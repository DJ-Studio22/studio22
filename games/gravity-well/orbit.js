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
  width: 200,
  height: 130,

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
  // NINE AND A HALF SECONDS OF LINE, and the figure is not arbitrary: the same
  // pilot given more of it flies better, measurably. Sixty first levels, one
  // pilot, three horizons -- 43 cleared at 7.5 seconds, 50 at 11, 55 at 15. If
  // foresight is what the game rewards then the game should hand a player a
  // generous amount of it, and 9.5 is where the line still reads as one arc
  // rather than a plate of spaghetti.
  predictSeconds: 9.5,
  predictEvery: 4,            // keep one point in four, to draw

  // The level.
  gateRadius: 4.2,
  // Reaching the gate too fast is not reaching the gate. This is what makes an
  // approach a problem rather than a direction.
  gateSpeed: 34,

  // Escaping. A craft this far outside the field is gone, and saying so beats
  // letting a player watch a dot leave for thirty seconds.
  strayMargin: 90,

  // HOW MUCH ROOM THE START GETS, and it is here because of what playing it
  // cold looked like. Twenty-two units of clearance is about a second and a
  // half of falling: five seconds of touching nothing ended the run CRASHED
  // with no fuel burned, which is the fault CLAUDE.md names twice -- a game
  // that kills you before you have acted. Fifty-two units is far enough out
  // that the pull is gentle and the first thing that happens is a slow drift
  // you have time to read.
  startClear: 52,

  // Scoring: the gate, plus what you did not spend getting there.
  scorePerGate: 500,
  scorePerFuel: 6,
  // A level refills the tank, so a run is a sequence of problems rather than
  // one long budget. What carries over is the score.
  levels: {
    bodiesBase: 1,
    bodiesPerLevel: 0.34,
    bodiesMax: 5,
    massBase: 1.0,
    massPerLevel: 0.06,
    // How far the gate is from the start, as a fraction of the field.
    reachBase: 0.42,
    reachPerLevel: 0.02,
    reachMax: 0.8,
  },
};

export const END = { STRANDED: 'Out of fuel', CRASHED: 'Crashed', STRAYED: 'Lost' };

// --- The field ------------------------------------------------------------

/**
 * A level: bodies, a start, and a gate.
 *
 * Generated and then CHECKED, the same discipline as the mini golf generator
 * proving a hole is sinkable and Colour Heist proving a vault has a route. A
 * level nobody can reach is not a hard level.
 */
export function buildLevel(n, t = TUNING) {
  const L = t.levels;
  const bodies = Math.min(L.bodiesMax, Math.round(L.bodiesBase + L.bodiesPerLevel * (n - 1)));
  const reach = Math.min(L.reachMax, L.reachBase + L.reachPerLevel * (n - 1));
  const mass = L.massBase + L.massPerLevel * (n - 1);

  for (let attempt = 0; attempt < 200; attempt++) {
    const level = layout(n, bodies, reach, mass, t);
    if (level) return level;
  }
  // Fall back to a level with one body, which is always layoutable. Better a
  // slightly easy level than a hang or a throw in the middle of a run.
  return layout(n, 1, L.reachBase, mass, t) ?? layout(n, 1, 0.4, 1, t);
}

function layout(n, bodyCount, reach, mass, t) {
  const start = { x: t.width * 0.12, y: t.height * (0.3 + Math.random() * 0.4) };
  const angle = (Math.random() * 2 - 1) * 0.6;
  const distance = t.width * reach;
  const gate = {
    x: start.x + Math.cos(angle) * distance,
    y: start.y + Math.sin(angle) * distance,
  };
  if (gate.x > t.width - 12 || gate.y < 10 || gate.y > t.height - 10) return null;

  const bodies = [];
  for (let i = 0; i < bodyCount; i++) {
    const radius = 5 + Math.random() * 5;
    const body = {
      x: 20 + Math.random() * (t.width - 40),
      y: 12 + Math.random() * (t.height - 24),
      radius,
      // Mass scales with size, so a big body looks like the pull it has. A
      // player should never have to learn a body's strength by dying to it.
      mass: radius * radius * 0.9 * mass,
    };
    // Not on top of the start, not on top of the gate, not on top of another
    // body -- all three of which produce a level that cannot be flown.
    if (near(body, start, radius + t.startClear)) return null;
    if (near(body, gate, radius + t.gateRadius + 9)) return null;
    if (bodies.some((other) => near(body, other, body.radius + other.radius + 8))) return null;
    bodies.push(body);
  }

  return { n, start, gate, bodies };
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
    this.level = 1;
    this.score = 0;
    this.gatesMade = 0;
    this.fuelSpent = 0;
    this.running = true;
    this.reason = null;
    this.#load();
  }

  #load() {
    const level = buildLevel(this.level, this.t);
    this.bodies = level.bodies;
    this.gate = level.gate;
    this.start = level.start;
    // A tankful per level, so a run is a sequence of problems rather than one
    // long budget that a single bad first burn ruins.
    this.craft = {
      x: level.start.x, y: level.start.y, vx: 0, vy: 0, angle: 0, fuel: this.t.fuel,
    };
    this.time = 0;
    this.carry = 0;
    this.arrivedSpeed = null;
    // NOTHING MOVES UNTIL THE PLAYER TOUCHES SOMETHING.
    //
    // The other half of the same fix, and the same trick Colour Heist uses to
    // start its clock. This is a game about reading a field before committing
    // to it, so the field has to be readable before it starts happening --
    // otherwise the first thing every level teaches is that looking at it costs
    // you. There is no timer behind this: it waits as long as you do.
    this.armed = false;
  }

  /** The line the game draws, for the control being held right now. */
  path(control) {
    return predict(this.craft, this.bodies, control, this.t);
  }

  /**
   * `dt` is real time; the simulation is advanced in fixed steps and the
   * remainder carried, so what is flown does not depend on the frame rate --
   * which is the other half of the prediction being honest.
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
      // A tab that was in the background does not get to simulate the minute it
      // missed in a single frame.
      this.carry = 0;
      steps = t.maxCatchUp;
    } else {
      this.carry -= steps * t.step;
    }

    for (let i = 0; i < steps && this.running; i++) {
      const before = this.craft.fuel;
      advance(this.craft, this.bodies, control, t.step, t);
      this.fuelSpent += before - this.craft.fuel;
      this.time += t.step;
      this.#check();
    }
  }

  #check() {
    const t = this.t;
    const craft = this.craft;

    for (const body of this.bodies) {
      if (Math.hypot(craft.x - body.x, craft.y - body.y) < body.radius + t.craftRadius) {
        return this.#end(END.CRASHED);
      }
    }
    if (strayed(craft, t)) return this.#end(END.STRAYED);

    const toGate = Math.hypot(craft.x - this.gate.x, craft.y - this.gate.y);
    if (toGate < t.gateRadius) {
      const speed = speedOf(craft);
      // ARRIVING IS NOT THE SAME AS ARRIVING SLOWLY ENOUGH. Without this the
      // answer to every level is "point at it and hold the trigger", and the
      // bodies are scenery.
      if (speed <= t.gateSpeed) return this.#gate(speed);
    }

    // Out of fuel is only the end if you are also going nowhere useful: a
    // coasting craft on a good arc is still playing.
    if (craft.fuel <= 0 && this.#hopeless()) return this.#end(END.STRANDED);
    return undefined;
  }

  /**
   * With the tank empty, is the gate still reachable?
   *
   * Answered by flying it: coast for half a minute and see whether the craft
   * ever passes through the gate slowly enough. Same arithmetic again -- the
   * game never asks a question about the future except by running the future.
   *
   * ORDER MATTERS HERE, and getting it wrong ended runs that were going fine.
   * The first version asked "does this path end badly?" before "does it reach
   * the gate?", and a coasting craft eventually leaves the field by definition,
   * so every empty tank was declared hopeless -- including one falling straight
   * through the gate two seconds later. Reaching the gate is checked FIRST, on
   * every step, and only a path that crashes or leaves before it gets there is
   * hopeless.
   */
  #hopeless() {
    const t = this.t;
    const copy = { ...this.craft };
    const steps = Math.round(30 / t.step);
    for (let i = 0; i < steps; i++) {
      advance(copy, this.bodies, {}, t.step, t);
      if (Math.hypot(copy.x - this.gate.x, copy.y - this.gate.y) < t.gateRadius
        && speedOf(copy) <= t.gateSpeed) return false;
      for (const body of this.bodies) {
        if (Math.hypot(copy.x - body.x, copy.y - body.y) < body.radius + t.craftRadius) return true;
      }
      if (strayed(copy, t)) return true;
    }
    return true;
  }

  #gate(speed) {
    const t = this.t;
    this.gatesMade++;
    this.arrivedSpeed = speed;
    this.score += t.scorePerGate + Math.round(this.craft.fuel * t.scorePerFuel);
    this.level++;
    this.#load();
  }

  #end(reason) {
    this.running = false;
    this.reason = reason;
  }
}
