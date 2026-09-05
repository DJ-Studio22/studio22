// engine/tournament-ui.js
//
// The screens a hot-seat tournament is played through: setup, the get-ready
// handoff, the running standings, and the podium.
//
// Split from engine/tournament.js on purpose. That file is the rules — who
// plays when, what a score is worth — and has no DOM in it, so the flow can
// be reasoned about and tested without a browser. This file is everything
// you look at, and knows nothing about scoring beyond what it is handed.
//
// DESIGNED FOR TEN FEET AWAY
// --------------------------
// This is the one part of Studio 22 most likely to be on a television with
// people on a sofa, so the defaults are sized for that rather than for a
// laptop: very large type, thick borders, and player colour carrying the
// identity. Colour is never the only signal — every player is also numbered
// and named — because eight colours on a badly calibrated TV is not a
// reliable way to tell people apart, and some of the people on the sofa will
// not be able to distinguish all eight anyway.
//
// INPUT
// -----
// engine/input.js, so a gamepad, the keyboard and a touchscreen all drive
// the same cursor. Navigation is spatial and works on real DOM focus, so
// tabbing works too and a screen reader is not left behind.

import { Input } from './input.js';
import { Manifest } from './manifest.js';
import {
  Tournament,
  MODES,
  MODE_INFO,
  PLAYER_COLORS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_NAME_LENGTH,
} from './tournament.js';

const ARCADE_URL = '/arcade.html';

// Seconds on the get-ready screen. Long enough to actually pass a controller
// and settle, short enough that nobody is drumming their fingers. Any button
// skips it.
const COUNTDOWN_SECONDS = 3;

// The on-screen keyboard. Ten across so the shape is familiar, with the
// three wide keys on their own row underneath.
const KEY_ROWS = [
  [...'ABCDEFGHIJ'],
  [...'KLMNOPQRST'],
  [...'UVWXYZ0123'],
  [...'456789'],
];

const SCREEN = {
  PLAYERS: 'players',
  MODE: 'mode',
  GAMES: 'games',
  READY: 'ready',
  STANDINGS: 'standings',
  PODIUM: 'podium',
};

// --- Module state -------------------------------------------------------

let root = null;
let screen = SCREEN.PLAYERS;
let reduceMotion = false;

// The tournament being assembled. Separate from Tournament's own state,
// which does not exist until Start is pressed — a half-filled setup is not a
// tournament and should not be stored as one.
const draft = {
  players: [
    { name: '', colorIndex: 0 },
    { name: '', colorIndex: 1 },
  ],
  mode: MODES.SINGLE,
  gameIds: [],
  keyboardAcknowledged: false,
};

// Name entry, when the on-screen keyboard is up. null when it is not.
let editing = null;   // { index, value }

let countdownEndsAt = 0;
let cursor = null;
let frameId = 0;

// --- Small DOM helpers --------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A focusable control the spatial cursor can land on. Everything selectable
// is a real <button>, so touch taps and the keyboard's own Tab order work
// without this module doing anything special for them.
function navButton(className, label, onActivate, { disabled = false } = {}) {
  const button = el('button', className);
  button.type = 'button';
  button.dataset.nav = '';
  if (typeof label === 'string') button.textContent = label;
  else if (label) button.append(label);
  if (disabled) button.disabled = true;
  else button.addEventListener('click', onActivate);
  return button;
}

// Player colour as an inline custom property rather than a class per colour.
// The VALUE still comes from styles/tokens.css — this only says which token,
// which keeps the eight-colour list in one place instead of duplicated as
// eight CSS rules that have to be kept in step with it.
function paintPlayer(node, player) {
  node.style.setProperty('--player-color', `var(${PLAYER_COLORS[player.colorIndex].token})`);
  return node;
}

function displayName(player, index) {
  return player.name.trim() || `Player ${index + 1}`;
}

// --- Screen: players ----------------------------------------------------

function renderPlayers() {
  const wrap = el('div', 'tn-screen');
  wrap.append(heading('Who is playing?', `${MIN_PLAYERS} to ${MAX_PLAYERS} players, one screen`));

  const list = el('ul', 'tn-players');

  draft.players.forEach((player, index) => {
    const row = paintPlayer(el('li', 'tn-player'), player);

    row.append(el('span', 'tn-player__number', String(index + 1)));

    // Tapping the swatch cycles the colour. Skips colours already taken, so
    // two players can never end up the same shade by fiddling.
    const swatch = navButton('tn-player__swatch', '', () => {
      cycleColor(index);
      rerender();
    });
    swatch.setAttribute(
      'aria-label',
      `${displayName(player, index)} colour: ${PLAYER_COLORS[player.colorIndex].name}. Change it.`,
    );
    row.append(swatch);

    const name = navButton('tn-player__name', displayName(player, index), () => {
      editing = { index, value: player.name.toUpperCase() };
      rerender();
    });
    if (!player.name.trim()) name.classList.add('is-placeholder');
    row.append(name);

    const remove = navButton('tn-player__remove', '×', () => {
      draft.players.splice(index, 1);
      rerender();
    }, { disabled: draft.players.length <= MIN_PLAYERS });
    remove.setAttribute('aria-label', `Remove ${displayName(player, index)}`);
    row.append(remove);

    list.append(row);
  });

  wrap.append(list);

  const actions = el('div', 'tn-actions');
  actions.append(navButton('tn-btn', 'Add player', () => {
    draft.players.push({ name: '', colorIndex: firstFreeColor() });
    rerender();
  }, { disabled: draft.players.length >= MAX_PLAYERS }));

  actions.append(navButton('tn-btn tn-btn--primary', 'Next', () => {
    screen = SCREEN.MODE;
    rerender();
  }));

  wrap.append(actions);
  wrap.append(backLink('Leave', () => { window.location.href = ARCADE_URL; }));
  return wrap;
}

function firstFreeColor() {
  const taken = new Set(draft.players.map((p) => p.colorIndex));
  for (let i = 0; i < PLAYER_COLORS.length; i++) if (!taken.has(i)) return i;
  return 0;
}

function cycleColor(index) {
  const taken = new Set(draft.players.map((p, i) => (i === index ? -1 : p.colorIndex)));
  let next = draft.players[index].colorIndex;
  for (let step = 1; step <= PLAYER_COLORS.length; step++) {
    const candidate = (draft.players[index].colorIndex + step) % PLAYER_COLORS.length;
    if (!taken.has(candidate)) { next = candidate; break; }
  }
  draft.players[index].colorIndex = next;
}

// --- Screen: on-screen keyboard ----------------------------------------

function renderKeyboard() {
  const overlay = el('div', 'tn-overlay');
  const panel = paintPlayer(el('div', 'tn-keyboard'), draft.players[editing.index]);

  panel.append(el('p', 'tn-keyboard__label', `Name for player ${editing.index + 1}`));

  const field = el('div', 'tn-keyboard__field');
  field.append(el('span', 'tn-keyboard__value', editing.value || ' '));
  field.append(el('span', 'tn-keyboard__caret'));
  panel.append(field);

  const grid = el('div', 'tn-keyboard__grid');
  for (const row of KEY_ROWS) {
    const rowEl = el('div', 'tn-keyboard__row');
    for (const key of row) {
      rowEl.append(navButton('tn-key', key, () => {
        if (editing.value.length < MAX_NAME_LENGTH) editing.value += key;
        rerender();
      }));
    }
    grid.append(rowEl);
  }

  const wide = el('div', 'tn-keyboard__row');
  wide.append(navButton('tn-key tn-key--wide', 'Space', () => {
    if (editing.value.length < MAX_NAME_LENGTH && editing.value.length > 0) editing.value += ' ';
    rerender();
  }));
  wide.append(navButton('tn-key tn-key--wide', 'Delete', () => {
    editing.value = editing.value.slice(0, -1);
    rerender();
  }));
  wide.append(navButton('tn-key tn-key--wide tn-key--done', 'Done', commitName));
  grid.append(wide);

  panel.append(grid);
  panel.append(el('p', 'tn-keyboard__hint',
    'A types · B deletes · Start finishes · a real keyboard also just works'));

  overlay.append(panel);
  return overlay;
}

function commitName() {
  draft.players[editing.index].name = editing.value.trim().slice(0, MAX_NAME_LENGTH);
  editing = null;
  rerender();
}

// A hardware keyboard should type into the on-screen keyboard rather than
// being ignored in front of a grid of letters. This is the one place the
// module listens for raw keys: engine/input.js deliberately exposes buttons
// and axes, not text, and text is exactly what this screen is for.
function onRawKey(event) {
  if (!editing) return;

  if (event.key === 'Enter') { event.preventDefault(); commitName(); return; }
  if (event.key === 'Escape') { event.preventDefault(); editing = null; rerender(); return; }
  if (event.key === 'Backspace') {
    event.preventDefault();
    editing.value = editing.value.slice(0, -1);
    rerender();
    return;
  }
  if (event.key.length === 1 && /[a-z0-9 ]/i.test(event.key)) {
    event.preventDefault();
    if (editing.value.length < MAX_NAME_LENGTH) {
      // Leading spaces are dropped rather than trimmed later, so the field
      // shows what will actually be stored.
      if (event.key !== ' ' || editing.value.length > 0) {
        editing.value += event.key.toUpperCase();
      }
    }
    rerender();
  }
}

// --- Screen: mode -------------------------------------------------------

function renderMode() {
  const wrap = el('div', 'tn-screen');
  wrap.append(heading('How are you playing?', 'Pick a format'));

  const grid = el('div', 'tn-modes');
  for (const info of Object.values(MODE_INFO)) {
    const card = el('div', 'tn-mode');
    const button = navButton('tn-mode__button', null, () => {
      draft.mode = info.id;
      // Changing between one-game and many-game modes invalidates whatever
      // was picked before, and silently keeping a single game as a
      // one-round "gauntlet" would be a worse surprise than re-picking.
      draft.gameIds = [];
      screen = SCREEN.GAMES;
      rerender();
    });
    button.append(el('span', 'tn-mode__label', info.label));
    button.append(el('span', 'tn-mode__blurb', info.blurb));
    if (draft.mode === info.id) button.classList.add('is-current');
    card.append(button);
    grid.append(card);
  }

  wrap.append(grid);
  wrap.append(backLink('Back', () => { screen = SCREEN.PLAYERS; rerender(); }));
  return wrap;
}

// --- Screen: games ------------------------------------------------------

function renderGames() {
  const wrap = el('div', 'tn-screen');
  const many = MODE_INFO[draft.mode].games === 'many';

  wrap.append(heading(
    many ? 'Pick the sequence' : 'Pick a game',
    many ? 'Two or more. You play them in this order.' : 'Everyone plays this one',
  ));

  const games = Tournament.eligibleGames();

  if (games.length === 0) {
    wrap.append(el('p', 'tn-empty', 'No games are ready for a tournament yet.'));
    wrap.append(backLink('Back', () => { screen = SCREEN.MODE; rerender(); }));
    return wrap;
  }

  const grid = el('div', 'tn-games');
  for (const game of games) {
    const chosen = draft.gameIds.indexOf(game.id);
    const button = navButton('tn-game', null, () => {
      toggleGame(game.id, many);
      rerender();
    });

    if (chosen >= 0) button.classList.add('is-chosen');
    button.append(el('span', 'tn-game__title', game.title));
    button.append(el('span', 'tn-game__tagline', game.tagline ?? ''));

    // The order badge is what makes a gauntlet's sequence visible. Without
    // it, picking four games gives no clue which one you play first.
    if (many && chosen >= 0) {
      button.append(el('span', 'tn-game__order', String(chosen + 1)));
    } else if (chosen >= 0) {
      button.append(el('span', 'tn-game__order', '✓'));
    }

    if (game.inputRequirement === 'keyboard') {
      button.append(el('span', 'tn-game__badge', 'Keyboard only'));
    }

    grid.append(button);
  }
  wrap.append(grid);

  // The constraint, surfaced here rather than discovered three turns in.
  // A controller can be passed round a room; a keyboard-only game means
  // everybody has to come and sit at the keyboard, which is a different
  // evening and worth knowing about before it starts.
  const needsKeyboard = Tournament.requiresKeyboard(draft.gameIds);
  if (needsKeyboard) {
    const notice = el('div', 'tn-notice');
    notice.append(el('h3', 'tn-notice__title', 'This tournament needs a keyboard'));
    notice.append(el('p', 'tn-notice__body',
      draft.gameIds
        .filter((id) => Manifest.getById(id)?.inputRequirement === 'keyboard')
        .map((id) => Manifest.getById(id).title)
        .join(' and ')
      + ' cannot be played on a controller. Everyone will have to take their '
      + 'turn at the keyboard rather than passing a pad around.'));

    const confirm = navButton(
      `tn-btn ${draft.keyboardAcknowledged ? 'tn-btn--confirmed' : ''}`,
      draft.keyboardAcknowledged ? 'Everyone is at the keyboard ✓' : 'We are all at the keyboard',
      () => { draft.keyboardAcknowledged = !draft.keyboardAcknowledged; rerender(); },
    );
    notice.append(confirm);
    wrap.append(notice);
  }

  const enough = many ? draft.gameIds.length >= 2 : draft.gameIds.length === 1;
  const blocked = needsKeyboard && !draft.keyboardAcknowledged;

  const actions = el('div', 'tn-actions');
  actions.append(navButton('tn-btn tn-btn--primary', 'Start tournament', startTournament,
    { disabled: !enough || blocked }));
  wrap.append(actions);

  if (!enough) {
    wrap.append(el('p', 'tn-hint',
      many ? 'Pick at least two games.' : 'Pick one game.'));
  } else if (blocked) {
    wrap.append(el('p', 'tn-hint', 'Confirm everyone can reach the keyboard first.'));
  }

  wrap.append(backLink('Back', () => { screen = SCREEN.MODE; rerender(); }));
  return wrap;
}

function toggleGame(id, many) {
  const at = draft.gameIds.indexOf(id);
  if (at >= 0) draft.gameIds.splice(at, 1);
  else if (many) draft.gameIds.push(id);
  else draft.gameIds = [id];

  // Un-picking the last keyboard-only game should not leave a stale
  // acknowledgement behind for the next one.
  if (!Tournament.requiresKeyboard(draft.gameIds)) draft.keyboardAcknowledged = false;
}

function startTournament() {
  Tournament.create({
    mode: draft.mode,
    players: draft.players.map((player, index) => ({
      name: displayName(player, index),
      colorIndex: player.colorIndex,
    })),
    gameIds: draft.gameIds,
  });
  goToReady();
}

// --- Screen: get ready --------------------------------------------------

function goToReady() {
  screen = SCREEN.READY;
  countdownEndsAt = performance.now() + COUNTDOWN_SECONDS * 1000;
  rerender();
}

function renderReady() {
  const turn = Tournament.currentTurn();
  if (!turn) { screen = SCREEN.PODIUM; return renderPodium(); }

  const wrap = paintPlayer(el('div', 'tn-screen tn-screen--ready'), turn.player);

  wrap.append(el('p', 'tn-ready__turn', `Turn ${turn.turnNumber} of ${turn.totalTurns}`));
  wrap.append(el('p', 'tn-ready__player', `Player ${turn.player.id.slice(1)}`));
  wrap.append(el('h2', 'tn-ready__name', turn.player.name));
  wrap.append(el('p', 'tn-ready__game',
    turn.game ? `${turn.game.title} · get ready` : 'Get ready'));

  const count = el('p', 'tn-ready__count', String(COUNTDOWN_SECONDS));
  count.dataset.countdown = '';
  wrap.append(count);

  const actions = el('div', 'tn-actions');
  actions.append(navButton('tn-btn tn-btn--primary', 'Start now', launchTurn));
  actions.append(navButton('tn-btn', 'Skip my turn', () => {
    Tournament.skipTurn();
    afterTurn();
  }));
  actions.append(navButton('tn-btn tn-btn--quiet', "I'm out", () => {
    Tournament.withdrawPlayer(turn.player.id);
    afterTurn();
  }));
  wrap.append(actions);

  return wrap;
}

function launchTurn() {
  const turn = Tournament.currentTurn();
  const url = turn && Tournament.urlForTurn(turn);
  if (!url) { afterTurn(); return; }
  stopLoop();
  window.location.href = url;
}

// Where to go once a turn is over, skipped, or abandoned.
function afterTurn() {
  screen = Tournament.isFinished() ? SCREEN.PODIUM : SCREEN.STANDINGS;
  rerender();
}

// --- Screen: standings --------------------------------------------------

function renderStandings() {
  const wrap = el('div', 'tn-screen');
  const next = Tournament.nextTurn() ?? Tournament.currentTurn();

  wrap.append(heading('Standings', next ? `Next up: ${next.player.name}` : 'Last turn played'));

  const rows = Tournament.getStandings();
  const table = el('ol', 'tn-standings');

  // Rendered in the order the standings were LAST shown, then moved into the
  // new order on the next frame. That is what makes a player visibly climb
  // past another rather than simply appearing somewhere new — across a page
  // navigation there is no previous DOM to animate from, only the stored
  // order.
  const previousOrder = Tournament.getState()?.standingsOrder ?? [];
  const byId = new Map(rows.map((row) => [row.player.id, row]));
  const startOrder = [
    ...previousOrder.filter((id) => byId.has(id)),
    ...rows.map((r) => r.player.id).filter((id) => !previousOrder.includes(id)),
  ];

  for (const id of startOrder) table.append(standingRow(byId.get(id)));
  wrap.append(table);

  const actions = el('div', 'tn-actions');
  if (next) {
    actions.append(navButton('tn-btn tn-btn--primary', `Pass to ${next.player.name}`, goToReady));
  } else {
    actions.append(navButton('tn-btn tn-btn--primary', 'See the result',
      () => { screen = SCREEN.PODIUM; rerender(); }));
  }
  actions.append(navButton('tn-btn tn-btn--quiet', 'End tournament', confirmEnd));
  wrap.append(actions);

  // Reorder after the frame that drew the old order, so there are two
  // positions to animate between.
  requestAnimationFrame(() => flipInto(table, rows.map((r) => r.player.id)));
  Tournament.commitStandingsOrder(rows.map((r) => r.player.id));

  return wrap;
}

function standingRow(row) {
  const item = paintPlayer(el('li', 'tn-standing'), row.player);
  item.dataset.playerId = row.player.id;
  if (row.player.withdrawn) item.classList.add('is-withdrawn');

  item.append(el('span', 'tn-standing__position', row.position === null ? '–' : String(row.position)));

  const who = el('div', 'tn-standing__who');
  who.append(el('span', 'tn-standing__name', row.player.name));
  const meta = [];
  if (row.player.withdrawn) meta.push('withdrew');
  if (row.detail) meta.push(row.detail);
  if (!row.played) meta.push('not played yet');
  if (meta.length) who.append(el('span', 'tn-standing__meta', meta.join(' · ')));
  item.append(who);

  // Movement since the last standings screen. Shown as a word as well as an
  // arrow, because a small coloured triangle is the first thing to become
  // unreadable across a room.
  const move = el('span', 'tn-standing__move');
  if (row.position !== null && row.previousPosition !== null) {
    const delta = row.previousPosition - row.position;
    if (delta > 0) { move.textContent = `▲ ${delta}`; move.classList.add('is-up'); }
    else if (delta < 0) { move.textContent = `▼ ${-delta}`; move.classList.add('is-down'); }
  }
  item.append(move);

  item.append(el('span', 'tn-standing__score', row.played ? String(row.total) : '–'));
  return item;
}

/**
 * FLIP: measure where the rows are, put them in the new order, measure
 * again, then transform them back to where they were and let them animate
 * forward. Only transforms move, so nothing here can trigger a layout pass
 * mid-animation.
 */
function flipInto(list, order) {
  const items = new Map([...list.children].map((node) => [node.dataset.playerId, node]));

  const before = new Map();
  for (const [id, node] of items) before.set(id, node.getBoundingClientRect().top);

  for (const id of order) {
    const node = items.get(id);
    if (node) list.append(node);
  }

  if (reduceMotion) return;

  for (const [id, node] of items) {
    const delta = before.get(id) - node.getBoundingClientRect().top;
    if (!delta) continue;
    node.style.transform = `translate3d(0, ${delta}px, 0)`;
    node.style.transition = 'none';
    // Next frame, drop the offset and let the transition carry it home.
    requestAnimationFrame(() => {
      node.style.transition = '';
      node.style.transform = '';
    });
  }
}

function confirmEnd() {
  Tournament.clear();
  resetDraft();
  screen = SCREEN.PLAYERS;
  rerender();
}

// --- Screen: podium -----------------------------------------------------

function renderPodium() {
  const wrap = el('div', 'tn-screen tn-screen--podium');
  const podium = Tournament.getPodium();
  const all = Tournament.getStandings();

  if (podium.length === 0) {
    wrap.append(heading('No result', 'Nobody finished a turn.'));
    wrap.append(podiumActions());
    return wrap;
  }

  const winner = podium[0];
  wrap.append(paintPlayer(el('p', 'tn-podium__crown', 'Winner'), winner.player));
  wrap.append(paintPlayer(el('h2', 'tn-podium__winner', winner.player.name), winner.player));

  if (!reduceMotion) wrap.append(celebration(winner));

  // Second, first, third — the shape of a real podium, so the tallest block
  // is in the middle where the eye already is.
  const blocks = el('div', 'tn-podium');
  for (const slot of [1, 0, 2]) {
    const row = podium[slot];
    if (!row) continue;
    const block = paintPlayer(el('div', `tn-podium__block tn-podium__block--${row.position}`), row.player);
    block.append(el('span', 'tn-podium__place', ordinal(row.position)));
    block.append(el('span', 'tn-podium__name', row.player.name));
    block.append(el('span', 'tn-podium__score', String(row.total)));
    blocks.append(block);
  }
  wrap.append(blocks);

  // Everyone else, so a tournament of eight does not end by showing three
  // people and hiding the rest.
  if (all.length > podium.length) {
    const rest = el('ol', 'tn-podium__rest');
    for (const row of all.slice(podium.length)) {
      const item = paintPlayer(el('li', 'tn-podium__restRow'), row.player);
      item.append(el('span', 'tn-podium__restPlace',
        row.position === null ? '–' : ordinal(row.position)));
      item.append(el('span', 'tn-podium__restName', row.player.name));
      item.append(el('span', 'tn-podium__restScore', row.played ? String(row.total) : '–'));
      rest.append(item);
    }
    wrap.append(rest);
  }

  wrap.append(podiumActions());
  return wrap;
}

function podiumActions() {
  const actions = el('div', 'tn-actions');
  actions.append(navButton('tn-btn tn-btn--primary', 'Play again', () => {
    // Same people, same format: the common case is another round, not a
    // fresh setup. The draft still holds the roster.
    Tournament.clear();
    screen = SCREEN.PLAYERS;
    rerender();
  }));
  actions.append(navButton('tn-btn', 'Back to arcade', () => {
    Tournament.clear();
    window.location.href = ARCADE_URL;
  }));
  return actions;
}

function ordinal(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// Confetti, as spans that only ever move by transform and fade by opacity.
// Skipped entirely under prefers-reduced-motion rather than shortened.
function celebration(winner) {
  const layer = el('div', 'tn-confetti');
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 28; i++) {
    const piece = el('span', 'tn-confetti__piece');
    piece.style.setProperty('--x', `${(i / 28) * 100}%`);
    piece.style.setProperty('--delay', `${(i % 7) * 0.14}s`);
    piece.style.setProperty('--spin', `${(i % 2 ? 1 : -1) * (180 + i * 12)}deg`);
    // Alternating between the winner's colour and the site accent keeps the
    // celebration attached to the person who won it.
    if (i % 2) paintPlayer(piece, winner.player);
    layer.append(piece);
  }
  return layer;
}

// --- Shared bits --------------------------------------------------------

function heading(title, sub) {
  const header = el('header', 'tn-header');
  header.append(el('h1', 'tn-header__title', title));
  if (sub) header.append(el('p', 'tn-header__sub', sub));
  return header;
}

function backLink(label, onActivate) {
  const nav = el('div', 'tn-back');
  nav.append(navButton('tn-btn tn-btn--quiet', label, onActivate));
  return nav;
}

function resetDraft() {
  draft.gameIds = [];
  draft.keyboardAcknowledged = false;
}

// --- Rendering ----------------------------------------------------------

function rerender() {
  if (!root) return;

  const previousId = cursor?.dataset?.navId ?? null;
  root.textContent = '';

  let view;
  if (screen === SCREEN.PLAYERS) view = renderPlayers();
  else if (screen === SCREEN.MODE) view = renderMode();
  else if (screen === SCREEN.GAMES) view = renderGames();
  else if (screen === SCREEN.READY) view = renderReady();
  else if (screen === SCREEN.STANDINGS) view = renderStandings();
  else view = renderPodium();

  root.append(view);
  if (editing) root.append(renderKeyboard());

  // Stable ids so the cursor can be put back on the same control after a
  // re-render — otherwise typing a letter would bounce the highlight back to
  // the top of the keyboard on every keystroke.
  const items = navItems();
  items.forEach((node, index) => { node.dataset.navId = String(index); });

  const restored = previousId !== null ? items[Number(previousId)] : null;
  moveCursorTo(restored ?? items[0] ?? null);
}

function navItems() {
  // When the keyboard overlay is up it owns the cursor entirely, so the
  // controls behind it cannot be reached by accident.
  const scope = editing ? root.querySelector('.tn-keyboard') : root;
  return scope ? [...scope.querySelectorAll('[data-nav]:not([disabled])')] : [];
}

function moveCursorTo(node) {
  if (cursor) cursor.classList.remove('is-cursor');
  cursor = node ?? null;
  if (!cursor) return;
  cursor.classList.add('is-cursor');
  // Real focus, so the browser scrolls it into view and assistive tech
  // follows along instead of tracking an invisible cursor of our own.
  cursor.focus({ preventScroll: false });
}

// --- Spatial navigation -------------------------------------------------

// Nearest control in the direction pressed, scored by distance along the
// axis of travel plus a heavy penalty for drifting off it. The same approach
// arcade.html uses, so the two pages feel like one product.
function step(dx, dy) {
  const items = navItems();
  if (items.length === 0) return;
  if (!cursor) { moveCursorTo(items[0]); return; }

  const from = cursor.getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const node of items) {
    if (node === cursor) continue;
    const box = node.getBoundingClientRect();
    const ddx = (box.left + box.width / 2) - fromX;
    const ddy = (box.top + box.height / 2) - fromY;

    // Wrong side of the cursor: not a candidate for this direction at all.
    if (dx && Math.sign(ddx) !== dx) continue;
    if (dy && Math.sign(ddy) !== dy) continue;

    const along = Math.abs(dx ? ddx : ddy);
    const across = Math.abs(dx ? ddy : ddx);
    if (along < 2) continue;

    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = node; }
  }

  if (best) moveCursorTo(best);
}

// --- Input loop ---------------------------------------------------------

const NAV_THRESHOLD = 0.5;
let navLatchX = 0;
let navLatchY = 0;

function frame() {
  frameId = requestAnimationFrame(frame);
  Input.update();

  const state = Input.get(0);

  const dx = Math.abs(state.x) > NAV_THRESHOLD ? Math.sign(state.x) : 0;
  const dy = Math.abs(state.y) > NAV_THRESHOLD ? Math.sign(state.y) : 0;
  if (dx !== 0 && navLatchX === 0) step(dx, 0);
  if (dy !== 0 && navLatchY === 0) step(0, dy);
  navLatchX = dx;
  navLatchY = dy;

  if (Input.pressed('a') && cursor) cursor.click();

  if (Input.pressed('b')) {
    // B is delete while typing, and back everywhere else.
    if (editing) {
      editing.value = editing.value.slice(0, -1);
      rerender();
    } else {
      goBack();
    }
  }

  if (Input.pressed('start') && editing) commitName();

  if (screen === SCREEN.READY) tickCountdown();
}

function tickCountdown() {
  const remaining = countdownEndsAt - performance.now();
  const node = root.querySelector('[data-countdown]');
  if (!node) return;

  if (remaining <= 0) { launchTurn(); return; }

  const seconds = Math.ceil(remaining / 1000);
  const label = String(seconds);
  if (node.textContent !== label) {
    node.textContent = label;
    // Restarting the animation is what makes each number land as its own
    // beat rather than one continuous fade.
    node.classList.remove('is-beat');
    void node.offsetWidth;   // forced reflow, so the class re-add restarts it
    if (!reduceMotion) node.classList.add('is-beat');
  }
}

function goBack() {
  if (screen === SCREEN.MODE) { screen = SCREEN.PLAYERS; rerender(); }
  else if (screen === SCREEN.GAMES) { screen = SCREEN.MODE; rerender(); }
  else if (screen === SCREEN.PLAYERS) window.location.href = ARCADE_URL;
  // READY, STANDINGS and PODIUM have no "back": going backwards through a
  // tournament in progress has no meaning, and the buttons on those screens
  // already cover leaving.
}

function stopLoop() {
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
}

// --- Public surface -----------------------------------------------------

export const TournamentUI = {
  /**
   * Takes over an element and runs the tournament in it.
   *
   * Picks up where a tournament in progress left off, which is what makes
   * the whole thing work across pages: the browser comes back here from a
   * game, and this decides whether that means standings, the next handoff,
   * or the podium.
   */
  mount(element) {
    root = element;
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (Tournament.isActive()) {
      screen = Tournament.isFinished() ? SCREEN.PODIUM : SCREEN.STANDINGS;
      // Seed the roster from the tournament so "Play again" comes back with
      // the same people rather than an empty setup screen.
      const state = Tournament.getState();
      draft.players = state.players.map((p) => ({ name: p.name, colorIndex: p.colorIndex }));
      draft.mode = state.mode;
      draft.gameIds = [...state.gameIds];
    } else {
      screen = SCREEN.PLAYERS;
    }

    window.addEventListener('keydown', onRawKey);
    rerender();
    frameId = requestAnimationFrame(frame);
  },

  /** Exposed for a host page that wants to tear the UI down. */
  unmount() {
    stopLoop();
    window.removeEventListener('keydown', onRawKey);
    if (root) root.textContent = '';
    root = null;
  },
};
