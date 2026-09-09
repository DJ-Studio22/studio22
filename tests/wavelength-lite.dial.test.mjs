// tests/wavelength-lite.dial.test.mjs
//
// Wavelength Lite's difficulty is two things: the width of the scoring bands
// and the quality of the spectrums. Both are data, and both are walked here.
//
// The band widths get the treatment convention 11 exists for. A four-wide
// bullseye out of a hundred sounds fine written down; whether a person can
// actually land on it is a different question, and "is there a way to score" and
// "how much room is there to be wrong" are not the same question. So a fan of
// human-shaped guessers is swept, and a real share of them has to get through.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIAL_TUNING,
  Dial,
  PHASE,
  SPECTRUMS,
  scoreFor,
  widestBand,
} from '../games/wavelength-lite/dial.js';

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, so a "guesser who is roughly right" is roughly right normally. */
function gaussian(rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const TABLES = [3, 4, 5, 6];

function playOnce(players, guessAt, { tuning, seed = 1 } = {}) {
  const game = new Dial({ players, tuning, rng: rngFrom(seed) });
  const rounds = [];
  while (game.phase !== PHASE.OVER) {
    game.reveal();
    game.hide();
    game.startGuessing();
    while (game.phase === PHASE.GUESS) game.guess(guessAt(game));
    rounds.push({ psychic: game.psychic, ...game.outcome });
    game.nextRound();
  }
  return { game, rounds };
}

// --- The spectrums -------------------------------------------------------

test('every spectrum is two ends of the same thing', () => {
  const seen = new Set();
  for (const s of SPECTRUMS) {
    assert.ok(s.low && s.high, 'a spectrum is missing an end');
    assert.notEqual(s.low.toLowerCase(), s.high.toLowerCase(), `${s.low} against itself`);
    const key = [s.low.toLowerCase(), s.high.toLowerCase()].sort().join('|');
    assert.ok(!seen.has(key), `${key} appears twice`);
    seen.add(key);
    // Short enough to read across a room at the ends of a dial.
    assert.ok(s.low.length <= 26 && s.high.length <= 26,
      `"${s.low}" / "${s.high}" is too long to sit at the end of a dial`);
  }
});

test('there are enough spectrums that an evening does not repeat one', () => {
  // Dealt without replacement and a game is at most six rounds, so six is the
  // floor. The real floor is higher: a group playing several games should not
  // keep meeting the same dial.
  assert.ok(SPECTRUMS.length >= DIAL_TUNING.maxPlayers * 5,
    `only ${SPECTRUMS.length} spectrums, which is barely an evening`);
});

// --- The bands -----------------------------------------------------------

test('THE BULLSEYE IS SOMETHING A PERSON CAN ACTUALLY HIT', () => {
  // Convention 11. A fan of human-shaped guessers: each one hears the clue and
  // forms a belief that is the true spot plus some error, and `spread` is how
  // good the clue was. The requirement is a real GRADIENT — a good clue has to
  // pay much better than a poor one — and that even a rough guess is not
  // hopeless, or nobody would bother moving the pointer.
  const rng = rngFrom(99);
  const runs = 4000;
  const results = {};
  for (const spread of [3, 8, 15, 30]) {
    let points = 0;
    let bullseyes = 0;
    for (let i = 0; i < runs; i++) {
      const target = DIAL_TUNING.margin + rng() * (100 - DIAL_TUNING.margin * 2);
      const at = Math.min(100, Math.max(0, target + gaussian(rng) * spread));
      const score = scoreFor(at, target);
      points += score;
      if (score === 4) bullseyes += 1;
    }
    results[spread] = { mean: points / runs, bulls: bullseyes / runs };
  }

  // A clue good enough to put people within a few units lands the bullseye
  // often enough to feel like the point of the game...
  assert.ok(results[3].bulls > 0.5,
    `a very good clue only hits the bullseye ${(results[3].bulls * 100).toFixed(0)}% of the time`);
  // ...but not so often that missing it is a surprise.
  assert.ok(results[8].bulls < 0.5 && results[8].bulls > 0.15,
    `a decent clue hits the bullseye ${(results[8].bulls * 100).toFixed(0)}% of the time`);
  // A rough guess still scores something most of the time, so a bad round is a
  // low score rather than a blank.
  assert.ok(results[15].mean > 1.2,
    `a rough guess averages ${results[15].mean.toFixed(2)}, which is close to nothing`);
  // And the gradient is real: better clues are worth markedly more.
  assert.ok(results[3].mean > results[15].mean * 1.8,
    'a very good clue is barely worth more than a rough one');
  assert.ok(results[15].mean > results[30].mean * 1.4,
    'a rough guess is barely worth more than a wild one');
});

test('the hidden spot is never where its own scoring zone falls off the dial', () => {
  // A spot at 3 is easier than a spot at 50 for reasons that have nothing to do
  // with the clue: half the ways to be wrong do not exist.
  const widest = widestBand();
  for (let seed = 1; seed <= 400; seed++) {
    const game = new Dial({ players: 4, rng: rngFrom(seed) });
    while (game.phase !== PHASE.OVER) {
      assert.ok(game.target - widest >= 0, `spot at ${game.target.toFixed(1)} runs off the low end`);
      assert.ok(game.target + widest <= 100, `spot at ${game.target.toFixed(1)} runs off the high end`);
      game.reveal(); game.hide(); game.startGuessing();
      while (game.phase === PHASE.GUESS) game.guess(50);
      game.nextRound();
    }
  }
});

test('the bands are ordered, and being further away is never worth more', () => {
  // An assertion about the shape of the rule rather than about its numbers, so
  // retuning the bands cannot quietly make the middle of the dial the best
  // place to be.
  let last = 5;
  for (const band of DIAL_TUNING.bands) {
    assert.ok(band.points < last, 'a further band pays more than a nearer one');
    last = band.points;
  }
  for (let d = 0; d < 40; d++) {
    assert.ok(scoreFor(50 + d, 50) >= scoreFor(50 + d + 1, 50),
      `moving from ${d} to ${d + 1} away scored more`);
  }
  assert.equal(scoreFor(50, 50), 4);
  assert.equal(scoreFor(99, 50), 0);
});

test('the pointer can be placed finely enough to use the bullseye', () => {
  // A pointer that steps coarser than the bullseye is wide cannot land on it,
  // which would make the top band decoration. This is the same class of fault
  // as a slide window narrower than the thing sliding.
  const bull = DIAL_TUNING.bands[0].within;
  assert.ok(DIAL_TUNING.pointerStep <= bull / 2,
    `a d-pad tap moves ${DIAL_TUNING.pointerStep} into a ${bull * 2}-wide bullseye`);
  // And a full sweep of the dial should take a second or two, not ten.
  const sweep = 100 / DIAL_TUNING.pointerSpeed;
  assert.ok(sweep > 1 && sweep < 4, `crossing the dial takes ${sweep.toFixed(1)}s`);
});

// --- Fair by construction ------------------------------------------------

test('EVERYBODY GIVES A CLUE EXACTLY ONCE', () => {
  for (const players of TABLES) {
    for (let seed = 1; seed <= 60; seed++) {
      const { rounds } = playOnce(players, () => 50, { seed });
      assert.equal(rounds.length, players);
      const gave = rounds.map((r) => r.psychic).sort((a, b) => a - b);
      assert.deepEqual(gave, [...Array(players).keys()],
        `at ${players} players somebody gave two clues`);
    }
  }
});

test('and everybody else guesses, exactly once, every round', () => {
  for (const players of TABLES) {
    const game = new Dial({ players, rng: rngFrom(players) });
    while (game.phase !== PHASE.OVER) {
      assert.equal(game.guessers.length, players - 1);
      assert.ok(!game.guessers.includes(game.psychic), 'the clue-giver was asked to guess');
      game.reveal(); game.hide(); game.startGuessing();
      let n = 0;
      while (game.phase === PHASE.GUESS) { game.guess(40 + n * 3); n += 1; }
      assert.equal(n, players - 1);
      assert.equal(game.guesses[game.psychic], null, 'the clue-giver recorded a guess');
      game.nextRound();
    }
  }
});

// --- The scoring holds ---------------------------------------------------

test('a good clue pays the clue-giver more than a lucky one', () => {
  // The clue-giver is paid the AVERAGE of the guesses, which is the whole
  // difference between a clue that lands the table and one that lands one
  // person. Built by hand so it says what the rule IS.
  const everyoneClose = new Dial({ players: 4, rng: rngFrom(2) });
  everyoneClose.reveal(); everyoneClose.hide(); everyoneClose.startGuessing();
  while (everyoneClose.phase === PHASE.GUESS) everyoneClose.guess(everyoneClose.target);
  const forLanding = everyoneClose.outcome.forClue;

  const oneLucky = new Dial({ players: 4, rng: rngFrom(2) });
  oneLucky.reveal(); oneLucky.hide(); oneLucky.startGuessing();
  let first = true;
  while (oneLucky.phase === PHASE.GUESS) {
    oneLucky.guess(first ? oneLucky.target : 2);
    first = false;
  }
  assert.ok(forLanding > oneLucky.outcome.forClue,
    'landing the whole table is worth no more than landing one person');
  assert.equal(forLanding, 4, 'a perfect round did not pay the clue-giver full marks');
});

test('a pointer driven off the end is a pointer at the end', () => {
  // Clamped rather than refused: running off the end is a real answer, and
  // refusing it leaves somebody pressing a button that does nothing.
  const game = new Dial({ players: 3, rng: rngFrom(8) });
  game.reveal(); game.hide(); game.startGuessing();
  game.guess(-40);
  game.guess(9999);
  const [a, b] = game.guessers;
  assert.equal(game.guesses[a], 0);
  assert.equal(game.guesses[b], 100);
});

// --- The handoff ---------------------------------------------------------

test('THE SPOT IS NEVER ON SCREEN WHILE THE DEVICE IS MOVING', () => {
  // Same rule and same enforcement as Impostor Circle: the person about to look
  // presses the button themselves, and the state machine refuses every other
  // way out of a handoff card. Two party games that hand a device round should
  // do it identically, so learning one teaches the other.
  const game = new Dial({ players: 4, rng: rngFrom(3) });
  assert.equal(game.phase, PHASE.HANDOFF, 'a round did not start on a handoff card');
  assert.equal(game.holder, game.psychic, 'the card was addressed to the wrong person');

  assert.equal(game.hide(), false, 'the spot could be skipped past');
  assert.equal(game.startGuessing(), false, 'guessing could start before the clue');
  assert.equal(game.phase, PHASE.HANDOFF);

  assert.equal(game.reveal(), true);
  assert.equal(game.phase, PHASE.SECRET);
  assert.equal(game.reveal(), false, 'revealing twice did something');
});

// --- Housekeeping --------------------------------------------------------

test('tuning is data a test can override', () => {
  const wide = { ...DIAL_TUNING, bands: [{ within: 25, points: 4 }] };
  assert.equal(scoreFor(70, 50, wide), 4, 'the band dial does nothing');
  assert.equal(scoreFor(70, 50), 0);
  const tight = new Dial({ players: 3, tuning: { margin: 45 }, rng: rngFrom(1) });
  assert.ok(tight.target >= 45 && tight.target <= 55, 'the margin dial does nothing');
});

test('standings share a tie rather than inventing an order', () => {
  const game = new Dial({ players: 3, rng: rngFrom(6) });
  game.scores = [9, 4, 9];
  const rows = game.standings();
  assert.equal(rows[0].place, 1);
  assert.equal(rows[1].place, 1);
  assert.equal(rows[2].place, 3);
});
