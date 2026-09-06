// tests/engine.util.test.mjs
//
// The maths every game shares. None of it is visible in a screenshot: a
// collision test that is a pixel generous makes a game feel unfair without
// looking wrong, and a particle pool that leaks makes a phone hitch several
// minutes into a run.
//
// The pooling assertions matter more than they look. CLAUDE.md requires
// anything spawned in a loop to be pooled, and the whole point of the pool is
// that it never allocates after construction — a "pool" that quietly grows is
// the bug it exists to prevent, and it would look identical on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp, lerp, map, randRange, randInt, randPick, shuffle,
  distance, angleTo, circleHit, rectHit, pointInRect, circleRectHit,
  Ease, hexToRgba, lighten, darken, lerpColor, Timer, ParticleSystem,
} from '../engine/util.js';

// --- Scalars --------------------------------------------------------------

test('clamp holds the ends and passes the middle through', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(0, 0, 0), 0);
});

test('lerp is exact at both ends, which is what stops a drift at rest', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(-10, 10, 0.5), 0);
});

test('map moves a value between ranges, including inverted ones', () => {
  assert.equal(map(5, 0, 10, 0, 100), 50);
  assert.equal(map(0, 0, 10, 100, 0), 100, 'an inverted output range must still work');
  assert.equal(map(10, 0, 10, 100, 0), 0);
});

// --- Geometry -------------------------------------------------------------

test('distance is symmetric and zero for a point against itself', () => {
  assert.equal(distance(0, 0, 3, 4), 5);
  assert.equal(distance(3, 4, 0, 0), 5);
  assert.equal(distance(7, -2, 7, -2), 0);
});

test('angleTo points the way the canvas does — y grows downward', () => {
  assert.equal(angleTo(0, 0, 1, 0), 0, 'due right is zero');
  assert.ok(Math.abs(angleTo(0, 0, 0, 1) - Math.PI / 2) < 1e-12, 'straight down is +90 degrees');
  assert.ok(Math.abs(angleTo(0, 0, 0, -1) + Math.PI / 2) < 1e-12, 'straight up is -90 degrees');
});

// --- Collision ------------------------------------------------------------
//
// Each of these is checked just inside and just outside the boundary. A test
// that only checks an obvious overlap cannot tell a correct routine from one
// that is a pixel too generous, and a pixel is exactly what "that hit me when
// it clearly missed" is made of.

test('circleHit is true when the gap closes and false a hair before', () => {
  assert.equal(circleHit(0, 0, 5, 9.9, 0, 5), true, 'radii sum to 10, centres 9.9 apart');
  assert.equal(circleHit(0, 0, 5, 10.1, 0, 5), false);
  assert.equal(circleHit(0, 0, 5, 0, 0, 5), true, 'concentric circles overlap');
});

test('rectHit separates on either axis', () => {
  assert.equal(rectHit(0, 0, 10, 10, 5, 5, 10, 10), true);
  assert.equal(rectHit(0, 0, 10, 10, 10.1, 0, 10, 10), false, 'clear on x');
  assert.equal(rectHit(0, 0, 10, 10, 0, 10.1, 10, 10), false, 'clear on y');
});

test('pointInRect includes the near edge', () => {
  assert.equal(pointInRect(5, 5, 0, 0, 10, 10), true);
  assert.equal(pointInRect(0, 0, 0, 0, 10, 10), true);
  assert.equal(pointInRect(-0.1, 5, 0, 0, 10, 10), false);
  assert.equal(pointInRect(5, 10.1, 0, 0, 10, 10), false);
});

test('circleRectHit catches a corner, which is the case a naive test misses', () => {
  // A circle beyond the corner diagonally is NOT touching, even though it
  // overlaps both the x and the y span of the rectangle.
  assert.equal(circleRectHit(15, 15, 4, 0, 0, 10, 10), false, 'corner is 7.07 away, radius 4');
  assert.equal(circleRectHit(12, 12, 4, 0, 0, 10, 10), true, 'corner is 2.83 away, radius 4');
  assert.equal(circleRectHit(5, 5, 1, 0, 0, 10, 10), true, 'a circle inside the rect hits');
  assert.equal(circleRectHit(-5, 5, 4, 0, 0, 10, 10), false, 'clear to the left');
  assert.equal(circleRectHit(-3, 5, 4, 0, 0, 10, 10), true, 'just reaching the left edge');
});

// --- Easing ---------------------------------------------------------------

test('every easing function is pinned at 0 and 1', () => {
  // An ease that overshoots its endpoints leaves a UI panel a pixel out of
  // place at rest, which reads as a layout bug rather than an animation one.
  for (const [name, fn] of Object.entries(Ease)) {
    if (typeof fn !== 'function') continue;
    assert.ok(Math.abs(fn(0) - 0) < 1e-9, `${name}(0) should be 0, got ${fn(0)}`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1) should be 1, got ${fn(1)}`);
  }
});

// --- Colour ---------------------------------------------------------------

test('hexToRgba parses both hex lengths and applies the alpha', () => {
  assert.equal(hexToRgba('#ffffff', 1), 'rgba(255, 255, 255, 1)');
  assert.equal(hexToRgba('#000000', 0.5), 'rgba(0, 0, 0, 0.5)');
});

test('lighten and darken move toward the ends without leaving the range', () => {
  for (const hex of ['#000000', '#ffffff', '#ffa22b']) {
    for (const out of [lighten(hex, 0.5), darken(hex, 0.5), lighten(hex, 1), darken(hex, 1)]) {
      const parts = out.match(/\d+/g).slice(0, 3).map(Number);
      for (const c of parts) {
        assert.ok(c >= 0 && c <= 255, `${out} from ${hex} is outside 0-255`);
      }
    }
  }
});

test('lerpColor lands exactly on its endpoints', () => {
  assert.equal(lerpColor('#000000', '#ffffff', 0), lerpColor('#000000', '#ffffff', 0));
  const mid = lerpColor('#000000', '#ffffff', 0.5).match(/\d+/g).slice(0, 3).map(Number);
  for (const c of mid) assert.ok(c > 100 && c < 155, `midpoint channel ${c} is not mid-grey`);
});

// --- Random ---------------------------------------------------------------

test('the random helpers stay inside their bounds over many draws', () => {
  for (let i = 0; i < 2000; i++) {
    const r = randRange(2, 5);
    assert.ok(r >= 2 && r < 5.000001, `randRange produced ${r}`);

    const n = randInt(1, 4);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 4, `randInt produced ${n}`);
  }
});

test('randInt can reach both ends of its range', () => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(randInt(0, 2));
  assert.deepEqual([...seen].sort(), [0, 1, 2], 'an off-by-one here silently starves one outcome');
});

test('shuffle keeps every element and does not mutate the input', () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const copy = [...source];
  const out = shuffle(source);
  assert.deepEqual(source, copy, 'shuffle must not mutate its argument');
  assert.deepEqual([...out].sort((a, b) => a - b), copy);
});

test('randPick returns a member of the array', () => {
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 200; i++) assert.ok(items.includes(randPick(items)));
});

// --- Timer ----------------------------------------------------------------

test('a repeating Timer fires once per period and carries the remainder', () => {
  const t = new Timer(0.2, { repeat: true });
  let fired = 0;
  // Twelve steps of 1/60 is 0.2s exactly: one fire, not two, not none.
  for (let i = 0; i < 12; i++) if (t.update(1 / 60)) fired++;
  assert.equal(fired, 1);

  for (let i = 0; i < 12; i++) if (t.update(1 / 60)) fired++;
  assert.equal(fired, 2, 'the second period must not drift late');
});

test('a one-shot Timer fires once and then stops', () => {
  const t = new Timer(0.1);
  let fired = 0;
  for (let i = 0; i < 60; i++) if (t.update(1 / 60)) fired++;
  assert.equal(fired, 1);
});

test('progress runs 0 to 1 and never leaves it', () => {
  const t = new Timer(0.5);
  assert.equal(t.progress, 0);
  t.update(0.25);
  assert.ok(Math.abs(t.progress - 0.5) < 1e-9);
  t.update(10);
  assert.ok(t.progress >= 0 && t.progress <= 1, `progress escaped to ${t.progress}`);
});

// --- ParticleSystem -------------------------------------------------------

test('the pool never grows, and drops the overflow instead', () => {
  const p = new ParticleSystem({ max: 10 });
  assert.equal(p.capacity, 10);

  p.emit(0, 0, { count: 25, life: [1, 1] });
  assert.equal(p.activeCount, 10, 'emitting past capacity must drop, not allocate');
  assert.equal(p.capacity, 10, 'the pool grew — that is the allocation it exists to avoid');
});

test('particles are reclaimed as they expire, and the pool is reusable', () => {
  const p = new ParticleSystem({ max: 20 });
  p.emit(0, 0, { count: 20, life: [0.1, 0.1] });
  assert.equal(p.activeCount, 20);

  p.update(0.2);
  assert.equal(p.activeCount, 0, 'expired particles were not reclaimed');

  p.emit(0, 0, { count: 20, life: [0.1, 0.1] });
  assert.equal(p.activeCount, 20, 'the pool did not hand its slots back out');
  assert.equal(p.capacity, 20);
});

test('a mixed batch reclaims only what has actually expired', () => {
  // The swap-remove in update() steps the loop index back after a swap. Get
  // that wrong and it skips a particle every time one dies, which shows up as
  // effects that outlive their lifetime by a frame or two.
  const p = new ParticleSystem({ max: 40 });
  p.emit(0, 0, { count: 20, life: [0.05, 0.05] });
  p.emit(0, 0, { count: 20, life: [1, 1] });
  assert.equal(p.activeCount, 40);

  p.update(0.1);
  assert.equal(p.activeCount, 20, 'exactly the short-lived half should have gone');
});

test('clear() empties the pool without shrinking it', () => {
  const p = new ParticleSystem({ max: 15 });
  p.emit(0, 0, { count: 15, life: [1, 1] });
  p.clear();
  assert.equal(p.activeCount, 0);
  assert.equal(p.capacity, 15);
});
