// tests/ballast.hold.test.mjs
//
// Ballast's claim is that a crate is a WEIGHT, not just a shape. The two
// things that have to be true for that to be a game rather than a decoration:
//
//   1. The list is RECOVERABLE. Weight on the high side always brings her
//      back, from any state, with no hysteresis. A list you cannot undo is a
//      countdown wearing a mechanic's clothes.
//   2. Managing it is WORTH SOMETHING. Two bots play the same seeded crate
//      sequences with the same stacking brain; only one of them looks at the
//      list. If they score alike, the twist is not carrying its weight.
//
// The second one has already earned its place twice — see the notes on
// SHAPES and TUNING.slideAt in hold.js. Both of those rules exist because
// this file said the game did not work without them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLS, END, Hold, ROWS, SHAPES, TUNING,
  centreOfGravity, crateTonnes, emptyGrid, listOf, momentOf, rotate, rotations, tonnesIn,
} from '../games/ballast/hold.js';
import { runOnce } from './helpers/ballast-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// --- The crates -----------------------------------------------------------

test('no crate is four cells — the set is deliberately not the standard seven', () => {
  for (const s of SHAPES) {
    assert.notEqual(s.cells.length, 4, `${s.id} is a tetromino, which the set rules out`);
    assert.ok(s.cells.length >= 1 && s.cells.length <= 5, `${s.id} is an odd size`);
  }
});

test('every crate is one connected piece', () => {
  for (const s of SHAPES) {
    const key = ([x, y]) => `${x},${y}`;
    const all = new Set(s.cells.map(key));
    const seen = new Set([key(s.cells[0])]);
    const queue = [s.cells[0]];
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = [x + dx, y + dy];
        if (all.has(key(n)) && !seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
      }
    }
    assert.equal(seen.size, s.cells.length, `${s.id} is in two pieces`);
  }
});

test('the weights are genuinely bimodal, which is what stops them averaging out', () => {
  const perCrate = SHAPES.map(crateTonnes);
  const heaviest = Math.max(...perCrate);
  const lightest = Math.min(...perCrate);
  // A modest spread was tried and measured useless: random imbalance grows as
  // the square root of the crate count while the total grows as the count, so
  // a narrow spread self-corrects and the list never becomes a decision.
  assert.ok(heaviest / lightest >= 8, `spread of ${lightest}-${heaviest}t is too narrow to matter`);
});

test('rotation normalises back to the origin and comes full circle', () => {
  for (const s of SHAPES) {
    let cells = s.cells;
    for (let i = 0; i < 4; i++) {
      cells = rotate(cells);
      assert.equal(Math.min(...cells.map((c) => c[0])), 0, `${s.id} drifted off the x origin`);
      assert.equal(Math.min(...cells.map((c) => c[1])), 0, `${s.id} drifted off the y origin`);
    }
    const sort = (cs) => [...cs].sort((a, b) => a[0] - b[0] || a[1] - b[1]).join(';');
    assert.equal(sort(cells), sort(s.cells), `${s.id} did not return after four turns`);
  }
});

test('rotations() reports only the distinct ones', () => {
  const single = rotations([[0, 0]]);
  assert.equal(single.length, 1, 'a one-cell crate has one orientation');
  const bar = rotations([[0, 0], [1, 0], [2, 0]]);
  assert.equal(bar.length, 2, 'a bar has two');
  const cross = rotations(SHAPES.find((s) => s.id === 'cross').cells);
  assert.equal(cross.length, 1, 'a plus has one');
});

// --- The list -------------------------------------------------------------

test('an empty hold and a symmetric hold both sit level', () => {
  assert.equal(listOf(emptyGrid()), 0);

  const g = emptyGrid();
  for (let x = 0; x < COLS; x++) g[ROWS - 1][x] = 5;
  assert.ok(Math.abs(listOf(g)) < 1e-9, 'an evenly loaded row is not level');
});

test('weight to port lists to port, and the mirror lists exactly as far', () => {
  const port = emptyGrid();
  port[ROWS - 1][0] = 26;
  const starboard = emptyGrid();
  starboard[ROWS - 1][COLS - 1] = 26;

  assert.ok(listOf(port) < 0, 'weight to port did not list to port');
  assert.ok(listOf(starboard) > 0, 'weight to starboard did not list to starboard');
  assert.ok(
    Math.abs(listOf(port) + listOf(starboard)) < 1e-9,
    'the hull is not symmetric — the same load lists further one way than the other',
  );
});

test('THE LIST IS RECOVERABLE — weight on the high side always brings her back', () => {
  // The property the whole game rests on. Load her hard over, then add cargo
  // to the high side one cell at a time and watch the list come back
  // MONOTONICALLY. Any step that went the wrong way would be a hull the
  // player cannot argue with.
  const g = emptyGrid();
  for (let y = ROWS - 1; y >= ROWS - 5; y--) for (let x = 0; x < 3; x++) g[y][x] = 8;

  let previous = listOf(g);
  assert.ok(previous < -TUNING.shipAt, `expected her well over, got ${previous.toFixed(1)}deg`);

  let steps = 0;
  for (let y = ROWS - 1; y >= ROWS - 5; y--) {
    for (let x = COLS - 1; x >= COLS - 3; x--) {
      g[y][x] = 8;
      const now = listOf(g);
      assert.ok(now > previous, `adding to the high side made the list worse at (${x},${y})`);
      previous = now;
      steps++;
    }
  }
  assert.ok(previous > -TUNING.shipAt, 'she never came back inside the threshold');
  assert.ok(steps >= 10, 'the walk was too short to prove anything');
});

test('cargo up in the air is more dangerous than the same cargo on the floor', () => {
  const low = emptyGrid();
  low[ROWS - 1][0] = 26;
  const high = emptyGrid();
  high[0][0] = 26;

  assert.ok(centreOfGravity(high) > centreOfGravity(low));
  assert.ok(
    Math.abs(listOf(high)) > Math.abs(listOf(low)),
    'a high centre of gravity did not make her tender',
  );
});

test('the list cannot exceed the hull she is physically able to reach', () => {
  const g = emptyGrid();
  for (let y = 0; y < ROWS; y++) g[y][0] = 26;
  assert.ok(Math.abs(listOf(g)) <= TUNING.maxList + 1e-9);
});

test('moment and tonnage are the plain sums they claim to be', () => {
  const g = emptyGrid();
  g[ROWS - 1][0] = 10;   // 3.5 columns to port
  g[ROWS - 1][7] = 4;    // 3.5 columns to starboard
  assert.equal(tonnesIn(g), 14);
  assert.ok(Math.abs(momentOf(g) - (10 * -3.5 + 4 * 3.5)) < 1e-9);
});

// --- The water ------------------------------------------------------------

test('she ships water over the threshold and pumps it out under it', () => {
  const hold = new Hold();
  hold.crate = null;
  for (let y = ROWS - 1; y >= ROWS - 6; y--) for (let x = 0; x < 3; x++) hold.grid[y][x] = 26;
  assert.ok(Math.abs(hold.list) > TUNING.shipAt, 'the fixture is not actually over');

  // A short step: this fixture is far enough over that a whole second of it
  // founders her outright, and a foundered hull stops stepping.
  hold.step(0.2);
  const shipped = hold.water;
  assert.ok(shipped > 0, 'a hull well over shipped no water');
  assert.ok(hold.running, 'the fixture sank before the pump could be tested');

  // Level her up and the pump gets to work.
  hold.grid = emptyGrid();
  hold.step(1);
  assert.ok(hold.water < shipped, 'the bilge pump did nothing on a level hull');
});

test('the pump can clear everything a recoverable list put aboard', () => {
  // Water that could not be pumped out would make an early mistake fatal
  // twenty crates later, which is the worst shape a rule can have in a game
  // about recovering.
  const hold = new Hold();
  hold.crate = null;
  hold.water = 0.8;
  hold.grid = emptyGrid();
  for (let i = 0; i < 60; i++) hold.step(1);
  assert.equal(hold.water, 0, 'a level hull never dried out');
  assert.ok(hold.running, 'she foundered while level and pumping');
});

test('enough water founders her, and says so', () => {
  const hold = new Hold();
  hold.crate = null;
  for (let y = 0; y < ROWS; y++) hold.grid[y][0] = 26;
  for (let i = 0; i < 400 && hold.running; i++) hold.step(1 / 60 * 10);
  assert.equal(hold.running, false);
  assert.equal(hold.reason, END.FOUNDERED);
  assert.equal(hold.water, 1);
});

// --- Battening down -------------------------------------------------------

test('a packed row slides out of the BOTTOM and everything above drops', () => {
  const hold = new Hold();
  hold.crate = null;
  // A full row, with one marker crate sitting on top of it.
  for (let x = 0; x < COLS; x++) hold.grid[ROWS - 1][x] = 3;
  hold.grid[ROWS - 2][2] = 26;

  const stowed = hold.batten();
  assert.equal(stowed, 1, 'the packed row did not batten down');
  assert.equal(hold.tonnage, 3 * COLS, 'tonnage stowed is not the row that went out');
  assert.equal(hold.grid[ROWS - 1][2], 26, 'the cargo above did not drop into the space');
  assert.equal(hold.grid[ROWS - 2][2], 0);
});

test('several packed rows all go, and the count is right', () => {
  const hold = new Hold();
  hold.crate = null;
  for (let y = ROWS - 3; y < ROWS; y++) for (let x = 0; x < COLS; x++) hold.grid[y][x] = 2;
  assert.equal(hold.batten(), 3);
  assert.equal(hold.tonnage, 2 * COLS * 3);
  assert.equal(tonnesIn(hold.grid), 0, 'the hold should be empty');
});

test('stowing a row lowers the centre of gravity, so it pays twice', () => {
  const hold = new Hold();
  hold.crate = null;
  for (let x = 0; x < COLS; x++) hold.grid[ROWS - 1][x] = 3;
  for (let x = 0; x < 3; x++) hold.grid[ROWS - 2][x] = 26;

  const before = centreOfGravity(hold.grid);
  hold.batten();
  assert.ok(centreOfGravity(hold.grid) < before, 'the cargo above did not end up lower');
});

// --- The slide ------------------------------------------------------------

test('a crate lands where it was aimed on a level hull', () => {
  const hold = new Hold();
  hold.grid = emptyGrid();
  assert.equal(hold.slideDirection(), 0, 'a level hull is sliding cargo');

  hold.crate.x = 2;
  hold.crate.cells = [[0, 0]];
  hold.crate.forms = [[[0, 0]]];
  hold.slam();
  assert.ok(hold.grid[ROWS - 1][2] > 0, 'the crate did not land where it was put');
});

test('a crate slides downhill on a hull that is already over', () => {
  const hold = new Hold();
  // Load her to starboard, clear of the columns the test crate will use.
  for (let y = ROWS - 1; y >= ROWS - 4; y--) hold.grid[y][COLS - 1] = 26;
  assert.ok(hold.list > TUNING.slideAt, `expected her over to starboard, got ${hold.list.toFixed(1)}`);
  assert.equal(hold.slideDirection(), 1);

  hold.crate.x = 2;
  hold.crate.cells = [[0, 0]];
  hold.crate.forms = [[[0, 0]]];
  hold.slam();
  assert.equal(hold.grid[ROWS - 1][2], 0, 'the crate stayed where it was aimed on a listing hull');
  assert.ok(hold.grid[ROWS - 1][3] > 0, 'the crate did not slide downhill');
});

// --- The hold itself ------------------------------------------------------

test('a hold with no room left ends the run and says so', () => {
  const hold = new Hold();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) hold.grid[y][x] = 1;
  hold.spawn();
  assert.equal(hold.running, false);
  assert.equal(hold.reason, END.FULL);
});

test('crates fall faster the more has been stowed', () => {
  const hold = new Hold();
  const slow = hold.fallSpeed;
  hold.tonnage = 800;
  assert.ok(hold.fallSpeed > slow, 'the game never speeds up');
});

// --- What the twist is actually worth -------------------------------------

test('MANAGING THE LIST IS WORTH SOMETHING — the twist is not decoration', () => {
  // Two bots, the same stacking brain, the same seeded crate sequences. The
  // only difference is whether they look at the list at all.
  const packer = [];
  const mate = [];
  let packerSank = 0;
  let mateSank = 0;

  for (let seed = 1; seed <= 30; seed++) {
    withSeed(seed, () => {
      const r = runOnce('packer');
      packer.push(r.tonnage);
      if (r.reason === END.FOUNDERED) packerSank++;
    });
    withSeed(seed, () => {
      const r = runOnce('mate');
      mate.push(r.tonnage);
      if (r.reason === END.FOUNDERED) mateSank++;
    });
  }

  const p = summarise(packer);
  const m = summarise(mate);

  assert.ok(
    m.median > p.median * 1.4,
    `weighing the list bought almost nothing: packer ${p.median}t vs mate ${m.median}t`,
  );
  assert.ok(
    packerSank / 30 > 0.35,
    `only ${packerSank}/30 careless voyages foundered — the water is not a real threat`,
  );
  assert.ok(
    mateSank <= packerSank / 3,
    `the careful bot foundered ${mateSank}/30 times — the list is not actually manageable`,
  );
});

test('tuning is data a test can override', () => {
  const calm = { ...TUNING, shipRate: 0, slideAt: 999 };
  const play = (t) => withSeed(12, () => runOnce('packer', t));
  assert.equal(play(calm).reason, END.FULL, 'a hull that cannot ship water still sank');
  assert.ok(play(calm).tonnage > play(TUNING).tonnage, 'removing the hazard changed nothing');
});
