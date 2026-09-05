// games/circuit-racer/game.js
//
// Circuit Racer — three laps of a top-down circuit against an AI that holds
// its line and moves to block yours.
//
// THE ONE GAME WHERE LOWER IS BETTER
// ----------------------------------
// Every other game in the suite scores upward: more depth, more points, more
// words. This one is timed, so the best run is the SMALLEST number, and it
// registers that with Session.setScoreDirection(GAME_ID, 'low'). Everything
// that ranks — the arcade's best-this-visit line, the tournament standings —
// reads that direction rather than assuming. Getting it wrong would quietly
// hand the trophy to whoever drove worst.
//
// UNITS: seconds, per the engine doctrine. Distances are units, speeds
// units/sec, accelerations units/sec².

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { UI } from '../../engine/ui.js';
import { ParticleSystem, clamp, randRange as R } from '../../engine/util.js';

const GAME_ID = 'circuit-racer';

const W = 960;
const H = 600;
const TAU = Math.PI * 2;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, kept in one place rather than scattered through
// the draw calls. Deliberately NOT from tokens.css: those tokens are the
// site's chrome.
//
// Daylight circuit — grass, asphalt, painted kerbs. Distinct from the other
// four: Updraft is night sky, Comet a black void, Sinkhole a cave, Number
// Crunch deep space. This one is the only game that happens outdoors in the
// afternoon.
const ART = {
  grass: '#3e6b3a',
  grassDark: '#355c32',
  road: '#4a4a4f',
  roadEdge: '#6a6a70',
  kerbA: '#d6453f',
  kerbB: '#f2f2f2',
  centerLine: 'rgba(255,255,255,.22)',

  startBand: '#f2f2f2',
  startDark: '#2b2b2f',

  player: '#ffc93c',
  playerDark: '#c9922a',
  rival: '#4da3ff',
  rivalDark: '#2c6fbd',
  glass: 'rgba(20,24,32,.75)',

  hudPanel: 'rgba(24,26,24,.72)',
  hudText: '#f5f1e8',
  hudLabel: 'rgba(245,241,232,.6)',
  hudBest: '#8be08b',

  dust: '#c7bda4',
  smoke: 'rgba(230,230,230,.5)',
};

// --- Track ---------------------------------------------------------------
//
// A closed centre line. Everything else — the road, the kerbs, where the car
// is on the lap, whether it is on the tarmac at all — is derived from it, so
// the track is one list of points rather than four descriptions that could
// disagree with each other.
const CENTER = [
  [190, 150], [340, 108], [520, 100], [680, 130], [800, 210],
  [852, 320], [820, 430], [700, 494], [540, 512], [400, 496],
  [300, 440], [268, 350], [300, 268], [232, 214],
];

const ROAD_HALF = 52;

// Cumulative distance to each point, and the total, computed once. The lap
// position of a car is a distance along this, which is what makes "who is
// ahead" a single subtraction rather than a special case per corner.
const SEG = [];
let TRACK_LENGTH = 0;
for (let i = 0; i < CENTER.length; i++) {
  const a = CENTER[i];
  const b = CENTER[(i + 1) % CENTER.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  SEG.push({ a, b, length, start: TRACK_LENGTH });
  TRACK_LENGTH += length;
}

/**
 * Closest point on the centre line, as a distance around the lap.
 *
 * @returns {{ s: number, dist: number }} s is metres around the loop, dist is
 *          how far off the centre line the point is — which is all the
 *          off-track test needs.
 */
function projectToTrack(x, y) {
  let best = { s: 0, dist: Infinity };

  for (const seg of SEG) {
    const dx = seg.b[0] - seg.a[0];
    const dy = seg.b[1] - seg.a[1];
    const lengthSq = dx * dx + dy * dy || 1;
    let t = ((x - seg.a[0]) * dx + (y - seg.a[1]) * dy) / lengthSq;
    t = clamp(t, 0, 1);
    const px = seg.a[0] + dx * t;
    const py = seg.a[1] + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < best.dist) best = { s: seg.start + seg.length * t, dist };
  }

  return best;
}

// A point a given distance around the lap, for the AI's look-ahead.
function pointAt(s) {
  let d = ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  for (const seg of SEG) {
    if (d <= seg.length) {
      const t = seg.length > 0 ? d / seg.length : 0;
      return [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t];
    }
    d -= seg.length;
  }
  return CENTER[0];
}

// Perpendicular to the track at a distance around the lap, so a car can be
// offset sideways from the centre line without leaving it.
function normalAt(s) {
  const [ax, ay] = pointAt(s);
  const [bx, by] = pointAt(s + 12);
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 200 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.88, yRatio: 0.80, radius: 52, label: 'Gas' },
]);

// THE POINT OF THIS GAME, as far as the rest of the suite is concerned.
// A lap time is better when it is smaller.
Session.setScoreDirection(GAME_ID, 'low');

audio.define({
  engine: { beep: { freq: 110, duration: 0.08, type: 'sawtooth', volume: 0.05 } },
  kerb: { beep: { freq: 260, duration: 0.04, type: 'square', volume: 0.08 } },
  lap: { beep: { freq: 900, duration: 0.18, type: 'triangle', volume: 0.2 } },
  best: { beep: { freq: 1200, duration: 0.26, type: 'triangle', volume: 0.22 } },
  finish: { beep: { freq: 520, duration: 0.5, type: 'square', volume: 0.24 } },
});

// --- Tuning --------------------------------------------------------------

const TOTAL_LAPS = 3;

const ACCEL = 430;             // units/sec²
const BRAKE = 620;
const ROLL_DRAG = 0.55;        // fraction of speed kept per second, coasting
const MAX_SPEED = 395;
const OFF_TRACK_MAX = 165;     // grass is slow, which is the whole penalty
const OFF_TRACK_DRAG = 0.12;
const TURN_RATE = 2.9;         // radians/sec at full lock

const CAR_L = 26;
const CAR_W = 15;

// --- State ---------------------------------------------------------------

let raceTime = 0;
let lapTime = 0;
let lap = 1;
let bestLap = Infinity;
let lapTimes = [];
let finished = false;
let countdown = 3;             // seconds before the lights go out
let offTrack = false;

const player = makeCar(ART.player, ART.playerDark);
const rival = makeCar(ART.rival, ART.rivalDark);

function makeCar(color, dark) {
  return {
    x: 0, y: 0, angle: 0, speed: 0,
    s: 0, travelled: 0, laps: 0,
    offset: 0, targetOffset: 0,
    color, dark,
  };
}

/**
 * Puts a car on the grid JUST PAST the start line, not behind it.
 *
 * Behind the line looks more like a real grid, but it means the car's very
 * first movement crosses the line and banks a lap it never drove — which
 * showed up as a three-lap race finishing with a lap time faster than the
 * track length divided by the top speed. Starting past the line makes the
 * first crossing the genuine end of lap one.
 */
function placeOnGrid(car, offsetAcross, ahead) {
  const s = ahead;
  const [px, py] = pointAt(s);
  const [nx, ny] = normalAt(s);
  const [ax, ay] = pointAt(s);
  const [bx, by] = pointAt(s + 12);
  car.x = px + nx * offsetAcross;
  car.y = py + ny * offsetAcross;
  car.angle = Math.atan2(by - ay, bx - ax);
  car.speed = 0;
  car.s = projectToTrack(car.x, car.y).s;
  car.travelled = car.s;
  car.laps = 0;
}

function reset() {
  raceTime = 0;
  lapTime = 0;
  lap = 1;
  bestLap = Infinity;
  lapTimes = [];
  finished = false;
  countdown = 3;
  offTrack = false;
  particles.clear();

  placeOnGrid(player, -18, 30);
  placeOnGrid(rival, 18, 74);
  rival.offset = 18;
  rival.targetOffset = 18;
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;
  if (finished) return;

  if (countdown > 0) {
    countdown -= dt;
    // Engines idle on the grid; nothing moves until the lights go out.
    return;
  }

  raceTime += dt;
  lapTime += dt;

  drivePlayer(dt);
  driveRival(dt);
  particles.update(dt);
}

function drivePlayer(dt) {
  const pad = Input.get();

  // Up on the stick or the A button is throttle, down is the brake. Reading
  // both means the virtual joystick, a d-pad and a gamepad face button all
  // drive the car without any of them being the "real" control.
  const throttle = (pad.y < -0.15 ? -pad.y : 0) + (pad.a || pad.rt ? 1 : 0);
  const braking = pad.y > 0.15 ? pad.y : 0;

  applyDrive(player, clamp(throttle, 0, 1), braking, pad.x, dt);
}

function applyDrive(car, throttle, braking, steer, dt) {
  const projected = projectToTrack(car.x, car.y);
  const onGrass = projected.dist > ROAD_HALF;

  if (car === player) {
    if (onGrass && !offTrack) audio.play('kerb');
    offTrack = onGrass;
  }

  const topSpeed = onGrass ? OFF_TRACK_MAX : MAX_SPEED;

  car.speed += throttle * ACCEL * dt;
  car.speed -= braking * BRAKE * dt;

  // Coasting drag, plus a much heavier one on the grass. Both are
  // exponential so they behave the same at any frame rate.
  const drag = onGrass ? OFF_TRACK_DRAG : ROLL_DRAG;
  if (throttle === 0) car.speed *= drag ** dt;
  car.speed = clamp(car.speed, -110, topSpeed);

  // Steering scales with speed: a stationary car cannot pivot on the spot,
  // which is what stops the whole thing feeling like a twin-stick shooter.
  const grip = clamp(Math.abs(car.speed) / 180, 0, 1);
  car.angle += steer * TURN_RATE * grip * dt * Math.sign(car.speed || 1);

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  // The world is a closed circuit, but the canvas is not: keep cars on it.
  car.x = clamp(car.x, 10, W - 10);
  car.y = clamp(car.y, 10, H - 10);

  if (onGrass && Math.abs(car.speed) > 60 && Math.random() < dt * 22) {
    particles.emit(car.x, car.y, {
      count: 1, colors: [ART.dust], speed: [20, 70], life: [0.2, 0.5],
      size: [2, 4], shape: 'circle', shrink: true,
    });
  }

  advanceLap(car, projectToTrack(car.x, car.y).s);
}

// The furthest a car can legitimately move along the track in one step, with
// room for the loop's own dt clamp. Anything larger is the projection
// snapping, not the car moving.
const MAX_STEP = MAX_SPEED * 0.06;

/**
 * Lap counting by DISTANCE TRAVELLED, not by crossing a line.
 *
 * Three approaches, and only the third survives contact with the track:
 *
 *   A trigger line can be missed at speed, or clipped twice in one corner.
 *
 *   Watching the lap position wrap past a threshold looks robust and is not.
 *   projectToTrack() returns the nearest point on the WHOLE centre line, so
 *   a car cutting a corner across the infield can be nearest to a part of
 *   the loop it has not reached yet. That reads as a wrap, and it banked a
 *   3.9-second lap on a circuit whose fastest possible lap is 4.5.
 *
 *   Accumulating the small, wrapped, frame-by-frame change cannot do that: a
 *   jump bigger than a car can travel in one step is rejected as a snap
 *   rather than counted as progress. It also handles reversing for free,
 *   since driving backwards subtracts from the total.
 */
function advanceLap(car, s) {
  let delta = s - car.s;
  if (delta > TRACK_LENGTH / 2) delta -= TRACK_LENGTH;
  if (delta < -TRACK_LENGTH / 2) delta += TRACK_LENGTH;

  if (Math.abs(delta) < MAX_STEP) car.travelled += delta;
  car.s = s;

  const laps = Math.floor(car.travelled / TRACK_LENGTH);
  if (laps > car.laps) {
    car.laps = laps;
    if (car === player) onPlayerLap();
  } else if (laps < car.laps) {
    car.laps = laps;
  }
}

function onPlayerLap() {
  lapTimes.push(lapTime);

  if (lapTime < bestLap) {
    bestLap = lapTime;
    audio.play('best');
  } else {
    audio.play('lap');
  }

  lapTime = 0;
  lap++;

  if (lap > TOTAL_LAPS) finishRace();
}

function finishRace() {
  finished = true;
  audio.play('finish');

  // Hundredths of a second as an integer: Session stores numbers, and a
  // hundredth is the resolution a lap time is actually quoted at.
  const score = Math.round(bestLap * 100);

  shell.showGameOver(score, {
    bestLap: formatTime(bestLap),
    totalTime: formatTime(raceTime),
    everyLap: lapTimes.map(formatTime).join('  '),
    result: player.laps >= rival.laps && raceTime > 0
      ? (rivalAhead() ? 'Rival won' : 'You won')
      : 'You won',
  });
}

function rivalAhead() {
  return rival.laps * TRACK_LENGTH + rival.s > player.laps * TRACK_LENGTH + player.s;
}

// --- The rival -----------------------------------------------------------

/**
 * Follows the racing line, and moves across to defend it.
 *
 * Look-ahead steering rather than waypoint-chasing: it aims at a point some
 * distance further round the track, which is what makes it turn INTO a
 * corner early instead of arriving at the apex and then noticing it.
 */
function driveRival(dt) {
  const lookAhead = 70 + Math.abs(rival.speed) * 0.35;
  const target = rival.s + lookAhead;

  // Defending. When the player is close behind and off to one side, the
  // rival drifts to that side to sit in front of them. It gives up when the
  // player is alongside, because blocking then is just a collision.
  const gap = (player.laps * TRACK_LENGTH + player.s) - (rival.laps * TRACK_LENGTH + rival.s);
  const playerOffset = sideOfTrack(player);
  if (gap < 0 && gap > -170) {
    rival.targetOffset = clamp(playerOffset, -26, 26);
  } else {
    rival.targetOffset = 0;
  }
  rival.offset += (rival.targetOffset - rival.offset) * (1 - Math.exp(-dt * 1.6));

  const [tx, ty] = pointAt(target);
  const [nx, ny] = normalAt(target);
  const aimX = tx + nx * rival.offset;
  const aimY = ty + ny * rival.offset;

  const desired = Math.atan2(aimY - rival.y, aimX - rival.x);
  let turn = desired - rival.angle;
  while (turn > Math.PI) turn -= TAU;
  while (turn < -Math.PI) turn += TAU;

  // Slows for corners by easing off when it is having to turn hard, which is
  // the same thing a driver does and costs nothing to compute.
  const cornering = Math.min(Math.abs(turn) / 0.7, 1);
  const throttle = clamp(1 - cornering * 0.75, 0.25, 1);

  applyDrive(rival, throttle, 0, clamp(turn * 1.9, -1, 1), dt);
}

// How far off the centre line a car is, signed left/right.
function sideOfTrack(car) {
  const projected = projectToTrack(car.x, car.y);
  const [px, py] = pointAt(projected.s);
  const [nx, ny] = normalAt(projected.s);
  return (car.x - px) * nx + (car.y - py) * ny;
}

// --- Formatting ----------------------------------------------------------

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '--.--';
  const mins = Math.floor(seconds / 60);
  const rest = seconds - mins * 60;
  const secs = String(Math.floor(rest)).padStart(2, '0');
  const hundredths = String(Math.floor((rest % 1) * 100)).padStart(2, '0');
  return mins > 0 ? `${mins}:${secs}.${hundredths}` : `${Math.floor(rest)}.${hundredths}`;
}

// --- Draw ----------------------------------------------------------------

function render() {
  drawGrass();
  drawTrack();
  particles.draw(ctx);
  drawCar(rival);
  drawCar(player);
  drawHud();

  if (countdown > 0) drawCountdown();

  shell.render();
}

function drawGrass() {
  ctx.fillStyle = ART.grass;
  ctx.fillRect(0, 0, W, H);
  // Mown stripes, which is the cheapest thing that stops a flat green field
  // reading as an empty canvas.
  ctx.fillStyle = ART.grassDark;
  for (let x = 0; x < W; x += 80) ctx.fillRect(x, 0, 40, H);
}

function trackPath() {
  ctx.beginPath();
  ctx.moveTo(CENTER[0][0], CENTER[0][1]);
  for (let i = 1; i < CENTER.length; i++) ctx.lineTo(CENTER[i][0], CENTER[i][1]);
  ctx.closePath();
}

function drawTrack() {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Kerbs first, as a wider stroke underneath, then the road on top of it.
  ctx.setLineDash([18, 18]);
  ctx.strokeStyle = ART.kerbA;
  ctx.lineWidth = ROAD_HALF * 2 + 14;
  trackPath();
  ctx.stroke();

  ctx.lineDashOffset = 18;
  ctx.strokeStyle = ART.kerbB;
  trackPath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  ctx.strokeStyle = ART.roadEdge;
  ctx.lineWidth = ROAD_HALF * 2 + 4;
  trackPath();
  ctx.stroke();

  ctx.strokeStyle = ART.road;
  ctx.lineWidth = ROAD_HALF * 2;
  trackPath();
  ctx.stroke();

  ctx.setLineDash([16, 26]);
  ctx.strokeStyle = ART.centerLine;
  ctx.lineWidth = 3;
  trackPath();
  ctx.stroke();
  ctx.setLineDash([]);

  drawStartLine();
}

function drawStartLine() {
  const [px, py] = pointAt(0);
  const [nx, ny] = normalAt(0);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(ny, nx));

  const squares = 8;
  const size = (ROAD_HALF * 2) / squares;
  for (let i = 0; i < squares; i++) {
    for (let row = 0; row < 2; row++) {
      ctx.fillStyle = (i + row) % 2 === 0 ? ART.startBand : ART.startDark;
      ctx.fillRect(-ROAD_HALF + i * size, -size + row * size, size, size);
    }
  }
  ctx.restore();
}

function drawCar(car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  ctx.fillStyle = car.dark;
  ctx.fillRect(-CAR_L / 2 - 1, -CAR_W / 2 - 1, CAR_L + 2, CAR_W + 2);
  ctx.fillStyle = car.color;
  ctx.fillRect(-CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W);

  // A windscreen towards the front, so which way the car is pointing is
  // readable at a glance even when it is stationary.
  ctx.fillStyle = ART.glass;
  ctx.fillRect(CAR_L / 2 - 11, -CAR_W / 2 + 2, 7, CAR_W - 4);

  ctx.restore();
}

// Its own HUD rather than shell.drawHud: the shell's is built around a score
// that counts up, and everything that matters here is a time. A "SCORE 2431"
// where the player expects "24.31" would be worse than no HUD at all.
function drawHud() {
  const panelW = 300;
  UI.roundRect(ctx, 14, 12, panelW, 78, 10);
  ctx.fillStyle = ART.hudPanel;
  ctx.fill();

  const shown = Session.getBest(GAME_ID);

  UI.text(ctx, `LAP ${Math.min(lap, TOTAL_LAPS)} / ${TOTAL_LAPS}`, 28, 34, {
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
      : (shown !== null ? formatTime(shown / 100) : '--.--'),
    190, 64, {
      size: 22, color: ART.hudBest, font: 'mono', weight: '700', baseline: 'middle',
    });

  if (offTrack) {
    UI.text(ctx, 'OFF TRACK', W / 2, 34, {
      size: 20, color: ART.kerbA, font: 'display', weight: '800',
      align: 'center', baseline: 'middle',
    });
  }
}

function drawCountdown() {
  const n = Math.ceil(countdown);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = ART.startDark;
  ctx.fillRect(0, H / 2 - 70, W, 140);
  ctx.restore();

  UI.text(ctx, n > 0 ? String(n) : 'GO', W / 2, H / 2, {
    size: 76, color: n > 0 ? ART.hudText : ART.hudBest, font: 'display', weight: '800',
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
  title: 'Circuit Racer',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Steer', gamepad: 'Left stick or D-pad', keyboard: 'Left / Right', touch: 'Drag the left side' },
    { action: 'Accelerate', gamepad: 'A, RT, or stick up', keyboard: 'Up arrow or W', touch: 'Gas button' },
    { action: 'Brake', gamepad: 'Stick down', keyboard: 'Down arrow or S', touch: 'Drag down' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Circuit Racer', tagline: 'Three laps. Hold your line.' });
