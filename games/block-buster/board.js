// games/block-buster/board.js
//
// The well, and everything that happens to it when rows come out.
//
// Kept apart from game.js because this is the part of Block Buster with real
// rules in it — what counts as full, what a charged cell takes with it, and
// how the survivors fall — and none of it needs a canvas, an input device or a
// clock. Separating it means the rules can be reasoned about (and tested) on
// their own, and it keeps game.js to wiring, drawing and feel.
//
// A cell is a plain object: { tint, charged, dy, flash }.
//   tint    index into the current theme's block palette
//   charged this cell detonates its column when its row clears
//   dy      VISUAL offset in cells, used while a cascaded cell slides home
//   flash   1 down to 0 while the cell is being cleared
// An empty square is null.

export function createGrid(cols, rows) {
  return Array.from({ length: rows }, () => new Array(cols).fill(null));
}

export function makeCell(tint, charged = false) {
  return { tint, charged, dy: 0, flash: 0 };
}

// Rows with no gap in them, top to bottom.
export function fullRows(grid) {
  const found = [];
  for (let r = 0; r < grid.length; r++) {
    if (grid[r].every((cell) => cell)) found.push(r);
  }
  return found;
}

/**
 * The extra cells a clear takes because a charged cell was caught in it.
 *
 * A charged cell inside a clearing row detonates the whole COLUMN it sits in.
 * Returned as a list of [row, col] rather than folded into the row list,
 * because a column is a vertical cut through the stack: it scores per cell,
 * and it is what opens the holes that let a cascade chain.
 *
 * Rows already clearing are skipped so no cell is counted twice.
 */
export function chargedCells(grid, rows) {
  const clearing = new Set(rows);
  const columns = new Set();

  for (const r of rows) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c]?.charged) columns.add(c);
    }
  }

  const cells = [];
  for (const c of columns) {
    for (let r = 0; r < grid.length; r++) {
      if (clearing.has(r)) continue;
      if (grid[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

/**
 * Empties the given rows and cells. `onRemoved` is called for each one so the
 * caller can throw particles at it without this module knowing what a particle
 * is.
 */
export function removeCells(grid, rows, cells, onRemoved) {
  for (const r of rows) {
    for (let c = 0; c < grid[r].length; c++) {
      if (onRemoved && grid[r][c]) onRemoved(r, c, grid[r][c]);
      grid[r][c] = null;
    }
  }
  for (const [r, c] of cells) {
    if (onRemoved && grid[r][c]) onRemoved(r, c, grid[r][c]);
    grid[r][c] = null;
  }
}

/**
 * CASCADE GRAVITY — the mechanic the whole game is built on.
 *
 * Every surviving cell falls on its own until it lands on something, rather
 * than intact rows sliding down together. The difference is not cosmetic: a
 * row-shift can never produce a row that was not already full, so it can never
 * chain. Letting cells fall independently means a clear low in the stack can
 * drop three unrelated cells into a gap and complete a row nobody built, which
 * is the chain, which is the game.
 *
 * Each moved cell gets `dy` set to how far it fell, so the renderer can draw it
 * where it used to be and slide it home. The grid itself is already settled the
 * moment this returns — the animation never races the next full-row check.
 */
export function cascade(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  let moved = 0;

  for (let c = 0; c < cols; c++) {
    // `write` is the lowest free square in this column, walking upward.
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      const cell = grid[r][c];
      if (!cell) continue;
      if (write !== r) {
        cell.dy = write - r;
        grid[write][c] = cell;
        grid[r][c] = null;
        moved++;
      }
      write--;
    }
  }
  return moved;
}

export function isEmpty(grid) {
  return grid.every((row) => row.every((cell) => !cell));
}

/**
 * Pushes a junk row in underneath everything, with one gap in it.
 *
 * Returns false when the top row already held something, which means the stack
 * has been pushed out of the well and the run is over. Checking BEFORE the
 * shift is what stops a cell being silently deleted off the top.
 */
export function raiseGarbage(grid, tint, gapColumn) {
  if (grid[0].some((cell) => cell)) return false;

  const cols = grid[0].length;
  grid.shift();

  const row = new Array(cols).fill(null);
  for (let c = 0; c < cols; c++) {
    if (c === gapColumn) continue;
    const cell = makeCell(tint);
    // Drawn one cell low and rising, so a row arriving from below reads as
    // arriving rather than simply appearing.
    cell.dy = -1;
    row[c] = cell;
  }
  grid.push(row);
  return true;
}
