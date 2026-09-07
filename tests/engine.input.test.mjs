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
const { Input } = await import('../engine/input.js');

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
