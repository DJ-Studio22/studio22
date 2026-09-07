// tests/helpers/winter-bot.mjs
//
// Four STRATEGIES for Winter Base Building, not two skill levels — and the
// difference matters.
//
// Everywhere else in this project the two bots answer "how good is the
// player". Here the question is different and more basic: DOES THE CHOICE
// EXIST AT ALL. Wood is meant to be dual-purpose and genuinely scarce, so that
// burning it and building with it compete, and a player can be caught having
// chosen wrong.
//
// The way to check that is not a good bot and a bad one. It is two bots that
// are each good at ONE of the two things, and a demonstration that they fail
// in OPPOSITE WAYS:
//
//   fortify  builds whenever it can. Should freeze.
//   warm     burns first and builds last. Should be eaten.
//   hoarder  gathers, and leaves everything to the last minute.
//   balanced plays both against each other, and should outlast all three.
//
// If fortify and warm died the same way, or if either comfortably survived,
// the tension would be imaginary and the game would be a chore list.

import { ACTION, Camp, TUNING, fuelFor } from '../../games/winter/camp.js';

export const STRATEGIES = ['fortify', 'warm', 'hoarder', 'balanced'];

/** Meat needed to get to the end of the week, roughly. */
function meatWanted(camp) {
  return camp.t.foodPerNight * (camp.daysToWolves + 1);
}

/** Wood the fire will want between now and the pack arriving. */
function fuelAhead(camp) {
  let total = 0;
  for (let d = camp.day; d <= camp.day + camp.daysToWolves; d++) {
    total += fuelFor(d, camp.t);
  }
  return total;
}

/** One action, chosen by strategy. */
function decide(camp, strategy) {
  const t = camp.t;
  const hungry = camp.meat < t.foodPerNight;
  const starving = hungry && camp.actionsLeft === 1;

  switch (strategy) {
    case 'fortify':
      // Wall first, always. Burns whatever happens to be left.
      if (hungry) return ACTION.HUNT;
      if (camp.canBuild) return ACTION.BUILD;
      return ACTION.GATHER;

    case 'warm':
      // NEVER builds. Every stick goes on the fire.
      //
      // This was originally 'fire first, then build with the surplus', which
      // is not an extreme at all — it is very nearly optimal play, and it
      // outlasted the bot that was supposed to be the careful one. A strategy
      // meant to demonstrate a failure has to actually commit to it.
      if (hungry) return ACTION.HUNT;
      return ACTION.GATHER;

    case 'hoarder':
      // Gathers, and leaves the wall until the night before — which the
      // one-build-a-day cap makes impossible to finish.
      if (hungry) return ACTION.HUNT;
      if (camp.daysToWolves === 0 && camp.canBuild && camp.readiness < 0) return ACTION.BUILD;
      return ACTION.GATHER;

    case 'balanced':
    default:
      // Eat, cover the fire to the end of the week, then put everything else
      // into the wall. The order is the whole point: the fire is never
      // negotiable, and what is left over is what the wall gets.
      if (starving || hungry) return ACTION.HUNT;
      if (camp.wood < fuelAhead(camp)) return ACTION.GATHER;
      if (camp.readiness < 0 && camp.canBuild) return ACTION.BUILD;
      if (camp.meat < meatWanted(camp)) return ACTION.HUNT;
      return ACTION.GATHER;
  }
}
/** One winter. Returns weeks survived and what got them. */
export function runOnce(strategy, tuning = TUNING) {
  const camp = new Camp(tuning);

  // A cap, so a strategy that has solved winter cannot hang the suite.
  for (let day = 0; day < 400 && camp.running; day++) {
    while (camp.running && camp.actionsLeft > 0) camp.act(decide(camp, strategy));
    if (camp.running) camp.endDay();
  }

  return {
    weeks: camp.weeksSurvived,
    days: camp.day,
    reason: camp.reason,
    alive: camp.running,
    wood: camp.wood,
    wall: camp.wall,
    meat: camp.meat,
  };
}

/** Runs one strategy many times and reports how it died. */
export function causeOfDeath(strategy, seeds, withSeed, tuning = TUNING) {
  const causes = {};
  const weeks = [];
  for (let seed = 1; seed <= seeds; seed++) {
    withSeed(seed, () => {
      const r = runOnce(strategy, tuning);
      causes[r.reason ?? 'survived the cap'] = (causes[r.reason ?? 'survived the cap'] ?? 0) + 1;
      weeks.push(r.weeks);
    });
  }
  return { causes, weeks };
}

