// games/ballast/game.js
//
// Ballast — stack the hold, keep her level.
//
// THE RULE
// --------
// Crates drop into a barge that is floating, not bolted down. Where you put
// the weight tilts the hull. Lean her far enough over and she starts shipping
// water; fill the bilge and the voyage is over. Pack a row solid and it
// battens down and slides out of the BOTTOM of the hold, and the tonnage you
// stowed is the score.
//
// WHY IT IS NOT JUST ANOTHER STACKER
// ----------------------------------
// Because a crate is a weight. A 26-tonne ingot is one cell and a quarter of
// a typical load; five cells of timber weigh less than it does. So "does it
// fit" and "should it go there" are different questions, which is the only
// thing that makes this game different from the two other stackers it is
// sitting next to in the arcade.
//
// That difference is a claim, and claims here get measured. The simulation is
// in hold.js with no DOM attached, and tests/ballast.hold.test.mjs plays it
// with two bots that share one stacking brain and differ only in whether they
// look at the list. TWO OF THE GAME'S RULES EXIST BECAUSE THAT TEST SAID SO —
// the crate weights are bimodal and a listing hull slides cargo, and without
// either of them the careful bot was WORSE than the careless one. The notes
// are on SHAPES and TUNING.slideAt.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, and the sea. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp } from '../../engine/util.js';

import { COLS, Hold, ROWS, TUNING, crateTonnes } from './hold.js';

const GAME_ID = 'ballast';

const W = 460;
const H = 780;

// The hold, drawn. Cell size and where the grid's top-left corner sits.
const CELL = 38;
const HOLD_W = COLS * CELL;   // 304
const HOLD_H = ROWS * CELL;   // 532
const HOLD_X = (W - HOLD_W) / 2;
const HOLD_Y = 140;

// She rolls about the middle of the hold. A pivot down at the waterline is
// more honest about how a hull floats and is unusable here: the top of a
// 532px hold is then 600px from the pivot, and even a modest angle swings it
// clean off the side of the canvas.
const PIVOT_X = W / 2;
const PIVOT_Y = HOLD_Y + HOLD_H / 2;

// The waterline, which stays level while the hull rolls.
const WATERLINE = HOLD_Y + HOLD_H + 34;

// The DRAWN roll is capped, and it is not the same number as the list.
//
// A hull rotated by the full 34 degrees she can physically reach does not fit
// on a 460px canvas however the pivot is placed — a tall box needs a lot of
// width to turn in. So the picture is scaled and clamped, and the
// INCLINOMETER carries the real figure to the degree. The gain is above 1 at
// small angles on purpose: five degrees is where crates start sliding, and
// the player has to be able to see five degrees.
const MAX_DRAWN_ROLL = 12;
const ROLL_GAIN = 0.9;
const drawnRoll = (list) => clamp(list * ROLL_GAIN, -MAX_DRAWN_ROLL, MAX_DRAWN_ROLL);

// --- Art palette ---------------------------------------------------------
//
// Ballast's own colours, deliberately NOT from tokens.css. This is a barge on
// dark water and the tokens are the arcade's chrome; the shell still draws
// pause, game over and the HUD in site tokens straight over the top, which is
// what keeps it recognisably Studio 22.
//
// Grouped by subject per CLAUDE.md. Matches the card in /thumbnails.js.
const ART = {
  sea: {
    top: '#123243',
    bottom: '#0a1d28',
    surface: '#1d4c62',
    foam: 'rgba(207,233,244,.30)',
    deep: '#071620',
  },
  hull: {
    side: '#2b5568',
    rim: '#a8d4e6',
    deck: '#cfe9f4',
    bilge: 'rgba(120,200,235,.30)',
    bilgeHigh: 'rgba(255,140,110,.42)',
    grid: 'rgba(168,212,230,.10)',
  },
  // Crates take their tone from how heavy they are per cell, so the player can
  // read the weight off the picture. The heaviest is the darkest and most
  // banded, which is also how a real dense crate looks.
  crate: {
    light: { face: '#e0aa62', edge: '#a9763a' },
    medium: { face: '#c98a4b', edge: '#8e5f31' },
    heavy: { face: '#b9743c', edge: '#7d4b25' },
    ingot: { face: '#8f6a3f', edge: '#57401f' },
    ghost: 'rgba(224,170,98,.55)',
    slide: 'rgba(255,150,120,.95)',
  },
  hud: {
    label: 'rgba(207,233,244,.60)',
    value: '#cfe9f4',
    tonnage: '#e0aa62',
    listSafe: '#7fd6a6',
    listWarn: '#ffc857',
    listBad: '#ff8a6b',
    meterBack: 'rgba(7,22,32,.66)',
  },
};

/** The crate palette for a per-cell tonnage. Reads the weight off the colour. */
function crateColours(tonnes) {
  if (tonnes >= 20) return ART.crate.ingot;
  if (tonnes >= 6) return ART.crate.heavy;
  if (tonnes >= 3) return ART.crate.medium;
  return ART.crate.light;
}

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 220 });

// Two action pads and nothing else — the virtual joystick stays, which is
// what carries left, right and the soft drop. Same arrangement as the other
// stacker in the arcade, so a player who knows one knows this one.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.90, radius: 48, label: 'Turn' },
  { name: 'b', xRatio: 0.72, yRatio: 0.93, radius: 42, label: 'Drop' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 220, duration: 0.04, type: 'square', volume: 0.08 } },
  turn: { beep: { freq: 380, duration: 0.05, type: 'square', volume: 0.1 } },
  drop: { beep: { freq: 150, duration: 0.09, type: 'triangle', volume: 0.16 } },
  slide: { beep: { freq: 190, duration: 0.14, type: 'sawtooth', volume: 0.14 } },
  stow: { beep: { freq: 640, duration: 0.16, type: 'triangle', volume: 0.2 } },
  alarm: { beep: { freq: 300, duration: 0.22, type: 'square', volume: 0.14 } },
  sink: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let hold = new Hold();
let running = false;

// Drawing only. The simulation is not allowed to care about any of these.
let drawnList = 0;
let alarmTimer = 0;
let stowFlash = 0;
let seaPhase = 0;

// Repeat for held left/right, so a hold-to-slide feels right on every device.
let repeatDir = 0;
let repeatTimer = 0;
const REPEAT_DELAY = 0.22;
const REPEAT_EVERY = 0.07;

function reset() {
  hold = new Hold();
  running = true;
  drawnList = 0;
  alarmTimer = 0;
  stowFlash = 0;
  repeatDir = 0;
  repeatTimer = 0;
  particles.clear();
}

function finish() {
  if (!running) return;
  running = false;
  audio.play('sink');
  shell.showGameOver(hold.tonnage, {
    rowsStowed: hold.rowsStowed,
    cratesLanded: hold.cratesLanded,
    water: `${Math.round(hold.water * 100)}%`,
    ending: hold.reason,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  seaPhase += dt;
  if (stowFlash > 0) stowFlash = Math.max(0, stowFlash - dt * 2.4);

  // The drawn hull eases towards the real list, so she rolls rather than
  // snapping. Presentation only — every rule reads hold.list directly.
  drawnList += (hold.list - drawnList) * clamp(dt * 5, 0, 1);

  if (!running) return;

  const pad = Input.get();

  // Left/right, with a repeat while held.
  const dir = (pad.x > 0.5 ? 1 : 0) - (pad.x < -0.5 ? 1 : 0);
  if (dir !== 0 && dir !== repeatDir) {
    if (hold.move(dir)) audio.play('move');
    repeatDir = dir;
    repeatTimer = REPEAT_DELAY;
  } else if (dir !== 0) {
    repeatTimer -= dt;
    if (repeatTimer <= 0) {
      repeatTimer = REPEAT_EVERY;
      if (hold.move(dir)) audio.play('move');
    }
  } else {
    repeatDir = 0;
  }

  // Same mapping as the other stacker in the arcade, deliberately: turn on A,
  // hard drop on B or up. A player who knows one should not have to relearn
  // their thumbs for the other.
  if (Input.pressed('a')) {
    if (hold.rotateCrate()) audio.play('turn');
  }

  const before = hold.rowsStowed;
  const wasSliding = hold.slideDirection() !== 0;

  if (Input.pressed('b') || Input.pressed('up')) {
    audio.play('drop');
    hold.slam();
    if (wasSliding) audio.play('slide');
  }

  // Soft drop: hold down and she falls faster, which is the only speed
  // control the player has.
  if (pad.y > 0.5) hold.step(dt * 6);
  else hold.step(dt);

  if (hold.rowsStowed > before) {
    stowFlash = 1;
    audio.play('stow');
    particles.sparkle(W / 2, HOLD_Y + HOLD_H - CELL / 2, {
      count: 16, colors: [ART.hull.deck, ART.crate.light.face],
    });
  }

  // The alarm, while she is shipping. Once a second, not every frame.
  if (hold.shipping) {
    alarmTimer -= dt;
    if (alarmTimer <= 0) {
      alarmTimer = 0.85;
      audio.play('alarm', { pitch: 1 + hold.water * 0.5 });
    }
  } else {
    alarmTimer = 0;
  }

  if (!hold.running) finish();
}

// --- Draw ----------------------------------------------------------------

function drawSea() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.sea.top);
  g.addColorStop(1, ART.sea.bottom);
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  // The waterline. It stays level while the hull rolls, which is what sells
  // the roll as the hull moving rather than the camera.
  const base = WATERLINE;
  ctx.fillStyle = ART.sea.surface;
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let x = 0; x <= W; x += 20) {
    ctx.lineTo(x, base + Math.sin(seaPhase * 1.6 + x * 0.03) * 4);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ART.sea.foam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 20) {
    const y = base + Math.sin(seaPhase * 1.6 + x * 0.03) * 4;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** One crate cell, with its lid and shadow, at grid coordinates. */
function drawCell(gx, gy, tonnes, alpha = 1) {
  const c = crateColours(tonnes);
  const x = HOLD_X + gx * CELL;
  const y = HOLD_Y + gy * CELL;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = c.face;
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  ctx.fillStyle = c.edge;
  ctx.fillRect(x + 1, y + CELL - 7, CELL - 2, 6);
  ctx.fillRect(x + 1, y + 1, CELL - 2, 3);
  // Banding, so the heavy crates read as dense rather than just dark.
  ctx.strokeStyle = c.edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + CELL / 2);
  ctx.lineTo(x + CELL - 6, y + CELL / 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawHold() {
  // The hull, rolling about her waterline.
  ctx.save();
  ctx.translate(PIVOT_X, PIVOT_Y);
  ctx.rotate((drawnRoll(drawnList) * Math.PI) / 180);
  ctx.translate(-PIVOT_X, -PIVOT_Y);

  // Hull sides and deck line.
  ctx.fillStyle = ART.hull.side;
  ctx.beginPath();
  ctx.moveTo(HOLD_X - 18, HOLD_Y - 10);
  ctx.lineTo(HOLD_X + HOLD_W + 18, HOLD_Y - 10);
  ctx.lineTo(HOLD_X + HOLD_W - 4, HOLD_Y + HOLD_H + 34);
  ctx.lineTo(HOLD_X + 4, HOLD_Y + HOLD_H + 34);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ART.hull.rim;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = ART.hull.deck;
  ctx.fillRect(HOLD_X - 18, HOLD_Y - 14, HOLD_W + 36, 5);

  // The hold's own grid, faint, so a column can be counted by eye.
  ctx.strokeStyle = ART.hull.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(HOLD_X + x * CELL, HOLD_Y);
    ctx.lineTo(HOLD_X + x * CELL, HOLD_Y + HOLD_H);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(HOLD_X, HOLD_Y + y * CELL);
    ctx.lineTo(HOLD_X + HOLD_W, HOLD_Y + y * CELL);
    ctx.stroke();
  }

  // The bilge, filling from the bottom of the hold.
  if (hold.water > 0.001) {
    const h = HOLD_H * clamp(hold.water, 0, 1);
    ctx.fillStyle = hold.water > 0.6 ? ART.hull.bilgeHigh : ART.hull.bilge;
    ctx.fillRect(HOLD_X, HOLD_Y + HOLD_H - h, HOLD_W, h);
  }

  // Stowed cargo.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (hold.grid[y][x] > 0) drawCell(x, y, hold.grid[y][x]);
    }
  }

  // The crate in the air, plus a ghost of where it would actually land —
  // including the slide, because a rule the player cannot see coming is a
  // surprise rather than a rule.
  const c = hold.crate;
  if (c) {
    const slide = hold.slideDirection();
    let gx = c.x;
    let gy = c.y;
    if (slide !== 0 && !hold.collides(gx + slide, gy, c.cells)) gx += slide;
    while (!hold.collides(gx, gy + 1, c.cells)) gy++;

    // Outlined, never filled. A filled ghost reads as cargo already stowed,
    // which is exactly the thing the player is trying to count.
    ctx.strokeStyle = slide !== 0 ? ART.crate.slide : ART.crate.ghost;
    ctx.lineWidth = 2;
    ctx.setLineDash(slide !== 0 ? [6, 4] : []);
    for (const [cx, cy] of c.cells) {
      const x = HOLD_X + (gx + cx) * CELL;
      const y = HOLD_Y + (gy + cy) * CELL;
      ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
    }
    ctx.setLineDash([]);

    // While she is over, the ghost has moved downhill from where the crate
    // is aimed. An arrow says which way, so the slide is a rule the player
    // can see rather than a surprise.
    if (slide !== 0) {
      const ax = HOLD_X + (gx + 0.5) * CELL + slide * 26;
      const ay = HOLD_Y + (gy - 0.4) * CELL;
      ctx.fillStyle = ART.crate.slide;
      ctx.beginPath();
      ctx.moveTo(ax + slide * 9, ay);
      ctx.lineTo(ax - slide * 4, ay - 7);
      ctx.lineTo(ax - slide * 4, ay + 7);
      ctx.closePath();
      ctx.fill();
    }
    for (const [cx, cy] of c.cells) {
      if (c.y + cy >= 0) drawCell(c.x + cx, c.y + cy, c.shape.tonnes);
    }
  }

  ctx.restore();
}

function drawHud() {
  // Tonnage — the score.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('TONNAGE STOWED', 18, 16);
  ctx.fillStyle = ART.hud.tonnage;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(String(hold.tonnage), 18, 28);

  // The next crate, with what it weighs. The weight is the decision, so it is
  // shown as a number and not only as a colour.
  const next = hold.next;
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  // Right-aligned against what the shell leaves free, not against the canvas
  // edge: on a phone there is a pause button in that corner. Zero on a desktop.
  const hudRight = screen.right - shell.rightInset();
  ctx.fillText('NEXT', hudRight - 18, 16);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillText(`${crateTonnes(next)} t`, hudRight - 18, 30);

  const c = crateColours(next.tonnes);
  for (const [cx, cy] of next.cells) {
    ctx.fillStyle = c.face;
    ctx.fillRect(W - 96 + cx * 13, 52 + cy * 13, 11, 11);
  }

  // The list, as an inclinometer. Number and needle both, so colour is never
  // the only thing carrying it.
  const list = hold.list;
  const over = Math.abs(list) > TUNING.shipAt;
  const warn = Math.abs(list) > TUNING.slideAt;
  const colour = over ? ART.hud.listBad : warn ? ART.hud.listWarn : ART.hud.listSafe;

  const cx = W / 2;
  const cy = 66;
  ctx.textAlign = 'center';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('LIST', cx, 16);

  ctx.strokeStyle = ART.hud.meterBack;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, Math.PI, Math.PI * 2);
  ctx.stroke();

  const angle = Math.PI + (clamp(list / TUNING.maxList, -1, 1) * 0.5 + 0.5) * Math.PI;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * 24, cy + Math.sin(angle) * 24);
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText(`${Math.abs(list).toFixed(0)}° ${list < -0.5 ? 'P' : list > 0.5 ? 'S' : '—'}`, cx, cy + 4);

  // The water, and what it is doing right now. The word is what matters:
  // "SHIPPING" is the only warning the player needs.
  const barW = 150;
  const barX = cx - barW / 2;
  const barY = H - 30;
  ctx.fillStyle = ART.hud.meterBack;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, 9, 4);
  ctx.fill();
  ctx.fillStyle = hold.water > 0.6 ? ART.hud.listBad : ART.hull.bilge;
  ctx.beginPath();
  ctx.roundRect(barX, barY, Math.max(3, barW * clamp(hold.water, 0, 1)), 9, 4);
  ctx.fill();

  ctx.fillStyle = hold.shipping ? ART.hud.listBad : ART.hud.label;
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(hold.shipping ? 'SHIPPING WATER' : 'BILGE', cx, barY - 4);
}

function render() {
  drawSea();
  drawHold();
  particles.draw(ctx);

  if (stowFlash > 0) {
    ctx.globalAlpha = stowFlash * 0.22;
    ctx.fillStyle = ART.hull.deck;
    ctx.fillRect(screen.left, 0, screen.stageWidth, H);
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
  title: 'Ballast',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'Left / Right or A / D', touch: 'Drag the left side' },
    { action: 'Turn', gamepad: 'A', keyboard: 'Space', touch: 'Turn pad' },
    { action: 'Drop', gamepad: 'B or up', keyboard: 'Shift or Up', touch: 'Drop pad' },
    { action: 'Soft drop', gamepad: 'Hold down', keyboard: 'Hold Down or S', touch: 'Drag down' },
    { action: 'Listing', gamepad: 'Crates slide downhill', keyboard: 'Crates slide downhill', touch: 'Crates slide downhill' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Ballast', tagline: 'Stack the hold. Keep her level.' });
