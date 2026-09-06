// tests/skyhook.swing.test.mjs
//
// Rope physics, and the two things a difficulty pass has to keep true:
// a competent first run lasts long enough to feel like a failure rather than
// a refusal, and a good player can still get far past it.
//
// The bot harness is in helpers/skyhook-bot.mjs. Both bots play seeded cities,
// so a change of a few percent is visible instead of drowned in noise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOOK, Swing, TUNING } from '../games/skyhook/swing.js';
import { CITY_TUNING, anchorOf, difficultyAt, nextBuilding } from '../games/skyhook/city.js';
import { PRE_TUNING_BASELINE, measure, runOnce } from './helpers/skyhook-bot.mjs';
import { withSeed } from './helpers/seeded.mjs';

const RUNS = 120;

// --- The physics ---------------------------------------------------------

test('the rope conserves the swing rather than bleeding it', () => {
  withSeed(7, () => {
    const swing = new Swing();
    const before = swing.speed;
    // Hang and swing with no input at all: a rope does no work, so apart from
    // gravity and the light air drag the tangential speed survives.
    for (let i = 0; i < 30; i++) swing.step(1 / 60, { firePressed: false, dive: false, reel: 0 });
    assert.ok(swing.running, 'the opening swing crashed');
    assert.ok(swing.speed > before * 0.5, 'the swing lost more than half its speed in half a second');
  });
});

test('reeling in speeds the swing up — the pump is real, not a bonus', () => {
  const sample = (reel) => withSeed(11, () => {
    const swing = new Swing();
    for (let i = 0; i < 24; i++) swing.step(1 / 60, { firePressed: false, dive: false, reel });
    return swing.speed;
  });
  assert.ok(sample(-1) > sample(0), 'reeling in did not add speed');
});

test('a run opens mid-arc, already attached and moving forward', () => {
  withSeed(3, () => {
    const swing = new Swing();
    assert.equal(swing.hookState, HOOK.ATTACHED);
    assert.ok(swing.hero.vx > 0, 'the opening swing is not moving forward');
    assert.equal(swing.swings, 1);
  });
});

// --- The geometry contract ----------------------------------------------
//
// A pendulum sweeps over the roof its mast stands on, so the arc clears that
// building only while the rope is shorter than the mast. Shipped once with a
// median mast of 71 against a median rope of 178: four swings in five were
// committed to hitting a roof the moment they attached, which read as random
// unfair deaths rather than as mistakes.

test('masts are tall enough to hang the rope from', () => {
  const masts = [];
  withSeed(5, () => {
    let previous = null;
    for (let i = 0; i < 400; i++) {
      previous = nextBuilding(previous, i * 40);
      masts.push(previous.mast);
    }
  });
  const shortest = Math.min(...masts);
  assert.ok(
    shortest >= TUNING.ropeMax * 0.7,
    `shortest mast ${shortest.toFixed(0)} against ropeMax ${TUNING.ropeMax}: `
    + 'swings from it cannot clear the roof they hang over',
  );
});

test('most swings clear the roof they are anchored to', () => {
  let attachments = 0;
  let clearing = 0;

  for (let seed = 1; seed <= 60; seed++) {
    withSeed(seed, () => {
      const swing = new Swing();
      for (let i = 0; i < 1200 && swing.running && attachments < 400; i++) {
        let fire = false;
        if (swing.hookState === HOOK.ATTACHED) {
          const theta = Math.atan2(swing.hero.x - swing.hookTarget.x, swing.hero.y - swing.hookTarget.y);
          fire = theta > 0.65 && swing.hero.vx > 0;
        } else if (swing.hookState === HOOK.IDLE && swing.bestAnchor()) {
          fire = true;
        }
        swing.step(1 / 60, { firePressed: fire, dive: false, reel: 0 });
        for (const event of swing.drainEvents()) {
          if (event.type !== 'attached') continue;
          attachments++;
          const building = swing.buildings.find((b) => Math.abs(anchorOf(b).x - swing.hookTarget.x) < 1);
          if (building && swing.ropeLength < building.mast) clearing++;
        }
      }
    });
  }

  const share = clearing / Math.max(1, attachments);
  assert.ok(
    share > 0.85,
    `only ${Math.round(share * 100)}% of swings clear the roof they hang from `
    + `(${clearing}/${attachments}); it was 21% before the geometry was fixed`,
  );
});

test('the hook accepts anchors below the player', () => {
  // Refusing them rejected 86% of the anchors actually within reach, and read
  // as the button not working rather than as a mistake.
  assert.ok(TUNING.anchorBelowMargin > 0, 'anchors below the player are refused outright again');
});

// --- The difficulty curve ------------------------------------------------

test('the opening of a run is nearly flat, and the escalation has no ceiling', () => {
  assert.ok(difficultyAt(0) === 0);
  // Roughly where a competent run ends: it should barely have started.
  assert.ok(difficultyAt(1500) < 0.02, 'the city is already hard where a first run ends');
  // Far out, it should be most of the way up but never arrive.
  assert.ok(difficultyAt(200000) > 0.9);
  assert.ok(difficultyAt(1e9) < 1);
  // Monotonic.
  let last = -1;
  for (let d = 0; d < 200000; d += 2500) {
    const t = difficultyAt(d);
    assert.ok(t >= last, `difficulty went backwards at ${d}`);
    last = t;
  }
});

// --- What the bots say ---------------------------------------------------

test('a competent first run lasts long enough to feel like a failure', () => {
  const now = measure(RUNS);
  const c = now.competent;

  assert.ok(c.medianMetres >= 45, `competent median only ${c.medianMetres} m`);
  assert.ok(c.medianSeconds >= 3.5, `competent median only ${c.medianSeconds}s`);
  // The specific complaint that started the pass: almost every run ended
  // before the player had done anything.
  assert.ok(
    c.veryShortRuns / c.runs < 0.25,
    `${c.veryShortRuns}/${c.runs} competent runs ended under 25 m`,
  );
});

test('a good player still gets far past a competent one', () => {
  const now = measure(RUNS);
  assert.ok(
    now.ceilingRatio >= 4,
    `good/competent median ratio is only ${now.ceilingRatio}x; the ceiling has flattened`,
  );
  assert.ok(now.good.bestMetres > 1000, `best good run only ${now.good.bestMetres} m`);
});

test('the tuning beats the numbers it replaced, on identical cities', () => {
  const before = measure(RUNS, PRE_TUNING_BASELINE);
  const after = measure(RUNS);

  assert.ok(
    after.competent.medianMetres > before.competent.medianMetres * 2,
    `competent median ${before.competent.medianMetres} -> ${after.competent.medianMetres} m is not the improvement this shipped for`,
  );
  assert.ok(
    after.ceilingRatio > before.ceilingRatio,
    `ceiling ratio ${before.ceilingRatio}x -> ${after.ceilingRatio}x: the gap narrowed`,
  );
});

test('a run always ends for a stated reason', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const run = runOnce('competent', seed);
    assert.ok(run.reason && run.reason !== '', `run ${seed} ended with no reason`);
    assert.ok(run.metres >= 0);
  }
});

test('tuning is data a test can override', () => {
  // The arrangement the whole harness depends on; if either stops being a
  // plain object, every comparison above silently starts measuring one thing.
  assert.equal(typeof TUNING, 'object');
  assert.equal(typeof CITY_TUNING, 'object');
  assert.ok(Number.isFinite(TUNING.grappleRange));
  assert.ok(Number.isFinite(CITY_TUNING.ramp));
});
