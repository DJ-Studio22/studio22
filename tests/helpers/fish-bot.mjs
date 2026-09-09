// tests/helpers/fish-bot.mjs
//
// Players for Bigger Fish, as policies over the same body.
//
// Every policy moves at the speed its mass allows, sees the same distance and
// re-decides on the same clock. What differs is judgement: whether it runs from
// something that can eat it, whether it declines a morsel parked next to
// something huge, whether it treats a spike as terrain once it is big enough to
// be hurt by one, whether it checks that a split will actually land, and
// whether it splits at all.
//
// That is the shape the measurements need. The claim is about DECISIONS, so
// nothing here is allowed to differ in reflexes or in stats.

import {
  Pond, TUNING, canEat, radiusOf, speedOf, splitReach, threatens,
} from '../../games/bigger-fish/pond.js';

// WHAT THESE POLICIES DIFFER IN, AND WHY IT IS ONLY THIS.
//
// Two goes at this pair were wrong before the third, and both failures are
// worth keeping because they are the same mistake in different clothes.
//
// FIRST: greedy also ignored threats, bait and split maths. The counterfactual
// then meant nothing -- taking the size penalty away made BOTH policies worse,
// because running from something that can eat you pays whether or not being big
// is risky. It was measuring recklessness, not greed.
//
// SECOND: selective STOPPED GROWING above a comfortable size. That cannot win a
// game scored on peak mass, and it should not: declining to grow is not
// selectivity, it is forfeiting. Greedy beat it 503 to 214 and was right to.
//
// So selectivity here means DECLINING DANGEROUS GROWTH, at exactly the same
// appetite. Every policy runs from lethal threats, declines obvious bait,
// checks that a split will land, and chases whatever it can eat. The two
// judgements that differ are the two that exist only BECAUSE size is dangerous:
//
//   avoidsSpikes   -- treat spikes as terrain, and do not chase prey onto one,
//                     once you are big enough for them to hurt
//   checksPunish   -- do not divide yourself while something big enough to eat
//                     the halves is close enough to reach them
//
// Both are pure cost in a pond where size is safe -- there is nothing to route
// around and a fast half can outrun a punisher -- which is what makes the
// counterfactual mean something.
export const POLICIES = {
  greedy: { avoidsSpikes: false, checksPunish: false, usesSplit: true },
  selective: { avoidsSpikes: true, checksPunish: true, usesSplit: true },
  // Selective in every respect but one: it never splits. The pair that says
  // whether the mechanic is doing anything.
  noSplit: { avoidsSpikes: true, checksPunish: true, usesSplit: false },
};

const STEP = 1 / 60;

/** Nearest of `items` to (x, y), or null. */
function nearest(items, x, y, filter = () => true) {
  let best = null;
  for (const item of items) {
    if (!filter(item)) continue;
    const d = Math.hypot(item.x - x, item.y - y);
    if (!best || d < best.d) best = { item, d };
  }
  return best;
}

/**
 * One decision. Returns { x, y, split } — a direction and whether to commit.
 *
 * The order is the same for every policy: run, hunt, graze. The policy only
 * changes how well each question is answered, which is the whole point.
 */
function decide(pond, policy, t) {
  const mine = pond.cellsOf('player');
  if (!mine.length) return { x: 0, y: 0 };
  const head = mine.reduce((a, b) => (a.mass >= b.mass ? a : b));
  const others = pond.cells.filter((c) => c.owner !== 'player');

  // 1. RUNNING. Every policy does this: being eaten ends the run at any size,
  // so it is not a judgement about greed.
  // The same reading the bots use: a bigger fish is only a threat at range if
  // the halves it would split into could still eat you.
  const threat = nearest(others, head.x, head.y,
    (c) => threatens(c, head.mass, Math.hypot(c.x - head.x, c.y - head.y), t));
  if (threat) {
    return { x: head.x - threat.item.x, y: head.y - threat.item.y };
  }

  // 2. HUNTING. Every policy hunts as hard as every other; the appetite is not
  // what is being compared.
  const big = head.mass >= t.spikeMass;
  const prey = nearest(others, head.x, head.y, (c) => {
    if (!canEat(head.mass, c.mass, t)) return false;
    if (Math.hypot(c.x - head.x, c.y - head.y) > 700) return false;
    // Bait: a morsel sitting in the shadow of something that could eat YOU.
    // Every policy declines it; falling for bait is not greed, it is blindness.
    for (const other of others) {
      if (other === c) continue;
      if (!canEat(other.mass, head.mass / 2, t)) continue;
      if (Math.hypot(other.x - c.x, other.y - c.y) < 220) return false;
    }
    // A meal sitting on a spike is a meal that costs you five pieces of
    // yourself. Only a policy that treats spikes as terrain declines it.
    if (policy.avoidsSpikes && big) {
      const spike = nearest(pond.spikes, c.x, c.y);
      if (spike && spike.d < radiusOf(head.mass, t) + t.spikeRadius) return false;
    }
    return true;
  });

  if (prey) {
    const reaches = prey.d < splitReach(head.mass, t);
    const worth = head.mass / 2 > prey.item.mass * t.eatRatio;
    // Every policy checks that the split lands before committing to it; a
    // wasted split divides you whatever your size, so that is not a judgement
    // about greed either. What differs is whether anything is standing by to
    // eat the halves.
    const punished = policy.checksPunish && others.some((c) => canEat(c.mass, head.mass / 2, t)
      && Math.hypot(c.x - head.x, c.y - head.y) < splitReach(c.mass, t) + 140);
    const split = policy.usesSplit && head.mass >= t.splitMinMass
      && reaches && worth && !punished;
    return { x: prey.item.x - head.x, y: prey.item.y - head.y, split };
  }

  // 2b. THERE IS NO LONGER A "PUT YOURSELF BACK TOGETHER" MOVE, and this is
  // where one used to be.
  //
  // Under the old steering the pieces only gathered while the stick was eased
  // off, so a split player had to stop playing to merge and the bot had a whole
  // branch for it: swim at your own centre of mass at a quarter speed. The
  // player now drives one cell and the others chase it whatever the stick is
  // doing, so that branch was a bot handicapping itself for a rule that no
  // longer exists -- a quarter speed, in a pond, for nothing.
  //
  // What merging still costs is the twenty seconds of unbroken contact, which
  // is a cost you pay by not being flung apart rather than by standing still.

  // 3. GRAZING, and routing round the terrain if it is dangerous to you.
  // Sampled rather than searched, for the same reason the bots sample: the
  // nearest crumb of fifteen hundred is not a decision, it is a search.
  const sample = [];
  for (let i = 0; i < 48 && pond.pellets.length; i++) {
    sample.push(pond.pellets[(Math.random() * pond.pellets.length) | 0]);
  }
  let goal = nearest(sample, head.x, head.y);
  let want = goal
    ? { x: goal.item.x - head.x, y: goal.item.y - head.y }
    : { x: t.width / 2 - head.x, y: t.height / 2 - head.y };

  if (policy.avoidsSpikes && big) {
    const spike = nearest(pond.spikes, head.x, head.y);
    if (spike && spike.d < radiusOf(head.mass, t) + t.spikeRadius + 70) {
      want = { x: head.x - spike.item.x, y: head.y - spike.item.y };
    }
  }
  return want;
}

/**
 * Play one run and report it.
 *
 * `seconds` caps it: the pond is endless and a run that is going well would
 * otherwise end only when the harness got bored.
 */
export function runOnce(policyName, tuning = TUNING, options = {}) {
  const { seconds = 120, skill = 'steady' } = options;
  const policy = POLICIES[policyName];
  const pond = new Pond(tuning, { skill });

  let sinceDecision = tuning.decideSeconds;
  let want = { x: 0, y: 0 };
  let split = false;
  while (pond.running && pond.time < seconds) {
    sinceDecision += STEP;
    if (sinceDecision >= tuning.decideSeconds) {
      sinceDecision = 0;
      const choice = decide(pond, policy, tuning);
      want = { x: choice.x, y: choice.y };
      split = Boolean(choice.split);
    } else {
      split = false;
    }

    // A STICK, NOT A VECTOR. A harness handing the pond raw goal offsets is
    // pushing the stick a hundred units in one frame and a thousand in the
    // next, which is not an input any controller can produce. Normalised, so
    // this is a direction held at full deflection -- the same thing a thumb
    // does.
    const mag = Math.hypot(want.x, want.y) || 1;
    pond.step(STEP, {
      x: want.x / mag,
      y: want.y / mag,
      split,
    });
  }

  return {
    // The score: mass-seconds, the area under the mass curve. Peak and held are
    // reported alongside because they are what a player watches, and because
    // the difference between them is the whole reason the score changed.
    score: pond.score,
    peak: Math.round(pond.peakMass),
    held: Math.round(pond.heldMass),
    finalMass: Math.round(pond.playerMass),
    eaten: pond.eaten,
    splits: pond.splits,
    spiked: pond.spiked,
    survived: pond.running,
    seconds: +pond.time.toFixed(1),
    reason: pond.reason,
  };
}

export { speedOf, splitReach };
