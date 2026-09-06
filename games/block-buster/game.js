// games/block-buster/game.js
//
// Block Buster — a falling-shape puzzle whose board falls apart properly.
//
// WHAT MAKES THIS ITS OWN GAME
// ----------------------------
// Three things, and they compound:
//
// 1. CASCADE GRAVITY. When rows clear, the surviving cells do not ride down as
//    intact rows. Every cell falls on its own until it lands on something,
//    which means a clear can drop three cells into a hole and complete another
//    row that was never full before. That is a CHAIN, and the multiplier for a
//    chain grows fast. The skill this creates is building overhangs on purpose:
//    a stack that looks reckless is a stack primed to collapse into itself.
//
// 2. CHARGED CELLS. Roughly one piece in five carries a single lit cell. Clear
//    a row containing one and the whole column it sits in goes with the row.
//    A charged cell dropped deep is a hole punched through the stack, which is
//    the most reliable way to start a chain.
//
// 3. THE BOARD EVOLVES. Clear the board completely and it is not just a large
//    bonus — the whole game restyles. New block art, new well, new palette.
//    A long run is visibly a journey through six of them rather than the same
//    picture getting faster.
//
// The shape set and the rotation rule live in pieces.js and are documented
// there; neither is borrowed.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, randInt, randRange } from '../../engine/util.js';
import { ORIENTATIONS, SHOVES, ShapeBag } from './pieces.js';
import {
  createGrid, makeCell, fullRows, chargedCells, removeCells,
  cascade, isEmpty, raiseGarbage,
} from './board.js';

const GAME_ID = 'block-buster';

// --- Board geometry ------------------------------------------------------
//
// The canvas is taller than the well on purpose. The band below the board is
// where the touch pads land on a phone, and a pad drawn on top of the stack
// would cover the exact cells a player is trying to read.
const COLS = 10;
const ROWS = 18;
const CELL = 30;
const W = 440;
const H = 800;
const BOARD_X = 24;
const BOARD_Y = 150;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const PANEL_X = BOARD_X + BOARD_W + 16;   // the NEXT / LINES column
const PANEL_W = W - PANEL_X - 20;

// --- Tuning --------------------------------------------------------------

// How long a piece rests on the stack before it locks. It resets when the
// piece is successfully moved or turned, but only RESET_LIMIT times, so a
// player cannot hold a piece in the air forever by wiggling it.
const LOCK_DELAY_BASE = 0.50;
const LOCK_DELAY_MIN = 0.18;
const LOCK_RESET_LIMIT = 12;

// Horizontal auto-repeat. The first step is immediate, then a pause, then a
// fast repeat — the standard shape for a held direction, tuned by feel.
const DAS_DELAY = 0.16;
const DAS_REPEAT = 0.045;

// Soft drop is a multiplier on the fall rate rather than a fixed speed, so it
// still feels like an accelerator at level 20 where the natural fall is
// already quick.
const SOFT_DROP_FACTOR = 14;

// Clear choreography. Long enough to read what happened, short enough that a
// four-step chain does not feel like a cutscene.
const FLASH_TIME = 0.20;
const SETTLE_TIME = 0.14;

// Cells dropped by a cascade are drawn above their real home and slide into
// it. Per second, so the slide is the same length on any display.
const DROP_SETTLE_PER_SECOND = 1e-6;

// A row is added to the difficulty every this many lines.
const LINES_PER_LEVEL = 8;

// The floor on the natural fall interval. Speed alone stops being the
// difficulty here — past this point the escalation is the rising floor below.
const FALL_MIN = 0.055;

// From this level onward, a row of junk rises from the bottom every so often.
// This is what makes the difficulty genuinely unbounded: fall speed has a
// floor, the floor coming up to meet you does not.
const GARBAGE_FROM_LEVEL = 8;

// Chance a piece carries a charged cell. Climbs with level, because the stack
// gets harder to keep flat and the tool that fixes it should get commoner.
const CHARGE_BASE = 0.18;
const CHARGE_PER_LEVEL = 0.012;
const CHARGE_MAX = 0.42;

// --- Scoring -------------------------------------------------------------
//
// Rows cleared in one step, then multiplied by where in the chain that step
// happened. Deliberately weighted so that two chained single rows beat one
// double: the chain is the game, so the chain is what pays.
const ROW_VALUE = [0, 100, 260, 480, 800, 1200];
const CHAIN_MULT = [1, 1, 1.6, 2.4, 3.4, 4.6, 6, 7.5];
const CHARGED_CELL_VALUE = 40;
const PERFECT_CLEAR_VALUE = 1500;
const SOFT_DROP_VALUE = 1;
const HARD_DROP_VALUE = 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, and deliberately NOT from tokens.css: those tokens
// are the arcade's chrome, and a game is artwork. The shell still draws its
// pause, game over and HUD in site tokens on top of all of this, which is the
// point — you always know you are in Studio 22 whichever world the board is
// currently wearing.
//
// Grouped by subject rather than flat, which is what CLAUDE.md asks for once
// one flat object would turn unwieldy. It would: six themes of eleven colours
// each is sixty-six names in one bag.
//
// `style` picks how a block is DRAWN, not just what colour it is. Changing
// only the hue on a perfect clear would read as a palette swap; changing the
// shape of the block reads as a different game, which is the intent.
const ART = {
  // Fixed regardless of theme: the frame the board sits in and the readouts
  // around it belong to the game, not to the current world.
  ui: {
    label: 'rgba(255,255,255,.55)',
    value: '#ffffff',
    panelFill: 'rgba(255,255,255,.05)',
    panelLine: 'rgba(255,255,255,.14)',
    chain: '#ffd166',
    charged: '#fff3b0',
    chargedCore: '#ffffff',
    bannerShadow: 'rgba(0,0,0,.55)',
  },

  themes: [
    {
      name: 'Circuit',
      style: 'chip',
      skyTop: '#04161c',
      skyBottom: '#072a30',
      well: '#02090c',
      wellEdge: '#1d5c63',
      grid: 'rgba(120,240,220,.07)',
      ghost: 'rgba(150,255,235,.20)',
      blocks: ['#31e0c0', '#2bb8e0', '#7ce06a', '#e0d24a', '#e06a9a', '#8a7ce0', '#48d0a0', '#d0e04a', '#4ac6e0'],
    },
    {
      name: 'Sunset',
      style: 'round',
      skyTop: '#2a0f2e',
      skyBottom: '#5c1f3a',
      well: '#180818',
      wellEdge: '#b04a6a',
      grid: 'rgba(255,190,220,.07)',
      ghost: 'rgba(255,200,180,.20)',
      blocks: ['#ff8a5c', '#ffc857', '#ff6b8a', '#c86bff', '#ffa8c0', '#ff5f5f', '#ffd89a', '#e07ad0', '#ffb347'],
    },
    {
      name: 'Frost',
      style: 'gem',
      skyTop: '#0b1a2e',
      skyBottom: '#16324f',
      well: '#050d18',
      wellEdge: '#5a90c0',
      grid: 'rgba(200,230,255,.08)',
      ghost: 'rgba(210,240,255,.22)',
      blocks: ['#9fdcff', '#c8eaff', '#6fb6e8', '#b6d8f0', '#7fe0e0', '#a8c8ff', '#e0f4ff', '#6ea8d8', '#d0e8ff'],
    },
    {
      name: 'Ember',
      style: 'molten',
      skyTop: '#1c0603',
      skyBottom: '#3d1006',
      well: '#100301',
      wellEdge: '#a03a14',
      grid: 'rgba(255,150,90,.07)',
      ghost: 'rgba(255,170,110,.22)',
      blocks: ['#ff6b1a', '#ffa02a', '#ff3d3d', '#ffd24a', '#e0501a', '#ff8552', '#c02a10', '#ffbf6a', '#ff4f1f'],
    },
    {
      name: 'Orchard',
      style: 'leaf',
      skyTop: '#0d1c0a',
      skyBottom: '#1e3a14',
      well: '#050d04',
      wellEdge: '#4a7a30',
      grid: 'rgba(180,255,150,.07)',
      ghost: 'rgba(200,255,170,.20)',
      blocks: ['#8ed94f', '#d9c14f', '#e07a4f', '#b0d94f', '#5fbf6a', '#d94f6a', '#f0e08a', '#7ac96f', '#c9d94f'],
    },
    {
      name: 'Vapour',
      style: 'neon',
      skyTop: '#150a2e',
      skyBottom: '#2c1152',
      well: '#0a0418',
      wellEdge: '#7a3ac0',
      grid: 'rgba(220,180,255,.08)',
      ghost: 'rgba(240,200,255,.22)',
      blocks: ['#ff5fd0', '#5fe0ff', '#c05fff', '#5fffc0', '#ff5f8a', '#8a5fff', '#ffd05f', '#5f9fff', '#ff9fd0'],
    },
  ],
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 320 });

// Two pads, named for what they do. The joystick is left on: left/right and
// soft drop all come off it, which is the same axis a keyboard and a d-pad
// already provide, so nothing needs a touch-only code path.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.90, radius: 48, label: 'Turn' },
  { name: 'b', xRatio: 0.72, yRatio: 0.93, radius: 42, label: 'Drop' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 320, duration: 0.025, type: 'square', volume: 0.07 } },
  turn: { beep: { freq: 480, duration: 0.035, type: 'square', volume: 0.09 } },
  lock: { beep: { freq: 200, duration: 0.05, type: 'triangle', volume: 0.13 } },
  drop: { beep: { freq: 150, duration: 0.07, type: 'sawtooth', volume: 0.15 } },
  clear: { beep: { freq: 660, duration: 0.13, type: 'square', volume: 0.18 } },
  chain: { beep: { freq: 880, duration: 0.16, type: 'square', volume: 0.2 } },
  charge: { beep: { freq: 1200, duration: 0.12, type: 'sawtooth', volume: 0.17 } },
  perfect: { beep: { freq: 520, duration: 0.5, type: 'triangle', volume: 0.26 } },
  garbage: { beep: { freq: 110, duration: 0.16, type: 'sawtooth', volume: 0.18 } },
  over: { beep: { freq: 90, duration: 0.5, type: 'triangle', volume: 0.25 } },
});

// --- State ---------------------------------------------------------------

const bag = new ShapeBag();

// board[row][col] is null, or a cell: { tint, charged, dy, flash }.
// `dy` is a VISUAL offset in cells, used while a cascaded cell slides home.
let board = [];

let piece = null;      // { shape, rot, col, row, chargedIndex }
let nextShape = null;
let nextCharged = false;

let score = 0;
let lines = 0;
let level = 1;
let bestChain = 0;
let perfects = 0;
let piecesPlaced = 0;

let phase = 'play';    // 'play' | 'flash' | 'settle' | 'over'
let phaseTimer = 0;
let chain = 0;
let flashRows = [];
let flashCells = [];   // extra cells taken by a charged column

let fallTimer = 0;
let lockTimer = 0;
let lockResets = 0;
let dasTimer = 0;
let dasDir = 0;
let sinceGarbage = 0;

let themeIndex = 0;
let banner = null;     // { text, sub, life }
let shakeTime = 0;

const theme = () => ART.themes[themeIndex];

// --- Board helpers -------------------------------------------------------

// The natural fall interval for the current level. Geometric decay to a floor
// — past the floor the difficulty comes from the rising garbage instead.
function fallInterval() {
  return Math.max(FALL_MIN, 0.85 * 0.855 ** (level - 1));
}

function lockDelay() {
  return Math.max(LOCK_DELAY_MIN, LOCK_DELAY_BASE - (level - 1) * 0.025);
}

function garbageInterval() {
  // Locks between rises. Shrinks with level and never stops shrinking, which
  // is where "no ceiling" actually lives.
  return Math.max(3, 16 - (level - GARBAGE_FROM_LEVEL) * 1.2);
}

// Absolute [col, row] of every cell of a piece in its current orientation.
function cellsOf(p) {
  const shape = ORIENTATIONS.get(p.shape.id)[p.rot];
  const out = [];
  for (let i = 0; i < shape.length; i++) {
    out.push([p.col + shape[i][0], p.row + shape[i][1], i]);
  }
  return out;
}

// True when every cell of the piece is inside the well and on empty ground.
// Rows above the top of the board are allowed, so a piece can spawn partly
// off-screen and still be legal.
function fits(p) {
  for (const [c, r] of cellsOf(p)) {
    if (c < 0 || c >= COLS || r >= ROWS) return false;
    if (r >= 0 && board[r][c]) return false;
  }
  return true;
}

function tryMove(dc, dr) {
  const moved = { ...piece, col: piece.col + dc, row: piece.row + dr };
  if (!fits(moved)) return false;
  piece = moved;
  return true;
}

/**
 * Rotate, then shove. See pieces.js for why this is not a kick table: the
 * same five candidates are tried for every piece in every orientation.
 */
function tryRotate() {
  const states = ORIENTATIONS.get(piece.shape.id);
  if (states.length === 1) return false;   // a square genuinely cannot turn

  const rot = (piece.rot + 1) % states.length;
  for (const [dc, dr] of SHOVES) {
    const candidate = { ...piece, rot, col: piece.col + dc, row: piece.row + dr };
    if (fits(candidate)) {
      piece = candidate;
      return true;
    }
  }
  return false;
}

function chargeChance() {
  return Math.min(CHARGE_MAX, CHARGE_BASE + (level - 1) * CHARGE_PER_LEVEL);
}

function spawn() {
  const shape = nextShape ?? bag.next();
  const charged = nextCharged;
  nextShape = bag.next();
  nextCharged = Math.random() < chargeChance();

  const cells = ORIENTATIONS.get(shape.id)[0];
  let width = 0;
  for (const [x] of cells) if (x + 1 > width) width = x + 1;

  piece = {
    shape,
    rot: 0,
    col: Math.floor((COLS - width) / 2),
    // Start just above the ceiling so a five-cell piece is not instantly
    // overlapping a tall stack it could have been steered around.
    row: -1,
    chargedIndex: charged ? randInt(0, cells.length - 1) : -1,
  };

  lockTimer = 0;
  lockResets = 0;
  fallTimer = 0;

  // Topped out: the fresh piece has nowhere legal to be.
  if (!fits(piece)) gameOver();
}

function lockPiece() {
  let landedAbove = false;

  for (const [c, r, i] of cellsOf(piece)) {
    if (r < 0) { landedAbove = true; continue; }
    board[r][c] = makeCell(piece.shape.tint, i === piece.chargedIndex);
  }

  audio.play('lock', { pitchVariance: 0.1 });
  piecesPlaced++;
  piece = null;

  // A piece that could only rest with cells above the ceiling is the classic
  // lose condition, and it is checked here rather than at spawn so the player
  // sees the piece that ended it sitting where they put it.
  if (landedAbove) { gameOver(); return; }

  chain = 0;
  if (!beginClears()) afterSettle();
}

/**
 * Marks any full rows for the flash, including the extra cells a charged cell
 * in one of those rows takes with it. Returns false when nothing is full.
 */
function beginClears() {
  flashRows = fullRows(board);
  if (flashRows.length === 0) return false;

  // A charged cell caught in a clearing row takes its whole column with it.
  flashCells = chargedCells(board, flashRows);

  for (const r of flashRows) for (let c = 0; c < COLS; c++) board[r][c].flash = 1;
  for (const [r, c] of flashCells) board[r][c].flash = 1;

  if (flashCells.length > 0) audio.play('charge');
  audio.play(chain > 0 ? 'chain' : 'clear', { pitch: 1 + chain * 0.12 });

  phase = 'flash';
  phaseTimer = FLASH_TIME;
  return true;
}

/**
 * Removes the flashed cells, then lets every survivor fall on its own.
 *
 * The per-cell fall is the whole mechanic: shifting intact rows down (what a
 * conventional game does here) can never create a new full row, so it can
 * never chain.
 */
function applyClears() {
  const cleared = flashRows.length;
  const extra = flashCells.length;

  removeCells(board, flashRows, flashCells, (r, c, cell) => {
    burst(c, r, cell.charged ? ART.ui.charged : theme().blocks[cell.tint]);
  });

  // See board.js: every survivor falls on its own, which is what lets a clear
  // complete a row nobody built. That is the chain.
  cascade(board);

  chain++;
  if (chain > bestChain) bestChain = chain;

  const rowScore = ROW_VALUE[Math.min(cleared, ROW_VALUE.length - 1)];
  const mult = CHAIN_MULT[Math.min(chain, CHAIN_MULT.length - 1)];
  score += Math.round((rowScore + extra * CHARGED_CELL_VALUE) * mult * (1 + (level - 1) * 0.1));

  lines += cleared;
  const newLevel = 1 + Math.floor(lines / LINES_PER_LEVEL);
  if (newLevel > level) {
    level = newLevel;
    showBanner(`LEVEL ${level}`, 'It gets faster from here');
  }

  if (chain >= 2) {
    showBanner(`CHAIN x${chain}`, `${Math.round(mult * 10) / 10}x score`);
    shakeTime = Math.max(shakeTime, 0.12 + chain * 0.03);
  }

  flashRows = [];
  flashCells = [];
  phase = 'settle';
  phaseTimer = SETTLE_TIME;
}

// Called once a cascade has finished settling and nothing more is full.
function afterSettle() {
  if (isEmpty(board) && piecesPlaced > 0) {
    perfects++;
    score += PERFECT_CLEAR_VALUE * level;
    themeIndex = (themeIndex + 1) % ART.themes.length;
    showBanner('BOARD CLEARED', `Welcome to ${theme().name}`, 2.6);
    audio.play('perfect');
    shakeTime = 0.4;
  }

  maybeRaiseGarbage();
  if (phase !== 'over') { phase = 'play'; spawn(); }
}

/**
 * The rising floor. From GARBAGE_FROM_LEVEL onward, a part-filled row is
 * pushed in underneath everything every so often — and the interval keeps
 * shrinking with level, so there is no speed at which the player is finally
 * on top of it.
 */
function maybeRaiseGarbage() {
  if (level < GARBAGE_FROM_LEVEL) { sinceGarbage = 0; return; }

  sinceGarbage++;
  if (sinceGarbage < garbageInterval()) return;
  sinceGarbage = 0;

  // Junk uses the theme's last tint so it reads as scenery rather than as a
  // piece somebody placed. raiseGarbage refuses, and the run ends, when the
  // stack has been pushed out of the top of the well.
  const room = raiseGarbage(board, theme().blocks.length - 1, randInt(0, COLS - 1));
  if (!room) { gameOver(); return; }

  audio.play('garbage');
  shakeTime = Math.max(shakeTime, 0.18);
  showBanner('THE FLOOR RISES', 'Clear a line to buy room');
}

// How far the piece would fall if dropped right now, in cells.
function dropDistance() {
  let d = 0;
  while (fits({ ...piece, row: piece.row + d + 1 })) d++;
  return d;
}

function burst(col, row, color) {
  particles.emit(
    BOARD_X + col * CELL + CELL / 2,
    BOARD_Y + row * CELL + CELL / 2,
    {
      count: 5,
      colors: [color],
      speed: [40, 190],
      life: [0.25, 0.6],
      size: [2, 5],
      gravity: 320,
      drag: 0.5,
      shape: 'square',
      shrink: true,
    },
  );
}

function showBanner(text, sub = '', life = 1.5) {
  banner = { text, sub, life, max: life };
}

function gameOver() {
  if (phase === 'over') return;
  phase = 'over';
  piece = null;
  audio.play('over');
  shell.showGameOver(score, {
    lines,
    level,
    bestChain,
    boardsCleared: perfects,
    pieces: piecesPlaced,
  });
}

function reset() {
  board = createGrid(COLS, ROWS);
  bag.reset();
  particles.clear();

  score = 0;
  lines = 0;
  level = 1;
  chain = 0;
  bestChain = 0;
  perfects = 0;
  piecesPlaced = 0;
  sinceGarbage = 0;
  themeIndex = 0;
  banner = null;
  shakeTime = 0;
  flashRows = [];
  flashCells = [];

  phase = 'play';
  phaseTimer = 0;
  dasTimer = 0;
  dasDir = 0;

  nextShape = bag.next();
  nextCharged = Math.random() < chargeChance();
  spawn();
}

// --- Update --------------------------------------------------------------

function handleSteering(dt) {
  const stick = Input.get(0);
  const dir = stick.x < -0.4 ? -1 : stick.x > 0.4 ? 1 : 0;

  if (dir !== dasDir) {
    // A fresh press moves once immediately, then waits out the long delay.
    dasDir = dir;
    dasTimer = DAS_DELAY;
    if (dir !== 0 && tryMove(dir, 0)) {
      audio.play('move', { pitchVariance: 0.15 });
      touchLock();
    }
  } else if (dir !== 0) {
    dasTimer -= dt;
    while (dasTimer <= 0) {
      dasTimer += DAS_REPEAT;
      if (!tryMove(dir, 0)) break;
      touchLock();
    }
  }
}

// Landing on the stack starts a countdown; moving or turning restarts it, but
// only so many times. Without the cap a player can hover a piece forever.
function touchLock() {
  if (lockTimer > 0 && lockResets < LOCK_RESET_LIMIT) {
    lockTimer = 0;
    lockResets++;
  }
}

function update(dt) {
  if (!shell.update()) return;

  if (banner) {
    banner.life -= dt;
    if (banner.life <= 0) banner = null;
  }
  if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);

  // Cells that a cascade moved slide into place. Visual only — the board
  // itself is already settled, so a clear check never races the animation.
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      if (cell.dy !== 0) {
        cell.dy *= DROP_SETTLE_PER_SECOND ** dt;
        if (Math.abs(cell.dy) < 0.01) cell.dy = 0;
      }
      if (cell.flash > 0) cell.flash = Math.max(0, cell.flash - dt / FLASH_TIME);
    }
  }

  particles.update(dt);

  if (phase === 'flash') {
    phaseTimer -= dt;
    if (phaseTimer <= 0) applyClears();
    return;
  }

  if (phase === 'settle') {
    phaseTimer -= dt;
    if (phaseTimer <= 0) {
      // Another full row may have appeared underneath the cascade. If so this
      // is the next link in the chain; if not the piece supply resumes.
      if (!beginClears()) afterSettle();
    }
    return;
  }

  if (phase !== 'play' || !piece) return;

  handleSteering(dt);

  if (Input.pressed('a')) {
    if (tryRotate()) {
      audio.play('turn', { pitchVariance: 0.1 });
      touchLock();
    }
  }

  // Hard drop. Also on `up`, which costs nothing on a keyboard or a pad and
  // is where a lot of players' hands already go.
  if (Input.pressed('b') || Input.pressed('up')) {
    const d = dropDistance();
    piece.row += d;
    score += d * HARD_DROP_VALUE;
    audio.play('drop');
    shakeTime = Math.max(shakeTime, 0.06);
    lockPiece();
    return;
  }

  const soft = Input.get(0).y > 0.45;
  const interval = soft ? fallInterval() / SOFT_DROP_FACTOR : fallInterval();

  fallTimer += dt;
  while (fallTimer >= interval) {
    fallTimer -= interval;
    if (tryMove(0, 1)) {
      if (soft) score += SOFT_DROP_VALUE;
      lockTimer = 0;
    } else {
      break;
    }
  }

  // Resting on the stack.
  if (!fits({ ...piece, row: piece.row + 1 })) {
    lockTimer += dt;
    if (lockTimer >= lockDelay()) lockPiece();
  } else {
    lockTimer = 0;
  }
}

// --- Draw ----------------------------------------------------------------

// Rebuilt whenever the theme changes rather than every frame. A gradient is
// cheap but not free, and this one is drawn over the whole canvas.
let skyGradient = null;
let skyForTheme = -1;

function sky() {
  if (skyForTheme !== themeIndex) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme().skyTop);
    g.addColorStop(1, theme().skyBottom);
    skyGradient = g;
    skyForTheme = themeIndex;
  }
  return skyGradient;
}

/**
 * One block, in the current theme's style.
 *
 * Every branch draws the same square footprint — only the treatment inside it
 * changes. That is what lets the board restyle mid-run without a single cell
 * moving or the stack becoming harder to read.
 */
function drawBlock(x, y, size, color, { charged = false, flash = 0, alpha = 1 } = {}) {
  const t = theme();
  const pad = 1.5;
  const s = size - pad * 2;
  const bx = x + pad;
  const by = y + pad;

  ctx.globalAlpha = alpha;

  switch (t.style) {
    case 'chip': {
      // Flat plate with a bright top edge and two contact pads.
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, s, s);
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.fillRect(bx, by, s, 3);
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.fillRect(bx, by + s - 3, s, 3);
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(bx + s * 0.22, by + s * 0.42, s * 0.56, 2);
      break;
    }
    case 'round': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx, by, s, s, s * 0.34);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.26)';
      ctx.beginPath();
      ctx.roundRect(bx + 3, by + 3, s - 6, s * 0.36, s * 0.2);
      ctx.fill();
      break;
    }
    case 'gem': {
      // Four facets meeting in the middle.
      const cx = bx + s / 2;
      const cy = by + s / 2;
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, s, s);
      ctx.fillStyle = 'rgba(255,255,255,.34)';
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + s, by); ctx.lineTo(cx, cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath();
      ctx.moveTo(bx, by + s); ctx.lineTo(bx + s, by + s); ctx.lineTo(cx, cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx, by + s); ctx.lineTo(cx, cy);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'molten': {
      // A dark crust with a hot core showing through.
      ctx.fillStyle = 'rgba(20,4,0,.9)';
      ctx.fillRect(bx, by, s, s);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx + 2, by + 2, s - 4, s - 4, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,.32)';
      ctx.beginPath();
      ctx.ellipse(bx + s / 2, by + s * 0.42, s * 0.26, s * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx, by, s, s, [s * 0.5, 4, s * 0.5, 4]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + 3, by + s - 3); ctx.lineTo(bx + s - 3, by + 3);
      ctx.stroke();
      break;
    }
    default: {
      // 'neon' — hollow with a lit outline.
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fillRect(bx, by, s, s);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx + 1.5, by + 1.5, s - 3, s - 3);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * 0.22;
      ctx.fillRect(bx, by, s, s);
      ctx.globalAlpha = alpha;
      break;
    }
  }

  // A charged cell reads the same in every theme, because it is a rule of the
  // game rather than a feature of the current world.
  if (charged) {
    ctx.fillStyle = ART.ui.charged;
    ctx.beginPath();
    ctx.arc(bx + s / 2, by + s / 2, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ART.ui.chargedCore;
    ctx.beginPath();
    ctx.arc(bx + s / 2, by + s / 2, s * 0.10, 0, Math.PI * 2);
    ctx.fill();
  }

  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.85 * flash})`;
    ctx.fillRect(bx - pad, by - pad, size, size);
  }

  ctx.globalAlpha = 1;
}

function drawWell() {
  const t = theme();

  ctx.fillStyle = t.well;
  ctx.beginPath();
  ctx.roundRect(BOARD_X - 4, BOARD_Y - 4, BOARD_W + 8, BOARD_H + 8, 8);
  ctx.fill();

  ctx.strokeStyle = t.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < COLS; c++) {
    ctx.moveTo(BOARD_X + c * CELL, BOARD_Y);
    ctx.lineTo(BOARD_X + c * CELL, BOARD_Y + BOARD_H);
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.moveTo(BOARD_X, BOARD_Y + r * CELL);
    ctx.lineTo(BOARD_X + BOARD_W, BOARD_Y + r * CELL);
  }
  ctx.stroke();

  ctx.strokeStyle = t.wellEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(BOARD_X - 4, BOARD_Y - 4, BOARD_W + 8, BOARD_H + 8, 8);
  ctx.stroke();
}

function drawPanel() {
  const t = theme();
  const x = PANEL_X;

  ctx.fillStyle = ART.ui.panelFill;
  ctx.beginPath();
  ctx.roundRect(x, BOARD_Y, PANEL_W, 96, 8);
  ctx.fill();
  ctx.strokeStyle = ART.ui.panelLine;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = ART.ui.label;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('NEXT', x + PANEL_W / 2, BOARD_Y + 8);

  if (nextShape) {
    const cells = ORIENTATIONS.get(nextShape.id)[0];
    let w = 0;
    let h = 0;
    for (const [cx, cy] of cells) {
      if (cx + 1 > w) w = cx + 1;
      if (cy + 1 > h) h = cy + 1;
    }
    const size = 17;
    const ox = x + PANEL_W / 2 - (w * size) / 2;
    const oy = BOARD_Y + 30 + (3 - h) * size / 2;
    for (const [cx, cy] of cells) {
      drawBlock(ox + cx * size, oy + cy * size, size, t.blocks[nextShape.tint]);
    }
    if (nextCharged) {
      ctx.fillStyle = ART.ui.charged;
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.fillText('CHARGED', x + PANEL_W / 2, BOARD_Y + 82);
    }
  }

  // Readouts under the preview. Score, best and level are the shell's job and
  // are drawn at the top left; these are the ones specific to this game.
  const rows = [
    ['LINES', String(lines)],
    ['CHAIN', bestChain > 0 ? `x${bestChain}` : '—'],
    ['WORLD', theme().name],
  ];
  let y = BOARD_Y + 112;
  for (const [label, value] of rows) {
    ctx.fillStyle = ART.ui.label;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(label, x + PANEL_W / 2, y);
    ctx.fillStyle = ART.ui.value;
    ctx.font = '700 15px ui-monospace, monospace';
    ctx.fillText(value, x + PANEL_W / 2, y + 13);
    y += 40;
  }
}

function drawBanner() {
  if (!banner) return;

  // Fades out over its last third rather than the whole life, so it is fully
  // legible for most of the time it is up.
  const fade = clamp(banner.life / (banner.max * 0.35), 0, 1);
  const y = BOARD_Y + BOARD_H + 26;

  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ART.ui.bannerShadow;
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(banner.text, W / 2 + 1, y + 1);
  ctx.fillStyle = ART.ui.chain;
  ctx.fillText(banner.text, W / 2, y);

  if (banner.sub) {
    ctx.fillStyle = ART.ui.label;
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText(banner.sub, W / 2, y + 22);
  }
  ctx.globalAlpha = 1;
}

// `alpha` is unused: the board is a grid, and everything on it moves in whole
// cells on a tick. There is nothing between two ticks to interpolate.
function render() {
  const t = theme();

  ctx.fillStyle = sky();
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (shakeTime > 0) {
    const m = shakeTime * 14;
    ctx.translate(randRange(-m, m), randRange(-m, m));
  }

  drawWell();

  // The settled stack.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      drawBlock(
        BOARD_X + c * CELL,
        BOARD_Y + (r - cell.dy) * CELL,
        CELL,
        t.blocks[cell.tint],
        { charged: cell.charged, flash: cell.flash },
      );
    }
  }

  if (piece && phase === 'play') {
    // The ghost: where the piece would land. Not an assist so much as the only
    // way to read a ten-wide well at speed on a phone.
    const d = dropDistance();
    for (const [c, r] of cellsOf(piece)) {
      const gr = r + d;
      if (gr < 0) continue;
      ctx.fillStyle = t.ghost;
      ctx.fillRect(BOARD_X + c * CELL + 2, BOARD_Y + gr * CELL + 2, CELL - 4, CELL - 4);
    }

    for (const [c, r, i] of cellsOf(piece)) {
      if (r < 0) continue;
      drawBlock(
        BOARD_X + c * CELL,
        BOARD_Y + r * CELL,
        CELL,
        t.blocks[piece.shape.tint],
        { charged: i === piece.chargedIndex },
      );
    }
  }

  particles.draw(ctx);
  ctx.restore();

  drawPanel();
  drawBanner();

  shell.drawHud({ score, best: Session.getBest(GAME_ID), level });
  shell.render();
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
  title: 'Block Buster',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'Left / Right or A / D', touch: 'Drag the left side' },
    { action: 'Soft drop', gamepad: 'Hold down', keyboard: 'Hold Down or S', touch: 'Drag down' },
    { action: 'Turn', gamepad: 'A', keyboard: 'Space', touch: 'Turn pad' },
    { action: 'Hard drop', gamepad: 'B or up', keyboard: 'Shift or Up', touch: 'Drop pad' },
    { action: 'Chains', gamepad: 'Cells fall alone after a clear', keyboard: 'Cells fall alone after a clear', touch: 'Cells fall alone after a clear' },
    { action: 'Charged cell', gamepad: 'Clears its whole column', keyboard: 'Clears its whole column', touch: 'Clears its whole column' },
    { action: 'Empty board', gamepad: 'Restyles the world', keyboard: 'Restyles the world', touch: 'Restyles the world' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Block Buster', tagline: 'Clear the board and the world changes.' });
