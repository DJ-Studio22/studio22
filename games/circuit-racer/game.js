// games/circuit-racer/game.js
//
// Circuit Racer -- a four-car field round one of four circuits, with a
// slipstream to work for and a rival that is fallible on purpose.
//
// WHAT LIVES WHERE
// ----------------
//   tracks.js   the circuits, as data, plus the geometry that reads them
//   driving.js  physics, the AI brain, lap counting, standings -- no DOM
//   game.js     this file: setup screen, input, drawing, HUD, the shell
//
// The split is not tidiness. "Casual is beatable by a first-timer" is a claim
// about lap times, so the physics and the AI had to be importable by a script
// that simulates races without a browser. The difficulty numbers in
// driving.js came out of 1,200 of those races.
//
// THE ONE GAME WHERE LOWER IS BETTER
// ----------------------------------
// Every other game in the suite scores upward: more depth, more points, more
// words. This one is timed, so the best run is the SMALLEST number, and it
// registers that with Session.setScoreDirection(GAME_ID, 'low'). Everything
// that ranks -- the arcade's best-this-visit line, the tournament standings --
// reads that direction rather than assuming. Getting it wrong would quietly
// hand the trophy to whoever drove worst.
//
// UNITS: seconds, per the engine doctrine.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { UI } from '../../engine/ui.js';
import { ParticleSystem, clamp } from '../../engine/util.js';

import { TRACKS, DEFAULT_TRACK, buildTrack, validateAllTracks } from './tracks.js';
import * as Drive from './driving.js';

const GAME_ID = 'circuit-racer';

const W = 960;
const H = 600;
const TAU = Math.PI * 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome, and this is the game's artwork.
//
// Daylight circuit -- grass, asphalt, painted kerbs. Distinct from the
// others: Updraft is night sky, Comet a black void, Sinkhole a cave, Number
// Crunch deep space, Keystroke a sheet of paper. This one is the only game
// that happens outdoors in the afternoon.
const ART = {
  grass: '#3e6b3a',
  grassDark: '#355c32',
  road: '#4a4a4f',
  roadEdge: '#6a6a70',
  kerbA: '#d6453f',
  kerbB: '#f2f2f2',
  centerLine: 'rgba(255,255,255,.22)',
  tyreMark: 'rgba(18,16,20,.30)',

  startBand: '#f2f2f2',
  startDark: '#2b2b2f',

  player: '#ffc93c',
  playerDark: '#c9922a',
  rivalA: '#4da3ff',
  rivalADark: '#2c6fbd',
  rivalB: '#ff7a59',
  rivalBDark: '#c25236',
  rivalC: '#b183ff',
  rivalCDark: '#7f56c4',
  glass: 'rgba(20,24,32,.75)',

  hudPanel: 'rgba(24,26,24,.72)',
  hudText: '#f5f1e8',
  hudLabel: 'rgba(245,241,232,.6)',
  hudBest: '#8be08b',
  hudLoss: '#ff8f7a',
  tow: '#63d2ff',

  lightOff: '#40201f',
  lightOn: '#ff3b30',
  lightGo: '#5ce07a',

  panel: 'rgba(20,26,20,.82)',
  panelEdge: 'rgba(245,241,232,.16)',
  chip: 'rgba(245,241,232,.10)',
  chipOn: '#ffc93c',
  chipInk: '#f5f1e8',
  chipInkOn: '#20240f',

  dust: '#c7bda4',
  spark: '#ffd76a',
};

const RIVAL_COLORS = [
  [ART.rivalA, ART.rivalADark],
  [ART.rivalB, ART.rivalBDark],
  [ART.rivalC, ART.rivalCDark],
];

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 220 });

Input.setTouchLayout([
  // Same two actions as the triggers, so a thumb and a trigger are the same
  // control rather than two different games.
  { name: 'a', xRatio: 0.90, yRatio: 0.78, radius: 50, label: 'Gas' },
  { name: 'b', xRatio: 0.74, yRatio: 0.88, radius: 40, label: 'Brake' },
]);

// THE POINT OF THIS GAME, as far as the rest of the suite is concerned.
// A lap time is better when it is smaller.
//
// Registered once for the game, not once per circuit. Session looks the
// direction up by game id even when a score carries a variant, so adding a
// fifth circuit to tracks.js cannot forget to register one and start ranking
// its lap times upward.
Session.setScoreDirection(GAME_ID, 'low');

audio.define({
  engine: { beep: { freq: 96, duration: 0.09, type: 'sawtooth', volume: 0.05 } },
  kerb: { beep: { freq: 260, duration: 0.04, type: 'square', volume: 0.08 } },
  bump: { beep: { freq: 150, duration: 0.07, type: 'square', volume: 0.14 } },
  light: { beep: { freq: 420, duration: 0.09, type: 'square', volume: 0.16 } },
  go: { beep: { freq: 880, duration: 0.22, type: 'triangle', volume: 0.22 } },
  jump: { beep: { freq: 180, duration: 0.4, type: 'sawtooth', volume: 0.2 } },
  lap: { beep: { freq: 900, duration: 0.18, type: 'triangle', volume: 0.2 } },
  best: { beep: { freq: 1200, duration: 0.26, type: 'triangle', volume: 0.22 } },
  finish: { beep: { freq: 520, duration: 0.5, type: 'square', volume: 0.24 } },
  move: { beep: { freq: 520, duration: 0.05, type: 'square', volume: 0.1 } },
  pick: { beep: { freq: 760, duration: 0.09, type: 'triangle', volume: 0.14 } },
});

// A circuit whose start line sits on a corner, or that doubles back close
// enough for the nearest-point lookup to snap to the wrong straight, is a bug
// that only shows up mid-race. Say so at boot rather than during a lap.
for (const problem of validateAllTracks()) console.warn('[circuit-racer] ' + problem);

// Motion the player has asked not to see. Read once: this is a preference,
// not something that changes mid-race.
const REDUCED_MOTION = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Start lights --------------------------------------------------------
//
// Five reds come on one at a time, then a short unpredictable hold, then they
// all go out together and the race is on. The hold is random so the start
// cannot be memorised as a rhythm -- which is the whole reason a jump-start
// rule has anything to police.
const LIGHTS = 5;
const LIGHT_GAP = 0.62;          // seconds between reds coming on
const HOLD_MIN = 0.5;
const HOLD_MAX = 1.5;
const JUMP_PENALTY = 3;          // seconds held stationary for going early
const JUMP_MOVE = 4;             // units of movement that counts as jumping

// --- State ---------------------------------------------------------------

const PHASE = { SETUP: 'setup', LIGHTS: 'lights', RACE: 'race', OVER: 'over' };
let phase = PHASE.SETUP;

let chosenTrack = DEFAULT_TRACK;
let chosenLaps = Drive.DEFAULT_LAPS;
let chosenDifficulty = Drive.DEFAULT_DIFFICULTY;

let track = buildTrack(TRACKS[0]);
let field = null;
let cars = [];
let player = null;

let raceTime = 0;
let lapTime = 0;
let lap = 1;
let bestLap = Infinity;
let lapTimes = [];
let finishOrder = 0;
let finishHold = 0;

let lightsTime = 0;
let lightsOutAt = 0;
let jumped = false;
let penaltyLeft = 0;
let gridProgress = 0;

// Sector splits. Kept in memory rather than in Session: they are a coaching
// aid for the run in front of you, not a score, and they are only meaningful
// against the same circuit.
let sectorBest = [];
let sectorRef = null;            // which track the bests belong to
let sectorIndex = 0;
let sectorStart = 0;
let splitText = '';
let splitGood = false;
let splitLeft = 0;

let shake = 0;
let engineTick = 0;
let offTrack = false;

// Tyre marks, in a fixed ring buffer. Pooled because they are spawned in a
// loop and the performance rule in CLAUDE.md is not negotiable: at four cars
// laying rubber through a hairpin this would otherwise allocate every frame.
const MARK_MAX = 260;
const marks = [];
for (let i = 0; i < MARK_MAX; i++) marks.push({ x: 0, y: 0, angle: 0, life: 0 });
let markAt = 0;

function addMark(x, y, angle) {
  const mark = marks[markAt];
  markAt = (markAt + 1) % MARK_MAX;
  mark.x = x;
  mark.y = y;
  mark.angle = angle;
  mark.life = 1;
}

// --- Setup screen --------------------------------------------------------

const SETUP_ROWS = 4;            // circuit, length, difficulty, go
let setupRow = 0;
let latchX = 0;
let latchY = 0;

function setupLayout() {
  const pad = 56;
  const inner = W - pad * 2;

  const trackW = (inner - (TRACKS.length - 1) * 12) / TRACKS.length;
  const lapW = (inner - (Drive.LAP_OPTIONS.length - 1) * 12) / Drive.LAP_OPTIONS.length;
  const diffW = (inner - (Drive.DIFFICULTIES.length - 1) * 12) / Drive.DIFFICULTIES.length;

  return [
    {
      label: 'Circuit',
      y: 118,
      chips: TRACKS.map((t, i) => ({
        id: t.id, label: t.name, glyph: t, on: chosenTrack === t.id,
        x: pad + i * (trackW + 12), y: 118, w: trackW, h: 104,
      })),
    },
    {
      label: 'Race length',
      y: 262,
      chips: Drive.LAP_OPTIONS.map((n, i) => ({
        id: n, label: n + ' laps', on: chosenLaps === n,
        x: pad + i * (lapW + 12), y: 262, w: lapW, h: 52,
      })),
    },
    {
      label: 'Rivals',
      y: 354,
      chips: Drive.DIFFICULTIES.map((d, i) => ({
        id: d.id, label: d.label, on: chosenDifficulty === d.id,
        x: pad + i * (diffW + 12), y: 354, w: diffW, h: 52,
      })),
    },
    {
      label: '',
      y: 466,
      chips: [{
        id: 'start', label: 'Race', on: true,
        x: W / 2 - 120, y: 466, w: 240, h: 62,
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
  if (dy !== 0 && latchY === 0) {
    setupRow = (setupRow + dy + SETUP_ROWS) % SETUP_ROWS;
    audio.play('move');
  }
  if (dx !== 0 && latchX === 0) nudge(dx);
  latchX = dx;
  latchY = dy;

  if (Input.pressed('a')) activateSetupRow();
}

function nudge(direction) {
  const cycle = (list, current) => {
    const at = list.indexOf(current);
    return list[(at + direction + list.length) % list.length];
  };

  if (setupRow === 0) chosenTrack = cycle(TRACKS.map(t => t.id), chosenTrack);
  else if (setupRow === 1) chosenLaps = cycle(Drive.LAP_OPTIONS, chosenLaps);
  else if (setupRow === 2) {
    chosenDifficulty = cycle(Drive.DIFFICULTIES.map(d => d.id), chosenDifficulty);
  } else return;

  audio.play('move');
}

function activateSetupRow() {
  if (setupRow < SETUP_ROWS - 1) { setupRow++; audio.play('move'); return; }
  audio.play('pick');
  startRace();
}

screen.canvas.addEventListener('pointerdown', (event) => {
  if (shell.isOverlayOpen || phase !== PHASE.SETUP) return;
  const point = screen.screenToGame(event.clientX, event.clientY);

  setupLayout().forEach((row, index) => {
    for (const chip of row.chips) {
      if (point.x < chip.x || point.x > chip.x + chip.w) continue;
      if (point.y < chip.y || point.y > chip.y + chip.h) continue;
      setupRow = index;
      if (chip.id === 'start') { audio.play('pick'); startRace(); return; }
      if (index === 0) chosenTrack = chip.id;
      else if (index === 1) chosenLaps = chip.id;
      else chosenDifficulty = chip.id;
      audio.play('move');
    }
  });
});

// --- Starting a race -----------------------------------------------------

function startRace() {
  track = buildTrack(TRACKS.find(t => t.id === chosenTrack) || TRACKS[0]);

  // Sector bests belong to a circuit. Comparing a split on The Pin Works
  // against one set on Sunset Loop would be worse than showing nothing.
  if (sectorRef !== track.id) {
    sectorRef = track.id;
    sectorBest = new Array(Drive.SECTORS).fill(Infinity);
  }

  field = Drive.makeField(track, { rivals: 3, difficulty: chosenDifficulty });
  cars = field.cars;
  player = field.player;

  field.rivals.forEach((car, i) => {
    const [color, dark] = RIVAL_COLORS[i % RIVAL_COLORS.length];
    car.color = color;
    car.dark = dark;
  });
  player.color = ART.player;
  player.dark = ART.playerDark;

  raceTime = 0;
  lapTime = 0;
  lap = 1;
  bestLap = Infinity;
  lapTimes = [];
  finishOrder = 0;
  finishHold = 0;
  offTrack = false;
  shake = 0;
  engineTick = 0;

  sectorIndex = 0;
  sectorStart = 0;
  splitText = '';
  splitLeft = 0;

  lightsTime = 0;
  lightsOutAt = LIGHTS * LIGHT_GAP + HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
  jumped = false;
  penaltyLeft = 0;
  gridProgress = player.travelled;

  for (const mark of marks) mark.life = 0;
  particles.clear();

  phase = PHASE.LIGHTS;
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;

  if (phase === PHASE.SETUP) { updateSetup(); return; }
  if (phase === PHASE.OVER) { particles.update(dt); return; }

  if (phase === PHASE.LIGHTS) updateLights(dt);
  else {
    raceTime += dt;
    lapTime += dt;
    if (penaltyLeft > 0) penaltyLeft -= dt;
    if (splitLeft > 0) splitLeft -= dt;
  }

  driveEveryone(dt);
  Drive.separateCars(cars, dt);
  Drive.updateSlipstream(cars);
  particles.update(dt);
  fadeMarks(dt);
  updateShake(dt);
  updateEngineNote(dt);
}

/**
 * The light sequence, during which the PLAYER can move and the field cannot.
 *
 * That asymmetry is the point. A jump start has to be something the player
 * can actually do and actually gain from, or the penalty is policing nothing.
 * Creep off the line here and you are up the road when the lights go out --
 * and then held for three seconds while the whole field drives past.
 */
function updateLights(dt) {
  const before = lightsTime;
  lightsTime += dt;

  for (let i = 0; i < LIGHTS; i++) {
    const at = i * LIGHT_GAP;
    if (before < at && lightsTime >= at) audio.play('light');
  }

  // Going early ENDS the sequence there and then. Letting it run would mean
  // a player who floors it on the first red gets four seconds of free track
  // before the penalty lands -- most of a lap on the shorter circuits. This
  // way the most a jump can gain is the few units it takes to notice it.
  if (player.travelled - gridProgress > JUMP_MOVE) {
    jumped = true;
    phase = PHASE.RACE;
    penaltyLeft = JUMP_PENALTY;
    audio.play('jump');
    return;
  }

  if (lightsTime >= lightsOutAt) {
    phase = PHASE.RACE;
    audio.play('go');
  }
}

function driveEveryone(dt) {
  const playerProgress = player.travelled;

  for (const car of cars) {
    if (car.done) {
      Drive.coastToStop(track, car, dt);
      Drive.clampToCanvas(car, W, H);
      continue;
    }

    // Nobody but the player moves until the lights go out.
    if (phase === PHASE.LIGHTS && !car.isPlayer) continue;

    const wasOnGrass = car.onGrass;
    const input = car.isPlayer
      ? playerInput()
      : Drive.aiControls(track, car, cars, dt, playerProgress);

    Drive.stepCar(track, car, input, dt);
    Drive.clampToCanvas(car, W, H);
    trailFor(car, wasOnGrass, dt);

    // Progress accumulates under the lights as well, so a car that crept
    // forward is where the standings say it is. It cannot bank a lap doing
    // it: jumping the start cuts the sequence short a few units later.
    const gained = Drive.advanceLap(track, car, chosenLaps);
    if (phase !== PHASE.RACE) continue;

    if (car.done && !car.finishOrder) car.finishOrder = ++finishOrder;
    if (car.isPlayer) {
      checkSector();
      if (gained) onPlayerLap();
    }
  }

  if (phase === PHASE.RACE && player.done) {
    finishHold += dt;
    // A beat to see the flag before the results panel covers the track.
    if (finishHold > 1.4) finishRace();
  }
}

function playerInput() {
  // Held on the line for jumping the start. Brake on, everything else off:
  // the car is stationary and visibly being punished, not frozen mid-frame.
  if (penaltyLeft > 0) return { throttle: 0, brake: 1, steer: 0 };

  // SCREEN-RELATIVE. The stick names a direction on the screen and the car
  // turns toward it; it is not a rotation command. On a top-down track that
  // is what most people expect the first time they pick it up — push right,
  // go right — and it stops the car steering "backwards" whenever it happens
  // to be pointing down the screen at you.
  //
  // The mapping itself lives in driving.js so it can be tested without a
  // browser, and so the AI and the player still hand stepCar the same shape.
  return Drive.playerInput(player, Input.get());
}

/**
 * Rubber, dust and sparks -- the things that tell you what the car is doing
 * without a single number on screen.
 */
function trailFor(car, wasOnGrass, dt) {
  const fast = Math.abs(car.speed) > 130;
  const sliding = Math.abs(car.steerInput) > 0.55 && Math.abs(car.speed) > 190;

  if (!car.onGrass && fast && (car.braking || sliding) && Math.random() < dt * 55) {
    // Two marks, one per rear wheel, so it reads as a car and not a smudge.
    const across = Drive.CAR_W / 2 - 2;
    const nx = -Math.sin(car.angle) * across;
    const ny = Math.cos(car.angle) * across;
    const backX = car.x - Math.cos(car.angle) * (Drive.CAR_L / 2 - 4);
    const backY = car.y - Math.sin(car.angle) * (Drive.CAR_L / 2 - 4);
    addMark(backX + nx, backY + ny, car.angle);
    addMark(backX - nx, backY - ny, car.angle);
  }

  if (car.onGrass && Math.abs(car.speed) > 55 && Math.random() < dt * 30) {
    particles.emit(car.x, car.y, {
      count: 1, colors: [ART.dust], speed: [20, 80], life: [0.25, 0.6],
      size: [2, 5], shape: 'circle', shrink: true,
    });
  }

  if (car.onGrass && !wasOnGrass) {
    // The moment of leaving the road: sparks off the kerb, a bump of shake,
    // and a noise. Only the player's own excursion shakes the view.
    particles.emit(car.x, car.y, {
      count: 6, colors: [ART.spark, ART.kerbB], speed: [60, 190], life: [0.15, 0.4],
      size: [1, 3], shape: 'circle', shrink: true,
    });
    if (car.isPlayer) {
      audio.play('kerb');
      bump(5);
    }
  }
  if (car.isPlayer) offTrack = car.onGrass;
}

function fadeMarks(dt) {
  for (const mark of marks) {
    if (mark.life > 0) mark.life -= dt * 0.055;
  }
}

/**
 * Screen shake: a constant tremble once the car is genuinely quick, plus a
 * jolt on contact. Skipped entirely when the player has asked for reduced
 * motion -- a shaking viewport is exactly what that preference is about.
 */
function bump(amount) {
  if (REDUCED_MOTION) return;
  shake = Math.max(shake, amount);
}

const SHAKE_FROM = 300;   // speed at which the view starts to tremble

function updateShake(dt) {
  // Decays fast, so a bump is a jolt rather than a wobble.
  shake *= 0.0025 ** dt;
  if (shake < 0.05) shake = 0;

  const over = Math.abs(player.speed) - SHAKE_FROM;
  if (over > 0) bump((over / (Drive.MAX_SPEED - SHAKE_FROM)) * 2.4);
}

/**
 * A rising engine note, built from short blips rather than a held oscillator.
 *
 * engine/audio.js plays one-shots with a playback rate, which is all this
 * needs: fire a short sawtooth often enough and the blips overlap into a
 * continuous note whose pitch follows the speed. A sustained oscillator would
 * mean owning a node for the lifetime of the page and remembering to stop it
 * on pause, on game over and on navigation.
 */
function updateEngineNote(dt) {
  if (phase === PHASE.OVER) return;

  engineTick -= dt;
  if (engineTick > 0) return;
  engineTick = 0.075;

  const ratio = clamp(Math.abs(player.speed) / Drive.MAX_SPEED, 0, 1);
  const idle = phase === PHASE.LIGHTS ? 0.12 : 0;
  audio.play('engine', {
    pitch: 0.55 + ratio * 1.75,
    volume: 0.5 + (ratio + idle) * 0.9,
  });
}

// --- Sectors -------------------------------------------------------------

/**
 * Splits, so the player can see WHERE the time went rather than only how
 * much of it. Compared against your own best on this circuit this visit --
 * the only comparison that means anything without persistence.
 */
function checkSector() {
  const now = Drive.sectorOf(track, player);
  if (now === sectorIndex) return;

  const elapsed = raceTime - sectorStart;
  const finishedSector = sectorIndex;
  sectorIndex = now;
  sectorStart = raceTime;

  // The out-lap sector from a standing start is not comparable to a flying
  // one, so it sets the baseline instead of being judged against it.
  const previous = sectorBest[finishedSector];
  if (Number.isFinite(previous)) {
    const delta = elapsed - previous;
    splitGood = delta < 0;
    splitText = 'S' + (finishedSector + 1) + '  '
      + (delta < 0 ? '-' : '+') + Math.abs(delta).toFixed(2);
  } else {
    splitGood = true;
    splitText = 'S' + (finishedSector + 1) + '  ' + elapsed.toFixed(2);
  }
  splitLeft = 2.6;

  if (elapsed < previous) sectorBest[finishedSector] = elapsed;
}

// --- Laps and the flag ---------------------------------------------------

function onPlayerLap() {
  // No lap can be quicker than the track length at top speed. A tripwire, not
  // a gameplay rule: if it fires, the lap counter has broken again. It exists
  // because last time it broke, impossible times went into the session as
  // legitimate bests and showed up as a phantom BEST LAP on every reload. A
  // number the player never set must never reach storage.
  const floor = track.length / Drive.MAX_SPEED;

  if (lapTime < floor) {
    console.warn(
      '[circuit-racer] Ignoring an impossible ' + lapTime.toFixed(2) + 's lap. '
      + 'The fastest this circuit allows is ' + floor.toFixed(2)
      + 's, so the lap counter is miscounting.',
    );
  } else {
    lapTimes.push(lapTime);
    if (lapTime < bestLap) {
      bestLap = lapTime;
      audio.play('best');
    } else {
      audio.play('lap');
    }
  }

  lapTime = 0;
  lap++;
}

function finishRace() {
  phase = PHASE.OVER;
  audio.play('finish');

  // Anyone still running is classified where they currently sit, so the
  // results always name a full field.
  for (const car of Drive.standings(cars)) {
    if (!car.finishOrder) car.finishOrder = ++finishOrder;
  }

  // Hundredths of a second as an integer: Session stores numbers, and a
  // hundredth is the resolution a lap time is quoted at.
  //
  // With no valid lap -- only reachable if the tripwire above fired -- the
  // total race time stands in. That is a real number the player actually set,
  // which a fabricated lap time would not be.
  const hasLap = Number.isFinite(bestLap);
  const score = Math.round((hasLap ? bestLap : raceTime) * 100);
  const place = player.finishOrder;

  const stats = {
    result: place === 1 ? 'Won' : 'Finished ' + Drive.ordinal(place) + ' of ' + cars.length,
    circuit: track.name,
    bestLap: hasLap ? formatTime(bestLap) : 'no valid lap',
    raceTime: formatTime(raceTime),
    sectors: sectorBest.map(s => (Number.isFinite(s) ? s.toFixed(2) : '--')).join('  '),
  };
  // Added only when it happened. Present-and-null renders as "Penalty: null",
  // which reads like a bug to the one player it is shown to.
  if (jumped) stats.penalty = 'Jump start, 3s';

  shell.showGameOver(score, stats, { variant: track.id });
}

// --- Formatting ----------------------------------------------------------

/**
 * Seconds as a lap time.
 *
 * Rounded to hundredths ONCE, up front, and everything else derived from that
 * integer. Splitting the seconds and the fraction apart first is wrong twice
 * over: flooring the fraction displayed a stored 4.55 as "4.54", because
 * 4.55 % 1 is 0.5499999999999998 in binary floating point; and rounding it
 * instead would display 4.999 as "4.100", because the hundredths carry into
 * the seconds and nothing was there to catch it.
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--.--';

  const total = Math.round(seconds * 100);      // hundredths, carried correctly
  const mins = Math.floor(total / 6000);
  const secs = Math.floor((total % 6000) / 100);
  const hundredths = String(total % 100).padStart(2, '0');

  return mins > 0
    ? mins + ':' + String(secs).padStart(2, '0') + '.' + hundredths
    : secs + '.' + hundredths;
}

// --- Draw ----------------------------------------------------------------

function render() {
  if (phase === PHASE.SETUP) {
    renderSetup();
    shell.render();
    return;
  }

  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  drawGrass();
  drawTrack();
  drawMarks();
  particles.draw(ctx);
  // Player last, so it is never hidden under a rival in a scrap.
  for (const car of cars) if (!car.isPlayer) drawCar(car);
  drawCar(player);

  ctx.restore();

  drawHud();
  if (phase === PHASE.LIGHTS || penaltyLeft > 0) drawStartGantry();

  shell.render();
}

function drawGrass() {
  ctx.fillStyle = ART.grass;
  ctx.fillRect(-20, -20, W + 40, H + 40);
  // Mown stripes, the cheapest thing that stops a flat green field reading as
  // an empty canvas.
  ctx.fillStyle = ART.grassDark;
  for (let x = -20; x < W + 40; x += 80) ctx.fillRect(x, -20, 40, H + 40);
}

function trackPath(center) {
  ctx.beginPath();
  ctx.moveTo(center[0][0], center[0][1]);
  for (let i = 1; i < center.length; i++) ctx.lineTo(center[i][0], center[i][1]);
  ctx.closePath();
}

function drawTrack() {
  const center = track.center;
  const half = track.roadHalf;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Kerbs first, as a wider stroke underneath, then the road on top of it.
  ctx.setLineDash([18, 18]);
  ctx.strokeStyle = ART.kerbA;
  ctx.lineWidth = half * 2 + 14;
  trackPath(center);
  ctx.stroke();

  ctx.lineDashOffset = 18;
  ctx.strokeStyle = ART.kerbB;
  trackPath(center);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  ctx.strokeStyle = ART.roadEdge;
  ctx.lineWidth = half * 2 + 4;
  trackPath(center);
  ctx.stroke();

  ctx.strokeStyle = ART.road;
  ctx.lineWidth = half * 2;
  trackPath(center);
  ctx.stroke();

  ctx.setLineDash([16, 26]);
  ctx.strokeStyle = ART.centerLine;
  ctx.lineWidth = 3;
  trackPath(center);
  ctx.stroke();
  ctx.setLineDash([]);

  drawStartLine();
}

/**
 * The chequered band, spanning the tarmac from one edge to the other.
 *
 * Rotated by the TANGENT, so the local axes are along-track and across-track.
 * The band then runs the full road width by construction (-roadHalf to
 * +roadHalf across) rather than by a guess that only held where the road
 * happened to be straight. tracks.js refuses to ship a circuit whose s = 0 is
 * on a bend, which is what makes that construction safe.
 */
function drawStartLine() {
  const [px, py] = track.pointAt(0);
  const [tx, ty] = track.tangentAt(0);
  const half = track.roadHalf;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(ty, tx));   // +x along the track, +y across it

  const across = 8;
  const cell = (half * 2) / across;
  for (let i = 0; i < across; i++) {
    for (let row = 0; row < 2; row++) {
      ctx.fillStyle = (i + row) % 2 === 0 ? ART.startBand : ART.startDark;
      ctx.fillRect(-cell + row * cell, -half + i * cell, cell, cell);
    }
  }
  ctx.restore();
}

function drawMarks() {
  ctx.strokeStyle = ART.tyreMark;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const mark of marks) {
    if (mark.life <= 0) continue;
    const dx = Math.cos(mark.angle) * 5;
    const dy = Math.sin(mark.angle) * 5;
    ctx.moveTo(mark.x - dx, mark.y - dy);
    ctx.lineTo(mark.x + dx, mark.y + dy);
  }
  ctx.stroke();
}

function drawCar(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  // The tow, drawn as a wash behind the car that is getting it. Legibility is
  // the whole argument for this mechanic, so it has to be visible on the car
  // and not only in the HUD.
  if (car.slip > 0.08) {
    ctx.globalAlpha = car.slip * 0.5;
    ctx.fillStyle = ART.tow;
    ctx.fillRect(-Drive.CAR_L / 2 - 16, -Drive.CAR_W / 2, 16, Drive.CAR_W);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = car.dark;
  ctx.fillRect(-Drive.CAR_L / 2 - 1, -Drive.CAR_W / 2 - 1, Drive.CAR_L + 2, Drive.CAR_W + 2);
  ctx.fillStyle = car.color;
  ctx.fillRect(-Drive.CAR_L / 2, -Drive.CAR_W / 2, Drive.CAR_L, Drive.CAR_W);

  // A windscreen towards the front, so which way the car is pointing is
  // readable at a glance even when it is stationary.
  ctx.fillStyle = ART.glass;
  ctx.fillRect(Drive.CAR_L / 2 - 11, -Drive.CAR_W / 2 + 2, 7, Drive.CAR_W - 4);

  ctx.restore();
}

// Its own HUD rather than shell.drawHud: the shell's is built around a score
// that counts up, and everything that matters here is a time. A "SCORE 2431"
// where the player expects "24.31" would be worse than no HUD at all.
function drawHud() {
  UI.roundRect(ctx, 14, 12, 300, 78, 10);
  ctx.fillStyle = ART.hudPanel;
  ctx.fill();

  // This circuit's record, not the game's. A 4.55 set on Sunset Loop is not
  // a target on The Long Way -- it is a number the player never set here and
  // on the longer circuits cannot physically beat.
  const stored = Session.getBest(GAME_ID, { variant: track.id });

  UI.text(ctx, 'LAP ' + Math.min(lap, chosenLaps) + ' / ' + chosenLaps, 28, 34, {
    size: 15, color: ART.hudLabel, font: 'display', weight: '700', baseline: 'middle',
  });
  UI.text(ctx, formatTime(lapTime), 28, 66, {
    size: 32, color: ART.hudText, font: 'mono', weight: '700', baseline: 'middle',
  });

  UI.text(ctx, 'BEST LAP', 190, 34, {
    size: 13, color: ART.hudLabel, font: 'display', baseline: 'middle',
  });
  UI.text(ctx,
    Number.isFinite(bestLap) ? formatTime(bestLap)
      : (stored !== null ? formatTime(stored / 100) : '--.--'),
    190, 64, {
      size: 22, color: ART.hudBest, font: 'mono', weight: '700', baseline: 'middle',
    });

  drawPosition();
  drawTowMeter();

  if (splitLeft > 0 && splitText) {
    UI.text(ctx, splitText, W / 2, 108, {
      size: 26, color: splitGood ? ART.hudBest : ART.hudLoss,
      font: 'mono', weight: '700', align: 'center', baseline: 'middle',
    });
  }

  if (offTrack) {
    UI.text(ctx, 'OFF TRACK', W / 2, 34, {
      size: 20, color: ART.kerbA, font: 'display', weight: '800',
      align: 'center', baseline: 'middle',
    });
  }
}

// Position while the race is happening, not only at the end -- with the whole
// field listed, so a place changing is something you can watch rather than
// something you infer.
function drawPosition() {
  const order = Drive.standings(cars);
  const place = order.indexOf(player) + 1;

  UI.roundRect(ctx, W - 158, 12, 144, 78, 10);
  ctx.fillStyle = ART.hudPanel;
  ctx.fill();

  UI.text(ctx, 'POSITION', W - 146, 32, {
    size: 13, color: ART.hudLabel, font: 'display', baseline: 'middle',
  });
  UI.text(ctx, 'P' + place, W - 146, 64, {
    size: 30, color: place === 1 ? ART.hudBest : ART.hudText,
    font: 'display', weight: '800', baseline: 'middle',
  });
  UI.text(ctx, 'of ' + cars.length, W - 92, 66, {
    size: 14, color: ART.hudLabel, font: 'display', baseline: 'middle',
  });

  // The running order as a column of coloured pips, leader at the top.
  order.forEach((car, i) => {
    const y = 26 + i * 14;
    ctx.fillStyle = car.color;
    ctx.fillRect(W - 34, y, 18, 9);
    if (car.isPlayer) {
      ctx.strokeStyle = ART.hudText;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - 35, y - 1, 20, 11);
    }
  });
}

function drawTowMeter() {
  if (player.slip < 0.05) return;
  const w = 150;
  const x = W / 2 - w / 2;

  UI.text(ctx, 'TOW', x - 12, H - 34, {
    size: 14, color: ART.tow, font: 'display', weight: '800',
    align: 'right', baseline: 'middle',
  });
  UI.roundRect(ctx, x, H - 40, w, 12, 6);
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fill();
  UI.roundRect(ctx, x, H - 40, w * clamp(player.slip, 0, 1), 12, 6);
  ctx.fillStyle = ART.tow;
  ctx.fill();
}

/** Five reds, then nothing -- and the jump-start verdict underneath. */
function drawStartGantry() {
  const lit = Math.min(LIGHTS, Math.floor(lightsTime / LIGHT_GAP));
  const out = phase !== PHASE.LIGHTS;
  const spacing = 46;
  const left = W / 2 - ((LIGHTS - 1) * spacing) / 2;

  // Centred on the canvas, not near the start line. Every circuit loops
  // around the middle, so the infield is the one place a panel can sit
  // without covering the grid it is counting down.
  const top = H / 2 - 31;

  UI.roundRect(ctx, W / 2 - 150, top, 300, 62, 12);
  ctx.fillStyle = 'rgba(12,14,12,.8)';
  ctx.fill();

  for (let i = 0; i < LIGHTS; i++) {
    ctx.beginPath();
    ctx.arc(left + i * spacing, top + 31, 15, 0, TAU);
    ctx.fillStyle = out ? ART.lightOff : (i < lit ? ART.lightOn : ART.lightOff);
    ctx.fill();
  }

  if (penaltyLeft > 0) {
    UI.text(ctx, 'JUMP START', W / 2, top + 96, {
      size: 30, color: ART.kerbA, font: 'display', weight: '800',
      align: 'center', baseline: 'middle',
    });
    UI.text(ctx, 'held ' + penaltyLeft.toFixed(1) + 's', W / 2, top + 128, {
      size: 18, color: ART.hudText, font: 'mono', align: 'center', baseline: 'middle',
    });
  } else if (phase === PHASE.LIGHTS && lit >= LIGHTS) {
    UI.text(ctx, 'wait for it', W / 2, top + 96, {
      size: 18, color: ART.hudLabel, font: 'display',
      align: 'center', baseline: 'middle',
    });
  }
}

// --- Setup screen drawing ------------------------------------------------

function renderSetup() {
  drawGrass();

  UI.roundRect(ctx, 32, 40, W - 64, H - 80, 16);
  ctx.fillStyle = ART.panel;
  ctx.fill();
  ctx.strokeStyle = ART.panelEdge;
  ctx.lineWidth = 2;
  ctx.stroke();

  UI.text(ctx, 'Pick your race', W / 2, 74, {
    size: 26, color: ART.hudText, font: 'display', weight: '800',
    align: 'center', baseline: 'middle',
  });

  setupLayout().forEach((row, index) => {
    if (row.label) {
      UI.text(ctx, row.label, 56, row.y - 14, {
        size: 15, color: ART.hudLabel, font: 'display', weight: '700', baseline: 'middle',
      });
    }
    for (const chip of row.chips) drawChip(chip, setupRow === index);
  });

  const difficulty = Drive.difficultyById(chosenDifficulty);
  const circuit = TRACKS.find(t => t.id === chosenTrack) || TRACKS[0];
  UI.text(ctx, circuit.blurb, W / 2, 434, {
    size: 15, color: ART.hudLabel, align: 'center', baseline: 'middle',
  });
  UI.text(ctx, difficulty.blurb, W / 2, 546, {
    size: 15, color: ART.hudBest, align: 'center', baseline: 'middle',
  });
}

function drawChip(chip, rowFocused) {
  UI.roundRect(ctx, chip.x, chip.y, chip.w, chip.h, 10);
  ctx.fillStyle = chip.on ? ART.chipOn : ART.chip;
  ctx.fill();

  // The outline marks where the cursor is, so it goes on the chosen chip of
  // the focused row only -- outlining a whole row reads as everything in it
  // being selected.
  if (rowFocused && chip.on) {
    ctx.strokeStyle = ART.hudText;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const ink = chip.on ? ART.chipInkOn : ART.chipInk;

  if (chip.glyph) {
    drawTrackGlyph(chip.glyph, chip.x + 10, chip.y + 8, chip.w - 20, chip.h - 34, ink);
    UI.text(ctx, chip.label, chip.x + chip.w / 2, chip.y + chip.h - 15, {
      size: 15, color: ink, font: 'display', weight: '700',
      align: 'center', baseline: 'middle',
    });
    return;
  }

  UI.text(ctx, chip.label, chip.x + chip.w / 2, chip.y + chip.h / 2, {
    size: chip.h > 56 ? 24 : 19, color: ink, font: 'display', weight: '700',
    align: 'center', baseline: 'middle',
  });
}

/**
 * The circuit itself, scaled into a chip.
 *
 * Because the tracks are data, this is the same point list the race is driven
 * on -- so the shape on the button is exactly the shape you get, and adding a
 * fifth circuit to tracks.js gives it a picture for free.
 */
function drawTrackGlyph(data, x, y, w, h, color) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of data.center) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }

  const scale = Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.86;
  const offX = x + w / 2 - ((minX + maxX) / 2) * scale;
  const offY = y + h / 2 - ((minY + maxY) / 2) * scale;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  data.center.forEach(([px, py], i) => {
    const gx = offX + px * scale;
    const gy = offY + py * scale;
    if (i === 0) ctx.moveTo(gx, gy);
    else ctx.lineTo(gx, gy);
  });
  ctx.closePath();

  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(4, data.roadHalf * 2 * scale);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
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
  title: 'Circuit Racer',
  canvas: screen,
  loop,
  audio,
  onRestart: () => { phase = PHASE.SETUP; setupRow = 0; },
  controls: [
    { action: 'Point the car', gamepad: 'Left stick — the direction on screen', keyboard: 'Arrows or WASD', touch: 'Drag the left side' },
    { action: 'Accelerate', gamepad: 'Right trigger', keyboard: 'Space', touch: 'Gas pad' },
    { action: 'Brake', gamepad: 'Left trigger', keyboard: 'Shift', touch: 'Brake pad' },
    { action: 'Slipstream', gamepad: 'Tuck in behind a rival', keyboard: 'Tuck in behind a rival', touch: 'Tuck in behind a rival' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

loop.start();
shell.showTitle({
  name: 'Circuit Racer',
  tagline: 'Four circuits, three rivals, one line through the corner.',
});
