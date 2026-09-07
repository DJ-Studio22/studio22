// tests/helpers/gravity-bot.mjs
//
// Two pilots for Gravity Well, differing in ONE field: `usesPrediction`.
//
// The planner chooses what to do by flying the choice first -- it runs the same
// predict() the game draws on screen, over each of a handful of candidate
// controls, and takes the one whose path ends up nearest the gate at a speed it
// could actually arrive at. That is precisely the skill the game claims to be
// about, performed by a machine.
//
// The chaser has the same craft, the same fuel, the same turn rate and the same
// greed. It just cannot see the future: it points at the gate and burns. It is
// not a weak pilot -- it is the null hypothesis, and if it kept up, the line on
// screen would be decoration.

import {
  Flight, TUNING, advance, predict, speedOf,
} from '../../games/gravity-well/orbit.js';

export const SKILLS = {
  planner: { usesPrediction: true },
  chaser: { usesPrediction: false },
};

// How often a pilot changes its mind. Not every frame: a pilot that re-decides
// a hundred and twenty times a second is not flying, it is averaging.
const DECIDE_EVERY = 0.25;

// What it is allowed to do. The same set for both bots; only whether the
// choice is made by looking ahead differs.
const CONTROLS = [
  { turn: 0, burn: false },
  { turn: 0, burn: true },
  { turn: -1, burn: false },
  { turn: 1, burn: false },
  { turn: -1, burn: true },
  { turn: 1, burn: true },
  { turn: -0.45, burn: true },
  { turn: 0.45, burn: true },
];

/**
 * How good a future is: how near the gate it gets, and how fast it is going
 * when it gets there.
 *
 * Deliberately simple. A scorer that solved the level analytically would be an
 * oracle rather than a player -- the mistake Colour Heist's router made, where
 * the clock was derived from the same solver that was being measured against
 * it.
 */
function scorePath(state, bodies, gate, control, t, seconds) {
  const copy = { ...state };
  const steps = Math.round(seconds / t.step);
  let best = Infinity;
  let bestSpeed = 0;
  for (let i = 0; i < steps; i++) {
    advance(copy, bodies, control, t.step, t);
    for (const body of bodies) {
      if (Math.hypot(copy.x - body.x, copy.y - body.y) < body.radius + t.craftRadius) {
        return { cost: Infinity, crashes: true };
      }
    }
    const d = Math.hypot(copy.x - gate.x, copy.y - gate.y);
    if (d < best) { best = d; bestSpeed = speedOf(copy); }
  }
  // Arriving too fast is not arriving, so overspeed is charged for rather than
  // ignored -- otherwise every plan is "dive at it".
  const over = Math.max(0, bestSpeed - t.gateSpeed);
  return { cost: best + over * 2.2, crashes: false };
}

function decidePlanner(flight, t) {
  let best = null;
  for (const control of CONTROLS) {
    if (control.burn && flight.craft.fuel <= 0) continue;
    const { cost } = scorePath(flight.craft, flight.bodies, flight.gate, control, t, t.predictSeconds);
    if (!best || cost < best.cost) best = { cost, control };
  }
  return best ? best.control : { turn: 0, burn: false };
}

function decideChaser(flight, t) {
  const craft = flight.craft;
  const wanted = Math.atan2(flight.gate.y - craft.y, flight.gate.x - craft.x);
  let delta = wanted - craft.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const turn = Math.abs(delta) < 0.05 ? 0 : Math.sign(delta);
  // Burn while pointing more or less at it and not already going too fast to
  // stop -- the obvious way to fly if you cannot see what the bodies will do.
  const burn = Math.abs(delta) < 0.6 && speedOf(craft) < t.gateSpeed * 1.6;
  return { turn, burn };
}

/**
 * Fly one run and report it.
 *
 * `levels` caps it: the escalation has no ceiling, so a run that is going well
 * would otherwise end only when the harness got bored.
 */
export function runOnce(skillName, tuning = TUNING, options = {}) {
  const { levels = 6, patienceSeconds = 45 } = options;
  const skill = SKILLS[skillName];
  const flight = new Flight(tuning);
  const t = tuning;

  let sinceDecision = DECIDE_EVERY;
  let control = { turn: 0, burn: false };
  let levelStarted = 0;
  let clock = 0;

  while (flight.running && flight.level <= levels) {
    sinceDecision += t.step;
    if (sinceDecision >= DECIDE_EVERY) {
      sinceDecision = 0;
      control = skill.usesPrediction ? decidePlanner(flight, t) : decideChaser(flight, t);
    }
    const level = flight.level;
    flight.step(t.step, control);
    clock += t.step;
    if (flight.level !== level) levelStarted = clock;

    // Give up on a level nobody is going to finish, so a craft in a stable
    // orbit does not run the harness forever.
    if (clock - levelStarted > patienceSeconds) break;
  }

  return {
    score: flight.score,
    gates: flight.gatesMade,
    level: flight.level,
    fuelSpent: Math.round(flight.fuelSpent),
    reason: flight.reason,
    alive: flight.running,
  };
}

/** Handy for a test that wants the prediction itself rather than a whole run. */
export { predict };
