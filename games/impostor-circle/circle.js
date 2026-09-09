// games/impostor-circle/circle.js
//
// IMPOSTOR CIRCLE — the whole game, with no canvas in it.
//
// THE RULE:
//
//   Everyone gets the same word except one person, who gets a different one.
//   Say a clue each, then vote for whoever you think is the odd one out.
//
// Nobody is told who the impostor is, INCLUDING THE IMPOSTOR. They see a word
// and it looks exactly like everybody else's card, so they find out they are the
// odd one out the same way everyone else does: by listening. That is deliberate
// and it is the single most important thing about the design, because a player
// who knows they are lying behaves like a player who knows they are lying, and
// everybody at the table can see it. Not knowing makes the first clue honest and
// the second one frightened.
//
// WHY EVERY PLAYER IS THE IMPOSTOR EXACTLY ONCE
// ---------------------------------------------
// A round has as many rounds as there are players, and the impostor role is
// dealt round-robin over a shuffled order rather than rolled each time. So it is
// fair BY CONSTRUCTION rather than fair on average: nobody spends a whole game
// never having been it, and nobody is it three times out of four and feels
// picked on. It also means the game has a natural length nobody has to be told.
//
// THE WORD PAIRS ARE THE DIFFICULTY, AND THEY ARE A CLAIM
// -------------------------------------------------------
// A pair that is too far apart (BANANA / SUBMARINE) gives the impostor away on
// their first word and there is no game. A pair that is too close (SOFA /
// COUCH) means every clue fits both and the vote is a coin toss. Both failures
// are properties of the LIST, so the list is data and a test walks all of it —
// see tests/impostor-circle.circle.test.mjs.

/**
 * The word pairs, grouped so a pair is always two things of the same kind.
 *
 * `near` pairs share a category and most of their obvious clues; `far` pairs
 * share a category and little else. The distance is the difficulty dial, and it
 * is the only one — there is no timer to shorten and no score to weight.
 */
export const PAIRS = [
  // --- near: the same sort of thing, and most clues fit both ---------------
  { a: 'COFFEE', b: 'TEA', of: 'drinks', near: true },
  { a: 'VIOLIN', b: 'CELLO', of: 'instruments', near: true },
  { a: 'CASTLE', b: 'PALACE', of: 'buildings', near: true },
  { a: 'RIVER', b: 'CANAL', of: 'water', near: true },
  { a: 'JACKET', b: 'COAT', of: 'clothes', near: true },
  { a: 'PIRATE', b: 'SAILOR', of: 'people at sea', near: true },
  { a: 'CROW', b: 'RAVEN', of: 'birds', near: true },
  { a: 'BISCUIT', b: 'SCONE', of: 'baking', near: true },
  { a: 'TRUMPET', b: 'TROMBONE', of: 'instruments', near: true },
  { a: 'HOTEL', b: 'HOSTEL', of: 'places to stay', near: true },
  { a: 'FOG', b: 'MIST', of: 'weather', near: true },
  { a: 'LIBRARY', b: 'BOOKSHOP', of: 'places with books', near: true },
  { a: 'PUDDLE', b: 'POND', of: 'water', near: true },
  { a: 'WOLF', b: 'HUSKY', of: 'animals', near: true },
  { a: 'CINEMA', b: 'THEATRE', of: 'places to watch', near: true },
  { a: 'BACKPACK', b: 'SUITCASE', of: 'luggage', near: true },
  { a: 'SNOWMAN', b: 'SCARECROW', of: 'figures in a field', near: true },
  { a: 'PENCIL', b: 'CRAYON', of: 'things to draw with', near: true },
  { a: 'HARBOUR', b: 'MARINA', of: 'places for boats', near: true },
  { a: 'DENTIST', b: 'DOCTOR', of: 'appointments', near: true },

  // --- far: the same category, but almost nothing else in common ----------
  { a: 'BEACH', b: 'DESERT', of: 'places', near: false },
  { a: 'PIANO', b: 'DRUMS', of: 'instruments', near: false },
  { a: 'WEDDING', b: 'FUNERAL', of: 'occasions', near: false },
  { a: 'LIGHTHOUSE', b: 'WINDMILL', of: 'tall buildings', near: false },
  { a: 'ELEPHANT', b: 'SPIDER', of: 'animals', near: false },
  { a: 'SUBMARINE', b: 'HOT AIR BALLOON', of: 'ways to travel', near: false },
  { a: 'BIRTHDAY', b: 'MONDAY', of: 'days', near: false },
  { a: 'VOLCANO', b: 'GLACIER', of: 'landscape', near: false },
  { a: 'DENTIST', b: 'ASTRONAUT', of: 'jobs', near: false },
  { a: 'SPAGHETTI', b: 'PORRIDGE', of: 'food', near: false },
  { a: 'CIRCUS', b: 'HOSPITAL', of: 'places people work', near: false },
  { a: 'MIRROR', b: 'WINDOW', of: 'things you look at', near: false },
  { a: 'THUNDERSTORM', b: 'SUNRISE', of: 'sky', near: false },
  { a: 'CHESS', b: 'FOOTBALL', of: 'games', near: false },
  { a: 'DIARY', b: 'PASSPORT', of: 'things you keep', near: false },
  { a: 'BEEHIVE', b: 'ANTHILL', of: 'homes', near: false },
  { a: 'HAIRCUT', b: 'TATTOO', of: 'things done to you', near: false },
  { a: 'AVALANCHE', b: 'SANDSTORM', of: 'things that bury you', near: false },
  { a: 'ORCHESTRA', b: 'CHOIR', of: 'groups that perform', near: false },
  { a: 'MOTORWAY', b: 'FOOTPATH', of: 'ways through', near: false },
];

export const CIRCLE_TUNING = {
  minPlayers: 3,
  maxPlayers: 6,

  // 'near' is harder for the table and easier for the impostor; 'far' is the
  // other way round. Both are drawn from the same list, so the difficulty is a
  // choice about the words and nothing else moves.
  difficulty: 'far',

  // What a round is worth.
  //
  // The impostor is paid more for surviving than a single voter is paid for
  // catching them, because there is one of them and several of the others.
  // Otherwise being the impostor is a round you simply lose.
  pointsForCatching: 1,
  pointsForSurviving: 3,
  // Caught, but names the word anyway: the round is not a write-off, and it
  // gives a losing impostor a reason to have been listening.
  pointsForStealing: 2,
};

/** Fisher-Yates, with the generator injected so a game can be replayed. */
function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The phases, in the order they happen. */
export const PHASE = {
  HANDOFF: 'handoff',   // "Player Three — press A when you are holding it"
  WORD: 'word',         // the word, for one pair of eyes
  CLUES: 'clues',       // talking, which the screen stays out of
  VOTE: 'vote',         // each player names somebody, in turn
  STEAL: 'steal',       // a caught impostor gets one guess at the word
  RESULT: 'result',
  OVER: 'over',
};

export class Circle {
  #rng;
  #tuning;
  #order;

  constructor({ players = 4, tuning = CIRCLE_TUNING, rng = Math.random } = {}) {
    this.#tuning = tuning === CIRCLE_TUNING ? tuning : { ...CIRCLE_TUNING, ...tuning };
    this.#rng = rng;
    this.players = players;
    this.scores = new Array(players).fill(0);

    // Everyone is the impostor exactly once, in an order nobody can predict.
    const seats = [];
    for (let p = 0; p < players; p++) seats.push(p);
    this.#order = shuffled(seats, rng);

    // Pairs are dealt without replacement, so a word cannot come up twice in one
    // sitting -- the second time it appears, everybody already knows the shape
    // of the answer and the round is spent.
    const pool = PAIRS.filter((pair) => (this.#tuning.difficulty === 'near' ? pair.near : !pair.near));
    this.#deck = shuffled(pool, rng);

    this.round = -1;
    this.phase = PHASE.OVER;
    this.nextRound();
  }

  get rounds() { return this.players; }
  get tuning() { return this.#tuning; }
  get impostor() { return this.#order[this.round]; }

  #deck = [];

  /** Sets up the next round, or ends the game. */
  nextRound() {
    this.round += 1;
    if (this.round >= this.rounds) {
      this.phase = PHASE.OVER;
      return false;
    }

    const pair = this.#deck[this.round % this.#deck.length];
    // Which of the two words the table gets is itself a coin toss, so a player
    // who has seen the pair before still cannot tell from their own card which
    // side of it they are on.
    const flip = this.#rng() < 0.5;
    this.tableWord = flip ? pair.a : pair.b;
    this.impostorWord = flip ? pair.b : pair.a;
    this.category = pair.of;

    this.seat = 0;                 // whose turn it is to look, or to vote
    this.votes = new Array(this.players).fill(-1);
    this.outcome = null;
    this.phase = PHASE.HANDOFF;
    return true;
  }

  /** The word the seat currently looking should be shown. */
  wordFor(player) {
    return player === this.impostor ? this.impostorWord : this.tableWord;
  }

  /**
   * The card is in the right hands: show the word.
   *
   * Split from `seen()` on purpose. Nothing secret is on screen until the
   * person about to read it presses the button themselves, so the device can be
   * carried across a table with the word already dealt and nobody has to say
   * "don't look yet".
   */
  reveal() {
    if (this.phase !== PHASE.HANDOFF) return false;
    this.phase = PHASE.WORD;
    return true;
  }

  /** Read it. Move on to the next pair of eyes, or to the talking. */
  seen() {
    if (this.phase !== PHASE.WORD) return false;
    this.seat += 1;
    this.phase = this.seat >= this.players ? PHASE.CLUES : PHASE.HANDOFF;
    return true;
  }

  /** The talking is over; start naming names. */
  startVote() {
    if (this.phase !== PHASE.CLUES) return false;
    this.seat = 0;
    this.phase = PHASE.VOTE;
    return true;
  }

  /**
   * One vote. Returns true while there are more to cast.
   *
   * Voting for yourself is refused rather than allowed and ignored: it is
   * always a misclick, and a vote nobody meant to cast decides rounds.
   */
  vote(target) {
    if (this.phase !== PHASE.VOTE) return false;
    if (target === this.seat) return false;
    if (target < 0 || target >= this.players) return false;
    this.votes[this.seat] = target;
    this.seat += 1;
    if (this.seat < this.players) return true;
    this.#settle();
    return false;
  }

  /** How the votes fell, most-voted first. */
  tally() {
    const counts = new Array(this.players).fill(0);
    for (const target of this.votes) if (target >= 0) counts[target] += 1;
    return counts;
  }

  /**
   * Who the table accused, or -1 if it could not agree.
   *
   * A tie is NOT broken. Nobody was accused, so the impostor got away with it —
   * which is the honest reading of a table that could not make up its mind, and
   * it stops the game inventing a verdict nobody voted for.
   */
  accused() {
    const counts = this.tally();
    let top = 0;
    let who = -1;
    let tied = false;
    counts.forEach((n, p) => {
      if (n > top) { top = n; who = p; tied = false; }
      else if (n === top && n > 0) tied = true;
    });
    return tied ? -1 : who;
  }

  /**
   * Four words for a caught impostor to choose between, one of them right.
   *
   * A CHOICE RATHER THAN TYPING. Spelling a word out on an on-screen keyboard
   * with five people watching is a minute of nothing happening, and it makes
   * the round about whether you can drive a cursor. Four large words and one
   * button is the same decision in three seconds.
   *
   * The three wrong ones are drawn from OTHER PAIRS IN THE SAME CATEGORY where
   * there are any, so the choice is between plausible answers rather than
   * between the word and three obvious jokes.
   */
  stealOptions() {
    const wrong = [];
    const seen = new Set([this.tableWord, this.impostorWord]);
    const sameKind = PAIRS.filter((p) => p.of === this.category);
    const rest = PAIRS.filter((p) => p.of !== this.category);
    for (const pair of [...shuffled(sameKind, this.#rng), ...shuffled(rest, this.#rng)]) {
      for (const word of [pair.a, pair.b]) {
        if (seen.has(word) || wrong.length >= 3) continue;
        seen.add(word);
        wrong.push(word);
      }
      if (wrong.length >= 3) break;
    }
    return shuffled([this.tableWord, ...wrong], this.#rng);
  }

  /**
   * A caught impostor names the word. Right, and the round is half theirs.
   *
   * Compared case-insensitively and without spaces, so what comes back from a
   * button is compared to what went onto it however either was written.
   */
  steal(guess) {
    if (this.phase !== PHASE.STEAL) return false;
    const tidy = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, '');
    const right = tidy(guess) === tidy(this.tableWord);
    if (right) {
      this.scores[this.impostor] += this.#tuning.pointsForStealing;
      this.outcome.stolen = true;
    }
    this.phase = PHASE.RESULT;
    return right;
  }

  #settle() {
    const caught = this.accused() === this.impostor;
    this.outcome = { caught, accused: this.accused(), stolen: false };

    if (caught) {
      // Everybody who actually pointed at them is paid. Being carried by the
      // rest of the table is not the same as having worked it out.
      this.votes.forEach((target, voter) => {
        if (target === this.impostor) this.scores[voter] += this.#tuning.pointsForCatching;
      });
      this.phase = PHASE.STEAL;
    } else {
      this.scores[this.impostor] += this.#tuning.pointsForSurviving;
      this.phase = PHASE.RESULT;
    }
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
