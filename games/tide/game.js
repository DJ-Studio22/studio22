// games/tide/game.js
//
// Tide — canvas, input, sound and the pad-passing chrome. The game itself is
// games/tide/grid.js and nothing in here knows the rule.
//
// TEACHING, WHICH IS MOST OF WHAT THIS FILE DOES
// ----------------------------------------------
// Tide has one rule and it is never printed as a rule. It is taught three ways,
// all of them on the board rather than on a screen somebody has to read:
//
//   1. THE PREVIEW. Move the cursor and the line it would fill lights up, with
//      the points flying to whoever would take them. You can see what your move
//      does to everybody's score while you are still deciding, so the rule can
//      be guessed rather than learned.
//   2. ONE SENTENCE, ONCE. On the very first turn of a game a single line sits
//      beside the cursor, where the player is already looking. After that first
//      stone it is gone for good and the strip at the bottom says only which
//      button does what.
//   3. THE WASH. A line fills, the number flies to a score bar, water sweeps
//      the line off the board. Somebody who walks in at round three watches one
//      turn and has seen the whole game.
//
// THE HOT POTATO IS DRAWN, NOT LEFT TO BE COUNTED
// -----------------------------------------------
// A line one stone from full, with somebody already holding most of it, is the
// thing the room talks about. It is marked on the board in that player's colour
// and pulses, so it reads from across a room instead of only to whoever is
// keeping track. See grid.js readyLines().

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem } from '../../engine/util.js';
import { NEUTRAL, Tide, linesOf } from './grid.js';

const GAME_ID = 'tide';
const W = 960;
const H = 540;
const TAU = Math.PI * 2;

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css: those are the
// site's chrome, and a game's artwork is its own thing.
//
// The six player colours are chosen to be told apart ACROSS A ROOM on a
// television, which is a harder problem than telling them apart on a monitor at
// arm's length. They are widely spaced in hue and they differ in lightness as
// well, so they survive a set with the contrast wound down — and every stone
// carries its player's number besides, because colour alone is not an identity
// a colour-blind player can read.
const ART = {
  seaTop: '#08202e',
  seaBottom: '#0d3347',
  boardEdge: 'rgba(255,255,255,.10)',
  cellEmpty: 'rgba(255,255,255,.05)',
  cellEmptyEdge: 'rgba(255,255,255,.09)',
  neutral: '#7d8c95',
  neutralEdge: '#5d6a72',
  cursor: '#ffffff',
  lineGlow: 'rgba(255,255,255,.16)',
  foam: 'rgba(190,240,255,.85)',
  wash: 'rgba(120,215,255,.35)',
  text: '#eaf6fb',
  textDim: 'rgba(234,246,251,.55)',
  teach: '#ffe08a',
  barTrack: 'rgba(255,255,255,.10)',
  players: ['#ffb02e', '#4fc3f7', '#7ed957', '#ff6b8a', '#c792ea', '#f2f0e6'],
  playerInk: ['#3a2400', '#04283a', '#0c2f10', '#3d0a19', '#2a1140', '#22262a'],
};

const PLAYER_NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 300 });

// A cursor and one button. The engine's B pad would sit there doing nothing.
Input.clearTouchLayout();
Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 420, duration: 0.03, type: 'sine', volume: 0.08 } },
  place: { beep: { freq: 560, duration: 0.06, type: 'triangle', volume: 0.14 } },
  wash: { beep: { freq: 300, duration: 0.35, type: 'sine', volume: 0.2 } },
  spoil: { beep: { freq: 190, duration: 0.22, type: 'sawtooth', volume: 0.13 } },
  pass: { beep: { freq: 680, duration: 0.09, type: 'sine', volume: 0.12 } },
});

// --- Game state ----------------------------------------------------------

let playerCount = 4;
let game = null;
let cursor = 0;
let navLatch = 0;
let time = 0;
let taughtFirstTurn = false;

/** Numbers flying from a washed line to a score bar. */
let flights = [];
/** Lines mid-wash, drawn as a sweep of water. */
let washing = [];

function reset() {
  game = new Tide({ players: playerCount });
  cursor = game.emptyCells()[0] ?? 0;
  flights = [];
  washing = [];
  taughtFirstTurn = false;
  particles.clear();
}

// --- Geometry ------------------------------------------------------------
//
// Everything the board needs to draw itself, recomputed rather than cached
// because the stage width changes with the viewport (see engine/canvas.js) and
// a cached layout would be a board that ignored half the screen.

// The strip under the board that the first-turn sentence lives in.
//
// Reserved in the LAYOUT rather than found at drawing time, and reserved
// whether or not the sentence is showing. The alternative was to place the box
// wherever there happened to be room, which on a short landscape phone put it
// straight over the bottom row of the board — a sentence explaining the game
// while covering the thing it is explaining. Costing the board forty units
// permanently is the cheaper mistake, and it keeps the board the same size on
// the first turn as on every other one.
const TEACH_STRIP = 42;

function layout() {
  const size = game.size;
  // The score column is measured from the stage rather than from W, so on a
  // wide phone the board takes the room it has instead of leaving a bar.
  const panelW = 250;
  const boardArea = Math.min(H - 96 - TEACH_STRIP, screen.stageWidth - panelW - 80);
  const cell = Math.floor(boardArea / size);
  const boardW = cell * size;
  const originX = screen.left + (screen.stageWidth - panelW - boardW) / 2;
  const originY = (H - TEACH_STRIP - boardW) / 2 + 8;
  return { size, cell, boardW, originX, originY, panelW };
}

function cellRect(index, L) {
  return {
    x: L.originX + (index % L.size) * L.cell,
    y: L.originY + Math.floor(index / L.size) * L.cell,
    s: L.cell,
  };
}

function cellAt(px, py, L) {
  const col = Math.floor((px - L.originX) / L.cell);
  const row = Math.floor((py - L.originY) / L.cell);
  if (col < 0 || row < 0 || col >= L.size || row >= L.size) return -1;
  return row * L.size + col;
}

// --- Update --------------------------------------------------------------

function moveCursor(dx, dy) {
  const size = game.size;
  let col = cursor % size;
  let row = Math.floor(cursor / size);
  // Walk past occupied squares rather than stopping on them: a cursor that
  // lands somewhere it cannot play is a cursor that has to be nudged twice.
  for (let step = 0; step < size; step++) {
    col = (col + dx + size) % size;
    row = (row + dy + size) % size;
    const next = row * size + col;
    if (game.cells[next] === null) { cursor = next; return true; }
    if (dx === 0 && dy === 0) break;
  }
  return false;
}

function playAt(index) {
  const result = game.place(index);
  audio.play('place');

  if (result.lines.length) {
    const L = layout();
    for (const lineIndex of result.lines) {
      washing.push({ line: lineIndex, life: 0.55, max: 0.55 });
    }
    if (result.total > 0) {
      audio.play('wash');
      result.payouts.forEach((points, player) => {
        if (points <= 0) return;
        const from = cellRect(index, L);
        flights.push({
          x: from.x + from.s / 2,
          y: from.y + from.s / 2,
          player,
          points,
          life: 0,
        });
      });
    } else {
      // A line that fills level pays nobody, and that deserves its own noise —
      // it is a move somebody made on purpose.
      audio.play('spoil');
    }
    for (const cell of result.cleared) {
      const r = cellRect(cell, L);
      particles.emit(r.x + r.s / 2, r.y + r.s / 2, {
        count: 5,
        colors: [ART.foam],
        speed: [40, 140],
        life: [0.25, 0.5],
        size: [2.4, 2.4],
        gravity: 60,
        drag: 0.9,
        shape: 'circle',
        shrink: true,
      });
    }
  }

  taughtFirstTurn = true;

  if (game.isOver) {
    finish();
    return;
  }
  audio.play('pass');
  if (game.cells[cursor] !== null) cursor = game.emptyCells()[0] ?? cursor;
}

function finish() {
  const rows = game.standings();
  const winner = rows[0];
  const shared = rows.filter((r) => r.place === 1).length > 1;
  // The score handed to the shell is the winning score, because a hot-seat game
  // has no single "your" score — the interesting number is what it took to win.
  shell.showGameOver(winner.score, {
    winner: shared ? 'Shared' : `Player ${PLAYER_NAMES[winner.player]}`,
    players: game.players,
    linesWashed: game.washes,
  });
}

function update(dt) {
  time += dt;
  particles.update(dt);
  for (const w of washing) w.life -= dt;
  washing = washing.filter((w) => w.life > 0);
  for (const f of flights) f.life += dt;
  flights = flights.filter((f) => f.life < 0.9);

  if (!shell.update()) return;
  if (game.isOver) return;

  const L = layout();

  // Touch: the first tap moves the cursor, a second tap on the same square
  // plays it. A single tap that places would make a mis-tap a turn, and a turn
  // cannot be taken back.
  const tap = Input.tapped();
  if (tap) {
    const point = screen.screenToGame(tap.x, tap.y);
    const hit = cellAt(point.x, point.y, L);
    if (hit >= 0 && game.cells[hit] === null) {
      if (hit === cursor) { playAt(hit); return; }
      cursor = hit;
      audio.play('move');
      return;
    }
  }

  const pad = Input.get();
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  if ((dx || dy) && navLatch === 0) {
    if (moveCursor(dx, dy)) audio.play('move');
  }
  navLatch = dx || dy;

  if (Input.pressed('a') && game.cells[cursor] === null) playAt(cursor);
}

// --- Draw ----------------------------------------------------------------

const SEA = (() => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.seaTop);
  g.addColorStop(1, ART.seaBottom);
  return g;
})();

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawStone(r, owner, alpha = 1) {
  const pad = r.s * 0.14;
  const d = r.s - pad * 2;
  ctx.globalAlpha = alpha;
  if (owner === NEUTRAL) {
    ctx.fillStyle = ART.neutralEdge;
    ctx.beginPath();
    ctx.arc(r.x + r.s / 2, r.y + r.s / 2 + 2, d / 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ART.neutral;
    ctx.beginPath();
    ctx.arc(r.x + r.s / 2, r.y + r.s / 2, d / 2, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = ART.playerInk[owner];
    ctx.beginPath();
    ctx.arc(r.x + r.s / 2, r.y + r.s / 2 + 2, d / 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ART.players[owner];
    ctx.beginPath();
    ctx.arc(r.x + r.s / 2, r.y + r.s / 2, d / 2, 0, TAU);
    ctx.fill();
    // The number, because six colours across a room is not an identity.
    ctx.fillStyle = ART.playerInk[owner];
    ctx.font = `700 ${Math.round(d * 0.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(owner + 1), r.x + r.s / 2, r.y + r.s / 2 + 1);
  }
  ctx.globalAlpha = 1;
}

function drawBoard(L, preview) {
  const lines = linesOf(L.size);

  // The squares.
  for (let i = 0; i < game.cells.length; i++) {
    const r = cellRect(i, L);
    const inset = L.cell * 0.05;
    ctx.fillStyle = ART.cellEmpty;
    roundRect(r.x + inset, r.y + inset, r.s - inset * 2, r.s - inset * 2, L.cell * 0.16);
    ctx.fill();
    ctx.strokeStyle = ART.cellEmptyEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (game.cells[i] !== null) drawStone(r, game.cells[i]);
  }

  // THE HOT POTATO. A line one stone from full, already held by somebody, is
  // outlined in their colour and breathes. This is the thing the table argues
  // about, so it is the thing the board says loudest.
  const pulse = 0.55 + 0.45 * Math.sin(time * 3);
  for (const ready of game.readyLines()) {
    if (ready.leader < 0) continue;
    const cells = ready.cells;
    const first = cellRect(cells[0], L);
    const last = cellRect(cells[cells.length - 1], L);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.4 * pulse;
    ctx.strokeStyle = ART.players[ready.leader];
    ctx.lineWidth = 3;
    roundRect(first.x + 2, first.y + 2,
      last.x - first.x + last.s - 4, last.y - first.y + last.s - 4, L.cell * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  // The line the cursor would fill, and what it is worth.
  if (preview && preview.lines.length) {
    for (const lineIndex of preview.lines) {
      const cells = lines[lineIndex];
      const first = cellRect(cells[0], L);
      const last = cellRect(cells[cells.length - 1], L);
      ctx.fillStyle = ART.lineGlow;
      roundRect(first.x, first.y, last.x - first.x + last.s, last.y - first.y + last.s,
        L.cell * 0.2);
      ctx.fill();
    }
  }

  // Water sweeping a washed line away.
  for (const w of washing) {
    const cells = lines[w.line];
    const first = cellRect(cells[0], L);
    const last = cellRect(cells[cells.length - 1], L);
    const t = 1 - w.life / w.max;
    const x0 = first.x;
    const y0 = first.y;
    const fullW = last.x - first.x + last.s;
    const fullH = last.y - first.y + last.s;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = ART.wash;
    if (fullW > fullH) ctx.fillRect(x0, y0, fullW * t, fullH);
    else ctx.fillRect(x0, y0, fullW, fullH * t);
    ctx.restore();
  }

  // The cursor.
  const r = cellRect(cursor, L);
  ctx.save();
  ctx.strokeStyle = ART.cursor;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.65 + 0.35 * Math.sin(time * 5);
  roundRect(r.x + 3, r.y + 3, r.s - 6, r.s - 6, L.cell * 0.18);
  ctx.stroke();
  ctx.restore();
  // A ghost of the stone about to be played, so the cursor says whose it is.
  drawStone(r, game.currentPlayer, 0.32);
}

function drawPanel(L, preview) {
  const x = L.originX + L.boardW + 34;
  const w = L.panelW - 44;
  let y = L.originY - 6;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ART.textDim;
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(`ROUND ${Math.min(game.round + 1, game.turnsEach)} OF ${game.turnsEach}`, x, y);
  y += 26;

  const top = Math.max(1, ...game.scores);
  for (let p = 0; p < game.players; p++) {
    const active = p === game.currentPlayer;
    const rowH = 40;

    if (active) {
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      roundRect(x - 10, y - 4, w + 20, rowH, 8);
      ctx.fill();
    }

    // The disc, so the panel and the board name a player the same way.
    ctx.fillStyle = ART.players[p];
    ctx.beginPath();
    ctx.arc(x + 11, y + 13, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ART.playerInk[p];
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(p + 1), x + 11, y + 18);

    ctx.textAlign = 'left';
    ctx.fillStyle = active ? ART.text : ART.textDim;
    ctx.font = `${active ? 700 : 500} 16px system-ui, sans-serif`;
    ctx.fillText(`Player ${PLAYER_NAMES[p]}`, x + 30, y + 18);

    ctx.textAlign = 'right';
    ctx.fillStyle = ART.text;
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText(String(game.scores[p]), x + w, y + 18);

    // What the hovered square would pay this player, right next to the number
    // it would change. This is the teaching.
    if (preview && preview.payouts[p] > 0) {
      ctx.fillStyle = ART.players[p];
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText(`+${preview.payouts[p]}`, x + w - 26, y + 18 - 18);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = ART.barTrack;
    roundRect(x, y + 25, w, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = ART.players[p];
    roundRect(x, y + 25, Math.max(3, (w * game.scores[p]) / top), 5, 2.5);
    ctx.fill();

    y += rowH + 6;
  }
}

function drawTeaching(L, preview) {
  // ONE SENTENCE, ONCE, beside the cursor — where the player is already
  // looking. Gone for good after the first stone of the game.
  if (taughtFirstTurn) return;
  const text = 'Fill a row or column — whoever has most stones in it takes the line.';
  ctx.font = '600 17px system-ui, sans-serif';
  const width = ctx.measureText(text).width;
  // Under the board and centred on it, not beside the cursor. Beside the cursor
  // is where the eye is, but it also sits ON the board, and a sentence that
  // covers the stones it is describing teaches nothing. Directly below is close
  // enough to be read without looking away and clear of everything.
  const bx = Math.max(screen.left + 12,
    Math.min(L.originX + L.boardW / 2 - width / 2 - 14, screen.right - width - 40));
  const by = L.originY + L.boardW + 6;
  ctx.fillStyle = 'rgba(8,32,46,.92)';
  roundRect(bx, by, width + 28, 38, 10);
  ctx.fill();
  ctx.strokeStyle = ART.teach;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = ART.teach;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 14, by + 20);
  void preview;
}

function drawFlights(L) {
  for (const f of flights) {
    const t = Math.min(1, f.life / 0.7);
    const targetY = L.originY + 20 + f.player * 46 + 18;
    const targetX = L.originX + L.boardW + 34 + (L.panelW - 44);
    const x = f.x + (targetX - f.x) * t;
    const y = f.y + (targetY - f.y) * t;
    ctx.globalAlpha = 1 - t * 0.4;
    ctx.fillStyle = ART.players[f.player];
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${f.points}`, x, y);
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.fillStyle = SEA;
  // Across the STAGE, not across W: on a wide screen the canvas runs past both
  // edges and an unpainted margin is a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  const L = layout();
  const preview = game.cells[cursor] === null ? game.preview(cursor) : null;

  drawBoard(L, preview);
  drawPanel(L, preview);
  particles.draw(ctx);
  drawFlights(L);
  drawTeaching(L, preview);

  // The persistent strip: controls only, never the rule again.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ART.textDim;
  ctx.font = '600 14px system-ui, sans-serif';
  const hint = Input.getActiveDevice() === 'touch'
    ? 'Tap a square, tap again to play it'
    : 'Move · A to play';
  ctx.fillText(hint, screen.left + screen.stageWidth / 2, H - 14);

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
  title: 'Tide',
  canvas: screen,
  loop,
  audio,
  music: true,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'Arrows', touch: 'Tap a square' },
    { action: 'Play a stone', gamepad: 'A', keyboard: 'Space', touch: 'Tap it again' },
    { action: 'Pass the pad', gamepad: 'Automatic', keyboard: 'Automatic', touch: 'Automatic' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Tide',
  tagline: 'Fill a line. The biggest share takes it.',
  items: [
    {
      label: () => `Players: ${playerCount}`,
      run: () => {
        playerCount = playerCount >= MAX_PLAYERS ? MIN_PLAYERS : playerCount + 1;
        reset();
        audio.play('move');
      },
      nudge: (direction) => {
        playerCount = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, playerCount + direction));
        reset();
        audio.play('move');
      },
    },
  ],
});
