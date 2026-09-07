// tests/helpers/paintball-bot.mjs
//
// One player for Pixel Paintball, with ONE field that changes: `aggression`.
//
// At nought it never shoots at a bot on purpose — it goes where the ground is
// not its own and paints. At one it does nothing but hunt. In between it does
// some of each, and the whole design stands or falls on the best score being
// somewhere in the middle: if either end wins, territory is a decoration on a
// shooting gallery, or the bots are a decoration on a painting exercise.
//
// Everything else about the bot is identical across the sweep -- the same
// movement, the same trigger discipline, the same habit of walking over a
// powerup it happens to pass. So a difference in score can only be the mix.

import { Arena, OWNER, TUNING } from '../../games/pixel-paintball/arena.js';

// When to stop and refill, and how full to get before moving off again. Shared
// by every aggression, deliberately: the ink discipline must not be the thing
// that separates them, or the sweep would be measuring reloading.
const REFILL_BELOW = 22;
const REFILL_UNTIL = 78;

const STEP = 1 / 60;

/**
 * The nearest place worth reloading in: somewhere the ground AROUND it is
 * mostly the player's, not merely one cell of their paint.
 *
 * Sampled on a coarse lattice rather than cell by cell, because a bot that
 * searches fifteen hundred cells for the perfect corner every third of a
 * second is a solver rather than a player.
 */
function nearestHome(arena) {
  const t = arena.t;
  let best = null;
  for (let cy = 3; cy < t.rows; cy += 3) {
    for (let cx = 3; cx < t.cols; cx += 3) {
      if (arena.homeShare(cx + 0.5, cy + 0.5) < t.refillHomeShare) continue;
      const d = (cx - arena.player.x) ** 2 + (cy - arena.player.y) ** 2;
      if (!best || d < best.d) best = { d, x: cx + 0.5, y: cy + 0.5 };
    }
  }
  return best;
}

/** The aggression each named skill plays at. */
export const SKILLS = {
  painter: { aggression: 0 },
  mixed: { aggression: 0.5 },
  fragger: { aggression: 1 },
};

/**
 * Somewhere worth painting: the middle of whichever quarter of the arena the
 * bot owns least of. Coarse on purpose -- a perfect coverage solver would be
 * an oracle rather than a player, which is the mistake Colour Heist's router
 * made.
 */
function paintGoal(arena) {
  const t = arena.t;
  let worst = null;
  for (let qy = 0; qy < 3; qy++) {
    for (let qx = 0; qx < 3; qx++) {
      let mine = 0;
      let total = 0;
      const x0 = Math.floor((qx * t.cols) / 3);
      const x1 = Math.floor(((qx + 1) * t.cols) / 3);
      const y0 = Math.floor((qy * t.rows) / 3);
      const y1 = Math.floor(((qy + 1) * t.rows) / 3);
      for (let cy = y0; cy < y1; cy++) {
        for (let cx = x0; cx < x1; cx++) {
          total++;
          if (arena.cells[arena.index(cx, cy)] === OWNER.PLAYER) mine++;
        }
      }
      const share = mine / total;
      if (!worst || share < worst.share) {
        worst = { share, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      }
    }
  }
  return worst;
}

function nearestBot(arena) {
  let best = null;
  for (const bot of arena.bots) {
    if (bot.stun > 0) continue;
    const d = Math.hypot(bot.x - arena.player.x, bot.y - arena.player.y);
    if (!best || d < best.d) best = { bot, d };
  }
  return best;
}

/**
 * Play one run to its end and report it.
 *
 * `waves` caps it, because the escalation has no ceiling and a run that is
 * going well would otherwise only end when the harness got bored.
 */
export function runOnce(skillOrAggression, tuning = TUNING, options = {}) {
  const { waves = 8 } = options;
  const aggression = typeof skillOrAggression === 'number'
    ? skillOrAggression
    : SKILLS[skillOrAggression].aggression;

  const arena = new Arena(tuning);
  let goal = null;
  let rethink = 0;
  let hunting = false;
  let refilling = false;

  while (arena.running && arena.wave <= waves) {
    const p = arena.player;

    // Pick a plan a few times a second rather than every frame. A bot that
    // re-decides sixty times a second is not playing, it is averaging.
    // INK FIRST, at every aggression. Below a fifth of a tank, go and stand on
    // your own paint until it is most of the way back -- there is nothing else
    // worth doing while dry, since both painting and shooting come out of the
    // same tank.
    if (refilling && p.ink >= REFILL_UNTIL) refilling = false;
    if (p.ink < REFILL_BELOW) refilling = true;

    rethink -= STEP;
    if (rethink <= 0) {
      rethink = 0.35;
      hunting = !refilling && Math.random() < aggression;
      const target = hunting ? nearestBot(arena) : null;
      if (hunting && target) goal = { x: target.bot.x, y: target.bot.y };
      else { hunting = false; goal = paintGoal(arena); }

      // A powerup on the way is always worth having, at any aggression, so it
      // cannot be the thing that separates them.
      if (arena.powerup) {
        const d = Math.hypot(arena.powerup.x - p.x, arena.powerup.y - p.y);
        if (d < 14) goal = { x: arena.powerup.x, y: arena.powerup.y };
      }
    }

    const target = hunting ? nearestBot(arena) : null;
    if (hunting && target) goal = { x: target.bot.x, y: target.bot.y };

    if (refilling) {
      // Ground you already hold refills you six times faster, so it is worth
      // the walk -- and it is free to cross, because the roller only charges
      // for cells that change hands. With nothing of your own left there is
      // nowhere to go and the trickle is all there is, which is exactly the
      // hole an all-out hunter digs itself.
      const home = nearestHome(arena);
      goal = home ? { x: home.x, y: home.y } : { x: p.x, y: p.y };
    }

    const dx = (goal?.x ?? p.x) - p.x;
    const dy = (goal?.y ?? p.y) - p.y;
    const d = Math.hypot(dx, dy);

    // WHERE TO SHOOT. At the bot when hunting; along the ground you are
    // crossing otherwise, because a shot paints the whole way rather than only
    // where it lands.
    const aim = hunting && target
      ? Math.atan2(target.bot.y - p.y, target.bot.x - p.x)
      : Math.atan2(dy || 0.001, dx || 0.001);

    // Stop short of a bot rather than walking into it: standing on top of one
    // is how a painter gets splattered, and that would make aggression change
    // two things at once.
    const move = hunting && d < 6 ? { x: 0, y: 0 } : { x: dx, y: dy };

    // WHEN TO PULL THE TRIGGER. Only at a bot, and only one in range.
    //
    // The first harness held the trigger down the whole time, which was fine
    // while ink did not exist and nonsense afterwards: every aggression drained
    // the same tank at the same rate, so the sweep measured reloading rather
    // than the mix. Firing at something is the only firing worth ink.
    const shooting = hunting && target && !refilling && d < arena.t.shotRange;

    arena.step(STEP, { x: move.x, y: move.y, aim, fire: Boolean(shooting) });
  }

  const hold = arena.holdings();
  return {
    score: Math.round(arena.score),
    waves: arena.wave - (arena.running ? 1 : 0),
    hold: +hold.player.toFixed(3),
    bestHold: +arena.bestHold.toFixed(3),
    splattered: arena.splattered,
    timesHit: arena.timesHit,
    dry: +arena.player.dry.toFixed(1),
    survived: arena.running,
    reason: arena.reason,
  };
}
