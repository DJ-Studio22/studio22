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
// it is the game being a lie. So the first four tests here are about nothing
// else, and one of them exists specifically so the other three cannot pass by
// both halves being equally wrong.
//
// The second claim is that the line is worth having, which is a question about
// players rather than about arithmetic, and it is measured across a range of
// horizons rather than asserted at one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  END, Flight, TUNING, advance, buildChunk, chunkStart, gravityAt, predict,
  speedOf, strayed,
} from '../games/gravity-well/orbit.js';
import { SKILLS, runOnce } from './helpers/gravity-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

const flat = (state) => ({ ...state });

// --- The honest line ------------------------------------------------------

test('THE DRAWN PATH IS THE FLOWN PATH, to the last decimal it can be', () => {
  // Fly a craft for two and a half seconds and predict the same. They are the
  // same call, so they agree exactly rather than nearly — the tolerance here is
  // floating-point noise rather than a fudge for two models drifting.
  //
  // A field laid out by hand rather than generated, because the comparison only
  // means anything over a path that runs the whole way: predict() stops where
  // the flight would stop, so a corridor that happens to put a planet in the
  // way ends the line early and the two ends are not the same question. That is
  // correct behaviour and it is checked separately below.
  const bodies = [{ x: 150, y: 20, radius: 7, mass: 44 }, { x: 40, y: 130, radius: 6, mass: 32 }];
  const start = { x: 60, y: 60, vx: 6, vy: -3, angle: 0.4, fuel: TUNING.fuel };
  const control = { turn: 0.3, burn: true };

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
});

test('and it agrees at every point along the way, not only at the end', () => {
  // Two paths can land on the same point having taken different routes. This
  // walks the drawn points against the flight that produced them.
  // Hand-laid for the same reason as the test above: a generated chunk that
  // happens to put a planet in the way ends the line early, and then this
  // proves almost nothing.
  const bodies = [{ x: 200, y: 20, radius: 7, mass: 44 }];
  const start = { x: 40, y: 70, vx: 10, vy: 4, angle: -0.2, fuel: TUNING.fuel };
  const control = { turn: -0.45, burn: true };

  const forecast = predict(flat(start), bodies, control, TUNING, { seconds: 3 });
  assert.equal(forecast.hit, null, 'the sample path hit something');
  const flown = flat(start);
  let drawn = 1;                       // points[0] is the starting position
  for (let i = 0; i < Math.round(3 / TUNING.step) && drawn < forecast.points.length; i++) {
    advance(flown, bodies, control, TUNING.step, TUNING);
    if (i % TUNING.predictEvery !== 0) continue;
    const point = forecast.points[drawn++];
    assert.ok(Math.hypot(point.x - flown.x, point.y - flown.y) < 1e-9,
      `point ${drawn} is ${Math.hypot(point.x - flown.x, point.y - flown.y)} from the craft`);
  }
  assert.ok(drawn > 20, 'the prediction drew almost nothing, so this proved almost nothing');
});

test('BREAK THE PHYSICS AND THE TWO DISAGREE — so the tests above can fail', () => {
  // The check on the check. Both tests above would pass just as happily if the
  // prediction and the flight were the same piece of WRONG arithmetic, which is
  // exactly the class of fault tests/README.md convention 12 is about: an
  // assertion that pins an accident rather than a property.
  const bodies = [{ x: 90, y: 60, radius: 8, mass: 60 }];
  const start = { x: 20, y: 40, vx: 8, vy: 0, angle: 0, fuel: TUNING.fuel };
  const control = { turn: 0, burn: false };
  const heavier = { ...TUNING, G: TUNING.G * 1.4 };

  const forecast = predict(flat(start), bodies, control, TUNING, { seconds: 3 });
  const flown = flat(start);
  for (let i = 0; i < Math.round(3 / TUNING.step); i++) {
    advance(flown, bodies, control, heavier.step, heavier);
  }
  assert.ok(Math.hypot(forecast.end.x - flown.x, forecast.end.y - flown.y) > 1,
    'a forty per cent change in gravity moved the craft less than a metre, '
    + 'so the comparison above is not comparing anything');
});

test('the line stops where the flight would stop', () => {
  // A prediction that draws straight through a planet is worse than no
  // prediction: it is a promise that the route is clear.
  const body = { x: 60, y: 40, radius: 8, mass: 60 };
  const start = { x: 20, y: 40, vx: 30, vy: 0, angle: 0, fuel: 0 };
  const forecast = predict(start, [body], {}, TUNING, { seconds: 4 });
  assert.equal(forecast.hit?.kind, 'body');
  const last = forecast.points[forecast.points.length - 1];
  assert.ok(Math.hypot(last.x - body.x, last.y - body.y) <= body.radius + TUNING.craftRadius + 1);
});

// --- The physics ----------------------------------------------------------

test('a circular orbit stays circular', () => {
  // A test of the integrator rather than of the game. Euler's error is a slow
  // outward spiral: an orbit set up to be stable drifts away over a few laps,
  // and a player cannot tell that from their own bad flying.
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
  const body = { x: 0, y: 0, radius: 6, mass: 50 };
  const at = (d) => Math.hypot(gravityAt(d, 0, [body]).ax, gravityAt(d, 0, [body]).ay);
  assert.ok(Number.isFinite(at(0)), 'the centre of a body is infinite');
  assert.ok(at(10) > at(40), 'gravity does not fall off with distance');
  assert.ok(at(0) < at(10) * 40, 'the centre is effectively a singularity anyway');
});

test('gravity is worth more than the engine, near a body', () => {
  // Otherwise the corridor is a straight line with scenery. This was wrong on
  // the first attempt: a stray division left the strongest pull in the game at
  // about one fortieth of the thrust.
  const body = { x: 0, y: 0, radius: 8, mass: 8 * 8 * 0.9 };
  assert.ok(Math.abs(gravityAt(-16, 0, [body]).ax) > TUNING.thrust);
  assert.ok(Math.abs(gravityAt(-70, 0, [body]).ax) < TUNING.thrust);
});

// --- The corridor ---------------------------------------------------------

test('THE FIRST CHUNK IS EMPTY — the run-up is a number somebody chose', () => {
  // Hand-play found this twice over. In the old level-based version a body
  // could sit 22 units from the start and five idle seconds ended the run;
  // rebuilt as a corridor, a body could be placed ON the start and the first
  // run ended CRASHED four tenths of a second in, having flown 37 units.
  withSeed(3, () => {
    for (let i = 0; i < 20; i++) assert.equal(buildChunk(0).bodies.length, 0);
    assert.ok(buildChunk(1).bodies.length > 0, 'the corridor never fills up');
  });
});

test('and every chunk leaves a lane you could fly through', () => {
  // Generate, then check, and throw the layout away rather than the player —
  // the same discipline as the mini golf generator proving a hole is sinkable.
  withSeed(6, () => {
    for (let n = 1; n <= 60; n++) {
      const chunk = buildChunk(n);
      const need = TUNING.craftRadius + TUNING.corridor.gap;
      let lane = false;
      for (let y = need; y <= TUNING.height - need && !lane; y += 1) {
        lane = chunk.bodies.every((b) => Math.abs(b.y - y) >= b.radius + need);
      }
      assert.ok(lane, `chunk ${n} is a wall`);
      // And no ring is buried in a planet, which would be a reward you cannot
      // take.
      for (const ring of chunk.rings) {
        for (const body of chunk.bodies) {
          assert.ok(Math.hypot(ring.x - body.x, ring.y - body.y)
            > body.radius + TUNING.gateRadius, `chunk ${n} buried a ring`);
        }
      }
    }
  });
});

test('the corridor gets harder as you get further, without a ceiling on it', () => {
  withSeed(6, () => {
    assert.ok(buildChunk(40).bodies.length > buildChunk(2).bodies.length);
    // The count stops, because a chunk of twelve is not a harder problem than a
    // chunk of six, it is the same problem with less room.
    assert.equal(buildChunk(4000).bodies.length, TUNING.corridor.bodiesMax);
  });
});

test('the world is built ahead of the craft and forgotten behind it', () => {
  const flight = new Flight();
  assert.ok(flight.chunks.length >= TUNING.corridor.lookAhead, 'nothing was built to fly into');
  flight.armed = true;
  flight.craft.x = TUNING.chunkWidth * 12;
  flight.step(TUNING.step, { turn: 0.2 });
  assert.ok(
    flight.chunks.every((c) => c.x0 + TUNING.chunkWidth > flight.craft.x - TUNING.chunkWidth * 2),
    'the corridor behind the craft is still being carried',
  );
  assert.ok(flight.chunks.some((c) => c.x0 > flight.craft.x), 'nothing ahead of the craft');
});

// --- Fuel and endings -----------------------------------------------------

test('A RING FILLS THE TANK', () => {
  // The whole point of the restructure: the circles do something. There is no
  // speed limit on taking one — a ring is a refuel, not a landing, and the
  // craft is usually moving fast when it needs one most.
  const flight = new Flight();
  flight.armed = true;
  const ring = flight.rings[0];
  assert.ok(ring, 'a corridor with no fuel in it');
  flight.craft.fuel = 5;
  flight.craft.x = ring.x;
  flight.craft.y = ring.y;
  flight.step(TUNING.step, { turn: 0.1 });
  assert.equal(flight.craft.fuel, TUNING.fuel);
  assert.equal(flight.ringsTaken, 1);
  assert.ok(!flight.rings.includes(ring), 'the ring is still there to be taken again');
});

test('distance is the score, and only forward counts', () => {
  const flight = new Flight();
  flight.armed = true;
  flight.craft.vx = 40;
  for (let i = 0; i < 120; i++) flight.step(TUNING.step, { turn: 0.01 });
  const reached = flight.distance;
  assert.ok(reached > 24, 'the craft went nowhere');
  // Drifting back over the same stretch is not progress.
  flight.craft.x -= 50;
  flight.step(TUNING.step, { turn: 0.01 });
  assert.equal(flight.distance, reached);
});

test('a run ends for a stated reason', () => {
  const crashed = new Flight();
  crashed.armed = true;
  const body = crashed.bodies[0];
  crashed.craft = { x: body.x, y: body.y, vx: 0, vy: 0, angle: 0, fuel: 10 };
  crashed.step(TUNING.step, { turn: 0.1 });
  assert.equal(crashed.running, false);
  assert.equal(crashed.reason, END.CRASHED);

  const lost = new Flight();
  lost.armed = true;
  lost.craft = { x: 40, y: -TUNING.strayMargin - 10, vx: 0, vy: 0, angle: 0, fuel: 10 };
  lost.step(TUNING.step, { turn: 0.1 });
  assert.equal(lost.reason, END.STRAYED);
});

test('an empty tank on a good arc is not the end of the run', () => {
  // Coasting is free, and a craft that has spent everything but is falling
  // towards a ring is still playing. Answered by flying it.
  const flight = new Flight();
  flight.armed = true;
  const ring = flight.rings[0];
  flight.craft = { x: ring.x - 40, y: ring.y, vx: 40, vy: 0, angle: 0, fuel: 0 };
  flight.step(TUNING.step, { turn: 0.001 });
  assert.equal(flight.running, true, 'an empty tank ended a run that was going fine');
});

test('NOTHING HAPPENS UNTIL THE PLAYER TOUCHES SOMETHING', () => {
  // The run-up, and hand-play is the only thing that found the need for it.
  // There is no timer behind this: it waits as long as the player does.
  const flight = new Flight();
  const { x, y } = flight.craft;
  for (let i = 0; i < 600; i++) flight.step(TUNING.step, { turn: 0, burn: false });
  assert.equal(flight.armed, false);
  assert.equal(flight.craft.x, x, 'the craft drifted before the player did anything');
  assert.equal(flight.craft.y, y);
  assert.equal(flight.running, true);

  flight.step(TUNING.step, { turn: 1, burn: false });
  assert.equal(flight.armed, true, 'touching a control did not start anything');
});

// --- The claim that the line is worth having ------------------------------

test('READING THE PATH BEATS FLYING AT THE CORRIDOR', () => {
  // Two pilots, identical in fuel, thrust, turn rate and impatience. One
  // chooses by flying the choice first, using the same predict() the game
  // draws; the other points down the corridor and burns.
  const median = (skill) => {
    const distances = [];
    for (let seed = 1; seed <= 20; seed++) {
      withSeed(seed, () => distances.push(runOnce(skill, undefined, { seconds: 60 }).distance));
    }
    return summarise(distances).median;
  };
  const planner = median('planner');
  const chaser = median('chaser');
  assert.ok(planner > chaser * 2.5, `flying blind keeps up: ${chaser} against ${planner}`);
});

test('SEEING FURTHER AHEAD IS WORTH MORE, up to the length of a decision', () => {
  // The same pilot, the same corridor, the same seeds; the only difference is
  // how far ahead it looks. Thirty seeds each, median distance:
  //
  //   none 670 | 0.5s 670 | 1s 2074 | 2s 3370 | 3s 7661 | 4.5s 7153 | 6s 7657
  //   and then away again: 9.5s 3021, 15s 2626.
  //
  // Eleven times better with three seconds of it than with none. It stops
  // paying past about six, and that is not a flaw in the idea but a property of
  // what the line means: it answers "where does this take me if I keep doing
  // this", so it is worth exactly as much as the time you keep doing it. A
  // fifteen-second line drawn on the assumption you never move the stick is a
  // fifteen-second lie. The game draws five.
  const median = (seconds) => {
    const tuning = { ...TUNING, predictSeconds: seconds };
    const distances = [];
    for (let seed = 1; seed <= 20; seed++) {
      withSeed(seed, () => distances.push(runOnce('planner', tuning, { seconds: 60 }).distance));
    }
    return summarise(distances).median;
  };
  const blind = median(0.5);
  const looking = median(3);
  assert.ok(looking > blind * 3,
    `looking three seconds ahead is worth almost nothing: ${blind} against ${looking}`);
  assert.ok(TUNING.predictSeconds >= 3 && TUNING.predictSeconds <= 6,
    'the drawn line is outside the range that was measured to pay');
});

test('the pilots differ along two named axes and nothing else', () => {
  // Sight (usesPrediction, and how much of the line is read) and cadence (how
  // often the pilot re-decides). A third field appearing here is a third thing
  // the comparison could be measuring without saying so.
  const keys = new Set(Object.values(SKILLS).flatMap((s) => Object.keys(s)));
  assert.deepEqual([...keys].sort(), ['decideEvery', 'horizon', 'usesPrediction']);
  // The chaser is the good pilot without eyes: same cadence, no line.
  assert.notEqual(SKILLS.good.usesPrediction, SKILLS.chaser.usesPrediction);
  assert.equal(SKILLS.good.decideEvery, SKILLS.chaser.decideEvery);
  // The competent pilot has the same eyes as the good one and reads less of
  // the line, less often.
  assert.equal(SKILLS.competent.usesPrediction, SKILLS.good.usesPrediction);
  assert.ok(SKILLS.competent.horizon < SKILLS.good.horizon);
  assert.ok(SKILLS.competent.decideEvery > SKILLS.good.decideEvery);
  // And the good pilot reads the whole of what the game draws, no more.
  assert.equal(SKILLS.good.horizon, TUNING.predictSeconds);
  assert.equal(SKILLS.planner, SKILLS.good);
});

test('tuning is data a test can override — and gravity is what makes it a game', () => {
  // Convention 3. Turning gravity off does not simply make the corridor easier:
  // measured over twenty seeds the MEDIAN barely moves (4464 with, 4327
  // without) while the floor rises enormously — a worst run of 432 with gravity
  // against 2247 without.
  //
  // Which is a better description of what the pull does than "it makes it
  // harder". It is what makes a run vary: the same corridor can slingshot you a
  // long way or end you early, and that spread is the game. A slalom with no
  // gravity in it is safer and duller.
  //
  // The top speed (TUNING.maxSpeed, September 2026) took the edge off the worst
  // case on purpose -- a slingshot can no longer fling the craft into the next
  // body at a speed nothing could answer -- so the floor moved from a fifth of
  // the weightless floor to about six tenths of it (1876 against 3055 over
  // sixteen seeds). The spread is still wider with gravity than without, which
  // is the claim that matters; the ratio below is loosened to fit the cap and
  // no further.
  const empty = { ...TUNING, G: 0 };
  const normal = [];
  const weightless = [];
  for (let seed = 1; seed <= 16; seed++) {
    withSeed(seed, () => normal.push(runOnce('planner', TUNING, { seconds: 40 }).distance));
    withSeed(seed, () => weightless.push(runOnce('planner', empty, { seconds: 40 }).distance));
  }
  const withGravity = summarise(normal);
  const without = summarise(weightless);
  assert.ok(withGravity.min < without.min * 0.8,
    `the worst run is ${without.min} without gravity against ${withGravity.min} with it, `
    + 'so the pull is not doing anything');
  assert.ok(withGravity.p90 - withGravity.p10 > without.p90 - without.p10,
    'gravity does not widen the spread of outcomes, so it is scenery');
});

test('THE TOP SPEED IS WHAT MADE IT PLAYABLE, and it holds in the prediction too', () => {
  // The number behind the September 2026 easing. Without a cap the competent
  // pilot -- one that reads a second and a half of the line, twice a second --
  // averaged 215 units a second and died at a median 14.5 seconds; a screen a
  // second is faster than a thumb. With the cap its median run is three times
  // as long and the good pilot stops crashing altogether. Measured over thirty
  // seeds of sixty seconds:
  //
  //                 competent            good
  //   no cap        median death 14.5s   25.3s   (30/30 dead, mostly crashed)
  //   cap 100       median death 42.4s   60s+    (good: 18/30 alive, 0 crashes)
  //
  // So the cap is asserted as tuning, and the cap is asserted to be enforced
  // by the integrator -- a cap applied to the craft but not to the prediction
  // would make the line a lie about speed.
  assert.ok(TUNING.maxSpeed > 0 && TUNING.maxSpeed <= 120, `maxSpeed ${TUNING.maxSpeed} is outside what was measured to play`);

  const fast = { x: 100, y: 75, vx: 500, vy: 0, angle: 0, fuel: 100 };
  advance(fast, [], { burn: true }, TUNING.step);
  assert.ok(Math.abs(speedOf(fast) - TUNING.maxSpeed) < 1e-9, 'the craft exceeds the top speed');

  const flown = { x: 100, y: 75, vx: 500, vy: 20, angle: 0.3, fuel: 100 };
  const forecast = predict(flown, [], { burn: true }, TUNING, { seconds: 1 });
  assert.ok(Math.abs(speedOf(forecast.end) - TUNING.maxSpeed) < 1e-9, 'the prediction is not capped the same way');

  // And with the cap removed the same craft keeps its speed -- so the test
  // above is measuring the cap and not something else.
  const uncapped = advance({ ...fast, vx: 500, vy: 0 }, [], {}, TUNING.step, { ...TUNING, maxSpeed: 0 });
  assert.ok(speedOf(uncapped) > 400);
});

test('THE COMPETENT PILOT LASTS, which is what "easier" means here', () => {
  // Not distance: distance is what the cap trades away. Survival. A competent
  // reader who died at fourteen seconds is now past thirty at the median, and
  // the good pilot is not merely also helped -- it stops crashing, so the two
  // are separated by fuel and navigation rather than by reflexes.
  const life = (skill) => {
    const seconds = [];
    let crashes = 0;
    for (let seed = 1; seed <= 16; seed++) {
      withSeed(seed, () => {
        const run = runOnce(skill, TUNING, { seconds: 60 });
        seconds.push(run.seconds);
        if (run.reason === END.CRASHED) crashes++;
      });
    }
    return { median: summarise(seconds).median, crashes };
  };
  const competent = life('competent');
  const good = life('good');
  assert.ok(competent.median >= 30, `a competent run lasts ${competent.median}s at the median; it was 14.5 before the cap`);
  assert.ok(good.median > competent.median, 'reading the whole line is not worth more time alive than reading part of it');
  assert.ok(good.crashes <= 2, `the good pilot crashed ${good.crashes} times in sixteen; the cap was meant to end that`);
});

test('speedOf, strayed and chunkStart are what the run is judged on', () => {
  assert.equal(speedOf({ vx: 3, vy: 4 }), 5);
  assert.equal(strayed({ x: 100, y: -TUNING.strayMargin - 1 }), true);
  assert.equal(strayed({ x: 100, y: TUNING.height / 2 }), false);
  assert.equal(chunkStart(3), 3 * TUNING.chunkWidth);
});
