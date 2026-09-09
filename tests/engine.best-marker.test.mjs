// tests/engine.best-marker.test.mjs
//
// The session-best line, shared by five distance games. The part that can be
// wrong is the crossing: fired at the wrong moment, fired twice, or fired on a
// run with nothing to beat, in every game at once. The drawing is checked by
// eye; the arithmetic that decides when the confetti goes is checked here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom();
const { BestMarker } = await import('../engine/best-marker.js');

test.after(() => uninstall());

// A canvas context that accepts anything, for the draw calls.
const ctx = document.createElement('canvas').getContext('2d');

test('a first run has nothing to beat, so there is no line and no celebration', () => {
  const marker = new BestMarker();
  for (const nothing of [null, undefined, 0, NaN, -5]) {
    marker.reset(nothing);
    assert.equal(marker.best, null, `${nothing} produced a line`);
    assert.equal(marker.visible, false);
    assert.equal(marker.update(1000, 1 / 60), false, `${nothing} produced a celebration`);
    assert.equal(marker.crossed, false);
  }
});

test('THE CROSSING FIRES ONCE, on the first tick the run is past the best', () => {
  const marker = new BestMarker();
  marker.reset(120);
  assert.equal(marker.visible, true);

  let fired = 0;
  let firedAt = -1;
  for (let progress = 0; progress <= 200; progress++) {
    if (marker.update(progress, 1 / 60, { burstX: 10, burstY: 20 })) {
      fired++;
      firedAt = progress;
    }
  }
  assert.equal(fired, 1, `the celebration fired ${fired} times`);
  // Past, not equal: matching the best is not beating it, and a run that
  // equals the best and dies has not made progress.
  assert.equal(firedAt, 121);
  assert.equal(marker.crossed, true);
  // The line comes down once passed: the number in the HUD is now the best,
  // and a line behind the player is clutter.
  assert.equal(marker.visible, false);
});

test('progress that goes backwards does not re-arm it', () => {
  // Skyhook's metres can step as rings are taken, and every game's figure is
  // a floor of something continuous. Once crossed is crossed.
  const marker = new BestMarker();
  marker.reset(50);
  assert.equal(marker.update(51, 1 / 60), true);
  assert.equal(marker.update(49, 1 / 60), false);
  assert.equal(marker.update(52, 1 / 60), false);
});

test('reset arms it again for the next run, against the new figure', () => {
  const marker = new BestMarker();
  marker.reset(50);
  marker.update(60, 1 / 60);
  marker.reset(60);
  assert.equal(marker.visible, true);
  assert.equal(marker.update(60, 1 / 60), false, 'equal to the new best counted as beating it');
  assert.equal(marker.update(61, 1 / 60), true);
});

test('the pulse is brief and the burst empties itself', () => {
  const marker = new BestMarker();
  marker.reset(10);
  marker.update(11, 1 / 60, { burstX: 0, burstY: 0 });
  assert.ok(marker.pulse > 0.9, 'the pulse did not start at full');
  // Two seconds later nothing is left of it: non-blocking means it is gone
  // before anybody has to look past it.
  for (let i = 0; i < 120; i++) marker.update(12, 1 / 60);
  assert.equal(marker.pulse, 0);
  // drawBurst and drawLine are safe to call in any state, including this one.
  marker.drawBurst(ctx);
  marker.drawLine(ctx, { orientation: 'vertical', at: 5, from: 0, to: 100, label: 'BEST 10 m' });
});

test('drawLine culls itself when the line is off the visible range', () => {
  // The games pass the visible range and never check it themselves, so a line
  // at a height two screens away must cost nothing and draw nothing. Counted
  // through the stroke calls the stub context receives.
  const marker = new BestMarker();
  marker.reset(30);
  let strokes = 0;
  const counting = new Proxy(ctx, {
    get: (target, key) => (key === 'stroke' ? () => { strokes++; } : target[key]),
  });
  marker.drawLine(counting, { orientation: 'horizontal', at: -500, from: 0, to: 100, min: 0, max: 400 });
  assert.equal(strokes, 0, 'an off-screen line was stroked');
  marker.drawLine(counting, { orientation: 'horizontal', at: 200, from: 0, to: 100, min: 0, max: 400 });
  assert.equal(strokes, 1, 'an on-screen line was not stroked');
});
