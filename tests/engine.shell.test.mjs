// tests/engine.shell.test.mjs
//
// engine/shell.js is the biggest module in the project — 1,227 lines — and
// every game hands it the run. It draws pause, game over, the title screen and
// the HUD, and it is the one place a game's score becomes a session record.
//
// What is worth asserting is not the drawing. It is the wiring:
//
//   · A score reaches Session, and the BEST that comes back is the better
//     number rather than the one just submitted. Circuit Racer ranks the
//     other way round from every other game, and this is where that is either
//     honoured or quietly lost.
//   · Tournament mode is decided by parsing a URL, and "?tournament=0" has to
//     mean off. Getting that wrong sends a lone player into a handoff screen.
//   · Sound is a visit preference now, so the shell must READ it at boot
//     rather than starting every game unmuted.
//   · Menu navigation wraps, because a stick that stops at the last item
//     reads as a broken controller.
//
// The shell needs a DOM to construct at all, so this uses the same stub as
// canvas.js and loop.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const uninstall = installDom({ manualClock: true });
const clock = uninstall.clock;

const { GameCanvas } = await import('../engine/canvas.js');
const { GameShell } = await import('../engine/shell.js');
const { GameLoop } = await import('../engine/loop.js');
const { Session } = await import('../engine/session.js');
const { Input } = await import('../engine/input.js');

test.after(() => uninstall());

let nextId = 0;

/**
 * A shell on a fresh game id, so no test can see another's session records.
 * `search` sets window.location.search before construction, which is what the
 * tournament check reads.
 */
const built = [];

function makeShell({ search = '', ...options } = {}) {
  window.location.search = search;
  const gameId = `test-game-${nextId++}`;
  const canvas = new GameCanvas({ width: 800, height: 450 });
  const loop = new GameLoop({ update: () => {}, render: () => {} });
  const shell = new GameShell({ gameId, title: 'Test', canvas, loop, ...options });
  built.push(shell);
  return { shell, gameId, loop, canvas };
}

/**
 * Closes every shell built so far and empties the frame queue.
 *
 * A real page has exactly one shell. This file has many, and every open one
 * runs its own overlay loop that calls Input.update() — so on a shared frame
 * the first loop to run CONSUMES the press edge and the shell under test
 * never sees it. That is a property of the test file, not of the shell, and
 * this is the line that removes it.
 */
function soloShell(options) {
  for (const previous of built) previous.resume();
  clock.tick(20);
  built.length = 0;
  return makeShell(options);
}

// --- Scores reach the session --------------------------------------------

test('a score submitted through the shell becomes the session record', () => {
  const { shell, gameId } = makeShell();
  shell.showGameOver(1200);
  assert.equal(Session.getBest(gameId), 1200);
});

test('THE BEST READ BACK IS THE BETTER NUMBER, not the one just submitted', () => {
  // The subtle one. Reusing the submitted score would show a worse run as the
  // new best on the panel, which is the number the player is looking at.
  const { shell, gameId } = makeShell();
  shell.showGameOver(900);
  shell.showGameOver(400);
  assert.equal(Session.getBest(gameId), 900, 'a worse run overwrote the best');
});

test('LOWER IS BETTER when a game says so — the Circuit Racer case', () => {
  const { shell, gameId } = makeShell();
  Session.setScoreDirection(gameId, 'low');
  shell.showGameOver(52.4);
  shell.showGameOver(48.1);
  assert.equal(Session.getBest(gameId), 48.1, 'a faster lap was not treated as better');
  shell.showGameOver(61.0);
  assert.equal(Session.getBest(gameId), 48.1, 'a slower lap overwrote the fastest');
});

test('run stats are recorded alongside the score', () => {
  const { shell, gameId } = makeShell();
  shell.showGameOver(10, { perfects: 4, reached: 'Dusk' });
  assert.deepEqual(Session.getRunStats(gameId), { perfects: 4, reached: 'Dusk' });
});

test('a game that reports no stats does not wipe the ones it had', () => {
  const { shell, gameId } = makeShell();
  shell.showGameOver(10, { perfects: 4 });
  shell.showGameOver(12);
  assert.deepEqual(Session.getRunStats(gameId), { perfects: 4 });
});

test('playing a game marks it played, even on a scoreless run', () => {
  const { shell, gameId } = makeShell();
  shell.showGameOver(0);
  assert.ok(Session.getPlayedGames().includes(gameId));
});

// --- Tournament mode ------------------------------------------------------

test('?tournament turns tournament mode on in every form that means on', () => {
  for (const search of ['?tournament', '?tournament=1', '?tournament=yes', '?a=b&tournament=1']) {
    const { shell } = makeShell({ search });
    assert.equal(shell.isTournamentMode, true, `${search} should be tournament mode`);
  }
});

test('and OFF for no param and for the explicit offs', () => {
  for (const search of ['', '?other=1', '?tournament=0', '?tournament=false']) {
    const { shell } = makeShell({ search });
    assert.equal(shell.isTournamentMode, false, `${search} should NOT be tournament mode`);
  }
});

// --- Sound is a visit preference -----------------------------------------

test('THE SHELL READS THE VISIT PREFERENCE at boot, not a hardcoded on', () => {
  // Every game page is its own document, so a shell that starts unmuted
  // discards the choice the player made on the last one.
  Session.setSoundOn(false);
  try {
    const { shell } = makeShell();
    assert.equal(shell.isSoundOn, false, 'a muted visit produced an unmuted game');
  } finally {
    Session.setSoundOn(true);
  }
});

test('and writes it back, so the next game inherits the change', () => {
  const { shell } = makeShell();
  shell.setSound(false);
  try {
    assert.equal(Session.isSoundOn(), false, 'muting a game did not reach the session');
    const { shell: second } = makeShell();
    assert.equal(second.isSoundOn, false, 'the next game did not inherit the mute');
  } finally {
    Session.setSoundOn(true);
  }
});

// --- Screens and the loop -------------------------------------------------

test('opening a screen suspends the game and closing it resumes', () => {
  const { shell, loop } = makeShell();
  loop.start();
  shell.pause();
  assert.equal(shell.isPaused, true);

  // update() returns false while a screen is up: that is the one line every
  // game's update() leans on to stop simulating behind a menu.
  assert.equal(shell.update(), false, 'the game was told to keep simulating while paused');
  loop.stop();
});

test('a game over screen also stops the game simulating', () => {
  const { shell, loop } = makeShell();
  loop.start();
  shell.showGameOver(5);
  assert.equal(shell.update(), false);
  loop.stop();
});

test('with no screen open, update() lets the game run', () => {
  const { shell, loop } = makeShell();
  loop.start();
  assert.equal(shell.update(), true);
  loop.stop();
});

test('showTitle puts a screen up before the game starts', () => {
  const { shell } = makeShell();
  shell.showTitle({ name: 'Test', tagline: 'A tagline' });
  assert.equal(shell.update(), false, 'the game ran underneath its own title screen');
});

// --- Menu navigation ------------------------------------------------------

/**
 * One deliberate press-and-release, as the shell's MENU sees it.
 *
 * Menu input is not handled by shell.update() — that returns false the moment
 * a screen is open and does nothing else. Overlays run on the shell's own
 * frame loop, because the game loop is suspended while one is up. So driving
 * a menu means pumping the clock, not calling update().
 */
function tap(code) {
  window.dispatch('keydown', { code });
  clock.tick(20);
  window.dispatch('keyup', { code });
  clock.tick(20);
}

test('the menu cursor moves, and activating runs THAT item', () => {
  // Observed through what the item actually does rather than through an
  // index: the shell exposes no cursor, and the behaviour is the point.
  let restarted = 0;
  const { shell } = soloShell({ onRestart: () => { restarted++; } });
  shell.pause();

  // Pause menu is Resume, Restart, Sound, How to Play, Back. One down lands
  // on Restart.
  tap('ArrowDown');
  tap('Space');
  assert.equal(restarted, 1, 'activating the second item did not restart');
});

test('MENU SELECTION WRAPS — a cursor that stops reads as a broken pad', () => {
  let restarted = 0;
  const { shell } = soloShell({ onRestart: () => { restarted++; } });
  shell.pause();

  // Five items, so five downs must return the cursor to the first one.
  for (let i = 0; i < 5; i++) tap('ArrowDown');
  tap('Space');

  assert.equal(restarted, 0, 'the cursor did not wrap — it landed on Restart');
  assert.equal(shell.isPaused, false, 'the cursor did not wrap back to Resume');
});

test('going UP from the first item wraps to the last', () => {
  let restarted = 0;
  const { shell } = soloShell({ onRestart: () => { restarted++; } });
  shell.pause();
  tap('ArrowUp');      // from Resume, up should reach the last item
  tap('Space');
  assert.equal(restarted, 0, 'up from the first item ran Restart');
  assert.equal(shell.isPaused, true, 'up from the first item resumed');
});

test('a reopened menu opens on its first item again', () => {
  let restarted = 0;
  const { shell } = soloShell({ onRestart: () => { restarted++; } });
  shell.pause();
  tap('ArrowDown');    // move off the first item
  shell.resume();
  shell.pause();              // and open it again
  tap('Space');
  assert.equal(restarted, 0, 'the reopened menu kept the old cursor position');
  assert.equal(shell.isPaused, false, 'the reopened menu did not start on Resume');
});

// --- Construction ---------------------------------------------------------

test('the shell survives a game that passes no optional wiring', () => {
  const canvas = new GameCanvas({ width: 400, height: 300 });
  assert.doesNotThrow(() => new GameShell({ gameId: 'bare', title: 'Bare', canvas }));
});

test('the shell theme decides the letterbox, so the frame matches the game', () => {
  // A light game framed in the site's near-black looks broken rather than
  // framed, and the game should not have to know the bars exist. The colour
  // lands on the container the canvas sits in.
  const boxOf = (canvas) => String(canvas.canvas.parentNode?.style?.background ?? '');

  const light = makeShell({ shellTheme: 'light' });
  assert.match(boxOf(light.canvas), /light/, 'a light-themed shell left the letterbox dark');

  const dark = makeShell();
  assert.ok(boxOf(dark.canvas).length > 0, 'the default theme set no letterbox colour at all');
  assert.doesNotMatch(boxOf(dark.canvas), /light/, 'the dark default used the light letterbox');
});
