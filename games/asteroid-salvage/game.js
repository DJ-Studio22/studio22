// games/asteroid-salvage/game.js
//
// Asteroid Salvage — armour is not free.
//
// THE RULE
// --------
// Fly a field for twenty-six seconds, collecting salvage and not hitting
// anything. Then a shop: engine, hull, or cargo. Then the next field, denser
// and faster. Salvage collected is the score.
//
// WHY THE SHOP IS THE GAME
// ------------------------
// Acceleration is thrust divided by mass, and hull plates and cargo bays are
// made of something. So armour literally slows you down, and the engine you
// did not buy is the reason you cannot dodge — the three upgrades interfere
// rather than stack.
//
// And the next field's character is ANNOUNCED before the shop closes. A dense
// field is many rocks slowly and wants a ship that can thread them; a fast one
// is few rocks quickly and wants a ship that can take the one you did not see.
// So the shop asks a different question every time.
//
// flight.js proves it rather than claiming it: three fixed purchase orders,
// same pilot, same seeds, and none of them wins more than half — while a bot
// that reads the announcement beats all three.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, and a shop that shows what a level
// actually costs you elsewhere. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp, randRange } from '../../engine/util.js';

import {
  Flight, TUNING, UPGRADE, UPGRADES, accelerationAt, collectAt, hullAt,
} from './flight.js';

const GAME_ID = 'asteroid-salvage';

// The canvas matches the field's proportions, so a world unit is the same
// number of pixels in both axes and a rock is round.
const SCALE = 9.4;
const W = Math.round(TUNING.width * SCALE);   // 940
const H = Math.round(TUNING.height * SCALE);  // 564

// --- Art palette ---------------------------------------------------------
//
// Asteroid Salvage's own colours, deliberately NOT from tokens.css. Deep space
// with a working light on it: cold rock, a warm ship, and one bright colour
// reserved for salvage so the eye chases it. The shell still draws pause, game
// over and its own screens in site tokens over the top.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  space: { far: '#070a12', near: '#0e1422', star: 'rgba(200,220,255,.55)', dust: 'rgba(140,170,220,.20)' },
  rock: { body: '#6b7385', shade: '#454b59', rim: '#8f99ad', crater: '#3a4049' },
  ship: {
    hull: '#e8944a', hullDark: '#8a4d1c', glass: '#9fd8ff',
    flame: '#ffd45e', flameCore: '#fff6d8', shield: 'rgba(159,216,255,.34)',
  },
  salvage: { body: '#5df2c0', edge: '#1c8f6e', glow: 'rgba(93,242,192,.28)' },
  hud: {
    label: 'rgba(226,236,250,.58)',
    value: '#eef4fb',
    good: '#5df2c0',
    warn: '#ffd45e',
    bad: '#ff6b5a',
    panel: 'rgba(7,10,18,.88)',
    panelEdge: 'rgba(226,236,250,.14)',
    selected: '#ffd45e',
    selectedFill: 'rgba(255,212,94,.13)',
    barTrack: 'rgba(7,10,18,.66)',
  },
  spark: ['#ffd45e', '#ff8a5a', '#eef4fb'],
  loot: ['#5df2c0', '#eef4fb'],
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 300 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.80, radius: 50, label: 'Buy' },
  { name: 'start', xRatio: 0.88, yRatio: 0.94, radius: 44, label: 'Launch' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 300, duration: 0.03, type: 'square', volume: 0.06 } },
  loot: { beep: { freq: 780, duration: 0.07, type: 'sine', volume: 0.13 } },
  hit: { beep: { freq: 110, duration: 0.26, type: 'sawtooth', volume: 0.22 } },
  buy: { beep: { freq: 560, duration: 0.13, type: 'triangle', volume: 0.16 } },
  denied: { beep: { freq: 130, duration: 0.06, type: 'square', volume: 0.09 } },
  field: { beep: { freq: 420, duration: 0.28, type: 'triangle', volume: 0.17 } },
  over: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let flight = new Flight();
let running = false;
let shopCursor = 0;
let time = 0;
let shake = 0;
let navLatch = 0;
let lastHits = 0;
let lastBanked = 0;
let lastFields = 0;
let flash = null;

const stars = [];
for (let i = 0; i < 130; i++) {
  stars.push({ x: Math.random() * W, y: Math.random() * H, r: randRange(0.5, 1.6), z: randRange(0.2, 1) });
}

function reset() {
  flight = new Flight();
  running = true;
  shopCursor = 0;
  time = 0;
  shake = 0;
  lastHits = 0;
  lastBanked = 0;
  lastFields = 0;
  flash = null;
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 1.8 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(flight.banked, {
    fieldsCleared: flight.fieldsCleared,
    hitsTaken: flight.hits,
    build: `engine ${flight.engine} · hull ${flight.hullLevel} · cargo ${flight.cargo}`,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  time += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  for (const star of stars) {
    star.x -= (14 + star.z * 46) * dt;
    if (star.x < -2) { star.x = W + 2; star.y = Math.random() * H; }
  }

  if (!running) return;

  const pad = Input.get();

  if (flight.shopOpen) {
    const dir = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
    if (dir !== 0 && navLatch === 0) {
      shopCursor = (shopCursor + dir + UPGRADES.length) % UPGRADES.length;
      audio.play('move');
    }
    navLatch = dir;

    if (Input.pressed('a')) {
      if (flight.buy(UPGRADES[shopCursor])) audio.play('buy');
      else audio.play('denied');
    }
    if (Input.pressed('start') || Input.pressed('b')) {
      flight.launch();
      audio.play('field');
      say(`${flight.shape.name} field`, ART.hud.warn);
    }
    return;
  }
  navLatch = 0;

  flight.step(dt, { x: pad.x, y: pad.y });

  if (flight.banked > lastBanked) {
    audio.play('loot', { pitchVariance: 0.12 });
    particles.emit(sx(flight.x), sy(flight.y), {
      ...ParticlePresets.sparkle, count: 6, colors: ART.loot, speed: [30, 100],
    });
  }
  lastBanked = flight.banked;

  if (flight.hits > lastHits) {
    audio.play('hit');
    shake = 1;
    particles.emit(sx(flight.x), sy(flight.y), {
      ...ParticlePresets.explosion, count: 22, colors: ART.spark, speed: [90, 240],
    });
  }
  lastHits = flight.hits;

  if (flight.fieldsCleared > lastFields) {
    audio.play('field');
    shopCursor = 0;
  }
  lastFields = flight.fieldsCleared;

  if (!flight.running) finish();
}

// --- Drawing -------------------------------------------------------------

const sx = (x) => x * SCALE;
const sy = (y) => y * SCALE;

function drawSpace() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.space.far);
  g.addColorStop(1, ART.space.near);
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  for (const star of stars) {
    ctx.fillStyle = star.z > 0.6 ? ART.space.star : ART.space.dust;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRocks() {
  for (const rock of flight.rocks) {
    const x = sx(rock.x);
    const y = sy(rock.y);
    const r = rock.r * SCALE;
    ctx.fillStyle = ART.rock.body;
    ctx.beginPath();
    // A lumpy circle, deterministic per rock so it does not shimmer.
    for (let i = 0; i <= 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const wobble = 1 + Math.sin(a * 3 + rock.spin * 6) * 0.13;
      const px = x + Math.cos(a) * r * wobble;
      const py = y + Math.sin(a) * r * wobble;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ART.rock.rim;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = ART.rock.crater;
    ctx.beginPath();
    ctx.arc(x - r * 0.22, y - r * 0.16, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSalvage() {
  for (const piece of flight.salvagePieces) {
    if (piece.taken) continue;
    const x = sx(piece.x);
    const y = sy(piece.y) + Math.sin(time * 4 + piece.x) * 2;
    ctx.fillStyle = ART.salvage.glow;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ART.salvage.body;
    ctx.beginPath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ART.salvage.edge;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawShip() {
  const x = sx(flight.x);
  const y = sy(flight.y);
  const r = TUNING.shipRadius * SCALE;

  // The collection radius, drawn — it is a thing you buy, so it should be a
  // thing you can see getting bigger.
  ctx.strokeStyle = 'rgba(93,242,192,.20)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.arc(x, y, flight.collectRadius * SCALE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (flight.invulnerable > 0 && Math.floor(time * 14) % 2 === 0) {
    ctx.fillStyle = ART.ship.shield;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // Exhaust, scaled by how hard it is actually accelerating — so a heavy ship
  // visibly struggles.
  const push = Math.hypot(flight.vx, flight.vy);
  if (push > 2) {
    const size = clamp(push / 26, 0.2, 1.4);
    ctx.fillStyle = ART.ship.flame;
    ctx.beginPath();
    ctx.ellipse(x - r * 1.3, y, r * size * 1.1, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ART.ship.flameCore;
    ctx.beginPath();
    ctx.ellipse(x - r * 1.2, y, r * size * 0.6, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The nose is drawn at 1.25 radii rather than 1.7. At 1.7 a ship pinned
  // against the right wall — which the walls make a real position to be in —
  // had its point sticking out past the edge of the canvas.
  ctx.fillStyle = ART.ship.hull;
  ctx.beginPath();
  ctx.moveTo(x + r * 1.25, y);
  ctx.lineTo(x - r, y - r * 0.95);
  ctx.lineTo(x - r * 0.5, y);
  ctx.lineTo(x - r, y + r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ART.ship.hullDark;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = ART.ship.glass;
  ctx.beginPath();
  ctx.arc(x + r * 0.35, y, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

function drawHud() {
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(16, 14, 300, 74, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  // Anchored to the left edge of the SCREEN, not of the game. See screen.left.
  const hudLeft = screen.left;
  ctx.fillText('SALVAGE', hudLeft + 30, 36);
  ctx.fillStyle = ART.hud.good;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(String(flight.banked), hudLeft + 30, 62);

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('FIELD', 108, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(String(flight.field), 108, 62);

  // Hull as pips, because a hit is a thing you lose rather than a number.
  for (let i = 0; i < flight.hullMax; i++) {
    ctx.fillStyle = i < flight.hull ? ART.hud.bad : 'rgba(226,236,250,.14)';
    ctx.beginPath();
    ctx.roundRect(172 + i * 14, 30, 9, 20, 3);
    ctx.fill();
  }
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('HULL', 172, 62);

  // The clock on this field.
  const share = clamp(flight.left / TUNING.fieldSeconds, 0, 1);
  ctx.fillStyle = ART.hud.barTrack;
  ctx.beginPath(); ctx.roundRect(W - 300, 30, 268, 12, 6); ctx.fill();
  ctx.fillStyle = ART.hud.value;
  ctx.beginPath(); ctx.roundRect(W - 300, 30, Math.max(4, 268 * (1 - share)), 12, 6); ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(
    `${flight.shape.name.toUpperCase()} FIELD  ·  ${Math.ceil(flight.left)}s to the shop`,
    W - 32, 62,
  );
}

/**
 * The shop.
 *
 * Every row says what the level buys AND what it costs elsewhere, because the
 * whole decision is that armour is heavy. A shop that showed only the upside
 * would be asking the player to take the trade on trust.
 */
function drawShop() {
  if (!flight.shopOpen) return;
  ctx.fillStyle = 'rgba(5,8,14,.90)';
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(`Field ${flight.field} cleared`, W / 2, 74);

  // THE ANNOUNCEMENT. Everything below is chosen against this line.
  const next = flight.nextShape;
  ctx.fillStyle = ART.hud.warn;
  ctx.font = '800 19px system-ui, sans-serif';
  ctx.fillText(`Next: a ${next.name.toUpperCase()} field`, W / 2, 108);
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(
    next.name === 'Dense' ? `${next.rocks} rocks, but slow — you will need to thread them`
      : next.name === 'Fast' ? `${next.rocks} rocks at speed — you will not see one of them coming`
        : `${next.rocks} rocks, middling speed`,
    W / 2, 132,
  );

  ctx.fillStyle = ART.hud.good;
  ctx.font = '800 17px system-ui, sans-serif';
  ctx.fillText(`${flight.salvage} salvage to spend`, W / 2, 170);

  const rows = [
    {
      kind: UPGRADE.ENGINE,
      name: 'Engine',
      now: `thrust ${Math.round(accelerationAt(flight.engine, flight.hullLevel, flight.cargo))}`,
      then: `→ ${Math.round(accelerationAt(flight.engine + 1, flight.hullLevel, flight.cargo))}`,
      cost: null,
    },
    {
      kind: UPGRADE.HULL,
      name: 'Hull plating',
      now: `${flight.hullMax} hull`,
      then: `→ ${hullAt(flight.hullLevel + 1)}`,
      cost: `and thrust ${Math.round(accelerationAt(flight.engine, flight.hullLevel, flight.cargo))} → `
        + `${Math.round(accelerationAt(flight.engine, flight.hullLevel + 1, flight.cargo))}`,
    },
    {
      kind: UPGRADE.CARGO,
      name: 'Cargo scoop',
      now: `reach ${collectAt(flight.cargo).toFixed(1)}`,
      then: `→ ${collectAt(flight.cargo + 1).toFixed(1)}`,
      cost: `and thrust ${Math.round(accelerationAt(flight.engine, flight.hullLevel, flight.cargo))} → `
        + `${Math.round(accelerationAt(flight.engine, flight.hullLevel, flight.cargo + 1))}`,
    },
  ];

  const prices = flight.prices;
  rows.forEach((row, i) => {
    const y = 208 + i * 82;
    const on = i === shopCursor;
    const price = prices[row.kind];
    ctx.globalAlpha = price.maxed ? 0.4 : 1;

    ctx.fillStyle = on ? ART.hud.selectedFill : ART.hud.panel;
    ctx.beginPath(); ctx.roundRect(W / 2 - 330, y, 660, 70, 10); ctx.fill();
    ctx.strokeStyle = on ? ART.hud.selected : ART.hud.panelEdge;
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = on ? ART.hud.selected : ART.hud.value;
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.fillText(`${row.name}  ·  level ${price.level}`, W / 2 - 306, y + 28);

    ctx.fillStyle = ART.hud.good;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(`${row.now} ${row.then}`, W / 2 - 306, y + 50);
    if (row.cost) {
      ctx.fillStyle = ART.hud.bad;
      ctx.fillText(row.cost, W / 2 - 120, y + 50);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = price.maxed ? ART.hud.label : price.afford ? ART.hud.good : ART.hud.bad;
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(price.maxed ? 'MAXED' : String(price.price), W / 2 + 306, y + 40);
    ctx.globalAlpha = 1;
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText('Up and down to choose  ·  A or Space to buy  ·  Shift to launch', W / 2, H - 34);
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 7, randRange(-1, 1) * shake * 7);
  drawSpace();
  drawSalvage();
  drawRocks();
  drawShip();
  particles.draw(ctx);
  ctx.restore();

  drawHud();

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, 120);
    ctx.globalAlpha = 1;
  }

  drawShop();
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
  title: 'Asteroid Salvage',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Fly', gamepad: 'Left stick', keyboard: 'WASD or arrows', touch: 'Drag the left side' },
    { action: 'Buy', gamepad: 'A', keyboard: 'Space', touch: 'Buy pad' },
    { action: 'Launch', gamepad: 'Start or B', keyboard: 'Shift', touch: 'Launch pad' },
    { action: 'Armour', gamepad: 'Is heavy — it costs you thrust', keyboard: 'Is heavy — it costs you thrust', touch: 'Is heavy — it costs you thrust' },
    { action: 'The next field', gamepad: 'Is announced before you buy', keyboard: 'Is announced before you buy', touch: 'Is announced before you buy' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Asteroid Salvage',
  tagline: 'Armour is not free. It is heavy.',
});
