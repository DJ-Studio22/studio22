// games/ballast/hold.js
//
// Ballast's simulation: the hold, the crates, the list, and the water. No
// canvas, no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// Ballast has a twist, and a twist is a claim: a crate is a WEIGHT and not
// just a shape, so where you put it matters as much as whether it fits. If a
// player who ignores the list does about as well as one who manages it, the
// twist is decorative and the game is a worse stacker than the stackers it is
// standing next to.
//
// That is measurable, so it is measured. tests/ballast.hold.test.mjs runs two
// bots over the same seeded crate sequences — one that packs for a flat stack
// and one that also weighs the list — and asserts the second is substantially
// better. Everything here is importable from Node so it can.
//
// THE THREE RULES
// ---------------
// 1. WHERE THE WEIGHT GOES TILTS THE HULL. The list is the moment of the
//    stowed cargo about the centreline. It is not random and it is not
//    hysteresis: put weight on the high side and the list comes back. That is
//    what makes it a skill rather than a countdown.
//
// 2. A HULL FAR ENOUGH OVER SHIPS WATER. Past a threshold list, water comes
//    in at a rate proportional to how far over she is. Level her up and the
//    bilge pump clears it, slowly. Water that could never be pumped out would
//    make one early mistake fatal twenty crates later, which is the worst
//    shape a rule can have in a game about recovering.
//
// 3. A PACKED ROW BATTENS DOWN AND SLIDES OUT OF THE BOTTOM. It does not
//    vanish upward like a cleared line — the cargo is stowed, and stowed
//    tonnage is the score. Everything above it drops by one.
//
// STACKING HIGH IS ITS OWN PUNISHMENT. The list is scaled by how high the
// cargo sits, because a high centre of gravity is exactly what makes a real
// hull tender. So the safe stack is low and even, and the game is the
// argument between that and the shapes you are actually dealt.

// --- Geometry -------------------------------------------------------------

export const COLS = 8;
export const ROWS = 14;

// --- Tuning ---------------------------------------------------------------
//
// A plain object, so a test can clone it, change one figure and run both
// versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The barge's own displacement, in tonnes. This is what stops a single
  // crate from putting her on her beam ends: the list depends on where the
  // cargo sits against the mass of the whole vessel, not on the cargo alone.
  //
  // Without it the numbers were nonsense. The first version listed purely on
  // the raw moment, so a single ingot in the corner of an otherwise empty
  // hold put her nineteen degrees over — past the shipping threshold, on the
  // first crate of the run. The bots found it immediately: the one that
  // respected the list could not place anything anywhere and scored a median
  // of zero.
  hullTonnes: 20,

  // Degrees of list per column the loaded centre of gravity sits off the
  // centreline. Half the hold's width is 3.5 columns, so this is the list of
  // a barge with every tonne stowed hard against one side.
  degreesPerColumn: 9.5,

  // How much a high centre of gravity multiplies the list. At the top of the
  // hold the same cargo lists this much more than it would on the floor.
  heightTenderness: 0.85,

  // A crate landing on a hull already over by this much SLIDES one column
  // downhill before it settles.
  //
  // This rule is the reason the game works, and it was added because the bots
  // said so. Without it, a bot that simply packed a flat, low, hole-free
  // stack stayed level for free and never shipped a drop — because "flat and
  // even" and "balanced" turn out to be almost the same objective, and the
  // random weights average out faster than they accumulate. The twist was
  // decorative: the bot that respected the list only ever paid for it, and
  // scored barely a third of the bot that ignored it.
  //
  // Sliding breaks that equivalence. A tilted hull no longer puts crates
  // where they were aimed, so careful packing STOPS WORKING while she is
  // over, and the list becomes something you have to fix before you can go
  // back to stacking. It also matches what the game says it is about: where
  // a crate lands tilts the hull, and the tilted hull decides where the next
  // one lands.
  slideAt: 5,

  // She is over far enough to ship water past this, and cannot physically
  // lean further than the second figure.
  shipAt: 12,
  maxList: 34,

  // Water in per degree over the threshold per second, and water out per
  // second while she is inside it. In is faster than out — recovery is real
  // but it is not free.
  shipRate: 0.090,
  pumpRate: 0.045,

  // Fall speed, in rows per second, and how it grows per hundred tonnes.
  baseFall: 1.5,
  fallPerHundredTonnes: 0.55,

  // How long a crate rests on the stack before it is committed, so a last
  // adjustment is always possible.
  lockDelay: 0.45,
};

// --- The crates -----------------------------------------------------------
//
// Deliberately NOT the seven standard tetrominoes, and the rule that keeps it
// that way is simple enough to state: NO CRATE IS FOUR CELLS. Sizes are one,
// two, three and five, which rules out all seven of them at a stroke and
// gives the set a shape of its own — a single heavy ingot is a real decision
// in a way no tetromino ever is.
//
// `tonnes` is per cell, so a five-cell crate of light timber weighs a fifth of
// a one-cell ingot. That is the whole point of the twist.
//
// THE WEIGHTS ARE BIMODAL ON PURPOSE, and the reason is a measurement. The
// first set ran 2 to 9 tonnes a cell — a reasonable-looking spread, and
// useless: over sixty-odd crates the imbalance a random sequence produces
// grows as the square root of the count while the total grows as the count,
// so the relative lopsidedness SHRINKS the longer you play. A bot that packed
// flat stayed level for free and never shipped a drop of water, at any tuning
// tried, because with weights like that "flat" and "balanced" are the same
// objective.
//
// A 26-tonne ingot cannot be averaged away. It is a third of a typical load
// in a single cell, so where it goes is a decision on its own and no amount
// of tidy packing makes it not one. "The heavy ones are heavy" is what the
// game says it is about, and it turns out to be load-bearing rather than
// flavour.
export const SHAPES = [
  // One cell, and a quarter of the hold's weight. Awkward, decisive, and the
  // only thing that will fill a single hole.
  { id: 'ingot', tonnes: 26, cells: [[0, 0]] },

  // Two cells.
  { id: 'barrel', tonnes: 8, cells: [[0, 0], [0, 1]] },
  { id: 'plank', tonnes: 1, cells: [[0, 0], [1, 0]] },

  // Three cells.
  { id: 'elbow', tonnes: 3, cells: [[0, 0], [0, 1], [1, 1]] },
  { id: 'beam', tonnes: 2, cells: [[0, 0], [1, 0], [2, 0]] },

  // Five cells, and mostly light, so the big crate is not the dangerous one.
  { id: 'cross', tonnes: 1, cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: 'hook', tonnes: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: 'stair', tonnes: 1, cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
  { id: 'gate', tonnes: 2, cells: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
];

/** Total tonnage of one crate — cells times the per-cell weight. */
export const crateTonnes = (shape) => shape.cells.length * shape.tonnes;

/**
 * A crate's cells rotated a quarter turn clockwise, normalised back to the
 * origin so the shape does not wander as it turns.
 */
export function rotate(cells) {
  const turned = cells.map(([x, y]) => [-y, x]);
  const minX = Math.min(...turned.map((c) => c[0]));
  const minY = Math.min(...turned.map((c) => c[1]));
  return turned.map(([x, y]) => [x - minX, y - minY]);
}

/** All distinct rotations of a shape, in turn order. Squares give one. */
export function rotations(cells) {
  const seen = [];
  let current = cells.map(([x, y]) => [x, y]);
  for (let i = 0; i < 4; i++) {
    const key = [...current].sort((a, b) => a[0] - b[0] || a[1] - b[1]).join(';');
    if (seen.some((s) => s.key === key)) break;
    seen.push({ key, cells: current });
    current = rotate(current);
  }
  return seen.map((s) => s.cells);
}

// --- The hull -------------------------------------------------------------

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * The moment of the stowed cargo about the centreline, in tonne-columns.
 * Positive is to starboard (to the right).
 *
 * This is the whole twist in one function, and it is deliberately simple: the
 * player has to be able to look at the hold and know which way she will go.
 */
export function momentOf(grid) {
  const centre = (COLS - 1) / 2;
  let moment = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = grid[y][x];
      if (t > 0) moment += t * (x - centre);
    }
  }
  return moment;
}

/**
 * How high the cargo is sitting, 0 at the floor and 1 at the deckhead — the
 * mean height of every stowed tonne, weighted by weight.
 *
 * A hull with her cargo up in the air is tender. This is what says so.
 */
export function centreOfGravity(grid) {
  let tonnes = 0;
  let weighted = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = grid[y][x];
      if (t > 0) {
        tonnes += t;
        // Row 0 is the deckhead, ROWS-1 is the floor.
        weighted += t * (1 - y / (ROWS - 1));
      }
    }
  }
  return tonnes === 0 ? 0 : weighted / tonnes;
}

/** Total tonnes stowed in the hold. */
export function tonnesIn(grid) {
  let total = 0;
  for (const row of grid) for (const t of row) total += t;
  return total;
}

/**
 * The list, in degrees. Positive is over to starboard.
 *
 * The moment is divided by the whole vessel's mass — cargo PLUS the barge's
 * own displacement — so what drives the list is how far the loaded centre of
 * gravity sits off the centreline, not how much cargo there happens to be.
 *
 * That division is doing two jobs. It stops the first crate of a run from
 * being catastrophic, and it makes the game get harder honestly: as the hold
 * fills, the cargo is a larger share of the total, so the same lopsidedness
 * costs more degrees than it did when she was light.
 *
 * Deterministic in the cargo alone, which is the property that makes the game
 * fair: no hidden state, and shifting weight to the high side always brings
 * her back.
 */
export function listOf(grid, tuning = TUNING) {
  const cargo = tonnesIn(grid);
  if (cargo === 0) return 0;
  const offset = momentOf(grid) / (cargo + tuning.hullTonnes);
  const tender = 1 + centreOfGravity(grid) * tuning.heightTenderness;
  return clamp(offset * tuning.degreesPerColumn * tender, -tuning.maxList, tuning.maxList);
}

// --- The hold -------------------------------------------------------------

export const END = {
  FOUNDERED: 'Shipped too much water',
  FULL: 'The hold is full',
};

export const emptyGrid = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

/** One voyage. */
export class Hold {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    this.grid = emptyGrid();
    this.water = 0;
    this.tonnage = 0;      // the score: tonnes battened down
    this.rowsStowed = 0;
    this.cratesLanded = 0;
    this.running = true;
    this.reason = null;
    this.fallTimer = 0;
    this.restTimer = 0;
    this.next = this.#draw();
    this.spawn();
  }

  #draw() {
    return SHAPES[Math.floor(Math.random() * SHAPES.length)];
  }

  get list() { return listOf(this.grid, this.t); }
  get shipping() { return Math.abs(this.list) > this.t.shipAt; }

  /** Rows per second, which grows with how much has been stowed. */
  get fallSpeed() {
    return this.t.baseFall + (this.tonnage / 100) * this.t.fallPerHundredTonnes;
  }

  /** Puts the next crate at the top, centred. Ends the run if it will not go. */
  spawn() {
    const shape = this.next;
    this.next = this.#draw();
    const forms = rotations(shape.cells);
    this.crate = {
      shape,
      forms,
      turn: 0,
      cells: forms[0],
      // Centred, and as high as the shape allows.
      x: Math.floor((COLS - (Math.max(...forms[0].map((c) => c[0])) + 1)) / 2),
      y: 0,
    };
    this.fallTimer = 0;
    this.restTimer = 0;

    if (this.collides(this.crate.x, this.crate.y, this.crate.cells)) {
      this.running = false;
      this.reason = END.FULL;
    }
  }

  /** Would this crate, at this place, be off the grid or on top of cargo? */
  collides(x, y, cells) {
    for (const [cx, cy] of cells) {
      const gx = x + cx;
      const gy = y + cy;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && this.grid[gy][gx] > 0) return true;
    }
    return false;
  }

  move(dx) {
    if (!this.running || !this.crate) return false;
    const c = this.crate;
    if (this.collides(c.x + dx, c.y, c.cells)) return false;
    c.x += dx;
    this.restTimer = 0;
    return true;
  }

  /**
   * A quarter turn, with a shove. Five candidates, tried in order: in place,
   * one each way, two each way. Deliberately not a kick table — the crates
   * are not tetrominoes and a table built for tetrominoes would be a lie
   * about which nudges are possible.
   */
  rotateCrate() {
    if (!this.running || !this.crate) return false;
    const c = this.crate;
    const turn = (c.turn + 1) % c.forms.length;
    const cells = c.forms[turn];
    for (const shove of [0, -1, 1, -2, 2]) {
      if (!this.collides(c.x + shove, c.y, cells)) {
        c.turn = turn;
        c.cells = cells;
        c.x += shove;
        this.restTimer = 0;
        return true;
      }
    }
    return false;
  }

  /** True if the crate is resting on something. */
  grounded() {
    const c = this.crate;
    return !c || this.collides(c.x, c.y + 1, c.cells);
  }

  /** Drops the crate as far as it will go and commits it immediately. */
  slam() {
    if (!this.running || !this.crate) return;
    const c = this.crate;
    while (!this.collides(c.x, c.y + 1, c.cells)) c.y++;
    this.land();
  }

  /**
   * How far a crate landing right now would slide, in columns. Positive is to
   * starboard. Zero while she is inside the slide threshold.
   *
   * Exposed because the renderer draws it as a warning before the crate is
   * committed — a rule the player cannot see coming is not a rule, it is a
   * surprise.
   */
  slideDirection() {
    const list = this.list;
    return Math.abs(list) < this.t.slideAt ? 0 : Math.sign(list);
  }

  /** Commits the crate where it sits, then batten down and respawn. */
  land() {
    const c = this.crate;
    if (!c) return;

    // A hull already over does not put a crate where it was aimed. It slides
    // downhill and settles again, which is what stops careful packing from
    // being a way to ignore the list entirely.
    const slide = this.slideDirection();
    if (slide !== 0 && !this.collides(c.x + slide, c.y, c.cells)) {
      c.x += slide;
      while (!this.collides(c.x, c.y + 1, c.cells)) c.y++;
    }

    for (const [cx, cy] of c.cells) {
      const gy = c.y + cy;
      if (gy >= 0) this.grid[gy][c.x + cx] = c.shape.tonnes;
    }
    this.cratesLanded++;
    this.crate = null;
    this.batten();
    if (this.running) this.spawn();
  }

  /**
   * Any row that is packed solid slides out of the BOTTOM of the hold, and
   * everything above it drops one. Its tonnage is the score.
   *
   * Out of the bottom rather than vanishing is not decoration: it means the
   * cargo above lands lower, which lowers the centre of gravity, which makes
   * her stiffer. Stowing a row is rewarded twice.
   */
  batten() {
    let stowed = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every((t) => t > 0)) {
        stowed++;
        this.tonnage += this.grid[y].reduce((sum, t) => sum + t, 0);
        this.grid.splice(y, 1);
        this.grid.unshift(new Array(COLS).fill(0));
        y++; // the row that dropped into this slot has not been looked at
      }
    }
    this.rowsStowed += stowed;
    return stowed;
  }

  /**
   * One tick of the clock. Water, then the fall.
   *
   * The water is charged against the list as it is RIGHT NOW, every tick,
   * which is what makes levelling her up worth doing immediately rather than
   * eventually.
   */
  step(dt) {
    if (!this.running) return;
    const T = this.t;

    const over = Math.abs(this.list) - T.shipAt;
    if (over > 0) this.water += over * T.shipRate * dt;
    else this.water = Math.max(0, this.water - T.pumpRate * dt);

    if (this.water >= 1) {
      this.water = 1;
      this.running = false;
      this.reason = END.FOUNDERED;
      return;
    }

    if (!this.crate) return;

    // Resting on the stack: a short grace period so a last nudge is possible.
    if (this.grounded()) {
      this.restTimer += dt;
      if (this.restTimer >= T.lockDelay) this.land();
      return;
    }

    this.restTimer = 0;
    this.fallTimer += dt * this.fallSpeed;
    while (this.fallTimer >= 1) {
      this.fallTimer -= 1;
      if (this.collides(this.crate.x, this.crate.y + 1, this.crate.cells)) break;
      this.crate.y++;
    }
  }
}
