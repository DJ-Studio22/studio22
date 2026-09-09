// tests/bigger-fish.ladder.test.mjs
//
// THE SKILL LADDER: that the bots' levels are three different opponents rather
// than three labels on the same one.
//
// This file used to prove that by playing the game out — twelve seeds of two
// and a half minutes against a careless shoal and again against a ruthless one,
// asserting that the player ended up far bigger against the careless one. That
// assertion has been retired, and the reason is worth the space.
//
// WHY THE PLAYED MEASUREMENT WAS RETIRED
// --------------------------------------
// It is not portable across a V8 version, and no amount of sample is going to
// make it so. Measured on the SAME twelve seeds and the SAME code:
//
//     node 22 (CI)     careless 768   ruthless 488    ratio 1.57
//     node 24 (local)  careless 1613  ruthless 537    ratio 3.00
//
// The pond is chaotic. `Math.hypot` and `**` are not identical to the last bit
// across V8 versions, and a hundred and fifty seconds of pond amplifies a
// one-ulp difference into a completely different run — so the same seeds are
// not the same runs, and a median of twelve of them is not a stable quantity.
// This file had already been bitten by that once, at a floor of 2 measuring
// 2.74 locally and 1.82 on CI. The floor was moved to 1.6 and the sample
// resized, and it went red again at 1.573. Moving it a third time would be
// fitting a threshold to whatever CI last happened to draw, which is convention
// 12 — pinning an accident — with extra steps.
//
// The magnitude is not the portable part. The measurement, taken honestly on
// thirty-six seeds at ninety seconds and reported here rather than asserted:
//
//     seeds  1-12   the player peaked higher against a careless shoal on  9 of 12
//     seeds 13-24                                                         7 of 12
//     seeds 25-36                                                         8 of 12
//
// Twenty-four of thirty-six. So the effect is real and it is in the right
// direction, and it is nothing like as clean as "9.9x" made it sound. What the
// numbers actually show is a difference in SPREAD rather than in level: against
// a careless shoal the player's peak was 5444 where a ruthless one held it to
// 290, and also 13 where a ruthless one allowed 87. A careless shoal is chaos,
// and chaos is not the same thing as easy.
//
// WHAT IS ASSERTED INSTEAD
// ------------------------
// The judgement itself, deterministically, on a pond built to ask one question.
// The levels differ in whether a bot checks the arithmetic before dividing
// itself, so that is what gets checked — in milliseconds, with no chaos in the
// way, and it cannot come out differently on a different V8.
//
// The rest of the ladder is asserted in tests/bigger-fish.pond.test.mjs, on the
// SHOAL's behaviour rather than on the player's score: a careless shoal splits
// more than twice as often as a steady one and kills far more of itself. That
// one has held across three disjoint blocks and is what a player actually sees.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Pond, TUNING, canEat, splitReach } from '../games/bigger-fish/pond.js';
import { withSeed } from './helpers/seeded.mjs';

/**
 * A pond containing one hunter, one pinned meal, and nothing else that matters.
 *
 * The player is parked in a far corner rather than removed: the pond stops
 * running when the player has no cells, so deleting them freezes time and every
 * bot decision with it. That mistake reads as "the bots never split", which
 * looks exactly like a passing test of the wrong thing.
 */
function splitsAt({ skill, hunterMass, mealMass, gap, seconds = 20, seed = 1 }) {
  let splits = 0;
  withSeed(seed, () => {
    const pond = new Pond({ ...TUNING, pellets: 0, botCount: 2, spikes: 0 }, { skill });
    pond.spikes = [];
    const mid = TUNING.width / 2;
    const player = pond.cells.find((c) => c.owner === 'player');
    const hunter = pond.cells.find((c) => c.owner === 'bot0');
    const meal = pond.cells.find((c) => c.owner === 'bot1');
    hunter.mass = hunterMass;
    hunter.x = mid;
    hunter.y = mid;

    for (let i = 0; i < 60 * seconds; i++) {
      // Both held still, so this measures the DECISION rather than a chase.
      player.x = 200;
      player.y = 200;
      meal.x = mid + gap;
      meal.y = mid;
      meal.mass = mealMass;
      meal.vx = 0;
      meal.vy = 0;
      pond.step(1 / 60, {});
    }
    splits = pond.botSplits;
  });
  return splits;
}

test('THE LADDER IS A DIFFERENT DECISION, not a different set of numbers', () => {
  // A meal that is edible whole but is more than half of you. Split at it and
  // each half is too small to eat the thing it lands on, so the launch throws
  // away half your mass and buys nothing.
  //
  // 600 against 280: 600 eats 280 comfortably at an eat ratio of 1.25, and 300
  // cannot eat it at all. Chosen well clear of the threshold in both directions
  // so this is a decision rather than a rounding.
  const hunterMass = 600;
  const mealMass = 280;
  assert.ok(canEat(hunterMass, mealMass, TUNING), 'the meal is not edible whole');
  assert.ok(!canEat(hunterMass / 2, mealMass, TUNING), 'a half could still eat it');

  const close = { hunterMass, mealMass, gap: 250 };
  assert.ok(close.gap < splitReach(hunterMass, TUNING), 'the launch does not reach');

  // Six seeds, because the rethink clock is offset randomly per bot and a
  // single run could catch one that had not thought yet. Summed, not medianed.
  const total = (skill) => [1, 2, 3, 4, 5, 6]
    .reduce((sum, seed) => sum + splitsAt({ skill, ...close, seed }), 0);

  const careless = total('careless');
  const ruthless = total('ruthless');

  assert.ok(careless > 0,
    'a careless bot declined a split it has no way of knowing is bad');
  assert.equal(ruthless, 0,
    `a ruthless bot split ${ruthless} times at something its halves cannot eat`);
});

test('and the difference is the arithmetic, not the appetite', () => {
  // The other half of the same judgement: a meal placed beyond the launch. A
  // careless bot splits at anything roughly in front of it; the checked levels
  // swim there first and split when it is actually in range.
  //
  // Neither declines the MEAL — appetite is not what separates them, and a
  // level that ate less would be a worse opponent rather than a better one.
  const spec = { hunterMass: 600, mealMass: 60, gap: 400 };
  assert.ok(spec.gap > splitReach(spec.hunterMass, TUNING), 'the meal is within reach');

  const total = (skill) => [1, 2, 3, 4, 5, 6]
    .reduce((sum, seed) => sum + splitsAt({ skill, ...spec, seed }), 0);

  const careless = total('careless');
  const ruthless = total('ruthless');

  assert.ok(careless > ruthless,
    `a careless shoal split ${careless} times at a meal out past its launch `
    + `and a ruthless one ${ruthless}: the levels are not deciding differently`);
  assert.ok(ruthless > 0,
    'the ruthless level stopped splitting altogether, which is caution, not skill');
});

// --- The claims that are not asserted, and why ----------------------------

// CAUTION BEATS GREED, and SPLITTING PAYS ON THE SCORE, both died against
// measurements in earlier phases and are written up in
// tests/bigger-fish.pond.test.mjs. THE PLAYER FEELS THE LADDER dies here, for a
// different reason: it is true, it is just not a thing this project can assert
// portably. All three are recorded rather than retuned, which is the rule.
