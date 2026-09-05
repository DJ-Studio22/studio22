// games/number-crunch/problems.js
//
// The arithmetic half of Number Crunch: what a problem is, what a plausible
// wrong answer looks like, and how the game decides a child is ready for
// harder numbers.
//
// Deliberately separate from game.js and completely free of the DOM. This is
// the part that has to be RIGHT rather than merely look right — a division
// problem that does not divide exactly, or an adaptation that ratchets a
// seven-year-old up three bands on one lucky streak, is a bug you cannot see
// in a screenshot. Kept here, it can be run and checked directly.

import { randInt } from '../../engine/util.js';

export const OPS = ['add', 'sub', 'mul', 'div'];
export const OP_SIGN = { add: '+', sub: '−', mul: '×', div: '÷' };

// Seven bands per operation. The Easy / Medium / Hard choice picks where a
// run STARTS; adaptation walks up and down from there, which is why Hard does
// not start at the top — a child who picks Hard and is flying should still
// have somewhere left to be taken.
export const BANDS = 7;
export const START_BAND = { easy: 0, medium: 3, hard: 5 };

// Per-band operand ranges. Addition and subtraction share a table because the
// difficulty of 17 + 8 and 25 − 8 is the same arithmetic either way.
const ADD_RANGE = [
  [1, 5], [1, 10], [2, 20], [5, 30], [10, 50], [10, 99], [20, 199],
];

// [multiplicand max, multiplier max] — the times tables widen before the
// numbers do, because 7 × 8 is a fact to learn and 7 × 80 is only that same
// fact with a zero on the end.
const MUL_RANGE = [
  [5, 5], [10, 5], [10, 10], [12, 12], [12, 20], [20, 20], [50, 12],
];

const clampBand = (level) => Math.min(Math.max(Math.floor(level) || 0, 0), BANDS - 1);

// --- Problems ------------------------------------------------------------

/**
 * One single-step problem for `op` at difficulty `level`.
 * @returns {{ text: string, answer: number, op: string, isBoss: boolean }}
 */
export function makeProblem(op, level) {
  const band = clampBand(level);

  if (op === 'add') {
    const [lo, hi] = ADD_RANGE[band];
    const a = randInt(lo, hi);
    const b = randInt(lo, hi);
    return { text: `${a} + ${b}`, answer: a + b, op, isBoss: false };
  }

  if (op === 'sub') {
    const [lo, hi] = ADD_RANGE[band];
    // Ordered so the answer is never negative. Negative numbers are a
    // different lesson, and meeting one by accident here just reads as "the
    // game is broken" to a seven-year-old.
    const a = randInt(lo, hi);
    const b = randInt(lo, hi);
    const big = Math.max(a, b);
    const small = Math.min(a, b);
    return { text: `${big} − ${small}`, answer: big - small, op, isBoss: false };
  }

  if (op === 'mul') {
    const [maxA, maxB] = MUL_RANGE[band];
    const a = randInt(1, maxA);
    const b = randInt(1, maxB);
    return { text: `${a} × ${b}`, answer: a * b, op, isBoss: false };
  }

  // Division is built BACKWARDS from a multiplication, so it always divides
  // exactly. Remainders are a later topic and an arcade game is the wrong
  // place to meet one for the first time.
  const [maxA, maxB] = MUL_RANGE[band];
  const divisor = randInt(2, Math.max(2, maxB));
  const answer = randInt(1, Math.max(1, maxA));
  return { text: `${divisor * answer} ÷ ${divisor}`, answer, op, isBoss: false };
}

/**
 * A two-step problem for a boss round.
 *
 * Two steps rather than bigger numbers: "bigger" is only more of the same
 * arithmetic, where "two steps" is the thing that is actually harder. The
 * band is dropped by one to pay for the extra step.
 */
export function makeBossProblem(op, level) {
  const band = clampBand(level - 1);

  if (op === 'mul' || op === 'div') {
    const [maxA, maxB] = MUL_RANGE[band];
    const a = randInt(2, Math.max(2, maxA));
    const b = randInt(2, Math.max(2, maxB));
    const c = randInt(1, 20);
    return { text: `${a} × ${b} + ${c}`, answer: a * b + c, op, isBoss: true };
  }

  const [lo, hi] = ADD_RANGE[band];
  const a = randInt(lo, hi);
  const b = randInt(lo, hi);
  const c = randInt(lo, hi);

  if (op === 'sub') {
    // Built from the answer outwards, so the running total never goes
    // negative partway through.
    const total = a + b + c;
    return { text: `${total} − ${b} − ${c}`, answer: a, op, isBoss: true };
  }

  return { text: `${a} + ${b} + ${c}`, answer: a + b + c, op, isBoss: true };
}

/**
 * Wrong answers that are worth getting wrong.
 *
 * Random numbers would be useless: a child can rule them out without doing
 * the sum, which turns the game into spot-the-odd-one-out. These are the
 * mistakes people actually make — off by one, off by ten, the neighbouring
 * row of the times table, reaching for the wrong operation — so picking the
 * right bubble means having actually done the arithmetic.
 *
 * Guarantees: `count` values, all distinct, none equal to the answer, none
 * negative.
 */
export function makeDistractors(problem, count = 2) {
  const { answer, op } = problem;
  const candidates = [];

  const push = (value) => {
    if (Number.isFinite(value) && value >= 0 && value !== answer) candidates.push(value);
  };

  push(answer + 1);
  push(answer - 1);
  push(answer + 10);
  push(answer - 10);

  if (op === 'mul') {
    // The neighbouring row of the times table, which is where the classic
    // "7 × 8 = 54" comes from.
    const parts = problem.text.match(/(\d+) × (\d+)/);
    if (parts) {
      const a = Number(parts[1]);
      const b = Number(parts[2]);
      push(a * (b + 1));
      push(a * (b - 1));
      push(a + b);            // reaching for the wrong operation entirely
    }
  }

  if (op === 'add' || op === 'sub') {
    push(answer + 2);
    push(answer - 2);
  }

  if (op === 'div') push(answer * 2);

  // Spread out at the top end, where being one away is barely a distractor.
  if (answer > 40) {
    push(answer + randInt(3, 9));
    push(answer - randInt(3, 9));
  }

  const pool = [...new Set(candidates)];
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
  }

  // Only reachable when every candidate collided, which needs a very small
  // answer. Filling upwards keeps the bubbles distinct.
  let filler = answer + 1;
  while (picked.length < count) {
    if (filler !== answer && !picked.includes(filler)) picked.push(filler);
    filler++;
  }

  return picked;
}

// --- Adaptation ----------------------------------------------------------

// How many recent problems the adaptation looks at, and the thresholds it
// acts on. Stated here rather than inline so the numbers in the design and
// the numbers in the code are the same numbers.
export const WINDOW = 10;
export const MIN_SAMPLES = 5;
export const RAISE_ABOVE = 0.85;
export const LOWER_BELOW = 0.60;

/**
 * Per-operation difficulty that follows the player.
 *
 * Each operation keeps its own band and its own rolling window, so a child
 * with multiplication cold but division shaky gets harder times tables and
 * gentler division in the same run, without anyone choosing that.
 */
export function createAdaptive(startRange = 'easy') {
  const start = START_BAND[startRange] ?? 0;
  const bands = {};
  const windows = {};

  for (const op of OPS) {
    bands[op] = start;
    windows[op] = [];
  }

  return {
    bandFor(op) {
      return bands[op] ?? start;
    },

    /** Recent accuracy for `op`, or null before there is enough to judge. */
    accuracyFor(op) {
      const window = windows[op];
      if (!window || window.length < MIN_SAMPLES) return null;
      return window.reduce((sum, n) => sum + n, 0) / window.length;
    },

    /**
     * Records an outcome and moves the band if the window says it should.
     *
     * The window is CLEARED whenever the band moves. Without that, one strong
     * streak keeps re-triggering a raise on every subsequent problem, and a
     * child ends up three bands out of their depth before the window has
     * caught up with where they now are.
     *
     * @returns {-1|0|1} which way the band moved.
     */
    record(op, correct) {
      const window = windows[op] ?? (windows[op] = []);
      window.push(correct ? 1 : 0);
      if (window.length > WINDOW) window.shift();

      if (window.length < MIN_SAMPLES) return 0;

      const accuracy = window.reduce((sum, n) => sum + n, 0) / window.length;
      const current = bands[op];

      if (accuracy > RAISE_ABOVE && current < BANDS - 1) {
        bands[op] = current + 1;
        window.length = 0;
        return 1;
      }

      if (accuracy < LOWER_BELOW && current > 0) {
        bands[op] = current - 1;
        window.length = 0;
        return -1;
      }

      return 0;
    },
  };
}
