// games/wavelength-lite/dial.js
//
// WAVELENGTH LITE — the whole game, with no canvas in it.
//
// THE RULE:
//
//   One of you sees a hidden spot on the dial and says a clue out loud.
//   Everybody else moves the pointer to where they think it is.
//
// The dial runs between two opposites — COLD to HOT, USELESS to ESSENTIAL — and
// the hidden spot is somewhere along it. The clue-giver cannot say a number and
// cannot say either end word; everything else is allowed, and the whole game is
// how well one person's idea of "quite warm" matches everybody else's.
//
// EVERYBODY GIVES A CLUE EXACTLY ONCE
// -----------------------------------
// One round per player, and the role is dealt round-robin over a shuffled order
// rather than rolled each time — the same construction as Impostor Circle, for
// the same reason. Fair by construction beats fair on average when a game is
// only five rounds long, and it gives the game a length nobody has to be told.
//
// WHY EVERYONE GUESSES SEPARATELY
// -------------------------------
// The board game this is lightened from has the table argue towards one shared
// guess. That is a good game and it needs a referee: somebody has to decide when
// the arguing is over, and on one screen with one pad that somebody is whoever
// is holding it. Guessing in turn removes the referee, gives everybody a score
// of their own, and keeps the arguing where it belongs — before the pad moves,
// not while somebody is trying to place it.
//
// The clue-giver is paid the AVERAGE of the guesses, so a clue that lands the
// whole table near the spot is worth more than one that lands one person on it.

/** The dial runs 0 to 100. Every number here is on that scale. */
export const DIAL_TUNING = {
  minPlayers: 3,
  maxPlayers: 6,

  // The scoring bands, as distance from the hidden spot.
  //
  // A HAND-SIZED BULLSEYE, DELIBERATELY. Four units out of a hundred is about a
  // fingertip on a phone and about a degree of thumb on a stick. It is meant to
  // be hit sometimes and missed often — see the hittability sweep in
  // tests/wavelength-lite.dial.test.mjs, which is convention 11: a window
  // nobody can hit is not difficulty, and neither is one nobody can miss.
  // MEASURED, NOT CHOSEN. The first set — 4/10/18 paying 4/3/2 — read fine
  // written down and was far too flat in practice: a rough guess scored 2.24
  // against a near-perfect 3.81, so playing well was worth about 70% more than
  // barely trying and the clue hardly mattered. Narrowing the outer bands and
  // dropping what they pay takes that to 2.3x while leaving the bullseye just
  // as reachable. See the sweep in the test file.
  bands: [
    { within: 4, points: 4 },
    { within: 9, points: 2 },
    { within: 16, points: 1 },
  ],

  // The hidden spot never sits where its widest band would run off the end.
  //
  // A spot at 3 is easier than a spot at 50 for a reason that has nothing to do
  // with the clue: half the ways to be wrong do not exist. Keeping the whole
  // scoring zone on the dial makes every round the same shape.
  margin: 16,

  // How far the pointer travels in a second at full stick. Slow enough to place
  // it on a four-wide band, fast enough to cross the dial in about two seconds.
  pointerSpeed: 55,
  // And the step a d-pad tap makes, for anybody without an analogue stick.
  pointerStep: 1,
};

/**
 * The spectrums. Two opposites and nothing in between, because everything in
 * between is the game.
 *
 * They are checked rather than trusted — see the test file. The failure that
 * matters is a pair that is not actually a spectrum ("CAT to DOG" has no
 * middle), because then there is nowhere for a hidden spot to be and the clue
 * cannot mean anything.
 */
export const SPECTRUMS = [
  { low: 'Cold', high: 'Hot' },
  { low: 'Useless', high: 'Essential' },
  { low: 'Quiet', high: 'Loud' },
  { low: 'Cheap', high: 'Expensive' },
  { low: 'Forgettable', high: 'Unforgettable' },
  { low: 'Underrated', high: 'Overrated' },
  { low: 'Boring job', high: 'Exciting job' },
  { low: 'Bad habit', high: 'Good habit' },
  { low: 'Rough', high: 'Smooth' },
  { low: 'Temporary', high: 'Permanent' },
  { low: 'Easy to fix', high: 'Impossible to fix' },
  { low: 'Silly', high: 'Serious' },
  { low: 'Common', high: 'Rare' },
  { low: 'Weak smell', high: 'Strong smell' },
  { low: 'Safe', high: 'Dangerous' },
  { low: 'Ugly', high: 'Beautiful' },
  { low: 'Slow', high: 'Fast' },
  { low: 'Guilty pleasure', high: 'Respectable taste' },
  { low: 'Waste of money', high: 'Worth every penny' },
  { low: 'Simple', high: 'Complicated' },
  { low: 'Indoors', high: 'Outdoors' },
  { low: 'Modern', high: 'Old-fashioned' },
  { low: 'Rude', high: 'Polite' },
  { low: 'A snack', high: 'A meal' },
  { low: 'Fantasy', high: 'Realistic' },
  { low: 'Hard to explain', high: 'Easy to explain' },
  { low: 'Unhealthy', high: 'Healthy' },
  { low: 'Everyday word', high: 'Rare word' },
  { low: 'Worst chore', high: 'Best chore' },
  { low: 'Bad advice', high: 'Good advice' },
  { low: 'Would not miss it', high: 'Could not live without it' },
  { low: 'Too early', high: 'Too late' },
  { low: 'A hobby', high: 'An obsession' },
  { low: 'Overpriced', high: 'A bargain' },
  { low: 'Awkward', high: 'Comfortable' },
  { low: 'A want', high: 'A need' },
  { low: 'Bad film', high: 'Good film' },
  { low: 'Light', high: 'Heavy' },
  { low: 'Private', high: 'Public' },
  { low: 'Beginner', high: 'Expert' },
];

export const PHASE = {
  HANDOFF: 'handoff',   // "Player Three — press A when you are holding it"
  SECRET: 'secret',     // the dial, with the spot on it, for one pair of eyes
  CLUE: 'clue',         // the clue-giver says it out loud; the dial is hidden
  GUESS: 'guess',       // each other player in turn, with their own handoff
  RESULT: 'result',
  OVER: 'over',
};

function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** What a guess at `at` is worth against a spot at `target`. */
export function scoreFor(at, target, tuning = DIAL_TUNING) {
  const t = { ...DIAL_TUNING, ...tuning };
  const distance = Math.abs(at - target);
  for (const band of t.bands) if (distance <= band.within) return band.points;
  return 0;
}

/** The widest band, which is what `margin` has to keep on the dial. */
export function widestBand(tuning = DIAL_TUNING) {
  const t = { ...DIAL_TUNING, ...tuning };
  return Math.max(...t.bands.map((b) => b.within));
}

export class Dial {
  #rng;
  #tuning;
  #order;
  #deck;

  constructor({ players = 4, tuning = DIAL_TUNING, rng = Math.random } = {}) {
    this.#tuning = tuning === DIAL_TUNING ? tuning : { ...DIAL_TUNING, ...tuning };
    this.#rng = rng;
    this.players = players;
    this.scores = new Array(players).fill(0);

    const seats = [];
    for (let p = 0; p < players; p++) seats.push(p);
    this.#order = shuffled(seats, rng);
    this.#deck = shuffled(SPECTRUMS, rng);

    this.round = -1;
    this.phase = PHASE.OVER;
    this.nextRound();
  }

  get rounds() { return this.players; }
  get tuning() { return this.#tuning; }
  /** Whose turn it is to see the spot and give the clue. */
  get psychic() { return this.#order[this.round]; }

  /** The seats that guess this round, in order, skipping the clue-giver. */
  get guessers() {
    const out = [];
    for (let p = 0; p < this.players; p++) if (p !== this.psychic) out.push(p);
    return out;
  }

  nextRound() {
    this.round += 1;
    if (this.round >= this.rounds) {
      this.phase = PHASE.OVER;
      return false;
    }
    this.spectrum = this.#deck[this.round % this.#deck.length];

    // Never where the widest band would run off the end: a spot at 3 is easier
    // than a spot at 50 for reasons that have nothing to do with the clue.
    const m = this.#tuning.margin;
    this.target = m + this.#rng() * (100 - m * 2);

    this.guesses = new Array(this.players).fill(null);
    this.seat = 0;                     // index into guessers, during GUESS
    this.phase = PHASE.HANDOFF;
    this.outcome = null;
    return true;
  }

  /** Who the current handoff card is addressed to. */
  get holder() {
    if (this.phase === PHASE.HANDOFF) return this.psychic;
    return this.guessers[this.seat] ?? this.psychic;
  }

  /**
   * The card is in the right hands: show the spot.
   *
   * Split from `hide()` for the same reason Impostor Circle splits its reveal:
   * nothing secret is on screen until the person about to read it presses the
   * button themselves, so the device can cross a table with the round already
   * dealt and nobody has to say "don't look yet".
   */
  reveal() {
    if (this.phase !== PHASE.HANDOFF) return false;
    this.phase = PHASE.SECRET;
    return true;
  }

  /** Seen it. The dial goes away and the talking starts. */
  hide() {
    if (this.phase !== PHASE.SECRET) return false;
    this.phase = PHASE.CLUE;
    return true;
  }

  /** The clue has been said; start guessing. */
  startGuessing() {
    if (this.phase !== PHASE.CLUE) return false;
    this.seat = 0;
    this.phase = PHASE.GUESS;
    return true;
  }

  /**
   * One guess. Returns true while there are more to come.
   *
   * Clamped rather than refused: a pointer driven off the end is a pointer at
   * the end, which is a real answer, and refusing it would leave a player
   * pressing a button that does nothing.
   */
  guess(at) {
    if (this.phase !== PHASE.GUESS) return false;
    const who = this.guessers[this.seat];
    this.guesses[who] = Math.min(100, Math.max(0, at));
    this.seat += 1;
    if (this.seat < this.guessers.length) return true;
    this.#settle();
    return false;
  }

  #settle() {
    const scored = [];
    for (const who of this.guessers) {
      const points = scoreFor(this.guesses[who], this.target, this.#tuning);
      this.scores[who] += points;
      scored.push({ player: who, at: this.guesses[who], points });
    }
    // The clue-giver is paid the AVERAGE, so a clue that lands the whole table
    // near the spot beats one that lands a single person on it. That is the
    // difference between a good clue and a lucky one, and it is the only thing
    // the clue-giver can influence.
    const mean = scored.reduce((sum, g) => sum + g.points, 0) / scored.length;
    const forClue = Math.round(mean);
    this.scores[this.psychic] += forClue;
    this.outcome = { scored, forClue, target: this.target };
    this.phase = PHASE.RESULT;
  }

  /** Final placings. Ties share. */
  standings() {
    const rows = this.scores.map((score, player) => ({ player, score }));
    rows.sort((a, b) => b.score - a.score);
    let place = 1;
    rows.forEach((row, i) => {
      if (i > 0 && rows[i - 1].score !== row.score) place = i + 1;
      row.place = place;
    });
    return rows;
  }
}
