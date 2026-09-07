// games/dungeon-dice/game.js
//
// Dungeon Dice — every turn is a roll, and the game is what you do about it.
//
// THE RULE
// --------
// Roll five dice. Swords hit, shields block what is winding up, hearts heal.
// Bolts become charges, and charges buy the three things that make a bad roll
// answerable: reroll it, bend a face one step around the ring, or bank a die
// for the turn you will want it. Floors survived is the score.
//
// WHY THE MANIPULATION IS THE WHOLE GAME
// --------------------------------------
// A dice game has one way of being bad and it is fatal: the dice decide and
// the player watches. So dice.js measures two things rather than asserting
// them — that a bot which works the roll beats one that takes what it is given
// (8 floors against 15), and that a run almost never ends on a turn where
// nothing could have been done (5%, and that figure is an upper bound).
//
// Both numbers started out wrong, and the tests are what said so.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, and the one thing this game has to get
// right visually: showing what the table is WORTH and what is about to land,
// at a glance, so a decision is a decision rather than arithmetic homework.
// Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp, randRange } from '../../engine/util.js';

import { FACE, Run, TUNING } from './dice.js';

const GAME_ID = 'dungeon-dice';

const W = 880;
const H = 560;

// --- Art palette ---------------------------------------------------------
//
// Dungeon Dice' own colours, deliberately NOT from tokens.css. Candlelit
// stone: a warm dark room, bone-white dice, and one cold electric colour that
// belongs only to charges and the things they buy — so the eye learns that
// blue means "you can still do something about this". The shell still draws
// pause, game over and its own screens in site tokens over the top.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  room: { far: '#171219', near: '#241b26', floor: '#2e2331', grout: 'rgba(255,224,180,.05)' },
  die: {
    body: '#efe6d6', bodyEdge: '#8d7f68', shadow: 'rgba(0,0,0,.35)',
    // 136 from a plain die was not enough to see which ones you had marked;
    // 227 now, and it also carries a drawn mark.
    held: '#f5c25a', heldEdge: '#a8792a', pickEdge: '#7fd2ff',
  },
  // The shield is green rather than blue, and the contrast check is why: at
  // #6fa8dc it scored 106 against the bolt, and those are the two faces it
  // hurts most to confuse — one of them stops the hit, the other is the
  // currency you pay to change your mind. Blue belongs to charges alone.
  face: {
    sword: '#d8534f', shield: '#5aa88c', heart: '#e0679a',
    bolt: '#7fd2ff', blank: '#6f6659',
  },
  enemy: {
    body: '#7b4a6e', bodyEdge: '#452839', eye: '#ffd45e',
    hp: '#d8534f', hpTrack: 'rgba(0,0,0,.42)',
    winding: '#ff8a5a', wound: '#ffd45e',
  },
  hero: { hp: '#7fd6a6', hpTrack: 'rgba(0,0,0,.42)', charge: '#7fd2ff', chargeSpent: 'rgba(127,210,255,.38)' },
  hud: {
    label: 'rgba(240,232,218,.58)',
    value: '#f6efe2',
    good: '#7fd6a6',
    bad: '#ff6b5a',
    warn: '#ffd45e',
    panel: 'rgba(16,11,18,.88)',
    panelEdge: 'rgba(240,232,218,.14)',
    selected: '#7fd2ff',
    selectedFill: 'rgba(127,210,255,.14)',
  },
  spark: ['#ffd45e', '#ffb340', '#f6efe2'],
  blood: ['#d8534f', '#7b4a6e', '#e0679a'],
};

const FACE_COLOUR = {
  [FACE.SWORD]: ART.face.sword,
  [FACE.SHIELD]: ART.face.shield,
  [FACE.HEART]: ART.face.heart,
  [FACE.BOLT]: ART.face.bolt,
  [FACE.BLANK]: ART.face.blank,
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 240 });

// Start is the shell's pause everywhere in this project, so the turn is ended
// with a shoulder button instead — E on a keyboard, which sits next to the
// movement keys and is already the engine's `rs`.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.56, radius: 46, label: 'Pick' },
  { name: 'b', xRatio: 0.88, yRatio: 0.76, radius: 42, label: 'Reroll' },
  { name: 'ls', xRatio: 0.70, yRatio: 0.76, radius: 40, label: 'Bank' },
  { name: 'rs', xRatio: 0.88, yRatio: 0.94, radius: 44, label: 'Go' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 320, duration: 0.03, type: 'square', volume: 0.07 } },
  roll: { beep: { freq: 240, duration: 0.09, type: 'triangle', volume: 0.13 } },
  nudge: { beep: { freq: 700, duration: 0.06, type: 'sine', volume: 0.14 } },
  bank: { beep: { freq: 520, duration: 0.10, type: 'triangle', volume: 0.14 } },
  hit: { beep: { freq: 180, duration: 0.09, type: 'sawtooth', volume: 0.16 } },
  hurt: { beep: { freq: 110, duration: 0.20, type: 'sawtooth', volume: 0.20 } },
  heal: { beep: { freq: 620, duration: 0.14, type: 'sine', volume: 0.13 } },
  kill: { beep: { freq: 150, duration: 0.20, type: 'square', volume: 0.18 } },
  floor: { beep: { freq: 460, duration: 0.28, type: 'triangle', volume: 0.18 } },
  denied: { beep: { freq: 130, duration: 0.07, type: 'square', volume: 0.10 } },
  over: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let run = new Run();
let running = false;
let cursor = 0;              // which die the player is on
let picked = new Set();      // dice selected for a reroll
let upgradeCursor = 0;
let flash = null;
let shake = 0;
let time = 0;

function reset() {
  run = new Run();
  running = true;
  cursor = 0;
  picked = new Set();
  upgradeCursor = 0;
  flash = null;
  shake = 0;
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 1.5 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(run.floorsCleared, {
    reachedFloor: run.floor,
    rerolls: run.rerollsUsed,
    nudges: run.nudgesUsed,
    banked: run.banksUsed,
  });
}

// --- Update --------------------------------------------------------------

let navLatch = 0;

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  time += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  if (!running) return;

  const pad = Input.get();

  // Between floors: pick an upgrade.
  if (run.pendingUpgrades) {
    const dir = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
    if (dir !== 0 && navLatch === 0) {
      upgradeCursor = (upgradeCursor + dir + run.pendingUpgrades.length) % run.pendingUpgrades.length;
      audio.play('move');
    }
    navLatch = dir;
    if (Input.pressed('a') || Input.pressed('rs')) {
      const offer = run.pendingUpgrades[upgradeCursor];
      run.takeUpgrade(offer);
      upgradeCursor = 0;
      picked = new Set();
      cursor = 0;
      audio.play('floor');
      say(offer.label, ART.hud.warn);
    }
    return;
  }

  // The table. Left and right move the cursor; up and down nudge the die under
  // it, which is the manipulation that matters most and so gets the axis a
  // thumb is already on.
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  const dir = dx !== 0 ? dx : 0;
  if (dir !== 0 && navLatch === 0) {
    cursor = (cursor + dir + run.shown.length) % run.shown.length;
    audio.play('move');
  }
  if (dy !== 0 && navLatch === 0) {
    if (run.nudge(cursor, dy > 0 ? -1 : 1)) {
      audio.play('nudge');
      particles.emit(dieX(cursor), dieY() - 6, {
        ...ParticlePresets.sparkle, count: 6, colors: [ART.face.bolt], speed: [30, 90],
      });
    } else {
      audio.play('denied');
    }
  }
  navLatch = dx !== 0 ? dx : dy;

  // A: mark a die for rerolling, or reroll if any are marked.
  if (Input.pressed('a')) {
    if (picked.has(cursor)) picked.delete(cursor); else picked.add(cursor);
    audio.play('move');
  }
  if (Input.pressed('b')) {
    if (picked.size === 0) {
      audio.play('denied');
    } else if (run.reroll([...picked])) {
      audio.play('roll');
      picked = new Set();
    } else {
      audio.play('denied');
      say('No charges left', ART.hud.bad);
    }
  }
  if (Input.pressed('ls')) {
    if (run.bank(cursor)) {
      audio.play('bank');
      cursor = Math.min(cursor, Math.max(0, run.shown.length - 1));
      picked = new Set();
    } else {
      audio.play('denied');
    }
  }

  // A shoulder button ends the turn. Not Start — that is the shell's pause in
  // every game here, and a game that steals it is a game you cannot pause.
  if (Input.pressed('rs') || Input.pressed('rb')) commit();
}

function commit() {
  const before = run.floorsCleared;
  const target = pickTarget();
  const result = run.commit(target);
  picked = new Set();
  cursor = 0;
  if (!result) return;

  if (result.damage > 0) audio.play('hit');
  if (result.killed.length) {
    audio.play('kill');
    particles.emit(W / 2, 170, {
      ...ParticlePresets.explosion, count: 20, colors: ART.blood, speed: [80, 220],
    });
  }
  if (result.heal > 0) audio.play('heal');
  if (result.taken > 0) {
    audio.play('hurt');
    shake = Math.min(1, result.taken / 10);
    say(`-${result.taken}`, ART.hud.bad);
  } else if (run.incoming > 0 || result.block > 0) {
    say('Blocked', ART.hud.good);
  }
  if (run.floorsCleared > before) {
    audio.play('floor');
    say(`Floor ${before + 1} cleared`, ART.hud.warn);
  }
  if (!run.running) finish();
}

/** Concentrate on whatever this turn's damage would actually finish. */
function pickTarget() {
  if (!run.enemies.length) return null;
  const damage = run.table.damage;
  const finishable = run.enemies.filter((e) => e.hp <= damage).sort((a, b) => b.hp - a.hp)[0];
  if (finishable) return finishable.id;
  return [...run.enemies].sort((a, b) => a.hp - b.hp)[0].id;
}

// --- Drawing -------------------------------------------------------------

const DIE = 74;
const DIE_GAP = 18;
const dieX = (i) => W / 2 - ((run.shown.length * (DIE + DIE_GAP)) - DIE_GAP) / 2 + i * (DIE + DIE_GAP) + DIE / 2;
const dieY = () => 372;

function drawRoom() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.room.far);
  g.addColorStop(1, ART.room.near);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = ART.room.floor;
  ctx.fillRect(0, 300, W, H - 300);
  ctx.strokeStyle = ART.room.grout;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 300; y < H; y += 36) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  for (let x = 0; x < W; x += 60) { ctx.moveTo(x, 300); ctx.lineTo(x, H); }
  ctx.stroke();
}

/** One face, drawn as a shape rather than a letter. */
function drawFace(face, x, y, size) {
  const c = FACE_COLOUR[face];
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = size;

  switch (face) {
    case FACE.SWORD:
      // A blade with a point and a guard, not a plus sign — which is exactly
      // what the first version drew, and it read as arithmetic rather than as
      // the face that does the damage.
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.05);
      ctx.lineTo(x + s * 0.3, y - s * 0.55);
      ctx.lineTo(x + s * 0.2, y + s * 0.28);
      ctx.lineTo(x - s * 0.2, y + s * 0.28);
      ctx.lineTo(x - s * 0.3, y - s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.62, y + s * 0.34); ctx.lineTo(x + s * 0.62, y + s * 0.34);
      ctx.moveTo(x, y + s * 0.34); ctx.lineTo(x, y + s * 0.95);
      ctx.stroke();
      break;
    case FACE.SHIELD:
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.78, y - s * 0.5);
      ctx.lineTo(x + s * 0.62, y + s * 0.55);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s * 0.62, y + s * 0.55);
      ctx.lineTo(x - s * 0.78, y - s * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case FACE.HEART:
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.8);
      ctx.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.42, y - s * 1.1, x, y - s * 0.34);
      ctx.bezierCurveTo(x + s * 0.42, y - s * 1.1, x + s * 1.4, y - s * 0.2, x, y + s * 0.8);
      ctx.fill();
      break;
    case FACE.BOLT:
      ctx.beginPath();
      ctx.moveTo(x + s * 0.34, y - s);
      ctx.lineTo(x - s * 0.42, y + s * 0.1);
      ctx.lineTo(x + s * 0.04, y + s * 0.1);
      ctx.lineTo(x - s * 0.28, y + s);
      ctx.lineTo(x + s * 0.5, y - s * 0.14);
      ctx.lineTo(x + s * 0.02, y - s * 0.14);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(x, y, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function drawTable() {
  if (run.pendingUpgrades) return;
  const y = dieY();

  for (let i = 0; i < run.shown.length; i++) {
    const x = dieX(i);
    const on = i === cursor;
    const marked = picked.has(i);

    ctx.fillStyle = ART.die.shadow;
    ctx.beginPath(); ctx.roundRect(x - DIE / 2 + 3, y - DIE / 2 + 5, DIE, DIE, 12); ctx.fill();

    ctx.fillStyle = marked ? ART.die.held : ART.die.body;
    ctx.beginPath(); ctx.roundRect(x - DIE / 2, y - DIE / 2, DIE, DIE, 12); ctx.fill();
    ctx.strokeStyle = on ? ART.die.pickEdge : marked ? ART.die.heldEdge : ART.die.bodyEdge;
    ctx.lineWidth = on ? 3.5 : 2;
    ctx.stroke();

    drawFace(run.shown[i], x, y, DIE * 0.24);

    // Marked dice say so in a second way, because colour alone is the one
    // channel a player can be short of.
    if (marked) {
      ctx.fillStyle = ART.die.heldEdge;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('↻', x + DIE / 2 - 13, y - DIE / 2 + 20);
    }

    // The cursor carries the nudge hint, because the nudge is the tool a new
    // player will not think to look for.
    if (on && run.charges >= TUNING.nudgeCost) {
      ctx.fillStyle = ART.face.bolt;
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▲', x, y - DIE / 2 - 8);
      ctx.fillText('▼', x, y + DIE / 2 + 20);
    }
  }
}

function drawEnemies() {
  const list = run.enemies;
  if (!list.length) return;
  const spread = Math.min(150, 640 / list.length);
  const startX = W / 2 - ((list.length - 1) * spread) / 2;

  list.forEach((e, i) => {
    const x = startX + i * spread;
    const y = 168 + Math.sin(time * 2 + i) * 4;
    const winding = e.wind === 0;

    ctx.fillStyle = ART.enemy.body;
    ctx.beginPath();
    ctx.ellipse(x, y, 32, 38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = winding ? ART.enemy.winding : ART.enemy.bodyEdge;
    ctx.lineWidth = winding ? 4 : 2;
    ctx.stroke();

    ctx.fillStyle = ART.enemy.eye;
    ctx.beginPath();
    ctx.arc(x - 10, y - 6, 4.5, 0, Math.PI * 2);
    ctx.arc(x + 10, y - 6, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Health.
    ctx.fillStyle = ART.enemy.hpTrack;
    ctx.beginPath(); ctx.roundRect(x - 34, y + 46, 68, 8, 4); ctx.fill();
    ctx.fillStyle = ART.enemy.hp;
    ctx.beginPath();
    ctx.roundRect(x - 34, y + 46, Math.max(3, 68 * clamp(e.hp / e.maxHp, 0, 1)), 8, 4);
    ctx.fill();

    // THE TELEGRAPH. What it will do and when, as a number and as a countdown,
    // because a shield you cannot plan is a shield you spend at random.
    ctx.textAlign = 'center';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillStyle = winding ? ART.enemy.winding : ART.hud.label;
    ctx.fillText(winding ? `${e.damage} NOW` : `${e.damage} in ${e.wind}`, x, y + 76);
  });
}

/**
 * The ledger: what the table is worth and what is about to land.
 *
 * This is the most important thing on the screen. The whole game is deciding
 * whether the roll in front of you answers the turn, and a player should be
 * able to see that without adding anything up.
 */
function drawLedger() {
  if (run.pendingUpgrades) return;
  const table = run.table;
  const incoming = run.incoming;
  const net = Math.max(0, incoming - table.block);
  const survive = run.hp + table.heal - net;

  const y = 268;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const parts = [
    [`${table.damage} damage`, ART.face.sword],
    [`${table.block} block`, ART.face.shield],
    [`${table.heal} heal`, ART.face.heart],
  ];
  let x = W / 2 - 150;
  ctx.font = '700 14px system-ui, sans-serif';
  for (const [text, colour] of parts) {
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
    x += 150;
  }

  // And the one line that matters: does this turn kill you.
  ctx.font = '800 16px system-ui, sans-serif';
  ctx.fillStyle = survive <= 0 ? ART.hud.bad : net > 0 ? ART.hud.warn : ART.hud.good;
  ctx.fillText(
    survive <= 0 ? `THIS TURN KILLS YOU — ${net} through`
      : net > 0 ? `${net} gets through, leaving ${survive}`
        : incoming > 0 ? 'Nothing gets through' : 'Nothing incoming',
    W / 2, y + 26,
  );
  ctx.textBaseline = 'alphabetic';
}

function drawHud() {
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(16, 14, 218, 78, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('FLOOR', 30, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(run.floor), 30, 62);

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('CLEARED', 96, 36);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(run.floorsCleared), 96, 62);

  // Health.
  ctx.fillStyle = ART.hero.hpTrack;
  ctx.beginPath(); ctx.roundRect(168, 30, 52, 10, 5); ctx.fill();
  ctx.fillStyle = ART.hero.hp;
  ctx.beginPath();
  ctx.roundRect(168, 30, Math.max(3, 52 * clamp(run.hp / run.maxHp, 0, 1)), 10, 5);
  ctx.fill();
  ctx.fillStyle = ART.hud.value;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${run.hp}/${run.maxHp}`, 220, 60);

  // Charges, as pips — the resource every decision is paid for in, so it is
  // never a number you have to go and read.
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('CHARGES', W - 24, 30);
  for (let i = 0; i < TUNING.maxCharges; i++) {
    const on = i < run.charges;
    const px = W - 30 - i * 17;
    ctx.beginPath();
    ctx.arc(px, 48, 6, 0, Math.PI * 2);
    if (on) {
      ctx.fillStyle = ART.hero.charge;
      ctx.fill();
    } else {
      // An empty socket, drawn as an outline. Filled at low alpha they read as
      // lit from any distance, so a player with nothing looked like a player
      // with eight.
      ctx.strokeStyle = ART.hero.chargeSpent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(
    run.rerollsLeft > 0
      ? `${run.rerollsLeft} free reroll${run.rerollsLeft === 1 ? '' : 's'}`
      : 'rerolls cost a charge',
    W - 24, 74,
  );

  // What the dice are worth this run, because sharpening changes it.
  ctx.fillText(
    `sword ${run.rates.damagePerSword}  ·  shield ${run.rates.blockPerShield}`,
    W - 24, 92,
  );
}

function drawUpgrades() {
  if (!run.pendingUpgrades) return;
  ctx.fillStyle = 'rgba(10,7,12,.86)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(`Floor ${run.floor - 1} cleared`, W / 2, 150);
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText('Take one before you go down', W / 2, 178);

  run.pendingUpgrades.forEach((offer, i) => {
    const y = 226 + i * 60;
    const on = i === upgradeCursor;
    ctx.fillStyle = on ? ART.hud.selectedFill : ART.hud.panel;
    ctx.beginPath(); ctx.roundRect(W / 2 - 220, y, 440, 48, 10); ctx.fill();
    ctx.strokeStyle = on ? ART.hud.selected : ART.hud.panelEdge;
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();
    ctx.fillStyle = on ? ART.hud.selected : ART.hud.value;
    ctx.font = `${on ? '700' : '500'} 15px system-ui, sans-serif`;
    ctx.fillText(offer.label, W / 2, y + 30);
  });
}

function drawControls() {
  if (run.pendingUpgrades || !running) return;
  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillText(
    'Left/Right choose  ·  Up/Down bend a die  ·  Pick then Reroll  ·  Bank  ·  Go',
    W / 2, H - 22,
  );
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 6, randRange(-1, 1) * shake * 6);
  drawRoom();
  drawEnemies();
  drawLedger();
  drawTable();
  particles.draw(ctx);
  ctx.restore();

  drawHud();
  drawControls();
  drawUpgrades();

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2, 118);
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
  title: 'Dungeon Dice',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Choose a die', gamepad: 'Left/Right', keyboard: 'A and D, or arrows', touch: 'Drag the left side' },
    { action: 'Bend a die', gamepad: 'Up/Down', keyboard: 'W and S', touch: 'Nudge pad' },
    { action: 'Mark for reroll', gamepad: 'A', keyboard: 'Space', touch: 'Pick pad' },
    { action: 'Reroll the marked', gamepad: 'B', keyboard: 'Shift', touch: 'Reroll pad' },
    { action: 'Bank a die', gamepad: 'Left stick click', keyboard: 'Q', touch: 'Bank pad' },
    { action: 'End the turn', gamepad: 'Right stick click or RB', keyboard: 'E', touch: 'Go pad' },
    { action: 'Charges', gamepad: 'Bolts become charges, and charges keep', keyboard: 'Bolts become charges, and charges keep', touch: 'Bolts become charges, and charges keep' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Dungeon Dice',
  tagline: 'The roll is the question, not the answer.',
});
