// games/skyhook/swing.js
//
// The rope, the body on the end of it, and the city they move through.
// No canvas, no input device, no clock.
//
// WHY THIS IS ITS OWN FILE
// ------------------------
// Skyhook is a game about momentum, and "does this feel fair" is a claim about
// numbers — how long a competent first run lasts, how far a good player can
// get past that, whether the hook can reach the next mast at all. None of that
// is visible in a screenshot, and none of it can be measured through a browser
// at one run per few seconds. Pulled out here it can be driven by a bot a
// thousand times in a second, which is what turns the difficulty tuning from
// an opinion into a measurement.
//
// Same reason Circuit Racer has driving.js and Number Crunch has problems.js.
//
// THE PHYSICS, IN ONE PARAGRAPH
// -----------------------------
// While the hook is attached the player is a rigid pendulum. The constraint is
// solved by projecting the position back onto the circle around the anchor and
// discarding the RADIAL part of the velocity, which leaves the tangential part
// untouched — that is what conserves the swing, and it is why a rope is used
// here rather than a spring. Reeling in shortens the rope and rescales the
// tangential speed by oldLength/newLength, which conserves angular momentum:
// pumping a swing speeds it up out of the maths rather than out of a bonus.
// Letting go simply stops applying the constraint, so you leave with exactly
// the velocity you had.

import { clamp } from '../../engine/util.js';
import { anchorOf, nextBuilding, ringBetween } from './city.js';

/**
 * Every number the feel of this game lives in.
 *
 * Passed to the constructor rather than read from module scope so a test can
 * clone it, change one figure, and run both versions side by side. That is the
 * whole point of the file.
 */
export const TUNING = {
  gravity: 950,
  airDragPerSecond: 0.94,     // very light: momentum has to survive
  diveAccel: 1500,            // tuck mid-air to trade height for speed
  maxSpeed: 1400,

  // Rope limits.
  //
  // THE GEOMETRY CONTRACT, and it is the most important number in the file.
  // A pendulum hung from a mast sweeps over the roof that mast stands on, and
  // the bottom of that arc sits at (roof - mast + rope). So a swing only
  // clears the building it is anchored to while ROPE IS SHORTER THAN MAST.
  // Measured on the original numbers, only 21% of swings satisfied that: the
  // median mast was 71 tall and the median rope 178, so attaching usually
  // committed the player to swinging straight into the building. It read as
  // random unfair deaths. ropeMax came down and the masts in city.js went up
  // until the contract holds nearly always.
  ropeMin: 46,
  ropeMax: 210,
  reelInSpeed: 210,
  reelOutSpeed: 260,

  // How far the hook reaches, and how much an anchor behind you costs. Anchors
  // behind are allowed but penalised: sometimes the only way out of a bad arc
  // is to swing backwards first.
  // Raised from 470. Worth saying plainly: once the masts were tall enough
  // this stopped mattering — 470, 540 and 620 measured identically for a
  // competent player. It is kept a little generous because it costs nothing
  // and makes the hook feel less fussy at the edge of reach, not because it
  // was the problem.
  grappleRange: 540,
  behindPenalty: 2.6,

  // How far BELOW the player an anchor may still be taken. A rope only pulls,
  // so an anchor underfoot is useless — but one a little below is not, because
  // you are usually falling toward it, and refusing those is what makes the
  // hook feel like it is ignoring you.
  // This was 0, meaning an anchor even slightly below the player was refused
  // outright. Measured at the moment of release, 86% of next anchors were in
  // range but BELOW — so the hook was thrown at nothing, the player fell, and
  // it felt like the game had ignored the button rather than like a mistake.
  // A rope you fall past and catch is a real move, and now it is allowed.
  anchorBelowMargin: 140,
  belowPenalty: 1.8,

  // The hook takes time to fly out. Short, but not zero: an instant attach
  // makes the timing free, and the timing is the game.
  hookTravelSpeed: 2600,

  // The opening swing. The angle is measured from straight down, negative
  // meaning behind the anchor, so a run starts at the top of a forward arc.
  startSpeed: 380,
  openingMast: 260,
  openingRope: 170,
  openingAngle: -0.9,

  // Scoring, all in one unit: metres. A ring is worth metres you did not have
  // to travel for.
  unitsPerMetre: 20,
  // Rings are where a good run separates from a competent one, so this is
  // the ceiling dial rather than a difficulty dial: raising it widens the gap
  // between skill levels without making the game any easier to survive.
  ringMetres: 14,
  comboCap: 8,

  // The floor of the world. Below this you have fallen out of the city.
  deathY: 900,

  heroRadius: 11,
};

export const HOOK = { IDLE: 'idle', FLYING: 'flying', ATTACHED: 'attached' };

// How much city to keep ahead of, and behind, the player.
const AHEAD = 1800;
const BEHIND = 900;

export class Swing {
  constructor(tuning = TUNING) {
    this.t = { ...TUNING, ...tuning };
    this.hero = { x: 0, y: 0, vx: 0, vy: 0, r: this.t.heroRadius, angle: 0 };
    this.hookTip = { x: 0, y: 0 };
    // Drained by the caller each step, so audio and particles can react
    // without this file knowing either exists.
    this.events = [];
    this.reset();
  }

  reset() {
    const t = this.t;

    this.buildings = [];
    this.rings = [];
    this.hookState = HOOK.IDLE;
    this.hookTarget = null;
    this.ropeLength = 0;

    this.bonusMetres = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.ringsTaken = 0;
    this.ringsMissed = 0;
    this.furthest = 0;
    this.topSpeed = 0;
    this.swings = 0;
    this.running = true;
    this.deathReason = '';
    this.elapsed = 0;
    this.events.length = 0;

    this.hero.x = 0;
    this.hero.y = 0;
    this.extendCity();

    // A run opens mid-arc: hanging behind the first mast, already swinging
    // forward. Being dropped onto a roof to work out the controls would teach
    // the wrong thing about a game whose whole subject is momentum.
    //
    // The first mast is forced tall because the opening position is measured
    // DOWN from the anchor: on a normal mast the rope would put the player
    // inside the roof they are hanging over, which is a crash on frame one.
    const first = this.buildings[0];
    first.mast = t.openingMast;
    const anchor = anchorOf(first);

    this.ropeLength = t.openingRope;
    const rx = Math.sin(t.openingAngle);
    const ry = Math.cos(t.openingAngle);
    this.hero.x = anchor.x + rx * this.ropeLength;
    this.hero.y = anchor.y + ry * this.ropeLength;
    // Perpendicular to the rope, forward and down: the top of a swing.
    this.hero.vx = ry * t.startSpeed;
    this.hero.vy = -rx * t.startSpeed;

    this.hookState = HOOK.ATTACHED;
    this.hookTarget = anchor;
    this.swings = 1;
  }

  get metres() {
    return Math.floor(this.furthest / this.t.unitsPerMetre) + this.bonusMetres;
  }

  get speed() {
    return Math.hypot(this.hero.vx, this.hero.vy);
  }

  // --- City ---------------------------------------------------------------

  extendCity() {
    while (this.buildings.length === 0
      || this.buildings[this.buildings.length - 1].x < this.hero.x + AHEAD) {
      const previous = this.buildings[this.buildings.length - 1] ?? null;
      const building = nextBuilding(previous, this.hero.x);
      this.buildings.push(building);

      if (previous) {
        const ring = ringBetween(previous, building, this.hero.x);
        if (ring) this.rings.push(ring);
      }
    }

    const cutoff = this.hero.x - BEHIND;
    while (this.buildings.length > 2 && this.buildings[0].x + this.buildings[0].w < cutoff) {
      this.buildings.shift();
    }
    while (this.rings.length > 0 && this.rings[0].x < cutoff) this.rings.shift();
  }

  // --- Grapple ------------------------------------------------------------

  /**
   * The anchor the hook would take right now, or null.
   *
   * Scored rather than "nearest": the nearest anchor is often the one directly
   * overhead, which gives a swing that goes nowhere. Anchors ahead and above
   * are preferred; ones behind, or a little below, are taken only when there
   * is nothing better — which is what makes the hook an escape hatch out of a
   * bad arc rather than a refusal.
   */
  bestAnchor() {
    const t = this.t;
    let best = null;
    let bestCost = Infinity;

    for (const building of this.buildings) {
      const a = anchorOf(building);
      const dx = a.x - this.hero.x;
      const dy = a.y - this.hero.y;
      const dist = Math.hypot(dx, dy);

      if (dist > t.grappleRange || dist < t.ropeMin) continue;
      // A rope only pulls. An anchor far below the player would leave them in
      // a rope that goes slack the instant it tightens.
      if (dy > t.anchorBelowMargin) continue;

      let cost = dist;
      if (dx < 0) cost *= t.behindPenalty;
      if (dy > -20) cost *= t.belowPenalty;
      if (cost < bestCost) { bestCost = cost; best = a; }
    }
    return best;
  }

  fireHook() {
    const anchor = this.bestAnchor();
    if (!anchor) {
      this.events.push({ type: 'fireMissed' });
      return;
    }
    this.hookState = HOOK.FLYING;
    this.hookTarget = anchor;
    this.hookTip = { x: this.hero.x, y: this.hero.y };
    this.events.push({ type: 'fired' });
  }

  attach() {
    this.hookState = HOOK.ATTACHED;
    this.ropeLength = clamp(
      Math.hypot(this.hookTarget.x - this.hero.x, this.hookTarget.y - this.hero.y),
      this.t.ropeMin, this.t.ropeMax,
    );
    this.swings++;
    this.events.push({ type: 'attached' });
  }

  release() {
    if (this.hookState === HOOK.ATTACHED) this.events.push({ type: 'released' });
    this.hookState = HOOK.IDLE;
    this.hookTarget = null;
  }

  /**
   * The rope constraint. Position is pulled back onto the circle and the
   * component of velocity along the rope is discarded; what survives is the
   * swing. Inside the length the rope is slack and does nothing at all.
   */
  applyRope() {
    const dx = this.hero.x - this.hookTarget.x;
    const dy = this.hero.y - this.hookTarget.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001 || dist < this.ropeLength) return;

    const nx = dx / dist;
    const ny = dy / dist;
    this.hero.x = this.hookTarget.x + nx * this.ropeLength;
    this.hero.y = this.hookTarget.y + ny * this.ropeLength;

    const radial = this.hero.vx * nx + this.hero.vy * ny;
    if (radial > 0) {
      this.hero.vx -= radial * nx;
      this.hero.vy -= radial * ny;
    }
  }

  /**
   * Changing rope length while swinging, conserving angular momentum: the
   * tangential speed scales by oldLength / newLength. Shortening therefore
   * speeds the swing up, which is the pump.
   */
  reel(dt, direction) {
    if (direction === 0) return;
    const t = this.t;

    const previous = this.ropeLength;
    this.ropeLength = clamp(
      this.ropeLength + direction * (direction < 0 ? t.reelInSpeed : t.reelOutSpeed) * dt,
      t.ropeMin, t.ropeMax,
    );
    if (this.ropeLength === previous) return;

    const dx = this.hero.x - this.hookTarget.x;
    const dy = this.hero.y - this.hookTarget.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    const radial = this.hero.vx * nx + this.hero.vy * ny;
    const scale = previous / this.ropeLength;
    const tx = (this.hero.vx - radial * nx) * scale;
    const ty = (this.hero.vy - radial * ny) * scale;

    this.hero.vx = tx + radial * nx;
    this.hero.vy = ty + radial * ny;
    if (direction < 0) this.events.push({ type: 'reeling' });
  }

  // --- Collisions ---------------------------------------------------------

  checkCrash() {
    const hero = this.hero;

    for (const b of this.buildings) {
      if (hero.y + hero.r < b.top) continue;
      if (hero.x + hero.r < b.x || hero.x - hero.r > b.x + b.w) continue;
      // Whether it reads as a roof or a wall is only about where the centre
      // is; both end the run the same way.
      const overRoof = hero.x >= b.x && hero.x <= b.x + b.w;
      this.die(overRoof ? 'Hit the roof' : 'Hit the wall');
      return;
    }

    if (hero.y > this.t.deathY) this.die('Fell');
  }

  die(reason) {
    if (!this.running) return;
    this.running = false;
    this.deathReason = reason;
    this.events.push({ type: 'died', reason });
  }

  // --- Rings --------------------------------------------------------------

  checkRings() {
    const t = this.t;
    for (const ring of this.rings) {
      if (ring.taken || ring.missed) continue;

      if (Math.hypot(ring.x - this.hero.x, ring.y - this.hero.y) < ring.r + this.hero.r) {
        ring.taken = true;
        this.ringsTaken++;
        this.combo = Math.min(t.comboCap, this.combo + 1);
        if (this.combo > this.bestCombo) this.bestCombo = this.combo;
        this.bonusMetres += t.ringMetres * this.combo;
        this.events.push({ type: 'ring', ring, combo: this.combo });
        continue;
      }

      // Gone past it. The combo is the only thing a missed ring costs, and
      // that is enough: a ring you could not reach is usually a swing you
      // misjudged two buildings ago, and punishing it twice punishes it late.
      if (this.hero.x - ring.x > ring.r + 30) {
        ring.missed = true;
        this.ringsMissed++;
        this.combo = 0;
      }
    }
  }

  // --- One step -----------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} input
   *   firePressed  the hook button went down this frame (toggles fire/release)
   *   dive         held, and only effective while unattached
   *   reel         -1 in, +1 out, 0 neither
   */
  step(dt, input) {
    if (!this.running) return;
    const t = this.t;
    const hero = this.hero;
    this.elapsed += dt;

    if (input.firePressed) {
      if (this.hookState === HOOK.IDLE) this.fireHook();
      else this.release();
    }

    if (this.hookState === HOOK.FLYING) {
      const dx = this.hookTarget.x - this.hookTip.x;
      const dy = this.hookTarget.y - this.hookTip.y;
      const dist = Math.hypot(dx, dy);
      const step = t.hookTravelSpeed * dt;
      if (dist <= step) {
        this.hookTip = { ...this.hookTarget };
        this.attach();
      } else {
        this.hookTip.x += (dx / dist) * step;
        this.hookTip.y += (dy / dist) * step;
      }
    }

    hero.vy += t.gravity * dt;

    const diving = Boolean(input.dive) && this.hookState !== HOOK.ATTACHED;
    if (diving) hero.vy += t.diveAccel * dt;
    this.diving = diving;

    const damp = t.airDragPerSecond ** dt;
    hero.vx *= damp;
    hero.vy *= damp;

    if (this.hookState === HOOK.ATTACHED) this.reel(dt, input.reel ?? 0);

    hero.x += hero.vx * dt;
    hero.y += hero.vy * dt;

    if (this.hookState === HOOK.ATTACHED) this.applyRope();

    const speed = this.speed;
    if (speed > t.maxSpeed) {
      hero.vx *= t.maxSpeed / speed;
      hero.vy *= t.maxSpeed / speed;
    }
    if (speed > this.topSpeed) this.topSpeed = speed;

    hero.angle = Math.atan2(hero.vy, hero.vx);
    if (hero.x > this.furthest) this.furthest = hero.x;

    this.extendCity();
    this.checkRings();
    this.checkCrash();
  }

  // Hands the caller everything that happened this step and clears the list.
  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }
}
