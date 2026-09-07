// tests/bigger-fish.pond.test.mjs
//
// Bigger Fish is built on one trade: MASS IS SPEED, SPENT. Growing makes you
// stronger and slower, turns spikes from scenery into terrain, and makes the
// only way to catch anything -- splitting -- the thing that leaves you edible.
//
// Three claims are measured here, and one is deliberately NOT asserted. What
// each of them is worth is written next to it, because the difference between a
// result and a hope is the sample it survived.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  END, Pond, SKILLS, SKILL_NAMES, TUNING, canEat, radiusOf, recombineDelay,
  speedOf, splitReach,
} from '../games/bigger-fish/pond.js';
import { POLICIES, runOnce } from './helpers/fish-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// --- The trade, in the arithmetic ----------------------------------------

test('MASS IS SPEED, SPENT — the line the whole game rests on', () => {
  assert.ok(speedOf(TUNING.startMass) > speedOf(100));
  assert.ok(speedOf(100) > speedOf(1000));
  // And it is a real difference rather than a rounding one: a big cell moves at
  // little more than a third of the pace of a small one, which is what makes
  // prey outrun you exactly when you most want it.
  assert.ok(speedOf(1000) < speedOf(TUNING.startMass) * 0.45,
    `a thousand-mass cell moves at ${(speedOf(1000) / speedOf(TUNING.startMass)).toFixed(2)} `
    + 'of a starting cell, which is not a penalty anybody would feel');
});

test('radius grows by area, so twice the mass is not twice the width', () => {
  // Which is what stops a big cell's reach growing out of hand: it is a bigger
  // target long before it is a wider one.
  assert.ok(Math.abs(radiusOf(400) - radiusOf(100) * 2) < 1e-9);
});

test('eating needs a real margin, not a crumb', () => {
  assert.equal(canEat(100, 100), false, 'equals ate equals');
  assert.equal(canEat(100, 79), true);
  assert.equal(canEat(100, 81), false);
});

test('splitReach is where the launch actually gets you', () => {
  // Exported because the bots decide with it and game.js DRAWS it. One
  // function, so the ring on screen and the decision behind a bot's split
  // cannot come apart -- the Tank Tactics rule.
  const reach = splitReach(100);
  assert.ok(Math.abs(reach - (TUNING.splitLaunch / TUNING.splitDrag + radiusOf(50))) < 1e-9);
  // And it beats what a cell of that size could cover by swimming, or splitting
  // would never be the way to catch anything.
  assert.ok(reach > speedOf(100) * 1.5);
});

// --- Split ----------------------------------------------------------------

test('splitting halves you and throws one half forward', () => {
  const pond = new Pond();
  const cell = pond.cellsOf('player')[0];
  cell.mass = 200;
  const before = pond.playerMass;
  assert.equal(pond.split('player', cell.x + 100, cell.y), 1);
  const mine = pond.cellsOf('player');
  assert.equal(mine.length, 2);
  assert.ok(Math.abs(pond.playerMass - before) < 1e-9, 'splitting created or destroyed mass');
  assert.ok(mine.some((c) => c.vx > 0), 'nothing was launched');
});

test('and it is a commitment: the halves will not merge for a while', () => {
  const pond = new Pond();
  const cell = pond.cellsOf('player')[0];
  cell.mass = 200;
  pond.split('player', cell.x + 100, cell.y);
  const delay = recombineDelay(100);
  assert.ok(delay > 10, 'the halves merge back almost immediately, so splitting risks nothing');
  for (const piece of pond.cellsOf('player')) assert.ok(piece.splitUntil >= delay - 1e-6);
});

test('a small cell cannot split, and nobody exceeds the cell cap', () => {
  const pond = new Pond();
  const cell = pond.cellsOf('player')[0];
  cell.mass = TUNING.splitMinMass - 1;
  assert.equal(pond.split('player', cell.x + 10, cell.y), 0);

  cell.mass = 4000;
  for (let i = 0; i < 8; i++) pond.split('player', cell.x + 10, cell.y);
  assert.ok(pond.cellsOf('player').length <= TUNING.maxCells);
});

// --- Eject ----------------------------------------------------------------

test('ejecting costs more than it delivers', () => {
  // Which is what makes feeding, baiting and shedding weight a decision rather
  // than a free action.
  const pond = new Pond();
  pond.bots = [];
  const cell = pond.cellsOf('player')[0];
  cell.mass = 200;
  assert.equal(pond.eject('player', cell.x + 50, cell.y), 1);
  assert.equal(cell.mass, 200 - TUNING.ejectCost);
  assert.equal(pond.blobs.length, 1);
  assert.ok(pond.blobs[0].mass < TUNING.ejectCost, 'ejecting is free');
});

test('a fed spike spits out another one, which is how you push one at somebody', () => {
  const pond = new Pond();
  const spike = pond.spikes[0];
  const before = pond.spikes.length;
  for (let i = 0; i < TUNING.spikeFeedToSplit; i++) {
    pond.blobs.push({ x: spike.x, y: spike.y, vx: 0, vy: 0, mass: TUNING.ejectMass, owner: 'player', angle: 0 });
    pond.step(1 / 60, {});
  }
  assert.equal(pond.spikes.length, before + 1, 'feeding a spike did nothing');
});

// --- Spikes ---------------------------------------------------------------

test('SPIKES ARE HARMLESS SMALL AND RUINOUS LARGE', () => {
  // The mechanism that makes size turn the map hostile: a small player ignores
  // the terrain, a big one has to route around it.
  const small = new Pond();
  small.bots = [];
  const tiddler = small.cellsOf('player')[0];
  tiddler.mass = TUNING.spikeMass - 5;
  tiddler.x = small.spikes[0].x;
  tiddler.y = small.spikes[0].y;
  small.step(1 / 60, {});
  assert.equal(small.cellsOf('player').length, 1, 'a small cell was burst by a spike');
  assert.equal(small.spiked, 0);

  const big = new Pond();
  big.bots = [];
  // No pellets: a mouthful eaten on the way in would be counted against the
  // spike, and this is measuring the spike.
  big.pellets = [];
  const whale = big.cellsOf('player')[0];
  whale.mass = 400;
  whale.x = big.spikes[0].x;
  whale.y = big.spikes[0].y;
  const before = big.playerMass;
  big.step(1 / 60, {});
  assert.ok(big.cellsOf('player').length > 1, 'a big cell walked through a spike');
  assert.equal(big.spiked, 1);
  // And it costs mass, not just tidiness. Without a price the burst was noise:
  // measured over ten minutes a player hit spikes seventy-odd times a run and
  // no policy cared, because the pieces merged back a few seconds later with
  // everything they went in with.
  assert.ok(Math.abs(big.playerMass - before * (1 - TUNING.spikeLoss)) < 1e-6,
    'a spike burst cost nothing, so the terrain is decoration');
});

// --- The pond stays dangerous ---------------------------------------------

test('NEW ARRIVALS COME IN YOUR OWN WEIGHT CLASS', () => {
  // Without this the pond gets safer the longer you live: bots respawn tiny,
  // you outgrow every one of them, and nothing in the water can touch you. It
  // is also the title of the game.
  const pond = new Pond();
  pond.cellsOf('player')[0].mass = 1000;
  for (const bot of pond.bots) {
    for (const cell of pond.cellsOf(bot.id)) cell.mass = 0;
  }
  pond.cells = pond.cells.filter((c) => c.mass > 0);
  for (let i = 0; i < 60 * (TUNING.botRespawnSeconds + 1); i++) pond.step(1 / 60, {});

  const arrivals = pond.bots.map((b) => pond.massOf(b.id)).filter((m) => m > 0);
  assert.ok(arrivals.length > 0, 'nothing came back');
  assert.ok(Math.max(...arrivals) > TUNING.startMass * 4,
    `the biggest new arrival was ${Math.max(...arrivals)} against a player of 1000`);
});

test('a run ends when the last of you is eaten, and says so', () => {
  const pond = new Pond();
  pond.cells = pond.cells.filter((c) => c.owner !== 'player');
  pond.step(1 / 60, {});
  assert.equal(pond.running, false);
  assert.equal(pond.reason, END.EATEN);
});

test('the score is peak mass, and what you held is reported beside it', () => {
  // Held mass was tried as the score on the strength of a twelve-seed
  // measurement that did not survive sixty seeds. See the note in pond.js.
  const pond = new Pond();
  pond.cellsOf('player')[0].mass = 500;
  pond.step(1 / 60, {});
  assert.equal(pond.score, Math.round(pond.peakMass));
  assert.ok(pond.heldMass <= pond.peakMass);
});

// --- The skill levels -----------------------------------------------------

test('SKILL LEVELS DIFFER IN JUDGEMENT, NOT IN REFLEXES OR STATS', () => {
  // A bot that moves faster or thinks more often than the player is not a
  // harder opponent, it is a handicap. Every level here shares the movement
  // code, the decision clock and the sight range; what changes is the quality
  // of the answers.
  const keys = Object.keys(SKILLS.careless);
  for (const name of SKILL_NAMES) {
    assert.deepEqual(Object.keys(SKILLS[name]), keys, `${name} has a different set of dials`);
    for (const key of keys) {
      assert.equal(typeof SKILLS[name][key], 'boolean',
        `${name}.${key} is a number — that is a stat, not a judgement`);
    }
  }
  // And the levels are actually ordered: each one does everything the one below
  // does, and one thing more.
  const yes = (name) => keys.filter((k) => SKILLS[name][k]).length;
  assert.ok(yes('careless') < yes('steady'));
  assert.ok(yes('steady') < yes('ruthless'));
});

test('and the ladder is real — the same player does far worse against better bots', () => {
  // Measured, not asserted. Ten seeds of four minutes each; the player
  // policy is identical throughout, so the difference is entirely in how well
  // the pond plays against it.
  //
  // Measured at 24 seeds: careless 2616, steady 306, ruthless 247. A careless
  // shoal splits at anything in front of it and feeds the player its halves,
  // which is exactly the mistake it is meant to make.
  const against = (skill) => {
    const peaks = [];
    for (let seed = 1; seed <= 10; seed++) {
      withSeed(seed, () => peaks.push(runOnce('selective', undefined, { seconds: 240, skill }).peak));
    }
    return summarise(peaks).median;
  };
  const careless = against('careless');
  const ruthless = against('ruthless');
  assert.ok(careless > ruthless * 2,
    `a careless shoal is barely easier than a ruthless one: ${careless} against ${ruthless}`);
});

// --- The claims -----------------------------------------------------------

test('SPLITTING PAYS — the mechanic is not decoration', () => {
  // Two policies identical in every respect but one: whether they ever divide
  // themselves to catch something faster.
  //
  // Twenty-four seeds of four minutes. Across two disjoint blocks of that size
  // the ratio came out 1.21 and 1.29, so the floor here is well under what was
  // measured and well over noise.
  const median = (policy) => {
    const peaks = [];
    for (let seed = 1; seed <= 24; seed++) {
      withSeed(seed, () => peaks.push(runOnce(policy, undefined, { seconds: 240 }).peak));
    }
    return summarise(peaks).mean;
  };
  const splits = median('selective');
  const never = median('noSplit');
  assert.ok(splits > never * 1.1,
    `never splitting costs almost nothing: ${never} against ${splits}`);
});

test('the policies differ in one thing: judgement about being big', () => {
  const keys = new Set(Object.values(POLICIES).flatMap((p) => Object.keys(p)));
  assert.deepEqual([...keys].sort(), ['avoidsSpikes', 'checksPunish', 'usesSplit']);
  // greedy and selective differ only in the two size-linked judgements; the
  // third field is what the split pair above is for.
  assert.equal(POLICIES.greedy.usesSplit, POLICIES.selective.usesSplit);
  assert.notEqual(POLICIES.greedy.avoidsSpikes, POLICIES.selective.avoidsSpikes);
  assert.notEqual(POLICIES.greedy.checksPunish, POLICIES.selective.checksPunish);
});

test('TAKE THE TRADE AWAY AND THE TWO POLICIES PLAY THE SAME GAME', () => {
  // The counterfactual, and the strongest result in this file.
  //
  // Both policies want exactly the same things; the only difference is two
  // judgements that exist BECAUSE size is dangerous -- route around a spike,
  // and do not divide yourself while something can eat the halves. So take the
  // danger away, and there should be nothing left to judge.
  //
  // There is not. With the speed penalty and the spike threat set to nothing,
  // 23 of 24 runs come out BIT-IDENTICAL: the same seeds, the same moves, the
  // same final mass, because at no point did either policy find a reason to
  // decide differently. In the real pond only 1 of 12 runs is identical.
  //
  // (An earlier version of this asserted that ALL the flat runs matched, which
  // passed for a while and then broke on a seed where the punish check did
  // matter. That was convention 12 in its purest form -- pinning an accident.
  // A share is the claim; identity was a coincidence that held for a while.)
  const flat = { ...TUNING, speedFalloff: 0, spikeMass: Infinity };
  const matches = (tuning, seeds) => {
    let same = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      let greedy = 0;
      let selective = 0;
      withSeed(seed, () => { greedy = runOnce('greedy', tuning, { seconds: 240 }).peak; });
      withSeed(seed, () => { selective = runOnce('selective', tuning, { seconds: 240 }).peak; });
      if (greedy === selective) same++;
    }
    return same / seeds;
  };

  const safe = matches(flat, 12);
  const dangerous = matches(TUNING, 12);
  assert.ok(safe >= 0.8,
    `only ${(safe * 100).toFixed(0)}% of runs matched with the trade removed, so the `
    + 'policies differ in more than judgement about being big');
  assert.ok(dangerous <= 0.4,
    `${(dangerous * 100).toFixed(0)}% of runs matched in the real pond, so the judgement `
    + 'almost never comes up and the trade is not biting');
});

test('tuning is data a test can override', () => {
  // Convention 3, and the override above is the one that matters. This is the
  // cheap direct check that the speed dial is live at all.
  const heavy = { ...TUNING, speedFalloff: 0.6 };
  assert.ok(speedOf(500, heavy) < speedOf(500), 'the falloff dial does nothing');
  assert.equal(speedOf(TUNING.startMass, { ...TUNING, speedFalloff: 0 }), TUNING.speedBase);
});
