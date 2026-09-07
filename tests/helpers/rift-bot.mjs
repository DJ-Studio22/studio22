// tests/helpers/rift-bot.mjs
//
// Two bots for Rift Runner, per tests/README.md convention 5.
//
// The solver in rift.js answers "is this pattern possible at all". That is a
// different question from "how far does a player get", and both are needed:
// the solver rules out the impossible, these two measure what is merely hard.
//
// What separates them is READING DISTANCE and JUMP CONTROL, which is what a
// runner is actually about:
//
//   competent  reacts to the obstacle in front of it, at arm's length, and
//              holds every jump to full height.
//   good       looks further ahead, so it is already in the right state when
//              the obstacle arrives, and cuts jumps short when something
//              overhead means it must.
//
// Neither bot can see the pattern list. Both read the obstacles in front of
// them exactly as a player would.

import { Course } from '../../games/rift-runner/patterns.js';
import {
  KIND, TILE, TUNING, heightAbove, jumpTiles, physicsAt,
} from '../../games/rift-runner/rift.js';

// Two axes, and a swept parameter grid picked them rather than taste.
//
//   reactionMs    how long between reading the world and acting on it.
//   timesTakeoff  whether the bot works out WHERE the jump arc has to start
//                 for the landing to be past the far edge, or just jumps when
//                 the obstacle is near and hopes.
//
// `readTiles` is deliberately the SAME for both, which is the opposite of how
// this file started. Giving the better bot a longer lookahead made it worse —
// markedly worse, median 57m against 98m — because reacting to an obstacle
// early means committing early, and committing early to a fixed-distance move
// is how you land in the gap you were trying to clear. Lookahead is not the
// skill in a runner. Timing is. The sweep is in PROGRESS.md.
//   misreadChance the classic beginner error, and the one a parameter sweep
//                 could never have found for me: reaching for the wrong verb.
//                 Jumping at a bar instead of ducking it, ducking at a spike.
//                 A competent player does this under pressure; a good one has
//                 stopped. Without it the two bots were within 1.25x of each
//                 other, because reaction time alone barely matters when most
//                 obstacles want one obvious input.
export const SKILLS = {
  competent: {
    readTiles: 2.6, reactionMs: 165, timesTakeoff: false, cutJumps: false,
    misreadChance: 0.05,
  },
  good: {
    readTiles: 2.6, reactionMs: 35, timesTakeoff: true, cutJumps: true,
    misreadChance: 0,
  },
};

/** The verb a player reaches for when they misread the obstacle. */
const WRONG_VERB = {
  [KIND.SPIKE]: KIND.BAR,     // ducked at something you had to jump
  [KIND.GAP]: KIND.BAR,
  [KIND.BAR]: KIND.SPIKE,     // jumped at something you had to duck
  [KIND.RIFT]: KIND.SPIKE,    // tried to jump a wall
};

/**
 * The next obstacle the runner has not already passed.
 *
 * "Passed" means the BODY is clear, not that the centre point is. blocks()
 * tests `state.x ± bodyW / 2` against the obstacle, and this used a bare x —
 * so an obstacle was dropped from consideration while the runner's trailing
 * half, thirteen pixels of it, was still inside it.
 *
 * Under a bar that is fatal and it was invisible in the aggregate: the bot
 * slides the whole length of the bar, the bar leaves the list on the frame the
 * centre clears the far edge, the bot stands up, and the back half of its head
 * is still under the bar. It killed the good bot on 31 runs in 60 and looked
 * like the bar being too hard.
 *
 * The near edge had already been fixed once, for the same reason and with the
 * same symptom. The far edge is the other half of it.
 */
function ahead(run, fromX, tuning = TUNING) {
  const trailing = fromX - tuning.bodyW / 2;
  let best = null;
  for (const o of run.obstacles) {
    const left = o.tile * TILE;
    const right = left + o.tiles * TILE;
    if (right < trailing) continue;
    if (!best || left < best.left) best = { o, left, right };
  }
  return best;
}

/** Is anything hanging over this stretch that would stop a full jump? */
function ceilingOver(run, x) {
  for (const o of run.obstacles) {
    if (o.kind !== KIND.BAR) continue;
    const left = o.tile * TILE;
    const right = left + o.tiles * TILE;
    if (x >= left - TILE && x <= right + TILE) return o.clear * TILE;
  }
  return Infinity;
}

/**
 * What this bot does on the frame it is thinking.
 *
 * Exported so a trace can drive the REAL bot rather than a copy of it. The
 * copy is how the flip-budget check ended up measuring a reimplementation of
 * Gravity Flip instead of Gravity Flip; a bot's decision rule is exactly the
 * sort of thing that gets quietly duplicated into a diagnostic and then drifts.
 */
export function decide(course, s, tuning = TUNING, memory = {}) {
  const run = course.run;
  const read = s.readTiles * TILE;
  const next = ahead(run, run.x, tuning);

  const decision = { jump: false, jumpHeld: false, slide: false, dash: false };

  if (next) {
    const distance = next.left - run.x;
    const feet = heightAbove(run, run.realm);

    // Note the absence of a "have I passed it" clause on the LEFT edge. There
    // was one, and it was wrong: it stopped the bot acting once it was one
    // tile past the near edge of the obstacle, so on a three-tile bar it stood
    // up 80px before it was out — and died, every time, on every run that
    // opened with a bar. ahead() already drops obstacles whose far edge is
    // behind the runner, which is the real test.
    if (distance < read) {
      // Which obstacle the bot THINKS it is looking at. A competent player
      // reaches for the wrong verb under pressure; the kind that reads
      // correctly is what makes a good one good.
      //
      // Read ONCE PER OBSTACLE and then committed, which is what a person
      // does. It used to be re-rolled on every decision tick, and that is not
      // a 5% misread rate — an obstacle is in view for about six ticks, so it
      // compounds to roughly 26%, and it compounds WORST for whatever the
      // runner spends longest next to. A bar takes the longest, so the bot
      // would slide correctly under one for half a second and then, on the
      // sixth roll, decide it was a spike and jump into it.
      //
      // The constant says five percent. It should mean five percent.
      if (memory.tile !== next.o.tile) {
        memory.tile = next.o.tile;
        memory.kind = (s.misreadChance && Math.random() < s.misreadChance)
          ? WRONG_VERB[next.o.kind] ?? next.o.kind
          : next.o.kind;
      }
      const kind = memory.kind;
      switch (kind) {
        case KIND.SPIKE:
        case KIND.GAP: {
          // Where the arc has to START for the landing to be past the far
          // edge. Anything earlier lands inside.
          const reach = jumpTiles(run.realm, tuning) * TILE;
          const latestSafe = next.left - TILE * 0.3;
          const earliestSafe = next.right - reach + TILE * 0.6;
          const ready = s.timesTakeoff
            ? run.x >= earliestSafe && run.x <= latestSafe
            : true;
          if (run.grounded && ready) decision.jump = true;
          decision.jumpHeld = true;
          if (s.cutJumps) {
            const roof = ceilingOver(run, next.left);
            if (roof < Infinity && feet + tuning.bodyH > roof - TILE) {
              decision.jumpHeld = false;
            }
          }
          break;
        }
        case KIND.BAR:
          // Held, so there is no window to miss — get down before it and
          // stay down until it is behind you.
          decision.slide = true;
          break;
        case KIND.RIFT: {
          // And so does the phase.
          const p = physicsAt(run.speed, run.realm, tuning);
          const cover = p.dashTime * run.speed * tuning.dashSpeedBonus;
          // The weak bot dashes as soon as the wall is within reach of the
          // phase, rather than at a fixed sixty pixels.
          //
          // Sixty was narrower than this bot's own stride between decisions —
          // 165ms is 56px — and the decision is sticky, so a tick landing at
          // 70px produced no dash and the next tick came after the wall. It
          // simply ran into rift walls with the dash off cooldown and nothing
          // in its way, on three of the first seven seeds.
          //
          // This was tried once before and made things WORSE, because the
          // phase only covered 92px then and dashing early ended it before the
          // wall. At 207px there is room to be early. Widening a trigger is
          // only safe once the thing it triggers is generous.
          const ready = s.timesTakeoff
            ? run.x >= next.right - cover && run.x <= next.left - TILE * 0.2
            : run.x >= next.right - cover * 0.9;
          if (ready) decision.dash = true;
          break;
        }
        default:
          break;
      }
    } else if (!run.grounded && s.cutJumps) {
      // Nothing to clear: come down rather than float.
      decision.jumpHeld = false;
    }
  }
  return decision;
}

/** One run. Returns metres and why it ended. */
export function runOnce(skill, tuning = TUNING) {
  const s = SKILLS[skill];
  const course = new Course(tuning);
  const dt = 1 / 60;

  let decision = { jump: false, jumpHeld: false, slide: false, dash: false };
  let sinceDecision = 0;
  const every = s.reactionMs / 1000;
  // What this bot currently believes the obstacle in front of it is. Owned by
  // the run, so one run's misread cannot leak into the next.
  const memory = {};

  // A cap, so a bot that has solved the game cannot hang the suite.
  for (let i = 0; i < 60 * 300 && course.running; i++) {
    sinceDecision += dt;
    if (sinceDecision >= every) {
      sinceDecision = 0;
      decision = decide(course, s, tuning, memory);
    }
    course.step(dt, decision);
  }

  // The realm and the phrase a run ended on, which is what a distribution
  // cannot tell you. Spacing the rifts out dropped the competent median from
  // 350m to 97m and nothing about "median 97" says why; "89% of deaths were in
  // surface, on wide-gap" does.
  const last = course.dealt.filter((d) => !d.gate && d.tile * TILE <= course.run.x + TILE * 2).pop();
  return {
    metres: course.metres,
    reason: course.reason,
    rifts: course.riftsEntered,
    alive: course.running,
    realm: course.realm.id,
    pattern: last ? last.id : null,
  };
}
