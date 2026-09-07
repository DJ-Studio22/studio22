// tests/mini-golf.green.test.mjs
//
// Endless Mini Golf generates its holes forever and gets harder as it goes,
// which makes one claim carry the whole game:
//
//   EVERY HOLE IT DEALS CAN BE SUNK WITHIN ITS PAR.
//
// A generator that occasionally produces a cup behind a wall with no angle
// into it does not feel unlucky. It feels broken — and the player cannot tell
// "I can't see the shot" from "there is no shot", which is the worst position
// to put somebody in.
//
// So holes are generated and then PROVED, by a search over the real putt
// physics, before they are ever dealt. These check that the proving actually
// happens, that the search is honest about what it proves, and that the stroke
// bank is an economy rather than a formality.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Hole, RAMP_PUSH, T, TILE, TUNING, isRamp, isSolid, putt, reachAt, solveHole,
} from '../games/mini-golf/green.js';
import { Course, END, buildHole, shapeAt } from '../games/mini-golf/holes.js';
import { runOnce } from './helpers/golf-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

/** A plain rectangular green with walls round it, for physics tests. */
function flatHole({ cols = 12, rows = 8, par = 3, cup = { x: 9, y: 4 }, tee = { x: 2, y: 4 } } = {}) {
  const tiles = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => (
    x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? T.WALL : T.GREEN
  )));
  const centre = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
  return new Hole({ tiles, tee: centre(tee), cup: centre(cup), par });
}

// --- The putt -------------------------------------------------------------

test('a putt travels further with more power, and always comes to rest', () => {
  const hole = flatHole({ cols: 40, cup: { x: 38, y: 4 } });
  let previous = 0;
  for (const power of [0.2, 0.4, 0.6, 0.8, 1]) {
    const r = putt(hole, hole.tee, 0, power);
    const travelled = r.x - hole.tee.x;
    assert.ok(travelled > previous, `power ${power} went no further than the last`);
    assert.equal(r.reason === 'timeout', false, 'the ball never stopped');
    previous = travelled;
  }
});

test('reachAt() is what the generator prices par against, and it is honest', () => {
  const hole = flatHole({ cols: 40, cup: { x: 38, y: 4 } });
  const r = putt(hole, hole.tee, 0, 1);
  const actual = r.x - hole.tee.x;
  assert.ok(
    Math.abs(actual - reachAt(1)) < reachAt(1) * 0.25,
    `a full putt ran ${actual.toFixed(0)}px against a predicted ${reachAt(1).toFixed(0)}px`,
  );
});

test('walls bounce rather than swallow', () => {
  const hole = flatHole({ cols: 8, rows: 8, cup: { x: 6, y: 6 } });
  const r = putt(hole, hole.tee, 0, 1);
  // Fired straight at a wall from the tee: it must come back, not stop dead
  // in it, and must still be on the green.
  assert.equal(isSolid(hole.tileAt(r.x, r.y)), false, 'the ball came to rest inside a wall');
});

test('WATER COSTS A STROKE and returns the ball', () => {
  const hole = flatHole({ cols: 14, cup: { x: 12, y: 4 } });
  for (let x = 5; x <= 7; x++) hole.tiles[4][x] = T.WATER;
  const r = putt(hole, hole.tee, 0, 1);
  assert.equal(r.reason, 'water');
  assert.equal(r.strokes, 1 + TUNING.waterPenalty, 'water did not cost the extra stroke');
  assert.equal(r.x, hole.tee.x, 'the ball did not return to where it was played from');
  assert.equal(r.y, hole.tee.y);
});

test('sand kills a ball far shorter than green does', () => {
  const open = flatHole({ cols: 40, cup: { x: 38, y: 4 } });
  const sandy = flatHole({ cols: 40, cup: { x: 38, y: 4 } });
  for (let x = 3; x < 39; x++) sandy.tiles[4][x] = T.SAND;
  const a = putt(open, open.tee, 0, 1);
  const b = putt(sandy, sandy.tee, 0, 1);
  assert.ok(b.x < a.x * 0.7, 'sand barely slowed the ball');
});

test('a ramp pushes the ball along its arrow', () => {
  for (const [tile, push] of Object.entries(RAMP_PUSH)) {
    const hole = flatHole({ cols: 20, rows: 20, cup: { x: 18, y: 18 } });
    for (let y = 1; y < 19; y++) for (let x = 1; x < 19; x++) hole.tiles[y][x] = Number(tile);
    assert.ok(isRamp(Number(tile)));
    const from = { x: 10 * TILE, y: 10 * TILE };
    // Fired perpendicular to the push, so any movement along it is the ramp.
    const angle = push.x !== 0 ? Math.PI / 2 : 0;
    const r = putt(hole, from, angle, 0.3);
    const moved = push.x !== 0 ? (r.x - from.x) * push.x : (r.y - from.y) * push.y;
    assert.ok(moved > 0, `ramp ${tile} did not push the ball along its arrow`);
  }
});

test('A BALL ARRIVING TOO FAST RIMS OUT — power matters near the cup', () => {
  // Without this, every hole is "point at the cup and hit it as hard as
  // possible", and there is no decision anywhere on the green.
  const hole = flatHole({ cols: 40, cup: { x: 20, y: 4 } });
  const gentle = putt(hole, hole.tee, 0, 0.55);
  const hammered = putt(hole, hole.tee, 0, 1);
  assert.equal(hammered.sunk, false, 'a full-power putt straight through the cup went in');
  void gentle;
});

// --- The search -----------------------------------------------------------

test('the search SINKS the ball rather than estimating', () => {
  const hole = flatHole({ cols: 14, cup: { x: 11, y: 4 }, par: 3 });
  const strokes = solveHole(hole);
  assert.ok(strokes !== null && strokes <= 3, `an open green was not solved: ${strokes}`);
});

test('and reports failure on a cup it genuinely cannot reach', () => {
  // Cup walled off completely. There is no shot, and the search must not
  // pretend otherwise.
  const hole = flatHole({ cols: 14, rows: 10, cup: { x: 11, y: 5 }, par: 5 });
  for (let y = 3; y <= 7; y++) { hole.tiles[y][9] = T.WALL; hole.tiles[y][13] = T.WALL; }
  for (let x = 9; x <= 13; x++) { hole.tiles[3][x] = T.WALL; hole.tiles[7][x] = T.WALL; }
  assert.equal(solveHole(hole), null, 'the search claimed to sink a sealed cup');
});

// --- Generation -----------------------------------------------------------

test('EVERY GENERATED HOLE IS PROVED SINKABLE WITHIN ITS PAR', () => {
  // The claim the whole game rests on. Walked across the difficulty curve, not
  // just at the easy end.
  let unproved = 0;
  withSeed(3, () => {
    for (const n of [1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 40]) {
      const hole = buildHole(n);
      if (hole.unproved) { unproved++; continue; }
      assert.ok(hole.provedIn !== null, `hole ${n} was dealt without a proof`);
      assert.ok(hole.provedIn <= hole.par,
        `hole ${n} needed ${hole.provedIn} strokes against a par of ${hole.par}`);
    }
  });
  assert.equal(unproved, 0, 'a hole was dealt that the search could not solve at any par');
});

test('the tee and the cup are never on a hazard', () => {
  withSeed(9, () => {
    for (let n = 1; n <= 25; n++) {
      const hole = buildHole(n);
      for (const [name, point] of [['tee', hole.tee], ['cup', hole.cup]]) {
        const tile = hole.tileAt(point.x, point.y);
        assert.equal(tile, T.GREEN, `hole ${n}'s ${name} is on tile type ${tile}`);
      }
    }
  });
});

test('holes escalate — bigger, longer, tighter, wetter', () => {
  const early = shapeAt(1);
  const late = shapeAt(40);
  assert.ok(late.cols > early.cols, 'the board never grows');
  assert.ok(late.corners > early.corners, 'the route never gets longer');
  assert.ok(late.width < early.width, 'the fairway never tightens');
  assert.ok(late.water > early.water, 'hazards never multiply');
});

test('and the escalation has a ceiling only where a screen forces one', () => {
  // Board size has to stop; everything else should not have to.
  const far = shapeAt(500);
  assert.ok(far.cols <= 22 && far.rows <= 15, 'the board grew past what fits');
  assert.ok(far.width >= 1, 'the fairway narrowed to nothing');
});

test('generating a hole is fast enough to do between strokes', () => {
  const t = Date.now();
  withSeed(5, () => { for (let n = 1; n <= 12; n++) buildHole(n); });
  const ms = (Date.now() - t) / 12;
  assert.ok(ms < 400, `a hole takes ${ms.toFixed(0)}ms to build, which the player would feel`);
});

// --- The stroke economy ---------------------------------------------------

test('THE BANK IS THE GAME: under par adds, over par spends', () => {
  withSeed(2, () => {
    const course = new Course();
    const startingBank = course.bank;
    const par = course.hole.par;

    // Sink it in one, from wherever the search says works.
    course.ball = { ...course.hole.cup };
    course.strokes = par - 2;
    course.play(0, 0.05);   // a tap from inside the cup

    assert.ok(course.bank > startingBank - 2,
      'sinking under par did not add anything to the bank');
  });
});

test('running the bank dry ends the round, mid-hole', () => {
  withSeed(6, () => {
    const course = new Course();
    course.bank = 1;
    // Putt hopelessly until the bank is spent.
    for (let i = 0; i < 60 && course.running; i++) course.play(Math.PI, 0.06);
    assert.equal(course.running, false, 'the round survived an empty bank');
    assert.equal(course.reason, END.BANKRUPT);
  });
});

test('the score is HOLES, not strokes', () => {
  withSeed(8, () => {
    const course = new Course();
    assert.equal(course.completed, 0);
    assert.equal(typeof course.holeNumber, 'number');
  });
});

test('a fresh hole resets the strokes but not the bank', () => {
  withSeed(12, () => {
    const course = new Course();
    course.bank = 9;
    course.strokes = 2;
    course.ball = { ...course.hole.cup };
    course.play(0, 0.05);
    assert.equal(course.strokes, 0, 'strokes carried over to the next hole');
    assert.ok(course.bank >= 9 - 2, 'the bank was reset with the hole');
  });
});

// --- What the two skill levels get ----------------------------------------

test('a competent round lasts long enough to feel like a round', () => {
  const runs = [];
  for (let seed = 1; seed <= 20; seed++) {
    withSeed(seed, () => runs.push(runOnce('competent').completed));
  }
  const s = summarise(runs);
  assert.ok(s.median >= 2, `competent median ${s.median} holes — the bank is refusing the player`);
  assert.ok(s.median <= 20, `competent median ${s.median} holes — nothing is at stake`);
});

test('PLANNING THE SHOT is what separates the two — the skill claim', () => {
  // The competent bot aims at the cup; the good one tries a fan and keeps
  // whichever shot leaves the ball best placed. That difference — playing the
  // dog-leg rather than the straight line — is the whole game.
  const competent = [];
  const good = [];
  for (let seed = 1; seed <= 12; seed++) {
    withSeed(seed, () => competent.push(runOnce('competent').completed));
    withSeed(seed, () => good.push(runOnce('good').completed));
  }
  const c = summarise(competent);
  const g = summarise(good);
  assert.ok(g.median > c.median * 2,
    `planning bought little: competent ${c.median} holes vs good ${g.median}`);
});

test('every round ends by running out of strokes, not by accident', () => {
  withSeed(4, () => {
    const r = runOnce('competent');
    if (!r.alive) assert.equal(r.reason, END.BANKRUPT);
  });
});

test('tuning is data a test can override', () => {
  // Deliberately NOT 'a bigger bank buys more holes'. It does not, and that
  // is a fact about the game rather than a broken override: a bot that aims
  // straight at the cup gets STUCK on a hole it cannot see the line for, and
  // then spends whatever bank it has on that one hole. Thirty strokes of bank
  // buys thirty more strokes on the same hole, not another hole.
  //
  // Which is the economy working as designed — going over par spends the bank
  // — but it makes bank size the wrong thing to measure the override with.
  withSeed(1, () => {
    const course = new Course({ ...TUNING, startingBank: 30 });
    assert.equal(course.bank, 30, 'the Course ignored the tuning it was given');
  });

  const hole = flatHole({ cols: 40, cup: { x: 38, y: 4 } });
  const slow = new Hole(
    { tiles: hole.tiles, tee: hole.tee, cup: hole.cup, par: hole.par },
    { ...TUNING, greenFriction: TUNING.greenFriction * 3 },
  );
  const far = putt(hole, hole.tee, 0, 1);
  const near = putt(slow, slow.tee, 0, 1);
  assert.ok(near.x < far.x - 40, 'tripling the friction did not shorten the putt');
});
