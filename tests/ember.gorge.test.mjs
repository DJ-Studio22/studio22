// tests/ember.gorge.test.mjs
//
// Ember makes one claim: "momentum is the whole skill, so the gap has to be
// read early." That is an arithmetic claim, and these check it.
//
// The important one is the reachability contract. Every gap must be reachable
// from the worst state a player could legitimately arrive in — at the edge of
// the previous gap, at terminal velocity, moving the wrong way, with the gust
// against them. A gorge that generates one gap outside that band has produced
// a death nobody could have avoided, and in an endless game that death will
// find every player eventually.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  END, Flight, PIXELS_PER_METRE, TUNING, WORLD_H,
  difficultyAt, firstGate, nextGate, physicsAt, reachableBand, reachableOffset, wallsAt,
} from '../games/ember/gorge.js';
import { runOnce } from './helpers/ember-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// --- The physics ----------------------------------------------------------

test('the burner lifts and letting go sinks', () => {
  const rise = new Flight();
  for (let i = 0; i < 30; i++) rise.step(1 / 60, { burn: true });
  assert.ok(rise.vy < 0, 'holding the burner did not produce lift');

  const sink = new Flight();
  for (let i = 0; i < 30; i++) sink.step(1 / 60, { burn: false });
  assert.ok(sink.vy > 0, 'releasing the burner did not sink');
});

test('the balloon carries its momentum — it cannot change its mind', () => {
  const f = new Flight();
  // Half a second of sink builds real downward speed.
  for (let i = 0; i < 30; i++) f.step(1 / 60, { burn: false });
  const sinking = f.vy;
  assert.ok(sinking > 100, `expected a real sink rate, got ${sinking.toFixed(0)}`);

  // One frame of burner must NOT undo it. If it did, there would be no game.
  f.step(1 / 60, { burn: true });
  assert.ok(f.vy > sinking * 0.8, 'one frame of burner cancelled the momentum');
});

test('neither direction runs away — both speeds are terminal', () => {
  // Terminal speeds SCALE with the drift, so the base figures are the wrong
  // yardstick — the limit has to be read at the speed the balloon is doing.
  const limit = (f) => physicsAt(difficultyAt(f.x).speed);

  const up = new Flight();
  for (let i = 0; i < 60 * 5; i++) up.step(1 / 60, { burn: true });
  assert.ok(Math.abs(up.vy) <= limit(up).maxRise + 1, 'rise exceeded its terminal speed');

  const down = new Flight();
  for (let i = 0; i < 60 * 5; i++) down.step(1 / 60, { burn: false });
  assert.ok(down.vy <= limit(down).maxSink + 1, 'sink exceeded its terminal speed');
});

// --- The reachability contract -------------------------------------------

test('reachableOffset is negative when there is no time to arrest the sink', () => {
  // Arriving at terminal with almost no time left: the balloon is still losing
  // ground. The function must say so rather than reporting a small positive.
  assert.ok(reachableOffset(0.05, TUNING.baseSpeed) < 0, 'claimed forward progress with no time to stop');
});

test('reachableOffset grows with time and is stated against the weaker accel', () => {
  const at = (t) => reachableOffset(t, TUNING.baseSpeed);
  assert.ok(at(1.5) > at(1.0));
  assert.ok(at(1.0) > at(0.7));

  // Make the burner enormous. The answer must not move, because the contract
  // is stated against whichever direction is weaker.
  const lopsided = { ...TUNING, burnAccel: TUNING.burnAccel * 10 };
  assert.equal(
    reachableOffset(1.2, TUNING.baseSpeed, lopsided).toFixed(4),
    reachableOffset(1.2, TUNING.baseSpeed, TUNING).toFixed(4),
    'a stronger burner changed a contract that is supposed to track the weaker direction',
  );
});

test('the reachable band is INVARIANT in pixels however fast the drift gets', () => {
  // The invariant the whole game rests on, and the one the first cut of this
  // file did not have. Accelerations scale with speed^2 and terminal speeds
  // with speed, so the time terms shrink exactly as fast as the drift rises
  // and every vertical distance is left where it was.
  //
  // Without it the reachable band shrank every kilometre, reached zero at
  // about 25 km and went negative after — a gorge no perfect player could
  // have crossed. Measured, not guessed; this is that measurement, kept.
  const at = (x) => {
    const d = difficultyAt(x);
    return reachableOffset(d.spacing / d.speed, d.speed);
  };

  // Past the point where gap and spacing have both floored, the geometry is
  // fixed and the reach must stop moving completely.
  const settled = at(30000);
  for (const x of [30000, 60000, 200000, 1_000_000, 10_000_000]) {
    assert.ok(
      Math.abs(at(x) - settled) < 0.01,
      `reach drifted from ${settled.toFixed(1)}px to ${at(x).toFixed(1)}px by ${(x / 1000).toFixed(0)} km`,
    );
  }
  assert.ok(settled > 120, `settled reach of ${settled.toFixed(1)}px is too tight to fly`);

  // And the arrest distance — the momentum cost that IS the game — is the
  // same at every speed, which is what makes the skill transferable.
  const arrest = (x) => {
    const p = physicsAt(difficultyAt(x).speed);
    const a = Math.min(p.burnAccel, p.sinkAccel) - p.gustAccel;
    const v = Math.min(p.maxRise, p.maxSink);
    return (v * v) / (2 * a);
  };
  assert.ok(Math.abs(arrest(0) - arrest(500000)) < 0.01, 'the momentum cost changed with speed');
});

test('EVERY generated gap is reachable from the worst legal arrival', () => {
  let gates = 0;
  let clamped = 0;
  let worstUsage = 0;

  for (let seed = 1; seed <= 60; seed++) {
    withSeed(seed, () => {
      let prev = firstGate();
      // Far enough that the gap and the spacing have both hit their floors.
      for (let i = 0; i < 400; i++) {
        const gate = nextGate(prev);
        const band = reachableBand(prev.centre, prev.spacing, gate.speed, gate.gap);
        const needed = Math.abs(gate.centre - prev.centre);

        assert.ok(
          needed <= band.reach + 0.001,
          `gate ${i} at x=${gate.x.toFixed(0)} needs ${needed.toFixed(1)}px `
          + `but only ${band.reach.toFixed(1)}px is reachable`,
        );
        // Both walls must stay inside the world. A gap centre near an edge
        // puts the rock off screen, which is how the gorge lost a wall.
        assert.ok(
          gate.centre - gate.gap / 2 >= TUNING.edgeRock - 0.001,
          `gate ${i} put the ceiling above the top of the world`,
        );
        assert.ok(
          gate.centre + gate.gap / 2 <= WORLD_H - TUNING.edgeRock + 0.001,
          `gate ${i} put the floor below the bottom of the world`,
        );

        worstUsage = Math.max(worstUsage, band.reach === 0 ? 0 : needed / band.reach);
        if (gate.clamped) clamped++;
        gates++;
        prev = gate;
      }
    });
  }

  // A guarantee that never binds is a coincidence, not a guarantee. If the
  // clamp never fired, this test would pass on a gorge that simply never
  // wanted to go anywhere difficult.
  const rate = clamped / gates;
  assert.ok(rate > 0.05, `the reachability clamp only bound on ${(rate * 100).toFixed(1)}% of gates — it is not doing any work`);
  assert.ok(worstUsage > 0.9, 'no gate came close to the limit, so the limit is untested');
});

test('the safety factor is real — the contract is not satisfied only exactly', () => {
  // Every gate must leave headroom over the raw analytic reach, or a perfect
  // player committing one frame late is dead through no fault of their own.
  withSeed(99, () => {
    let prev = firstGate();
    for (let i = 0; i < 300; i++) {
      const gate = nextGate(prev);
      const raw = reachableOffset(prev.spacing / gate.speed, gate.speed);
      const needed = Math.abs(gate.centre - prev.centre);
      assert.ok(
        needed <= raw * TUNING.reachSafety + 0.001,
        `gate ${i} used more than the safety factor allows`,
      );
      prev = gate;
    }
  });
});

// --- The difficulty curve -------------------------------------------------

test('the gorge narrows and quickens with distance, and then stops', () => {
  const near = difficultyAt(0);
  const far = difficultyAt(6000);
  assert.ok(far.gap < near.gap, 'the gorge never narrowed');
  assert.ok(far.spacing < near.spacing, 'the gates never tightened');
  assert.ok(far.speed > near.speed, 'the drift never quickened');

  // Gap and spacing bottom out; speed does not, which is what ends a run.
  const veryFar = difficultyAt(100000);
  assert.equal(veryFar.gap, TUNING.minGap);
  assert.equal(veryFar.spacing, TUNING.minSpacing);
  assert.ok(veryFar.speed > far.speed, 'speed hit a ceiling — the game would never end');
});

test('the narrowest gorge still admits the balloon with room to fly', () => {
  // A gap only as wide as the envelope is a gap nobody can fly through, and
  // minGap is exactly the number somebody will tune without checking this.
  assert.ok(
    TUNING.minGap > TUNING.radius * 2 * 2,
    `minGap ${TUNING.minGap} leaves less than an envelope's width of room either side`,
  );
});

test('the gorge is continuous — what is drawn is what is solid', () => {
  withSeed(5, () => {
    let prev = firstGate();
    const gates = [prev];
    for (let i = 0; i < 30; i++) { prev = nextGate(prev); gates.push(prev); }

    // Walk the silhouette and confirm it never jumps. A discontinuity is a
    // wall that appears out of nothing between two frames.
    let last = wallsAt(gates[0].x, gates);
    for (let x = gates[0].x; x < gates[gates.length - 2].x; x += 6) {
      const w = wallsAt(x, gates);
      assert.ok(w.floor > w.ceiling, `the gorge closed completely at x=${x}`);
      assert.ok(Math.abs(w.ceiling - last.ceiling) < 12, `the ceiling jumped at x=${x}`);
      assert.ok(Math.abs(w.floor - last.floor) < 12, `the floor jumped at x=${x}`);
      last = w;
    }
  });
});

// --- What the two skill levels actually get -------------------------------

test('a competent first run lasts long enough to feel like a failure', () => {
  const runs = [];
  for (let seed = 1; seed <= 40; seed++) {
    withSeed(seed, () => runs.push(runOnce('competent').metres));
  }
  const s = summarise(runs);
  // Not a refusal: a first run has to get somewhere before the rock finds it.
  assert.ok(s.median >= 60, `competent median only ${s.median} m — the game is refusing the player`);
  assert.ok(s.median <= 1200, `competent median ${s.median} m — nothing is at stake`);
});

test('a good player still gets far past a competent one', () => {
  const competent = [];
  const good = [];
  for (let seed = 1; seed <= 40; seed++) {
    withSeed(seed, () => competent.push(runOnce('competent').metres));
    withSeed(seed, () => good.push(runOnce('good').metres));
  }
  const c = summarise(competent);
  const g = summarise(good);

  // This is the momentum claim, measured. Reading one gap further and leading
  // with velocity is the ONLY difference between these two bots. If it bought
  // nothing, the game would not be about momentum at all.
  assert.ok(
    g.median > c.median * 1.8,
    `reading ahead bought almost nothing: competent ${c.median} m vs good ${g.median} m`,
  );
});

test('a run always ends for a stated reason', () => {
  withSeed(4, () => {
    const r = runOnce('competent');
    if (!r.alive) assert.equal(r.reason, END.ROCK);
  });
});

test('tuning is data a test can override', () => {
  const wide = { ...TUNING, baseGap: 460, minGap: 460 };
  const narrow = { ...TUNING, baseGap: 150, minGap: 150 };
  const play = (t) => withSeed(21, () => runOnce('competent', t).metres);
  assert.ok(play(wide) > play(narrow), 'gap width made no difference, so the tuning is not live');
});

test('metres are pixels, converted in exactly one place', () => {
  const f = new Flight();
  f.x = PIXELS_PER_METRE * 42.7;
  assert.equal(f.metres, 42);
});
