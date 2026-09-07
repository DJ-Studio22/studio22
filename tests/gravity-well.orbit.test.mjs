// tests/gravity-well.orbit.test.mjs
//
// Gravity Well's whole skill is reading a trajectory before committing to it,
// which puts everything on one claim:
//
//   THE PREDICTED PATH IS THE PATH. Not an approximation of it, not a model
//   kept in agreement with it by discipline — the same arithmetic, run twice.
//
// If that is not true then every hour a player spends learning to read the line
// is spent learning something the game does not do. It is not a bug in the HUD;
// it is the game being a lie. So the first three tests here are about nothing
// else, and one of them exists specifically so the other two cannot pass by
// both halves being equally wrong.
//
// The second claim is that the line is worth having, which is a question about
// players rather than about arithmetic: two pilots, identical in every respect
// except whether they look ahead.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  END, Flight, TUNING, advance, buildLevel, gravityAt, predict, speedOf, strayed,
} from '../games/gravity-well/orbit.js';
import { SKILLS, runOnce } from './helpers/gravity-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

const flat = (state) => ({ ...state });

// --- The honest line ------------------------------------------------------

test('THE DRAWN PATH IS THE FLOWN PATH, to the last decimal it can be', () => {
  // Fly a craft for two and a half seconds and predict the same. They are
  // the same call, so they agree exactly rather than nearly — and the tolerance
  // here is floating-point noise rather than a fudge for two models drifting.
  // A field laid out by hand rather than generated, because the comparison
  // only means anything over a path that runs the whole four seconds: predict()
  // stops where the flight would stop, so a generated level that happens to put
  // a planet in the way ends the line early and the two ends are not the same
  // question. That is correct behaviour and it is checked separately below.
  const bodies = [{ x: 150, y: 20, radius: 7, mass: 44 }, { x: 40, y: 110, radius: 6, mass: 32 }];
  const start = { x: 60, y: 60, vx: 6, vy: -3, angle: 0.4, fuel: TUNING.fuel };
  const control = { turn: 0.3, burn: true };

  {
    const forecast = predict(flat(start), bodies, control, TUNING, { seconds: 2.5 });
    assert.equal(forecast.hit, null, 'the sample path hit something, so it proves less than it should');
    const flown = flat(start);
    for (let i = 0; i < Math.round(2.5 / TUNING.step); i++) {
      advance(flown, bodies, control, TUNING.step, TUNING);
    }

    assert.ok(Math.abs(forecast.end.x - flown.x) < 1e-9,
      `the line ends at ${forecast.end.x} and the craft at ${flown.x}`);
    assert.ok(Math.abs(forecast.end.y - flown.y) < 1e-9);
    assert.ok(Math.abs(forecast.end.vx - flown.vx) < 1e-9);
    assert.ok(Math.abs(forecast.end.vy - flown.vy) < 1e-9);
  }
});

test('and it agrees at every point along the way, not only at the end', () => {
  // Two paths can land on the same point having taken different routes. This
  // walks the drawn points against the flight that produced them.
  withSeed(9, () => {
    const level = buildLevel(4);
    const start = { x: level.start.x, y: level.start.y, vx: 10, vy: 4, angle: -0.2, fuel: TUNING.fuel };
    const control = { turn: -0.45, burn: true };

    const forecast = predict(flat(start), level.bodies, control, TUNING, { seconds: 3 });
    const flown = flat(start);
    let drawn = 1;                       // points[0] is the starting position
    for (let i = 0; i < Math.round(3 / TUNING.step) && drawn < forecast.points.length; i++) {
      advance(flown, level.bodies, control, TUNING.step, TUNING);
      if (i % TUNING.predictEvery !== 0) continue;
      const point = forecast.points[drawn++];
      assert.ok(Math.hypot(point.x - flown.x, point.y - flown.y) < 1e-9,
        `point ${drawn} is ${Math.hypot(point.x - flown.x, point.y - flown.y)} away from the craft`);
    }
    assert.ok(drawn > 20, 'the prediction drew almost nothing, so this proved almost nothing');
  });
});

test('BREAK THE PHYSICS AND THE TWO DISAGREE — so the tests above can fail', () => {
  // The check on the check. Both tests above would pass just as happily if the
  // prediction and the flight were the same piece of WRONG arithmetic, which is
  // exactly the class of fault tests/README.md convention 12 is about: an
  // assertion that pins an accident rather than a property.
  //
  // So: predict under one gravity, fly under another. If the tolerance above
  // were loose enough to hide a real difference, this would slip through too.
  withSeed(11, () => {
    const level = buildLevel(3);
    const start = { x: level.start.x, y: level.start.y, vx: 8, vy: 0, angle: 0, fuel: TUNING.fuel };
    const control = { turn: 0, burn: false };
    const heavier = { ...TUNING, G: TUNING.G * 1.4 };

    const forecast = predict(flat(start), level.bodies, control, TUNING, { seconds: 4 });
    const flown = flat(start);
    for (let i = 0; i < Math.round(4 / TUNING.step); i++) {
      advance(flown, level.bodies, control, heavier.step, heavier);
    }
    assert.ok(Math.hypot(forecast.end.x - flown.x, forecast.end.y - flown.y) > 1,
      'a forty per cent change in gravity moved the craft less than a metre, '
      + 'so the comparison above is not comparing anything');
  });
});

test('the line stops where the flight would stop', () => {
  // A prediction that draws straight through a planet is worse than no
  // prediction: it is a promise that the route is clear.
  withSeed(2, () => {
    const body = { x: 60, y: 40, radius: 8, mass: 60 };
    const start = { x: 20, y: 40, vx: 30, vy: 0, angle: 0, fuel: 0 };
    const forecast = predict(start, [body], {}, TUNING, { seconds: 4 });
    assert.equal(forecast.hit?.kind, 'body');
    const last = forecast.points[forecast.points.length - 1];
    assert.ok(Math.hypot(last.x - body.x, last.y - body.y) <= body.radius + TUNING.craftRadius + 1);
  });
});

// --- The physics ----------------------------------------------------------

test('a circular orbit stays circular', () => {
  // Which is a test of the integrator rather than of the game. Euler's error is
  // a slow outward spiral: an orbit set up to be stable drifts away over a few
  // laps, and a player cannot tell that from their own bad flying. Velocity
  // Verlet holds it.
  const body = { x: 100, y: 65, radius: 8, mass: 8 * 8 * 0.9 };
  const r = 30;
  const a = Math.abs(gravityAt(100 - r, 65, [body]).ax);
  const state = { x: 100 - r, y: 65, vx: 0, vy: -Math.sqrt(a * r), angle: 0, fuel: 0 };

  let low = Infinity;
  let high = 0;
  for (let i = 0; i < 120 * 30; i++) {
    advance(state, [body], {}, TUNING.step, TUNING);
    const d = Math.hypot(state.x - body.x, state.y - body.y);
    low = Math.min(low, d);
    high = Math.max(high, d);
  }
  assert.ok(high - low < r * 0.02, `thirty seconds of orbit drifted from ${low} to ${high}`);
});

test('gravity is a well rather than a singularity', () => {
  // Softening. Without it a craft passing through a centre picks up a velocity
  // with no physical meaning, and the prediction — doing the identical sum —
  // draws it faithfully leaving the solar system.
  const body = { x: 0, y: 0, radius: 6, mass: 50 };
  const at = (d) => Math.hypot(gravityAt(d, 0, [body]).ax, gravityAt(d, 0, [body]).ay);
  assert.ok(Number.isFinite(at(0)), 'the centre of a body is infinite');
  assert.ok(at(10) > at(40), 'gravity does not fall off with distance');
  assert.ok(at(0) < at(10) * 40, 'the centre is effectively a singularity anyway');
});

test('gravity is worth more than the engine, near a body', () => {
  // Otherwise every level is "point at the gate and hold the trigger" and the
  // bodies are scenery. This is the whole reason the game exists, and it was
  // wrong on the first attempt: a stray division left the strongest pull in the
  // game at about one fortieth of the thrust.
  const body = { x: 0, y: 0, radius: 8, mass: 8 * 8 * 0.9 };
  const near = Math.abs(gravityAt(-16, 0, [body]).ax);
  assert.ok(near > TUNING.thrust, `the strongest pull is ${near} against thrust ${TUNING.thrust}`);
  // And far away it is not, or there would be nowhere safe to think.
  assert.ok(Math.abs(gravityAt(-70, 0, [body]).ax) < TUNING.thrust);
});

// --- The levels -----------------------------------------------------------

test('a level never puts a body on the start, the gate, or another body', () => {
  // The same discipline as the mini golf generator proving a hole is sinkable:
  // generate, then check, and throw the layout away rather than the player.
  withSeed(6, () => {
    for (let n = 1; n <= 40; n++) {
      const level = buildLevel(n);
      for (const body of level.bodies) {
        assert.ok(Math.hypot(body.x - level.start.x, body.y - level.start.y) > body.radius + 20,
          `level ${n} starts you inside a planet`);
        assert.ok(Math.hypot(body.x - level.gate.x, body.y - level.gate.y)
          > body.radius + TUNING.gateRadius + 6, `level ${n} buried the gate`);
      }
      for (let i = 0; i < level.bodies.length; i++) {
        for (let j = i + 1; j < level.bodies.length; j++) {
          const a = level.bodies[i];
          const b = level.bodies[j];
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius,
            `level ${n} overlapped two bodies`);
        }
      }
    }
  });
});

test('and the levels get harder without a ceiling on it', () => {
  withSeed(6, () => {
    const reach = (n) => {
      const level = buildLevel(n);
      return Math.hypot(level.gate.x - level.start.x, level.gate.y - level.start.y);
    };
    assert.ok(buildLevel(20).bodies.length > buildLevel(1).bodies.length);
    assert.ok(reach(20) > reach(1));
    // The number of bodies stops, because a field of twelve is not a harder
    // problem than a field of five, it is the same problem with less room.
    assert.equal(buildLevel(400).bodies.length, TUNING.levels.bodiesMax);
  });
});

// --- Arriving -------------------------------------------------------------

test('ARRIVING IS NOT THE SAME AS ARRIVING SLOWLY ENOUGH', () => {
  // Without a speed limit at the gate the answer to every level is "point at it
  // and dive", and the reading-the-trajectory skill the game is built around
  // has nothing to do.
  const slow = new Flight();
  slow.craft = { ...slow.gate, vx: 0, vy: 0, angle: 0, fuel: 10 };
  slow.armed = true;
  slow.step(TUNING.step, {});
  assert.equal(slow.gatesMade, 1);

  const fast = new Flight();
  fast.craft = { ...fast.gate, vx: TUNING.gateSpeed + 20, vy: 0, angle: 0, fuel: 10 };
  fast.armed = true;
  fast.step(TUNING.step, {});
  assert.equal(fast.gatesMade, 0, 'a craft arrived at any speed it liked');
});

test('a gate pays for the fuel you did not spend', () => {
  const thrifty = new Flight();
  thrifty.craft = { ...thrifty.gate, vx: 0, vy: 0, angle: 0, fuel: TUNING.fuel };
  thrifty.armed = true;
  thrifty.step(TUNING.step, {});

  const wasteful = new Flight();
  wasteful.craft = { ...wasteful.gate, vx: 0, vy: 0, angle: 0, fuel: 5 };
  wasteful.armed = true;
  wasteful.step(TUNING.step, {});

  assert.ok(thrifty.score > wasteful.score, 'fuel left in the tank is worth nothing');
});

test('a run ends for a stated reason, and crashing is one of them', () => {
  const flight = new Flight();
  const body = flight.bodies[0];
  flight.craft = { x: body.x, y: body.y, vx: 0, vy: 0, angle: 0, fuel: 10 };
  flight.armed = true;
  flight.step(TUNING.step, {});
  assert.equal(flight.running, false);
  assert.equal(flight.reason, END.CRASHED);

  const lost = new Flight();
  lost.craft = { x: -TUNING.strayMargin - 10, y: 40, vx: 0, vy: 0, angle: 0, fuel: 10 };
  lost.armed = true;
  lost.step(TUNING.step, {});
  assert.equal(lost.reason, END.STRAYED);
  assert.ok(strayed(lost.craft));
});

test('an empty tank on a good arc is not the end of the run', () => {
  // Coasting is free, and a craft that has spent everything but is falling
  // towards the gate at a sensible speed is still playing. Answered by flying
  // it — the game never asks a question about the future except by running it.
  const flight = new Flight();
  flight.bodies = [];
  const toGate = Math.atan2(flight.gate.y - flight.start.y, flight.gate.x - flight.start.x);
  flight.craft = {
    x: flight.start.x, y: flight.start.y,
    vx: Math.cos(toGate) * 20, vy: Math.sin(toGate) * 20,
    angle: toGate, fuel: 0,
  };
  flight.armed = true;
  flight.step(TUNING.step, {});
  assert.equal(flight.running, true, 'an empty tank ended a run that was going fine');

  const wrongWay = new Flight();
  wrongWay.bodies = [];
  wrongWay.craft = {
    x: wrongWay.start.x, y: wrongWay.start.y,
    vx: -40, vy: 0, angle: Math.PI, fuel: 0,
  };
  wrongWay.armed = true;
  wrongWay.step(TUNING.step, {});
  assert.equal(wrongWay.running, false);
  assert.equal(wrongWay.reason, END.STRANDED);
});

test('the simulation does not depend on the frame rate', () => {
  // The other half of the line being honest: fixed steps with the remainder
  // carried, so a busy machine flies the same craft as an idle one.
  const smooth = new Flight();
  const stuttering = new Flight();
  stuttering.bodies = smooth.bodies;
  stuttering.gate = smooth.gate;
  stuttering.craft = { ...smooth.craft };

  const control = { turn: 0.2, burn: true };
  for (let i = 0; i < 120; i++) smooth.step(1 / 120, control);
  for (let i = 0; i < 20; i++) stuttering.step(1 / 20, control);

  assert.ok(Math.hypot(smooth.craft.x - stuttering.craft.x, smooth.craft.y - stuttering.craft.y) < 1e-9,
    'the same second flown at two frame rates ended somewhere different');
});

test('NOTHING HAPPENS UNTIL THE PLAYER TOUCHES SOMETHING', () => {
  // The run-up, and hand-play is the only thing that would have found the need
  // for it: five seconds of touching nothing ended the first run CRASHED with
  // no fuel burned. In a game about reading a field before committing to it,
  // the field has to be readable before it starts happening -- otherwise the
  // first thing every level teaches is that looking at it costs you.
  //
  // There is no timer behind this. It waits as long as the player does.
  const flight = new Flight();
  const { x, y } = flight.craft;
  for (let i = 0; i < 600; i++) flight.step(TUNING.step, { turn: 0, burn: false });
  assert.equal(flight.armed, false);
  assert.equal(flight.craft.x, x, 'the craft drifted before the player did anything');
  assert.equal(flight.craft.y, y);
  assert.equal(flight.running, true, 'five seconds of reading the field ended the run');

  flight.step(TUNING.step, { turn: 1, burn: false });
  assert.equal(flight.armed, true, 'touching a control did not start anything');
});

test('and the start has room to fall in', () => {
  // The other half of the same fix. Twenty-two units of clearance is about a
  // second and a half of falling; the pull at the new distance is gentle enough
  // that the first thing that happens is a drift you have time to read.
  withSeed(15, () => {
    for (let n = 1; n <= 30; n++) {
      const level = buildLevel(n);
      for (const body of level.bodies) {
        const gap = Math.hypot(body.x - level.start.x, body.y - level.start.y) - body.radius;
        assert.ok(gap >= TUNING.startClear, `level ${n} starts you ${gap.toFixed(1)} from a planet`);
      }
    }
  });
});

// --- The claim that the line is worth having ------------------------------

test('READING THE PATH BEATS FLYING AT THE GATE — and by everything', () => {
  // Two pilots, identical in fuel, thrust, turn rate and greed. One chooses
  // what to do by flying the choice first, using the same predict() the game
  // draws on screen; the other points at the gate and burns.
  //
  // If the second one kept up, the line would be decoration and the game would
  // be an asteroids clone with planets painted on it.
  const gates = {};
  for (const skill of ['planner', 'chaser']) {
    gates[skill] = [];
    for (let seed = 1; seed <= 40; seed++) {
      withSeed(seed, () => gates[skill].push(runOnce(skill, undefined, { levels: 8 }).gates));
    }
  }
  assert.ok(summarise(gates.planner).median >= 2,
    `the planner cannot fly the game either: ${JSON.stringify(summarise(gates.planner))}`);
  assert.equal(summarise(gates.chaser).max, 0,
    'flying straight at the gate reached one, so the bodies are not in the way of anything');
});

test('SEEING FURTHER AHEAD IS WORTH MORE — which is the game, measured', () => {
  // The same pilot, the same levels, the same seeds; the only difference is how
  // far ahead it looks before choosing. If foresight bought nothing then the
  // line would be scenery and the game would be a test of nerve.
  //
  // Measured: 43, 50 and 55 of sixty first levels cleared at 7.5, 11 and 15
  // seconds of lookahead.
  const clears = (seconds) => {
    const tuning = { ...TUNING, predictSeconds: seconds };
    let cleared = 0;
    for (let seed = 1; seed <= 60; seed++) {
      withSeed(seed, () => {
        if (runOnce('planner', tuning, { levels: 3 }).gates >= 1) cleared++;
      });
    }
    return cleared;
  };
  const near = clears(7.5);
  const far = clears(15);
  assert.ok(far > near + 5,
    `looking twice as far ahead cleared ${far} against ${near}, which is noise`);
});

test('and the levels are winnable — the limit above is the pilot, not the field', () => {
  // Which is the other half of the same measurement, and worth separating: a
  // generator quietly producing problems with no answer would look exactly like
  // a pilot that cannot fly, until you give the pilot better eyes and the
  // number moves.
  //
  // Still a lower bound rather than a proof. This pilot is a greedy one --
  // eight candidate controls, re-chosen four times a second, one look ahead
  // each -- so a level it cannot fly is not necessarily a level nobody can.
  const deep = { ...TUNING, predictSeconds: 15 };
  let cleared = 0;
  for (let seed = 1; seed <= 60; seed++) {
    withSeed(seed, () => {
      if (runOnce('planner', deep, { levels: 3 }).gates >= 1) cleared++;
    });
  }
  assert.ok(cleared >= 48, `only ${cleared} of 60 first levels could be flown at all`);
});

test('the two pilots differ in exactly one field', () => {
  const keys = new Set(Object.values(SKILLS).flatMap((s) => Object.keys(s)));
  assert.deepEqual([...keys], ['usesPrediction']);
  assert.notEqual(SKILLS.planner.usesPrediction, SKILLS.chaser.usesPrediction);
});

test('tuning is data a test can override', () => {
  // Convention 3. Turn gravity off and the planner should do BETTER, because
  // every level becomes a straight line with a speed limit — which is also a
  // neat demonstration that the bodies are what make the game hard.
  const empty = { ...TUNING, G: 0 };
  const normal = [];
  const weightless = [];
  for (let seed = 1; seed <= 20; seed++) {
    withSeed(seed, () => normal.push(runOnce('planner', TUNING, { levels: 6 }).gates));
    withSeed(seed, () => weightless.push(runOnce('planner', empty, { levels: 6 }).gates));
  }
  assert.ok(summarise(weightless).median > summarise(normal).median,
    'removing gravity changed nothing, so gravity is not what the game is about');
});

test('speedOf is the speed the gate is judged on', () => {
  assert.equal(speedOf({ vx: 3, vy: 4 }), 5);
});
