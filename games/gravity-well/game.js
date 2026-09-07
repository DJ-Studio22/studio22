// games/gravity-well/game.js
//
// Gravity Well — the line on screen is the flight.
//
// THE RULE
// --------
// Reach the gate, slowly enough to stop there. You have a small tank of fuel,
// no time limit worth worrying about, and several bodies whose pull is the only
// thing that will get you across. Burning is a decision; falling is free. Each
// gate refills the tank and hands you a harder field, without end.
//
// THE LINE
// --------
// The dotted path ahead of the craft is drawn by calling the SAME predict() the
// craft flies with, over a copy of the same state, against the same bodies, at
// the same fixed step. It is not an approximation and it is not a second model
// kept in step by discipline — there is one piece of arithmetic and the drawing
// calls it. It also stops where the flight would stop, so a line that runs into
// a planet ends at the planet rather than promising a clear route through it.
//
// That matters more here than anywhere else in the arcade: the entire skill is
// reading a trajectory before committing to it, so a line that lied would make
// every hour of practice practice at something the game does not do.
// tests/gravity-well.orbit.test.mjs holds it to that, including a test that
// breaks the physics on purpose to prove the comparison can fail.
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

import { Flight, TUNING, speedOf } from './orbit.js';

const GAME_ID = 'gravity-well';

// One field unit is SCALE pixels, so a body is round and the prediction is
// drawn in the same coordinates it was computed in.
const SCALE = 4.7;
const W = Math.round(TUNING.width * SCALE);    // 940
const H = Math.round(TUNING.height * SCALE);   // 611

// --- Art palette ---------------------------------------------------------
//
// Gravity Well's own colours, deliberately NOT from tokens.css. Deep space with
// three things that have to read instantly at a glance: the bodies are warm and
// solid, the gate is the one green thing on screen, and the predicted path is a
// cold dotted line that turns red the moment it ends in something. The shell
// still draws pause, game over and its own screens in site tokens over the top.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  space: {
    far: '#05060f',
    near: '#0d1122',
    star: 'rgba(190,210,255,0.55)',
    starBright: 'rgba(255,255,255,0.85)',
  },
  body: {
    core: '#c98b4b',
    rim: '#f3c78a',
    shade: '#5c3b1c',
    field: 'rgba(201,139,75,0.11)',
    fieldEdge: 'rgba(201,139,75,0.20)',
  },
  gate: {
    ring: '#5df2c0',
    inner: 'rgba(93,242,192,0.16)',
    glow: 'rgba(93,242,192,0.30)',
  },
  craft: {
    hull: '#e8f1ff',
    rim: '#6d86b8',
    flame: '#ffb347',
    flameHot: '#fff0c4',
    dead: '#5a6274',
  },
  path: {
    good: 'rgba(160,200,255,0.85)',
    slow: 'rgba(93,242,192,0.9)',
    doomed: '#ff6b5a',
  },
  hud: {
    text: '#e8f1ff',
    dim: 'rgba(232,241,255,0.55)',
    fuel: '#ffd45e',
    fuelLow: '#ff6b5a',
    good: '#5df2c0',
    warn: '#ff6b5a',
  },
};

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 260 });

Input.setTouchLayout([
  { name: 'lb', xRatio: 0.11, yRatio: 0.80, radius: 48, label: '◀' },
  { name: 'rb', xRatio: 0.31, yRatio: 0.80, radius: 48, label: '▶' },
  { name: 'a', xRatio: 0.87, yRatio: 0.76, radius: 60, label: 'BURN' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  burn: { beep: { freq: 130, duration: 0.06, type: 'sawtooth', volume: 0.05 } },
  gate: { beep: { freq: 720, duration: 0.34, type: 'triangle', volume: 0.2 } },
  crash: { beep: { freq: 90, duration: 0.45, type: 'sawtooth', volume: 0.26 } },
  dry: { beep: { freq: 200, duration: 0.12, type: 'square', volume: 0.09 } },
  over: { beep: { freq: 70, duration: 0.8, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let flight = new Flight();
let running = false;
let burnNoise = 0;
let shake = 0;
let flash = null;
let lastGates = 0;
let wasDry = false;

const stars = [];
for (let i = 0; i < 140; i++) {
  stars.push({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 0.5 + Math.random() * 1.3,
    bright: Math.random() < 0.15,
  });
}

function reset() {
  flight = new Flight();
  running = true;
  burnNoise = 0;
  shake = 0;
  flash = null;
  lastGates = 0;
  wasDry = false;
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 2.2 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(flight.score, {
    gatesMade: flight.gatesMade,
    reachedLevel: flight.level,
    fuelBurned: Math.round(flight.fuelSpent),
    ended: flight.reason,
  });
}

// --- Update --------------------------------------------------------------

// What the player is doing right now, kept here because the drawing needs the
// SAME control the simulation just used — a line predicted from a different
// control than the one being held would be honest arithmetic answering the
// wrong question.
let control = { turn: 0, burn: false };

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 3);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }
  if (burnNoise > 0) burnNoise -= dt;

  for (const star of stars) star.twinkle = star.bright;

  if (!running) return;

  const pad = Input.get();
  let turn = 0;
  if (Math.abs(pad.x) > 0.2) turn = pad.x;
  if (pad.lb) turn = -1;
  if (pad.rb) turn = 1;
  control = { turn, burn: Boolean(pad.a || pad.b) && flight.craft.fuel > 0 };

  flight.step(dt, control);

  if (control.burn) {
    if (burnNoise <= 0) {
      audio.play('burn', { pitchVariance: 0.3 });
      burnNoise = 0.09;
    }
    const back = flight.craft.angle + Math.PI;
    particles.emit(
      sx(flight.craft.x) + Math.cos(back) * 9,
      sy(flight.craft.y) + Math.sin(back) * 9,
      {
        ...ParticlePresets.trail, count: 2,
        colors: [ART.craft.flame, ART.craft.flameHot], speed: [20, 70],
      },
    );
  }

  if (flight.craft.fuel <= 0 && !wasDry) {
    wasDry = true;
    audio.play('dry');
    say('TANK DRY — RIDE IT IN', ART.hud.warn);
  }
  if (flight.craft.fuel > 0) wasDry = false;

  if (flight.gatesMade > lastGates) {
    lastGates = flight.gatesMade;
    audio.play('gate');
    say(`GATE ${flight.gatesMade} — LEVEL ${flight.level}`, ART.hud.good);
    particles.emit(sx(flight.craft.x), sy(flight.craft.y), {
      ...ParticlePresets.sparkle, count: 26, colors: [ART.gate.ring, '#ffffff'], speed: [50, 200],
    });
  }

  if (!flight.running) {
    if (flight.reason && flight.reason !== 'Out of fuel') {
      audio.play('crash');
      shake = 1;
      particles.emit(sx(flight.craft.x), sy(flight.craft.y), {
        ...ParticlePresets.explosion, count: 30,
        colors: [ART.craft.flame, ART.path.doomed, '#ffffff'], speed: [80, 260],
      });
    }
    finish();
  }
}

// --- Drawing -------------------------------------------------------------

const sx = (x) => x * SCALE;
const sy = (y) => y * SCALE;

function drawSpace() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.space.far);
  g.addColorStop(1, ART.space.near);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const star of stars) {
    ctx.fillStyle = star.bright ? ART.space.starBright : ART.space.star;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBodies() {
  for (const body of flight.bodies) {
    // THE REACH OF A BODY, drawn. A player should be able to see where the pull
    // starts to matter rather than learn it by dying, and the radius shown is
    // where gravity is about equal to the engine — a number from the physics
    // rather than a nice-looking circle.
    const reach = Math.sqrt((TUNING.G * body.mass) / TUNING.thrust);
    ctx.fillStyle = ART.body.field;
    ctx.strokeStyle = ART.body.fieldEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx(body.x), sy(body.y), sx(reach), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const g = ctx.createRadialGradient(
      sx(body.x - body.radius * 0.35), sy(body.y - body.radius * 0.35), sx(body.radius * 0.15),
      sx(body.x), sy(body.y), sx(body.radius),
    );
    g.addColorStop(0, ART.body.rim);
    g.addColorStop(0.55, ART.body.core);
    g.addColorStop(1, ART.body.shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx(body.x), sy(body.y), sx(body.radius), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGate() {
  const x = sx(flight.gate.x);
  const y = sy(flight.gate.y);
  const r = sx(TUNING.gateRadius);
  ctx.fillStyle = ART.gate.inner;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ART.gate.ring;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  // A slow pulse, so the one thing you are aiming at is never lost against the
  // stars.
  const pulse = 1 + 0.14 * Math.sin(performance.now() / 420);
  ctx.strokeStyle = ART.gate.glow;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r * pulse * 1.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPath() {
  // THE HONEST LINE. One call to the same predict() the craft flies with, using
  // the control being held this very frame.
  const forecast = flight.path(control);
  if (forecast.points.length < 2) return;

  const doomed = Boolean(forecast.hit);
  const arriving = speedOf(forecast.end) <= TUNING.gateSpeed;
  ctx.strokeStyle = doomed ? ART.path.doomed : arriving ? ART.path.slow : ART.path.good;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.moveTo(sx(forecast.points[0].x), sy(forecast.points[0].y));
  for (const point of forecast.points) ctx.lineTo(sx(point.x), sy(point.y));
  ctx.stroke();
  ctx.setLineDash([]);

  // Where it ends, and what happens there. A cross for a crash, a ring for a
  // coast — because "this line ends in a planet" is the single most useful
  // thing the game can tell you.
  const last = forecast.points[forecast.points.length - 1];
  const x = sx(last.x);
  const y = sy(last.y);
  ctx.strokeStyle = doomed ? ART.path.doomed : ART.path.good;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (doomed) {
    ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7);
    ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7);
  } else {
    ctx.arc(x, y, 6, 0, Math.PI * 2);
  }
  ctx.stroke();
}

function drawCraft() {
  const craft = flight.craft;
  ctx.save();
  ctx.translate(sx(craft.x), sy(craft.y));
  ctx.rotate(craft.angle);

  if (control.burn && running) {
    ctx.fillStyle = ART.craft.flame;
    ctx.beginPath();
    ctx.moveTo(-8, -4);
    ctx.lineTo(-8 - 8 - Math.random() * 6, 0);
    ctx.lineTo(-8, 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = running ? ART.craft.hull : ART.craft.dead;
  ctx.strokeStyle = ART.craft.rim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-7, 7);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-7, -7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHud() {
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.text;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(flight.score), 22, 40);

  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText(`LEVEL ${flight.level}  ·  ${flight.bodies.length} BODIES`, 22, 60);

  // Fuel.
  const fuel = flight.craft.fuel / TUNING.fuel;
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText('FUEL', W - 210, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(W - 168, 18, 146, 15);
  ctx.fillStyle = fuel < 0.25 ? ART.hud.fuelLow : ART.hud.fuel;
  ctx.fillRect(W - 168, 18, 146 * fuel, 15);

  // SPEED, against the speed the gate will accept — because "too fast to stop"
  // is the thing most likely to be misjudged, and it is a number the game
  // already knows.
  const speed = speedOf(flight.craft);
  const ok = speed <= TUNING.gateSpeed;
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText('SPEED', W - 210, 56);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(W - 168, 44, 146, 15);
  ctx.fillStyle = ok ? ART.hud.good : ART.hud.warn;
  ctx.fillRect(W - 168, 44, 146 * clamp(speed / (TUNING.gateSpeed * 2), 0, 1), 15);
  // The line the gate will accept, marked on the bar.
  ctx.fillStyle = ART.hud.text;
  ctx.fillRect(W - 168 + 73, 41, 2, 21);

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, 90);
    ctx.globalAlpha = 1;
  }

  // Nothing is happening yet, and the game says so rather than leaving a
  // player to wonder whether it is broken.
  if (running && !flight.armed) {
    ctx.textAlign = 'center';
    ctx.fillStyle = ART.hud.dim;
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText('READ THE LINE — TURN OR BURN TO START', W / 2, H - 34);
  }
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 9, (Math.random() - 0.5) * shake * 9);
  drawSpace();
  drawBodies();
  drawGate();
  if (running) drawPath();
  drawCraft();
  particles.draw(ctx);
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
  title: 'Gravity Well',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Turn', gamepad: 'Left stick', keyboard: 'A/D or arrows', touch: '◀ ▶ pads' },
    { action: 'Burn', gamepad: 'A', keyboard: 'Space', touch: 'BURN pad' },
    { action: 'The dotted line', gamepad: 'Is where you are actually going', keyboard: 'Is where you are actually going', touch: 'Is where you are actually going' },
    { action: 'Red line', gamepad: 'Ends in a planet — turn', keyboard: 'Ends in a planet — turn', touch: 'Ends in a planet — turn' },
    { action: 'The gate', gamepad: 'Only accepts you below the speed mark', keyboard: 'Only accepts you below the speed mark', touch: 'Only below the speed mark' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Gravity Well',
  tagline: 'Burning is a decision. Falling is free.',
});
