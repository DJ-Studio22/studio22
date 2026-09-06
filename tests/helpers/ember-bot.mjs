// tests/helpers/ember-bot.mjs
//
// Two bots for Ember, at two skill levels, per tests/README.md convention 5.
//
// Both see the same world and both output only the one bit the player has:
// burner on, or burner off. What separates them is stated on SKILLS below.
// If those two played the same, Ember's momentum claim would be decorative.

import { Flight, TUNING } from '../../games/ember/gorge.js';

/**
 * The gate the balloon is flying at — the first one still ahead of it.
 */
function gateAhead(flight, skip = 0) {
  let seen = 0;
  for (const g of flight.gates) {
    if (g.x > flight.x) {
      if (seen === skip) return g;
      seen++;
    }
  }
  return flight.gates[flight.gates.length - 1];
}

// Both bots aim at the gap in FRONT of them. Flying at the one after it is
// just flying into rock, which is what the first version of this file did —
// the "good" bot scored WORSE than the competent one until that was fixed.
//
// Two things separate them, and both are what "read the gap early" means once
// it has to be a number:
//
// `blend` — how far the aim point is pulled towards the gap after next, while
//   still being held inside the current gap. Arriving at this gap already on
//   the side the next one is on.
//
// `mode` — what the bot actually controls, which is the real difference
//   between a competent player and a good one at a momentum game:
//
//   position — "am I above or below the gap?" Correct, and always a step
//              behind, because it only notices the error after the momentum
//              has already produced it.
//   rate     — "what vertical speed do I need to arrive on the gap, and am I
//              doing it?" This is flying the balloon rather than chasing it.
export const SKILLS = {
  competent: { mode: 'position', blend: 0, deadBand: 24, reactionMs: 165, leadFactor: 0.4 },
  good: { mode: 'rate', blend: 0.55, deadBand: 14, reactionMs: 35, leadFactor: 1 },
};

/**
 * One run. Returns metres travelled and why it ended.
 */
export function runOnce(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const flight = new Flight(tuning);
  const dt = 1 / 60;

  let burn = false;
  let sinceDecision = 0;
  const decisionEvery = s.reactionMs / 1000;

  // A hard ceiling on run length, so a bot that has genuinely solved the game
  // cannot hang the suite. Difficulty has no ceiling, so this is generous.
  for (let i = 0; i < 60 * 240 && flight.running; i++) {
    sinceDecision += dt;
    if (sinceDecision >= decisionEvery) {
      sinceDecision = 0;

      const gate = gateAhead(flight, 0);
      const after = gateAhead(flight, 1);

      // Aim at this gap, pulled towards the next one — but never further than
      // this gap's own edges allow, because the rock in front is real and the
      // rock after it is not yet.
      const room = Math.max(0, gate.gap / 2 - TUNING.radius - 6);
      const pull = (after.centre - gate.centre) * s.blend;
      const aim = gate.centre + Math.max(-room, Math.min(room, pull));

      const time = Math.max(0.001, (gate.x - flight.x) / gate.speed);

      if (s.mode === 'rate') {
        // The vertical speed that arrives on the aim point, and whether the
        // balloon is currently doing more or less than that.
        const want = (aim - flight.y) / time;
        const error = want - flight.vy;
        if (error < -s.deadBand) burn = true;       // sinking too slowly
        else if (error > s.deadBand) burn = false;  // sinking too fast
      } else {
        // Where the balloon will be by the time it arrives, if it does
        // nothing — and a correction only once that is already wrong.
        const drift = flight.vy * time * s.leadFactor;
        const error = (aim - (flight.y + drift));
        if (error < -s.deadBand) burn = true;       // need to be higher
        else if (error > s.deadBand) burn = false;  // need to be lower
      }
      // inside the dead band: hold whatever it was doing
    }
    flight.step(dt, { burn });
  }

  return { metres: flight.metres, reason: flight.reason, alive: flight.running };
}
