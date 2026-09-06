// games/block-buster/pieces.js
//
// The shape set, the rotation rule, and the bag that hands them out.
//
// WHY THIS IS NOT THE STANDARD SEVEN
// ----------------------------------
// The obvious set for a falling-block game is the seven four-cell shapes
// everybody already knows. This game deliberately does not use them, and the
// reason is not novelty for its own sake: a mixed-size set changes what the
// board asks of you. Three-cell pieces are a repair tool, five-cell pieces are
// a commitment, and having both in the same bag means every draw is a real
// decision about whether you are building or patching.
//
// So the set is nine shapes across three sizes:
//
//   3 cells   bar, elbow                  — the patch pieces
//   4 cells   square, tee, ell, zag       — the workhorses
//   5 cells   cup, plus, chair            — the awkward ones
//
// Four of the four-cell shapes overlap with shapes any block game would have,
// because there are only so many ways to join four squares. What is different
// is the set: there is no line-of-four, no S-and-Z pair, and no J-and-L pair.
// You cannot clear four rows at once with a piece, because no piece is four
// long, which is what pushes scoring toward the chain mechanic instead.
//
// ROTATION IS OURS TOO
// --------------------
// The well-known rotation system for this genre is a table of five candidate
// offsets per rotation per piece, tuned so that specific wall and floor kicks
// work. That table is the game it comes from, so this file does not use it.
//
// Instead: rotate the cells a quarter turn inside their own bounding box, then
// if the result overlaps something, SHOVE it — try one left, one right, two
// left, two right, then one up, and take the first that fits. Five candidates,
// the same five for every piece, no table. The practical difference is that
// this system will not perform the deep floor-kick tricks the tabled one is
// famous for. That is the intended trade: the pieces here are 3 to 5 cells and
// the board is ten wide, so a shove of two is enough to turn anything anywhere
// it reasonably should, and a player never has to learn a table to predict it.

import { shuffle } from '../../engine/util.js';

/**
 * Each shape is a list of [column, row] offsets, written with row 0 at the
 * TOP, which is the way they read on screen. Every shape is normalised so its
 * smallest column and smallest row are both 0.
 *
 * `tint` is an index into the active theme's block palette. Two shapes never
 * share a tint within a size class, so a glance at the colour tells you the
 * shape before you have read it.
 */
export const SHAPES = [
  // --- Three cells: the patch pieces ------------------------------------
  { id: 'bar', tint: 0, cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'elbow', tint: 1, cells: [[0, 0], [0, 1], [1, 1]] },

  // --- Four cells: the workhorses ---------------------------------------
  { id: 'square', tint: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: 'tee', tint: 3, cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: 'ell', tint: 4, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { id: 'zag', tint: 5, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },

  // --- Five cells: the awkward ones --------------------------------------
  { id: 'cup', tint: 6, cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'plus', tint: 7, cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: 'chair', tint: 8, cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
];

// The shove candidates, in the order they are tried. Straight left and right
// first because that is what a player expects from a rotation next to a wall;
// the single step up last, because lifting a piece is the most surprising
// outcome and should only happen when nothing else worked.
export const SHOVES = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
];

// Normalises a cell list back to the origin after a transform, so a piece's
// column position always means the same thing regardless of how many times it
// has been turned.
function normalise(cells) {
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

/**
 * One quarter turn clockwise, inside the shape's own bounding box.
 *
 * The transform is (x, y) -> (maxRow - y, x): the top row becomes the right
 * column. Normalising afterwards is what keeps a piece from wandering left
 * across repeated rotations.
 */
export function rotateCells(cells) {
  let maxY = 0;
  for (const [, y] of cells) if (y > maxY) maxY = y;
  return normalise(cells.map(([x, y]) => [maxY - y, x]));
}

/**
 * Every distinct orientation of a shape, precomputed at load.
 *
 * Turning four times always returns to the start, but a square returns after
 * one and a bar after two. Storing only the distinct ones means the square
 * genuinely does not move when you press rotate, rather than appearing to
 * rotate into an identical position — which reads as an input that did not
 * register.
 */
function orientationsOf(shape) {
  const seen = [];
  let cells = normalise(shape.cells);
  for (let i = 0; i < 4; i++) {
    const key = cells.map(([x, y]) => `${x},${y}`).sort().join('|');
    if (seen.some((o) => o.key === key)) break;
    seen.push({ key, cells });
    cells = rotateCells(cells);
  }
  return seen.map((o) => o.cells);
}

// Built once. Nine shapes with at most four orientations each is a trivial
// amount of work, but it is work that would otherwise happen on every
// rotation of every piece for the whole run.
export const ORIENTATIONS = new Map(
  SHAPES.map((shape) => [shape.id, orientationsOf(shape)]),
);

/**
 * The piece supply.
 *
 * A shuffled bag of all nine rather than independent random draws. Pure random
 * can hand you four five-cell pieces in a row, which is not difficulty, it is
 * just a bad hand — and it can starve you of the three-cell patches exactly
 * when the board most needs one. A bag guarantees you see every shape once
 * before any repeats, so a stack that goes wrong went wrong because of how you
 * played it.
 */
export class ShapeBag {
  #queue = [];

  next() {
    if (this.#queue.length === 0) this.#queue = shuffle(SHAPES.map((s) => s.id));
    const id = this.#queue.pop();
    return SHAPES.find((shape) => shape.id === id);
  }

  reset() {
    this.#queue = [];
  }
}
