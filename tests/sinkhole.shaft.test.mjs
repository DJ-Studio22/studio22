// tests/sinkhole.shaft.test.mjs
//
// Two fairness claims, neither of which is visible on screen.
//
// A floor that is spiked end to end looks exactly as intended and plays as a
// coin toss: the gap is the only survivable square on the whole width, so
// missing it costs a life with nothing the player could have done. It used to
// happen on about two floors in five past 6,000 depth.
//
// And a ceiling that is outrun stops being a threat silently. The game still
// works; it is just no longer the game — the thing it is named for has left.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHAFT_TUNING, makeLedge, isGap, isSafeLanding, isSpikeAt, ledgeSegments, chaseCeiling,
} from '../games/sinkhole/shaft.js';

const W = SHAFT_TUNING.width;
const PLAYER_R = 13;
const DEPTHS = [0, 1000, 5000, 12000, 30000, 90000, 400000];

// Every x a player could actually occupy, at the resolution that matters.
function* across(step = 1) {
  for (let x = PLAYER_R; x <= W - PLAYER_R; x += step) yield x;
}

test('every floor, at every depth, has somewhere survivable to land', () => {
  for (const depth of DEPTHS) {
    for (let i = 0; i < 400; i++) {
      const ledge = makeLedge(0, depth);
      const landing = [...across()].some((x) => isSafeLanding(ledge, x, PLAYER_R));
      assert.ok(
        landing,
        `depth ${depth}: a floor with no survivable landing — gap ${Math.round(ledge.gapX)}+${Math.round(ledge.gapW)}, safe ${Math.round(ledge.safeX)}+${Math.round(ledge.safeW)}, spiked ${ledge.spiked}`,
      );
    }
  }
});

test('every floor also has a gap wide enough to fall through', () => {
  for (const depth of DEPTHS) {
    for (let i = 0; i < 400; i++) {
      const ledge = makeLedge(0, depth);
      assert.ok(
        [...across()].some((x) => isGap(ledge, x, PLAYER_R)),
        `depth ${depth}: no gap a player fits through (${Math.round(ledge.gapW)} wide)`,
      );
    }
  }
});

test('the gap and the safe band never overlap', () => {
  // If they did, the "safe" band would be a hole and the guarantee above
  // would be satisfied by something the player falls straight through.
  for (const depth of DEPTHS) {
    for (let i = 0; i < 300; i++) {
      const l = makeLedge(0, depth);
      const gapEnd = l.gapX + l.gapW;
      const safeEnd = l.safeX + l.safeW;
      assert.ok(gapEnd <= l.safeX || safeEnd <= l.gapX,
        `depth ${depth}: gap ${l.gapX}..${gapEnd} overlaps safe ${l.safeX}..${safeEnd}`);
    }
  }
});

test('both bands stay inside the shaft', () => {
  for (const depth of DEPTHS) {
    for (let i = 0; i < 300; i++) {
      const l = makeLedge(0, depth);
      assert.ok(l.gapX >= 0 && l.gapX + l.gapW <= W, `gap escaped the shaft at depth ${depth}`);
      assert.ok(l.safeX >= 0 && l.safeX + l.safeW <= W, `safe band escaped the shaft at depth ${depth}`);
    }
  }
});

test('a landing is never both safe and spiked', () => {
  for (const depth of DEPTHS) {
    for (let i = 0; i < 120; i++) {
      const l = makeLedge(0, depth);
      for (const x of across(3)) {
        assert.ok(!(isSafeLanding(l, x, PLAYER_R) && isSpikeAt(l, x, PLAYER_R)),
          `x=${x} at depth ${depth} is both safe and spiked`);
      }
    }
  }
});

test('what is drawn as plain shelf is exactly what can be landed on', () => {
  // The picture and the collision come from the same module on purpose. A
  // stretch that looked safe and hurt would be the least forgivable bug this
  // game could have.
  for (const depth of [0, 8000, 60000]) {
    for (let i = 0; i < 150; i++) {
      const l = makeLedge(0, depth);
      const segments = ledgeSegments(l, SHAFT_TUNING);

      for (const x of across(2)) {
        const drawn = segments.find((s) => x >= s.x && x < s.x + s.w);
        if (!drawn) continue;               // over the gap
        const hurts = isSpikeAt(l, x, 0);
        assert.equal(hurts, drawn.spiked,
          `x=${x} is drawn ${drawn.spiked ? 'spiked' : 'plain'} but ${hurts ? 'hurts' : 'does not hurt'}`);
      }
    }
  }
});

test('segments tile the shelf without gaps or overlaps', () => {
  for (const depth of [0, 20000]) {
    for (let i = 0; i < 150; i++) {
      const l = makeLedge(0, depth);
      const covered = ledgeSegments(l, SHAFT_TUNING)
        .reduce((sum, s) => sum + s.w, 0);
      assert.ok(Math.abs(covered - (W - l.gapW)) < 1e-6,
        `segments cover ${covered}, shelf is ${W - l.gapW}`);
    }
  }
});

test('difficulty still rises — the guarantee is not a flat game', () => {
  const measure = (depth) => {
    let gap = 0; let safe = 0; let spiked = 0;
    const n = 600;
    for (let i = 0; i < n; i++) {
      const l = makeLedge(0, depth);
      gap += l.gapW; safe += l.safeW; spiked += l.spiked ? 1 : 0;
    }
    return { gap: gap / n, safe: safe / n, spikedShare: spiked / n };
  };

  const easy = measure(0);
  const hard = measure(60000);

  assert.ok(hard.gap < easy.gap, 'the gap should narrow with depth');
  assert.ok(hard.safe < easy.safe, 'the safe band should narrow with depth');
  assert.ok(hard.spikedShare > easy.spikedShare, 'more floors should be spiked with depth');
  assert.ok(hard.safe >= SHAFT_TUNING.safeMin, 'but the safe band must never vanish');
});

// --- The ceiling ----------------------------------------------------------

test('the ceiling descends even when the player is right under it', () => {
  const scroll = 100;
  const before = 100;
  const after = chaseCeiling(before, before + 200, scroll, 1);
  assert.ok(after > before, 'the ceiling must always be closing');
  assert.ok(Math.abs(after - (before + scroll)) < 1e-9,
    'with the player close it should descend at exactly the shaft speed');
});

test('a diving player cannot outrun the ceiling forever', () => {
  // The reported failure: a thousand units down and the game went slack.
  let ceiling = SHAFT_TUNING.ceilingStartY;
  let player = SHAFT_TUNING.ceilingStartY + 200;
  const dt = 1 / 60;

  // Dive hard for ten seconds, far faster than the shaft rises.
  for (let i = 0; i < 600; i++) {
    player += 1100 * dt;
    ceiling = chaseCeiling(ceiling, player, 235, dt);
  }

  // The lead must SETTLE rather than diverge. A hard cap during a dive would
  // make diving pointless; an uncapped lead is the bug being fixed.
  const lead = player - ceiling;
  assert.ok(
    lead < SHAFT_TUNING.ceilingMaxLead * 2,
    `the lead ran away to ${Math.round(lead)}; it should settle near ${SHAFT_TUNING.ceilingMaxLead}`,
  );
  assert.ok(ceiling > 5000, 'the ceiling should have travelled a long way down with the player');
});

test('diving still buys real room — the chase is not a leash', () => {
  let ceiling = 100;
  let player = 300;
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) {
    player += 1100 * dt;
    ceiling = chaseCeiling(ceiling, player, 235, dt);
  }
  assert.ok(player - ceiling > 400, 'a good dive should still open a gap worth having');
});

test('the ceiling reaches the player but never steps past them', () => {
  // Reaching them IS the death — game.js turns it into a hit. Stepping past
  // in one tick would read as a teleport rather than a crush.
  let ceiling = 100;
  const player = 900;
  for (let i = 0; i < 2000; i++) {
    const before = ceiling;
    ceiling = chaseCeiling(ceiling, player, 235, 1 / 60);
    assert.ok(ceiling <= player, 'the ceiling went past the player');
    assert.ok(ceiling - before < 60, 'the ceiling jumped rather than closed');
  }
  assert.ok(player - ceiling < 1, 'a stationary player should eventually be caught');
});

test('standing still lets it catch up, which is the whole design', () => {
  // Hesitating is what kills you. If the player stops, the gap must close.
  let ceiling = 100;
  const player = 1400;
  const start = player - ceiling;
  for (let i = 0; i < 600; i++) ceiling = chaseCeiling(ceiling, player, 235, 1 / 60);
  assert.ok(player - ceiling < start, 'the ceiling did not gain on a stationary player');
});

test('THE SPIKES NEVER LEAVE THE TOP OF THE VIEW', () => {
  // Fixed twice, returned twice, and both times the number was adjusted when
  // the MODEL was what was wrong.
  //
  // The lead above is expressed in WORLD units; what a player complains about
  // is expressed in SCREEN units, and nothing connected the two. The camera
  // holds the player 302 pixels below the top of the view and the lead settles
  // at 820, so the resting state of the old model put the spikes 518 pixels
  // ABOVE the screen. Not while the player got ahead -- always. No value of
  // ceilingCatchUp reaches that, because the equilibrium itself is out of
  // frame, which is why tuning it kept appearing to work and kept coming back.
  //
  // So the constraint now lives where the complaint does: the ceiling is
  // clamped to the top of the view, and this is the check that says so.
  const CAM_ANCHOR = 720 * 0.42;
  const CAM_LOOKAHEAD = 130;

  let ceiling = SHAFT_TUNING.ceilingStartY;
  let player = SHAFT_TUNING.ceilingStartY + 200;
  let worstOffScreen = 0;

  const dt = 1 / 60;
  for (let i = 0; i < 60 * 30; i++) {
    // A player diving as hard as the game allows, which is the case that used
    // to lose them.
    player += 1150 * dt;
    const viewTop = Math.max(0, player - CAM_ANCHOR + CAM_LOOKAHEAD);
    ceiling = chaseCeiling(ceiling, player, 235, dt, SHAFT_TUNING, viewTop);
    // Positive means the ceiling is above the top of the view: off screen.
    worstOffScreen = Math.max(worstOffScreen, viewTop - ceiling);
  }

  assert.equal(Math.round(worstOffScreen), 0,
    `after thirty seconds of diving the spikes were ${Math.round(worstOffScreen)}px above the screen`);
});

test('and being held in view does not mean being shoved onto the player', () => {
  // The other half of the report was "they spawn on top of me". The clamp
  // pushes the ceiling DOWN towards the player, so it has to be checked that it
  // never pushes it onto them: the crush is meant to be something you watch
  // arrive, not something that lands.
  const CAM_ANCHOR = 720 * 0.42;
  let ceiling = SHAFT_TUNING.ceilingStartY;
  let player = SHAFT_TUNING.ceilingStartY + 200;
  let closest = Infinity;

  const dt = 1 / 60;
  for (let i = 0; i < 60 * 30; i++) {
    player += 600 * dt;                       // a steady, ordinary descent
    const viewTop = Math.max(0, player - CAM_ANCHOR);
    ceiling = chaseCeiling(ceiling, player, 235, dt, SHAFT_TUNING, viewTop);
    closest = Math.min(closest, player - ceiling);
  }

  assert.ok(closest > 100,
    `the ceiling closed to ${Math.round(closest)}px of the player without them stopping`);
});
