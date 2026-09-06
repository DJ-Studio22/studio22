// tests/helpers/ballast-bot.mjs
//
// Two bots for Ballast, per tests/README.md convention 5 — but here the two
// skill levels are carrying a second job as well.
//
// Ballast's whole reason to exist next to the other stackers is that a crate
// is a WEIGHT. These two bots are identical in every respect EXCEPT whether
// they care about that:
//
//   packer — plays it as a pure stacking game. Flat stack, low stack, no
//            holes. Never looks at the list.
//   mate   — the same scoring, plus the list and the water.
//
// So the gap between them is not "how good is the player", it is "how much is
// the twist worth". If the mate is not substantially ahead, the twist is
// decorative and the game should be something else.

import { COLS, Hold, ROWS, TUNING, crateTonnes, listOf, rotations } from '../../games/ballast/hold.js';

/** Every placement the current crate has: each rotation at every column. */
function placements(hold) {
  const c = hold.crate;
  if (!c) return [];
  const out = [];
  for (let turn = 0; turn < c.forms.length; turn++) {
    const cells = c.forms[turn];
    const w = Math.max(...cells.map((p) => p[0])) + 1;
    for (let x = 0; x <= COLS - w; x++) {
      // Drop it and see where it stops.
      let y = c.y;
      if (hold.collides(x, y, cells)) continue;
      while (!hold.collides(x, y + 1, cells)) y++;
      out.push({ turn, cells, x, y });
    }
  }
  return out;
}

/** The grid as it would be after this placement, without touching the real one. */
function simulate(hold, place) {
  const grid = hold.grid.map((row) => row.slice());
  for (const [cx, cy] of place.cells) {
    const gy = place.y + cy;
    if (gy >= 0) grid[gy][place.x + cx] = hold.crate.shape.tonnes;
  }
  // Batten down, the same way the real hold does.
  let stowed = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (grid[y].every((t) => t > 0)) {
      stowed++;
      grid.splice(y, 1);
      grid.unshift(new Array(COLS).fill(0));
      y++;
    }
  }
  return { grid, stowed };
}

/** Column heights, holes under them, and how uneven the surface is. */
function shapeOf(grid) {
  const heights = new Array(COLS).fill(0);
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let seen = false;
    for (let y = 0; y < ROWS; y++) {
      if (grid[y][x] > 0) {
        if (!seen) { seen = true; heights[x] = ROWS - y; }
      } else if (seen) holes++;
    }
  }
  let bumps = 0;
  for (let x = 0; x < COLS - 1; x++) bumps += Math.abs(heights[x] - heights[x + 1]);
  return { heights, holes, bumps, max: Math.max(...heights) };
}

// How long a bot takes over each crate before hard-dropping it. The SAME for
// both, because it is not the variable under test — it is here so that time
// passes at all.
//
// The first version of this harness slammed every crate the instant it
// spawned, which meant a seventy-crate run took 1.3 seconds of simulated
// time. The water is charged per second, so it never accumulated and no bot
// could sink at any tuning — twelve combinations of threshold and rate
// returned byte-identical results, which is what gave it away. A rule
// measured against a clock has to be measured with the clock running.
const THINK_TIME = 0.75;

export const SKILLS = {
  packer: { weighsList: false },
  mate: { weighsList: true },
};

/**
 * Scores a candidate placement. The first four terms are pure stacking and
 * both bots use them; the last two are the twist and only the mate does.
 */
function score(hold, place, skill) {
  const { grid, stowed } = simulate(hold, place);
  const s = shapeOf(grid);

  let v = 0;
  v += stowed * 60;          // stowing a row is the point
  v -= s.holes * 14;         // a hole is a row you cannot finish
  v -= s.bumps * 1.6;        // a flat surface takes any shape
  v -= s.max * 2.2;          // and a low stack has room to recover

  if (skill.weighsList) {
    const list = Math.abs(listOf(grid, hold.t));

    // A gentle pull towards level, only strong enough to break ties between
    // otherwise equal placements. Weighting absolute levelness heavily was
    // the first attempt and it was much worse than ignoring the list
    // altogether: the bot passed up rows it could have stowed in order to
    // stay perfectly upright, and scored a fifth of what the packer did.
    // Level is not the objective. Not sinking is.
    v -= list * 0.5;

    // The real cost starts before the threshold, not at it, because a hull
    // sitting just inside it has nowhere to go when the next crate is an
    // ingot. Squared, so it rises sharply rather than being traded away.
    const worry = list - (hold.t.shipAt - 4);
    if (worry > 0) v -= worry * worry * 9;

    // And once she is actually shipping, it scales with how much is already
    // aboard — the last few percent of water is worth far more than the
    // first few.
    const over = list - hold.t.shipAt;
    if (over > 0) v -= over * over * (14 + hold.water * 90);
  }
  return v;
}

/** One voyage. Returns tonnage stowed and why it ended. */
export function runOnce(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const hold = new Hold(tuning);
  const dt = 1 / 60;

  // A hard cap, so a bot that has solved the game cannot hang the suite.
  let decided = null;
  let thinking = 0;

  for (let i = 0; i < 60 * 900 && hold.running; i++) {
    if (hold.crate && decided !== hold.crate) {
      const options = placements(hold);
      if (options.length > 0) {
        let best = options[0];
        let bestScore = -Infinity;
        for (const p of options) {
          const v = score(hold, p, s);
          if (v > bestScore) { bestScore = v; best = p; }
        }
        // Bots place directly rather than miming the controls: this is a test
        // of the RULES, not of whether a d-pad can reach column six.
        hold.crate.turn = best.turn;
        hold.crate.cells = best.cells;
        hold.crate.x = best.x;
      }
      decided = hold.crate;
      thinking = 0;
    }

    // Let the clock run while the crate is considered, then hard-drop it —
    // which is how the game is actually played, and the only way the water
    // gets any time to come in.
    thinking += dt;
    if (hold.crate && thinking >= THINK_TIME) hold.slam();
    hold.step(dt);
  }

  return {
    tonnage: hold.tonnage,
    rowsStowed: hold.rowsStowed,
    crates: hold.cratesLanded,
    water: hold.water,
    reason: hold.reason,
  };
}
