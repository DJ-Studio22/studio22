// games/wavelength-lite/game.js
//
// Wavelength Lite — canvas, input, sound and the pad-passing chrome. The game
// is games/wavelength-lite/dial.js and nothing here knows where the spot is
// except to draw it.
//
// THE HANDOFF IS THE SAME SHAPE AS IMPOSTOR CIRCLE'S, ON PURPOSE
// --------------------------------------------------------------
// A full-bleed card in the player's colour, one name, one instruction, and the
// person about to look presses the button themselves. Nothing secret is on
// screen while the device is moving, so nobody ever has to say "don't look
// yet". Two party games in the same arcade that hand a device round should do
// it identically: learning one should teach the other, and a room that has just
// swapped games should not have to learn a new ceremony.
//
// TEACHING
// --------
// One sentence, on the first card of the first round only. After that every
// screen says one thing: what to do next. The dial itself does the rest — a
// pointer, two words at the ends, and a band that lights up when it is revealed
// is not a rule anybody needs read to them.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { DIAL_TUNING, Dial, PHASE, scoreFor } from './dial.js';

const GAME_ID = 'wavelength-lite';
const W = 960;
const H = 540;
const TAU = Math.PI * 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css. The six player
// colours match Tide's and Impostor Circle's: three party games where player
// three is a different colour in each would be a small cruelty to a room that
// has just swapped.
const ART = {
  deep: '#0b1524',
  deepLow: '#13233a',
  track: 'rgba(255,255,255,.08)',
  trackEdge: 'rgba(255,255,255,.14)',
  band4: '#ffd479',
  band2: 'rgba(255,212,121,.42)',
  band1: 'rgba(255,212,121,.18)',
  needle: '#ffffff',
  text: '#eef4fb',
  textDim: 'rgba(238,244,251,.55)',
  teach: '#ffd479',
  players: ['#ffb02e', '#4fc3f7', '#7ed957', '#ff6b8a', '#c792ea', '#f2f0e6'],
  playerInk: ['#3a2400', '#04283a', '#0c2f10', '#3d0a19', '#2a1140', '#22262a'],
};

const NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();

// ONE PAD, LABELLED A, and no virtual stick.
//
// The first version cleared the layout and relied on tap-anywhere. Two things
// were wrong with that on a phone. Every card said "press A" with no A on the
// screen; and the guess could not be locked in AT ALL -- locking is
// Input.pressed('a'), which nothing on a touchscreen produced, so the dial
// could be dragged for ever and never answered. The stick goes because the
// dial is the control: a touch on the left half was being claimed by an
// invisible joystick and nudging the pointer at stick speed, while the same
// touch on the right half dragged it straight to the spot.
Input.setDirectionalTouch(false);
Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.84, radius: 52, label: 'A' },
]);
Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  move: { beep: { freq: 380, duration: 0.02, type: 'sine', volume: 0.05 } },
  reveal: { beep: { freq: 320, duration: 0.12, type: 'triangle', volume: 0.14 } },
  hide: { beep: { freq: 230, duration: 0.1, type: 'sine', volume: 0.12 } },
  lock: { beep: { freq: 600, duration: 0.07, type: 'square', volume: 0.13 } },
  bullseye: { beep: { freq: 880, duration: 0.3, type: 'triangle', volume: 0.2 } },
  miss: { beep: { freq: 180, duration: 0.26, type: 'sawtooth', volume: 0.15 } },
});

// --- State ---------------------------------------------------------------

let playerCount = 4;
let game = null;
let pointer = 50;
let time = 0;
let taught = false;
// A short lock after every screen change. The commonest way a pass-and-reveal
// game leaks is a held button carrying through a card.
let lock = 0;

function reset() {
  game = new Dial({ players: playerCount });
  pointer = 50;
  taught = false;
  lock = 0.35;
}

// --- Update --------------------------------------------------------------

function advance() {
  switch (game.phase) {
    case PHASE.HANDOFF:
      game.reveal();
      audio.play('reveal');
      taught = true;
      break;
    case PHASE.SECRET:
      game.hide();
      audio.play('hide');
      break;
    case PHASE.CLUE:
      game.startGuessing();
      // The pointer starts in the middle every time rather than where the last
      // person left it. Otherwise the previous guess is a hint nobody meant to
      // give, and the first thing you see is somebody else's answer.
      pointer = 50;
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
    rounds: game.rounds,
  });
}

function update(dt) {
  time += dt;
  if (lock > 0) lock = Math.max(0, lock - dt);
  if (!shell.update()) return;
  if (game.phase === PHASE.OVER) return;

  if (game.phase === PHASE.GUESS) {
    const pad = Input.get();
    if (Math.abs(pad.x) > 0.12) {
      pointer = Math.min(100, Math.max(0, pointer + pad.x * DIAL_TUNING.pointerSpeed * dt));
    }

    // Touch: drag anywhere along the dial. The whole width of the stage is the
    // control, so there is no small target to miss and no button to find.
    const point = Input.pointer();
    if (point) {
      const at = screen.screenToGame(point.x, point.y);
      const track = trackRect();
      pointer = Math.min(100, Math.max(0, ((at.x - track.x) / track.w) * 100));
    }

    if (Input.pressed('a') && lock === 0) {
      const points = scoreFor(pointer, game.target);
      audio.play(points >= 4 ? 'bullseye' : 'lock');
      game.guess(pointer);
      if (game.phase === PHASE.RESULT) audio.play(game.outcome.forClue >= 3 ? 'bullseye' : 'miss');
      pointer = 50;
      lock = 0.25;
    }
    return;
  }

  if (lock === 0 && (Input.pressed('a') || Input.tapped())) advance();
}

// --- Draw ----------------------------------------------------------------

const DEEP = (() => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.deep);
  g.addColorStop(1, ART.deepLow);
  return g;
})();

function trackRect() {
  const w = Math.min(760, screen.stageWidth - 120);
  return { x: screen.left + (screen.stageWidth - w) / 2, y: 262, w, h: 46 };
}

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

/**
 * The dial. `showTarget` is the only difference between the card one person
 * sees and the card everybody sees, which is the whole game in one flag.
 */
function drawDial({ showTarget = false, showPointer = false, markers = [] } = {}) {
  const t = trackRect();

  ctx.fillStyle = ART.track;
  roundRect(t.x, t.y, t.w, t.h, t.h / 2);
  ctx.fill();
  ctx.strokeStyle = ART.trackEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (showTarget) {
    // Widest band first so the narrower ones sit on top of it. The bands come
    // from the tuning rather than being drawn as three fixed rectangles, so
    // retuning the scoring retunes the picture.
    const bands = [...DIAL_TUNING.bands].sort((a, b) => b.within - a.within);
    const shade = { 4: ART.band4, 2: ART.band2, 1: ART.band1 };
    for (const band of bands) {
      const from = Math.max(0, game.target - band.within);
      const to = Math.min(100, game.target + band.within);
      ctx.fillStyle = shade[band.points] ?? ART.band1;
      roundRect(t.x + (from / 100) * t.w, t.y + 3,
        ((to - from) / 100) * t.w, t.h - 6, 8);
      ctx.fill();
    }
  }

  // The ends. These are the only words on the dial and they are what the clue
  // has to live between.
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.textDim;
  ctx.fillText(game.spectrum.low, t.x, t.y - 18);
  ctx.textAlign = 'right';
  ctx.fillText(game.spectrum.high, t.x + t.w, t.y - 18);

  for (const marker of markers) {
    const x = t.x + (marker.at / 100) * t.w;
    ctx.fillStyle = ART.players[marker.player];
    ctx.beginPath();
    ctx.moveTo(x, t.y + t.h + 6);
    ctx.lineTo(x - 9, t.y + t.h + 24);
    ctx.lineTo(x + 9, t.y + t.h + 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ART.playerInk[marker.player];
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    // Middle rather than the default baseline: on an alphabetic baseline the
    // digit climbs into the point of the arrow and gets clipped by it.
    ctx.textBaseline = 'middle';
    ctx.fillText(String(marker.player + 1), x, t.y + t.h + 18);
    ctx.textBaseline = 'alphabetic';
  }

  if (showPointer) {
    const x = t.x + (pointer / 100) * t.w;
    ctx.strokeStyle = ART.needle;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, t.y - 8);
    ctx.lineTo(x, t.y + t.h + 8);
    ctx.stroke();
    ctx.fillStyle = ART.needle;
    ctx.beginPath();
    ctx.arc(x, t.y - 14, 6, 0, TAU);
    ctx.fill();
  }
}

function drawRoundStrip() {
  centred(`ROUND ${Math.min(game.round + 1, game.rounds)} OF ${game.rounds}`,
    44, '600 16px system-ui, sans-serif', ART.textDim);
}

function drawHandoff() {
  const who = game.holder;
  ctx.fillStyle = ART.players[who];
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  const ink = ART.playerInk[who];
  centred(`PLAYER ${NAMES[who].toUpperCase()}`, 250, '800 74px system-ui, sans-serif', ink);
  centred('Press A when you are holding it', 320, '600 28px system-ui, sans-serif',
    'rgba(0,0,0,.6)');
  if (!taught && game.round === 0) {
    centred('You will see a hidden spot on a dial. Everyone else has to find it.',
      404, '700 24px system-ui, sans-serif', 'rgba(0,0,0,.75)');
  }
}

function drawSecret() {
  ctx.fillStyle = DEEP;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();
  centred('Here it is. Say a clue out loud.', 130, '800 42px system-ui, sans-serif', ART.text);
  centred('No numbers, and not the words at the ends.', 172,
    '600 22px system-ui, sans-serif', ART.textDim);
  drawDial({ showTarget: true });
  centred('A to hide it', 452, '600 22px system-ui, sans-serif', ART.textDim);
}

function drawClue() {
  ctx.fillStyle = DEEP;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();
  centred(`Player ${NAMES[game.psychic]} — say your clue`, 130,
    '800 42px system-ui, sans-serif', ART.players[game.psychic]);
  centred('Everybody else, listen. You each get a go at the dial.', 172,
    '600 22px system-ui, sans-serif', ART.textDim);
  drawDial({});
  centred('A when the clue has been said', 452, '600 22px system-ui, sans-serif', ART.textDim);
}

function drawGuess() {
  ctx.fillStyle = DEEP;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();
  const who = game.holder;
  centred(`Player ${NAMES[who]} — where is it?`, 130,
    '800 42px system-ui, sans-serif', ART.players[who]);
  // Nobody else's guess is drawn. Seeing the last answer first turns a guess
  // into a copy, and the point of guessing separately is that everybody commits
  // to their own idea of what the clue meant.
  centred(`${game.seat + 1} of ${game.guessers.length}`, 172,
    '600 22px system-ui, sans-serif', ART.textDim);
  drawDial({ showPointer: true });
  centred('Move the pointer · A to lock it in', 452,
    '600 22px system-ui, sans-serif', ART.textDim);
}

function drawResult() {
  ctx.fillStyle = DEEP;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  drawRoundStrip();

  const best = Math.max(...game.outcome.scored.map((g) => g.points));
  centred(best >= 4 ? 'Dead on' : 'There it was', 120,
    '800 46px system-ui, sans-serif', best >= 4 ? ART.band4 : ART.text);

  drawDial({
    showTarget: true,
    markers: game.outcome.scored.map((g) => ({ player: g.player, at: g.at })),
  });

  const w = Math.min(600, screen.stageWidth - 120);
  const x = screen.left + (screen.stageWidth - w) / 2;
  let y = 372;
  ctx.font = '600 18px system-ui, sans-serif';
  for (const g of game.outcome.scored) {
    ctx.textAlign = 'left';
    ctx.fillStyle = ART.players[g.player];
    ctx.fillText(`Player ${NAMES[g.player]}`, x, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = ART.text;
    ctx.fillText(`+${g.points}   ${game.scores[g.player]} pts`, x + w, y);
    y += 24;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.players[game.psychic];
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.fillText(`Player ${NAMES[game.psychic]} — the clue`, x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.text;
  ctx.fillText(`+${game.outcome.forClue}   ${game.scores[game.psychic]} pts`, x + w, y);

  centred('A to carry on', 516, '600 20px system-ui, sans-serif', ART.textDim);
}

function render() {
  ctx.fillStyle = DEEP;
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);
  switch (game.phase) {
    case PHASE.HANDOFF: drawHandoff(); break;
    case PHASE.SECRET: drawSecret(); break;
    case PHASE.CLUE: drawClue(); break;
    case PHASE.GUESS: drawGuess(); break;
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
  title: 'Wavelength Lite',
  canvas: screen,
  loop,
  audio,
  // No music, for the same reason as Impostor Circle: every phase is people
  // listening to each other, and a track under that is one somebody talks over.
  music: false,
  onRestart: reset,
  controls: [
    { action: 'Move the pointer', gamepad: 'Left stick or D-pad', keyboard: 'Arrows', touch: 'Drag the dial' },
    { action: 'Lock it in', gamepad: 'A', keyboard: 'Space', touch: 'A pad' },
    { action: 'Carry on', gamepad: 'A', keyboard: 'Space', touch: 'Tap, or A' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Wavelength Lite',
  tagline: 'One of you can see the spot. Say something useful.',
  items: [
    {
      label: () => `Players: ${playerCount}`,
      run: () => {
        playerCount = playerCount >= DIAL_TUNING.maxPlayers
          ? DIAL_TUNING.minPlayers : playerCount + 1;
        reset();
        audio.play('move');
      },
      nudge: (direction) => {
        playerCount = Math.min(DIAL_TUNING.maxPlayers,
          Math.max(DIAL_TUNING.minPlayers, playerCount + direction));
        reset();
        audio.play('move');
      },
    },
  ],
});
