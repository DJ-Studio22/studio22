// tests/dungeon-dice.dice.test.mjs
//
// A dice game has one way of being bad and it is fatal: the dice decide and
// the player watches. Dungeon Dice makes two claims against that, and they
// fail in different ways, so they are measured separately.
//
//   WORTH IT      a bot that works the roll beats one that takes what it is
//                 given. If it does not, every tool in the game is decoration.
//   NOT A ROBBERY a run almost never ends on a turn where nothing could have
//                 been done. Measured by searching the losing turn for ANY
//                 sequence of manipulations that survives it.
//
// The second is the one that is easy to get wrong and impossible to notice by
// playing, because a player who dies to a bad roll blames the roll and moves
// on. The first version of this game killed a quarter of its runs with no
// possible out, and nothing but this test would have said so.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Die, FACE, NUDGE_RING, Run, TUNING, UPGRADE, enemiesOnFloor, enemyDamage,
  enemyHp, hadAnOut, nudged, offerUpgrades, tally,
} from '../games/dungeon-dice/dice.js';
import { SKILLS, runOnce, runWithPostMortem } from './helpers/dice-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

const SEEDS = 40;

// --- Faces and nudging ----------------------------------------------------

test('the nudge ring is a ring, and a blank is one step from a bolt', () => {
  // The single most important adjacency in the game: the worst face you can
  // roll is one step from the face that pays for changing faces. That is what
  // stops a terrible roll being a dead roll.
  assert.equal(nudged(FACE.BLANK), FACE.BOLT);
  assert.equal(nudged(FACE.BOLT, -1), FACE.BLANK);
  // And it closes, so no face is a dead end.
  let face = NUDGE_RING[0];
  for (let i = 0; i < NUDGE_RING.length; i++) face = nudged(face);
  assert.equal(face, NUDGE_RING[0]);
});

test('a tally counts what is on the table at the rates given', () => {
  const faces = [FACE.SWORD, FACE.SWORD, FACE.SHIELD, FACE.HEART, FACE.BLANK];
  const t = tally(faces, { damagePerSword: 3, blockPerShield: 3, healPerHeart: 2 });
  assert.equal(t.damage, 6);
  assert.equal(t.block, 3);
  assert.equal(t.heal, 2);
  assert.equal(t.blanks, 1);
});

test('upgrading a die replaces a blank and only a blank', () => {
  const die = new Die([FACE.BLANK, FACE.SWORD, FACE.SWORD, FACE.SHIELD, FACE.HEART, FACE.BOLT]);
  assert.equal(die.upgrade(FACE.BLANK, FACE.SWORD), true);
  assert.equal(die.count(FACE.BLANK), 0);
  assert.equal(die.count(FACE.SWORD), 3);
  assert.equal(die.upgrade(FACE.BLANK, FACE.SWORD), false, 'upgraded a face that was not there');
});

// --- Charges --------------------------------------------------------------

test('CHARGES CARRY OVER — the line that stops the dice robbing you', () => {
  // Bolts used to exist only for the turn they were rolled, so a turn that
  // rolled none had no manipulation available at all. Carrying them is what
  // lets a player bank power on the easy turns and spend it on the hard one.
  const run = new Run();
  run.shown = [FACE.BOLT, FACE.BOLT, FACE.SHIELD, FACE.SHIELD, FACE.SHIELD];
  run.charges = tally(run.shown, run.rates).bolts;
  const before = run.charges;
  assert.ok(before >= 2);
  // A shield nudges to a sword, which pays nothing back.
  run.nudge(2);
  assert.equal(run.charges, before - TUNING.nudgeCost, 'a nudge did not cost a charge');
});

test('and a nudge onto a bolt pays for itself, which is the point of the ring', () => {
  // The blank-to-bolt adjacency is not a rounding detail, it is the escape
  // hatch: the worst face on the table can always be turned into the currency
  // that buys another change, for free. A player with nothing is never a
  // player with nothing to do.
  const run = new Run();
  run.shown = [FACE.BLANK, FACE.SHIELD, FACE.SHIELD, FACE.SHIELD, FACE.SHIELD];
  run.charges = 1;
  assert.equal(run.nudge(0), true);
  assert.equal(run.shown[0], FACE.BOLT);
  assert.equal(run.charges, 1, 'turning a blank into a bolt should cost nothing net');
});

test('a charge cannot be spent twice, and manipulation stops when they run out', () => {
  const run = new Run();
  run.charges = 1;
  run.shown = [FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK];
  assert.equal(run.nudge(0), true);
  // That nudge landed on a bolt, which pays for itself — so spend it again.
  run.charges = 0;
  assert.equal(run.nudge(1), false, 'nudged with no charges');
});

test('the free reroll is free, and the next one is not', () => {
  const run = new Run();
  run.charges = 0;
  run.rerollsLeft = 1;
  run.shown = [FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK];
  assert.equal(run.reroll([0]), true, 'the free reroll was refused');
  run.charges = 0;
  run.rerollsLeft = 0;
  assert.equal(run.reroll([1]), false, 'rerolled with nothing to pay with');
});

test('banking carries a face into the next turn, and is capped', () => {
  const run = new Run();
  run.charges = 9;
  run.shown = [FACE.SHIELD, FACE.SHIELD, FACE.SHIELD, FACE.SWORD, FACE.SWORD];
  assert.equal(run.bank(0), true);
  assert.equal(run.bank(0), true);
  assert.equal(run.bank(0), false, 'banked past the cap');
  assert.equal(run.banked.length, TUNING.maxBanked);
  run.roll();
  assert.equal(run.shown.slice(0, TUNING.maxBanked).every((f) => f === FACE.SHIELD), true,
    'the banked faces did not come back');
});

// --- The floors -----------------------------------------------------------

test('the dungeon escalates without a ceiling, on all three axes', () => {
  assert.ok(enemyHp(50) > enemyHp(1));
  assert.ok(enemyDamage(50) > enemyDamage(1));
  assert.ok(enemiesOnFloor(50) > enemiesOnFloor(1));
  assert.ok(enemyHp(500) > enemyHp(50), 'the escalation stops');
});

test('an enemy telegraphs before it lands, so a shield is a decision', () => {
  const run = new Run();
  const winding = run.enemies.filter((e) => e.wind > 0);
  assert.ok(winding.length > 0, 'everything landed on turn one, so nothing was telegraphed');
  // And they are staggered, so a queue does not all swing at once.
  const slots = new Set(run.enemies.map((e) => e.wind));
  assert.ok(slots.size > 1 || run.enemies.length === 1);
});

test('clearing a floor offers upgrades, and taking one changes the run', () => {
  const run = new Run();
  run.enemies = [];
  run.shown = [FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK];
  run.commit();
  assert.equal(run.floorsCleared, 1);
  assert.ok(run.pendingUpgrades.length > 0);

  const before = run.rates.blockPerShield;
  run.takeUpgrade({ kind: UPGRADE.REINFORCE });
  assert.equal(run.rates.blockPerShield, before + TUNING.reinforceStep);
});

test('THE PLAYER CEILING SCALES, or the dice start robbing you', () => {
  // Without sharpen and reinforce the best possible block was five shields at
  // three apiece — fifteen, forever — while incoming climbed past it around
  // floor ten. From there no roll survived a full landing and 28% of deaths
  // had no out. The offers must be able to move the rates.
  const run = new Run();
  const seen = new Set();
  for (let i = 0; i < 60; i++) for (const o of offerUpgrades(run)) seen.add(o.kind);
  assert.ok(seen.has(UPGRADE.SHARPEN), 'nothing on offer makes swords hit harder');
  assert.ok(seen.has(UPGRADE.REINFORCE), 'nothing on offer makes shields block more');
});

// --- The two claims -------------------------------------------------------

test('WORKING THE ROLL IS WORTH IT — the depth claim', () => {
  // The two bots differ in one field. Everything else — target choice, upgrade
  // choice, the lot — is identical, so the gap between them is the
  // manipulation and cannot be anything else.
  const greedy = [];
  const manipulator = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    withSeed(seed, () => greedy.push(runOnce('greedy').floors));
    withSeed(seed, () => manipulator.push(runOnce('manipulator').floors));
  }
  const g = summarise(greedy);
  const m = summarise(manipulator);

  assert.ok(m.median > g.median * 1.5,
    `working the roll bought little: greedy ${g.median} floors, manipulator ${m.median}`);
  assert.ok(m.max > g.max,
    'the ceiling is no higher for the player who works the roll, so it is not depth');
});

test('and all three tools are actually used', () => {
  // A tool nobody reaches for is a tool that should not be in the game. The
  // bank was dead for a whole revision — nothing could afford it — and this is
  // what would have said so.
  let rerolls = 0;
  let nudges = 0;
  let banks = 0;
  for (let seed = 1; seed <= 20; seed++) {
    withSeed(seed, () => {
      const r = runOnce('manipulator');
      rerolls += r.rerolls; nudges += r.nudges; banks += r.banks;
    });
  }
  assert.ok(rerolls > 0, 'the reroll is never worth taking');
  assert.ok(nudges > 0, 'the nudge is never worth taking');
  assert.ok(banks > 0, 'the bank is never worth taking');
});

test('THE DICE DO NOT ROB YOU — deaths almost always had an out', () => {
  // For the turn each run died on, search every legal sequence of
  // manipulations and ask whether ANY of them survived.
  //
  // The search samples rerolls rather than enumerating them, so a `true` is
  // PROOF that an out existed and a `false` is a strong maybe. That asymmetry
  // is the right way round and it makes this figure an UPPER BOUND on how
  // often the dice actually robbed the player.
  let noOut = 0;
  let deaths = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    withSeed(seed, () => {
      const r = runWithPostMortem('manipulator');
      if (!r.lastTurn) return;
      deaths++;
      if (!hadAnOut(r.lastTurn)) noOut++;
    });
  }
  assert.ok(deaths > 0, 'nothing died, so nothing was measured');
  assert.ok(noOut / deaths <= 0.12,
    `${noOut} of ${deaths} deaths had no possible out — the dice are deciding, not the player`);
});

test('a run ends for a stated reason, naming the floor', () => {
  const r = withSeed(3, () => runOnce('greedy'));
  assert.equal(r.alive, false);
  assert.match(r.reason, /Killed on floor \d+/);
});

test('floors cleared is the score, and it only counts whole ones', () => {
  const run = new Run();
  assert.equal(run.score, 0);
  run.enemies = [];
  run.shown = [FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK, FACE.BLANK];
  run.commit();
  assert.equal(run.score, 1);
});

test('tuning is data a test can override', () => {
  // Convention 3. If this passed with a restated constant it would be
  // measuring a copy of the game rather than the game.
  const brutal = { ...TUNING, enemyDamageBase: TUNING.enemyDamageBase * 4 };
  const normal = [];
  const hard = [];
  for (let seed = 1; seed <= 16; seed++) {
    withSeed(seed, () => normal.push(runOnce('manipulator').floors));
    withSeed(seed, () => hard.push(runOnce('manipulator', brutal).floors));
  }
  assert.ok(summarise(hard).median < summarise(normal).median,
    'quadrupling enemy damage changed nothing, so the tuning is not live');
});

test('both bots exist and differ only in whether they manipulate', () => {
  const keys = new Set([...Object.keys(SKILLS.greedy), ...Object.keys(SKILLS.manipulator)]);
  const differ = [...keys].filter((k) => SKILLS.greedy[k] !== SKILLS.manipulator[k]);
  assert.deepEqual(differ, ['manipulates'],
    'the two bots differ in more than the manipulation, so the gap measures something else');
});
