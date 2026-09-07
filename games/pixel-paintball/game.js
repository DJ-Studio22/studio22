// games/pixel-paintball/game.js
//
// Pixel Paintball — the ground is the scoreboard.
//
// THE RULE
// --------
// One arena, one roller, and bots that want the same floor you do. You paint
// the ground you walk over and the ground your shots land on. Splattering a
// bot scores you nothing — it takes that bot out for a few seconds, which is
// long enough to paint the patch it was defending. When the whistle goes you
// keep playing only if you are holding better than a third of the arena.
//
// WHAT MAKES IT A DECISION
// ------------------------
// One tank, two uses. Ink pays for every cell that changes hands and for every
// shot, and it comes back six times faster when the ground around you is
// already yours. So attacking is what empties you and your own territory is
// where you reload — and a player who only hunts has nowhere to go when the
// tank runs dry.
//
// arena.js proves that rather than claiming it: the same bot is swept from
// never-shoot to only-shoot, and the best score is in the middle. Take the ink
// away in the tuning and the hunter wins outright, which is where three
// earlier versions of this game sat without anything failing.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp } from '../../engine/util.js';

import { Arena, OWNER, POWERUP, TUNING, holdNeededFor, waveShape } from './arena.js';

const GAME_ID = 'pixel-paintball';

// One cell is CELL pixels square. The canvas is the arena plus a strip of HUD.
const CELL = 19;
const HUD = 56;
const W = TUNING.cols * CELL;          // 912
const H = TUNING.rows * CELL + HUD;    // 626

// --- Art palette ---------------------------------------------------------
//
// Pixel Paintball's own colours, deliberately NOT from tokens.css. Two paints
// that could not be confused at a glance or by anyone who confuses red and
// green: the player is cyan, the bots are magenta, and the bare floor between
// them is a flat dark grey so both read as paint on concrete rather than as
// two halves of a gradient. The shell still draws pause, game over and its own
// screens in site tokens over the top.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  floor: {
    bare: '#22242c',
    grid: 'rgba(255,255,255,0.035)',
    edge: 'rgba(255,255,255,0.10)',
    hud: '#15161b',
  },
  mine: {
    paint: '#22d3ee',
    edge: '#7ff0ff',
    dark: '#0e7490',
  },
  theirs: {
    paint: '#f0559b',
    edge: '#ffa3cb',
    dark: '#8c1e52',
  },
  player: {
    body: '#e8fbff',
    rim: '#0e7490',
    barrel: '#22d3ee',
    stunned: '#7a8390',
  },
  bot: {
    body: '#ffe1ee',
    rim: '#8c1e52',
    barrel: '#f0559b',
    stunned: '#5c4450',
  },
  shot: {
    mine: '#7ff0ff',
    theirs: '#ffa3cb',
  },
  power: {
    ring: '#ffd54a',
    core: '#fff3c4',
    text: '#1b1a16',
  },
  hud: {
    text: '#eef2f7',
    dim: 'rgba(238,242,247,0.55)',
    ink: '#ffd54a',
    inkLow: '#ff6b5a',
    warn: '#ff6b5a',
    good: '#22d3ee',
  },
};

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 320 });

// Move with the left half or the stick; the right pad fires along the way you
// are facing, which is what the stick, the keys and a thumb all agree on.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.74, radius: 58, label: 'PAINT' },
]);
Input.setAimStickEnabled(false);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  shoot: { beep: { freq: 660, duration: 0.04, type: 'square', volume: 0.06 } },
  splat: { beep: { freq: 240, duration: 0.09, type: 'triangle', volume: 0.12 } },
  hitBot: { beep: { freq: 880, duration: 0.11, type: 'sine', volume: 0.16 } },
  hurt: { beep: { freq: 110, duration: 0.28, type: 'sawtooth', volume: 0.22 } },
  dry: { beep: { freq: 150, duration: 0.05, type: 'square', volume: 0.07 } },
  power: { beep: { freq: 760, duration: 0.22, type: 'triangle', volume: 0.18 } },
  wave: { beep: { freq: 500, duration: 0.3, type: 'triangle', volume: 0.18 } },
  over: { beep: { freq: 80, duration: 0.8, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let arena = new Arena();
let running = false;
let aim = 0;
let shake = 0;
let flash = null;
let lastHit = 0;
let lastSplat = 0;
let lastWave = 1;
let lastShots = 0;
let dryNoise = 0;

function reset() {
  arena = new Arena();
  running = true;
  aim = 0;
  shake = 0;
  flash = null;
  lastHit = 0;
  lastSplat = 0;
  lastWave = 1;
  lastShots = 0;
  dryNoise = 0;
  particles.clear();
}

const DRY_TEXT = 'OUT OF INK — LET GO AND FALL BACK';

function say(text, colour) { flash = { text, colour, life: 2 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(Math.round(arena.score), {
    wavesHeld: arena.wave - 1,
    bestHold: `${Math.round(arena.bestHold * 100)}%`,
    botsSplattered: arena.splattered,
    timesHit: arena.timesHit,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 3);
  if (flash && flash.text !== DRY_TEXT) {
    flash.life -= dt;
    if (flash.life <= 0) flash = null;
  }
  if (dryNoise > 0) dryNoise -= dt;

  if (!running) return;

  const pad = Input.get();
  // Facing follows the way you are moving, so one stick does both and a
  // keyboard is not a second-class way to play.
  if (Math.hypot(pad.x, pad.y) > 0.2) aim = Math.atan2(pad.y, pad.x);

  // Held, not pressed: the trigger is something you hold down, and the ink is
  // what stops that being the whole game.
  arena.step(dt, { x: pad.x, y: pad.y, aim, fire: pad.a || pad.b });

  if (arena.shots.length > lastShots) audio.play('shoot', { pitchVariance: 0.2 });
  lastShots = arena.shots.length;

  if (arena.splattered > lastSplat) {
    audio.play('hitBot');
    particles.emit(px(arena.player.x), py(arena.player.y), {
      ...ParticlePresets.sparkle, count: 8, colors: [ART.mine.paint, ART.mine.edge], speed: [40, 140],
    });
  }
  lastSplat = arena.splattered;

  if (arena.timesHit > lastHit) {
    audio.play('hurt');
    shake = 1;
    particles.emit(px(arena.player.x), py(arena.player.y), {
      ...ParticlePresets.explosion, count: 22, colors: [ART.theirs.paint, ART.theirs.edge], speed: [80, 220],
    });
  }
  lastHit = arena.timesHit;

  // RUNNING DRY HAS TO BE LOUD.
  //
  // Hand-play found this and nothing else would have: holding the trigger down
  // permanently is a perfectly reasonable thing for a player to try, and it
  // means the tank never refills, which means no shots AND no paint. The game
  // was correct and silent -- forty seconds of pressing everything with nothing
  // appearing on the floor. The rule stays; what changed is that it now says
  // so.
  if (arena.player.ink < TUNING.inkPerShot) {
    if (dryNoise <= 0) {
      audio.play('dry');
      dryNoise = 0.7;
    }
    if (!flash || flash.text !== DRY_TEXT) say(DRY_TEXT, ART.hud.warn);
  } else if (flash && flash.text === DRY_TEXT) {
    flash = null;
  }

  if (arena.wave !== lastWave) {
    lastWave = arena.wave;
    audio.play('wave');
    const shape = waveShape(arena.wave);
    say(`WAVE ${arena.wave} — ${shape.bots} BOTS`, ART.hud.good);
  }

  if (!arena.running) finish();
}

// --- Drawing -------------------------------------------------------------

const px = (x) => x * CELL;
const py = (y) => y * CELL + HUD;

// The floor is drawn as a fourteen-hundred-pixel image and scaled up, rather
// than as fourteen hundred fillRect calls a frame. Same picture, and it holds
// sixty on a phone.
const paintLayer = document.createElement('canvas');
paintLayer.width = TUNING.cols;
paintLayer.height = TUNING.rows;
const paintCtx = paintLayer.getContext('2d');
const paintImage = paintCtx.createImageData(TUNING.cols, TUNING.rows);

/** '#rrggbb' to [r, g, b], so the pixel floor still reads its colours from ART. */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const RGB = {
  [OWNER.NONE]: rgb(ART.floor.bare),
  [OWNER.PLAYER]: rgb(ART.mine.paint),
  [OWNER.BOT]: rgb(ART.theirs.paint),
};

function drawPaint() {
  const data = paintImage.data;
  for (let i = 0; i < arena.cells.length; i++) {
    const [r, g, b] = RGB[arena.cells[i]];
    const o = i * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  paintCtx.putImageData(paintImage, 0, 0);
  // Nearest-neighbour, because this is pixel paint and a smoothed edge would
  // turn the boundary between two territories into a gradient of neither.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(paintLayer, 0, HUD, W, TUNING.rows * CELL);
  ctx.imageSmoothingEnabled = true;

  ctx.strokeStyle = ART.floor.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let cx = 0; cx <= TUNING.cols; cx += 4) {
    ctx.moveTo(px(cx), HUD);
    ctx.lineTo(px(cx), H);
  }
  for (let cy = 0; cy <= TUNING.rows; cy += 4) {
    ctx.moveTo(0, py(cy));
    ctx.lineTo(W, py(cy));
  }
  ctx.stroke();
}

function drawFighter(x, y, angle, stunned, art) {
  ctx.save();
  ctx.translate(px(x), py(y));
  ctx.rotate(angle);
  ctx.fillStyle = stunned ? art.stunned : art.barrel;
  ctx.fillRect(0, -4, 20, 8);
  ctx.beginPath();
  ctx.fillStyle = stunned ? art.stunned : art.body;
  ctx.strokeStyle = art.rim;
  ctx.lineWidth = 3;
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRefillHalo() {
  // WHERE YOU CAN RELOAD, drawn rather than left to be discovered. The rule is
  // that the ground around you has to be mostly yours; a ring that lights up
  // when it is says so without a word of tutorial.
  const home = arena.homeShare(arena.player.x, arena.player.y) >= TUNING.refillHomeShare;
  ctx.strokeStyle = home ? ART.mine.edge : 'rgba(255,255,255,0.10)';
  ctx.lineWidth = home ? 3 : 1.5;
  ctx.globalAlpha = home ? 0.55 : 0.3;
  ctx.beginPath();
  ctx.arc(px(arena.player.x), py(arena.player.y), TUNING.refillRadius * CELL, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPowerup() {
  if (!arena.powerup) return;
  const x = px(arena.powerup.x);
  const y = py(arena.powerup.y);
  const label = arena.powerup.kind === POWERUP.ROLLER ? 'W'
    : arena.powerup.kind === POWERUP.RAPID ? 'R' : 'D';
  ctx.fillStyle = ART.power.core;
  ctx.strokeStyle = ART.power.ring;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ART.power.text;
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawShots() {
  for (const shot of arena.shots) {
    ctx.fillStyle = shot.owner === OWNER.PLAYER ? ART.shot.mine : ART.shot.theirs;
    ctx.beginPath();
    ctx.arc(px(shot.x), py(shot.y), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHud() {
  ctx.fillStyle = ART.floor.hud;
  ctx.fillRect(0, 0, W, HUD);

  const hold = arena.hold ?? arena.holdings().player;

  // THE BAR IS THE SCOREBOARD, because the score IS the ground. Player paint
  // from the left, bots from the right, and the line you have to stay above
  // marked on it — so "am I winning" is one glance rather than a number.
  const barX = 16;
  const barY = 30;
  const barW = W - 300;
  const barH = 16;
  ctx.fillStyle = ART.floor.bare;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = ART.mine.paint;
  ctx.fillRect(barX, barY, barW * hold, barH);
  const theirs = arena.holdings().bot;
  ctx.fillStyle = ART.theirs.paint;
  ctx.fillRect(barX + barW * (1 - theirs), barY, barW * theirs, barH);

  // The line is drawn from the same function that ends the run, so what the
  // bar promises and what the whistle does cannot come apart.
  const needed = holdNeededFor(arena.wave);
  const line = barX + barW * needed;
  ctx.strokeStyle = hold >= needed ? ART.hud.good : ART.hud.warn;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(line, barY - 5);
  ctx.lineTo(line, barY + barH + 5);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.text;
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText(String(Math.round(arena.score)), barX, 22);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText(`WAVE ${arena.wave}  ·  ${Math.round(hold * 100)}% HELD`, barX + 74, 22);

  // The tank.
  const inkX = W - 268;
  const ink = arena.player.ink / TUNING.inkMax;
  ctx.fillStyle = ART.hud.dim;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText('INK', inkX, 22);
  ctx.fillStyle = ART.floor.bare;
  ctx.fillRect(inkX + 32, 10, 120, 14);
  const dry = arena.player.ink < TUNING.inkPerShot;
  ctx.fillStyle = ink < 0.25 ? ART.hud.inkLow : ART.hud.ink;
  ctx.fillRect(inkX + 32, 10, 120 * ink, 14);
  if (dry) {
    // An empty bar is easy to not notice; an empty bar with a pulse around it
    // is not.
    ctx.strokeStyle = ART.hud.inkLow;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 160));
    ctx.strokeRect(inkX + 30, 8, 124, 18);
    ctx.globalAlpha = 1;
  }

  // The clock, which is the wave rather than the run.
  const left = Math.max(0, TUNING.waveSeconds - arena.time);
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.text;
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText(`${left.toFixed(1)}s`, W - 16, 22);
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.dim;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(
    arena.player.powerup ? `${arena.player.powerup.toUpperCase()} ${arena.player.powerupLeft.toFixed(1)}s` : '',
    inkX + 32, 46,
  );
}

function render() {
  ctx.fillStyle = ART.floor.bare;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 8, (Math.random() - 0.5) * shake * 8);

  drawPaint();
  drawRefillHalo();
  drawPowerup();
  for (const bot of arena.bots) drawFighter(bot.x, bot.y, bot.aim, bot.stun > 0, ART.bot);
  drawFighter(arena.player.x, arena.player.y, aim, arena.player.stun > 0, ART.player);
  drawShots();
  particles.draw(ctx);

  ctx.strokeStyle = ART.floor.edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, HUD + 1, W - 2, TUNING.rows * CELL - 2);
  ctx.restore();

  drawHud();

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, HUD + 90);
    ctx.globalAlpha = 1;
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
  title: 'Pixel Paintball',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move and paint', gamepad: 'Left stick', keyboard: 'WASD or arrows', touch: 'Drag the left side' },
    { action: 'Shoot', gamepad: 'A', keyboard: 'Space', touch: 'PAINT pad' },
    { action: 'Ink', gamepad: 'Pays for paint AND for shots', keyboard: 'Pays for paint AND for shots', touch: 'Pays for paint and shots' },
    { action: 'Reload', gamepad: 'Fall back onto your own paint', keyboard: 'Fall back onto your own paint', touch: 'Fall back onto your own paint' },
    { action: 'The whistle', gamepad: 'Hold a third of the floor or you are out', keyboard: 'Hold a third of the floor or you are out', touch: 'Hold a third of the floor' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Pixel Paintball',
  tagline: 'The ground is the scoreboard.',
});
