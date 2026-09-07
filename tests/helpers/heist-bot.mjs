// tests/helpers/heist-bot.mjs
//
// Two bots for Colour Heist, per tests/README.md convention 5.
//
// They differ in one thing, and it is the thing the game claims is its depth:
//
//   dasher  heads for the target by the shortest number of STEPS, ignoring
//           what colour the doors are, and switches whenever it finds itself
//           standing in front of one it cannot pass.
//   router  plans over (cell, colour) with the real cost model, so a door it
//           cannot pass is priced BEFORE it walks there rather than after.
//
// Both know the map. Both take the same gems. The gap between them is entirely
// whether the constraint was planned around or bumped into — which is exactly
// the claim, so if the gap is small the doors are scenery.

import {
  COLOUR, COLOURS, Heist, OPEN, TUNING, fastestRoute,
} from '../../games/color-heist/maze.js';

export const SKILLS = {
  dasher: { plans: false },
  router: { plans: true },
};

/** Shortest path in STEPS, pretending every door is open. */
function blindPath(vault, from, to) {
  const cells = vault.cols * vault.rows;
  const prev = new Int32Array(cells).fill(-1);
  const seen = new Uint8Array(cells);
  const queue = [from];
  seen[from] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell === to) break;
    const x = cell % vault.cols;
    const y = (cell / vault.cols) | 0;
    for (const [dx, dy] of vault.exitsFrom(x, y)) {
      const next = (y + dy) * vault.cols + (x + dx);
      if (seen[next]) continue;
      seen[next] = 1;
      prev[next] = cell;
      queue.push(next);
    }
  }
  if (!seen[to]) return null;
  const path = [];
  for (let at = to; at !== -1; at = prev[at]) path.push(at);
  return path.reverse();
}

/**
 * Where this bot is trying to get to: the best uncollected gem it still has
 * time for, else the way out.
 *
 * Memoised on what actually changes the answer, because this weighs every gem
 * with two searches apiece and the answer cannot move while the runner has not.
 */
const targetCache = new WeakMap();
function target(heist) {
  // Only what can actually change the answer. Keyed on the runner's CELL as
  // well it recomputed on every step — sixteen searches a step — and a router
  // that reached deep floors never finished a run at all.
  const stamp = `${heist.floor}:${heist.collected.size}:${Math.ceil(heist.left / 3)}`;
  let cache = targetCache.get(heist);
  if (!cache) { cache = {}; targetCache.set(heist, cache); }
  if (cache.stamp === stamp) return cache.value;
  const value = computeTarget(heist);
  cache.stamp = stamp;
  cache.value = value;
  return value;
}

function computeTarget(heist) {
  const left = heist.vault.gems.filter((g) => !heist.collected.has(g.cell));
  if (!left.length) return heist.vault.exit;
  // Only detour for a gem while there is comfortably time; otherwise leave.
  const spare = heist.left;
  let best = null;
  for (const gem of left) {
    const legA = fastestRoute(heist.vault, heist.cell, gem.cell, heist.colour, heist.t);
    if (!legA) continue;
    const legB = fastestRoute(heist.vault, gem.cell, heist.vault.exit, COLOUR.AMBER, heist.t);
    if (!legB) continue;
    const total = legA.seconds + legB.seconds;
    if (total > spare * 0.86) continue;
    if (!best || total < best.total) best = { cell: gem.cell, total };
  }
  return best ? best.cell : heist.vault.exit;
}

/**
 * A plan, kept until it is spent or invalidated.
 *
 * The router used to solve the whole vault again before every single step,
 * which is not what planning means and is what made it too slow to measure.
 * It plans a route and then walks it, replanning only when the destination
 * changes under it.
 */
const planCache = new WeakMap();
function nextFromPlan(heist, to) {
  let plan = planCache.get(heist);
  if (!plan || plan.to !== to || plan.cell !== heist.cell || plan.colour !== heist.colour) {
    const route = fastestRoute(heist.vault, heist.cell, to, heist.colour, heist.t);
    if (!route || route.path.length < 2) return null;
    plan = { to, steps: route.path.slice(1) };
  }
  const next = plan.steps.shift();
  if (!next) { planCache.delete(heist); return null; }
  plan.cell = next.cell;
  plan.colour = next.colour;
  planCache.set(heist, plan);
  return next;
}

/** One action for this bot: a step, or a switch. */
export function decide(heist, s) {
  if (heist.busy > 0) return null;
  const to = target(heist);
  if (to === heist.cell) return null;

  if (s.plans) {
    const next = nextFromPlan(heist, to);
    if (!next) return null;
    if (next.cell === heist.cell) return { switchTo: next.colour };
    const x = heist.cell % heist.vault.cols;
    const y = (heist.cell / heist.vault.cols) | 0;
    const nx = next.cell % heist.vault.cols;
    const ny = (next.cell / heist.vault.cols) | 0;
    return { move: [nx - x, ny - y] };
  }

  // The dasher: shortest in steps, colour ignored until it is in the way.
  const path = blindPath(heist.vault, heist.cell, to);
  if (!path || path.length < 2) return null;
  const x = heist.cell % heist.vault.cols;
  const y = (heist.cell / heist.vault.cols) | 0;
  const nx = path[1] % heist.vault.cols;
  const ny = (path[1] / heist.vault.cols) | 0;
  const dx = nx - x;
  const dy = ny - y;
  if (heist.canMove(dx, dy)) return { move: [dx, dy] };

  // Blocked. Switch to whatever this door wants — the reactive version of the
  // decision the router made three cells ago.
  const door = heist.vault.passage(x, y, dx, dy);
  if (door !== null && door !== OPEN) return { switchTo: door };
  return { switchTo: COLOURS[(heist.colour + 1) % COLOURS.length] };
}

/**
 * One heist.
 *
 * The loop thinks ONCE PER ACTION rather than once per frame, and that is not
 * a micro-optimisation: a plan is a Dijkstra plus two more for every gem it
 * weighs, and running that sixty times a second while the runner is mid-step
 * made a thirty-seed table take longer than the rest of the suite put
 * together. The bot is not smarter for thinking again before it has moved.
 */
export function runOnce(skill, tuning = TUNING, maxSeconds = 900) {
  const s = SKILLS[skill];
  const heist = new Heist(tuning);
  const dt = 1 / 60;

  // A cap, and it does real work rather than being a safety net: the planning
  // bot is an ORACLE, not a player. It holds a complete solver and the whole
  // map, and the clock is derived from that same solver's answer — so it
  // cannot lose, and it stops only when the cap says so. Its number is not
  // "how hard the game is"; it is an upper bound the reactive bot is measured
  // against.
  for (let i = 0; i < 60 * maxSeconds && heist.running; i++) {
    if (heist.busy <= 0) {
      const action = decide(heist, s);
      if (action?.move) heist.move(action.move[0], action.move[1]);
      else if (action?.switchTo !== undefined) heist.switchTo(action.switchTo);
      // Nothing to do and nothing in progress: the clock is the only thing
      // left, so run it down rather than replanning the same dead end sixty
      // times a second.
      else heist.busy = 0.25;
    }
    heist.step(dt);
  }

  return {
    gems: heist.gems,
    floors: heist.floorsCleared,
    reason: heist.reason,
    alive: heist.running,
    switches: heist.switches,
    steps: heist.steps,
  };
}
