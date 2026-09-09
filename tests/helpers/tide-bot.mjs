// tests/helpers/tide-bot.mjs
//
// Two ways of playing Tide, differing in exactly one thing: what they are
// trying to maximise.
//
//   greedy    the points this move pays ME
//   cautious  the points it pays me, MINUS the points it pays my best-off
//             opponent
//
// That is the whole game as a question. Tide's only decision is when to finish
// a line, and finishing one pays everybody in it — so if taking the biggest
// payout on the table is never a mistake, there is no decision and the design
// is thin. These two exist to answer that, and the answer goes in the write-up
// whichever way it comes out.
//
// EVERYTHING ELSE ABOUT THEM IS IDENTICAL, including the tie-break, which
// matters more here than usual: most early moves pay nothing at all, so without
// a shared tie-break the two policies would differ on every quiet turn and the
// comparison would be measuring the tie-break instead of the objective.

import { Tide, NEUTRAL, linesOf, linesThrough } from '../../games/tide/grid.js';

export const POLICIES = ['greedy', 'cautious', 'guarded', 'random'];

// WHY THERE ARE THREE AND NOT TWO.
//
// `cautious` was written first and it is the obvious reading: never hand
// anybody points. It loses, and it deserves to -- feeding a player who is
// twenty behind costs you nothing, and a policy that flinches from every
// payout declines free money all game.
//
// `guarded` is the same idea aimed properly: it only minds what it pays the
// player who is actually WINNING. That is the decision a person at a table
// makes out loud -- "I'm not finishing that, it's worth three to you and you're
// already ahead" -- so it is the one the design is really claiming exists.
//
// Both differ from greedy in exactly one dimension: whether the payout to
// somebody else counts against the move. They differ from each other only in
// WHICH somebody else. Everything else -- the tie-break, the search depth, the
// order squares are considered in -- is shared.

/**
 * The shared tie-break: build where you already have stones.
 *
 * Used by both policies, and only when the payouts are level. It is deliberately
 * the most obvious thing a person does on a turn that pays nothing — put it
 * where it might pay later — so neither policy gets an advantage from it.
 */
function position(game, index, me) {
  const lines = linesOf(game.size);
  let mine = 0;
  let theirs = 0;
  for (const lineIndex of linesThrough(index, game.size)) {
    for (const cell of lines[lineIndex]) {
      const who = game.cells[cell];
      if (who === null || who === NEUTRAL) continue;
      if (who === me) mine += 1; else theirs += 1;
    }
  }
  // Own stones are worth having beside you; other people's are worth avoiding,
  // because a line they lead is a line you will not want to finish.
  return mine * 2 - theirs;
}

/** Whoever is ahead on points right now; -1 if nobody is, or it is shared. */
function leaderOf(game, me) {
  let best = -1;
  let top = -1;
  let shared = false;
  for (let p = 0; p < game.players; p++) {
    if (p === me) continue;
    if (game.scores[p] > top) { top = game.scores[p]; best = p; shared = false; }
    else if (game.scores[p] === top) shared = true;
  }
  return shared ? -1 : best;
}

/**
 * One move, by one policy.
 *
 * `rng` breaks ties between moves the policy rates identically. It is not
 * decoration: without it, a table of identical bots plays a game that is a pure
 * function of the seed, so a thousand runs is one run measured a thousand times
 * and any "seat bias" it reports is an artefact. Most turns in Tide pay nothing
 * at all, so that is most turns.
 */
export function chooseMove(game, policy, rng = Math.random) {
  const me = game.currentPlayer;
  const options = game.emptyCells();
  const leader = leaderOf(game, me);

  let best = null;
  let ties = 0;

  if (policy === 'random') return options[Math.floor(rng() * options.length)];

  for (const index of options) {
    const { payouts } = game.preview(index, me);

    let cost = 0;
    if (policy === 'cautious') {
      for (let p = 0; p < game.players; p++) if (p !== me && payouts[p] > cost) cost = payouts[p];
    } else if (policy === 'guarded' && leader >= 0) {
      cost = payouts[leader];
    }

    const value = payouts[me] - cost;
    const tie = position(game, index, me);
    const better = !best || value > best.value || (value === best.value && tie > best.tie);
    const level = best && value === best.value && tie === best.tie;

    if (better) { best = { index, value, tie }; ties = 1; }
    else if (level) {
      ties += 1;
      // Reservoir sampling, so every equally good square is equally likely
      // without building a list of them on every turn.
      if (rng() < 1 / ties) best.index = index;
    }
  }
  return best ? best.index : options[0];
}

/**
 * One whole game.
 *
 * `seats` names the policy in each seat, so a two-policy table is written
 * ['greedy', 'cautious'] and a mixed six is written out in full.
 */
export function playOnce(seats, { tuning, rng = Math.random } = {}) {
  const game = new Tide({ players: seats.length, tuning, rng });
  // How many turns had a payout on the table at all. If that number is small,
  // the game's one decision hardly ever comes up, and no policy can beat
  // another at a decision it never gets to make.
  let liveTurns = 0;
  let turns = 0;
  while (!game.isOver) {
    turns += 1;
    if (game.emptyCells().some((i) => game.preview(i).total > 0)) liveTurns += 1;
    game.place(chooseMove(game, seats[game.currentPlayer], rng));
  }
  return {
    scores: [...game.scores],
    standings: game.standings(),
    washes: game.washes,
    paidOut: game.paidOut,
    turnsEach: game.turnsEach,
    turns,
    liveTurns,
  };
}

/**
 * How often each seat wins, over `runs` games with the same policy everywhere.
 *
 * With every seat playing identically, any difference in the results is the
 * SEATING and nothing else — which is the measurement that decides whether Tide
 * needs a catch-up rule at all, and if so which way round it goes.
 */
export function seatBias(players, { runs = 400, policy = 'cautious', tuning, seed = 1 } = {}) {
  const wins = new Array(players).fill(0);
  const points = new Array(players).fill(0);
  const rng = mulberry32(seed);
  const seats = new Array(players).fill(policy);
  for (let i = 0; i < runs; i++) {
    const out = playOnce(seats, { tuning, rng });
    out.scores.forEach((s, p) => { points[p] += s; });
    // A shared first place is shared, not ignored.
    const winners = out.standings.filter((r) => r.place === 1);
    for (const w of winners) wins[w.player] += 1 / winners.length;
  }
  return { wins, points, runs };
}

/** Seeded, so a surprising result can be re-run rather than argued about. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
