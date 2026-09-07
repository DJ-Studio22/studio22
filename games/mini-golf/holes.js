// games/mini-golf/holes.js
//
// Hole generation, the stroke economy, and the endless course. No canvas, no
// input device, no clock.
//
// GENERATE, THEN PROVE, THEN DEAL
// -------------------------------
// Every hole is carved, then handed to the search in green.js, and only dealt
// if the search actually sinks it within par. A hole that cannot be solved is
// discarded and another is generated — costing a few milliseconds and nothing
// else.
//
// That is the whole reason the generator is allowed to be adventurous. It can
// put water across the direct line and a wall behind the cup, because it does
// not have to be careful: the search is what decides whether the result is a
// hole or a joke.
//
// HOW A HOLE IS CARVED
// --------------------
// A random walk from tee to cup, widened into a fairway, with everything else
// left as rough. Hazards are then dropped ON the fairway rather than around
// it — water in the middle of the route is a decision; water somewhere you
// were never going to putt is scenery.
//
// The walk is what makes the holes read as designed rather than as noise: it
// turns corners, so there is a line to find, and the corners are where the
// interest is.
//
// THE STROKE ECONOMY
// ------------------
// You do not get a fixed number of shots. You get a BANK. Sink under par and
// the difference is added to it; go over and it is spent. Run the bank to zero
// and the round ends, mid-hole if that is where it happens.
//
// Which means a bad hole is survivable and a run of them is not, and a good
// hole buys you room for a bad one later. That is the tension the whole game
// is built on, and it is why the score is HOLES COMPLETED rather than strokes:
// strokes are the resource, not the result.

import {
  Hole, T, TILE, TUNING, putt, reachAt, solveHole,
} from './green.js';

// --- Difficulty -----------------------------------------------------------

/**
 * What a hole looks like at this depth into a round. Everything escalates and
 * nothing has a ceiling except the board itself, which cannot grow for ever
 * because it has to fit on a screen.
 */
export function shapeAt(holeNumber) {
  const n = holeNumber;
  return {
    cols: Math.min(22, 12 + Math.floor(n / 4)),
    rows: Math.min(15, 9 + Math.floor(n / 6)),
    // Longer routes: more corners to turn.
    corners: Math.min(6, 1 + Math.floor(n / 3)),
    // Tighter greens: the fairway narrows from three tiles to one.
    width: Math.max(1, 3 - Math.floor(n / 7)),
    water: Math.min(7, Math.floor(n / 2)),
    sand: Math.min(8, Math.floor(n / 3)),
    ramps: Math.min(4, Math.floor(n / 5)),
    movers: Math.min(3, Math.floor(n / 6)),
  };
}

// --- Carving --------------------------------------------------------------

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** A right-angled walk from a tee to a cup, as a list of tiles. */
function carvePath(cols, rows, corners) {
  const path = [];
  let x = randInt(1, 2);
  let y = randInt(1, rows - 2);
  path.push({ x, y });

  // Alternate horizontal and vertical legs, always making net progress right,
  // so the hole always has somewhere to go and never doubles back on itself.
  let horizontal = true;
  const legs = corners + 1;
  for (let i = 0; i < legs; i++) {
    const last = i === legs - 1;
    if (horizontal) {
      const remaining = cols - 2 - x;
      const step = last ? remaining : randInt(2, Math.max(2, Math.floor(remaining / (legs - i))));
      for (let k = 0; k < step && x < cols - 2; k++) { x++; path.push({ x, y }); }
    } else {
      const dir = pick([-1, 1]);
      const room = dir < 0 ? y - 1 : rows - 2 - y;
      const step = Math.min(room, randInt(1, 4));
      for (let k = 0; k < step; k++) { y += dir; path.push({ x, y }); }
    }
    horizontal = !horizontal;
  }
  return path;
}

/** Everything within `width` of the path becomes green. */
function widen(tiles, path, width, cols, rows) {
  for (const p of path) {
    for (let dy = -width; dy <= width; dy++) {
      for (let dx = -width; dx <= width; dx++) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1) continue;
        if (Math.abs(dx) + Math.abs(dy) > width) continue;
        tiles[y][x] = T.GREEN;
      }
    }
  }
}

const centreOf = (tile) => ({ x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2 });

/**
 * One candidate hole. Not necessarily a good one — buildHole() is what decides
 * whether it survives.
 */
function carve(holeNumber) {
  const shape = shapeAt(holeNumber);
  const { cols, rows } = shape;

  const tiles = Array.from({ length: rows }, () => new Array(cols).fill(T.ROUGH));
  const path = carvePath(cols, rows, shape.corners);
  widen(tiles, path, shape.width, cols, rows);

  // A wall ring, so a ball can rebound rather than simply stopping dead on the
  // rough. Bouncing off the boards is most of what mini golf IS.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (tiles[y][x] !== T.ROUGH) continue;
      const touchesGreen = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < cols && ny < rows && tiles[ny][nx] === T.GREEN;
      });
      if (touchesGreen) tiles[y][x] = T.WALL;
    }
  }

  const tee = path[0];
  const cupTile = path[path.length - 1];

  // Hazards go ON the route, between the tee and the cup, never on either.
  const body = path.slice(3, -3);
  const place = (count, kind) => {
    for (let i = 0; i < count && body.length; i++) {
      const p = pick(body);
      if (tiles[p.y][p.x] === T.GREEN) tiles[p.y][p.x] = kind;
    }
  };
  place(shape.water, T.WATER);
  place(shape.sand, T.SAND);
  place(shape.ramps, pick([T.RAMP_N, T.RAMP_E, T.RAMP_S, T.RAMP_W]));

  tiles[tee.y][tee.x] = T.GREEN;
  tiles[cupTile.y][cupTile.x] = T.GREEN;

  // Moving blockers, sliding across the fairway.
  const movers = [];
  for (let i = 0; i < shape.movers && body.length; i++) {
    const p = pick(body);
    const vertical = Math.random() < 0.5;
    movers.push({
      x0: p.x * TILE + 4, y0: p.y * TILE + 4,
      x1: (p.x + (vertical ? 0 : 1)) * TILE + 4,
      y1: (p.y + (vertical ? 1 : 0)) * TILE + 4,
      w: vertical ? TILE - 8 : 8, h: vertical ? 8 : TILE - 8,
      speed: 1.2 + Math.random() * 1.4, phase: Math.random() * 6,
    });
  }

  // Par from the route's length against how far a putt actually runs.
  //
  // Note the 0.75: a full-power putt covers ten tiles in a straight line and
  // almost nobody putts in a straight line. Holes turn corners, so a stroke
  // buys about three-quarters of its nominal reach in practice. Pricing par
  // at the straight-line figure gave hole 1 a par of 2 on a route with a
  // corner in it — an ace or nothing — and a competent round lasted four
  // holes.
  // The floor is THREE, not two, and hand-play is what settled it.
  //
  // A par-2 hole is an ace or a loss: sink it in two and you break even, take
  // three and the bank pays. Played cold, the very first hole came in at seven
  // strokes against a par of two and ended the round before the player had
  // learned which button charges. With a floor of three there is room to be
  // bad at a hole without the round ending on it.
  const legLength = path.length * TILE;
  const effectiveReach = reachAt(1) * 0.75;
  const par = Math.max(3, Math.min(7, Math.ceil(legLength / effectiveReach) + 1));

  return new Hole({ tiles, tee: centreOf(tee), cup: centreOf(cupTile), par, movers });
}

/**
 * A hole that has been PROVED sinkable within par.
 *
 * Tries up to `attempts` carvings and returns the first the search can solve.
 * If none survive — which should be rare and is not fatal — the last is
 * returned with a par raised to whatever the search could manage, so the game
 * never stalls waiting for a perfect hole.
 */
export function buildHole(holeNumber, options = {}) {
  const { attempts = 14, solver = {} } = options;
  let last = null;

  for (let i = 0; i < attempts; i++) {
    const hole = carve(holeNumber);
    last = hole;
    const strokes = solveHole(hole, { ...solver, par: hole.par });
    if (strokes !== null) {
      hole.provedIn = strokes;
      return hole;
    }
  }

  // Nothing solved at its own par. Rather than deal an unsinkable hole, find
  // what par it IS sinkable at and use that.
  for (const par of [last.par + 1, last.par + 2, last.par + 3]) {
    const strokes = solveHole(last, { ...solver, par });
    if (strokes !== null) {
      last.par = par;
      last.provedIn = strokes;
      return last;
    }
  }

  // Still nothing. Hand back a hole with a par nobody will hit rather than one
  // nobody can finish; the test asserts this branch is essentially never taken.
  last.par = last.par + 4;
  last.provedIn = null;
  last.unproved = true;
  return last;
}

// --- The round ------------------------------------------------------------

export const END = {
  BANKRUPT: 'Ran out of strokes',
};

/**
 * A whole round: hole after hole, forever, against a bank of strokes.
 */
export class Course {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    this.holeNumber = 1;
    this.completed = 0;
    this.bank = this.t.startingBank;
    this.strokes = 0;
    this.running = true;
    this.reason = null;
    this.lastResult = null;
    this.hole = buildHole(this.holeNumber);
    this.ball = { ...this.hole.tee };
    this.time = 0;
  }

  /** Strokes over par on the hole being played right now. */
  get over() { return Math.max(0, this.strokes - this.hole.par); }

  /** What the bank would be if the round ended this instant. */
  get effectiveBank() { return this.bank - this.over; }

  /**
   * Plays one stroke. `power` is 0..1, `angle` in radians.
   * Returns the putt result so the game can animate it.
   */
  play(angle, power) {
    if (!this.running) return null;

    const result = putt(this.hole, this.ball, angle, power, { startTime: this.time });
    this.strokes += result.strokes;
    this.ball = { x: result.x, y: result.y };
    this.time = result.time;
    this.lastResult = result;

    if (result.sunk) {
      this.bank += this.hole.par - this.strokes;
      this.completed++;
      if (this.bank <= 0) {
        this.running = false;
        this.reason = END.BANKRUPT;
        return result;
      }
      this.holeNumber++;
      this.hole = buildHole(this.holeNumber);
      this.ball = { ...this.hole.tee };
      this.strokes = 0;
      this.time = 0;
      return result;
    }

    // Running the bank dry mid-hole ends it there. Waiting until the hole is
    // finished would let a player keep putting on a hole they have already
    // lost, which is a worse ending than a clean one.
    if (this.effectiveBank <= 0) {
      this.running = false;
      this.reason = END.BANKRUPT;
    }
    return result;
  }
}
