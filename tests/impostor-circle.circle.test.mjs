// tests/impostor-circle.circle.test.mjs
//
// Impostor Circle's difficulty is entirely in its word list, so that is what
// gets checked — not by reading it, but by walking all of it.
//
// The two ways a pair fails are opposite and both are fatal. Too far apart
// (BANANA / SUBMARINE) and the impostor is caught on their first word, so there
// is no game. Too close (SOFA / COUCH) and every clue fits both, so the vote is
// a coin toss and there is no game either. Convention 11 in tests/README.md is
// the same point about timing windows: a window nobody can hit is not
// difficulty, and neither is one nobody can miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CIRCLE_TUNING, Circle, PAIRS, PHASE, SKIP } from '../games/impostor-circle/circle.js';

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLES = [3, 4, 5, 6];

/** Plays a whole game, voting however `pick` says. */
function playOnce(players, pick, { tuning, seed = 1 } = {}) {
  const game = new Circle({ players, tuning, rng: rngFrom(seed) });
  const rounds = [];
  while (game.phase !== PHASE.OVER) {
    while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
      if (game.phase === PHASE.HANDOFF) game.reveal();
      else game.seen();
    }
    game.startVote();
    while (game.phase === PHASE.VOTE) game.vote(pick(game, game.seat));
    if (game.phase === PHASE.STEAL) game.steal('NOT THE WORD');
    rounds.push({ impostor: game.impostor, ...game.outcome });
    game.nextRound();
  }
  return { game, rounds };
}

// --- The word list -------------------------------------------------------

test('every pair is two different words of the same kind', () => {
  const seen = new Set();
  for (const pair of PAIRS) {
    assert.ok(pair.a && pair.b, 'a pair is missing a word');
    assert.notEqual(pair.a, pair.b, `${pair.a} is paired with itself`);
    assert.ok(pair.of && pair.of.length > 2, `${pair.a}/${pair.b} does not say what kind of thing it is`);
    assert.equal(typeof pair.near, 'boolean', `${pair.a}/${pair.b} is neither near nor far`);
    // Same word on both sides of two different pairs is fine; the same PAIR
    // twice is a wasted round, because the second time the table already knows
    // the shape of the answer.
    const key = [pair.a, pair.b].sort().join('|');
    assert.ok(!seen.has(key), `${key} appears twice`);
    seen.add(key);
  }
});

test('there are enough pairs that a sitting never repeats one', () => {
  // The deck is dealt without replacement, and a game is at most six rounds, so
  // each difficulty needs at least six. The real floor is higher than that: a
  // group that plays several games in an evening should not keep meeting the
  // same words, so each side wants a good multiple of a full game.
  for (const near of [true, false]) {
    const count = PAIRS.filter((p) => p.near === near).length;
    assert.ok(count >= CIRCLE_TUNING.maxPlayers * 3,
      `only ${count} ${near ? 'near' : 'far'} pairs, which is barely a game`);
  }
});

test('a word is never on screen in the wrong hands', () => {
  // The one thing this game cannot get wrong. Walked for every seat of every
  // round of every table size: the impostor sees the impostor word, everybody
  // else sees the table word, and the two are never the same.
  for (const players of TABLES) {
    const game = new Circle({ players, rng: rngFrom(players) });
    while (game.phase !== PHASE.OVER) {
      assert.notEqual(game.tableWord, game.impostorWord, 'both words are the same');
      for (let p = 0; p < players; p++) {
        const shown = game.wordFor(p);
        if (p === game.impostor) assert.equal(shown, game.impostorWord);
        else assert.equal(shown, game.tableWord);
      }
      while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
        if (game.phase === PHASE.HANDOFF) game.reveal(); else game.seen();
      }
      game.startVote();
      while (game.phase === PHASE.VOTE) game.vote((game.seat + 1) % players);
      if (game.phase === PHASE.STEAL) game.steal('');
      game.nextRound();
    }
  }
});

// --- Fairness by construction --------------------------------------------

test('EVERYBODY IS THE IMPOSTOR EXACTLY ONCE', () => {
  // Not "on average". Rolling the role each round leaves somebody who was never
  // it and somebody who was it three times out of four, and both of those are
  // felt at a table long before they show up in a statistic.
  for (const players of TABLES) {
    for (let seed = 1; seed <= 60; seed++) {
      const { rounds } = playOnce(players, (g) => (g.seat + 1) % players, { seed });
      assert.equal(rounds.length, players, 'the game was not one round per player');
      const wasImpostor = rounds.map((r) => r.impostor).sort((a, b) => a - b);
      assert.deepEqual(wasImpostor, [...Array(players).keys()],
        `at ${players} players somebody was the impostor twice`);
    }
  }
});

test('and the order it comes round in is not predictable', () => {
  // Fair by construction must not mean "player one is always first". Over many
  // games every seat should take the first round about equally often.
  const players = 5;
  const first = new Array(players).fill(0);
  const runs = 600;
  for (let seed = 1; seed <= runs; seed++) {
    first[new Circle({ players, rng: rngFrom(seed) }).impostor] += 1;
  }
  first.forEach((n, p) => {
    const share = n / runs;
    assert.ok(share > 0.13 && share < 0.27,
      `seat ${p} goes first ${(share * 100).toFixed(0)}% of the time`);
  });
});

// --- The rules hold ------------------------------------------------------

test('catching the impostor pays the people who actually pointed at them', () => {
  // Being carried by the rest of the table is not the same as having worked it
  // out, so a voter who named somebody else is paid nothing.
  const game = new Circle({ players: 4, rng: rngFrom(3) });
  const guilty = game.impostor;
  const innocent = (guilty + 1) % 4;
  while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
    if (game.phase === PHASE.HANDOFF) game.reveal(); else game.seen();
  }
  game.startVote();
  // Everybody names the impostor except one, who names somebody else. The
  // impostor has to vote for somebody, and cannot name themselves.
  while (game.phase === PHASE.VOTE) {
    const me = game.seat;
    if (me === guilty) game.vote(innocent);
    else if (me === innocent) game.vote((innocent + 2) % 4);
    else game.vote(guilty);
  }
  assert.equal(game.outcome.caught, true, 'the impostor was not caught');
  assert.equal(game.scores[innocent], 0, 'a voter who named the wrong person was paid');
  for (let p = 0; p < 4; p++) {
    if (p === guilty || p === innocent) continue;
    assert.equal(game.scores[p], CIRCLE_TUNING.pointsForCatching);
  }
});

test('a table that cannot agree has not accused anybody', () => {
  // A tie is not broken. Nobody was accused, so the impostor got away with it —
  // which is the honest reading, and it stops the game inventing a verdict
  // nobody voted for.
  const game = new Circle({ players: 4, rng: rngFrom(11) });
  while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
    if (game.phase === PHASE.HANDOFF) game.reveal(); else game.seen();
  }
  game.startVote();
  // Two votes each on two different people.
  game.vote(1); game.vote(0); game.vote(1); game.vote(0);
  assert.equal(game.accused(), -1, 'a tie produced an accusation');
  assert.equal(game.outcome.caught, false);
  assert.equal(game.scores[game.impostor], CIRCLE_TUNING.pointsForSurviving);
});

test('a caught impostor who names the word still takes something home', () => {
  const game = new Circle({ players: 3, rng: rngFrom(5) });
  const guilty = game.impostor;
  while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
    if (game.phase === PHASE.HANDOFF) game.reveal(); else game.seen();
  }
  game.startVote();
  while (game.phase === PHASE.VOTE) {
    game.vote(game.seat === guilty ? (guilty + 1) % 3 : guilty);
  }
  assert.equal(game.phase, PHASE.STEAL, 'a caught impostor was given no guess');
  const before = game.scores[guilty];
  // Spacing and case must not decide a round typed on a gamepad under pressure.
  assert.equal(game.steal(` ${game.tableWord.toLowerCase()} `), true);
  assert.equal(game.scores[guilty], before + CIRCLE_TUNING.pointsForStealing);
  assert.equal(game.phase, PHASE.RESULT);
});

// Deals the cards round so a test can get straight to the vote.
function toVote(game) {
  while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
    if (game.phase === PHASE.HANDOFF) game.reveal(); else game.seen();
  }
  game.startVote();
}

test('THE TABLE MAY NAME NOBODY, and then nobody is accused', () => {
  // Being made to accuse somebody every round meant a wrong guess was free and
  // a right one was a coin toss on a quiet round. A table that is not sure can
  // now say so.
  const game = new Circle({ players: 4, rng: rngFrom(7) });
  toVote(game);
  const guilty = game.impostor;
  while (game.phase === PHASE.VOTE) game.vote(SKIP);
  assert.equal(game.skips(), 4);
  assert.equal(game.accused(), -1);
  assert.equal(game.outcome.skipped, true);
  assert.equal(game.outcome.wrong, false);
  assert.equal(game.outcome.caught, false);
  // The impostor got away with it, and is paid as such. Nobody is punished for
  // an accusation nobody made.
  assert.equal(game.scores[guilty], CIRCLE_TUNING.pointsForSurviving);
  for (let p = 0; p < 4; p++) if (p !== guilty) assert.equal(game.scores[p], 0);
  assert.equal(game.phase, PHASE.RESULT, 'a skipped round offered a steal');
});

test('a skip is decided by the table, not by one voter', () => {
  // One abstention against three votes for the same name is an accusation.
  // Two abstentions against two votes is not: doubt wins the tie, because the
  // accusation is the thing that costs.
  const one = new Circle({ players: 4, rng: rngFrom(8) });
  toVote(one);
  const target = (one.seat + 1) % 4;
  for (let i = 0; i < 4; i++) {
    const me = one.seat;
    if (i === 0) one.vote(SKIP);
    else one.vote(me === target ? (target + 1) % 4 : target);
  }
  assert.equal(one.accused() === -1, false, 'one abstention overrode three votes');

  const two = new Circle({ players: 4, rng: rngFrom(8) });
  toVote(two);
  const named = (two.seat + 1) % 4;
  two.vote(SKIP);
  two.vote(two.seat === named ? (named + 1) % 4 : named);
  two.vote(SKIP);
  two.vote(two.seat === named ? (named + 1) % 4 : named);
  // Whichever way the seats fell, no name has more votes than there are skips.
  assert.equal(two.accused(), -1, 'a name with as many votes as nobody was accused anyway');
});

test('A WRONG ACCUSATION IS A LOSS FOR THE TABLE -- everybody but the impostor pays', () => {
  // This is what gives the impostor a way to win rather than merely a way to
  // not lose. Before it, a wrong guess cost nothing, so there was no reason not
  // to guess.
  const game = new Circle({ players: 4, rng: rngFrom(9) });
  toVote(game);
  const guilty = game.impostor;
  const innocent = (guilty + 1) % 4;
  while (game.phase === PHASE.VOTE) {
    // Everybody names the innocent; the innocent names somebody else.
    game.vote(game.seat === innocent ? (innocent + 1) % 4 : innocent);
  }
  assert.equal(game.outcome.wrong, true);
  assert.equal(game.outcome.accused, innocent);
  assert.equal(game.scores[guilty], CIRCLE_TUNING.pointsForSurviving);
  for (let p = 0; p < 4; p++) {
    if (p === guilty) continue;
    assert.equal(game.scores[p], -CIRCLE_TUNING.pointsLostForWrongAccusation,
      `player ${p} did not pay for the table's wrong accusation`);
  }
  // Including the innocent who voted for somebody else: the table accused
  // together, and "I pointed elsewhere" is not a defence.
  assert.equal(game.scores[innocent], -CIRCLE_TUNING.pointsLostForWrongAccusation);
  assert.equal(game.phase, PHASE.RESULT);
});

test('the three endings are told apart, and a tie is a skip rather than a wrong accusation', () => {
  const game = new Circle({ players: 4, rng: rngFrom(11) });
  toVote(game);
  game.vote(1); game.vote(0); game.vote(1); game.vote(0);
  assert.deepEqual(
    { caught: game.outcome.caught, wrong: game.outcome.wrong, skipped: game.outcome.skipped },
    { caught: false, wrong: false, skipped: true },
  );
  // Nobody paid for a tie.
  for (let p = 0; p < 4; p++) if (p !== game.impostor) assert.equal(game.scores[p], 0);
});

test('being the impostor is worth more than one vote, because there is one of you', () => {
  // Otherwise the round you are it is a round you simply lose, and a game where
  // a fifth of your turns are a write-off is a game people stop playing.
  assert.ok(CIRCLE_TUNING.pointsForSurviving > CIRCLE_TUNING.pointsForCatching);
  assert.ok(CIRCLE_TUNING.pointsForStealing < CIRCLE_TUNING.pointsForSurviving,
    'getting away with it should beat being caught and guessing');
});

test('nobody can vote for themselves, and a refused vote does not advance the turn', () => {
  // Always a misclick, and a vote nobody meant to cast decides rounds.
  const game = new Circle({ players: 4, rng: rngFrom(7) });
  while (game.phase === PHASE.HANDOFF || game.phase === PHASE.WORD) {
    if (game.phase === PHASE.HANDOFF) game.reveal(); else game.seen();
  }
  game.startVote();
  const seat = game.seat;
  assert.equal(game.vote(seat), false, 'a self-vote was accepted');
  assert.equal(game.seat, seat, 'a refused vote stole a turn');
  assert.equal(game.vote(99), false, 'a vote for nobody was accepted');
  assert.equal(game.seat, seat);
});

// --- The handoff ---------------------------------------------------------

test('THE SECRET IS NEVER ON SCREEN WHILE THE DEVICE IS MOVING', () => {
  // The moment most likely to confuse a table, and the one the design turns on:
  // the person about to look triggers the reveal themselves, so nobody ever has
  // to say "don't look yet". The state machine has to make that impossible
  // rather than merely discourage it.
  const game = new Circle({ players: 4, rng: rngFrom(2) });
  assert.equal(game.phase, PHASE.HANDOFF, 'a round did not start on a handoff card');

  // Nothing advances out of a handoff except the deliberate reveal.
  assert.equal(game.seen(), false, 'the word could be skipped past');
  assert.equal(game.startVote(), false, 'voting could start before anyone had looked');
  assert.equal(game.phase, PHASE.HANDOFF);

  assert.equal(game.reveal(), true);
  assert.equal(game.phase, PHASE.WORD);
  assert.equal(game.reveal(), false, 'revealing twice did something');

  // And every single seat gets its own handoff, not just the first.
  let handoffs = 1;
  while (game.phase !== PHASE.CLUES) {
    if (game.phase === PHASE.HANDOFF) { handoffs += 1; game.reveal(); } else game.seen();
  }
  assert.equal(handoffs, 4, 'somebody was handed the device with a word already showing');
});

// --- Housekeeping --------------------------------------------------------

test('tuning is data a test can override', () => {
  const near = new Circle({ players: 4, tuning: { difficulty: 'near' }, rng: rngFrom(1) });
  const pair = PAIRS.find((p) => (p.a === near.tableWord && p.b === near.impostorWord)
    || (p.b === near.tableWord && p.a === near.impostorWord));
  assert.ok(pair, 'the words came from outside the list');
  assert.equal(pair.near, true, 'the difficulty dial does nothing');
});

test('standings share a tie rather than inventing an order', () => {
  const game = new Circle({ players: 3, rng: rngFrom(4) });
  game.scores = [5, 5, 1];
  const rows = game.standings();
  assert.equal(rows[0].place, 1);
  assert.equal(rows[1].place, 1);
  assert.equal(rows[2].place, 3);
});

test('a caught impostor chooses between four plausible words, not four jokes', () => {
  // Typing a word on a gamepad with five people watching is a minute of nothing
  // happening. Four words and one button is the same decision in three seconds
  // — but only if the wrong three are worth considering.
  for (let seed = 1; seed <= 200; seed++) {
    const game = new Circle({ players: 4, rng: rngFrom(seed) });
    const options = game.stealOptions();
    assert.equal(options.length, 4, 'the wrong number of choices');
    assert.equal(new Set(options).size, 4, 'the same word appeared twice');
    assert.ok(options.includes(game.tableWord), 'the right answer was not among them');
    assert.ok(!options.includes(game.impostorWord),
      'the impostor was offered their own word, which gives the answer away');
  }
});
