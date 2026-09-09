// tests/updraft.climb.test.mjs
//
// Updraft's column must always be climbable.
//
// The fault this file exists for: a run ended in three crack platforms in a
// row. A crack platform gave no bounce at all, so a stretch of them was a hole
// with pictures of platforms in it, and the death was not the player's.
//
// Two properties, and they are different questions:
//
//   1. Every platform the generator makes can be landed on. A one-touch
//      platform counts -- it gives you your chance. A broken one does not.
//   2. From every platform you can stand on, another one you can stand on is
//      within a bounce. This is arithmetic against the jump arc, and it is the
//      one that guards the gap widening, which grows with the score and which
//      nothing else in the game compares to the jump.
//
// Both are checked over thousands of generated columns rather than a handful,
// because the fault was a run of three rolls out of a distribution and a spot
// check would have walked straight past it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIMB_TUNING,
  difficultyAt,
  extendColumn,
  firstDeadEnd,
  gapCeiling,
  horizontalReach,
  isLandable,
  jumpRise,
  makePlatform,
  reach,
  repair,
  springRise,
  startingPlatforms,
} from '../games/updraft/climb.js';

/**
 * A seeded generator, so a failure is a bug report rather than a rumour.
 *
 * mulberry32: small, fast, and good enough for "did this shape of column ever
 * come out". Nothing here is cryptography.
 */
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole run's worth of column: start, then top up repeatedly as it scrolls. */
function playedColumn(seed, { topUps = 60, tuning = CLIMB_TUNING } = {}) {
  const rng = rngFrom(seed);
  const plats = startingPlatforms(tuning, rng);
  // Scores across the whole curve, so the widening gap and the widening crack
  // band are both exercised rather than only their opening values.
  for (let i = 0; i < topUps; i++) {
    const score = Math.round((i / topUps) * 3200);
    // The camera has moved on: drop what has scrolled off the bottom, exactly
    // as the game does, so the check sees the array the game actually holds.
    const lift = 120;
    for (const p of plats) p.y += lift;
    let live = plats.filter((p) => p.y < tuning.height + 40);
    plats.length = 0;
    plats.push(...live);
    extendColumn(plats, { score, tuning, rng });
  }
  return plats;
}

// --- The physics the proof rests on --------------------------------------

test('the reach is derived from the jump, not written down', () => {
  // If someone retunes the jump, the reachability rule has to follow it. This
  // asserts the relationship rather than the number: doubling the jump speed
  // quadruples the rise, because rise is v squared over 2g.
  const faster = { ...CLIMB_TUNING, jumpPerFrame: CLIMB_TUNING.jumpPerFrame * 2 };
  assert.ok(Math.abs(jumpRise(faster) / jumpRise() - 4) < 1e-9,
    'rise did not follow the jump; the proof is measuring a constant');
  assert.equal(reach(faster) > reach(), true);
});

test('the proof uses the ordinary bounce, never the spring', () => {
  // A spring lifts roughly two and a half times as far. Building the column so
  // it is needed would make every stretch without one impossible, and a spring
  // is not guaranteed to be anywhere.
  assert.ok(springRise() > jumpRise() * 2);
  assert.ok(reach() < jumpRise(), 'the reach must leave height in hand');
});

test('the widest gap the game generates fits inside the reach', () => {
  // The one number in this game that grows towards the jump arc. At maximum
  // score the gap is 122 against a 154 reach; nothing else compares them.
  const widest = gapCeiling(1e9);
  assert.ok(widest < reach(),
    `widest gap ${widest.toFixed(1)} exceeds the reach ${reach().toFixed(1)}`);
});

test('sideways is never the binding constraint', () => {
  // Stated because the rule deliberately ignores horizontal distance. One
  // bounce carries the bird the full width of the screen, and it wraps around
  // the edges besides. If the arc were ever shortened enough for that to stop
  // being true, this says so.
  assert.ok(horizontalReach() >= CLIMB_TUNING.width * 0.95,
    'a bounce no longer crosses the screen; the rule now needs an x term');
});

// --- Property 1: everything generated can be landed on --------------------

test('no platform is ever generated already broken', () => {
  // The distinction the whole fix turns on. A one-touch platform is fair
  // because it gives you a chance; a broken one is a hole.
  const rng = rngFrom(99);
  for (let i = 0; i < 20000; i++) {
    const p = makePlatform(-i, (i % 100) / 100, CLIMB_TUNING, rng);
    assert.equal(isLandable(p), true, `platform ${i} of type ${p.type} cannot be landed on`);
  }
});

test('crack platforms are still common, so this is not a fix by deletion', () => {
  // The easy way to make the column solvable is to stop generating the
  // dangerous thing. That would be a different, blander game, so the mix is
  // pinned: crack platforms are a real share of the column at every difficulty.
  const rng = rngFrom(7);
  for (const difficulty of [0, 0.5, 1]) {
    let cracks = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (makePlatform(-i, difficulty, CLIMB_TUNING, rng).type === 'crack') cracks++;
    }
    const share = cracks / n;
    assert.ok(share > 0.06 && share < 0.20,
      `crack share at difficulty ${difficulty} is ${(share * 100).toFixed(1)}%`);
  }
});

// --- Property 2: the column is climbable ----------------------------------

test('two thousand played columns, and not one dead end', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const plats = playedColumn(seed, { topUps: 12 });
    const bad = firstDeadEnd(plats);
    assert.equal(bad, null, bad
      ? `seed ${seed}: platform at y=${bad.from.y.toFixed(0)} has nothing landable `
        + `within ${bad.limit.toFixed(0)}; the next is ${bad.rise.toFixed(0)} above`
      : '');
  }
});

test('a full run-length column at maximum difficulty is climbable', () => {
  // The short columns above are the common case. This is the long one, at the
  // top of the difficulty curve where the gap is widest and the crack band is
  // widest, which is exactly where the reported death happened.
  for (let seed = 1; seed <= 200; seed++) {
    const rng = rngFrom(seed * 31);
    const plats = startingPlatforms(CLIMB_TUNING, rng);
    for (let i = 0; i < 200; i++) {
      for (const p of plats) p.y += 120;
      const live = plats.filter((p) => p.y < CLIMB_TUNING.height + 40);
      plats.length = 0;
      plats.push(...live);
      extendColumn(plats, { score: 4000, rng });
    }
    assert.equal(firstDeadEnd(plats), null, `seed ${seed} produced a dead end at full difficulty`);
  }
});

// --- The check is not vacuous ---------------------------------------------
//
// A guard that cannot fail proves nothing. These build the two faults by hand
// and require the check to find each of them, so a later change that quietly
// broke firstDeadEnd would go red here rather than going unnoticed.

test('the check catches a stretch of unlandable platforms', () => {
  const plats = [
    { y: 600, broke: false, type: 'normal' },
    { y: 520, broke: true, type: 'crack' },
    { y: 440, broke: true, type: 'crack' },
    { y: 360, broke: true, type: 'crack' },
    { y: 280, broke: false, type: 'normal' },
  ];
  const bad = firstDeadEnd(plats);
  assert.notEqual(bad, null, 'three broken platforms in a row went unnoticed');
  assert.equal(bad.from.y, 600);
});

test('the check catches a gap wider than the jump', () => {
  const plats = [
    { y: 600, broke: false, type: 'normal' },
    { y: 600 - reach() - 1, broke: false, type: 'normal' },
  ];
  assert.notEqual(firstDeadEnd(plats), null, 'a gap past the reach went unnoticed');
});

test('the check does not cry wolf on the top of the column', () => {
  // The highest platform has nothing above it because the column is endless
  // and not yet drawn, which is not a dead end.
  const plats = [{ y: 600, broke: false, type: 'normal' }];
  assert.equal(firstDeadEnd(plats), null);
});

// --- The repair ------------------------------------------------------------

test('the repair fixes both faults and leaves a climbable column', () => {
  const unlandable = [
    { y: 600, w: 80, broke: false, type: 'normal' },
    { y: 520, w: 80, broke: true, type: 'crack' },
    { y: 440, w: 80, broke: true, type: 'crack' },
    { y: 360, w: 80, broke: true, type: 'crack' },
    { y: 280, w: 80, broke: false, type: 'normal' },
  ];
  assert.ok(repair(unlandable, CLIMB_TUNING, rngFrom(1)) > 0);
  assert.equal(firstDeadEnd(unlandable), null);

  const tooFar = [
    { y: 600, w: 80, broke: false, type: 'normal' },
    { y: 100, w: 80, broke: false, type: 'normal' },
  ];
  const inserted = repair(tooFar, CLIMB_TUNING, rngFrom(1));
  assert.ok(inserted > 0, 'nothing was inserted into a 500-unit gap');
  assert.equal(firstDeadEnd(tooFar), null);
});

test('the repair almost never has to fire on a real column', () => {
  // Convention 12: an assertion can pin an accident. This one is here to say
  // what the guard is actually doing, and the honest answer is "watching".
  //
  // With crack platforms bouncing once, every platform the generator makes is
  // landable and every gap it rolls fits the arc, so a correct generator gives
  // the repair nothing to do. If this ever starts firing, the generator has
  // drifted and the number is the size of the drift -- which is a far more
  // useful signal than a silent repair quietly holding a broken game together.
  const rng = rngFrom(4242);
  let repairs = 0;
  for (let seed = 0; seed < 400; seed++) {
    const plats = startingPlatforms(CLIMB_TUNING, rng);
    for (let i = 0; i < 10; i++) repairs += extendColumn(plats, { score: seed * 8, rng });
  }
  assert.equal(repairs, 0,
    `the repair fired ${repairs} times; the generator is producing dead ends`);
});

// --- What the fix actually was --------------------------------------------

test('a broken column is only unclimbable because broken platforms do not bounce', () => {
  // The same five platforms, twice. Unbroken, they are an ordinary stretch;
  // broken, they are a hole. Nothing about the SPACING changed -- which is the
  // whole point, and why no amount of gap tuning would have fixed the report.
  const spacing = [600, 520, 440, 360, 280];
  const fine = spacing.map((y) => ({ y, broke: false, type: 'crack' }));
  const hole = spacing.map((y, i) => ({ y, broke: i > 0 && i < 4, type: 'crack' }));

  assert.equal(firstDeadEnd(fine), null);
  assert.notEqual(firstDeadEnd(hole), null);
});

// --- Difficulty still moves -----------------------------------------------

test('difficulty is a curve, not a step', () => {
  assert.equal(difficultyAt(0), 0);
  assert.equal(difficultyAt(1300), 0.5);
  assert.equal(difficultyAt(2600), 1);
  assert.equal(difficultyAt(1e9), 1, 'difficulty must be capped');
  assert.ok(makePlatform(0, 1, CLIMB_TUNING, rngFrom(3)).w
    < makePlatform(0, 0, CLIMB_TUNING, rngFrom(3)).w,
  'platforms should narrow as difficulty rises');
});
