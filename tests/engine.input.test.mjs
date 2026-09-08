// tests/engine.input.test.mjs
//
// engine/input.js is 836 lines that every one of the thirteen games imports,
// and it had no tests at all. That asymmetry is backwards: seven games have
// measured rules modules while the shared code they all depend on had none,
// and a fault here breaks all thirteen at once.
//
// THIS FILE FOUND A REAL BUG ON ITS FIRST RUN. up/down/left/right were not in
// BUTTON_NAMES, so Input.pressed('up') read an undefined slot and returned
// false forever. Block Buster shipped with "Hard drop: B or up" printed in its
// own controls list, and the Up half had never once worked; Ballast inherited
// the same line. Asking for a button that does not exist is not an error, so
// nothing said anything. See the note on DIRECTION_THRESHOLD in the module.
//
// What is worth asserting here is the arithmetic and the state machine —
// edge detection, the radial deadzone, device merging, the party keyboard
// layouts, and the cases where input must be FORGOTTEN. None of it is visible
// in a screenshot.
//
// Constants are imported, never restated (tests/README.md convention 1):
// the layouts come from Input.LAYOUTS and the deadzone is set through the
// module's own setter.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom();
const { Input, JOYSTICK_MAX_RADIUS_PX } = await import('../engine/input.js');

test.after(() => uninstall());

/** Clears every held key, touch and pad between tests. */
function reset() {
  window.dispatch('blur');            // drops held keys and touches
  Input.setDeadzone(0.15);
  Input.setKeyboardLayout(1, Input.LAYOUTS.WASD);
  navigator.getGamepads = () => [];
  Input.update();
  Input.update();                     // settle the edge diff
}

const hold = (code) => window.dispatch('keydown', { code });
const release = (code) => window.dispatch('keyup', { code });

/** A gamepad in the shape the Gamepad API's "standard" mapping produces. */
function fakePad({ axes = [0, 0, 0, 0], buttons = {} } = {}) {
  const list = Array.from({ length: 17 }, (_, i) => ({ pressed: Boolean(buttons[i]), value: buttons[i] ? 1 : 0 }));
  return { index: 0, connected: true, mapping: 'standard', axes, buttons: list };
}

// --- Edge detection -------------------------------------------------------

test('pressed() fires on exactly one frame, however long the key is held', () => {
  reset();
  hold('Space');
  Input.update();
  assert.equal(Input.pressed('a'), true, 'the press edge was missed');

  for (let i = 0; i < 5; i++) {
    Input.update();
    assert.equal(Input.pressed('a'), false, 'pressed() repeated while the key was merely held');
  }
  assert.equal(Input.get().a, true, 'the key should still read as held');
});

test('released() fires on exactly one frame', () => {
  reset();
  hold('Space');
  Input.update();
  release('Space');
  Input.update();
  assert.equal(Input.released('a'), true);
  Input.update();
  assert.equal(Input.released('a'), false, 'released() repeated');
});

test('asking about a button that does not exist is false, not a crash', () => {
  reset();
  Input.update();
  assert.equal(Input.pressed('nonsense'), false);
  assert.equal(Input.released('nonsense'), false);
});

// --- The directions, which is where the bug was ---------------------------

test('DIRECTIONS ARE EDGE-TRACKED — pressed("up") was dead for two games', () => {
  reset();
  hold('ArrowUp');
  Input.update();
  assert.equal(Input.pressed('up'), true, 'pressed("up") is dead again');
  assert.equal(Input.get().up, true, 'get().up is not reported');

  Input.update();
  assert.equal(Input.pressed('up'), false, 'up repeated while held');

  release('ArrowUp');
  Input.update();
  assert.equal(Input.released('up'), true);
});

test('all four directions work, and only the one being held', () => {
  for (const [code, dir] of [['ArrowUp', 'up'], ['ArrowDown', 'down'],
                             ['ArrowLeft', 'left'], ['ArrowRight', 'right']]) {
    reset();
    hold(code);
    Input.update();
    for (const other of ['up', 'down', 'left', 'right']) {
      assert.equal(Input.pressed(other), other === dir,
        `holding ${code} reported ${other} as ${other === dir ? 'not ' : ''}pressed`);
    }
    release(code);
  }
});

test('a stick past half deflection counts as a direction; a nudge does not', () => {
  reset();
  navigator.getGamepads = () => [fakePad({ axes: [0, -0.9, 0, 0] })];
  Input.update();
  assert.equal(Input.get().up, true, 'a firm stick push did not register as up');

  reset();
  navigator.getGamepads = () => [fakePad({ axes: [0, -0.3, 0, 0] })];
  Input.update();
  assert.equal(Input.get().up, false, 'a light nudge registered as a direction');
});

// --- The radial deadzone --------------------------------------------------

test('a resting stick reads exactly zero, so nothing drifts', () => {
  reset();
  navigator.getGamepads = () => [fakePad({ axes: [0.08, -0.05, 0, 0] })];
  Input.update();
  const f = Input.get();
  assert.equal(f.x, 0, 'stick drift leaked through the deadzone');
  assert.equal(f.y, 0);
});

test('the deadzone is RADIAL, not per-axis — a diagonal is not easier', () => {
  // Per-axis deadzones let a diagonal through that neither axis alone would
  // pass, so a stick rested off-centre creeps diagonally.
  reset();
  Input.setDeadzone(0.5);
  navigator.getGamepads = () => [fakePad({ axes: [0.35, 0.35, 0, 0] })];
  Input.update();
  const f = Input.get();
  // Magnitude is 0.495, just inside the deadzone, so both axes must be zero.
  assert.equal(Math.hypot(f.x, f.y), 0, 'a diagonal slipped past a radial deadzone');
});

test('output ramps from zero at the deadzone edge rather than jumping', () => {
  reset();
  Input.setDeadzone(0.25);
  navigator.getGamepads = () => [fakePad({ axes: [0.26, 0, 0, 0] })];
  Input.update();
  const justOutside = Input.get().x;
  assert.ok(justOutside > 0 && justOutside < 0.1,
    `just past the deadzone should be near zero, got ${justOutside}`);

  navigator.getGamepads = () => [fakePad({ axes: [1, 0, 0, 0] })];
  Input.update();
  assert.ok(Math.abs(Input.get().x - 1) < 1e-9, 'full deflection should reach 1');
});

test('the deadzone is clamped to something usable', () => {
  reset();
  Input.setDeadzone(5);
  navigator.getGamepads = () => [fakePad({ axes: [0.95, 0, 0, 0] })];
  Input.update();
  assert.ok(Input.get().x > 0, 'an absurd deadzone made the stick unusable');
  Input.setDeadzone(-1);
  assert.doesNotThrow(() => Input.update());
});

// --- Merging devices ------------------------------------------------------

test('keyboard and gamepad merge — the stronger vector wins', () => {
  reset();
  hold('KeyD');                                   // full right on the keyboard
  navigator.getGamepads = () => [fakePad({ axes: [0.6, 0, 0, 0] })];
  Input.update();
  assert.ok(Math.abs(Input.get().x - 1) < 1e-9,
    'a full keyboard press should beat a partial stick');
});

test('buttons merge with OR — either device can press A', () => {
  reset();
  navigator.getGamepads = () => [fakePad({ buttons: { 0: true } })];
  Input.update();
  assert.equal(Input.get().a, true, 'the pad could not press A');

  reset();
  hold('Space');
  Input.update();
  assert.equal(Input.get().a, true, 'the keyboard could not press A');
});

test('a keyboard contributes no aim vector rather than a wrong one', () => {
  reset();
  hold('KeyW');
  Input.update();
  const f = Input.get();
  assert.equal(f.aimX, 0);
  assert.equal(f.aimY, 0);
});

// --- Forgetting input -----------------------------------------------------

test('BLUR CLEARS HELD KEYS — otherwise the player alt-tabs into a wall', () => {
  reset();
  hold('KeyD');
  Input.update();
  assert.ok(Input.get().x > 0);

  // Alt-tab: the keyup lands on whatever took focus, never on us.
  window.dispatch('blur');
  Input.update();
  assert.equal(Input.get().x, 0, 'a key stayed held after the window lost focus');
});

test('changing the touch layout releases anything mid-press', () => {
  reset();
  Input.setTouchLayout([{ name: 'a', xRatio: 0.5, yRatio: 0.5, radius: 40 }]);
  Input.update();
  assert.doesNotThrow(() => Input.clearTouchLayout());
  Input.update();
  assert.equal(Input.get().a, false, 'a touch button stayed down across a layout change');
});

// --- The party keyboard layouts -------------------------------------------

test('the four party layouts share no key — four people, one keyboard', () => {
  // A collision means two players fight over one key, which is unplayable and
  // completely invisible until four people are actually sitting there.
  const layouts = Object.entries(Input.LAYOUTS);
  assert.ok(layouts.length >= 4, 'expected at least four presets');

  const owner = new Map();
  for (const [name, layout] of layouts) {
    for (const [action, codes] of Object.entries(layout)) {
      for (const code of codes) {
        // Escape is shared on purpose: any player may back out.
        if (code === 'Escape') continue;
        const previous = owner.get(code);
        assert.equal(previous, undefined,
          `${code} is in both ${previous} and ${name}.${action}`);
        owner.set(code, `${name}.${action}`);
      }
    }
  }
});

test('every layout covers every action a shell menu needs', () => {
  for (const [name, layout] of Object.entries(Input.LAYOUTS)) {
    for (const action of ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'back']) {
      assert.ok(Array.isArray(layout[action]) && layout[action].length > 0,
        `${name} has no key bound for "${action}"`);
    }
  }
});

test('a second player reads their own layout and not player one\'s', () => {
  reset();
  Input.setKeyboardLayout(1, Input.LAYOUTS.IJKL);
  hold('KeyI');                        // player two's up
  Input.update();
  assert.equal(Input.get(1).up, true, 'player two did not see their own key');
  assert.equal(Input.get(0).up, false, 'player two\'s key moved player one');
  release('KeyI');
});

test('setKeyboardLayout rejects a name it does not know', () => {
  assert.throws(() => Input.setKeyboardLayout(0, 'NOT_A_LAYOUT'), /unknown layout/i);
});

test('setKeyboardLayout catches its own arguments being swapped', () => {
  // (playerIndex, layout) is an easy pair to reverse, and reversed it used to
  // be SILENT: a number landed in the layout slot, every lookup on it came
  // back undefined, and that player's keyboard did nothing for the whole
  // party with no error anywhere. This test was written because the first
  // draft of this very file got the order wrong.
  assert.throws(() => Input.setKeyboardLayout(Input.LAYOUTS.IJKL, 1), /argument order/i);
  assert.throws(() => Input.setKeyboardLayout(0, 42), /argument order/i);
  assert.throws(() => Input.setKeyboardLayout(99, Input.LAYOUTS.WASD), /playerIndex/i);
  assert.throws(() => Input.setKeyboardLayout(-1, Input.LAYOUTS.WASD), /playerIndex/i);
});

// --- Degrading gracefully -------------------------------------------------

test('no Gamepad API at all is survivable — WebKit on some platforms', () => {
  reset();
  const real = navigator.getGamepads;
  try {
    delete navigator.getGamepads;
    assert.doesNotThrow(() => Input.update());
    assert.deepEqual(Input.getConnectedPads(), []);
  } finally {
    navigator.getGamepads = real;
  }
});

test('a Gamepad API that THROWS is treated as no pads', () => {
  reset();
  const real = navigator.getGamepads;
  try {
    navigator.getGamepads = () => { throw new Error('locked down'); };
    assert.doesNotThrow(() => Input.update());
    assert.deepEqual(Input.getConnectedPads(), []);
  } finally {
    navigator.getGamepads = real;
  }
});

test('a pad slot holding null does not count as connected', () => {
  reset();
  navigator.getGamepads = () => [null, null];
  Input.update();
  assert.deepEqual(Input.getConnectedPads(), []);
});

test('get() hands back a copy — a game cannot corrupt the input state', () => {
  reset();
  hold('KeyD');
  Input.update();
  const frame = Input.get();
  frame.x = -999;
  assert.notEqual(Input.get().x, -999, 'a game mutating its frame changed Input itself');
});

// --- Where a thumb actually finds a control -------------------------------
//
// Every fault in this section shipped, none of them was visible to any test in
// the project, and all of them were ONE fault appearing in up to twelve games
// at once. They are geometry, which is exactly the kind of thing a test is for
// and exactly the kind of thing a screenshot of one game at one size does not
// answer.

// A play area with a letterbox bar down each side, which is what a 3:2 game
// gets on a 932-wide phone in landscape.
const PLAY_AREA = { left: 134, top: 0, width: 665, height: 430 };

test('A PAD IS PLACED ON THE PLAY AREA, NOT ON THE WINDOW', () => {
  reset();
  Input.setControlBounds(PLAY_AREA);
  Input.setTouchLayout([{ name: 'a', xRatio: 0.5, yRatio: 0.5, radius: 50, label: 'GO' }]);

  const at = Input.touchButtonCenter({ name: 'a', xRatio: 0.5, yRatio: 0.5, radius: 50 });
  // Half way across the PLAY AREA, which on this screen is not half way across
  // the window. Placed against the window it landed at 466, thirty pixels off,
  // and on a narrower game it landed in the black bar entirely -- off the
  // canvas, so never drawn, and off the play area, so a thumb that found it
  // was pressing scenery.
  assert.ok(Math.abs(at.x - (134 + 665 / 2)) < 1, `pad at ${at.x}, not on the play area`);
});

test('THE WHOLE RING STAYS ON THE PLAY AREA, not just its centre', () => {
  reset();
  Input.setControlBounds(PLAY_AREA);
  const pad = { name: 'a', xRatio: 0.97, yRatio: 0.95, radius: 55, label: 'TURN' };
  Input.setTouchLayout([pad]);

  const at = Input.touchButtonCenter(pad);
  assert.ok(at.x + pad.radius <= PLAY_AREA.left + PLAY_AREA.width,
    `the pad's right edge is at ${at.x + pad.radius}, past the play area`);
  assert.ok(at.y + pad.radius <= PLAY_AREA.top + PLAY_AREA.height,
    `the pad's bottom edge is at ${at.y + pad.radius}, past the play area`);
  // Ballast declared exactly this and shipped a crescent: a ratio places a
  // centre and says nothing at all about the radius around it.
});

test('PADS DO NOT OVERLAP EACH OTHER, whatever ratios a game declared', () => {
  reset();
  // A pair a comfortable distance apart in landscape...
  const wide = { left: 0, top: 0, width: 932, height: 430 };
  const a = { name: 'a', xRatio: 0.86, yRatio: 0.78, radius: 52, label: 'DROP' };
  const b = { name: 'b', xRatio: 0.95, yRatio: 0.78, radius: 52, label: 'TURN' };
  Input.setTouchLayout([a, b]);
  Input.setControlBounds(wide);
  const apart = (x, y) => Math.hypot(x.x - y.x, x.y - y.y);
  assert.ok(apart(Input.touchButtonCenter(a), Input.touchButtonCenter(b)) >= 104);

  // ...is the same pair 39 pixels apart in portrait, because the ratio shrinks
  // with the box and the radius does not. Twelve of the twenty-three games had
  // a pair like this. Both pads still respond to a tap, which is why nothing
  // caught it; what they cannot do is tell a thumb which one it pressed.
  Input.setControlBounds({ left: 0, top: 0, width: 430, height: 932 });
  const gap = apart(Input.touchButtonCenter(a), Input.touchButtonCenter(b));
  assert.ok(gap >= 104, `the pads are ${Math.round(gap)}px apart, so they are one blob`);
});

test('and two pads declared in exactly the same place still come apart', () => {
  reset();
  Input.setControlBounds(PLAY_AREA);
  const a = { name: 'a', xRatio: 0.6, yRatio: 0.6, radius: 40 };
  const b = { name: 'b', xRatio: 0.6, yRatio: 0.6, radius: 40 };
  Input.setTouchLayout([a, b]);
  const first = Input.touchButtonCenter(a);
  const second = Input.touchButtonCenter(b);
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= 80,
    'coincident pads stayed coincident, so one of them can never be pressed');
});

test('A PAD IS NEVER LEFT SITTING ON THE RESTING STICK', () => {
  reset();
  Input.setControlBounds(PLAY_AREA);
  Input.setDirectionalTouch(true);
  // Bottom-left, which is exactly where the stick lives. Hangman, Beat Blocker
  // and Gravity Well all declared a pad here.
  const pad = { name: 'b', xRatio: 0.09, yRatio: 0.9, radius: 46, label: 'Hint' };
  Input.setTouchLayout([pad]);

  const at = Input.touchButtonCenter(pad);
  const home = Input.stickHome();
  const gap = Math.hypot(at.x - home.x, at.y - home.y);
  assert.ok(gap >= 46 + JOYSTICK_MAX_RADIUS_PX,
    `the pad is ${Math.round(gap)}px from the middle of the joystick`);
  // And it went somewhere real, not off the edge to get away.
  assert.ok(at.x - pad.radius >= PLAY_AREA.left - 1);
  assert.ok(at.y + pad.radius <= PLAY_AREA.top + PLAY_AREA.height + 1);
});

test('a game that says it does not steer does not get an invisible joystick', () => {
  reset();
  Input.setControlBounds(PLAY_AREA);
  Input.setTouchLayout([]);
  Input.setDirectionalTouch(false);

  // A drag in the left half, which is the stick's half.
  const touch = { identifier: 1, clientX: 200, clientY: 300 };
  window.dispatch('touchstart', { changedTouches: [touch], touches: [touch] });
  window.dispatch('touchmove', {
    changedTouches: [{ identifier: 1, clientX: 280, clientY: 300 }],
    touches: [{ identifier: 1, clientX: 280, clientY: 300 }],
  });
  Input.update();
  // The flag used to govern only whether the shell DREW the ring, so a game
  // that declared it did not steer still had every touch in its left half
  // swallowed by a joystick nobody could see. Hangman lost half its alphabet
  // to it.
  assert.equal(Input.get().x, 0, 'a game that does not steer is steering');
  window.dispatch('touchend', { changedTouches: [{ identifier: 1, clientX: 280, clientY: 300 }], touches: [] });
});

// The two tests about what a touch MEANS live in
// tests/engine.input.touch.test.mjs, because they need a DOM that claims to
// be a touchscreen before engine/input.js is imported, and this file does not.
