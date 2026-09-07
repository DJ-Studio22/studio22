// tests/helpers/tank-bot.mjs
//
// Two bots for Tank Tactics, per tests/README.md convention 5.
//
// They differ in exactly ONE thing, and it is the thing the game claims is its
// skill ceiling:
//
//   direct  only takes shots it has a clear line for. If cover is in the way,
//           it repositions and waits.
//   bank    takes those too, and when it cannot see a target it solves the
//           one-bounce shot off a wall and takes that instead.
//
// Everything else — how they move, how they pick a target, how they lead — is
// identical, so the gap between them is the value of the ricochet and nothing
// else. If that gap is small, the ceiling is decorative and the game is a
// twin-stick shooter wearing a physics puzzle as a hat.
//
// Neither bot can see the arena's internals. Both get what a player gets: the
// positions, the cover, and the same solver the aiming line on screen uses.

import {
  Battle, TUNING, bankSolutions, canHurt, hasLineOfSight,
} from '../../games/tank-tactics/arena.js';

export const SKILLS = {
  direct: { banks: false, aimError: 0.05, leads: true },
  bank: { banks: true, aimError: 0.05, leads: true },
};

/** The nearest living enemy. */
function nearest(battle) {
  let best = null;
  for (const e of battle.enemies) {
    const d = Math.hypot(e.x - battle.player.x, e.y - battle.player.y);
    if (!best || d < best.d) best = { e, d };
  }
  return best;
}

/**
 * Where to aim to hit a moving target with a shell of finite speed.
 *
 * Both bots lead, so leading is not what separates them.
 */
function leadAngle(from, target, speed) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const distance = Math.hypot(dx, dy);
  const flight = distance / speed;
  const px = target.x + (target.vx ?? 0) * flight;
  const py = target.y + (target.vy ?? 0) * flight;
  return Math.atan2(py - from.y, px - from.x);
}

const jitter = (a) => (Math.random() * 2 - 1) * a;

/** What this bot does this frame. */
export function decide(battle, s, tuning = TUNING) {
  const p = battle.player;
  const target = nearest(battle);
  const input = { x: 0, y: 0, aim: p.turret, fire: false };
  if (!target) return input;

  // Movement is the same for both: keep a working distance and keep moving,
  // because a stationary tank is a dead tank in any of these waves.
  const away = Math.atan2(p.y - target.e.y, p.x - target.e.x);
  const want = 14;
  const drive = target.d < want ? 1 : -0.55;
  input.x = Math.cos(away) * drive;
  input.y = Math.sin(away) * drive;

  // A dug-in tank cannot be hurt head on, so a clear line at one is worth
  // nothing and the bank is the only shot there is.
  const mustBank = !canHurt(target.e, { bounces: 0 }, tuning);

  if (s.banks && mustBank) {
    const solutions = bankSolutions(p, target.e, battle.cover, tuning);
    if (solutions.length) {
      input.aim = solutions[0].angle + jitter(s.aimError);
      input.fire = true;
      return input;
    }
  }

  const clear = !mustBank && hasLineOfSight(p, target.e, battle.cover, tuning);
  if (clear) {
    input.aim = leadAngle(p, target.e, tuning.shellSpeed) + jitter(s.aimError);
    input.fire = true;
    return input;
  }

  if (s.banks) {
    // THE WHOLE DIFFERENCE. Cover between you and the target is a reason to
    // bank, not a reason to wait.
    const solutions = bankSolutions(p, target.e, battle.cover, tuning);
    if (solutions.length) {
      input.aim = solutions[0].angle + jitter(s.aimError);
      input.fire = true;
      return input;
    }
  }

  // No shot at all: strafe to open one, rather than standing there.
  //
  // Without this the bot and a blocked enemy would face each other through a
  // block and neither would ever move — the wave could not end and every run
  // finished on the harness cap with zero waves cleared. A bot that cannot
  // create its own shot is not measuring the game, it is measuring a deadlock.
  const around = Math.atan2(target.e.y - p.y, target.e.x - p.x);
  input.x = -Math.sin(around);
  input.y = Math.cos(around);
  input.aim = around;
  // And it still shoots: cover comes apart, so firing at the thing in the way
  // is a legitimate answer and the direct bot needs to have it, or the
  // comparison flatters banking by giving the other bot nothing to do.
  input.fire = true;
  return input;
}

/** One battle. Returns waves cleared and why it ended. */
export function runOnce(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const battle = new Battle(tuning);
  const dt = 1 / 60;

  // A cap, so a bot that has solved the arena cannot hang the suite.
  for (let i = 0; i < 60 * 600 && battle.running; i++) {
    battle.step(dt, decide(battle, s, tuning));
  }

  return {
    waves: battle.wavesCleared,
    reason: battle.reason,
    alive: battle.running,
    shots: battle.shotsFired,
    bankHits: battle.bankHits,
    directHits: battle.directHits,
  };
}
