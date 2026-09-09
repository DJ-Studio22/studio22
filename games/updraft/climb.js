// games/updraft/climb.js
//
// Updraft's column of platforms, and the proof that it can be climbed.
//
// WHY THIS FILE EXISTS
// --------------------
// A run ended in a stretch the player could not have got out of. Three `crack`
// platforms in a row, and a crack platform gave NO bounce at all -- touching
// one broke it and let the bird fall straight through. So a run of them was not
// a hard section, it was a hole several platforms deep with pictures of
// platforms in it, and nothing the player did caused the death.
//
// Two separate things came out of that, and it is worth keeping them apart
// because only one of them is the fix:
//
//   THE FIX is that a crack platform now bounces you once and then breaks. It
//   is a ONE-TOUCH platform, which is what it looks like and what everybody
//   assumed it already was. You land, you bounce, you move on.
//
//   THE GUARD is this module. The generation is out of game.js and into a
//   DOM-free file a test can play thousands of times, the reachability rule is
//   arithmetic derived from the jump rather than a number somebody liked, and
//   nothing leaves the generator without being checked and repaired.
//
// The guard would not have caught the original bug on its own, and saying so
// is the point: a check is only as good as the property it is asked about, and
// "is every platform landable" had never been asked. It is asked now, on every
// column, and it is asked of the gaps too -- which matters, because the gap
// grows with the score and nothing else in the game compares it to the jump.
//
// WHAT "LANDABLE" MEANS, WHICH IS THE WHOLE DISTINCTION
// -----------------------------------------------------
// A one-touch platform is fair: it gives you your chance and then it is gone.
// An already-broken platform is not: there is nothing there to land on. So
// `broke` is the test, and it is the only test -- a type that stopped
// launching the player would have to say so by being broken.

/** The original prototype's frame rate, and the 12.5% speed-up applied to it. */
const TICKS_PER_SECOND = 60;
const SNAP = 1.125;

/**
 * Everything the column is made of. A plain exported object, so a test can
 * clone it, change one figure, and run both versions side by side.
 */
export const CLIMB_TUNING = {
  width: 420,
  height: 640,

  // The per-frame physics from the prototype, kept in that form because that is
  // how they were tuned. Converted below: a velocity by the tick rate, an
  // acceleration by its square.
  gravityPerFrame: 0.118 * SNAP * SNAP,
  jumpPerFrame: -7.10 * SNAP,
  springPerFrame: -10.90 * SNAP,
  maxHorizontalPerFrame: 3.9,

  // Vertical spacing between consecutive platforms.
  gapMin: 62,
  gapMax: 96,
  // ...which then widens as the score climbs, to a ceiling. This is the number
  // the reachability check earns its keep on: it is the only thing in the game
  // that grows towards the jump arc, and before this module nothing compared
  // the two.
  gapGrowthPerPoint: 1 / 60,
  gapGrowthMax: 26,

  platformHeight: 13,
  widthMax: 86,
  widthMin: 52,
  edgeMargin: 6,
  firstPlatformWidth: 110,

  // Score at which difficulty is at maximum.
  difficultyScore: 2600,

  // The type mix, unchanged from the prototype: `move` takes the bottom of the
  // roll and `crack` the band above it, both widening with difficulty.
  moveChanceBase: 0.10,
  moveChancePerDifficulty: 0.14,
  crackChanceBase: 0.08,
  crackChancePerDifficulty: 0.06,
  driftMin: 0.45,
  driftMax: 0.95,
  springChance: 0.09,

  // HOW MUCH OF THE JUMP THE PROOF IS ALLOWED TO SPEND.
  //
  // A bounce rises 214 units to the apex, and arriving at the apex with no
  // velocity left, exactly on a platform's top edge, is not a landing anybody
  // can make. Requiring the next landable platform inside this share of the arc
  // means there is real height in hand when the player gets there. The widest
  // gap the game actually generates is 122, which is 57% of the arc, so this is
  // a ceiling with room under it rather than a constraint being fought.
  reachSafety: 0.72,
};

const merge = (tuning) => (tuning === CLIMB_TUNING ? tuning : { ...CLIMB_TUNING, ...tuning });

const gravity = (t) => t.gravityPerFrame * TICKS_PER_SECOND * TICKS_PER_SECOND;
const jumpSpeed = (t) => -t.jumpPerFrame * TICKS_PER_SECOND;
const springSpeed = (t) => -t.springPerFrame * TICKS_PER_SECOND;

/**
 * How far a bounce actually lifts the bird, in units.
 *
 * DERIVED, never written down. If the jump or gravity is retuned, the
 * reachability rule follows it. Restating 214 here would leave the guard
 * describing a jump the game no longer has -- which is the exact shape of the
 * failure this file exists to prevent, so it would be a poor place to make it.
 */
export function jumpRise(tuning = CLIMB_TUNING) {
  const t = merge(tuning);
  const v = jumpSpeed(t);
  return (v * v) / (2 * gravity(t));
}

/** The same for a spring, which is not what the proof uses -- see reach(). */
export function springRise(tuning = CLIMB_TUNING) {
  const t = merge(tuning);
  const v = springSpeed(t);
  return (v * v) / (2 * gravity(t));
}

/**
 * The greatest height the column is allowed to ask the player to cross.
 *
 * Off the ORDINARY bounce, not the spring: a spring is a gift and roughly two
 * and a half times the lift, and building the column so it is needed would make
 * every stretch without one impossible. The guarantee has to hold for the jump
 * the player always has.
 */
export function reach(tuning = CLIMB_TUNING) {
  const t = merge(tuning);
  return jumpRise(t) * t.reachSafety;
}

/**
 * How far the bird can travel sideways during one bounce, edge to edge.
 *
 * Reported for completeness and checked by a test, but it is not part of the
 * reachability rule: it works out at roughly the full width of the screen, and
 * the bird wraps around the edges anyway, so no platform is ever out of reach
 * horizontally. If the arc were ever shortened enough for that to stop being
 * true, the test says so rather than the player finding out.
 */
export function horizontalReach(tuning = CLIMB_TUNING) {
  const t = merge(tuning);
  const airtime = (2 * jumpSpeed(t)) / gravity(t);
  return t.maxHorizontalPerFrame * TICKS_PER_SECOND * airtime;
}

/** Difficulty, 0 to 1, from the score. */
export function difficultyAt(score, tuning = CLIMB_TUNING) {
  const t = merge(tuning);
  return Math.min(Math.max(score, 0) / t.difficultyScore, 1);
}

/** The widest gap the generator will roll at this score. */
export function gapCeiling(score, tuning = CLIMB_TUNING) {
  const t = merge(tuning);
  return t.gapMax + Math.min(Math.max(score, 0) * t.gapGrowthPerPoint, t.gapGrowthMax);
}

/**
 * Can this platform be bounced off?
 *
 * A one-touch platform counts -- one touch is a chance, and a chance is all the
 * player is owed. A broken one does not.
 */
export function isLandable(platform) {
  return !platform.broke;
}

/** Does touching this platform destroy it? True of `crack` and nothing else. */
export function isOneTouch(platform) {
  return platform.type === 'crack';
}

/** One platform at height `y`. `rng` is injected so a failure can be replayed. */
export function makePlatform(y, difficulty, tuning = CLIMB_TUNING, rng = Math.random) {
  const t = merge(tuning);
  const d = Math.min(Math.max(difficulty, 0), 1);
  const w = Math.max(t.widthMin, t.widthMax - d * (t.widthMax - t.widthMin));

  const moveBand = t.moveChanceBase + d * t.moveChancePerDifficulty;
  const crackBand = moveBand + t.crackChanceBase + d * t.crackChancePerDifficulty;

  let type = 'normal';
  const r = rng();
  if (r < moveBand) type = 'move';
  else if (r < crackBand) type = 'crack';

  const platform = {
    x: t.edgeMargin + rng() * (t.width - w - t.edgeMargin * 2),
    y,
    w,
    h: t.platformHeight,
    type,
    vx: 0,
    spring: false,
    broke: false,
  };
  if (type === 'move') {
    const speed = t.driftMin + rng() * (t.driftMax - t.driftMin);
    platform.vx = speed * TICKS_PER_SECOND * (rng() < 0.5 ? -1 : 1);
  }
  // A crack never also springs. It gets exactly one launch and which launch
  // that is should not be a surprise.
  if (type !== 'crack' && rng() < t.springChance) platform.spring = true;
  return platform;
}

/**
 * The first place the column stops being climbable, or null if it never does.
 *
 * From every landable platform, ask the only question that matters: is there
 * another landable one within a bounce? Anything higher than that is not this
 * platform's problem, because the player cannot get there without landing
 * somewhere first, and that landing gets asked the same question in its turn.
 *
 * Unlandable platforms are not asked -- you cannot stand on one, so what is
 * above it is irrelevant. That is exactly why a stretch of them is fatal: the
 * last real platform below them has to clear the whole run in one bounce.
 *
 * Returns WHERE rather than merely THAT, so a failing test can point at it.
 *
 * `above` is the player's height, and platforms below it are not asked the
 * question. The bird only ever climbs, so what is under it is settled history —
 * and it is history containing the crack platforms the player has already
 * bounced off and broken. Without this, a broken platform two below would look
 * like a dead end and the repair would put it back, so a platform the player
 * had visibly smashed would silently reassemble under their feet.
 */
export function firstDeadEnd(platforms, tuning = CLIMB_TUNING, { above = Infinity } = {}) {
  const t = merge(tuning);
  const limit = reach(t);
  // Larger y is lower on screen, so climbing means y decreasing.
  const sorted = [...platforms].sort((a, b) => b.y - a.y);

  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    if (from.y > above) continue;
    if (!isLandable(from)) continue;

    let nextAbove = null;
    let reachable = null;
    for (let j = i + 1; j < sorted.length; j++) {
      const to = sorted[j];
      const rise = from.y - to.y;
      if (rise <= 0) continue;              // level with it, not above it
      if (!nextAbove) nextAbove = to;
      if (rise > limit) break;              // sorted, so nothing later is nearer
      if (isLandable(to)) { reachable = to; break; }
    }

    // Nothing above at all is the top of what has been generated so far, not a
    // dead end. The column is endless; it is simply not drawn yet.
    if (nextAbove && !reachable) {
      return { from, nextAbove, rise: from.y - nextAbove.y, limit };
    }
  }
  return null;
}

/**
 * Makes a column climbable in place, and returns how many platforms it changed.
 *
 * REPAIR RATHER THAN REJECT. Rejecting means re-rolling the dice until they
 * agree, which is unbounded work for a guarantee that can be met directly, and
 * it throws away a whole column over one platform. Two faults, two repairs:
 *
 *   - the nearest platform above cannot be landed on -> it becomes one
 *   - it can, but it is too far -> a platform is inserted inside the reach
 *
 * The count is the interesting number for a test: it is how often the dice
 * produce a dead end, which is the size of the fault being guarded against.
 */
export function repair(platforms, tuning = CLIMB_TUNING, rng = Math.random, { above = Infinity } = {}) {
  const t = merge(tuning);
  const limit = reach(t);
  let fixed = 0;

  // One pass per fault, because a repair can expose the next problem above it.
  // Bounded: every iteration either fixes something or returns.
  for (let guard = 0; guard < platforms.length + 8; guard++) {
    const bad = firstDeadEnd(platforms, t, { above });
    if (!bad) return fixed;
    fixed++;

    if (!isLandable(bad.nextAbove)) {
      // Nearest rather than any: repairing a further one would leave the near
      // gap unlanded and could widen the very stretch being fixed.
      bad.nextAbove.broke = false;
      if (bad.nextAbove.type === 'crack') bad.nextAbove.type = 'normal';
      continue;
    }

    // Landable but too far. Put one in, two thirds of the way up, so neither
    // the gap below it nor the gap above it becomes the tight one.
    const inserted = makePlatform(bad.from.y - limit * 0.66, 0, t, rng);
    inserted.type = 'normal';
    inserted.vx = 0;
    inserted.spring = false;
    platforms.push(inserted);
  }
  return fixed;
}

/**
 * The column a run starts with: one wide, plain platform under the bird, then
 * ordinary generation up past the top of the screen.
 *
 * The first platform is deliberately not rolled. A run has to begin on
 * something that certainly holds -- see the standing-start rule in
 * tests/README.md, which this game would otherwise be the third instance of.
 */
export function startingPlatforms(tuning = CLIMB_TUNING, rng = Math.random) {
  const t = merge(tuning);
  const firstY = t.height - 90;
  const plats = [{
    x: t.width / 2 - t.firstPlatformWidth / 2,
    y: firstY,
    w: t.firstPlatformWidth,
    h: t.platformHeight,
    type: 'normal',
    vx: 0,
    spring: false,
    broke: false,
  }];

  let y = firstY;
  while (y > -400) {
    y -= t.gapMin + rng() * (t.gapMax - t.gapMin);
    plats.push(makePlatform(y, 0, t, rng));
  }
  repair(plats, t, rng);
  return plats;
}

/**
 * Tops the column up above `untilY` and guarantees the result is climbable.
 *
 * Called every tick with the live array. The repair looks at the whole column
 * rather than only the new platforms, because a dead end is a relationship
 * between two of them and the pair can straddle the join.
 */
export function extendColumn(platforms, {
  score = 0,
  tuning = CLIMB_TUNING,
  rng = Math.random,
  untilY = -160,
  playerY = Infinity,
} = {}) {
  const t = merge(tuning);
  const difficulty = difficultyAt(score, t);
  const ceiling = gapCeiling(score, t);

  let top = t.height;
  for (const p of platforms) if (p.y < top) top = p.y;
  while (top > untilY) {
    top -= t.gapMin + rng() * (ceiling - t.gapMin);
    platforms.push(makePlatform(top, difficulty, t, rng));
  }
  return repair(platforms, t, rng, { above: playerY });
}
