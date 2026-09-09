// tests/tide.grid.test.mjs
//
// Tide has one rule, so it has one thing to prove: that the rule makes a game.
//
// Every claim in the design is here, and two of them came out against the
// design and changed it. The measurements are in games/tide/grid.js at the
// tuning they chose; this file is what re-runs them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NEUTRAL,
  TIDE_TUNING,
  Tide,
  linesOf,
  linesThrough,
  sizeFor,
  turnsEachFor,
} from '../games/tide/grid.js';
import { chooseMove, mulberry32, playOnce, seatBias } from './helpers/tide-bot.mjs';

const TABLES = [2, 3, 4, 5, 6];

// --- The rule is what it says it is ---------------------------------------

test('the preview is exactly what happens', () => {
  // The preview is not decoration: it is the whole of how Tide is taught, so a
  // preview that disagreed with the move would be teaching the wrong game to
  // everybody who has never played it. Checked on every square of every turn of
  // a lot of games rather than on a sample.
  const rng = mulberry32(1);
  for (let run = 0; run < 60; run++) {
    const players = TABLES[run % TABLES.length];
    const game = new Tide({ players, rng });
    while (!game.isOver) {
      const index = chooseMove(game, 'greedy', rng);
      const promised = game.preview(index);
      const before = [...game.scores];
      const actual = game.place(index);
      assert.deepEqual(actual.payouts, promised.payouts, 'the payout was not what was shown');
      assert.deepEqual(actual.lines, promised.lines, 'a different line washed');
      for (let p = 0; p < players; p++) {
        assert.equal(game.scores[p], before[p] + promised.payouts[p],
          `player ${p} was not paid what the screen promised`);
      }
    }
  }
});

test('a full line goes to whoever holds most of it, and a level line pays nobody', () => {
  // The rule, stated three ways round, on a board built by hand rather than
  // found in a run -- so this says what the game IS rather than what one game
  // happened to do.
  const build = (row) => {
    const game = new Tide({ players: 2, tuning: { neutralStones: 0 }, rng: () => 0 });
    row.forEach((who, i) => { game.cells[i] = who; });
    return game;
  };

  // Player 0 holds three of the five; the last square is player 0's to play.
  let game = build([0, 0, 1, 1, null]);
  let out = game.preview(4, 0);
  assert.equal(out.payouts[0], 5, 'the majority did not take the line');
  assert.equal(out.payouts[1], 0);

  // Level at two-all, so nobody has the most and nobody is paid.
  //
  // Note WHAT IT TAKES to be level: a grey stone. Five squares split between
  // two people always leaves somebody ahead, so on a two-player board with no
  // grey stones a full line always pays out. The scattered stones are not only
  // there to give the opening some shape — they are what makes spoiling a line
  // possible at all when there are only two of you.
  game = build([0, 0, 1, NEUTRAL, null]);
  out = game.preview(4, 1);
  assert.equal(out.total, 0, 'a level line paid somebody');

  // And a grey stone counts towards filling the line but pays nobody.
  game = build([0, NEUTRAL, NEUTRAL, 1, null]);
  out = game.preview(4, 1);
  assert.equal(out.payouts[1], 5, 'grey stones should not stop a majority');
});

test('a stone that closes a row AND a column is paid for both', () => {
  const game = new Tide({ players: 2, tuning: { neutralStones: 0 }, rng: () => 0 });
  const size = game.size;
  // Fill everything except the corner at (0,0), leaving its row and column one
  // short of full, with player 0 holding both.
  for (const line of linesThrough(0, size)) {
    for (const cell of linesOf(size)[line]) if (cell !== 0) game.cells[cell] = 0;
  }
  const out = game.preview(0, 0);
  assert.equal(out.lines.length, 2, 'only one line was seen');
  assert.equal(out.payouts[0], size * 2, 'the double close was paid once');
  // Cleared once, though: the corner is in both lines.
  assert.equal(out.cleared.length, size * 2 - 1);
});

// --- It is a game --------------------------------------------------------

test('THE GAME REWARDS PLAYING IT: a bot that thinks beats one that does not', () => {
  // The measurement that chose the payout rule, and the one that matters most.
  //
  // Under the rule this game shipped with, thinking wins 94-97% of the time.
  // Under the rule the design was signed off with it was 79-99% -- also fine --
  // but under the third candidate, where whoever closes a line is not paid,
  // GREEDY LOST TO RANDOM at 26-29%. A game where engaging with the rule is
  // worse than ignoring it is broken however interesting its decisions look.
  for (const players of [2, 4, 6]) {
    const rng = mulberry32(23);
    let thinking = 0;
    let flailing = 0;
    const runs = 120;
    for (let i = 0; i < runs; i++) {
      const seats = [];
      for (let p = 0; p < players; p++) seats.push((p + i) % 2 === 0 ? 'greedy' : 'random');
      const out = playOnce(seats, { rng });
      const winners = out.standings.filter((r) => r.place === 1);
      for (const w of winners) {
        if (seats[w.player] === 'greedy') thinking += 1 / winners.length;
        else flailing += 1 / winners.length;
      }
    }
    const share = thinking / (thinking + flailing);
    assert.ok(share > 0.75,
      `at ${players} players, thinking only wins ${(share * 100).toFixed(0)}% of the time`);
  }
});

test('and there is something at stake on a real share of turns', () => {
  // The signed-off rule had a payout available on 19% of turns, so four turns in
  // five were dead air. This one is about half.
  for (const players of [2, 4, 6]) {
    const rng = mulberry32(5);
    let live = 0;
    let turns = 0;
    for (let i = 0; i < 60; i++) {
      const out = playOnce(new Array(players).fill('greedy'), { rng });
      live += out.liveTurns;
      turns += out.turns;
    }
    assert.ok(live / turns > 0.3,
      `only ${((100 * live) / turns).toFixed(0)}% of turns had anything at stake at ${players} players`);
  }
});

test('the tide comes in often enough to be worth watching', () => {
  for (const players of TABLES) {
    const rng = mulberry32(9);
    let washes = 0;
    const runs = 60;
    for (let i = 0; i < runs; i++) washes += playOnce(new Array(players).fill('greedy'), { rng }).washes;
    assert.ok(washes / runs >= 4,
      `${players} players saw only ${(washes / runs).toFixed(1)} lines wash in a whole game`);
  }
});

// --- It is fair ----------------------------------------------------------

test('the board fills legally, nobody is ever stuck, and everyone gets the same turns', () => {
  // Deadlock is impossible by construction and it is worth saying why: filling
  // the last empty square completes every row and every column, so the whole
  // board washes and comes back empty. There is therefore always somewhere to
  // play. This walks it rather than trusting the argument.
  const rng = mulberry32(31);
  for (const players of TABLES) {
    for (let run = 0; run < 20; run++) {
      const game = new Tide({ players, rng });
      const played = new Array(players).fill(0);
      while (!game.isOver) {
        assert.ok(game.emptyCells().length > 0, 'no square left to play');
        played[game.currentPlayer] += 1;
        game.place(chooseMove(game, 'greedy', rng));
      }
      assert.deepEqual(played, new Array(players).fill(game.turnsEach),
        `turns were not equal at ${players} players`);
    }
  }
});

test('WHERE YOU SIT IS NOT THE GAME', () => {
  // With every seat playing identically, any difference left is the seating.
  //
  // This is what chose the board sizes and killed the catch-up rule. On a 5x5
  // board at six players one chair scored 16% under the rest; on 6x6 that comes
  // down to 8%. Rotating the lead, snaking it, and sorting by score were all
  // tried and all made at least one table size worse, so the order is left
  // alone -- see the tuning.
  //
  // The band is on POINTS rather than on win rate. A win rate is a step
  // function over a small score gap and swings far harder than the gap it is
  // reporting; points are the thing a seat actually gets more or less of.
  for (const players of TABLES) {
    const { points, runs } = seatBias(players, { runs: 260, policy: 'greedy' });
    const mean = points.reduce((a, b) => a + b, 0) / players / runs;
    points.forEach((total, seat) => {
      const share = total / runs / mean;
      assert.ok(share > 0.82 && share < 1.18,
        `at ${players} players seat ${seat} scores ${(share * 100).toFixed(0)}% of the average`);
    });
  }
});

test('the opening never hands anybody a line that was nearly finished', () => {
  // Grey stones are scattered, and a free scatter can drop three into one row.
  // Rejection sampling against a cap, checked over enough boards that a rare
  // failure would show.
  const rng = mulberry32(77);
  for (let run = 0; run < 800; run++) {
    const players = TABLES[run % TABLES.length];
    const game = new Tide({ players, rng });
    let greys = 0;
    for (const cell of game.cells) if (cell === NEUTRAL) greys += 1;
    assert.equal(greys, TIDE_TUNING.neutralStones, 'the scatter did not place them all');
    for (const line of linesOf(game.size)) {
      const inLine = line.filter((c) => game.cells[c] === NEUTRAL).length;
      assert.ok(inLine <= TIDE_TUNING.maxNeutralPerLine,
        `a line opened with ${inLine} grey stones in it`);
    }
  }
});

// --- The hot potato ------------------------------------------------------

test('a line one stone from washing knows who it belongs to', () => {
  // The conversation lives here, so the state the screen needs is part of the
  // rules rather than something a renderer works out for itself. A row somebody
  // leads three to one is a row nobody else wants to close, and everyone should
  // be able to see that from the other side of a room.
  const game = new Tide({ players: 3, tuning: { neutralStones: 0 }, rng: () => 0 });
  [0, 0, 0, 1, null].forEach((who, i) => { game.cells[i] = who; });

  const ready = game.readyLines().filter((r) => r.line === 0);
  assert.equal(ready.length, 1, 'the line one short was not reported');
  assert.equal(ready[0].empty, 4, 'the wrong square was named');
  assert.equal(ready[0].leader, 0, 'the wrong player was named as holding it');
  assert.equal(ready[0].value, game.size);

  // And a level line reports nobody, because nobody has the most.
  const level = new Tide({ players: 3, tuning: { neutralStones: 0 }, rng: () => 0 });
  [0, 0, 1, 1, null].forEach((who, i) => { level.cells[i] = who; });
  assert.equal(level.readyLines().find((r) => r.line === 0).leader, -1);
});

test('closing a line you do not lead is a real cost, so it is a real decision', () => {
  // The decision the whole design rests on, made concrete rather than inferred
  // from win rates: on this board, one square hands 5 points to somebody else
  // and another hands nothing to anybody. If those ever became the same move,
  // Tide would have no decision in it.
  const game = new Tide({ players: 2, tuning: { neutralStones: 0 }, rng: () => 0 });
  [0, 0, 0, 1, null].forEach((who, i) => { game.cells[i] = who; });

  const closing = game.preview(4, 1);
  assert.equal(closing.payouts[0], game.size, 'closing did not pay the player who holds the line');
  assert.equal(closing.payouts[1], 0, 'the closer was paid for a line they do not lead');

  const elsewhere = game.preview(12, 1);
  assert.equal(elsewhere.total, 0, 'a quiet square paid somebody');
});

// --- Housekeeping --------------------------------------------------------

test('the board and the length are chosen by the table, not by luck', () => {
  assert.equal(sizeFor(4), 5);
  assert.equal(sizeFor(5), 6, 'a big table should get a bigger board');
  for (const players of TABLES) {
    const stones = turnsEachFor(players) * players;
    assert.ok(stones >= 36 && stones <= 52,
      `${players} players play ${stones} stones, which is a different length of game`);
    assert.ok(turnsEachFor(players) >= TIDE_TUNING.minTurnsEach);
  }
});

test('tuning is data a test can override', () => {
  // Convention 3, and here it is load-bearing: the payout rule is a dial
  // because choosing it was the design, and a future argument about it should
  // be re-runnable rather than re-litigated.
  const shared = new Tide({ players: 2, tuning: { payout: 'share', neutralStones: 0 }, rng: () => 0 });
  [0, 0, 0, 1, null].forEach((who, i) => { shared.cells[i] = who; });
  const out = shared.preview(4, 1);
  assert.equal(out.payouts[0], 3, 'the share rule is no longer reachable');
  assert.equal(out.payouts[1], 2);
  assert.notEqual(sizeFor(6, { largeFrom: 99 }), 6, 'the board-size dial does nothing');
});

test('standings share a tie rather than inventing an order', () => {
  const game = new Tide({ players: 3, rng: mulberry32(2) });
  game.scores = [7, 7, 3];
  const rows = game.standings();
  assert.equal(rows[0].place, 1);
  assert.equal(rows[1].place, 1, 'a tie on points and stones was broken out of thin air');
  assert.equal(rows[2].place, 3);
});
