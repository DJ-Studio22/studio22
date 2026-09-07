// games/asteroid-salvage/flight.js
//
// Asteroid Salvage's simulation: the ship, the field, the salvage, and the
// three things you can spend it on. No canvas, no input device, no clock.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// The game rests on a claim that upgrade games almost always get wrong:
//
//   THE THREE UPGRADES COMPETE. There is no order that is simply correct.
//
// That is the trap the real-time Winter prototype walked into and was rejected
// for — three sinks on one pool, and one of them pays back fastest, so every
// run buys the same thing first and the shop is a shopping list with a price
// on it. It is not a thing you can hope your way out of; it has to be built in
// and then measured.
//
// Two mechanisms do it here, and both are physical rather than arithmetical:
//
//   MASS. Hull and cargo bays are made of something. Every level of either
//   makes the ship heavier, and acceleration is thrust divided by mass — so
//   armour literally slows you down and the engine you did not buy is the
//   reason you cannot dodge. The upgrades interfere rather than stacking.
//
//   THE FIELD HAS A CHARACTER. Some fields are DENSE — many rocks, slowly —
//   and reward a ship that can thread them. Some are FAST — few rocks, quickly
//   — and reward a ship that can take the one you did not see. The mix is
//   drawn per field, so which upgrade was the right one changes inside a
//   single run, and a build chosen in advance is a build that is wrong half
//   the time.
//
// tests/asteroid-salvage.flight.test.mjs runs fixed purchase orders against
// each other and requires that none of them dominates.

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The box the ship flies in, in world units.
  width: 100,
  height: 60,

  // The ship, unupgraded.
  shipRadius: 1.5,
  baseThrust: 210,        // world units per second squared, before mass
  baseMass: 1.0,
  drag: 1.9,
  baseHull: 4,
  baseCollect: 2.6,

  // What each level of each upgrade does — and what it costs you elsewhere.
  // These three numbers ARE the claim, and the sweep set them.
  //
  // At +2 hull for 0.30 mass, armour was simply the best buy: hullFirst won 23
  // of 40 seeds and the shop was a shopping list with a price on it — the
  // failure the whole design exists to avoid. A hit point for half a level of
  // sluggishness is a real trade; two hit points for a third of one is not.
  enginePerLevel: 68,     // thrust
  hullPerLevel: 1,        // hit points
  hullMassPerLevel: 0.55, // ...and this much more to shift
  collectPerLevel: 1.5,   // collection radius
  cargoMassPerLevel: 0.16,

  // Prices. They rise, so a level bought late costs more than one bought
  // early — which is what makes the ORDER a decision rather than just the set.
  costBase: 9,
  costGrowth: 1.55,
  maxLevel: 6,

  // A field, and how they escalate. No ceiling on either axis.
  fieldSeconds: 26,
  // Four rocks, not thirteen. At thirteen — nearly twenty-five once a dense
  // field multiplied it — every bot died inside the first field with three
  // hits and five salvage, and the shop was never reached at all. A game whose
  // whole claim is about the shop has to let you get to one.
  rocksBase: 4,
  rocksPerField: 0.8,
  rockSpeedBase: 12,
  rockSpeedPerField: 1.5,
  rockRadiusMin: 1.2,
  rockRadiusMax: 3.4,

  // THE CHARACTER OF A FIELD, drawn per field. `mix` runs 0 (all density) to
  // 1 (all speed); the two ends want opposite ships.
  denseMultiplier: 1.9,   // how much a fully dense field multiplies rock count
  fastMultiplier: 1.7,    // how much a fully fast field multiplies rock speed

  salvagePerField: 9,
  salvageValue: 1,
  salvageSpeed: 9,

  // Getting hit. A grace period, or a rock you are already inside eats the
  // whole hull in a second.
  invulnerableSeconds: 1.1,

  // THE ROOM A FIELD OPENS WITH, and the hand-play is why it exists.
  //
  // A field's opening rocks are scattered across the whole width so it does not
  // begin empty — but nothing stopped one being scattered ON TOP OF THE SHIP.
  // Five seconds of touching nothing at all, on the very first field, and the
  // hull was already down to three of four. A player has not agreed to play
  // yet when a field opens.
  //
  // So the opening scatter leaves this much clear around where the ship
  // starts. It is a number somebody chose, which is the point.
  spawnClearRadius: 22,

  // And two seconds of shield when a field opens.
  //
  // Clearing the spawn was not enough on its own: rocks keep arriving from the
  // right, so a ship sitting still while its pilot reads the screen was down to
  // two hull of four after five seconds of the FIRST field. A field opening is
  // also a shop closing, and a player who has just been reading prices has not
  // re-oriented yet.
  //
  // It is the shield that already exists, so it announces itself: the ship
  // flickers exactly as it does after a hit.
  openingGraceSeconds: 2.0,
};

export const END = { WRECKED: 'Wrecked' };

export const UPGRADE = { ENGINE: 'engine', HULL: 'hull', CARGO: 'cargo' };
export const UPGRADES = [UPGRADE.ENGINE, UPGRADE.HULL, UPGRADE.CARGO];

// --- Derived numbers ------------------------------------------------------
//
// All exported, because the shop shows them and the tests assert on them. A
// player who cannot see what a level buys cannot choose between two.

export const thrustAt = (engineLevel, t = TUNING) =>
  t.baseThrust + engineLevel * t.enginePerLevel;

export const hullAt = (hullLevel, t = TUNING) =>
  t.baseHull + hullLevel * t.hullPerLevel;

export const collectAt = (cargoLevel, t = TUNING) =>
  t.baseCollect + cargoLevel * t.collectPerLevel;

/** Everything you bolt on is made of something. */
export const massAt = (hullLevel, cargoLevel, t = TUNING) =>
  t.baseMass + hullLevel * t.hullMassPerLevel + cargoLevel * t.cargoMassPerLevel;

/**
 * What the ship can actually do, which is thrust divided by what it is
 * carrying.
 *
 * THE LINE THAT MAKES THE UPGRADES COMPETE. Armour is not free: three levels
 * of hull is nearly a doubling of mass, and a heavy ship with a stock engine
 * accelerates worse than the one it started as.
 */
export const accelerationAt = (engineLevel, hullLevel, cargoLevel, t = TUNING) =>
  thrustAt(engineLevel, t) / massAt(hullLevel, cargoLevel, t);

/** What the next level of something costs. */
export const costOf = (level, t = TUNING) =>
  Math.round(t.costBase * (t.costGrowth ** level));

// --- Fields ---------------------------------------------------------------

/**
 * The shape of field number `n`, given its character.
 *
 * `mix` is 0 for wholly dense and 1 for wholly fast. Both axes still escalate
 * with the field number underneath, so a late fast field is worse than an
 * early one in both directions — the character decides which way it leans, not
 * whether it is hard.
 */
export function fieldShape(n, mix, t = TUNING) {
  const dense = 1 + (1 - mix) * (t.denseMultiplier - 1);
  const fast = 1 + mix * (t.fastMultiplier - 1);
  return {
    rocks: Math.round((t.rocksBase + (n - 1) * t.rocksPerField) * dense),
    speed: (t.rockSpeedBase + (n - 1) * t.rockSpeedPerField) * fast,
    mix,
    dense,
    fast,
    // What the field is called on screen. A player who cannot tell a dense
    // field from a fast one before flying into it cannot choose a build for it.
    name: mix < 0.34 ? 'Dense' : mix > 0.66 ? 'Fast' : 'Mixed',
  };
}

// --- The run --------------------------------------------------------------

/**
 * One salvage run.
 *
 * `step(dt, input)` is the whole game; game.js only draws what this says is
 * true. `input` is { x, y } — a thrust vector, nothing else — so a stick, a
 * keyboard and a thumb are all playing the same game.
 */
export class Flight {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.engine = 0;
    this.hullLevel = 0;
    this.cargo = 0;
    this.hull = hullAt(0, t);
    this.salvage = 0;
    this.banked = 0;          // total ever collected — the score
    this.field = 1;
    this.fieldsCleared = 0;
    this.running = true;
    this.reason = null;
    this.shopOpen = false;
    this.invulnerable = 0;
    this.hits = 0;
    this.x = t.width * 0.22;
    this.y = t.height / 2;
    this.vx = 0;
    this.vy = 0;
    this.enterField();
  }

  enterField() {
    const t = this.t;
    // THE NEXT FIELD IS ANNOUNCED, and this is the line that makes the shop a
    // decision rather than a guess.
    //
    // The character used to be drawn on entering the field — after the shop
    // had closed. So a player, and the adaptive bot, could only buy against
    // the field just flown, which predicts nothing: the draw is independent.
    // The bot that "read the field" was reading noise, and measured as no
    // better than buying blind, which is exactly right and exactly useless.
    //
    // Drawn one field ahead and shown in the shop, the same mechanism becomes
    // what it was meant to be: "the next one is Fast — is that worth a level
    // of hull, or do I bank it".
    this.shape = this.nextShape ?? fieldShape(this.field, Math.random(), t);
    this.nextShape = fieldShape(this.field + 1, Math.random(), t);
    this.left = t.fieldSeconds;
    this.rocks = [];
    this.salvagePieces = [];
    for (let i = 0; i < this.shape.rocks; i++) this.#spawnRock(true);
    for (let i = 0; i < t.salvagePerField; i++) this.#spawnSalvage(true);
    this.invulnerable = Math.max(this.invulnerable, t.openingGraceSeconds);
    this.shopOpen = false;
  }

  #spawnRock(anywhere = false) {
    const t = this.t;
    let x = anywhere ? Math.random() * t.width : t.width + 4;
    let y = Math.random() * t.height;
    if (anywhere) {
      // Keep the opening scatter off the ship. Tried a handful of times and
      // then pushed out to the right rather than looped forever, because a
      // crowded field must still be able to fill.
      for (let attempt = 0; attempt < 12; attempt++) {
        if (Math.hypot(x - this.x, y - this.y) >= t.spawnClearRadius) break;
        x = Math.random() * t.width;
        y = Math.random() * t.height;
      }
      if (Math.hypot(x - this.x, y - this.y) < t.spawnClearRadius) x = t.width - 2;
    }
    this.rocks.push({
      x,
      y,
      r: t.rockRadiusMin + Math.random() * (t.rockRadiusMax - t.rockRadiusMin),
      vx: -this.shape.speed * (0.7 + Math.random() * 0.6),
      vy: (Math.random() - 0.5) * this.shape.speed * 0.16,
      spin: (Math.random() - 0.5) * 2,
    });
  }

  #spawnSalvage(anywhere = false) {
    const t = this.t;
    this.salvagePieces.push({
      x: anywhere ? Math.random() * t.width : t.width + 3,
      y: Math.random() * t.height,
      vx: -t.salvageSpeed,
      taken: false,
    });
  }

  get thrust() { return thrustAt(this.engine, this.t); }
  get mass() { return massAt(this.hullLevel, this.cargo, this.t); }
  get acceleration() { return accelerationAt(this.engine, this.hullLevel, this.cargo, this.t); }
  get collectRadius() { return collectAt(this.cargo, this.t); }
  get hullMax() { return hullAt(this.hullLevel, this.t); }

  /** What the next level of each upgrade costs, and whether it is affordable. */
  get prices() {
    const t = this.t;
    const level = { engine: this.engine, hull: this.hullLevel, cargo: this.cargo };
    const out = {};
    for (const kind of UPGRADES) {
      const at = level[kind === UPGRADE.HULL ? 'hull' : kind];
      const maxed = at >= t.maxLevel;
      const price = costOf(at, t);
      out[kind] = { level: at, price, maxed, afford: !maxed && this.salvage >= price };
    }
    return out;
  }

  /** Buy one. Returns whether it happened. */
  buy(kind) {
    const price = this.prices[kind];
    if (!price || price.maxed || !price.afford) return false;
    this.salvage -= price.price;
    if (kind === UPGRADE.ENGINE) this.engine++;
    else if (kind === UPGRADE.HULL) { this.hullLevel++; this.hull += this.t.hullPerLevel; }
    else this.cargo++;
    return true;
  }

  /** Leave the shop and fly the next field. */
  launch() {
    if (!this.shopOpen) return false;
    this.field++;
    this.enterField();
    return true;
  }

  #hit() {
    if (this.invulnerable > 0) return;
    this.hull--;
    this.hits++;
    this.invulnerable = this.t.invulnerableSeconds;
    if (this.hull <= 0) {
      this.hull = 0;
      this.running = false;
      this.reason = END.WRECKED;
    }
  }

  /** One frame. */
  step(dt, input = {}) {
    if (!this.running || this.shopOpen) return;
    const t = this.t;

    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);

    // Thrust, divided by what the ship is carrying.
    const push = Math.hypot(input.x ?? 0, input.y ?? 0);
    if (push > 0.15) {
      const scale = Math.min(1, push) / push;
      const a = this.acceleration;
      this.vx += (input.x * scale) * a * dt;
      this.vy += (input.y * scale) * a * dt;
    }
    const decay = Math.max(0, 1 - t.drag * dt);
    this.vx *= decay;
    this.vy *= decay;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // The walls are walls, not wrap-around: being pinned against one is a
    // position you can be manoeuvred into, which is most of the tension.
    if (this.x < t.shipRadius) { this.x = t.shipRadius; this.vx = 0; }
    if (this.x > t.width - t.shipRadius) { this.x = t.width - t.shipRadius; this.vx = 0; }
    if (this.y < t.shipRadius) { this.y = t.shipRadius; this.vy = 0; }
    if (this.y > t.height - t.shipRadius) { this.y = t.height - t.shipRadius; this.vy = 0; }

    for (const rock of this.rocks) {
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      if (rock.y < rock.r || rock.y > t.height - rock.r) rock.vy = -rock.vy;
      if (Math.hypot(rock.x - this.x, rock.y - this.y) < rock.r + t.shipRadius) this.#hit();
    }
    this.rocks = this.rocks.filter((r) => r.x > -6);
    while (this.rocks.length < this.shape.rocks) this.#spawnRock();

    for (const piece of this.salvagePieces) {
      piece.x += piece.vx * dt;
      if (piece.taken) continue;
      if (Math.hypot(piece.x - this.x, piece.y - this.y) < this.collectRadius) {
        piece.taken = true;
        this.salvage += t.salvageValue;
        this.banked += t.salvageValue;
      }
    }
    this.salvagePieces = this.salvagePieces.filter((p) => p.x > -4 && !p.taken);
    while (this.salvagePieces.length < t.salvagePerField) this.#spawnSalvage();

    if (!this.running) return;

    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.fieldsCleared++;
      this.shopOpen = true;
    }
  }

  /** Salvage collected — the score. */
  get score() { return this.banked; }
}
