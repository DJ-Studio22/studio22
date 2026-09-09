// tests/engine.audio.test.mjs
//
// Audio that dies when the phone takes the speaker, and whether it comes back.
//
// THE BUG THIS EXISTS FOR
// -----------------------
// On an iPhone, an alarm, a call, or switching apps suspends the page's
// AudioContext -- Safari puts it in a non-standard 'interrupted' state. The
// shipped AudioManager unlocked the context once, on the first tap, dropped its
// gesture listeners, and never called resume() again. Every game went silent
// until the page was reloaded, and nothing in the console said why.
//
// The engine cannot be run against a real AudioContext here, so this file
// drives it with a fake whose state can be changed FROM OUTSIDE, exactly as
// the OS does, and asserts the manager brings it back. The fake is deliberately
// minimal: it models the state machine and the statechange event, and nothing
// about sound.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom();
const { AudioManager } = await import('../engine/audio.js');

test.after(() => uninstall());

/**
 * A context that behaves like the browser's on the axis under test.
 *
 *   state          'suspended' until resumed, like a fresh iOS context
 *   resume()       succeeds when `allowResume` is true, otherwise leaves the
 *                  state alone and rejects -- which is what a browser does
 *                  when it wants a gesture it did not get
 *   interrupt()    the OS taking the session: state -> 'interrupted', and a
 *                  statechange event, the same as Safari
 *   suspendByOs()  the same for a backgrounded Chrome: state -> 'suspended'
 */
class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  allowResume = true;
  resumeCalls = 0;
  #listeners = [];

  addEventListener(type, fn) { if (type === 'statechange') this.#listeners.push(fn); }
  removeEventListener(type, fn) { this.#listeners = this.#listeners.filter((f) => f !== fn); }
  #fire() { for (const fn of [...this.#listeners]) fn({ type: 'statechange' }); }

  // Asynchronous like the real thing: the state changes on a later tick, not
  // inside the call, so a test can observe the stopped state in between.
  resume() {
    this.resumeCalls++;
    if (!this.allowResume) return Promise.reject(new Error('NotAllowedError'));
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.state !== 'running' && this.state !== 'closed') {
          this.state = 'running';
          this.#fire();
        }
        resolve();
      }, 0);
    });
  }

  interrupt() { this.state = 'interrupted'; this.#fire(); }
  suspendByOs() { this.state = 'suspended'; this.#fire(); }

  // The graph the manager builds on construction. None of it needs to work.
  #node() {
    const param = {
      value: 1,
      setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {},
    };
    return {
      gain: param, playbackRate: param, frequency: param,
      connect() {}, disconnect() {}, start() {}, stop() {},
      buffer: null, loop: false, type: 'sine', onended: null,
    };
  }
  createGain() { return this.#node(); }
  createBufferSource() { return this.#node(); }
  createOscillator() { return this.#node(); }
  createBuffer() { return {}; }
}

// Lets every promise the manager chained on resume() settle.
const settle = () => new Promise((r) => setTimeout(r, 5));

// Builds a manager whose context is the fake, and unlocks it with a tap the
// way a player would. Returns both so the test can drive the context.
async function unlockedManager() {
  const ctx = new FakeAudioContext();
  window.AudioContext = function () { return ctx; };
  const audio = new AudioManager();
  document.visibilityState = 'visible';

  window.dispatch('pointerdown');
  await settle();
  assert.equal(audio.isUnlocked, true, 'precondition: the first tap unlocks');
  assert.equal(audio.isRunning, true);
  return { audio, ctx };
}

test('the first tap unlocks the context, as before', async () => {
  const { audio } = await unlockedManager();
  assert.equal(audio.isRunning, true);
  // And the gesture listeners come off, so the page is not paying for them
  // during play.
  assert.equal(window.listenerCount('pointerdown'), 0);
});

test('AN INTERRUPTION FROM OUTSIDE IS RECOVERED WITHOUT A RELOAD -- the iPhone alarm case', async () => {
  const { audio, ctx } = await unlockedManager();

  // The OS takes the session. Safari's state for this is 'interrupted'.
  ctx.interrupt();
  assert.equal(audio.isRunning, false, 'the context really did stop');

  // The page is still in the foreground, so the manager should ask for it
  // back on its own, and get it.
  await settle();
  assert.equal(ctx.state, 'running', 'the manager called resume() and the context came back');
  assert.equal(audio.isRunning, true);
  // isUnlocked never lied in between: it means "has ever been unlocked".
  assert.equal(audio.isUnlocked, true);
});

test('a backgrounded suspension is recovered when the page becomes visible again', async () => {
  const { audio, ctx } = await unlockedManager();

  // Switching apps: the page hides, then the context stops. In that order,
  // because that is the order a phone does it.
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  ctx.suspendByOs();
  await settle();
  // Nothing should have brought it back while hidden -- browsers refuse, and
  // asking is pointless.
  assert.equal(audio.isRunning, false);

  // Coming back.
  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  await settle();
  assert.equal(ctx.state, 'running');
  assert.equal(audio.isRunning, true);
});

test('WHEN THE AUTOMATIC RESUME IS REFUSED, THE NEXT TAP DOES IT -- the gesture path is re-armed', async () => {
  const { audio, ctx } = await unlockedManager();

  // The browser wants a gesture and will not take a bare resume().
  ctx.allowResume = false;
  ctx.interrupt();
  await settle();
  assert.equal(audio.isRunning, false, 'the refused resume left it stopped');
  assert.ok(ctx.resumeCalls >= 1, 'it did at least try');

  // The listeners that were removed after the first unlock must be back on,
  // otherwise the player's tap does nothing and audio is gone until reload --
  // which is the shipped bug in one line.
  assert.ok(window.listenerCount('pointerdown') > 0, 'gesture listeners re-armed');

  // The player taps. Now the browser allows it, because it is a gesture.
  ctx.allowResume = true;
  window.dispatch('pointerdown');
  await settle();
  assert.equal(ctx.state, 'running');
  assert.equal(audio.isRunning, true);
  assert.equal(window.listenerCount('pointerdown'), 0, 'and released again once running');
});

test('a sound requested while stopped kicks a recovery, once, not once per sound', async () => {
  const { audio, ctx } = await unlockedManager();
  audio.define({ tick: { beep: { freq: 440, duration: 0.02 } } });

  // Stopped, and the automatic recovery refused so it stays stopped.
  ctx.allowResume = false;
  ctx.interrupt();
  await settle();
  const before = ctx.resumeCalls;

  // A game keeps playing effects into the silence. Each is an opportunity to
  // try again, but a hung resume must not be stacked sixty times a second.
  ctx.allowResume = true;
  for (let i = 0; i < 20; i++) audio.play('tick');
  await settle();
  assert.equal(ctx.state, 'running', 'the first play() brought it back');
  assert.ok(ctx.resumeCalls - before <= 2, `resume() called ${ctx.resumeCalls - before} times for 20 sounds`);
});

test('a page that has NEVER been unlocked is not resumed behind the player\'s back', async () => {
  const ctx = new FakeAudioContext();
  window.AudioContext = function () { return ctx; };
  const audio = new AudioManager();
  // Force the context into existence without a gesture, as a game does by
  // defining sounds on load.
  audio.define({ tick: { beep: { freq: 440 } } });
  audio.play('tick');

  document.visibilityState = 'visible';
  document.dispatch('visibilitychange');
  window.dispatch('focus');
  await settle();
  assert.equal(audio.isUnlocked, false);
  assert.equal(ctx.resumeCalls, 0, 'no resume attempted without a first gesture');
});

test('a closed context is left alone', async () => {
  const { audio, ctx } = await unlockedManager();
  ctx.state = 'closed';
  const calls = ctx.resumeCalls;
  document.dispatch('visibilitychange');
  audio.play('nothing');
  await settle();
  assert.equal(ctx.resumeCalls, calls);
  assert.equal(audio.isRunning, false);
});
