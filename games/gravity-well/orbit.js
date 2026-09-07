// games/gravity-well/orbit.js
//
// Gravity Well's simulation: the bodies, the craft, the fuel, and the
// prediction. No canvas, no input device, no audio.
//
// THE ONE THING THIS GAME HAS TO GET RIGHT
// ----------------------------------------
// THE PREDICTED PATH MUST BE HONEST.
//
// The whole skill here is reading a trajectory before committing to it. If the
// line on screen is drawn by one piece of arithmetic and the craft flies by
// another, then every hour a player spends learning to read that line is spent
// learning something the game does not do. That is not a bug in the HUD; it is
// the game being a lie.
//
// Tank Tactics settled how to avoid that and this file follows it exactly:
// there is ONE integrator, `advance()`. The craft flies by calling it once a
// frame. The prediction calls it a few hundred times against a COPY of the same
// state. They cannot disagree, because there is nothing to disagree with.
//
// tests/gravity-well.orbit.test.mjs holds the line to it two ways: it flies a
// craft and predicts it and asserts they land on the same point to within
// floating-point noise, and then it breaks the physics in a cloned tuning so
// that a prediction made under the old numbers is wrong -- which is what stops
// the first test passing because both halves are equally broken.
//
// WHAT THE GAME IS
// ----------------
// Reach the gate. You have a small tank of fuel, a much bigger budget of
// patience, and several bodies whose pull is the only thing that will get you
// there. Burning is a decision; falling is free.

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The corridor is unbounded to the right; height is floor to ceiling.
  height: 150,

  // THE INTEGRATOR'S FIXED STEP.
  //
  // The simulation advances in slices of this, however long a frame took. A
  // variable step would make the prediction and the flight differ by exactly
  // the amount the machine was busy, which is the honest-line problem sneaking
  // back in through the timer.
  step: 1 / 120,
  // How many steps a frame may catch up on, so a tab that was in the background
  // for a minute does not simulate a minute in one frame.
  maxCatchUp: 24,

  // Gravity. Newtonian, with a floor on the distance so a body is a well
  // rather than a singularity: without softening, a craft that clips the centre
  // is accelerated to a number that no longer means anything.
  G: 900,
  softening: 3.0,

  // The craft.
  thrust: 34,
  turnRate: 3.0,              // radians a second
  fuel: 140,
  fuelPerSecond: 15,
  craftRadius: 1.4,

  // What the prediction draws: how far ahead, and at what resolution. Long
  // enough to show a whole swing round a body, and it is the same arithmetic
  // whatever these are set to.
  // FIVE SECONDS OF LINE, and the figure was measured rather than chosen.
  //
  // The line answers "where does this take me if I keep doing this", so its
  // useful length is bounded by how long anybody actually holds a control. The
  // same pilot at different horizons, thirty seeds each, distance in units:
  //
  //   none  670 | 0.5s  670 | 1s 2074 | 2s 3370 | 3s 7661 | 4.5s 7153 | 6s 7657
  //   and then it falls away: 9.5s 3021, 15s 2626.
  //
  // Eleven times better with three seconds of it than with none, a plateau from
  // three to six, and worse beyond -- because a fifteen-second line drawn on
  // the assumption you never move the stick is a fifteen-second lie. Five is in
  // the middle of the plateau and long enough to show a whole swing round a
  // body.
  predictSeconds: 5,
  predictEvery: 4,            // keep one point in four, to draw

  // A FUEL RING: how close you must pass to take it.
  gateRadius: 5.6,

  // Leaving the corridor. There is a floor and a ceiling; this is how far past
  // one counts as gone, and saying so beats watching a dot leave for thirty
  // seconds.
  strayMargin: 40,

  // Scoring: distance, plus something for the rings, because a run that takes
  // the awkward ring is worth more than one that coasts past it.
  scorePerRing: 120,

  // THE CORRIDOR. Chunks are generated ahead of the craft and forgotten behind
  // it, so the world is unbounded in one direction and the camera has something
  // to follow.
  chunkWidth: 150,
  corridor: {
    lookAhead: 3,
    bodiesBase: 1.2,
    bodiesPerChunk: 0.16,
    bodiesMax: 6,
    massBase: 1.0,
    massPerChunk: 0.02,
    // A ring in every chunk, and a second one this often.
    ringChance: 0.45,
    // The clear lane a chunk must leave somewhere across its height.
    gap: 7,
  },
};

export const END = { STRANDED: 'Out of fuel', CRASHED: 'Crashed', STRAYED: 'Lost' };

// --- The corridor --------------------------------------------------------
//
// THE WORLD IS ONE CONTINUOUS CHAIN, GENERATED AHEAD OF YOU.
//
// It used to be discrete levels: a field, a start, a gate, and a fresh field
// when you reached it. That made the gate a finish line and the camera
// pointless -- everything fitted on one screen, so there was nothing to follow.
//
// Now the craft flies right and the world is built in CHUNKS in front of it and
// forgotten behind. Bodies to slingshot around and to avoid, and fuel rings
// scattered along the way that fill the tank when you pass through one. Distance
// is the score. There is no finish, only how far.

/** How far into the corridor a chunk begins. */
export const chunkStart = (index, t = TUNING) => index * t.chunkWidth;

/**
 * The bodies and rings in one chunk of corridor.
 *
 * Generated and then CHECKED, the same discipline as before: a chunk that
 * buries a ring inside a body, or leaves no gap wide enough to fly through, is
 * thrown away and rolled again. A corridor nobody can pass is not a hard
 * corridor.
 */
export function buildChunk(index, t = TUNING) {
  const x0 = chunkStart(index, t);
  // THE FIRST CHUNK IS EMPTY. It is the run-up, and it is a number somebody
  // chose rather than whatever the generator happened to produce -- without it
  // a body could be placed on the start and the first run ended CRASHED four
  // tenths of a second in, having flown thirty-seven units.
  const difficulty = Math.max(0, index - 1);
  const bodies = index === 0 ? 0 : Math.min(
    t.corridor.bodiesMax,
    Math.round(t.corridor.bodiesBase + t.corridor.bodiesPerChunk * difficulty),
  );
  const mass = t.corridor.massBase + t.corridor.massPerChunk * difficulty;

  for (let attempt = 0; attempt < 120; attempt++) {
    const chunk = layoutChunk(index, x0, bodies, mass, t);
    if (chunk) return chunk;
  }
  return layoutChunk(index, x0, 1, t.corridor.massBase, t) ?? { index, x0, bodies: [], rings: [] };
}

function layoutChunk(index, x0, bodyCount, mass, t) {
  // BODIES GO IN BANDS, and one band is always left empty.
  //
  // Scattering them at random and rejecting any layout without a lane through
  // it sounds equivalent and is not: past three or four bodies almost every
  // random layout blocks the corridor, so the generator exhausted its retries
  // and fell back to a single body. Measured, the corridor stopped getting
  // harder at chunk twenty and then got EASIER -- four bodies at twenty, one at
  // forty, one at four thousand. Building the lane in rather than hoping for it
  // keeps the escalation real.
  const bands = bodyCount + 1;
  const bandHeight = t.height / bands;
  const free = Math.floor(Math.random() * bands);
  const bodies = [];
  let band = 0;
  for (let i = 0; i < bodyCount; i++) {
    if (band === free) band++;
    const radius = 5 + Math.random() * 6;
    const centre = (band + 0.5) * bandHeight;
    const slack = Math.max(0, bandHeight / 2 - radius - 2);
    const body = {
      x: x0 + 14 + Math.random() * (t.chunkWidth - 28),
      y: centre + (Math.random() * 2 - 1) * slack,
      radius,
      mass: radius * radius * 0.9 * mass,
    };
    if (bodies.some((other) => near(body, other, body.radius + other.radius + 18))) return null;
    bodies.push(body);
    band++;
  }

  // A ring or two per chunk, never inside a body and never in its skin.
  const rings = [];
  const wanted = Math.random() < t.corridor.ringChance ? 2 : 1;
  for (let i = 0; i < wanted; i++) {
    const ring = {
      x: x0 + 20 + Math.random() * (t.chunkWidth - 40),
      y: 16 + Math.random() * (t.height - 32),
      taken: false,
      id: String(index) + ':' + String(i),
    };
    if (bodies.some((body) => near(body, ring, body.radius + t.gateRadius + 14))) return null;
    if (rings.some((other) => near(other, ring, t.gateRadius * 6))) return null;
    rings.push(ring);
  }

  // THE GAP CHECK. Somewhere in this chunk there has to be a horizontal line
  // the craft could fly along without touching anything -- otherwise the
  // corridor is a wall and the only question is where you die.
  if (!hasGap(bodies, t)) return null;

  return { index, x0, bodies, rings };
}

/** Is there a lane through this chunk wide enough to fly? */
function hasGap(bodies, t) {
  const need = t.craftRadius + t.corridor.gap;
  for (let y = need; y <= t.height - need; y += 2) {
    let clear = true;
    for (const body of bodies) {
      if (Math.abs(body.y - y) < body.radius + need) { clear = false; break; }
    }
    if (clear) return true;
  }
  return false;
}

const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) < d;

// --- The physics ----------------------------------------------------------

/**
 * The pull of every body at a point.
 *
 * Softened: `softening` is added to the distance before it is squared, so the
 * centre of a body is a strong pull rather than an infinite one. Without it a
 * craft that passes exactly through a centre picks up a velocity with no
 * physical meaning and the prediction, which is doing the identical sum, draws
 * it faithfully going to the moon.
 */
export function gravityAt(x, y, bodies, t = TUNING) {
  let ax = 0;
  let ay = 0;
  for (const body of bodies) {
    const dx = body.x - x;
    const dy = body.y - y;
    const d = Math.hypot(dx, dy) + t.softening;
    const pull = (t.G * body.mass) / (d * d * d);
    ax += dx * pull;
    ay += dy * pull;
  }
  return { ax, ay };
}

/**
 * ONE STEP OF THE WORLD. The only place motion happens.
 *
 * `state` is { x, y, vx, vy, angle, fuel } and is MUTATED, because this runs
 * hundreds of times a frame for the prediction and allocating a new object each
 * time would show up on a phone. Callers that want to keep the old one pass a
 * copy -- see `predict()` immediately below, which is the only caller that
 * cares.
 *
 * Velocity Verlet rather than Euler, because Euler's error is a slow outward
 * spiral: a stable circular orbit drifts away over a few laps, and a player
 * cannot tell a physics bug from their own bad flying.
 */
export function advance(state, bodies, control, dt, t = TUNING) {
  const burning = Boolean(control.burn) && state.fuel > 0;

  if (control.turn) state.angle += control.turn * t.turnRate * dt;

  const first = gravityAt(state.x, state.y, bodies, t);
  let ax = first.ax;
  let ay = first.ay;
  if (burning) {
    ax += Math.cos(state.angle) * t.thrust;
    ay += Math.sin(state.angle) * t.thrust;
    state.fuel = Math.max(0, state.fuel - t.fuelPerSecond * dt);
  }

  state.x += state.vx * dt + 0.5 * ax * dt * dt;
  state.y += state.vy * dt + 0.5 * ay * dt * dt;

  const second = gravityAt(state.x, state.y, bodies, t);
  let bx = second.ax;
  let by = second.ay;
  if (burning) {
    bx += Math.cos(state.angle) * t.thrust;
    by += Math.sin(state.angle) * t.thrust;
  }

  state.vx += 0.5 * (ax + bx) * dt;
  state.vy += 0.5 * (ay + by) * dt;
  return state;
}

/**
 * WHERE YOU ARE GOING, drawn by flying a copy of you.
 *
 * This is the honest line. It runs the same advance() the craft runs, at the
 * same fixed step, over a copy of the same state, against the same bodies. It
 * is not an approximation of the flight and it is not a separate model kept in
 * agreement by discipline -- there is one piece of arithmetic and this calls it.
 *
 * `control` is what you are doing RIGHT NOW, held for the whole prediction, so
 * the line answers "where does this take me if I keep doing this" -- which is
 * the question a player is actually asking with their thumb on the trigger.
 */
export function predict(state, bodies, control, t = TUNING, options = {}) {
  const seconds = options.seconds ?? t.predictSeconds;
  const steps = Math.round(seconds / t.step);
  const copy = { ...state };
  const points = [{ x: copy.x, y: copy.y }];
  let hit = null;

  for (let i = 0; i < steps; i++) {
    advance(copy, bodies, control, t.step, t);
    // The line stops where the flight would stop. A prediction that draws
    // straight through a planet is worse than no prediction.
    for (const body of bodies) {
      if (Math.hypot(copy.x - body.x, copy.y - body.y) < body.radius + t.craftRadius) {
        hit = { kind: 'body', x: copy.x, y: copy.y };
        break;
      }
    }
    if (!hit && strayed(copy, t)) hit = { kind: 'stray', x: copy.x, y: copy.y };
    if (i % t.predictEvery === 0 || hit) points.push({ x: copy.x, y: copy.y });
    if (hit) break;
  }
  return { points, hit, end: { x: copy.x, y: copy.y, vx: copy.vx, vy: copy.vy } };
}

export const strayed = (state, t = TUNING) => (
  state.x < -t.strayMargin || state.x > t.width + t.strayMargin
  || state.y < -t.strayMargin || state.y > t.height + t.strayMargin
);

export const speedOf = (state) => Math.hypot(state.vx, state.vy);

// --- The run --------------------------------------------------------------

export class Flight {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.score = 0;
    this.distance = 0;
    this.ringsTaken = 0;
    this.bodiesPassed = 0;
    this.fuelSpent = 0;
    this.running = true;
    this.reason = null;
    this.chunks = [];
    this.nextChunk = 0;

    this.craft = { x: 24, y: t.height / 2, vx: 0, vy: 0, angle: 0, fuel: t.fuel };
    this.time = 0;
    this.carry = 0;
    // Nothing moves until the player touches a control. See the note in
    // PROGRESS.md: this is a game about reading a field before committing to
    // it, so the field has to be readable before it starts happening.
    this.armed = false;
    this.#extend();
  }

  /** Build corridor ahead of the craft and forget what is well behind it. */
  #extend() {
    const t = this.t;
    const ahead = this.craft.x + t.chunkWidth * t.corridor.lookAhead;
    while (chunkStart(this.nextChunk, t) < ahead) {
      this.chunks.push(buildChunk(this.nextChunk, t));
      this.nextChunk++;
    }
    const behind = this.craft.x - t.chunkWidth * 1.5;
    this.chunks = this.chunks.filter((c) => c.x0 + t.chunkWidth > behind);
    this.#rebuild();
  }

  // The live world, CACHED rather than rebuilt on every read.
  //
  // These were getters that walked the chunks and allocated a fresh array each
  // time. That is fine until you notice who calls them: the collision check
  // every simulation step, and the prediction inside its own inner loop, eight
  // candidate controls deep. A ninety-second bot run never finished. They are
  // rebuilt when the corridor changes and when a ring is taken, which is the
  // only time they can change.
  #rebuild() {
    this.bodies = [];
    this.rings = [];
    for (const chunk of this.chunks) {
      for (const body of chunk.bodies) this.bodies.push(body);
      for (const ring of chunk.rings) if (!ring.taken) this.rings.push(ring);
    }
  }

  /** The line the game draws, for the control being held right now. */
  path(control) {
    return predict(this.craft, this.bodies, control, this.t);
  }

  /**
   * `dt` is real time; the simulation advances in fixed steps and the remainder
   * is carried, so what is flown does not depend on the frame rate -- which is
   * the other half of the prediction being honest.
   */
  step(dt, control = {}) {
    if (!this.running) return;
    const t = this.t;
    if (!this.armed) {
      if (!control.burn && !control.turn) return;
      this.armed = true;
    }

    this.carry += dt;
    let steps = Math.floor(this.carry / t.step);
    if (steps > t.maxCatchUp) {
      this.carry = 0;
      steps = t.maxCatchUp;
    } else {
      this.carry -= steps * t.step;
    }

    for (let i = 0; i < steps && this.running; i++) {
      const before = this.craft.fuel;
      const wasAt = this.craft.x;
      advance(this.craft, this.bodies, control, t.step, t);
      this.fuelSpent += before - this.craft.fuel;
      this.time += t.step;
      // DISTANCE IS THE SCORE, and only forward counts: drifting backwards and
      // forwards over the same stretch is not progress.
      if (this.craft.x > wasAt) this.distance = Math.max(this.distance, this.craft.x);
      this.#check();
    }
    this.#extend();
    this.score = Math.round(this.distance - 24) + this.ringsTaken * t.scorePerRing;
  }

  #check() {
    const t = this.t;
    const craft = this.craft;

    for (const body of this.bodies) {
      if (Math.hypot(craft.x - body.x, craft.y - body.y) < body.radius + t.craftRadius) {
        return this.#end(END.CRASHED);
      }
    }
    // The corridor has a floor and a ceiling; going out the back is the only
    // other way to leave it.
    if (craft.y < -t.strayMargin || craft.y > t.height + t.strayMargin
      || craft.x < this.distance - t.chunkWidth) {
      return this.#end(END.STRAYED);
    }

    // FUEL RINGS. Passing through one fills the tank -- no speed limit, because
    // a ring is a refuel and not a landing, and the craft is usually moving
    // fast when it needs one most.
    for (const chunk of this.chunks) {
      for (const ring of chunk.rings) {
        if (ring.taken) continue;
        if (Math.hypot(craft.x - ring.x, craft.y - ring.y) > t.gateRadius) continue;
        ring.taken = true;
        this.#rebuild();
        this.ringsTaken++;
        this.lastRingAt = this.time;
        craft.fuel = t.fuel;
      }
    }

    if (craft.fuel <= 0 && this.#hopeless()) return this.#end(END.STRANDED);
    return undefined;
  }

  /**
   * With the tank empty, is there anything left to fly to?
   *
   * Answered by flying it: coast for half a minute and see whether the craft
   * makes it through a ring or simply falls into something. Same arithmetic
   * again -- the game never asks a question about the future except by running
   * the future.
   */
  #hopeless() {
    const t = this.t;
    const copy = { ...this.craft };
    const bodies = this.bodies;
    const rings = this.rings;
    const steps = Math.round(30 / t.step);
    for (let i = 0; i < steps; i++) {
      advance(copy, bodies, {}, t.step, t);
      for (const ring of rings) {
        if (Math.hypot(copy.x - ring.x, copy.y - ring.y) < t.gateRadius) return false;
      }
      for (const body of bodies) {
        if (Math.hypot(copy.x - body.x, copy.y - body.y) < body.radius + t.craftRadius) return true;
      }
      if (copy.y < -t.strayMargin || copy.y > t.height + t.strayMargin) return true;
    }
    return true;
  }

  #end(reason) {
    this.running = false;
    this.reason = reason;
  }
}
