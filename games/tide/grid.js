// games/tide/grid.js
//
// TIDE — the whole game, with no canvas in it.
//
// THE RULE, and there is only one:
//
//   Put a stone on any empty square. When a row or column fills up, whoever has
//   the most stones in it takes the line, and the line washes away.
//
// If two people are level in a line then nobody has the most, and nobody is
// paid. That is not a second rule; it is what the first one says.
//
// HOW THE RULE GOT HERE, BECAUSE IT WAS NOT THE FIRST ONE TRIED
// -------------------------------------------------------------
// The design that was signed off paid EVERYONE in a full line, a point per
// stone. It was measured before a pixel was drawn, and it did not hold up:
//
//                        turns with       does declining a      does skill
//                        anything at      payout that feeds     beat playing
//                        stake            an opponent pay?      at random?
//   every stone paid       19%                 50%                  79-99%
//   finisher unpaid        50%                 76-82%                26-53%
//   most stones takes it   34-52%              50%                  94-97%
//
// The first row is the signed-off rule, and the middle column is the whole
// pitch of the game: there was no decision in it. Finishing a line pays you for
// your own stone too, so finishing is never worse than letting somebody else do
// it, and "should I close this?" has the same answer every time.
//
// The second row fixes that and breaks something worse. If the finisher is not
// paid then nobody wants to finish anything, scores collapse to under two
// points a game, and PLAYING WELL LOSES TO PLAYING AT RANDOM. A game that
// punishes engagement is not a hard game, it is a broken one.
//
// The third row is this one. The last stone in a line can flip who holds most
// of it, so the finisher is choosing the winner rather than rubber-stamping a
// split that was settled two turns ago -- and closing a line somebody else
// leads hands them the whole thing in front of everybody, which is the gift the
// design was always about, only much louder.
//
// All three are kept as a dial, because the choice IS the game and a future
// argument about it should be re-runnable rather than re-litigated.
//
// WHY THE PREVIEW LIVES IN THE RULES MODULE
// -----------------------------------------
// `preview()` is not a convenience for the renderer. It is how the game is
// taught: hovering a square shows what it pays and WHO it pays, so somebody who
// has never seen Tide works the rule out from the numbers moving rather than
// from being told it. That makes it load-bearing, so it sits with the rule it
// describes and a test pins the two together -- a preview that disagreed with
// what actually happened would be teaching the wrong game.

export const TIDE_TUNING = {
  // THE BOARD GROWS FOR A BIG TABLE.
  //
  // Six people on twenty-five squares is six stones a round on a board that
  // barely holds twenty: it churns faster than anyone can plan, and it measured
  // as a real unfairness -- one chair scored 16% under the rest because of
  // where it sat in the round. Thirty-six squares takes that to 5% at five
  // players and 15% at six.
  size: 5,
  largeSize: 6,
  largeFrom: 5,

  // Grey stones already on the board when the game starts. They fill a line
  // like any other stone and they belong to nobody.
  //
  // An empty board makes the first turn meaningless -- every square is the
  // same, so there is nothing to guess and nothing for the preview to show.
  // Six stones give the opening some shape, so the very first player already
  // sees one square matter more than another.
  neutralStones: 6,
  // ...but no line may start further along than this, or somebody is handed a
  // line that was nearly finished before anyone sat down.
  maxNeutralPerLine: 2,

  // Roughly how many stones get played in total, whatever the table size. Turns
  // each is derived from it, so two people and six people play for about the
  // same length of time. A party game that runs eleven minutes with a full
  // table and four with two is really two different games.
  targetPlacements: 40,
  minTurnsEach: 6,

  //   'majority'  whoever holds most of a full line takes it; level pays nobody
  //   'share'     everyone in it scores a point per stone they hold
  //   'others'    like 'share', but whoever placed the last stone gets nothing
  payout: 'majority',

  // WHO LEADS A ROUND: 'fixed', 'rotate', 'snake', 'trailing-first',
  // 'trailing-last'.
  //
  // Fixed, and that is a measurement rather than laziness. All four alternatives
  // were tried against seat bias and not one beat leaving the order alone:
  // rotation and snake both made SIX players worse (points high over low of
  // 1.44 and 1.29 against 1.15), because the advantage does not sit at a fixed
  // position in the round, so moving people through the positions moves the
  // problem rather than sharing it.
  //
  // So there is no catch-up ceremony. A ceremony that does nothing is worse
  // than no ceremony in a game whose whole pitch is one rule -- and the rule
  // already catches up on its own, since a leader cannot close a line without
  // either winning it in front of everybody or handing it to somebody else.
  turnOrder: 'fixed',
};

/** A neutral stone belongs to nobody, and this is what nobody looks like. */
export const NEUTRAL = -1;

/** The board is bigger for a big table. See the tuning. */
export function sizeFor(players, tuning = TIDE_TUNING) {
  const t = { ...TIDE_TUNING, ...tuning };
  return players >= t.largeFrom ? t.largeSize : t.size;
}

/**
 * Every line on the board, rows first and then columns.
 *
 * Cached per size, because every question this module answers is really a
 * question about lines.
 */
const LINE_CACHE = new Map();
export function linesOf(size) {
  const hit = LINE_CACHE.get(size);
  if (hit) return hit;
  const lines = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(r * size + c);
    lines.push(row);
  }
  for (let c = 0; c < size; c++) {
    const col = [];
    for (let r = 0; r < size; r++) col.push(r * size + c);
    lines.push(col);
  }
  LINE_CACHE.set(size, lines);
  return lines;
}

/** The two lines a square is in: its row, then its column. */
export function linesThrough(index, size) {
  return [Math.floor(index / size), size + (index % size)];
}

/**
 * How many turns each player gets.
 *
 * Held roughly constant in STONES PLAYED rather than in turns, so the game
 * takes about the same time however many people are round the table. Nobody
 * notices they got seven turns instead of ten; everybody notices a game that
 * outstays its welcome.
 */
export function turnsEachFor(players, tuning = TIDE_TUNING) {
  const t = { ...TIDE_TUNING, ...tuning };
  const size = sizeFor(players, t);
  // Scaled by the board WIDTH rather than its area. The bigger board needs
  // more stones to wash the same number of lines, but scaling by area (1.44x)
  // made a six-player game half as long again as a four-player one, which is
  // the thing this function exists to prevent.
  const target = t.targetPlacements * (size / 5);
  return Math.max(t.minTurnsEach, Math.round(target / players));
}

export class Tide {
  #tuning;
  #rng;
  #size;
  #players;
  #order;

  constructor({ players = 2, tuning = TIDE_TUNING, rng = Math.random } = {}) {
    this.#tuning = tuning === TIDE_TUNING ? tuning : { ...TIDE_TUNING, ...tuning };
    this.#rng = rng;
    this.#size = sizeFor(players, this.#tuning);
    this.#players = players;

    /** null is empty, NEUTRAL is grey, 0..players-1 is somebody's. */
    this.cells = new Array(this.#size * this.#size).fill(null);
    this.scores = new Array(players).fill(0);

    this.round = 0;
    this.turnInRound = 0;
    this.turnsEach = turnsEachFor(players, this.#tuning);

    // Kept for the tests that ask whether the tide comes in often enough for
    // this to be a game at all.
    this.washes = 0;
    this.paidOut = 0;
    /** The last thing that happened, so the screen can animate it. */
    this.lastResult = null;

    this.#seed();
    this.#order = this.#orderFor(0);
  }

  get size() { return this.#size; }
  get players() { return this.#players; }
  get tuning() { return this.#tuning; }
  get isOver() { return this.round >= this.turnsEach; }
  get currentPlayer() { return this.#order[this.turnInRound]; }
  get roundOrder() { return [...this.#order]; }

  /** What a full line is worth: its length, so a bigger board pays more. */
  get lineValue() { return this.#size; }

  emptyCells() {
    const out = [];
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === null) out.push(i);
    return out;
  }

  /**
   * What playing at `index` would do, without doing it.
   *
   * This is what the screen draws while the cursor is moving, and it is the
   * only teaching this game has.
   */
  preview(index, owner = this.currentPlayer) {
    const size = this.#size;
    const all = linesOf(size);
    const payouts = new Array(this.#players).fill(0);
    const washing = [];

    if (this.cells[index] !== null) {
      return { payouts, lines: washing, cleared: [], total: 0, index, owner };
    }

    for (const lineIndex of linesThrough(index, size)) {
      const line = all[lineIndex];
      let full = true;
      for (const cell of line) {
        if (cell !== index && this.cells[cell] === null) { full = false; break; }
      }
      if (!full) continue;
      washing.push(lineIndex);

      // Who holds what in the line, counting the stone about to be played --
      // it is in the line like any other.
      const held = new Array(this.#players).fill(0);
      for (const cell of line) {
        const who = cell === index ? owner : this.cells[cell];
        if (who !== null && who !== NEUTRAL) held[who] += 1;
      }

      const mode = this.#tuning.payout;
      if (mode === 'majority') {
        let top = 0;
        let winner = -1;
        let level = false;
        held.forEach((n, p) => {
          if (n > top) { top = n; winner = p; level = false; }
          else if (n === top && n > 0) level = true;
        });
        // Level means nobody has the most, so nobody is paid -- which is what
        // makes playing into a line to spoil it a real move.
        if (winner >= 0 && !level) payouts[winner] += line.length;
      } else {
        for (let p = 0; p < this.#players; p++) payouts[p] += held[p];
        if (mode === 'others') payouts[owner] -= held[owner];
      }
    }

    // A square that finishes a row AND a column counts in both, which is what
    // makes it the big play. It is only cleared once.
    const cleared = new Set();
    for (const lineIndex of washing) for (const cell of all[lineIndex]) cleared.add(cell);

    return {
      payouts,
      lines: washing,
      cleared: [...cleared],
      total: payouts.reduce((a, b) => a + b, 0),
      index,
      owner,
    };
  }

  /**
   * Play a stone. Returns exactly what preview() promised, which a test pins:
   * what the screen said was going to happen is what happened.
   */
  place(index) {
    if (this.isOver) throw new Error('the tide has gone out; the game is over');
    if (this.cells[index] !== null) throw new Error(`square ${index} is not empty`);

    const owner = this.currentPlayer;
    const result = this.preview(index, owner);

    this.cells[index] = owner;
    for (const cell of result.cleared) this.cells[cell] = null;
    for (let p = 0; p < this.#players; p++) this.scores[p] += result.payouts[p];
    this.washes += result.lines.length;
    this.paidOut += result.total;
    this.lastResult = result;

    this.#advance();
    return result;
  }

  /**
   * The lines one stone short of washing, and who would take each.
   *
   * THE HOT POTATO, made answerable. A row somebody already leads three to one
   * is a row nobody else wants to close, and the whole table should see that
   * from across a room rather than only the person counting. The screen draws
   * these, so the state is computed here rather than left to a renderer.
   */
  readyLines() {
    const all = linesOf(this.#size);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      let empty = -1;
      let holes = 0;
      for (const cell of all[i]) {
        if (this.cells[cell] === null) { empty = cell; holes++; }
      }
      if (holes !== 1) continue;

      const held = new Array(this.#players).fill(0);
      for (const cell of all[i]) {
        const who = this.cells[cell];
        if (who !== null && who !== NEUTRAL) held[who] += 1;
      }
      // Who is ahead in it as it stands. The stone that closes it can change
      // this, which is the point -- so this is what is at stake BEFORE anyone
      // chooses.
      let leader = -1;
      let top = 0;
      let level = false;
      held.forEach((n, p) => {
        if (n > top) { top = n; leader = p; level = false; }
        else if (n === top && n > 0) level = true;
      });
      out.push({
        line: i,
        cells: all[i],
        empty,
        held,
        leader: level ? -1 : leader,
        value: all[i].length,
      });
    }
    return out;
  }

  /** Final placings. Ties share, and a shared placing is a shared placing. */
  standings() {
    const stones = new Array(this.#players).fill(0);
    for (const cell of this.cells) if (cell !== null && cell !== NEUTRAL) stones[cell] += 1;
    const rows = this.scores.map((score, player) => ({ player, score, stones: stones[player] }));
    // Points; then most stones still on the board, which is whoever invested
    // most and was paid out least.
    rows.sort((a, b) => b.score - a.score || b.stones - a.stones);
    let place = 1;
    rows.forEach((row, i) => {
      if (i > 0 && (rows[i - 1].score !== row.score || rows[i - 1].stones !== row.stones)) {
        place = i + 1;
      }
      row.place = place;
    });
    return rows;
  }

  // --- Internals -----------------------------------------------------------

  #advance() {
    this.turnInRound += 1;
    if (this.turnInRound < this.#players) return;
    this.turnInRound = 0;
    this.round += 1;
    if (!this.isOver) this.#order = this.#orderFor(this.round);
  }

  #orderFor(round) {
    const seats = [];
    for (let p = 0; p < this.#players; p++) seats.push(p);
    const mode = this.#tuning.turnOrder;
    if (mode === 'fixed') return seats;
    if (mode === 'snake') return round % 2 === 0 ? seats : seats.reverse();
    if (mode === 'rotate') {
      const lead = round % this.#players;
      return seats.map((_, i) => (i + lead) % this.#players);
    }
    if (round === 0) return seats;
    const trailingFirst = mode === 'trailing-first';
    seats.sort((a, b) => (trailingFirst
      ? this.scores[a] - this.scores[b] || a - b
      : this.scores[b] - this.scores[a] || a - b));
    return seats;
  }

  /**
   * Scatter the grey stones.
   *
   * Rejection sampling against a cap per line rather than a free scatter: six
   * stones dropped anywhere can land three in one row, and a game that opens
   * with a line nearly finished has given the first player something for
   * nothing. Bounded by construction -- the cap is two a line, and six stones
   * over ten or twelve lines cannot saturate it.
   */
  #seed() {
    const size = this.#size;
    const all = linesOf(size);
    const perLine = new Array(all.length).fill(0);
    let placed = 0;
    let attempts = 0;
    while (placed < this.#tuning.neutralStones && attempts < 800) {
      attempts++;
      const index = Math.floor(this.#rng() * this.cells.length);
      if (this.cells[index] !== null) continue;
      const [row, col] = linesThrough(index, size);
      if (perLine[row] >= this.#tuning.maxNeutralPerLine) continue;
      if (perLine[col] >= this.#tuning.maxNeutralPerLine) continue;
      this.cells[index] = NEUTRAL;
      perLine[row] += 1;
      perLine[col] += 1;
      placed += 1;
    }
  }
}
