// games/impostor-circle/game.js
//
// Impostor Circle — canvas, input, sound and the pad-passing chrome. The game
// is games/impostor-circle/circle.js and nothing here knows the words.
//
// THE HANDOFF, WHICH IS THE WHOLE OF THIS FILE'S JOB
// --------------------------------------------------
// A pass-and-reveal game lives or dies on one moment: the device changing hands
// with a secret on it. Every version of this that has ever gone wrong went wrong
// the same way — the screen says "pass it to Sam" and the secret is ALREADY
// SHOWING, so somebody has to say "don't look yet", and somebody always looks.
//
// So the secret is never on screen while the device is moving. A handoff card
// carries one name and one instruction, and THE PERSON ABOUT TO LOOK IS THE ONE
// WHO PRESSES THE BUTTON. Nothing else advances it — circle.js refuses, so it is
// a property of the game rather than a habit of this file. Nobody has to be
// told not to look, because there is nothing to look at.
//
// TEACHING
// --------
// One sentence, on the first handoff card of the first round only: "One of you
// gets a different word. Nobody is told who." After that every screen says only
// what to do next, in the same place, in the same words. A player who joins at
// round three watches one handoff and one vote and has the whole game.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { CIRCLE_TUNING, Circle, PHASE, SKIP } from './circle.js';

const GAME_ID = 'impostor-circle';
const W = 960;
const H = 540;
const TAU = Math.PI * 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css. The player colours
// are the same six as Tide's on purpose: two party games in the same arcade
// where player three is green in one and pink in the other is a small cruelty
// to a room that has just swapped games.
const ART = {
  night: '#12111a',
  nightLow: '#1d1a2a',
  card: '#221f30',
  text: '#f3eee6',
  textDim: 'rgba(243,238,230,.55)',
  teach: '#ffd479',
  wordBack: 'rgba(0,0,0,.28)',
  good: '#7ed957',
  bad: '#ff6b8a',
  players: ['#ffb02e', '#4fc3f7', '#7ed957', '#ff6b8a', '#c792ea', '#f2f0e6'],
  playerInk: ['#3a2400', '#04283a', '#0c2f10', '#3d0a19', '#2a1140', '#22262a'],
};

const NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();

// ONE PAD, LABELLED A, because every card on screen says "press A". The first
// version cleared the layout and relied on tap-anywhere, so a phone showed
// "Press A when you are holding it" with no A anywhere on it. Tapping the card
// still works -- the pad is the thing the words point at. No stick: nothing
// here steers, and the stick would claim half the screen from the taps.
Input.setDirectionalTouch(false);
Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.84, radius: 52, label: 'A' },
]);
Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 420, duration: 0.03, type: 'sine', volume: 0.08 } },
  reveal: { beep: { freq: 300, duration: 0.12, type: 'triangle', volume: 0.14 } },
  hide: { beep: { freq: 220, duration: 0.1, type: 'sine', volume: 0.12 } },
  vote: { beep: { freq: 560, duration: 0.07, type: 'square', volume: 0.13 } },
  caught: { beep: { freq: 700, duration: 0.28, type: 'triangle', volume: 0.2 } },
  escaped: { beep: { freq: 170, duration: 0.34, type: 'sawtooth', volume: 0.18 } },
});

// --- State ---------------------------------------------------------------

let playerCount = 4;
let difficulty = CIRCLE_TUNING.difficulty;
let game = null;
let cursor = 0;
let navLatch = 0;
let time = 0;
let taught = false;
// A short lock after every screen change. The single biggest way a
// pass-and-play game leaks a secret is a held button carrying through the
// handoff card and revealing the word in the wrong hands.
let lock = 0;
let stealChoices = [];

function reset() {
  game = new Circle({ players: playerCount, tuning: { difficulty } });
  cursor = 0;
  taught = false;
  lock = 0.35;
  stealChoices = [];
}

// The vote list is every seat and then one more row, NOBODY. Its index is the
// player count, so the seats keep the same buttons they had.
const voteRows = () => game.players + 1;
const isSkipRow = (i) => i === game.players;

function armCursorForPhase() {
  if (game.phase === PHASE.VOTE) {
    // Never start on yourself: it is the one square that cannot be chosen.
    cursor = (game.seat + 1) % game.players;
  } else {
    cursor = 0;
  }
}

// --- Update --------------------------------------------------------------

function confirmPressed() {
  if (lock > 0) return false;
  return Input.pressed('a') || Boolean(Input.tapped());
}

function advance() {
  switch (game.phase) {
    case PHASE.HANDOFF:
      game.reveal();
      audio.play('reveal');
      taught = true;
      break;
    case PHASE.WORD:
      game.seen();
      audio.play('hide');
      break;
    case PHASE.CLUES:
      game.startVote();
      armCursorForPhase();
      break;
    case PHASE.RESULT:
      if (!game.nextRound()) finish();
      break;
    default:
      break;
  }
  lock = 0.3;
}

function finish() {
  const rows = game.standings();
  const top = rows[0];
  const shared = rows.filter((r) => r.place === 1).length > 1;
  shell.showGameOver(top.score, {
    winner: shared ? 'Shared' : `Player ${NAMES[top.player]}`,
    players: game.players,
    words: difficulty === 'near' ? 'Close pairs' : 'Far pairs',
  });
}

function update(dt) {
  time += dt;
  if (lock > 0) lock = Math.max(0, lock - dt);
  if (!shell.update()) return;
  if (game.phase === PHASE.OVER) return;

  const pad = Input.get();

  if (game.phase === PHASE.VOTE || game.phase === PHASE.STEAL) {
    const count = game.phase === PHASE.VOTE ? voteRows() : stealChoices.length;
    const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
    const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
    const step = dx || dy;
    if (step && navLatch === 0 && count > 0) {
      do {
        cursor = (cursor + step + count) % count;
      } while (game.phase === PHASE.VOTE && cursor === game.seat);
      audio.play('move');
    }
    navLatch = step;

    // Touch: a tap on a name is a vote for it, and the buttons are the whole
    // screen width, so there is no small target to miss.
    const tap = Input.tapped();
    if (tap && lock === 0) {
      const point = screen.screenToGame(tap.x, tap.y);
      const hit = choiceAt(point.y, count);
      if (hit >= 0 && !(game.phase === PHASE.VOTE && hit === game.seat)) {
        cursor = hit;
        commitChoice();
        return;
      }
    }
    if (Input.pressed('a') && lock === 0) commitChoice();
    return;
  }

  if (confirmPressed()) advance();
}

function commitChoice() {
  if (game.phase === PHASE.VOTE) {
    audio.play('vote');
    const more = game.vote(isSkipRow(cursor) ? SKIP : cursor);
    if (more) armCursorForPhase();
    else {
      if (game.phase === PHASE.STEAL) {
        stealChoices = game.stealOptions();
        cursor = 0;
      }
      audio.play(game.outcome.caught ? 'caught' : 'escaped');
    }
  } else if (game.phase === PHASE.STEAL) {
    game.steal(stealChoices[cursor]);
    audio.play(game.outcome.stolen ? 'caught' : 'escaped');
  }
  lock = 0.3;
}

// --- Draw ----------------------------------------------------------------

const CHOICE_TOP = 190;
const CHOICE_H = 62;
const CHOICE_GAP = 8;
// The list must end above the bottom edge with room for a caption.
const CHOICE_BOTTOM = H - 30;

/**
 * Where row i of a list of `count` sits. The rows are the comfortable size
 * when they fit and shrink together when they do not: six players and a NOBODY
 * row is seven, and seven rows at full height run off the bottom of the card.
 */
function rowRect(i, count) {
  const pitch = Math.min(CHOICE_H + CHOICE_GAP, (CHOICE_BOTTOM - CHOICE_TOP) / Math.max(1, count));
  const h = pitch * (CHOICE_H / (CHOICE_H + CHOICE_GAP));
  const w = Math.min(560, screen.stageWidth - 120);
  const x = screen.left + (screen.stageWidth - w) / 2;
  return { x, y: CHOICE_TOP + i * pitch, w, h };
}

function choiceAt(y, count) {
  for (let i = 0; i < count; i++) {
    const r = rowRect(i, count);
    if (y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

const NIGHT = (() => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.night);
  g.addColorStop(1, ART.nightLow);
  return g;
})();

function centred(text, y, font, colour) {
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, screen.left + screen.stageWidth / 2, y);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The wide button used for every choice, so votes and guesses look the same. */
function choiceButton(i, count, label, selected, colour, { dim = false } = {}) {
  const { x, y, w, h } = rowRect(i, count);
  ctx.fillStyle = selected ? colour : dim ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.07)';
  roundRect(x, y, w, h, 12);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  // Type follows the row: 30px in a 62px row, smaller as the rows shrink.
  const size = Math.round(Math.min(30, h * 0.48));
  ctx.font = `${selected ? 700 : 600} ${size}px system-ui, sans-serif`;
  ctx.fillStyle = selected ? '#191622' : dim ? 'rgba(243,238,230,.28)' : ART.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawRoundStrip() {
  centred(`ROUND ${Math.min(game.round + 1, game.rounds)} OF ${game.rounds}`,
    46, '600 16px system-ui, sans-serif', ART.textDim);
}

function drawHandoff() {
  const who = game.seat;
  // The whole screen is that player's colour. From across a room the only
  // question is "is that mine", and a colour answers it before any word does.
  ctx.fillStyle = ART.players[who];
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  const ink = ART.playerInk[who];
  centred(`PLAYER ${NAMES[who].toUpperCase()}`, 250, '800 74px system-ui, sans-serif', ink);
  centred('Press A when you are holding it', 320, '600 28px system-ui, sans-serif',
    'rgba(0,0,0,.6)');

  // ONE SENTENCE, ONCE, on the first card of the game.
  if (!taught && game.round === 0) {
    centred('One of you gets a different word. Nobody is told who.',
      404, '700 24px system-ui, sans-serif', 'rgba(0,0,0,.75)');
  }
}

function drawWord() {
  const who = game.seat;
  ctx.fillStyle = ART.players[who];
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  const word = game.wordFor(who);
  const boxW = Math.min(720, screen.stageWidth - 80);
  ctx.fillStyle = ART.wordBack;
  roundRect(screen.left + (screen.stageWidth - boxW) / 2, 176, boxW, 150, 18);
  ctx.fill();

  // Long words shrink rather than run off the card.
  let size = 76;
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  while (ctx.measureText(word).width > boxW - 60 && size > 30) {
    size -= 4;
    ctx.font = `800 ${size}px system-ui, sans-serif`;
  }
  centred(word, 272, `800 ${size}px system-ui, sans-serif`, ART.text);

  centred(`a kind of ${game.category}`, 152, '600 22px system-ui, sans-serif',
    'rgba(0,0,0,.55)');
  centred('Press A when you have read it', 396, '600 26px system-ui, sans-serif',
    'rgba(0,0,0,.6)');
}

function drawClues() {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();

  centred('Say one word about it', 168, '800 54px system-ui, sans-serif', ART.text);
  centred('Go round the table. One word each, out loud.', 216,
    '600 24px system-ui, sans-serif', ART.textDim);

  // The circle, so the order is obvious without anybody organising it.
  const cx = screen.left + screen.stageWidth / 2;
  const cy = 350;
  const radius = 92;
  for (let p = 0; p < game.players; p++) {
    const angle = -Math.PI / 2 + (p / game.players) * TAU;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    ctx.fillStyle = ART.players[p];
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ART.playerInk[p];
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p + 1), x, y + 1);
  }
  ctx.textBaseline = 'alphabetic';
  centred('A to vote', 502, '600 20px system-ui, sans-serif', ART.textDim);
}

function drawVote() {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();

  const who = game.seat;
  // The heading carries the player's colour instead of a disc beside it. A disc
  // placed at a fixed offset from the centre lands ON the words as soon as the
  // stage is a different width, and it was doing exactly that on a phone.
  // Colouring the line says the same thing and cannot collide with anything.
  centred(`Player ${NAMES[who]} — who was the odd one out?`, 122,
    '700 34px system-ui, sans-serif', ART.players[who]);

  const count = voteRows();
  for (let p = 0; p < game.players; p++) {
    if (p === who) {
      // Your own name stays on screen, greyed. Removing it would renumber the
      // list under everybody's fingers and make the same seat a different
      // button on every turn.
      choiceButton(p, count, `Player ${NAMES[p]} — you`, false, ART.players[p], { dim: true });
      continue;
    }
    choiceButton(p, count, `Player ${NAMES[p]}`, cursor === p, ART.players[p]);
  }
  // The way out. Naming nobody is a real choice with a real price -- the
  // impostor is paid for surviving -- but it is not the price of being wrong.
  choiceButton(game.players, count, 'Nobody — skip the vote', cursor === game.players, ART.text);
}

function drawSteal() {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();
  centred(`Caught. Player ${NAMES[game.impostor]} — what was everyone else's word?`,
    122, '700 30px system-ui, sans-serif', ART.text);
  stealChoices.forEach((word, i) => {
    choiceButton(i, stealChoices.length, word, cursor === i, ART.players[game.impostor]);
  });
}

function drawResult() {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();

  const { caught, wrong, accused } = game.outcome;
  // Three endings, three headlines. A wrong accusation is a loss for the table
  // and says so; a skipped vote is the impostor getting away, not a defeat.
  const headline = caught ? 'Caught' : wrong ? 'Wrong — the table loses' : 'Nobody accused';
  centred(headline, 118, '800 52px system-ui, sans-serif', caught ? ART.good : ART.bad);
  if (wrong) {
    centred(`Player ${NAMES[accused]} was innocent. Everyone but the impostor loses ${CIRCLE_TUNING.pointsLostForWrongAccusation}.`,
      150, '600 18px system-ui, sans-serif', ART.bad);
  }
  centred(`Player ${NAMES[game.impostor]} had ${game.impostorWord}`, 182,
    '600 26px system-ui, sans-serif', ART.text);
  centred(`Everyone else had ${game.tableWord}`, 214,
    '600 26px system-ui, sans-serif', ART.textDim);
  if (game.outcome.stolen) {
    centred('…and named it anyway', 246, '700 24px system-ui, sans-serif', ART.bad);
  }

  // Who voted for whom, so a table can argue about it with the evidence up.
  const counts = game.tally();
  const skips = game.skips();
  const barTop = 290;
  const w = Math.min(560, screen.stageWidth - 120);
  const x = screen.left + (screen.stageWidth - w) / 2;
  for (let p = 0; p < game.players; p++) {
    const y = barTop + p * 30;
    ctx.fillStyle = p === game.impostor ? ART.players[p] : 'rgba(255,255,255,.35)';
    ctx.font = `${p === game.impostor ? 700 : 600} 18px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`Player ${NAMES[p]}`, x, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${counts[p]} vote${counts[p] === 1 ? '' : 's'}   ${game.scores[p]} pts`, x + w, y);
  }
  if (skips > 0) {
    const y = barTop + game.players * 30;
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Nobody', x, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${skips} vote${skips === 1 ? '' : 's'}`, x + w, y);
  }
  centred('A to carry on', 512, '600 20px system-ui, sans-serif', ART.textDim);
}

function render() {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  switch (game.phase) {
    case PHASE.HANDOFF: drawHandoff(); break;
    case PHASE.WORD: drawWord(); break;
    case PHASE.CLUES: drawClues(); break;
    case PHASE.VOTE: drawVote(); break;
    case PHASE.STEAL: drawSteal(); break;
    default: drawResult(); break;
  }

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
  title: 'Impostor Circle',
  canvas: screen,
  loop,
  audio,
  // No music. Every phase of this game is people listening to each other, and
  // a track under that is a track somebody has to talk over.
  music: false,
  onRestart: reset,
  controls: [
    { action: 'Carry on', gamepad: 'A', keyboard: 'Space', touch: 'Tap' },
    { action: 'Choose', gamepad: 'Left stick or D-pad', keyboard: 'Arrows', touch: 'Tap a name' },
    { action: 'Not sure', gamepad: 'Vote for Nobody', keyboard: 'Vote for Nobody', touch: 'Tap Nobody' },
    { action: 'Wrong accusation', gamepad: 'Everyone but the impostor loses a point', keyboard: 'Everyone but the impostor loses a point', touch: 'Everyone but the impostor loses a point' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Impostor Circle',
  tagline: 'One of you has a different word.',
  items: [
    {
      label: () => `Players: ${playerCount}`,
      run: () => {
        playerCount = playerCount >= CIRCLE_TUNING.maxPlayers
          ? CIRCLE_TUNING.minPlayers : playerCount + 1;
        reset();
        audio.play('move');
      },
      nudge: (direction) => {
        playerCount = Math.min(CIRCLE_TUNING.maxPlayers,
          Math.max(CIRCLE_TUNING.minPlayers, playerCount + direction));
        reset();
        audio.play('move');
      },
    },
    {
      label: () => (difficulty === 'near'
        ? 'Words: Close — hard to spot the impostor'
        : 'Words: Far apart — easier to spot'),
      run: () => {
        difficulty = difficulty === 'near' ? 'far' : 'near';
        reset();
        audio.play('move');
      },
    },
  ],
});
