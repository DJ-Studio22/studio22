// games/hangman/game.js
//
// Hangman — the word is guessable, not just knowable.
//
// THE RULE
// --------
// Six wrong guesses a word, three lost rounds a run. Words solved is the
// score, and the lexicon gets longer and stranger as you go. A hint costs one
// of your six — and from round five the category stops being printed, so the
// same button will buy back either a letter or the label, for the same price.
//
// WHY THE HARD PART IS THE ALPHABET
// ---------------------------------
// Hangman on a keyboard is trivial and on anything else is usually a fudge —
// a grid you drag a cursor across with a virtual stick, or worse, a declared
// "keyboard only". Neither is acceptable here, so the letter grid is the ONE
// input model and every device gets a real way to drive it:
//
//   keyboard   press the letter. Also arrows and Enter, for anyone who wants
//              to see the grid do the work.
//   gamepad    the grid is walked with the stick or the d-pad and confirmed
//              with A. Wrapping at the edges and skipping spent letters, so
//              the shortest route to any letter is short.
//   touch      put a finger on the letter. Engine support for this was added
//              for it — Input.tapped() reports a touch nothing else claimed,
//              and GameCanvas.screenToGame() puts it in the same coordinates
//              the grid is drawn in.
//
// All three resolve to one action, `run.guess(letter)`, so the difficulty
// measured in tests/ is true of every device rather than of whichever one was
// to hand — the lesson Endless Mini Golf's aim model earned.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring, the grid, and the gallows. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp, randRange } from '../../engine/util.js';

import { ALPHABET, HINT, Run, TUNING } from './gallows.js';

const GAME_ID = 'hangman';

const W = 940;
const H = 620;

// --- Art palette ---------------------------------------------------------
//
// Hangman's own colours, deliberately NOT from tokens.css. Chalk on a slate
// board: a cool dark ground, bone-white chalk, and exactly three signal
// colours — green for a letter that landed, red for one that did not, amber
// for anything that costs you something. Nothing else is allowed to be
// coloured, because on a screen that is mostly letters, colour IS the reading.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  board: { back: '#1a2026', slate: '#222a32', frame: '#3a4650', grain: 'rgba(226,232,238,.03)' },
  chalk: { line: '#e8eef2', faint: 'rgba(232,238,242,.30)', dust: 'rgba(232,238,242,.55)' },
  key: {
    // The four key states are the whole reading of this screen, and the
    // contrast check moved three of them. An untried key scored 42 against the
    // board it sits on — the grid read as flat — and untried against tried-and-
    // wrong was 110, which is the one pair a player checks on every single
    // guess. 159 and 186 now.
    idle: '#4e5e6d', idleEdge: '#6b7c8c', text: '#f2f6f9',
    cursor: '#ffc857', cursorGlow: 'rgba(255,200,87,.22)',
    hit: '#3f8f5c', hitText: '#dff5e6',
    miss: '#93242f', missText: '#f6cdd1',
    hinted: '#8a6a18', hintedText: '#ffe6a8',
  },
  word: { slot: 'rgba(232,238,242,.26)', letter: '#e8eef2', hinted: '#ffc857' },
  gallows: { wood: '#8a6a44', rope: '#c9b48a', body: '#e8eef2', danger: '#ff6b5a' },
  hud: {
    label: 'rgba(226,232,238,.58)',
    value: '#eef3f7',
    good: '#7fd6a6',
    warn: '#ffc857',
    bad: '#ff6b5a',
    panel: 'rgba(12,16,20,.86)',
    panelEdge: 'rgba(226,232,238,.14)',
  },
  spark: ['#ffc857', '#e8eef2', '#7fd6a6'],
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 200 });

Input.setTouchLayout([
  { name: 'b', xRatio: 0.09, yRatio: 0.90, radius: 46, label: 'Hint' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 300, duration: 0.03, type: 'square', volume: 0.06 } },
  hit: { beep: { freq: 620, duration: 0.10, type: 'triangle', volume: 0.15 } },
  miss: { beep: { freq: 150, duration: 0.14, type: 'sawtooth', volume: 0.16 } },
  hint: { beep: { freq: 480, duration: 0.14, type: 'sine', volume: 0.14 } },
  won: { beep: { freq: 720, duration: 0.30, type: 'triangle', volume: 0.20 } },
  lost: { beep: { freq: 120, duration: 0.40, type: 'sawtooth', volume: 0.20 } },
  denied: { beep: { freq: 130, duration: 0.06, type: 'square', volume: 0.09 } },
  over: { beep: { freq: 80, duration: 0.7, type: 'triangle', volume: 0.28 } },
});

// --- The grid ------------------------------------------------------------
//
// Seven across by four down: 28 cells for 26 letters, so the last row is two
// short rather than a ragged wrap. Laid out alphabetically because a player
// looking for Q looks near the end, and any cleverer order would make the
// keyboard and the grid disagree about where a letter lives.

const COLS = 7;
const ROWS = 4;
const KEY_W = 96;
const KEY_H = 52;
const KEY_GAP = 8;
const GRID_X = (W - (COLS * (KEY_W + KEY_GAP) - KEY_GAP)) / 2;
// 364, not 372: at 372 the bottom row finished at 604 against a frame whose
// inside edge is 602, so the last five letters were clipped by two pixels —
// the kind of thing that reads as a rendering fault rather than as a layout.
const GRID_Y = 364;

const keyRect = (i) => ({
  x: GRID_X + (i % COLS) * (KEY_W + KEY_GAP),
  y: GRID_Y + Math.floor(i / COLS) * (KEY_H + KEY_GAP),
  w: KEY_W,
  h: KEY_H,
});

/** Which key is under a game-space point, or -1. */
function keyAt(x, y) {
  for (let i = 0; i < ALPHABET.length; i++) {
    const r = keyRect(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

// --- State ---------------------------------------------------------------

let run = new Run();
let running = false;
let cursor = 0;
let time = 0;
let shake = 0;
let flash = null;
let navLatch = 0;
let holdBetweenRounds = 0;

function reset() {
  run = new Run();
  running = true;
  cursor = 0;
  time = 0;
  shake = 0;
  flash = null;
  holdBetweenRounds = 0;
  particles.clear();
}

function say(text, colour) { flash = { text, colour, life: 1.8 }; }

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(run.solved, {
    reachedRound: run.round,
    hintsUsed: run.hintsUsed,
    lastWord: run.lastRound ? run.lastRound.word : '—',
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  time += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.6);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  if (!running) return;

  // A finished round holds for a beat so the answer can be read, then any
  // input moves on. A word you lost that you never got to see is a word you
  // learn nothing from.
  if (run.roundOver) {
    holdBetweenRounds += dt;
    const pressed = Input.pressed('a') || Input.pressed('b') || Input.pressed('start')
      || Input.tapped() || anyLetterKey() !== null;
    if (holdBetweenRounds > 0.7 && pressed) {
      holdBetweenRounds = 0;
      if (!run.next()) finish();
    }
    return;
  }

  // --- Keyboard: press the letter ---
  const typed = anyLetterKey();
  if (typed !== null) {
    cursor = ALPHABET.indexOf(typed);
    submit(typed);
    return;
  }

  // --- Touch and mouse: put a finger on it ---
  const tap = Input.tapped();
  if (tap) {
    const point = screen.screenToGame(tap.x, tap.y);
    const hit = keyAt(point.x, point.y);
    if (hit >= 0) {
      cursor = hit;
      submit(ALPHABET[hit]);
      return;
    }
  }

  // --- Gamepad and arrows: walk the grid ---
  const pad = Input.get();
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  if ((dx || dy) && navLatch === 0) {
    moveCursor(dx, dy);
    audio.play('move');
  }
  navLatch = dx || dy;

  if (Input.pressed('a')) submit(ALPHABET[cursor]);
  if (Input.pressed('b')) askHint();
}

/**
 * Which letter key went down this frame, if any.
 *
 * Input has no "was this letter typed" call — it maps a fixed set of codes to
 * named buttons — so the twenty-six letters are checked against the raw held
 * set through a layout of their own. Registering them as buttons would be the
 * wrong shape: they are not actions, they are one action with an argument.
 */
let lastHeld = new Set();
function anyLetterKey() {
  const held = new Set();
  let pressed = null;
  for (const ch of ALPHABET) {
    const code = `Key${ch}`;
    if (Input.isKeyHeld(code)) {
      held.add(ch);
      if (!lastHeld.has(ch)) pressed = ch;
    }
  }
  lastHeld = held;
  return pressed;
}

/** Move the cursor, wrapping, and skipping letters already spent. */
function moveCursor(dx, dy) {
  let index = cursor;
  for (let step = 0; step < ALPHABET.length; step++) {
    if (dx) {
      const col = (index % COLS + dx + COLS) % COLS;
      index = Math.floor(index / COLS) * COLS + col;
    }
    if (dy) {
      const row = (Math.floor(index / COLS) + dy + ROWS) % ROWS;
      index = row * COLS + (index % COLS);
    }
    if (index >= ALPHABET.length) {
      // The last row is two short. Step past the gap rather than stopping in
      // it, so the grid never has a dead cell to get stuck on.
      index = dy > 0 ? index % COLS : ALPHABET.length - 1;
    }
    if (!run.guessed.has(ALPHABET[index])) break;
  }
  cursor = index;
}

function submit(letter) {
  const before = run.wrong;
  const result = run.guess(letter);
  if (result === null) { audio.play('denied'); return; }

  if (run.wrong > before) {
    audio.play('miss');
    shake = 0.6;
  } else if (result !== 'lost') {
    audio.play('hit');
    const r = keyRect(ALPHABET.indexOf(letter));
    particles.emit(r.x + r.w / 2, r.y + r.h / 2, {
      ...ParticlePresets.sparkle, count: 8, colors: ART.spark, speed: [30, 110],
    });
  }

  if (result === 'won') { audio.play('won'); say('Got it', ART.hud.good); }
  if (result === 'lost') { audio.play('lost'); shake = 1; say(run.word, ART.hud.bad); }
  if (!run.running) finish();
  if (run.guessed.has(ALPHABET[cursor])) moveCursor(1, 0);
}

function askHint() {
  // With the category still hidden, that is what the hint buys — it is the
  // bigger piece of information at that point, and a player who wants a letter
  // instead can just press again.
  const kind = run.categoryKnown ? HINT.LETTER : HINT.CATEGORY;
  const result = run.hint(kind);
  if (!result) {
    audio.play('denied');
    say(run.guessesLeft <= TUNING.hintCostsWrong ? 'Not enough guesses left' : 'Nothing to reveal',
      ART.hud.bad);
    return;
  }
  audio.play('hint');
  if (result.kind === HINT.CATEGORY) say(result.category, ART.hud.warn);
  else say(`${result.letter} — that cost you a guess`, ART.hud.warn);
  if (run.roundOver === 'won') { audio.play('won'); say('Got it', ART.hud.good); }
  if (!run.running) finish();
}

// --- Drawing -------------------------------------------------------------

function drawBoard() {
  ctx.fillStyle = ART.board.back;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ART.board.slate;
  ctx.fillRect(18, 18, W - 36, H - 36);
  ctx.strokeStyle = ART.board.frame;
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, W - 36, H - 36);
}

/**
 * The gallows, drawn a stroke at a time.
 *
 * Six wrong guesses, six strokes, and the last one is red — so "how much
 * trouble am I in" is answerable from across the room without counting
 * anything.
 */
function drawGallows() {
  const x = 96;
  const y = 96;
  const wrong = Math.min(run.wrong, TUNING.wrongAllowed);
  const last = wrong === TUNING.wrongAllowed;

  ctx.strokeStyle = ART.gallows.wood;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 40, y + 190); ctx.lineTo(x + 60, y + 190);   // base
  ctx.moveTo(x + 10, y + 190); ctx.lineTo(x + 10, y);          // post
  ctx.lineTo(x + 100, y);                                      // arm
  ctx.stroke();
  ctx.strokeStyle = ART.gallows.rope;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 100, y); ctx.lineTo(x + 100, y + 30);
  ctx.stroke();

  const parts = [
    () => { ctx.beginPath(); ctx.arc(x + 100, y + 48, 18, 0, Math.PI * 2); ctx.stroke(); },
    () => { ctx.beginPath(); ctx.moveTo(x + 100, y + 66); ctx.lineTo(x + 100, y + 124); ctx.stroke(); },
    () => { ctx.beginPath(); ctx.moveTo(x + 100, y + 80); ctx.lineTo(x + 72, y + 106); ctx.stroke(); },
    () => { ctx.beginPath(); ctx.moveTo(x + 100, y + 80); ctx.lineTo(x + 128, y + 106); ctx.stroke(); },
    () => { ctx.beginPath(); ctx.moveTo(x + 100, y + 124); ctx.lineTo(x + 76, y + 166); ctx.stroke(); },
    () => { ctx.beginPath(); ctx.moveTo(x + 100, y + 124); ctx.lineTo(x + 124, y + 166); ctx.stroke(); },
  ];
  ctx.lineWidth = 5;
  for (let i = 0; i < wrong; i++) {
    ctx.strokeStyle = (last && i === wrong - 1) ? ART.gallows.danger : ART.gallows.body;
    parts[i]();
  }
  ctx.lineCap = 'butt';
}

function drawWord() {
  const pattern = run.pattern;
  const wide = Math.min(56, (W - 420) / Math.max(1, pattern.length));
  const startX = W / 2 + 100 - (pattern.length * wide) / 2;
  const y = 250;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let i = 0; i < pattern.length; i++) {
    const x = startX + i * wide + wide / 2;
    ctx.strokeStyle = ART.word.slot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - wide * 0.36, y + 10);
    ctx.lineTo(x + wide * 0.36, y + 10);
    ctx.stroke();
    if (pattern[i] !== null) {
      const hinted = run.revealedByHint.has(pattern[i]);
      ctx.fillStyle = hinted ? ART.word.hinted : ART.word.letter;
      ctx.font = `800 ${Math.round(wide * 0.78)}px system-ui, sans-serif`;
      ctx.fillText(pattern[i], x, y);
    }
  }

  // The category, or the fact that it is being withheld — because "you are
  // not being told this round" is itself information a player needs.
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillStyle = run.categoryKnown ? ART.hud.warn : ART.hud.label;
  ctx.fillText(
    run.categoryKnown ? run.category : 'Category hidden — the hint will buy it',
    W / 2 + 100, 196,
  );

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText(`${pattern.length} letters`, W / 2 + 100, 300);
}

function drawGrid() {
  for (let i = 0; i < ALPHABET.length; i++) {
    const ch = ALPHABET[i];
    const r = keyRect(i);
    const tried = run.guessed.has(ch);
    const inWord = tried && run.word.includes(ch);
    const hinted = run.revealedByHint.has(ch);
    const on = i === cursor && !run.roundOver;

    if (on) {
      ctx.fillStyle = ART.key.cursorGlow;
      ctx.beginPath();
      ctx.roundRect(r.x - 5, r.y - 5, r.w + 10, r.h + 10, 12);
      ctx.fill();
    }

    ctx.fillStyle = hinted ? ART.key.hinted : inWord ? ART.key.hit : tried ? ART.key.miss : ART.key.idle;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 9);
    ctx.fill();
    ctx.strokeStyle = on ? ART.key.cursor : ART.key.idleEdge;
    ctx.lineWidth = on ? 3.5 : 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hinted ? ART.key.hintedText : inWord ? ART.key.hitText
      : tried ? ART.key.missText : ART.key.text;
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText(ch, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }
}

function drawHud() {
  ctx.fillStyle = ART.hud.panel;
  ctx.beginPath(); ctx.roundRect(W - 268, 34, 234, 92, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('SOLVED', W - 250, 56);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(run.solved), W - 250, 82);

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillText('ROUND', W - 176, 56);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(String(run.round), W - 176, 82);

  // Lives as pips, guesses as a count — a life is a thing you have, a guess is
  // a thing you spend.
  for (let i = 0; i < TUNING.lives; i++) {
    ctx.fillStyle = i < run.lives ? ART.hud.good : 'rgba(226,232,238,.16)';
    ctx.beginPath();
    ctx.arc(W - 108 + i * 22, 62, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = run.guessesLeft <= 2 ? ART.hud.bad : ART.hud.label;
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText(`${run.guessesLeft} guesses left`, W - 250, 112);

  // The hint, and what it will cost — always priced, never a mystery button.
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.panel;
  // Under the gallows, NOT beside the grid. At (34, 470) this panel sat
  // squarely on top of the third row of letters and covered the O key — found
  // in the first screenshot, and invisible to every test in the project.
  ctx.beginPath(); ctx.roundRect(34, 296, 210, 62, 10); ctx.fill();
  ctx.strokeStyle = ART.hud.panelEdge;
  ctx.stroke();
  ctx.fillStyle = ART.hud.warn;
  ctx.font = '800 12px system-ui, sans-serif';
  ctx.fillText('SHIFT / B — HINT', 48, 320);
  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText(
    run.categoryKnown ? 'reveals a letter' : 'reveals the category',
    48, 338,
  );
  ctx.fillStyle = ART.hud.bad;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText(`costs ${TUNING.hintCostsWrong} guess`, 48, 354);
}

function drawRoundEnd() {
  if (!run.roundOver) return;
  const won = run.roundOver === 'won';
  ctx.fillStyle = 'rgba(10,14,18,.82)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = won ? ART.hud.good : ART.hud.bad;
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText(won ? 'Solved' : 'Hanged', W / 2, H / 2 - 40);

  ctx.fillStyle = ART.chalk.line;
  ctx.font = '800 46px system-ui, sans-serif';
  ctx.fillText(run.word, W / 2, H / 2 + 16);

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(run.category, W / 2, H / 2 + 46);
  ctx.fillText(
    holdBetweenRounds > 0.7 ? 'Any key for the next word' : ' ',
    W / 2, H / 2 + 82,
  );
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(randRange(-1, 1) * shake * 5, randRange(-1, 1) * shake * 5);
  drawBoard();
  drawGallows();
  drawWord();
  drawGrid();
  particles.draw(ctx);
  ctx.restore();

  drawHud();

  if (flash) {
    ctx.globalAlpha = clamp(flash.life, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = flash.colour;
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(flash.text, W / 2 + 100, 340);
    ctx.globalAlpha = 1;
  }

  drawRoundEnd();
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
  title: 'Hangman',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Guess a letter', gamepad: 'Move to it, then A', keyboard: 'Press the letter', touch: 'Tap the letter' },
    { action: 'Move the cursor', gamepad: 'Stick or D-pad', keyboard: 'Arrow keys', touch: 'Not needed — tap' },
    { action: 'Hint', gamepad: 'B', keyboard: 'Shift', touch: 'Hint pad' },
    { action: 'A hint costs', gamepad: 'One of your six guesses', keyboard: 'One of your six guesses', touch: 'One of your six guesses' },
    { action: 'From round 5', gamepad: 'The category is hidden', keyboard: 'The category is hidden', touch: 'The category is hidden' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Hangman',
  tagline: 'Every word can be reasoned out. That is the promise.',
});
