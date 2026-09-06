// games/gravity-flip/motion.js
//
// The numbers a flip is made of, and the three functions that derive from
// them. No canvas, no input, no clock.
//
// WHY THESE ARE NOT IN game.js
// ----------------------------
// This game rests on one invariant: a flip always costs the same number of
// COLUMNS of ground, at every speed, forever. rooms.js authors every room
// against that figure, so if the physics drift the rooms silently stop being
// passable. That is a claim about arithmetic, and a claim about arithmetic
// should be checked by arithmetic — which means a test has to be able to
// import the actual numbers.
//
// It was checked, for a while, by a script that restated the constants rather
// than importing them. That is not a test of anything: the copy can agree with
// itself perfectly while the game does something else. These live here so
// tests/gravity-flip.physics.test.mjs reads the same values the game runs on.

import { FLIP_COLUMNS, ROOM_ROWS } from './rooms.js';

export const TILE = 40;
// The interior rows plus a solid ceiling above and a solid floor below.
export const GRID_ROWS = ROOM_ROWS + 2;

export const PLAYER_W = 22;
export const PLAYER_H = 26;

export const BASE_SPEED = 300;
export const SPEED_PER_ROOM = 7;

// Chosen so that a full floor-to-ceiling flip at BASE_SPEED covers
// FLIP_COLUMNS tiles of ground. See flipColumns() below.
export const BASE_GRAVITY = 2540;

// Terminal velocity, scaled with speed like everything else, so the arc keeps
// its shape rather than flattening out at the bottom of a long flip.
export const BASE_MAX_FALL = 1500;

// The longest a single movement slice may travel, as a fraction of a tile.
// Anything approaching 1 can skip a tile entirely, and because gravity grows
// with the square of speed a long run gets there: by about room 50 a single
// 1/60s tick moved further than a tile and the player passed through solid
// blocks. update() slices each tick until no slice exceeds this.
export const MAX_STEP_FRACTION = 0.4;

// How far a full surface-to-surface flip actually travels vertically.
export const FLIP_TRAVEL = (GRID_ROWS - 2) * TILE - PLAYER_H;

export const speedAt = (roomsCleared) => BASE_SPEED + roomsCleared * SPEED_PER_ROOM;

/**
 * Gravity scaled so that a flip always costs the same number of COLUMNS.
 *
 * Fall distance for a given fall time goes as g*t^2, and the ground covered in
 * that time goes as v*t. Holding (ground covered) fixed while v grows means t
 * must shrink as 1/v, which means g must grow as v^2. This one line is what
 * keeps every authored room passable at any speed.
 */
export function gravityAt(roomsCleared) {
  const ratio = speedAt(roomsCleared) / BASE_SPEED;
  return BASE_GRAVITY * ratio * ratio;
}

export const maxFallAt = (roomsCleared) => BASE_MAX_FALL * (speedAt(roomsCleared) / BASE_SPEED);

/**
 * How many columns of ground a full flip costs, analytically.
 *
 * The game warns at boot if this exceeds rooms.js's FLIP_COLUMNS, and
 * tests/gravity-flip.physics.test.mjs asserts the same thing plus the part
 * the closed form cannot see: that the stepped integration agrees with it.
 */
export function flipColumns() {
  const time = Math.sqrt((2 * FLIP_TRAVEL) / BASE_GRAVITY);
  return (BASE_SPEED * time) / TILE;
}

export { FLIP_COLUMNS };
