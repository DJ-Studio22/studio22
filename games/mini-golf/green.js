// games/mini-golf/green.js
//
// Endless Mini Golf's simulation: one hole, the ball on it, and the search
// that proves the hole can be sunk. No canvas, no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// The game generates its holes, forever, and gets harder as it goes. That
// makes one claim load-bearing above all others: EVERY HOLE IT DEALS CAN BE
// SUNK WITHIN ITS PAR. A generator that occasionally produces a cup behind a
// wall with no angle into it does not feel unlucky, it feels broken — and the
// player has no way to tell the difference between "I cannot see the shot" and
// "there is no shot".
//
// So holes are generated and then PROVED, by a search over the real putt
// physics, before they are ever dealt. holes.js does the generating; the
// search lives here, next to the physics it depends on.
//
// THE SEARCH IS SOUND, NOT COMPLETE
// ---------------------------------
// Aim and power are continuous, so an exhaustive search is not available. This
// is a beam search over a sampled fan of shots: it either SINKS THE BALL, by
// really simulating every stroke, or it fails to find a way in the beam it
// looked at.
//
//   sunk      -> proof. Those exact strokes work.
//   not sunk  -> unknown. The hole may still be sinkable.
//
// That asymmetry is fine here and it is why the design works: a hole the
// search cannot solve is simply DISCARDED and another generated. Being
// incomplete costs a few wasted holes at generation time. Being unsound would
// cost the player a hole they cannot finish, which is the thing that must
// never happen.
//
// THE GRID
// --------
// A hole is a grid of tiles, and the ball moves continuously over it. Tiles
// rather than free polygons because every rule here — what blocks, what
// drowns, what accelerates — has to be checkable by a test, and a grid is
// something a test can state a fact about.

// --- Geometry -------------------------------------------------------------

export const TILE = 32;

/** What a tile is. */
export const T = {
  ROUGH: 0,    // off the green: not playable, blocks like a wall
  GREEN: 1,    // fairway
  WALL: 2,     // bounces
  WATER: 3,    // costs a stroke and returns the ball
  SAND: 4,     // heavy friction
  RAMP_N: 5,   // pushes the ball along
  RAMP_E: 6,
  RAMP_S: 7,
  RAMP_W: 8,
};

export const RAMP_PUSH = {
  [T.RAMP_N]: { x: 0, y: -1 },
  [T.RAMP_E]: { x: 1, y: 0 },
  [T.RAMP_S]: { x: 0, y: 1 },
  [T.RAMP_W]: { x: -1, y: 0 },
};

export const isSolid = (tile) => tile === T.WALL || tile === T.ROUGH;
export const isRamp = (tile) => tile >= T.RAMP_N && tile <= T.RAMP_W;

// --- Tuning ---------------------------------------------------------------
//
// A plain object, so a test can clone it, change one figure and run both
// versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  ballRadius: 5,

  // A full-power putt, in px/s, and how quickly the green takes it back.
  // maxPower against greenFriction is what sets how far a shot travels, which
  // is what every hole is generated against.
  maxPower: 620,
  minPower: 90,
  greenFriction: 1.9,     // per second, proportional
  sandFriction: 6.2,
  rampAccel: 700,

  // Below this the ball is treated as stopped, so a hole ends rather than
  // creeping for ever.
  restSpeed: 12,

  // Walls give a little back rather than none — a dead bounce reads as a bug.
  bounce: 0.72,

  // The cup. A ball arriving faster than dropSpeed rims out, which is what
  // makes power a decision near the hole rather than only far from it.
  cupRadius: 9,
  dropSpeed: 260,

  // Water returns the ball to where it was played from, plus a stroke.
  waterPenalty: 1,

  // The stroke economy. See Course in holes.js. Five rather than four: the
  // bank is the only thing standing between a bad hole and the end of the
  // round, and four left no room to learn a hole at all.
  startingBank: 5,
};

// --- The ball -------------------------------------------------------------

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

export const END = {
  SUNK: 'sunk',
  RESTED: 'rested',
  STILL_MOVING: 'moving',
};

/**
 * A hole: the grid, the tee, the cup, and its par.
 *
 * `tiles` is row-major, `tiles[y][x]`.
 */
export class Hole {
  constructor({ tiles, tee, cup, par, movers = [] }, tuning = TUNING) {
    this.t = tuning;
    this.tiles = tiles;
    this.rows = tiles.length;
    this.cols = tiles[0].length;
    this.tee = { ...tee };
    this.cup = { ...cup };
    this.par = par;
    // Moving blockers, each a rectangle sliding between two points.
    this.movers = movers.map((m) => ({ ...m }));
  }

  get width() { return this.cols * TILE; }
  get height() { return this.rows * TILE; }

  tileAt(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return T.ROUGH;
    return this.tiles[ty][tx];
  }

  /** Where a mover sits at time `t`, as a rectangle. */
  moverRect(m, time) {
    const phase = (Math.sin((time + m.phase) * m.speed) + 1) / 2;
    return {
      x: m.x0 + (m.x1 - m.x0) * phase,
      y: m.y0 + (m.y1 - m.y0) * phase,
      w: m.w,
      h: m.h,
    };
  }
}

/**
 * One putt, simulated to rest.
 *
 * Returns where the ball stopped, whether it went in, and how many strokes it
 * cost (one, plus a water penalty if it found the pond). The game and the
 * search both call this, so what the search proved is exactly what the player
 * gets.
 */
export function putt(hole, from, angle, power, options = {}) {
  const t = hole.t;
  const { maxSeconds = 12, dt = 1 / 120, startTime = 0 } = options;

  const speed = clamp(power, 0, 1) * (t.maxPower - t.minPower) + t.minPower;
  let x = from.x;
  let y = from.y;
  let vx = Math.cos(angle) * speed;
  let vy = Math.sin(angle) * speed;
  let strokes = 1;
  let time = startTime;

  const steps = Math.ceil(maxSeconds / dt);
  for (let i = 0; i < steps; i++) {
    time += dt;
    const tile = hole.tileAt(x, y);

    // Water: back to where it was played from, and it costs.
    if (tile === T.WATER) {
      return { x: from.x, y: from.y, strokes: strokes + t.waterPenalty, sunk: false, reason: 'water', time };
    }

    // Ramps push, sand drags.
    if (isRamp(tile)) {
      const push = RAMP_PUSH[tile];
      vx += push.x * t.rampAccel * dt;
      vy += push.y * t.rampAccel * dt;
    }
    const friction = tile === T.SAND ? t.sandFriction : t.greenFriction;
    const decay = Math.max(0, 1 - friction * dt);
    vx *= decay;
    vy *= decay;

    let nx = x + vx * dt;
    let ny = y + vy * dt;

    // Walls, one axis at a time so a corner does not eat the ball.
    if (isSolid(hole.tileAt(nx, y))) { vx = -vx * t.bounce; nx = x; }
    if (isSolid(hole.tileAt(x, ny))) { vy = -vy * t.bounce; ny = y; }

    // Moving blockers bounce like walls, off whichever face was hit.
    for (const m of hole.movers) {
      const r = hole.moverRect(m, time);
      if (nx + t.ballRadius > r.x && nx - t.ballRadius < r.x + r.w
        && ny + t.ballRadius > r.y && ny - t.ballRadius < r.y + r.h) {
        const fromLeft = Math.abs((nx) - r.x);
        const fromRight = Math.abs((r.x + r.w) - nx);
        const fromTop = Math.abs((ny) - r.y);
        const fromBottom = Math.abs((r.y + r.h) - ny);
        const least = Math.min(fromLeft, fromRight, fromTop, fromBottom);
        if (least === fromLeft || least === fromRight) { vx = -vx * t.bounce; nx = x; }
        else { vy = -vy * t.bounce; ny = y; }
      }
    }

    x = nx;
    y = ny;

    // The cup. Too fast and it rims out, which is what makes a long putt a
    // decision about power rather than only about line.
    const dx = x - hole.cup.x;
    const dy = y - hole.cup.y;
    if (Math.hypot(dx, dy) <= t.cupRadius) {
      if (Math.hypot(vx, vy) <= t.dropSpeed) {
        return { x: hole.cup.x, y: hole.cup.y, strokes, sunk: true, reason: 'sunk', time };
      }
    }

    if (Math.hypot(vx, vy) < t.restSpeed) {
      return { x, y, strokes, sunk: false, reason: 'rested', time };
    }
  }

  return { x, y, strokes, sunk: false, reason: 'timeout', time };
}

// --- The search -----------------------------------------------------------

/**
 * Can this hole be sunk in `par` strokes or fewer?
 *
 * A beam search over a fan of sampled shots. Sound, not complete — see the
 * header. Returns the strokes it took, or null if it could not find a way.
 *
 * The shot fan is the same resolution a player has any hope of aiming at.
 * Sampling it finer would find more routes and take longer; the point is not
 * to find every route, it is to be sure at least one exists.
 */
export function solveHole(hole, options = {}) {
  const {
    par = hole.par,
    angles = 48,
    powers = [0.25, 0.4, 0.55, 0.7, 0.85, 1],
    beam = 26,
  } = options;

  let frontier = [{ x: hole.tee.x, y: hole.tee.y, strokes: 0 }];

  for (let stroke = 1; stroke <= par; stroke++) {
    const next = [];
    for (const state of frontier) {
      for (let a = 0; a < angles; a++) {
        const angle = (a / angles) * Math.PI * 2;
        for (const power of powers) {
          const result = putt(hole, state, angle, power);
          const strokes = state.strokes + result.strokes;
          if (strokes > par) continue;
          if (result.sunk) return strokes;
          next.push({ x: result.x, y: result.y, strokes });
        }
      }
    }
    if (next.length === 0) return null;

    // Keep the most promising distinct positions. Distinct matters: without
    // it the beam fills with a dozen versions of the same spot and the search
    // explores one line of play very thoroughly and nothing else.
    next.sort((p, q) => {
      const dp = Math.hypot(p.x - hole.cup.x, p.y - hole.cup.y) + p.strokes * 40;
      const dq = Math.hypot(q.x - hole.cup.x, q.y - hole.cup.y) + q.strokes * 40;
      return dp - dq;
    });
    const kept = [];
    for (const candidate of next) {
      if (kept.length >= beam) break;
      const near = kept.some((k) => Math.hypot(k.x - candidate.x, k.y - candidate.y) < TILE * 0.75);
      if (!near) kept.push(candidate);
    }
    frontier = kept;
  }

  return null;
}

/** How far a putt at this power runs on open green, for the generator. */
export function reachAt(power, tuning = TUNING) {
  const speed = clamp(power, 0, 1) * (tuning.maxPower - tuning.minPower) + tuning.minPower;
  // Exponential decay to rest speed: v(t) = v0 * e^(-k t), integrated.
  const k = tuning.greenFriction;
  return (speed - tuning.restSpeed) / k;
}
