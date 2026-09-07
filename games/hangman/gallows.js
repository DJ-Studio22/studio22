// games/hangman/gallows.js
//
// Hangman's simulation: the round, the run, the hint economy, and the solver
// that proves a word can be reasoned out rather than merely known. No canvas,
// no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// Hangman has exactly one way of being unfair, and it is not "the word was
// hard". It is this:
//
//   A WORD MUST BE SOLVABLE BY REASONING, not only by already knowing it.
//
// Given the revealed positions, the letters already ruled out, and the length,
// a player who thinks should be able to get there inside the guess budget. If
// the only route to CHIMPANZEE is having CHIMPANZEE in mind before you start,
// the game is a quiz with a drawing attached.
//
// So there is a solver, and it does what a thinking player does: keep every
// word still consistent with what is on the board, and guess the letter that
// appears in most of them. tests/hangman.gallows.test.mjs runs it over the
// whole lexicon at every tier and requires it to win.
//
// WHAT THE SOLVER IS AND IS NOT
// -----------------------------
// It reasons over THIS FILE'S OWN WORD LIST, which is the honest proxy for a
// player's mental lexicon and should be stated rather than glossed. A person
// does not hold exactly these words, so the number is not "x% of players will
// solve it". It is the stronger and more useful claim: the information on the
// board is sufficient. Anything the solver cannot get is a word where the
// board never narrowed enough, and that is the game's fault rather than the
// player's.
//
// The second bot exists to check the reverse. `frequency` guesses ETAOINSHRDLU
// in order and never looks at the board at all. If it did as well as the
// deducer, then reading the board would be worth nothing and the game would be
// a slot machine with an alphabet.

import { CATEGORIES, WORDS, wordsFor } from './words.js';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// English letter frequency, commonest first. Used by the weaker bot, and by
// the hint when it has nothing better to go on.
export const BY_FREQUENCY = 'ETAOINSHRDLCUMWFGYPBVKJXQZ'.split('');

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // Wrong guesses allowed on a word. Six is the traditional figure and it is
  // traditional for a reason: it is the number the solver needs on a hard word
  // with a little to spare, which the test asserts rather than assumes.
  wrongAllowed: 6,

  // Rounds you can lose before the run ends.
  lives: 3,

  // How the lexicon opens up. Tier 0 is short and common; tier 2 is long or
  // awkward. Escalation is a property of the word list rather than a
  // multiplier bolted onto it.
  tierEvery: 5,        // one tier deeper every this many rounds
  maxTier: 2,

  // THE HINT, AND WHAT IT COSTS.
  //
  // A hint that is free is not a decision. This one is paid for in the only
  // currency the round has: one of your wrong guesses. So asking for help
  // brings the gallows a step closer, and a player weighs "I could work this
  // out with four guesses left" against "I could know a letter and have
  // three".
  hintCostsWrong: 1,

  // WHAT CHANGES AS A RUN GOES ON.
  //
  // Up to this round the category is printed. After it the word arrives
  // unlabelled, and the same hint button will buy the category back — for the
  // same price as a letter. That is the interesting version of the hint
  // economy: two different kinds of help competing for one cost, and which is
  // worth more depends on the board in front of you.
  categoryFreeUntil: 4,
};

export const END = { OUT_OF_LIVES: 'Out of lives' };

export const HINT = { LETTER: 'letter', CATEGORY: 'category' };

/** How deep into the lexicon a round reaches. */
export const tierForRound = (round, t = TUNING) =>
  Math.min(t.maxTier, Math.floor((round - 1) / t.tierEvery));

/** Is the category shown for free this round? */
export const categoryFree = (round, t = TUNING) => round <= t.categoryFreeUntil;

// --- The board ------------------------------------------------------------

/**
 * What a guesser can see: the revealed pattern and the letters ruled out.
 *
 * A plain object rather than a class because the solver builds hypothetical
 * ones, and because it is exactly the information the screen shows — if the
 * solver could see more than this, the fairness claim would be a lie.
 */
export function boardOf(word, guessed) {
  const pattern = word.split('').map((ch) => (guessed.has(ch) ? ch : null));
  const wrong = [...guessed].filter((ch) => !word.includes(ch));
  return { pattern, wrong: new Set(wrong), guessed: new Set(guessed) };
}

/** Does this word fit the pattern and avoid every ruled-out letter? */
export function matches(candidate, pattern, wrong, guessed) {
  if (candidate.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const shown = pattern[i];
    if (shown !== null) {
      if (candidate[i] !== shown) return false;
    } else if (guessed.has(candidate[i])) {
      // A letter already guessed and NOT shown here cannot be here. This is
      // the deduction most people make without noticing they are making it,
      // and leaving it out makes the solver markedly worse.
      return false;
    }
  }
  for (const ch of wrong) if (candidate.includes(ch)) return false;
  return true;
}

/** Every word still consistent with the board. */
export function candidates(board, pool) {
  return pool.filter((w) => matches(w, board.pattern, board.wrong, board.guessed));
}

/**
 * The letter a thinking player would try next.
 *
 * Whichever unguessed letter appears in the most remaining candidates: the
 * guess most likely to be right, and the one that cuts the field hardest when
 * it is wrong. When nothing is left consistent — which happens when the pool
 * does not contain the word — it falls back to raw frequency, because a player
 * with no idea still has an idea.
 */
export function bestGuess(board, pool) {
  const live = candidates(board, pool);
  if (live.length) {
    const score = new Map();
    for (const word of live) {
      for (const ch of new Set(word)) {
        if (board.guessed.has(ch)) continue;
        score.set(ch, (score.get(ch) ?? 0) + 1);
      }
    }
    let best = null;
    for (const [ch, n] of score) {
      if (!best || n > best.n || (n === best.n && BY_FREQUENCY.indexOf(ch) < BY_FREQUENCY.indexOf(best.ch))) {
        best = { ch, n };
      }
    }
    if (best) return best.ch;
  }
  return BY_FREQUENCY.find((ch) => !board.guessed.has(ch)) ?? null;
}

/**
 * Play a whole word out with the deducing strategy and report what it cost.
 *
 * Returns { solved, wrong, guesses }. This is the fairness measurement, and it
 * is the function the test drives over every word in the lexicon.
 */
export function solveWord(word, pool, t = TUNING) {
  const guessed = new Set();
  let wrong = 0;
  const order = [];

  while (wrong <= t.wrongAllowed) {
    const board = boardOf(word, guessed);
    if (board.pattern.every((ch) => ch !== null)) {
      return { solved: true, wrong, guesses: order };
    }
    const pick = bestGuess(board, pool);
    if (pick === null) break;
    guessed.add(pick);
    order.push(pick);
    if (!word.includes(pick)) wrong++;
  }
  return { solved: false, wrong, guesses: order };
}

/** The same, guessing straight down the frequency table and never looking. */
export function solveByFrequency(word, t = TUNING) {
  const guessed = new Set();
  let wrong = 0;
  for (const ch of BY_FREQUENCY) {
    if (wrong > t.wrongAllowed) break;
    guessed.add(ch);
    if (!word.includes(ch)) wrong++;
    if (word.split('').every((c) => guessed.has(c))) {
      return { solved: wrong <= t.wrongAllowed, wrong };
    }
  }
  return { solved: false, wrong };
}

// --- The run --------------------------------------------------------------

let dealt = [];

/** Pick a word for this round, avoiding anything already used in the run. */
function drawWord(round, used, t = TUNING) {
  const tier = tierForRound(round, t);
  const pool = wordsFor(tier).filter(([word]) => !used.has(word));
  const from = pool.length ? pool : wordsFor(tier);
  return from[(Math.random() * from.length) | 0];
}

/**
 * One run: rounds until the lives are gone.
 *
 * `guess(letter)` and `hint(kind)` are the whole game; game.js only draws what
 * this says is true.
 */
export class Run {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    this.round = 1;
    this.solved = 0;
    this.lives = this.t.lives;
    this.running = true;
    this.reason = null;
    this.used = new Set();
    this.hintsUsed = 0;
    this.lastRound = null;
    this.#deal();
  }

  #deal() {
    const [word, category, tier] = drawWord(this.round, this.used, this.t);
    this.used.add(word);
    this.word = word;
    this.category = category;
    this.tier = tier;
    this.guessed = new Set();
    this.wrong = 0;
    this.revealedByHint = new Set();
    this.categoryKnown = categoryFree(this.round, this.t);
    this.roundOver = null;   // 'won' | 'lost' once decided
  }

  get pattern() {
    return this.word.split('').map((ch) => (this.guessed.has(ch) ? ch : null));
  }

  get wrongLetters() {
    return [...this.guessed].filter((ch) => !this.word.includes(ch));
  }

  get guessesLeft() { return this.t.wrongAllowed - this.wrong; }

  get board() { return boardOf(this.word, this.guessed); }

  /** Letters still worth pressing. */
  get available() { return ALPHABET.filter((ch) => !this.guessed.has(ch)); }

  /**
   * Guess a letter. Returns 'hit', 'miss', 'won', 'lost', or null if the
   * letter was already tried or the round is over.
   */
  guess(letter) {
    if (!this.running || this.roundOver) return null;
    const ch = String(letter || '').toUpperCase();
    if (!ALPHABET.includes(ch) || this.guessed.has(ch)) return null;

    this.guessed.add(ch);
    const hit = this.word.includes(ch);
    if (!hit) this.wrong++;

    if (this.pattern.every((c) => c !== null)) return this.#winRound();
    if (this.wrong > this.t.wrongAllowed) return this.#loseRound();
    return hit ? 'hit' : 'miss';
  }

  /**
   * Ask for help, and pay for it with a guess.
   *
   * LETTER reveals one letter that is actually in the word. CATEGORY buys back
   * the label the later rounds withhold. Both cost the same, which is the
   * whole point: on a board where you already half-see the shape, the category
   * is worth more than another letter, and on a blank one it is worth less.
   */
  hint(kind = HINT.LETTER) {
    if (!this.running || this.roundOver) return null;
    if (this.guessesLeft <= this.t.hintCostsWrong) return null;

    if (kind === HINT.CATEGORY) {
      if (this.categoryKnown) return null;
      this.categoryKnown = true;
      this.wrong += this.t.hintCostsWrong;
      this.hintsUsed++;
      return { kind, category: this.category };
    }

    const hidden = this.word.split('').filter((ch) => !this.guessed.has(ch));
    if (!hidden.length) return null;
    // The commonest hidden letter, so a hint is worth the guess it costs.
    const counts = new Map();
    for (const ch of hidden) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    let pick = hidden[0];
    for (const [ch, n] of counts) {
      if (n > (counts.get(pick) ?? 0)) pick = ch;
    }

    this.guessed.add(pick);
    this.revealedByHint.add(pick);
    this.wrong += this.t.hintCostsWrong;
    this.hintsUsed++;

    if (this.pattern.every((c) => c !== null)) return this.#winRound(kind, pick);
    if (this.wrong > this.t.wrongAllowed) return this.#loseRound();
    return { kind, letter: pick };
  }

  #winRound() {
    this.roundOver = 'won';
    this.solved++;
    this.lastRound = { word: this.word, won: true, wrong: this.wrong };
    return 'won';
  }

  #loseRound() {
    this.roundOver = 'lost';
    this.lives--;
    this.lastRound = { word: this.word, won: false, wrong: this.wrong };
    if (this.lives <= 0) {
      this.running = false;
      this.reason = END.OUT_OF_LIVES;
    }
    return 'lost';
  }

  /** Move on after a finished round. */
  next() {
    if (!this.roundOver) return false;
    if (!this.running) return false;
    this.round++;
    this.#deal();
    return true;
  }

  /** Words solved — the score. */
  get score() { return this.solved; }
}

export { CATEGORIES, WORDS, wordsFor, dealt };
