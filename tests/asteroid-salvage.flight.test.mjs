// tests/asteroid-salvage.flight.test.mjs
//
// Asteroid Salvage rests on a claim that upgrade games almost always get
// wrong:
//
//   THE THREE UPGRADES COMPETE. There is no order that is simply correct.
//
// That is the trap the real-time Winter prototype was rejected for: three
// sinks on one pool, one of them pays back fastest, every run buys the same
// thing first, and the shop is a shopping list with a price on it. Hoping is
// not a strategy — it has to be built in and then measured.
//
// So the bots differ ONLY in what they buy. They fly identically, dodge
// identically, and are equally greedy, because the claim is about the shop and
// a clever pilot would paper over a bad build.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  END, Flight, TUNING, UPGRADE, UPGRADES, accelerationAt, collectAt, costOf,
  fieldShape, hullAt, massAt, thrustAt,
} from '../games/asteroid-salvage/flight.js';
import { ORDERS, SKILLS, runOnce } from './helpers/salvage-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

const SEEDS = 30;

// --- The interference -----------------------------------------------------

test('ARMOUR SLOWS YOU DOWN — the line that makes the upgrades compete', () => {
  // Acceleration is thrust over mass, and hull and cargo are made of
  // something. Without this the three upgrades would simply stack and the best
  // order would be whichever pays back fastest.
  const stock = accelerationAt(0, 0, 0);
  const armoured = accelerationAt(0, 3, 0);
  const laden = accelerationAt(0, 0, 3);
  assert.ok(armoured < stock, 'three levels of hull cost nothing to shift');
  assert.ok(laden < stock, 'three cargo bays cost nothing to shift');

  // And the engine has to be able to ANSWER it, or armour would just be a
  // trap rather than a trade. Three levels of hull nearly triples the mass, so
  // three of engine recovers most of it and the full six overtakes stock — a
  // heavy ship is a slow ship until you pay to make it fast again, which is
  // the whole shape of the decision.
  assert.ok(accelerationAt(3, 3, 0) > accelerationAt(0, 3, 0) * 1.5,
    'the engine barely answers armour, so armour is a trap rather than a trade');
  assert.ok(accelerationAt(TUNING.maxLevel, 3, 0) > stock,
    'even a maxed engine cannot outrun three levels of hull');
});

test('and every level of everything does something', () => {
  assert.ok(thrustAt(1) > thrustAt(0));
  assert.ok(hullAt(1) > hullAt(0));
  assert.ok(collectAt(1) > collectAt(0));
  assert.ok(massAt(1, 0) > massAt(0, 0));
  assert.ok(massAt(0, 1) > massAt(0, 0));
});

test('a level bought late costs more than one bought early', () => {
  // Which is what makes the ORDER a decision rather than just the set. With
  // flat prices you would end a long run with the same ship whatever you did.
  assert.ok(costOf(3) > costOf(0));
  assert.ok(costOf(6) > costOf(3));
});

// --- The field ------------------------------------------------------------

test('a dense field and a fast field are different problems', () => {
  const dense = fieldShape(5, 0);
  const fast = fieldShape(5, 1);
  assert.ok(dense.rocks > fast.rocks, 'the dense field is not denser');
  assert.ok(fast.speed > dense.speed, 'the fast field is not faster');
  assert.equal(dense.name, 'Dense');
  assert.equal(fast.name, 'Fast');
});

test('and both axes escalate underneath the character, without a ceiling', () => {
  assert.ok(fieldShape(40, 0.5).rocks > fieldShape(1, 0.5).rocks);
  assert.ok(fieldShape(40, 0.5).speed > fieldShape(1, 0.5).speed);
  assert.ok(fieldShape(400, 0.5).rocks > fieldShape(40, 0.5).rocks, 'the escalation stops');
});

test('THE NEXT FIELD IS ANNOUNCED BEFORE THE SHOP CLOSES', () => {
  // The mechanism that makes buying for a field a decision rather than a
  // guess. The character used to be drawn on ENTERING the field, after the
  // shop had closed — so the only thing to buy against was the field just
  // flown, which predicts nothing, because the draw is independent. The bot
  // that "read the field" measured as no better than one buying blind, which
  // was correct and useless.
  withSeed(4, () => {
    const flight = new Flight();
    assert.ok(flight.nextShape, 'nothing is known about the next field');
    const promised = flight.nextShape;
    flight.left = 0;
    flight.step(1 / 60, {});
    assert.equal(flight.shopOpen, true);
    assert.equal(flight.nextShape, promised, 'the promise changed while the shop was open');
    flight.launch();
    assert.equal(flight.shape, promised, 'the field flown was not the one promised');
  });
});

// --- The shop -------------------------------------------------------------

test('buying takes the salvage and raises the level; being broke does not', () => {
  const flight = new Flight();
  flight.salvage = 0;
  assert.equal(flight.buy(UPGRADE.ENGINE), false, 'bought something with nothing');

  flight.salvage = 500;
  const before = flight.engine;
  assert.equal(flight.buy(UPGRADE.ENGINE), true);
  assert.equal(flight.engine, before + 1);
  assert.equal(flight.salvage, 500 - costOf(before));
});

test('hull bought in the shop is hull you actually have', () => {
  const flight = new Flight();
  flight.salvage = 500;
  const before = flight.hull;
  flight.buy(UPGRADE.HULL);
  assert.equal(flight.hull, before + TUNING.hullPerLevel,
    'the level went up but the ship did not get tougher');
});

test('nothing can be bought past its cap', () => {
  const flight = new Flight();
  flight.salvage = 100000;
  for (let i = 0; i < TUNING.maxLevel + 4; i++) flight.buy(UPGRADE.CARGO);
  assert.equal(flight.cargo, TUNING.maxLevel);
  assert.equal(flight.prices[UPGRADE.CARGO].maxed, true);
});

// --- Flying ---------------------------------------------------------------

test('a hit costs hull, and there is a moment before the next one can', () => {
  // Without the grace period a rock you are already inside eats the whole hull
  // in a second and a single mistake is the run.
  const flight = new Flight();
  // Past the opening grace, which is the other reason a hit might not land.
  flight.invulnerable = 0;
  flight.rocks = [{ x: flight.x, y: flight.y, r: 3, vx: 0, vy: 0 }];
  const before = flight.hull;
  flight.step(1 / 60, {});
  assert.equal(flight.hull, before - 1);
  flight.step(1 / 60, {});
  assert.equal(flight.hull, before - 1, 'the same rock hit twice in two frames');
  assert.ok(flight.invulnerable > 0);
});

test('the ship stops at the walls rather than wrapping', () => {
  // Being pinned against an edge is a position you can be manoeuvred into, and
  // most of the tension of a dense field is exactly that.
  const flight = new Flight();
  flight.rocks = [];
  for (let i = 0; i < 240; i++) flight.step(1 / 60, { x: 0, y: -1 });
  assert.ok(flight.y >= TUNING.shipRadius - 1e-6);
  assert.ok(flight.y <= TUNING.height - TUNING.shipRadius + 1e-6);
});

test('a run ends for a stated reason', () => {
  const flight = new Flight();
  flight.invulnerable = 0;
  flight.hull = 1;
  flight.rocks = [{ x: flight.x, y: flight.y, r: 3, vx: 0, vy: 0 }];
  flight.step(1 / 60, {});
  assert.equal(flight.running, false);
  assert.equal(flight.reason, END.WRECKED);
});

// --- The claim ------------------------------------------------------------

test('NO PURCHASE ORDER DOMINATES — the shop is not a shopping list', () => {
  // Three fixed orders, same pilot, same seeds. If one of them simply won, the
  // shop would be a menu with a correct answer on it.
  const banked = {};
  for (const skill of ['engineFirst', 'hullFirst', 'cargoFirst']) {
    banked[skill] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      withSeed(seed, () => banked[skill].push(runOnce(skill).banked));
    }
  }

  // Nobody wins more than half the seeds outright.
  const wins = { engineFirst: 0, hullFirst: 0, cargoFirst: 0 };
  for (let i = 0; i < SEEDS; i++) {
    let best = null;
    for (const skill of Object.keys(wins)) {
      if (!best || banked[skill][i] > banked[best][i]) best = skill;
    }
    wins[best]++;
  }
  for (const [skill, n] of Object.entries(wins)) {
    assert.ok(n < SEEDS * 0.5,
      `${skill} won ${n} of ${SEEDS} seeds — that is a shopping list, not a decision`);
    assert.ok(n > 0, `${skill} never won a single seed, so it is simply wrong`);
  }

  // And no order's median runs away from the others.
  const medians = Object.fromEntries(
    Object.entries(banked).map(([k, v]) => [k, summarise(v).median]),
  );
  const values = Object.values(medians);
  assert.ok(Math.max(...values) < Math.min(...values) * 1.6,
    `the orders are not close: ${JSON.stringify(medians)}`);
});

test('and READING THE ANNOUNCED FIELD BEATS ALL THREE', () => {
  // The other half. If knowing what is coming bought nothing, the field's
  // character would be decoration and the announcement a label.
  // Against the BEST fixed order individually, not against all three pooled.
  // Pooling and taking a median compares adaptive to a mixture that is mostly
  // the middling orders, which flatters it — and the claim is that reading the
  // announcement beats the best thing you could have decided in advance.
  const banked = { engineFirst: [], hullFirst: [], cargoFirst: [], adaptive: [] };
  // Eighty seeds, and that figure was chosen rather than picked. At forty the
  // adaptive margin sat inside the noise — cargoFirst came out ahead on one
  // sample and behind on the next — which would have made this a test that
  // passes or fails on the weather. At a hundred and fifty the ordering is
  // stable at 39 / 46 / 45 against 52; eighty is where it stops flipping.
  for (let seed = 1; seed <= 80; seed++) {
    for (const skill of Object.keys(banked)) {
      withSeed(seed, () => banked[skill].push(runOnce(skill).banked));
    }
  }
  const medians = Object.fromEntries(
    Object.entries(banked).map(([k, v]) => [k, summarise(v).median]),
  );
  const bestFixed = Math.max(
    medians.engineFirst, medians.hullFirst, medians.cargoFirst,
  );
  assert.ok(medians.adaptive > bestFixed,
    `buying for the field bought nothing: ${JSON.stringify(medians)}`);
});

test('the bots differ in what they buy and nothing else', () => {
  // If they flew differently the comparison above would be measuring piloting.
  for (const order of Object.values(ORDERS)) {
    assert.equal(new Set(order).size, UPGRADES.length, 'an order misses an upgrade');
  }
  const keys = new Set(Object.values(SKILLS).flatMap((s) => Object.keys(s)));
  assert.deepEqual([...keys].sort(), ['adapts', 'order']);
});

test('tuning is data a test can override', () => {
  // Convention 3. Make armour weightless and hull-first should pull ahead —
  // which is the failure the whole design is arranged to prevent.
  const weightless = { ...TUNING, hullMassPerLevel: 0, hullPerLevel: 4 };
  const normal = [];
  const broken = [];
  for (let seed = 1; seed <= 12; seed++) {
    withSeed(seed, () => normal.push(runOnce('hullFirst').banked));
    withSeed(seed, () => broken.push(runOnce('hullFirst', weightless).banked));
  }
  assert.ok(summarise(broken).median > summarise(normal).median,
    'free armour changed nothing, so the mass penalty is not live');
});
