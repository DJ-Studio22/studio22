// games/bigger-fish/pond.js
//
// Bigger Fish's simulation: the pond, the cells, the pellets, the spikes and
// the bots. No canvas, no input device, no audio.
//
// WHAT THE GAME IS
// ----------------
// A pond much larger than the screen, scattered with pellets. Eat to grow. Eat
// anything meaningfully smaller than you, including other players' cells. Peak
// mass is the score, and it never ends -- something bigger always turns up.
//
// THE TRADE THE WHOLE GAME IS MADE OF
// -----------------------------------
//   MASS IS SPEED, SPENT.
//
// A big cell is slower than a small one, so growing is also the act of making
// yourself easier to corner. If that trade does not bite, the game is a
// treadmill: eat everything, win. So it is arranged to bite in three ways that
// compound, and then measured:
//
//   * SPEED falls with mass, so prey outruns you exactly when you most want it.
//   * SPIKES split a big cell into pieces and are harmless to a small one, so
//     size turns the terrain hostile. A small player ignores the map; a big one
//     has to route around it.
//   * SPLITTING, the only way to close distance on something faster, leaves you
//     divided and each piece is small enough to be eaten by things that could
//     not touch you a moment ago.
//
// tests/bigger-fish.pond.test.mjs proves it rather than claiming it: a purely
// greedy bot loses to a selective one, and then the mass penalty and the spike
// threat are set to nothing in a cloned tuning and greedy goes straight back to
// the top. Same shape as the ink proof in the game this one replaced.

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The pond. Much larger than any viewport: the camera follows and most of it
  // is somewhere you have not been.
  width: 2000,
  height: 2000,

  // Size. Radius from mass by area, so twice the mass is not twice the width --
  // which is what keeps a big cell's reach from growing out of hand.
  radiusPerRootMass: 5,
  startMass: 12,
  minMass: 8,

  // SPEED FROM MASS. The line the game rests on.
  //
  // speed = speedBase / mass^speedFalloff. At the starting mass that is about
  // 81 a second, at a hundred 51, at a thousand 30 -- so a big cell moves at
  // little more than a third of the pace of a small one. Fast enough to feel
  // quick when you are small, slow enough that a big cell cannot simply run
  // prey down, which is what makes SPLIT the answer and the split the risk.
  speedBase: 140,
  speedFalloff: 0.30,

  // Eating. You have to be meaningfully bigger, not a crumb bigger, or every
  // near-equal meeting is a coin flip nobody can read.
  eatRatio: 1.25,
  // How far inside you the other cell's centre must be. Full engulfment would
  // be unreadable; a bare touch would be unfair.
  eatOverlap: 0.42,

  // Pellets: the floor of the food chain.
  // Dense enough that grazing is a real living: a starting cell sweeps about
  // 2700 square units a second and there is a pellet in every 2700, so it
  // roughly doubles in the first ten seconds and slows down from there as its
  // own bulk starts costing it speed.
  pellets: 1500,
  pelletMass: 1.6,

  // SPLIT.
  splitMinMass: 26,
  maxCells: 8,
  splitLaunch: 620,          // initial speed of the launched half
  splitDrag: 2.6,            // how fast that launch bleeds off
  // PUTTING YOURSELF BACK TOGETHER IS SOMETHING YOU DO, NOT SOMETHING THAT
  // HAPPENS TO YOU.
  //
  // The first version was a timer: split, wait eleven seconds, snap back
  // together wherever you happened to be. Nothing about that was steering --
  // the whole post-split window was spent waiting rather than managing.
  //
  // Now the pieces drift towards each other on their own, and merge only after
  // twenty seconds of CONTINUOUS CONTACT. Break contact and the clock starts
  // again from nothing, so holding your pieces together through a fight, a
  // spike field or a chase is work you are doing, and letting them apart to
  // cover ground is a decision with a price.
  mergeDrift: 34,               // how hard the pieces pull towards each other
  mergeContactSeconds: 20,

  // HOW FAR AHEAD THE PACK IS STEERED, and this is the line that makes breaking
  // contact possible at all.
  //
  // The stick gives a DIRECTION, and moving every piece along the same
  // direction moves them in parallel: two halves of equal mass then keep
  // exactly the distance between them for ever, so contact can never be broken
  // by steering and the merge clock just runs down on its own. Hand-play caught
  // that immediately -- the clock counted from twenty to ten through a hard
  // turn without a flicker.
  //
  // So the stick aims at a POINT this far ahead of the pack instead, and every
  // piece swims towards it. Straight running gathers the pieces up; a hard turn
  // swings the outside piece wide and pulls it off the inside one; a piece of a
  // different size arrives at a different time. Contact becomes something the
  // player's hands are doing.
  steerAhead: 130,

  // YOUR OWN PIECES ARE SOLID, and this is the other half of being able to
  // break contact.
  //
  // Without it two halves settle exactly on top of each other -- the drift
  // pulls them to the same point and nothing pushes back -- so they are welded
  // together and no manoeuvre can part them. Measured: a hard about-turn left
  // the contact clock running without a flicker, from 8.4 seconds to 10.4.
  //
  // Pushing them apart until they are just touching puts them on the EDGE of
  // contact, where a turn, a size difference or a shove genuinely separates
  // them. It also makes a split read as two fish rather than one blurred one.
  cellPush: 40,
  // How far into each other resting pieces settle, as a share of their combined
  // radius, and how much daylight still counts as touching. Pushing them to
  // exactly touching and then asking whether they touch is a question that
  // answers itself wrong: they sit on the boundary and float a hair outside it,
  // and the contact clock never starts at all. Measured: nought seconds of
  // contact over eight seconds of running straight.
  cellRest: 0.9,
  // AND HOW FAR THEY STRING OUT WHEN YOU RUN.
  //
  // The rest distance is not a constant: at full stick the pieces spread to
  // well beyond touching, and easing off lets them close again. Without this
  // the push stopped the moment they were just touching, so running flat out
  // held them at exactly the distance that still counts as contact and the
  // merge clock ran on regardless -- 5.5 seconds to 8.5 through three seconds
  // of full stick.
  cellSpread: 0.7,
  contactSlack: 3,

  // EJECT.
  ejectMinMass: 24,
  ejectCost: 11,             // taken from the cell
  ejectMass: 8,              // delivered into the world (the rest is spent)
  ejectLaunch: 420,
  ejectDrag: 2.2,

  // SPIKES. Harmless below the threshold, ruinous above it.
  spikes: 18,
  spikeRadius: 22,
  spikeMass: 55,
  // WHAT A SPIKE ACTUALLY COSTS, beyond being scattered.
  //
  // Without this a burst conserved mass and the pieces merged back a few
  // seconds later, so the terrain was noise rather than a threat: measured over
  // ten minutes a player hit spikes seventy-odd times a run and neither policy
  // cared. A quarter of the cell is left on the spike now, which is what makes
  // routing around one worth the detour and makes size expensive to carry.
  spikeLoss: 0.4,
  // How many ejected blobs a spike will swallow before it spits a new spike
  // out along the direction it was last fed from. This is what lets a spike be
  // pushed at somebody.
  spikeFeedToSplit: 6,
  spikeShotSpeed: 150,

  // What a big cell loses just for being big. Keeps a runaway leader from
  // becoming the whole pond, and it is another reason not to hold mass you are
  // not using.
  decayAboveMass: 40,
  decayPerSecond: 0.006,

  // The bots.
  botCount: 7,
  botRespawnSeconds: 2.5,

  // THE OPENING, and all three of these are here because of what playing it
  // cold looked like: five seconds of touching nothing ended the run EATEN,
  // at the starting mass, having done nothing.
  //
  // A bot could start half again your size, they all hunt the fattest thing
  // they can eat, and one could arrive on top of you. None of that is
  // difficulty -- it is the game deciding the run before the player has moved.
  //
  //   openingGraceSeconds -- nobody hunts you at all for this long
  //   startClear          -- and nobody starts within this far of you
  //   botStartShare       -- and nobody starts big enough to eat you
  openingGraceSeconds: 6,
  startClear: 420,
  botStartShare: 0.95,
  // WHAT A NEW ARRIVAL WEIGHS, as a share of whoever is currently biggest.
  //
  // Without this the pond gets safer the longer you live: bots respawn tiny,
  // you outgrow every one of them, and nothing in the water can touch you.
  // Measured, a greedy player then beat a careful one 496 to 322 and was right
  // to -- there was no risk to decline. With it, the pond keeps producing
  // company in your own weight class, which is the whole premise: there is
  // always a bigger fish, and if there is not yet, there shortly will be.
  //
  // A RANGE RATHER THAN A FIGURE, and that is the difference between a pond and
  // a queue. Arrivals all at the same share of the leader means every bot is
  // roughly every other bot's size, nobody can eat anybody -- eating needs a
  // clear quarter more mass -- and the only predator-prey pair in the water is
  // you and them. Measured that way, seven bots managed seven meals between
  // them in three minutes. A spread means there is always something in the pond
  // that can eat something else in the pond.
  respawnShare: 0.7,
  respawnSpread: 0.6,
  // How often anybody -- bot or the test harness's player -- may change their
  // mind. Shared, so no skill level gets to think more often than another.
  decideSeconds: 0.15,

  // THE SCORE IS THE AREA UNDER THE MASS CURVE: how big you were, multiplied
  // by how long you stayed that way.
  //
  // Peak mass was the first answer and it is the wrong shape for this game.
  // Peak ignores how long you held it, so a run that spikes to five hundred and
  // dies scores the same as one that holds five hundred for four minutes --
  // which makes growing as fast as possible and accepting death optimal BY
  // CONSTRUCTION, and no amount of tuning the risks can change that. Every risk
  // added lowers both a reckless player and a careful one together.
  //
  // Mass-seconds fixes the shape: surviving big is worth more than briefly
  // being big, which is the thing the design is actually about. Divided by this
  // to keep the number readable rather than astronomical.
  scoreDivisor: 10,
  // Sampled for the "held" figure, which is reported beside the score.
  holdSeconds: 10,
  sampleSeconds: 0.5,
};

export const END = { EATEN: 'Eaten' };

// --- Skill levels ---------------------------------------------------------
//
// SELECTABLE BEFORE THE RUN, AND THEY DIFFER IN JUDGEMENT ONLY.
//
// Every level moves at the same speed, sees the same distance, and re-decides
// on the same clock. What changes is the quality of the decisions: whether a
// bot checks that a split will actually reach before committing to it, whether
// it notices that something bigger is close enough to punish it while it is
// divided, whether it treats a spike as terrain when it is big, and whether it
// can be pulled onto one by a trail of bait.
//
// That is deliberate. A bot that reacts faster or moves faster than the player
// is not a harder opponent, it is a handicap; a bot that plays the same game
// better is.
export const SKILLS = {
  careless: {
    // Splits at anything roughly in front of it, whether or not the maths says
    // it lands, and never looks over its shoulder while it is doing it.
    checksSplitReach: false,
    checksPunish: false,
    avoidsSpikes: false,
    usesSpikes: false,
    readsBait: false,
  },
  steady: {
    // Splits only when it will reach, and not while something bigger is close
    // enough to eat the halves. Treats spikes as terrain once it is big.
    checksSplitReach: true,
    checksPunish: true,
    avoidsSpikes: true,
    usesSpikes: false,
    readsBait: true,
  },
  ruthless: {
    // All of that, and it uses the terrain: it herds prey towards spikes and
    // feeds spikes towards anything too big to attack directly.
    checksSplitReach: true,
    checksPunish: true,
    avoidsSpikes: true,
    usesSpikes: true,
    readsBait: true,
  },
};
export const SKILL_NAMES = ['careless', 'steady', 'ruthless'];

// --- Size and speed -------------------------------------------------------

export const radiusOf = (mass, t = TUNING) => t.radiusPerRootMass * Math.sqrt(mass);

/** How fast a cell of this mass moves. The trade, in one line. */
export const speedOf = (mass, t = TUNING) => t.speedBase / (mass ** t.speedFalloff);

/** Can `mass` eat `other`? */
export const canEat = (mass, other, t = TUNING) => mass > other * t.eatRatio;

/**
 * How long two pieces must stay in contact before they merge.
 *
 * A constant rather than a function of mass, and that is deliberate: the cost
 * of a split should be about what you have to DO to undo it, not about a
 * number that quietly grows as you get bigger.
 */
export const mergeContactSeconds = (t = TUNING) => t.mergeContactSeconds;

/**
 * IS `other` ACTUALLY A THREAT TO A CELL OF `mass` AT THIS DISTANCE?
 *
 * The obvious answer -- anything bigger, anywhere near -- is wrong, and wrong
 * in a way that made the pond dead. A cell can catch something faster than it
 * only by splitting, and splitting HALVES it: a fish thirty per cent bigger
 * than you that splits produces two halves at sixty-five per cent of you, which
 * cannot eat you at all. So the range at which a bigger fish is dangerous
 * depends on whether its HALVES could still eat you.
 *
 * Treating every bigger cell as a split-threat had the good bots fleeing almost
 * continuously and never engaging: measured over three minutes, seven steady
 * bots managed two meals between them, against three hundred for a shoal of
 * careless ones. The pond was inert at exactly the skill levels a player would
 * choose.
 */
export function threatens(other, mass, distance, t = TUNING) {
  // It can eat you where it stands, and it is close enough to lean on you.
  if (canEat(other.mass, mass, t)
    && distance < radiusOf(other.mass, t) + radiusOf(mass, t) + 120) return true;
  // Or it can split onto you and the halves would still be big enough.
  return canEat(other.mass / 2, mass, t) && distance < splitReach(other.mass, t) + 90;
}

/** How far a cell can throw half of itself.
 *
 * The launch decays exponentially, so the distance is the integral of it:
 * launch / drag. Used by the bots to decide whether a split actually reaches,
 * and by game.js to draw the reach ring -- one function, so what is drawn and
 * what is decided cannot disagree.
 */
export const splitReach = (mass, t = TUNING) =>
  t.splitLaunch / t.splitDrag + radiusOf(mass / 2, t);

// --- The pond -------------------------------------------------------------

let nextId = 1;

export class Pond {
  constructor(tuning = TUNING, options = {}) {
    this.t = tuning;
    this.skill = options.skill ?? 'steady';
    this.reset();
  }

  reset() {
    const t = this.t;
    this.time = 0;
    this.running = true;
    this.reason = null;
    this.peakMass = 0;
    this.heldMass = 0;
    // The integral of mass over time: the score.
    this.massSeconds = 0;
    this.samples = [];
    this.nextSample = 0;
    this.eaten = 0;
    this.splits = 0;
    this.merges = 0;
    // What the pond does to itself, so "the world has its own life" is a
    // measurement rather than an impression.
    this.botKills = 0;
    this.botSplits = 0;
    this.botSpiked = 0;
    this.ejections = 0;
    this.spiked = 0;
    // How long each pair of a player's or bot's own cells has been touching.
    this.contact = new Map();

    this.cells = [];
    this.blobs = [];                 // ejected mass in flight
    this.pellets = [];
    this.spikes = [];

    this.player = this.#spawnPlayer();
    this.bots = [];
    for (let i = 0; i < t.botCount; i++) this.bots.push(this.#spawnBot(i));

    for (let i = 0; i < t.pellets; i++) this.pellets.push(this.#randomPellet());
    for (let i = 0; i < t.spikes; i++) this.spikes.push(this.#randomSpike());
  }

  // --- Spawning -----------------------------------------------------------

  #randomPoint() {
    return { x: Math.random() * this.t.width, y: Math.random() * this.t.height };
  }

  /** A point far enough from the player to not be an opening ambush. */
  #awayFromPlayer() {
    const centre = this.player ? this.centreOf('player') : null;
    if (!centre) return this.#randomPoint();
    for (let attempt = 0; attempt < 40; attempt++) {
      const at = this.#randomPoint();
      if (Math.hypot(at.x - centre.x, at.y - centre.y) >= this.t.startClear) return at;
    }
    // Pushed to the far corner rather than looped forever, because a crowded
    // pond still has to be able to fill.
    return {
      x: centre.x > this.t.width / 2 ? 20 : this.t.width - 20,
      y: centre.y > this.t.height / 2 ? 20 : this.t.height - 20,
    };
  }

  #randomPellet() {
    return { ...this.#randomPoint(), mass: this.t.pelletMass };
  }

  #randomSpike() {
    return { ...this.#randomPoint(), fed: 0, feedAngle: 0 };
  }

  #spawnPlayer() {
    const at = this.#randomPoint();
    const cell = this.#newCell('player', at.x, at.y, this.t.startMass);
    return { id: 'player', cells: [cell], alive: true, peak: this.t.startMass };
  }

  #spawnBot(index) {
    const at = this.#awayFromPlayer();
    const id = `bot${index}`;
    // Nobody starts able to eat you. They grow into that soon enough.
    const cell = this.#newCell(id, at.x, at.y,
      this.t.startMass * this.t.botStartShare * (0.55 + Math.random() * 0.45));
    return {
      id,
      cells: [cell],
      alive: true,
      dead: 0,
      goal: null,
      rethink: Math.random() * this.t.decideSeconds,
    };
  }

  #newCell(owner, x, y, mass) {
    const cell = {
      id: nextId++, owner, x, y, mass, vx: 0, vy: 0,
    };
    this.cells.push(cell);
    return cell;
  }

  // --- Lookups ------------------------------------------------------------

  cellsOf(owner) { return this.cells.filter((c) => c.owner === owner); }

  massOf(owner) {
    let total = 0;
    for (const cell of this.cells) if (cell.owner === owner) total += cell.mass;
    return total;
  }

  /** The centre of somebody's cells, weighted by mass. Where the camera looks. */
  centreOf(owner) {
    let x = 0;
    let y = 0;
    let mass = 0;
    for (const cell of this.cells) {
      if (cell.owner !== owner) continue;
      x += cell.x * cell.mass;
      y += cell.y * cell.mass;
      mass += cell.mass;
    }
    return mass ? { x: x / mass, y: y / mass, mass } : null;
  }

  get playerMass() { return this.massOf('player'); }

  // --- Actions ------------------------------------------------------------

  /**
   * Split every cell of `owner` that is big enough, launching half forward.
   *
   * Returns how many cells split, so the caller can tell whether the button
   * did anything -- a control that silently does nothing is worse than one
   * that refuses out loud.
   */
  split(owner, aimX, aimY) {
    const t = this.t;
    const mine = this.cellsOf(owner);
    if (mine.length >= t.maxCells) return 0;
    let done = 0;
    for (const cell of [...mine].sort((a, b) => b.mass - a.mass)) {
      if (this.cellsOf(owner).length >= t.maxCells) break;
      if (cell.mass < t.splitMinMass) continue;
      const angle = Math.atan2(aimY - cell.y, aimX - cell.x);
      const half = cell.mass / 2;
      cell.mass = half;
      const piece = this.#newCell(owner, cell.x, cell.y, half);
      piece.vx = Math.cos(angle) * t.splitLaunch;
      piece.vy = Math.sin(angle) * t.splitLaunch;
      done++;
    }
    if (owner === 'player') this.splits += done;
    else this.botSplits += done;
    return done;
  }

  /** Shoot a small piece of mass forward from every cell big enough to spare it. */
  eject(owner, aimX, aimY) {
    const t = this.t;
    let done = 0;
    for (const cell of this.cellsOf(owner)) {
      if (cell.mass < t.ejectMinMass) continue;
      const angle = Math.atan2(aimY - cell.y, aimX - cell.x);
      cell.mass -= t.ejectCost;
      const r = radiusOf(cell.mass, t);
      this.blobs.push({
        x: cell.x + Math.cos(angle) * r,
        y: cell.y + Math.sin(angle) * r,
        vx: Math.cos(angle) * t.ejectLaunch,
        vy: Math.sin(angle) * t.ejectLaunch,
        mass: t.ejectMass,
        owner,
        angle,
      });
      done++;
    }
    if (owner === 'player') this.ejections += done;
    return done;
  }

  // --- One frame ----------------------------------------------------------

  /**
   * `input` is { x, y, split, eject } — a direction to head in and two edges.
   * A stick, a keyboard and a thumb all reduce to that.
   */
  step(dt, input = {}) {
    if (!this.running) return;
    const t = this.t;
    this.time += dt;

    if (input.split) {
      const centre = this.centreOf('player');
      if (centre) {
        this.split('player', centre.x + (input.x || 0) * 100, centre.y + (input.y || 0) * 100);
      }
    }
    if (input.eject) {
      const centre = this.centreOf('player');
      if (centre) {
        this.eject('player', centre.x + (input.x || 0) * 100, centre.y + (input.y || 0) * 100);
      }
    }

    this.#steerPlayer(dt, input);
    this.#thinkBots(dt);
    this.#moveCells(dt);
    this.#moveBlobs(dt);
    this.#eatPellets();
    this.#eatBlobs();
    this.#hitSpikes();
    this.#eatEachOther();
    // How hard the stick is pushed, which is what decides whether the pieces
    // gather or spread. See #drift.
    this.effort = Math.min(1, Math.hypot(input.x || 0, input.y || 0));
    this.#drift(dt);
    this.#separate(dt);
    this.#merge(dt);
    this.#decay(dt);
    this.#respawnBots(dt);
    this.#topUpPellets();

    const mass = this.playerMass;
    this.peakMass = Math.max(this.peakMass, mass);
    this.massSeconds += mass * dt;
    this.#sample(mass);
    if (!this.cellsOf('player').length) {
      this.running = false;
      this.reason = END.EATEN;
    }
  }

  /**
   * The score: the highest mass held continuously for holdSeconds.
   *
   * Sampled twice a second and read as the FLOOR of a rolling window, so a
   * momentary spike counts for nothing and a size you kept counts for all of
   * it. Rising while the window fills, and it never falls.
   */
  #sample(mass) {
    const t = this.t;
    if (this.time < this.nextSample) return;
    this.nextSample = this.time + t.sampleSeconds;
    this.samples.push(mass);
    const window = Math.round(t.holdSeconds / t.sampleSeconds);
    if (this.samples.length > window) this.samples.shift();
    if (this.samples.length < window) return;
    let floor = Infinity;
    for (const sample of this.samples) floor = Math.min(floor, sample);
    this.heldMass = Math.max(this.heldMass, floor);
  }

  /**
   * What the run is worth: mass-seconds, the area under the mass curve.
   *
   * Peak mass and the biggest size held for ten seconds are both still tracked
   * and both reported, because they are the things a player actually watches.
   * They are just not what is scored.
   */
  get score() { return Math.round(this.massSeconds / this.t.scoreDivisor); }

  #steerPlayer(dt, input) {
    const t = this.t;
    const mag = Math.hypot(input.x || 0, input.y || 0);
    if (mag < 0.001) return;
    const mine = this.cellsOf('player');
    if (!mine.length) return;

    // The stick aims at a point ahead of the pack; every piece swims towards
    // that point rather than along the stick. See steerAhead.
    const centre = this.centreOf('player');
    const aimX = centre.x + (input.x / mag) * t.steerAhead;
    const aimY = centre.y + (input.y / mag) * t.steerAhead;

    for (const cell of mine) {
      const dx = aimX - cell.x;
      const dy = aimY - cell.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.001) continue;
      const speed = speedOf(cell.mass, t);
      cell.x += (dx / d) * speed * dt;
      cell.y += (dy / d) * speed * dt;
    }
  }

  #moveCells(dt) {
    const t = this.t;
    for (const cell of this.cells) {
      // The launch from a split bleeds off, which is what gives a split its
      // reach and its limit.
      if (cell.vx || cell.vy) {
        cell.x += cell.vx * dt;
        cell.y += cell.vy * dt;
        const keep = Math.exp(-t.splitDrag * dt);
        cell.vx *= keep;
        cell.vy *= keep;
        if (Math.hypot(cell.vx, cell.vy) < 1) { cell.vx = 0; cell.vy = 0; }
      }
      const r = radiusOf(cell.mass, t);
      cell.x = Math.min(t.width - r, Math.max(r, cell.x));
      cell.y = Math.min(t.height - r, Math.max(r, cell.y));
    }
  }

  #moveBlobs(dt) {
    const t = this.t;
    for (const blob of this.blobs) {
      blob.x += blob.vx * dt;
      blob.y += blob.vy * dt;
      const keep = Math.exp(-t.ejectDrag * dt);
      blob.vx *= keep;
      blob.vy *= keep;
      blob.x = Math.min(t.width, Math.max(0, blob.x));
      blob.y = Math.min(t.height, Math.max(0, blob.y));
    }
  }

  /**
   * Grazing, through a bucket index rather than by asking every cell about
   * every pellet.
   *
   * Fifteen hundred pellets against fifteen cells is twenty-two thousand
   * distance checks a frame, which is a phone's frame budget spent on food.
   * Bucketing the pellets once and then looking only in the buckets a cell
   * actually covers is about thirteen times less work, and it is the same
   * answer.
   */
  #eatPellets() {
    const t = this.t;
    const size = 100;
    const cols = Math.ceil(t.width / size);
    const buckets = new Map();
    for (let i = 0; i < this.pellets.length; i++) {
      const pellet = this.pellets[i];
      const key = ((pellet.y / size) | 0) * cols + ((pellet.x / size) | 0);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i); else buckets.set(key, [i]);
    }

    const eaten = new Set();
    for (const cell of this.cells) {
      const r = radiusOf(cell.mass, t);
      const x0 = Math.max(0, ((cell.x - r) / size) | 0);
      const x1 = Math.min(cols - 1, ((cell.x + r) / size) | 0);
      const y0 = Math.max(0, ((cell.y - r) / size) | 0);
      const y1 = Math.min(Math.ceil(t.height / size) - 1, ((cell.y + r) / size) | 0);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const bucket = buckets.get(cy * cols + cx);
          if (!bucket) continue;
          for (const i of bucket) {
            if (eaten.has(i)) continue;
            const pellet = this.pellets[i];
            const dx = pellet.x - cell.x;
            const dy = pellet.y - cell.y;
            if (dx * dx + dy * dy > r * r) continue;
            cell.mass += pellet.mass;
            eaten.add(i);
          }
        }
      }
    }
    if (eaten.size) this.pellets = this.pellets.filter((_, i) => !eaten.has(i));
  }

  #eatBlobs() {
    const t = this.t;
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const blob = this.blobs[i];
      // A spike swallows ejected mass, and enough of it makes the spike spit a
      // new one out the way it was fed. That is how a spike gets pushed at
      // somebody who is too big to attack directly.
      let swallowed = false;
      for (const spike of this.spikes) {
        if (Math.hypot(spike.x - blob.x, spike.y - blob.y) > t.spikeRadius) continue;
        spike.fed++;
        spike.feedAngle = blob.angle;
        if (spike.fed >= t.spikeFeedToSplit) {
          spike.fed = 0;
          this.spikes.push({
            x: spike.x + Math.cos(blob.angle) * t.spikeRadius * 2,
            y: spike.y + Math.sin(blob.angle) * t.spikeRadius * 2,
            fed: 0,
            feedAngle: blob.angle,
            vx: Math.cos(blob.angle) * t.spikeShotSpeed,
            vy: Math.sin(blob.angle) * t.spikeShotSpeed,
          });
        }
        swallowed = true;
        break;
      }
      if (swallowed) { this.blobs.splice(i, 1); continue; }

      for (const cell of this.cells) {
        if (Math.hypot(blob.x - cell.x, blob.y - cell.y) > radiusOf(cell.mass, t)) continue;
        cell.mass += blob.mass;
        this.blobs.splice(i, 1);
        break;
      }
    }
    // Spikes that were shot out drift and stop.
    for (const spike of this.spikes) {
      if (!spike.vx && !spike.vy) continue;
      spike.x = Math.min(t.width, Math.max(0, spike.x + spike.vx * (1 / 60)));
      spike.y = Math.min(t.height, Math.max(0, spike.y + spike.vy * (1 / 60)));
      spike.vx *= 0.94;
      spike.vy *= 0.94;
      if (Math.hypot(spike.vx, spike.vy) < 2) { spike.vx = 0; spike.vy = 0; }
    }
  }

  #hitSpikes() {
    const t = this.t;
    for (const spike of this.spikes) {
      for (const cell of [...this.cells]) {
        if (cell.mass < t.spikeMass) continue;      // small cells pass under
        const r = radiusOf(cell.mass, t);
        if (Math.hypot(spike.x - cell.x, spike.y - cell.y) > r) continue;
        this.#burst(cell);
        if (cell.owner === 'player') this.spiked++;
        else this.botSpiked++;
      }
    }
  }

  /** A spike hit: one big cell becomes as many pieces as it is allowed. */
  #burst(cell) {
    const t = this.t;
    const room = t.maxCells - this.cellsOf(cell.owner).length;
    const pieces = Math.max(1, Math.min(room, 5));
    if (pieces < 1) return;
    const share = (cell.mass * (1 - t.spikeLoss)) / (pieces + 1);
    cell.mass = share;
    for (let i = 0; i < pieces; i++) {
      const angle = (i / pieces) * Math.PI * 2 + Math.random();
      const piece = this.#newCell(cell.owner, cell.x, cell.y, share);
      piece.vx = Math.cos(angle) * t.splitLaunch * 0.7;
      piece.vy = Math.sin(angle) * t.splitLaunch * 0.7;
    }
  }

  #eatEachOther() {
    const t = this.t;
    // Biggest first, so a chain of eats in one frame resolves the way it looks.
    const order = [...this.cells].sort((a, b) => b.mass - a.mass);
    const dead = new Set();
    for (const big of order) {
      if (dead.has(big.id)) continue;
      const r = radiusOf(big.mass, t);
      for (const small of order) {
        if (small === big || dead.has(small.id)) continue;
        if (small.owner === big.owner) continue;
        if (!canEat(big.mass, small.mass, t)) continue;
        const d = Math.hypot(big.x - small.x, big.y - small.y);
        if (d > r - radiusOf(small.mass, t) * t.eatOverlap) continue;
        big.mass += small.mass;
        dead.add(small.id);
        if (big.owner === 'player') this.eaten++;
        else if (small.owner !== 'player') this.botKills++;
      }
    }
    if (dead.size) this.cells = this.cells.filter((c) => !dead.has(c.id));
  }

  /**
   * The pieces pull towards each other, so a split closes on its own if you
   * let it.
   *
   * Gentle -- a fraction of walking pace -- because it is a tendency rather
   * than a tractor beam. You can pull the pieces apart by steering, and you
   * will, because two cells sixty units apart cover twice the ground.
   */
  #drift(dt) {
    const t = this.t;
    // GATHERING COSTS YOU SPEED, and that is what makes holding your pieces
    // together something you are doing.
    //
    // The pull towards each other only works while you are easing off; the push
    // apart is always on. So running flat out spreads your pieces -- covering
    // ground, and vulnerable, with the merge clock at nothing -- and knitting
    // back together means slowing down in a pond that has just watched you
    // divide yourself.
    //
    // Without this the pieces were welded: identical halves given identical
    // velocities move in parallel for ever, and no amount of steering can part
    // them. That is geometry rather than tuning, so the answer had to be a rule
    // rather than a number.
    const gather = Math.max(0, 1 - (this.effort ?? 0));
    const owners = new Set(this.cells.map((c) => c.owner));
    for (const owner of owners) {
      const mine = this.cellsOf(owner);
      if (mine.length < 2) continue;
      const centre = this.centreOf(owner);
      for (const cell of mine) {
        const dx = centre.x - cell.x;
        const dy = centre.y - cell.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.5) continue;
        // Bots always gather; only the player pays for it with speed, because
        // only the player has a stick.
        const pull = owner === 'player' ? t.mergeDrift * gather : t.mergeDrift;
        cell.x += (dx / d) * pull * dt;
        cell.y += (dy / d) * pull * dt;
      }
    }
  }

  /**
   * Your own pieces are solid: they push each other apart until they are just
   * touching, rather than settling into one another.
   *
   * The counterpart to the drift. Drift pulls them in, this holds them at arm's
   * length, and the balance leaves them exactly on the edge of contact -- which
   * is what makes contact something a manoeuvre can break.
   */
  #separate(dt) {
    const t = this.t;
    const owners = new Set(this.cells.map((c) => c.owner));
    for (const owner of owners) {
      const mine = this.cellsOf(owner);
      if (mine.length < 2) continue;
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          const a = mine[i];
          const b = mine[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const effort = owner === 'player' ? (this.effort ?? 0) : 0;
          const want = (radiusOf(a.mass, t) + radiusOf(b.mass, t))
            * (t.cellRest + effort * t.cellSpread);
          if (d >= want) continue;
          const push = Math.min(t.cellPush * dt, (want - d) / 2);
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }

  /**
   * Merging: twenty seconds of unbroken contact, and breaking contact resets it.
   *
   * The contact clock lives per PAIR rather than per cell, so two pieces that
   * have been together for nineteen seconds are not reset by a third arriving,
   * and a pair that comes apart for a frame genuinely starts again. That reset
   * is the point: keeping the pieces together through a fight is the work, and
   * letting them apart to cover ground is the decision.
   */
  #merge(dt) {
    const t = this.t;
    const seen = new Set();
    const owners = new Set(this.cells.map((c) => c.owner));

    for (const owner of owners) {
      const mine = this.cellsOf(owner);
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          const a = mine[i];
          const b = mine[j];
          if (a.mass === 0 || b.mass === 0) continue;
          const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
          const touching = Math.hypot(a.x - b.x, a.y - b.y)
            <= radiusOf(a.mass, t) + radiusOf(b.mass, t) + t.contactSlack;
          if (!touching) continue;
          seen.add(key);
          const held = (this.contact.get(key) ?? 0) + dt;
          this.contact.set(key, held);
          if (held >= t.mergeContactSeconds) {
            a.mass += b.mass;
            b.mass = 0;
            this.contact.delete(key);
            if (owner === 'player') this.merges++;
          }
        }
      }
    }

    // Anything not touching this frame starts again from nothing.
    for (const key of [...this.contact.keys()]) if (!seen.has(key)) this.contact.delete(key);
    this.cells = this.cells.filter((c) => c.mass > 0);
  }

  /**
   * How close the player is to putting themselves back together: the longest
   * unbroken contact among their own pieces, in seconds.
   *
   * Exported behaviour rather than a private detail because game.js draws it --
   * a clock you are running has to be a clock you can see.
   */
  get contactHeld() {
    let best = 0;
    const mine = new Set(this.cellsOf('player').map((c) => c.id));
    for (const [key, held] of this.contact) {
      const [a, b] = key.split(':').map(Number);
      if (mine.has(a) && mine.has(b)) best = Math.max(best, held);
    }
    return best;
  }

  /**
   * What a big cell loses just for being big.
   *
   * Only the mass ABOVE the threshold decays, so a small cell never shrinks and
   * a huge one bleeds steadily. It stops a runaway leader becoming the whole
   * pond, and it is one more reason not to sit on mass you are not using.
   */
  #decay(dt) {
    const t = this.t;
    for (const cell of this.cells) {
      if (cell.mass <= t.decayAboveMass) continue;
      cell.mass -= (cell.mass - t.decayAboveMass) * t.decayPerSecond * dt;
    }
  }

  #respawnBots(dt) {
    for (const bot of this.bots) {
      const mine = this.cellsOf(bot.id);
      if (mine.length) { bot.alive = true; continue; }
      bot.alive = false;
      bot.dead += dt;
      if (bot.dead >= this.t.botRespawnSeconds) {
        bot.dead = 0;
        const at = this.#awayFromPlayer();
        this.#newCell(bot.id, at.x, at.y, this.#arrivalMass());
      }
    }
  }

  /**
   * What a newly arriving bot weighs: a share of the biggest thing in the pond,
   * drawn from a wide spread so the pond has a size ladder in it.
   */
  #arrivalMass() {
    const t = this.t;
    let leader = t.startMass;
    const owners = new Set(this.cells.map((c) => c.owner));
    for (const owner of owners) leader = Math.max(leader, this.massOf(owner));
    const share = t.respawnShare * (1 - t.respawnSpread + Math.random() * t.respawnSpread * 2);
    return Math.max(t.startMass, leader * share);
  }

  /**
   * The arrival-mass draw, for tests.
   *
   * A seam rather than making #arrivalMass public: the spread of arrival sizes
   * is a claim the pond makes -- there is a size ladder in the water -- and a
   * claim needs to be checkable without running three minutes of simulation and
   * hoping the right bots died.
   */
  arrivalMassForTest() { return this.#arrivalMass(); }

  #topUpPellets() {
    while (this.pellets.length < this.t.pellets) this.pellets.push(this.#randomPellet());
  }

  // --- The bots -----------------------------------------------------------

  #thinkBots(dt) {
    for (const bot of this.bots) {
      const mine = this.cellsOf(bot.id);
      if (!mine.length) continue;
      bot.rethink -= dt;
      if (bot.rethink <= 0) {
        bot.rethink = this.t.decideSeconds;
        this.#decide(bot, mine);
      }
      const goal = bot.goal;
      if (!goal) continue;
      for (const cell of mine) {
        const dx = goal.x - cell.x;
        const dy = goal.y - cell.y;
        const d = Math.hypot(dx, dy) || 1;
        const speed = speedOf(cell.mass, this.t);
        cell.x += (dx / d) * speed * dt;
        cell.y += (dy / d) * speed * dt;
      }
    }
  }

  /**
   * ONE DECISION, and the skill level is entirely in the quality of it.
   *
   * The order is the same at every level: run from what can eat you, take a
   * meal that is worth taking, otherwise go and graze. What the levels change
   * is how well each of those questions is answered.
   */
  #decide(bot, mine) {
    const t = this.t;
    const skill = SKILLS[this.skill] ?? SKILLS.steady;
    const head = mine.reduce((a, b) => (a.mass >= b.mass ? a : b));
    const others = this.cells.filter((c) => c.owner !== bot.id);

    // THE OPENING GRACE. For the first few seconds nobody has noticed you:
    // they graze, they eat each other, and you get to learn which way is up.
    const noticed = this.time >= t.openingGraceSeconds;

    // 1. THREATS. Anything that can eat the head cell.
    let threat = null;
    for (const other of others) {
      const d = Math.hypot(other.x - head.x, other.y - head.y);
      // A hunter that can split onto you is dangerous further away than it
      // looks -- but only if its halves could still eat you. Only the levels
      // that check reach know either half of that; the careless ones just look
      // for something big and nearby.
      const dangerous = skill.checksSplitReach
        ? threatens(other, head.mass, d, t)
        : canEat(other.mass, head.mass, t) && d < 150;
      if (dangerous && (!threat || d < threat.d)) threat = { cell: other, d };
    }
    if (threat) {
      bot.goal = {
        x: head.x - (threat.cell.x - head.x),
        y: head.y - (threat.cell.y - head.y),
      };
      return;
    }

    // 2. PREY.
    let prey = null;
    for (const other of others) {
      if (!noticed && other.owner === 'player') continue;
      if (!canEat(head.mass, other.mass, t)) continue;
      const d = Math.hypot(other.x - head.x, other.y - head.y);
      if (d > 700) continue;
      // Bait: a small morsel sitting right next to something much bigger is a
      // trap. Only the levels that read it decline.
      if (skill.readsBait && this.#guarded(other, head)) continue;
      // WORTH IT, WEIGHED AGAINST THE WALK. Not the nearest -- that has every
      // bot chasing crumbs and nothing ever hunting the leader. Not the fattest
      // either, which was the previous version and had all seven bots setting
      // off after the same distant target and ignoring the fight next to them.
      //
      // Mass over distance picks the meal that is actually worth going for,
      // which is what spreads the pond out into several fights at once instead
      // of one procession.
      const worth = other.mass / (d + 200);
      if (!prey || worth > prey.worth) prey = { cell: other, d, worth };
    }

    if (prey) {
      bot.goal = { x: prey.cell.x, y: prey.cell.y };

      // Herding: push prey towards a spike rather than simply at it. Only the
      // top level does this, and it is the one thing it does that the level
      // below does not.
      if (skill.usesSpikes && prey.cell.mass >= t.spikeMass) {
        const spike = this.#nearestSpike(prey.cell.x, prey.cell.y);
        if (spike) {
          bot.goal = {
            x: prey.cell.x + (prey.cell.x - spike.x) * 0.4,
            y: prey.cell.y + (prey.cell.y - spike.y) * 0.4,
          };
        }
      }

      // SPLITTING, which is where a bad decision costs the most.
      const reaches = prey.d < splitReach(head.mass, t);
      const worth = head.mass / 2 > prey.cell.mass * t.eatRatio;
      const punished = this.#punisher(head, mine) !== null;
      const shouldSplit = skill.checksSplitReach
        ? reaches && worth && !(skill.checksPunish && punished)
        : prey.d < 420;                       // "roughly in front of me"
      if (shouldSplit && head.mass >= t.splitMinMass) {
        this.split(bot.id, prey.cell.x, prey.cell.y);
      }
      return;
    }

    // 3. GRAZE. A nearby pellet, avoiding spikes if big enough to care.
    //
    // SAMPLED, not searched. Asking every bot about every one of fifteen
    // hundred pellets is ten thousand distance checks a frame for a decision
    // that does not need to be optimal -- "head for that crumb over there" is
    // what grazing looks like, and the nearest crumb of fifteen hundred is not
    // a behaviour anybody could tell apart from a near one.
    let food = null;
    for (let i = 0; i < 48 && this.pellets.length; i++) {
      const pellet = this.pellets[(Math.random() * this.pellets.length) | 0];
      const d = Math.hypot(pellet.x - head.x, pellet.y - head.y);
      if (!food || d < food.d) food = { pellet, d };
    }
    bot.goal = food ? { x: food.pellet.x, y: food.pellet.y } : this.#randomPoint();

    if (skill.avoidsSpikes && head.mass >= t.spikeMass) {
      const spike = this.#nearestSpike(head.x, head.y);
      if (spike && Math.hypot(spike.x - head.x, spike.y - head.y)
        < radiusOf(head.mass, t) + t.spikeRadius + 60) {
        bot.goal = {
          x: head.x + (head.x - spike.x),
          y: head.y + (head.y - spike.y),
        };
      }
    }
  }

  /** Is this morsel sitting in the shadow of something much bigger? */
  #guarded(target, hunter) {
    for (const other of this.cells) {
      if (other === target || other.owner === target.owner) continue;
      if (!canEat(other.mass, hunter.mass, this.t)) continue;
      if (Math.hypot(other.x - target.x, other.y - target.y) < 220) return true;
    }
    return false;
  }

  /** Anything close enough to eat the halves if this cell split right now. */
  #punisher(head, mine) {
    const half = head.mass / 2;
    for (const other of this.cells) {
      if (mine.includes(other)) continue;
      if (!canEat(other.mass, half, this.t)) continue;
      if (Math.hypot(other.x - head.x, other.y - head.y)
        < splitReach(other.mass, this.t) + 120) return other;
    }
    return null;
  }

  #nearestSpike(x, y) {
    let best = null;
    for (const spike of this.spikes) {
      const d = Math.hypot(spike.x - x, spike.y - y);
      if (!best || d < best.d) best = { ...spike, d, x: spike.x, y: spike.y };
    }
    return best;
  }
}
