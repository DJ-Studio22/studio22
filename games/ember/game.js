// games/ember/game.js
//
// Ember — one burner, a patchwork balloon, and a gorge at dusk.
//
// THE RULE
// --------
// Hold the burner and you rise. Let go and you sink. That is the whole
// control. The balloon drifts up the gorge on its own and the rock ahead has
// a gap in it; the only question ever asked is when to commit.
//
// WHY IT IS ABOUT MOMENTUM
// ------------------------
// A balloon cannot change its mind. Arriving at a gap at full sink and asked
// to climb, it spends about 80px of altitude just arresting what it was
// already doing — against a channel 265px wide, and that cost is the same at
// every speed, deliberately. So
// the gap has to be read early, and a player who commits at the last moment
// has already lost the argument with physics.
//
// That claim is arithmetic, so it is not asserted here: the simulation lives
// in gorge.js with no DOM attached, and tests/ember.gorge.test.mjs plays it a
// few thousand times. Every gap the generator produces is provably reachable
// from the worst state a player could arrive in — see the header of gorge.js.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, camera, shell wiring, and the dusk. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, randRange } from '../../engine/util.js';

import { Flight, PIXELS_PER_METRE, TUNING, WORLD_H, difficultyAt, wallsAt } from './gorge.js';
import { BestMarker } from '../../engine/best-marker.js';

const GAME_ID = 'ember';

// The world is as tall as the gorge, so nothing has to be scaled between the
// simulation and the screen. Landscape, because the gorge is read ahead.
const W = 880;
const H = WORLD_H;

// Where the balloon sits on screen. Well left of centre: almost the whole
// canvas is the rock you have not reached yet, which is the point.
const BALLOON_X = 250;

// --- Art palette ---------------------------------------------------------
//
// Ember's own colours, deliberately NOT from tokens.css. This is a gorge at
// dusk and the tokens are the arcade's chrome; the shell still draws pause,
// game over and the HUD in site tokens straight over the top, which is what
// keeps it recognisably Studio 22.
//
// Grouped by subject per CLAUDE.md. Matches the card in /thumbnails.js.
const ART = {
  sky: {
    // Dusk, top to bottom. The sun sits behind the gorge and never moves,
    // because the balloon is climbing rather than travelling into evening.
    high: '#33204f',
    mid: '#9c4a6b',
    low: '#f0a15c',
    sun: 'rgba(255,208,138,.45)',
    haze: 'rgba(255,190,140,.10)',
  },
  rock: {
    // Two tones a side. The lighter one is a rim on the gorge-facing edge, so
    // the silhouette reads against the sky instead of sinking into it.
    face: '#2a2033',
    rim: '#5c4661',
    crack: 'rgba(0,0,0,.32)',
  },
  balloon: {
    envelopeA: '#e2603f',
    envelopeB: '#f0a03c',
    envelopeShade: 'rgba(185,67,47,.75)',
    basket: '#8a5a30',
    basketEdge: '#5c3d20',
    rope: '#2a2033',
    flame: '#ffe08a',
    flameCore: '#fff6d8',
    glow: 'rgba(255,196,108,.22)',
  },
  spark: ['#ffe08a', '#f0a03c', '#e2603f'],
  hud: {
    label: 'rgba(255,232,205,.62)',
    metres: '#ffe08a',
    gust: 'rgba(255,232,205,.30)',
    gustUp: 'rgba(160,220,255,.55)',
    gustDown: 'rgba(255,150,110,.55)',
  },
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 200 });
// The session-best line across the gorge, and the confetti for passing it.
const best = new BestMarker();

// One button and nothing to steer. The stick is cleared rather than left on
// screen doing nothing, which is an invitation to press the wrong thing.
Input.clearTouchLayout();
// No virtual stick: Ember is one button: you jump, and that is the whole vocabulary.
// Without this the shell advertises a joystick in the corner that steers
// nothing, which is worse than no joystick at all.
Input.setDirectionalTouch(false);

Input.setTouchLayout([
  // Bottom LEFT, by request, and it suits the game: the balloon sits at the
  // left of the screen and the gorge is read to the right of it, so a pad on
  // the right would cover exactly the part you are looking at.
  { name: 'a', xRatio: 0.08, yRatio: 0.82, radius: 66, label: 'Burn' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  burn: { beep: { freq: 130, duration: 0.12, type: 'sawtooth', volume: 0.1 } },
  pass: { beep: { freq: 720, duration: 0.06, type: 'triangle', volume: 0.13 } },
  near: { beep: { freq: 300, duration: 0.05, type: 'square', volume: 0.09 } },
  crash: { beep: { freq: 84, duration: 0.6, type: 'triangle', volume: 0.28 } },
  best: { beep: { freq: 990, duration: 0.16, type: 'triangle', volume: 0.16 } },
});

// --- State ---------------------------------------------------------------

let flight = new Flight();
let running = false;

// Smoothed for drawing only. The simulation is not allowed to care.
let flameLevel = 0;
let tilt = 0;
let shake = 0;

// The gate the balloon has most recently cleared, so passing one can make a
// noise exactly once.
let lastPassedX = -1;
let nearMisses = 0;
let bestClearance = Infinity;

// Embers rising from the burner. Pooled: one is spawned most frames the
// burner is lit, which is exactly the case CLAUDE.md asks to pool.
const embers = [];
for (let i = 0; i < 60; i++) {
  embers.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 1 });
}

function spawnEmber(x, y) {
  for (const e of embers) {
    if (e.active) continue;
    e.active = true;
    e.x = x + randRange(-4, 4);
    e.y = y;
    e.vx = randRange(-14, 6);
    e.vy = randRange(-58, -22);
    e.max = randRange(0.5, 1.1);
    e.life = e.max;
    e.r = randRange(1, 2.4);
    return;
  }
}

// Haze bands, for depth. Generated once and scrolled — see drawHaze() for
// why this is haze and not a far wall.
const haze = [];
for (let i = 0; i < 14; i++) {
  haze.push({
    x: i * 180, y: randRange(60, WORLD_H - 60),
    w: randRange(220, 420), h: randRange(10, 26), o: randRange(0.25, 0.7),
  });
}

// --- Run control ---------------------------------------------------------

function reset() {
  flight = new Flight();
  running = true;
  flameLevel = 0;
  tilt = 0;
  shake = 0;
  lastPassedX = -1;
  nearMisses = 0;
  bestClearance = Infinity;
  particles.clear();
  for (const e of embers) e.active = false;
  best.reset(Session.getBest(GAME_ID));
}

function crash() {
  if (!running) return;
  running = false;
  shake = 1;
  audio.play('crash');
  particles.explosion(BALLOON_X, flight.y, {
    count: 26, colors: ART.spark, speed: 220,
  });
  shell.showGameOver(flight.metres, {
    gatesPassed: flight.gatesPassed,
    nearMisses,
    tightest: bestClearance === Infinity ? '—' : `${Math.round(bestClearance)} px`,
    ending: flight.reason,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 2.2);

  for (const e of embers) {
    if (!e.active) continue;
    e.life -= dt;
    if (e.life <= 0) { e.active = false; continue; }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 26 * dt; // they slow, cool and fall back
  }

  if (!running) return;

  // Held, not pressed: the burner is a control you lean on, not a trigger.
  const burn = Input.get().a;
  flight.step(dt, { burn });

  // Everything below is presentation, driven off what the simulation did.
  flameLevel += ((burn ? 1 : 0) - flameLevel) * clamp(dt * 12, 0, 1);
  if (burn) {
    if (Math.random() < 0.6) spawnEmber(BALLOON_X, flight.y + 46);
    if (Math.random() < 0.06) audio.play('burn', { pitchVariance: 0.25 });
  }

  // The balloon leans into what it is doing. Presentation only.
  const wantTilt = clamp(flight.vy / 320, -1, 1) * 0.16;
  tilt += (wantTilt - tilt) * clamp(dt * 6, 0, 1);

  // Clearance, for the HUD and for the near-miss count.
  const { ceiling, floor } = wallsAt(flight.x, flight.gates);
  const clearance = Math.min(flight.y - TUNING.radius - ceiling, floor - (flight.y + TUNING.radius));
  if (clearance < bestClearance) bestClearance = clearance;

  // Passing a gate: a note, once, and a nod if it was close.
  for (const g of flight.gates) {
    if (g.x <= flight.x && g.x > lastPassedX) {
      lastPassedX = g.x;
      if (clearance < 26) {
        nearMisses++;
        audio.play('near');
        particles.sparkle(BALLOON_X, flight.y, { count: 6, colors: ART.spark });
      } else {
        audio.play('pass', { pitchVariance: 0.08 });
      }
    }
  }

  // Past the best? The burst is in screen space, at the balloon.
  if (best.update(flight.metres, dt, { burstX: BALLOON_X, burstY: flight.y })) audio.play('best');

  if (!flight.running) crash();
}

// --- Draw ----------------------------------------------------------------

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.sky.high);
  g.addColorStop(0.5, ART.sky.mid);
  g.addColorStop(1, ART.sky.low);
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  ctx.fillStyle = ART.sky.sun;
  ctx.beginPath();
  ctx.arc(W * 0.5, H + 40, 150, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ART.sky.haze;
  ctx.fillRect(screen.left, H * 0.55, screen.stageWidth, H * 0.45);
}

/**
 * Depth, without anything that could be mistaken for terrain.
 *
 * This was a parallaxed far WALL to begin with, and playing it showed why
 * that was a bad idea: the far wall poked into the channel and read as slabs
 * of rock floating in the middle of the gorge. In a game whose whole contract
 * is that what is drawn is what is solid, a background that looks solid is
 * not a depth cue, it is a lie.
 *
 * Soft horizontal haze instead. It scrolls, so it still gives the drift
 * somewhere to be measured against, and nobody will ever try to fly over it.
 */
function drawHaze() {
  const scroll = flight.x * 0.3;
  for (const band of haze) {
    const x = ((band.x - scroll) % 2400 + 2400) % 2400 - 600;
    if (x > W + 100 || x < -700) continue;
    ctx.globalAlpha = band.o;
    ctx.fillStyle = ART.sky.haze;
    ctx.beginPath();
    ctx.ellipse(x + band.w / 2, band.y, band.w / 2, band.h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The gorge. Sampled from the same wallsAt() the collision test uses, so what
 * is drawn is exactly what is solid — there is no second opinion about where
 * the rock is.
 */
function drawGorge() {
  const step = 8;
  const left = flight.x - BALLOON_X;

  // SAMPLED ACROSS THE WHOLE STAGE, not across the game's own width.
  //
  // On a phone in landscape the canvas now extends past both sides of the
  // game's 880 (see engine/canvas.js). This loop ran from -4 to W, so the rock
  // simply stopped where the black bars used to be and the gorge read as a
  // cliff cut off in mid-air -- the reclaimed space looked like missing world
  // rather than more of it.
  //
  // wallsAt() is defined for any x, so there is nothing to invent: the gorge
  // was always there, it just was not being asked for.
  const from = screen.left - 4;
  const to = screen.right + step;

  for (const side of ['ceiling', 'floor']) {
    ctx.beginPath();
    ctx.moveTo(from, side === 'ceiling' ? -4 : H + 4);
    for (let sx = from; sx <= to; sx += step) {
      const w = wallsAt(left + sx, flight.gates);
      ctx.lineTo(sx, w[side]);
    }
    ctx.lineTo(to, side === 'ceiling' ? -4 : H + 4);
    ctx.closePath();
    ctx.fillStyle = ART.rock.face;
    ctx.fill();

    // The rim, on the gorge-facing edge only.
    ctx.beginPath();
    for (let sx = from; sx <= to; sx += step) {
      const w = wallsAt(left + sx, flight.gates);
      if (sx === from) ctx.moveTo(sx, w[side]);
      else ctx.lineTo(sx, w[side]);
    }
    ctx.strokeStyle = ART.rock.rim;
    ctx.lineWidth = 5;
    ctx.stroke();
  }
}

function drawBalloon() {
  const x = BALLOON_X;
  const y = flight.y;
  const r = TUNING.radius;

  // The burner throws light on the rock. Cheap, and it sells the one control.
  if (flameLevel > 0.05) {
    ctx.fillStyle = ART.balloon.glow;
    ctx.beginPath();
    ctx.arc(x, y + 40, 60 + flameLevel * 40, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  // Envelope: two panels and a shaded side, matching the card.
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.5);
  ctx.bezierCurveTo(r * 1.1, -r * 1.5, r * 1.5, -r * 0.7, r * 1.35, 0.1 * r);
  ctx.bezierCurveTo(r * 1.15, r * 0.8, r * 0.55, r * 1.25, 0, r * 1.5);
  ctx.bezierCurveTo(-r * 0.55, r * 1.25, -r * 1.15, r * 0.8, -r * 1.35, 0.1 * r);
  ctx.bezierCurveTo(-r * 1.5, -r * 0.7, -r * 1.1, -r * 1.5, 0, -r * 1.5);
  ctx.closePath();
  ctx.fillStyle = ART.balloon.envelopeA;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = ART.balloon.envelopeB;
  ctx.fillRect(0, -r * 1.6, r * 1.6, r * 3.2);
  ctx.fillStyle = ART.balloon.envelopeShade;
  ctx.fillRect(-r * 1.6, r * 0.2, r * 1.2, r * 1.6);
  ctx.restore();

  // Ropes and basket.
  ctx.strokeStyle = ART.balloon.rope;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.28, r * 1.5); ctx.lineTo(-r * 0.42, r * 1.72);
  ctx.moveTo(r * 0.28, r * 1.5); ctx.lineTo(r * 0.42, r * 1.72);
  ctx.stroke();

  ctx.fillStyle = ART.balloon.basket;
  ctx.strokeStyle = ART.balloon.basketEdge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.35, r * 1.7);
  ctx.lineTo(r * 0.35, r * 1.7);
  ctx.lineTo(r * 0.27, r * 2.2);
  ctx.lineTo(-r * 0.27, r * 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // The flame, sized by the control. This is the only feedback the player has
  // that the burner is lit, so it is generous.
  if (flameLevel > 0.02) {
    const h = 10 + flameLevel * 26;
    ctx.fillStyle = ART.balloon.flame;
    ctx.beginPath();
    ctx.moveTo(0, r * 1.75 + h);
    ctx.bezierCurveTo(r * 0.3, r * 1.75 + h * 0.5, r * 0.3, r * 1.6, 0, r * 1.4);
    ctx.bezierCurveTo(-r * 0.3, r * 1.6, -r * 0.3, r * 1.75 + h * 0.5, 0, r * 1.75 + h);
    ctx.fill();
    ctx.fillStyle = ART.balloon.flameCore;
    ctx.beginPath();
    ctx.moveTo(0, r * 1.7 + h * 0.6);
    ctx.bezierCurveTo(r * 0.16, r * 1.7 + h * 0.3, r * 0.16, r * 1.55, 0, r * 1.45);
    ctx.bezierCurveTo(-r * 0.16, r * 1.55, -r * 0.16, r * 1.7 + h * 0.3, 0, r * 1.7 + h * 0.6);
    ctx.fill();
  }

  ctx.restore();
}

function drawEmbers() {
  for (const e of embers) {
    if (!e.active) continue;
    ctx.globalAlpha = clamp(e.life / e.max, 0, 1) * 0.85;
    ctx.fillStyle = ART.spark[(e.r * 3 | 0) % ART.spark.length];
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  // Anchored to the left edge of the SCREEN, not of the game. See screen.left.
  const hudLeft = screen.left;
  ctx.fillText('METRES', hudLeft + 20, 16);

  ctx.fillStyle = ART.hud.metres;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(String(flight.metres), hudLeft + 20, 28);

  // The crosswind, shown as an arrow, because a force the player cannot see
  // is not a skill — and gorge.js already pays for it in the contract.
  const gust = flight.gust(difficultyAt(flight.x, TUNING).speed);
  const strength = clamp(gust / 200, -1, 1);
  if (Math.abs(strength) > 0.08) {
    const cx = W - 40;
    const cy = 34;
    ctx.strokeStyle = strength < 0 ? ART.hud.gustUp : ART.hud.gustDown;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - strength * 16);
    ctx.lineTo(cx, cy + strength * 16);
    ctx.stroke();
    ctx.beginPath();
    const tipY = cy + strength * 18;
    ctx.moveTo(cx - 5, tipY - Math.sign(strength) * 5);
    ctx.lineTo(cx, tipY);
    ctx.lineTo(cx + 5, tipY - Math.sign(strength) * 5);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = ART.hud.gust;
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillText('WIND', cx, 58);
  }
}

function render() {
  ctx.save();
  if (shake > 0) {
    ctx.translate(randRange(-1, 1) * shake * 9, randRange(-1, 1) * shake * 9);
  }

  drawSky();
  drawHaze();
  drawGorge();
  // The best as a place in the gorge: a metre is PIXELS_PER_METRE of world,
  // and the world scrolls past a balloon fixed at BALLOON_X.
  if (best.visible) {
    best.drawLine(ctx, {
      orientation: 'vertical',
      at: best.best * PIXELS_PER_METRE - flight.x + BALLOON_X,
      from: 0,
      to: H,
      min: screen.left - 10,
      max: screen.left + screen.stageWidth + 10,
      label: `BEST ${best.best} m`,
      scale: screen.uiScale,
    });
  }
  drawEmbers();
  if (running || shake > 0.02) drawBalloon();
  particles.draw(ctx);
  best.drawBurst(ctx);

  ctx.restore();
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
  title: 'Ember',
  canvas: screen,
  loop,
  audio,
  // Music: the gorge is read ahead visually -- no sound tells you to burn.
  music: true,
  onRestart: reset,
  controls: [
    { action: 'Burner', gamepad: 'Hold A', keyboard: 'Hold Space', touch: 'Hold Burn' },
    { action: 'Rise', gamepad: 'Hold it', keyboard: 'Hold it', touch: 'Hold it' },
    { action: 'Sink', gamepad: 'Let go', keyboard: 'Let go', touch: 'Let go' },
    { action: 'The gap', gamepad: 'Commit early', keyboard: 'Commit early', touch: 'Commit early' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Ember', tagline: 'One burner. Mind the walls.' });
