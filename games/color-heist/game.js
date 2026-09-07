// games/color-heist/game.js
//
// Colour Heist — the doors only open for what you are wearing.
//
// THE RULE
// --------
// Cross the vault to the exit before the alarm. A coloured door only lets you
// through while you are that colour, and changing colour means standing still
// for half a second you cannot spare. Gems sit off the fastest route, so
// taking one is a decision rather than a pickup. Gems stolen is the score.
//
// WHY THE CONSTRAINT IS REAL
// --------------------------
// Because switching costs TIME, and the clock is derived from the search that
// proved the floor: you get par plus a margin, and the margin shrinks every
// floor forever. So the game is not "can you get there", it is "how close to
// the best route can you get", and a switch you did not need is three and a
// half steps you did not take.
//
// maze.js proves both halves of that. Every floor is provably crossable — the
// search over (cell, colour) is exact, so a rejection is a fact rather than a
// doubt — and a bot that plans around the doors outlives one that only reacts
// to them.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, and the one thing that has to be right:
// making a door's colour, and your own, readable at a glance while moving. Not
// one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp, randRange } from '../../engine/util.js';

import { COLOUR, COLOURS, Heist, OPEN, TUNING } from './maze.js';

const GAME_ID = 'color-heist';

const W = 900;
const H = 600;

// --- Art palette ---------------------------------------------------------
//
// Colour Heist' own colours, deliberately NOT from tokens.css. A dark museum
// after hours, lit only by the thing you are wearing. The three door colours
// are the load-bearing ones and were chosen by measurement rather than taste:
// they have to be far apart from each other, from the floor, and from the
// walls, because reading a door at a run IS the game.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  room: { back: '#0d0f16', floor: '#1b2030', floorAlt: '#171c2a', wall: '#39415c', wallTop: '#4d5779' },
  // Amber, cyan, magenta. Nothing else in the game is allowed near these.
  door: ['#ffb03a', '#3ad6ff', '#ff5ce0'],
  // A SHUT door has to read as a DOOR, not as a wall. At the first values a
  // closed cyan door scored 125 against the wall it sits in — so "locked for
  // now, switch and pass" looked the same as "never, go round", which is the
  // one distinction the whole game turns on. 187 and up now, and still clearly
  // dimmer than the same door open.
  doorDark: ['#a87116', '#1a93a8', '#a8288f'],
  thief: { body: '#f4f1ea', edge: '#0d0f16', visor: '#0d0f16' },
  gem: { body: '#7bf5b0', edge: '#1d7d4e', glint: '#e8fff3' },
  exit: { frame: '#f4f1ea', glow: 'rgba(244,241,234,.16)', arrow: '#7bf5b0' },
  hud: {
    label: 'rgba(238,240,248,.58)',
    value: '#f2f4fa',
    good: '#7bf5b0',
    warn: '#ffb03a',
    bad: '#ff6b5a',
    panel: 'rgba(8,10,16,.86)',
    panelEdge: 'rgba(238,240,248,.14)',
    barTrack: 'rgba(8,10,16,.6)',
  },
  spark: ['#7bf5b0', '#e8fff3', '#ffb03a'],
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 200 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.87, yRatio: 0.72, radius: 50, label: 'Next' },
  { name: 'b', xRatio: 0.87, yRatio: 0.92, radius: 44, label: 'Back' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  step: { beep: { freq: 260, duration: 0.03, type: 'square', volume: 0.06 } },
  blocked: { beep: { freq: 120, duration: 0.06, type: 'square', volume: 0.09 } },
  switch: { beep: { freq: 540, duration: 0.12, type: 'triangle', volume: 0.15 } },
  gem: { beep: { freq: 880, duration: 0.13, type: 'sine', volume: 0.18 } },
  floor: { beep: { freq: 440, duration: 0.30, type: 'triangle', volume: 0.18 } },
  warn: { beep: { freq: 200, duration: 0.10, type: 'sawtooth', volume: 0.12 } },
  over: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let heist = new Heist();
let running = false;
let time = 0;
let shake = 0;
let flash = null;
let navLatch = 0;
let lastWarn = 0;
// Where the thief is DRAWN, which eases toward the cell it is in — so a step
// reads as a step rather than a teleport.
let drawX = 0;
let drawY = 0;

function reset() {
  heist = new Heist();
  running = true;
  time = 0;
  shake = 0;
  flash = null;
  lastWarn = 0;
  drawX = heist.x;
  drawY = heist.y;
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 1.4 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(heist.gems, {
    reachedFloor: heist.floor,
    floorsCleared: heist.floorsCleared,
    switches: heist.switches,
    steps: heist.steps,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  time += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  // Ease the drawn position toward the true one.
  drawX += (heist.x - drawX) * Math.min(1, dt * 16);
  drawY += (heist.y - drawY) * Math.min(1, dt * 16);

  if (!running) return;

  const pad = Input.get();
  const floorBefore = heist.floorsCleared;
  const gemsBefore = heist.gems;

  // One step per press of a direction, so a cell is a decision rather than
  // something you slide past.
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  const dir = dx !== 0 ? [dx, 0] : dy !== 0 ? [0, dy] : null;
  if (dir && navLatch === 0 && heist.busy <= 0) {
    if (heist.move(dir[0], dir[1])) {
      audio.play('step', { pitchVariance: 0.12 });
    } else {
      audio.play('blocked');
      shake = Math.max(shake, 0.22);
    }
  }
  navLatch = dx !== 0 ? dx : dy;

  if (Input.pressed('a')) doSwitch(1);
  if (Input.pressed('b')) doSwitch(-1);

  heist.step(dt);

  if (heist.gems > gemsBefore) {
    audio.play('gem');
    particles.emit(cellX(heist.x), cellY(heist.y), {
      ...ParticlePresets.sparkle, count: 12, colors: ART.spark, speed: [40, 130],
    });
  }
  if (heist.floorsCleared > floorBefore) {
    audio.play('floor');
    say(`Floor ${floorBefore + 1} — ${heist.floorGems} gems`, ART.hud.good);
    drawX = heist.x;
    drawY = heist.y;
  }

  // The alarm, ticking louder as it closes in.
  const share = heist.left / Math.max(0.001, heist.vault.limit);
  if (share < 0.3) {
    const every = share < 0.15 ? 0.28 : 0.55;
    if (time - lastWarn > every) { audio.play('warn'); lastWarn = time; }
  }

  if (!heist.running) finish();
}

function doSwitch(direction) {
  if (heist.busy > 0) return;
  if (heist.cycle(direction)) {
    audio.play('switch');
    particles.emit(cellX(heist.x), cellY(heist.y), {
      ...ParticlePresets.sparkle,
      count: 10, colors: [ART.door[heist.colour]], speed: [30, 100],
    });
  }
}

// --- Drawing -------------------------------------------------------------
//
// The whole vault is fitted to the canvas rather than drawn at a fixed cell
// size, because it grows from 7x5 to 21x15 and a fixed size would either
// overflow later or waste the screen early. Same lesson as the mini golf
// board, which shipped at a quarter of the size it should have been.

let view = { scale: 40, x: 0, y: 0 };

function layout() {
  const v = heist.vault;
  const top = 96;
  const bottom = 34;
  const scale = Math.min((W - 60) / v.cols, (H - top - bottom) / v.rows);
  view = {
    scale,
    x: (W - v.cols * scale) / 2,
    y: top + (H - top - bottom - v.rows * scale) / 2,
  };
}

const cellX = (x) => view.x + (x + 0.5) * view.scale;
const cellY = (y) => view.y + (y + 0.5) * view.scale;

function drawVault() {
  const v = heist.vault;
  const s = view.scale;

  // Floor, in a soft checker so distance is readable across a big vault.
  for (let y = 0; y < v.rows; y++) {
    for (let x = 0; x < v.cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? ART.room.floor : ART.room.floorAlt;
      ctx.fillRect(view.x + x * s, view.y + y * s, s, s);
    }
  }

  // Walls and doors. A wall is drawn as a solid bar; a door as a bar in its
  // colour with a gap through the middle, so "there is a way through here, if
  // you are the right colour" is one picture rather than two.
  const thick = Math.max(3, s * 0.14);
  for (let y = 0; y < v.rows; y++) {
    for (let x = 0; x < v.cols; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (!v.inside(x + dx, y + dy)) continue;
        const p = v.passage(x, y, dx, dy);
        const px = view.x + (x + (dx ? 1 : 0.5)) * s;
        const py = view.y + (y + (dy ? 1 : 0.5)) * s;
        const along = dx ? [0, 1] : [1, 0];

        if (p === null) {
          ctx.fillStyle = ART.room.wall;
          ctx.fillRect(
            px - (along[0] ? s / 2 : thick / 2), py - (along[1] ? s / 2 : thick / 2),
            along[0] ? s : thick, along[1] ? s : thick,
          );
        } else if (p !== OPEN) {
          const passable = p === heist.colour;
          ctx.fillStyle = passable ? ART.door[p] : ART.doorDark[p];
          const w = along[0] ? s : thick;
          const h = along[1] ? s : thick;
          ctx.fillRect(px - w / 2, py - h / 2, w, h);
          // The gap: a door you can pass is drawn open.
          if (passable) {
            ctx.fillStyle = (x + y) % 2 ? ART.room.floor : ART.room.floorAlt;
            const gw = along[0] ? s * 0.44 : thick * 2;
            const gh = along[1] ? s * 0.44 : thick * 2;
            ctx.fillRect(px - gw / 2, py - gh / 2, gw, gh);
          }
        }
      }
    }
  }

  // The outer wall.
  ctx.strokeStyle = ART.room.wallTop;
  ctx.lineWidth = Math.max(3, s * 0.12);
  ctx.strokeRect(view.x, view.y, v.cols * s, v.rows * s);
}

function drawGems() {
  const s = view.scale;
  for (const gem of heist.vault.gems) {
    if (heist.collected.has(gem.cell)) continue;
    const gx = cellX(gem.cell % heist.vault.cols);
    const gy = cellY((gem.cell / heist.vault.cols) | 0) + Math.sin(time * 3 + gem.cell) * s * 0.05;
    const r = s * 0.22;
    ctx.fillStyle = ART.gem.body;
    ctx.beginPath();
    ctx.moveTo(gx, gy - r);
    ctx.lineTo(gx + r * 0.8, gy);
    ctx.lineTo(gx, gy + r);
    ctx.lineTo(gx - r * 0.8, gy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ART.gem.edge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = ART.gem.glint;
    ctx.fillRect(gx - r * 0.28, gy - r * 0.45, r * 0.22, r * 0.5);
  }
}

function drawExit() {
  const v = heist.vault;
  const s = view.scale;
  const ex = cellX(v.exit % v.cols);
  const ey = cellY((v.exit / v.cols) | 0);
  const pulse = 0.6 + Math.sin(time * 3) * 0.25;
  ctx.fillStyle = ART.exit.glow;
  ctx.globalAlpha = pulse;
  ctx.beginPath();
  ctx.arc(ex, ey, s * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ART.exit.frame;
  ctx.lineWidth = 3;
  ctx.strokeRect(ex - s * 0.3, ey - s * 0.34, s * 0.6, s * 0.68);
  ctx.fillStyle = ART.exit.arrow;
  ctx.beginPath();
  ctx.moveTo(ex, ey - s * 0.16);
  ctx.lineTo(ex + s * 0.16, ey + s * 0.06);
  ctx.lineTo(ex - s * 0.16, ey + s * 0.06);
  ctx.closePath();
  ctx.fill();
}

function drawThief() {
  const s = view.scale;
  const x = view.x + (drawX + 0.5) * s;
  const y = view.y + (drawY + 0.5) * s;
  const mid = heist.busy > 0 && heist.busy > TUNING.stepSeconds;

  // The halo IS the colour you are wearing, and it is the biggest thing on
  // screen after the doors — because the one question the player asks fifty
  // times a floor is "what am I".
  ctx.fillStyle = ART.door[heist.colour];
  ctx.globalAlpha = mid ? 0.35 + Math.sin(time * 26) * 0.2 : 0.30;
  ctx.beginPath();
  ctx.arc(x, y, s * (mid ? 0.52 : 0.44), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ART.door[heist.colour];
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = ART.thief.body;
  ctx.beginPath();
  ctx.roundRect(x - s * 0.17, y - s * 0.22, s * 0.34, s * 0.44, s * 0.1);
  ctx.fill();
  ctx.strokeStyle = ART.thief.edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = ART.thief.visor;
  ctx.fillRect(x - s * 0.12, y - s * 0.13, s * 0.24, s * 0.09);
}

function drawHud() {
  const v = heist.vault;

  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(16, 14, 250, 66, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('GEMS', 30, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(String(heist.gems), 30, 62);

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('FLOOR', 96, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(String(heist.floor), 96, 62);

  // What you are, spelled out as three lamps with the live one filled. The
  // halo says it too, but a lamp row says which of three and in what order the
  // buttons will walk them.
  COLOURS.forEach((c, i) => {
    const cx = 176 + i * 28;
    ctx.beginPath();
    ctx.arc(cx, 48, 10, 0, Math.PI * 2);
    if (c === heist.colour) {
      ctx.fillStyle = ART.door[c];
      ctx.fill();
    } else {
      ctx.strokeStyle = ART.doorDark[c];
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  });

  // The alarm. The one number that is always urgent, so it gets the width.
  const share = clamp(heist.left / Math.max(0.001, v.limit), 0, 1);
  const barW = W - 320;
  ctx.fillStyle = ART.hud.barTrack;
  ctx.beginPath(); ctx.roundRect(288, 30, barW, 14, 7); ctx.fill();
  ctx.fillStyle = share < 0.18 ? ART.hud.bad : share < 0.4 ? ART.hud.warn : ART.hud.good;
  ctx.beginPath(); ctx.roundRect(288, 30, Math.max(4, barW * share), 14, 7); ctx.fill();

  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(
    `${heist.left.toFixed(1)}s  ·  par ${v.parTime.toFixed(1)}s with ${v.parSwitches} switches`,
    W - 24, 62,
  );
}

function render() {
  ctx.fillStyle = ART.room.back;
  ctx.fillRect(0, 0, W, H);

  layout();
  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 5, randRange(-1, 1) * shake * 5);
  drawVault();
  drawExit();
  drawGems();
  drawThief();
  particles.draw(ctx);
  ctx.restore();

  drawHud();

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, H - 46);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }
}

// --- Boot ----------------------------------------------------------------

let shell;

const loop = new GameLoop({
  update,
  render,
  onPause: () => shell?.pause(),
});

shell = new GameShell({
  gameId: GAME_ID,
  title: 'Colour Heist',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'WASD or arrows', touch: 'Drag the left side' },
    { action: 'Next colour', gamepad: 'A', keyboard: 'Space', touch: 'Next pad' },
    { action: 'Previous colour', gamepad: 'B', keyboard: 'Shift', touch: 'Back pad' },
    { action: 'Doors', gamepad: 'Open only for their own colour', keyboard: 'Open only for their own colour', touch: 'Open only for their own colour' },
    { action: 'Switching', gamepad: 'Costs half a second standing still', keyboard: 'Costs half a second standing still', touch: 'Costs half a second standing still' },
    { action: 'Gems', gamepad: 'Always off the fastest route', keyboard: 'Always off the fastest route', touch: 'Always off the fastest route' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Colour Heist',
  tagline: 'The doors only open for what you are wearing.',
});
