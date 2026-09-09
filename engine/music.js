// engine/music.js
//
// Background music for the games where sound is furniture rather than
// information.
//
// WHAT THIS IS NOT FOR
// --------------------
// Beat Blocker's music IS the chart -- every tone is scheduled from the same
// list of numbers the gameplay reads, and a second piece of music playing over
// it would be two songs at once in a game about being on the beat. Any game
// where a sound tells you something you have to act on is the same case. So
// music is opt-in per game, declared in games/<game>/game.js, and the default
// is silence.
//
// WHY A PLAYLIST RATHER THAN A LOOP
// ---------------------------------
// The tracks are full songs of three to five minutes, not the short loops the
// mechanism was first sketched for. Looping a whole song means an abrupt jump
// from its last bar back to its first, every few minutes, for as long as
// somebody plays -- which is worse than any gap at a loop point.
//
// So a session plays a SHUFFLED PLAYLIST and cross-fades one track into the
// next a few seconds before the end. The player hears continuous music that
// changes, nothing ever restarts abruptly, and the whole thing still works
// unchanged if the tracks are later re-exported as real short loops: a loop is
// just a playlist of one, and loopStart/loopEnd below handle it.
//
// WHAT IT COSTS, AND WHEN
// -----------------------
// NOTHING until a game with music actually starts, and nothing at all if sound
// is off. The landing page and the arcade hub never import this module, so they
// cannot fetch audio even by accident. ONE track is fetched to begin with, and
// the next only in the last half-minute of it -- so the cost of starting a game
// is one file, not five and not two.
//
// If a file is missing, slow, or corrupt, the game gets silence. Never an
// error, never a stall: this module's failure mode is the absence of music.

import { Session } from './session.js';

// The five tracks, in public/music/. Filenames are URL-safe on purpose -- the
// originals had spaces and an apostrophe, which survive a fetch only by luck
// and encoding.
const TRACKS = [
  'beautiful-mistake',
  'dont-call-me',
  'never-good-at-leaving',
  'stay-a-while',
  'tonight-again',
];

const BASE = '/music/';

// How long a cross-fade takes, and how far before the end of a track the next
// one starts. The fade is deliberately long: this is background music, and a
// quick change draws attention to itself, which is the one thing background
// music must not do.
const CROSSFADE_SECONDS = 4;

// The opening fade. Slower still, because it happens while the player is
// reading a title screen and a song arriving suddenly is a jump scare.
const FADE_IN_SECONDS = 3;

// How quickly music gets out of the way when the game stops asking for it.
const FADE_OUT_SECONDS = 1.2;

// Anything quieter than this counts as silence when trimming a track's ends.
// -60dB or so: low enough not to clip a real fade-in, high enough to catch the
// encoder padding this is looking for.
const SILENCE = 0.001;

// How long before a hand-over the next track starts downloading. See the note
// in #advance: the point of this number is that starting a game costs ONE file.
const PREFETCH_LEAD = 30;

/**
 * Where the audible part of a decoded buffer starts and ends, in seconds.
 *
 * An MP3 does not decode to exactly what went in. The encoder pads the front
 * (encoder delay, typically around 1100 samples) and the back (to fill the last
 * frame), and decodeAudioData hands that padding straight to you: Chrome
 * applies the gapless tags, Safari historically does not, and neither is
 * something to depend on. Played as a loop, that padding is the click.
 *
 * Scanning for the first and last sample above the noise floor removes exactly
 * that, and does the right thing for any file: a track that genuinely opens on
 * silence keeps its silence trimmed too, which is what anybody wants from
 * background music anyway.
 */
function audibleRange(buffer) {
  const channel = buffer.getChannelData(0);
  const length = channel.length;
  let first = 0;
  let last = length - 1;
  while (first < length && Math.abs(channel[first]) < SILENCE) first++;
  while (last > first && Math.abs(channel[last]) < SILENCE) last--;
  // A buffer that is silent all the way through: leave it alone rather than
  // returning a zero-length region that would make a source play nothing for
  // ever.
  if (first >= last) return { start: 0, end: buffer.duration };
  return { start: first / buffer.sampleRate, end: (last + 1) / buffer.sampleRate };
}

/** Fisher-Yates, so a session does not always open on the same song. */
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class Music {
  #audio;
  #order = [];
  #next = 0;
  #playing = null;      // { source, gain, endsAt }
  #timer = null;
  #prefetchTimer = null;
  #started = false;
  #decoded = new Map(); // id -> AudioBuffer, only what has actually been heard
  #prefetching = null;

  /**
   * @param {AudioManager} audio  the game's own AudioManager, so music and
   *                              effects share one context and one mute.
   */
  constructor(audio) {
    this.#audio = audio;
  }

  /**
   * Start the session's music. Safe to call more than once; safe to call when
   * sound is off, when the files are missing, and when the browser has no
   * audio context at all.
   *
   * ASKS BEFORE IT FETCHES. Sound off means no request is made, which is the
   * difference between "muted" and "silent": a muted page that downloaded six
   * megabytes anyway has not respected anything.
   */
  start() {
    if (this.#started) return;
    if (!Session.isSoundOn()) return;
    this.#started = true;
    this.#order = shuffled(TRACKS);
    this.#next = 0;
    this.#advance(FADE_IN_SECONDS);
  }

  /** Fade out and stop. The session can be started again later. */
  stop({ fadeOut = FADE_OUT_SECONDS } = {}) {
    this.#started = false;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    if (this.#prefetchTimer) { clearTimeout(this.#prefetchTimer); this.#prefetchTimer = null; }
    this.#fadeOutCurrent(fadeOut);
  }

  /** True while a track is playing or fading in. */
  get isPlaying() {
    return Boolean(this.#playing);
  }

  // --- Internals ----------------------------------------------------------

  #fadeOutCurrent(seconds) {
    const playing = this.#playing;
    if (!playing) return;
    this.#playing = null;
    const ctx = this.#context();
    if (!ctx) return;
    const now = ctx.currentTime;
    const { source, gain } = playing;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    try { source.stop(now + seconds + 0.05); } catch { /* already stopped */ }
    source.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
  }

  // The AudioManager owns the context and the music bus; this reaches them
  // through the small accessor it exposes rather than building its own graph,
  // so one mute and one volume slider govern everything.
  #context() {
    return this.#audio?.musicContext ?? null;
  }

  #bus() {
    return this.#audio?.musicBus ?? null;
  }

  async #load(id) {
    if (this.#decoded.has(id)) return this.#decoded.get(id);
    const ctx = this.#context();
    if (!ctx) return null;
    try {
      const response = await fetch(`${BASE}${id}.mp3`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const encoded = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(encoded);
      this.#decoded.set(id, buffer);
      return buffer;
    } catch (error) {
      // A content problem, not a reason to take the game down. Warn once and
      // carry on to the next track; if none of them load, the game is silent.
      console.warn(`[music] Could not load "${id}": ${error.message}`);
      this.#decoded.set(id, null);
      return null;
    }
  }

  /**
   * Play the next track, cross-fading from whatever is playing.
   *
   * Walks past tracks that failed to load rather than stopping at one, and
   * gives up only when it has tried every track once -- so four broken files
   * and one good one is still music.
   */
  async #advance(fadeIn) {
    if (!this.#started) return;

    let buffer = null;
    let id = null;
    for (let tried = 0; tried < this.#order.length && !buffer; tried++) {
      id = this.#order[this.#next % this.#order.length];
      this.#next++;
      buffer = await this.#load(id);
    }
    if (!buffer || !this.#started) return;

    const ctx = this.#context();
    const bus = this.#bus();
    if (!ctx || !bus) return;

    const { start, end } = audibleRange(buffer);
    const gain = ctx.createGain();
    gain.connect(bus);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Looping is set even though the playlist normally moves on before the end:
    // if this is the only track that loaded, it loops rather than falling
    // silent, and the trimmed points are what make that loop clean.
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = end;
    source.connect(gain);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeIn);

    // Start at the first audible sample, not at zero -- otherwise every track
    // opens with the encoder's padding.
    source.start(now, start);

    this.#fadeOutCurrent(fadeIn);
    this.#playing = { source, gain, id };

    // Hand over before this one ends, so the fades overlap and the room never
    // hears a gap.
    const playable = Math.max(1, end - start);
    const handover = Math.max(1, playable - CROSSFADE_SECONDS);
    this.#timer = setTimeout(() => this.#advance(CROSSFADE_SECONDS), handover * 1000);

    // The next track is fetched LATE, not now.
    //
    // Fetching it immediately was the first version and it doubled the cost of
    // starting a game -- two files in flight before the player had done
    // anything, on a site whose whole pitch is that it loads instantly. These
    // tracks run three to five minutes; thirty seconds of warning is plenty for
    // a five-megabyte file on any connection that was going to manage it at
    // all, and on one that was not, the playlist simply repeats the track it
    // already has.
    const warmUp = Math.max(0, handover - PREFETCH_LEAD) * 1000;
    this.#prefetchTimer = setTimeout(() => this.#prefetch(), warmUp);
  }

  #prefetch() {
    const id = this.#order[this.#next % this.#order.length];
    if (!id || this.#decoded.has(id) || this.#prefetching === id) return;
    this.#prefetching = id;
    this.#load(id).finally(() => { this.#prefetching = null; });
  }
}
