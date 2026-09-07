// games/dungeon-dice/dice.js
//
// Dungeon Dice' simulation: the pool, the roll, the things you can do to a roll
// you do not like, and the floors that keep coming. No canvas, no input device,
// no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// A dice game has one way of being bad and it is fatal: the dice decide and
// the player watches. So the whole design rests on a claim, and the claim is
// about numbers:
//
//   THE DEPTH IS IN THE MANIPULATION. A player who works a bad roll must beat
//   one who takes what they are given, and a run must almost never end on a
//   turn where nothing could have been done.
//
// Two separate things, and they fail in different ways, so they are measured
// separately in tests/dungeon-dice.dice.test.mjs:
//
//   WORTH IT       a bot that rerolls and nudges beats a bot that does not. If
//                  it does not, every tool in the game is decoration and the
//                  player is a spectator with a scoreboard.
//   NOT A ROBBERY  when a run ends, there was something the player could have
//                  done. Measured by exhaustively searching every legal
//                  sequence of manipulations on the losing turn and asking
//                  whether ANY of them survived. A game that kills you with no
//                  out is not hard, it is rude.
//
// WHY THE DECISION IS THE MANIPULATION AND NOTHING ELSE
// -----------------------------------------------------
// Faces resolve themselves: swords hit, shields block, hearts heal. There is
// no clever assignment step, because an assignment puzzle would be a second
// source of difficulty and would muddy the measurement of the first. What the
// player decides is what to do about the roll — reroll it, bend a face, bank a
// die — and how to spend the charges that pay for all three. So when the bots
// separate, the gap is the manipulation and cannot be anything else.

// --- Faces ----------------------------------------------------------------

export const FACE = {
  SWORD: 'sword',   // damage
  SHIELD: 'shield', // blocks the telegraphed hit
  HEART: 'heart',   // heals
  BOLT: 'bolt',     // the currency every manipulation is paid for in
  BLANK: 'blank',   // nothing, and the thing upgrades replace
};

// The order a nudge walks along. Deliberately a RING and deliberately this
// order: a blank is one step from a bolt, so the worst face is always one
// charge away from the face that buys more charges. That is what stops a
// terrible roll being a dead roll.
export const NUDGE_RING = [FACE.BLANK, FACE.BOLT, FACE.SHIELD, FACE.SWORD, FACE.HEART];

/** The face one nudge away, in the given direction. */
export function nudged(face, direction = 1) {
  const i = NUDGE_RING.indexOf(face);
  if (i < 0) return face;
  const n = NUDGE_RING.length;
  return NUDGE_RING[(i + direction + n) % n];
}

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  poolSize: 5,

  // The starting die. Two swords, a shield, a heart, a bolt and a blank — so
  // an average roll does a bit of everything and no roll is all of one thing.
  startingFaces: [FACE.SWORD, FACE.SWORD, FACE.SHIELD, FACE.HEART, FACE.BOLT, FACE.BLANK],

  // What a face is worth.
  damagePerSword: 3,
  blockPerShield: 3,
  healPerHeart: 2,

  // What manipulation costs, in bolts. These three numbers are the game.
  rerollCost: 1,
  nudgeCost: 1,
  bankCost: 1,
  // Free rerolls at the start of every turn, before bolts are touched. One is
  // deliberate: enough that a hopeless roll is never simply accepted, not so
  // many that the first roll stops mattering.
  freeRerolls: 1,
  maxBanked: 2,
  // CHARGES CARRY OVER, and this is the line that stops the dice robbing you.
  //
  // Bolts used to exist only for the turn they were rolled. A starting die has
  // one bolt face in six, so over five dice a turn produced none about four
  // times in ten — and on those turns there was no manipulation available at
  // all, only the single free reroll. A quarter of all deaths turned out to
  // have had no possible out, which for a dice game is the whole failure mode
  // in one number.
  //
  // Banking them turns that around: charges accumulate on the turns you do not
  // need them and are there on the turn you do. It also adds the one decision
  // the game was missing — spend now, or save for what is winding up.
  maxCharges: 8,

  // The player.
  startingHp: 24,
  maxHp: 24,

  // Enemies. A floor is a queue of them, and both the queue and the enemies
  // grow without a ceiling.
  enemyHpBase: 7,
  enemyHpPerFloor: 1.7,
  enemyDamageBase: 3,
  enemyDamagePerFloor: 0.45,
  enemiesPerFloorBase: 2,
  enemiesPerFloorGrowth: 0.2,
  // A wind-up: an enemy telegraphs the hit this many turns before it lands, so
  // a shield is a decision rather than a guess — and so a queue of enemies
  // does not all swing on the same turn.
  windUp: 2,

  // Between floors, a choice of three from this many candidate upgrades.
  upgradeChoices: 3,
  healBetweenFloors: 5,
  // What sharpening and reinforcing are worth. THE PLAYER'S CEILING HAS TO
  // SCALE OR THE DICE START ROBBING YOU.
  //
  // Without these the best possible block was five shields at three apiece,
  // fifteen, forever — while incoming damage climbed past it around floor ten.
  // From there no roll of any kind survived a full landing, so 28% of deaths
  // had no out. That is not difficulty, it is the game running out of answers
  // before the player does.
  sharpenStep: 1,
  reinforceStep: 1,
};

export const END = {
  KILLED: 'Killed on floor',
};

// --- Dice -----------------------------------------------------------------

/** One die: six faces, and any of them can be upgraded later. */
export class Die {
  constructor(faces) {
    this.faces = [...faces];
  }

  roll() {
    return this.faces[(Math.random() * this.faces.length) | 0];
  }

  /** Replace the first face of `from` with `to`. Returns whether it happened. */
  upgrade(from, to) {
    const i = this.faces.indexOf(from);
    if (i < 0) return false;
    this.faces[i] = to;
    return true;
  }

  /** How many of the six faces are this. */
  count(face) {
    return this.faces.filter((f) => f === face).length;
  }
}

/** What a set of shown faces is worth, before anything is spent. */
export function tally(faces, t = TUNING) {
  const count = (f) => faces.filter((x) => x === f).length;
  return {
    damage: count(FACE.SWORD) * t.damagePerSword,
    block: count(FACE.SHIELD) * t.blockPerShield,
    heal: count(FACE.HEART) * t.healPerHeart,
    bolts: count(FACE.BOLT),
    blanks: count(FACE.BLANK),
  };
}

// --- Floors ---------------------------------------------------------------

export const enemyHp = (floor, t = TUNING) =>
  Math.round(t.enemyHpBase + (floor - 1) * t.enemyHpPerFloor);

export const enemyDamage = (floor, t = TUNING) =>
  Math.round(t.enemyDamageBase + (floor - 1) * t.enemyDamagePerFloor);

export const enemiesOnFloor = (floor, t = TUNING) =>
  Math.round(t.enemiesPerFloorBase + (floor - 1) * t.enemiesPerFloorGrowth);

/** The upgrades on offer after a floor. */
export const UPGRADE = {
  FACE: 'face',           // turn a blank into something
  REROLL: 'reroll',       // one more free reroll every turn
  HEART: 'maxhp',         // more hull
  SHARPEN: 'sharpen',     // every sword hits harder
  REINFORCE: 'reinforce', // every shield blocks more
};

/**
 * Three offers, drawn so that there is always something useful but never the
 * same three twice running.
 */
export function offerUpgrades(run, t = TUNING) {
  const offers = [];
  const blanks = run.pool.reduce((sum, die) => sum + die.count(FACE.BLANK), 0);
  if (blanks > 0) {
    for (const to of [FACE.SWORD, FACE.SHIELD, FACE.BOLT]) {
      offers.push({ kind: UPGRADE.FACE, to, label: `A blank face becomes ${to}` });
    }
  }
  offers.push({ kind: UPGRADE.REROLL, label: 'One more free reroll each turn' });
  offers.push({ kind: UPGRADE.HEART, label: `+4 max health, and heal ${t.healBetweenFloors}` });
  offers.push({ kind: UPGRADE.SHARPEN, label: `Every sword hits for ${t.sharpenStep} more` });
  offers.push({ kind: UPGRADE.REINFORCE, label: `Every shield blocks ${t.reinforceStep} more` });

  // Shuffled, then cut to the offer count.
  for (let i = offers.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [offers[i], offers[j]] = [offers[j], offers[i]];
  }
  return offers.slice(0, t.upgradeChoices);
}

// --- The run --------------------------------------------------------------

/**
 * One descent.
 *
 * A turn is: `roll()`, then any number of `reroll()`, `nudge()` and `bank()`,
 * then `commit()`. Nothing resolves until commit, so a bot and a player are
 * making exactly the same decisions in exactly the same order.
 */
export class Run {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.pool = Array.from({ length: t.poolSize }, () => new Die(t.startingFaces));
    // What a face is worth THIS RUN. Sharpening and reinforcing move these, so
    // the player's ceiling climbs alongside the dungeon's.
    this.rates = {
      damagePerSword: t.damagePerSword,
      blockPerShield: t.blockPerShield,
      healPerHeart: t.healPerHeart,
    };
    this.hp = t.startingHp;
    this.maxHp = t.maxHp;
    this.freeRerolls = t.freeRerolls;
    this.floor = 1;
    this.floorsCleared = 0;
    this.running = true;
    this.reason = null;
    this.banked = [];        // faces carried into the next turn
    this.charges = 0;        // manipulation currency, kept between turns
    this.shown = [];         // what is on the table right now
    this.rerollsLeft = 0;
    this.turn = 0;
    // Bookkeeping the tests read.
    this.rerollsUsed = 0;
    this.nudgesUsed = 0;
    this.banksUsed = 0;
    this.enterFloor();
  }

  enterFloor() {
    const t = this.t;
    const count = enemiesOnFloor(this.floor, t);
    this.enemies = Array.from({ length: count }, (_, i) => ({
      id: i,
      hp: enemyHp(this.floor, t),
      maxHp: enemyHp(this.floor, t),
      // Staggered wind-ups, so they do not all land on the same turn and a
      // shield is worth having every turn rather than every third.
      wind: (i % (t.windUp + 1)),
      damage: enemyDamage(this.floor, t),
    }));
    this.turn = 0;
    this.roll();
  }

  /** Fresh faces for the turn. Banked dice come back and are not rerolled. */
  roll() {
    const t = this.t;
    const banked = this.banked;
    this.banked = [];
    const rolled = [];
    for (let i = banked.length; i < t.poolSize; i++) rolled.push(this.pool[i].roll());
    this.shown = [...banked, ...rolled];
    this.rerollsLeft = this.freeRerolls;
    // Bolts on the table become charges immediately, and charges keep.
    this.charges = Math.min(t.maxCharges, this.charges + tally(this.shown, this.rates).bolts);
    this.turn++;
    return this.shown;
  }

  /** What the current table is worth, at this run's rates. */
  get table() { return tally(this.shown, this.rates); }

  /** Total damage arriving at the end of this turn. */
  get incoming() {
    return this.enemies.reduce((sum, e) => sum + (e.wind === 0 ? e.damage : 0), 0);
  }

  /** Can this manipulation be paid for? */
  canAfford(cost) {
    return this.charges >= cost;
  }

  /**
   * Reroll the dice at these indexes. Free while `rerollsLeft` holds out, then
   * a bolt each.
   */
  reroll(indexes) {
    if (!this.running || indexes.length === 0) return false;
    if (this.rerollsLeft > 0) {
      this.rerollsLeft--;
    } else {
      if (!this.canAfford(this.t.rerollCost)) return false;
      this.charges -= this.t.rerollCost;
    }
    for (const i of indexes) {
      if (i < 0 || i >= this.shown.length) continue;
      const was = this.shown[i];
      this.shown[i] = this.pool[i].roll();
      // A bolt that is rerolled away was already banked; a new one banks now.
      if (was !== FACE.BOLT && this.shown[i] === FACE.BOLT) {
        this.charges = Math.min(this.t.maxCharges, this.charges + 1);
      }
    }
    this.rerollsUsed++;
    return true;
  }

  /** Bend one die one step along the ring. Costs a bolt. */
  nudge(index, direction = 1) {
    if (!this.running) return false;
    if (index < 0 || index >= this.shown.length) return false;
    if (!this.canAfford(this.t.nudgeCost)) return false;
    this.charges -= this.t.nudgeCost;
    this.shown[index] = nudged(this.shown[index], direction);
    if (this.shown[index] === FACE.BOLT) {
      this.charges = Math.min(this.t.maxCharges, this.charges + 1);
    }
    this.nudgesUsed++;
    return true;
  }

  /** Carry a die into the next turn instead of resolving it. Costs a bolt. */
  bank(index) {
    if (!this.running) return false;
    if (this.banked.length >= this.t.maxBanked) return false;
    if (index < 0 || index >= this.shown.length) return false;
    if (!this.canAfford(this.t.bankCost)) return false;
    const face = this.shown[index];
    this.charges -= this.t.bankCost;
    this.banked.push(face);
    this.shown.splice(index, 1);
    this.banksUsed++;
    return true;
  }


  /** Resolve the table: you hit, you heal, then whatever is winding up lands. */
  commit(targetId = null) {
    if (!this.running) return null;
    const t = this.t;
    const table = this.table;

    const result = {
      damage: table.damage, block: table.block, heal: table.heal,
      killed: [], taken: 0, floorCleared: false,
    };

    // Damage all goes to one enemy — the chosen one, or the weakest that the
    // hit would finish, or the front of the queue.
    if (table.damage > 0 && this.enemies.length) {
      const target = this.enemies.find((e) => e.id === targetId)
        ?? this.enemies.find((e) => e.hp <= table.damage)
        ?? this.enemies[0];
      target.hp -= table.damage;
      if (target.hp <= 0) result.killed.push(target.id);
    }

    if (table.heal > 0) this.hp = Math.min(this.maxHp, this.hp + table.heal);

    // Everything that was winding up lands now, against the block on the table.
    const incoming = this.incoming;
    const taken = Math.max(0, incoming - table.block);
    result.taken = taken;
    this.hp -= taken;

    this.enemies = this.enemies.filter((e) => e.hp > 0);
    for (const e of this.enemies) e.wind = e.wind === 0 ? t.windUp : e.wind - 1;

    if (this.hp <= 0) {
      this.hp = 0;
      this.running = false;
      this.reason = `${END.KILLED} ${this.floor}`;
      return result;
    }

    if (this.enemies.length === 0) {
      result.floorCleared = true;
      this.floorsCleared++;
      this.floor++;
      this.pendingUpgrades = offerUpgrades(this, t);
    } else {
      this.roll();
    }
    return result;
  }

  /** Take one of the offers and go down. */
  takeUpgrade(offer) {
    const t = this.t;
    if (offer) {
      if (offer.kind === UPGRADE.FACE) {
        const die = this.pool.find((d) => d.count(FACE.BLANK) > 0) ?? this.pool[0];
        die.upgrade(FACE.BLANK, offer.to);
      } else if (offer.kind === UPGRADE.REROLL) {
        this.freeRerolls++;
      } else if (offer.kind === UPGRADE.HEART) {
        this.maxHp += 4;
        this.hp = Math.min(this.maxHp, this.hp + t.healBetweenFloors);
      } else if (offer.kind === UPGRADE.SHARPEN) {
        this.rates.damagePerSword += t.sharpenStep;
      } else if (offer.kind === UPGRADE.REINFORCE) {
        this.rates.blockPerShield += t.reinforceStep;
      }
    }
    this.pendingUpgrades = null;
    this.enterFloor();
  }

  /** Floors fully cleared — the score. */
  get score() { return this.floorsCleared; }
}

// --- Was there anything you could have done? ------------------------------

/**
 * Could this turn have been survived at all?
 *
 * Searches every legal sequence of manipulations up to `depth` operations and
 * asks whether ANY of them leaves the player alive. Rerolls are random, so
 * they are sampled rather than enumerated — which makes a `true` answer proof
 * (a route was found) and a `false` answer a strong maybe. That asymmetry is
 * the right way round, exactly as it is for the mini golf generator and the
 * Rift Runner solver: being told there was an out you missed is fair; being
 * told there was none when there was would be the lie.
 *
 * This is what makes "the dice did not rob you" a measured claim rather than a
 * hope. It is not used by the game — only by the tests.
 */
export function hadAnOut(snapshot, options = {}) {
  const t = options.tuning ?? TUNING;
  const samples = options.samples ?? 40;
  const depth = options.depth ?? 3;

  const rates = snapshot.rates ?? t;
  const survives = (shown, hp) => {
    const table = tally(shown, rates);
    return hp + table.heal - Math.max(0, snapshot.incoming - table.block) > 0;
  };

  // Doing nothing at all.
  if (survives(snapshot.shown, snapshot.hp)) return true;

  const search = (shown, charges, rerollsLeft, left) => {
    if (left === 0) return false;

    // Nudge each die each way.
    if (charges >= t.nudgeCost) {
      for (let i = 0; i < shown.length; i++) {
        for (const dir of [1, -1]) {
          const next = [...shown];
          next[i] = nudged(next[i], dir);
          // A nudge that lands on a bolt pays for part of itself.
          const after = charges - t.nudgeCost + (next[i] === FACE.BOLT ? 1 : 0);
          if (survives(next, snapshot.hp)) return true;
          if (search(next, after, rerollsLeft, left - 1)) return true;
        }
      }
    }

    // Reroll the useless dice, sampled.
    const junk = shown
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f === FACE.BLANK)
      .map(({ i }) => i);
    if (junk.length && (rerollsLeft > 0 || charges >= t.rerollCost)) {
      for (let s = 0; s < samples; s++) {
        const next = [...shown];
        for (const i of junk) next[i] = snapshot.pool[i].roll();
        if (survives(next, snapshot.hp)) return true;
        const after = rerollsLeft > 0 ? charges : charges - t.rerollCost;
        if (search(next, after, Math.max(0, rerollsLeft - 1), left - 1)) return true;
      }
    }
    return false;
  };

  return search([...snapshot.shown], snapshot.charges, snapshot.rerollsLeft, depth);
}
