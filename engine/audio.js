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
// THE INTERRUPTION PROBLEM, which is the unlock problem's second act
// ------------------------------------------------------------------
// Unlocking once is not enough on a phone. The OS takes the audio session
// away whenever it likes -- an alarm, a phone call, a notification with a
// sound, switching to another app and back -- and when it does, the context
// stops. Safari reports this as a non-standard 'interrupted' state; Chrome
// and a backgrounded Safari use plain 'suspended'. Either way the context
// does NOT come back on its own, and a page that never calls resume() again
// is silent until it is reloaded. That is exactly what shipped: the first
// version of this file removed its gesture listeners the moment the context
// was running, and nothing else ever called resume().
//
// So the module now watches for the context stopping, from three directions:
//
//   1. the context's own statechange event, which Safari and Chrome both fire
//      when the OS suspends or interrupts it;
//   2. the page becoming visible again, or regaining focus, at which point a
//      stopped context is asked to resume outright -- browsers allow that
//      without a gesture once the page has been unlocked before;
//   3. the player's next tap or key, because (2) is allowed to fail. When the
//      context stops, the gesture listeners go back on, and the next
//      interaction resumes it from inside a real user gesture, which is the
//      one path no browser refuses.
//
// isUnlocked answers "has the player ever unlocked audio"; isRunning answers
// "can this page make a noise right now". They differ during an interruption.
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
  #fallbacks = new Map(); // id -> beep options, used until a file is loaded
  #voices = [];         // reusable gain nodes, one per simultaneous sound
  #warned = new Set();  // ids already complained about, so we only do it once

  #volume = 1;
  #muted = false;

  // The two buses' own levels, independent of each other and of the master.
  // The graph was always shaped for this -- see #ensureContext -- and until now
  // nothing turned the dials.
  #musicVolume = 1;
  #sfxVolume = 1;

  #unlocked = false;
  #unlockBound = false;
  #gamepadPollId = 0;

  // True while an automatic resume() is in flight, so the kick in play() and
  // beep() does not fire one per sound effect while the OS has the session.
  // The gesture and visibility paths ignore this flag on purpose: a resume
  // that hangs for the length of a phone call must not block the tap that
  // should end it.
  #resuming = false;
  #lifecycleBound = false;

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

  /**
   * True when the context exists and is actually running -- the only state in
   * which a sound reaches the speaker. Differs from isUnlocked while the OS
   * has interrupted the session; see the header.
   */
  get isRunning() {
    return Boolean(this.#ctx) && this.#ctx.state === 'running';
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
   * Declares a game's whole sound set in one place, each entry with a
   * synthesised fallback and optionally a file.
   *
   *   audio.define({
   *     bounce: { beep: { freq: 520, duration: 0.055, type: 'square' } },
   *     spring: { beep: { freq: 780, duration: 0.14 }, file: '/assets/sfx/spring.wav' },
   *   });
   *
   * play('bounce') then works immediately, synthesised. Adding a `file` to an
   * entry is the ONLY change needed to upgrade that sound to a real
   * recording: files load in the background, play() uses the sample the
   * moment it is ready and the beep until then, and no call site moves.
   *
   * Loading is deliberately fire-and-forget. A game should never be gated on
   * audio downloading, and a file that fails simply leaves the beep in place.
   */
  define(definitions) {
    for (const [id, def] of Object.entries(definitions ?? {})) {
      if (def && def.beep) this.#fallbacks.set(id, def.beep);
      if (def && def.file) {
        // Not awaited: the beep covers the gap, and a failure is already
        // handled inside load().
        this.load(id, def.file);
      }
    }
  }

  /**
   * Plays a loaded effect, or its declared fallback beep if no file has
   * arrived for it.
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
    this.#kickIfStopped();

    const buffer = this.#buffers.get(id);
    if (!buffer) {
      // A declared fallback is the normal case before any audio files exist,
      // so it is not a problem and must not warn.
      const fallback = this.#fallbacks.get(id);
      if (fallback) {
        this.beep(fallback);
        return;
      }
      // Warn once per id: a missing sound effect is usually triggered from
      // inside a loop, and sixty identical console lines a second buries
      // whatever else the developer was trying to read.
      if (!this.#warned.has(id)) {
        this.#warned.add(id);
        console.warn(`[audio] No sound or fallback defined for "${id}" -- ignoring play().`);
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
    this.#kickIfStopped();

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
    this.#kickIfStopped();

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
   * The audio context and the music bus, for engine/music.js.
   *
   * Exposed rather than letting music.js build its own graph, so that ONE mute
   * and ONE pair of volume sliders govern both. Both force the context into
   * existence, which is safe: creating it is cheap, and it stays suspended
   * until the player has touched something.
   */
  get musicContext() {
    return this.#ensureContext();
  }

  get musicBus() {
    this.#ensureContext();
    return this.#musicGain;
  }

  /**
   * The music bus level, 0..1, independent of effects.
   *
   * Ramped rather than set, like every other gain change in this file: a step
   * change in gain is a click, and a click is the one artefact a player will
   * always notice.
   *
   * Safe before the context exists -- the value is remembered and applied when
   * it does, which matters because the volume is restored from the session
   * before anybody has touched the screen to unlock audio.
   */
  setMusicVolume(volume) {
    this.#musicVolume = clamp01(volume);
    AudioManager.#rampTo(this.#ctx, this.#musicGain, this.#musicVolume);
  }

  get musicVolume() {
    return this.#musicVolume;
  }

  /** The effects bus level, 0..1, independent of music. */
  setSfxVolume(volume) {
    this.#sfxVolume = clamp01(volume);
    AudioManager.#rampTo(this.#ctx, this.#sfxBus, this.#sfxVolume);
  }

  get sfxVolume() {
    return this.#sfxVolume;
  }

  // Shared by both setters and by #ensureContext. A no-op before the graph
  // exists, which is not a failure: the stored value is applied at build time.
  static #rampTo(ctx, node, value) {
    if (!ctx || !node) return;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(value, now + GAIN_RAMP_SECONDS);
  }

  /**
   * Forces an unlock attempt. Called automatically on the first interaction;
   * exposed only for the rare case of a game wanting to trigger it from its
   * own "tap to start" button.
   */
  unlock() {
    this.#tryUnlock();
  }

  /**
   * Asks a stopped context to start again, outside any gesture. This is what
   * the visibility and statechange watchers call; it is public so a game with
   * its own "tap to continue" screen can call it too. Harmless when the
   * context is already running or does not exist yet.
   *
   * Returns a promise that resolves to whether the context is running
   * afterwards. Never rejects: a refusal here is expected -- the browser
   * wanting a gesture -- and the gesture listeners are already re-armed for
   * exactly that case.
   */
  recover() {
    const ctx = this.#ctx;
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    if (ctx.state === 'closed') return Promise.resolve(false);

    // Whatever resume() does, the next tap must also be able to fix this.
    this.#bindUnlockListeners();

    let settled;
    try {
      settled = Promise.resolve(ctx.resume());
    } catch (error) {
      // Some older WebKit builds throw synchronously rather than rejecting.
      settled = Promise.reject(error);
    }
    return settled.then(
      () => this.#afterResumeAttempt(),
      () => this.#afterResumeAttempt(),
    );
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
    // Whatever the player last chose, applied as the graph is built rather
    // than after -- otherwise the first note of a track plays at full volume
    // and then ducks, which is worse than either level on its own.
    this.#musicGain.gain.value = this.#musicVolume;
    this.#sfxBus.gain.value = this.#sfxVolume;

    // Pre-build the voice pool so no gain node has to be allocated during
    // gameplay.
    for (let i = 0; i < MAX_VOICES; i++) {
      const gain = this.#ctx.createGain();
      gain.connect(this.#sfxBus);
      this.#voices.push({ gain, source: null, busy: false, startedAt: 0 });
    }

    this.#watchLifecycle(this.#ctx);

    return this.#ctx;
  }

  // --- Recovering from interruptions ------------------------------------

  // Wires up the three ways this module finds out the context has stopped.
  // See "THE INTERRUPTION PROBLEM" in the header.
  #watchLifecycle(ctx) {
    // (1) The context says so itself.
    try {
      if (typeof ctx.addEventListener === 'function') {
        ctx.addEventListener('statechange', this.#onStateChange);
      } else {
        ctx.onstatechange = this.#onStateChange;
      }
    } catch { /* a context that cannot report state still gets (2) and (3) */ }

    if (this.#lifecycleBound) return;
    this.#lifecycleBound = true;

    // (2) The page comes back. Three events because no single one is
    // reliable everywhere: visibilitychange is the standard signal,
    // pageshow catches iOS restoring a tab from the back-forward cache
    // without a visibilitychange, and focus catches a phone alarm that
    // dimmed the page without ever hiding it.
    document.addEventListener('visibilitychange', this.#onPageReturn);
    window.addEventListener('pageshow', this.#onPageReturn);
    window.addEventListener('focus', this.#onPageReturn);
  }

  #onStateChange = () => {
    const ctx = this.#ctx;
    if (!ctx) return;

    if (ctx.state === 'running') {
      // Whether the player tapped or the OS handed the session back on its
      // own, the context is alive: stop listening for gestures until it stops
      // again.
      this.#markUnlocked();
      this.#releaseUnlockListeners();
      return;
    }
    if (ctx.state === 'closed') return; // nothing brings a closed context back

    // Suspended or interrupted. (3): the next tap fixes it, whatever else
    // happens. Then try to fix it now without waiting for one, which works on
    // a page that has been unlocked before and is still in the foreground.
    this.#bindUnlockListeners();
    if (this.#unlocked && !isPageHidden()) this.recover();
  };

  #onPageReturn = () => {
    if (isPageHidden()) return;
    if (!this.#unlocked || !this.#ctx) return;
    if (this.#ctx.state === 'running') return;
    this.recover();
  };

  // The cheap check play() and beep() make on their way through: a sound
  // asked for while the context is stopped is the moment the player would
  // notice the silence, so it is the moment to try once more.
  #kickIfStopped() {
    const ctx = this.#ctx;
    if (!ctx || !this.#unlocked) return;
    if (ctx.state === 'running' || ctx.state === 'closed') return;
    if (this.#resuming) return;
    this.#resuming = true;
    this.recover().then(() => { this.#resuming = false; });
  }

  #afterResumeAttempt() {
    const ctx = this.#ctx;
    if (!ctx) return false;
    if (ctx.state === 'running') {
      this.#markUnlocked();
      this.#releaseUnlockListeners();
      return true;
    }
    // Still stopped: the listeners are on, the next gesture gets another go.
    return false;
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
    // NO early return on #unlocked here. The listeners that call this are
    // put back whenever the context stops, so this is also how a tap resumes
    // an interrupted context -- from inside the gesture, which is the path
    // every browser allows.
    const ctx = this.#ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.#markUnlocked();
      this.#releaseUnlockListeners();
      return;
    }

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
        this.#releaseUnlockListeners();
      } else {
        Promise.resolve(ctx.resume()).then(
          () => this.#afterResumeAttempt(),
          () => { /* still blocked; the next gesture gets another go */ },
        );
      }
    } catch (error) {
      // Leave the listeners attached and try again on the next interaction.
      console.warn(`[audio] Unlock attempt failed: ${error.message}`);
    }
  }

  #markUnlocked() {
    this.#unlocked = true;
  }

  // Safe to call when nothing is bound; the pair toggles as the context
  // stops and starts.
  #releaseUnlockListeners() {
    if (!this.#unlockBound) return;
    this.#unlockBound = false;
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

// A resume attempted while the page is hidden is refused by every browser
// that ever suspends a context, so it is not worth making.
function isPageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
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
