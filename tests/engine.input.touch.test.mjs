// tests/engine.input.touch.test.mjs
//
// WHAT A TOUCH MEANS, which is a different question from where a control is.
//
// Separate from tests/engine.input.test.mjs because engine/input.js decides at
// module load whether this is a touchscreen at all -- a desktop should not pay
// for a virtual joystick -- so the DOM has to claim to be one BEFORE the import.
//
// Both tests here are about one fault that shipped in four games and was
// reported as four unrelated bugs: the virtual joystick claims the left half
// of the play area the moment a thumb lands in it, so half of every screen
// could not be tapped. Hangman lost half its alphabet; Number Crunch,
// Keystroke and Circuit Racer each lost the left half of their setup screen,
// which is what "the menu doesn't respond" turned out to be.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom({ touch: true });
const { Input, JOYSTICK_MAX_RADIUS_PX } = await import('../engine/input.js');

test.after(() => uninstall());

// A play area with a letterbox bar down each side: a 3:2 game on a 932-wide
// phone held landscape.
const PLAY_AREA = { left: 134, top: 0, width: 665, height: 430 };

function reset() {
  window.dispatch('blur');
  Input.setControlBounds(PLAY_AREA);
  Input.setTouchLayout([]);
  Input.setDirectionalTouch(true);
  Input.update();
  Input.update();
}

const at = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
const touch = (type, ...points) => window.dispatch(type, {
  changedTouches: points,
  touches: type === 'touchend' ? [] : points,
});

test('the joystick still spawns under a thumb that means to steer', () => {
  reset();
  touch('touchstart', at(1, 250, 300));
  touch('touchmove', at(1, 250 + JOYSTICK_MAX_RADIUS_PX, 300));
  Input.update();
  assert.ok(Input.get().x > 0.9, 'a drag in the left half did not move the stick');
  touch('touchend', at(1, 250 + JOYSTICK_MAX_RADIUS_PX, 300));
});

test('A TOUCH THAT NEVER MOVED IS A TAP, even in the stick half', () => {
  reset();
  // A poke, not a drag. Every setup screen in the arcade is drawn across the
  // whole play area, so this is a player tapping a menu row -- and it used to
  // be swallowed whole by a joystick that had already claimed the touch.
  touch('touchstart', at(7, 250, 300));
  touch('touchend', at(7, 250, 300));
  Input.update();

  const tap = Input.tapped();
  assert.ok(tap, 'a poke in the left half of the screen reported no tap at all');
  assert.equal(tap.x, 250);
  assert.equal(tap.y, 300);
});

test('but a swing out and back is a drag, not a tap', () => {
  reset();
  touch('touchstart', at(8, 250, 300));
  touch('touchmove', at(8, 250 + JOYSTICK_MAX_RADIUS_PX, 300));
  Input.update();
  // Back to exactly where it started before letting go. The rescue has to look
  // at the FURTHEST the touch ever got, not at where it ended up, or a player
  // steering out and centring would hand the game a phantom tap.
  touch('touchmove', at(8, 250, 300));
  touch('touchend', at(8, 250, 300));
  Input.update();
  assert.equal(Input.tapped(), null, 'a drag was reported as a tap');
});

test('a game that says it does not steer does not get an invisible joystick', () => {
  reset();
  Input.setDirectionalTouch(false);

  touch('touchstart', at(2, 200, 300));
  touch('touchmove', at(2, 280, 300));
  Input.update();
  // The flag used to govern only whether engine/shell.js DREW the resting
  // ring, so a game that declared it did not steer still had every touch in
  // its left half swallowed by a joystick nobody could see. Hidden, not
  // absent, which is the worst of both.
  assert.equal(Input.get().x, 0, 'a game that does not steer is steering');

  // And the touch is still available as a tap, which is the whole point.
  touch('touchend', at(2, 280, 300));
  Input.update();
  assert.ok(Input.tapped() === null || Input.tapped().x === 280);
});

test('a pad still wins a touch outright — a thumb on FIRE is not also a poke', () => {
  reset();
  const pad = { name: 'a', xRatio: 0.85, yRatio: 0.8, radius: 55, label: 'FIRE' };
  Input.setTouchLayout([pad]);
  const centre = Input.touchButtonCenter(pad);

  touch('touchstart', at(3, centre.x, centre.y));
  Input.update();
  assert.equal(Input.get().a, true, 'the pad did not take the touch');
  touch('touchend', at(3, centre.x, centre.y));
  Input.update();
  assert.equal(Input.tapped(), null, 'pressing a pad also read as a tap behind it');
});
