// engine/session.js
//
// Score and run-stat tracking for the current visit. Nothing here outlives
// the tab.
//
// Studio 22 collects zero data. No localStorage, no sessionStorage, no
// cookies, no IndexedDB, no server. Every number this module holds lives in
// a few Maps in memory, and when the tab closes they go with the page.
// That is not a limitation waiting to be fixed -- it is the product
// decision, and it is what lets a player hand the machine to a friend
// without leaving anything of themselves behind.
//
// THE SWAP POINT
// --------------
// If persistent saves are ever wanted, this file is the entire change.
//
// Games never read or write storage themselves. They only ever call the
// handful of methods below, and they have no idea where a score goes after
// they hand it over. So a persistent build means rewriting the internals of
// this one module -- swapping the Maps for localStorage reads and writes --
// and touching nothing else in the codebase. No game imports a storage API,
// no game knows a storage key, and no game file would need editing.
//
// Anything replacing this file has to keep three promises the games rely on:
//
//   1. The same methods, with the same arguments and the same return shapes.
//   2. Reads for a game never played return null (or an empty array) --
//      never undefined, and never a throw.
//   3. submitScore() stays synchronous and returns its verdict immediately.
//      Games use the returned { isBest } to fire a "NEW BEST!" celebration
//      on the same frame the run ends, so an async storage layer would need
//      its own in-memory cache in front of it to preserve that timing.
//
// Persistence is currently forbidden by the project rules. This note exists
// so that if that decision is ever revisited, the blast radius is known in
// advance, and it is exactly one file.

// --- Score direction ----------------------------------------------------
//
// Most games want the highest score; a time trial wants the lowest lap.
//
// Direction is registered per game rather than passed on every submitScore()
// call, because "lower is better" is a fact about the GAME, not about any
// individual score. Stated once, it cannot drift. The per-call alternative
// invites exactly one bug: a game that passes 'low' at its main game-over
// call site and forgets it on some second path (a retry, a timeout, a
// quit-early branch), after which scores are silently compared the wrong
// way round. That failure is invisible in testing, because the wrong
// direction still produces a perfectly plausible-looking number.

const VALID_DIRECTIONS = ['high', 'low'];
const DEFAULT_DIRECTION = 'high';

// --- Session state ------------------------------------------------------
//
// Maps rather than plain objects: gameIds come from games.json, and a plain
// object would let an id like 'constructor' or '__proto__' collide with
// something already on Object.prototype. A Map has no inherited keys to
// trip over, so any string is a safe id.

const bestScores = new Map(); // gameId -> best score this visit
const latestStats = new Map(); // gameId -> stats object from the most recent run
const directions = new Map(); // gameId -> 'high' | 'low'

// A Set (insertion-ordered) so getPlayedGames() reports games in the order
// they were first played this visit. Tracked separately rather than derived
// from the two Maps above, because a game counts as played once it reports
// *anything* -- a run that ended without a score still happened.
const playedGames = new Set();

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
    if (!Number.isFinite(score)) return { isBest: false, previousBest };

    const direction = directions.get(gameId) ?? DEFAULT_DIRECTION;

    // The first score of the visit always counts. After that it has to
    // actually beat the standing best -- matching it is not beating it, so
    // a tie leaves the best alone and reports isBest: false.
    const isBest = previousBest === null || isBetter(score, previousBest, direction);
    if (isBest) bestScores.set(gameId, score);

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

  // Wipes the visit back to a blank slate.
  //
  // This clears registered directions too. That's safe here because every
  // game is its own page under games/, so a game re-registers its direction
  // on load -- there is no long-lived game object left holding a stale
  // registration after a clear.
  clear() {
    bestScores.clear();
    latestStats.clear();
    directions.clear();
    playedGames.clear();
  },
};

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { Session } from '../../engine/session.js';
//
// // Once, as the game boots. Lap times: lower is better.
// Session.setScoreDirection('time-trial', 'low');
//
// // When a run ends:
// const { isBest, previousBest } = Session.submitScore('time-trial', 42.19);
// if (isBest) showNewBestBanner(previousBest);
//
// Session.setRunStats('time-trial', { laps: 3, topSpeed: 118, clean: true });
//
// // ...and over in the arcade hub, building its cards:
// for (const gameId of Session.getPlayedGames()) {
//   renderCard(gameId, Session.getBest(gameId), Session.getRunStats(gameId));
// }
