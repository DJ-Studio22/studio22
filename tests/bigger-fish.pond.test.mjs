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
  END, Pond, SKILLS, SKILL_NAMES, TUNING, canEat, mergeContactSeconds, radiusOf,
  speedOf, splitReach, threatens,
} from '../games/bigger-fish/pond.js';
import { POLICIES, runOnce } from './helpers/fish-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// --- The trade, in the arithmetic ----------------------------------------

test('MASS IS SPEED, SPENT — the line the whole game rests on', () => {
  assert.ok(speedOf(TUNING.startMass) > speedOf(100));
  assert.ok(speedOf(100) > speedOf(1000));
  // And it is a real difference rather than a rounding one -- but a difference
  // you can PLAY, which is the part this test used to have backwards. It
  // asserted a big cell moved at under 0.45 of a small one, and the tuning that
  // satisfied it (falloff 0.30) meant that from about two hundred mass onward
  // you were crawling: prey escaped by existing, and being big was misery
  // rather than a trade. The curve is now speedBase 150 over mass^0.08 --
  //
  //     mass    2  ->  142 a second
  //     mass  100  ->  104
  //     mass 1000  ->   86
  //
  // -- so the biggest thing in the pond still moves at three fifths of the pace
  // of the smallest. The BAND is the claim, both ends of it: below the floor
  // and size is a punishment, above the ceiling and size costs nothing at all.
  const ratio = speedOf(1000) / speedOf(TUNING.startMass);
  assert.ok(ratio > 0.5, `a thousand-mass cell moves at ${ratio.toFixed(2)} of a `
    + 'starting cell, which is not slower, it is stuck');
  assert.ok(ratio < 0.75, `a thousand-mass cell moves at ${ratio.toFixed(2)} of a `
    + 'starting cell, which is not a penalty anybody would feel');
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

test('PUTTING YOURSELF BACK TOGETHER IS SOMETHING YOU DO', () => {
  // Not a timer. The pieces merge only after twenty seconds of unbroken
  // contact, and breaking contact resets the clock to nothing -- so the
  // post-split window is a stretch you are managing rather than waiting out.
  // STARVED: no pellets in the TUNING, rather than an emptied array. The pond
  // tops its pellets back up every frame, so clearing the array only skipped one
  // frame of grazing -- the pieces ate their way from 100 mass to 125 while this
  // test was measuring distances against their radii.
  const pond = new Pond({ ...TUNING, pellets: 0 });
  pond.bots = [];
  pond.cells = pond.cells.filter((c) => c.owner === 'player');
  // No terrain and no food: a two-hundred-mass cell is well over the spike
  // threshold, so a spike would burst it and this would be measuring that
  // instead. Both of these tests failed that way first.
  pond.spikes = [];
  // And put the cell in the middle of the pond. Spawns are random, and a cell
  // near the right wall has its pieces CLAMPED back inside when this test moves
  // them apart -- which quietly puts them back in contact and made the reset
  // assertion fail every other run.
  pond.cellsOf('player')[0].x = pond.t.width / 2;
  pond.cellsOf('player')[0].y = pond.t.height / 2;
  const cell = pond.cellsOf('player')[0];
  cell.mass = 200;
  pond.split('player', cell.x + 100, cell.y);
  assert.equal(pond.cellsOf('player').length, 2);

  // Held apart, they never merge however long you wait.
  //
  // The FIRST cell is pinned to the middle as well as the second being placed
  // beside it. Only the second was, and over twenty-five seconds the pair
  // drifted into the right-hand wall together: the pond clamps a cell inside
  // its bounds, so the b this loop had just pushed forty units clear came back
  // hard against a and the contact clock started. The test failed on a wall,
  // not on the rule.
  for (let i = 0; i < 60 * (mergeContactSeconds() + 5); i++) {
    const [a, b] = pond.cellsOf('player');
    if (!b) break;
    a.x = pond.t.width / 2;
    a.y = pond.t.height / 2;
    b.x = a.x + radiusOf(a.mass) + radiusOf(b.mass) + 40;   // keep them off each other
    b.y = a.y;
    pond.step(1 / 60, {});
  }
  assert.equal(pond.cellsOf('player').length, 2, 'the pieces merged while held apart');
  assert.equal(pond.contactHeld, 0);

  // Let them touch and they merge — but only after the full twenty seconds.
  // Velocity zeroed as well as position: a launched half still travelling eats
  // the first seconds of the window, which makes the timing of this test a
  // matter of how much drag has already happened rather than of the rule.
  const [a, b] = pond.cellsOf('player');
  b.x = a.x;
  b.y = a.y;
  a.vx = 0; a.vy = 0; b.vx = 0; b.vy = 0;
  for (let i = 0; i < 60 * (mergeContactSeconds() - 1); i++) pond.step(1 / 60, {});
  assert.equal(pond.cellsOf('player').length, 2, 'they merged early');
  assert.ok(pond.contactHeld > mergeContactSeconds() - 2);
  for (let i = 0; i < 60 * 2; i++) pond.step(1 / 60, {});
  assert.equal(pond.cellsOf('player').length, 1, 'they never merged');
  assert.equal(pond.merges, 1);
});

test('and breaking contact starts the clock again from nothing', () => {
  // The reset is the point: holding your pieces together through a fight is
  // the work, and letting them apart to cover ground is the decision.
  // STARVED: no pellets in the TUNING, rather than an emptied array. The pond
  // tops its pellets back up every frame, so clearing the array only skipped one
  // frame of grazing -- the pieces ate their way from 100 mass to 125 while this
  // test was measuring distances against their radii.
  const pond = new Pond({ ...TUNING, pellets: 0 });
  pond.bots = [];
  pond.cells = pond.cells.filter((c) => c.owner === 'player');
  // No terrain and no food: a two-hundred-mass cell is well over the spike
  // threshold, so a spike would burst it and this would be measuring that
  // instead. Both of these tests failed that way first.
  pond.spikes = [];
  // And put the cell in the middle of the pond. Spawns are random, and a cell
  // near the right wall has its pieces CLAMPED back inside when this test moves
  // them apart -- which quietly puts them back in contact and made the reset
  // assertion fail every other run.
  pond.cellsOf('player')[0].x = pond.t.width / 2;
  pond.cellsOf('player')[0].y = pond.t.height / 2;
  const cell = pond.cellsOf('player')[0];
  cell.mass = 200;
  pond.split('player', cell.x + 100, cell.y);
  const [a, b] = pond.cellsOf('player');
  b.x = a.x;
  b.y = a.y;
  // And stop it: the launched half is still travelling at six hundred a second,
  // so left alone it flies out of contact for the first three seconds and the
  // clock this test is about would not start until it came back.
  b.vx = 0;
  b.vy = 0;
  for (let i = 0; i < 60 * 10; i++) pond.step(1 / 60, {});
  assert.ok(pond.contactHeld > 9, 'the contact clock is not running');

  // One frame apart is enough.
  b.x = a.x + radiusOf(a.mass) + radiusOf(b.mass) + 60;
  pond.step(1 / 60, {});
  assert.equal(pond.contactHeld, 0, 'breaking contact did not reset the clock');
});

test('the pieces drift back towards each other on their own', () => {
  // A tendency rather than a tractor beam: it closes a split if you let it, and
  // you can pull them apart by steering, because two cells cover twice the
  // ground.
  // STARVED: no pellets in the TUNING, rather than an emptied array. The pond
  // tops its pellets back up every frame, so clearing the array only skipped one
  // frame of grazing -- the pieces ate their way from 100 mass to 125 while this
  // test was measuring distances against their radii.
  const pond = new Pond({ ...TUNING, pellets: 0 });
  pond.bots = [];
  pond.cells = pond.cells.filter((c) => c.owner === 'player');
  // No terrain and no food: a two-hundred-mass cell is well over the spike
  // threshold, so a spike would burst it and this would be measuring that
  // instead. Both of these tests failed that way first.
  pond.spikes = [];
  // And put the cell in the middle of the pond. Spawns are random, and a cell
  // near the right wall has its pieces CLAMPED back inside when this test moves
  // them apart -- which quietly puts them back in contact and made the reset
  // assertion fail every other run.
  pond.cellsOf('player')[0].x = pond.t.width / 2;
  pond.cellsOf('player')[0].y = pond.t.height / 2;
  const cell = pond.cellsOf('player')[0];
  cell.mass = 200;
  pond.split('player', cell.x + 100, cell.y);
  const gapAt = () => {
    const [a, b] = pond.cellsOf('player');
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  for (let i = 0; i < 60; i++) pond.step(1 / 60, {});    // let the launch bleed off
  const wide = gapAt();
  for (let i = 0; i < 60 * 2; i++) pond.step(1 / 60, {});
  assert.ok(gapAt() < wide, `the pieces are not closing: ${wide} then ${gapAt()}`);
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
  //
  // ONE SPIKE, PUT IN THE MIDDLE ON PURPOSE, and an empty pond around it. This
  // test used to move the player onto `spikes[0]`, wherever the pond had
  // happened to scatter it, with the other cells still in the water. Both bit,
  // and both bit rarely enough to look like a platform difference: on 2 of 400
  // seeds it failed, and it picked one of them on CI while passing locally.
  //
  //   - `bots = []` empties the LIST of bots and leaves their CELLS in the
  //     pond, so a burst piece ate a two-mass bystander in the same frame and
  //     the run came out at 242 against an expected 240.
  //   - a spike within a hundred units of a wall is a spike a hundred-radius
  //     whale gets clamped away from, so it never burst at all.
  //
  // Neither is a fact about spikes, which is what this test is for.
  const clear = (pond, x, y) => {
    pond.bots = [];
    pond.cells = pond.cells.filter((c) => c.owner === 'player');
    pond.spikes = [{ ...pond.spikes[0], x, y }];
    const cell = pond.cellsOf('player')[0];
    cell.x = x;
    cell.y = y;
    return cell;
  };
  const middleX = TUNING.width / 2;
  const middleY = TUNING.height / 2;

  const small = new Pond({ ...TUNING, pellets: 0 });
  const tiddler = clear(small, middleX, middleY);
  tiddler.mass = TUNING.spikeMass - 5;
  small.step(1 / 60, {});
  assert.equal(small.cellsOf('player').length, 1, 'a small cell was burst by a spike');
  assert.equal(small.spiked, 0);

  // No pellets IN THE TUNING: a mouthful eaten on the way in would be counted
  // against the spike, and this is measuring the spike. Emptying the array does
  // not do it -- the pond tops its pellets back up every frame, so the whale ate
  // between the assignment and the assertion. That passed on node 24 and failed
  // on node 22, because the difference was a few hundredths of a mass unit
  // against an exact comparison.
  const big = new Pond({ ...TUNING, pellets: 0 });
  const whale = clear(big, middleX, middleY);
  whale.mass = 400;
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

test('NOTHING IN THE POND IS SIZED AGAINST YOU', () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE, and that is the point of it.
  //
  // It was called NEW ARRIVALS COME IN YOUR OWN WEIGHT CLASS, and it required
  // that a bot respawning against a thousand-mass player came back at more than
  // four times a starting cell. The reasoning read well -- otherwise you outgrow
  // the pond and nothing can touch you -- and it was wrong about what it felt
  // like to be on the other end of it. Getting big summoned big opponents, so
  // the reward for playing well was that the game quietly restocked the water
  // with things that could eat you. Difficulty manufactured behind the player's
  // back is not difficulty, it is the game arguing with you.
  //
  // So: EVERYTHING starts at startMass. The player, every bot, every respawn,
  // for ever. A big fish is big because you watched it eat its way there, and
  // the pond getting safer as you dominate it is the correct consequence of
  // dominating it.
  // Caught on the FRAME each bot comes back, not at the end of the wait. The
  // pond is thick with pellets and a returning cell grazes immediately -- read
  // a second later it is already at ten mass, which says nothing about what it
  // arrived at. The question is the size it was DEALT.
  const arrivalsUnder = (leaderMass) => {
    const pond = new Pond();
    pond.cellsOf('player')[0].mass = leaderMass;
    for (const cell of pond.cells) if (cell.owner !== 'player') cell.mass = 0;
    pond.cells = pond.cells.filter((c) => c.mass > 0);

    const seen = new Map();
    for (let i = 0; i < 60 * (TUNING.botRespawnSeconds + 2); i++) {
      pond.step(1 / 60, {});
      for (const bot of pond.bots) {
        const mass = pond.massOf(bot.id);
        if (mass > 0 && !seen.has(bot.id)) seen.set(bot.id, mass);
      }
    }
    return [...seen.values()];
  };

  const rich = arrivalsUnder(1000);
  assert.ok(rich.length > 0, 'nothing came back');
  for (const mass of rich) {
    assert.equal(mass, TUNING.startMass,
      `a new arrival came in at ${mass} against a player of 1000, so something is `
      + 'still sizing the pond against the leader');
  }

  // And the same at the other end: a starving player is not handed smaller
  // company either. The rule is that there is no rule.
  for (const mass of arrivalsUnder(TUNING.startMass)) {
    assert.equal(mass, TUNING.startMass,
      'an arrival came in at a different size against a small player, which is a '
      + 'scale by another name');
  }
});

test('a run ends when the last of you is eaten, and says so', () => {
  const pond = new Pond();
  pond.cells = pond.cells.filter((c) => c.owner !== 'player');
  pond.step(1 / 60, {});
  assert.equal(pond.running, false);
  assert.equal(pond.reason, END.EATEN);
});

test('THE SCORE IS THE AREA UNDER THE MASS CURVE', () => {
  // How big you were multiplied by how long you stayed that way. Peak mass was
  // the first answer and it is the wrong shape: peak ignores duration, so a run
  // that spikes and dies scores the same as one that holds the same size for
  // minutes, which makes reckless growth optimal by construction and no amount
  // of tuning the risks can change it.
  // Nothing in the water but the player, and nothing for it to eat: this is
  // measuring the SCORE against a held mass, so anything that changes the mass
  // is measuring something else. `pellets = []` does not starve a pond -- it
  // tops them back up every frame -- and `bots = []` empties the list of bots
  // while leaving their cells in the water for a five-hundred-mass player to
  // hoover up. Both traps have now cost this file a day each.
  const pond = new Pond({ ...TUNING, pellets: 0 });
  pond.bots = [];
  pond.cells = pond.cells.filter((c) => c.owner === 'player');
  pond.spikes = [];
  pond.cellsOf('player')[0].mass = 500;

  const after = (seconds) => {
    for (let i = 0; i < 60 * seconds; i++) pond.step(1 / 60, {});
    return pond.score;
  };
  const early = after(2);
  const later = after(2);
  assert.ok(early > 0, 'the score never moves');
  assert.ok(later > early * 1.8,
    `holding the same mass twice as long scored ${later} against ${early}`);

  // Peak and held are still tracked and reported; they are just not scored.
  assert.ok(pond.peakMass >= 400);
  assert.ok(pond.heldMass <= pond.peakMass);
});

// --- The pond has its own life --------------------------------------------

test('THE BOTS PLAY THE POND, NOT THE PLAYER', () => {
  // The pond should be an ecosystem you are in rather than seven things aimed
  // at you: bots pursuing each other, eating each other, splitting on each
  // other and blundering into spikes doing it. Measured over two minutes with
  // the player swimming in a straight line and otherwise ignored.
  //
  // Three seeds and a median, because the variance between ponds is enormous --
  // steady bots managed 12, 41 and 30 kills on three consecutive seeds, and
  // across eight seeds the range was 0 to 92. A single unseeded run drew a 1
  // and failed this test, which is what a single run of anything in here is
  // worth.
  const life = (skill) => {
    const kills = [];
    const splits = [];
    const spiked = [];
    for (let seed = 1; seed <= 6; seed++) {
      withSeed(seed, () => {
        const pond = new Pond(TUNING, { skill });
        for (let i = 0; i < 60 * 120; i++) pond.step(1 / 60, { x: 0.4, y: 0.2 });
        kills.push(pond.botKills);
        splits.push(pond.botSplits);
        spiked.push(pond.botSpiked);
      });
    }
    // Summed across the ponds rather than averaged over them. The spread
    // between ponds is enormous -- steady bots managed 6, 6, 25, 0 and 7 kills
    // on five consecutive seeds -- so a median can be a zero that says nothing
    // about the design, while a total over the same seeds is steady.
    const total = (list) => list.reduce((sum, n) => sum + n, 0);
    return { kills: total(kills), splits: total(splits), spiked: total(spiked) };
  };

  const steady = life('steady');
  assert.ok(steady.kills > 10,
    `the bots ate each other ${steady.kills} times across three ponds`);
  assert.ok(steady.splits > 2, 'the bots never split at each other');

  // And the ladder reads in what the pond LOOKS like, not only in the score: a
  // careless shoal is chaos, because it splits at anything in front of it and
  // feeds the halves to whatever was standing behind.
  //
  // SIX SEEDS AND A FLOOR OF 1.6, both of which are the spread's doing. Across
  // three disjoint six-seed blocks the kill ratio measured 3.5, 2.4 and 4.5;
  // at three seeds it measured 2.2, 6.1 and 2.0, and the old floor of 3 sat
  // inside that. It passed on the block it was written against and would have
  // failed on either of the others -- convention 12, pinning a block rather
  // than a property.
  const careless = life('careless');
  assert.ok(careless.kills > steady.kills * 1.6,
    `a careless shoal (${careless.kills} kills) is no more chaotic than a steady one (${steady.kills})`);

  // The second half used to be about spikes: careless bots blundering into them
  // more often. That was never the effect, only a correlate of it, and it does
  // not survive -- the same three blocks measured 1.8, 0.9 and 4.3, so it is a
  // coin flip dressed as a claim. What DOES survive is the cause itself, which
  // is also the thing you can see happening: a careless shoal divides itself at
  // anything. Ratios of 12.4, 4.2 and 11.1 over the same blocks.
  assert.ok(careless.splits > steady.splits * 2,
    `careless bots split ${careless.splits} times against a steady shoal's ${steady.splits}, `
    + 'so recklessness does not read on the screen');
});

test('A BIGGER FISH IS ONLY A THREAT IF ITS HALVES COULD EAT YOU', () => {
  // The rule that brought the pond to life, and it is a correctness fix rather
  // than a liveliness one. A cell catches something faster than it by
  // splitting, and splitting halves it -- so a fish thirty per cent bigger than
  // you is no threat at range at all, because the halves it would arrive as
  // could not eat you.
  //
  // Treating every bigger cell as a split-threat had good bots fleeing
  // continuously and never engaging: seven steady bots managed two meals
  // between them in three minutes, against three hundred for a careless shoal.
  const mine = 100;
  const slightlyBigger = { mass: mine * 1.4 };
  const muchBigger = { mass: mine * 3 };

  // At range, only the one whose halves could still eat you is a threat.
  const far = splitReach(muchBigger.mass) - 10;
  assert.equal(threatens(muchBigger, mine, far), true);
  assert.equal(threatens(slightlyBigger, mine, far), false,
    'a fish that would arrive in harmless halves is treated as a threat at range');

  // Up close, anything that can eat you is a threat.
  assert.equal(threatens(slightlyBigger, mine, 1), true);
  // And something smaller never is.
  assert.equal(threatens({ mass: mine * 0.5 }, mine, 1), false);
});

test('the ladder in the pond is earned rather than dealt', () => {
  // The companion to the test above, and the reason removing the spread of
  // arrival sizes did not flatten the pond.
  //
  // Arrivals used to be dealt across a range so that some bot could always eat
  // some other bot on the day it turned up. That produced a ladder immediately
  // and meant nothing: the rungs were assigned rather than climbed. Now every
  // bot enters at startMass and the spread has to come from play -- which it
  // does, and quickly, because the bots hunt each other.
  const spread = [];
  for (let seed = 1; seed <= 3; seed++) {
    withSeed(seed, () => {
      const pond = new Pond(TUNING, { skill: 'steady' });
      for (let i = 0; i < 60 * 90; i++) pond.step(1 / 60, { x: 0.4, y: 0.2 });
      const sizes = pond.bots.map((b) => pond.massOf(b.id)).filter((m) => m > 0);
      spread.push({ low: Math.min(...sizes), high: Math.max(...sizes) });
    });
  }
  // On every pond, ninety seconds in, the shoal has sorted itself into
  // something with a top and a bottom, and the top can eat the bottom.
  for (const { low, high } of spread) {
    assert.ok(canEat(high, low),
      `after ninety seconds the shoal runs ${Math.round(low)} to ${Math.round(high)}, `
      + 'which is not a ladder anybody could climb');
  }
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

// The ladder lives in tests/bigger-fish.ladder.test.mjs. It moved there when it
// was 554 of this file's 698 seconds and a file is what the runner
// parallelises; it is now a quarter of a second, because the played version of
// it was retired. It could not survive crossing a V8 version -- node 22
// measured a ratio of 1.57 where node 24 measured 3.00 on the same seeds and
// the same code -- so what that file asserts now is the DECISION the levels
// differ in, deterministically. The reasoning is written out in full there.

// CAUTION BEATS GREED WAS THE HEADLINE, AND IT IS NOT ASSERTED HERE.
//
// It was true, and it was true because of the rubber band. Bots used to arrive
// sized against the leader, so growing fast summoned bigger company and a
// greedy player walked into a pond restocked to punish them. Remove that -- and
// it had to go; a game that manufactures difficulty behind the player's back is
// arguing with them rather than challenging them -- and the result goes with it.
//
// Re-measured after the change, exactly as before: median score, selective
// against greedy, three disjoint blocks of sixty seeds at a 480-second cap.
//
//     seeds   1-60     selective 941    greedy  516     selective ahead
//     seeds  61-120    selective 954    greedy 1436     GREEDY ahead
//     seeds 121-180    selective 1122   greedy 1040     selective ahead
//
// The ordering flips. That is not a small effect measured imprecisely, it is
// the absence of an effect: two of three blocks lean one way, the middle one
// leans the other harder than either, and no threshold survives all three.
//
// AND AGAIN IN THE TEN-TIMES POND, because a world that different deserved the
// question asked again rather than assumed:
//
//     seeds   1-60     selective 3447   greedy 1866     1.85x
//     seeds  61-120    selective 1248   greedy 1519     0.82x
//     seeds 121-180    selective 1797   greedy 1376     1.31x
//
// Still flips, on the same middle block. Worth noting what does NOT flip: the
// MEAN favours judgement on all six blocks ever measured, and by a lot here
// (5935/3177, 6119/3734, 6624/4122). That is a real thing about the shape of
// the distribution -- a selective player's good runs are much better -- and it
// is not the claim. The claim was about the median run, and the median run
// says no.
//
// There is a version of this file with a threshold that passes, and finding it
// would have taken an afternoon of picking a cap and a seed count until a block
// agreed. That is convention 12 with extra steps, and the instruction was
// explicit: if it does not hold, say so rather than tuning it back into
// existence. So it is written down and not asserted.
//
// What the game IS, on the evidence: splitting is a tool you pay for rather
// than a profit (the test above), the danger comes from a shoal that hunts
// itself rather than from arrivals aimed at you, and the skill levels decide
// differently -- see tests/bigger-fish.ladder.test.mjs, which asserts the
// judgement itself rather than a score. Those are claims with evidence behind
// them. The
// headline was not, once the thing propping it up was gone.

test('the policies differ in one thing: judgement about being big', () => {
  const keys = new Set(Object.values(POLICIES).flatMap((p) => Object.keys(p)));
  assert.deepEqual([...keys].sort(), ['avoidsSpikes', 'checksPunish', 'usesSplit']);
  // greedy and selective differ only in the two size-linked judgements; the
  // third field is what the split pair above is for.
  assert.equal(POLICIES.greedy.usesSplit, POLICIES.selective.usesSplit);
  assert.notEqual(POLICIES.greedy.avoidsSpikes, POLICIES.selective.avoidsSpikes);
  assert.notEqual(POLICIES.greedy.checksPunish, POLICIES.selective.checksPunish);
});

// TAKE THE TRADE AWAY WAS THE LAST HEADLINE STANDING, AND IT IS NOT ASSERTED
// EITHER. THAT IS THE PRICE OF THE BIGGER POND, AND IT IS WORTH KNOWING.
//
// The claim: both policies want the same things, and the only difference is two
// judgements that exist BECAUSE size is dangerous -- route around a spike, and
// do not divide yourself while something can eat the halves. Take the danger
// away and there should be nothing left to judge. In the old pond that held
// hard: the policies came out bit-identical on 0.67 / 0.58 / 0.50 of flat runs
// against 0.17 / 0.25 / 0.17 of real ones, two to four times as often, on every
// block.
//
// Re-measured in the ten-times pond, three disjoint blocks of twelve seeds:
//
//     seeds  1-12    flat 0.75    real 0.17    4.50x
//     seeds 13-24    flat 0.83    real 0.42    2.00x
//     seeds 25-36    flat 0.25    real 0.25    1.00x
//
// The third block is not a thin result, it is no result: the two policies agree
// exactly as often with the danger switched off as with it on. A threshold that
// passes the first two fails the third, and there is no honest way to describe
// 4.50, 2.00 and 1.00 as one number.
//
// WHY, AND IT IS THE THING THE POND WAS CHANGED FOR. Both judgements only cost
// you anything when something is close enough to matter. Spikes are 7x sparser
// than they were -- deliberately, because at 2576 mass the player was wider
// than the gaps between them and the late game was a corridor -- so
// `avoidsSpikes` almost never fires. Bot density was restored to exactly what
// it was (1.76 per million square units against 1.75), which is what brought
// the first two blocks back from the 1.34 / 1.16 / 1.98 they measured at forty
// bots. It was not enough.
//
// So the pond is roomier and the two policies are more alike in it. That is a
// real trade and it is the player's game that gained: room to route, a late
// game that opens out, and an ecosystem that is the danger. What it costs is
// the sharpest measurable statement this file had about skill. Written down
// rather than tuned away, and the dial is right there -- spikes, or bots, or
// the size of the water -- if the trade is ever judged the wrong way round.
//
// What still holds, with samples behind it: the bots play the pond rather than
// the player, the skill levels make measurably different decisions (asserted
// outright in the ladder file; the played gap between them is real but too
// chaotic to assert, and the numbers are recorded there), splitting reaches
// where swimming cannot, and nothing in the water is sized against you.

test('tuning is data a test can override', () => {
  // Convention 3, and the override above is the one that matters. This is the
  // cheap direct check that the speed dial is live at all.
  const heavy = { ...TUNING, speedFalloff: 0.6 };
  assert.ok(speedOf(500, heavy) < speedOf(500), 'the falloff dial does nothing');
  assert.equal(speedOf(TUNING.startMass, { ...TUNING, speedFalloff: 0 }), TUNING.speedBase);
});

// --- The pond is a place, and it has to be big enough to be one -----------

test('NO TWO SPIKES ARE EVER CLOSE ENOUGH TO FENCE A BIG CELL IN', () => {
  // The fault this is about was reported as "at mass 2576 I couldn't move past
  // the spikes", and the arithmetic underneath it is stark: a cell at 2576 mass
  // is 508 units across, and the AVERAGE gap between two spikes in the old pond
  // was 471. The player was wider than the holes in the terrain.
  //
  // The average was never the number that mattered. Scattering spikes at random
  // puts pairs far closer together than the average, so the fence was built out
  // of the WORST gaps, and a minimum separation is the only thing that speaks
  // to a worst case. The spikes now go one per cell of a jittered grid, which
  // makes that separation a property of the construction rather than a hope
  // about a seed.
  //
  // Thirty ponds, because this is a claim about every pond.
  let worst = Infinity;
  for (let seed = 1; seed <= 30; seed++) {
    withSeed(seed, () => {
      const pond = new Pond();
      for (let i = 0; i < pond.spikes.length; i++) {
        for (let j = i + 1; j < pond.spikes.length; j++) {
          const a = pond.spikes[i];
          const b = pond.spikes[j];
          worst = Math.min(worst, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
    });
  }

  // The gate a cell has to fit through is the gap minus the two spike radii.
  const gate = worst - TUNING.spikeRadius * 2;
  const passes = ((gate / 2) / TUNING.radiusPerRootMass) ** 2;
  assert.ok(passes > 4000,
    `the tightest pair of spikes in thirty ponds is ${Math.round(worst)} apart, which `
    + `fences in anything over ${Math.round(passes)} mass`);
});

test('the pond grew with the sizes it produces, and the food grew with it', () => {
  // Ten times the area, and the SAME pellet density -- 1 per 2667 square units,
  // which is what it has always been. Density is the growth curve: a pond ten
  // times bigger with the same 1500 pellets would have quietly made grazing ten
  // times worse and rewritten every measurement in this file without changing a
  // line of the rules.
  const area = TUNING.width * TUNING.height;
  assert.ok(area >= 4e7, `the pond is ${area} square units`);
  const perPellet = area / TUNING.pellets;
  assert.ok(perPellet > 2400 && perPellet < 2900,
    `one pellet per ${Math.round(perPellet)} square units, which is not the density `
    + 'every growth measurement in this file was taken at');
});

test('the pellet grid finds exactly what a brute-force search finds', () => {
  // The grid is an OPTIMISATION, and the whole risk of an optimisation is that
  // it is faster and wrong. Fifteen thousand pellets rebuilt into a fresh map
  // sixty times a second cost 0.94ms of a 16.7ms frame; maintaining the grid
  // instead costs nothing, and this is the check that it still answers the same
  // question.
  //
  // Asked at several sizes because the interesting case is a cell that spans
  // many grid cells: a starting cell sits inside one, and a thousand-mass cell
  // covers a hundred.
  const pond = new Pond();
  for (const mass of [TUNING.startMass, 100, 1000, 4000]) {
    const r = radiusOf(mass);
    const at = { x: TUNING.width * 0.42, y: TUNING.height * 0.61 };

    const brute = new Set();
    for (const pellet of pond.pellets) {
      if (Math.abs(pellet.x - at.x) <= r && Math.abs(pellet.y - at.y) <= r) brute.add(pellet);
    }

    const viaGrid = new Set();
    pond.forEachPelletIn(at.x - r, at.y - r, at.x + r, at.y + r, (p) => viaGrid.add(p));

    // The grid may return a few EXTRA -- it works in 100-unit cells and both
    // callers do their own exact test -- but it must never miss one.
    for (const pellet of brute) {
      assert.ok(viaGrid.has(pellet),
        `the grid missed a pellet inside a ${mass}-mass cell's box`);
    }
  }
});

test('and eating through the grid leaves the pellet array consistent', () => {
  // The eat path removes a pellet from a grid bucket and compacts the array in
  // place, which is two bookkeeping jobs that can disagree. They cannot be
  // allowed to: a pellet left in the grid but not the array is food that can be
  // eaten twice, and one left in the array but not the grid is food nobody can
  // ever reach.
  const pond = new Pond();
  pond.bots = [];
  pond.cells = pond.cells.filter((c) => c.owner === 'player');
  pond.cellsOf('player')[0].mass = 900;      // a wide mouth, so it eats plenty
  for (let i = 0; i < 120; i++) pond.step(1 / 60, { x: 1, y: 0.4 });

  const inArray = new Set(pond.pellets);
  let inGrid = 0;
  let stray = 0;
  pond.forEachPelletIn(0, 0, TUNING.width, TUNING.height, (p) => {
    inGrid++;
    if (!inArray.has(p)) stray++;
  });
  assert.equal(stray, 0, 'the grid is holding pellets that are no longer in the pond');
  assert.equal(inGrid, pond.pellets.length,
    `the grid holds ${inGrid} pellets and the pond has ${pond.pellets.length}`);
});

test('A COLD START IS NOT A DEATH SENTENCE', () => {
  // tests/README.md section 9: every bot acts on frame one, and a person spends
  // the first seconds working out what they are looking at. So the harness
  // structurally cannot see the opening, and the only way to check it is to
  // simulate the thing a harness never does -- touching nothing.
  //
  // This found a real fault, and it was not one this phase introduced: a player
  // who did nothing survived a median of 16.9 seconds in the OLD pond and 12.6
  // in the ten-times one, with seven of forty cold starts ending inside ten
  // seconds in both. openingGraceSeconds and startClear are the two numbers
  // that decide it, and they were sized for a pond a fifteenth of this one.
  const lives = [];
  for (let seed = 1; seed <= 40; seed++) {
    withSeed(seed, () => {
      const pond = new Pond();
      let seconds = 0;
      // Sixty is well past the point of interest: what matters is that the
      // first few are survivable, not that standing still is a strategy.
      while (pond.running && seconds < 60) {
        pond.step(1 / 60, {});
        seconds += 1 / 60;
      }
      lives.push(seconds);
    });
  }

  const worst = Math.min(...lives);
  assert.ok(worst > 10,
    `the unluckiest cold start of forty lasted ${worst.toFixed(1)}s without the `
    + 'player touching anything, which is the game deciding the run');
  // And a floor is not the whole claim -- the typical opening has to be
  // comfortable, not survivable.
  assert.ok(summarise(lives).median > 18,
    `the median cold start is ${summarise(lives).median.toFixed(1)}s`);
});

