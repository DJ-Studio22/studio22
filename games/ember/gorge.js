// games/ember/gorge.js
//
// Ember's simulation: the balloon, the gorge, and the one contract that keeps
// the game fair. No canvas, no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// The whole game rests on a claim: "momentum is the whole skill, so the gap
// has to be read early." That is a statement about arithmetic — about whether
// a balloon travelling at its terminal sink rate can still make the next gap
// if it commits the moment the gap is visible. It cannot be checked by playing
// a browser at one run every few seconds, and it silently stops being true the
// moment anybody touches a tuning number.
//
// So the simulation lives here and tests/ember.gorge.test.mjs imports the real
// values. Per tests/README.md: never restate a constant.
//
// THE REACHABILITY CONTRACT
// -------------------------
// A balloon has momentum. Starting at full sink and asked to climb, it must
// first arrest the sink, and the ground it loses doing that is the whole game.
// So a gorge is only fair if EVERY gap can be reached from the WORST state the
// player could legitimately arrive in — at the edge of the previous gap, at
// terminal velocity, moving the wrong way.
//
// reachableOffset() answers exactly that question, and nextGate() clamps every
// generated gap into the band it returns. The contract therefore holds BY
// CONSTRUCTION rather than by hoping the random numbers are kind, and the test
// asserts both that it holds and that the clamp is actually doing work — a
// guarantee that never binds is not a guarantee, it is a coincidence.
//
// The contract is deliberately stated against the WEAKER of the two
// accelerations. Burner and gravity are not symmetric, and a gorge that is
// only fair in the easier direction is not fair.
//
// WHY THE PHYSICS SCALE WITH SPEED
// --------------------------------
// The first cut let the forward drift rise forever while the balloon's
// accelerations stayed fixed. The test found what that does: the reachable
// band shrank every kilometre, hit zero at about 25 km and went NEGATIVE after
// it. Past that point the gorge was not hard, it was arithmetically
// impossible — the balloon could not have crossed it flown perfectly.
//
// This is the same fault Gravity Flip had and the same fix. Accelerations
// scale with the SQUARE of the drift speed and terminal velocities scale
// linearly with it. Both time terms then shrink exactly as fast as the speed
// rises, so every vertical distance in the problem — arrest distance, reach,
// the lot — is invariant in PIXELS however fast the balloon is travelling.
//
// What escalates instead is honest: the gap narrows, the gates tighten, and
// the whole thing happens in less wall-clock time. The geometry a player has
// to fly stays a geometry a player can fly. There is still no ceiling.

// --- Tuning ---------------------------------------------------------------
//
// A plain object, so a test can clone it, change one figure and run both
// versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The balloon, at the base drift speed. Accelerations are px/s^2, speeds
  // px/s, and both are scaled up with the drift — see physicsAt().
  //
  // BURN is only a little stronger than SINK on purpose: a burner that
  // overwhelms gravity turns the game into a position control, and the whole
  // point is that it is a VELOCITY control you have to plan around.
  // Slow, for a balloon. These were nearly three times stronger to begin
  // with, and playing it in a browser found what the bots could not: from a
  // standing start the envelope reached the rock in 0.53 seconds, so a run
  // was over before a player had finished reading the screen. The bots never
  // noticed because they were already flying on frame one.
  //
  // Slower also makes the momentum cost a larger share of the gap — 82px of
  // it against a 265px channel — which is the thing the game is supposed to
  // be about.
  burnAccel: 340,
  sinkAccel: 280,
  maxRise: 195,
  maxSink: 215,

  // Radius of the envelope for collision. The basket hangs below and is
  // deliberately not part of the hitbox: clipping a basket the player can
  // barely see reads as a cheat.
  radius: 26,

  // Forward drift along the gorge. Grows without a ceiling, which is what
  // makes the run end eventually however well it is flown.
  baseSpeed: 190,
  speedPerKm: 13,

  // The gorge. Gap is the clear vertical channel between rock.
  baseGap: 265,
  minGap: 140,
  gapNarrowPerKm: 9,

  // Distance between gates. Tightening this shortens the time to read a gap,
  // which is the other half of the difficulty.
  // Gates stay reasonably far apart even at the far end. A slower balloon
  // needs more room to spend its momentum in, and tightening this too far
  // left the late gorge a straight tunnel — the reachable band collapsed to
  // 28px, so the gaps stopped moving and there was nothing left to read.
  baseSpacing: 560,
  minSpacing: 460,
  spacingTightenPerKm: 6,

  // How much of the analytically reachable band the generator is allowed to
  // use. Below 1 so a gap is never merely *just* reachable by a perfect
  // player committing on the exact frame it appeared.
  reachSafety: 0.72,

  // Crosswind: a slow vertical push that varies along the gorge. It is part of
  // the contract rather than an exception to it — see reachableOffset(), which
  // subtracts the worst-case gust before deciding what is reachable.
  gustAccel: 48,
  gustWavelength: 1100,

  // The thinnest the rock may be where it meets the top or bottom of the
  // world. The playable band is derived from this and the gap width rather
  // than being a fixed number — see centreBand().
  //
  // A fixed margin was the first version and it was wrong: 74px of margin
  // against a 265px gap puts the ceiling 58px ABOVE the top of the world, so
  // the gorge quietly stopped having two walls and the drawn silhouette left
  // the screen. It also made the difficulty backwards, because a wide gap
  // could roam as far as a narrow one.
  //
  // Deriving it means a wide early gap cannot move far and a narrow late gap
  // can move a long way, which is the difficulty shape the game wants anyway.
  edgeRock: 30,
};

// The world is this tall. The gorge is carved out of it.
export const WORLD_H = 500;

/** Metres, for the score. One metre of gorge is this many pixels. */
export const PIXELS_PER_METRE = 26;

// --- Difficulty -----------------------------------------------------------

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Everything that changes with distance, in one place so the test can walk it.
 * `x` is pixels travelled along the gorge.
 */
export function difficultyAt(x, tuning = TUNING) {
  const km = x / 1000;
  return {
    speed: tuning.baseSpeed + km * tuning.speedPerKm,
    gap: Math.max(tuning.minGap, tuning.baseGap - km * tuning.gapNarrowPerKm),
    spacing: Math.max(tuning.minSpacing, tuning.baseSpacing - km * tuning.spacingTightenPerKm),
  };
}

// --- The reachability contract -------------------------------------------

/**
 * The balloon's physics at a given drift speed.
 *
 * Accelerations go as the SQUARE of the speed ratio and terminal velocities
 * go linearly with it. That pairing is the whole invariant: v/a has units of
 * time and scales as 1/ratio, exactly matching how the time between gates
 * shrinks, so every vertical DISTANCE in the problem is left unchanged.
 *
 * Without this the game becomes literally unflyable at distance rather than
 * merely hard — measured, not guessed: the reachable band went negative at
 * about 25 km. See the header.
 */
export function physicsAt(speed, tuning = TUNING) {
  const ratio = speed / tuning.baseSpeed;
  const sq = ratio * ratio;
  return {
    burnAccel: tuning.burnAccel * sq,
    sinkAccel: tuning.sinkAccel * sq,
    gustAccel: tuning.gustAccel * sq,
    maxRise: tuning.maxRise * ratio,
    maxSink: tuning.maxSink * ratio,
  };
}

/**
 * The furthest the balloon can move vertically in `time`, starting at the
 * worst legal velocity — terminal, pointing the wrong way — under the weaker
 * of its two accelerations, with the worst crosswind gust against it.
 *
 * The shape of the answer: it must first spend v0/a seconds arresting the
 * momentum it arrived with, losing v0^2/(2a) of ground in the wrong direction
 * while it does. Whatever time is left goes into the right direction, capped
 * at terminal speed.
 *
 * `speed` is the drift the balloon is doing this at, because the physics scale
 * with it. Pass the speed at the gate being generated.
 *
 * This is the function the generator is built on and the function the test
 * checks the generator against, so it is written once and used by both.
 */
export function reachableOffset(time, speed = TUNING.baseSpeed, tuning = TUNING) {
  const p = physicsAt(speed, tuning);
  // The weaker direction decides. A gorge fair only downhill is not fair.
  const accel = Math.min(p.burnAccel, p.sinkAccel) - p.gustAccel;
  const vMax = Math.min(p.maxRise, p.maxSink);
  if (accel <= 0) return 0;

  // Phase 1 — arrest the momentum the balloon arrived with.
  const arrestTime = vMax / accel;
  if (time <= arrestTime) {
    // Not even enough time to stop. Ground is still being lost.
    return -(vMax * time - 0.5 * accel * time * time);
  }
  const lost = (vMax * vMax) / (2 * accel);

  // Phase 2 — accelerate the right way with whatever time remains.
  const left = time - arrestTime;
  const toTerminal = vMax / accel;
  const gained = left <= toTerminal
    ? 0.5 * accel * left * left
    : 0.5 * vMax * toTerminal + vMax * (left - toTerminal);

  return gained - lost;
}

/**
 * Where a gap of this width is allowed to sit, so that both walls stay inside
 * the world with at least `edgeRock` of rock at each end.
 */
export function centreBand(gap, tuning = TUNING) {
  const half = gap / 2 + tuning.edgeRock;
  // A gap wider than the world would invert this. Centre it and say so.
  if (half * 2 >= WORLD_H) return { lo: WORLD_H / 2, hi: WORLD_H / 2 };
  return { lo: half, hi: WORLD_H - half };
}

/**
 * The band of gap centres reachable from `fromCentre` for a gate `spacing`
 * away at `speed`, reduced by the safety factor and intersected with the band
 * the world itself allows for a gap that wide.
 *
 * Two separate constraints, reported separately, because they bind at
 * different distances: early on the gap is wide and the WORLD is the limit;
 * late on the gap is narrow and the balloon's REACH is the limit.
 */
export function reachableBand(fromCentre, spacing, speed, gap, tuning = TUNING) {
  const time = spacing / speed;
  const reach = Math.max(0, reachableOffset(time, speed, tuning)) * tuning.reachSafety;
  const world = centreBand(gap, tuning);
  return {
    reach,
    world,
    lo: Math.max(world.lo, fromCentre - reach),
    hi: Math.min(world.hi, fromCentre + reach),
  };
}

// --- Generation -----------------------------------------------------------

/**
 * The next gate along the gorge.
 *
 * The wanted centre is random, and then it is CLAMPED into the reachable band.
 * That clamp is the contract: a gap outside the band would be one the player
 * could not make however well they flew, and no amount of good generation
 * elsewhere excuses one of those.
 *
 * Returns the clamp's own working as well, so the test can confirm the clamp
 * actually binds sometimes rather than being decorative.
 */
export function nextGate(prev, tuning = TUNING) {
  const x = prev.x + prev.spacing;
  const { speed, gap, spacing } = difficultyAt(x, tuning);
  const band = reachableBand(prev.centre, prev.spacing, speed, gap, tuning);

  // Aim anywhere the world allows, then accept what the balloon can reach.
  // Drawing from the whole world band rather than from the reachable one is
  // deliberate: it means the gorge genuinely wants to go somewhere and the
  // contract is what holds it back, so the clamp is exercised rather than
  // decorative.
  const wanted = band.world.lo + Math.random() * (band.world.hi - band.world.lo);
  const centre = clamp(wanted, band.lo, band.hi);

  return {
    x,
    centre,
    gap,
    spacing,
    speed,
    // Diagnostics, for the test and for nothing else.
    wanted,
    clamped: Math.abs(wanted - centre) > 0.5,
    reach: band.reach,
  };
}

/** The first gate. Centred, wide, and far enough away to be read. */
export function firstGate(tuning = TUNING) {
  const { speed, gap, spacing } = difficultyAt(0, tuning);
  return { x: 620, centre: WORLD_H / 2, gap, spacing, speed, wanted: WORLD_H / 2, clamped: false, reach: 0 };
}

// --- The gorge silhouette -------------------------------------------------

/**
 * Floor and ceiling at an arbitrary x, interpolated between the two gates it
 * falls between with a smoothstep so the rock reads as carved rather than
 * folded. The collision test and the renderer both call this, so what is drawn
 * is exactly what is solid.
 */
export function wallsAt(x, gates) {
  let i = 0;
  while (i < gates.length - 2 && gates[i + 1].x < x) i++;
  const a = gates[i];
  const b = gates[i + 1] ?? a;

  const span = Math.max(1, b.x - a.x);
  const raw = clamp((x - a.x) / span, 0, 1);
  const t = raw * raw * (3 - 2 * raw); // smoothstep

  const centre = a.centre + (b.centre - a.centre) * t;
  const gap = a.gap + (b.gap - a.gap) * t;
  return { ceiling: centre - gap / 2, floor: centre + gap / 2, centre, gap };
}

// --- The simulation -------------------------------------------------------

export const END = {
  ROCK: 'Flew into the rock',
};

/**
 * One run. `step` is the entire game: everything else in games/ember/game.js
 * draws what this produced.
 */
export class Flight {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const T = this.t;
    this.gates = [firstGate(T)];
    // Enough gates ahead that wallsAt() always has a segment to work with.
    while (this.gates.length < 6) this.gates.push(nextGate(this.gates[this.gates.length - 1], T));

    this.x = 0;
    this.y = WORLD_H / 2;
    this.vy = 0;
    this.running = true;
    this.reason = null;
    this.gatesPassed = 0;
    // Index into `gates` of the first gate still ahead of the balloon.
    this.nextGateIndex = 0;
    this.distance = 0;
  }

  /** Metres up the gorge — the score, and the only number the player sees. */
  get metres() {
    return Math.floor(this.x / PIXELS_PER_METRE);
  }

  /**
   * The crosswind at the balloon's position. A smooth standing wave along the
   * gorge rather than a random gust: a wind you cannot see coming is not a
   * skill, and reachableOffset() has already paid for this much of it.
   *
   * Scaled with the drift like every other acceleration, or it would quietly
   * become negligible at distance and stop being part of the game.
   */
  gust(speed) {
    const g = physicsAt(speed, this.t).gustAccel;
    return Math.sin(this.x / this.t.gustWavelength * Math.PI * 2) * g;
  }

  step(dt, { burn }) {
    if (!this.running) return;
    const T = this.t;

    // Everything vertical is stated at the CURRENT drift speed, which is what
    // holds the reachability contract true at any distance.
    const { speed } = difficultyAt(this.x, T);
    const p = physicsAt(speed, T);

    // Vertical: the burner fights gravity, and neither wins instantly. This
    // is the momentum the whole game is about.
    const accel = (burn ? -p.burnAccel : p.sinkAccel) + this.gust(speed);
    this.vy = clamp(this.vy + accel * dt, -p.maxRise, p.maxSink);
    this.y += this.vy * dt;

    this.x += speed * dt;
    this.distance = this.x;

    // Keep the gate window ahead of the balloon.
    while (this.gates[this.gates.length - 1].x < this.x + 2400) {
      this.gates.push(nextGate(this.gates[this.gates.length - 1], T));
    }
    // Gates actually cleared. Counted where they are PASSED rather than where
    // they are dropped from the window below, which is a different and much
    // later event — the game over panel was reporting zero gates passed on a
    // run that had flown through two.
    while (this.nextGateIndex < this.gates.length && this.gates[this.nextGateIndex].x <= this.x) {
      this.nextGateIndex++;
      this.gatesPassed++;
    }

    // Drop the ones well behind, so a long run does not grow without bound.
    while (this.gates.length > 8 && this.gates[1].x < this.x - 900) {
      this.gates.shift();
      this.nextGateIndex = Math.max(0, this.nextGateIndex - 1);
    }

    // Collision. The envelope is a circle, so the test is the same one the
    // renderer draws.
    const { ceiling, floor } = wallsAt(this.x, this.gates);
    if (this.y - T.radius <= ceiling || this.y + T.radius >= floor) {
      this.running = false;
      this.reason = END.ROCK;
    }
  }
}
