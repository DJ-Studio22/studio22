// games/number-crunch/game.js
//
// Number Crunch — arithmetic as an arcade shooter, for ages 6-12.
//
// Answers drift down the screen on three bubbles. Fly under the right one and
// shoot it. Get it wrong and the game shows you the answer before moving on,
// because the point of this one is that a child ends the run knowing more
// than they started it.
//
// WHAT MAKES IT ADAPTIVE RATHER THAN A QUIZ
// -----------------------------------------
// Every operation carries its own difficulty band, and the run watches the
// last ten problems of each. Above 85% it nudges that operation harder; below
// 60% it eases off. So a child who has multiplication cold but is shaky on
// division gets harder times tables and gentler division in the same run,
// without anyone choosing that. The starting band comes from the Easy /
// Medium / Hard choice at setup; adaptation moves it from there.
//
// UNITS: seconds, per the engine doctrine. Nothing here was ported from a
// per-frame prototype, so every constant below is already units-per-second or
// units-per-second-squared and nothing needs converting.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { UI } from '../../engine/ui.js';
import { ParticleSystem, randInt, randRange as R, clamp } from '../../engine/util.js';
import {
  OPS, OP_SIGN, BANDS, createAdaptive,
  makeProblem, makeBossProblem, makeDistractors,
} from './problems.js';

const GAME_ID = 'number-crunch';

// Portrait, because this is the game most likely to be played on a phone held
// the way a phone is held. Three lanes at 180 units each leaves room for a
// three-digit answer at a size a seven-year-old can read at arm's length.
const W = 540;
const H = 810;
const TAU = Math.PI * 2;

const LANES = 3;
const LANE_X = [W / 6, W / 2, (W * 5) / 6];

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome, and a maths game for six-year-olds should not look like the
// same room as Comet.
//
// It is bright and saturated but NOT light. That is a constraint rather than
// a taste: engine/shell.js draws the HUD, pause and game over screens in the
// site's near-white text, so a pale sky behind them would leave the score
// unreadable. Deep indigo keeps the shell legible while the bubbles and stars
// do the friendly part.
const ART = {
  skyTop: '#2a1b6b',
  skyBottom: '#6b3fa0',
  star: '#ffffff',
  planet: 'rgba(255,255,255,.07)',

  // The three answer bubbles. Distinct in hue AND lightness, so they are
  // still three different things to a colour-blind player.
  bubble: ['#63f5c0', '#ffd93d', '#ff8a8a'],
  bubbleShade: ['#2fbb8c', '#d9ad00', '#d95c5c'],
  bubbleText: '#241553',

  bossBubble: '#c9a6ff',
  bossShade: '#8b5cd6',

  ship: '#ffffff',
  shipTrim: '#45d9ff',
  shipGlow: 'rgba(69,217,255,.5)',
  bullet: '#ffe66d',

  problemText: '#ffffff',
  problemShadow: 'rgba(0,0,0,.45)',
  bannerFill: '#180c3e',

  correct: '#63f5c0',
  wrong: '#ff8a8a',
  comboText: '#ffd93d',

  puffHit: '#ffffff',
  puffCorrect: '#63f5c0',
  puffWrong: '#ff8a8a',

  menuLabel: '#c8b9ff',
  menuChip: 'rgba(255,255,255,.12)',
  menuChipOn: '#ffd93d',
  menuChipText: '#ffffff',
  menuChipTextOn: '#241553',
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 260 });

// One pad, labelled with the verb rather than the letter — this game is aimed
// at players who have never been told what "A" means on a controller.
Input.setTouchLayout([
  { name: 'a', xRatio: 0.86, yRatio: 0.82, radius: 52, label: 'Fire' },
]);

Session.setScoreDirection(GAME_ID, 'high');

// --- Sound ---------------------------------------------------------------
//
// Synthesised for now; there are no audio files yet. Adding `file: '...'` to
// any entry below is the only change needed to upgrade that sound.
audio.define({
  shoot: { beep: { freq: 620, duration: 0.05, type: 'square', volume: 0.12 } },
  correct: { beep: { freq: 880, duration: 0.16, type: 'triangle', volume: 0.22 } },
  wrong: { beep: { freq: 150, duration: 0.3, type: 'sawtooth', volume: 0.2 } },
  wave: { beep: { freq: 1040, duration: 0.22, type: 'triangle', volume: 0.2 } },
  boss: { beep: { freq: 300, duration: 0.4, type: 'square', volume: 0.2 } },
  death: { beep: { freq: 100, duration: 0.5, type: 'triangle', volume: 0.26 } },
});

// --- Tuning --------------------------------------------------------------

const SHIP_SPEED = 430;       // units/sec
const SHIP_Y = H - 96;
const SHIP_HALF = 30;
const BULLET_SPEED = 1000;    // units/sec
const BUBBLE_R = 56;
// Clear of the shell's HUD, which owns roughly the top 130 units.
const BANNER_Y = 190;
const BANNER_H = 104;
const BANNER_BOTTOM = BANNER_Y + BANNER_H / 2;
// Bubbles start fully above the play area's top edge and slide out from under
// the banner. Far enough up that no part of one is showing at spawn.
const BUBBLE_TOP = BANNER_BOTTOM - BUBBLE_R - 12;
const BUBBLE_FLOOR = SHIP_Y - 44;   // where a bubble counts as landed

const BASE_FALL = 48;         // units/sec on wave 1
const FALL_PER_WAVE = 7;
const MAX_FALL = 150;

const PROBLEMS_PER_WAVE = 5;
const BOSS_EVERY = 5;         // every fifth wave is a boss round
const BOSS_PROBLEMS = 3;

const CELEBRATE_TIME = 0.55;  // pause after a correct answer
const FEEDBACK_TIME = 1.7;    // pause showing the answer after a wrong one
const MAX_COMBO = 5;

const START_LIVES = 3;

// --- Game state ----------------------------------------------------------

// 'setup' while the player picks what they want to practise, 'play' once the
// run is going. The shell's title screen sits in front of both.
let mode = 'setup';

let setupRow = 0;                  // 0 operation, 1 numbers, 2 start
const OP_CHOICES = ['add', 'sub', 'mul', 'div', 'mixed'];
const OP_CHOICE_LABEL = {
  add: 'Add', sub: 'Subtract', mul: 'Multiply', div: 'Divide', mixed: 'Mixed',
};
const RANGE_CHOICES = ['easy', 'medium', 'hard'];
let chosenOp = 'add';
let chosenRange = 'easy';

let score = 0;
let lives = START_LIVES;
let wave = 1;
let combo = 1;
let waveProblem = 0;           // problems answered so far this wave

let phase = 'falling';         // 'falling' | 'celebrate' | 'feedback'
let phaseTimer = 0;

let problem = null;            // { text, answer, op, isBoss }
let bubbles = [];              // one per lane
let bullet = null;             // { x, y } or null
let problemStartedAt = 0;
let flash = 0;                 // screen tint after a wrong answer

// Per-operation difficulty, which follows the player. Rebuilt at the start of
// each run because the starting band depends on the range they picked.
let adaptive = createAdaptive('easy');

// Run statistics, which are the whole point of the results screen.
const stats = {
  solved: 0,
  attempts: 0,
  fastest: Infinity,
  longestCombo: 1,
  perOp: {},                   // op -> { right, total }
};

const ship = { x: W / 2, vx: 0 };
const stars = [];
for (let i = 0; i < 70; i++) {
  stars.push({ x: R(0, W), y: R(0, H), r: R(0.8, 2.2), a: R(0.25, 0.9) });
}
const planets = [
  { x: W * 0.22, y: H * 0.24, r: 95 },
  { x: W * 0.84, y: H * 0.52, r: 130 },
];

// --- Problem generation --------------------------------------------------

// The operation this problem uses. In mixed mode each problem draws afresh,
// which is what makes mixed genuinely harder than any single tier: you cannot
// settle into one kind of thinking.
function pickOp() {
  return chosenOp === 'mixed' ? OPS[randInt(0, OPS.length - 1)] : chosenOp;
}

function isBossWave() {
  return wave % BOSS_EVERY === 0;
}

function problemsThisWave() {
  return isBossWave() ? BOSS_PROBLEMS : PROBLEMS_PER_WAVE;
}

function fallSpeed() {
  const speed = BASE_FALL + (wave - 1) * FALL_PER_WAVE;
  // Boss bubbles come down slower: the problem takes longer to think about,
  // and a two-step sum arriving at wave-20 speed is a trick, not a test.
  return Math.min(speed, MAX_FALL) * (isBossWave() ? 0.72 : 1);
}

function spawnProblem() {
  const op = pickOp();
  const level = adaptive.bandFor(op);
  problem = isBossWave() ? makeBossProblem(op, level) : makeProblem(op, level);

  const values = [problem.answer, ...makeDistractors(problem, LANES - 1)];
  // Shuffle so the answer is not in a predictable lane.
  for (let i = values.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }

  bubbles = values.map((value, lane) => ({
    lane,
    value,
    x: LANE_X[lane],
    y: BUBBLE_TOP - lane * 10,
    alive: true,
    wobble: R(0, TAU),
  }));

  bullet = null;
  phase = 'falling';
  problemStartedAt = performance.now();
}

// --- Statistics ----------------------------------------------------------

// Records an outcome for the results screen and hands it to the adaptive
// model, which decides on its own whether that changes the difficulty.
function recordOutcome(op, correct) {
  stats.attempts++;
  if (correct) stats.solved++;

  const perOp = stats.perOp[op] ?? (stats.perOp[op] = { right: 0, total: 0 });
  perOp.total++;
  if (correct) perOp.right++;

  adaptive.record(op, correct);
}

// --- Flow ----------------------------------------------------------------

function reset() {
  mode = 'setup';
  setupRow = 0;

  score = 0;
  lives = START_LIVES;
  wave = 1;
  combo = 1;
  waveProblem = 0;
  flash = 0;

  bubbles = [];
  bullet = null;
  problem = null;
  particles.clear();

  ship.x = W / 2;
  ship.vx = 0;

  adaptive = createAdaptive(chosenRange);

  stats.solved = 0;
  stats.attempts = 0;
  stats.fastest = Infinity;
  stats.longestCombo = 1;
  stats.perOp = {};
}

function beginRun() {
  mode = 'play';
  // Built here rather than in reset(), because reset() runs before the player
  // has chosen a range and the starting band comes from that choice.
  adaptive = createAdaptive(chosenRange);
  spawnProblem();
}

function nextProblem() {
  waveProblem++;
  if (waveProblem >= problemsThisWave()) {
    waveProblem = 0;
    wave++;
    audio.play(isBossWave() ? 'boss' : 'wave');
  }
  spawnProblem();
}

function onCorrect(bubble) {
  const seconds = (performance.now() - problemStartedAt) / 1000;
  stats.fastest = Math.min(stats.fastest, seconds);

  recordOutcome(problem.op, true);

  const base = problem.isBoss ? 50 : 10;
  score += base * combo;
  combo = Math.min(combo + 1, MAX_COMBO);
  stats.longestCombo = Math.max(stats.longestCombo, combo);

  puff(bubble.x, bubble.y, ART.puffCorrect, 26);
  audio.play('correct');

  phase = 'celebrate';
  phaseTimer = CELEBRATE_TIME;
}

function onWrong(bubble) {
  recordOutcome(problem.op, false);
  combo = 1;
  lives--;
  flash = 1;

  if (bubble) puff(bubble.x, bubble.y, ART.puffWrong, 22);
  audio.play('wrong');

  if (lives <= 0) {
    endRun();
    return;
  }

  phase = 'feedback';
  phaseTimer = FEEDBACK_TIME;
}

function endRun() {
  audio.play('death');

  const accuracy = stats.attempts
    ? Math.round((stats.solved / stats.attempts) * 100)
    : 0;

  // Six lines is the shell's ceiling, so per-operation accuracy is folded
  // into one row rather than taking four. In a single-operation run that row
  // says one thing; in mixed it is the most interesting line on the screen,
  // because it is where a child sees which one is costing them.
  const breakdown = OPS
    .filter((op) => stats.perOp[op])
    .map((op) => {
      const { right, total } = stats.perOp[op];
      return `${OP_SIGN[op]} ${Math.round((right / total) * 100)}%`;
    })
    .join('  ');

  shell.showGameOver(score, {
    problemsSolved: stats.solved,
    accuracy: `${accuracy}%`,
    byOperation: breakdown || '—',
    fastestAnswer: Number.isFinite(stats.fastest) ? `${stats.fastest.toFixed(1)}s` : '—',
    longestCombo: stats.longestCombo,
    waveReached: wave,
  });
}

function puff(x, y, color, count) {
  particles.emit(x, y, {
    count,
    colors: [color],
    speed: [60, 260],
    life: [0.25, 0.6],
    size: [3, 3],
    gravity: 120,
    drag: 0.9,
    shape: 'circle',
    shrink: true,
  });
}

// --- Setup screen --------------------------------------------------------
//
// Drawn by the game rather than the shell: the shell's menus are a vertical
// list of buttons, and this is a grid of choices that stay on screen together
// so a child can see what they are picking between.

const SETUP_ROWS = 3;

let setupLatchX = 0;
let setupLatchY = 0;

function updateSetup() {
  const pad = Input.get();

  // Edge-triggered off the axes rather than off button names: engine/input.js
  // has no 'up'/'down' buttons, because a d-pad, a stick and the arrow keys
  // all arrive as the same x/y pair. Latching means one flick moves one step
  // instead of skating along the row.
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0;
  const dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  if (dy !== 0 && setupLatchY === 0) setupRow = (setupRow + dy + SETUP_ROWS) % SETUP_ROWS;
  if (dx !== 0 && setupLatchX === 0) nudgeChoice(dx);
  setupLatchX = dx;
  setupLatchY = dy;

  if (Input.pressed('a')) {
    if (setupRow === SETUP_ROWS - 1) beginRun();
    else setupRow++;
  }
}

function nudgeChoice(direction) {
  if (setupRow === 0) {
    const at = OP_CHOICES.indexOf(chosenOp);
    chosenOp = OP_CHOICES[(at + direction + OP_CHOICES.length) % OP_CHOICES.length];
  } else if (setupRow === 1) {
    const at = RANGE_CHOICES.indexOf(chosenRange);
    chosenRange = RANGE_CHOICES[(at + direction + RANGE_CHOICES.length) % RANGE_CHOICES.length];
  }
}

// Chip rectangles, shared by drawing and by hit-testing a tap so a finger can
// never land somewhere the chip is not.
function setupLayout() {
  const rows = [];
  const chipH = 62;

  const opW = (W - 40 - 4 * 8) / OP_CHOICES.length;
  rows.push({
    label: 'What do you want to practise?',
    y: 250,
    chips: OP_CHOICES.map((id, i) => ({
      id,
      label: OP_CHOICE_LABEL[id],
      x: 20 + i * (opW + 8),
      y: 250,
      w: opW,
      h: chipH,
      on: chosenOp === id,
    })),
  });

  const rangeW = (W - 40 - 2 * 10) / RANGE_CHOICES.length;
  rows.push({
    label: 'How big are the numbers?',
    y: 420,
    chips: RANGE_CHOICES.map((id, i) => ({
      id,
      label: id[0].toUpperCase() + id.slice(1),
      x: 20 + i * (rangeW + 10),
      y: 420,
      w: rangeW,
      h: chipH,
      on: chosenRange === id,
    })),
  });

  rows.push({
    label: '',
    y: 580,
    chips: [{ id: 'start', label: 'Play', x: W / 2 - 110, y: 580, w: 220, h: 74, on: true }],
  });

  return rows;
}

function renderSetup() {
  drawSky();

  UI.text(ctx, 'NUMBER CRUNCH', W / 2, 120, {
    size: 40, color: ART.problemText, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });
  UI.text(ctx, 'Shoot the right answer', W / 2, 162, {
    size: 20, color: ART.menuLabel, font: 'body', align: 'center', baseline: 'middle',
  });

  setupLayout().forEach((row, index) => {
    if (row.label) {
      UI.text(ctx, row.label, W / 2, row.y - 34, {
        size: 20, color: ART.menuLabel, font: 'body',
        align: 'center', baseline: 'middle',
      });
    }

    for (const chip of row.chips) {
      const focused = setupRow === index;
      drawChip(chip, focused);
    }
  });

  UI.text(ctx, 'It gets harder when you do well, and easier when you do not.',
    W / 2, H - 90, {
      size: 15, color: ART.menuLabel, font: 'body', align: 'center', baseline: 'middle',
    });
}

function drawChip(chip, rowFocused) {
  const on = chip.on;
  UI.roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 14);
  ctx.fillStyle = on ? ART.menuChipOn : ART.menuChip;
  ctx.fill();

  // The outline marks where the cursor IS, so it goes on the chosen chip of
  // the focused row only. Outlining the whole row instead reads as though
  // every option in it were selected.
  if (rowFocused && on) {
    ctx.strokeStyle = ART.problemText;
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  // Shrink the label if a long word would otherwise run past the chip.
  let size = chip.h > 70 ? 30 : 22;
  while (size > 12 && UI.measure(ctx, chip.label, { size, font: 'display', weight: '700' }) > chip.w - 14) {
    size -= 1;
  }

  UI.text(ctx, chip.label, chip.x + chip.w / 2, chip.y + chip.h / 2, {
    size, color: on ? ART.menuChipTextOn : ART.menuChipText,
    font: 'display', weight: '700', align: 'center', baseline: 'middle',
  });
}

// A tap anywhere on a chip selects it, and a tap on Play starts. Without this
// the setup screen would be the one part of the game a touch player could not
// use, since it has no joystick and no action pad of its own.
screen.canvas.addEventListener('pointerdown', (event) => {
  if (mode !== 'setup' || shell.isOverlayOpen) return;
  const point = screen.screenToGame(event.clientX, event.clientY);

  setupLayout().forEach((row, index) => {
    for (const chip of row.chips) {
      if (point.x < chip.x || point.x > chip.x + chip.w) continue;
      if (point.y < chip.y || point.y > chip.y + chip.h) continue;
      setupRow = index;
      if (chip.id === 'start') beginRun();
      else if (index === 0) chosenOp = chip.id;
      else chosenRange = chip.id;
    }
  });
});

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  if (mode === 'setup') {
    updateSetup();
    return;
  }

  if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
  particles.update(dt);

  if (phase !== 'falling') {
    phaseTimer -= dt;
    if (phaseTimer <= 0) nextProblem();
    return;
  }

  // Ship. Direct velocity rather than acceleration: precision matters more
  // than momentum when the job is lining up under a specific bubble, and a
  // drifting ship is exactly the kind of thing that makes a child feel the
  // game cheated them.
  const pad = Input.get();
  ship.vx = pad.x * SHIP_SPEED;
  ship.x = clamp(ship.x + ship.vx * dt, SHIP_HALF, W - SHIP_HALF);

  if (Input.pressed('a') && bullet === null) {
    bullet = { x: ship.x, y: SHIP_Y - 20 };
    audio.play('shoot');
  }

  if (bullet) {
    bullet.y -= BULLET_SPEED * dt;
    if (bullet.y < -20) bullet = null;
  }

  const speed = fallSpeed();
  for (const bubble of bubbles) {
    if (!bubble.alive) continue;
    bubble.y += speed * dt;
    bubble.wobble += dt * 2;

    if (bullet && Math.hypot(bullet.x - bubble.x, bullet.y - bubble.y) < BUBBLE_R) {
      bullet = null;
      bubble.alive = false;
      puff(bubble.x, bubble.y, ART.puffHit, 10);
      if (bubble.value === problem.answer) onCorrect(bubble);
      else onWrong(bubble);
      return;
    }

    // Reaching the bottom is the same as answering wrong: the problem went
    // unanswered. Shown the same way too, so it teaches rather than just
    // taking a life.
    if (bubble.y > BUBBLE_FLOOR) {
      onWrong(null);
      return;
    }
  }
}

// --- Draw ----------------------------------------------------------------

// Built once. A gradient object is not free to create, and this one never
// changes.
const SKY = (() => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, ART.skyTop);
  gradient.addColorStop(1, ART.skyBottom);
  return gradient;
})();

function drawSky() {
  ctx.fillStyle = SKY;
  // Across the STAGE, not across W: on a screen wider than the game the canvas
  // extends past both edges (see engine/canvas.js) and an unpainted margin is
  // just a black bar the game chose not to fill.
  ctx.fillRect(screen.left, 0, screen.stageWidth, H);

  for (const planet of planets) {
    ctx.fillStyle = ART.planet;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, planet.r, 0, TAU);
    ctx.fill();
  }

  for (const star of stars) {
    ctx.globalAlpha = star.a;
    ctx.fillStyle = ART.star;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function render() {
  if (mode === 'setup') {
    renderSetup();
    shell.render();
    return;
  }

  drawSky();

  // Bubbles are clipped to the play area, which starts at the bottom edge of
  // the banner. Without the clip a bubble's top pokes up past the banner and
  // sits over the shell's HUD on the way down.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, BANNER_BOTTOM, W, H - BANNER_BOTTOM);
  ctx.clip();
  for (const bubble of bubbles) {
    if (bubble.alive) drawBubble(bubble);
  }
  ctx.restore();

  // The problem itself. Bigger than anything else on screen, because it is
  // the thing being read.
  drawProblemBanner();

  if (bullet) {
    ctx.fillStyle = ART.bullet;
    ctx.beginPath();
    ctx.ellipse(bullet.x, bullet.y, 5, 13, 0, 0, TAU);
    ctx.fill();
  }

  drawShip();
  particles.draw(ctx);

  if (phase === 'feedback') drawAnswerReveal();
  if (phase === 'celebrate') drawPraise();

  // A red wash on a wrong answer, fading out. Loud enough to notice, short
  // enough not to feel like a telling-off.
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.28;
    ctx.fillStyle = ART.wrong;
    ctx.fillRect(screen.left, 0, screen.stageWidth, H);
    ctx.globalAlpha = 1;
  }

  drawCombo();

  shell.drawHud({
    score,
    best: Session.getBest(GAME_ID),
    lives,
    level: wave,
  });

  shell.render();
}

function drawProblemBanner() {
  if (!problem) return;

  const y = BANNER_Y;
  UI.roundRect(ctx, 16, y - BANNER_H / 2, W - 32, BANNER_H, 18);
  ctx.fillStyle = ART.bannerFill;
  ctx.fill();

  if (problem.isBoss) {
    UI.text(ctx, `BOSS · WAVE ${wave}`, W / 2, y - 30, {
      size: 16, color: ART.bossBubble, font: 'display', weight: '700',
      align: 'center', baseline: 'middle',
    });
  }

  // Shrink to fit rather than overflow: a three-step boss problem is a much
  // longer string than "3 + 4", and running off the edge would hide the part
  // that matters.
  let size = problem.isBoss ? 48 : 58;
  while (size > 20 && UI.measure(ctx, `${problem.text} = ?`, { size, font: 'display', weight: '800' }) > W - 70) {
    size -= 2;
  }

  ctx.save();
  ctx.shadowColor = ART.problemShadow;
  ctx.shadowBlur = 10;
  UI.text(ctx, `${problem.text} = ?`, W / 2, y + (problem.isBoss ? 12 : 4), {
    size, color: ART.problemText, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });
  ctx.restore();
}

function drawBubble(bubble) {
  const wobbleX = Math.sin(bubble.wobble) * 5;
  const x = bubble.x + wobbleX;
  const fill = problem.isBoss ? ART.bossBubble : ART.bubble[bubble.lane];
  const shade = problem.isBoss ? ART.bossShade : ART.bubbleShade[bubble.lane];

  // A shaded underside rather than a flat disc: it reads as a solid object,
  // which is what makes shooting it satisfying.
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, bubble.y + 5, BUBBLE_R, 0, TAU);
  ctx.fill();

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, bubble.y, BUBBLE_R, 0, TAU);
  ctx.fill();

  // Highlight, top-left, like light from the same place every time.
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath();
  ctx.arc(x - BUBBLE_R * 0.32, bubble.y - BUBBLE_R * 0.34, BUBBLE_R * 0.26, 0, TAU);
  ctx.fill();

  let size = 42;
  const label = String(bubble.value);
  while (size > 16 && UI.measure(ctx, label, { size, font: 'display', weight: '800' }) > BUBBLE_R * 1.6) {
    size -= 2;
  }

  UI.text(ctx, label, x, bubble.y, {
    size, color: ART.bubbleText, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });
}

function drawShip() {
  ctx.save();
  ctx.translate(ship.x, SHIP_Y);

  ctx.shadowColor = ART.shipGlow;
  ctx.shadowBlur = 18;

  ctx.fillStyle = ART.ship;
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(24, 22);
  ctx.lineTo(0, 10);
  ctx.lineTo(-24, 22);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = ART.shipTrim;
  ctx.beginPath();
  ctx.arc(0, -4, 8, 0, TAU);
  ctx.fill();

  ctx.restore();
}

function drawCombo() {
  if (combo <= 1) return;
  UI.text(ctx, `${combo}× COMBO`, W / 2, H - 34, {
    size: 22, color: ART.comboText, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });
}

// The teaching moment. Big, plain, and on screen long enough to read twice.
function drawAnswerReveal() {
  ctx.fillStyle = 'rgba(20,10,55,.82)';
  ctx.fillRect(0, H / 2 - 110, W, 220);

  UI.text(ctx, 'The answer was', W / 2, H / 2 - 62, {
    size: 22, color: ART.menuLabel, font: 'body', align: 'center', baseline: 'middle',
  });

  let size = 66;
  const line = `${problem.text} = ${problem.answer}`;
  while (size > 22 && UI.measure(ctx, line, { size, font: 'display', weight: '800' }) > W - 50) {
    size -= 2;
  }

  UI.text(ctx, line, W / 2, H / 2 + 6, {
    size, color: ART.correct, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });

  UI.text(ctx, `${lives} ${lives === 1 ? 'life' : 'lives'} left`, W / 2, H / 2 + 72, {
    size: 20, color: ART.menuLabel, font: 'body', align: 'center', baseline: 'middle',
  });
}

function drawPraise() {
  UI.text(ctx, combo > 2 ? `${combo - 1} in a row!` : 'Correct!', W / 2, H / 2, {
    size: 46, color: ART.correct, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
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
  title: 'Number Crunch',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Move', gamepad: 'Left stick or D-pad', keyboard: 'Arrows or A / D', touch: 'Drag the left side' },
    { action: 'Fire', gamepad: 'A', keyboard: 'Space', touch: 'Fire button' },
    { action: 'Choose', gamepad: 'Left stick, then A', keyboard: 'Arrows, then Space', touch: 'Tap a choice' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Number Crunch', tagline: 'Shoot the right answer.' });
