// tests/winter.camp.test.mjs
//
// Winter Base Building rests on one claim, and it is a claim about arithmetic:
//
//   WOOD IS DUAL-PURPOSE AND GENUINELY SCARCE, so burning it and building with
//   it compete, and a player can be caught having chosen wrong.
//
// If that is false the game is a chore list — gather enough and everything is
// fine — and no amount of snow on the canvas would rescue it. So it is
// measured here rather than asserted in a comment.
//
// The interesting failures are "I built the wall and froze" and "I stayed warm
// and the wall fell". The uninteresting one is "I did not gather enough". The
// bots are shaped to tell those apart: four STRATEGIES rather than two skill
// levels, because the question is not how good the player is, it is whether
// the choice exists at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION, Camp, END, TUNING, bearChance, fuelFor, gatherYield, isWolfNight,
  packFor, weekBudget, weekOf,
} from '../games/winter/camp.js';
import { STRATEGIES, causeOfDeath, runOnce } from './helpers/winter-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

const SEEDS = 60;

// --- The week, and the calendar the whole design hangs on -----------------

test('week 1 is days 1-7, and the wolves come on the last night of each', () => {
  assert.equal(weekOf(1), 1);
  assert.equal(weekOf(TUNING.daysPerWeek), 1);
  assert.equal(weekOf(TUNING.daysPerWeek + 1), 2);

  for (let day = 1; day <= TUNING.daysPerWeek * 3; day++) {
    assert.equal(
      isWolfNight(day),
      day % TUNING.daysPerWeek === 0,
      `day ${day} disagreed about whether the pack comes`,
    );
  }
});

test('the fire wants more, the forest gives less, and the pack grows — forever', () => {
  // Endless means no ceiling on the pressure. A cap anywhere here would make a
  // deep run comfortable, and "how far you got" would stop meaning anything.
  const late = TUNING.daysPerWeek * 20;
  assert.ok(fuelFor(late) > fuelFor(1), 'the fire stopped getting hungrier');
  assert.ok(packFor(late) > packFor(1), 'the pack stopped growing');
  assert.ok(gatherYield(late) < gatherYield(1), 'the forest never thinned');
  // Gathering has a floor, though — an endless game must not reach a week
  // where an action returns nothing and the run is over regardless of play.
  assert.ok(gatherYield(late) >= TUNING.minWoodPerGather);
  // Bears are capped, because an unbounded bear rate would eventually make
  // hunting suicide and starving the only ending.
  assert.ok(bearChance(late) <= TUNING.bearMaxChance);
});

// --- The scarcity itself ---------------------------------------------------

test('THE OPENING PAYS FOR ITSELF AND THEN NOTHING DOES', () => {
  // This is the inequality the design rests on, checked directly rather than
  // inferred from how bots happen to do.
  //
  // The shape is deliberate and worth stating, because it is not "every week
  // is a loss". Weeks one and two show a surplus — that is the run-up, the
  // stretch where a player is still learning which action does what and can
  // afford to spend it badly. From week three onward a week's honest income
  // cannot cover both the fire and the wall it needs, and never can again.
  //
  //   week 1  +45     week 4  -71     week 8  -189
  //   week 2  +18     week 5  -85     week 12 -263
  //   week 3  -17     week 6  -128
  //
  // Median survival is five weeks, so the squeeze arrives in the middle of a
  // run rather than at the end of one — which is the point. A player is
  // spending a stockpile they built while it was easy, and the stockpile is
  // finite.
  for (const week of [1, 2]) {
    assert.ok(
      weekBudget(week).slack > 0,
      `week ${week} was already underwater — there is no run-up to learn in`,
    );
  }
  for (const week of [3, 4, 5, 8, 12]) {
    const b = weekBudget(week);
    assert.ok(
      b.slack < 0,
      `week ${week} paid for itself with ${b.slack} to spare — the choice is gone`,
    );
  }
});

test('and it only gets worse, so a stockpile buys time and nothing else', () => {
  let previous = Infinity;
  for (let week = 1; week <= 12; week++) {
    const { slack } = weekBudget(week);
    assert.ok(slack < previous, `week ${week} was no worse than week ${week - 1}`);
    previous = slack;
  }
});

test('the budget prices TIME, not just wood — hunting and building cost actions', () => {
  const b = weekBudget(1);
  assert.equal(b.actions, TUNING.actionsPerDay * TUNING.daysPerWeek);
  assert.ok(b.hunts > 0, 'nobody had to eat');
  assert.ok(b.builds > 0, 'the wall built itself');
  assert.equal(b.gathers, b.actions - b.hunts - b.builds);
});

// --- The rules -------------------------------------------------------------

test('a day is three actions and then it is over', () => {
  const camp = new Camp();
  assert.equal(camp.actionsLeft, TUNING.actionsPerDay);
  for (let i = 0; i < TUNING.actionsPerDay; i++) assert.ok(camp.act(ACTION.GATHER));
  assert.equal(camp.actionsLeft, 0);
  assert.equal(camp.act(ACTION.GATHER), null, 'a fourth action was allowed');
});

test('ONE WALL A DAY — the cap that stops hoarding beating commitment', () => {
  // Without this, wall decay makes building late strictly better than building
  // early: hoard all week, raise the whole wall on day seven, and nothing is
  // ever committed. A hoarding bot outlasted the careful one before this went
  // in, which is the tension not existing.
  const camp = new Camp();
  camp.wood = 500;
  assert.equal(camp.act(ACTION.BUILD).built, TUNING.wallPerBuild);
  assert.equal(camp.act(ACTION.BUILD).alreadyBuilt, true, 'built twice in one day');
  camp.endDay();
  assert.equal(camp.act(ACTION.BUILD).built, TUNING.wallPerBuild, 'the cap never reset');
});

test('deciding to build without the wood still spends the action', () => {
  // The cost of not looking. A free retry would make the readout decorative.
  const camp = new Camp();
  camp.wood = TUNING.woodPerBuild - 1;
  const before = camp.actionsLeft;
  const r = camp.act(ACTION.BUILD);
  assert.equal(r.short, true);
  assert.equal(camp.actionsLeft, before - 1);
});

test('the night burns first and fights second, so warmth is paid for in wall', () => {
  // Order matters: a camp that burns its last wood to stay warm meets the pack
  // behind whatever wall it already had. That is the choice, made concrete.
  const camp = new Camp();
  camp.day = TUNING.daysPerWeek;      // wolf night
  camp.wood = camp.fuelTonight;       // exactly enough to be warm, none spare
  camp.meat = TUNING.foodPerNight;
  camp.wall = 0;
  const night = camp.endDay();
  assert.equal(night.froze, false);
  assert.equal(night.wolves, true);
  assert.equal(night.breached, night.packStrength, 'a bare camp took no bite');
});

test('the wall absorbs the pack one for one, and takes the hit either way', () => {
  const camp = new Camp();
  camp.day = TUNING.daysPerWeek;
  camp.wood = 999;
  camp.meat = 999;
  camp.wall = packFor(camp.day) + 20;
  const before = camp.wall;
  const night = camp.endDay();
  assert.equal(night.breached, 0, 'a wall taller than the pack still let them in');
  assert.ok(camp.wall < before, 'the wall came through the night untouched');
});

test('readiness is the readout, and it is honest about decay', () => {
  // A player has to be able to see on day three that day seven is already
  // lost. That means readiness must count the nights of rot between now and
  // then, not just today's wall against today's pack.
  const camp = new Camp();
  camp.wall = camp.comingPack;
  assert.ok(
    camp.readiness < 0,
    'a wall exactly the size of the pack read as ready six nights early',
  );
  camp.wall = camp.comingPack + camp.daysToWolves * TUNING.wallDecayPerNight;
  assert.equal(camp.readiness, 0, 'readiness did not price the rot exactly');
});

test('a warm, fed, unbreached night mends — so careful play can pull ahead', () => {
  const camp = new Camp();
  camp.health = 50;
  camp.wood = 999;
  camp.meat = 999;
  const night = camp.endDay();
  assert.equal(night.healed, TUNING.healPerGoodNight);
  // But only when everything went right.
  camp.wood = 0;
  const bad = camp.endDay();
  assert.equal(bad.froze, true);
  assert.equal(bad.healed, undefined, 'a freezing night still healed');
});

test('weeks survived is the score, and it only counts whole ones', () => {
  const camp = new Camp();
  assert.equal(camp.weeksSurvived, 0);
  camp.day = TUNING.daysPerWeek;      // the seventh day, not yet survived
  assert.equal(camp.weeksSurvived, 0);
  camp.day = TUNING.daysPerWeek + 1;  // through it
  assert.equal(camp.weeksSurvived, 1);
});

// --- The claim, played out -------------------------------------------------

test('THE TWO ONE-SIDED STRATEGIES FAIL IN OPPOSITE WAYS', () => {
  // This is the test the whole design is for. `fortify` builds whenever it
  // can; `warm` never builds at all. If the choice is real, one of them
  // freezes and the other gets eaten. If they died the same way, wood would
  // not really be dual-purpose and the game would be a chore list wearing a
  // coat.
  const fortify = causeOfDeath('fortify', SEEDS, withSeed);
  const warm = causeOfDeath('warm', SEEDS, withSeed);

  const share = (r, cause) => (r.causes[cause] ?? 0) / SEEDS;

  assert.ok(
    share(fortify, END.FROZE) > 0.5,
    `the wall-first camp froze only ${Math.round(share(fortify, END.FROZE) * 100)}% of the time: ${JSON.stringify(fortify.causes)}`,
  );
  assert.ok(
    share(warm, END.WOLVES) > 0.5,
    `the fire-first camp was eaten only ${Math.round(share(warm, END.WOLVES) * 100)}% of the time: ${JSON.stringify(warm.causes)}`,
  );
  // And neither of them is dying of "I didn't gather enough" — starvation is
  // the chore-list failure and it should be rare.
  for (const [name, r] of [['fortify', fortify], ['warm', warm]]) {
    assert.ok(
      share(r, END.STARVED) < 0.2,
      `${name} mostly starved, which is the failure the design is meant to avoid: ${JSON.stringify(r.causes)}`,
    );
  }
});

test('and the camp that funds both outlasts every camp that funds one', () => {
  const weeks = {};
  for (const strategy of STRATEGIES) {
    weeks[strategy] = summarise(causeOfDeath(strategy, SEEDS, withSeed).weeks);
  }
  for (const strategy of ['fortify', 'warm', 'hoarder']) {
    assert.ok(
      weeks.balanced.median > weeks[strategy].median,
      `balanced (${weeks.balanced.median}) did not beat ${strategy} (${weeks[strategy].median})`,
    );
  }
});

test('HOARDING DOES NOT BEAT COMMITTING — the one-build cap earning its keep', () => {
  // Stated separately from the table above because it is the specific failure
  // the cap was added to fix, and it would come straight back if the cap were
  // ever loosened.
  const hoarder = summarise(causeOfDeath('hoarder', SEEDS, withSeed).weeks);
  const balanced = summarise(causeOfDeath('balanced', SEEDS, withSeed).weeks);
  assert.ok(
    balanced.median > hoarder.median,
    `leaving the wall to the last night matched playing it properly (${hoarder.median} vs ${balanced.median})`,
  );
});

test('nobody survives forever — the endless pressure really is unbounded', () => {
  for (const strategy of STRATEGIES) {
    const runs = [];
    for (let seed = 1; seed <= 12; seed++) {
      withSeed(seed, () => runs.push(runOnce(strategy)));
    }
    assert.ok(
      runs.every((r) => !r.alive),
      `${strategy} solved winter, which means the escalation has a ceiling`,
    );
  }
});

test('the tuning is live: a hungrier fire shortens every run', () => {
  // Convention 3 — a test must be able to clone the tuning, change one figure,
  // and see the game change. If this passed with a constant restated somewhere
  // it would be measuring a copy of the game rather than the game.
  const harsh = { ...TUNING, fuelBase: TUNING.fuelBase + 6 };
  const normal = summarise(causeOfDeath('balanced', 30, withSeed).weeks);
  const colder = summarise(causeOfDeath('balanced', 30, withSeed, harsh).weeks);
  assert.ok(
    colder.mean < normal.mean,
    `a fire wanting six more logs a night changed nothing (${colder.mean} vs ${normal.mean})`,
  );
});
