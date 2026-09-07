// tests/helpers/dice-bot.mjs
//
// Two bots for Dungeon Dice, per tests/README.md convention 5.
//
// They differ in one thing, and it is the thing the game claims is its depth:
//
//   greedy       takes the roll as it comes. Never rerolls, never nudges,
//                never banks. It still plays — it picks its target — so it is
//                a player, not a rock.
//   manipulator  works the roll: rerolls the junk, bends a die when bending it
//                changes the turn, and banks a face it will want next turn.
//
// Everything else is identical. If the gap between them is small, then every
// tool in the game is decoration and the player is a spectator with a
// scoreboard — which is the one way a dice game is guaranteed to be bad.

import {
  FACE, Run, TUNING, nudged, tally,
} from '../../games/dungeon-dice/dice.js';

export const SKILLS = {
  greedy: { manipulates: false },
  manipulator: { manipulates: true },
};

/**
 * Which upgrade to take. The SAME rule for both bots, so the gap between them
 * stays the manipulation and never becomes shopping.
 */
function pickUpgrade(run) {
  const offers = run.pendingUpgrades ?? [];
  const order = ['reinforce', 'sharpen', 'face', 'maxhp', 'reroll'];
  for (const kind of order) {
    const found = offers.find((o) => o.kind === kind);
    if (found) return found;
  }
  return offers[0];
}

/** Which enemy to hit: one this turn's damage would finish, else the biggest. */
function pickTarget(run, damage) {
  if (!run.enemies.length) return null;
  const finishable = run.enemies
    .filter((e) => e.hp <= damage)
    .sort((a, b) => b.hp - a.hp)[0];
  if (finishable) return finishable.id;
  // Otherwise concentrate on the one closest to dying, so the incoming damage
  // comes down a step at a time rather than never.
  return [...run.enemies].sort((a, b) => a.hp - b.hp)[0].id;
}

/** Would this table kill us this turn? */
function lethal(run, shown = run.shown) {
  const table = tally(shown, run.rates);
  return run.hp + table.heal - Math.max(0, run.incoming - table.block) <= 0;
}

/** How good a table is, given what is about to land. */
function score(run, shown) {
  const table = tally(shown, run.rates);
  const survived = run.hp + table.heal - Math.max(0, run.incoming - table.block);
  if (survived <= 0) return -1000;
  // Damage is the only thing that ends a floor, so it leads — but staying
  // above water is worth more than any amount of it.
  return table.damage * 3
    + Math.min(table.block, run.incoming) * 2
    + Math.min(table.heal, run.maxHp - run.hp) * 2
    + table.bolts * 0.6
    + Math.min(survived, 8) * 1.5;
}

/**
 * The manipulator's turn: spend what is worth spending, in the order that
 * matters most.
 */
function work(run) {
  // 1. Reroll the dead weight, while it is free. A blank is worth nothing and
  //    a bolt held past the point of spending it is worth nothing either.
  let guard = 0;
  while (run.rerollsLeft > 0 && guard++ < 6) {
    const junk = run.shown
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f === FACE.BLANK)
      .map(({ i }) => i);
    if (!junk.length) break;
    const before = score(run, run.shown);
    const snapshot = [...run.shown];
    if (!run.reroll(junk)) break;
    // A reroll can make things worse; there is no taking it back, which is
    // what makes spending the free one a decision rather than a formality.
    if (score(run, run.shown) < before && lethal(run)) {
      // Nothing to be done about it now, but do not keep digging.
      void snapshot;
      break;
    }
  }

  // 2. If the turn is still lethal, bend a die until it is not. This is the
  //    manipulation that matters: a nudge is the difference between dying to a
  //    roll and answering it.
  guard = 0;
  while (lethal(run) && run.charges >= run.t.nudgeCost && guard++ < 5) {
    let best = null;
    for (let i = 0; i < run.shown.length; i++) {
      for (const dir of [1, -1]) {
        const next = [...run.shown];
        next[i] = nudged(next[i], dir);
        const value = score(run, next);
        if (!best || value > best.value) best = { i, dir, value };
      }
    }
    if (!best || best.value <= score(run, run.shown)) break;
    if (!run.nudge(best.i, best.dir)) break;
  }

  // 3. Otherwise bend a die only when it clearly improves the turn.
  guard = 0;
  while (run.charges >= run.t.nudgeCost + 2 && guard++ < 3) {
    const before = score(run, run.shown);
    let best = null;
    for (let i = 0; i < run.shown.length; i++) {
      for (const dir of [1, -1]) {
        const next = [...run.shown];
        next[i] = nudged(next[i], dir);
        const value = score(run, next);
        if (!best || value > best.value) best = { i, dir, value };
      }
    }
    if (!best || best.value <= before + 2) break;
    if (!run.nudge(best.i, best.dir)) break;
  }

  // 4. Bank a shield when nothing is landing this turn but something is next.
  //    Saving a face for the turn it is needed is the tool with the longest
  //    horizon, and the only one that looks past the current roll.
  if (run.incoming === 0 && run.charges >= run.t.bankCost + 1) {
    const shield = run.shown.indexOf(FACE.SHIELD);
    if (shield >= 0) run.bank(shield);
  }
}

/** One descent. Returns floors cleared and why it ended. */
export function runOnce(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const run = new Run(tuning);

  // A cap, so a bot that has solved the dungeon cannot hang the suite.
  for (let i = 0; i < 4000 && run.running; i++) {
    if (run.pendingUpgrades) {
      // Both bots take the same offer by the same rule, so upgrade choice is
      // not what separates them.
      run.takeUpgrade(pickUpgrade(run));
      continue;
    }
    if (s.manipulates) work(run);
    run.commit(pickTarget(run, run.table.damage));
  }

  return {
    floors: run.floorsCleared,
    reason: run.reason,
    alive: run.running,
    rerolls: run.rerollsUsed,
    nudges: run.nudgesUsed,
    banks: run.banksUsed,
  };
}

/**
 * A run that also records, for the turn it died on, whether anything could
 * have saved it. Used by the "not a robbery" test.
 */
export function runWithPostMortem(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const run = new Run(tuning);
  let lastTurn = null;

  for (let i = 0; i < 4000 && run.running; i++) {
    if (run.pendingUpgrades) {
      run.takeUpgrade(pickUpgrade(run));
      continue;
    }
    // Snapshot BEFORE any manipulation, because the question is whether the
    // turn as dealt had an answer in it.
    lastTurn = {
      shown: [...run.shown],
      hp: run.hp,
      charges: run.charges,
      rerollsLeft: run.rerollsLeft,
      incoming: run.incoming,
      pool: run.pool,
      rates: run.rates,
    };
    if (s.manipulates) work(run);
    run.commit(pickTarget(run, run.table.damage));
  }

  return { floors: run.floorsCleared, reason: run.reason, lastTurn };
}
