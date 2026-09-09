// games/keystroke/game.js
//
// Keystroke — a typing race. Words cross the page; type them before they
// reach the edge, and a runner moves up the track with every one you land.
//
// THE SANCTIONED KEYBOARD-ONLY EXCEPTION
// --------------------------------------
// CLAUDE.md requires every game to work on a gamepad, a keyboard and a
// touchscreen. This is the one game exempted, and games.json says so with
// inputRequirement: "keyboard". Typing speed cannot be taught on a thumb
// stick, and an on-screen keyboard on a phone is a different activity rather
// than the same game played differently.
//
// The exemption covers the TYPING and nothing else. Every menu, the setup
// screen, the keyboard-needed notice and the results screen are all fully
// navigable on a gamepad or by tapping, because a player who cannot type
// still has to be able to find that out, read it, and leave.
//
// WHY THE SHELL IS LIGHT
// ----------------------
// This is a page of text to read, so it is built like paper rather than like
// the arcade: warm off-white, dark ink. That would have made the shell's
// near-white HUD invisible, so it declares shellTheme: 'light' and the shell
// draws its chrome from the light token set instead. See tokens.css.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { UI } from '../../engine/ui.js';
import { clamp } from '../../engine/util.js';
import {
  MODES, MODE_LABEL, LEVELS, LEVEL_LABEL, SPEED,
  nextItem, prepareCustomText, wpm,
} from './words.js';

const GAME_ID = 'keystroke';

// Landscape: a line of text needs width, and this is the one game that can
// only be played at a real keyboard, which means a real screen.
const W = 960;
const H = 600;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's dark chrome, and this game is paper.
//
// Light on purpose. Reading is the whole activity, and dark text on warm
// off-white is what every other reading surface in the world settles on. It
// is only possible because the shell now has a light theme to match — before
// that, a game like this had to go dark or ship an unreadable HUD.
const ART = {
  paper: '#f4efe4',
  paperEdge: '#e7e0d0',
  rule: '#d9d2c2',
  ink: '#2a241c',
  inkSoft: '#6f6555',
  inkFaint: '#a79c88',

  pending: '#2a241c',      // not yet typed
  done: '#1f7a45',         // typed correctly
  slip: '#c0392b',         // the character you just got wrong
  activeCard: '#fffaf0',
  activeEdge: '#c9a227',

  track: '#e3dccb',
  trackLine: '#cfc6b2',
  racer: '#c2551a',
  racerTrail: 'rgba(194,85,26,.25)',
  ghost: 'rgba(90,80,70,.30)',

  good: '#2f9e5e',
  mid: '#d8a12a',
  bad: '#c0392b',
  keyFace: '#ffffff',
  keyEdge: '#cfc6b2',
  keyUntouched: '#efe9db',
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();

// This game is played at a keyboard, so the virtual stick and pads would sit
// on screen doing nothing. Menus are reachable by tapping the choices
// directly, which is handled by the pointer listener further down.
Input.clearTouchLayout();

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  key: { beep: { freq: 780, duration: 0.03, type: 'square', volume: 0.07 } },
  word: { beep: { freq: 980, duration: 0.09, type: 'triangle', volume: 0.16 } },
  slip: { beep: { freq: 190, duration: 0.09, type: 'sawtooth', volume: 0.13 } },
  miss: { beep: { freq: 130, duration: 0.28, type: 'sawtooth', volume: 0.2 } },
  done: { beep: { freq: 140, duration: 0.5, type: 'triangle', volume: 0.24 } },
});

// --- Tuning --------------------------------------------------------------

const LANE_TOP = 250;
const LANE_H = 88;
const LANES = 3;
const SPAWN_X = W + 40;
const DEAD_X = 40;           // a word that passes this is missed
const MAX_MISSES = 3;

const TRACK_Y = 176;
const TRACK_X0 = 90;
const TRACK_X1 = W - 60;
const TRACK_LENGTH = 2600;   // units of "distance" a full track represents
const DISTANCE_PER_CHAR = 9;

// A touchscreen with no keyboard attached cannot play this. Detected as a
// capability rather than from the last device used, because the notice has
// to be on screen before the player has touched anything.
const TOUCH_ONLY = ('ontouchstart' in window || navigator.maxTouchPoints > 0);

// --- State ---------------------------------------------------------------

let mode = 'setup';          // 'setup' | 'run' | 'results'
let setupRow = 0;

let chosenMode = MODES.COMMON;
let chosenLevel = 'beginner';
let customItems = [];
let customRaw = '';

let words = [];              // { text, typed, x, y, lane, slipAt }
let spawnTimer = 0;
let elapsed = 0;
let misses = 0;
let combo = 0;
let bestCombo = 0;
let distance = 0;
let charsTyped = 0;          // correct characters only, for WPM
let keystrokes = 0;          // every character attempt, for accuracy
let mistakes = 0;
let wordsDone = 0;

// Per-key accuracy, keyed by the character that SHOULD have been typed.
// A Map rather than an object so a key like "constructor" cannot collide
// with something on Object.prototype.
const keyStats = new Map();  // char -> { hit, miss }

// The ghost: a trace of the best run so far, sampled as (seconds, distance).
//
// Kept in memory rather than through engine/session.js on purpose. Session
// stores scores and a small stats object for display; a few hundred sampled
// points is neither, and stuffing it in there would put a trace on the game
// over screen. The cost is that the ghost lives as long as the page, so
// navigating to the arcade and back loses it — which is the honest scope of
// "race your own best run" for a game you play in one sitting.
let ghostTrace = [];
let ghostBestDistance = 0;
let currentTrace = [];
let sampleTimer = 0;

// --- Setup screen --------------------------------------------------------

const SETUP_ROWS = 3;   // mode, level, start
let latchX = 0;
let latchY = 0;

function setupLayout() {
  const modeIds = Object.values(MODES);
  const chipH = 54;
  const modeW = (W - 120 - (modeIds.length - 1) * 10) / modeIds.length;
  const levelW = (W - 120 - (LEVELS.length - 1) * 10) / LEVELS.length;

  return [
    {
      label: 'What do you want to type?',
      y: 236,
      chips: modeIds.map((id, i) => ({
        id, label: MODE_LABEL[id], on: chosenMode === id,
        x: 60 + i * (modeW + 10), y: 236, w: modeW, h: chipH,
      })),
    },
    {
      label: 'How fast?',
      y: 358,
      chips: LEVELS.map((id, i) => ({
        id, label: LEVEL_LABEL[id], on: chosenLevel === id,
        x: 60 + i * (levelW + 10), y: 358, w: levelW, h: chipH,
      })),
    },
    {
      label: '',
      y: 470,
      chips: [{
        id: 'start',
        label: chosenMode === MODES.CUSTOM && customItems.length === 0 ? 'Paste text first' : 'Start',
        on: true, x: W / 2 - 120, y: 470, w: 240, h: 64,
      }],
    },
  ];
}

function updateSetup() {
  const pad = Input.get();

  // Edge-triggered off the axes: engine/input.js has no directional buttons,
  // because a d-pad, a stick and the arrow keys all arrive as the same pair.
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  if (dy !== 0 && latchY === 0) setupRow = (setupRow + dy + SETUP_ROWS) % SETUP_ROWS;
  if (dx !== 0 && latchX === 0) nudge(dx);
  latchX = dx;
  latchY = dy;

  if (Input.pressed('a')) activateSetupRow();
}

function nudge(direction) {
  if (setupRow === 0) {
    const ids = Object.values(MODES);
    const at = ids.indexOf(chosenMode);
    chosenMode = ids[(at + direction + ids.length) % ids.length];
  } else if (setupRow === 1) {
    const at = LEVELS.indexOf(chosenLevel);
    chosenLevel = LEVELS[(at + direction + LEVELS.length) % LEVELS.length];
  }
}

function activateSetupRow() {
  if (setupRow < SETUP_ROWS - 1) { setupRow++; return; }
  if (chosenMode === MODES.CUSTOM && customItems.length === 0) { openCustomEditor(); return; }
  beginRun();
}

// --- Custom text editor --------------------------------------------------
//
// A real <textarea> over the canvas, because pasting is a browser affordance
// and no amount of canvas drawing gets you a working Ctrl+V. Built from
// tokens so it matches the rest of the site rather than the game's paper.

let editor = null;

function openCustomEditor() {
  if (editor) return;

  editor = document.createElement('div');
  editor.className = 'ks-editor';
  editor.innerHTML = `
    <div class="ks-editor__panel">
      <h2>Paste your own text</h2>
      <p>Anything you like. It is split into short lines to type.</p>
      <textarea class="ks-editor__text" rows="8" spellcheck="false"
                aria-label="Text to type"></textarea>
      <div class="ks-editor__actions">
        <button type="button" class="ks-editor__use">Use this text</button>
        <button type="button" class="ks-editor__cancel">Cancel</button>
      </div>
    </div>`;

  const text = editor.querySelector('.ks-editor__text');
  text.value = customRaw;

  editor.querySelector('.ks-editor__use').addEventListener('click', () => {
    customRaw = text.value;
    customItems = prepareCustomText(customRaw);
    closeCustomEditor();
    if (customItems.length) beginRun();
  });
  editor.querySelector('.ks-editor__cancel').addEventListener('click', closeCustomEditor);

  document.body.append(editor);
  text.focus();
}

function closeCustomEditor() {
  editor?.remove();
  editor = null;
}

// --- Run -----------------------------------------------------------------

function beginRun() {
  mode = 'run';
  words = [];
  spawnTimer = 0;
  elapsed = 0;
  misses = 0;
  combo = 0;
  bestCombo = 0;
  distance = 0;
  charsTyped = 0;
  keystrokes = 0;
  mistakes = 0;
  wordsDone = 0;
  keyStats.clear();
  currentTrace = [];
  sampleTimer = 0;
  spawnWord();
}

function speedNow() {
  const table = SPEED[chosenLevel];
  const base = chosenMode === MODES.SENTENCES ? table.sentence : table.base;
  return base + elapsed * table.ramp;
}

function spawnWord() {
  const text = nextItem(chosenMode, chosenLevel, customItems);
  // Lanes are cycled rather than random so two words never overlap on the
  // way in, which would make the front one unreadable.
  const lane = words.length ? (words[words.length - 1].lane + 1) % LANES : 0;
  words.push({
    text,
    typed: 0,
    x: SPAWN_X,
    lane,
    slipAt: -1,
    slipTimer: 0,
  });
}

// The word being typed is always the one nearest the edge: the player has no
// way to choose a target, so the game has to make the choice obvious and
// consistent.
function activeWord() {
  if (words.length === 0) return null;
  let best = words[0];
  for (const word of words) if (word.x < best.x) best = word;
  return best;
}

function noteKey(expected, hit) {
  const key = expected.toLowerCase();
  const entry = keyStats.get(key) ?? { hit: 0, miss: 0 };
  if (hit) entry.hit++; else entry.miss++;
  keyStats.set(key, entry);
}

/**
 * One typed character.
 *
 * Wrong characters do NOT advance the word. Auto-advancing past a mistake is
 * how you train someone to type fast and wrong; making them land the right
 * key is the entire pedagogy of the thing.
 */
function typeChar(ch) {
  const word = activeWord();
  if (!word) return;

  const expected = word.text[word.typed];
  if (expected === undefined) return;

  keystrokes++;

  if (ch === expected) {
    word.typed++;
    charsTyped++;
    noteKey(expected, true);
    audio.play('key');

    if (word.typed >= word.text.length) completeWord(word);
    return;
  }

  mistakes++;
  combo = 0;
  noteKey(expected, false);
  word.slipAt = word.typed;
  word.slipTimer = 0.35;
  audio.play('slip');
}

function completeWord(word) {
  wordsDone++;
  combo++;
  bestCombo = Math.max(bestCombo, combo);
  distance += word.text.length * DISTANCE_PER_CHAR;
  audio.play('word');

  words.splice(words.indexOf(word), 1);
  spawnWord();
}

function missWord(word) {
  misses++;
  combo = 0;
  audio.play('miss');
  words.splice(words.indexOf(word), 1);

  if (misses >= MAX_MISSES) { endRun(); return; }
  spawnWord();
}

function endRun() {
  audio.play('done');
  mode = 'results';

  if (distance > ghostBestDistance) {
    ghostBestDistance = distance;
    ghostTrace = currentTrace.slice();
  }
}

// The score is characters typed correctly, weighted by accuracy: raw speed
// alone would reward hammering the keyboard, and accuracy alone would reward
// typing one word perfectly and stopping.
function finalScore() {
  const accuracy = keystrokes ? charsTyped / keystrokes : 0;
  return Math.round(charsTyped * accuracy);
}

function openGameOver() {
  // Space reaches this twice: once through the raw keydown listener below,
  // and once as engine/input.js's 'a' button. Latching on the mode means the
  // shell's game over screen opens once rather than being reopened on top of
  // itself the same frame.
  if (mode !== 'results') return;
  mode = 'over';

  const accuracy = keystrokes ? Math.round((charsTyped / keystrokes) * 100) : 0;
  const worst = weakestKeys(3)
    .map(([key, rate]) => `${key === ' ' ? 'space' : key} ${Math.round(rate * 100)}%`)
    .join('  ');

  shell.showGameOver(finalScore(), {
    wordsTyped: wordsDone,
    wordsPerMinute: Math.round(wpm(charsTyped, elapsed)),
    accuracy: `${accuracy}%`,
    longestStreak: bestCombo,
    weakestKeys: worst || '—',
    mode: `${MODE_LABEL[chosenMode]} · ${LEVEL_LABEL[chosenLevel]}`,
  });
}

// Keys with enough attempts to be worth reporting, worst first. Below the
// floor a single mistake reads as 0%, which would put a key someone touched
// once at the top of their weaknesses.
function weakestKeys(count, minAttempts = 3) {
  return [...keyStats.entries()]
    .map(([key, { hit, miss }]) => [key, hit / (hit + miss), hit + miss])
    .filter(([, , attempts]) => attempts >= minAttempts)
    .sort((a, b) => a[1] - b[1])
    .slice(0, count);
}

function updateRun(dt) {
  elapsed += dt;

  // Sampled for the ghost. Ten a second is smooth enough to draw and small
  // enough that a long run stays a few hundred points.
  sampleTimer += dt;
  if (sampleTimer >= 0.1) {
    sampleTimer = 0;
    currentTrace.push([elapsed, distance]);
  }

  const speed = speedNow();
  for (const word of [...words]) {
    word.x -= speed * dt;
    if (word.slipTimer > 0) word.slipTimer = Math.max(0, word.slipTimer - dt);
    if (word.x < DEAD_X) missWord(word);
  }

  // Keep two on screen so there is always something to read ahead to, but
  // never so many that the lanes fill up.
  spawnTimer -= dt;
  if (words.length < 2 && spawnTimer <= 0) {
    spawnWord();
    spawnTimer = 0.6;
  }
}

// Where the ghost had got to at this point in the run.
function ghostDistanceAt(seconds) {
  if (ghostTrace.length === 0) return null;
  if (seconds >= ghostTrace[ghostTrace.length - 1][0]) {
    return ghostTrace[ghostTrace.length - 1][1];
  }
  for (let i = 1; i < ghostTrace.length; i++) {
    if (ghostTrace[i][0] >= seconds) {
      const [t0, d0] = ghostTrace[i - 1];
      const [t1, d1] = ghostTrace[i];
      const span = t1 - t0;
      const at = span > 0 ? (seconds - t0) / span : 0;
      return d0 + (d1 - d0) * at;
    }
  }
  return 0;
}

// --- Typing input --------------------------------------------------------
//
// The one place this suite listens for raw keys. engine/input.js exposes
// buttons and axes by design; text is not a button, and this game is
// entirely about which character arrived.

window.addEventListener('keydown', (event) => {
  if (editor) return;                       // the textarea owns the keyboard
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (mode === 'results') {
    // Any key moves on, except the modifiers people rest fingers on.
    if (event.key.length === 1 || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openGameOver();
    }
    return;
  }

  if (mode !== 'run' || shell.isOverlayOpen) return;

  if (event.key.length === 1) {
    event.preventDefault();
    typeChar(event.key);
  }
});

// --- Pointer input -------------------------------------------------------
//
// Menus have to work by tapping, because the keyboard-only exception covers
// the typing and nothing else. A player on a phone must be able to reach the
// notice telling them so, and get back out.

screen.canvas.addEventListener('pointerdown', (event) => {
  if (shell.isOverlayOpen || editor) return;
  const point = screen.screenToGame(event.clientX, event.clientY);

  if (mode === 'results') { openGameOver(); return; }
  if (mode !== 'setup') return;

  setupLayout().forEach((row, index) => {
    for (const chip of row.chips) {
      if (point.x < chip.x || point.x > chip.x + chip.w) continue;
      if (point.y < chip.y || point.y > chip.y + chip.h) continue;
      setupRow = index;
      if (chip.id === 'start') activateSetupRow();
      else if (index === 0) {
        chosenMode = chip.id;
        if (chosenMode === MODES.CUSTOM && customItems.length === 0) openCustomEditor();
      } else chosenLevel = chip.id;
    }
  });
});

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;
  if (editor) return;                       // paused behind the paste dialog

  if (mode === 'setup') { updateSetup(); return; }
  if (mode === 'results') {
    if (Input.pressed('a') || Input.pressed('start')) openGameOver();
    return;
  }
  updateRun(dt);
}

// --- Draw ----------------------------------------------------------------

function paper() {
  ctx.fillStyle = ART.paper;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  ctx.fillStyle = ART.paperEdge;
  ctx.fillRect(screen.left, H - 14, screen.stageWidth, 14);
}

function render() {
  paper();

  if (mode === 'setup') renderSetup();
  else if (mode === 'run') renderRun();
  else renderResults();

  shell.render();
}

// --- Setup ---------------------------------------------------------------

function renderSetup() {
  UI.text(ctx, 'KEYSTROKE', W / 2, 96, {
    size: 52, color: ART.ink, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });
  UI.text(ctx, 'Type the words before they reach the edge', W / 2, 138, {
    size: 19, color: ART.inkSoft, align: 'center', baseline: 'middle',
  });

  // The keyboard-only notice, on screen before anything starts rather than
  // discovered by a player tapping in and finding nothing happens.
  if (TOUCH_ONLY) {
    const y = 174;
    UI.roundRect(ctx, 60, y - 22, W - 120, 46, 10);
    ctx.fillStyle = '#fff3d6';
    ctx.fill();
    ctx.strokeStyle = ART.activeEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    UI.text(ctx, 'This one needs a real keyboard. Menus work by touch; the typing does not.',
      W / 2, y, {
        size: 16, color: ART.ink, align: 'center', baseline: 'middle',
      });
  }

  setupLayout().forEach((row, index) => {
    if (row.label) {
      UI.text(ctx, row.label, 60, row.y - 18, {
        size: 17, color: ART.inkSoft, baseline: 'middle',
      });
    }
    for (const chip of row.chips) drawChip(chip, setupRow === index);
  });

  if (chosenMode === MODES.CUSTOM) {
    UI.text(ctx,
      customItems.length
        ? `${customItems.length} lines ready — press again to retype them`
        : 'Choosing Custom Text opens a box to paste into',
      W / 2, 552, {
        size: 15, color: ART.inkSoft, align: 'center', baseline: 'middle',
      });
  }
}

function drawChip(chip, rowFocused) {
  UI.roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 10);
  ctx.fillStyle = chip.on ? ART.activeEdge : ART.activeCard;
  ctx.fill();
  ctx.strokeStyle = chip.on ? ART.activeEdge : ART.rule;
  ctx.lineWidth = 2;
  ctx.stroke();

  // The outline marks where the cursor is, so it goes on the chosen chip of
  // the focused row only — outlining a whole row reads as everything in it
  // being selected.
  if (rowFocused && chip.on) {
    ctx.strokeStyle = ART.ink;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  let size = chip.h > 60 ? 24 : 18;
  while (size > 10 && UI.measure(ctx, chip.label, { size, font: 'display', weight: '700' }) > chip.w - 16) {
    size -= 1;
  }
  UI.text(ctx, chip.label, chip.x + chip.w / 2, chip.y + chip.h / 2, {
    size, color: ART.ink, font: 'display', weight: '700',
    align: 'center', baseline: 'middle',
  });
}

// --- Run -----------------------------------------------------------------

function renderRun() {
  drawTrack();

  const active = activeWord();
  for (const word of words) drawWord(word, word === active);

  // The edge words die at, drawn so the deadline is a place rather than a
  // surprise.
  ctx.strokeStyle = ART.slip;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(DEAD_X, LANE_TOP - 20);
  ctx.lineTo(DEAD_X, LANE_TOP + LANES * LANE_H);
  ctx.stroke();
  ctx.globalAlpha = 1;

  drawLiveStats();

  shell.drawHud({
    score: finalScore(),
    best: Session.getBest(GAME_ID),
    lives: MAX_MISSES - misses,
  });
}

function drawTrack() {
  ctx.fillStyle = ART.track;
  ctx.fillRect(TRACK_X0, TRACK_Y - 16, TRACK_X1 - TRACK_X0, 32);
  ctx.strokeStyle = ART.trackLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(TRACK_X0, TRACK_Y - 16, TRACK_X1 - TRACK_X0, 32);

  const span = TRACK_X1 - TRACK_X0;
  const at = (d) => TRACK_X0 + clamp(d / TRACK_LENGTH, 0, 1) * (span - 26) + 13;

  // The ghost first, so the live racer is never hidden behind it.
  const ghostD = ghostDistanceAt(elapsed);
  if (ghostD !== null) {
    drawRunner(at(ghostD), TRACK_Y, ART.ghost, true);
    UI.text(ctx, 'best', at(ghostD), TRACK_Y - 26, {
      size: 12, color: ART.inkFaint, align: 'center', baseline: 'middle',
    });
  }

  ctx.fillStyle = ART.racerTrail;
  ctx.fillRect(TRACK_X0, TRACK_Y - 4, at(distance) - TRACK_X0, 8);
  drawRunner(at(distance), TRACK_Y, ART.racer, false);
}

// A runner rather than a dot: at a glance you should be able to tell which
// way the race is going without reading anything.
function drawRunner(x, y, color, isGhost) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -9, 5, 0, Math.PI * 2);      // head
  ctx.fill();
  ctx.fillRect(-2, -5, 4, 10);            // body
  ctx.save();
  // Legs mid-stride. The ghost's stride is frozen so the two read apart even
  // when they are neck and neck.
  const stride = isGhost ? 0.5 : Math.sin(elapsed * 9) * 0.9;
  ctx.translate(0, 5);
  ctx.rotate(stride * 0.4);
  ctx.fillRect(-1.5, 0, 3, 8);
  ctx.restore();
  ctx.save();
  ctx.translate(0, 5);
  ctx.rotate(-(isGhost ? 0.5 : Math.sin(elapsed * 9) * 0.9) * 0.4);
  ctx.fillRect(-1.5, 0, 3, 8);
  ctx.restore();
  ctx.restore();
}

function drawWord(word, isActive) {
  const y = LANE_TOP + word.lane * LANE_H + LANE_H / 2;
  const size = word.text.length > 16 ? 26 : 34;
  const width = UI.measure(ctx, word.text, { size, font: 'mono', weight: '700' });

  if (isActive) {
    UI.roundRect(ctx, word.x - 14, y - 30, width + 28, 60, 10);
    ctx.fillStyle = ART.activeCard;
    ctx.fill();
    ctx.strokeStyle = ART.activeEdge;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Drawn one character at a time so the typed prefix can be a different
  // colour from the rest. A single fillText could not show progress at all.
  let x = word.x;
  for (let i = 0; i < word.text.length; i++) {
    const ch = word.text[i];
    let color = ART.pending;
    if (i < word.typed) color = ART.done;
    else if (isActive && i === word.typed && word.slipTimer > 0) color = ART.slip;
    else if (!isActive) color = ART.inkFaint;

    UI.text(ctx, ch, x, y, {
      size, color, font: 'mono', weight: '700', baseline: 'middle',
    });
    x += UI.measure(ctx, ch, { size, font: 'mono', weight: '700' });
  }

  // A caret under the next character to press.
  if (isActive && word.typed < word.text.length) {
    let caretX = word.x;
    for (let i = 0; i < word.typed; i++) {
      caretX += UI.measure(ctx, word.text[i], { size, font: 'mono', weight: '700' });
    }
    const chW = UI.measure(ctx, word.text[word.typed], { size, font: 'mono', weight: '700' });
    ctx.fillStyle = word.slipTimer > 0 ? ART.slip : ART.activeEdge;
    ctx.fillRect(caretX, y + 20, chW, 4);
  }
}

function drawLiveStats() {
  const accuracy = keystrokes ? Math.round((charsTyped / keystrokes) * 100) : 100;
  const rate = Math.round(wpm(charsTyped, elapsed));

  const items = [
    ['WPM', String(rate)],
    ['ACCURACY', `${accuracy}%`],
    ['STREAK', combo > 0 ? `${combo}` : '—'],
  ];

  let x = 60;
  for (const [label, value] of items) {
    UI.text(ctx, label, x, H - 74, {
      size: 13, color: ART.inkSoft, font: 'display', baseline: 'middle',
    });
    UI.text(ctx, value, x, H - 46, {
      size: 30, color: ART.ink, font: 'mono', weight: '700', baseline: 'middle',
    });
    x += 190;
  }
}

// --- Results -------------------------------------------------------------
//
// The game draws this itself rather than handing everything to the shell,
// because the heat map is the reason to play this over a generic typing test
// and it does not fit on a stat line. The shell's own game over screen opens
// after it, and still does the scoring.

const KEY_ROWS = [
  [...'qwertyuiop'],
  [...'asdfghjkl;'],
  [...'zxcvbnm,.'],
];

function renderResults() {
  const accuracy = keystrokes ? Math.round((charsTyped / keystrokes) * 100) : 0;

  UI.text(ctx, 'RUN COMPLETE', W / 2, 56, {
    size: 34, color: ART.ink, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });

  const summary = [
    ['WPM', String(Math.round(wpm(charsTyped, elapsed)))],
    ['ACCURACY', `${accuracy}%`],
    ['WORDS', String(wordsDone)],
    ['STREAK', String(bestCombo)],
  ];
  const colW = W / summary.length;
  summary.forEach(([label, value], i) => {
    const x = colW * i + colW / 2;
    UI.text(ctx, label, x, 106, {
      size: 13, color: ART.inkSoft, font: 'display', align: 'center', baseline: 'middle',
    });
    UI.text(ctx, value, x, 140, {
      size: 40, color: ART.ink, font: 'mono', weight: '700', align: 'center', baseline: 'middle',
    });
  });

  UI.text(ctx, 'Which keys let you down', W / 2, 200, {
    size: 18, color: ART.inkSoft, align: 'center', baseline: 'middle',
  });

  drawHeatMap();

  const worst = weakestKeys(3);
  UI.text(ctx,
    worst.length
      ? `Weakest: ${worst.map(([k, r]) => `${k === ' ' ? 'space' : k} ${Math.round(r * 100)}%`).join('   ')}`
      : 'Not enough keystrokes to pick out a weak key.',
    W / 2, H - 74, {
      size: 18, color: ART.ink, font: 'display', weight: '700',
      align: 'center', baseline: 'middle',
    });

  UI.text(ctx, 'Press any key to continue', W / 2, H - 40, {
    size: 15, color: ART.inkSoft, align: 'center', baseline: 'middle',
  });
}

// Colour for an accuracy, green through amber to red. Keys never touched
// stay blank rather than being coloured as if they were perfect — an untried
// key is not a strength.
/**
 * The band a key falls into: null (never pressed), 'good', 'mid' or 'bad'.
 *
 * Returned as a NAME rather than a colour so the drawing can give each band a
 * second, non-colour signal. Green, amber and red are three shades of the
 * same thing to a red-green colour-blind player, and "which keys let you
 * down" is the entire point of this screen.
 */
function heatBand(entry) {
  if (!entry || entry.hit + entry.miss === 0) return null;
  const rate = entry.hit / (entry.hit + entry.miss);
  if (rate >= 0.95) return 'good';
  if (rate >= 0.8) return 'mid';
  return 'bad';
}

const BAND_COLOR = { good: ART.good, mid: ART.mid, bad: ART.bad };
// The non-colour signal: how heavy the key's outline is. A weak key is
// visibly ringed whether or not its fill reads as red.
const BAND_BORDER = { good: 2, mid: 4, bad: 6 };

function drawHeatMap() {
  const keyW = 56;
  const keyH = 46;
  const gap = 6;
  const top = 226;

  KEY_ROWS.forEach((row, rowIndex) => {
    const rowW = row.length * keyW + (row.length - 1) * gap;
    // Each row is offset like a real keyboard, so the shape is recognisable
    // as the thing under the player's hands.
    const x0 = (W - rowW) / 2 + rowIndex * 14 - 14;
    const y = top + rowIndex * (keyH + gap);

    row.forEach((ch, i) => {
      const x = x0 + i * (keyW + gap);
      const entry = keyStats.get(ch);
      const band = heatBand(entry);
      const color = band ? BAND_COLOR[band] : null;

      UI.roundRect(ctx, x, y, keyW, keyH, 7);
      ctx.fillStyle = color ?? ART.keyUntouched;
      ctx.fill();
      ctx.strokeStyle = band === 'good' ? ART.keyEdge : ART.ink;
      ctx.lineWidth = band ? BAND_BORDER[band] : 2;
      ctx.stroke();

      UI.text(ctx, ch.toUpperCase(), x + keyW / 2, y + keyH / 2 - 4, {
        size: 19, color: color ? ART.keyFace : ART.inkFaint,
        font: 'mono', weight: '700', align: 'center', baseline: 'middle',
      });

      // The attempt count under the letter, so a red key with three tries
      // reads differently from a red key with forty.
      if (entry) {
        UI.text(ctx, String(entry.hit + entry.miss), x + keyW / 2, y + keyH - 10, {
          size: 11, color: color ? 'rgba(255,255,255,.8)' : ART.inkFaint,
          font: 'mono', align: 'center', baseline: 'middle',
        });
      }
    });
  });

  // The space bar, which is the most-pressed key in any typing run and would
  // be a strange thing to leave off a heat map of one.
  const spaceEntry = keyStats.get(' ');
  const spaceBand = heatBand(spaceEntry);
  const spaceColor = spaceBand ? BAND_COLOR[spaceBand] : null;
  const spaceW = 320;
  const spaceY = top + 3 * (keyH + gap);
  UI.roundRect(ctx, (W - spaceW) / 2, spaceY, spaceW, keyH * 0.7, 7);
  ctx.fillStyle = spaceColor ?? ART.keyUntouched;
  ctx.fill();
  ctx.strokeStyle = spaceBand === 'good' || !spaceBand ? ART.keyEdge : ART.ink;
  ctx.lineWidth = spaceBand ? BAND_BORDER[spaceBand] : 2;
  ctx.stroke();
  UI.text(ctx, spaceEntry ? `space  ${spaceEntry.hit + spaceEntry.miss}` : 'space',
    W / 2, spaceY + keyH * 0.35, {
      size: 14, color: spaceColor ? ART.keyFace : ART.inkFaint,
      font: 'mono', align: 'center', baseline: 'middle',
    });
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
  title: 'Keystroke',
  canvas: screen,
  loop,
  audio,
  // Music: a typing race; the words are read, never heard.
  music: true,
  // Paper, not the arcade. Without this the shell's near-white HUD text
  // would be invisible on the background this game draws.
  shellTheme: 'light',
  onRestart: () => { mode = 'setup'; setupRow = 0; },
  controls: [
    { action: 'Type', keyboard: 'The letters themselves', gamepad: 'Not possible — this one needs a keyboard', touch: 'Not possible — this one needs a keyboard' },
    { action: 'Choose', keyboard: 'Arrows, then Space', gamepad: 'Left stick, then A', touch: 'Tap a choice' },
    { action: 'Pause', keyboard: 'Escape', gamepad: 'Start', touch: 'Top-right button' },
  ],
});

loop.start();

shell.showTitle({ name: 'Keystroke', tagline: 'Type it before it gets away.' });
