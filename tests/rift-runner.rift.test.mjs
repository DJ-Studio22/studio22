// tests/rift-runner.rift.test.mjs
//
// Rift Runner makes two claims and both are arithmetic:
//
//   1. Every obstacle pattern can be cleared, in every realm it can be dealt
//      in. Not "somebody managed it once" — a breadth-first solver walks the
//      real physics and finds a route, or the pattern does not ship.
//   2. That stays true at any speed, forever, because gravity scales with the
//      square of the run speed and the jump impulse linearly with it.
//
// The second is the one that quietly kills endless runners: speed rises
// without a ceiling, jumps cover less ground each minute, and the patterns
// stop being possible. Gravity Flip found this, Ember rediscovered it, and
// here it is designed in from the start — so it needs a test that would notice
// if somebody undid it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  END, GROUND_Y, KIND, REALMS, Run, SOLVER_FINE, SolverBudget, TILE, TUNING,
  bodyHeight, dashTiles, heightAbove, isClearable, jumpHeightTiles, jumpTiles,
  physicsAt, realmById, speedAt,
} from '../games/rift-runner/rift.js';
import {
  Course, GATE_TILES, PATTERNS, patternsFor, tierAt, verifyCoverage, verifyLibrary,
} from '../games/rift-runner/patterns.js';
import { runOnce } from './helpers/rift-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// --- The speed-invariance contract ---------------------------------------

test('A JUMP COVERS THE SAME TILES AT ANY SPEED — the whole contract', () => {
  // Patterns are authored in tiles. If a jump shrinks as the run speeds up,
  // every one of them silently becomes impossible somewhere down the line.
  for (const realm of REALMS) {
    const reference = jumpTiles(realm);
    for (const km of [0, 5, 50, 500, 5000]) {
      const speed = speedAt(km * 1000) * realm.speedScale;
      const p = physicsAt(speed, realm);
      const airtime = (2 * p.jumpImpulse) / p.gravity;
      const tiles = (speed * airtime) / TILE;
      assert.ok(
        Math.abs(tiles - reference) < 0.001,
        `${realm.id}: a jump covers ${tiles.toFixed(2)} tiles at ${km}km, `
        + `against ${reference.toFixed(2)} at the start`,
      );
    }
  }
});

test('and so does the dash, and the height of a jump', () => {
  for (const realm of REALMS) {
    const h = jumpHeightTiles(realm);
    const d = dashTiles(realm);
    assert.ok(h > 1.5, `${realm.id} cannot clear a one-tile spike: ${h.toFixed(2)} tiles`);
    assert.ok(d > 1, `${realm.id} dash covers only ${d.toFixed(2)} tiles`);
  }
});

test('the realms are genuinely different, not a recolour', () => {
  const jumps = REALMS.map((r) => jumpTiles(r));
  const spread = Math.max(...jumps) / Math.min(...jumps);
  assert.ok(spread > 2, `the longest jump is only ${spread.toFixed(2)}x the shortest`);

  // And one of them turns the world over.
  assert.ok(REALMS.some((r) => r.flipped), 'no realm flips gravity');
});

test('speed rises without a ceiling — something has to end a run', () => {
  assert.ok(speedAt(100_000) > speedAt(1_000) * 2);
});

// --- The solver -----------------------------------------------------------

test('THE SOLVER IS SOUND: it only says yes when it walked a route', () => {
  // A wall of rift with no dash available cannot be passed, and the solver
  // has to say so rather than finding a way through the physics.
  const impossible = {
    tiles: 8,
    obstacles: [
      { kind: KIND.RIFT, tile: 2, tiles: 1 },
      { kind: KIND.RIFT, tile: 4, tiles: 1 },
      { kind: KIND.RIFT, tile: 6, tiles: 1 },
    ],
  };
  assert.equal(isClearable(impossible, REALMS[0]), false,
    'three rift walls two tiles apart should be beyond one dash');
});

test('a running-out-of-budget solver THROWS rather than saying no', () => {
  // The single most dangerous bug this file could have: reporting "impossible"
  // when it means "I gave up". It did exactly that once, at a fine setting,
  // and announced that a lone spike could not be jumped.
  assert.throws(
    () => isClearable(PATTERNS[0], REALMS[0], { maxStates: 50 }),
    SolverBudget,
  );
});

test('coarse settings never invent a route the fine ones cannot find', () => {
  // Quantisation can only merge states away, so it can lose a route but never
  // manufacture one. That is what lets verifyLibrary run cheap and only
  // double-check the rejections.
  const pattern = PATTERNS.find((p) => p.id === 'gauntlet');
  const coarse = isClearable(pattern, REALMS[0]);
  if (coarse) {
    assert.equal(isClearable(pattern, REALMS[0], SOLVER_FINE), true,
      'the cheap pass found a route the fine pass cannot — that is unsound');
  }
});

// --- The library ----------------------------------------------------------

test('EVERY PATTERN IS CLEARABLE IN EVERY REALM IT DECLARES', () => {
  const problems = verifyLibrary();
  assert.deepEqual(problems, [],
    `patterns that would be dealt and could not be beaten: `
    + problems.map((p) => `${p.pattern}/${p.realm}`).join(', '));
});

test('every realm has something to deal at every tier', () => {
  assert.deepEqual(verifyCoverage(), []);
});

test('the library really does span the verbs', () => {
  const kinds = new Set(PATTERNS.flatMap((p) => p.obstacles.map((o) => o.kind)));
  for (const kind of Object.values(KIND)) {
    assert.ok(kinds.has(kind), `nothing in the library uses ${kind}`);
  }
});

test('patterns combine rather than repeat — the brief', () => {
  // A library of single obstacles is a library of one idea. Most of it should
  // be asking for two verbs.
  const combos = PATTERNS.filter((p) => new Set(p.obstacles.map((o) => o.kind)).size > 1);
  assert.ok(combos.length >= PATTERNS.length / 3,
    `only ${combos.length} of ${PATTERNS.length} patterns combine two obstacle kinds`);
});

test('tiers unlock in order and the hardest is reachable', () => {
  assert.equal(tierAt(0), 0);
  assert.ok(tierAt(10_000) === 3);
  let previous = -1;
  for (const m of [0, 100, 200, 400, 800, 5000]) {
    const t = tierAt(m);
    assert.ok(t >= previous, 'the tier went backwards');
    previous = t;
  }
});

// --- The collision, in both directions ------------------------------------

test('INVERSE IS A MIRRORED WORLD, not a backdrop', () => {
  // Everything vertical is measured from the floor of the realm you are in.
  // Measuring from GROUND_Y instead hung every bar on the far side of the
  // world in Inverse, and the solver correctly called almost every pattern
  // impossible there.
  const upright = REALMS.find((r) => !r.flipped);
  const flipped = REALMS.find((r) => r.flipped);

  const a = new Run(); a.realm = upright; a.y = GROUND_Y;
  const b = new Run(); b.realm = flipped; b.y = TILE * 2;

  assert.equal(heightAbove(a, upright), 0, 'standing on the floor is height 0');
  assert.equal(heightAbove(b, flipped), 0, 'and so is standing on the ceiling');
});

test('sliding halves the runner, which is what gets under a bar', () => {
  const run = new Run();
  const standing = bodyHeight(run, TUNING);
  run.sliding = true;
  assert.ok(bodyHeight(run, TUNING) < standing / 1.5);
});

test('the slide is HELD, not a fixed dash', () => {
  // It was a 0.42s move covering 143px against a 120px bar — a 23px window to
  // start it in. The bots died on bars 27 times in 40 runs, correctly.
  const run = new Run();
  run.obstacles = [];
  for (let i = 0; i < 120; i++) run.step(1 / 60, { slide: true });
  assert.equal(run.sliding, true, 'a held slide ran out on its own');

  for (let i = 0; i < 30; i++) run.step(1 / 60, {});
  assert.equal(run.sliding, false, 'releasing did not stand the runner up');
});

test('you cannot slide in mid-air, so a bar after a gap must be landed for', () => {
  const run = new Run();
  run.obstacles = [];
  run.step(1 / 60, { jump: true, jumpHeld: true });
  assert.equal(run.grounded, false);
  run.step(1 / 60, { slide: true, jumpHeld: true });
  assert.equal(run.sliding, false, 'the runner slid while airborne');
});

test('only a dash gets through a rift wall', () => {
  const wall = { kind: KIND.RIFT, tile: 4, tiles: 1 };
  const run = new Run();
  run.obstacles = [wall];
  run.x = 4 * TILE + 5;
  run.phasing = false;
  // Walking into it ends the run.
  run.step(1 / 60, {});
  assert.equal(run.running, false);
  assert.equal(run.reason, END.HIT);
});

// --- The course -----------------------------------------------------------

test('A RIFT GATE IS DEALT, not waited for', () => {
  // The first version waited for a lull — grounded, nothing within six tiles —
  // and patterns are dealt four tiles apart, so it never found one. The median
  // run of both bots entered ZERO rifts, in a game whose whole hook is the
  // rifts.
  withSeed(1, () => {
    const course = new Course();
    const gates = course.dealt.filter((d) => d.gate);
    assert.ok(gates.length >= 1, 'no rift gate dealt in the opening stretch');
    const firstMetres = (gates[0].tile * TILE) / 30;
    assert.ok(firstMetres < 90,
      `the first rift is ${firstMetres.toFixed(0)}m in, which most runs never reach`);
  });
});

test('and a competent run actually reaches one', () => {
  const rifts = [];
  for (let seed = 1; seed <= 40; seed++) {
    withSeed(seed, () => rifts.push(runOnce('competent').rifts));
  }
  assert.ok(summarise(rifts).median >= 1,
    `the median competent run enters ${summarise(rifts).median} rifts — the hook is unreachable`);
});

test('a realm change never lands mid-jump', () => {
  // Changing gravity while somebody is in the air is a cheat, not a twist.
  withSeed(4, () => {
    const course = new Course();
    let shiftsWhileAirborne = 0;
    for (let i = 0; i < 60 * 120 && course.running; i++) {
      const airborne = !course.run.grounded;
      course.step(1 / 60, { jump: i % 37 === 0, jumpHeld: (i % 37) < 14 });
      if (course.justShifted && airborne) shiftsWhileAirborne++;
    }
    assert.equal(shiftsWhileAirborne, 0);
  });
});

test('crossing a rift only deals patterns the NEW realm can clear', () => {
  // The property that matters, stated against the dealt list rather than
  // against obstacle positions. Patterns dealt for the old realm were never
  // checked against the new one, and that is the single thing the library
  // check cannot catch — it verifies pattern/realm pairs, not what the course
  // actually hands you after the physics change underneath.
  withSeed(7, () => {
    const course = new Course();
    for (let i = 0; i < 60 * 200 && course.running; i++) {
      course.step(1 / 60, { jump: course.run.grounded, jumpHeld: true, dash: i % 90 === 0 });
      if (!course.justShifted) continue;

      const legal = new Set(patternsFor(course.realm.id, 3).map((p) => p.id));
      const dealtAfter = course.dealt.filter((d) => !d.gate && d.tile >= course.cursorTile - 200);
      for (const d of dealtAfter) {
        assert.ok(legal.has(d.id),
          `${d.id} was dealt in ${course.realm.id}, which it is not legal in`);
      }
      return;
    }
  });
});
test('the same pattern is never dealt twice running', () => {
  withSeed(11, () => {
    const course = new Course();
    for (let i = 0; i < 60 * 120 && course.running; i++) {
      course.step(1 / 60, { jump: course.run.grounded, jumpHeld: true });
    }
    // Compared over the FULL dealt list, gates included. A rift gate is ten
    // tiles of clear ground and a change of world, so the same phrase either
    // side of one is not a repetition — filtering the gates out and comparing
    // what remains says it is, which is the test being wrong rather than the
    // dealer.
    for (let i = 1; i < course.dealt.length; i++) {
      const previous = course.dealt[i - 1];
      const current = course.dealt[i];
      if (previous.gate || current.gate) continue;
      assert.notEqual(current.id, previous.id, `${current.id} was dealt twice in a row`);
    }
  });
});
test('the gate is wide enough to land, read and set off again', () => {
  assert.ok(GATE_TILES >= 8);
});

// --- What the two skill levels get ----------------------------------------

test('a competent first run lasts long enough to feel like a failure', () => {
  const runs = [];
  for (let seed = 1; seed <= 40; seed++) {
    withSeed(seed, () => runs.push(runOnce('competent').metres));
  }
  const s = summarise(runs);
  assert.ok(s.median >= 80, `competent median ${s.median}m — the game is refusing the player`);
  assert.ok(s.median <= 900, `competent median ${s.median}m — nothing is at stake`);
});

test('READING THE OBSTACLE is what separates the two — the skill claim', () => {
  const competent = [];
  const good = [];
  for (let seed = 1; seed <= 40; seed++) {
    withSeed(seed, () => competent.push(runOnce('competent').metres));
    withSeed(seed, () => good.push(runOnce('good').metres));
  }
  const c = summarise(competent);
  const g = summarise(good);
  assert.ok(g.median > c.median * 1.8,
    `reading correctly bought little: competent ${c.median}m vs good ${g.median}m`);
});

test('a run always ends for a stated reason', () => {
  withSeed(2, () => {
    const r = runOnce('competent');
    if (!r.alive) assert.ok(Object.values(END).includes(r.reason), `odd reason: ${r.reason}`);
  });
});

test('tuning is data a test can override', () => {
  const floaty = { ...TUNING, gravity: TUNING.gravity * 0.4 };
  assert.ok(jumpTiles(REALMS[0], floaty) > jumpTiles(REALMS[0]) * 1.5,
    'halving gravity did not lengthen the jump, so the tuning is not live');
});

test('realmById falls back rather than throwing', () => {
  assert.equal(realmById('nonsense').id, REALMS[0].id);
});
