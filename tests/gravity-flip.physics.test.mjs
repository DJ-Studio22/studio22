// tests/gravity-flip.physics.test.mjs
//
// The invariant the whole game rests on: a flip always costs the same number
// of COLUMNS of ground, at every speed, forever. rooms.js authors every room
// against that figure, so if the physics drift the rooms silently stop being
// passable — and the player cannot see that happening. They just start dying
// to rooms they used to clear.
//
// This file imports games/gravity-flip/motion.js. It does not restate a single
// constant, and that is deliberate: the first version of this check restated
// them, passed happily, and was measuring a copy of the game rather than the
// game. See tests/README.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_SPEED, FLIP_COLUMNS, FLIP_TRAVEL, MAX_STEP_FRACTION, TILE,
  flipColumns, gravityAt, maxFallAt, speedAt,
} from '../games/gravity-flip/motion.js';

const DT = 1 / 60;

/**
 * Integrates one full flip exactly the way update() does — semi-implicit
 * Euler at a fixed 1/60, sliced so no slice travels more than a fraction of a
 * tile on either axis. Returns the ground covered and the worst single step.
 */
function simulateFlip(roomsCleared, { substep = true } = {}) {
  const gravity = gravityAt(roomsCleared);
  const maxFall = maxFallAt(roomsCleared);
  const speed = speedAt(roomsCleared);

  let y = 0;
  let vy = 0;
  let x = 0;
  let worstVertical = 0;
  let worstHorizontal = 0;
  let ticks = 0;

  while (y < FLIP_TRAVEL && ticks < 100000) {
    ticks++;
    const verticalTravel = Math.abs(vy) * DT + gravity * DT * DT;
    const forwardTravel = speed * DT;
    const slices = substep
      ? Math.max(1, Math.ceil(Math.max(verticalTravel, forwardTravel) / (TILE * MAX_STEP_FRACTION)))
      : 1;
    const h = DT / slices;

    for (let i = 0; i < slices; i++) {
      vy = Math.min(vy + gravity * h, maxFall);
      const dy = vy * h;
      const dx = speed * h;
      worstVertical = Math.max(worstVertical, Math.abs(dy));
      worstHorizontal = Math.max(worstHorizontal, dx);
      y += dy;
      x += dx;
      if (y >= FLIP_TRAVEL) break;
    }
  }
  return { columns: x / TILE, worstVertical, worstHorizontal };
}

// Room 600 is far past anything a person will reach. It is here because the
// escalation has no ceiling, so the invariant has to hold where nobody is
// watching as well as where they are.
const RUN_LENGTHS = [0, 25, 50, 100, 150, 300, 600];

test('the closed form agrees with rooms.js and stays inside its budget', () => {
  const columns = flipColumns();
  assert.ok(
    columns <= FLIP_COLUMNS,
    `a flip costs ${columns.toFixed(2)} columns but rooms.js authors for ${FLIP_COLUMNS}; `
    + 'rooms at the minimum spacing are no longer passable',
  );
});

test('a flip costs the same ground at every speed', () => {
  const measured = RUN_LENGTHS.map((rooms) => simulateFlip(rooms).columns);

  for (const [i, columns] of measured.entries()) {
    assert.ok(
      columns <= FLIP_COLUMNS,
      `at room ${RUN_LENGTHS[i]} a flip costs ${columns.toFixed(2)} columns, over the budget of ${FLIP_COLUMNS}`,
    );
  }

  // The point is not just that each is under budget but that they are all the
  // SAME — that is what gravity scaling with the square of speed buys.
  const spread = Math.max(...measured) - Math.min(...measured);
  assert.ok(spread < 0.15, `flip cost varies by ${spread.toFixed(3)} columns across speeds`);
});

test('speed and gravity scale together, so the arc keeps its shape', () => {
  for (const rooms of RUN_LENGTHS) {
    const ratio = speedAt(rooms) / BASE_SPEED;
    // g must grow as v^2 for fall time to shrink as 1/v.
    assert.ok(
      Math.abs(gravityAt(rooms) / gravityAt(0) - ratio * ratio) < 1e-9,
      `gravity at room ${rooms} does not track speed squared`,
    );
  }
});

test('no movement slice can skip a tile, at any run length', () => {
  for (const rooms of RUN_LENGTHS) {
    const { worstVertical, worstHorizontal } = simulateFlip(rooms);
    assert.ok(
      worstVertical < TILE,
      `at room ${rooms} a slice falls ${worstVertical.toFixed(1)}px through a ${TILE}px tile`,
    );
    assert.ok(
      worstHorizontal < TILE,
      `at room ${rooms} a slice advances ${worstHorizontal.toFixed(1)}px through a ${TILE}px tile`,
    );
  }
});

test('without substepping it would tunnel — the guard is load-bearing', () => {
  // Proves the substepping is doing real work rather than being decoration:
  // the same integration without it passes straight through solid tiles well
  // inside the range a good run reaches.
  const offenders = RUN_LENGTHS.filter((rooms) => {
    const { worstVertical } = simulateFlip(rooms, { substep: false });
    return worstVertical >= TILE;
  });
  assert.ok(
    offenders.length > 0,
    'un-substepped movement no longer tunnels; if the physics changed, this test has stopped meaning anything',
  );
});
