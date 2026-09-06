// engine/manifest.js
//
// Reads games.json and answers questions about it.
//
// games.json is the single source of truth for the suite: adding a game means
// adding an entry there and creating a folder under games/, and nothing else
// anywhere should need editing. The landing page and the arcade hub both come
// through this module rather than reading the file themselves, so there is
// one place that knows the shape of an entry and one place that validates it.
//
// WHY THIS IMPORTS THE JSON INSTEAD OF FETCHING IT
// -----------------------------------------------
// A static `import` means the manifest is available synchronously, the moment
// the module loads. Every consumer is then a plain function call --
// Manifest.getAll() -- with no promise to await and no window during which
// the hub has no data to render. Vite turns the JSON into a module at build
// time (and serves it the same way in dev), so this costs no extra request
// at runtime, which also keeps the site honestly static: there is no fetch
// here at all.
//
// The trade-off is that a malformed games.json fails the build rather than
// failing at runtime. That is the better direction to fail in.
//
// VALIDATION WARNS, IT DOES NOT THROW OR DISCARD
// ----------------------------------------------
// A typo in one entry should be loud and obvious, but it should not blank the
// arcade. So problems are reported to the console and the entry is still
// returned: a game card that renders with a wrong category is diagnosable,
// whereas a game that silently vanishes from the hub is the exact failure
// this validation exists to prevent.

import games from '../games.json';

// --- The shape of an entry ----------------------------------------------

// Every field is required on every entry. There are no optional fields on
// purpose: a half-filled entry is a mistake, not a shortcut.
//
// There is deliberately no `thumbnail` here. Card artwork is inline SVG in
// /thumbnails.js, keyed by game id, so there is no file to name -- and a
// required field pointing at a raster that has never existed was a promise
// the repo could not keep.
const REQUIRED_FIELDS = [
  'id', 'title', 'tagline', 'description', 'category', 'path',
  'difficulty', 'ageRange', 'inputRequirement', 'tags', 'featured',
  'tournamentReady', 'estimatedRunTime', 'status',
];

// Exported because the hub needs them to build its filter controls, and
// deriving the list from whatever games happen to exist would mean a category
// disappears from the UI the moment its last game is removed.
export const CATEGORIES = ['arcade', 'learning', 'puzzle', 'racing'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const STATUSES = ['live', 'coming-soon'];

// What a game needs to be playable at all.
//
// 'universal' is the rule (gamepad + keyboard + touch, per CLAUDE.md) and is
// what every game should be. 'keyboard' is a declared exception for a game
// that genuinely cannot work otherwise -- currently only Keystroke, where
// a gamepad cannot teach typing and the on-screen keyboard on a phone is a
// different activity rather than the same game.
//
// The field is required on every entry rather than defaulted, so declaring an
// exception is a deliberate act. The hub reads it to warn a player on a phone
// before they tap into something they cannot play.
export const INPUT_REQUIREMENTS = ['universal', 'keyboard'];

// --- Validation ---------------------------------------------------------

function validate(entries) {
  const problems = [];

  if (!Array.isArray(entries)) {
    problems.push('games.json must contain an array of game entries.');
    return problems;
  }

  const seenIds = new Set();

  entries.forEach((game, index) => {
    // Identify the entry by id where possible; fall back to its position,
    // since an entry missing its id is exactly the case where a human needs
    // to be told where to look.
    const where = game && game.id ? `"${game.id}"` : `entry at index ${index}`;

    if (!game || typeof game !== 'object') {
      problems.push(`${where}: not an object.`);
      return;
    }

    for (const field of REQUIRED_FIELDS) {
      if (game[field] === undefined || game[field] === null) {
        problems.push(`${where}: missing required field "${field}".`);
      }
    }

    if (game.category !== undefined && !CATEGORIES.includes(game.category)) {
      problems.push(`${where}: unknown category "${game.category}". Expected one of ${CATEGORIES.join(', ')}.`);
    }
    if (game.status !== undefined && !STATUSES.includes(game.status)) {
      problems.push(`${where}: unknown status "${game.status}". Expected one of ${STATUSES.join(', ')}.`);
    }
    if (game.difficulty !== undefined && !DIFFICULTIES.includes(game.difficulty)) {
      problems.push(`${where}: unknown difficulty "${game.difficulty}". Expected one of ${DIFFICULTIES.join(', ')}.`);
    }
    if (game.inputRequirement !== undefined && !INPUT_REQUIREMENTS.includes(game.inputRequirement)) {
      problems.push(`${where}: unknown inputRequirement "${game.inputRequirement}". Expected one of ${INPUT_REQUIREMENTS.join(', ')}.`);
    }

    if (game.tags !== undefined && !Array.isArray(game.tags)) {
      problems.push(`${where}: "tags" must be an array of strings.`);
    }
    if (game.featured !== undefined && typeof game.featured !== 'boolean') {
      problems.push(`${where}: "featured" must be true or false.`);
    }
    if (game.tournamentReady !== undefined && typeof game.tournamentReady !== 'boolean') {
      problems.push(`${where}: "tournamentReady" must be true or false.`);
    }
    if (game.estimatedRunTime !== undefined && !Number.isFinite(game.estimatedRunTime)) {
      problems.push(`${where}: "estimatedRunTime" must be a number of seconds.`);
    }

    if (game.id !== undefined) {
      if (seenIds.has(game.id)) {
        problems.push(`${where}: duplicate id. Ids must be unique -- getById would only ever find the first.`);
      }
      seenIds.add(game.id);
    }

    // The id has to match the folder name under games/, and the path has to
    // point at that folder. Catching the mismatch here turns a blank page
    // later into a console line now.
    if (game.id !== undefined && typeof game.path === 'string' && !game.path.includes(`/${game.id}/`)) {
      problems.push(`${where}: path "${game.path}" does not contain "/${game.id}/". The id must match the folder name under games/.`);
    }
  });

  return problems;
}

const problems = validate(games);
if (problems.length > 0) {
  console.warn(
    `[manifest] games.json has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`,
  );
}

// --- Freezing -----------------------------------------------------------

// Frozen so a consumer cannot accidentally rewrite the source of truth by
// sorting or editing an entry it was handed. Freezing once is cheaper than
// deep-copying on every call, and the getters below still hand back a fresh
// ARRAY each time so callers remain free to sort and filter their own copy.
const catalogue = Array.isArray(games) ? games : [];
for (const game of catalogue) {
  if (game && Array.isArray(game.tags)) Object.freeze(game.tags);
  if (game) Object.freeze(game);
}
Object.freeze(catalogue);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

// --- Public interface ---------------------------------------------------

export const Manifest = {
  // Every game, in the order games.json lists them -- that order is editorial,
  // so it is preserved rather than sorted.
  getAll() {
    return [...catalogue];
  },

  // A single game, or null if nothing matches. Never throws on an unknown id.
  getById(id) {
    return catalogue.find((game) => game.id === id) ?? null;
  },

  // Games in one category. An unknown category returns an empty array rather
  // than throwing, so a hub filter can't crash the page.
  getByCategory(category) {
    return catalogue.filter((game) => game.category === category);
  },

  // The landing page's picks.
  getFeatured() {
    return catalogue.filter((game) => game.featured === true);
  },

  // Games that can be played hot-seat, for Phase 7's tournament mode.
  getTournamentReady() {
    return catalogue.filter((game) => game.tournamentReady === true);
  },

  /**
   * Free-text search across title and tags, case- and whitespace-insensitive.
   *
   * An empty query returns everything, because that is what a search box does
   * when the player clears it -- returning nothing there would make the hub
   * look broken at the exact moment someone backspaces.
   */
  search(query) {
    const needle = normalize(query);
    if (needle === '') return [...catalogue];

    return catalogue.filter((game) => {
      if (normalize(game.title).includes(needle)) return true;
      if (!Array.isArray(game.tags)) return false;
      return game.tags.some((tag) => normalize(tag).includes(needle));
    });
  },

  // Problems found in games.json at load. Empty when everything is well
  // formed. Exposed so a debug page can show them on screen rather than
  // relying on someone having the console open.
  getValidationProblems() {
    return [...problems];
  },
};

// -------------------------------------------------------------------
// Usage example (not executed -- for pages importing this module)
// -------------------------------------------------------------------
//
// import { Manifest, CATEGORIES } from './engine/manifest.js';
//
// // Landing page: the featured strip.
// for (const game of Manifest.getFeatured()) {
//   renderHeroCard(game.title, game.tagline, game.path);
// }
//
// // Arcade hub: a section per category, plus session bests from session.js.
// for (const category of CATEGORIES) {
//   for (const game of Manifest.getByCategory(category)) {
//     renderCard(game, Session.getBest(game.id));
//   }
// }
//
// // Search box.
// input.addEventListener('input', () => render(Manifest.search(input.value)));
//
// // Tournament setup (Phase 7): pace rounds with estimatedRunTime.
// const roster = Manifest.getTournamentReady().filter((g) => g.status === 'live');
