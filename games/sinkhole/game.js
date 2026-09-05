// games/sinkhole/game.js
//
// Sinkhole — a climbing game upside down.
//
// The ground keeps rising. You fall through gaps in it to stay ahead, and if
// you cannot find a gap the ledge you are standing on carries you up into the
// spikes. Hesitating is what kills you, which is the whole design: there is
// no safe place to stand and think, because standing still is what the game
// punishes.
//
// UNITS: seconds, per the engine doctrine. Nothing here was ported from a
// per-frame prototype, so every constant below is already units-per-second or
// units-per-second-squared.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, randRange as R, clamp } from '../../engine/util.js';

const GAME_ID = 'sinkhole';

// Portrait: the whole game is a vertical column, and a wide canvas would be
// mostly empty wall on either side.
const W = 480;
const H = 720;
const TAU = Math.PI * 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome.
//
// Underground: warm earth and lamplight rather than Comet's cold void or
// Updraft's night sky. The three games are all dark and all have to read as
// different rooms.
const ART = {
  rockTop: '#231a14',
  rockBottom: '#3d2a1c',
  wall: '#1a120d',
  dust: 'rgba(255,214,150,.05)',

  ledge: '#8a6234',
  ledgeTop: '#c08d4e',
  ledgeSpiked: '#7a3b30',
  ledgeSpikedTop: '#b0563f',
  spike: '#e0e0e0',
  spikeShade: '#9a9a9a',

  ceiling: '#2a1410',
  ceilingSpike: '#d8d2c4',
  ceilingWarn: 'rgba(220,80,60,.28)',

  player: '#ffd166',
  playerEdge: '#c98f24',
  playerEye: '#231a14',
  playerHurt: '#ff6b6b',

  lamp: 'rgba(255,196,110,.10)',
  depthText: 'rgba(255,214,150,.55)',

  puffRock: '#8a6234',
  puffHurt: '#ff6b6b',
  puffDive: 'rgba(255,209,102,.7)',
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 220 });

// One pad, named for what it does. Steering is the virtual stick on the left
// half, which engine/input.js provides without a layout.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.86, yRatio: 0.80, radius: 50, label: 'Dive' },
]);

// Depth is a distance and more is better — stated rather than assumed,
// because Circuit Racer in the same suite ranks the other way.
Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  land: { beep: { freq: 220, duration: 0.05, type: 'square', volume: 0.12 } },
  drop: { beep: { freq: 520, duration: 0.06, type: 'triangle', volume: 0.1 } },
  dive: { beep: { freq: 300, duration: 0.12, type: 'sawtooth', volume: 0.12 } },
  hurt: { beep: { freq: 150, duration: 0.28, type: 'sawtooth', volume: 0.22 } },
  death: { beep: { freq: 90, duration: 0.5, type: 'triangle', volume: 0.26 } },
});

// --- Tuning --------------------------------------------------------------

const GRAVITY = 1500;          // units/sec²
const DIVE_GRAVITY = 3400;
const MAX_FALL = 760;
const MAX_DIVE_FALL = 1150;
const MOVE_ACCEL = 3200;
const MAX_MOVE = 320;
const GROUND_DRAG_PER_SECOND = 0.0005;   // fraction of horizontal speed kept
const AIR_DRAG_PER_SECOND = 0.06;

const PLAYER_R = 14;

// Thick enough to be the shelf engine/shell.js draws its HUD on. A thin
// ceiling put the score on top of the spikes, where it was unreadable — and
// the slab reads as the roof of the cave rather than as padding.
const CEILING_H = 100;
const LEDGE_H = 16;
const LEDGE_SPACING = 132;

const BASE_SCROLL = 62;        // units/sec at depth 0
const SCROLL_PER_DEPTH = 0.011;
const MAX_SCROLL = 235;

const START_LIVES = 3;
const INVULN_TIME = 1.6;

// --- State ---------------------------------------------------------------

let depth = 0;
let lives = START_LIVES;
let invuln = 0;
let shake = 0;
let ledges = [];
let dead = false;

const P = { x: W / 2, y: 220, vx: 0, vy: 0, onGround: false, squash: 0 };

// Wall texture, generated once. Regenerating it per frame would be the
// single most expensive thing in the game for no visual gain.
const grit = [];
for (let i = 0; i < 90; i++) {
  grit.push({ x: R(0, W), y: R(0, H), r: R(1, 3.4), a: R(0.02, 0.09) });
}

const SKY = (() => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, ART.rockTop);
  gradient.addColorStop(1, ART.rockBottom);
  return gradient;
})();

// --- Level ---------------------------------------------------------------

function scrollSpeed() {
  return Math.min(BASE_SCROLL + depth * SCROLL_PER_DEPTH, MAX_SCROLL);
}

/**
 * One ledge: a full-width shelf with a single gap in it.
 *
 * The gap narrows with depth and the spiked share rises, which is the whole
 * difficulty curve — there is no separate "level", just a floor that gets
 * harder to fall through.
 */
function makeLedge(y) {
  const gapW = clamp(168 - depth * 0.012, 76, 168);
  const gapX = R(16, W - gapW - 16);
  const spiked = Math.random() < Math.min(0.08 + depth * 0.00012, 0.42);
  return { y, gapX, gapW, spiked };
}

function lowestLedgeY() {
  let low = -Infinity;
  for (const ledge of ledges) low = Math.max(low, ledge.y);
  return low === -Infinity ? 0 : low;
}

function reset() {
  depth = 0;
  lives = START_LIVES;
  invuln = 0;
  shake = 0;
  dead = false;
  particles.clear();

  P.x = W / 2;
  P.y = 200;
  P.vx = 0;
  P.vy = 0;
  P.onGround = false;
  P.squash = 0;

  ledges = [];
  for (let y = 360; y < H + LEDGE_SPACING; y += LEDGE_SPACING) {
    ledges.push(makeLedge(y));
  }
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;
  if (dead) return;

  const pad = Input.get();
  const diving = pad.a || pad.rt || pad.b;

  // Horizontal. Accelerated rather than instant, so a ledge edge can be
  // overshot — which is what makes threading a narrowing gap a skill rather
  // than a reflex.
  P.vx += pad.x * MOVE_ACCEL * dt;
  const drag = P.onGround ? GROUND_DRAG_PER_SECOND : AIR_DRAG_PER_SECOND;
  P.vx *= drag ** dt;
  P.vx = clamp(P.vx, -MAX_MOVE, MAX_MOVE);
  P.x = clamp(P.x + P.vx * dt, PLAYER_R, W - PLAYER_R);

  // Vertical. Diving is the answer to hesitating: it costs nothing but the
  // control you give up by falling faster.
  const gravity = diving ? DIVE_GRAVITY : GRAVITY;
  const terminal = diving ? MAX_DIVE_FALL : MAX_FALL;
  P.vy = Math.min(P.vy + gravity * dt, terminal);

  if (diving && P.vy > 300 && Math.random() < dt * 30) {
    particles.emit(P.x, P.y - PLAYER_R, {
      count: 1, colors: [ART.puffDive], speed: [10, 60], life: [0.15, 0.35],
      size: [2, 3], shape: 'circle', shrink: true,
    });
  }

  const previousBottom = P.y + PLAYER_R;
  P.y += P.vy * dt;

  // The world rises. Everything moves up by the same amount, which is what
  // makes the ledges feel like a floor coming up rather than the player
  // sinking.
  const rise = scrollSpeed() * dt;
  depth += rise;
  for (const ledge of ledges) ledge.y -= rise;
  particles.shift(0, -rise);

  P.onGround = false;
  landOnLedges(previousBottom);

  // Standing on a rising ledge carries the player up with it. Without this
  // the player would sink through a ledge that is moving underneath them.
  if (P.onGround) P.y -= rise;

  recycleLedges();

  // The ceiling. Being carried into it is the death this game is about.
  if (P.y - PLAYER_R < CEILING_H) {
    P.y = CEILING_H + PLAYER_R;
    hurt();
  }

  if (invuln > 0) invuln = Math.max(0, invuln - dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 24);
  if (P.squash > 0) P.squash = Math.max(0, P.squash - dt * 5);
  particles.update(dt);
}

function landOnLedges(previousBottom) {
  const bottom = P.y + PLAYER_R;
  if (P.vy < 0) return;

  for (const ledge of ledges) {
    // Only the downward crossing counts: passing the plane this step, rather
    // than merely overlapping, so a fast fall cannot tunnel through a ledge.
    if (previousBottom > ledge.y || bottom < ledge.y) continue;

    // Through the gap, which is the point of the game.
    const inGap = P.x + PLAYER_R * 0.55 > ledge.gapX
      && P.x - PLAYER_R * 0.55 < ledge.gapX + ledge.gapW;
    if (inGap) continue;

    if (ledge.spiked) {
      hurt();
      return;
    }

    P.y = ledge.y - PLAYER_R;
    P.vy = 0;
    P.onGround = true;
    if (P.squash <= 0) audio.play('land');
    P.squash = 1;
    return;
  }
}

function recycleLedges() {
  // Off the top: gone, and a fresh one is added below so the column never
  // runs out of floor.
  ledges = ledges.filter((ledge) => ledge.y > -LEDGE_H * 2);
  while (lowestLedgeY() < H + LEDGE_SPACING) {
    ledges.push(makeLedge(lowestLedgeY() + LEDGE_SPACING));
  }
}

function hurt() {
  if (invuln > 0) return;

  lives--;
  shake = 1;
  audio.play(lives > 0 ? 'hurt' : 'death');
  particles.emit(P.x, P.y, {
    count: 20, colors: [ART.puffHurt], speed: [80, 300], life: [0.3, 0.7],
    size: [3, 3], gravity: 300, drag: 0.9, shape: 'circle', shrink: true,
  });

  if (lives <= 0) {
    dead = true;
    shell.showGameOver(Math.floor(depth / 10), {
      depthReached: `${Math.floor(depth / 10)} m`,
      fallSpeed: `${Math.round(scrollSpeed())} u/s`,
    });
    return;
  }

  // Dropped back to a safe height with a moment of grace, rather than
  // respawned into the same crush.
  invuln = INVULN_TIME;
  P.y = H * 0.42;
  P.vy = 0;
  P.vx = 0;
}

// --- Draw ----------------------------------------------------------------

function render() {
  ctx.save();
  if (shake > 0.02) ctx.translate(R(-shake * 6, shake * 6), R(-shake * 6, shake * 6));

  ctx.fillStyle = SKY;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  for (const speck of grit) {
    ctx.globalAlpha = speck.a;
    ctx.fillStyle = ART.dust;
    ctx.beginPath();
    ctx.arc(speck.x, speck.y, speck.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // A lamp glow around the player, so the eye goes to the thing it controls.
  const lamp = ctx.createRadialGradient(P.x, P.y, 10, P.x, P.y, 210);
  lamp.addColorStop(0, ART.lamp);
  lamp.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, W, H);

  for (const ledge of ledges) drawLedge(ledge);
  drawCeiling();
  particles.draw(ctx);
  drawPlayer();

  ctx.restore();

  drawDepth();

  shell.drawHud({
    score: Math.floor(depth / 10),
    best: Session.getBest(GAME_ID),
    lives,
  });

  shell.render();
}

function drawLedge(ledge) {
  const top = ledge.spiked ? ART.ledgeSpikedTop : ART.ledgeTop;
  const body = ledge.spiked ? ART.ledgeSpiked : ART.ledge;

  const segments = [
    [0, ledge.gapX],
    [ledge.gapX + ledge.gapW, W - (ledge.gapX + ledge.gapW)],
  ];

  for (const [x, width] of segments) {
    if (width <= 0) continue;
    ctx.fillStyle = body;
    ctx.fillRect(x, ledge.y, width, LEDGE_H);
    ctx.fillStyle = top;
    ctx.fillRect(x, ledge.y, width, 4);

    // Spikes are drawn as actual spikes rather than signalled by colour
    // alone: the difference between a ledge you can stand on and one that
    // hurts has to survive a player who cannot separate the two hues.
    if (ledge.spiked) {
      ctx.fillStyle = ART.spike;
      const step = 14;
      for (let sx = x + 3; sx < x + width - 3; sx += step) {
        ctx.beginPath();
        ctx.moveTo(sx, ledge.y);
        ctx.lineTo(sx + step / 2, ledge.y - 9);
        ctx.lineTo(sx + step, ledge.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = ART.spikeShade;
      ctx.fillRect(x, ledge.y + LEDGE_H - 3, width, 3);
    }
  }
}

function drawCeiling() {
  ctx.fillStyle = ART.ceiling;
  ctx.fillRect(0, 0, W, CEILING_H);

  ctx.fillStyle = ART.ceilingSpike;
  const step = 24;
  for (let x = 0; x < W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, CEILING_H);
    ctx.lineTo(x + step / 2, CEILING_H + 16);
    ctx.lineTo(x + step, CEILING_H);
    ctx.closePath();
    ctx.fill();
  }

  // A warning wash that grows as the player nears the spikes, so the danger
  // is legible before it is fatal.
  const nearness = clamp(1 - (P.y - CEILING_H) / 220, 0, 1);
  if (nearness > 0) {
    ctx.globalAlpha = nearness;
    ctx.fillStyle = ART.ceilingWarn;
    ctx.fillRect(0, CEILING_H, W, 150);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  // Blink through the grace period, the arcade shorthand for "you cannot be
  // hit right now".
  if (invuln > 0 && Math.floor(invuln * 12) % 2 !== 0) return;

  const squash = 1 - P.squash * 0.28;
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.scale(1 + P.squash * 0.22, squash);

  ctx.fillStyle = invuln > 0 ? ART.playerHurt : ART.player;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = ART.playerEdge;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Eyes look the way you are moving, which is the cheapest possible way to
  // make a circle read as a creature.
  const look = clamp(P.vx / MAX_MOVE, -1, 1) * 4;
  ctx.fillStyle = ART.playerEye;
  ctx.beginPath();
  ctx.arc(-4 + look, -3, 2.6, 0, TAU);
  ctx.arc(4 + look, -3, 2.6, 0, TAU);
  ctx.fill();

  ctx.restore();
}

function drawDepth() {
  ctx.save();
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = ART.depthText;
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.floor(depth / 10)} m down`, W / 2, H - 22);
  ctx.restore();
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
  title: 'Sinkhole',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'Arrows or A / D', touch: 'Drag the left side' },
    { action: 'Dive', gamepad: 'A or RT', keyboard: 'Space', touch: 'Dive button' },
    { action: 'Stay alive', gamepad: 'Do not get pushed into the spikes', keyboard: 'Do not get pushed into the spikes', touch: 'Do not get pushed into the spikes' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Sinkhole', tagline: "Keep falling. Don't get caught." });
