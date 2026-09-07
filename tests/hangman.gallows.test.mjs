// tests/hangman.gallows.test.mjs
//
// Hangman has one way of being unfair, and it is not "the word was hard":
//
//   A WORD MUST BE SOLVABLE BY REASONING, not only by already knowing it.
//
// Given the revealed positions, the letters ruled out and the length, a player
// who thinks should get there inside the budget. If the only route to
// CHIMPANZEE is having CHIMPANZEE in mind beforehand, this is a quiz with a
// drawing attached.
//
// So the solver does what a thinking player does — keep every word still
// consistent with the board, guess the letter in most of them — and it is run
// over the whole lexicon at every tier.
//
// WHAT THE NUMBER MEANS, AND WHAT IT DOES NOT
// -------------------------------------------
// The solver reasons over the game's own word list. A person does not hold
// exactly these words, so this is NOT "x% of players will solve it". It is the
// stronger and more useful claim: THE INFORMATION ON THE BOARD IS SUFFICIENT.
// A word the solver cannot get is one where the board never narrowed enough,
// and that is the game's fault rather than the player's.
//
// The second bot checks the reverse. `frequency` guesses ETAOINSHRDLU in order
// and never looks at the board. If it did as well, reading the board would be
// worth nothing and this would be a slot machine with an alphabet.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHABET, BY_FREQUENCY, END, HINT, Run, TUNING, bestGuess, boardOf,
  candidates, categoryFree, matches, solveByFrequency, solveWord, tierForRound,
} from '../games/hangman/gallows.js';
import { CATEGORIES, WORDS, allWords, wordsFor } from '../games/hangman/words.js';
import { withSeed } from './helpers/seeded.mjs';

const POOL = allWords();

// --- The lexicon ----------------------------------------------------------

test('EVERY WORD IS SPELLABLE ON THE GRID', () => {
  // The letter grid has twenty-six keys. A word with a space, a hyphen or an
  // accent is a word the game can ask for and the player cannot type — which
  // on a gamepad, where the grid IS the only input, is unanswerable rather
  // than merely awkward.
  for (const [word, category, tier] of WORDS) {
    assert.match(word, /^[A-Z]+$/, `${word} is not spellable with A-Z`);
    assert.ok(word.length >= 3, `${word} is too short to be a puzzle`);
    assert.ok(CATEGORIES.includes(category), `${word} has an unknown category`);
    assert.ok(tier >= 0 && tier <= TUNING.maxTier, `${word} has tier ${tier}`);
  }
});

test('no word appears twice, and every tier and category has enough of them', () => {
  const seen = new Set();
  for (const [word] of WORDS) {
    assert.equal(seen.has(word), false, `${word} is in the list twice`);
    seen.add(word);
  }
  for (let tier = 0; tier <= TUNING.maxTier; tier++) {
    const count = WORDS.filter(([, , t]) => t === tier).length;
    assert.ok(count >= 20, `tier ${tier} has only ${count} words, so a run repeats itself`);
  }
  for (const category of CATEGORIES) {
    const count = WORDS.filter(([, c]) => c === category).length;
    assert.ok(count >= 8, `${category} has only ${count} words`);
  }
});

test('the lexicon opens up as a run goes on', () => {
  assert.equal(tierForRound(1), 0);
  assert.ok(tierForRound(30) > tierForRound(1));
  assert.equal(tierForRound(500), TUNING.maxTier);
  assert.ok(wordsFor(2).length > wordsFor(0).length, 'a deeper tier is not a bigger pool');
});

// --- Reasoning ------------------------------------------------------------

test('A GUESSED LETTER THAT DID NOT APPEAR HERE CANNOT BE HERE', () => {
  // The deduction most people make without noticing they are making it, and
  // the single thing that most improves the solver. If E has been guessed and
  // this position is still blank, the answer does not have E in this position.
  const guessed = new Set(['E']);
  const board = boardOf('APPLE', guessed);
  assert.equal(matches('APPLE', board.pattern, board.wrong, board.guessed), true);
  // GRAPE also ends in E and would fit on length alone — but position 2 is
  // blank and A is not guessed, so it survives; EAGLE does not, because its
  // first letter is a guessed E showing nowhere.
  assert.equal(matches('EAGLE', board.pattern, board.wrong, board.guessed), false);
});

test('a ruled-out letter rules out every word containing it', () => {
  const board = boardOf('CASTLE', new Set(['Z']));
  assert.equal(board.wrong.has('Z'), true);
  assert.equal(matches('BLIZZARD', board.pattern, board.wrong, board.guessed), false);
});

test('candidates narrow as the board fills in', () => {
  const wide = candidates(boardOf('PLANET', new Set()), POOL);
  const narrow = candidates(boardOf('PLANET', new Set(['P', 'L', 'E'])), POOL);
  assert.ok(narrow.length < wide.length, 'guessing three letters narrowed nothing');
  assert.ok(narrow.includes('PLANET'), 'the answer fell out of its own candidate set');
});

test('the best guess is the letter in most of what is left', () => {
  const board = boardOf('CHEESE', new Set());
  const pick = bestGuess(board, POOL);
  assert.ok(ALPHABET.includes(pick));
  assert.equal(board.guessed.has(pick), false, 'it suggested a letter already tried');
});

test('and it still suggests something when nothing is consistent', () => {
  // A word outside the pool leaves no candidates. A player with no idea still
  // has an idea, so the solver falls back to raw frequency rather than
  // stopping — otherwise a single odd word would hang the round.
  const board = boardOf('ZZZZZZ', new Set(['A']));
  const pick = bestGuess(board, POOL);
  assert.ok(BY_FREQUENCY.includes(pick));
});

// --- The two claims -------------------------------------------------------

test('EVERY WORD IN THE LEXICON IS SOLVABLE BY REASONING — the fairness claim', () => {
  const failures = [];
  let worst = 0;
  for (const [word] of WORDS) {
    const result = solveWord(word, POOL);
    if (!result.solved) failures.push(word);
    else worst = Math.max(worst, result.wrong);
  }
  assert.deepEqual(failures, [],
    'these words cannot be reasoned out inside the budget, however well you play');
  assert.ok(worst < TUNING.wrongAllowed,
    `the hardest word costs ${worst} wrong of ${TUNING.wrongAllowed} — no room to be human`);
});

test('and that holds tier by tier, so escalation does not break it', () => {
  for (let tier = 0; tier <= TUNING.maxTier; tier++) {
    const list = WORDS.filter(([, , t]) => t === tier).map(([w]) => w);
    const solved = list.filter((w) => solveWord(w, POOL).solved).length;
    assert.equal(solved, list.length,
      `tier ${tier}: only ${solved} of ${list.length} can be reasoned out`);
  }
});

test('READING THE BOARD IS WORTH IT — the depth claim', () => {
  // The two strategies differ in one thing: whether they look at what is
  // revealed. If the gap were small, the game would be a slot machine.
  let deduced = 0;
  let blind = 0;
  for (const [word] of WORDS) {
    if (solveWord(word, POOL).solved) deduced++;
    if (solveByFrequency(word).solved) blind++;
  }
  assert.ok(deduced > blind * 3,
    `reading the board bought little: ${deduced} solved against ${blind} guessing blind`);
});

// --- The round ------------------------------------------------------------

test('a hit reveals every copy of the letter, a miss costs a guess', () => {
  const run = new Run();
  run.word = 'BALLOON';
  run.guessed = new Set();
  run.wrong = 0;
  assert.equal(run.guess('L'), 'hit');
  assert.equal(run.pattern.filter((c) => c === 'L').length, 2, 'only one L was revealed');
  assert.equal(run.wrong, 0);
  assert.equal(run.guess('Z'), 'miss');
  assert.equal(run.wrong, 1);
});

test('the same letter twice is not a second mistake', () => {
  const run = new Run();
  run.word = 'CASTLE';
  run.guessed = new Set();
  run.wrong = 0;
  run.guess('Z');
  const after = run.wrong;
  assert.equal(run.guess('Z'), null, 'a repeat was accepted');
  assert.equal(run.wrong, after, 'a repeat cost a guess');
});

test('THE HINT COSTS A GUESS, which is what makes it a decision', () => {
  const run = new Run();
  run.word = 'PLANET';
  run.guessed = new Set();
  run.wrong = 0;
  run.categoryKnown = true;
  const before = run.guessesLeft;
  const result = run.hint(HINT.LETTER);
  assert.ok(result, 'the hint was refused with plenty of guesses left');
  assert.equal(run.guessesLeft, before - TUNING.hintCostsWrong, 'the hint was free');
  assert.ok(run.word.includes(result.letter), 'the hint revealed a letter not in the word');
  assert.equal(run.guessed.has(result.letter), true);
});

test('and it is refused when it would cost the round', () => {
  // A hint that kills you is not help. The last guess is yours to spend.
  const run = new Run();
  run.word = 'PLANET';
  run.guessed = new Set();
  run.wrong = TUNING.wrongAllowed - TUNING.hintCostsWrong;
  assert.equal(run.hint(HINT.LETTER), null, 'it sold help that would have ended the round');
});

test('THE CATEGORY GOES AWAY, and the same hint buys it back', () => {
  // The thing that changes how a run is played. Early rounds print the
  // category; later ones do not, and then the one hint button has two uses
  // competing for one price — which is worth more depends on the board.
  assert.equal(categoryFree(1), true);
  assert.equal(categoryFree(TUNING.categoryFreeUntil + 1), false);

  const run = new Run();
  run.round = TUNING.categoryFreeUntil + 1;
  run.word = 'PLANET';
  run.category = 'Science';
  run.categoryKnown = false;
  run.guessed = new Set();
  run.wrong = 0;

  const before = run.guessesLeft;
  const result = run.hint(HINT.CATEGORY);
  assert.equal(result.category, 'Science');
  assert.equal(run.categoryKnown, true);
  assert.equal(run.guessesLeft, before - TUNING.hintCostsWrong, 'the category was free');
  assert.equal(run.hint(HINT.CATEGORY), null, 'it sold the category twice');
});

test('solving a word scores it; failing one costs a life', () => {
  const run = new Run();
  run.word = 'CAT';
  run.guessed = new Set();
  run.wrong = 0;
  for (const ch of 'CAT') run.guess(ch);
  assert.equal(run.roundOver, 'won');
  assert.equal(run.score, 1);

  run.next();
  run.word = 'CAT';
  run.guessed = new Set();
  run.wrong = 0;
  const lives = run.lives;
  for (const ch of 'ZQXJVBW') run.guess(ch);
  assert.equal(run.roundOver, 'lost');
  assert.equal(run.lives, lives - 1);
});

test('the run ends when the lives are gone, for a stated reason', () => {
  const run = new Run();
  for (let i = 0; i < TUNING.lives; i++) {
    run.word = 'CAT';
    run.guessed = new Set();
    run.wrong = 0;
    run.roundOver = null;
    for (const ch of 'ZQXJVBW') run.guess(ch);
    run.next();
  }
  assert.equal(run.running, false);
  assert.equal(run.reason, END.OUT_OF_LIVES);
});

test('a run does not ask the same word twice', () => {
  withSeed(3, () => {
    const run = new Run();
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      assert.equal(seen.has(run.word), false, `${run.word} came round again`);
      seen.add(run.word);
      run.roundOver = 'won';
      run.next();
    }
  });
});

test('tuning is data a test can override', () => {
  // Convention 3. Squeeze the budget and words start becoming unsolvable —
  // which is exactly the failure the fairness test is there to catch.
  const mean = { ...TUNING, wrongAllowed: 1 };
  const failures = WORDS.filter(([w]) => !solveWord(w, POOL, mean).solved).length;
  assert.ok(failures > 0, 'a one-guess budget solved everything, so the budget is not live');
});
