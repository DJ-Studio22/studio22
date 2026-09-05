// engine/tournament.js
//
// Hot-seat tournaments: turn order, scoring, and standings for two to eight
// people sharing one screen and passing one controller.
//
// NOTHING HERE OUTLIVES THE TAB. Players type their names, and names are the
// most personal thing this site ever touches, so they get the same treatment
// as scores: sessionStorage, which is scoped to one tab and destroyed with
// it. No localStorage, no cookies, no server. Close the tab and the names
// are gone with everything else. See engine/session.js for the longer
// argument; this file follows the same rules for the same reasons.
//
// WHY THIS NEEDS STORAGE AT ALL
// -----------------------------
// A tournament spans pages. Each game is its own document under games/, and
// the tournament screens live on party.html, so every turn is two full
// navigations: party -> game -> party. In-memory state cannot survive that.
// The alternative — running games in an iframe — would mean every game
// inherits a second layer of focus, sizing and input quirks, to avoid one
// sessionStorage key.
//
// WHAT THIS FILE IS NOT
// ---------------------
// No DOM. This is the rules of a tournament and nothing else, so the flow
// can be reasoned about (and tested) without a browser. The screens live in
// engine/tournament-ui.js.

import { Manifest } from './manifest.js';
import { Session } from './session.js';

// Versioned, so a later change to the stored shape is recognised and
// discarded rather than misread into a half-working tournament.
const STORAGE_KEY = 'studio22.tournament.v1';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

// Names are typed on an on-screen keyboard by people who want to start
// playing, not fill in a form. Short enough to stay legible at the size the
// turn screens use, long enough for a real name.
export const MAX_NAME_LENGTH = 12;

export const MODES = {
  SINGLE: 'single',
  BEST_OF_THREE: 'bestOfThree',
  GAUNTLET: 'gauntlet',
};

export const MODE_INFO = {
  [MODES.SINGLE]: {
    id: MODES.SINGLE,
    label: 'Single Round',
    blurb: 'One game. One turn each. Highest score wins.',
    games: 'one',
  },
  [MODES.BEST_OF_THREE]: {
    id: MODES.BEST_OF_THREE,
    label: 'Best of Three',
    blurb: 'One game, three turns each. Only your best one counts.',
    games: 'one',
  },
  [MODES.GAUNTLET]: {
    id: MODES.GAUNTLET,
    label: 'Gauntlet',
    blurb: 'A different game each round. Points for where you place.',
    games: 'many',
  },
};

const ATTEMPTS = {
  [MODES.SINGLE]: 1,
  [MODES.BEST_OF_THREE]: 3,
  [MODES.GAUNTLET]: 1,
};

// The eight player identities, as token names rather than values. The
// tournament is site chrome, so its colours come from styles/tokens.css like
// everything else — see the player colour block there.
export const PLAYER_COLORS = [
  { token: '--color-player-1', name: 'Amber' },
  { token: '--color-player-2', name: 'Azure' },
  { token: '--color-player-3', name: 'Mint' },
  { token: '--color-player-4', name: 'Rose' },
  { token: '--color-player-5', name: 'Violet' },
  { token: '--color-player-6', name: 'Lemon' },
  { token: '--color-player-7', name: 'Cyan' },
  { token: '--color-player-8', name: 'Magenta' },
];

// --- Storage ------------------------------------------------------------

// Resolved once, with a write probe: some browsers expose sessionStorage and
// then throw on the first write. Checking the object exists is not enough.
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

// The single source of truth for the tournament in progress. null means
// there isn't one.
let state = null;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Everything read back is untrusted, even though it is only ever this tab's
// own data. A half-written blob should degrade to "no tournament" rather
// than into one that is subtly wrong for the next twenty minutes.
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
    if (!Array.isArray(data.players) || data.players.length < MIN_PLAYERS) {
      throw new Error('no players');
    }
    if (!Array.isArray(data.schedule)) throw new Error('no schedule');
    if (!Object.values(MODES).includes(data.mode)) throw new Error('unknown mode');
    state = data;
  } catch (error) {
    console.warn(`[tournament] Ignoring unreadable tournament: ${error.message}`);
    try { storage.removeItem(STORAGE_KEY); } catch { /* nothing more to do */ }
  }
}

function save() {
  if (!storage) return;
  try {
    if (state === null) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota, or storage revoked mid-visit. The in-memory copy is still
    // right, so this turn finishes; it just will not survive the navigation
    // into the next game. Callers find out via isActive() returning false
    // on the far side, which lands the player back at setup rather than in
    // a broken half-tournament.
  }
}

load();

// --- Ranking ------------------------------------------------------------

// Which way a game's scores run. The game itself registers this when it
// boots (Session.setScoreDirection), and that survives in sessionStorage, so
// by the time anyone is being ranked the answer is known. Before a game has
// ever been played it defaults to 'high', which is also the default for
// games that never register at all.
function directionFor(gameId) {
  return Session.getScoreDirection(gameId);
}

function isBetter(candidate, current, direction) {
  if (current === null || current === undefined) return true;
  return direction === 'low' ? candidate < current : candidate > current;
}

/**
 * Turns scores into positions, sharing a position across ties.
 *
 * Ties matter more here than they look like they should: two people drawing
 * on a round is common in a short game, and awarding them different
 * placements — on nothing but array order — would decide a tournament by
 * accident. Tied players take the same position, and the next position skips
 * by the size of the tie, so three players tied first are all 1st and the
 * next is 4th.
 *
 * @param {Array<{ id: string, value: number|null }>} entries
 * @param {'high'|'low'} direction
 * @returns {Map<string, number>} id -> position, 1-based. Null values get no
 *          position at all: "has not played yet" is not last place.
 */
export function rank(entries, direction) {
  const scored = entries.filter((e) => Number.isFinite(e.value));
  scored.sort((a, b) => (direction === 'low' ? a.value - b.value : b.value - a.value));

  const positions = new Map();
  let position = 0;
  let previousValue = null;

  scored.forEach((entry, index) => {
    if (previousValue === null || entry.value !== previousValue) {
      position = index + 1;          // skips past everyone tied above
      previousValue = entry.value;
    }
    positions.set(entry.id, position);
  });

  return positions;
}

// --- Schedule -----------------------------------------------------------

/**
 * Builds the full running order up front.
 *
 * Ordered attempt-major rather than player-major: in Best of Three everyone
 * takes their first turn before anyone takes their second. Player-major
 * would mean one person plays three times while everyone else watches, which
 * is not a party — the controller should keep moving.
 */
function buildSchedule(mode, players, gameIds) {
  const schedule = [];
  const attempts = ATTEMPTS[mode];

  gameIds.forEach((gameId, roundIndex) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      for (const player of players) {
        schedule.push({ playerId: player.id, gameId, roundIndex, attempt });
      }
    }
  });

  return schedule;
}

// --- Turn and scoring helpers -------------------------------------------
//
// Module-scope rather than methods on Tournament: they are implementation,
// and the module boundary is already the privacy. Tournament below is a
// plain object, so there is no class to hang a #private on.

function describeTurn(turn, index) {
  const player = state.players.find((p) => p.id === turn.playerId);
  const game = Manifest.getById(turn.gameId);
  return {
    player: { ...player },
    gameId: turn.gameId,
    game: game ?? null,
    roundIndex: turn.roundIndex,
    attempt: turn.attempt,
    // 1-based and counted over turns that will actually be played, so
    // "Turn 3 of 8" stays true after somebody withdraws.
    turnNumber: remainingBefore(index) + 1,
    totalTurns: playableTurnCount(),
  };
}

function playableTurnCount() {
  const withdrawn = new Set(state.players.filter((p) => p.withdrawn).map((p) => p.id));
  return state.schedule.filter((t) => !withdrawn.has(t.playerId)).length;
}

function remainingBefore(index) {
  const withdrawn = new Set(state.players.filter((p) => p.withdrawn).map((p) => p.id));
  let count = 0;
  for (let i = 0; i < index; i++) {
    if (!withdrawn.has(state.schedule[i].playerId)) count++;
  }
  return count;
}

// Single round and Best of Three: a player's total is their best score.
function scoreBest(rows) {
  const direction = directionFor(state.gameIds[0]);

  for (const row of rows) {
    const own = state.results.filter((r) => r.playerId === row.player.id);
    let best = null;
    for (const result of own) {
      if (isBetter(result.score, best, direction)) best = result.score;
    }
    row.total = best ?? 0;
    row.rounds = own.map((r) => r.score);
    row.detail = state.mode === MODES.BEST_OF_THREE && own.length
      ? `best of ${own.length}`
      : '';
  }
}

// Gauntlet: points for where you placed in each game, added up. A player
// who wins two of three beats one who wins one by a huge margin, which is
// the point of running a sequence rather than one long game.
function scoreGauntlet(rows) {
  const byId = new Map(rows.map((row) => [row.player.id, row]));
  const fieldSize = state.players.length;

  state.gameIds.forEach((gameId, roundIndex) => {
    const entries = state.players.map((player) => {
      const result = state.results.find(
        (r) => r.playerId === player.id && r.roundIndex === roundIndex,
      );
      return { id: player.id, value: result ? result.score : null };
    });

    const positions = rank(entries, directionFor(gameId));

    for (const [playerId, position] of positions) {
      // Win the round and you take the size of the field; last takes one.
      // Everyone who scored gets something, so a bad round still beats a
      // missed one.
      const points = fieldSize - position + 1;
      const row = byId.get(playerId);
      row.total += points;
      row.rounds.push({ gameId, position, points });
    }
  });

  for (const row of rows) {
    row.detail = row.rounds.length
      ? `${row.total} pts from ${row.rounds.length} ${row.rounds.length === 1 ? 'round' : 'rounds'}`
      : '';
  }
}


// --- Public interface ---------------------------------------------------

export const Tournament = {
  /** True when a tournament exists, finished or not. */
  isActive() {
    return state !== null;
  },

  /** A deep copy, so a caller poking at the result cannot corrupt the state. */
  getState() {
    return state === null ? null : structuredClone(state);
  },

  /**
   * Starts a tournament. Replaces any tournament already in progress.
   *
   * @param {object} config
   * @param {string} config.mode     One of MODES.
   * @param {Array<{name: string, colorIndex: number}>} config.players
   * @param {string[]} config.gameIds  One id for single/best-of-three, the
   *        sequence for a gauntlet.
   */
  create({ mode, players, gameIds }) {
    if (!Object.values(MODES).includes(mode)) {
      throw new Error(`[tournament] Unknown mode "${mode}"`);
    }
    if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new Error(`[tournament] Needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
    }
    if (!Array.isArray(gameIds) || gameIds.length === 0) {
      throw new Error('[tournament] Needs at least one game');
    }

    const roster = players.map((player, index) => ({
      // Index-based rather than random: it makes the id readable in a stored
      // blob, and a tournament never outlives the tab that created it.
      id: `p${index + 1}`,
      // Trimmed and capped here rather than trusting the UI, because this is
      // the only door into the state.
      name: String(player.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || `Player ${index + 1}`,
      colorIndex: Number.isInteger(player.colorIndex)
        ? ((player.colorIndex % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length
        : index % PLAYER_COLORS.length,
      withdrawn: false,
    }));

    state = {
      version: 1,
      mode,
      players: roster,
      gameIds: [...gameIds],
      schedule: buildSchedule(mode, roster, gameIds),
      turnIndex: 0,
      results: [],
      // The order the standings were last drawn in. Kept so the next
      // standings screen can start from it and animate the changes, which is
      // otherwise impossible across a page navigation — the new document has
      // no memory of where the rows used to be.
      standingsOrder: roster.map((p) => p.id),
      createdAt: Date.now(),
    };
    save();
    return this.getState();
  },

  /** Throws the whole thing away. */
  clear() {
    state = null;
    save();
  },

  // --- Turn flow --------------------------------------------------------

  /**
   * The turn about to be played, or null when the tournament is over.
   *
   * Skips past any turn belonging to someone who has withdrawn, so a player
   * leaving never strands the tournament on a turn nobody is going to take.
   */
  currentTurn() {
    if (state === null) return null;

    while (state.turnIndex < state.schedule.length) {
      const turn = state.schedule[state.turnIndex];
      const player = state.players.find((p) => p.id === turn.playerId);
      if (player && !player.withdrawn) {
        return describeTurn(turn, state.turnIndex);
      }
      state.turnIndex++;
    }

    return null;
  },

  /** The turn after this one, for the "pass to..." screen. */
  nextTurn() {
    if (state === null) return null;

    for (let i = state.turnIndex + 1; i < state.schedule.length; i++) {
      const turn = state.schedule[i];
      const player = state.players.find((p) => p.id === turn.playerId);
      if (player && !player.withdrawn) return describeTurn(turn, i);
    }

    return null;
  },

  /**
   * Records the score for the turn just played and advances.
   *
   * The gameId is passed and checked rather than assumed: this is called
   * from engine/shell.js on whatever page the game lives on, and a mismatch
   * means the player navigated somewhere the tournament did not send them.
   * Recording that score against the wrong round would be worse than
   * recording nothing.
   */
  recordTurn(gameId, score) {
    const turn = this.currentTurn();
    if (!turn) return null;

    if (turn.gameId !== gameId) {
      console.warn(
        `[tournament] Expected a score for "${turn.gameId}" but got one for "${gameId}". Ignoring.`,
      );
      return null;
    }

    state.results.push({
      playerId: turn.player.id,
      gameId,
      roundIndex: turn.roundIndex,
      attempt: turn.attempt,
      score: Number.isFinite(score) ? score : 0,
    });
    state.turnIndex++;
    save();

    return this.getState();
  },

  /**
   * Moves past the current turn without a score.
   *
   * For someone who steps away mid-turn: they stay in the tournament and
   * keep their earlier scores, they simply do not have one for this round.
   * A zero would be a lie about a game they never played, and in a low-is
   * -better game it would be an unbeatable win.
   */
  skipTurn() {
    if (state === null) return null;
    if (this.currentTurn() === null) return null;
    state.turnIndex++;
    save();
    return this.getState();
  },

  /**
   * Takes a player out for good. Their remaining turns are skipped and their
   * existing scores stand — they earned those, and deleting them would
   * silently rewrite the standings everyone has been watching.
   *
   * If this leaves nobody to play, the tournament simply ends and the
   * standings become the final result.
   */
  withdrawPlayer(playerId) {
    if (state === null) return null;
    const player = state.players.find((p) => p.id === playerId);
    if (!player || player.withdrawn) return this.getState();

    player.withdrawn = true;
    save();
    return this.getState();
  },

  /** How many players are still taking turns. */
  activePlayerCount() {
    if (state === null) return 0;
    return state.players.filter((p) => !p.withdrawn).length;
  },

  /**
   * True once every turn that is going to be played has been.
   *
   * Also true when everyone has withdrawn: there is nothing left to play, so
   * holding the tournament open would just be a screen nobody can leave.
   */
  isFinished() {
    if (state === null) return false;
    return this.currentTurn() === null;
  },

  // --- Standings --------------------------------------------------------

  /**
   * The table, in order, with enough detail for the screen to explain
   * itself.
   *
   * Each row carries `previousPosition` so the standings screen can animate
   * a player moving up or down. That number comes from the stored order of
   * the last standings drawn, not from anything in this document — across a
   * page navigation there is nothing else it could come from.
   */
  getStandings() {
    if (state === null) return [];

    const rows = state.players.map((player) => {
      const own = state.results.filter((r) => r.playerId === player.id);
      return {
        player: { ...player },
        total: 0,
        detail: '',
        rounds: [],
        played: own.length,
      };
    });

    if (state.mode === MODES.GAUNTLET) scoreGauntlet(rows);
    else scoreBest(rows);

    const direction = state.mode === MODES.GAUNTLET
      ? 'high'                                  // placement points always climb
      : directionFor(state.gameIds[0]);

    const positions = rank(
      rows.map((row) => ({ id: row.player.id, value: row.played ? row.total : null })),
      direction,
    );

    const previous = new Map(state.standingsOrder.map((id, index) => [id, index + 1]));

    for (const row of rows) {
      row.position = positions.get(row.player.id) ?? null;
      row.previousPosition = previous.get(row.player.id) ?? null;
    }

    // Unplayed players sort to the bottom in roster order rather than being
    // shuffled arbitrarily by a null position.
    rows.sort((a, b) => {
      if (a.position === null && b.position === null) {
        return state.players.indexOf(a.player) - state.players.indexOf(b.player);
      }
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return a.position - b.position;
    });

    return rows;
  },

  /**
   * Records the order the standings were just drawn in, so the next screen
   * can animate from it. Called by the standings screen after it renders.
   */
  commitStandingsOrder(order) {
    if (state === null) return;
    state.standingsOrder = [...order];
    save();
  },

  /** The top three rows, for the podium. */
  getPodium() {
    return this.getStandings().filter((row) => row.position !== null).slice(0, 3);
  },

  // --- Game selection ---------------------------------------------------

  /**
   * The games that can be put in a tournament: flagged tournamentReady in
   * games.json AND actually playable, since a coming-soon game has no folder
   * and would send everyone to a 404 halfway through a round.
   */
  eligibleGames() {
    return Manifest.getTournamentReady().filter((game) => game.status === 'live');
  },

  /**
   * True when any of these games needs a physical keyboard.
   *
   * This is the check that has to happen at SETUP. Passing a controller
   * round a room works because everyone can hold the controller; a
   * keyboard-only game in that rotation means everyone has to be sat at the
   * keyboard instead, which is a different evening and not one to discover
   * three turns in.
   */
  requiresKeyboard(gameIds = state?.gameIds ?? []) {
    return gameIds.some((id) => Manifest.getById(id)?.inputRequirement === 'keyboard');
  },

  /** Where to send the browser for a turn, with tournament mode switched on. */
  urlForTurn(turn) {
    const game = turn?.game ?? Manifest.getById(turn?.gameId);
    if (!game) return null;
    const separator = game.path.includes('?') ? '&' : '?';
    return `${game.path}${separator}tournament=1`;
  },
};

// -------------------------------------------------------------------
// Usage example (not executed -- for pages importing this module)
// -------------------------------------------------------------------
//
//   import { Tournament, MODES } from '/engine/tournament.js';
//
//   Tournament.create({
//     mode: MODES.GAUNTLET,
//     players: [
//       { name: 'Ada',  colorIndex: 0 },
//       { name: 'Grace', colorIndex: 1 },
//     ],
//     gameIds: ['updraft', 'comet'],
//   });
//
//   const turn = Tournament.currentTurn();
//   // -> { player: {...}, gameId: 'updraft', turnNumber: 1, totalTurns: 4, ... }
//   window.location.href = Tournament.urlForTurn(turn);
//
//   // ...and on the far side, engine/shell.js calls this when the run ends:
//   Tournament.recordTurn('updraft', 4820);
