// tests/helpers/skyhook-bot.mjs
//
// Two bots that play games/skyhook/swing.js, and the statistics they produce.
//
// TWO SKILL LEVELS, and the difference between them is the whole point:
//
//   competent  a first-timer who has understood the idea. Slow to react
//              (180ms), lets go somewhere in a wide window rather than at the
//              right moment, and pumps the swing less than half the time.
//   good       someone who has learned it. Reacts in 60ms, releases inside a
//              tight window near the top of the forward arc, always pumps, and
//              dives to buy speed when there is nothing to grab.
//
// A change that helps only the competent bot is forgiveness. A change that
// helps both in proportion is simply an easier game. A change that closes the
// gap between them has flattened the ceiling, which is the thing to avoid.
//
// This file is imported by skyhook.swing.test.mjs; it is not a test itself.

import { HOOK, Swing } from '../../games/skyhook/swing.js';
import { CITY_TUNING } from '../../games/skyhook/city.js';
import { percentile, seedRandom } from './seeded.mjs';

const DT = 1 / 60;
const MAX_SECONDS = 240;

// A player hanging on a rope making no ground is not surviving, they are
// stuck. Ending the run there keeps a bot that forgets to let go out of the
// survival statistics.
const STALL_SECONDS = 8;

export const SKILL = {
  competent: {
    reaction: 0.18,
    releaseFrom: 0.15,   // radians past the bottom of the arc
    releaseTo: 1.15,     // a wide, sloppy window
    pumpChance: 0.45,
    // A first-timer does not know to lean into the arc at all.
    leanSkill: 0,
    dive: false,
    fireDelay: 0.20,
  },
  good: {
    reaction: 0.06,
    releaseFrom: 0.55,
    releaseTo: 0.80,     // a tight window near the top of the forward arc
    pumpChance: 1,
    // Leans the way the arc is already going, which is how a swing is
    // pumped. Without this the bot never touches the mechanic and the
    // measurement covers only half the change.
    leanSkill: 1,
    dive: true,
    fireDelay: 0.05,
  },
};

/** One run. `swingOverrides` is merged over TUNING, so a test can A/B a dial. */
export function runOnce(skill, seed, swingOverrides = {}) {
  const restore = seedRandom(seed);
  try {
    const swing = new Swing(swingOverrides);
    const s = SKILL[skill];

    let sinceDecision = 0;
    let sinceRelease = 0;
    let firePressed = false;
    let dive = false;
    let reel = 0;
    let lean = 0;

    const pickRelease = () => s.releaseFrom + Math.random() * (s.releaseTo - s.releaseFrom);
    let releaseAt = pickRelease();

    let lastProgressAt = 0;
    let lastFurthest = swing.furthest;

    while (swing.running && swing.elapsed < MAX_SECONDS) {
      if (swing.furthest > lastFurthest + 1) {
        lastFurthest = swing.furthest;
        lastProgressAt = swing.elapsed;
      } else if (swing.elapsed - lastProgressAt > STALL_SECONDS) {
        swing.deathReason = 'stalled';
        break;
      }

      sinceDecision += DT;
      sinceRelease += DT;
      firePressed = false;

      if (sinceDecision >= s.reaction) {
        sinceDecision = 0;

        if (swing.hookState === HOOK.ATTACHED) {
          const dx = swing.hero.x - swing.hookTarget.x;
          const dy = swing.hero.y - swing.hookTarget.y;
          const theta = Math.atan2(dx, dy);        // 0 at the bottom, + forward
          const goingForward = swing.hero.vx > 0;

          // Pump: shorten on the way down, let out on the way up. Angular
          // momentum does the rest.
          if (Math.random() < s.pumpChance) {
            reel = theta < 0 && goingForward ? -1 : theta > 0.3 ? 1 : 0;
          } else {
            reel = 0;
          }

          // Lean the way the swing is already travelling: that is what adds
          // to the arc rather than fighting it.
          lean = (s.leanSkill ?? 0) * (goingForward ? 1 : -1);

          if (theta > releaseAt && goingForward) {
            firePressed = true;
            sinceRelease = 0;
          }
        } else if (swing.hookState === HOOK.IDLE) {
          reel = 0;
          lean = 0;
          dive = s.dive && swing.hero.vy > -50 && !swing.bestAnchor();

          const anchor = sinceRelease > s.fireDelay ? swing.bestAnchor() : null;
          if (anchor) {
            // The good bot waits for an anchor actually ahead of it; the
            // competent one grabs the first thing it sees.
            const ahead = anchor.x > swing.hero.x - 20;
            if (skill === 'competent' || ahead) {
              firePressed = true;
              releaseAt = pickRelease();
            }
          }
        }
      }

      swing.step(DT, { firePressed, dive, reel, lean });
      swing.drainEvents();
    }

    return {
      metres: swing.metres,
      seconds: swing.elapsed,
      rings: swing.ringsTaken,
      swings: swing.swings,
      bestCombo: swing.bestCombo,
      furthest: swing.furthest,
      reason: swing.deathReason || 'timeout',
    };
  } finally {
    restore();
  }
}

/**
 * Runs both skill levels over the same seeds.
 *
 * `overrides.swing` is merged over TUNING per run; `overrides.city` is applied
 * to the CITY_TUNING singleton for the duration and restored afterwards.
 */
export function measure(runs = 120, overrides = {}) {
  const cityBefore = { ...CITY_TUNING };
  Object.assign(CITY_TUNING, overrides.city ?? {});

  try {
    const out = {};
    for (const skill of Object.keys(SKILL)) {
      const results = [];
      for (let i = 0; i < runs; i++) results.push(runOnce(skill, i + 1, overrides.swing ?? {}));

      const metres = results.map((r) => r.metres);
      const seconds = results.map((r) => r.seconds);
      out[skill] = {
        runs: results.length,
        medianMetres: percentile(metres, 0.5),
        p10Metres: percentile(metres, 0.10),
        p90Metres: percentile(metres, 0.90),
        bestMetres: Math.max(...metres),
        medianSeconds: +percentile(seconds, 0.5).toFixed(1),
        veryShortRuns: metres.filter((m) => m < 25).length,
        medianRings: percentile(results.map((r) => r.rings), 0.5),
        medianSwings: percentile(results.map((r) => r.swings), 0.5),
      };
    }
    out.ceilingRatio = +(out.good.medianMetres / Math.max(1, out.competent.medianMetres)).toFixed(2);
    return out;
  } finally {
    Object.assign(CITY_TUNING, cityBefore);
  }
}

/** The numbers Skyhook shipped with before the difficulty pass. */
export const PRE_TUNING_BASELINE = {
  swing: { anchorBelowMargin: 0, grappleRange: 470, ropeMax: 380, ringMetres: 10 },
  city: { curve: 1, mastMin: 40, mastMax: 90, mastMaxGrow: 110, tallMastFactor: 1.7 },
};
