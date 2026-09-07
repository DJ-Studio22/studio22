// games/gravity-well/game.js
//
// Gravity Well — the line on screen is the flight.
//
// THE RULE
// --------
// Fly as far down the corridor as you can. Bodies to slingshot around and to
// avoid, fuel rings scattered along the way that fill the tank when you pass
// through one, and no end: the world is built ahead of you as you go. Burning
// is a decision; falling is free. Distance is the score.
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

// One world unit is SCALE pixels, so a body is round and the prediction is
// drawn in the same coordinates it was computed in. The canvas is as tall as
// the corridor and as wide as it needs to be; the camera handles the rest.
const SCALE = 4.3;
const H = Math.round(TUNING.height * SCALE);   // 645
const W = 960;

// WHERE THE CAMERA SITS, as a fraction of the screen width.
//
// Not centred. The craft sits a third of the way across, because everything
// worth reading is in front of it: the whole point of the game is seeing what
// is coming before you commit to it, and a centred camera spends half the
// screen on corridor you have already flown.
const CAMERA_AT = 0.34;

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
  ring: {
    edge: '#5df2c0',
    inner: 'rgba(93,242,192,0.16)',
    glow: 'rgba(93,242,192,0.30)',
    spent: 'rgba(93,242,192,0.10)',
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
let lastRings = 0;
let wasDry = false;
// The camera, in world units. It follows the craft with a little lag, which is
// what makes a slingshot read as being flung rather than as the world jumping.
let camera = { x: 0, y: TUNING.height / 2 };

// Stars live in world coordinates and are recycled behind the camera, so the
// background scrolls with the corridor instead of sitting still on the glass.
const stars = [];
for (let i = 0; i < 170; i++) {
  stars.push({
    x: Math.random() * (W / SCALE) * 1.6,
    y: Math.random() * TUNING.height,
    r: 0.4 + Math.random() * 1.1,
    // Two layers, so there is parallax to read speed from.
    depth: Math.random() < 0.4 ? 0.45 : 0.85,
    bright: Math.random() < 0.15,
  });
}

function reset() {
  flight = new Flight();
  running = true;
  burnNoise = 0;
  shake = 0;
  flash = null;
  lastRings = 0;
  wasDry = false;
  camera = { x: flight.craft.x, y: TUNING.height / 2 };
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 2.2 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(flight.score, {
    distance: `${Math.round(flight.distance)} units`,
    ringsTaken: flight.ringsTaken,
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
    say('TANK DRY — FIND A RING', ART.hud.warn);
  }
  if (flight.craft.fuel > 0) wasDry = false;

  if (flight.ringsTaken > lastRings) {
    lastRings = flight.ringsTaken;
    audio.play('gate');
    say('FUEL', ART.hud.good);
    particles.emit(sx(flight.craft.x), sy(flight.craft.y), {
      ...ParticlePresets.sparkle, count: 26, colors: [ART.ring.edge, '#ffffff'], speed: [50, 200],
    });
  }

  // THE CAMERA FOLLOWS, with lag. Ahead of the craft rather than on it, because
  // what matters is the corridor you have not flown yet.
  const lead = Math.min(60, Math.max(0, flight.craft.vx) * 0.5);
  const wantX = flight.craft.x + lead;
  const wantY = Math.max(TUNING.height * 0.5, Math.min(TUNING.height * 0.5, flight.craft.y));
  camera.x += (wantX - camera.x) * Math.min(1, dt * 3.2);
  camera.y += (wantY - camera.y) * Math.min(1, dt * 3.2);

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

// World to screen, through the camera. Everything drawn goes through these,
// including the prediction, so the line is in the same place as the craft.
const sx = (x) => (x - camera.x) * SCALE + W * CAMERA_AT;
const sy = (y) => (y - camera.y) * SCALE + H / 2;

// A LENGTH, not a position. The two are different once there is a camera, and
// conflating them is not a cosmetic mistake: sx() of a radius is a screen x
// coordinate, which goes negative as soon as the camera moves past it, and
// canvas throws on a gradient with a negative radius. The game loop stopped
// dead the first time it was played after the rework.
const len = (units) => units * SCALE;

function drawSpace() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.space.far);
  g.addColorStop(1, ART.space.near);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Parallax stars, recycled once they fall behind. Two depths, so there is
  // something to read speed from when the corridor is empty.
  const span = (W / SCALE) * 1.6;
  for (const star of stars) {
    let x = (star.x - camera.x * star.depth) % span;
    if (x < -20) x += span;
    ctx.fillStyle = star.bright ? ART.space.starBright : ART.space.star;
    ctx.globalAlpha = star.depth;
    ctx.beginPath();
    ctx.arc(x * SCALE, star.y * SCALE, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // The floor and the ceiling of the corridor, which are as fatal as a planet.
  ctx.strokeStyle = ART.hud.warn;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, sy(0));
  ctx.lineTo(W, sy(0));
  ctx.moveTo(0, sy(TUNING.height));
  ctx.lineTo(W, sy(TUNING.height));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBodies() {
  for (const body of flight.bodies) {
    if (sx(body.x) < -200 || sx(body.x) > W + 200) continue;
    // THE REACH OF A BODY, drawn. A player should be able to see where the pull
    // starts to matter rather than learn it by dying, and the radius shown is
    // where gravity is about equal to the engine — a number from the physics
    // rather than a nice-looking circle.
    const reach = Math.sqrt((TUNING.G * body.mass) / TUNING.thrust);
    ctx.fillStyle = ART.body.field;
    ctx.strokeStyle = ART.body.fieldEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx(body.x), sy(body.y), len(reach), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const g = ctx.createRadialGradient(
      sx(body.x - body.radius * 0.35), sy(body.y - body.radius * 0.35), len(body.radius * 0.15),
      sx(body.x), sy(body.y), len(body.radius),
    );
    g.addColorStop(0, ART.body.rim);
    g.addColorStop(0.55, ART.body.core);
    g.addColorStop(1, ART.body.shade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx(body.x), sy(body.y), len(body.radius), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRings() {
  const r = TUNING.gateRadius * SCALE;
  for (const ring of flight.rings) {
    const x = sx(ring.x);
    const y = sy(ring.y);
    if (x < -60 || x > W + 60) continue;
    ctx.fillStyle = ART.ring.inner;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ART.ring.edge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // A slow pulse, so fuel is never lost against the stars.
    const pulse = 1 + 0.14 * Math.sin(performance.now() / 420 + ring.x);
    ctx.strokeStyle = ART.ring.glow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPath() {
  // THE HONEST LINE. One call to the same predict() the craft flies with, using
  // the control being held this very frame.
  const forecast = flight.path(control);
  if (forecast.points.length < 2) return;

  const doomed = Boolean(forecast.hit);
  // Green when the line passes through fuel, because that is the other thing
  // worth knowing about where you are going.
  const fuelling = !doomed && flight.rings.some((ring) => forecast.points.some(
    (p) => Math.hypot(p.x - ring.x, p.y - ring.y) < TUNING.gateRadius,
  ));
  ctx.strokeStyle = doomed ? ART.path.doomed : fuelling ? ART.path.slow : ART.path.good;
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
  ctx.fillText(`${Math.round(flight.distance)} UNITS  ·  ${flight.ringsTaken} RINGS`, 22, 60);

  // Fuel.
  const fuel = flight.craft.fuel / TUNING.fuel;
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText('FUEL', W - 210, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(W - 168, 18, 146, 15);
  ctx.fillStyle = fuel < 0.25 ? ART.hud.fuelLow : ART.hud.fuel;
  ctx.fillRect(W - 168, 18, 146 * fuel, 15);

  // HOW FAR THE NEAREST FUEL IS, which is the question a dry tank asks.
  let nearest = null;
  for (const ring of flight.rings) {
    const d = Math.hypot(ring.x - flight.craft.x, ring.y - flight.craft.y);
    if (!nearest || d < nearest) nearest = d;
  }
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText('FUEL AHEAD', W - 210, 56);
  ctx.fillStyle = nearest === null ? ART.hud.dim : ART.hud.good;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText(nearest === null ? '—' : `${Math.round(nearest)}`, W - 130, 56);

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
  drawRings();
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
    { action: 'Green rings', gamepad: 'Fill the tank — fly through one', keyboard: 'Fill the tank — fly through one', touch: 'Fill the tank — fly through one' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Gravity Well',
  tagline: 'Burning is a decision. Falling is free.',
});
