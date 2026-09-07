// games/winter/camp.js
//
// Winter Base Building's simulation: the camp, the days, the night, and the
// wolves that come every seventh one. No canvas, no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// A survival game that is not tense is a chore list, and the difference
// between the two is entirely a matter of numbers. This one rests on a single
// claim:
//
//   WOOD IS DUAL-PURPOSE AND GENUINELY SCARCE, so a player must choose
//   between burning it and building with it, and can be caught choosing
//   wrong.
//
// The failure that makes the game interesting is "I built the wall and froze"
// or "I stayed warm and the wall fell". The failure that makes it a chore list
// is "I did not gather enough". Those are different games and only the numbers
// tell you which one you have built.
//
// So the numbers are here, free of the DOM, and tests/winter.camp.test.mjs
// plays them with four DIFFERENT STRATEGIES rather than two skill levels —
// because the question is not "how good is the player", it is "does the choice
// exist at all". A wood-first strategy that comfortably satisfies both uses
// would prove the tension is imaginary.
//
// THE TWO THREATS ARE DELIBERATELY SEPARATE
// -----------------------------------------
// Bears are the risk of GOING OUT. Wolves are the risk of the DEADLINE. If the
// same animal did both, "hunt carefully" and "be ready on day seven" would be
// one pressure felt twice, and the week would have no shape. Keeping them
// apart is what gives the seventh day its weight.
//
// WHY WOLVES AND NOT A BLIZZARD
// -----------------------------
// A blizzard is a fuel drain, and a fuel drain collapses into "did you
// stockpile enough wood" — which is the chore list, arriving by the front
// door. Wolves attack the STRUCTURE, so wood has to be spent on walls as well
// as burnt, and the two uses compete for the same pile.

// --- Tuning ---------------------------------------------------------------
//
// A plain object, so a test can clone it, change one figure and run both
// versions side by side. See tests/README.md, convention 3.
//
// Every number here was settled by the harness rather than by feel — see the
// scarcity assertions in the test file, which fail if wood stops being tight.
export const TUNING = {
  // A day is this many actions. The real currency of the game is not wood, it
  // is TIME: three actions is never enough to do everything a day wants.
  actionsPerDay: 3,

  daysPerWeek: 7,

  // Gathering. Falls off as the forest near camp is cleared, which is what
  // stops a long run from becoming comfortable.
  woodPerGather: 10,
  gatherFalloffPerWeek: 0.6,
  minWoodPerGather: 4,

  // Hunting. A bear is the risk of going out; see huntOutcome().
  meatPerHunt: 7,
  bearChanceBase: 0.10,
  bearChancePerWeek: 0.035,
  bearMaxChance: 0.45,
  // A bear WOUNDS. It used to kill: at 22 damage it accounted for a quarter of
  // every strategy's deaths, which made hunting the story instead of the wall.
  // The risk of going out should cost you a day and some blood, not the run.
  bearDamage: 14,
  // A hunt that meets a bear brings nothing home.
  bearMeat: 0,

  // Building. One action converts this much wood into this much wall — and
  // ONE A DAY, which is the rule that makes the whole game work.
  //
  // Without the cap, the dominant strategy is to hoard wood all week and
  // raise the entire wall on the seventh day: wall decay actively rewards
  // building late, so nothing is ever committed and nothing is ever given up.
  // A hoarding bot outlasted the careful one, which is the tension not
  // existing.
  //
  // Capped, a wall has to be built ACROSS the week, which means wood is
  // committed on day two that cannot be burnt on day five. That commitment is
  // the choice the game is about.
  maxBuildsPerDay: 1,
  woodPerBuild: 12,
  wallPerBuild: 14,
  // Walls rot in the cold, so a wall built in week one is not still standing
  // in week five. Without this a player could build far ahead and coast.
  wallDecayPerNight: 2,

  // The night. Both of these rise, and the fuel one is the whole game.
  fuelBase: 7,
  fuelPerWeek: 2,
  foodPerNight: 4,

  // What a cold or hungry night costs.
  freezeDamage: 14,
  starveDamage: 11,

  // A warm, fed night mends a little. This is not generosity — it is what
  // makes the fire worth more than 'avoid taking damage', and it is what lets
  // a careful run outlast a lucky one. Without it every strategy died at
  // roughly the same depth, because damage only ever accumulated and nothing
  // a player did well could undo any of it.
  healPerGoodNight: 7,

  // The wolves, every seventh night.
  packBase: 16,
  packPerWeek: 10,
  // Wall absorbs pack strength one for one. Whatever is left bites.
  //
  // 2.2 rather than 1.6, and the harness picked it. At 1.6 a camp that never
  // built a wall at all could simply absorb the pack on a full health bar and
  // heal it back before the next one, so the wall was not worth what it cost
  // and the whole choice was decorative. At 2.2 a breach of any size is a
  // serious wound and two in a row are fatal.
  wolfDamagePerPoint: 2.2,
  // And they take the larder if they get in.
  wolfMeatLoss: 0.5,

  startingHealth: 100,
  startingWood: 14,
  startingMeat: 8,
  startingWall: 0,
  maxHealth: 100,
};

// --- Derived numbers ------------------------------------------------------
//
// All of these are exported because the HUD shows them and the tests assert on
// them. A player who cannot see what tonight costs cannot choose.

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** Which week a day belongs to. Day 1 is week 1. */
export const weekOf = (day, tuning = TUNING) =>
  Math.floor((day - 1) / tuning.daysPerWeek) + 1;

/** Is this the night the wolves come? */
export const isWolfNight = (day, tuning = TUNING) => day % tuning.daysPerWeek === 0;

/** Wood the fire wants tonight. Rises every week, without a ceiling. */
export const fuelFor = (day, tuning = TUNING) =>
  tuning.fuelBase + (weekOf(day, tuning) - 1) * tuning.fuelPerWeek;

/** How much wood one gather brings back, this deep into a run. */
export const gatherYield = (day, tuning = TUNING) => Math.max(
  tuning.minWoodPerGather,
  Math.round(tuning.woodPerGather - (weekOf(day, tuning) - 1) * tuning.gatherFalloffPerWeek),
);

/** How strong the pack arriving at the end of this week is. */
export const packFor = (day, tuning = TUNING) =>
  tuning.packBase + (weekOf(day, tuning) - 1) * tuning.packPerWeek;

/** The chance a hunt meets a bear. */
export const bearChance = (day, tuning = TUNING) => Math.min(
  tuning.bearMaxChance,
  tuning.bearChanceBase + (weekOf(day, tuning) - 1) * tuning.bearChancePerWeek,
);

// --- The camp -------------------------------------------------------------

export const ACTION = {
  GATHER: 'gather',
  HUNT: 'hunt',
  BUILD: 'build',
};

export const END = {
  FROZE: 'Froze in the night',
  STARVED: 'Starved',
  WOLVES: 'The wolves got in',
  BEAR: 'A bear got you',
};

/**
 * One run. `act` spends an action; `endDay` resolves the night.
 *
 * The game and the bots both drive this, so a bot is playing the same winter a
 * player would.
 */
export class Camp {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.day = 1;
    this.actionsLeft = t.actionsPerDay;
    this.buildsToday = 0;
    this.wood = t.startingWood;
    this.meat = t.startingMeat;
    this.wall = t.startingWall;
    this.health = t.startingHealth;
    this.running = true;
    this.reason = null;
    this.log = [];
    // Presentation reads these; the rules do not.
    this.lastNight = null;
    this.lastHunt = null;
  }

  get week() { return weekOf(this.day, this.t); }
  get fuelTonight() { return fuelFor(this.day, this.t); }
  get wolvesTonight() { return isWolfNight(this.day, this.t); }

  /** Days until the pack arrives, 0 meaning tonight. */
  get daysToWolves() {
    const t = this.t;
    return (t.daysPerWeek - ((this.day - 1) % t.daysPerWeek)) - 1;
  }

  /** The pack that is coming at the end of this week. */
  get comingPack() { return packFor(this.day, this.t); }

  /**
   * How ready the camp is for that pack, as a plain number.
   *
   * Positive means the wall holds with room to spare; negative is how many
   * points of pack will get through. This is the readout the brief asks for,
   * and it is deliberately one number rather than a feeling — a player has to
   * be able to see, on day three, that they are going to lose on day seven.
   */
  get readiness() {
    const nightsLeft = this.daysToWolves;
    const decay = nightsLeft * this.t.wallDecayPerNight;
    return Math.round(this.wall - decay - this.comingPack);
  }

  /** Can a wall be raised right now — wood in hand, and not already built today. */
  get canBuild() {
    return this.wood >= this.t.woodPerBuild && this.buildsToday < this.t.maxBuildsPerDay;
  }

  #die(reason) {
    this.running = false;
    this.reason = reason;
    this.health = 0;
  }

  #hurt(amount, reason) {
    this.health -= amount;
    if (this.health <= 0) this.#die(reason);
  }

  /**
   * Spends one action. Returns what happened, for the log and the screen.
   */
  act(action) {
    if (!this.running || this.actionsLeft <= 0) return null;
    const t = this.t;
    this.actionsLeft--;

    switch (action) {
      case ACTION.GATHER: {
        const got = gatherYield(this.day, t);
        this.wood += got;
        return { action, wood: got };
      }

      case ACTION.HUNT: {
        const met = Math.random() < bearChance(this.day, t);
        if (met) {
          this.lastHunt = { bear: true, meat: t.bearMeat };
          this.meat += t.bearMeat;
          this.#hurt(t.bearDamage, END.BEAR);
          return { action, bear: true, meat: t.bearMeat, damage: t.bearDamage };
        }
        this.meat += t.meatPerHunt;
        this.lastHunt = { bear: false, meat: t.meatPerHunt };
        return { action, bear: false, meat: t.meatPerHunt };
      }

      case ACTION.BUILD: {
        if (this.buildsToday >= t.maxBuildsPerDay) {
          return { action, built: 0, alreadyBuilt: true };
        }
        if (this.wood < t.woodPerBuild) {
          // Not enough wood: the action is still spent, which is the point.
          // Deciding to build and finding you cannot is information the player
          // should have had, and the cost of not looking.
          return { action, built: 0, short: true };
        }
        this.wood -= t.woodPerBuild;
        this.wall += t.wallPerBuild;
        this.buildsToday++;
        return { action, built: t.wallPerBuild };
      }

      default:
        return null;
    }
  }

  /**
   * Resolves the night and moves to the next day.
   *
   * Order matters and is deliberate: fire, then food, then wolves. A player who
   * burns their last wood to stay warm meets the pack behind whatever wall they
   * already had, which is exactly the choice the game is about.
   */
  endDay() {
    if (!this.running) return null;
    const t = this.t;
    const night = {
      day: this.day,
      week: this.week,
      fuelWanted: this.fuelTonight,
      burned: 0,
      froze: false,
      ate: 0,
      starved: false,
      wolves: false,
      packStrength: 0,
      wallBefore: this.wall,
      breached: 0,
    };

    // Fire.
    const burn = Math.min(this.wood, night.fuelWanted);
    this.wood -= burn;
    night.burned = burn;
    if (burn < night.fuelWanted) {
      night.froze = true;
      this.#hurt(t.freezeDamage, END.FROZE);
    }

    // Food.
    if (this.running) {
      const eat = Math.min(this.meat, t.foodPerNight);
      this.meat -= eat;
      night.ate = eat;
      if (eat < t.foodPerNight) {
        night.starved = true;
        this.#hurt(t.starveDamage, END.STARVED);
      }
    }

    // Wolves.
    if (this.running && this.wolvesTonight) {
      night.wolves = true;
      night.packStrength = packFor(this.day, t);
      const through = Math.max(0, night.packStrength - this.wall);
      night.breached = through;
      // The wall takes the hit whether or not it holds.
      this.wall = Math.max(0, this.wall - night.packStrength);
      if (through > 0) {
        this.meat = Math.floor(this.meat * (1 - t.wolfMeatLoss));
        this.#hurt(Math.round(through * t.wolfDamagePerPoint), END.WOLVES);
      }
    }

    // Walls rot.
    if (this.running) this.wall = Math.max(0, this.wall - t.wallDecayPerNight);

    // A night warm and fed, with nothing through the wall, mends a little.
    if (this.running && !night.froze && !night.starved && night.breached === 0) {
      const before = this.health;
      this.health = Math.min(t.maxHealth, this.health + t.healPerGoodNight);
      night.healed = this.health - before;
    }

    this.lastNight = night;
    this.log.push(night);

    if (this.running) {
      this.day++;
      this.actionsLeft = t.actionsPerDay;
      this.buildsToday = 0;
    }
    return night;
  }

  /** Weeks fully survived — the score. */
  get weeksSurvived() {
    return Math.floor((this.day - 1) / this.t.daysPerWeek);
  }
}

// --- The scarcity the whole design rests on -------------------------------

/**
 * What a week actually costs against what a week can actually produce.
 *
 * This is the inequality the game is built on, exposed so the test can assert
 * it rather than infer it from bot outcomes.
 *
 * The first version of this counted only wood and it was misleading: it
 * reported a comfortable surplus every week, because it priced income as if
 * all 21 actions went to gathering. They cannot. You have to eat, so some
 * actions are hunts, and building is itself an action — so every point of wall
 * costs BOTH wood and a gather you did not make. Time is the real currency
 * and wood is only where it shows up.
 *
 * Returns the week's ledger. `slack` is what is left after feeding, burning
 * and walling, and the whole design depends on it going NEGATIVE and staying
 * there — at which point a player is spending a stockpile, and the stockpile
 * is finite.
 */
export function weekBudget(week, tuning = TUNING) {
  const firstDay = (week - 1) * tuning.daysPerWeek + 1;
  const actions = tuning.actionsPerDay * tuning.daysPerWeek;

  // Eating is not optional, so hunts come out of the action budget first.
  // Priced against the bear rate, because a mauled hunt brings nothing home.
  const foodNeeded = tuning.foodPerNight * tuning.daysPerWeek;
  const yieldPerHunt = tuning.meatPerHunt * (1 - bearChance(firstDay, tuning));
  const hunts = Math.ceil(foodNeeded / yieldPerHunt);

  // Then the wall this week's pack needs, including what rots meanwhile.
  const pack = packFor(firstDay, tuning);
  const decay = tuning.wallDecayPerNight * tuning.daysPerWeek;
  const builds = Math.min(
    tuning.daysPerWeek * tuning.maxBuildsPerDay,
    Math.ceil((pack + decay) / tuning.wallPerBuild),
  );

  // Whatever is left over can gather.
  const gathers = Math.max(0, actions - hunts - builds);
  const income = gathers * gatherYield(firstDay, tuning);

  let fuel = 0;
  for (let d = firstDay; d < firstDay + tuning.daysPerWeek; d++) fuel += fuelFor(d, tuning);

  const wallWood = builds * tuning.woodPerBuild;

  return {
    actions, hunts, builds, gathers, income, fuel, wall: wallWood,
    slack: income - fuel - wallWood,
  };
}
