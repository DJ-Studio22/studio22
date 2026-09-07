// tests/engine.loop.test.mjs
//
// engine/loop.js is the clock every game runs on. It is a fixed-timestep
// accumulator, and three of its properties are load-bearing for all thirteen:
//
//   1. update() is ALWAYS handed the same dt. Every game's tuning — Gravity
//      Flip's flip budget, Ember's reachability contract, Skyhook's rope — is
//      a number expressed per tick. A variable dt makes all of it a lie.
//   2. A long stall is CLAMPED rather than replayed. Switch tabs for a minute
//      and come back, and a naive accumulator owes you 3,600 steps; it runs
//      them, misses the next frame, owes more, and never recovers. That is the
//      spiral, and MAX_FRAME_MS is the one line that stops it.
//   3. A throw STOPS the loop. It used to keep scheduling frames into a broken
//      world, so the picture froze while the console filled — see the note in
//      the module.
//
// None of these can be seen in a screenshot and all of them are arithmetic
// about specific millisecond values, so the DOM stub hands this file a manual
// clock. Nothing here advances unless the test says so.
//
// Constants are IMPORTED, never restated — tests/README.md convention 1. The
// step length in particular is derived from TICKS_PER_SECOND rather than
// written as 16.67.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom({ manualClock: true });
const clock = uninstall.clock;

const { GameLoop, TICKS_PER_SECOND, showFatalError } = await import('../engine/loop.js');

test.after(() => uninstall());

// The real step length, from the real constant.
const STEP_MS = 1000 / TICKS_PER_SECOND;

/** A loop with counting callbacks and a fresh clock. */
function makeLoop(overrides = {}) {
  clock.set(0);
  const seen = { updates: [], renders: [], alphas: [] };
  const loop = new GameLoop({
    update: (dt) => { seen.updates.push(dt); },
    render: (alpha) => { seen.renders.push(alpha); seen.alphas.push(alpha); },
    ...overrides,
  });
  return { loop, seen };
}

// --- The fixed timestep ---------------------------------------------------

test('every update gets exactly the same dt, whatever the frame took', () => {
  const { loop, seen } = makeLoop();
  loop.start();

  // Deliberately ragged frames — a real display never delivers even ones.
  for (const ms of [16, 17, 16, 33, 8, 25, 16]) clock.frame(ms);

  assert.ok(seen.updates.length > 0, 'the loop never stepped at all');
  const unique = [...new Set(seen.updates)];
  assert.equal(unique.length, 1, `update() saw ${unique.length} different dt values: ${unique}`);
  assert.equal(unique[0], 1 / TICKS_PER_SECOND);
  loop.stop();
});

test('the step count follows real time, not frame count', () => {
  const { loop, seen } = makeLoop();
  loop.start();

  // One second of wall time delivered in 20 lumpy frames.
  for (let i = 0; i < 20; i++) clock.frame(50);

  // A second of simulation is TICKS_PER_SECOND steps. Allow one either side
  // for the sub-step remainder still sitting in the accumulator.
  assert.ok(
    Math.abs(seen.updates.length - TICKS_PER_SECOND) <= 1,
    `one second of frames produced ${seen.updates.length} steps, expected about ${TICKS_PER_SECOND}`,
  );
  loop.stop();
});

test('a frame shorter than a step renders without stepping — that is correct, not a bug', () => {
  const { loop, seen } = makeLoop();
  loop.start();
  // 240Hz: four frames per simulation step.
  clock.frame(STEP_MS / 4);
  assert.equal(seen.updates.length, 0, 'a quarter-step frame should not advance the simulation');
  assert.equal(seen.renders.length, 1, 'but it must still draw');
  loop.stop();
});

test('render is handed an alpha inside [0, 1) so games can interpolate', () => {
  const { loop, seen } = makeLoop();
  loop.start();
  for (const ms of [7, 11, 16, 23, 4, 31]) clock.frame(ms);
  for (const a of seen.alphas) {
    assert.ok(a >= 0 && a < 1, `alpha ${a} is outside [0, 1)`);
  }
  loop.stop();
});

// --- The spiral guard -----------------------------------------------------

test('A LONG STALL IS CLAMPED, not replayed — the spiral of death', () => {
  const { loop, seen } = makeLoop();
  loop.start();
  clock.frame(16);
  seen.updates.length = 0;

  // A minute in another tab. Replaying that honestly is 3,600 steps, and the
  // frame after it would owe even more.
  clock.frame(60_000);

  assert.ok(
    seen.updates.length <= 8,
    `a 60-second stall ran ${seen.updates.length} simulation steps in one frame`,
  );
  loop.stop();
});

test('and the backlog is DISCARDED, so the next frame starts level', () => {
  const { loop, seen } = makeLoop();
  loop.start();
  clock.frame(16);
  clock.frame(60_000);          // the stall
  seen.updates.length = 0;

  clock.frame(16);              // an ordinary frame after it
  assert.ok(
    seen.updates.length <= 2,
    `the frame after a stall still owed ${seen.updates.length} steps — the backlog was kept`,
  );
  loop.stop();
});

test('time never runs backwards, even if a timestamp arrives early', () => {
  // requestAnimationFrame reports when the frame BEGAN, which can be a hair
  // before the performance.now() captured inside start(). A negative delta
  // would drive the accumulator below zero and hand render() a negative alpha,
  // which has games extrapolating into the past.
  const { loop, seen } = makeLoop();
  clock.set(1000);
  loop.start();
  clock.frame(-40);             // an earlier timestamp than start() saw

  assert.equal(seen.updates.length, 0, 'a backwards frame advanced the simulation');
  for (const a of seen.alphas) assert.ok(a >= 0, `alpha went negative: ${a}`);
  loop.stop();
});

// --- Containment ----------------------------------------------------------

test('A THROW STOPS THE LOOP, once, instead of spraying every frame', () => {
  clock.set(0);
  let updates = 0;
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args[0]);

  try {
    const loop = new GameLoop({
      update: () => { updates++; throw new Error('boom'); },
      render: () => {},
    });
    loop.start();
    clock.frame(20);

    const afterFirst = updates;
    // Keep pumping. A stopped loop has nothing scheduled, so these are no-ops.
    clock.frames(10, 20);

    assert.equal(updates, afterFirst, 'the loop kept calling update() after it threw');
    assert.equal(loop.isRunning, false, 'the loop is still marked running');
    assert.equal(errors.length, 1, `expected exactly one console.error, got ${errors.length}`);
    assert.match(String(errors[0]), /loop/i);
  } finally {
    console.error = realError;
  }
});

test('a throw in render is contained the same way as one in update', () => {
  clock.set(0);
  const realError = console.error;
  let logged = 0;
  console.error = () => { logged++; };
  try {
    const loop = new GameLoop({ update: () => {}, render: () => { throw new Error('render boom'); } });
    loop.start();
    clock.frame(20);
    clock.frames(5, 20);
    assert.equal(loop.isRunning, false, 'a render throw did not stop the loop');
    assert.equal(logged, 1);
  } finally {
    console.error = realError;
  }
});

test('showFatalError paints a panel and survives being called twice', () => {
  // Plain DOM on purpose: the renderer may be the thing that broke, so this
  // cannot go through the canvas.
  assert.doesNotThrow(() => showFatalError(new Error('first')));
  assert.doesNotThrow(() => showFatalError(new Error('second')));
});

// --- Pause and resume -----------------------------------------------------

test('a paused loop stops simulating and resumes without owing time', () => {
  const { loop, seen } = makeLoop();
  loop.start();
  // Two whole steps, not 16ms: a 16ms frame is SHORTER than a 16.67ms step,
  // so it legitimately renders without simulating and would prove nothing.
  clock.frame(STEP_MS * 2);
  assert.ok(seen.updates.length >= 1, "the loop never stepped before being paused");

  loop.pause();
  seen.updates.length = 0;
  clock.frames(5, STEP_MS * 2);
  assert.equal(seen.updates.length, 0, 'a paused loop kept stepping');

  // Time passed while paused. Resuming must not settle that debt.
  clock.set(clock.now() + 30_000);
  loop.resume();
  clock.frame(STEP_MS * 2);
  assert.ok(
    seen.updates.length <= 2,
    `resume() replayed ${seen.updates.length} steps of paused time`,
  );
  loop.stop();
});

test('stop() unschedules — a stopped loop leaves nothing pending', () => {
  const { loop, seen } = makeLoop();
  loop.start();
  clock.frame(16);
  loop.stop();
  seen.updates.length = 0;
  seen.renders.length = 0;
  clock.frames(5, 16);
  assert.equal(seen.updates.length, 0);
  assert.equal(seen.renders.length, 0);
});

test('TICKS_PER_SECOND is what the games were tuned against', () => {
  // Every game's per-tick numbers assume this. Changing it silently retunes
  // thirteen games at once, so it is worth one assertion that says so.
  assert.equal(TICKS_PER_SECOND, 60);
});
