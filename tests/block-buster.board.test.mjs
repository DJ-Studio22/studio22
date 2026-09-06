// tests/block-buster.board.test.mjs
//
// The rules of the well: what counts as full, what a charged cell takes with
// it, and how the survivors fall.
//
// The cascade is the one worth testing hardest. A conventional falling-block
// game shifts intact rows down, which can never produce a row that was not
// already full, so it can never chain. Letting cells fall independently means
// a clear low in the stack can complete a row nobody built — and "the chain
// stopped chaining" is invisible in a screenshot.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cascade, chargedCells, createGrid, fullRows, isEmpty, makeCell,
  raiseGarbage, removeCells,
} from '../games/block-buster/board.js';

// A compact way to write a board: '.' empty, a digit is a tint, '*' is a
// charged cell. Reading the expected result back out the same way keeps the
// assertions legible.
const grid = (...rows) => rows.map((line) => [...line].map((ch) => (
  ch === '.' ? null : makeCell(ch === '*' ? 0 : Number(ch), ch === '*'))));

const show = (g) => g
  .map((row) => row.map((c) => (c ? (c.charged ? '*' : String(c.tint)) : '.')).join(''))
  .join('/');

test('fullRows finds only rows with no gap in them', () => {
  assert.deepEqual(fullRows(createGrid(4, 3)), []);
  assert.deepEqual(fullRows(grid('11.1', '1111', '....')), [1]);
  assert.deepEqual(fullRows(grid('1111', '1111', '..1.')), [0, 1]);
});

test('a charged cell in a clearing row takes its whole column', () => {
  const g = grid(
    '.1..',
    '.1..',
    '1*11',
  );
  assert.deepEqual(chargedCells(g, [2]).sort(), [[0, 1], [1, 1]]);
});

test('a clear with no charged cell takes nothing extra', () => {
  assert.deepEqual(chargedCells(grid('1111'), [0]), []);
});

test('survivors fall independently rather than as rows', () => {
  const g = grid(
    '1...',
    '1111',
    '...1',
  );
  removeCells(g, [1], []);
  cascade(g);

  assert.equal(show(g), '..../..../1..1');
  // The distance each cell fell is recorded so the renderer can slide it home.
  assert.equal(g[2][0].dy, 2);
});

test('the cascade completes a row that was not full before — the chain', () => {
  const g = grid(
    '1.11',
    '1111',
    '.1..',
  );
  removeCells(g, [1], []);
  cascade(g);

  // Nothing built this row: three unrelated cells fell into it.
  assert.deepEqual(fullRows(g), [2]);
  assert.equal(show(g), '..../..../1111');
});

test('a charged column can empty the board outright', () => {
  const g = grid(
    '.1..',
    '1*11',
  );
  const rows = fullRows(g);
  removeCells(g, rows, chargedCells(g, rows));
  cascade(g);

  assert.equal(isEmpty(g), true);
});

test('isEmpty is not fooled by a single cell', () => {
  assert.equal(isEmpty(createGrid(4, 3)), true);
  assert.equal(isEmpty(grid('...1', '....', '....')), false);
});

test('garbage rises when there is room, and refuses when there is not', () => {
  const g = grid('....', '.1..', '11.1');
  assert.equal(raiseGarbage(g, 7, 2), true);
  assert.equal(show(g), '.1../11.1/77.7');
  // Junk is drawn rising, so a row arriving from below reads as arriving.
  assert.equal(g[2][0].dy, -1);
});

test('garbage refuses rather than deleting a cell off the top', () => {
  const g = grid('1...', '....', '....');
  assert.equal(raiseGarbage(g, 7, 0), false);
  assert.equal(show(g), '1.../..../....');
});
