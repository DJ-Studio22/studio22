// games/rift-runner/patterns.js
//
// The obstacle library, and the check that keeps it honest.
//
// WHY PATTERNS ARE HAND-AUTHORED
// ------------------------------
// A runner that generates obstacles randomly produces two things: stretches
// with nothing in them, and stretches nobody could have cleared. Authoring
// them means every one is a deliberate ask — jump, then immediately duck; two
// gaps with a bar between them; a rift wall you have to phase while airborne.
//
// The brief was "obstacle patterns that combine rather than repeat", and that
// is what a pattern IS here: a short phrase of two or three verbs in an order
// that means something. The run then combines the phrases, so difficulty comes
// from what follows what rather than from the same spike getting closer
// together.
//
// THE LIBRARY CHECKS ITSELF AT LOAD
// ---------------------------------
// Every pattern declares which realms it may be dealt in. `verifyLibrary()`
// runs the solver from rift.js over every (pattern, realm) pair it declared
// and refuses any it cannot find a route through. That check runs in the test
// suite, and a cheap version runs at boot.
//
// This is the same arrangement as Gravity Flip's rooms.js, and for the same
// reason: writing the checker found several of my own rooms impassable. It
// found three here too — a rift wall placed where the dash could not be off
// cooldown in time, a bar hung one tile too low in Drift, and a gap-then-bar
// that was only clearable in Forge.
//
// ADDING A PATTERN
// ----------------
// Add it below with the realms you think it works in, then run the tests. If
// the solver disagrees, it is right: either move the obstacle or drop the
// realm from the list.

import {
  KIND, PIXELS_PER_METRE, REALMS, Run, SOLVER_FINE, TILE, TUNING,
  isClearable, realmById,
} from './rift.js';

// Shorthand so a pattern reads as a shape rather than as JSON.
const spike = (tile, tiles = 1) => ({ kind: KIND.SPIKE, tile, tiles });
const bar = (tile, tiles = 2, clear = 1) => ({ kind: KIND.BAR, tile, tiles, clear });
const gap = (tile, tiles = 2) => ({ kind: KIND.GAP, tile, tiles });
const rift = (tile, tiles = 1) => ({ kind: KIND.RIFT, tile, tiles });

const ALL = ['surface', 'drift', 'forge', 'surge', 'inverse'];

// A rift gate is this many tiles of clear ground with the portal in the
// middle. Wide enough to land, read the new realm, and set off again.
export const GATE_TILES = 10;

// About three seconds of clear ground before the first obstacle. See reset().
export const OPENING_TILES = 26;

/**
 * `tiles` is the pattern's length; obstacles sit at tile offsets inside it.
 * `realms` is where it may be dealt. `tier` is how far into a run it starts
 * appearing — 0 from the first metre, 3 only once the player has survived a
 * while.
 */
export const PATTERNS = [
  // --- Tier 0: one verb, clearly ------------------------------------------
  {
    id: 'first-spike', tier: 0, tiles: 6, realms: ALL,
    obstacles: [spike(3)],
  },
  {
    id: 'first-gap', tier: 0, tiles: 7, realms: ALL,
    obstacles: [gap(3, 2)],
  },
  {
    id: 'first-bar', tier: 0, tiles: 7, realms: ALL,
    obstacles: [bar(3, 3, 1)],
  },
  {
    id: 'first-rift', tier: 0, tiles: 7, realms: ALL,
    obstacles: [rift(3, 1)],
  },

  // --- Tier 1: the same verb twice, with a rhythm --------------------------
  {
    id: 'two-spikes', tier: 1, tiles: 10, realms: ALL,
    obstacles: [spike(3), spike(7)],
  },
  {
    // Not legal in Drift: a floaty jump covers 8.2 tiles, so there is no hop
    // short enough to come down in a two-tile window between spikes. The
    // solver said so; the realm list says so now.
    id: 'spike-stutter', tier: 1, tiles: 11,
    realms: ['surface', 'forge', 'surge', 'inverse'],
    obstacles: [spike(3), spike(6), spike(9)],
  },
  {
    id: 'wide-gap', tier: 1, tiles: 9, realms: ['surface', 'drift', 'surge', 'inverse'],
    obstacles: [gap(3, 3)],
  },
  {
    id: 'long-bar', tier: 1, tiles: 10, realms: ALL,
    obstacles: [bar(3, 5, 1)],
  },

  // --- Tier 2: two verbs, in order ----------------------------------------
  {
    id: 'jump-then-duck', tier: 2, tiles: 12, realms: ALL,
    obstacles: [spike(3), bar(7, 3, 1)],
  },
  {
    id: 'duck-then-jump', tier: 2, tiles: 12, realms: ALL,
    obstacles: [bar(3, 3, 1), spike(8)],
  },
  {
    id: 'gap-then-spike', tier: 2, tiles: 12, realms: ALL,
    obstacles: [gap(3, 2), spike(8)],
  },
  {
    id: 'rift-then-gap', tier: 2, tiles: 13, realms: ALL,
    obstacles: [rift(3, 1), gap(8, 2)],
  },
  {
    id: 'spike-island', tier: 2, tiles: 13, realms: ALL,
    obstacles: [gap(3, 2), spike(6), gap(9, 2)],
  },

  // --- Tier 3: two verbs at once, which is the ceiling ---------------------
  {
    // A bar over a gap: jumping the gap puts your head in the bar, so the gap
    // has to be crossed low — which means dashing it.
    id: 'low-crossing', tier: 3, tiles: 13, realms: ALL,
    obstacles: [gap(4, 2), bar(3, 5, 3)],
  },
  {
    // Two rifts, spaced so one dash cannot cover both and the second needs a
    // fresh charge. Twelve tiles rather than seven: the dash cycle is 1.19s in
    // Drift, which is 9.6 tiles of ground, and at seven the second wall
    // arrived while the dash was still on cooldown in three realms. Ten was
    // enough on paper and still failed in Drift — 9.6 tiles of cycle against
    // 10 of spacing leaves no room to be dashing when the wall arrives.
    id: 'double-rift', tier: 3, tiles: 20, realms: ALL,
    obstacles: [rift(3, 1), rift(15, 1)],
  },
  {
    // A spike you must jump, under a bar you must stay below: the ask is a
    // SHORT hop, which is what the jump-cut is for.
    //
    // The bar was authored at 2 tiles of clearance and that is impossible by
    // 4px — clearing a 1-tile spike puts the feet at 40px and the head at 84,
    // against 80 of headroom. Three tiles leaves a 36px window to aim at.
    id: 'spike-under-bar', tier: 3, tiles: 13, realms: ALL,
    obstacles: [bar(3, 6, 3), spike(6)],
  },
  {
    id: 'gauntlet', tier: 3, tiles: 17, realms: ALL,
    obstacles: [spike(3), bar(6, 3, 1), gap(11, 2), spike(15)],
  },
  {
    // Not legal in Drift, for the same reason as spike-stutter: the jump off
    // the spike is still in the air when the rift arrives, and phasing does
    // not help you land in time for the bar.
    id: 'rift-sandwich', tier: 3, tiles: 16,
    realms: ['surface', 'forge', 'surge', 'inverse'],
    obstacles: [spike(3), rift(7, 1), bar(11, 3, 1)],
  },
];

/**
 * Every pattern legal at this tier or below, for a realm.
 * The run deals from this, so a realm never sees a pattern it cannot clear.
 */
export function patternsFor(realmId, tier) {
  return PATTERNS.filter((p) => p.realms.includes(realmId) && p.tier <= tier);
}

/**
 * How deep into a run the tiers unlock, in metres.
 *
 * Tightened from 150/450/900 after the bots said the ramp was too slow: a
 * competent run had a median of 450m and spent nearly all of it on tier-0
 * patterns, which are one obstacle each. The rift gates make it worse by
 * handing out ten tiles of free ground every 95m. Escalating sooner is what
 * makes the last third of a run different from the first.
 */
export function tierAt(metres) {
  if (metres < 120) return 0;
  if (metres < 350) return 1;
  if (metres < 700) return 2;
  return 3;
}

// --- The self-check -------------------------------------------------------

/**
 * Runs the solver over every (pattern, realm) pair the library declares and
 * returns the ones with no route through.
 *
 * Empty means the library is honest. Anything in it is a pattern that would be
 * dealt to a player who then could not get past it, however well they played.
 */
export function verifyLibrary(options = {}) {
  const problems = [];
  for (const pattern of PATTERNS) {
    for (const realmId of pattern.realms) {
      const realm = realmById(realmId);
      if (isClearable(pattern, realm, options)) continue;

      // The cheap settings can reject a pattern they simply merged the route
      // out of — see the note on SOLVER_DEFAULTS. A rejection is only
      // believed once the fine search has also failed to find a way through.
      if (isClearable(pattern, realm, { ...SOLVER_FINE, ...options.fine })) continue;

      problems.push({ pattern: pattern.id, realm: realmId });
    }
  }
  return problems;
}

/**
 * Every realm has to have something to deal at every tier, or a run drops into
 * a realm and finds an empty library — which reads as the game freezing.
 */
export function verifyCoverage() {
  const problems = [];
  for (const realm of REALMS) {
    for (let tier = 0; tier <= 3; tier++) {
      const available = patternsFor(realm.id, tier);
      if (available.length < 2) {
        problems.push(`${realm.id} tier ${tier} has only ${available.length} pattern(s)`);
      }
    }
  }
  return problems;
}

// --- The course -----------------------------------------------------------


/**
 * A whole run: the runner, plus the endless course being dealt in front of it.
 *
 * This is what the game and the bot harness both drive, so a bot is playing
 * the same course a player would rather than a simplified one.
 *
 * Dealing is deliberately not random-per-obstacle. A pattern is dealt whole,
 * then `restTiles` of clear ground, then another — so the run is a sequence of
 * complete phrases with somewhere to breathe between them. What gets harder is
 * which phrases are in the deck (the tier) and how fast they arrive.
 */
export class Course {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.run = new Run(tuning);
    this.reset();
  }

  reset() {
    this.run.reset();
    this.realmIndex = 0;
    this.run.realm = REALMS[0];
    // The run-up, in tiles of clear ground before the first obstacle.
    //
    // Six was the first number and it is the Ember fault all over again: the
    // first obstacle arrived 1.06 SECONDS after the title screen cleared, and
    // a player who has just pressed Space to start is still reading the
    // screen. Playing it by hand found this in one attempt; no bot ever could,
    // because a bot is already running on frame one. Three seconds is enough
    // to see the runner, notice which way it is going, and find the buttons.
    this.cursorTile = OPENING_TILES;
    this.dealt = [];
    this.lastPatternId = null;
    this.riftsEntered = 0;
    this.nextRiftMetres = this.t.firstRiftMetres;
    // Where the next gate stands, in tiles, or null when none is dealt.
    this.pendingGateTile = null;
    this.justShifted = false;
    this.#fill();
  }

  get metres() { return this.run.metres; }
  get running() { return this.run.running; }
  get reason() { return this.run.reason; }
  get realm() { return this.run.realm; }

  /** Keeps a couple of patterns dealt ahead of the runner. */
  #fill() {
    while (this.cursorTile * TILE < this.run.x + 2400) this.#dealOne();
    // Drop what is well behind, so a long run does not grow without bound.
    const behind = this.run.x - 800;
    this.run.obstacles = this.run.obstacles.filter(
      (o) => (o.tile + o.tiles) * TILE > behind,
    );
  }

  /** How far along the course the DEALER has got, in metres. */
  get cursorMetres() { return (this.cursorTile * TILE) / PIXELS_PER_METRE; }

  #dealOne() {
    // A rift falls due when the DEALER reaches the mark, not when the runner
    // does. Scheduling it off the runner was wrong and put the gate wherever
    // the cursor happened to be — which is up to 107m ahead, because the
    // course is dealt that far in advance. The first gate was landing at
    // ~150m instead of 45m, so a competent run died before ever seeing one.
    if (this.cursorMetres >= this.nextRiftMetres && this.pendingGateTile === null) {
      this.nextRiftMetres = this.cursorMetres + this.t.realmMetres;
      this.#dealRiftGate();
      return;
    }

    const tier = tierAt(this.metres);
    let deck = patternsFor(this.run.realm.id, tier);
    // Never the same phrase twice running: repetition is the thing the whole
    // library exists to avoid.
    if (deck.length > 1 && this.lastPatternId) {
      const without = deck.filter((p) => p.id !== this.lastPatternId);
      if (without.length) deck = without;
    }
    const pattern = deck[Math.floor(Math.random() * deck.length)];
    this.lastPatternId = pattern.id;

    for (const o of pattern.obstacles) {
      this.run.obstacles.push({ ...o, tile: o.tile + this.cursorTile });
    }
    this.dealt.push({ id: pattern.id, tile: this.cursorTile, tiles: pattern.tiles });
    this.cursorTile += pattern.tiles + this.t.restTiles;
  }

  /**
   * A rift is DEALT, not waited for.
   *
   * The first version watched for a lull — grounded, and no obstacle within
   * six tiles — and shifted realm when it found one. It never found one:
   * patterns are dealt four tiles apart, so there is almost always something
   * inside six, and the median run of both bots entered ZERO rifts. The
   * portals are the whole hook of the game and nobody was seeing them.
   *
   * So the dealer lays a wide clear stretch with the rift standing in it. The
   * gate is guaranteed to arrive, it is guaranteed to be on flat empty
   * ground — changing gravity halfway through somebody's jump is a cheat, not
   * a twist — and the player can see it coming, which a hook has to be able
   * to do.
   */
  #dealRiftGate() {
    this.pendingGateTile = this.cursorTile + GATE_TILES / 2;
    this.dealt.push({ id: 'rift-gate', tile: this.cursorTile, tiles: GATE_TILES, gate: true });
    this.cursorTile += GATE_TILES;
    this.lastPatternId = null;
  }

  /** Steps through the gate the dealer laid, once the runner reaches it. */
  #crossGate() {
    if (this.pendingGateTile === null) return;
    if (this.run.x < this.pendingGateTile * TILE) return;
    if (!this.run.grounded) return;   // land first; never mid-jump

    let next = this.realmIndex;
    while (next === this.realmIndex) next = Math.floor(Math.random() * REALMS.length);
    this.realmIndex = next;
    this.run.realm = REALMS[next];
    this.run.realmIndex = next;
    this.riftsEntered++;
    this.pendingGateTile = null;
    this.justShifted = true;

    // Everything ahead was dealt for the old realm's physics. Throw it away
    // and re-deal, or the new realm inherits patterns it was never checked
    // against — the one thing the library check cannot catch.
    const frontier = Math.ceil(this.run.x / TILE) + 6;
    this.run.obstacles = this.run.obstacles.filter((o) => o.tile < frontier);
    this.cursorTile = Math.max(this.cursorTile, frontier);
    this.#fill();
  }
  step(dt, input) {
    if (!this.run.running) return;
    this.justShifted = false;
    this.#crossGate();
    this.run.step(dt, input);
    this.#fill();
  }
}
