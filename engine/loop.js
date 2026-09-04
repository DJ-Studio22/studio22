// engine/loop.js
//
// Fixed-timestep game loop with interpolated rendering.
//
// The rule this file exists to enforce: a Studio 22 game must play IDENTICALLY
// on a 60Hz laptop, a 120Hz phone, and a 144Hz gaming monitor. Jump height,
// run speed, and enemy timing are gameplay, not display properties.
//
// The naive loop -- "measure the time since last frame, advance the world by
// that much" -- fails this in two ways. Floating point differences mean the
// same input produces subtly different results at different frame rates, so
// a jump that just clears a gap at 60Hz can clip its corner at 144Hz. And
// variable steps make collision detection unreliable: a fast object moves
// further per step on a slow machine and can tunnel straight through a wall
// that would have stopped it on a fast one.
//
// So the world is advanced in fixed 1/60s slices, always, on every machine.
// Real elapsed time goes into an accumulator, and whole slices are drained
// out of it. A 144Hz display simply runs slices less often than it draws;
// a 30Hz one runs two slices per draw.
//
// That leaves a leftover: at 144Hz, most frames land partway between two
// simulation steps. Drawing the world at its last stepped position makes
// motion visibly stutter, so render() receives `alpha` -- how far between
// the previous step and the current one this frame falls, 0 to 1. Games
// interpolate their visuals across that gap and motion comes out smooth
// even though physics is running at a different rate than the display.
//
// See the usage example at the bottom for what that looks like in practice.

import { Input } from './input.js';

// --- Tunables -----------------------------------------------------------

// The simulation rate. 60Hz is the sweet spot: fine enough that collision
// steps stay small, cheap enough to run several per frame on a slow phone
// without missing the render.
const STEPS_PER_SECOND = 60;
const STEP_MS = 1000 / STEPS_PER_SECOND;

// What update(dt) receives. Always this exact value -- that constancy IS
// the guarantee this module makes. Seconds rather than milliseconds so game
// code can express speeds in readable units (300 px/sec, not 0.3 px/ms).
const STEP_SECONDS = 1 / STEPS_PER_SECOND;

// The death-spiral guard. If the page stalls -- a tab left in the background,
// a garbage collection pause, a laptop lid closed for an hour -- the next
// frame reports an enormous elapsed time. Feeding that in raw would queue up
// thousands of simulation steps, which takes longer than a frame to run,
// which makes the *next* elapsed time even bigger, and the game never
// recovers. Clamping the input to a quarter second means the worst case is
// 15 steps and the game just skips ahead instead of freezing.
const MAX_FRAME_MS = 250;

// Second line of defence, for when update() itself is too slow rather than
// the frame gap being too big. If we can't drain the accumulator in this
// many steps, the game is running slower than real time regardless, so we
// deliberately drop the backlog (the game runs in slow motion) rather than
// spiral.
const MAX_STEPS_PER_FRAME = 8;

// How often to recompute the FPS readout. Every frame is too noisy to read;
// half a second is responsive but stable.
const FPS_SAMPLE_MS = 500;

export class GameLoop {
  // --- Internal state -----------------------------------------------------

  #update;
  #render;
  #onPause;
  #onResume;

  #running = false;
  #paused = false;
  #rafId = 0;

  #lastTimeMs = 0;
  #accumulatorMs = 0;

  #fps = 0;
  #fpsFrames = 0;
  #fpsWindowStartMs = 0;
  #fpsElement = null;

  /**
   * @param {object} options
   * @param {(dt: number) => void}    options.update  Advance the world by exactly
   *        dt seconds (always 1/60). Called 0..MAX_STEPS_PER_FRAME times per frame.
   * @param {(alpha: number) => void} options.render  Draw the world. `alpha` is
   *        0..1, the fraction of a step between the previous and current
   *        simulation state -- interpolate visuals across it for smooth motion.
   * @param {() => void} [options.onPause]   Fired when the loop auto-pauses (tab
   *        hidden, window blurred) or pause() is called. Show your pause screen here.
   * @param {() => void} [options.onResume]  Fired on resume().
   * @param {boolean} [options.showFps=false] Start with the FPS counter visible.
   */
  constructor(options = {}) {
    this.#update = options.update ?? (() => {});
    this.#render = options.render ?? (() => {});
    this.#onPause = options.onPause ?? null;
    this.#onResume = options.onResume ?? null;

    if (options.showFps) this.setFpsVisible(true);
    this.#listen();
  }

  // --- Public surface -----------------------------------------------------

  get isRunning() {
    return this.#running;
  }

  get isPaused() {
    return this.#paused;
  }

  // Most recent measured frames-per-second. Available whether or not the
  // on-screen counter is showing.
  get fps() {
    return this.#fps;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#paused = false;
    this.#resetTiming();
    this.#rafId = requestAnimationFrame(this.#frame);
  }

  // Full stop. start() afterwards begins fresh rather than continuing.
  stop() {
    if (!this.#running) return;
    this.#running = false;
    this.#paused = false;
    cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
  }

  pause() {
    if (!this.#running || this.#paused) return;
    this.#paused = true;
    // Stop asking for frames entirely rather than running empty ones -- no
    // reason to keep a phone's GPU awake behind a pause screen.
    cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
    if (this.#onPause) this.#onPause();
  }

  resume() {
    if (!this.#running || !this.#paused) return;
    this.#paused = false;
    // Wall-clock time kept running while we were paused, so without this
    // the first frame back would report the entire pause duration as one
    // elapsed frame and the world would lurch forward.
    this.#resetTiming();
    this.#rafId = requestAnimationFrame(this.#frame);
    if (this.#onResume) this.#onResume();
  }

  setFpsVisible(visible) {
    if (visible) {
      if (!this.#fpsElement) this.#buildFpsElement();
      this.#fpsElement.style.display = 'block';
    } else if (this.#fpsElement) {
      this.#fpsElement.style.display = 'none';
    }
  }

  toggleFps() {
    const visible = Boolean(this.#fpsElement) && this.#fpsElement.style.display !== 'none';
    this.setFpsVisible(!visible);
  }

  // --- The loop itself ----------------------------------------------------

  // Arrow function so `this` survives being handed to requestAnimationFrame.
  #frame = (nowMs) => {
    // A pause() or stop() can land between the frame being scheduled and it
    // actually running, so re-check before doing any work.
    if (!this.#running || this.#paused) return;

    // Schedule the next frame up front: if update() or render() throws, the
    // loop keeps running and the error is visible in the console, rather
    // than the whole game silently dying on one bad frame.
    this.#rafId = requestAnimationFrame(this.#frame);

    let frameMs = nowMs - this.#lastTimeMs;
    this.#lastTimeMs = nowMs;

    // See MAX_FRAME_MS above -- this single clamp is what stops a long stall
    // from turning into an unrecoverable spiral.
    if (frameMs > MAX_FRAME_MS) frameMs = MAX_FRAME_MS;

    // And the other direction: requestAnimationFrame reports the time the
    // frame *began*, which can be marginally earlier than the
    // performance.now() captured inside start()/resume() a moment before.
    // A negative delta would push the accumulator below zero, which hands
    // render() a negative alpha and has games extrapolating backwards.
    // Time never runs backwards in a simulation.
    if (frameMs < 0) frameMs = 0;

    this.#accumulatorMs += frameMs;

    // Drain whole simulation steps. Zero iterations is normal and correct on
    // a high-refresh display: that frame just redraws the same world state
    // at a slightly larger alpha.
    let steps = 0;
    while (this.#accumulatorMs >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      // Polled once per simulation step, before the game reads anything, so
      // every tick sees one coherent input snapshot -- and so pressed()/
      // released() edges line up with exactly one tick of game logic.
      Input.update();
      this.#update(STEP_SECONDS);
      this.#accumulatorMs -= STEP_MS;
      steps++;
    }

    // Hit the step ceiling with time still owed: we're running slower than
    // real time, so throw the backlog away and keep only the sub-step
    // remainder that alpha needs. The game visibly slows down, which is
    // recoverable; a spiral is not.
    if (this.#accumulatorMs >= STEP_MS) {
      this.#accumulatorMs %= STEP_MS;
    }

    this.#render(this.#accumulatorMs / STEP_MS);
    this.#trackFps(nowMs);
  };

  #resetTiming() {
    this.#lastTimeMs = performance.now();
    this.#accumulatorMs = 0;
    this.#fpsWindowStartMs = this.#lastTimeMs;
    this.#fpsFrames = 0;
  }

  #trackFps(nowMs) {
    this.#fpsFrames++;
    const elapsed = nowMs - this.#fpsWindowStartMs;
    if (elapsed < FPS_SAMPLE_MS) return;

    this.#fps = Math.round((this.#fpsFrames * 1000) / elapsed);
    this.#fpsFrames = 0;
    this.#fpsWindowStartMs = nowMs;

    // Only touch the DOM when the counter is actually on screen.
    if (this.#fpsElement && this.#fpsElement.style.display !== 'none') {
      this.#fpsElement.textContent = `${this.#fps} FPS`;
    }
  }

  // --- Events -------------------------------------------------------------

  #listen() {
    // Auto-pause. Both events matter and they aren't redundant:
    // visibilitychange covers switching tabs or backgrounding the app, blur
    // covers alt-tabbing to another window while this tab stays visible.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    window.addEventListener('blur', () => this.pause());

    // Deliberately no auto-resume: coming back to a game that's already
    // running means the player has missed however long it took them to look
    // at the screen. Games call resume() themselves, usually from a "press
    // any key" pause screen driven by the onPause callback.
  }

  #buildFpsElement() {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.top = 'var(--space-sm)';
    el.style.right = 'var(--space-sm)';
    el.style.padding = 'var(--space-xs) var(--space-sm)';
    el.style.background = 'var(--color-bg-1)';
    el.style.color = 'var(--color-accent)';
    el.style.fontFamily = 'var(--font-mono)';
    el.style.fontSize = '1rem';
    el.style.borderRadius = 'var(--radius-sm)';
    // A debug readout should never eat a tap meant for the game.
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9999';
    el.textContent = '-- FPS';
    document.body.appendChild(el);
    this.#fpsElement = el;
  }
}

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { GameCanvas } from '../../engine/canvas.js';
// import { GameLoop } from '../../engine/loop.js';
// import { Input } from '../../engine/input.js';
//
// const screen = new GameCanvas();
// const player = { x: 100, y: 100, prevX: 100, prevY: 100 };
//
// const loop = new GameLoop({
//   update(dt) {
//     // Remember where we were, so render() can interpolate out of it.
//     player.prevX = player.x;
//     player.prevY = player.y;
//
//     const state = Input.get(0);
//     player.x += state.x * 300 * dt; // 300 px/sec, identical on every display
//     player.y += state.y * 300 * dt;
//   },
//
//   render(alpha) {
//     // Draw between the last two simulation states. Without this, motion
//     // stutters on any display that isn't exactly 60Hz.
//     const x = player.prevX + (player.x - player.prevX) * alpha;
//     const y = player.prevY + (player.y - player.prevY) * alpha;
//
//     const ctx = screen.ctx;
//     ctx.clearRect(0, 0, screen.width, screen.height);
//     ctx.fillStyle = 'white';
//     ctx.fillRect(x, y, 40, 40);
//   },
//
//   onPause() { /* show a pause screen; call loop.resume() to continue */ },
// });
//
// loop.start();
//
// // Note: the loop calls Input.update() for you. A game should never call
// // it as well -- doing so would consume button press edges before the
// // game's own update() gets a chance to see them.
