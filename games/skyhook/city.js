// games/skyhook/city.js
//
// The skyline, and the things worth swinging at.
//
// The city is generated one building at a time, always just ahead of the
// player, and thrown away once it is well behind. Nothing is ever laid out in
// advance, so a run has no length limit and no level table — the difficulty
// lives entirely in how the numbers below drift as the distance grows.
//
// WHAT ESCALATES, AND WHY EACH ONE
// --------------------------------
//   gap        The distance you have to cross with nothing under you. This is
//              the main dial: a wider gap needs more speed, and speed only
//              comes from swinging well.
//   width      Buildings get narrower. A narrow roof is a smaller margin for
//              error on the way past, and it puts the anchors further apart.
//   height     Roofs climb and vary more, so the swing arc has to be planned
//              rather than repeated.
//   mast       The anchor is the tip of a mast above the roof. Taller masts
//              give a longer rope and a wider, faster arc — they are the
//              reward for being high enough to reach them.
//
// Every one of those is a smooth function of distance with no ceiling, so the
// city keeps getting harder for as long as anyone can keep up with it.
//
// This file has no canvas and no input in it. It is a generator: give it the
// distance travelled and it hands back geometry.

import { clamp, randInt, randRange } from '../../engine/util.js';

// The distance over which the city goes from its easiest to roughly its
// hardest. Past this the curves keep moving, just more slowly.
const RAMP = 26000;

// A ring is worth taking, so it must be reachable — but only just. It hangs
// over the middle of a gap at a height that climbs with the distance, which is
// what turns "swing high" from advice into the thing the score is made of.
const RING_CHANCE = 0.72;

export function difficultyAt(distance) {
  // Eases toward 1 and never reaches it, so nothing ever stops getting harder.
  return 1 - 1 / (1 + distance / RAMP);
}

/**
 * The next building after `previous`.
 *
 * @param {object|null} previous
 * @param {number} distance  How far the player has travelled, in world units.
 */
export function nextBuilding(previous, distance) {
  const t = difficultyAt(distance);

  const width = randRange(150 - t * 80, 205 - t * 120);
  const gap = randRange(85 + t * 170, 145 + t * 290);

  // Roofs wander rather than jumping: each is a step from the last one, and
  // the size of the step is what grows. A skyline of independent random
  // heights reads as noise and is impossible to plan a swing across.
  const spread = 70 + t * 200;
  const previousTop = previous ? previous.top : 420;
  const top = clamp(
    previousTop + randRange(-spread, spread),
    120,          // nothing taller than this, or the anchors leave the screen
    560,          // nothing shorter, or there is no building left to hit
  );

  const x = previous ? previous.x + previous.w + gap : 0;

  return {
    x,
    w: width,
    top,
    // The mast is the anchor. Taller ones are rarer and are the fast line.
    mast: randRange(40, 90 + t * 110) * (Math.random() < 0.22 ? 1.7 : 1),
    // Cosmetic, but fixed per building so the windows do not shimmer as the
    // camera moves.
    seed: randInt(0, 99999),
    lit: Math.random() < 0.7,
  };
}

// Where the grapple actually attaches: the tip of the mast.
export function anchorOf(building) {
  return { x: building.x + building.w * 0.5, y: building.top - building.mast };
}

/**
 * A ring over the gap between two buildings, or null if this gap has none.
 *
 * Height is measured from the LOWER of the two roofs, so a ring is always
 * something you have to swing up to rather than something you fall through.
 */
export function ringBetween(left, right, distance) {
  if (Math.random() > RING_CHANCE) return null;

  const t = difficultyAt(distance);
  const floor = Math.max(left.top, right.top);
  const lift = randRange(60 + t * 90, 150 + t * 220);

  return {
    x: (left.x + left.w + right.x) / 2,
    y: clamp(floor - lift, 60, 520),
    r: 26,
    taken: false,
    missed: false,
  };
}
