// games/bigger-fish/game.js
//
// Bigger Fish — there is always a bigger fish, and if there is not yet, there
// shortly will be.
//
// THE RULE
// --------
// A pond much larger than the screen. Eat pellets to grow, eat anything
// meaningfully smaller than you, and stay away from anything meaningfully
// bigger. Peak mass is the score. It never ends: new arrivals turn up in your
// own weight class, so outgrowing the pond is not something that happens.
//
// THE TRADE
// ---------
// MASS IS SPEED, SPENT. A big cell is slower than a small one, so growing is
// also the act of making yourself easier to corner — and spikes, which a small
// cell passes straight under, take a quarter of a big one and scatter what is
// left. Growing turns the map hostile.
//
// SPLIT is the only way to close on something faster than you, and it is a
// commitment: half your mass is thrown forward, both halves are small enough to
// be eaten by things that could not touch you a second earlier, and they will
// not merge again for ten seconds or more.
//
// EJECT shoots a small piece of mass forward. It feeds a teammate you do not
// have, so mostly it is for baiting, for shedding weight to get your speed
// back, and for feeding a spike until it spits a new one out — which is how a
// spike gets pushed at somebody too big to attack directly.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, camera, input, audio, shell wiring, and the skill picker. Not one
// rule: those are all in pond.js, where the bots and the tests can reach them.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp } from '../../engine/util.js';

import {
  Pond, SKILL_NAMES, TUNING, radiusOf, speedOf, splitReach,
} from './pond.js';

const GAME_ID = 'bigger-fish';

const W = 960;
const H = 620;

// --- Art palette ---------------------------------------------------------
//
// Bigger Fish's own colours, deliberately NOT from tokens.css. Cold water, a
// grid that tells you the camera is moving, and exactly one warm colour for
// YOU so your own cells are never in doubt in a crowd. Everything that can eat
// you is red; everything you can eat is green; everything in between is grey,
// which is a colour blind player's reading as much as anyone's — the ring
// around a cell says the same thing as its fill. The shell still draws pause,
// game over and its own screens in site tokens over the top.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  water: {
    deep: '#071a24',
    shallow: '#0d2c3c',
    grid: 'rgba(120,200,230,0.07)',
    edge: 'rgba(255,120,120,0.5)',
  },
  me: {
    body: '#ffc247',
    rim: '#8a5a00',
    core: 'rgba(255,255,255,0.22)',
  },
  prey: {
    body: '#4bd97f',
    rim: '#146b39',
  },
  threat: {
    body: '#ff5f6d',
    rim: '#8a1c2a',
  },
  even: {
    body: '#8fa3ad',
    rim: '#3c4a52',
  },
  pellet: ['#7fe3ff', '#a8f0c6', '#ffe6a3', '#ffb3d1'],
  spike: {
    body: '#1f8a5b',
    spines: '#6ef2b0',
    fed: '#ffe08a',
  },
  blob: '#ffd98a',
  hud: {
    text: '#eaf6ff',
    dim: 'rgba(234,246,255,0.55)',
    good: '#4bd97f',
    warn: '#ff5f6d',
    panel: 'rgba(4,18,26,0.82)',
  },
};

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 300 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.72, radius: 52, label: 'SPLIT' },
  { name: 'b', xRatio: 0.88, yRatio: 0.90, radius: 44, label: 'EJECT' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  pellet: { beep: { freq: 620, duration: 0.03, type: 'sine', volume: 0.045 } },
  eat: { beep: { freq: 330, duration: 0.12, type: 'triangle', volume: 0.16 } },
  split: { beep: { freq: 520, duration: 0.09, type: 'square', volume: 0.11 } },
  eject: { beep: { freq: 300, duration: 0.05, type: 'square', volume: 0.07 } },
  spike: { beep: { freq: 140, duration: 0.3, type: 'sawtooth', volume: 0.22 } },
  move: { beep: { freq: 420, duration: 0.03, type: 'square', volume: 0.05 } },
  over: { beep: { freq: 80, duration: 0.8, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let pond = new Pond(TUNING, { skill: 'steady' });
let running = false;
let choosing = true;              // the skill picker, before the run
let skillIndex = 1;               // 'steady'
let navLatch = 0;
let camera = { x: 0, y: 0, scale: 1 };
let shake = 0;
let flash = null;
let lastEaten = 0;
let lastSpiked = 0;
let lastMass = 0;

function reset() {
  pond = new Pond(TUNING, { skill: SKILL_NAMES[skillIndex] });
  running = true;
  choosing = true;
  shake = 0;
  flash = null;
  lastEaten = 0;
  lastSpiked = 0;
  lastMass = TUNING.startMass;
  const centre = pond.centreOf('player');
  camera = { x: centre.x, y: centre.y, scale: 1 };
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 2 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(Math.round(pond.peakMass), {
    bots: SKILL_NAMES[skillIndex],
    cellsEaten: pond.eaten,
    splitsMade: pond.splits,
    timesSpiked: pond.spiked,
    survived: `${Math.round(pond.time)}s`,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  if (shake > 0) shake = Math.max(0, shake - dt * 3);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  if (!running) return;

  const pad = Input.get();

  // THE SKILL PICKER, before anything moves. Chosen with the same stick and
  // button the game is played with, so it needs no separate input story.
  if (choosing) {
    const dir = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
    if (dir !== 0 && navLatch === 0) {
      skillIndex = (skillIndex + dir + SKILL_NAMES.length) % SKILL_NAMES.length;
      audio.play('move');
    }
    navLatch = dir;
    if (Input.pressed('a') || Input.pressed('start')) {
      pond = new Pond(TUNING, { skill: SKILL_NAMES[skillIndex] });
      const centre = pond.centreOf('player');
      camera = { x: centre.x, y: centre.y, scale: 1 };
      choosing = false;
      say(`${SKILL_NAMES[skillIndex].toUpperCase()} SHOAL`, ART.hud.good);
    }
    return;
  }
  navLatch = 0;

  const split = Input.pressed('a');
  const eject = Input.pressed('b');
  pond.step(dt, { x: pad.x, y: pad.y, split, eject });

  if (split && pond.splits > 0) audio.play('split');
  if (eject) audio.play('eject');

  const mass = pond.playerMass;
  if (mass > lastMass + 0.5) audio.play('pellet', { pitchVariance: 0.4 });
  lastMass = mass;

  if (pond.eaten > lastEaten) {
    audio.play('eat');
    const centre = pond.centreOf('player');
    if (centre) {
      particles.emit(...toScreen(centre.x, centre.y), {
        ...ParticlePresets.sparkle, count: 14, colors: [ART.prey.body, '#ffffff'], speed: [60, 200],
      });
    }
  }
  lastEaten = pond.eaten;

  if (pond.spiked > lastSpiked) {
    audio.play('spike');
    shake = 1;
    say('SPIKED', ART.hud.warn);
    const centre = pond.centreOf('player');
    if (centre) {
      particles.emit(...toScreen(centre.x, centre.y), {
        ...ParticlePresets.explosion, count: 26,
        colors: [ART.spike.spines, ART.me.body], speed: [90, 260],
      });
    }
  }
  lastSpiked = pond.spiked;

  // THE CAMERA. Follows the centre of your cells, and pulls back as you grow --
  // a bigger fish has to see more of the pond, both because it is slower and
  // because what it has to avoid is further away.
  const centre = pond.centreOf('player');
  if (centre) {
    const wanted = clamp(1.5 / (centre.mass ** 0.16), 0.28, 1.1);
    camera.scale += (wanted - camera.scale) * Math.min(1, dt * 2.2);
    camera.x += (centre.x - camera.x) * Math.min(1, dt * 6);
    camera.y += (centre.y - camera.y) * Math.min(1, dt * 6);
  }

  if (!pond.running) finish();
}

// --- Drawing -------------------------------------------------------------

const toScreen = (x, y) => [
  (x - camera.x) * camera.scale + W / 2,
  (y - camera.y) * camera.scale + H / 2,
];

function drawWater() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.water.shallow);
  g.addColorStop(1, ART.water.deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // A grid, so the camera moving reads as the world scrolling rather than the
  // cells drifting. In a game where you are always in the middle of the screen
  // this is the only thing that says you are moving at all.
  const step = 100 * camera.scale;
  const ox = (-camera.x * camera.scale + W / 2) % step;
  const oy = (-camera.y * camera.scale + H / 2) % step;
  ctx.strokeStyle = ART.water.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = ox; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = oy; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // The edge of the pond, which is a wall you can be pinned against.
  const [x0, y0] = toScreen(0, 0);
  const [x1, y1] = toScreen(TUNING.width, TUNING.height);
  ctx.strokeStyle = ART.water.edge;
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

function drawPellets() {
  for (const pellet of pond.pellets) {
    const [x, y] = toScreen(pellet.x, pellet.y);
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
    ctx.fillStyle = ART.pellet[(Math.floor(pellet.x + pellet.y)) % ART.pellet.length];
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.6, 4 * camera.scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlobs() {
  ctx.fillStyle = ART.blob;
  for (const blob of pond.blobs) {
    const [x, y] = toScreen(blob.x, blob.y);
    ctx.beginPath();
    ctx.arc(x, y, radiusOf(blob.mass) * camera.scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSpikes() {
  for (const spike of pond.spikes) {
    const [x, y] = toScreen(spike.x, spike.y);
    const r = TUNING.spikeRadius * camera.scale;
    if (x < -r * 3 || y < -r * 3 || x > W + r * 3 || y > H + r * 3) continue;
    ctx.fillStyle = ART.spike.body;
    ctx.strokeStyle = spike.fed > 0 ? ART.spike.fed : ART.spike.spines;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const spiky = r * (i % 2 ? 1.32 : 0.9);
      const px = x + Math.cos(a) * spiky;
      const py = y + Math.sin(a) * spiky;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** How a cell relates to you: what you can eat, what can eat you, what is even. */
function standing(cell, myMass) {
  if (cell.owner === 'player') return ART.me;
  if (myMass > cell.mass * TUNING.eatRatio) return ART.prey;
  if (cell.mass > myMass * TUNING.eatRatio) return ART.threat;
  return ART.even;
}

function drawCells() {
  const myMass = pond.playerMass;
  // Smallest first, so a big cell never hides a small one you needed to see.
  const order = [...pond.cells].sort((a, b) => a.mass - b.mass);
  for (const cell of order) {
    const [x, y] = toScreen(cell.x, cell.y);
    const r = radiusOf(cell.mass) * camera.scale;
    if (x < -r - 20 || y < -r - 20 || x > W + r + 20 || y > H + r + 20) continue;
    const art = standing(cell, myMass);

    ctx.fillStyle = art.body;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // The ring is the same reading as the fill, so the who-eats-whom question
    // survives a colour-blind player and a busy screen.
    ctx.strokeStyle = art.rim;
    ctx.lineWidth = Math.max(2, r * 0.13);
    ctx.stroke();

    if (cell.owner === 'player') {
      ctx.fillStyle = ART.me.core;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    if (r > 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = `700 ${Math.max(10, Math.min(20, r * 0.5))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(cell.mass)), x, y + 4);
    }
  }
}

function drawReach() {
  // WHERE A SPLIT WOULD LAND, drawn from the same splitReach() the bots use to
  // decide whether to commit to one. A dashed ring rather than a number,
  // because the question it answers is "can I reach that from here".
  const mine = pond.cellsOf('player');
  if (!mine.length) return;
  const head = mine.reduce((a, b) => (a.mass >= b.mass ? a : b));
  if (head.mass < TUNING.splitMinMass) return;
  const [x, y] = toScreen(head.x, head.y);
  ctx.strokeStyle = 'rgba(255,194,71,0.28)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 9]);
  ctx.beginPath();
  ctx.arc(x, y, splitReach(head.mass) * camera.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMinimap() {
  const size = 118;
  const pad = 14;
  const x0 = W - size - pad;
  const y0 = H - size - pad;
  ctx.fillStyle = ART.hud.panel;
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  const sx = (x) => x0 + (x / TUNING.width) * size;
  const sy = (y) => y0 + (y / TUNING.height) * size;

  for (const spike of pond.spikes) {
    ctx.fillStyle = ART.spike.spines;
    ctx.fillRect(sx(spike.x) - 1, sy(spike.y) - 1, 2, 2);
  }
  const myMass = pond.playerMass;
  for (const cell of pond.cells) {
    if (cell.mass < myMass * 0.25 && cell.owner !== 'player') continue;
    ctx.fillStyle = standing(cell, myMass).body;
    const r = clamp(Math.sqrt(cell.mass) * 0.12, 1.5, 5);
    ctx.beginPath();
    ctx.arc(sx(cell.x), sy(cell.y), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHud() {
  const mass = pond.playerMass;
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.text;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(String(Math.round(mass)), 22, 44);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText(`PEAK ${Math.round(pond.peakMass)}  ·  ${SKILL_NAMES[skillIndex].toUpperCase()} BOTS`, 22, 64);

  // SPEED, as a share of what a starting cell does, because the trade is the
  // game and a number you can watch fall is the clearest way to say it.
  const share = speedOf(mass) / speedOf(TUNING.startMass);
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText('SPEED', 22, 88);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(72, 77, 120, 12);
  ctx.fillStyle = share < 0.55 ? ART.hud.warn : ART.hud.good;
  ctx.fillRect(72, 77, 120 * clamp(share, 0, 1), 12);

  // Whether the terrain has become your problem yet.
  if (mass >= TUNING.spikeMass) {
    ctx.fillStyle = ART.hud.warn;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('BIG ENOUGH FOR SPIKES TO HURT', 22, 110);
  }

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, 120);
    ctx.globalAlpha = 1;
  }
}

function drawPicker() {
  ctx.fillStyle = 'rgba(4,18,26,0.86)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.text;
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText('HOW GOOD ARE THE OTHER FISH?', W / 2, 150);

  const blurbs = {
    careless: 'Splits at anything in front of it and pays for it. Ignores spikes.',
    steady: 'Splits only when it will land, and not while it can be punished.',
    ruthless: 'All of that, and it will herd you onto a spike to get you.',
  };

  for (let i = 0; i < SKILL_NAMES.length; i++) {
    const name = SKILL_NAMES[i];
    const y = 230 + i * 82;
    const on = i === skillIndex;
    ctx.fillStyle = on ? 'rgba(255,194,71,0.16)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(W / 2 - 320, y - 34, 640, 66);
    ctx.strokeStyle = on ? ART.me.body : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = on ? 3 : 1;
    ctx.strokeRect(W / 2 - 320, y - 34, 640, 66);
    ctx.fillStyle = on ? ART.me.body : ART.hud.text;
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText(name.toUpperCase(), W / 2, y - 6);
    ctx.fillStyle = ART.hud.dim;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(blurbs[name], W / 2, y + 18);
  }

  ctx.fillStyle = ART.hud.dim;
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('They all move and think at the same speed as each other.', W / 2, H - 92);
  ctx.fillText('What changes is how well they choose.', W / 2, H - 70);
  ctx.fillStyle = ART.hud.text;
  ctx.font = '700 17px system-ui, sans-serif';
  ctx.fillText('LEFT / RIGHT TO CHOOSE  ·  SPLIT BUTTON TO DIVE IN', W / 2, H - 36);
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 10);
  drawWater();
  drawPellets();
  drawSpikes();
  drawBlobs();
  drawReach();
  drawCells();
  particles.draw(ctx);
  ctx.restore();

  drawHud();
  drawMinimap();
  if (choosing) drawPicker();
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
  title: 'Bigger Fish',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Swim', gamepad: 'Left stick', keyboard: 'WASD or arrows', touch: 'Drag the left side' },
    { action: 'Split', gamepad: 'A', keyboard: 'Space', touch: 'SPLIT pad' },
    { action: 'Eject', gamepad: 'B', keyboard: 'Shift', touch: 'EJECT pad' },
    { action: 'Green', gamepad: 'You can eat it', keyboard: 'You can eat it', touch: 'You can eat it' },
    { action: 'Red', gamepad: 'It can eat you', keyboard: 'It can eat you', touch: 'It can eat you' },
    { action: 'Spikes', gamepad: 'Harmless small, ruinous large', keyboard: 'Harmless small, ruinous large', touch: 'Harmless small, ruinous large' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Bigger Fish',
  tagline: 'Mass is speed, spent.',
});
