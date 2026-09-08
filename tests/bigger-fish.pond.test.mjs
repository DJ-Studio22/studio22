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

test('and the ladder is real — the same player does far worse against better bots', () => {
  // Measured, not asserted. Twenty seeds of four minutes each; the player
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
  // At twenty seeds the medians are 911 against 273 and 1571 against 195 --
  // ratios of 3.3 and 8.1, with the means at 12.6 and 12.9. A floor of 1.6 is
  // well under the smallest of those and well over anything chaos can produce.
  const against = (skill) => {
    const peaks = [];
    for (let seed = 1; seed <= 20; seed++) {
      withSeed(seed, () => peaks.push(runOnce('selective', undefined, { seconds: 240, skill }).peak));
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
// There is a version of this file with a threshold that passes, and finding it
// would have taken an afternoon of picking a cap and a seed count until a block
// agreed. That is convention 12 with extra steps, and the instruction was
// explicit: if it does not hold, say so rather than tuning it back into
// existence. So it is written down and not asserted.
//
// What the game IS, on the evidence: splitting is a tool you pay for rather
// than a profit (the test above), the danger comes from a shoal that hunts
// itself rather than from arrivals aimed at you, and the skill ladder is real
// and measured -- see 'the ladder is real' above, where the same player scores
// far worse against better bots. Those are claims with samples behind them. The
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

test('TAKE THE TRADE AWAY AND THE TWO POLICIES PLAY THE SAME GAME', () => {
  // The counterfactual, and the strongest result in this file.
  //
  // Both policies want exactly the same things; the only difference is two
  // judgements that exist BECAUSE size is dangerous -- route around a spike,
  // and do not divide yourself while something can eat the halves. So take the
  // danger away, and there should be nothing left to judge.
  //
  // There is not, and this is now the only headline claim in the file that
  // survived removing the rubber band -- which is why it is stated as a GAP
  // rather than as a level.
  //
  // Three disjoint blocks of twelve seeds, share of runs coming out
  // bit-identical between the two policies:
  //
  //     seeds  1-12    flat 0.67    real pond 0.17
  //     seeds 13-24    flat 0.58    real pond 0.25
  //     seeds 25-36    flat 0.50    real pond 0.17
  //
  // Take the danger away and the policies agree two to four times as often. The
  // direction and the size of the gap hold on every block; the absolute share
  // does not, and used to be asserted at 0.8 because the block it was written
  // against happened to give 23 of 24. That was convention 12 -- pinning a
  // block. Under the new rules the flat pond diverges more, because a shoal
  // that all starts at startMass and hunts itself produces far more near-equal
  // meetings, and a near-equal meeting is where one ulp becomes a different run.
  //
  // So the assertion is the RATIO, with floors either side of it so that a
  // degenerate reading -- both zero, or both one -- cannot satisfy it.
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
  assert.ok(safe >= 0.4,
    `only ${(safe * 100).toFixed(0)}% of runs matched with the trade removed, so the `
    + 'policies differ in more than judgement about being big');
  assert.ok(dangerous <= 0.35,
    `${(dangerous * 100).toFixed(0)}% of runs matched in the real pond, so the judgement `
    + 'almost never comes up and the trade is not biting');
  assert.ok(safe > dangerous * 1.8,
    `the policies agreed on ${(safe * 100).toFixed(0)}% of flat runs and `
    + `${(dangerous * 100).toFixed(0)}% of real ones, which is not a gap`);
});

test('tuning is data a test can override', () => {
  // Convention 3, and the override above is the one that matters. This is the
  // cheap direct check that the speed dial is live at all.
  const heavy = { ...TUNING, speedFalloff: 0.6 };
  assert.ok(speedOf(500, heavy) < speedOf(500), 'the falloff dial does nothing');
  assert.equal(speedOf(TUNING.startMass, { ...TUNING, speedFalloff: 0 }), TUNING.speedBase);
});
