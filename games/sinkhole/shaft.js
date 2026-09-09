// games/sinkhole/shaft.js
//
// The shaft: what a floor is made of, and where the ceiling is.
//
// Both of the rules in here are claims about fairness rather than about
// drawing, which is why they live in a module Node can import and a bot can
// hammer. Neither could be checked by looking at the game.
//
// RULE ONE — EVERY FLOOR HAS SOMEWHERE SURVIVABLE
// -----------------------------------------------
// A ledge used to be spiked or not spiked, as one boolean for the whole
// shelf. Past about 6,000 depth roughly two floors in five were spiked end to
// end, which meant the gap was the only survivable square on the entire
// width — miss it and you take a hit with nothing you could have done
// differently. That is not difficulty, it is a coin toss, and it is invisible
// in a screenshot because a spiked ledge looks exactly as intended.
//
// A ledge now always carries a SAFE BAND as well as a gap: a stretch of plain
// shelf you can land on. What gets harder with depth is how narrow both are
// and how much of the rest is spiked, never whether a landing exists at all.
//
// RULE TWO — THE CEILING CHASES
// -----------------------------
// The ceiling was a fixed line at the top of the world. A player who dived
// hard outran it permanently: a thousand units down it was no longer part of
// the game, and the only thing left was the gaps. The threat the game is
// named for stopped existing exactly when the player got good.
//
// It now descends at the shaft's own rate and, when the player has pulled too
// far ahead, closes at a catch-up speed. Diving still buys room — that is the
// reward — but the room is finite and it is always coming.

import { clamp, randRange } from '../../engine/util.js';

export const SHAFT_TUNING = {
  width: 420,

  // The hole you fall through. Narrows with depth, never past the floor.
  gapWide: 168,
  gapNarrowPerDepth: 0.012,
  gapMin: 76,

  // The stretch of plain shelf that is always somewhere on the floor. This is
  // the guarantee: it shrinks, but it never reaches zero.
  safeWide: 96,
  safeNarrowPerDepth: 0.009,
  safeMin: 42,

  // How much of the shelf outside the gap and the safe band carries spikes.
  spikeShareBase: 0.08,
  spikeSharePerDepth: 0.00012,
  spikeShareMax: 0.62,

  // Margin kept at each wall so neither the gap nor the safe band is welded
  // into a corner where the player cannot line up on it.
  edgeMargin: 16,

  // The ceiling.
  ceilingStartY: 100,
  // How far the player may get ahead before it starts closing faster.
  ceilingMaxLead: 820,
  // How hard it pulls on the EXCESS lead, per second. At a full 1100/sec dive
  // against a 235/sec shaft this settles the lead at roughly 820 + 400 units:
  // a dive buys real room, holds it while you keep diving, and loses it the
  // moment you stop.
  ceilingCatchUp: 2.2,
};

/**
 * One floor.
 *
 * `gapX/gapW` is the hole. `safeX/safeW` is plain shelf. Everything else on
 * the shelf is spiked when `spiked` is true. The two bands never overlap, and
 * both always exist — see the guarantee above.
 */
export function makeLedge(y, depth, tuning = SHAFT_TUNING) {
  const t = { ...SHAFT_TUNING, ...tuning };
  const W = t.width;

  const gapW = clamp(t.gapWide - depth * t.gapNarrowPerDepth, t.gapMin, t.gapWide);
  const safeW = clamp(t.safeWide - depth * t.safeNarrowPerDepth, t.safeMin, t.safeWide);

  // Lay the two bands down side by side in a random order, then place that
  // pair somewhere across the width. Doing it as a pair is what guarantees
  // they cannot overlap however narrow the shelf gets.
  const pairW = gapW + safeW;
  const room = Math.max(0, W - t.edgeMargin * 2 - pairW);
  const pairX = t.edgeMargin + randRange(0, room);
  const gapFirst = Math.random() < 0.5;

  const gapX = gapFirst ? pairX : pairX + safeW;
  const safeX = gapFirst ? pairX + gapW : pairX;

  const spiked = Math.random() < Math.min(
    t.spikeShareBase + depth * t.spikeSharePerDepth,
    t.spikeShareMax,
  );

  return { y, gapX, gapW, safeX, safeW, spiked };
}

/** True where the player would fall straight through. */
export function isGap(ledge, x, halfWidth = 0) {
  return x - halfWidth >= ledge.gapX && x + halfWidth <= ledge.gapX + ledge.gapW;
}

/** True where landing is safe — plain shelf, or any shelf on an unspiked floor. */
export function isSafeLanding(ledge, x, halfWidth = 0) {
  if (isGap(ledge, x, halfWidth)) return false;
  if (!ledge.spiked) return true;
  return x - halfWidth >= ledge.safeX && x + halfWidth <= ledge.safeX + ledge.safeW;
}

/** True where touching the floor hurts. */
export function isSpikeAt(ledge, x, halfWidth = 0) {
  if (isGap(ledge, x, halfWidth)) return false;
  return ledge.spiked && !isSafeLanding(ledge, x, halfWidth);
}

/**
 * The drawable runs of a ledge: the shelf either side of the gap, split so
 * the safe band can be drawn as plain shelf on an otherwise spiked floor.
 * Returned as { x, w, spiked } so the renderer needs no geometry of its own.
 */
export function ledgeSegments(ledge, tuning = SHAFT_TUNING) {
  const W = (tuning ?? SHAFT_TUNING).width;
  const shelves = [
    { x: 0, w: ledge.gapX },
    { x: ledge.gapX + ledge.gapW, w: W - (ledge.gapX + ledge.gapW) },
  ].filter((s) => s.w > 0);

  if (!ledge.spiked) return shelves.map((s) => ({ ...s, spiked: false }));

  const safeFrom = ledge.safeX;
  const safeTo = ledge.safeX + ledge.safeW;
  const out = [];

  for (const shelf of shelves) {
    const from = shelf.x;
    const to = shelf.x + shelf.w;
    const overlapFrom = Math.max(from, safeFrom);
    const overlapTo = Math.min(to, safeTo);

    if (overlapFrom >= overlapTo) { out.push({ ...shelf, spiked: true }); continue; }
    if (overlapFrom > from) out.push({ x: from, w: overlapFrom - from, spiked: true });
    out.push({ x: overlapFrom, w: overlapTo - overlapFrom, spiked: false });
    if (overlapTo < to) out.push({ x: overlapTo, w: to - overlapTo, spiked: true });
  }
  return out.filter((s) => s.w > 0);
}

/**
 * Where the ceiling is after this tick.
 *
 * It always descends with the shaft. Once the player is further ahead than
 * `ceilingMaxLead` it closes faster, so a dive buys a finite, earned margin
 * rather than permanent safety.
 */
export function chaseCeiling(ceilingY, playerY, scrollSpeed, dt, tuning = SHAFT_TUNING, viewTop = null) {
  const t = { ...SHAFT_TUNING, ...tuning };

  // It always descends with the shaft, whatever else is happening.
  let next = ceilingY + scrollSpeed * dt;

  // Past the allowed lead it closes on the EXCESS rather than at a multiple
  // of the shaft speed. That distinction is the whole fix: a fixed multiple
  // is a fixed top speed, and a dive at 1100 units/sec simply outran it —
  // the lead grew without bound and the ceiling left the game. Closing on
  // the excess means the harder you run, the harder it pulls, so the lead
  // settles instead of diverging.
  const excess = (playerY - next) - t.ceilingMaxLead;
  if (excess > 0) next += excess * t.ceilingCatchUp * dt;

  // AND IT NEVER LEAVES THE TOP OF THE VIEW. This is the part that was wrong
  // twice, and it was wrong because it was missing rather than mistuned.
  //
  // The lead above was expressed in WORLD units and the thing a player
  // actually complains about is expressed in SCREEN units, and the two never
  // met. The camera holds the player 302 pixels below the top of the view
  // (172 in a full dive) and the lead settles at 820, so at equilibrium the
  // spikes sat 518 pixels ABOVE the top of the screen -- not transiently while
  // the player got ahead, but as the resting state of the model. No value of
  // ceilingCatchUp changes that: the equilibrium lead is nearly three times
  // the room the camera gives, so the ceiling was always outside the frame.
  //
  // Which is also where "it spawned on top of me" came from. Something
  // invisible that closes the moment you slow down does not appear to close --
  // it appears to arrive. Held at the top edge it is always visible, always
  // approaching, and the pressure is something you can watch.
  //
  // viewTop is optional so the pure-rules tests can still call this without a
  // camera; game.js always passes it.
  if (viewTop !== null) next = Math.max(next, viewTop);

  // It may REACH the player — that is the death this game is named for, and
  // game.js turns it into a hit. What it must never do is step past them in
  // one tick, which would read as a teleport rather than a crush.
  return Math.min(next, playerY);
}

// --- The descent itself ---------------------------------------------------
//
// WHY THIS MOVED HERE, AND IT SHOULD HAVE BEEN HERE ALL ALONG.
//
// Sinkhole is the only game in the arcade whose difficulty was never measured,
// and the reason is structural rather than an oversight: the ceiling, the
// player and the camera all lived in game.js, tangled up with a canvas, so no
// bot could ever play it. Three separate reports of the same fault -- spikes
// that leave the top of the screen -- went out of the door because nothing
// could play ten thousand runs and say what the ceiling was doing.
//
// The camera is in here too, which looks like presentation and is not. The
// moment the ceiling was clamped to the top of the view, where the view is
// became a rule: it decides how much room the player has above them, which
// decides when they are crushed. A number that decides a death is not a
// drawing concern.
//
// game.js keeps the canvas, the particles, the audio and the shell. It owns no
// physics.

/** Player and world constants. Separate from the tuning above so a test can
 *  clone and override either without disturbing the other. */
export const PHYSICS = {
  width: 480,
  height: 720,

  gravity: 1500,
  diveGravity: 3400,
  maxFall: 760,
  maxDiveFall: 1150,

  moveAccel: 3200,
  maxMove: 320,
  groundDragPerSecond: 0.0005,
  airDragPerSecond: 0.06,

  playerRadius: 14,
  ledgeHeight: 16,
  ledgeSpacing: 132,

  baseScroll: 62,
  scrollPerDepth: 0.011,
  maxScroll: 235,

  startLives: 3,
  invulnTime: 1.6,
  ceilingHeight: 100,

  // Where the player sits on screen, and how much further down the view slides
  // while diving. See viewTopFor: the lookahead may not eat the room the
  // ceiling occupies.
  camAnchor: 720 * 0.42,
  camLookahead: 130,
  camFollow: 7,
  ceilingRoom: 280,
};

/**
 * The world position of the TOP of the view.
 *
 * This is a rule, not a camera trick: chaseCeiling clamps the spikes to this
 * line, so it sets how much room the player has above them. The lookahead
 * slides the view down to show more of what is coming, which pushes the player
 * up the screen -- and that would shorten the gap to the spikes hardest at the
 * exact moment the player is going fastest. Looking further ahead should cost
 * you what is behind you, and the spikes are not behind you.
 */
export function viewTopFor(playerY, vy, physics = PHYSICS) {
  const p = { ...PHYSICS, ...physics };
  const dive = Math.min(1, Math.max(0, vy / p.maxDiveFall));
  const want = Math.max(0, playerY - p.camAnchor + dive * p.camLookahead);
  return Math.min(want, Math.max(0, playerY - p.ceilingRoom));
}

/** How fast the shaft rises at this depth. */
export function scrollAt(depth, physics = PHYSICS) {
  const p = { ...PHYSICS, ...physics };
  return Math.min(p.baseScroll + depth * p.scrollPerDepth, p.maxScroll);
}

/**
 * One run, with no canvas anywhere in it.
 *
 * `clampCeiling` exists so the harness can play the OLD model as well as the
 * new one and put a number on the difference. It is not a game option -- game.js
 * always leaves it on.
 */
export class Descent {
  constructor({ tuning = SHAFT_TUNING, physics = PHYSICS, clampCeiling = true } = {}) {
    this.t = { ...SHAFT_TUNING, ...tuning };
    this.p = { ...PHYSICS, ...physics };
    this.clampCeiling = clampCeiling;

    this.depth = 0;
    this.lives = this.p.startLives;
    this.invuln = 0;
    this.dead = false;
    this.hits = 0;
    this.spikeHits = 0;
    this.crushes = 0;
    this.time = 0;

    this.x = this.p.width / 2;
    this.y = 200;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;

    this.ceilingY = this.p.ceilingHeight;
    this.camY = 0;
    this.ledges = [];
    for (let y = 360; y < this.p.height + this.p.ledgeSpacing; y += this.p.ledgeSpacing) {
      this.ledges.push(makeLedge(y, this.depth, this.t));
    }
  }

  get scrollSpeed() {
    return scrollAt(this.depth, this.p);
  }

  /** Metres, the way the game reports it. */
  get metres() {
    return Math.floor(this.depth / 10);
  }

  /** How far above the top of the view the spikes are. Negative is on screen. */
  get spikesAboveView() {
    return this.camY - this.ceilingY;
  }

  step(dt, input = {}) {
    if (this.dead) return;
    const p = this.p;
    const moveX = Math.max(-1, Math.min(1, input.x ?? 0));
    const diving = Boolean(input.dive);

    this.time += dt;

    this.vx += moveX * p.moveAccel * dt;
    const drag = this.onGround ? p.groundDragPerSecond : p.airDragPerSecond;
    this.vx *= drag ** dt;
    this.vx = Math.max(-p.maxMove, Math.min(p.maxMove, this.vx));
    this.x = Math.max(p.playerRadius,
      Math.min(p.width - p.playerRadius, this.x + this.vx * dt));

    const gravity = diving ? p.diveGravity : p.gravity;
    const terminal = diving ? p.maxDiveFall : p.maxFall;
    this.vy = Math.min(this.vy + gravity * dt, terminal);

    const bottomBefore = this.y + p.playerRadius;
    this.y += this.vy * dt;

    const rise = this.scrollSpeed * dt;
    this.depth += rise;
    for (const ledge of this.ledges) ledge.y -= rise;

    this.onGround = false;
    this.#land(bottomBefore, rise);
    if (this.onGround) this.y -= rise;

    this.#recycle();

    this.camY += (viewTopFor(this.y, this.vy, p) - this.camY)
      * (1 - Math.exp(-dt * p.camFollow));

    this.ceilingY = chaseCeiling(
      this.ceilingY, this.y, this.scrollSpeed, dt, this.t,
      this.clampCeiling ? this.camY : null,
    );

    if (this.y - p.playerRadius < this.ceilingY) {
      this.y = this.ceilingY + p.playerRadius;
      this.crushes++;
      this.#hurt();
    }

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
  }

  #land(bottomBefore, rise) {
    if (this.vy < 0) return;
    const p = this.p;
    const bottomAfter = this.y + p.playerRadius;

    const crossed = [];
    for (const ledge of this.ledges) {
      const yBefore = ledge.y + rise;
      if (bottomBefore > yBefore) continue;
      if (bottomAfter < ledge.y) continue;
      crossed.push(ledge);
    }
    if (crossed.length === 0) return;
    crossed.sort((a, b) => a.y - b.y);

    for (const ledge of crossed) {
      if (isGap(ledge, this.x, p.playerRadius)) continue;
      if (isSpikeAt(ledge, this.x, p.playerRadius)) {
        this.spikeHits++;
        this.#hurt();
        return;
      }
      this.y = ledge.y - p.playerRadius;
      this.vy = 0;
      this.onGround = true;
      return;
    }
  }

  #recycle() {
    const p = this.p;
    this.ledges = this.ledges.filter((ledge) => ledge.y > -p.ledgeHeight * 2);
    let low = -Infinity;
    for (const ledge of this.ledges) low = Math.max(low, ledge.y);
    if (low === -Infinity) low = 0;
    while (low < this.camY + p.height + p.ledgeSpacing) {
      low += p.ledgeSpacing;
      this.ledges.push(makeLedge(low, this.depth, this.t));
    }
  }

  #hurt() {
    if (this.invuln > 0) return;
    this.hits++;
    this.lives--;
    if (this.lives <= 0) {
      this.dead = true;
      return;
    }
    const p = this.p;
    this.invuln = p.invulnTime;
    this.y = p.ceilingHeight + p.height * 0.34;
    this.vy = 0;
    this.vx = 0;
    this.camY = viewTopFor(this.y, this.vy, p);
  }
}
