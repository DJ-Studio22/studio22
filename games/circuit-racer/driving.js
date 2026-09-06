// games/circuit-racer/driving.js
//
// The physics and the AI brain, with no DOM in sight.
//
// Split out of game.js for one reason: "Casual should be beatable by someone
// driving the track for the first time" is a claim about lap times, and lap
// times are measurable. Because nothing in here touches a canvas, a window or
// an audio context, a script can import it and simulate a hundred races in a
// second -- which is how the difficulty numbers below were chosen rather than
// guessed. game.js keeps the drawing, the HUD, the input and the shell.
//
// UNITS: seconds, per the engine doctrine. Distances are units, speeds
// units/sec, accelerations units/sec squared.

import { clamp } from '../../engine/util.js';

const TAU = Math.PI * 2;

// --- The car ------------------------------------------------------------

export const ACCEL = 430;          // units/sec^2
export const BRAKE = 620;
export const ROLL_DRAG = 0.55;     // fraction of speed kept per second, coasting
export const MAX_SPEED = 395;
export const REVERSE_MAX = 110;
export const OFF_TRACK_MAX = 165;  // grass is slow, which is the whole penalty
export const OFF_TRACK_DRAG = 0.12;
export const TURN_RATE = 2.9;      // radians/sec at full lock
export const GRIP_SPEED = 180;     // speed at which steering reaches full lock

export const CAR_L = 26;
export const CAR_W = 15;
export const CAR_R = 11;           // collision radius, a little under half-length

export const SECTORS = 3;

// --- Slipstream ----------------------------------------------------------
//
// THE DEPTH MECHANIC. Of the three candidates -- surface variation,
// slipstream, tyre degradation -- this is the one that earns its complexity:
//
//   Surface variation already exists in its useful form: leaving the tarmac
//   caps you at OFF_TRACK_MAX. A third surface would be more states teaching
//   the same lesson.
//
//   Tyre degradation is invisible state. It makes the car worse for reasons
//   the player cannot see, and teaches nothing in a three-lap race.
//
//   Slipstream is the only one that makes the FIELD mean something. With
//   three rivals out there it turns "a car in front" from an obstacle into a
//   resource. It is completely legible -- you can see you are tucked in and
//   see the speed climb -- and it rewards racecraft instead of punishing
//   error. It is also the cheapest of the three: a cone test.
export const SLIP_RANGE = 150;        // units behind a car the tow reaches
export const SLIP_HALF_WIDTH = 30;    // how far off their line you can be
export const SLIP_TOP_BONUS = 0.16;   // extra top speed at full tow
export const SLIP_ACCEL_BONUS = 0.45; // extra acceleration at full tow

// --- Difficulty ----------------------------------------------------------
//
// Three levers: cornering speed, line accuracy, and how hard the AI
// rubber-bands. The numbers come out of a race simulation rather than out
// of taste -- 1,200 simulated races against three modelled drivers.
//
// The result, as win rate over three laps across all four circuits:
//
//                 Casual   Standard   Pro
//   first-timer     75%        0%      0%
//   knows the track 100%      84%      0%
//   mastered it     100%     100%     72%
//
// The interesting finding: cornerSkill dominates and topSpeed barely
// matters. These circuits are corner-limited, so a rival that is soft on
// corner entry is beatable however fast it runs down the straight. That is
// the better lever to soften anyway -- Casual still looks quick on the
// straights, and the player beats it by out-braking it into a corner, which
// is a thing they can see themselves doing.
export const DIFFICULTIES = [
  {
    id: 'casual',
    label: 'Casual',
    blurb: 'Beatable on your first lap of a track you have never seen.',
    topSpeed: 0.80,      // fraction of the player's top speed it will use
    cornerSkill: 0.66,   // fraction of the achievable corner speed it carries
    lineWobble: 18,      // units it drifts either side of the ideal line
    mistakeEvery: 6.5,   // mean seconds between visible errors
    rubberBand: 0.30,    // how much it eases off once it is clear ahead
  },
  {
    id: 'standard',
    label: 'Standard',
    blurb: 'Holds a tidy line. You will have to earn the place.',
    topSpeed: 0.92,
    cornerSkill: 0.82,
    lineWobble: 11,
    mistakeEvery: 13,
    rubberBand: 0.16,
  },
  {
    id: 'pro',
    label: 'Pro',
    blurb: 'Quick, precise, and rarely hands anything back.',
    topSpeed: 1.0,
    cornerSkill: 0.93,
    lineWobble: 6,
    mistakeEvery: 24,
    rubberBand: 0.05,
  },
];

export const DEFAULT_DIFFICULTY = 'casual';

export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[0];
}

export const LAP_OPTIONS = [3, 5, 10];
export const DEFAULT_LAPS = 3;

// How much slower each rival is than the one ahead of it on the grid, so a
// field of three is a spread of ability rather than three copies of the same
// driver arriving nose to tail.
const FIELD_SPREAD = 0.035;

// --- Cars ----------------------------------------------------------------

export function makeCar(id, { isPlayer = false } = {}) {
  return {
    id,
    isPlayer,
    x: 0, y: 0, angle: 0, speed: 0,

    // Where it is on the lap, and how far it has driven in total. Position,
    // lap counting and the finish all read `travelled`; nothing reads a
    // trigger line. See advanceLap for why.
    s: 0,
    travelled: 0,
    laps: 0,

    done: false,
    finishOrder: 0,
    onGrass: false,
    slip: 0,             // 0..1, how much tow it is getting right now
    steerInput: 0,       // last steering command, for the tyre-mark test
    braking: false,

    // AI only. Kept on the car rather than in a parallel map, so a car is one
    // object and nothing can fall out of step with it.
    ai: null,
  };
}

export function makeAiBrain(tuning, rank) {
  return {
    tuning,
    ability: 1 - rank * FIELD_SPREAD,      // each rival a slightly different driver
    wobblePhase: Math.random() * TAU,
    wobbleRate: 0.35 + Math.random() * 0.25,
    mistake: null,
    nextMistake: 2 + Math.random() * tuning.mistakeEvery,
  };
}

/**
 * Puts a car on the grid JUST PAST the start line, never behind it.
 *
 * Behind the line looks more like a real grid and is a bug: the car's first
 * movement crosses the line and banks a lap it never drove, which showed up
 * as a three-lap race with a lap quicker than the track length divided by the
 * top speed. Starting past the line makes the first crossing genuine.
 */
export function placeOnGrid(track, car, along, across) {
  const [px, py] = track.pointAt(along);
  const [nx, ny] = track.normalAt(along);
  const [tx, ty] = track.tangentAt(along);

  car.x = px + nx * across;
  car.y = py + ny * across;
  car.angle = Math.atan2(ty, tx);
  car.speed = 0;
  car.s = track.project(car.x, car.y).s;
  car.travelled = car.s;
  car.laps = 0;
  car.done = false;
  car.finishOrder = 0;
  car.slip = 0;
  car.onGrass = false;
}

/**
 * Builds the whole field, player at the back.
 *
 * Starting last is the arcade choice: it gives the position indicator
 * something to say from the first corner, and overtaking is the part of a
 * racing game that is actually fun. It also means the player is never the car
 * the rubber-banding is protecting.
 */
export function makeField(track, { rivals = 3, difficulty = DEFAULT_DIFFICULTY } = {}) {
  const tuning = difficultyById(difficulty);
  const cars = [];

  for (let i = 0; i < rivals; i++) {
    const car = makeCar('rival' + i);
    car.ai = makeAiBrain(tuning, i);
    cars.push(car);
  }
  const player = makeCar('player', { isPlayer: true });
  cars.push(player);

  // Front of the grid to the back, alternating sides. The spacing is a car
  // and a half, so nobody starts inside anybody else.
  const GRID_GAP = 34;
  const ACROSS = Math.min(18, track.roadHalf * 0.42);
  cars.forEach((car, i) => {
    const fromFront = cars.length - 1 - i;
    placeOnGrid(track, car, 30 + fromFront * GRID_GAP, i % 2 === 0 ? -ACROSS : ACROSS);
  });

  return { cars, player, rivals: cars.filter((c) => !c.isPlayer), tuning };
}

// --- Motion --------------------------------------------------------------

/**
 * One car, one tick.
 *
 * `input` is {throttle, brake, steer} and comes from either the player's
 * controller or the AI brain. Neither gets physics the other does not: the
 * rival is fast because it makes fewer mistakes, not because it is allowed
 * more grip.
 */
export function stepCar(track, car, input, dt) {
  const projected = track.project(car.x, car.y);
  const onGrass = projected.dist > track.roadHalf;
  car.onGrass = onGrass;

  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  const steer = clamp(input.steer || 0, -1, 1);
  car.steerInput = steer;
  car.braking = brake > 0.15 && car.speed > 40;

  // The tow does nothing off the tarmac. There is no slipstream in a field,
  // and allowing it would reward cutting the corner behind someone.
  const slip = onGrass ? 0 : car.slip;
  const topSpeed = (onGrass ? OFF_TRACK_MAX : MAX_SPEED) * (1 + slip * SLIP_TOP_BONUS);
  const accel = ACCEL * (1 + slip * SLIP_ACCEL_BONUS);

  car.speed += throttle * accel * dt;
  car.speed -= brake * BRAKE * dt;

  // Coasting drag, plus a much heavier one on the grass. Both exponential, so
  // they behave identically at any frame rate.
  const drag = onGrass ? OFF_TRACK_DRAG : ROLL_DRAG;
  if (throttle === 0) car.speed *= drag ** dt;
  car.speed = clamp(car.speed, -REVERSE_MAX, topSpeed);

  // Steering scales with speed: a stationary car cannot pivot on the spot,
  // which is what stops the whole thing feeling like a twin-stick shooter.
  const grip = clamp(Math.abs(car.speed) / GRIP_SPEED, 0, 1);
  car.angle += steer * TURN_RATE * grip * dt * Math.sign(car.speed || 1);

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  return { onGrass };
}

/** Keeps a car on the canvas. The circuit is closed; the canvas is not. */
export function clampToCanvas(car, w, h) {
  car.x = clamp(car.x, 10, w - 10);
  car.y = clamp(car.y, 10, h - 10);
}

/**
 * Brings a car that has taken the flag to a halt just past the line.
 *
 * Braking rather than freezing on the spot: a car that stops dead the instant
 * it crosses looks like the game hitched. NOT stepCar with the brake held --
 * that has no floor at zero, so a finished car decelerates straight past a
 * standstill and reverses away down the track, which is exactly what the
 * first version of this did. Braking may reverse a car a player is driving; a
 * car that has finished must simply stop.
 */
export function coastToStop(track, car, dt) {
  const decel = BRAKE * dt;
  if (Math.abs(car.speed) <= decel) {
    car.speed = 0;
    return;
  }
  car.speed -= Math.sign(car.speed) * decel;

  // Still steers along the track while it rolls, so it comes to rest on the
  // tarmac rather than ploughing into the grass at whatever angle it crossed
  // the line. advanceLap is deliberately not called: the race is over and no
  // further laps may count.
  const [tx, ty] = track.pointAt(car.s + 40);
  let turn = Math.atan2(ty - car.y, tx - car.x) - car.angle;
  while (turn > Math.PI) turn -= TAU;
  while (turn < -Math.PI) turn += TAU;

  const grip = clamp(Math.abs(car.speed) / GRIP_SPEED, 0, 1);
  car.angle += clamp(turn * 1.5, -1, 1) * TURN_RATE * grip * dt;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.s = track.project(car.x, car.y).s;
}

// The furthest a car can legitimately move along the track in one step, with
// room for the loop's own dt clamp. Anything larger is the projection
// snapping, not the car moving.
export const MAX_STEP = MAX_SPEED * 0.06;

/**
 * Lap counting by DISTANCE TRAVELLED, not by crossing a line.
 *
 * Three approaches, and only the third survives contact with the track:
 *
 *   A trigger line can be missed at speed, or clipped twice in one corner.
 *
 *   Watching the lap position wrap past a threshold looks robust and is not.
 *   project() returns the nearest point on the WHOLE centre line, so a car
 *   cutting a corner across the infield can be nearest to a part of the loop
 *   it has not reached yet. That reads as a wrap, and it banked a 3.9-second
 *   lap on a circuit whose fastest possible lap is 4.5.
 *
 *   Accumulating the small, wrapped, frame-by-frame change cannot do that: a
 *   jump bigger than a car can travel in one step is rejected as a snap
 *   rather than counted as progress. It handles reversing for free, since
 *   driving backwards subtracts from the total.
 *
 * @returns {number} how many laps ticked over this step, normally 0 or 1.
 */
export function advanceLap(track, car, totalLaps) {
  const s = track.project(car.x, car.y).s;
  let delta = s - car.s;
  if (delta > track.length / 2) delta -= track.length;
  if (delta < -track.length / 2) delta += track.length;

  if (Math.abs(delta) < MAX_STEP) car.travelled += delta;
  car.s = s;

  const laps = Math.floor(car.travelled / track.length);
  if (laps === car.laps) return 0;

  const gained = laps - car.laps;
  car.laps = laps;
  if (gained > 0 && car.laps >= totalLaps) car.done = true;
  return gained > 0 ? gained : 0;
}

/** Which sector of the lap a car is in, 0-based. */
export function sectorOf(track, car) {
  const within = ((car.travelled % track.length) + track.length) % track.length;
  return Math.min(SECTORS - 1, Math.floor(within / (track.length / SECTORS)));
}

// --- Cars touching each other -------------------------------------------

/**
 * Keeps the field from driving through itself.
 *
 * Circles, not car-shaped boxes. With four cars on a road two cars wide
 * something has to stop them occupying the same tarmac, but a proper
 * rigid-body response would need mass, restitution and rotation to look right
 * and would turn contact into a physics demo. Pushing them apart and
 * scrubbing a little speed reads as a nudge, which is what an arcade racer
 * wants: contact costs you time without ending your race.
 */
export function separateCars(cars, dt) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const min = CAR_R * 2;
      if (dist >= min || dist === 0) continue;

      const push = (min - dist) / 2;
      const ux = dx / dist;
      const uy = dy / dist;
      a.x -= ux * push;
      a.y -= uy * push;
      b.x += ux * push;
      b.y += uy * push;

      // Scrubbed PER SECOND of contact, not per tick. Per tick it was a
      // 0.94 multiplier at 60fps -- a 97% loss over a single second, which
      // welded the car behind to the car in front and turned a field of
      // four into a rolling roadblock nothing could pass.
      const keep = 0.72 ** dt;
      a.speed *= keep;
      b.speed *= keep;
    }
  }
}

// --- Slipstream ----------------------------------------------------------

/**
 * How much tow each car is getting, 0..1, written onto car.slip.
 *
 * A cone behind the car in front: close enough, lined up along ITS direction
 * of travel, and not off to one side. Being alongside gives nothing, which is
 * what makes the mechanic a decision -- you pull out of the tow to make the
 * pass, and you have to time it.
 */
export function updateSlipstream(cars) {
  for (const car of cars) {
    let best = 0;

    for (const other of cars) {
      if (other === car) continue;

      // "Behind" means behind in the OTHER car's frame, not on the map.
      const dx = car.x - other.x;
      const dy = car.y - other.y;
      const fx = Math.cos(other.angle);
      const fy = Math.sin(other.angle);
      const behind = -(dx * fx + dy * fy);       // positive when tucked in
      const beside = Math.abs(dx * -fy + dy * fx);

      if (behind <= CAR_L * 0.5 || behind > SLIP_RANGE) continue;
      if (beside > SLIP_HALF_WIDTH) continue;
      if (other.speed < 120) continue;           // no tow off a crawling car

      // Strongest right behind them, fading at the edges of the cone.
      const along = 1 - (behind - CAR_L * 0.5) / (SLIP_RANGE - CAR_L * 0.5);
      const across = 1 - beside / SLIP_HALF_WIDTH;
      best = Math.max(best, along * across);
    }

    // Eased rather than snapped, so the HUD bar and the surge both feel like
    // catching a tow instead of a switch flipping.
    car.slip += (best - car.slip) * 0.12;
    if (car.slip < 0.005) car.slip = 0;
  }
}

// --- The AI --------------------------------------------------------------

/**
 * The fastest a car can get round the bend at `s`.
 *
 * Not a friction circle -- this car has no lateral force model, it has a turn
 * rate. The tightest arc it can hold at speed v has radius v / TURN_RATE, so
 * invert that: v = TURN_RATE * radius. The radius available is the corner's
 * own radius plus most of the road width, because a driver straightens a
 * corner by going in wide and clipping the apex.
 */
export function cornerSpeedAt(track, s) {
  const curvature = track.curvatureAt(s);
  if (curvature < 1e-5) return MAX_SPEED;
  const radius = 1 / curvature + track.roadHalf * 0.9;
  return Math.min(MAX_SPEED, TURN_RATE * radius);
}

/**
 * How far sideways to move to get out from behind the car in front.
 *
 * Without this, four cars of similar pace form a train: each one sits in
 * the one ahead, none of them ever pulls out, and the player at the back of
 * the grid has nowhere to go. Nudging the line to whichever side there is
 * more room on is enough to break it up -- the field fans out through a
 * corner and the road becomes passable.
 */
function avoidanceOffset(car, cars) {
  const LOOK = 90;
  const LANE = 26;
  let shift = 0;

  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);

  for (const other of cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const ahead = dx * fx + dy * fy;
    const beside = dx * -fy + dy * fx;
    if (ahead <= 0 || ahead > LOOK) continue;
    if (Math.abs(beside) > LANE) continue;

    // Pull towards the side it is NOT on. Dead astern gets a deterministic
    // side rather than a random one, so the car commits instead of dithering.
    const side = beside === 0 ? 1 : -Math.sign(beside);
    shift += side * (1 - ahead / LOOK) * LANE * 1.4;
  }

  return shift;
}

/**
 * What a rival wants to do this tick.
 *
 * Look-ahead steering rather than waypoint-chasing: it aims at a point some
 * distance further round the track, which is what makes it turn INTO a corner
 * early instead of arriving at the apex and then noticing it.
 */
export function aiControls(track, car, cars, dt, playerProgress) {
  const brain = car.ai;
  const tune = brain.tuning;

  // --- Believable imperfection ------------------------------------------
  //
  // A rival that never errs is a wall, not an opponent. Two layers: a
  // constant slow drift so the line is never metronomic even when nothing is
  // going wrong, and occasional committed mistakes that actually cost time.
  brain.wobblePhase += dt * brain.wobbleRate * TAU;

  brain.nextMistake -= dt;
  if (brain.nextMistake <= 0 && !brain.mistake) {
    const roll = Math.random();
    brain.mistake = {
      // Running wide is the most visible from outside the car, so it is the
      // most common: you see the rival drift towards the kerb and know it
      // went in too hot.
      kind: roll < 0.5 ? 'wide' : roll < 0.8 ? 'late' : 'lift',
      left: 0.5 + Math.random() * 1.1,
      side: Math.random() < 0.5 ? -1 : 1,
    };
    // Spacing is randomised too, so mistakes are not on a metronome either.
    brain.nextMistake = tune.mistakeEvery * (0.5 + Math.random());
  }
  if (brain.mistake) {
    brain.mistake.left -= dt;
    if (brain.mistake.left <= 0) brain.mistake = null;
  }
  const mistake = brain.mistake;

  // --- Where to aim -----------------------------------------------------

  const lookAhead = 70 + Math.abs(car.speed) * 0.35;
  const aimS = car.s + lookAhead;

  let offset = Math.sin(brain.wobblePhase) * tune.lineWobble;
  if (mistake && mistake.kind === 'wide') {
    offset += mistake.side * track.roadHalf * 0.8;
  }
  offset += avoidanceOffset(car, cars);
  offset = clamp(offset, -track.roadHalf * 0.85, track.roadHalf * 0.85);

  const [ax, ay] = track.pointAt(aimS);
  const [nx, ny] = track.normalAt(aimS);
  const aimX = ax + nx * offset;
  const aimY = ay + ny * offset;

  let turn = Math.atan2(aimY - car.y, aimX - car.x) - car.angle;
  while (turn > Math.PI) turn -= TAU;
  while (turn < -Math.PI) turn += TAU;
  const steer = clamp(turn * 1.9, -1, 1);

  // --- How fast to be going ---------------------------------------------
  //
  // Looks along the stretch it will cover while slowing down and takes the
  // tightest thing in it, so it brakes FOR a corner rather than AT one.
  let limit = MAX_SPEED;
  for (let d = 30; d <= 30 + Math.abs(car.speed) * 0.85; d += 26) {
    limit = Math.min(limit, cornerSpeedAt(track, car.s + d));
  }

  let skill = tune.cornerSkill * brain.ability;
  if (mistake && mistake.kind === 'late') skill *= 1.3;   // in too fast
  let target = Math.min(MAX_SPEED * tune.topSpeed * brain.ability, limit * skill);

  // --- Rubber-banding ----------------------------------------------------
  //
  // Measured against the PLAYER, not against the leader. Against the leader
  // it is meaningless: the leader is compared to itself and comes out level,
  // so the setting silently did nothing at every difficulty.
  //
  // One-directional on purpose. A rival clear of the player eases off; a
  // rival that has fallen behind does NOT get a magic boost to reel them back
  // in. Catch-up that works both ways makes every gap the player builds feel
  // fake, and that is the failure mode this setting guards against.
  const ahead = car.travelled - playerProgress;
  if (ahead > 0) {
    const eased = clamp(ahead / (track.length * 0.5), 0, 1) * tune.rubberBand;
    target *= 1 - eased;
  }

  if (mistake && mistake.kind === 'lift') target *= 0.62;

  // --- Pedals ------------------------------------------------------------
  const over = car.speed - target;
  let throttle = 0;
  let brake = 0;
  if (over > 26) brake = clamp(over / 90, 0, 1);
  else if (over < 0) throttle = clamp(-over / 40, 0, 1);
  else throttle = 0.35;

  return { throttle, brake, steer };
}

// --- Standings -----------------------------------------------------------

/**
 * The field in race order.
 *
 * `travelled` is the whole answer: it is monotonic, it already includes the
 * grid offset each car started with, and it is the same number the finish is
 * judged on -- so the running order can never disagree with the result.
 */
export function standings(cars) {
  return [...cars].sort((a, b) => {
    if (a.finishOrder && b.finishOrder) return a.finishOrder - b.finishOrder;
    if (a.finishOrder) return -1;
    if (b.finishOrder) return 1;
    return b.travelled - a.travelled;
  });
}

export function positionOf(cars, car) {
  return standings(cars).indexOf(car) + 1;
}

export function leaderProgressOf(cars) {
  let best = -Infinity;
  for (const car of cars) best = Math.max(best, car.travelled);
  return best;
}

export function ordinal(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
}
