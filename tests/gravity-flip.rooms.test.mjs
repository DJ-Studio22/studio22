// tests/gravity-flip.rooms.test.mjs
//
// The room library checks itself at load — rooms.js exports `roomProblems`,
// which is empty when every room satisfies the three rules it is authored to.
// This asserts that it is empty, and separately exercises the sequencer.
//
// Writing that checker found several rooms that were genuinely impassable, so
// the useful thing is not the checker existing but it staying green.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FLIP_COLUMNS, ROOMS, ROOM_COLS, ROOM_ROWS, pickRoom, readRoom, roomProblems,
} from '../games/gravity-flip/rooms.js';

test('every authored room passes the file’s own rules', () => {
  assert.deepEqual(roomProblems, [], `rooms.js reported:\n  - ${roomProblems.join('\n  - ')}`);
});

test('the library covers every tier', () => {
  for (const tier of [0, 1, 2, 3]) {
    const count = ROOMS.filter((r) => r.tier === tier).length;
    assert.ok(count > 0, `tier ${tier} has no rooms`);
  }
  assert.ok(ROOMS.length >= 12, `only ${ROOMS.length} rooms; the deck repeats too soon`);
});

test('room ids are unique', () => {
  const ids = ROOMS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every room is the declared size', () => {
  for (const room of ROOMS) {
    assert.equal(room.grid.length, ROOM_ROWS, `${room.id} row count`);
    for (const [i, row] of room.grid.entries()) {
      assert.equal(row.length, ROOM_COLS, `${room.id} row ${i} width`);
    }
  }
});

test('no column is blocked on both surfaces — there is always somewhere to be', () => {
  for (const room of ROOMS) {
    const { floorOk, ceilOk } = readRoom(room);
    for (let c = 0; c < ROOM_COLS; c++) {
      assert.ok(floorOk[c] || ceilOk[c], `${room.id} column ${c} is blocked top and bottom`);
    }
  }
});

test('the doorway of every room is clear, so an entry is never an ambush', () => {
  for (const room of ROOMS) {
    const { crossable } = readRoom(room);
    for (let c = 0; c < FLIP_COLUMNS; c++) {
      assert.ok(crossable[c], `${room.id} column ${c} is not clear`);
    }
  }
});

test('the sequencer never leaks a harder tier and never repeats immediately', () => {
  let previous = null;
  for (let i = 0; i < 4000; i++) {
    const tier = i % 4;
    const room = pickRoom(tier, previous);
    assert.ok(room.tier <= tier, `${room.id} (tier ${room.tier}) served at tier ${tier}`);
    if (previous) assert.notEqual(room.id, previous.id, `${room.id} served twice running`);
    previous = room;
  }
});

test('a tier-0 opening only ever draws from tier 0', () => {
  for (let i = 0; i < 500; i++) {
    assert.equal(pickRoom(0, null).tier, 0);
  }
});
