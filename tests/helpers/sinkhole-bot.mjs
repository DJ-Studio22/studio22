// tests/helpers/sinkhole-bot.mjs
//
// A bot that plays Sinkhole, because until now nothing could.
//
// The game's difficulty had never been measured, and that is why the same
// fault -- spikes leaving the top of the screen -- shipped three times: the
// player, the ceiling and the camera all lived inside game.js next to a canvas,
// so there was nothing a test could drive. games/sinkhole/shaft.js now holds the
// whole descent with no DOM in it, and this plays it.
//
// TWO SKILL LEVELS, DIFFERING IN JUDGEMENT RATHER THAN IN REFLEXES.
//
// Neither bot moves faster than the other, thinks more often, or gets a longer
// reach. What separates them is how far ahead they look and whether they are
// willing to commit:
//
//   competent  aims at the gap in the ledge immediately below, and dives only
//              once it is lined up. It is safe, and it is slow, and the
//              ceiling is what punishes it.
//   good       aims at the gap TWO ledges down when it can already fit through
//              the first, so it is set up before it arrives, and dives on any
//              alignment it can hold. It gets more depth for the same risk.
//
// That is the shape CLAUDE.md asks for: a change that helps only the weak bot
// is forgiveness, one that helps both equally is an easier game, and one that
// closes the gap has flattened the ceiling.

import { Descent, PHYSICS, SHAFT_TUNING, isSpikeAt } from '../../games/sinkhole/shaft.js';

export const SKILLS = {
  // How many ledges ahead the bot lines itself up on.
  competent: { lookahead: 1, diveMargin: 26, commitsEarly: false },
  good: { lookahead: 2, diveMargin: 44, commitsEarly: true },
};

/** The ledges below the player, nearest first. */
function ledgesBelow(run) {
  const feet = run.y + run.p.playerRadius;
  return run.ledges
    .filter((ledge) => ledge.y >= feet - 1)
    .sort((a, b) => a.y - b.y);
}

/**
 * Where the bot wants to be, horizontally.
 *
 * The gap is the way down. When there is no gap to aim at -- which the shelf
 * guarantee makes rare but not impossible within the lookahead -- it aims at
 * the safe band instead, because standing on spikes is the one thing worse
 * than standing still.
 */
function targetX(run, skill) {
  const below = ledgesBelow(run);
  if (below.length === 0) return run.p.width / 2;

  const ledge = below[Math.min(skill.lookahead, below.length) - 1];
  const nearest = below[0];

  // Set up on the FURTHER ledge only when the nearer one is already passable
  // from here -- otherwise the bot walks past a hole it was standing over.
  const fitsNearest = run.x - run.p.playerRadius >= nearest.gapX
    && run.x + run.p.playerRadius <= nearest.gapX + nearest.gapW;
  const aim = (skill.lookahead > 1 && fitsNearest) ? ledge : nearest;

  const centre = aim.gapX + aim.gapW / 2;
  if (aim.gapW > run.p.playerRadius * 2) return centre;

  // The gap is too tight to fit: aim for somewhere that is not spikes.
  const step = 8;
  let best = centre;
  let bestCost = Infinity;
  for (let x = run.p.playerRadius; x <= run.p.width - run.p.playerRadius; x += step) {
    if (isSpikeAt(aim, x, run.p.playerRadius)) continue;
    const cost = Math.abs(x - run.x);
    if (cost < bestCost) { bestCost = cost; best = x; }
  }
  return best;
}

/**
 * Plays one run and reports what happened.
 *
 * `clampCeiling: false` reproduces the model as it was before the spikes were
 * held in the view, which is the only way to say what that change cost.
 */
export function runOnce(skillName = 'competent', {
  seconds = 120,
  tuning = SHAFT_TUNING,
  physics = PHYSICS,
  clampCeiling = true,
} = {}) {
  const skill = SKILLS[skillName] ?? SKILLS.competent;
  const run = new Descent({ tuning, physics, clampCeiling });

  const dt = 1 / 60;
  let worstSpikesAbove = -Infinity;

  for (let i = 0; i < seconds / dt && !run.dead; i++) {
    const want = targetX(run, skill);
    const dx = want - run.x;
    // A direction, not a position: the bot pushes the same stick a player has,
    // and overshoots the same way.
    const move = Math.abs(dx) < 4 ? 0 : Math.sign(dx);

    // Dive once lined up. The margin is the judgement: a cautious bot wants to
    // be dead centre before committing, a confident one accepts being close.
    const below = ledgesBelow(run);
    const nearest = below[0];
    let dive = false;
    if (nearest) {
      const centre = nearest.gapX + nearest.gapW / 2;
      const lined = Math.abs(run.x - centre) <= skill.diveMargin
        && nearest.gapW > run.p.playerRadius * 2;
      dive = lined || (skill.commitsEarly && run.onGround && Math.abs(dx) < 4);
    }

    run.step(dt, { x: move, dive });
    worstSpikesAbove = Math.max(worstSpikesAbove, run.spikesAboveView);
  }

  return {
    metres: run.metres,
    seconds: +run.time.toFixed(1),
    lives: run.lives,
    hits: run.hits,
    spikeHits: run.spikeHits,
    crushes: run.crushes,
    survived: !run.dead,
    // Positive means the spikes were above the top of the view at some point.
    worstSpikesAbove: Math.round(worstSpikesAbove),
  };
}
