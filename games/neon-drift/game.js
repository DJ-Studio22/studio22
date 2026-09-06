// games/neon-drift/game.js
//
// Neon Drift Delivery — a courier run through traffic that is trying to drive
// properly rather than trying to be in your way.
//
// THE LOOP
// --------
// A clock is always running down. A drop point is always somewhere ahead, on
// the left shoulder or the right. Reaching it buys you time and puts the next
// one further away. Miss one and the run is over — there is no life system and
// no second chance, because the clock IS the life bar and having both would
// mean neither mattered.
//
// WHAT THERE IS TO MASTER BEYOND STEERING
// ---------------------------------------
// Boost is the whole game, and you cannot buy it — you can only earn it by
// squeezing past traffic. Passing a car within a hand's width charges the
// meter and builds a combo; touching one loses both. So the fast line and the
// safe line are the same line, taken at different distances, and the entire
// difficulty curve is really a question about how close you are willing to
// pass.
//
// The handbrake is the other half. It trades forward speed for a sharp step
// sideways, which is how you take a gap that opened too late, and how you get
// onto a drop pad you had almost gone past. It also charges the meter a little
// while the car is actually sliding, so a driver who commits is rewarded twice.
//
// Traffic behaviour lives in traffic.js and is documented there.

import { GameCanvas } from '../../engine/canvas.js';
import { GameLoop } from '../../engine/loop.js';
import { GameShell } from '../../engine/shell.js';
import { Input } from '../../engine/input.js';
import { Session } from '../../engine/session.js';
import { AudioManager } from '../../engine/audio.js';
import { ParticleSystem, clamp, randInt, randRange } from '../../engine/util.js';
import { Traffic } from './traffic.js';

const GAME_ID = 'neon-drift';

// --- Road geometry -------------------------------------------------------

const W = 480;
const H = 720;
const LANE_COUNT = 4;
const LANE_W = 85;
const ROAD_LEFT = 70;
const ROAD_RIGHT = ROAD_LEFT + LANE_COUNT * LANE_W;   // 410
const SHOULDER = 34;                                   // drivable, but it bites

// The player sits low on the screen so most of the canvas is the road ahead.
// Reaction time is view distance, and view distance is this number.
const EYE_Y = H * 0.74;

const laneX = (lane) => ROAD_LEFT + LANE_W * (lane + 0.5);

// --- Car handling --------------------------------------------------------

const CRUISE_BASE = 330;
const CRUISE_PER_DROP = 11;      // the job gets faster as it goes on
const SPEED_MIN = 130;
const BOOST_SPEED = 640;
const ACCEL = 210;
const BRAKE = 430;
const OFF_ROAD_DRAG = 150;       // below ACCEL, so the verge slows you rather than stopping you

const STEER_ACCEL = 2600;
const STEER_MAX = 300;
const STEER_MAX_SLIDE = 620;
const STEER_DAMP_PER_SECOND = 0.0004;

// The handbrake: a hard step sideways bought with forward speed.
const SLIDE_SPEED_COST = 260;    // per second, while held and actually turning

// --- Boost ---------------------------------------------------------------

const CHARGE_MAX = 100;
const CHARGE_PER_NEAR_MISS = 15;
const CHARGE_PER_SLIDE_SECOND = 7;
const BOOST_DRAIN = 42;

// --- Near misses ---------------------------------------------------------
//
// Measured edge to edge, so a lorry is as hard to squeeze past as it looks.
const NEAR_MISS_GAP = 30;
const NEAR_MISS_MIN_SPEED = 300;
const COMBO_WINDOW = 3.2;

// --- The job -------------------------------------------------------------

const START_TIME = 22;
const FIRST_DROP_DISTANCE = 1100;
const DROP_DISTANCE_STEP = 240;
const TIME_BONUS_FIRST = 15;
const TIME_BONUS_DECAY = 0.55;
const TIME_BONUS_FLOOR = 6.5;
const CRASH_TIME_COST = 4;

const PAD_HALF_LENGTH = 58;

// --- Scoring -------------------------------------------------------------

const SCORE_PER_DISTANCE = 0.1;
const SCORE_PER_NEAR_MISS = 25;
const SCORE_PER_DELIVERY = 500;
const SCORE_PER_SECOND_SPARE = 10;

// --- Art palette ---------------------------------------------------------
//
// This game's own colours, deliberately NOT from tokens.css. The site's warm
// charcoal and amber are the arcade around the game; this is a wet city at
// night and it needs to be allowed to be one. The shell still draws its pause,
// game over and HUD in site tokens straight over the top, which is what keeps
// it recognisably Studio 22.
//
// Grouped by subject rather than flat: a road, a skyline, a set of cars and a
// readout are four different things and naming them in one bag would give
// colours like `pink3`.
const ART = {
  night: {
    skyTop: '#05030f',
    skyBottom: '#140a26',
    haze: 'rgba(120,60,200,.16)',
    star: 'rgba(200,220,255,.55)',
  },
  city: {
    blockNear: '#0d0820',
    blockFar: '#0a0618',
    edge: '#2a1a4a',
    windowWarm: 'rgba(255,190,120,.85)',
    windowCool: 'rgba(120,220,255,.75)',
  },
  road: {
    surface: '#15121c',
    shoulder: '#241c30',
    rumble: '#3a2a4a',
    laneDash: 'rgba(230,230,255,.55)',
    edgeLine: 'rgba(255,120,200,.65)',
    centreLine: '#ffd166',
  },
  cars: {
    // Traffic bodies. Muted next to the player so the road reads as background
    // and the thing you steer reads as foreground.
    bodies: ['#3f4a6b', '#5a3f6b', '#3f6b5e', '#6b4a3f', '#4a5a7a', '#6b3f52'],
    roof: 'rgba(0,0,0,.34)',
    tail: '#ff3a3a',
    head: 'rgba(255,245,210,.9)',
    headBeam: 'rgba(255,245,210,.10)',
    indicator: '#ffb020',
    lorryBody: '#2f3a52',
  },
  player: {
    body: '#28e0ff',
    bodyBoost: '#fff27a',
    roof: 'rgba(0,20,30,.45)',
    trim: '#ff3d9a',
    tail: '#ff3d9a',
    head: 'rgba(220,250,255,.95)',
    flame: '#ffd166',
    flameHot: '#fff6c9',
    smoke: 'rgba(200,200,220,.5)',
  },
  drop: {
    pad: 'rgba(40,224,255,.18)',
    padEdge: '#28e0ff',
    padText: '#ffffff',
    arrow: '#28e0ff',
    far: 'rgba(40,224,255,.45)',
  },
  cone: {
    body: '#ff7a1a',
    band: '#ffffff',
    base: 'rgba(0,0,0,.4)',
  },
  hud: {
    label: 'rgba(255,255,255,.55)',
    value: '#ffffff',
    meterBack: 'rgba(255,255,255,.10)',
    meterFill: '#28e0ff',
    meterFull: '#ffd166',
    combo: '#ff3d9a',
    warn: '#ff4d4d',
    good: '#5ef2a0',
  },
};

// --- Engine wiring -------------------------------------------------------

const screen = new GameCanvas({ width: W, height: H });
const ctx = screen.ctx;
const audio = new AudioManager();
const particles = new ParticleSystem({ max: 300 });

Input.setTouchLayout([
  { name: 'a', xRatio: 0.90, yRatio: 0.84, radius: 50, label: 'Boost' },
  { name: 'b', xRatio: 0.72, yRatio: 0.92, radius: 42, label: 'Slide' },
]);

Session.setScoreDirection(GAME_ID, 'high');

audio.define({
  engine: { beep: { freq: 90, duration: 0.08, type: 'sawtooth', volume: 0.05 } },
  nearMiss: { beep: { freq: 900, duration: 0.06, type: 'square', volume: 0.12 } },
  boost: { beep: { freq: 320, duration: 0.2, type: 'sawtooth', volume: 0.14 } },
  slide: { beep: { freq: 240, duration: 0.12, type: 'sawtooth', volume: 0.1 } },
  crash: { beep: { freq: 110, duration: 0.3, type: 'sawtooth', volume: 0.3 } },
  deliver: { beep: { freq: 720, duration: 0.28, type: 'square', volume: 0.24 } },
  warn: { beep: { freq: 420, duration: 0.1, type: 'triangle', volume: 0.16 } },
  over: { beep: { freq: 80, duration: 0.6, type: 'triangle', volume: 0.26 } },
});

const traffic = new Traffic({
  max: 26,
  laneCount: LANE_COUNT,
  laneX,
  colors: ART.cars.bodies,
});

// --- State ---------------------------------------------------------------

// The player is shaped like a traffic car on purpose: traffic.js reasons about
// it with the same fields it uses for its own, which is what lets the other
// drivers treat it as one of them.
const car = {
  x: laneX(1), y: 0, speed: CRUISE_BASE, lane: 1,
  vx: 0, w: 34, h: 60, tilt: 0,
};

let score = 0;
let timeLeft = START_TIME;
let deliveries = 0;
let charge = 0;
let boosting = false;
let sliding = false;
let braking = false;
// Throttles the "no boost" callout so holding an empty trigger does not
// machine-gun it.
let emptyBoostSaid = 0;
let combo = 0;
let comboTimer = 0;
let bestCombo = 0;
let nearMisses = 0;
let crashes = 0;
let invulnerable = 0;
let shakeTime = 0;
let running = false;
let lowTimeBeep = 0;

let drop = null;         // { y, side, sideX }
let cones = [];          // roadworks: { y, lane, length }
const floaters = [];     // short-lived "+250" style callouts
const stars = [];
const blocks = [];       // the skyline, both sides

// --- Setup helpers -------------------------------------------------------

// The job gets longer and the payment for it smaller, without limit. There is
// no final delivery: eventually a drop is further away than the clock can
// reach, and where that happens is the score.
function dropDistance() {
  return FIRST_DROP_DISTANCE + deliveries * DROP_DISTANCE_STEP;
}

function timeBonus() {
  return Math.max(TIME_BONUS_FLOOR, TIME_BONUS_FIRST - deliveries * TIME_BONUS_DECAY);
}

function cruiseSpeed() {
  return CRUISE_BASE + deliveries * CRUISE_PER_DROP;
}

// How many lanes on the left have been given over to oncoming traffic. Held to
// two so there is always half a road to work with.
function oncomingLanes() {
  if (deliveries < 4) return 0;
  return deliveries < 9 ? 1 : 2;
}

function trafficDensity() {
  return Math.min(22, 6 + deliveries * 1.1);
}

// The pad is proper surface: standing on it is not "off road".
function isOnPad() {
  return Boolean(drop)
    && Math.abs(drop.y - car.y) < PAD_HALF_LENGTH
    && Math.abs(drop.x - car.x) < SHOULDER;
}

function placeDrop() {
  const side = Math.random() < 0.5 ? -1 : 1;
  drop = {
    y: car.y + dropDistance(),
    side,
    x: side < 0 ? ROAD_LEFT - SHOULDER / 2 : ROAD_RIGHT + SHOULDER / 2,
  };
}

// Roadworks: a run of cones closing part of a lane. Only from the sixth drop,
// because a closed lane on an empty road is scenery and on a busy one is a
// genuine problem — and the road is not busy until then.
function maybeAddRoadworks() {
  if (deliveries < 6) return;
  if (cones.length > 3) return;
  if (Math.random() > 0.55) return;

  const lane = randInt(oncomingLanes(), LANE_COUNT - 1);
  cones.push({
    y: car.y + randRange(700, 1400),
    lane,
    length: randRange(180, 340),
  });
}

// --- Floating callouts ---------------------------------------------------
//
// Pooled rather than allocated: these fire several times a second during a
// good run, which is exactly the case CLAUDE.md asks to be pooled.
for (let i = 0; i < 16; i++) {
  floaters.push({ active: false, x: 0, y: 0, life: 0, text: '', color: '#fff' });
}

function floater(x, y, text, color) {
  for (const f of floaters) {
    if (f.active) continue;
    f.active = true;
    f.x = x;
    f.y = y;
    f.life = 0.9;
    f.text = text;
    f.color = color;
    return;
  }
}

// --- Scenery -------------------------------------------------------------

for (let i = 0; i < 70; i++) {
  stars.push({ x: randRange(0, W), y: randRange(0, H * 0.55), r: randRange(0.5, 1.4) });
}

// The skyline is a ring buffer in world space: blocks scroll past and are
// recycled to the far end rather than being created and thrown away.
function seedBlocks() {
  blocks.length = 0;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 14; i++) {
      blocks.push(makeBlock(side, i * 150 - 400));
    }
  }
}

function makeBlock(side, y) {
  return {
    side,
    y,
    depth: randRange(0, 1),
    w: randRange(26, 58),
    h: randRange(120, 300),
    lit: randRange(0, 1) < 0.55,
    seed: randInt(0, 9999),
  };
}

// --- Reset ---------------------------------------------------------------

function reset() {
  car.x = laneX(1);
  car.y = 0;
  car.speed = CRUISE_BASE;
  car.vx = 0;
  car.lane = 1;
  car.tilt = 0;

  score = 0;
  timeLeft = START_TIME;
  deliveries = 0;
  charge = 0;
  boosting = false;
  sliding = false;
  braking = false;
  emptyBoostSaid = 0;
  combo = 0;
  comboTimer = 0;
  bestCombo = 0;
  nearMisses = 0;
  crashes = 0;
  invulnerable = 0;
  shakeTime = 0;
  lowTimeBeep = 0;
  running = true;

  cones = [];
  traffic.clear();
  particles.clear();
  for (const f of floaters) f.active = false;

  seedBlocks();
  placeDrop();

  // A little traffic already on the road at the start, rather than a clear
  // stretch that fills in as you drive into it.
  traffic.refill(car, {
    density: trafficDensity(),
    spanFrom: 220,
    spanTo: 1600,
    laneCount: LANE_COUNT,
    speedRange: [200, 300],
    lorryChance: 0.12,
    oncomingLanes: 0,
  });
}

// --- Collisions ----------------------------------------------------------

function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
}

function crash(atX, atY) {
  if (invulnerable > 0) return;

  crashes++;
  invulnerable = 1.1;
  car.speed = Math.max(SPEED_MIN, car.speed * 0.32);
  car.vx *= -0.3;
  timeLeft -= CRASH_TIME_COST;
  combo = 0;
  comboTimer = 0;
  shakeTime = 0.45;

  audio.play('crash');
  particles.explosion(atX, EYE_Y - (atY - car.y), {
    count: 26,
    colors: [ART.player.flame, ART.cars.tail, ART.player.smoke],
  });
  floater(car.x, EYE_Y - 40, `-${CRASH_TIME_COST}s`, ART.hud.warn);

  if (timeLeft <= 0) finish();
}

function finish() {
  if (!running) return;
  running = false;
  audio.play('over');
  shell.showGameOver(Math.round(score), {
    deliveries,
    nearMisses,
    bestCombo,
    crashes,
    distance: `${Math.round(car.y / 10)} m`,
  });
}

// --- Update --------------------------------------------------------------

function update(dt) {
  if (!shell.update()) return;
  if (!running) return;

  const stick = Input.get(0);

  // --- The clock --------------------------------------------------------
  timeLeft -= dt;
  if (timeLeft <= 6 && timeLeft > 0) {
    lowTimeBeep -= dt;
    if (lowTimeBeep <= 0) {
      lowTimeBeep = timeLeft < 3 ? 0.35 : 0.7;
      audio.play('warn');
    }
  }
  if (timeLeft <= 0) { timeLeft = 0; finish(); return; }

  // --- Throttle, boost, handbrake ---------------------------------------
  // Boost on the right trigger, brake on the left, with A and B carrying the
  // same two actions. Reaching for the triggers on a pad and finding nothing
  // there is what "boost and brake do nothing on gamepad" actually was: the
  // buttons were mapped, the triggers were not, and a driving game is played
  // with the triggers.
  const wantBoost = Boolean(stick.rt || stick.a);
  const wantBrake = Boolean(stick.lt || stick.b);

  // The handbrake step-out still needs a turn and some speed — that is the
  // move. But the brake now also just brakes, which is what the control is
  // called and what a player expects it to do.
  sliding = wantBrake && Math.abs(stick.x) > 0.25 && car.speed > 200;
  braking = wantBrake && !sliding;

  boosting = wantBoost && charge > 0;

  // Pressing boost on an empty meter used to be completely silent, which is
  // indistinguishable from a dead button. It now says no.
  if (wantBoost && charge <= 0 && emptyBoostSaid <= 0) {
    audio.play('warn', { pitch: 0.6, volume: 0.5 });
    floater(car.x, EYE_Y - 30, 'NO BOOST', ART.hud.warn);
    emptyBoostSaid = 0.9;
  }
  if (emptyBoostSaid > 0) emptyBoostSaid = Math.max(0, emptyBoostSaid - dt);

  if (boosting) {
    charge = Math.max(0, charge - BOOST_DRAIN * dt);
    car.speed += ACCEL * 2.4 * dt;
    if (car.speed > BOOST_SPEED) car.speed = BOOST_SPEED;
    particles.emit(car.x, EYE_Y + car.h / 2, {
      count: 2,
      colors: [ART.player.flame, ART.player.flameHot],
      speed: [60, 200], life: [0.12, 0.3], size: [2, 5],
      angle: Math.PI / 2, spread: 0.7, gravity: 0, drag: 0.5, shrink: true,
    });
  } else {
    const target = cruiseSpeed();
    if (car.speed < target) car.speed += ACCEL * dt;
    else car.speed -= BRAKE * 0.35 * dt;
  }

  if (braking) car.speed -= BRAKE * dt;

  if (sliding) {
    car.speed -= SLIDE_SPEED_COST * dt;
    charge = Math.min(CHARGE_MAX, charge + CHARGE_PER_SLIDE_SECOND * dt);
    particles.emit(car.x - Math.sign(stick.x) * 14, EYE_Y + car.h * 0.3, {
      count: 1,
      colors: [ART.player.smoke],
      speed: [20, 70], life: [0.2, 0.5], size: [3, 7],
      gravity: 0, drag: 0.7, shrink: true,
    });
  }

  // Off the tarmac costs speed. The shoulder is where the drop pads are, so
  // it has to be drivable — it just must never be the fast line.
  const offRoad = !isOnPad()
    && (car.x < ROAD_LEFT + car.w / 2 || car.x > ROAD_RIGHT - car.w / 2);
  if (offRoad) {
    car.speed -= OFF_ROAD_DRAG * dt;
    if (Math.random() < 0.35) {
      particles.emit(car.x, EYE_Y + car.h / 2, {
        count: 1, colors: [ART.road.rumble],
        speed: [30, 110], life: [0.15, 0.35], size: [1, 3],
        gravity: 0, drag: 0.5, shrink: true,
      });
    }
  }

  car.speed = clamp(car.speed, SPEED_MIN, BOOST_SPEED);
  car.y += car.speed * dt;
  score += car.speed * dt * SCORE_PER_DISTANCE;

  // --- Steering ---------------------------------------------------------
  const steerMax = sliding ? STEER_MAX_SLIDE : STEER_MAX;
  car.vx += stick.x * STEER_ACCEL * dt;
  car.vx *= STEER_DAMP_PER_SECOND ** dt;
  car.vx = clamp(car.vx, -steerMax, steerMax);
  car.x += car.vx * dt;

  // The verges are a hard wall. Falling off the world in a driving game reads
  // as a bug however it is dressed up.
  const minX = ROAD_LEFT - SHOULDER + car.w / 2;
  const maxX = ROAD_RIGHT + SHOULDER - car.w / 2;
  if (car.x < minX) { car.x = minX; car.vx = 0; }
  if (car.x > maxX) { car.x = maxX; car.vx = 0; }

  car.lane = clamp(Math.floor((car.x - ROAD_LEFT) / LANE_W), 0, LANE_COUNT - 1);
  car.tilt = clamp(car.vx / STEER_MAX, -1, 1) * (sliding ? 0.4 : 0.22);

  if (invulnerable > 0) invulnerable -= dt;
  if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);

  // --- Traffic ----------------------------------------------------------
  traffic.update(dt, car, { behind: 700, ahead: 2200 }, oncomingLanes());
  traffic.refill(car, {
    density: trafficDensity(),
    spanFrom: 900,
    spanTo: 2100,
    laneCount: LANE_COUNT,
    speedRange: [190, 300 + deliveries * 4],
    lorryChance: Math.min(0.34, 0.12 + deliveries * 0.02),
    oncomingLanes: oncomingLanes(),
  });

  checkTraffic();
  checkCones();
  checkDrop();

  // --- Combo ------------------------------------------------------------
  if (combo > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }

  for (const f of floaters) {
    if (!f.active) continue;
    f.life -= dt;
    f.y -= 40 * dt;
    if (f.life <= 0) f.active = false;
  }

  particles.update(dt);
}

/**
 * Collisions and near misses, in one pass over the traffic.
 *
 * The near miss fires on the frame the player draws level with a car, not on
 * proximity alone — otherwise sitting alongside somebody would pay out sixty
 * times a second.
 */
function checkTraffic() {
  for (const other of traffic.cars) {
    if (!other.active) continue;

    const dy = Math.abs(other.y - car.y);
    const dx = Math.abs(other.x - car.x);

    if (overlaps(car.x, car.y, car.w, car.h, other.x, other.y, other.w, other.h)) {
      crash(other.x, other.y);
      other.passedBy = true;    // no near-miss credit for a car you hit
      continue;
    }

    // Level with it, close, and moving.
    if (!other.passedBy && dy < car.h / 2) {
      other.passedBy = true;
      const gap = dx - (car.w + other.w) / 2;
      const fast = car.speed > NEAR_MISS_MIN_SPEED || other.oncoming;
      if (gap < NEAR_MISS_GAP && fast) {
        nearMisses++;
        combo++;
        if (combo > bestCombo) bestCombo = combo;
        comboTimer = COMBO_WINDOW;
        charge = Math.min(CHARGE_MAX, charge + CHARGE_PER_NEAR_MISS);
        const points = SCORE_PER_NEAR_MISS * combo;
        score += points;
        audio.play('nearMiss', { pitch: 1 + Math.min(combo, 10) * 0.06 });
        floater(other.x, EYE_Y - (other.y - car.y), `+${points}`, ART.hud.combo);
      }
    }

    // Once it is well behind, arm it again — the road wraps cars around and a
    // recycled car must be scoreable next time it is met.
    if (other.passedBy && other.y < car.y - 400) other.passedBy = false;
  }
}

function checkCones() {
  cones = cones.filter((c) => c.y > car.y - 500);

  for (const c of cones) {
    const x = laneX(c.lane);
    if (overlaps(car.x, car.y, car.w, car.h, x, c.y, LANE_W * 0.5, c.length)) {
      crash(x, c.y);
    }
  }
}

function checkDrop() {
  if (!drop) return;

  if (isOnPad()) {
    deliveries++;
    const spare = Math.round(timeLeft);
    score += SCORE_PER_DELIVERY + spare * SCORE_PER_SECOND_SPARE;
    timeLeft += timeBonus();
    audio.play('deliver');
    particles.sparkle(drop.x, EYE_Y - (drop.y - car.y), {
      count: 22, colors: [ART.drop.padEdge, ART.hud.good, ART.player.flameHot],
    });
    floater(drop.x, EYE_Y - (drop.y - car.y), `+${Math.round(timeBonus())}s`, ART.hud.good);
    maybeAddRoadworks();
    placeDrop();
    return;
  }

  // Driven past it. The drop is behind and unreachable, and that is the end of
  // the run — the job was to get there, and it did not happen.
  if (car.y - drop.y > PAD_HALF_LENGTH + 40) finish();
}

// --- Draw ----------------------------------------------------------------

// World y to screen y. Everything on the road goes through this, so there is
// one place that knows which way the camera faces.
const toScreen = (worldY) => EYE_Y - (worldY - car.y);

const SKY = (() => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, ART.night.skyTop);
  g.addColorStop(1, ART.night.skyBottom);
  return g;
})();

function drawScenery() {
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = ART.night.star;
  for (const s of stars) {
    ctx.globalAlpha = 0.3 + (s.r - 0.5) * 0.5;
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = ART.night.haze;
  ctx.fillRect(0, H * 0.30, W, H * 0.28);

  // The skyline. Blocks recycle to the far end once they pass behind, so the
  // list never grows and nothing is allocated during a run.
  for (const b of blocks) {
    let sy = toScreen(b.y);
    if (sy > H + 320) {
      b.y += 14 * 150;
      b.w = randRange(26, 58);
      b.h = randRange(120, 300);
      b.lit = Math.random() < 0.55;
      b.seed = randInt(0, 9999);
      sy = toScreen(b.y);
    }
    if (sy < -b.h - 40 || sy > H + 40) continue;

    const outward = 6 + b.depth * 46;
    const x = b.side < 0 ? ROAD_LEFT - SHOULDER - outward - b.w : ROAD_RIGHT + SHOULDER + outward;

    ctx.fillStyle = b.depth > 0.5 ? ART.city.blockFar : ART.city.blockNear;
    ctx.fillRect(x, sy - b.h, b.w, b.h);
    ctx.strokeStyle = ART.city.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, sy - b.h + 0.5, b.w - 1, b.h - 1);

    if (!b.lit) continue;
    // Windows from a cheap deterministic hash of the block's seed, so a block
    // does not shimmer as it scrolls and there is no per-window state to keep.
    ctx.fillStyle = b.seed % 2 ? ART.city.windowWarm : ART.city.windowCool;
    for (let wy = sy - b.h + 10; wy < sy - 8; wy += 13) {
      for (let wx = x + 5; wx < x + b.w - 6; wx += 11) {
        if ((((wx | 0) * 31 + (wy | 0) * 17 + b.seed) % 7) > 3) continue;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(wx, wy, 4, 6);
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawRoad() {
  ctx.fillStyle = ART.road.shoulder;
  ctx.fillRect(ROAD_LEFT - SHOULDER, 0, ROAD_RIGHT - ROAD_LEFT + SHOULDER * 2, H);

  ctx.fillStyle = ART.road.surface;
  ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT - ROAD_LEFT, H);

  // Rumble strips. Anchored to world position so they scroll with the road
  // rather than crawling at a speed of their own.
  const stripe = 46;
  const offset = ((car.y % (stripe * 2)) + stripe * 2) % (stripe * 2);
  ctx.fillStyle = ART.road.rumble;
  for (let y = -stripe * 2 + offset; y < H + stripe; y += stripe * 2) {
    ctx.fillRect(ROAD_LEFT - SHOULDER, y, SHOULDER, stripe);
    ctx.fillRect(ROAD_RIGHT, y, SHOULDER, stripe);
  }

  // Lane dashes.
  const dash = 34;
  const gap = 30;
  const period = dash + gap;
  const dashOffset = ((car.y % period) + period) % period;
  ctx.fillStyle = ART.road.laneDash;
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    const x = ROAD_LEFT + lane * LANE_W - 1.5;
    // The boundary between the oncoming side and ours is a solid line, and
    // gold, because crossing it is a different kind of mistake.
    if (lane === oncomingLanes() && oncomingLanes() > 0) {
      ctx.fillStyle = ART.road.centreLine;
      ctx.fillRect(x - 1, 0, 2, H);
      ctx.fillRect(x + 3, 0, 2, H);
      ctx.fillStyle = ART.road.laneDash;
      continue;
    }
    for (let y = -period + dashOffset; y < H + period; y += period) {
      ctx.fillRect(x, y, 3, dash);
    }
  }

  ctx.fillStyle = ART.road.edgeLine;
  ctx.fillRect(ROAD_LEFT - 2, 0, 3, H);
  ctx.fillRect(ROAD_RIGHT - 1, 0, 3, H);
}

function drawDrop() {
  if (!drop) return;

  const sy = toScreen(drop.y);

  // On screen: the pad itself, pulsing.
  if (sy > -160 && sy < H + 160) {
    const pulse = 0.55 + Math.sin(performance.now() / 180) * 0.2;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = ART.drop.pad;
    ctx.fillRect(drop.x - SHOULDER, sy - PAD_HALF_LENGTH, SHOULDER * 2, PAD_HALF_LENGTH * 2);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = ART.drop.padEdge;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(drop.x - SHOULDER, sy - PAD_HALF_LENGTH, SHOULDER * 2, PAD_HALF_LENGTH * 2);
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(drop.x, sy);
    ctx.fillStyle = ART.drop.padText;
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DROP', 0, 0);
    ctx.restore();
    return;
  }

  // Off the top: a marker pinned to the edge of the screen with the distance,
  // so the pad is never a surprise arriving at 600 px a second.
  const metres = Math.max(0, Math.round((drop.y - car.y) / 10));
  const x = drop.side < 0 ? ROAD_LEFT - SHOULDER / 2 : ROAD_RIGHT + SHOULDER / 2;

  ctx.fillStyle = ART.drop.far;
  ctx.beginPath();
  ctx.moveTo(x, 14);
  ctx.lineTo(x - 11, 32);
  ctx.lineTo(x + 11, 32);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ART.drop.arrow;
  ctx.font = '700 12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${metres}m`, x, 36);
}

function drawCones() {
  for (const c of cones) {
    const x = laneX(c.lane);
    const top = toScreen(c.y + c.length / 2);
    const bottom = toScreen(c.y - c.length / 2);
    if (bottom < -40 || top > H + 40) continue;

    for (let y = top; y < bottom; y += 34) {
      ctx.fillStyle = ART.cone.base;
      ctx.beginPath();
      ctx.ellipse(x, y + 12, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ART.cone.body;
      ctx.beginPath();
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x + 9, y + 12);
      ctx.lineTo(x - 9, y + 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ART.cone.band;
      ctx.fillRect(x - 6, y + 2, 12, 3);
    }
  }
}

function drawCar(x, y, w, h, body, { tilt = 0, oncoming = false, signalDir = 0, isPlayer = false } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.25);

  // Headlight wash on the road ahead. Drawn under the body, and only for cars
  // facing the way they are lighting.
  ctx.fillStyle = ART.cars.headBeam;
  ctx.beginPath();
  const dir = oncoming ? 1 : -1;
  ctx.moveTo(-w / 2, (h / 2) * dir);
  ctx.lineTo(-w * 1.3, (h / 2 + 150) * dir);
  ctx.lineTo(w * 1.3, (h / 2 + 150) * dir);
  ctx.lineTo(w / 2, (h / 2) * dir);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 7);
  ctx.fill();

  ctx.fillStyle = isPlayer ? ART.player.roof : ART.cars.roof;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 5, -h * 0.20, w - 10, h * 0.42, 4);
  ctx.fill();

  if (isPlayer) {
    ctx.fillStyle = ART.player.trim;
    ctx.fillRect(-w / 2 + 3, -h * 0.42, w - 6, 3);
  }

  // Lights. Tail lights face the camera on same-direction traffic; oncoming
  // traffic shows headlights instead, which is the only cue you get that
  // something is coming the other way.
  const tailY = oncoming ? -h / 2 + 3 : h / 2 - 5;
  ctx.fillStyle = oncoming ? ART.cars.head : (isPlayer ? ART.player.tail : ART.cars.tail);
  ctx.fillRect(-w / 2 + 3, tailY, 7, 3);
  ctx.fillRect(w / 2 - 10, tailY, 7, 3);

  const headY = oncoming ? h / 2 - 5 : -h / 2 + 3;
  ctx.fillStyle = isPlayer ? ART.player.head : ART.cars.head;
  ctx.fillRect(-w / 2 + 3, headY, 7, 3);
  ctx.fillRect(w / 2 - 10, headY, 7, 3);

  // Indicator: blinks, because a light that is simply on is not an indicator.
  if (signalDir !== 0 && Math.floor(performance.now() / 220) % 2 === 0) {
    ctx.fillStyle = ART.cars.indicator;
    const sx = signalDir < 0 ? -w / 2 - 3 : w / 2 - 2;
    ctx.fillRect(sx, -h / 2 + 6, 5, 5);
    ctx.fillRect(sx, h / 2 - 11, 5, 5);
  }

  ctx.restore();
}

function drawHudExtras() {
  const barW = 132;
  const barH = 9;
  const x = 20;
  const y = H - 34;

  ctx.fillStyle = ART.hud.label;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('BOOST', x, y - 4);

  ctx.fillStyle = ART.hud.meterBack;
  ctx.beginPath();
  ctx.roundRect(x, y, barW, barH, 4);
  ctx.fill();

  const full = charge >= CHARGE_MAX - 0.5;
  ctx.fillStyle = full ? ART.hud.meterFull : ART.hud.meterFill;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(2, barW * (charge / CHARGE_MAX)), barH, 4);
  ctx.fill();

  // Deliveries, bottom right.
  ctx.textAlign = 'right';
  ctx.fillStyle = ART.hud.label;
  ctx.fillText('DELIVERED', W - 20, y - 4);
  ctx.fillStyle = ART.hud.value;
  ctx.font = '700 20px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(String(deliveries), W - 20, y);

  // Speed, centre bottom — a driving game with no speed readout feels vague.
  ctx.textAlign = 'center';
  ctx.fillStyle = boosting ? ART.hud.meterFull : ART.hud.label;
  ctx.font = '700 15px ui-monospace, monospace';
  ctx.fillText(`${Math.round(car.speed / 3)} kph`, W / 2, y);

  // Where the next drop is, always. This is the thing a run ends on, so it
  // gets a permanent line rather than a marker that only appears sometimes.
  if (drop) {
    const metres = Math.round((drop.y - car.y) / 10);
    const close = metres < 30;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = ART.hud.label;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('NEXT DROP', W / 2, 56);
    ctx.fillStyle = close ? ART.hud.warn : ART.hud.value;
    ctx.font = '700 16px ui-monospace, monospace';
    const side = drop.side < 0 ? '◀' : '▶';
    ctx.fillText(
      drop.side < 0 ? `${side} ${Math.max(0, metres)}m` : `${Math.max(0, metres)}m ${side}`,
      W / 2, 68,
    );
  }

  if (combo > 1) {
    ctx.fillStyle = ART.hud.combo;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`x${combo}`, W / 2, 96);
  }

  for (const f of floaters) {
    if (!f.active) continue;
    ctx.globalAlpha = clamp(f.life / 0.5, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

// `alpha` is unused: the camera reframes the whole world every tick by
// translating it, and interpolating across that tick tears the road apart.
function render() {
  ctx.save();
  if (shakeTime > 0) {
    const m = shakeTime * 16;
    ctx.translate(randRange(-m, m), randRange(-m, m));
  }

  drawScenery();
  drawRoad();
  drawDrop();
  drawCones();

  for (const other of traffic.cars) {
    if (!other.active) continue;
    const sy = toScreen(other.y);
    if (sy < -140 || sy > H + 140) continue;
    drawCar(other.x, sy, other.w, other.h,
      other.h > 80 ? ART.cars.lorryBody : other.color,
      { oncoming: other.oncoming, signalDir: other.signalDir });
  }

  // The player flashes while briefly invulnerable after a crash, so the
  // grace period is visible rather than something you have to infer.
  const hidden = invulnerable > 0 && Math.floor(performance.now() / 70) % 2 === 0;
  if (!hidden) {
    drawCar(car.x, EYE_Y, car.w, car.h,
      boosting ? ART.player.bodyBoost : ART.player.body,
      { tilt: car.tilt, isPlayer: true });
  }

  particles.draw(ctx);
  ctx.restore();

  // Timer through the engine HUD so it sits where every other game's does.
  shell.drawHud({ score: Math.round(score), best: Session.getBest(GAME_ID), timer: timeLeft });
  drawHudExtras();
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
  title: 'Neon Drift Delivery',
  canvas: screen,
  loop,
  audio,
  onRestart: reset,
  controls: [
    { action: 'Steer', gamepad: 'Left stick or D-pad', keyboard: 'Left / Right or A / D', touch: 'Drag the left side' },
    { action: 'Boost', gamepad: 'Right trigger or A', keyboard: 'Space', touch: 'Boost pad' },
    { action: 'Brake', gamepad: 'Left trigger or B', keyboard: 'Shift', touch: 'Slide pad' },
    { action: 'Handbrake turn', gamepad: 'Brake while steering hard', keyboard: 'Brake while steering hard', touch: 'Brake while steering hard' },
    { action: 'Charge boost', gamepad: 'Pass traffic close', keyboard: 'Pass traffic close', touch: 'Pass traffic close' },
    { action: 'Deliver', gamepad: 'Drive onto the lit pad', keyboard: 'Drive onto the lit pad', touch: 'Drive onto the lit pad' },
    { action: 'Pause', gamepad: 'Start', keyboard: 'Escape', touch: 'Top-right button' },
  ],
});

reset();
loop.start();

shell.showTitle({ name: 'Neon Drift Delivery', tagline: 'The clock is the fuel. Pass close.' });
