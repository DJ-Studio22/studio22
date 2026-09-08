// games/updraft/game.js
//
// Updraft — an endless climb. Ported from the standalone Sky Hopper prototype
// onto the Studio 22 engine.
//
// WHAT CHANGED IN THE PORT, AND WHAT DELIBERATELY DID NOT
// ------------------------------------------------------
// Input, canvas scaling, the loop, audio, scoring and the pause/game-over
// chrome are all the engine's now. The physics constants are untouched, and
// so is the order the simulation applies them, because the feel of this game
// lives entirely in those numbers.
//
// UNITS: the engine works in seconds, so this game does too. The original's
// numbers were tuned per frame on a 60Hz rAF, and they are kept below in that
// form as the source of truth, then converted once. The conversion is done in
// code rather than by pasting rounded results, which makes it exact: a
// velocity multiplies by TICKS_PER_SECOND, an acceleration by its square.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop, TICKS_PER_SECOND as TPS } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, randRange as R } from '../../engine/util.js';

const GAME_ID = 'updraft';
const W = 420;
const H = 640;
const TAU = Math.PI * 2;

// --- Physics. Do not retune without playing it. --------------------------
//
// The original per-frame tuning, kept verbatim as the record of what this
// game felt like before the port:
//
//   gravity 0.118   jump -7.10   spring -10.90   accel 0.40   max vx 3.9
//
// SNAP: the arc was then sped up by 12.5%. Peak height is unchanged, which is
// the whole trick — for a projectile the peak is v squared over 2g, so
// scaling velocity by k and gravity by k SQUARED leaves it exactly where it
// was while the time to reach it drops to 1/k. The bird gets there sooner and
// falls back sooner; it does not jump higher or lower.
const SNAP = 1.125;

const PER_FRAME = {
  grav: 0.118 * SNAP * SNAP,
  jump: -7.10 * SNAP,
  spring: -10.90 * SNAP,
  move: 0.40,
  maxvx: 3.9,
};

// Converted once, here. Velocities scale by the tick rate, accelerations by
// its square.
const GRAV = PER_FRAME.grav * TPS * TPS;
const JUMP = PER_FRAME.jump * TPS;
const SPRING = PER_FRAME.spring * TPS;
const MOVE = PER_FRAME.move * TPS * TPS;
const MAXVX = PER_FRAME.maxvx * TPS;

// Per-frame damping factors become per-second rates the same way: a velocity
// multiplied by 0.90 every frame retains 0.90^60 of itself after a second.
const DRAG_PER_SECOND = 0.90 ** TPS;
const SQUASH_DECAY_PER_SECOND = 0.86 ** TPS;
const SHAKE_DECAY_PER_SECOND = 0.85 ** TPS;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome — the warm charcoal and amber of the arcade around the game.
// A game's artwork is its own thing, and forcing this sky and this bird into
// the site palette would flatten every game into the same picture.
const ART = {
  skyTop: '#0d1b2a',
  skyBottom: '#1b3a5c',
  cloud: '#cfe8ff',
  platTop: '#7ad4ff',
  platBottom: '#3a86c9',
  moveTop: '#5ee7a0',
  moveBottom: '#2fa876',
  crackTop: '#c99a6b',
  crackBottom: '#8b6338',
  crackLine: 'rgba(60,35,15,.5)',
  spring: '#ffe66d',
  bird: '#ffe66d',
  birdBelly: '#f2c94c',
  birdBeak: '#f2994a',
  birdEyeWhite: '#fff',
  birdPupil: '#22303f',
  foe: '#ff7a8a',
  foeEyeWhite: '#ffd0d6',
  foePupil: '#3a0d15',
  streak: 'rgba(255,255,255,.35)',
  puffWhite: '#ffffff',
  puffWood: '#a87854',
  puffFoe: '#ff7a8a',
  hudBest: 'rgba(255,255,255,.4)',
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 260 });

// Nothing to press: you bounce automatically and only steer. This removes the
// engine's default A/B pads so they cannot sit on screen doing nothing. The
// virtual joystick stays, because steering still needs it.
Input.clearTouchLayout();

// Height is a distance, so higher is better — the default, stated anyway so
// the intent is on the record next to a game where it could plausibly be
// otherwise (a climb could just as easily have been scored on time).
Session.setScoreDirection(GAME_ID, 'high');

// --- Sound ---------------------------------------------------------------
//
// Synthesised for now; there are no audio files yet. Adding `file: '...'` to
// any entry below is the only change needed to upgrade that sound — the file
// loads in the background, play() switches to it once it arrives, and none of
// the call sites move.
audio.define({
  bounce: { beep: { freq: 520, duration: 0.055, type: 'square', volume: 0.16 } },
  spring: { beep: { freq: 780, duration: 0.14, type: 'square', volume: 0.2 } },
  break: { beep: { freq: 150, duration: 0.13, type: 'sawtooth', volume: 0.18 } },
  squash: { beep: { freq: 300, duration: 0.1, type: 'sawtooth', volume: 0.22 } },
  death: { beep: { freq: 110, duration: 0.4, type: 'triangle', volume: 0.25 } },
});

// --- Game state ----------------------------------------------------------

let score = 0;
let camY = 0;
let tick = 0;
let shake = 0;
let plats = [];
let foes = [];
const clouds = [];

const P = { x: W / 2, y: H - 140, vx: 0, vy: 0, w: 30, h: 32, face: 1, squash: 0 };

// Drift speeds converted at creation, so everything downstream is per second.
for (let i = 0; i < 9; i++) {
  clouds.push({ x: R(0, W), y: R(0, H), r: R(28, 64), o: R(0.03, 0.09), s: R(0.1, 0.3) * TPS });
}

// Per-frame rates from the original, converted once.
const FOE_PHASE_SPEED = 0.09 * TPS;
const FACE_FLIP_SPEED = 0.4 * TPS;

function makePlat(y) {
  const diff = Math.min(score / 2600, 1);
  const w = Math.max(52, 86 - diff * 30);
  let type = 'normal';
  const r = Math.random();
  if (r < 0.10 + diff * 0.14) type = 'move';
  else if (r < 0.18 + diff * 0.20) type = 'crack';

  const p = { x: R(6, W - w - 6), y, w, h: 13, type, vx: 0, spring: false, broke: false };
  if (type === 'move') p.vx = R(0.45, 0.95) * TPS * (Math.random() < 0.5 ? -1 : 1);
  if (type !== 'crack' && Math.random() < 0.09) p.spring = true;
  return p;
}

function reset() {
  score = 0;
  camY = 0;
  tick = 0;
  shake = 0;
  foes = [];
  particles.clear();

  P.x = W / 2;
  P.y = H - 140;
  P.vx = 0;
  P.vy = JUMP;
  P.face = 1;
  P.squash = 0;

  plats = [{ x: W / 2 - 55, y: H - 90, w: 110, h: 13, type: 'normal', vx: 0, spring: false, broke: false }];
  let y = H - 90;
  while (y > -400) {
    y -= R(62, 96);
    plats.push(makePlat(y));
  }
}

// Speeds converted from the original's per-frame values: a puff that moved
// 0.6-3.4 px per frame moves 36-204 px per second, and gravity of 0.036 px
// per frame squared is 129.6 px per second squared.
function puff(px, py, color, count) {
  particles.emit(px, py, {
    count,
    colors: [color],
    speed: [36, 204],
    life: [0.23, 0.5],
    size: [2.6, 2.6],
    gravity: 130,
    drag: 0.91,
    shape: 'circle',
    shrink: false,
  });
}

function die() {
  audio.play('death');
  shell.showGameOver(score, {
    height: score,
    platformsPassed: Math.floor(camY / 78),
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  // The shell gets first refusal: it returns false while a title, pause,
  // game over or how-to-play screen owns the frame.
  if (!shell.update()) return;

  tick++;

  // Clouds drift in update, not in draw. The original moved them inside its
  // render function, which was fine on a bare rAF where the two were the
  // same thing — under a fixed timestep, render can run more or less often
  // than the simulation and anything mutated there drifts with frame rate.
  for (const cl of clouds) {
    cl.y += cl.s * dt;
    if (cl.y - cl.r > H) {
      cl.y = -cl.r;
      cl.x = R(0, W);
    }
  }

  // Steering. Input.get() already merges the left stick, the d-pad, the
  // arrow keys, A/D and the touch stick into one axis, so the original's
  // four separate input paths collapse to this.
  const mx = Input.get(0).x;

  P.vx += mx * MOVE * dt;
  P.vx *= DRAG_PER_SECOND ** dt;
  if (P.vx > MAXVX) P.vx = MAXVX;
  if (P.vx < -MAXVX) P.vx = -MAXVX;
  if (Math.abs(P.vx) > FACE_FLIP_SPEED) P.face = P.vx > 0 ? 1 : -1;
  P.x += P.vx * dt;
  if (P.x < -P.w / 2) P.x = W + P.w / 2;
  if (P.x > W + P.w / 2) P.x = -P.w / 2;

  P.vy += GRAV * dt;
  P.y += P.vy * dt;
  if (P.squash > 0) P.squash *= SQUASH_DECAY_PER_SECOND ** dt;

  // Land on platforms, only while falling.
  if (P.vy > 0) {
    for (const p of plats) {
      if (p.broke) continue;
      if (P.x + P.w / 2 > p.x && P.x - P.w / 2 < p.x + p.w) {
        const foot = P.y + P.h / 2;
        // The tolerance is "however far the player moved this step", which in
        // per-second units is vy * dt rather than vy. Using the raw velocity
        // here would widen the catch band sixtyfold and let the bird land on
        // platforms it was nowhere near.
        if (foot > p.y && foot < p.y + p.h + P.vy * dt + 2) {
          if (p.type === 'crack') {
            p.broke = true;
            puff(P.x, p.y, ART.puffWood, 12);
            shake = 4;
            audio.play('break');
          } else {
            P.y = p.y - P.h / 2;
            P.vy = p.spring ? SPRING : JUMP;
            P.squash = p.spring ? 1.6 : 1;
            puff(P.x, p.y + 4, ART.puffWhite, p.spring ? 12 : 5);
            if (p.spring) shake = 6;
            audio.play(p.spring ? 'spring' : 'bounce');
          }
          break;
        }
      }
    }
  }

  // Camera follows upward only, by translating the world rather than by
  // transforming the context.
  const line = H * 0.42;
  if (P.y < line) {
    const d = line - P.y;
    P.y = line;
    camY += d;
    for (const p of plats) p.y += d;
    for (const f of foes) f.y += d;
    particles.shift(0, d);
    score = Math.max(score, Math.floor(camY / 10));
  }

  for (const p of plats) {
    if (p.type === 'move' && !p.broke) {
      p.x += p.vx * dt;
      if (p.x < 4) { p.x = 4; p.vx *= -1; }
      if (p.x + p.w > W - 4) { p.x = W - 4 - p.w; p.vx *= -1; }
    }
  }

  plats = plats.filter((p) => p.y < H + 40);
  let top = H;
  for (const p of plats) if (p.y < top) top = p.y;
  while (top > -160) {
    top -= R(62, 96 + Math.min(score / 60, 26));
    plats.push(makePlat(top));
  }

  if (score > 240 && tick % 150 === 0 && foes.length < 2) {
    foes.push({
      x: R(40, W - 40), y: -50,
      vx: R(0.35, 0.78) * TPS * (Math.random() < 0.5 ? -1 : 1),
      r: 19, ph: R(0, TAU),
    });
  }

  for (let i = foes.length - 1; i >= 0; i--) {
    const f = foes[i];
    f.x += f.vx * dt;
    f.ph += FOE_PHASE_SPEED * dt;
    if (f.x < f.r) { f.x = f.r; f.vx *= -1; }
    if (f.x > W - f.r) { f.x = W - f.r; f.vx *= -1; }
    if (f.y > H + 70) { foes.splice(i, 1); continue; }

    if (Math.hypot(f.x - P.x, f.y - P.y) < f.r + 13) {
      if (P.vy > 0 && P.y < f.y - 4) {
        foes.splice(i, 1);
        P.vy = JUMP * 1.1;
        P.squash = 1.4;
        score += 50;
        shake = 8;
        puff(f.x, f.y, ART.puffFoe, 18);
        audio.play('squash');
      } else {
        puff(P.x, P.y, ART.puffFoe, 24);
        die();
        return;
      }
    }
  }

  particles.update(dt);

  if (shake > 0.3) shake *= SHAKE_DECAY_PER_SECOND ** dt;
  else shake = 0;

  if (P.y - P.h / 2 > H + 30) die();
}

// --- Draw ----------------------------------------------------------------

function drawPlat(p) {
  if (p.broke) return;

  let top;
  let bottom;
  if (p.type === 'move') { top = ART.moveTop; bottom = ART.moveBottom; }
  else if (p.type === 'crack') { top = ART.crackTop; bottom = ART.crackBottom; }
  else { top = ART.platTop; bottom = ART.platBottom; }

  ctx.fillStyle = bottom;
  ctx.beginPath(); ctx.roundRect(p.x, p.y + 3, p.w, p.h, 6); ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h - 1, 6); ctx.fill();

  if (p.type === 'crack') {
    ctx.strokeStyle = ART.crackLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x + p.w * 0.4, p.y); ctx.lineTo(p.x + p.w * 0.5, p.y + p.h);
    ctx.moveTo(p.x + p.w * 0.68, p.y); ctx.lineTo(p.x + p.w * 0.6, p.y + p.h);
    ctx.stroke();
  }

  if (p.spring) {
    const sx = p.x + p.w / 2;
    ctx.strokeStyle = ART.spring;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - 6, p.y - 2); ctx.lineTo(sx + 6, p.y - 6);
    ctx.lineTo(sx - 6, p.y - 10); ctx.lineTo(sx + 6, p.y - 14);
    ctx.stroke();
  }
}

// `alpha` is deliberately unused. The camera reframes by translating every
// object on the tick it happens, so interpolating between two ticks that
// straddle a reframe would tear the whole world apart for one frame. Drawing
// the settled state gives exactly the 60 distinct positions a second the
// original had.
// Built once, like Comet's and Number Crunch's. Rebuilding it every frame
// measured at 0.33us against 0.035us for reusing it — a tenth of the cost,
// on a number far too small to matter either way. It is cached because the
// other games cache theirs and a rule the codebase states and then breaks is
// worse than the third of a microsecond it saves.
const SKY = (() => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, ART.skyTop);
  gradient.addColorStop(1, ART.skyBottom);
  return gradient;
})();

function render() {
  ctx.fillStyle = SKY;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  for (const cl of clouds) {
    ctx.globalAlpha = cl.o;
    ctx.fillStyle = ART.cloud;
    ctx.beginPath(); ctx.arc(cl.x, cl.y, cl.r, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cl.x + cl.r * 0.7, cl.y + 6, cl.r * 0.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cl.x - cl.r * 0.7, cl.y + 8, cl.r * 0.6, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  if (shake > 0.3) ctx.translate(R(-shake, shake), R(-shake, shake));

  for (const p of plats) drawPlat(p);

  for (const f of foes) {
    ctx.save();
    ctx.translate(f.x, f.y + Math.sin(f.ph) * 4);
    ctx.fillStyle = ART.foe;
    ctx.beginPath(); ctx.arc(0, 0, f.r, 0, TAU); ctx.fill();
    ctx.fillStyle = ART.foeEyeWhite;
    ctx.beginPath(); ctx.arc(-6, -4, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(7, -4, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = ART.foePupil;
    ctx.beginPath(); ctx.arc(-5, -3, 2.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(8, -3, 2.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = ART.foePupil;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(1, 6, 6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  const sq = P.squash;
  const bw = P.w * (1 - sq * 0.18);
  const bh = P.h * (1 + sq * 0.22);
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.scale(P.face, 1);
  ctx.fillStyle = ART.bird;
  ctx.beginPath(); ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = ART.birdBelly;
  ctx.beginPath(); ctx.ellipse(0, bh * 0.22, bw * 0.42, bh * 0.24, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = ART.birdEyeWhite;
  ctx.beginPath(); ctx.arc(4, -6, 6, 0, TAU); ctx.fill();
  ctx.fillStyle = ART.birdPupil;
  ctx.beginPath(); ctx.arc(6, -6, 3, 0, TAU); ctx.fill();
  ctx.fillStyle = ART.birdBeak;
  ctx.beginPath();
  ctx.moveTo(bw * 0.42, -1); ctx.lineTo(bw * 0.62, 3); ctx.lineTo(bw * 0.42, 7);
  ctx.closePath(); ctx.fill();
  if (P.vy < 0) {
    ctx.strokeStyle = ART.streak;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-bw * 0.2, bh * 0.6); ctx.lineTo(-bw * 0.2, bh * 0.95);
    ctx.moveTo(bw * 0.15, bh * 0.6); ctx.lineTo(bw * 0.15, bh * 1.0);
    ctx.stroke();
  }
  ctx.restore();

  particles.draw(ctx);
  ctx.restore();

  // Both lines through the engine HUD, so every game's score and best sit in
  // the same place and the same type. getBest returns null before the first
  // run of a visit, and drawHud skips the line on null, so no guard here.
  shell.drawHud({ score, best: Session.getBest(GAME_ID) });

  shell.render();
}

// --- Boot ----------------------------------------------------------------

let shell;

const loop = new GameLoop({
  update,
  render,
  // Losing focus mid-climb should raise the pause screen, not silently
  // freeze the game behind a still image.
  onPause: () => shell?.pause(),
});

shell = new GameShell({
  gameId: GAME_ID,
  title: 'Updraft',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Steer', gamepad: 'Left stick or D-pad', keyboard: 'Arrows or A / D', touch: 'Drag the left side' },
    { action: 'Bounce', gamepad: 'Automatic', keyboard: 'Automatic', touch: 'Automatic' },
    { action: 'Wrap around', gamepad: 'Fly off an edge', keyboard: 'Fly off an edge', touch: 'Fly off an edge' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

// The front door. Nothing simulates until Start is pressed: the shell
// suspends the loop while the title is up.
shell.showTitle({ name: 'Updraft', tagline: 'Bounce higher. Never look down.' });
