// tests/bigger-fish.ladder.test.mjs
//
// THE SKILL LADDER, on its own, because it is the most expensive assertion in
// the project and a test FILE is the unit the runner parallelises.
//
// Everything else about the pond is in tests/bigger-fish.pond.test.mjs. This
// file holds the one claim that has to play the game out at length: that the
// bots' skill levels are a ladder a player can feel, rather than three labels
// on the same opponent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOnce } from './helpers/fish-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

test('and the ladder is real — the same player does far worse against better bots', () => {
  // Measured, not asserted. Twelve seeds of two and a half minutes each; the player
  // policy is identical throughout, so the difference is entirely in how well
  // the pond plays against it. A careless shoal splits at anything in front of
  // it and feeds the player its halves, which is exactly the mistake it is
  // meant to make.
  //
  // THE THRESHOLD HAS TO CLEAR THE NOISE BY A LONG WAY, and the reason is worth
  // writing down: this simulation is chaotic, and the last bits of Math.hypot
  // and ** are not identical across V8 versions. Four minutes of pond amplifies
  // a one-ulp difference into a completely different run, so the same seeds
  // give different numbers on node 22 and node 24. An earlier version of this
  // asserted a ratio of 2 on ten seeds; it measured 2.74 locally and 1.82 on
  // CI, and went red.
  //
  // TWELVE SEEDS AT 150 SECONDS, AND THE SAMPLE WAS CUT ON EVIDENCE RATHER THAN
  // ON CONVENIENCE. It was twenty seeds at 240, sized when the effect was 3.3x
  // in the small pond; in the ten-times pond the same comparison is about 10x,
  // and the run cost had grown to 554 seconds -- eighty per cent of this game's
  // entire test time for one assertion.
  //
  // So the cheaper settings were measured across three DISJOINT blocks first,
  // and the floor of 1.6 has to clear the worst of them:
  //
  //     12 seeds @ 120s    4.68   2.77   1.94     <- rejected
  //     12 seeds @ 150s    3.58   3.81   2.63     <- taken
  //
  // 120 seconds is the interesting one: every block still passes, and the worst
  // is only 21% above the floor. This file has already been bitten once by the
  // node 22 / node 24 divergence -- a ratio that measured 2.74 locally came out
  // 1.82 on CI -- and 21% is inside that. At 150 the worst block is 64% clear,
  // which is the margin that history says is needed.
  const against = (skill) => {
    const peaks = [];
    for (let seed = 1; seed <= 12; seed++) {
      withSeed(seed, () => peaks.push(runOnce('selective', undefined, { seconds: 150, skill }).peak));
    }
    return summarise(peaks).median;
  };
  const careless = against('careless');
  const ruthless = against('ruthless');
  assert.ok(careless > ruthless * 1.6,
    `a careless shoal is barely easier than a ruthless one: ${careless} against ${ruthless}`);
});

// --- The claims -----------------------------------------------------------

// SPLITTING CATCHES WHAT WOULD OTHERWISE OUTRUN YOU -- ALSO NOT ASSERTED.
//
// This one held under the old rules and does not hold under the new ones, for
// the same reason the headline below does not: the rubber band was doing the
// work. When arrivals were sized against the leader, the pond was full of
// things too fast to swim down, and dividing yourself was the only way to reach
// one. Everything now enters at startMass, so most of what is worth eating is
// slower than you are and you can simply go and get it.
//
// Re-measured the same way as before -- mean cells eaten, selective against a
// policy identical but for never splitting, three disjoint blocks of 24 seeds
// at a 300-second cap:
//
//     seeds  1-24    selective 12.0    noSplit 17.3    ratio 0.69
//     seeds 25-48    selective 19.4    noSplit 18.3    ratio 1.06
//     seeds 49-72    selective 21.1    noSplit 15.1    ratio 1.40
//
// It flips, and the first block flips hard the wrong way. The old floor of
// 1.15 passes on one block of three.
//
// What is still true is the MECHANIC rather than the strategy: a split covers
// ground no amount of swimming covers at that size, which is asserted outright
// in 'splitReach is where the launch actually gets you' above and is a fact
// about the arithmetic rather than a hope about a sample. Splitting is a reach
// tool with a real price -- twenty seconds of held contact to undo -- and
// whether reaching is worth the price is the player's judgement, not a result
// this file can claim on their behalf.
