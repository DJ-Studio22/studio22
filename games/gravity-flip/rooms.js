// games/gravity-flip/rooms.js
//
// The rooms, the rules they are built to, and the checker that enforces them.
//
// The depth in this game is room design, so the rooms are AUTHORED rather than
// generated. A generator would have to be taught everything below and would
// still produce the occasional room that cannot be crossed — which, in a game
// with one button and no second chance, is the worst failure available.
// Sequencing them is procedural; the shapes themselves are not.
//
// THE GRID
// --------
// Every room is 20 columns by 9 rows. The floor and ceiling are added by the
// game and are always solid, so these 9 rows are the space between them. Row 0
// sits under the ceiling; row 8 sits on the floor.
//
//   .  empty
//   #  solid. Landing on one is fine — running into its side is not.
//   ^  spikes standing on the bottom of their cell. Deadly.
//   v  spikes hanging from the top of their cell. Deadly.
//   o  a saw, patrolling up and down the middle of its column. Deadly.
//
// THE MODEL THE RULES ARE WRITTEN AGAINST
// ---------------------------------------
// A player is always in one of three situations in any given column:
//
//   riding the floor      needs rows 7-8 clear
//   riding the ceiling    needs rows 0-1 clear
//   crossing between them needs the WHOLE column clear
//
// So a column where the floor is blocked is a column you must be on the
// ceiling for, and vice versa. Those are "forced" columns, and the rules are
// about getting between them:
//
// 1. COLUMNS 0-3 ARE FULLY CLEAR. A room is entered on whichever surface the
//    last one left you on, and a hazard in the doorway is a death you could
//    not have avoided.
//
// 2. NO COLUMN IS BLOCKED ON BOTH SURFACES. There would be nowhere to be.
//
// 3. FOUR CONSECUTIVE FULLY-CLEAR COLUMNS BETWEEN OPPOSITE FORCES. A flip
//    crosses the room in roughly four columns of travel, so a stretch that
//    forces you onto the ceiling followed by one that forces you onto the
//    floor needs four clear columns in between to do it in. Hazards forcing
//    you onto the SAME surface can be as close as you like: staying put costs
//    nothing.
//
// A saw is deliberately NOT a wall for rule 3. It patrols the middle of its
// column and never reaches either surface, so it is a timing problem on the
// way across rather than a blocked column — which is exactly what makes it a
// tier 3 hazard rather than a tier 1 one.
//
// All of this is checked at load by validate() below. Every room in this file
// passes; the check exists so that the next one has to as well.

export const ROOM_COLS = 20;
export const ROOM_ROWS = 9;

// How many columns of travel a flip takes, floor to ceiling. This is derived
// from the game's gravity and run speed and the two must not drift apart —
// game.js asserts against it at boot.
export const FLIP_COLUMNS = 4;

// Saws live in the middle band only, so their patrol can never reach a surface.
export const SAW_ROW_MIN = 3;
export const SAW_ROW_MAX = 5;

/**
 * Tiers, roughly:
 *   0  one hazard, acres of room. Teaches that the button flips you.
 *   1  two hazards on opposite surfaces. Teaches the rhythm.
 *   2  solid blocks and mid-air slabs; some rooms must be committed to early.
 *   3  saws in the crossing, long spans, and gaps at the legal minimum.
 */
export const ROOMS = [
  // --- Tier 0 -----------------------------------------------------------
  {
    id: 'first-light',
    tier: 0,
    grid: [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.......^^^..........',
    ],
  },
  {
    id: 'overhang',
    tier: 0,
    grid: [
      '.......vvv..........',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
    ],
  },
  {
    id: 'two-bites',
    tier: 0,
    grid: [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.....^^^.....^^^....',
    ],
  },
  {
    id: 'low-ledge',
    tier: 0,
    grid: [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.......####.........',
      '.......####.........',
      '.......####.........',
    ],
  },

  // --- Tier 1 -----------------------------------------------------------
  {
    // Floor forced onto the ceiling at 4-7, ceiling forced onto the floor at
    // 12-15. Columns 8-11 are the crossing: exactly the legal minimum.
    id: 'zigzag',
    tier: 1,
    grid: [
      '............vvvv....',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....^^^^............',
    ],
  },
  {
    id: 'ceiling-wall',
    tier: 1,
    grid: [
      '......#####.........',
      '......#####.........',
      '......#####.........',
      '......#####.........',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
    ],
  },
  {
    id: 'floor-wall',
    tier: 1,
    grid: [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '......#####.........',
      '......#####.........',
      '......#####.........',
      '......#####.........',
    ],
  },
  {
    id: 'stagger',
    tier: 1,
    grid: [
      '.....####...........',
      '.....####...........',
      '.....####...........',
      '.....####...........',
      '....................',
      '..............####..',
      '..............####..',
      '..............####..',
      '..............####..',
    ],
  },
  {
    id: 'long-teeth',
    tier: 1,
    grid: [
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.....^^^^^^^^.......',
    ],
  },

  // --- Tier 2 -----------------------------------------------------------
  {
    // The slab across the middle means the crossing has to happen before
    // column 5. Once you are on the ceiling you are committed for ten columns,
    // and the spikes below are only a threat if you got the timing wrong.
    id: 'corridor',
    tier: 2,
    grid: [
      '....................',
      '....................',
      '.....##########.....',
      '.....##########.....',
      '....................',
      '....................',
      '....................',
      '....................',
      '.....^^^....^^^.....',
    ],
  },
  {
    // The ceiling block is a ledge as well as an obstacle: flipping up under
    // it parks you on its underside until it runs out.
    id: 'threading',
    tier: 2,
    grid: [
      '.....####...........',
      '.....####...........',
      '.....####...........',
      '....................',
      '....................',
      '....................',
      '.............#####..',
      '.............#####..',
      '.............#####..',
    ],
  },
  {
    id: 'pillar-and-teeth',
    tier: 2,
    grid: [
      '.....###............',
      '.....###............',
      '.....###............',
      '.....###............',
      '....................',
      '....................',
      '....................',
      '....................',
      '............^^^^....',
    ],
  },
  {
    id: 'both-jaws',
    tier: 2,
    grid: [
      '.....vvvv...........',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.............^^^....',
    ],
  },
  {
    // Nothing forces you off the ceiling here, but the slab means that if you
    // are still on the floor at column 7 you are staying there.
    id: 'shelf',
    tier: 2,
    grid: [
      '....................',
      '....................',
      '....................',
      '.......######.......',
      '.......######.......',
      '....................',
      '....................',
      '....................',
      '....^^^........^^^..',
    ],
  },

  // --- Tier 3 -----------------------------------------------------------
  {
    // A saw sitting in the middle of the only crossing there is.
    id: 'saw-alley',
    tier: 3,
    grid: [
      '....vvvv............',
      '....................',
      '....................',
      '....................',
      '.........o..........',
      '....................',
      '....................',
      '....................',
      '............^^^^....',
    ],
  },
  {
    id: 'gauntlet',
    tier: 3,
    grid: [
      '....####............',
      '....####............',
      '....####............',
      '....####............',
      '.........o..o.......',
      '..............####..',
      '..............####..',
      '..............####..',
      '..............####..',
    ],
  },
  {
    // Both spans at their longest, and the crossing at its shortest.
    id: 'needle',
    tier: 3,
    grid: [
      '.............vvvvv..',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....^^^^^...........',
    ],
  },
  {
    id: 'crush',
    tier: 3,
    grid: [
      '.....####...........',
      '.....####...........',
      '.....####...........',
      '.....####...........',
      '..........o.........',
      '.............#####..',
      '.............#####..',
      '.............#####..',
      '.............#####..',
    ],
  },
  {
    // A ledge you can ride, a slab you cannot pass, and a saw between them.
    id: 'the-long-way',
    tier: 3,
    grid: [
      '....................',
      '....................',
      '......########......',
      '......########......',
      '..........o.........',
      '....................',
      '....................',
      '....................',
      '....^^^.....^^^^^...',
    ],
  },
];

// --- Validation ----------------------------------------------------------

const WALL = '#';
const SPIKES = new Set(['^', 'v']);
const SAW = 'o';

const blocks = (ch) => ch === WALL || SPIKES.has(ch);

/**
 * Reads a room into the three facts the rules are about, per column:
 * whether the floor is usable, whether the ceiling is usable, and whether the
 * column can be crossed.
 */
export function readRoom(room) {
  const floorOk = [];
  const ceilOk = [];
  const crossable = [];

  for (let c = 0; c < ROOM_COLS; c++) {
    let floorClear = true;
    let ceilClear = true;
    let columnClear = true;

    for (let r = 0; r < ROOM_ROWS; r++) {
      const ch = room.grid[r]?.[c] ?? '.';
      if (!blocks(ch)) continue;
      if (r >= ROOM_ROWS - 2) floorClear = false;
      if (r <= 1) ceilClear = false;
      columnClear = false;
    }

    floorOk.push(floorClear);
    ceilOk.push(ceilClear);
    // A saw does not make a column uncrossable: it moves, so it is a timing
    // problem rather than a wall.
    crossable.push(columnClear);
  }

  return { floorOk, ceilOk, crossable };
}

// The longest run of consecutive crossable columns in [from, to).
function longestCrossingRun(crossable, from, to) {
  let best = 0;
  let run = 0;
  for (let c = Math.max(0, from); c < Math.min(ROOM_COLS, to); c++) {
    run = crossable[c] ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

function validateRoom(room, problems) {
  const where = `"${room.id}"`;

  if (room.grid.length !== ROOM_ROWS) {
    problems.push(`${where}: ${room.grid.length} rows, expected ${ROOM_ROWS}.`);
    return;
  }
  for (let r = 0; r < ROOM_ROWS; r++) {
    if (room.grid[r].length !== ROOM_COLS) {
      problems.push(`${where}: row ${r} is ${room.grid[r].length} wide, expected ${ROOM_COLS}.`);
      return;
    }
  }

  // Saws must sit in the middle band, or their patrol reaches a surface and
  // the "a saw is not a wall" assumption above stops being true.
  for (let r = 0; r < ROOM_ROWS; r++) {
    for (let c = 0; c < ROOM_COLS; c++) {
      if (room.grid[r][c] !== SAW) continue;
      if (r < SAW_ROW_MIN || r > SAW_ROW_MAX) {
        problems.push(`${where}: saw at row ${r}, column ${c}; must be rows ${SAW_ROW_MIN}-${SAW_ROW_MAX}.`);
      }
    }
  }

  const { floorOk, ceilOk, crossable } = readRoom(room);

  // Rule 2: somewhere to be, in every column.
  for (let c = 0; c < ROOM_COLS; c++) {
    if (!floorOk[c] && !ceilOk[c]) {
      problems.push(`${where}: column ${c} is blocked on both surfaces.`);
    }
  }

  // Rule 1: a clear doorway.
  for (let c = 0; c < FLIP_COLUMNS; c++) {
    if (!crossable[c]) {
      problems.push(`${where}: column ${c} is not clear; the first ${FLIP_COLUMNS} columns must be.`);
    }
  }

  // Rule 3: room to change surface between opposite forced stretches.
  //
  // "Forced" runs are collapsed first, so a single hazard and a run of eight
  // are one entry each — what matters is where a stretch starts and ends, not
  // how many columns it covers.
  const forced = [];
  for (let c = 0; c < ROOM_COLS; c++) {
    const surface = !floorOk[c] ? 'ceiling' : !ceilOk[c] ? 'floor' : null;
    if (!surface) continue;
    const last = forced[forced.length - 1];
    if (last && last.surface === surface && last.to === c - 1) last.to = c;
    else forced.push({ surface, from: c, to: c });
  }

  // Entering: the player may arrive on either surface, so there must be room
  // to change before the first forced stretch.
  if (forced.length > 0) {
    const first = forced[0];
    if (longestCrossingRun(crossable, 0, first.from) < FLIP_COLUMNS) {
      problems.push(`${where}: only ${longestCrossingRun(crossable, 0, first.from)} clear column(s) before the forced stretch at ${first.from}; needs ${FLIP_COLUMNS}.`);
    }
  }

  for (let i = 1; i < forced.length; i++) {
    const previous = forced[i - 1];
    const current = forced[i];
    if (previous.surface === current.surface) continue;   // staying put is free

    const run = longestCrossingRun(crossable, previous.to + 1, current.from);
    if (run < FLIP_COLUMNS) {
      problems.push(`${where}: ${run} clear column(s) between the ${previous.surface} stretch ending at ${previous.to} and the ${current.surface} stretch starting at ${current.from}; needs ${FLIP_COLUMNS}.`);
    }
  }
}

function validate() {
  const problems = [];
  const seen = new Set();

  for (const room of ROOMS) {
    if (seen.has(room.id)) problems.push(`"${room.id}": duplicate id.`);
    seen.add(room.id);
    validateRoom(room, problems);
  }
  return problems;
}

export const roomProblems = validate();
if (roomProblems.length > 0) {
  console.warn(`[rooms] ${roomProblems.length} problem(s):\n  - ${roomProblems.join('\n  - ')}`);
}

/**
 * Picks the next room.
 *
 * Weighted toward the current tier rather than locked to it, so a hard run
 * still gets the occasional breather and an easy one still gets a warning
 * shot. `avoid` is the room just played and is excluded outright — the same
 * room twice running reads as a bug even when it is only chance.
 */
export function pickRoom(tier, avoid) {
  const candidates = ROOMS.filter((room) => room.tier <= tier && room.id !== avoid?.id);
  if (candidates.length === 0) return ROOMS[0];

  const weights = candidates.map((room) => 1 / (1 + (tier - room.tier) * 1.5));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
