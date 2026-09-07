// games/color-heist/maze.js
//
// Colour Heist's simulation: the vault, the coloured doors, the clock, and the
// search that proves a floor is possible before anybody is asked to run it. No
// canvas, no input device, no clock of its own.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// The game is a routing problem wearing a maze, and routing problems are the
// kind of thing that is either honest in the numbers or a lie:
//
//   THE CONSTRAINT HAS TO COST SOMETHING. You pass a door only while wearing
//   its colour, and changing colour takes TIME you do not have. If switching
//   were free the doors would be scenery and the maze would be a corridor.
//
//   AND EVERY FLOOR HAS TO BE POSSIBLE. A generated vault that cannot be
//   crossed in the time given does not read as hard, it reads as broken — and
//   the player cannot tell "I took the wrong route" from "there was no route".
//
// So a floor is generated, then PROVED by a search over the real cost model —
// steps and switches, in seconds — and thrown away if it cannot be done with
// room to spare. Same discipline as the mini golf generator and the Rift
// Runner library, for the same reason.
//
// WHY THE SEARCH IS EXACT HERE
// ----------------------------
// Unlike those two, this one is not a heuristic: the state space is (cell,
// colour), which is small, and Dijkstra over it is complete. So "impossible"
// really does mean impossible rather than "not found", and the generator can
// be trusted to reject rather than merely to doubt.

// --- Colours --------------------------------------------------------------

export const COLOUR = { AMBER: 0, CYAN: 1, MAGENTA: 2 };
export const COLOURS = [COLOUR.AMBER, COLOUR.CYAN, COLOUR.MAGENTA];
export const COLOUR_COUNT = COLOURS.length;

// A door with no colour is just a doorway; anyone walks through.
export const OPEN = -1;

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The vault grows with the floor, and never stops.
  colsBase: 7,
  rowsBase: 5,
  growEvery: 2,          // one more cell each way, this often
  maxCols: 21,
  maxRows: 15,

  // How much of the maze is doors rather than plain doorways. Too few and the
  // colour is irrelevant; too many and every step is a switch.
  doorShare: 0.55,
  // Extra connections beyond a spanning tree. THIS IS THE LINE THAT MAKES IT A
  // ROUTING GAME: a tree has exactly one path between any two cells, so there
  // is nothing to choose and the "best route" is the only route.
  loopShare: 0.22,

  // The cost model, in seconds. Everything the search prices is here.
  stepSeconds: 0.16,
  switchSeconds: 0.55,

  // THE CLOCK IS SET FROM THE PROVEN PAR, NOT FROM A TABLE.
  //
  // A fixed time per floor with a minimum is not endless: past the floor where
  // the maze stops growing and the clock stops falling, nothing changes and a
  // good player runs forever. It showed up immediately — the planning bot
  // cleared a hundred and two floors and was still going when the harness
  // stopped it.
  //
  // So the search that proves the floor also sets its clock: you get par plus
  // a MARGIN, and the margin shrinks without ever reaching zero. Early floors
  // are generous, late ones ask you to be close to optimal, and there is no
  // point at which the game stops asking for more. It is also fair by
  // construction — the time given is derived from a route that provably
  // exists.
  // THE ALARM DOES NOT START UNTIL YOU MOVE.
  //
  // Playing it cold found this in one attempt and no bot ever could. Floor one
  // has a par of about three and a half seconds, so the clock is under eight —
  // and four seconds spent working out what the colours mean, where the exit
  // is and which button switches had already spent more than half of it. The
  // run was over in eight seconds with four steps taken.
  //
  // Arming on the first input costs nothing to a player who knows the game and
  // gives a new one the whole opening to read. Every floor, not just the
  // first, because every floor is a fresh map.
  armOnFirstMove: true,

  // The shape of the squeeze, and it has been widened once already.
  //
  // At 1.4 / 0.955 / 0.16 the game was unforgiving from the first floor: par
  // plus 140% sounds generous until you notice par is three and a half
  // seconds, and the margin was under double par by floor ten. There was never
  // a stretch where a player had room to look at the map and think.
  //
  //   floor    1     5    10    15    20    30    45    60
  //   was   1.40  1.16  0.93  0.73  0.58  0.37  0.18  0.16
  //   now   2.60  2.25  1.89  1.58  1.32  0.93  0.54  0.32
  //
  // Triple par for the first stretch, still comfortably over double at floor
  // fifteen, and the real pressure arrives in the thirties rather than the
  // tens. It never stops tightening, which is what keeps it endless.
  marginBase: 2.6,       // floor 1: par plus 260%
  marginDecay: 0.965,    // multiplied per floor
  marginFloor: 0.25,     // and never tighter than par plus 25%

  gemsBase: 3,
  gemsPerFloor: 0.35,
  maxGems: 8,
};

export const END = { CAUGHT: 'The alarm caught you' };

// --- The vault ------------------------------------------------------------

const idx = (x, y, cols) => y * cols + x;

/**
 * A maze of cells joined by passages, each passage either open or coloured.
 *
 * Passages are stored once, on the cell to the left or above, so a door is one
 * fact rather than two that can disagree.
 */
export class Vault {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    // right[i] / down[i]: null for a wall, OPEN or a colour for a passage.
    this.right = new Array(cols * rows).fill(null);
    this.down = new Array(cols * rows).fill(null);
    this.gems = [];
    this.start = 0;
    this.exit = cols * rows - 1;
  }

  inside(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }

  /** The passage between two adjacent cells, or null if there is a wall. */
  passage(x, y, dx, dy) {
    if (dx === 1) return this.right[idx(x, y, this.cols)];
    if (dx === -1) return this.inside(x - 1, y) ? this.right[idx(x - 1, y, this.cols)] : null;
    if (dy === 1) return this.down[idx(x, y, this.cols)];
    if (dy === -1) return this.inside(x, y - 1) ? this.down[idx(x, y - 1, this.cols)] : null;
    return null;
  }

  setPassage(x, y, dx, dy, value) {
    if (dx === 1) this.right[idx(x, y, this.cols)] = value;
    else if (dx === -1) this.right[idx(x - 1, y, this.cols)] = value;
    else if (dy === 1) this.down[idx(x, y, this.cols)] = value;
    else if (dy === -1) this.down[idx(x, y - 1, this.cols)] = value;
  }

  /** Every passage out of a cell, as [dx, dy, colour]. */
  exitsFrom(x, y) {
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!this.inside(x + dx, y + dy)) continue;
      const p = this.passage(x, y, dx, dy);
      if (p === null) continue;
      out.push([dx, dy, p]);
    }
    return out;
  }

  /** Every coloured door in the vault, for drawing and for counting. */
  doors() {
    const list = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const r = this.right[idx(x, y, this.cols)];
        if (r !== null && r !== OPEN) list.push({ x, y, dir: 'right', colour: r });
        const d = this.down[idx(x, y, this.cols)];
        if (d !== null && d !== OPEN) list.push({ x, y, dir: 'down', colour: d });
      }
    }
    return list;
  }
}

// --- Generation -----------------------------------------------------------

/** A spanning maze by recursive backtracking, then loops cut back in. */
function carve(cols, rows, t) {
  const vault = new Vault(cols, rows);
  const seen = new Array(cols * rows).fill(false);
  const stack = [[0, 0]];
  seen[0] = true;

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!vault.inside(nx, ny) || seen[idx(nx, ny, cols)]) continue;
      options.push([dx, dy]);
    }
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy] = options[(Math.random() * options.length) | 0];
    vault.setPassage(x, y, dx, dy, OPEN);
    seen[idx(x + dx, y + dy, cols)] = true;
    stack.push([x + dx, y + dy]);
  }

  // Loops. A spanning tree has exactly one path between any two cells, so
  // there is no route to choose and no game. These are what make it routing.
  const walls = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x + 1 < cols && vault.right[idx(x, y, cols)] === null) walls.push([x, y, 1, 0]);
      if (y + 1 < rows && vault.down[idx(x, y, cols)] === null) walls.push([x, y, 0, 1]);
    }
  }
  const extra = Math.round(walls.length * t.loopShare);
  for (let i = 0; i < extra && walls.length; i++) {
    const pick = (Math.random() * walls.length) | 0;
    const [x, y, dx, dy] = walls.splice(pick, 1)[0];
    vault.setPassage(x, y, dx, dy, OPEN);
  }
  return vault;
}

/** Paint some passages as doors. */
function paintDoors(vault, t) {
  const all = [];
  for (let y = 0; y < vault.rows; y++) {
    for (let x = 0; x < vault.cols; x++) {
      if (vault.right[idx(x, y, vault.cols)] === OPEN) all.push(['right', x, y]);
      if (vault.down[idx(x, y, vault.cols)] === OPEN) all.push(['down', x, y]);
    }
  }
  const wanted = Math.round(all.length * t.doorShare);
  for (let i = 0; i < wanted && all.length; i++) {
    const pick = (Math.random() * all.length) | 0;
    const [dir, x, y] = all.splice(pick, 1)[0];
    const colour = COLOURS[(Math.random() * COLOUR_COUNT) | 0];
    if (dir === 'right') vault.right[idx(x, y, vault.cols)] = colour;
    else vault.down[idx(x, y, vault.cols)] = colour;
  }
}

// --- The search that proves a floor ---------------------------------------

/**
 * Fastest time from one cell to another, in seconds, over states of
 * (cell, colour).
 *
 * Dijkstra, and complete: the state space is cells times three, which is small
 * enough to search exhaustively. So a null answer really is "there is no
 * route" rather than "I did not find one" — which is what lets the generator
 * REJECT a vault rather than merely doubt it.
 *
 * Returns { seconds, switches, steps, path } or null.
 */
export function fastestRoute(vault, from, to, startColour = COLOUR.AMBER, t = TUNING) {
  const cells = vault.cols * vault.rows;
  const states = cells * COLOUR_COUNT;
  const key = (cell, colour) => cell * COLOUR_COUNT + colour;

  const best = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const start = key(from, startColour);
  best[start] = 0;

  // A simple binary heap; the state space is small and this keeps the module
  // dependency-free like everything else here.
  const heap = [[0, start]];
  const push = (cost, state) => {
    heap.push([cost, state]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < heap.length && heap[l][0] < heap[small][0]) small = l;
        if (r < heap.length && heap[r][0] < heap[small][0]) small = r;
        if (small === i) break;
        [heap[small], heap[i]] = [heap[i], heap[small]];
        i = small;
      }
    }
    return top;
  };

  while (heap.length) {
    const [cost, state] = pop();
    if (cost > best[state]) continue;
    const cell = (state / COLOUR_COUNT) | 0;
    const colour = state % COLOUR_COUNT;

    if (cell === to) {
      // Walk the chain back for the route, and count what it cost.
      const path = [];
      let at = state;
      while (at !== -1) {
        path.push({ cell: (at / COLOUR_COUNT) | 0, colour: at % COLOUR_COUNT });
        at = prev[at];
      }
      path.reverse();
      let switches = 0;
      let steps = 0;
      for (let i = 1; i < path.length; i++) {
        if (path[i].cell === path[i - 1].cell) switches++; else steps++;
      }
      return { seconds: cost, switches, steps, path };
    }

    const x = cell % vault.cols;
    const y = (cell / vault.cols) | 0;

    // Step through any passage this colour can pass.
    for (const [dx, dy, door] of vault.exitsFrom(x, y)) {
      if (door !== OPEN && door !== colour) continue;
      const next = key(idx(x + dx, y + dy, vault.cols), colour);
      const cand = cost + t.stepSeconds;
      if (cand < best[next]) { best[next] = cand; prev[next] = state; push(cand, next); }
    }

    // Or change colour, standing still, and pay for it.
    for (const other of COLOURS) {
      if (other === colour) continue;
      const next = key(cell, other);
      const cand = cost + t.switchSeconds;
      if (cand < best[next]) { best[next] = cand; prev[next] = state; push(cand, next); }
    }
  }
  return null;
}

/**
 * Best time from any of `sources` to every cell, taking the best colour at
 * each. One search instead of one per destination.
 *
 * Placing gems used to call fastestRoute twice for EVERY candidate cell — six
 * hundred searches on a large floor — and it was the single slowest thing in
 * the project by a wide margin: a bot good enough to reach deep floors could
 * not finish a run inside the harness at all. The graph is symmetric, so two
 * searches answer the whole question.
 */
export function distancesFrom(vault, sources, t = TUNING) {
  const cells = vault.cols * vault.rows;
  const states = cells * COLOUR_COUNT;
  const best = new Float64Array(states).fill(Infinity);
  const heap = [];
  const push = (cost, state) => {
    heap.push([cost, state]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < heap.length && heap[l][0] < heap[small][0]) small = l;
        if (r < heap.length && heap[r][0] < heap[small][0]) small = r;
        if (small === i) break;
        [heap[small], heap[i]] = [heap[i], heap[small]];
        i = small;
      }
    }
    return top;
  };

  for (const { cell, colour } of sources) {
    const state = cell * COLOUR_COUNT + colour;
    if (best[state] > 0) { best[state] = 0; push(0, state); }
  }

  while (heap.length) {
    const [cost, state] = pop();
    if (cost > best[state]) continue;
    const cell = (state / COLOUR_COUNT) | 0;
    const colour = state % COLOUR_COUNT;
    const x = cell % vault.cols;
    const y = (cell / vault.cols) | 0;
    for (const [dx, dy, door] of vault.exitsFrom(x, y)) {
      if (door !== OPEN && door !== colour) continue;
      const next = ((y + dy) * vault.cols + (x + dx)) * COLOUR_COUNT + colour;
      const cand = cost + t.stepSeconds;
      if (cand < best[next]) { best[next] = cand; push(cand, next); }
    }
    for (const other of COLOURS) {
      if (other === colour) continue;
      const next = cell * COLOUR_COUNT + other;
      const cand = cost + t.switchSeconds;
      if (cand < best[next]) { best[next] = cand; push(cand, next); }
    }
  }

  const perCell = new Float64Array(cells).fill(Infinity);
  for (let cell = 0; cell < cells; cell++) {
    for (const colour of COLOURS) {
      const v = best[cell * COLOUR_COUNT + colour];
      if (v < perCell[cell]) perCell[cell] = v;
    }
  }
  return perCell;
}

export const sizeForFloor = (floor, t = TUNING) => ({
  cols: Math.min(t.maxCols, t.colsBase + 2 * Math.floor((floor - 1) / t.growEvery)),
  rows: Math.min(t.maxRows, t.rowsBase + 2 * Math.floor((floor - 1) / t.growEvery)),
});

/** How much more than par a floor gives you. Shrinks forever, never to zero. */
export const marginForFloor = (floor, t = TUNING) =>
  Math.max(t.marginFloor, t.marginBase * (t.marginDecay ** (floor - 1)));

/** The clock for a floor, given the par the search proved. */
export const timeForPar = (par, floor, t = TUNING) => par * (1 + marginForFloor(floor, t));

export const gemsForFloor = (floor, t = TUNING) =>
  Math.min(t.maxGems, Math.round(t.gemsBase + (floor - 1) * t.gemsPerFloor));

/**
 * Generate a floor, prove it, and deal it — or throw it away and try again.
 *
 * `attempts` is generous because rejection is cheap (a Dijkstra over a few
 * hundred states) and a vault the player cannot cross is not.
 */
export function buildFloor(floor, t = TUNING, attempts = 24) {
  const { cols, rows } = sizeForFloor(floor, t);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const vault = carve(cols, rows, t);
    paintDoors(vault, t);
    vault.start = idx(0, rows - 1, cols);
    vault.exit = idx(cols - 1, 0, cols);

    const route = fastestRoute(vault, vault.start, vault.exit, COLOUR.AMBER, t);
    if (!route) continue;
    // A vault that can be crossed without ever changing colour is a vault with
    // no game in it. Reject it and deal another.
    if (route.switches < 1) continue;

    const limit = timeForPar(route.seconds, floor, t);
    placeGems(vault, floor, route, limit, t);
    vault.floor = floor;
    vault.limit = limit;
    vault.parTime = route.seconds;
    vault.parSwitches = route.switches;
    return vault;
  }

  // Every attempt rejected: hand back the most forgiving thing there is rather
  // than nothing, because a missing floor would end a run that had not lost.
  const vault = carve(cols, rows, t);
  vault.start = idx(0, rows - 1, cols);
  vault.exit = idx(cols - 1, 0, cols);
  const route = fastestRoute(vault, vault.start, vault.exit, COLOUR.AMBER, t);
  const par = route ? route.seconds : t.stepSeconds * (cols + rows);
  const limit = timeForPar(par, floor, t);
  vault.floor = floor;
  vault.limit = limit;
  vault.parTime = par;
  vault.parSwitches = route ? route.switches : 0;
  vault.degenerate = true;
  placeGems(vault, floor, { seconds: par }, limit, t);
  return vault;
}

/**
 * Gems go where they are a DETOUR, not on the way.
 *
 * A gem on the fastest route is not a decision, it is a pickup. Each one is
 * placed so that going via it costs real time, and only kept if the detour
 * still fits inside the clock — otherwise it is a taunt.
 */
function placeGems(vault, floor, route, limit, t) {
  const wanted = gemsForFloor(floor, t);
  const cells = vault.cols * vault.rows;
  const taken = new Set([vault.start, vault.exit]);
  const gems = [];

  // Two searches, not two per candidate: out from the start, and back from the
  // exit. The graph is symmetric, so the second one read backwards is the cost
  // of finishing from anywhere.
  const out = distancesFrom(vault, [{ cell: vault.start, colour: COLOUR.AMBER }], t);
  const home = distancesFrom(vault, COLOURS.map((colour) => ({ cell: vault.exit, colour })), t);

  const order = [];
  for (let i = 0; i < cells; i++) if (!taken.has(i)) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const cell of order) {
    if (gems.length >= wanted) break;
    const viaSeconds = out[cell] + home[cell];
    if (!Number.isFinite(viaSeconds)) continue;
    if (viaSeconds <= route.seconds + t.stepSeconds) continue;  // on the way; no decision
    if (viaSeconds > limit) continue;                            // a taunt; unreachable
    gems.push({ cell, detour: +(viaSeconds - route.seconds).toFixed(2) });
    taken.add(cell);
  }
  vault.gems = gems;
}

// --- The run --------------------------------------------------------------

/**
 * One heist.
 *
 * `step(dt, input)` is the whole game; game.js only draws what this says is
 * true. Movement is cell to cell and takes stepSeconds, so the cost the search
 * priced and the cost the player pays are the same number.
 */
export class Heist {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    this.floor = 1;
    this.gems = 0;
    this.floorsCleared = 0;
    this.running = true;
    this.reason = null;
    this.switches = 0;
    this.steps = 0;
    this.enterFloor();
  }

  enterFloor() {
    this.vault = buildFloor(this.floor, this.t);
    this.cell = this.vault.start;
    this.colour = COLOUR.AMBER;
    this.left = this.vault.limit;
    this.busy = 0;            // seconds of standing still, mid-switch
    this.armed = !this.t.armOnFirstMove;
    this.collected = new Set();
    this.floorGems = 0;
  }

  get x() { return this.cell % this.vault.cols; }
  get y() { return (this.cell / this.vault.cols) | 0; }
  get atExit() { return this.cell === this.vault.exit; }

  /** Can this colour walk that way from here? */
  canMove(dx, dy) {
    if (!this.vault.inside(this.x + dx, this.y + dy)) return false;
    const door = this.vault.passage(this.x, this.y, dx, dy);
    if (door === null) return false;
    return door === OPEN || door === this.colour;
  }

  /** Take a step. Costs time and only happens if the door lets you. */
  move(dx, dy) {
    if (!this.running || this.busy > 0) return false;
    if (!this.canMove(dx, dy)) return false;
    this.armed = true;
    this.cell = idx(this.x + dx, this.y + dy, this.vault.cols);
    this.busy = this.t.stepSeconds;
    this.steps++;

    const gem = this.vault.gems.find((g) => g.cell === this.cell);
    if (gem && !this.collected.has(gem.cell)) {
      this.collected.add(gem.cell);
      this.gems++;
      this.floorGems++;
    }
    return true;
  }

  /**
   * Change colour. THE COST THAT MAKES THE CONSTRAINT REAL: you stand still
   * for switchSeconds, which is three and a half steps you are not taking.
   */
  switchTo(colour) {
    if (!this.running || this.busy > 0) return false;
    if (colour === this.colour) return false;
    this.armed = true;
    this.colour = colour;
    this.busy = this.t.switchSeconds;
    this.switches++;
    return true;
  }

  cycle(direction = 1) {
    return this.switchTo((this.colour + direction + COLOUR_COUNT) % COLOUR_COUNT);
  }

  /** One frame. */
  step(dt) {
    if (!this.running) return;
    this.busy = Math.max(0, this.busy - dt);
    if (this.armed) this.left -= dt;

    if (this.atExit) {
      this.floorsCleared++;
      this.floor++;
      this.enterFloor();
      return;
    }
    if (this.left <= 0) {
      this.left = 0;
      this.running = false;
      this.reason = END.CAUGHT;
    }
  }

  /** Gems stolen — the score. */
  get score() { return this.gems; }
}
