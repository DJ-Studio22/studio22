// tests/engine.canvas.test.mjs
//
// canvas.js is where the black-screen bug lived, and it is the module every
// game imports. What is worth testing here is not how anything looks — it is
// the arithmetic underneath: turning a tap at a screen coordinate into a
// position in game space.
//
// That conversion is the one every touch control depends on. Get it wrong and
// a button works on a desktop and misses by an inch on a phone, because the
// error only appears once the canvas is letterboxed and scaled. There is no
// screenshot that shows it.
//
// The DOM stub is described in helpers/dom.mjs, along with why this file gets
// to break the "no DOM in tests" rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
const { GameCanvas } = await import('../engine/canvas.js');

test.after(() => uninstall());

/** A canvas whose element reports exactly the rect a test wants. */
function makeCanvas(options = {}, rect = { left: 0, top: 0, width: 800, height: 450 }) {
  const screen = new GameCanvas({ width: 800, height: 450, ...options });
  screen.canvas._rect = { ...rect };
  return screen;
}

test('a game gets the internal size it asked for, whatever the window does', () => {
  const screen = makeCanvas();
  assert.equal(screen.width, 800);
  assert.equal(screen.height, 450);
});

test('the canvas carries an accessible name — the bug that broke every game', () => {
  // Not decoration: a game page is one canvas and nothing else, so this is the
  // only text a screen reader has. The field behind it was once referenced and
  // never declared, which is a parse error, which took all six games down.
  const screen = makeCanvas();
  assert.equal(screen.canvas.getAttribute('role'), 'img');
  assert.equal(screen.canvas.getAttribute('aria-label'), 'Test Game — Studio 22',
    'the label should default to document.title');
  assert.ok(screen.canvas.textContent.includes('Test Game'),
    'the fallback text for a browser without canvas should name the game');
});

test('an explicit label wins over the page title', () => {
  const screen = makeCanvas({ label: 'Chosen Name' });
  assert.equal(screen.canvas.getAttribute('aria-label'), 'Chosen Name');
});

test('screenToGame maps the corners exactly', () => {
  const screen = makeCanvas({}, { left: 0, top: 0, width: 800, height: 450 });

  assert.deepEqual(screen.screenToGame(0, 0), { x: 0, y: 0 });
  assert.deepEqual(screen.screenToGame(800, 450), { x: 800, y: 450 });
  assert.deepEqual(screen.screenToGame(400, 225), { x: 400, y: 225 });
});

test('screenToGame accounts for where the canvas sits on the page', () => {
  // The letterbox offset. Forgetting it is the classic version of this bug:
  // correct in the top-left, increasingly wrong toward the bottom-right.
  const screen = makeCanvas({}, { left: 240, top: 135, width: 800, height: 450 });

  assert.deepEqual(screen.screenToGame(240, 135), { x: 0, y: 0 });
  assert.deepEqual(screen.screenToGame(1040, 585), { x: 800, y: 450 });
  assert.deepEqual(screen.screenToGame(640, 360), { x: 400, y: 225 });
});

test('screenToGame undoes the display scale', () => {
  // The canvas is drawn at half size; a tap in the middle of what the player
  // sees is still the middle of the game.
  const screen = makeCanvas({}, { left: 0, top: 0, width: 400, height: 225 });

  assert.deepEqual(screen.screenToGame(200, 112.5), { x: 400, y: 225 });
  assert.deepEqual(screen.screenToGame(400, 225), { x: 800, y: 450 });
});

test('a tap outside the canvas returns coordinates outside the play area', () => {
  // Documented behaviour, and deliberate: "the player touched outside" is
  // real information. Clamping it here would hide a missed tap from the game.
  const screen = makeCanvas({}, { left: 100, top: 100, width: 800, height: 450 });

  const before = screen.screenToGame(50, 50);
  assert.ok(before.x < 0 && before.y < 0);

  const after = screen.screenToGame(1000, 700);
  assert.ok(after.x > 800 && after.y > 450);
});

test('a hidden canvas returns the origin rather than NaN', () => {
  // A zero-sized rect is a canvas inside a collapsed parent. Dividing by it
  // would put NaN into a game's input path, where it spreads silently.
  const screen = makeCanvas({}, { left: 0, top: 0, width: 0, height: 0 });
  const p = screen.screenToGame(123, 456);
  assert.deepEqual(p, { x: 0, y: 0 });
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('uiScale is 1 normally and lifts in TV mode', () => {
  assert.equal(makeCanvas().uiScale, 1);
  assert.equal(makeCanvas({ tvMode: true, tvUiScale: 1.5 }).uiScale, 1.5);
});

test('pixelRatio is uncapped by default and honours a ceiling when asked', () => {
  globalThis.window.devicePixelRatio = 3;
  assert.equal(makeCanvas().pixelRatio, 3, 'the default must not cap — that was measured on device');
  assert.equal(makeCanvas({ maxPixelRatio: 2 }).pixelRatio, 2);
  assert.equal(makeCanvas({ maxPixelRatio: 1 }).pixelRatio, 1, 'pixel-art games ask for 1');
  globalThis.window.devicePixelRatio = 1;
});

test('the 2D context exists and is transformed into game coordinates', () => {
  const screen = makeCanvas();
  assert.ok(screen.ctx, 'no drawing context');
  assert.equal(screen.ctx.canvas, screen.canvas);
});

test('the letterbox colour can be changed for a light game', () => {
  // A bright game framed in near-black reads as a rendering fault rather than
  // as framing, which is why shell.js drives this from its theme.
  const screen = makeCanvas();
  assert.doesNotThrow(() => screen.setLetterboxColor('var(--color-shell-light-bg-0)'));
});
