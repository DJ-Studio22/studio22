// tests/helpers/golf-bot.mjs
//
// Two bots for Endless Mini Golf, per tests/README.md convention 5.
//
// The search in green.js answers "can this hole be sunk at all". These answer
// the different question: how far does a round actually get, and is the stroke
// bank a real economy or a formality.
//
// What separates them is one thing, and it is the thing mini golf is about:
//
//   competent  aims at the cup. Straight line, power from distance, some
//              error in both. If a wall is in the way, that is the wall's
//              problem.
//   good       tries a fan of shots and picks the one that leaves the ball
//              best placed — which is how you play a dog-leg, and the only way
//              to play around water.
//
// Neither can see the hole's par or the solver's answer. Both see the grid and
// the ball, as a player does.

import { Course } from '../../games/mini-golf/holes.js';
import { TILE, TUNING, putt, reachAt } from '../../games/mini-golf/green.js';

export const SKILLS = {
  competent: { fanAngles: 0, angleError: 0.10, powerError: 0.12 },
  good: { fanAngles: 20, angleError: 0.02, powerError: 0.03 },
};

const jitter = (amount) => (Math.random() * 2 - 1) * amount;

/** The straight-at-it shot, with this bot's error on it. */
function directShot(hole, ball, s) {
  const dx = hole.cup.x - ball.x;
  const dy = hole.cup.y - ball.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) + jitter(s.angleError);
  // Power that would just about reach, so the ball dies near the cup rather
  // than rattling past it.
  let power = distance / reachAt(1);
  power = Math.min(1, Math.max(0.18, power * 1.05)) + jitter(s.powerError);
  return { angle, power: Math.min(1, Math.max(0.05, power)) };
}

/**
 * Tries a fan and keeps whichever shot leaves the ball nearest the cup —
 * sinking it outright if any does.
 */
function plannedShot(hole, ball, s, time) {
  let best = null;
  for (let a = 0; a < s.fanAngles; a++) {
    const angle = (a / s.fanAngles) * Math.PI * 2;
    for (const power of [0.35, 0.6, 0.85, 1]) {
      // Exploratory putts get a shorter clock than a real one: a shot still
      // rolling after six seconds is not the shot this bot wants anyway, and
      // the fan is 80 simulations per stroke.
      const result = putt(hole, ball, angle, power, { startTime: time, maxSeconds: 6 });
      if (result.sunk) return { angle, power };
      // Water costs a stroke: price it in rather than walking into it.
      const penalty = result.reason === 'water' ? TILE * 6 : 0;
      const score = Math.hypot(result.x - hole.cup.x, result.y - hole.cup.y) + penalty;
      if (!best || score < best.score) best = { angle, power, score };
    }
  }
  if (!best) return directShot(hole, ball, s);
  return {
    angle: best.angle + jitter(s.angleError),
    power: Math.min(1, Math.max(0.05, best.power + jitter(s.powerError))),
  };
}

/** One round. Returns holes completed and why it ended. */
export function runOnce(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const course = new Course(tuning);

  // A cap on strokes, so a bot that cannot finish a hole cannot hang the
  // suite. The bank runs out long before this in any real round.
  for (let i = 0; i < 400 && course.running; i++) {
    const shot = s.fanAngles > 0
      ? plannedShot(course.hole, course.ball, s, course.time)
      : directShot(course.hole, course.ball, s);
    course.play(shot.angle, shot.power);
  }

  return {
    completed: course.completed,
    bank: course.bank,
    holeNumber: course.holeNumber,
    reason: course.reason,
    alive: course.running,
  };
}
