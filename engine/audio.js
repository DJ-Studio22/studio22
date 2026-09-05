// engine/audio.js
//
// Sound effects, music, and a synthesized-tone fallback, on top of Web Audio.
//
// THE UNLOCK PROBLEM, which is the reason most of this file exists
// ----------------------------------------------------------------
// Browsers refuse to let a page make noise until the player has interacted
// with it. On iOS in particular an AudioContext starts in a 'suspended'
// state and stays there until it is resumed from inside a real user-gesture
// handler -- and historically, resume() alone wasn't enough: something had
// to actually be played from within that handler before the context would
// come alive. A game that skips this is completely silent on iPhone, with no
// error and nothing in the console to explain it.
//
// So this module handles it automatically. It listens for the first
// pointerdown, touchstart, or keydown, resumes the context, and plays a
// one-sample silent buffer to satisfy the older iOS rule. A game never has
// to think about it, and never has to call unlock() itself.
//
// Gamepad buttons are watched too, but with a caveat worth knowing: browsers
// do not count gamepad input as a user gesture, so a pad press cannot
// legally unlock a blocked context. The poll is there because it costs
// almost nothing and does work in the cases where the context wasn't blocked
// in the first place -- a player on a desktop who starts a game with a
// controller gets sound. Touch or key input remains the reliable path.
//
// EVERYTHING IS IN MEMORY. Volume and mute are held in fields on this
// object, never in localStorage, per the project rules. Reload the page and
// audio is back to defaults, exactly like scores in session.js.

// --- Tunables -----------------------------------------------------------

// How many effects can overlap. Past this, the oldest is cut off to make
// room -- which sounds far better than the alternative of refusing to play
// the newest sound, because the newest one is the one the player just caused.
const MAX_VOICES = 16;

// Ramp applied to volume and mute changes. Jumping a gain node straight to a
// new value produces an audible click, because the waveform steps
// discontinuously; twenty milliseconds is short enough to feel instant.
const GAIN_RAMP_SECONDS = 0.02;

// Envelope on synthesized beeps, for the same anti-click reason.
const BEEP_ATTACK_SECONDS = 0.01;

export class AudioManager {
  // --- Internal state -----------------------------------------------------

  #ctx = null;
  #master = null;   // global volume + mute
  #sfxBus = null;   // all one-shot effects
  #musicGain = null;

  #buffers = new Map(); // id -> AudioBuffer
  #voices = [];         // reusable gain nodes, one per simultaneous sound
  #warned = new Set();  // ids already complained about, so we only do it once

  #volume = 1;
  #muted = false;

  #unlocked = false;
  #unlockBound = false;
  #gamepadPollId = 0;

  #music = null; // { source, gain, id }

  constructor({ volume = 1 } = {}) {
    this.#volume = clamp01(volume);
    // Listeners go on immediately, but the AudioContext itself is created
    // lazily -- constructing one before any interaction earns a console
    // warning in Chrome and achieves nothing, since it would just sit
    // suspended.
    this.#bindUnlockListeners();
  }

  // --- Public surface -----------------------------------------------------

  get isUnlocked() {
    return this.#unlocked;
  }

  get isMuted() {
    return this.#muted;
  }

  get volume() {
    return this.#volume;
  }

  // Number of effects currently playing, for debug readouts.
  get activeVoices() {
    return this.#voices.filter((v) => v.busy).length;
  }

  /**
   * Loads one sound. Resolves true on success, false on any failure -- a
   * missing or corrupt file is a content problem, not a reason to take the
   * game down, so this never rejects and never throws.
   */
  async load(id, url) {
    const ctx = this.#ensureContext();
    if (!ctx) return false;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const encoded = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(encoded);
      this.#buffers.set(id, buffer);
      return true;
    } catch (error) {
      console.warn(`[audio] Could not load "${id}" from ${url}: ${error.message}`);
      return false;
    }
  }

  /**
   * Loads a whole { id: url } map. Always resolves, reporting counts, so a
   * game can carry on with whatever loaded.
   */
  async loadAll(map) {
    const entries = Object.entries(map ?? {});
    const results = await Promise.all(entries.map(([id, url]) => this.load(id, url)));
    const loaded = results.filter(Boolean).length;
    return { loaded, failed: results.length - loaded };
  }

  /**
   * Plays a loaded effect.
   *
   * @param {string} id
   * @param {object} [opts]
   *   volume        0..1, multiplied into the global volume (default 1)
   *   pitch         playback rate, 1 is normal (default 1)
   *   pitchVariance random +/- spread around pitch (default 0). This is what
   *                 stops a rapid-fire sound turning into a machine-gun of
   *                 identical clicks -- even 0.1 is enough for the ear to
   *                 stop hearing it as one repeated sample.
   */
  play(id, { volume = 1, pitch = 1, pitchVariance = 0 } = {}) {
    const ctx = this.#ensureContext();
    if (!ctx) return;

    const buffer = this.#buffers.get(id);
    if (!buffer) {
      // Warn once per id: a missing sound effect is usually triggered from
      // inside a loop, and sixty identical console lines a second buries
      // whatever else the developer was trying to read.
      if (!this.#warned.has(id)) {
        this.#warned.add(id);
        console.warn(`[audio] No sound loaded for "${id}" -- ignoring play().`);
      }
      return;
    }

    const voice = this.#takeVoice();
    if (!voice) return;

    // A BufferSource is single-use by spec: once started it can never be
    // started again, so it genuinely cannot be pooled. What IS pooled is the
    // gain node behind it, which is the expensive part to keep re-creating
    // and re-connecting.
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const rate = pitchVariance > 0
      ? pitch + (Math.random() * 2 - 1) * pitchVariance
      : pitch;
    source.playbackRate.value = Math.max(0.01, rate);

    voice.gain.gain.value = clamp01(volume);
    source.connect(voice.gain);

    source.onended = () => {
      voice.busy = false;
      voice.source = null;
      try { source.disconnect(); } catch { /* already torn down */ }
    };

    voice.busy = true;
    voice.source = source;
    voice.startedAt = ctx.currentTime;
    source.start();
  }

  /**
   * Synthesized tone -- no asset required. Built for prototyping before any
   * sound files exist: audio.beep({ freq: 880, duration: 0.08 }).
   *
   * Deliberately outside the voice pool. The pool exists to stop rapid-fire
   * SAMPLE playback from re-creating gain nodes; an oscillator is generated
   * on the fly, is cheap, and needs its own envelope automation that would
   * fight with a shared voice's volume. So activeVoices does not count
   * beeps -- it counts play() calls.
   *
   * @param {object} [opts] freq (Hz), duration (seconds), type (OscillatorNode
   *   type: 'sine' | 'square' | 'sawtooth' | 'triangle'), volume 0..1.
   */
  beep({ freq = 440, duration = 0.12, type = 'sine', volume = 0.3 } = {}) {
    const ctx = this.#ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    // Fade in and out rather than starting and stopping at full amplitude,
    // which would click at both ends.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(clamp01(volume), now + BEEP_ATTACK_SECONDS);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(this.#sfxBus);

    osc.start(now);
    osc.stop(now + duration + 0.02);
    // Oscillators are one-shot like buffer sources; drop the graph once it's
    // finished so it can be collected.
    osc.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
  }

  /**
   * Starts looping music, fading it in. If something is already playing it is
   * faded out at the same time, so the two cross-fade rather than one
   * slamming off as the other starts.
   */
  playMusic(id, { fadeIn = 1, loop = true, volume = 1 } = {}) {
    const ctx = this.#ensureContext();
    if (!ctx) return;

    const buffer = this.#buffers.get(id);
    if (!buffer) {
      if (!this.#warned.has(id)) {
        this.#warned.add(id);
        console.warn(`[audio] No music loaded for "${id}" -- ignoring playMusic().`);
      }
      return;
    }

    if (this.#music) this.stopMusic({ fadeOut: fadeIn });

    const gain = ctx.createGain();
    gain.connect(this.#musicGain);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(clamp01(volume), now + Math.max(0.01, fadeIn));

    source.start();
    this.#music = { source, gain, id };
  }

  // Fades the current track out and stops it. Safe to call when nothing is
  // playing.
  stopMusic({ fadeOut = 1 } = {}) {
    if (!this.#music || !this.#ctx) return;

    const { source, gain } = this.#music;
    this.#music = null;

    const now = this.#ctx.currentTime;
    const seconds = Math.max(0.01, fadeOut);

    // Ramp from wherever the gain actually is right now, not from its
    // nominal value -- otherwise interrupting a fade-in jumps to full volume
    // before fading out.
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + seconds);

    // Stop slightly after the ramp completes so the tail isn't cut off.
    try { source.stop(now + seconds + 0.05); } catch { /* already stopped */ }
    source.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
  }

  /**
   * Global mute. This is the hook engine/shell.js drives -- the shell calls
   * setMuted(bool) duck-typed, so the signature must stay exactly this.
   */
  setMuted(muted) {
    this.#muted = Boolean(muted);
    this.#applyMasterGain();
  }

  // Global volume, 0..1. Ignored while muted, and takes effect on unmute.
  setVolume(volume) {
    this.#volume = clamp01(volume);
    this.#applyMasterGain();
  }

  /**
   * Forces an unlock attempt. Called automatically on the first interaction;
   * exposed only for the rare case of a game wanting to trigger it from its
   * own "tap to start" button.
   */
  unlock() {
    this.#tryUnlock();
  }

  // --- Context setup ------------------------------------------------------

  // Creates the context and mixing graph on first use. Returns null if Web
  // Audio isn't available at all, in which case every public method above
  // quietly becomes a no-op rather than throwing.
  #ensureContext() {
    if (this.#ctx) return this.#ctx;

    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.#ctx = new Ctor();
    } catch (error) {
      console.warn(`[audio] Web Audio unavailable: ${error.message}`);
      return null;
    }

    //   voices -> sfxBus --\
    //                       >-- master -> destination
    //   music  -> musicGain /
    //
    // Separate buses so music and effects can be balanced against each other
    // later without touching either one's own gain.
    this.#master = this.#ctx.createGain();
    this.#sfxBus = this.#ctx.createGain();
    this.#musicGain = this.#ctx.createGain();

    this.#sfxBus.connect(this.#master);
    this.#musicGain.connect(this.#master);
    this.#master.connect(this.#ctx.destination);
    this.#master.gain.value = this.#muted ? 0 : this.#volume;

    // Pre-build the voice pool so no gain node has to be allocated during
    // gameplay.
    for (let i = 0; i < MAX_VOICES; i++) {
      const gain = this.#ctx.createGain();
      gain.connect(this.#sfxBus);
      this.#voices.push({ gain, source: null, busy: false, startedAt: 0 });
    }

    return this.#ctx;
  }

  #applyMasterGain() {
    if (!this.#master || !this.#ctx) return;
    const target = this.#muted ? 0 : this.#volume;
    const now = this.#ctx.currentTime;
    this.#master.gain.cancelScheduledValues(now);
    this.#master.gain.setValueAtTime(this.#master.gain.value, now);
    this.#master.gain.linearRampToValueAtTime(target, now + GAIN_RAMP_SECONDS);
  }

  // Finds a free voice, or steals the one that has been playing longest.
  #takeVoice() {
    let oldest = null;
    for (const voice of this.#voices) {
      if (!voice.busy) return voice;
      if (!oldest || voice.startedAt < oldest.startedAt) oldest = voice;
    }

    if (oldest && oldest.source) {
      try { oldest.source.stop(); } catch { /* already finished */ }
    }
    return oldest;
  }

  // --- Unlocking ----------------------------------------------------------

  #bindUnlockListeners() {
    if (this.#unlockBound) return;
    this.#unlockBound = true;

    // pointerdown covers mouse, pen, and most touch; touchstart is kept for
    // older iOS Safari, which is exactly the browser this is here for.
    window.addEventListener('pointerdown', this.#onInteraction, true);
    window.addEventListener('touchstart', this.#onInteraction, true);
    window.addEventListener('keydown', this.#onInteraction, true);

    // Only watch pads once one exists, so a keyboard-and-mouse page never
    // runs the poll at all.
    window.addEventListener('gamepadconnected', this.#startGamepadPoll);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (Array.from(pads).some(Boolean)) this.#startGamepadPoll();
    } catch { /* getGamepads throws in a few locked-down browsers */ }
  }

  #onInteraction = () => {
    this.#tryUnlock();
  };

  #startGamepadPoll = () => {
    if (this.#unlocked || this.#gamepadPollId) return;
    this.#gamepadPollId = requestAnimationFrame(this.#pollGamepads);
  };

  #pollGamepads = () => {
    this.#gamepadPollId = 0;
    if (this.#unlocked) return;

    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;
        for (const button of pad.buttons) {
          if (button && button.pressed) {
            this.#tryUnlock();
            return;
          }
        }
      }
    } catch { /* ignore and keep polling */ }

    this.#gamepadPollId = requestAnimationFrame(this.#pollGamepads);
  };

  #tryUnlock() {
    if (this.#unlocked) return;

    const ctx = this.#ensureContext();
    if (!ctx) return;

    try {
      // The iOS ritual: play something, however inaudible, from inside the
      // gesture. A single silent sample is enough, and resume() on its own
      // historically was not.
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);

      // Only claim success once the context is genuinely running. Starting a
      // buffer succeeds even on a blocked context, so treating that as proof
      // would leave the game silently muted with isUnlocked reporting yes --
      // the exact failure this module exists to prevent. Checking the state
      // instead means a refused attempt keeps the listeners attached and
      // tries again on the player's next interaction.
      if (ctx.state === 'running') {
        this.#markUnlocked();
      } else {
        ctx.resume().then(
          () => { if (ctx.state === 'running') this.#markUnlocked(); },
          () => { /* still blocked; the next gesture gets another go */ },
        );
      }
    } catch (error) {
      // Leave the listeners attached and try again on the next interaction.
      console.warn(`[audio] Unlock attempt failed: ${error.message}`);
    }
  }

  #markUnlocked() {
    if (this.#unlocked) return;
    this.#unlocked = true;
    this.#releaseUnlockListeners();
  }

  #releaseUnlockListeners() {
    window.removeEventListener('pointerdown', this.#onInteraction, true);
    window.removeEventListener('touchstart', this.#onInteraction, true);
    window.removeEventListener('keydown', this.#onInteraction, true);
    window.removeEventListener('gamepadconnected', this.#startGamepadPoll);
    if (this.#gamepadPollId) {
      cancelAnimationFrame(this.#gamepadPollId);
      this.#gamepadPollId = 0;
    }
  }
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { AudioManager } from '../../engine/audio.js';
//
// const audio = new AudioManager();
//
// // Prototyping, before any sound files exist:
// audio.beep({ freq: 880, duration: 0.08, type: 'square' });
//
// // Real assets, once there are some:
// await audio.loadAll({
//   jump: '/assets/sfx/jump.wav',
//   theme: '/assets/sfx/theme.mp3',
// });
// audio.play('jump', { pitchVariance: 0.12 });  // never twice the same
// audio.playMusic('theme', { fadeIn: 2 });
//
// // Hand it to the shell, whose Sound: On/Off menu item then drives it:
// const shell = new GameShell({ ...options, audio });
//
// // No unlock() call anywhere: the first tap or keypress does it.
