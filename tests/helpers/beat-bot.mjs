// tests/helpers/beat-bot.mjs
//
// Two players for Beat Blocker, differing in ONE field: whether they press to
// the chart or at a fixed rate of their own.
//
// That is the whole point of the pair. A rhythm game's claim is that timing to
// the music is what scores; the way that claim quietly fails is that mashing
// does nearly as well, and no amount of playing it yourself will tell you by
// how much. So the masher is not a weak player -- it is the null hypothesis.
//
// Both bots move the shield the same way, on the same lookahead, and press the
// same button. The only difference is WHEN they press.

import { Session, TUNING } from '../../games/beat-blocker/chart.js';

export const SKILLS = {
  // Times each press to the attack it is aiming at, with human slop.
  onBeat: { readsChart: true },
  // The same movement, the same slop, but pressing on a metronome of its own
  // rather than on the chart's.
  masher: { readsChart: false },
};

const STEP = 1 / 120;

// How far off a bot's presses land, in milliseconds, drawn once per attack.
// A bot that re-drew its jitter every frame would average it away across a
// hundred and twenty samples a second and play perfectly.
const DEFAULT_JITTER_MS = 38;

// The masher's own tempo. Fixed, because a masher that tracked the tempo would
// be reading the chart, which is the thing being held out.
const MASHER_BPM = 165;

/**
 * Play one session and report it.
 *
 * `phrases` caps the run. A run needs a cap because a good player does not
 * die: the chart never asks for a move that cannot be made, so surviving is
 * not what separates these two -- SCORE OVER A FIXED STRETCH is. Comparing
 * survival would just compare who ran out of hearts, and the good bot never
 * does.
 */
export function runOnce(skillName, tuning = TUNING, options = {}) {
  const { phrases = 12, jitterMs = DEFAULT_JITTER_MS } = options;
  const skill = SKILLS[skillName];
  const session = new Session(tuning);

  const masherPeriod = 60 / MASHER_BPM;
  let nextMash = 0;
  let plannedFor = null;
  let plannedAt = 0;

  while (session.running && session.phrase <= phrases) {
    // WHERE TO STAND. Both bots do this identically: head for the lane of the
    // next attack, which -- since the shield travels -- means leaving for it
    // before the current one has landed.
    //
    // AND ABANDON ANYTHING ALREADY LOST, which is the part that took measuring
    // to find. The first version stood over a note until its window expired
    // even once the shield could no longer arrive, so a single miss held the
    // shield in the wrong lane and took the next note with it. That cascade
    // showed up as a cliff -- ninety per cent survival at 45ms of slop and zero
    // at 60ms -- and it was the bot's stubbornness, not the chart. A person who
    // is late gives up on the note and moves.
    const next = session.events.find((e) => {
      if (e.done) return false;
      const travel = Math.abs(session.shield - e.lane) * (tuning.laneMoveMs / 1000);
      return session.time + travel <= e.time + tuning.goodMs / 1000;
    });
    const lane = next ? next.lane : session.lane;

    let block = false;
    if (skill.readsChart) {
      if (next) {
        if (plannedFor !== next.id) {
          plannedFor = next.id;
          plannedAt = next.time + (Math.random() * 2 - 1) * (jitterMs / 1000);
        }
        if (session.time >= plannedAt) block = true;
      }
    } else if (session.time >= nextMash) {
      nextMash = session.time + masherPeriod;
      block = true;
    }

    const before = session.phrase;
    session.step(STEP, { lane, block });
    if (session.phrase !== before) nextMash = 0;
  }

  return {
    score: session.score,
    phrases: session.phrase,
    blocked: session.blocked,
    perfects: session.perfects,
    missed: session.missed,
    bestStreak: session.bestStreak,
    hearts: session.hearts,
    bpm: session.bpm,
    survived: session.running,
    reason: session.reason,
  };
}
