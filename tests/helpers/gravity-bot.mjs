// tests/helpers/gravity-bot.mjs
//
// Two pilots for Gravity Well, differing in ONE field: `usesPrediction`.
//
// The planner chooses what to do by flying the choice first -- it runs the same
// predict() the game draws on screen over each of a handful of candidate
// controls, and takes the one that ends furthest down the corridor without
// ending in a planet. That is precisely the skill the game claims to be about,
// performed by a machine.
//
// The chaser has the same craft, the same fuel, the same turn rate and the same
// impatience. It just cannot see the future: it points down the corridor, or at
// a fuel ring when the tank is low, and burns. It is not a weak pilot -- it is
// the null hypothesis, and if it kept up, the line on screen would be
// decoration.

import { Flight, TUNING, advance, predict, speedOf } from '../../games/gravity-well/orbit.js';

export const SKILLS = {
  planner: { usesPrediction: true },
  chaser: { usesPrediction: false },
};

// How often a pilot changes its mind. Not every frame: a pilot that re-decides
// a hundred and twenty times a second is not flying, it is averaging.
const DECIDE_EVERY = 0.25;

// What it is allowed to do. The same set for both; only whether the choice is
// made by looking ahead differs.
// Any path that ends badly costs more than any path that does not, and among
// the bad ones, later is better.
const DOOMED = 1e6;

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
 * How good a future is: how far down the corridor it gets, whether it ends in
 * something, and whether it collects fuel on the way.
 *
 * Deliberately simple. A scorer that solved the corridor analytically would be
 * an oracle rather than a player -- the mistake Colour Heist's router made.
 */
function scorePath(flight, control, t, seconds) {
  const copy = { ...flight.craft };
  const bodies = flight.bodies;
  const rings = flight.rings;
  const steps = Math.round(seconds / t.step);
  let ringsHit = 0;
  const taken = new Set();

  for (let i = 0; i < steps; i++) {
    advance(copy, bodies, control, t.step, t);
    // A CRASH IS NOT A CRASH IS NOT A CRASH.
    //
    // This used to return Infinity for any path that ended badly, which made
    // every doomed option identical -- and in a corridor this dense most
    // options are doomed somewhere inside a long horizon, so the longer the
    // pilot looked the more often EVERY candidate came back Infinity and the
    // choice fell through to a fallback. Measured: 2156 units at four seconds
    // of lookahead, 966 at nine and a half, 578 at fifteen. Looking further
    // ahead made it fly worse, which is the opposite of the game's whole claim
    // and was entirely the scorer's fault.
    //
    // Dying later is better than dying sooner, so it is scored that way.
    for (const body of bodies) {
      if (Math.hypot(copy.x - body.x, copy.y - body.y) < body.radius + t.craftRadius) {
        return { cost: DOOMED - i };
      }
    }
    if (copy.y < 0 || copy.y > t.height) return { cost: DOOMED - i };
    for (const ring of rings) {
      if (taken.has(ring.id)) continue;
      if (Math.hypot(copy.x - ring.x, copy.y - ring.y) < t.gateRadius) {
        taken.add(ring.id);
        ringsHit++;
      }
    }
  }

  // Distance is the score, so distance is the goal -- with fuel weighted in,
  // because a stretch flown on an empty tank ends the run whatever it covered.
  const dry = copy.fuel <= 0 && ringsHit === 0;
  return { cost: -copy.x - ringsHit * 260 + (dry ? 400 : 0) };
}

function decidePlanner(flight, t) {
  let best = null;
  for (const control of CONTROLS) {
    if (control.burn && flight.craft.fuel <= 0) continue;
    const { cost } = scorePath(flight, control, t, t.predictSeconds);
    if (!best || cost < best.cost) best = { cost, control };
  }
  // If every candidate ends in a planet, do SOMETHING rather than nothing:
  // coasting is also a choice and it is the one that definitely crashes.
  return best ? best.control : { turn: 1, burn: true };
}

function decideChaser(flight, t) {
  const craft = flight.craft;
  // Head down the corridor, or at a ring when the tank is running out -- the
  // obvious way to fly if you cannot see what the bodies will do to you.
  let goalX = craft.x + 200;
  let goalY = t.height / 2;
  if (craft.fuel < t.fuel * 0.4) {
    let best = null;
    for (const ring of flight.rings) {
      if (ring.x < craft.x - 10) continue;
      const d = Math.hypot(ring.x - craft.x, ring.y - craft.y);
      if (!best || d < best.d) best = { ring, d };
    }
    if (best) { goalX = best.ring.x; goalY = best.ring.y; }
  }

  const wanted = Math.atan2(goalY - craft.y, goalX - craft.x);
  let delta = wanted - craft.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const turn = Math.abs(delta) < 0.05 ? 0 : Math.sign(delta);
  const burn = Math.abs(delta) < 0.6 && speedOf(craft) < 70;
  return { turn, burn };
}

/**
 * Fly one run and report it.
 *
 * `seconds` caps it: the corridor has no end, so a run that is going well would
 * otherwise finish only when the harness got bored.
 */
export function runOnce(skillName, tuning = TUNING, options = {}) {
  const { seconds = 90 } = options;
  const skill = SKILLS[skillName];
  const flight = new Flight(tuning);
  const t = tuning;

  let sinceDecision = DECIDE_EVERY;
  let control = { turn: 0, burn: false };
  let guard = 0;

  while (flight.running && flight.time < seconds && guard++ < 2_000_000) {
    sinceDecision += t.step;
    if (sinceDecision >= DECIDE_EVERY) {
      sinceDecision = 0;
      control = skill.usesPrediction ? decidePlanner(flight, t) : decideChaser(flight, t);
    }
    // NOTHING MOVES UNTIL THE PLAYER TOUCHES A CONTROL, which is right for a
    // person reading the corridor and a trap for a bot: a pilot that decides to
    // coast never starts the clock, and the harness spins forever on a run that
    // has not begun. A deciding-to-do-nothing pilot still has to press
    // something.
    const nudge = !flight.armed && !control.burn && !control.turn
      ? { turn: 0.0001, burn: false }
      : control;
    flight.step(t.step, nudge);
  }

  return {
    score: flight.score,
    distance: Math.round(flight.distance),
    rings: flight.ringsTaken,
    fuelSpent: Math.round(flight.fuelSpent),
    seconds: +flight.time.toFixed(1),
    reason: flight.reason,
    alive: flight.running,
  };
}

export { predict };
