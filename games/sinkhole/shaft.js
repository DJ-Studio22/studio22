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
export function chaseCeiling(ceilingY, playerY, scrollSpeed, dt, tuning = SHAFT_TUNING) {
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

  // It may REACH the player — that is the death this game is named for, and
  // game.js turns it into a hit. What it must never do is step past them in
  // one tick, which would read as a teleport rather than a crush.
  return Math.min(next, playerY);
}
