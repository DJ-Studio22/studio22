// tests/engine.session.test.mjs
//
// The one place the whole suite stores anything, and the promise the site
// makes on its own landing page: nothing survives the tab.
//
// Two failures here have already shipped and are what these cover:
//
//   Circuit Racer is the only game where LOWER is better. clear() used to wipe
//   the score directions along with the scores, which left a running page with
//   no direction at all — and an unranked lap time defaults to "higher wins",
//   so the slowest lap became the record.
//
//   The v1 storage key held LIES: a broken lap counter had written impossible
//   times into it as legitimate bests, and sessionStorage survives a reload.
//   The key was bumped to v2 and v1 is swept on load. If that sweep ever stops
//   running, players get a phantom best they never set.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

// The DOM stub carries a working sessionStorage, so session.js takes its real
// storage path rather than quietly falling back to memory — the versioning is
// the thing under test. Installed before the dynamic import for that reason.
const uninstall = installDom();
const { Session } = await import('../engine/session.js');
const STORAGE_KEY = 'studio22.session.v2';
const LEGACY_KEY = 'studio22.session.v1';

const raw = () => JSON.parse(globalThis.sessionStorage.getItem(STORAGE_KEY) ?? '{}');

test.after(() => uninstall());

test('a fresh game has no best and no direction of its own', () => {
  assert.equal(Session.getBest('nothing-played'), null);
  assert.equal(Session.getScoreDirection('nothing-played'), 'high');
});

test('higher wins by default', () => {
  Session.submitScore('t-high', 100);
  assert.equal(Session.getBest('t-high'), 100);

  const worse = Session.submitScore('t-high', 40);
  assert.equal(worse.isBest, false);
  assert.equal(worse.previousBest, 100);
  assert.equal(Session.getBest('t-high'), 100, 'a lower score must not replace a higher best');

  const better = Session.submitScore('t-high', 140);
  assert.equal(better.isBest, true);
  assert.equal(Session.getBest('t-high'), 140);
});

test("a 'low' game ranks the other way, which is Circuit Racer's whole scoring", () => {
  Session.setScoreDirection('t-low', 'low');
  Session.submitScore('t-low', 42.19);
  assert.equal(Session.getBest('t-low'), 42.19);

  const slower = Session.submitScore('t-low', 55.0);
  assert.equal(slower.isBest, false, 'a slower lap is not a better lap');
  assert.equal(Session.getBest('t-low'), 42.19);

  const quicker = Session.submitScore('t-low', 38.5);
  assert.equal(quicker.isBest, true);
  assert.equal(Session.getBest('t-low'), 38.5);
});

test('an unknown direction throws rather than being quietly ignored', () => {
  // Loudly, and at boot: a game registers its direction once as it starts, so
  // a typo that was swallowed would surface later as the wrong score winning.
  assert.throws(() => Session.setScoreDirection('t-bogus', 'sideways'), /high.*low/s);
  assert.equal(Session.getScoreDirection('t-bogus'), 'high');
});

test('variants keep separate records, and the game-level best is the best of them', () => {
  Session.setScoreDirection('t-variant', 'low');
  Session.submitScore('t-variant', 60, { variant: 'loop' });
  Session.submitScore('t-variant', 45, { variant: 'sprint' });

  assert.equal(Session.getBest('t-variant', { variant: 'loop' }), 60);
  assert.equal(Session.getBest('t-variant', { variant: 'sprint' }), 45);
  assert.equal(Session.getBest('t-variant'), 45, 'the game-level best is the best variant');
});

test('a score that is not a finite number is refused', () => {
  const before = Session.getBest('t-high');
  for (const bad of [NaN, Infinity, -Infinity, 'nope', null, undefined]) {
    Session.submitScore('t-high', bad);
  }
  assert.equal(Session.getBest('t-high'), before, 'rubbish must not become a record');
});

test('run stats round-trip, and an unknown game has none', () => {
  Session.setRunStats('t-stats', { laps: 3, clean: true });
  assert.deepEqual(Session.getRunStats('t-stats'), { laps: 3, clean: true });
  assert.equal(Session.getRunStats('never-played'), null);
});

test('played games are reported in the order they were first played', () => {
  Session.clear();
  Session.submitScore('first', 1);
  Session.submitScore('second', 1);
  Session.submitScore('first', 2);
  assert.deepEqual(Session.getPlayedGames(), ['first', 'second']);
});

test('everything written reaches storage, not just memory', () => {
  Session.clear();
  Session.submitScore('t-persist', 7);
  const stored = raw();
  assert.equal(stored.bests['t-persist'], 7, 'the best never reached sessionStorage');
  assert.ok(Array.isArray(stored.played) && stored.played.includes('t-persist'));
});

test('clear() wipes the visit but KEEPS the score directions', () => {
  Session.setScoreDirection('t-keep', 'low');
  Session.submitScore('t-keep', 10);
  Session.clear();

  assert.equal(Session.getBest('t-keep'), null, 'scores are data about the visit and should go');
  assert.deepEqual(Session.getPlayedGames(), []);
  assert.equal(
    Session.getScoreDirection('t-keep'),
    'low',
    'direction is a fact about the game — losing it makes the slowest lap the record',
  );
});

test('the sound preference survives clear(), because it is a preference', () => {
  Session.setSoundOn(false);
  assert.equal(Session.isSoundOn(), false);
  Session.clear();
  assert.equal(Session.isSoundOn(), false, 'muting the site should not be undone by a clear');
  Session.setSoundOn(true);
  assert.equal(Session.isSoundOn(), true);
});

test('sound defaults to on', async () => {
  // A fresh module against empty storage, which is what a first visit is.
  globalThis.sessionStorage.clear();
  const fresh = await import(`../engine/session.js?first-visit=${Date.now()}`);
  assert.equal(fresh.Session.isSoundOn(), true);
});

test('the v1 key is swept on load — it held impossible lap times', async () => {
  globalThis.sessionStorage.clear();
  globalThis.sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ bests: { 'circuit-racer': 0.001 } }));

  const fresh = await import(`../engine/session.js?legacy=${Date.now()}`);

  assert.equal(
    globalThis.sessionStorage.getItem(LEGACY_KEY),
    null,
    'the v1 key must be removed, not left to rot',
  );
  assert.equal(
    fresh.Session.getBest('circuit-racer'),
    null,
    'a v1 best must not be adopted — that is what the version bump was for',
  );
});

test('unreadable stored data is discarded rather than crashing the page', async () => {
  globalThis.sessionStorage.clear();
  globalThis.sessionStorage.setItem(STORAGE_KEY, '{ this is not json');

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const fresh = await import(`../engine/session.js?corrupt=${Date.now()}`);
    assert.equal(fresh.Session.getBest('anything'), null);
  } finally {
    console.warn = realWarn;
  }

  assert.ok(warnings.some((w) => w.includes('[session]')), 'a corrupt session should be reported');
  assert.equal(globalThis.sessionStorage.getItem(STORAGE_KEY), null, 'and cleaned up');
});
