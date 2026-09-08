// games/beat-blocker/game.js
//
// Beat Blocker — the music is made out of the chart.
//
// THE RULE
// --------
// Three lanes. Attacks fall down them towards a strike line. Slide the shield
// into a lane and press block as the attack lands. Four hearts, one per miss,
// one back for every thirty in a row. It never ends; it gets faster, and then
// when it can get no faster it gets wider.
//
// WHERE THE MUSIC COMES FROM
// --------------------------
// engine/audio.js synthesises tones — there are no samples, no tracks, and no
// backend to fetch one from — so there is nothing here to follow. The usual
// arrangement of a rhythm game (a recording, and a chart authored against it)
// is not available.
//
// So it is inverted. chart.js owns a tempo and a list of attack times as plain
// numbers; this file plays a drum on each of that phrase's beats and a note as
// each attack lands. The music cannot drift out of time with the gameplay,
// because it is not two things being kept in step — it is one list, read twice.
//
// The honest cost: a chart generated from a rule is a drum pattern, not a song.
// It swings, it syncopates and it builds, and nobody will hum it.
//
// WHY THAT IS WORTH IT
// --------------------
// Fairness becomes arithmetic. The judging windows are in MILLISECONDS, so a
// faster phrase asks for more rather than for more precision. And the shield
// genuinely travels, so a chart can ask you to be in two places at once —
// which chart.js refuses to deal and tests/beat-blocker.chart.test.mjs walks
// two hundred phrases looking for.
//
// WHAT THIS FILE DOES
// -------------------
// Canvas, input, audio, shell wiring. Not one rule.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session as Scores } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticlePresets, ParticleSystem, clamp } from '../../engine/util.js';

import { JUDGE, Session, TUNING, atCeiling, bpmAt, ceilingPhrase } from './chart.js';

const GAME_ID = 'beat-blocker';

const W = 900;
const H = 600;

// The track. Attacks enter at TOP and are judged at STRIKE.
const TOP = 60;
const STRIKE = 470;
const LANE_W = 150;
const LANE_X = (lane) => W / 2 + (lane - (TUNING.lanes - 1) / 2) * LANE_W;

// --- Art palette ---------------------------------------------------------
//
// Beat Blocker's own colours, deliberately NOT from tokens.css. A dark stage
// with three lit lanes: the lanes are cool and identical so the ATTACK is the
// only warm thing falling, and the strike line is the one place anything is
// ever bright. The shell still draws pause, game over and its own screens in
// site tokens over the top.
//
// Grouped by subject per CLAUDE.md.
const ART = {
  stage: {
    far: '#0b0a16',
    near: '#15122a',
    floor: 'rgba(120,110,220,0.10)',
    edge: 'rgba(150,140,255,0.16)',
  },
  lane: {
    fill: 'rgba(126,116,240,0.055)',
    fillLit: 'rgba(126,116,240,0.13)',
    line: 'rgba(150,140,255,0.22)',
    strike: 'rgba(196,190,255,0.5)',
    strikeHot: '#ffe9a8',
  },
  attack: {
    body: '#ff7b52',
    core: '#ffd7a1',
    rim: '#8f2f18',
    trail: 'rgba(255,123,82,0.18)',
  },
  shield: {
    body: '#54e6c8',
    core: '#d8fff5',
    rim: '#126f5e',
    glow: 'rgba(84,230,200,0.28)',
    travelling: '#3aa892',
  },
  pulse: {
    beat: 'rgba(180,170,255,0.30)',
    bar: 'rgba(255,233,168,0.42)',
  },
  spark: ['#ffe9a8', '#54e6c8', '#ffffff'],
  burst: ['#ff7b52', '#ffb06b', '#8f2f18'],
  hud: {
    text: '#efeaff',
    dim: 'rgba(239,234,255,0.5)',
    heart: '#ff6b8a',
    heartGone: 'rgba(255,107,138,0.18)',
    perfect: '#ffe9a8',
    good: '#54e6c8',
    miss: '#ff6b8a',
  },
};

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 260 });

// Touch gets discrete lane steps rather than only the virtual stick. Lanes are
// three fixed positions, and stepping onto one is a different gesture from
// steering — a thumb dragging a stick lands between lanes, which is exactly the
// place where a press does not count.
// BOTH LANE PADS ON THE LEFT, and stacked rather than side by side.
//
// They used to sit at 0.13 and 0.34 across, which was clear of the note lane
// when the canvas was the same shape as the game. It is not any more: on a wide
// screen the canvas extends past both sides of the game (see engine/canvas.js)
// and a pad placed at a third of the way across the SCREEN landed on top of the
// lane, which is the one thing on this screen a player has to watch.
//
// The margin either side is exactly the right home for a control -- it is
// backdrop rather than play area -- so the pair moves into it.
// And no virtual stick, for the reason written directly above: a thumb
// dragging a stick lands between lanes. The flag is touch-only, so a gamepad
// stick still moves the shield.
//
// It also frees the whole left-hand side for the two lane pads, which would
// otherwise be shoved apart by the engine keeping them clear of a joystick this
// game does not want.
Input.setDirectionalTouch(false);

Input.setTouchLayout([
  { name: 'lb', xRatio: 0.05, yRatio: 0.52, radius: 48, label: '◀' },
  { name: 'rb', xRatio: 0.05, yRatio: 0.84, radius: 48, label: '▶' },
  { name: 'a', xRatio: 0.95, yRatio: 0.72, radius: 58, label: 'BLOCK' },
]);

Scores.setScoreDirection(GAME_ID, 'high');

// The instrument. Every sound here is scheduled from a number in chart.js.
audio.define({
  // The pulse: a kick on the bar, a softer tick on the other beats. This is
  // what makes the tempo audible even in a phrase with nothing to block.
  kick: { beep: { freq: 96, duration: 0.11, type: 'sine', volume: 0.16 } },
  tick: { beep: { freq: 190, duration: 0.035, type: 'square', volume: 0.045 } },
  // One note per lane, as an attack lands. Low lane left, high lane right, so
  // the chart is audibly the same shape it looks.
  note0: { beep: { freq: 262, duration: 0.10, type: 'triangle', volume: 0.11 } },
  note1: { beep: { freq: 330, duration: 0.10, type: 'triangle', volume: 0.11 } },
  note2: { beep: { freq: 392, duration: 0.10, type: 'triangle', volume: 0.11 } },
  perfect: { beep: { freq: 880, duration: 0.09, type: 'sine', volume: 0.15 } },
  good: { beep: { freq: 620, duration: 0.07, type: 'sine', volume: 0.10 } },
  miss: { beep: { freq: 84, duration: 0.30, type: 'sawtooth', volume: 0.24 } },
  move: { beep: { freq: 420, duration: 0.03, type: 'square', volume: 0.05 } },
  heal: { beep: { freq: 700, duration: 0.22, type: 'triangle', volume: 0.16 } },
  phrase: { beep: { freq: 520, duration: 0.20, type: 'triangle', volume: 0.13 } },
  over: { beep: { freq: 70, duration: 0.8, type: 'triangle', volume: 0.28 } },
});

// --- State ---------------------------------------------------------------

let session = new Session();
let running = false;
let time = 0;
let shake = 0;
let flash = null;                 // the last verdict, fading
let beatPulse = 0;                // 1 on the beat, decaying
let barPulse = 0;
let lastBeatIndex = -1;
let lastPhrase = 1;
let lastHearts = TUNING.hearts;
let lastBlocked = 0;
let lastMissed = 0;
let navLatch = 0;

function reset() {
  session = new Session();
  running = true;
  time = 0;
  shake = 0;
  flash = null;
  beatPulse = 0;
  barPulse = 0;
  lastBeatIndex = -1;
  lastPhrase = 1;
  lastHearts = TUNING.hearts;
  lastBlocked = 0;
  lastMissed = 0;
  navLatch = 0;
  particles.clear();
}

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(session.score, {
    phrasesSurvived: session.phrase - 1,
    reachedTheCeiling: atCeiling(session.phrase) ? 'yes' : `no (at ${ceilingPhrase()})`,
    attacksBlocked: session.blocked,
    perfect: session.perfects,
    bestStreak: session.bestStreak,
    finalTempo: `${Math.round(session.bpm)} bpm`,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  particles.update(dt);
  time += dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 3);
  beatPulse = Math.max(0, beatPulse - dt * 4.5);
  barPulse = Math.max(0, barPulse - dt * 3);
  if (flash) { flash.life -= dt; if (flash.life <= 0) flash = null; }

  if (!running) return;

  const pad = Input.get();

  // MOVING. Discrete steps, because the lanes are three places rather than a
  // continuum: a stick held half over would otherwise park the shield between
  // two lanes, which is the one position where a perfectly timed press does
  // nothing and nothing on screen explains why.
  let step = 0;
  if (Input.pressed('lb')) step -= 1;
  if (Input.pressed('rb')) step += 1;
  const dir = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  if (dir !== 0 && navLatch === 0) step += dir;
  navLatch = dir;

  const wanted = clamp(session.lane + step, 0, TUNING.lanes - 1);
  if (step !== 0 && wanted !== session.lane) audio.play('move');

  const block = Input.pressed('a') || Input.pressed('b');

  session.step(dt, { lane: wanted, block });

  if (session.phrase !== lastPhrase) {
    // A new phrase, with a beat of its own. Nothing is discarded: the chart is
    // one list on one clock, and the attacks of the phrase after this one have
    // already been dealt and are already falling.
    const reachedCeiling = !atCeiling(lastPhrase) && atCeiling(session.phrase);
    lastPhrase = session.phrase;
    lastBeatIndex = -1;
    audio.play('phrase');
    if (reachedCeiling) say('TOP OF THE CHART — NOW HOW LONG?', ART.hud.perfect);
  }

  // SOUNDING THE PHRASE. Everything below reads the same numbers the
  // simulation just judged against — this phrase's beats, and the attacks in
  // it — which is the whole reason the music cannot drift out of time with the
  // game. There is nothing here keeping two clocks in step, because there is
  // only one clock.
  const beatIndex = Math.floor((session.time - session.phraseStart) / session.beat);
  if (session.time >= 0 && beatIndex !== lastBeatIndex && beatIndex < TUNING.beatsPerPhrase) {
    lastBeatIndex = beatIndex;
    if (beatIndex % 4 === 0) { audio.play('kick'); barPulse = 1; } else audio.play('tick');
    beatPulse = 1;
  }
  for (const event of session.events) {
    if (event.sounded || event.time > session.time) continue;
    // Marked on the attack rather than kept in a set beside it, because the
    // chart is now one long list that gets pruned from the front -- a set of
    // ids would grow for as long as the run does.
    event.sounded = true;
    audio.play(`note${event.lane % 3}`);
  }

  if (session.blocked > lastBlocked) {
    const verdict = session.lastJudge.verdict;
    audio.play(verdict === JUDGE.PERFECT ? 'perfect' : 'good');
    flash = { verdict, life: 0.55 };
    particles.emit(LANE_X(session.lastJudge.lane), STRIKE, {
      ...ParticlePresets.sparkle,
      count: verdict === JUDGE.PERFECT ? 16 : 8,
      colors: ART.spark,
      speed: [60, 190],
    });
  }
  lastBlocked = session.blocked;

  if (session.missed > lastMissed) {
    audio.play('miss');
    shake = 1;
    flash = { verdict: JUDGE.MISS, life: 0.7 };
    particles.emit(LANE_X(session.lastJudge.lane), STRIKE, {
      ...ParticlePresets.explosion, count: 20, colors: ART.burst, speed: [80, 230],
    });
  }
  lastMissed = session.missed;

  if (session.hearts > lastHearts) audio.play('heal');
  lastHearts = session.hearts;

  if (!session.running) finish();
}

// --- Drawing -------------------------------------------------------------

function drawStage() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.stage.far);
  g.addColorStop(1, ART.stage.near);
  ctx.fillStyle = g;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  // The lanes. Lit under the shield so the covered lane is never in doubt.
  const covered = session.coveredLane();
  for (let lane = 0; lane < TUNING.lanes; lane++) {
    const x = LANE_X(lane) - LANE_W / 2;
    ctx.fillStyle = lane === covered ? ART.lane.fillLit : ART.lane.fill;
    ctx.fillRect(x, TOP - 40, LANE_W, STRIKE + 70 - (TOP - 40));
    ctx.strokeStyle = ART.lane.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, TOP - 40, LANE_W - 2, STRIKE + 70 - (TOP - 40));
  }

  // THE PULSE. Drawn on the beat rather than on the attacks, so the tempo is
  // visible in a bar with nothing in it — the same reason the drum plays.
  ctx.strokeStyle = ART.stage.edge;
  ctx.lineWidth = 2 + barPulse * 5;
  ctx.globalAlpha = 0.25 + beatPulse * 0.75;
  ctx.strokeStyle = barPulse > 0.05 ? ART.pulse.bar : ART.pulse.beat;
  const left = LANE_X(0) - LANE_W / 2;
  const width = LANE_W * TUNING.lanes;
  ctx.strokeRect(left - 8, TOP - 48, width + 16, STRIKE + 78 - (TOP - 48));
  ctx.globalAlpha = 1;
}

function drawStrikeLine() {
  const hot = flash && flash.verdict !== JUDGE.MISS ? clamp(flash.life / 0.55, 0, 1) : 0;
  ctx.strokeStyle = hot > 0.05 ? ART.lane.strikeHot : ART.lane.strike;
  ctx.lineWidth = 3 + hot * 4;
  ctx.beginPath();
  ctx.moveTo(LANE_X(0) - LANE_W / 2, STRIKE);
  ctx.lineTo(LANE_X(TUNING.lanes - 1) + LANE_W / 2, STRIKE);
  ctx.stroke();
}

/** Where an attack sits on screen. The one place approach time turns into y. */
function yFor(eventTime) {
  const ahead = (eventTime - session.time) / TUNING.approachSeconds;
  return STRIKE - ahead * (STRIKE - TOP);
}

function drawAttacks() {
  for (const event of session.incoming) {
    const y = yFor(event.time);
    if (y < TOP - 60) continue;
    const x = LANE_X(event.lane);
    const r = 26;

    // A short trail, so a fast phrase reads as motion rather than as a row of
    // discs appearing.
    ctx.fillStyle = ART.attack.trail;
    ctx.fillRect(x - 8, Math.max(TOP - 40, y - 46), 16, Math.min(46, y - (TOP - 40)));

    ctx.fillStyle = ART.attack.body;
    ctx.strokeStyle = ART.attack.rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.86, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.86, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ART.attack.core;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShield() {
  const x = LANE_X(0) + session.shield * LANE_W;
  const covered = session.coveredLane() !== null;
  const w = 112;

  ctx.fillStyle = ART.shield.glow;
  ctx.beginPath();
  ctx.ellipse(x, STRIKE, w * 0.72, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // TRAVELLING IS VISIBLE. A shield between two lanes cannot block, and the
  // colour says so before a press is wasted proving it.
  ctx.fillStyle = covered ? ART.shield.body : ART.shield.travelling;
  ctx.strokeStyle = ART.shield.rim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, STRIKE + 16);
  ctx.lineTo(x - w / 2 + 16, STRIKE - 16);
  ctx.lineTo(x + w / 2 - 16, STRIKE - 16);
  ctx.lineTo(x + w / 2, STRIKE + 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = ART.shield.core;
  ctx.fillRect(x - 24, STRIKE - 6, 48, 5);
}

function drawHud() {
  ctx.textAlign = 'left';
  ctx.fillStyle = ART.hud.text;
  ctx.font = '800 30px system-ui, sans-serif';
  // Anchored to the left edge of the SCREEN, not of the game. See screen.left.
  const hudLeft = screen.left;
  ctx.fillText(String(session.score), hudLeft + 26, 46);

  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = ART.hud.dim;
  ctx.fillText(`PHRASE ${session.phrase}  ·  ${Math.round(session.bpm)} BPM`, hudLeft + 26, 68);

  // THE CEILING, SAID OUT LOUD.
  //
  // The chart stops getting harder at a stated phrase -- the tempo caps, the
  // subdivision caps, and past that the reachability floors are the binding
  // constraint, so every further phrase is the same phrase. That is the honest
  // end of the escalation, but an endless game that quietly stops escalating
  // reads as one that has run out of ideas. So it is announced, once, and then
  // stays on the HUD as a badge: from here it is not about surviving something
  // worse, it is about how long you can hold the hardest it gets.
  if (atCeiling(session.phrase)) {
    ctx.fillStyle = ART.hud.perfect;
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText('TOP OF THE CHART — IT GETS NO HARDER FROM HERE', hudLeft + 26, 88);
  }

  // Hearts.
  for (let i = 0; i < TUNING.hearts; i++) {
    ctx.fillStyle = i < session.hearts ? ART.hud.heart : ART.hud.heartGone;
    const x = W - 34 - i * 30;
    ctx.beginPath();
    ctx.arc(x - 6, 34, 7, 0, Math.PI * 2);
    ctx.arc(x + 6, 34, 7, 0, Math.PI * 2);
    ctx.moveTo(x - 13, 37);
    ctx.lineTo(x, 52);
    ctx.lineTo(x + 13, 37);
    ctx.fill();
  }

  // The streak, and how close it is to buying a heart back — otherwise the
  // heal arrives as a surprise and reads as the game deciding to be kind.
  const toHeal = TUNING.healStreak - (session.streak % TUNING.healStreak);
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.dim;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(
    session.streak ? `STREAK ${session.streak}  ·  ${toHeal} TO A HEART` : 'STREAK 0',
    W - 26, 68,
  );

  if (flash) {
    const label = flash.verdict === JUDGE.PERFECT ? 'PERFECT'
      : flash.verdict === JUDGE.GOOD ? 'BLOCKED' : 'HIT';
    const colour = flash.verdict === JUDGE.PERFECT ? ART.hud.perfect
      : flash.verdict === JUDGE.GOOD ? ART.hud.good : ART.hud.miss;
    ctx.globalAlpha = clamp(flash.life * 1.8, 0, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = colour;
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText(label, W / 2, STRIKE + 74);
    ctx.globalAlpha = 1;
  }

  // The run-up: four beats of music before anything arrives, said out loud so
  // the wait reads as deliberate.
  if (session.time < 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = ART.hud.dim;
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillText('LISTEN FOR THE BEAT', W / 2, 200);
  }
}

function render() {
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake * 9, (Math.random() - 0.5) * shake * 9);
  }
  drawStage();
  drawAttacks();
  drawStrikeLine();
  drawShield();
  particles.draw(ctx);
  ctx.restore();
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
  title: 'Beat Blocker',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or d-pad', keyboard: 'A/D or arrows', touch: '◀ ▶ pads' },
    { action: 'Block', gamepad: 'A or B', keyboard: 'Space', touch: 'BLOCK pad' },
    { action: 'Timing', gamepad: 'On the beat scores triple', keyboard: 'On the beat scores triple', touch: 'On the beat scores triple' },
    { action: 'The shield', gamepad: 'Takes time to change lane', keyboard: 'Takes time to change lane', touch: 'Takes time to change lane' },
    { action: 'Thirty in a row', gamepad: 'Buys a heart back', keyboard: 'Buys a heart back', touch: 'Buys a heart back' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({
  name: 'Beat Blocker',
  tagline: `Three lanes, one shield, and a tempo that starts at ${bpmAt(1)} `
    + `and stops climbing at phrase ${ceilingPhrase()}.`,
});
