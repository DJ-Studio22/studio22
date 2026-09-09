// tests/sinkhole.bot.test.mjs
//
// Sinkhole, played by bots. This file exists because the same fault -- spikes
// leaving the top of the screen -- was reported three times and fixed twice,
// and nothing here could ever have caught it: the player, the ceiling and the
// camera all lived inside game.js next to a canvas, so there was no simulation
// a test could drive. games/sinkhole/shaft.js now holds the whole descent, and
// game.js draws it and owns no physics.
//
// The measurement that mattered, and it corrected a claim made without one.
// Moving the ceiling into the view was described as "a real difficulty
// increase" on the reasoning that the effective lead falls from 820 units to
// 280. Measured over three disjoint blocks of thirty seeds at 180 seconds:
//
//   competent, before the clamp   137m  123m  110m
//   competent, after              137m  121m  110m
//   good, before                  203m  139m  140m
//   good, after                   184m  127m  140m
//
// So it costs a competent player essentially nothing and a good one about
// seven per cent. The 820-unit lead was almost never the binding constraint --
// what kills you is being stopped, and from either distance the ceiling
// arrives while you are stopped. The guess was wrong and the harness is why
// anybody knows.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SKILLS, runOnce } from './helpers/sinkhole-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

test('THE SPIKES NEVER LEAVE THE VIEW IN A REAL RUN', () => {
  // The isolated check in sinkhole.shaft.test.mjs drives chaseCeiling directly
  // with a hand-made camera. This one plays the actual game, with landings,
  // respawns and a camera that eases -- because the fault was never in the
  // formula, it was in nothing ever connecting the formula to the view.
  let worst = -Infinity;
  for (let seed = 1; seed <= 20; seed++) {
    withSeed(seed, () => {
      const run = runOnce('good', { seconds: 120 });
      worst = Math.max(worst, run.worstSpikesAbove);
    });
  }
  assert.ok(worst <= 0,
    `across twenty played runs the spikes reached ${worst}px above the top of the view`);
});

test('and the old model is what it was measured to be', () => {
  // The counterfactual, kept so the number in the header above is reproducible
  // rather than a remembered figure. clampCeiling: false is the model as it
  // shipped, and it is dramatic: the spikes sit hundreds of pixels off screen.
  let worst = -Infinity;
  for (let seed = 1; seed <= 20; seed++) {
    withSeed(seed, () => {
      const run = runOnce('good', { seconds: 120, clampCeiling: false });
      worst = Math.max(worst, run.worstSpikesAbove);
    });
  }
  assert.ok(worst > 400,
    `the old model kept the spikes within ${worst}px of the view, so this test proves nothing`);
});

test('THE SKILL LADDER IS REAL — looking further ahead gets you deeper', () => {
  // The two bots differ in judgement rather than in reflexes: neither moves
  // faster or thinks more often. `good` lines itself up on the ledge TWO down
  // once it can already fit through the next one, so it arrives set up.
  //
  // Forty seeds, and a floor of 1.10 against measured ratios of 1.20, 1.22 and
  // 1.45 over three disjoint blocks. The floor clears the worst block by ten
  // per cent, which is the margin this project's history says is needed for a
  // chaotic simulation across node versions.
  const median = (skill) => {
    const metres = [];
    for (let seed = 1; seed <= 40; seed++) {
      withSeed(seed, () => metres.push(runOnce(skill, { seconds: 180 }).metres));
    }
    return summarise(metres).median;
  };
  const competent = median('competent');
  const good = median('good');
  assert.ok(good > competent * 1.10,
    `good reached ${good}m against competent's ${competent}m, which is not a ladder`);
});

test('the skills differ in judgement, not in reflexes or stats', () => {
  // Convention: a change that helps a weak player is forgiveness, one that
  // helps both equally is an easier game, and one that closes the gap has
  // flattened the ceiling. Only two bots that are the SAME except for
  // judgement can tell those apart -- so nothing here may be a speed or a
  // reaction time.
  const keys = new Set(Object.values(SKILLS).flatMap((s) => Object.keys(s)));
  assert.deepEqual([...keys].sort(), ['commitsEarly', 'diveMargin', 'lookahead']);
});

test('a competent bot actually plays rather than falling down a hole', () => {
  // The check that stops every number above being about a bot that does
  // nothing. Over a spread of seeds rather than one, because a single run is a
  // draw: seed 7 lasts 19 seconds and seed 3 lasts twice that, and an
  // assertion pinned to either is an assertion about that seed.
  const metres = [];
  const seconds = [];
  let hurtAtAll = 0;
  for (let seed = 1; seed <= 12; seed++) {
    withSeed(seed, () => {
      const run = runOnce('competent', { seconds: 120 });
      metres.push(run.metres);
      seconds.push(run.seconds);
      if (run.crushes > 0 || run.spikeHits > 0) hurtAtAll++;
    });
  }
  assert.ok(summarise(metres).median > 60,
    `a competent run reaches ${summarise(metres).median}m`);
  assert.ok(summarise(seconds).median > 20,
    `a competent run lasts ${summarise(seconds).median}s`);
  assert.equal(hurtAtAll, 12, 'some runs were never hurt by anything at all');
});
