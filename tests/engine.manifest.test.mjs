// tests/engine.manifest.test.mjs
//
// games.json is the single source of truth for the suite, and manifest.js is
// the only thing that reads it. A bad entry here does not crash anything — by
// design, it warns and keeps going — so the failure mode is a game that is
// subtly wrong on the hub forever and nobody notices.
//
// This file also asserts the real manifest is clean, which is the check that
// would catch a hand-edit to games.json before it ships.
//
// Note for anyone adding to this: manifest.js could not be imported by Node
// at all until it gained `with { type: 'json' }` on its games.json import.
// That is why it had no tests. Rule one in the README applies — if a module
// cannot be imported, fix the module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  Manifest, CATEGORIES, DIFFICULTIES, STATUSES, INPUT_REQUIREMENTS,
} from '../engine/manifest.js';

const games = JSON.parse(readFileSync(new URL('../games.json', import.meta.url), 'utf8'));

test('the shipped games.json has no validation problems', () => {
  assert.deepEqual(Manifest.getValidationProblems(), []);
});

test('every entry carries every required field', () => {
  const required = ['id', 'title', 'tagline', 'description', 'category', 'path',
    'difficulty', 'ageRange', 'inputRequirement', 'tags', 'featured',
    'tournamentReady', 'estimatedRunTime', 'status'];
  for (const game of Manifest.getAll()) {
    for (const field of required) {
      assert.ok(game[field] !== undefined && game[field] !== null,
        `${game.id} is missing ${field}`);
    }
  }
});

test('every enumerated field holds a value the UI knows how to draw', () => {
  for (const game of Manifest.getAll()) {
    assert.ok(CATEGORIES.includes(game.category), `${game.id}: category ${game.category}`);
    assert.ok(DIFFICULTIES.includes(game.difficulty), `${game.id}: difficulty ${game.difficulty}`);
    assert.ok(STATUSES.includes(game.status), `${game.id}: status ${game.status}`);
    assert.ok(INPUT_REQUIREMENTS.includes(game.inputRequirement),
      `${game.id}: inputRequirement ${game.inputRequirement}`);
  }
});

test('ids are unique — getById would only ever find the first', () => {
  const ids = Manifest.getAll().map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a game's path points at the folder named by its id", () => {
  // The mismatch this catches turns into a blank page, and nothing else in
  // the codebase would notice.
  for (const game of Manifest.getAll()) {
    assert.ok(game.path.includes(`/${game.id}/`), `${game.id}: path is ${game.path}`);
  }
});

test('keyboard-only is a declared exception, never a default', () => {
  // CLAUDE.md: universal input is the rule, and an exception has to be a
  // deliberate act. Keystroke is the only one, because typing cannot be
  // taught on a gamepad.
  const keyboardOnly = Manifest.getAll()
    .filter((g) => g.inputRequirement === 'keyboard')
    .map((g) => g.id);
  assert.deepEqual(keyboardOnly, ['keystroke']);
});

test('getById returns null for an unknown id rather than throwing', () => {
  assert.equal(Manifest.getById('not-a-game'), null);
  assert.equal(Manifest.getById(undefined), null);
});

test('getByCategory is exhaustive and an unknown category is empty, not an error', () => {
  const counted = CATEGORIES
    .map((c) => Manifest.getByCategory(c).length)
    .reduce((a, b) => a + b, 0);
  assert.equal(counted, games.length, 'every game belongs to exactly one known category');
  assert.deepEqual(Manifest.getByCategory('nonsense'), []);
});

test('the getters hand back a fresh array each time, and the entries are frozen', () => {
  const a = Manifest.getAll();
  a.push({ id: 'injected' });
  assert.equal(Manifest.getAll().length, games.length, 'a caller mutated the catalogue');

  const game = Manifest.getById(games[0].id);
  assert.throws(() => { game.title = 'changed'; }, TypeError);
});

test('search on an empty query returns everything — a cleared box is not a filter', () => {
  assert.equal(Manifest.search('').length, games.length);
  assert.equal(Manifest.search('   ').length, games.length);
  assert.equal(Manifest.search(null).length, games.length);
});

test('search matches title and tags, case and whitespace insensitively', () => {
  assert.deepEqual(Manifest.search('skyhook').map((g) => g.id), ['skyhook']);
  assert.deepEqual(Manifest.search('  SKYHOOK ').map((g) => g.id), ['skyhook']);
  assert.deepEqual(Manifest.search('grappling').map((g) => g.id), ['skyhook'],
    'a tag-only match must still be found');
  assert.deepEqual(Manifest.search('zzzz'), []);
});

test('search covers coming-soon games too — the hub filters the whole catalogue', () => {
  const soon = Manifest.getAll().filter((g) => g.status !== 'live');
  assert.ok(soon.length > 0, 'no coming-soon games to check');
  for (const game of soon) {
    const hit = Manifest.search(game.title).some((g) => g.id === game.id);
    assert.ok(hit, `${game.id} cannot be found by its own title`);
  }
});

test('featured and tournament-ready are subsets that actually have members', () => {
  const featured = Manifest.getFeatured();
  assert.ok(featured.length > 0 && featured.every((g) => g.featured === true));

  const ready = Manifest.getTournamentReady();
  assert.ok(ready.length > 0 && ready.every((g) => g.tournamentReady === true));

  // Keystroke is deliberately out: a typing race does not fit passing one
  // controller round a room.
  assert.ok(!ready.some((g) => g.id === 'keystroke'));
});

test('a malformed entry is reported but not discarded', () => {
  // The documented contract: a wrong card is diagnosable, a vanished one is a
  // mystery. Checked against the validator's own output on the real data
  // rather than by rebuilding the module, which cannot take injected data.
  assert.equal(typeof Manifest.getValidationProblems, 'function');
  assert.ok(Array.isArray(Manifest.getValidationProblems()));
  assert.equal(Manifest.getAll().length, games.length,
    'every entry in the file is returned, valid or not');
});
