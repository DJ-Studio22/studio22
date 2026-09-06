// tests/number-crunch.problems.test.mjs
//
// The arithmetic, and the adaptation that follows the player.
//
// This is the one game in the suite where a bug is a lie told to a child. A
// division that does not divide exactly, a subtraction that goes negative, a
// distractor that happens to equal the answer, or an adaptation that ratchets
// someone three bands out of their depth on one lucky streak — none of those
// are visible in a screenshot, and all of them are visible here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS, LOWER_BELOW, MIN_SAMPLES, OPS, RAISE_ABOVE, START_BAND, WINDOW,
  createAdaptive, makeBossProblem, makeDistractors, makeProblem,
} from '../games/number-crunch/problems.js';

const BAND_RANGE = [...Array(BANDS).keys()];

// The answer a problem's own text says it has, so the test checks the text
// rather than trusting the field beside it.
function evaluate(text) {
  const normalised = text.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  assert.match(normalised, /^[\d\s+\-*/]+$/, `unexpected characters in "${text}"`);
  // eslint-disable-next-line no-new-func -- test-only, and the input is
  // asserted above to be digits and operators.
  return Function(`"use strict"; return (${normalised});`)();
}

test('every problem’s stated answer is the answer to its own text', () => {
  for (const op of OPS) {
    for (const band of BAND_RANGE) {
      for (let i = 0; i < 60; i++) {
        const p = makeProblem(op, band);
        assert.equal(evaluate(p.text), p.answer, `${op} band ${band}: "${p.text}" != ${p.answer}`);
      }
    }
  }
});

test('boss problems are two steps and still add up', () => {
  for (const op of OPS) {
    for (const band of BAND_RANGE) {
      for (let i = 0; i < 40; i++) {
        const p = makeBossProblem(op, band);
        assert.equal(p.isBoss, true);
        assert.equal(evaluate(p.text), p.answer, `boss ${op} band ${band}: "${p.text}"`);
      }
    }
  }
});

test('no answer is ever negative — that is a different lesson', () => {
  for (const op of OPS) {
    for (const band of BAND_RANGE) {
      for (let i = 0; i < 60; i++) {
        assert.ok(makeProblem(op, band).answer >= 0, `${op} band ${band} went negative`);
        assert.ok(makeBossProblem(op, band).answer >= 0, `boss ${op} band ${band} went negative`);
      }
    }
  }
});

test('division always divides exactly', () => {
  for (const band of BAND_RANGE) {
    for (let i = 0; i < 120; i++) {
      const p = makeProblem('div', band);
      assert.ok(Number.isInteger(p.answer), `"${p.text}" gave ${p.answer}`);
    }
  }
});

test('every answer is a whole number', () => {
  for (const op of OPS) {
    for (const band of BAND_RANGE) {
      for (let i = 0; i < 40; i++) {
        assert.ok(Number.isInteger(makeProblem(op, band).answer), `${op} band ${band}`);
      }
    }
  }
});

test('distractors are distinct, non-negative, and never the answer', () => {
  for (const op of OPS) {
    for (const band of BAND_RANGE) {
      for (let i = 0; i < 40; i++) {
        const p = makeProblem(op, band);
        for (const count of [2, 3]) {
          const wrong = makeDistractors(p, count);
          assert.equal(wrong.length, count, `${op}: asked for ${count}, got ${wrong.length}`);
          assert.equal(new Set(wrong).size, count, `${op}: duplicate distractors ${wrong}`);
          for (const w of wrong) {
            assert.notEqual(w, p.answer, `${op}: distractor equals the answer for "${p.text}"`);
            assert.ok(w >= 0, `${op}: negative distractor ${w}`);
            assert.ok(Number.isInteger(w), `${op}: non-integer distractor ${w}`);
          }
        }
      }
    }
  }
});

test('difficulty bands are ordered — later bands are not easier', () => {
  // Measured rather than asserted from the tables: the average answer for a
  // band should not go down as the band goes up.
  for (const op of OPS) {
    const averages = BAND_RANGE.map((band) => {
      let total = 0;
      for (let i = 0; i < 400; i++) total += makeProblem(op, band).answer;
      return total / 400;
    });
    assert.ok(
      averages[averages.length - 1] > averages[0],
      `${op}: the hardest band is not harder than the easiest (${averages[0].toFixed(1)} -> ${averages[averages.length - 1].toFixed(1)})`,
    );
  }
});

test('a band out of range is clamped rather than throwing', () => {
  for (const op of OPS) {
    for (const band of [-5, -1, BANDS, BANDS + 10]) {
      const p = makeProblem(op, band);
      assert.ok(Number.isInteger(p.answer), `${op} at band ${band}`);
      assert.equal(evaluate(p.text), p.answer);
    }
  }
});

// --- Adaptation ----------------------------------------------------------

test('each operation adapts on its own', () => {
  const a = createAdaptive('easy');
  for (let i = 0; i < WINDOW * 3; i++) a.record('mul', true);
  assert.ok(a.bandFor('mul') > a.bandFor('div'), 'a strong operation dragged the others up with it');
});

test('adaptation waits for enough evidence before moving', () => {
  const a = createAdaptive('easy');
  const start = a.bandFor('add');
  for (let i = 0; i < MIN_SAMPLES - 1; i++) {
    assert.equal(a.record('add', true), 0, 'moved before it had enough samples');
  }
  assert.equal(a.bandFor('add'), start);
  assert.equal(a.accuracyFor('add'), null, 'reported accuracy before it had enough samples');
});

test('one streak cannot ratchet a child several bands out of their depth', () => {
  // The window is cleared whenever the band moves; without that a single
  // strong run re-triggers a raise on every subsequent problem.
  const a = createAdaptive('easy');
  let raises = 0;
  for (let i = 0; i < MIN_SAMPLES + 3; i++) {
    if (a.record('add', true) > 0) raises++;
  }
  assert.equal(raises, 1, `one streak produced ${raises} raises`);
});

test('sustained success raises the band and sustained failure lowers it', () => {
  const up = createAdaptive('easy');
  for (let i = 0; i < WINDOW * 6; i++) up.record('add', true);
  assert.ok(up.bandFor('add') > START_BAND.easy, 'never raised on a perfect run');

  const down = createAdaptive('hard');
  for (let i = 0; i < WINDOW * 6; i++) down.record('add', false);
  assert.ok(down.bandFor('add') < START_BAND.hard, 'never lowered on a run of failures');
});

test('the band stays inside the table at both ends', () => {
  const a = createAdaptive('hard');
  for (let i = 0; i < WINDOW * 20; i++) a.record('mul', true);
  assert.ok(a.bandFor('mul') <= BANDS - 1, `band ran off the top: ${a.bandFor('mul')}`);

  const b = createAdaptive('easy');
  for (let i = 0; i < WINDOW * 20; i++) b.record('mul', false);
  assert.ok(b.bandFor('mul') >= 0, `band ran off the bottom: ${b.bandFor('mul')}`);
});

test('a middling player is nudged, not ratcheted across the table', () => {
  // The adaptation acts on whatever window it has once it has MIN_SAMPLES, so
  // a short prefix of a steady run can genuinely sit above RAISE_ABOVE and
  // earn a move. What must NOT happen is a player around three-quarters right
  // being carried several bands away from where they started.
  const a = createAdaptive('medium');
  const start = a.bandFor('add');

  const pattern = [true, true, false, true, true, true, true, false, true, true];
  const accuracy = pattern.filter(Boolean).length / pattern.length;
  assert.ok(accuracy > LOWER_BELOW && accuracy < RAISE_ABOVE, 'the test pattern is not actually middling');

  for (let i = 0; i < WINDOW * 20; i++) a.record('add', pattern[i % pattern.length]);

  const drift = Math.abs(a.bandFor('add') - start);
  assert.ok(drift <= 1, `a middling player drifted ${drift} bands from ${start}`);
});

test('reported accuracy matches the outcomes fed in', () => {
  const a = createAdaptive('easy');
  for (let i = 0; i < WINDOW; i++) a.record('sub', i % 2 === 0);
  assert.ok(Math.abs(a.accuracyFor('sub') - 0.5) < 1e-9);
});
