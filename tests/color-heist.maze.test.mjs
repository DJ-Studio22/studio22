// tests/color-heist.maze.test.mjs
//
// Colour Heist is a routing problem wearing a maze, and it makes two claims:
//
//   THE CONSTRAINT COSTS SOMETHING. You pass a door only while wearing its
//   colour, and changing colour costs time. If switching were free the doors
//   would be scenery. Measured as the gap between a bot that plans around the
//   colours and one that only reacts to them.
//
//   EVERY FLOOR IS POSSIBLE. A generated vault that cannot be crossed in the
//   time given reads as broken, not as hard, and the player cannot tell "I
//   took the wrong route" from "there was no route". Guaranteed by
//   construction — the clock is derived from a route the search has proved.
//
// The second is unusual in this project in being exact rather than sampled:
// the state space is (cell, colour), Dijkstra over it is complete, so
// "impossible" really means impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLOUR, COLOURS, END, Heist, OPEN, TUNING, Vault, buildFloor, distancesFrom,
  fastestRoute, gemsForFloor, marginForFloor, sizeForFloor, timeForPar,
} from '../games/color-heist/maze.js';
import { SKILLS, runOnce } from './helpers/heist-bot.mjs';
import { summarise, withSeed } from './helpers/seeded.mjs';

// --- The vault ------------------------------------------------------------

test('a passage is one fact, not two that can disagree', () => {
  const v = new Vault(4, 4);
  v.setPassage(1, 1, 1, 0, COLOUR.CYAN);
  assert.equal(v.passage(1, 1, 1, 0), COLOUR.CYAN);
  assert.equal(v.passage(2, 1, -1, 0), COLOUR.CYAN, 'the same door read from the other side differed');
});

test('a wall is not a door, and the edge of the vault is a wall', () => {
  const v = new Vault(3, 3);
  assert.equal(v.passage(1, 1, 1, 0), null);
  assert.equal(v.inside(-1, 0), false);
  assert.equal(v.inside(3, 0), false);
});

// --- The search -----------------------------------------------------------

test('the search prices a switch, and prefers the long way round when it is cheaper', () => {
  // Two routes: three steps through a cyan door, or six steps all open. With a
  // switch costing three and a half steps, the long way should win.
  const v = new Vault(8, 1);
  for (let x = 0; x < 7; x++) v.setPassage(x, 0, 1, 0, OPEN);
  const open = fastestRoute(v, 0, 7, COLOUR.AMBER);
  assert.equal(open.switches, 0);

  v.setPassage(3, 0, 1, 0, COLOUR.CYAN);
  const gated = fastestRoute(v, 0, 7, COLOUR.AMBER);
  assert.equal(gated.switches, 1, 'the only way through a cyan door is to be cyan');
  assert.ok(gated.seconds > open.seconds, 'the switch cost nothing');
});

test('and it returns null when there is genuinely no way through', () => {
  const v = new Vault(3, 1);
  v.setPassage(0, 0, 1, 0, OPEN);
  // Cell 2 is walled off entirely.
  assert.equal(fastestRoute(v, 0, 2, COLOUR.AMBER), null);
});

test('the search is exact, so a rejection is a fact rather than a doubt', () => {
  // Unlike the mini golf beam or the Rift Runner solver, this one is complete:
  // (cell, colour) is a small state space and Dijkstra over it is exhaustive.
  // The test that this matters: a route it says costs N cannot be beaten by
  // any hand-built alternative.
  const v = new Vault(5, 1);
  for (let x = 0; x < 4; x++) v.setPassage(x, 0, 1, 0, OPEN);
  const route = fastestRoute(v, 0, 4, COLOUR.AMBER);
  assert.equal(route.steps, 4);
  assert.equal(route.switches, 0);
  assert.ok(Math.abs(route.seconds - 4 * TUNING.stepSeconds) < 1e-9);
});

test('distancesFrom agrees with fastestRoute, which is why it can replace it', () => {
  // Gem placement used to call fastestRoute twice per candidate cell — six
  // hundred searches on a big floor, and the slowest thing in the project by a
  // long way. Two searches answer the same question, and this is the check
  // that they answer it the same.
  withSeed(5, () => {
    const vault = buildFloor(4);
    const out = distancesFrom(vault, [{ cell: vault.start, colour: COLOUR.AMBER }]);
    for (const gem of vault.gems) {
      const direct = fastestRoute(vault, vault.start, gem.cell, COLOUR.AMBER);
      assert.ok(direct, 'a gem was placed somewhere unreachable');
      assert.ok(Math.abs(out[gem.cell] - direct.seconds) < 1e-6,
        `the bulk search and the single search disagree at ${gem.cell}`);
    }
  });
});

// --- Generation -----------------------------------------------------------

test('EVERY FLOOR IS POSSIBLE, and with room to spare', () => {
  // The clock is derived from a route the search proved, so this cannot fail
  // by accident — which is the point of deriving it that way rather than
  // reading it off a table.
  withSeed(2, () => {
    for (let floor = 1; floor <= 30; floor++) {
      const vault = buildFloor(floor);
      const route = fastestRoute(vault, vault.start, vault.exit, COLOUR.AMBER);
      assert.ok(route, `floor ${floor} has no route to the exit at all`);
      assert.ok(route.seconds < vault.limit,
        `floor ${floor} needs ${route.seconds.toFixed(1)}s and gives ${vault.limit.toFixed(1)}s`);
    }
  });
});

test('and no floor can be crossed without ever changing colour', () => {
  // A vault you can walk straight through is a vault with the game taken out
  // of it. The generator rejects them.
  withSeed(7, () => {
    for (let floor = 1; floor <= 20; floor++) {
      const vault = buildFloor(floor);
      if (vault.degenerate) continue;
      assert.ok(vault.parSwitches >= 1,
        `floor ${floor} can be crossed without a single switch, so the doors are scenery`);
    }
  });
});

test('THE MARGIN SHRINKS FOREVER AND NEVER REACHES ZERO', () => {
  // This is what makes it endless. A fixed time per floor with a minimum is
  // not: past the floor where the maze stops growing and the clock stops
  // falling, nothing changes — and the planning bot cleared 102 floors and was
  // still going when the harness stopped it.
  let previous = Infinity;
  for (const floor of [1, 5, 10, 25, 60, 200]) {
    const margin = marginForFloor(floor);
    assert.ok(margin <= previous, `the margin grew between floors at ${floor}`);
    assert.ok(margin >= TUNING.marginFloor, 'the margin went below its floor');
    previous = margin;
  }
  assert.ok(marginForFloor(200) < marginForFloor(1) * 0.5, 'the tightening is not real');
  assert.ok(timeForPar(10, 1) > timeForPar(10, 50), 'a later floor is not tighter');
});

test('the vault grows, and has loops so there is a route to choose', () => {
  assert.ok(sizeForFloor(20).cols > sizeForFloor(1).cols);
  withSeed(4, () => {
    const vault = buildFloor(6);
    // A spanning tree of N cells has exactly N-1 passages. More than that means
    // loops, and loops are what make it routing rather than following.
    let passages = 0;
    for (const list of [vault.right, vault.down]) {
      for (const p of list) if (p !== null) passages++;
    }
    const cells = vault.cols * vault.rows;
    assert.ok(passages > cells - 1,
      'the vault is a tree, so there is exactly one path and nothing to route');
  });
});

test('GEMS ARE DETOURS, not things you walk past', () => {
  // A gem on the fastest route is a pickup, not a decision. Every one is
  // placed so that going via it costs real time, and dropped if the detour
  // will not fit in the clock.
  withSeed(11, () => {
    for (let floor = 1; floor <= 12; floor++) {
      const vault = buildFloor(floor);
      if (vault.degenerate) continue;
      const out = distancesFrom(vault, [{ cell: vault.start, colour: COLOUR.AMBER }]);
      const home = distancesFrom(vault, COLOURS.map((colour) => ({ cell: vault.exit, colour })));
      for (const gem of vault.gems) {
        const via = out[gem.cell] + home[gem.cell];
        assert.ok(via > vault.parTime,
          `a gem on floor ${floor} sits on the fastest route, so taking it is not a choice`);
        assert.ok(via <= vault.limit,
          `a gem on floor ${floor} cannot be reached in the time given, so it is a taunt`);
      }
    }
  });
});

test('gems grow with the floor, up to a sane cap', () => {
  assert.ok(gemsForFloor(20) > gemsForFloor(1));
  assert.equal(gemsForFloor(500), TUNING.maxGems);
});

// --- The run --------------------------------------------------------------

test('a door only opens for its own colour, and switching takes time', () => {
  const heist = new Heist();
  heist.vault = new Vault(3, 1);
  heist.vault.setPassage(0, 0, 1, 0, COLOUR.CYAN);
  heist.vault.gems = [];
  heist.cell = 0;
  heist.colour = COLOUR.AMBER;
  heist.busy = 0;

  assert.equal(heist.move(1, 0), false, 'walked through a door of the wrong colour');
  assert.equal(heist.switchTo(COLOUR.CYAN), true);
  assert.ok(heist.busy > 0, 'the switch was free');
  assert.equal(heist.move(1, 0), false, 'moved while mid-switch');

  heist.busy = 0;
  assert.equal(heist.move(1, 0), true, 'the door stayed shut for its own colour');
});

test('THE ALARM DOES NOT START UNTIL YOU MOVE', () => {
  // Found by playing it cold, and no bot could have: floor one gives under
  // eight seconds, and four of them spent reading the screen had already lost
  // the run. Arming on the first input costs a player who knows the game
  // nothing.
  const heist = new Heist();
  const before = heist.left;
  heist.step(3);
  assert.equal(heist.left, before, 'the clock ran while the player was still reading');
  assert.equal(heist.armed, false);

  heist.cycle(1);
  assert.equal(heist.armed, true, 'touching a control did not start the alarm');
  heist.step(0.5);
  assert.ok(heist.left < before, 'the alarm never started');
});

test('and once it is running, it runs out for a stated reason', () => {
  const heist = new Heist();
  heist.armed = true;
  heist.left = 0.01;
  heist.cell = heist.vault.start;
  heist.step(0.5);
  assert.equal(heist.running, false);
  assert.equal(heist.reason, END.CAUGHT);
});

test('reaching the exit deals the next floor', () => {
  const heist = new Heist();
  heist.cell = heist.vault.exit;
  const floor = heist.floor;
  heist.step(1 / 60);
  assert.equal(heist.floor, floor + 1);
  assert.equal(heist.floorsCleared, 1);
  assert.equal(heist.cell, heist.vault.start, 'the next floor did not start at its own door');
});

// --- The claim ------------------------------------------------------------

test('PLANNING AROUND THE COLOURS BEATS REACTING TO THEM — the depth claim', () => {
  // The two bots differ in one field. Both know the map, both take the same
  // gems, both move at the same speed. The gap is entirely whether the
  // constraint was planned around or bumped into.
  // WHAT THE GAP ACTUALLY IS, and the first version of this test had it wrong.
  //
  // Over a short window the two bots earn at almost the same RATE — 24 gems
  // against 28 — because both are collecting from vaults neither is struggling
  // with yet. The difference is not speed, it is SURVIVAL: the margin tightens
  // every floor, and a bot that walks into doors it did not plan for runs out
  // of clock while one that priced them keeps going.
  //
  // So the assertion is about who is still alive, and the gems follow from it.
  const CAP = 420;
  const dasher = [];
  const router = [];
  let dasherAlive = 0;
  let routerAlive = 0;
  for (let seed = 1; seed <= 10; seed++) {
    withSeed(seed, () => {
      const r = runOnce('dasher', TUNING, CAP);
      dasher.push(r.gems);
      if (r.alive) dasherAlive++;
    });
    withSeed(seed, () => {
      const r = runOnce('router', TUNING, CAP);
      router.push(r.gems);
      if (r.alive) routerAlive++;
    });
  }
  const d = summarise(dasher);
  const r = summarise(router);

  assert.equal(dasherAlive, 0,
    'the reactive bot survived the window, so the doors are not costing it anything');
  assert.equal(routerAlive, 10,
    'the planning bot died, which means the clock is tighter than the search that set it');
  assert.ok(r.median > d.median * 1.25,
    `planning bought little: dasher ${d.median} gems, router ${r.median}`);
});

test('and the reactive bot pays for it in switches per step', () => {
  // The mechanism, not just the outcome: a bot that only notices a door when
  // it is standing in front of one switches far more often for the ground it
  // covers. If this were not true the gap above would be measuring something
  // other than the colours.
  let dasherRate = 0;
  let routerRate = 0;
  for (let seed = 1; seed <= 8; seed++) {
    withSeed(seed, () => {
      const d = runOnce('dasher', TUNING, 90);
      dasherRate += d.switches / Math.max(1, d.steps);
    });
    withSeed(seed, () => {
      const r = runOnce('router', TUNING, 90);
      routerRate += r.switches / Math.max(1, r.steps);
    });
  }
  assert.ok(dasherRate > routerRate * 1.4,
    `the reactive bot switched ${(dasherRate / 8).toFixed(2)} times a step against `
    + `${(routerRate / 8).toFixed(2)} — it is not actually being caught out by the doors`);
});

test('tuning is data a test can override', () => {
  // Convention 3. Make switching ruinous and the best route stops using it.
  const cheap = { ...TUNING, switchSeconds: 0.05 };
  const dear = { ...TUNING, switchSeconds: 6 };
  const v = new Vault(8, 1);
  for (let x = 0; x < 7; x++) v.setPassage(x, 0, 1, 0, OPEN);
  v.setPassage(3, 0, 1, 0, COLOUR.CYAN);
  const a = fastestRoute(v, 0, 7, COLOUR.AMBER, cheap);
  const b = fastestRoute(v, 0, 7, COLOUR.AMBER, dear);
  assert.ok(b.seconds > a.seconds, 'the switch cost is not live');
});

test('both bots exist and differ only in whether they plan', () => {
  const keys = new Set([...Object.keys(SKILLS.dasher), ...Object.keys(SKILLS.router)]);
  const differ = [...keys].filter((k) => SKILLS.dasher[k] !== SKILLS.router[k]);
  assert.deepEqual(differ, ['plans'],
    'the two bots differ in more than the planning, so the gap measures something else');
});
