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
// distance travelled and it hands back geometry. Every number it uses is in
// CITY_TUNING so a bot harness can clone it, change one figure and run both
// versions over the same seeds — see swing.js for the same arrangement and
// the same reason.

import { clamp, randInt, randRange } from '../../engine/util.js';

export const CITY_TUNING = {
  // How quickly the city gets hard. `curve` shapes the approach: 1 is a plain
  // hyperbolic ramp, which rises FASTEST at the very start; 2 makes the first
  // stretch nearly flat and moves the work later. Either way the value eases
  // toward 1 and never reaches it, so nothing ever stops getting harder.
  ramp: 26000,
  curve: 2,

  // Buildings narrow as the run goes on.
  widthMin: 150,
  widthMinDrop: 80,
  widthMax: 205,
  widthMaxDrop: 120,

  // The gap between them widens. The main dial.
  gapMin: 85,
  gapMinGrow: 170,
  gapMax: 145,
  gapMaxGrow: 290,

  // How far a roof may step from the one before it.
  roofSpread: 70,
  roofSpreadGrow: 200,
  roofHighest: 120,
  roofLowest: 560,

  // The mast is the anchor, and its height is not decoration: see the
  // geometry contract on ropeMax in swing.js. A swing clears the building it
  // hangs from only while the rope is shorter than the mast, so masts of
  // 40-90 against ropes of ~180 meant four swings in five went through the
  // roof. Tall masts are what make the city swingable at all; the tall-mast
  // bonus is now a smaller multiplier because the base is already high.
  mastMin: 160,
  mastMax: 240,
  mastMaxGrow: 120,
  tallMastChance: 0.22,
  tallMastFactor: 1.3,

  // A ring hangs over the middle of a gap at a height that climbs with the
  // distance, which is what turns "swing high" from advice into the thing the
  // score is made of.
  ringChance: 0.72,
  ringLiftMin: 60,
  ringLiftMinGrow: 90,
  ringLiftMax: 150,
  ringLiftMaxGrow: 220,
  ringRadius: 26,
};

/**
 * How far up the difficulty curve a given distance is, 0 to (never quite) 1.
 *
 * s/(1+s) is the same easing as 1 - 1/(1+s), written the way it reads: a
 * quantity that grows without bound, squashed into a fraction that approaches
 * one. Raising the input to a power before squashing is what lets the opening
 * of a run be flat while the far end keeps climbing.
 */
export function difficultyAt(distance) {
  const c = CITY_TUNING;
  const x = Math.max(0, distance) / c.ramp;
  const s = c.curve === 1 ? x : x ** c.curve;
  return s / (1 + s);
}

/**
 * The next building after `previous`.
 *
 * @param {object|null} previous
 * @param {number} distance  How far the player has travelled, in world units.
 */
export function nextBuilding(previous, distance) {
  const c = CITY_TUNING;
  const t = difficultyAt(distance);

  const width = randRange(c.widthMin - t * c.widthMinDrop, c.widthMax - t * c.widthMaxDrop);
  const gap = randRange(c.gapMin + t * c.gapMinGrow, c.gapMax + t * c.gapMaxGrow);

  // Roofs wander rather than jumping: each is a step from the last one, and
  // the size of the step is what grows. A skyline of independent random
  // heights reads as noise and is impossible to plan a swing across.
  const spread = c.roofSpread + t * c.roofSpreadGrow;
  const previousTop = previous ? previous.top : 420;
  const top = clamp(
    previousTop + randRange(-spread, spread),
    c.roofHighest,   // nothing taller, or the anchors leave the screen
    c.roofLowest,    // nothing shorter, or there is no building left to hit
  );

  const x = previous ? previous.x + previous.w + gap : 0;

  return {
    x,
    w: width,
    top,
    mast: randRange(c.mastMin, c.mastMax + t * c.mastMaxGrow)
      * (Math.random() < c.tallMastChance ? c.tallMastFactor : 1),
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
  const c = CITY_TUNING;
  if (Math.random() > c.ringChance) return null;

  const t = difficultyAt(distance);
  const floor = Math.max(left.top, right.top);
  const lift = randRange(c.ringLiftMin + t * c.ringLiftMinGrow, c.ringLiftMax + t * c.ringLiftMaxGrow);

  return {
    x: (left.x + left.w + right.x) / 2,
    y: clamp(floor - lift, 60, 520),
    r: c.ringRadius,
    taken: false,
    missed: false,
  };
}
