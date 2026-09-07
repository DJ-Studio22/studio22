// games/rift-runner/rift.js
//
// Rift Runner's simulation: the runner, the realms, and the one contract that
// keeps an endless runner fair. No canvas, no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// The game makes two claims and both are arithmetic.
//
//   1. Every obstacle pattern can be cleared. Not "was cleared once by
//      somebody" — there EXISTS an input sequence that gets through it, and a
//      solver proves it rather than a playtest suggesting it.
//   2. That stays true at every speed, in every realm, forever.
//
// The second is the one that kills endless runners. Speed rises without a
// ceiling, so a jump that cleared a four-tile gap at the start clears three
// tiles later and two after that, and the patterns quietly stop being
// possible. The player experiences that as the game cheating, which it is.
//
// THE SPEED-INVARIANCE CONTRACT
// -----------------------------
// Gravity scales with the SQUARE of the run speed and the jump impulse scales
// linearly with it. Both time terms then shrink exactly as fast as the speed
// rises, so a jump covers the same number of TILES at 340 px/s and at 3,400.
// Slide and dash durations scale as 1/speed for the same reason.
//
// The consequence is the point: a pattern authored in tiles is clearable
// forever. What escalates is the wall-clock time you have to read it, which is
// honest — the geometry never becomes impossible, you just have less time to
// see it.
//
// This is the third game to need this exact fix. Gravity Flip found it,
// Ember rediscovered it (its reachable band hit zero at 25 km), and it is
// written into the design here from the start rather than patched in.
//
// THE REALMS
// ----------
// A rift changes the RULES, not the backdrop. Each realm scales gravity, jump
// and speed differently, so the same three verbs produce different distances
// and a pattern that is comfortable in one realm can be impossible in
// another. That is allowed — what is NOT allowed is a pattern being DEALT in
// a realm it cannot be cleared in, and patterns.js checks its own library
// against this module at load to make sure none is.

// --- Geometry -------------------------------------------------------------

export const TILE = 40;

// The world, in tiles. Row 0 is the ceiling, ROWS-1 is the floor surface.
export const ROWS = 12;
export const WORLD_H = ROWS * TILE;          // 480

// Where the ground sits, and the headroom above it.
export const GROUND_Y = (ROWS - 2) * TILE;   // 400

// --- Tuning ---------------------------------------------------------------
//
// A plain object, so a test can clone it, change one figure and run both
// versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // Run speed. Rises without a ceiling — this is the only thing that makes an
  // endless run end.
  baseSpeed: 340,
  speedPerKm: 26,

  // The jump, stated at baseSpeed. Everything else is derived so that this
  // jump always covers the same ground in TILES.
  //
  // 780 against 2600 gives an apex of 117px (just under 3 tiles) and an airtime
  // of 0.6s, which is 204px at base speed — a shade over 5 tiles of travel.
  // Patterns are authored against that.
  jumpImpulse: 780,
  gravity: 2600,

  // Cutting the jump short by releasing early. The difference between a hop
  // and a full jump is most of the vertical control the player has.
  jumpCutMultiplier: 0.45,

  // Coyote time and input buffering, both in seconds at base speed and both
  // scaled with it. Neither is generosity for its own sake: without them a
  // runner at 900 px/s is unplayable by anybody, because the window to press
  // at the right pixel is shorter than a human reaction.
  coyoteTime: 0.09,
  bufferTime: 0.11,

  // The slide is HELD, not a fixed-length move, and that is a correction.
  //
  // It was a 0.42s dash to begin with, which covers 143px at base speed. A bar
  // is 120px wide, so the window to start the slide in was 23px — about one
  // and a half frames. The bots died on bars 27 times in 40 runs and they were
  // right to: a window that small is not a skill, it is a coin toss, and the
  // five-tile `long-bar` was very nearly impossible outright.
  //
  // Holding it removes the timing problem entirely and leaves the real one:
  // you cannot slide in mid-air, so a bar after a gap still has to be landed
  // for. slideMinTime is only so a tap reads as a slide rather than a flicker.
  slideMinTime: 0.12,
  slideHeight: 22,

  // The dash. This is the rift-phase: for its duration the runner is between
  // realms and passes through rift walls. Same 1/speed scaling.
  dashTime: 0.20,
  dashCooldown: 0.85,
  dashSpeedBonus: 1.35,

  // The runner's box.
  bodyW: 26,
  bodyH: 44,

  // How far apart patterns are dealt, in tiles of clear ground. Enough to land,
  // reset and read the next one.
  restTiles: 4,

  // How often a rift opens, in metres.
  //
  // 220 to begin with, and the bots said that was wrong in the plainest way
  // available: the median run of BOTH skill levels entered zero rifts. The
  // portals are the whole hook of the game and nobody was living long enough
  // to see one. The first is early enough that a first run meets it; after
  // that they come often enough to keep the rules moving.
  firstRiftMetres: 45,
  realmMetres: 95,
};

/** Metres, for the score. */
export const PIXELS_PER_METRE = 30;

// --- The realms -----------------------------------------------------------
//
// Each is a set of multipliers on the base physics. `tags` is what patterns
// declare themselves legal in — see patterns.js.
//
// The multipliers are chosen so each realm changes WHICH VERB IS CHEAP rather
// than just how it feels:
//
//   surface  the baseline everything else is read against
//   drift    long floaty jumps, so gaps are trivial and low bars are lethal
//   forge    short heavy jumps, so gaps need the dash and bars are easy
//   surge    fast, but the dash comes back almost instantly
//   inverse  gravity points up; the runner runs on the ceiling
export const REALMS = [
  {
    id: 'surface', name: 'Surface',
    gravityScale: 1, jumpScale: 1, speedScale: 1, dashCooldownScale: 1,
    flipped: false,
  },
  {
    id: 'drift', name: 'Drift',
    gravityScale: 0.5, jumpScale: 0.8, speedScale: 0.95, dashCooldownScale: 1.1,
    flipped: false,
  },
  {
    id: 'forge', name: 'Forge',
    gravityScale: 1.8, jumpScale: 1.2, speedScale: 1, dashCooldownScale: 0.7,
    flipped: false,
  },
  {
    id: 'surge', name: 'Surge',
    gravityScale: 1.15, jumpScale: 1.05, speedScale: 1.3, dashCooldownScale: 0.35,
    flipped: false,
  },
  {
    id: 'inverse', name: 'Inverse',
    gravityScale: 1, jumpScale: 1, speedScale: 1, dashCooldownScale: 1,
    flipped: true,
  },
];

export const realmById = (id) => REALMS.find((r) => r.id === id) ?? REALMS[0];

// --- Speed and the invariance --------------------------------------------

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** Run speed at a distance, before the realm's own multiplier. */
export function speedAt(x, tuning = TUNING) {
  return tuning.baseSpeed + (x / 1000) * tuning.speedPerKm;
}

/**
 * The physics at a given speed, in a given realm.
 *
 * Gravity goes as speed^2 and the jump impulse linearly with it, which is
 * what holds every distance constant in tiles. Durations go as 1/speed for
 * the same reason. See the header.
 */
export function physicsAt(speed, realm = REALMS[0], tuning = TUNING) {
  const ratio = speed / tuning.baseSpeed;
  return {
    gravity: tuning.gravity * ratio * ratio * realm.gravityScale,
    jumpImpulse: tuning.jumpImpulse * ratio * realm.jumpScale,
    slideMinTime: tuning.slideMinTime / ratio,
    dashTime: tuning.dashTime / ratio,
    dashCooldown: (tuning.dashCooldown / ratio) * realm.dashCooldownScale,
    coyoteTime: tuning.coyoteTime / ratio,
    bufferTime: tuning.bufferTime / ratio,
  };
}

/**
 * How far a full jump travels, in TILES, in this realm. Constant with speed
 * by construction — the test asserts exactly that, because it is the whole
 * contract and it is the thing a careless tuning change breaks.
 */
export function jumpTiles(realm = REALMS[0], tuning = TUNING) {
  const p = physicsAt(tuning.baseSpeed * realm.speedScale, realm, tuning);
  const airtime = (2 * p.jumpImpulse) / p.gravity;
  return (tuning.baseSpeed * realm.speedScale * airtime) / TILE;
}

/** Peak height of a full jump, in tiles. */
export function jumpHeightTiles(realm = REALMS[0], tuning = TUNING) {
  const p = physicsAt(tuning.baseSpeed * realm.speedScale, realm, tuning);
  return (p.jumpImpulse * p.jumpImpulse) / (2 * p.gravity) / TILE;
}

/** How far a dash carries, in tiles. */
export function dashTiles(realm = REALMS[0], tuning = TUNING) {
  const speed = tuning.baseSpeed * realm.speedScale;
  const p = physicsAt(speed, realm, tuning);
  return (speed * tuning.dashSpeedBonus * p.dashTime) / TILE;
}

// --- Obstacles ------------------------------------------------------------
//
// Four kinds, one per verb plus one that combines two. A pattern is a list of
// these at tile offsets; patterns.js holds the library.
export const KIND = {
  // On the ground, one tile tall. Jump it.
  SPIKE: 'spike',
  // Overhead, hanging from a height. Slide under it, or be airborne above it
  // if there is room — which is what makes bars over gaps interesting.
  BAR: 'bar',
  // A hole in the floor. Jump or dash across.
  GAP: 'gap',
  // Floor to ceiling, solid, and passable ONLY while phasing. This is what
  // the dash is for.
  RIFT: 'rift',
};

/**
 * How high the runner's FEET are above the floor of the realm they are in.
 *
 * Every obstacle test below works in this one coordinate, and that is what
 * makes Inverse a real mirrored world rather than a backdrop. The first cut
 * measured everything from GROUND_Y, so in Inverse — where the runner is on
 * the ceiling — bars hung on the far side of the world and the solver
 * correctly reported almost every pattern impossible.
 */
export function heightAbove(state, realm) {
  const floor = realm.flipped ? TILE * 2 : GROUND_Y;
  return realm.flipped ? state.y - floor : floor - state.y;
}

/** The runner's height right now. Sliding halves it. */
export const bodyHeight = (state, tuning = TUNING) =>
  (state.sliding ? tuning.slideHeight : tuning.bodyH);

/**
 * The runner's box in SCREEN space, for drawing and for the horizontal test.
 * y is the top edge in both realms.
 */
export function bodyOf(state, realm = REALMS[0], tuning = TUNING) {
  const h = bodyHeight(state, tuning);
  return {
    x: state.x - tuning.bodyW / 2,
    y: realm.flipped ? state.y : state.y - h,
    w: tuning.bodyW,
    h,
  };
}

/**
 * Does this obstacle stop the runner, given where they are and what they are
 * doing?
 *
 * One function, used by the game AND by the solver, so what kills a player is
 * exactly what the solver had to get past. Vertical tests are all in
 * height-above-floor, so they read the same way in both realms.
 */
export function blocks(obstacle, state, realm = REALMS[0], tuning = TUNING) {
  const halfW = tuning.bodyW / 2;
  const left = obstacle.tile * TILE;
  const right = left + obstacle.tiles * TILE;
  if (state.x + halfW <= left || state.x - halfW >= right) return false;

  const feet = heightAbove(state, realm);
  const head = feet + bodyHeight(state, tuning);

  switch (obstacle.kind) {
    case KIND.SPIKE:
      // Fills the first tile off the floor. Get your feet above it.
      return feet < TILE;
    case KIND.BAR:
      // Hangs from the roof down to `clear` tiles off the floor. Anything
      // taller than that gap is stopped, which is what the slide is for.
      return head > obstacle.clear * TILE;
    case KIND.GAP:
      // Only a problem at floor level, and phasing carries you over.
      return feet <= 0.5 && !state.phasing;
    case KIND.RIFT:
      return !state.phasing;
    default:
      return false;
  }
}

/** Is there floor under this x? */
export function hasFloor(x, obstacles) {
  for (const o of obstacles) {
    if (o.kind !== KIND.GAP) continue;
    const left = o.tile * TILE;
    const right = left + o.tiles * TILE;
    if (x >= left && x < right) return false;
  }
  return true;
}

// --- The runner -----------------------------------------------------------

export const END = {
  HIT: 'Hit an obstacle',
  FELL: 'Fell through a rift',
};

/**
 * One run. `step` is the whole game; games/rift-runner/game.js only draws what
 * this produced.
 *
 * `input` is the three verbs the player has: { jump, jumpHeld, slide, dash }.
 */
export class Run {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = GROUND_Y;
    this.vy = 0;
    this.grounded = true;
    this.sliding = false;
    this.slideLeft = 0;
    this.phasing = false;
    this.dashLeft = 0;
    this.dashCool = 0;
    this.coyote = 0;
    this.buffer = 0;
    this.running = true;
    this.reason = null;
    this.realm = REALMS[0];
    this.realmIndex = 0;
    this.obstacles = [];
    this.patternsCleared = 0;
  }

  get metres() { return Math.floor(this.x / PIXELS_PER_METRE); }

  get speed() { return speedAt(this.x, this.t) * this.realm.speedScale; }

  get physics() { return physicsAt(this.speed, this.realm, this.t); }

  /** Ground level for the runner, which flips with the realm. */
  get floorY() { return this.realm.flipped ? TILE * 2 : GROUND_Y; }

  step(dt, input = {}) {
    if (!this.running) return;
    const T = this.t;
    const p = this.physics;
    const dir = this.realm.flipped ? -1 : 1;

    // --- Timers ---------------------------------------------------------
    if (this.dashCool > 0) this.dashCool = Math.max(0, this.dashCool - dt);
    if (this.buffer > 0) this.buffer = Math.max(0, this.buffer - dt);
    if (this.coyote > 0) this.coyote = Math.max(0, this.coyote - dt);

    if (this.phasing) {
      this.dashLeft -= dt;
      if (this.dashLeft <= 0) { this.phasing = false; this.dashLeft = 0; }
    }
    if (this.sliding) {
      this.slideLeft = Math.max(0, this.slideLeft - dt);
      // Held keeps it going; released ends it once the minimum has run, so a
      // tap still ducks under something.
      if (!input.slide && this.slideLeft <= 0) this.sliding = false;
      if (!this.grounded) this.sliding = false;
    }

    // --- Verbs ----------------------------------------------------------
    if (input.jump) this.buffer = p.bufferTime;

    const canJump = this.grounded || this.coyote > 0;
    if (this.buffer > 0 && canJump) {
      this.vy = -p.jumpImpulse * dir;
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.sliding = false;
      this.slideLeft = 0;
    }

    // Releasing early cuts the rise, which is most of the player's control.
    if (!input.jumpHeld && this.vy * dir < 0) {
      this.vy *= T.jumpCutMultiplier;
    }

    if (input.slide && this.grounded && !this.sliding) {
      this.sliding = true;
      this.slideLeft = p.slideMinTime;
    }

    if (input.dash && this.dashCool <= 0 && !this.phasing) {
      this.phasing = true;
      this.dashLeft = p.dashTime;
      this.dashCool = p.dashCooldown + p.dashTime;
    }

    // --- Motion ---------------------------------------------------------
    const forward = this.speed * (this.phasing ? T.dashSpeedBonus : 1);
    this.x += forward * dt;

    this.vy += p.gravity * dt * dir;
    this.y += this.vy * dt;

    // Land, unless there is a rift in the floor here.
    const floor = this.floorY;
    const onFloor = this.realm.flipped ? this.y <= floor : this.y >= floor;
    const solid = hasFloor(this.x, this.obstacles) || this.phasing;

    if (onFloor && solid) {
      this.y = floor;
      this.vy = 0;
      if (!this.grounded) this.grounded = true;
      this.coyote = p.coyoteTime;
    } else {
      if (this.grounded) this.coyote = p.coyoteTime;
      this.grounded = false;
    }

    // Fell into a rift.
    const past = this.realm.flipped ? this.y < -TILE * 2 : this.y > WORLD_H + TILE * 2;
    if (past) {
      this.running = false;
      this.reason = END.FELL;
      return;
    }

    // Ceiling, so a jump cannot leave the world.
    const ceiling = this.realm.flipped ? WORLD_H - TILE * 2 : TILE;
    const hitCeiling = this.realm.flipped ? this.y > ceiling : this.y - T.bodyH < ceiling;
    if (hitCeiling && this.vy * dir < 0) {
      this.y = this.realm.flipped ? ceiling : ceiling + T.bodyH;
      this.vy = 0;
    }

    // --- Collision -------------------------------------------------------
    for (const o of this.obstacles) {
      if (blocks(o, this, this.realm, T)) {
        this.running = false;
        this.reason = END.HIT;
        return;
      }
    }
  }
}

// --- The solver -----------------------------------------------------------
//
// Does an input sequence exist that clears this pattern?
//
// This is the function the whole fairness claim rests on, and it is a real
// search rather than a heuristic: a breadth-first walk over the same physics
// step the game runs, with states deduplicated on a quantised key. If it
// returns false, no player could have cleared that pattern — not a good one,
// not a lucky one.
//
// It is deliberately NOT a bot. A bot tells you how far a particular skill
// level gets; this tells you whether the geometry is possible at all. Ember
// needed both and so does this: the solver rules out the impossible, and the
// two-skill harness in tests/ measures what is merely hard.
//
// Cost: patterns are short, and the quantisation collapses the enormous
// nominal branching into a few thousand distinct states. A whole library
// checks in well under a second.

/**
 * Thrown when the search exhausts its state budget.
 *
 * A separate type on purpose: the one thing this solver must never do is let
 * "I could not finish" be read as "there is no route". Callers can catch it
 * and widen the budget, or let it fail the test, but they cannot mistake it
 * for a verdict.
 */
export class SolverBudget extends Error {
  constructor(message) { super(message); this.name = 'SolverBudget'; }
}

/** The five things a player can do on any given frame. */
// Five, not six. 'release' was in here as well and is the same action as
// 'run' — both leave jumpHeld falsy, which is what cuts a jump short. A
// duplicate action multiplies the search by 6/5 for nothing.
const SOLVER_ACTIONS = [
  { name: 'run' },                                  // nothing new; cuts a jump
  { name: 'jump', jump: true, jumpHeld: true },
  { name: 'hold', jumpHeld: true },                 // keep rising
  { name: 'slide', slide: true },
  { name: 'dash', dash: true },
];

// How coarsely two states in the same layer are treated as the same state.
//
// THE PROPERTY THAT MAKES THIS SAFE: coarsening can only ever LOSE routes,
// never invent one. The simulation itself is exact — every state is reached
// by really stepping the real physics — and quantisation only decides which
// states are worth expanding. So:
//
//   a 'clearable' answer is PROOF. A route was walked, step by step.
//   an 'unclearable' answer is a MAYBE. The route may have been merged away.
//
// verifyLibrary() leans on exactly that: it runs the cheap settings first and
// re-checks anything they reject at SOLVER_FINE before believing it. Which
// matters, because the cheap pass does produce false negatives — at 8px it
// rejected `spike-stutter`, a pattern the fine pass walks a route through.
//
// dt is 1/60 deliberately: that is the rate the game itself steps at, so the
// search is looking at the same frames a player gets. The fastest the runner
// ever moves is a dash in Surge at 597px/s, which is 10px a step against a
// 40px tile, so nothing is stepped over.
export const SOLVER_DEFAULTS = { qPos: 12, qVy: 120, qCool: 0.25, dt: 1 / 60 };

// Slow, and the closest thing to truth available. Used only to double-check a
// rejection, which should be rare.
export const SOLVER_FINE = {
  qPos: 5, qVy: 50, qCool: 0.08, dt: 1 / 120, maxStates: 6_000_000,
};

function solverKey(r, q) {
  return (
    `${Math.round(r.x / q.qPos)},${Math.round(r.y / q.qPos)},${Math.round(r.vy / q.qVy)},`
    + `${r.grounded ? 1 : 0}${r.sliding ? 1 : 0}${r.phasing ? 1 : 0}`
    + `,${Math.round(r.dashCool / q.qCool)}`
  );
}

function snapshot(run) {
  return {
    x: run.x, y: run.y, vy: run.vy, grounded: run.grounded,
    sliding: run.sliding, slideLeft: run.slideLeft, phasing: run.phasing,
    dashLeft: run.dashLeft, dashCool: run.dashCool, coyote: run.coyote,
    buffer: run.buffer,
  };
}

function restore(run, s) {
  Object.assign(run, s);
  run.running = true;
  run.reason = null;
}

/**
 * True if `pattern` can be cleared in `realm`, starting at `startSpeed`.
 *
 * @param {object} pattern   from patterns.js — { tiles, obstacles }
 * @param {object} realm     from REALMS
 * @param {object} [options] { speed, dt, maxStates }
 */
export function isClearable(pattern, realm, options = {}) {
  const tuning = options.tuning ?? TUNING;
  const {
    // Checked at the speed the realm actually runs at. Because of the
    // invariance the answer should not depend on this, and the test asserts
    // that separately by trying several.
    speed = tuning.baseSpeed * realm.speedScale,
    dt = SOLVER_DEFAULTS.dt,
    qPos = SOLVER_DEFAULTS.qPos,
    qVy = SOLVER_DEFAULTS.qVy,
    qCool = SOLVER_DEFAULTS.qCool,
    maxStates = 1_500_000,
  } = options;

  // A run positioned at the start of the pattern, with the obstacles loaded.
  const run = new Run(tuning);
  run.realm = realm;
  run.obstacles = pattern.obstacles;
  run.y = realm.flipped ? TILE * 2 : GROUND_Y;
  run.x = -tuning.restTiles * TILE;
  run.grounded = true;

  // Pin the speed: speedAt() reads x, and x moves during the search.
  Object.defineProperty(run, 'speed', { get: () => speed, configurable: true });

  const goal = (pattern.tiles + tuning.restTiles) * TILE;

  // Dedup is PER LAYER, not global, and that distinction is the whole
  // correctness of this search.
  //
  // A global set looks obviously right and is not. x advances about 2.8px per
  // step while the key quantises it to 6px, so two CONSECUTIVE steps often
  // land in the same bucket — and the later one is then pruned as "already
  // seen". Pruning it drops the branch, because the earlier state's
  // successors were computed from a slightly different x. The effect is that
  // simply CONTINUING TO RUN gets pruned, the frontier bleeds out over a few
  // dozen steps, and the solver reports a single jumpable spike as
  // unclearable. It did exactly that: 76 of 90 pairs failed, including
  // `first-spike`, which is one spike on flat ground.
  //
  // Each layer is one time step, so states within a layer are genuinely
  // simultaneous and comparing them is meaningful. Across layers it is not.
  const q = { qPos, qVy, qCool };
  let frontier = [snapshot(run)];
  let states = 1;
  let layers = 0;

  // Enough layers to cross the pattern with room for hesitation.
  const maxLayers = Math.ceil(((goal - run.x) / (speed * dt)) * 1.6) + 60;

  while (frontier.length && layers++ < maxLayers) {
    const seen = new Set();
    const next = [];
    for (const state of frontier) {
      for (const action of SOLVER_ACTIONS) {
        restore(run, state);
        run.step(dt, action);

        if (!run.running) continue;             // died on this branch
        if (run.x >= goal) return true;         // through the far side

        const key = solverKey(run, q);
        if (seen.has(key)) continue;
        seen.add(key);
        if (++states > maxStates) {
          // NOT `return false`. That is the version this had first, and it is
          // the worst possible bug in a fairness checker: it reports
          // "impossible" when it means "I gave up", and the two are
          // indistinguishable to the caller. Running the solver at a finer
          // quantisation to double-check a result made the state count
          // explode, so it hit the cap on 54 of 87 pairs and cheerfully
          // announced that a single spike could not be jumped.
          throw new SolverBudget(
            `solver ran out of budget after ${states} states — the answer is unknown, not no`,
          );
        }
        next.push(snapshot(run));
      }
    }
    frontier = next;
  }

  return false;
}
