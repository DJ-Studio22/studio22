// engine/session.js
//
// Score and run-stat tracking for the current visit. Nothing here outlives
// the tab.
//
// Studio 22 collects zero data. No localStorage, no cookies, no IndexedDB,
// no server, no accounts. What this module does use is sessionStorage, which
// is scoped to a single tab and destroyed by the browser when that tab
// closes. "Nothing survives the tab" is still literally true: close it and
// everything here is gone, with nothing left on disk to find later.
//
// WHY STORAGE AT ALL, WHEN MAPS IN MEMORY WERE ENOUGH
// ---------------------------------------------------
// Every game is its own page under games/, and the arcade is another page
// again. Moving between them is a full navigation, which tears down every
// module in the document — so a score written in a game was already gone by
// the time the arcade tried to read it. Purely in-memory state cannot span
// pages in a multi-page site, and the arcade's "best this visit" could never
// have shown anything.
//
// sessionStorage is the smallest thing that fixes it while keeping the
// promise unchanged. It is per-tab, so a second tab starts clean, and it is
// discarded with the tab rather than persisted to disk.
//
// HOW IT IS STRUCTURED
// --------------------
// The Maps below are still the working copy: reads never touch storage or
// parse JSON. Storage is a mirror, loaded once when the module first runs
// and rewritten after each change. If storage is unavailable for any reason
// — a locked-down browser, a full quota, a sandboxed frame — every method
// still works exactly as before and simply stops surviving navigation. It
// never throws.
//
// THE SWAP POINT
// --------------
// If real persistence across visits is ever wanted, this file is still the
// entire change: swap sessionStorage for localStorage here and nothing else
// in the codebase moves. Games never read or write storage themselves; they
// only ever call the methods below. That would break the privacy promise on
// the landing page, so it is a product decision rather than a technical one.
//
// Anything replacing this file has to keep three promises the games rely on:
//
//   1. The same methods, with the same arguments and the same return shapes.
//   2. Reads for a game never played return null (or an empty array) --
//      never undefined, and never a throw.
//   3. submitScore() stays synchronous and returns its verdict immediately.
//      Games use the returned { isBest } to fire a "NEW BEST!" celebration
//      on the same frame the run ends.

// --- Score direction ----------------------------------------------------
//
// Most games want the highest score; a time trial wants the lowest lap.
//
// Direction is registered per game rather than passed on every submitScore()
// call, because "lower is better" is a fact about the GAME, not about any
// individual score. Stated once, it cannot drift. The per-call alternative
// invites exactly one bug: a game passes 'low' at its main game-over call
// site and forgets it on some second path, after which scores rank backwards
// -- a failure invisible in testing, because the wrong direction still
// yields a perfectly plausible number.

const VALID_DIRECTIONS = ['high', 'low'];
const DEFAULT_DIRECTION = 'high';

// Versioned, so a future change to the stored shape can be recognised and
// discarded rather than misread.
const STORAGE_KEY = 'studio22.session.v1';

// --- Session state ------------------------------------------------------
//
// Maps rather than plain objects: gameIds come from games.json, and a plain
// object would let an id like 'constructor' or '__proto__' collide with
// something already on Object.prototype. A Map has no inherited keys to trip
// over, so any string is a safe id.

const bestScores = new Map(); // gameId -> best score this visit
const latestStats = new Map(); // gameId -> stats object from the most recent run
const directions = new Map(); // gameId -> 'high' | 'low'

// Insertion-ordered, so getPlayedGames() reports games in the order they
// were first played. Tracked separately rather than derived from the Maps
// above, because a game counts as played once it reports anything -- a run
// that ended without a score still happened.
const playedGames = new Set();

// --- Storage ------------------------------------------------------------

// Resolved once. The write probe matters: some browsers expose
// sessionStorage but throw the moment anything is written to it (private
// browsing modes have historically done exactly this), so merely checking
// that the object exists is not enough to know it works.
const storage = (() => {
  try {
    const probe = `${STORAGE_KEY}.probe`;
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
})();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Everything read back is treated as untrusted. It is only ever this tab's
// own data, but a half-written or hand-edited blob should degrade to "no
// saved session" rather than poison a comparison later -- a stored NaN in
// bestScores would become a best score nothing could ever beat.
function load() {
  if (!storage) return;

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    if (!isPlainObject(data)) throw new Error('not an object');

    for (const [id, score] of Object.entries(data.bests ?? {})) {
      if (Number.isFinite(score)) bestScores.set(id, score);
    }
    for (const [id, stats] of Object.entries(data.stats ?? {})) {
      if (isPlainObject(stats)) latestStats.set(id, stats);
    }
    for (const [id, direction] of Object.entries(data.directions ?? {})) {
      if (VALID_DIRECTIONS.includes(direction)) directions.set(id, direction);
    }
    for (const id of Array.isArray(data.played) ? data.played : []) {
      if (typeof id === 'string') playedGames.add(id);
    }
  } catch (error) {
    console.warn(`[session] Ignoring unreadable saved session: ${error.message}`);
    try { storage.removeItem(STORAGE_KEY); } catch { /* nothing more to do */ }
  }
}

// Called after every change. The whole blob is rewritten rather than patched
// because it is a few hundred bytes at most, and one key is atomic where
// four separate keys could be left inconsistent by a failed write.
function save() {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      bests: Object.fromEntries(bestScores),
      stats: Object.fromEntries(latestStats),
      directions: Object.fromEntries(directions),
      played: [...playedGames],
    }));
  } catch {
    // Quota exceeded, or storage revoked mid-session. The in-memory copy is
    // still correct, so the visit carries on and simply stops surviving the
    // next navigation.
  }
}

load();

function isBetter(candidate, current, direction) {
  return direction === 'low' ? candidate < current : candidate > current;
}

// --- Public interface ---------------------------------------------------

export const Session = {
  /**
   * Registers which way this game's scores run. Call once when the game
   * boots, before submitting anything. Games left unregistered are 'high'.
   */
  setScoreDirection(gameId, direction) {
    // A typo here ('lowest', 'asc') would otherwise fall through to 'high'
    // and quietly rank every score backwards, so fail loudly instead. This
    // is a setup-time programmer error, not the unknown-gameId case the
    // reads below are required to tolerate.
    if (!VALID_DIRECTIONS.includes(direction)) {
      throw new Error(
        `Session.setScoreDirection: direction must be 'high' or 'low', got "${direction}"`,
      );
    }
    directions.set(gameId, direction);
    save();
  },

  /**
   * Records a score for the run that just ended.
   * @returns {{ isBest: boolean, previousBest: number|null }} previousBest is
   *          null when this is the game's first score this visit.
   */
  submitScore(gameId, score) {
    const previousBest = bestScores.get(gameId) ?? null;
    playedGames.add(gameId);

    // NaN would be a disaster to store: every comparison against it is
    // false, so it would install itself as the best score and then never be
    // beaten for the rest of the visit. Drop it and report no improvement
    // rather than poisoning the game's best. (Infinity is rejected for the
    // same reason -- nothing can beat it.)
    if (!Number.isFinite(score)) {
      save();
      return { isBest: false, previousBest };
    }

    const direction = directions.get(gameId) ?? DEFAULT_DIRECTION;

    // The first score of the visit always counts. After that it has to
    // actually beat the standing best -- matching it is not beating it, so
    // a tie leaves the best alone and reports isBest: false.
    const isBest = previousBest === null || isBetter(score, previousBest, direction);
    if (isBest) bestScores.set(gameId, score);

    save();
    return { isBest, previousBest };
  },

  // Best score this visit, or null if this game hasn't been played. Note
  // `?? null` rather than `|| null`, so a legitimate best of 0 survives.
  getBest(gameId) {
    return bestScores.get(gameId) ?? null;
  },

  /**
   * Records details of the run that just ended -- accuracy, time survived,
   * problems solved, whatever this particular game tracks. Only the most
   * recent run is kept.
   */
  setRunStats(gameId, stats) {
    playedGames.add(gameId);
    // Shallow copy, so a game that reuses one stats object between runs
    // can't rewrite what we already recorded. Nested objects are still
    // shared by reference -- keep run stats flat.
    latestStats.set(gameId, { ...stats });
    save();
  },

  // Stats from the most recent run, or null if this game hasn't reported
  // any. Returns a copy for the same reason submitScore stores one.
  getRunStats(gameId) {
    const stats = latestStats.get(gameId);
    return stats ? { ...stats } : null;
  },

  // gameIds played this visit, oldest first, for the arcade hub to decorate
  // its cards with session bests. A copy, so a caller can't edit our set.
  getPlayedGames() {
    return [...playedGames];
  },

  // Wipes the visit back to a blank slate, storage included.
  //
  // This clears registered directions too. That's safe because every game is
  // its own page under games/, so a game re-registers its direction on load
  // -- there is no long-lived game object left holding a stale registration
  // after a clear.
  clear() {
    bestScores.clear();
    latestStats.clear();
    directions.clear();
    playedGames.clear();
    if (storage) {
      try { storage.removeItem(STORAGE_KEY); } catch { /* already gone */ }
    }
  },

  // Whether this visit is actually surviving navigation. False means storage
  // was unavailable and the session is memory-only for this tab -- useful
  // for a debug readout, not something games should branch on.
  get isPersisted() {
    return storage !== null;
  },
};

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { Session } from '../../engine/session.js';
//
// // Once, as the game boots. Lap times: lower is better.
// Session.setScoreDirection('circuit-racer', 'low');
//
// // When a run ends:
// const { isBest, previousBest } = Session.submitScore('circuit-racer', 42.19);
// if (isBest) showNewBestBanner(previousBest);
//
// Session.setRunStats('circuit-racer', { laps: 3, topSpeed: 118, clean: true });
//
// // ...and over in the arcade, which is a separate page load entirely:
// for (const gameId of Session.getPlayedGames()) {
//   renderCard(gameId, Session.getBest(gameId));
// }
