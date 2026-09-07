// games/mini-golf/game.js
//
// Endless Mini Golf — aim, power, and a bank of strokes that runs out.
//
// THE RULE
// --------
// Sink the ball. Sinking under par banks the difference; going over spends it.
// Run the bank to zero and the round is over, mid-hole if that is where it
// happens. Holes completed is the score — strokes are the RESOURCE, not the
// result, which is why the scoreboard counts holes and the HUD counts strokes.
//
// ONE CONTROL MODEL, THREE DEVICES
// --------------------------------
// Aim on the stick, the arrow keys, or the touch joystick. Charge by HOLDING
// the putt button and release to hit. Identical on all three, deliberately:
// three different control schemes would mean the difficulty numbers measured
// in tests/ only describe one of them.
//
// The power meter rises and falls while held rather than only rising, so
// letting go is a timing decision at every power rather than only at full.
//
// WHAT IS PROVED RATHER THAN HOPED
// --------------------------------
// Every hole is generated and then SOLVED — a search over the real putt
// physics sinks it within par — before it is ever dealt. A hole the search
// cannot solve is thrown away and another generated. That lives in green.js
// and holes.js with no DOM attached, and tests/mini-golf.green.test.mjs runs
// it.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, and the grass. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem } from '../../engine/util.js';

import { Course } from './holes.js';
import { RAMP_PUSH, T, TILE, TUNING, isRamp } from './green.js';

const GAME_ID = 'mini-golf';

const W = 760;
const H = 560;

// How long the ball takes to roll out on screen, per simulated second.
const ROLL_SPEED = 1;

// --- Art palette ---------------------------------------------------------
//
// Mini Golf's own colours, deliberately NOT from tokens.css. Crazy golf is a
// bright, flat, municipal sort of place and the tokens are the arcade's dark
// chrome; the shell still draws pause, game over and the HUD in site tokens
// straight over the top, which is what keeps it recognisably Studio 22.
//
// Grouped by subject per CLAUDE.md. The tile colours are chosen so that no two
// ADJACENT meanings are close in value — a water hazard that reads as grass at
// a glance is the same class of fault as Rift Runner's invisible gaps, and it
// is checked the same way, by sampling the canvas.
const ART = {
  table: '#11261c',
  rough: '#123322',
  green: '#3f9d5a',
  greenAlt: '#379152',
  wall: '#e8ddc4',
  wallEdge: '#a8977a',
  water: '#2b6ecf',
  waterFoam: 'rgba(190,225,255,.45)',
  sand: '#e3c778',
  ramp: '#6ad2a0',
  rampArrow: 'rgba(10,40,25,.55)',
  mover: '#ff6b5a',
  moverEdge: '#8f2c22',
  cup: '#0b1a12',
  cupRim: '#f6f2e8',
  flag: '#ff4d5e',
  flagPole: '#f6f2e8',
  ball: '#ffffff',
  ballEdge: '#9aa6a0',
  aim: 'rgba(255,255,255,.75)',
  aimDot: 'rgba(255,255,255,.35)',
  power: {
    back: 'rgba(10,26,18,.72)',
    low: '#7fe07f',
    mid: '#ffd45e',
    high: '#ff6b5a',
  },
  hud: {
    label: 'rgba(255,255,255,.6)',
    value: '#ffffff',
    bankGood: '#7fe07f',
    bankLow: '#ff6b5a',
    par: '#ffd45e',
  },
  spark: ['#ffffff', '#7fe07f', '#ffd45e'],
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 180 });

// The joystick stays for aiming; one pad charges the putt. Same model as the
// stick-and-button on a pad and the arrows-and-space on a keyboard.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.80, radius: 56, label: 'Putt' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  hit: { beep: { freq: 520, duration: 0.05, type: 'square', volume: 0.14 } },
  wall: { beep: { freq: 240, duration: 0.04, type: 'triangle', volume: 0.10 } },
  water: { beep: { freq: 150, duration: 0.30, type: 'sine', volume: 0.18 } },
  sink: { beep: { freq: 880, duration: 0.22, type: 'triangle', volume: 0.24 } },
  bank: { beep: { freq: 1180, duration: 0.16, type: 'square', volume: 0.16 } },
  over: { beep: { freq: 90, duration: 0.6, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let course = new Course();
let running = false;

let aim = 0;              // radians
let charging = false;
let power = 0;            // 0..1
let powerDir = 1;

// The ball is simulated instantly by putt(); this replays the path on screen
// so the player sees the roll rather than a teleport.
let rolling = null;       // { path, index }
let ballDraw = { x: 0, y: 0 };
let sinkFlash = 0;
let bankFlash = 0;

function reset() {
  course = new Course();
  running = true;
  aim = 0;
  charging = false;
  power = 0;
  powerDir = 1;
  rolling = null;
  ballDraw = { ...course.ball };
  sinkFlash = 0;
  bankFlash = 0;
  particles.clear();
}

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(course.completed, {
    reachedHole: course.holeNumber,
    strokeBank: course.bank,
    lastPar: course.hole.par,
    ending: course.reason,
  });
}

/**
 * Replays a putt on screen.
 *
 * The simulation resolves a stroke instantly, which is right for the search
 * and wrong for the player: a ball that teleports gives no feedback about the
 * bounce that saved it or the water that took it. So the path is re-walked at
 * a watchable rate, and the game does not accept another stroke until it lands.
 */
function beginRoll(from, angle, strength) {
  const path = [];
  const step = 1 / 120;
  const hole = course.hole;
  // Re-run the same physics, sampling as it goes. Same function the rules use,
  // so what is drawn is what happened.
  let x = from.x;
  let y = from.y;
  const speed = strength * (TUNING.maxPower - TUNING.minPower) + TUNING.minPower;
  let vx = Math.cos(angle) * speed;
  let vy = Math.sin(angle) * speed;
  let time = course.time;
  for (let i = 0; i < 12 / step; i++) {
    time += step;
    const tile = hole.tileAt(x, y);
    if (tile === T.WATER) { path.push({ x, y, splash: true }); break; }
    if (isRamp(tile)) {
      const push = RAMP_PUSH[tile];
      vx += push.x * TUNING.rampAccel * step;
      vy += push.y * TUNING.rampAccel * step;
    }
    const friction = tile === T.SAND ? TUNING.sandFriction : TUNING.greenFriction;
    const decay = Math.max(0, 1 - friction * step);
    vx *= decay; vy *= decay;
    let nx = x + vx * step;
    let ny = y + vy * step;
    let bounced = false;
    if (hole.tileAt(nx, y) === T.WALL || hole.tileAt(nx, y) === T.ROUGH) { vx = -vx * TUNING.bounce; nx = x; bounced = true; }
    if (hole.tileAt(x, ny) === T.WALL || hole.tileAt(x, ny) === T.ROUGH) { vy = -vy * TUNING.bounce; ny = y; bounced = true; }
    x = nx; y = ny;
    if (i % 2 === 0) path.push({ x, y, bounced });
    if (Math.hypot(x - hole.cup.x, y - hole.cup.y) <= TUNING.cupRadius
      && Math.hypot(vx, vy) <= TUNING.dropSpeed) {
      path.push({ x: hole.cup.x, y: hole.cup.y, sunk: true });
      break;
    }
    if (Math.hypot(vx, vy) < TUNING.restSpeed) break;
  }
  rolling = { path, index: 0 };
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  if (sinkFlash > 0) sinkFlash = Math.max(0, sinkFlash - dt * 2);
  if (bankFlash > 0) bankFlash = Math.max(0, bankFlash - dt * 1.6);

  // Roll the ball out, a few samples a frame.
  if (rolling) {
    const perFrame = Math.max(2, Math.round(6 * ROLL_SPEED));
    for (let i = 0; i < perFrame && rolling.index < rolling.path.length; i++) {
      const p = rolling.path[rolling.index++];
      ballDraw = { x: p.x, y: p.y };
      if (p.bounced) audio.play('wall', { pitchVariance: 0.2 });
      if (p.splash) {
        audio.play('water');
        particles.sparkle(p.x, p.y, { count: 12, colors: [ART.water, ART.waterFoam] });
      }
      if (p.sunk) {
        audio.play('sink');
        sinkFlash = 1;
        particles.explosion(p.x, p.y, { count: 20, colors: ART.spark, speed: 150 });
      }
    }
    if (rolling.index >= rolling.path.length) {
      rolling = null;
      ballDraw = { ...course.ball };
      if (!course.running) finish();
    }
    return;
  }

  if (!running) return;

  const pad = Input.get();

  // Aim. Analogue on a stick, stepped on a keyboard, and the same on touch.
  const turn = pad.x;
  if (Math.abs(turn) > 0.15) aim += turn * 2.6 * dt;

  // Charge and release. Rising and falling while held, so letting go is a
  // decision at every power rather than only at the top.
  if (Input.pressed('a')) { charging = true; power = 0; powerDir = 1; }
  if (charging) {
    power += powerDir * dt * 1.35;
    if (power >= 1) { power = 1; powerDir = -1; }
    if (power <= 0.05) { power = 0.05; powerDir = 1; }
  }
  if (charging && !pad.a) {
    charging = false;
    const from = { ...course.ball };
    const before = course.completed;
    audio.play('hit', { pitch: 0.8 + power * 0.6 });
    beginRoll(from, aim, power);
    course.play(aim, power);
    if (course.completed > before) {
      bankFlash = 1;
      audio.play('bank');
      // Point the aim at the new cup, so the next hole starts readable.
      aim = Math.atan2(course.hole.cup.y - course.ball.y, course.hole.cup.x - course.ball.x);
    }
    power = 0;
  }
}

// --- Draw ----------------------------------------------------------------

/**
 * Where and how big to draw the hole.
 *
 * SCALED to fill the canvas rather than drawn at a fixed tile size. Holes grow
 * from 12x9 to 22x15 over a round, and pinning the tile at 32px meant an early
 * hole occupied about a quarter of the screen with the ball a five-pixel dot in
 * the middle of it. Playing it, that was the first thing wrong: the board was
 * legible, just small enough that reading the line was a squint.
 *
 * Scaling to fit means hole 1 is enormous and hole 40 still fits, and the ball
 * is the same size relative to the green either way.
 */
function viewOf(hole) {
  const top = 54;                       // clear of the HUD
  const bottom = 46;                    // clear of the power meter
  const scale = Math.min((W - 48) / hole.width, (H - top - bottom) / hole.height);
  return {
    scale,
    x: (W - hole.width * scale) / 2,
    y: top + (H - top - bottom - hole.height * scale) / 2,
  };
}

function drawHole(hole) {

  for (let ty = 0; ty < hole.rows; ty++) {
    for (let tx = 0; tx < hole.cols; tx++) {
      const tile = hole.tiles[ty][tx];
      const x = tx * TILE;
      const y = ty * TILE;

      switch (tile) {
        case T.GREEN:
          // Two greens in a checker, so distance is readable across a big hole.
          ctx.fillStyle = (tx + ty) % 2 ? ART.green : ART.greenAlt;
          ctx.fillRect(x, y, TILE, TILE);
          break;
        case T.WALL:
          ctx.fillStyle = ART.wall;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = ART.wallEdge;
          ctx.fillRect(x, y + TILE - 4, TILE, 4);
          break;
        case T.WATER:
          ctx.fillStyle = ART.water;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = ART.waterFoam;
          ctx.fillRect(x + 4, y + 8, TILE - 8, 2);
          ctx.fillRect(x + 8, y + 18, TILE - 16, 2);
          break;
        case T.SAND:
          ctx.fillStyle = ART.sand;
          ctx.fillRect(x, y, TILE, TILE);
          break;
        case T.RAMP_N: case T.RAMP_E: case T.RAMP_S: case T.RAMP_W: {
          ctx.fillStyle = ART.ramp;
          ctx.fillRect(x, y, TILE, TILE);
          const push = RAMP_PUSH[tile];
          ctx.strokeStyle = ART.rampArrow;
          ctx.lineWidth = 3;
          ctx.beginPath();
          const cx = x + TILE / 2;
          const cy = y + TILE / 2;
          ctx.moveTo(cx - push.x * 9, cy - push.y * 9);
          ctx.lineTo(cx + push.x * 9, cy + push.y * 9);
          ctx.moveTo(cx + push.x * 9, cy + push.y * 9);
          ctx.lineTo(cx + push.y * 6 - push.x * 3, cy + push.x * 6 - push.y * 3);
          ctx.moveTo(cx + push.x * 9, cy + push.y * 9);
          ctx.lineTo(cx - push.y * 6 - push.x * 3, cy - push.x * 6 - push.y * 3);
          ctx.stroke();
          break;
        }
        default:
          ctx.fillStyle = ART.rough;
          ctx.fillRect(x, y, TILE, TILE);
          break;
      }
    }
  }

  // The cup and its flag.
  ctx.fillStyle = ART.cup;
  ctx.beginPath();
  ctx.arc(hole.cup.x, hole.cup.y, TUNING.cupRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ART.cupRim;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = ART.flagPole;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hole.cup.x, hole.cup.y);
  ctx.lineTo(hole.cup.x, hole.cup.y - 34);
  ctx.stroke();
  ctx.fillStyle = ART.flag;
  ctx.beginPath();
  ctx.moveTo(hole.cup.x, hole.cup.y - 34);
  ctx.lineTo(hole.cup.x + 18, hole.cup.y - 28);
  ctx.lineTo(hole.cup.x, hole.cup.y - 22);
  ctx.closePath();
  ctx.fill();

  // Moving blockers.
  for (const m of hole.movers) {
    const r = hole.moverRect(m, course.time);
    ctx.fillStyle = ART.mover;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = ART.moverEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
}

function drawAim() {
  if (rolling || !running) return;
  const bx = ballDraw.x;
  const by = ballDraw.y;

  // A dotted line, length showing the charge. Dots rather than a solid line so
  // it never reads as a wall.
  const length = 40 + power * 110;
  ctx.fillStyle = ART.aimDot;
  for (let d = 16; d < length; d += 11) {
    ctx.beginPath();
    ctx.arc(bx + Math.cos(aim) * d, by + Math.sin(aim) * d, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = ART.aim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx + Math.cos(aim) * 10, by + Math.sin(aim) * 10);
  ctx.lineTo(bx + Math.cos(aim) * 22, by + Math.sin(aim) * 22);
  ctx.stroke();
}

function drawBall() {
  ctx.fillStyle = ART.ball;
  ctx.beginPath();
  ctx.arc(ballDraw.x, ballDraw.y, TUNING.ballRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ART.ballEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHud() {
  const hole = course.hole;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('HOLES', 18, 12);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(course.completed), 18, 24);

  // Par and strokes on this hole.
  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText(`HOLE ${course.holeNumber}`, W / 2, 12);
  ctx.fillStyle = ART.hud.par;
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillText(`${course.strokes} / par ${hole.par}`, W / 2, 26);

  // The bank — the only thing standing between the player and the end, so it
  // gets the clearest readout on the screen.
  const bank = course.effectiveBank;
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('STROKE BANK', W - 18, 12);
  ctx.fillStyle = bank <= 1 ? ART.hud.bankLow : ART.hud.bankGood;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(bank), W - 18, 24);

  if (bankFlash > 0) {
    ctx.globalAlpha = bankFlash;
    ctx.fillStyle = ART.hud.bankGood;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('BANKED', W - 18, 54);
    ctx.globalAlpha = 1;
  }

  // The power meter, drawn only while charging so it never adds noise.
  if (charging) {
    const barW = 190;
    const x = (W - barW) / 2;
    const y = H - 26;
    ctx.fillStyle = ART.power.back;
    ctx.beginPath(); ctx.roundRect(x, y, barW, 12, 6); ctx.fill();
    ctx.fillStyle = power > 0.8 ? ART.power.high : power > 0.5 ? ART.power.mid : ART.power.low;
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(6, barW * power), 12, 6); ctx.fill();
  }
}

function render() {
  const hole = course.hole;
  const view = viewOf(hole);

  ctx.fillStyle = ART.table;
  ctx.fillRect(0, 0, W, H);

  // Everything below is drawn in HOLE coordinates. One transform rather than
  // an origin added to every call.
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  drawHole(hole);
  drawAim();
  drawBall();
  particles.draw(ctx);
  ctx.restore();

  if (sinkFlash > 0) {
    ctx.globalAlpha = sinkFlash * 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  drawHud();
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
  title: 'Endless Mini Golf',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Aim', gamepad: 'Left stick or D-pad', keyboard: 'Left / Right', touch: 'Drag the left side' },
    { action: 'Charge', gamepad: 'Hold A', keyboard: 'Hold Space', touch: 'Hold Putt' },
    { action: 'Putt', gamepad: 'Release A', keyboard: 'Release Space', touch: 'Release' },
    { action: 'Power', gamepad: 'Rises and falls while held', keyboard: 'Rises and falls while held', touch: 'Rises and falls while held' },
    { action: 'Under par', gamepad: 'Banks the strokes you saved', keyboard: 'Banks the strokes you saved', touch: 'Banks the strokes you saved' },
    { action: 'Over par', gamepad: 'Spends them', keyboard: 'Spends them', touch: 'Spends them' },
    { action: 'Water', gamepad: 'Costs a stroke and replays', keyboard: 'Costs a stroke and replays', touch: 'Costs a stroke and replays' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Endless Mini Golf',
  tagline: 'Sink it under par. Bank the difference.',
});
