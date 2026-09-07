// games/pixel-paintball/arena.js
//
// Pixel Paintball's simulation: the grid, the paint, the bots, and the wave
// clock. No canvas, no input device, no audio.
//
// WHAT THE GAME IS ABOUT
// ----------------------
// Territory held is the score, and that one decision changes what a shooter
// is. Splattering a bot scores you nothing directly — it stops that bot
// painting for a few seconds and leaves a small blot where it stood. Ground is
// won by covering it.
//
// Which sets up the claim this file exists to make good on:
//
//   NEITHER PURE STRATEGY WINS. A player who only paints is repainted over
//   faster than they can cover; a player who only hunts owns nothing.
//
// That is deliberately the shape that Winter's turn-based version has and its
// real-time prototype did not: two extremes that fail in DIFFERENT ways, with
// the best play somewhere between them. If it collapsed into "always paint" or
// "always shoot", the arena would be a shooting gallery with a scoreboard
// bolted on.
//
// It is arranged rather than hoped for:
//
//   * A wave carries more bots than you, and together they repaint faster than
//     one player can cover. So ignoring them loses ground.
//   * A splatter paints only the small patch under the bot. So hunting them
//     wins nothing on its own.
//   * A splattered bot is out for a few seconds — long enough to paint the
//     ground it was contesting. Shooting BUYS TIME, and time is what painting
//     costs.
//
// tests/pixel-paintball.arena.test.mjs sweeps a single field, `aggression`,
// from nought to one and checks the best score is in the middle rather than at
// either end.

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The arena, in cells. One cell is one unit, so a position and a cell are
  // the same coordinates and nothing has to be scaled to ask who owns the
  // ground somebody is standing on.
  cols: 48,
  rows: 30,

  // Moving and shooting.
  playerSpeed: 15.5,
  playerFireSeconds: 0.26,
  shotSpeed: 42,
  shotRange: 26,
  // The radius a shot paints where it lands. Ranged, so ground can be claimed
  // across the arena -- but a dot, so it is not how the arena gets covered.
  splatRadius: 2.2,

  // WHERE COVERAGE ACTUALLY COMES FROM: THE GROUND YOU WALK OVER.
  //
  // The first version painted a line under every shot as it flew, and the
  // sweep came out flat -- an all-out hunter scored as well as anything,
  // because chasing bots around the arena while holding the trigger paints the
  // arena as a side effect. Coverage was free.
  //
  // Painting from movement instead makes the trade geometric and impossible to
  // dodge. Ground is covered by GOING THERE, so hunting is time spent walking
  // where the bots are rather than where the unclaimed ground is, and being
  // stunned is coverage you do not get. A splattered bot is three seconds of
  // its patch left unattended, which is the whole reason to shoot at all.
  rollRadius: 1.45,
  botRollRadius: 0.66,

  // INK: ONE TANK, TWO USES.
  //
  // This is the line the whole design rests on, and it was added because the
  // first two versions did not have it. Painting and shooting both came out of
  // nothing, so shooting was free suppression on top of coverage you were
  // getting anyway, and an all-out hunter simply won: the aggression sweep came
  // out flat and then rising, which is a shooting gallery with a scoreboard
  // bolted on.
  //
  // It is the same symmetry that makes the turn-based Winter work and that its
  // real-time prototype could not reproduce: BOTH USES OF THE RESOURCE COST THE
  // SAME SCARCE THING. A shot is ink not spent on ground; ground is ink not
  // available for the bot walking up behind you.
  //
  // And refilling is the second half of it. Ink comes back fastest standing on
  // your own paint, so a hunter deep in bot territory has nowhere to reload --
  // which is a failure mode of a completely different shape from the painter's,
  // who covers plenty and gets shot for it.
  inkMax: 100,
  inkPerShot: 9,
  // INK IS SPENT ON PAINT THAT ACTUALLY LANDS ON SOMEBODY ELSE'S GROUND.
  //
  // Per cell claimed, not per second of walking, which is both the physical
  // reading and the one that makes the economy sit in the right place: rolling
  // back across your own territory changes nothing and so costs nothing, while
  // pushing into bot paint drains you. Charging by the second instead made
  // going home to reload as expensive as attacking, and the whole map became a
  // toll road.
  inkPerCell: 0.10,
  // REFILLING: WHERE YOU ARE DECIDES HOW FAST, AND "WHERE" MEANS THE GROUND
  // AROUND YOU RATHER THAN THE SQUARE UNDER YOU.
  //
  // The square under you is useless as a test and it took two goes to see why:
  // the roller paints where you stand, so after one frame of moving every
  // player is standing on their own paint, wherever they are. Asked that way
  // the answer is always "at home" and the tank refills itself.
  //
  // So it reads a disc around you and asks whether most of it is yours. That is
  // the thing the rule was always trying to say -- you reload where your team's
  // paint is, not on the one square you have just rolled over -- and it is what
  // leaves a hunter deep in bot territory with nowhere to fill up.
  refillRadius: 4.5,
  refillHomeShare: 0.6,
  refillOnOwn: 34,
  refillElsewhere: 2,

  // Getting hit. A player is out briefly and the bot that hit them is not, so
  // being shot costs ground rather than a life.
  playerStunSeconds: 1.1,
  botStunSeconds: 2.4,
  // What a hit paints where it lands, which is why being shot is a loss of
  // territory and not just of time.
  hitSplatRadius: 4.0,

  hitRadius: 0.75,

  // THE WAVE.
  waveSeconds: 30,
  // WHAT YOU MUST BE HOLDING WHEN THE WHISTLE GOES, or you are pushed out. A
  // fail state made of territory rather than of hit points, because the score
  // is territory.
  //
  // It starts lower and climbs, and that on-ramp came out of playing it cold
  // rather than out of the bots. The bots know at every instant which third of
  // the arena they own least of; a person spends the first wave working out
  // that the trigger is not something you hold down. Playing sensibly by eye --
  // sweeping the floor, shooting back when something got close -- reached 21%
  // of the arena on the first wave against a flat bar of 28%, which fails a
  // player for not yet knowing the game rather than for playing it badly.
  holdToAdvance: 0.17,
  holdPerWave: 0.037,
  holdMax: 0.28,

  // THE BOTS, and how they get better. No ceiling on any of it: the run ends
  // when a wave finally takes the arena off you.
  botsBase: 3,
  botsPerWave: 0.6,
  botsMax: 12,
  botSpeed: 9.5,
  botSpeedPerWave: 0.55,
  botSpeedMax: 15.0,
  botFireSeconds: 1.5,
  botFirePerWave: -0.055,
  botFireFloor: 0.42,
  // Aim error in radians. A wave-one bot misses a lot; a wave-twenty bot does
  // not. This is the figure that eventually ends every run.
  botAim: 0.44,
  botAimPerWave: -0.014,
  botAimFloor: 0.05,
  // How far a bot will shoot from, and how close it wants to be.
  botRange: 15,
  botEngage: 11,

  // THE RUN-UP AT THE START OF A WAVE, and it is here because of what playing
  // it cold looked like.
  //
  // Five seconds of touching nothing left the player holding NOTHING with three
  // bots stacked on top of them: every bot in the wave started inside its
  // engage range of the middle, so they all beelined at once and the opening
  // was a mobbing rather than a fight. For these seconds a bot paints its own
  // patch and does not come for you -- which is also the only chance the game
  // ever gives you to see what the bots do when they are not shooting at you.
  waveGraceSeconds: 3,
  // HOW FAR A BOT WANDERS FROM WHERE IT IS.
  //
  // Bots used to pick a goal anywhere in the arena, which quietly handed the
  // whole thing to an all-out hunter: chasing bots that roam everywhere walks
  // you everywhere, so hunting covered the ground for free and the sweep came
  // out flat. Bots that stay in a patch have to be gone to, one patch at a
  // time, and the ground the hunter is not standing on keeps getting painted.
  botRoam: 13,

  // POWERUPS. One on the floor at a time, respawning; they last a while and
  // they do different things rather than the same thing by different amounts.
  powerupEvery: 9,
  powerupSeconds: 8,

  // Scoring. Territory held, sampled continuously, so holding ground for a
  // while is worth more than touching it once.
  scorePerSecond: 100,
};

export const OWNER = { NONE: 0, PLAYER: 1, BOT: 2 };

export const POWERUP = {
  // A much wider roller: raw coverage, for the ground you were going to walk
  // anyway.
  ROLLER: 'roller',
  // Fires far faster: denial, because a stunned bot is a bot not repainting.
  RAPID: 'rapid',
  // Moves faster: reach, which is what turns a corner of the arena into all of
  // it.
  DASH: 'dash',
};
export const POWERUPS = [POWERUP.ROLLER, POWERUP.RAPID, POWERUP.DASH];

export const END = { OVERRUN: 'Overrun' };

// --- Per-wave figures -----------------------------------------------------

const ramp = (base, per, wave, limit, rising) => {
  const value = base + per * (wave - 1);
  return rising ? Math.min(limit, value) : Math.max(limit, value);
};

/**
 * What you have to be holding to survive wave `n`.
 *
 * Its own function because game.js draws the line on the territory bar, and a
 * line drawn from a different number than the one that ends the run would be
 * the worst possible bug in a game whose whole HUD is that bar.
 */
export const holdNeededFor = (n, t = TUNING) =>
  Math.min(t.holdMax, t.holdToAdvance + t.holdPerWave * (n - 1));

/** What wave `n` sends at you. One place, so a test can read the escalation. */
export function waveShape(n, t = TUNING) {
  return {
    bots: Math.min(t.botsMax, Math.round(t.botsBase + t.botsPerWave * (n - 1))),
    speed: ramp(t.botSpeed, t.botSpeedPerWave, n, t.botSpeedMax, true),
    fireSeconds: ramp(t.botFireSeconds, t.botFirePerWave, n, t.botFireFloor, false),
    aim: ramp(t.botAim, t.botAimPerWave, n, t.botAimFloor, false),
  };
}

// --- The arena ------------------------------------------------------------

export class Arena {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.cells = new Uint8Array(t.cols * t.rows);
    this.wave = 1;
    this.time = 0;
    this.score = 0;
    this.running = true;
    this.reason = null;
    this.splattered = 0;      // bots you have put out of action
    this.timesHit = 0;
    this.bestHold = 0;

    this.player = {
      x: t.cols / 2, y: t.rows / 2, aim: 0, cooldown: 0, stun: 0,
      ink: t.inkMax, dry: 0,
      powerup: null, powerupLeft: 0,
    };
    this.shots = [];
    this.bots = [];
    this.powerup = null;
    this.powerupTimer = t.powerupEvery * 0.5;
    this.#spawnWave();
    // A patch of ground under each side to start, so the first second is a
    // contest rather than an empty page -- and the player's is big enough to
    // reload in, since reloading needs the ground AROUND you rather than the
    // square under you.
    this.#paint(this.player.x, this.player.y, t.refillRadius + 1.5, OWNER.PLAYER);
    for (const bot of this.bots) this.#paint(bot.x, bot.y, 2.4, OWNER.BOT);
  }

  // --- The grid -----------------------------------------------------------

  index(cx, cy) { return cy * this.t.cols + cx; }

  ownerAt(x, y) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.t.cols || cy >= this.t.rows) return OWNER.NONE;
    return this.cells[this.index(cx, cy)];
  }

  /** Paint a disc. The only way any cell ever changes hands. */
  #paint(x, y, radius, owner) {
    const t = this.t;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(t.cols - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(t.rows - 1, Math.ceil(y + radius));
    let painted = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - x;
        const dy = cy + 0.5 - y;
        if (dx * dx + dy * dy > r2) continue;
        const i = this.index(cx, cy);
        if (this.cells[i] !== owner) painted++;
        this.cells[i] = owner;
      }
    }
    return painted;
  }

  /**
   * How much of the ground around (x, y) is the player's.
   *
   * Used for refilling, and exported behaviour rather than a private detail
   * because game.js draws it: a player needs to see where they can reload
   * before they are empty rather than after.
   */
  homeShare(x, y) {
    const t = this.t;
    const r = t.refillRadius;
    const r2 = r * r;
    let mine = 0;
    let total = 0;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(t.cols - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(t.rows - 1, Math.ceil(y + r));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - x;
        const dy = cy + 0.5 - y;
        if (dx * dx + dy * dy > r2) continue;
        total++;
        if (this.cells[this.index(cx, cy)] === OWNER.PLAYER) mine++;
      }
    }
    return total ? mine / total : 0;
  }

  /** Fraction of the arena each side holds. The score, and the fail state. */
  holdings() {
    let player = 0;
    let bot = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === OWNER.PLAYER) player++;
      else if (this.cells[i] === OWNER.BOT) bot++;
    }
    const total = this.cells.length;
    return { player: player / total, bot: bot / total, cells: total };
  }

  // --- Spawning -----------------------------------------------------------

  #spawnWave() {
    const shape = waveShape(this.wave, this.t);
    this.shape = shape;
    this.bots = [];
    for (let i = 0; i < shape.bots; i++) {
      // Around the edge, away from the middle where the player starts.
      const angle = (i / shape.bots) * Math.PI * 2 + Math.random();
      this.bots.push({
        x: this.t.cols / 2 + Math.cos(angle) * this.t.cols * 0.42,
        y: this.t.rows / 2 + Math.sin(angle) * this.t.rows * 0.42,
        aim: angle + Math.PI,
        cooldown: Math.random() * shape.fireSeconds,
        stun: 0,
        goalX: null,
        goalY: null,
        rethink: 0,
      });
    }
    for (const bot of this.bots) {
      bot.x = clampTo(bot.x, 1, this.t.cols - 1);
      bot.y = clampTo(bot.y, 1, this.t.rows - 1);
    }
  }

  #spawnPowerup() {
    const kind = POWERUPS[(Math.random() * POWERUPS.length) | 0];
    this.powerup = {
      kind,
      x: 3 + Math.random() * (this.t.cols - 6),
      y: 3 + Math.random() * (this.t.rows - 6),
    };
  }

  // --- Firing -------------------------------------------------------------

  #fire(from, angle, owner) {
    this.shots.push({
      x: from.x, y: from.y, angle, owner,
      vx: Math.cos(angle) * this.t.shotSpeed,
      vy: Math.sin(angle) * this.t.shotSpeed,
      travelled: 0,
    });
  }

  get playerFireSeconds() {
    return this.player.powerup === POWERUP.RAPID
      ? this.t.playerFireSeconds * 0.42
      : this.t.playerFireSeconds;
  }

  get playerSpeed() {
    return this.player.powerup === POWERUP.DASH
      ? this.t.playerSpeed * 1.55
      : this.t.playerSpeed;
  }

  get playerSplatRadius() {
    return this.player.powerup === POWERUP.ROLLER
      ? this.t.splatRadius * 1.8
      : this.t.splatRadius;
  }

  get playerRollRadius() {
    return this.player.powerup === POWERUP.ROLLER
      ? this.t.rollRadius * 1.9
      : this.t.rollRadius;
  }

  // --- One frame ----------------------------------------------------------

  /**
   * `input` is { x, y, aim, fire } — a direction, an angle to shoot along, and
   * whether the trigger is down. A stick, a keyboard and a thumb all reduce to
   * that, and so does every bot in the test harness.
   */
  step(dt, input = {}) {
    if (!this.running) return;
    const t = this.t;
    this.time += dt;

    this.#stepPlayer(dt, input);
    this.#stepBots(dt);
    this.#stepShots(dt);

    // Powerups.
    this.powerupTimer -= dt;
    if (!this.powerup && this.powerupTimer <= 0) {
      this.#spawnPowerup();
      this.powerupTimer = t.powerupEvery;
    }
    if (this.powerup) {
      const d = Math.hypot(this.powerup.x - this.player.x, this.powerup.y - this.player.y);
      if (d < 1.4) {
        this.player.powerup = this.powerup.kind;
        this.player.powerupLeft = t.powerupSeconds;
        this.powerup = null;
        this.powerupTimer = t.powerupEvery;
      }
    }
    if (this.player.powerupLeft > 0) {
      this.player.powerupLeft -= dt;
      if (this.player.powerupLeft <= 0) this.player.powerup = null;
    }

    // Scoring: territory held, sampled continuously, so ground held for a
    // while is worth more than ground touched once.
    const hold = this.holdings();
    this.hold = hold.player;
    this.bestHold = Math.max(this.bestHold, hold.player);
    this.score += hold.player * t.scorePerSecond * dt;

    // The whistle.
    if (this.time >= t.waveSeconds) {
      if (hold.player < holdNeededFor(this.wave, t)) {
        this.running = false;
        this.reason = END.OVERRUN;
        return;
      }
      this.wave++;
      this.time = 0;
      this.shots = [];
      this.#spawnWave();
    }
  }

  #stepPlayer(dt, input) {
    const p = this.player;
    if (p.stun > 0) {
      p.stun -= dt;
      return;
    }
    const t = this.t;
    const mag = Math.hypot(input.x || 0, input.y || 0);
    const moving = mag > 0.001;
    if (moving) {
      const speed = this.playerSpeed;
      p.x = clampTo(p.x + ((input.x / mag) * speed * dt), 0.4, t.cols - 0.4);
      p.y = clampTo(p.y + ((input.y / mag) * speed * dt), 0.4, t.rows - 0.4);
    }
    // The roller. Standing still paints the same patch over and over, which is
    // to say nothing: ground is covered by crossing it -- and every cell it
    // claims costs ink, the same ink a shot costs.
    if (moving && p.ink > 0) {
      const claimed = this.#paint(p.x, p.y, this.playerRollRadius, OWNER.PLAYER);
      p.ink = Math.max(0, p.ink - claimed * t.inkPerCell);
    }
    if (typeof input.aim === 'number') p.aim = input.aim;

    p.cooldown -= dt;
    const firing = Boolean(input.fire) && p.ink >= t.inkPerShot;
    if (firing && p.cooldown <= 0) {
      p.cooldown = this.playerFireSeconds;
      p.ink -= t.inkPerShot;
      this.#fire(p, p.aim, OWNER.PLAYER);
    }

    // Refilling. Never while the trigger is down, and six times faster on
    // ground you already held than on ground you are taking -- so falling back
    // across your own territory is how you reload, and pushing is what empties
    // you. Tying it to standing still instead simply handed the game to the
    // hunter, who stops anyway to shoot.
    if (!firing && !input.fire) {
      const home = this.homeShare(p.x, p.y) >= t.refillHomeShare;
      p.ink = Math.min(t.inkMax, p.ink + (home ? t.refillOnOwn : t.refillElsewhere) * dt);
    }
    if (p.ink <= 0) p.dry += dt;
  }

  #stepBots(dt) {
    const t = this.t;
    const shape = this.shape;
    for (const bot of this.bots) {
      if (bot.stun > 0) {
        bot.stun -= dt;
        continue;
      }
      const toPlayer = Math.hypot(this.player.x - bot.x, this.player.y - bot.y);
      const angleToPlayer = Math.atan2(this.player.y - bot.y, this.player.x - bot.x);

      // A bot's job is the same as yours: cover ground, and stop you covering
      // it. It closes on you when you are near enough to be worth shooting,
      // and otherwise goes and paints somewhere it does not already own.
      const grace = this.time < t.waveGraceSeconds;

      bot.rethink -= dt;
      if (bot.rethink <= 0 || bot.goalX === null) {
        bot.rethink = 0.8 + Math.random() * 0.7;
        if (!grace && toPlayer < t.botEngage) {
          bot.goalX = this.player.x;
          bot.goalY = this.player.y;
        } else {
          const roam = t.botRoam;
          bot.goalX = clampTo(bot.x + (Math.random() * 2 - 1) * roam, 2, t.cols - 2);
          bot.goalY = clampTo(bot.y + (Math.random() * 2 - 1) * roam, 2, t.rows - 2);
        }
      }
      const dx = bot.goalX - bot.x;
      const dy = bot.goalY - bot.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 1) {
        bot.x = clampTo(bot.x + (dx / d) * shape.speed * dt, 0.4, t.cols - 0.4);
        bot.y = clampTo(bot.y + (dy / d) * shape.speed * dt, 0.4, t.rows - 0.4);
      }
      this.#paint(bot.x, bot.y, t.botRollRadius, OWNER.BOT);
      const hunting = !grace && toPlayer < t.botRange;
      bot.hunting = hunting;
      bot.aim = hunting ? angleToPlayer : Math.atan2(dy, dx);

      bot.cooldown -= dt;
      if (bot.cooldown <= 0) {
        bot.cooldown = shape.fireSeconds;
        // At the player when in range, and along its own path otherwise, so a
        // bot away from the fight is still painting rather than idling.
        const aimed = hunting
          ? angleToPlayer + (Math.random() * 2 - 1) * shape.aim
          : Math.atan2(dy, dx);
        this.#fire(bot, aimed, OWNER.BOT);
      }
    }
  }

  #stepShots(dt) {
    const t = this.t;
    const alive = [];
    for (const shot of this.shots) {
      const stepX = shot.vx * dt;
      const stepY = shot.vy * dt;
      shot.x += stepX;
      shot.y += stepY;
      shot.travelled += Math.hypot(stepX, stepY);

      let done = false;

      if (shot.owner === OWNER.PLAYER) {
        for (const bot of this.bots) {
          if (bot.stun > 0) continue;
          if (Math.hypot(bot.x - shot.x, bot.y - shot.y) < t.hitRadius + 0.5) {
            bot.stun = t.botStunSeconds;
            this.splattered++;
            this.#paint(bot.x, bot.y, this.playerSplatRadius, OWNER.PLAYER);
            done = true;
            break;
          }
        }
      } else if (this.player.stun <= 0
        && Math.hypot(this.player.x - shot.x, this.player.y - shot.y) < t.hitRadius) {
        this.player.stun = t.playerStunSeconds;
        this.timesHit++;
        this.#paint(this.player.x, this.player.y, t.hitSplatRadius, OWNER.BOT);
        done = true;
      }

      const out = shot.x < 0 || shot.y < 0 || shot.x >= t.cols || shot.y >= t.rows;
      if (!done && (out || shot.travelled >= t.shotRange)) {
        const radius = shot.owner === OWNER.PLAYER ? this.playerSplatRadius : t.splatRadius;
        this.#paint(shot.x, shot.y, radius, shot.owner);
        done = true;
      }
      if (!done) alive.push(shot);
    }
    this.shots = alive;
  }
}

function clampTo(value, low, high) {
  return value < low ? low : value > high ? high : value;
}
