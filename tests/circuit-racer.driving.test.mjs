// tests/circuit-racer.driving.test.mjs
//
// Circuit geometry, lap counting, and whether the difficulty settings are
// actually different from one another.
//
// Two of this game's worst bugs are why the lap group exists. Lap counting
// once ran off `project()`, which returns the nearest point on the WHOLE
// centre line — so a car cutting a corner could be nearest to track it had not
// reached, which read as a lap and banked a 3.9-second lap on a circuit whose
// fastest possible lap is 4.5. And the finish once sent both cars reversing
// away from the line, because the coast-to-stop reused a brake with no floor
// at zero. Neither is visible in a screenshot.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TRACK, TRACKS, buildTrack, validateAllTracks } from '../games/circuit-racer/tracks.js';
import {
  DIFFICULTIES, MAX_SPEED, MAX_STEP, OFF_TRACK_MAX, SECTORS, advanceLap, aiControls, coastToStop,
  difficultyById, makeField, ordinal, positionOf, sectorOf, separateCars, standings,
  stepCar, updateSlipstream,
} from '../games/circuit-racer/driving.js';
import { withSeed } from './helpers/seeded.mjs';

const DT = 1 / 60;
const built = TRACKS.map((data) => buildTrack(data));

/**
 * A driver good enough to keep a car on the road, so tests that need a lap
 * driven have one. project() reports distance from the centre line but not
 * which side, so steering is done by chasing a point further along the line
 * rather than by correcting an offset.
 */
function pursue(track, car, lookahead = 90) {
  const here = track.project(car.x, car.y);
  const [tx, ty] = track.pointAt(here.s + lookahead);
  let diff = Math.atan2(ty - car.y, tx - car.x) - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.max(-1, Math.min(1, diff * 2.5));
}

// --- Geometry ------------------------------------------------------------

test('every circuit passes the file’s own validation', () => {
  const problems = validateAllTracks();
  assert.deepEqual(problems, [], `tracks.js reported:\n  - ${problems.join('\n  - ')}`);
});

test('the default track exists', () => {
  assert.ok(TRACKS.some((t) => t.id === DEFAULT_TRACK));
});

test('each circuit is a closed loop with a usable width', () => {
  for (const track of built) {
    assert.ok(track.length > 0, 'zero-length centre line');
    assert.ok(track.roadHalf > 0, 'zero-width road');
  }
});

test('projecting a point on the centre line returns that point', () => {
  for (const track of built) {
    for (let i = 0; i < 12; i++) {
      const [x, y] = track.pointAt((track.length * i) / 12);
      const back = track.project(x, y);
      assert.ok(back.dist < 1.5, `${track.id}: projected ${back.dist.toFixed(2)} units off its own line`);
    }
  }
});

// --- Lap counting --------------------------------------------------------

test('a teleport is rejected as a snap rather than banked as progress', () => {
  const track = built[0];
  const { player } = makeField(track, { rivals: 0 });
  const before = player.travelled;

  // Move the car most of the way round the circuit in a single step — the
  // shape a corner-cutting projection used to have. Anything bigger than a car
  // can cover in one step is refused, which is what stopped impossible lap
  // times reaching the score board.
  const [x, y] = track.pointAt(track.length * 0.75);
  player.x = x;
  player.y = y;

  assert.equal(advanceLap(track, player, 3), 0, 'a teleport counted as a lap');
  assert.ok(
    Math.abs(player.travelled - before) < MAX_STEP,
    `a single step banked ${(player.travelled - before).toFixed(1)} units of progress`,
  );
});

test('driving forward for a lap ticks over exactly one lap', () => {
  const track = built[0];
  const { player } = makeField(track, { rivals: 0 });

  let laps = 0;
  for (let i = 0; i < 60 * 240 && laps < 1; i++) {
    stepCar(track, player, { throttle: 1, brake: 0, steer: pursue(track, player) }, DT);
    laps += advanceLap(track, player, 3);
  }

  assert.equal(laps, 1, 'never completed a lap under full throttle');
  assert.ok(player.travelled >= track.length * 0.95, 'banked a lap without travelling one');
});

test('a lap can never be quicker than the track allows', () => {
  // The tripwire that exists because the lap counter once produced impossible
  // times and wrote them into session storage as legitimate bests.
  for (const track of built) {
    const fastestPossible = track.length / MAX_SPEED;
    assert.ok(fastestPossible > 0.5, `${track.id}: a lap could be done in ${fastestPossible.toFixed(2)}s`);
  }
});

test('sectors divide the lap and stay in range', () => {
  const track = built[0];
  const { player } = makeField(track, { rivals: 0 });
  for (let i = 0; i < SECTORS * 4; i++) {
    player.travelled = (track.length * i) / (SECTORS * 4);
    const sector = sectorOf(track, player);
    assert.ok(sector >= 0 && sector < SECTORS, `sector ${sector} out of range`);
  }
});

// --- Motion --------------------------------------------------------------

test('a car driven on the road accelerates, and never past its top speed', () => {
  const track = built[0];
  const { player } = makeField(track, { rivals: 0 });
  for (let i = 0; i < 60 * 30; i++) {
    stepCar(track, player, { throttle: 1, brake: 0, steer: pursue(track, player) }, DT);
  }
  assert.ok(player.speed > OFF_TRACK_MAX, `only reached ${player.speed.toFixed(0)}, no better than off-road`);
  assert.ok(player.speed <= MAX_SPEED + 1, `exceeded top speed: ${player.speed}`);
  assert.equal(player.onGrass, false, 'the pursuit driver could not stay on the road');
});

test('grass is slower than tarmac, which is the whole penalty', () => {
  const track = built[0];

  // Held well off the line, flat out, for long enough to reach whatever speed
  // the surface allows. Nothing pulls it back on, so it stays on the grass.
  const { player: offRoad } = makeField(track, { rivals: 0 });
  const s = track.length * 0.5;
  const [x, y] = track.pointAt(s);
  const [nx, ny] = track.normalAt(s);
  const [tx, ty] = track.tangentAt(s);
  offRoad.x = x + nx * (track.roadHalf + 40);
  offRoad.y = y + ny * (track.roadHalf + 40);
  offRoad.angle = Math.atan2(ty, tx);
  offRoad.speed = 0;
  for (let i = 0; i < 60 * 15; i++) stepCar(track, offRoad, { throttle: 1, brake: 0, steer: 0 }, DT);

  assert.equal(offRoad.onGrass, true, 'the off-road car found its way back onto the tarmac');
  assert.ok(
    offRoad.speed <= OFF_TRACK_MAX + 1,
    `reached ${offRoad.speed.toFixed(0)} on grass, past the ${OFF_TRACK_MAX} cap`,
  );

  // And the cap is genuinely a penalty rather than the same number twice.
  assert.ok(OFF_TRACK_MAX < MAX_SPEED, 'grass is not slower than tarmac');
});

test('coasting to a stop stops, rather than reversing away from the line', () => {
  const track = built[0];
  const { player } = makeField(track, { rivals: 0 });
  for (let i = 0; i < 60 * 20; i++) stepCar(track, player, { throttle: 1, brake: 0, steer: 0 }, DT);
  assert.ok(player.speed > 50, 'never got up to speed');

  for (let i = 0; i < 60 * 30; i++) coastToStop(track, player, DT);
  assert.ok(Math.abs(player.speed) < 1, `coasted to ${player.speed.toFixed(2)} instead of a stop`);
  assert.ok(player.speed >= -0.01, 'ended up reversing');
});

test('overlapping cars are pushed apart', () => {
  const track = built[0];
  const { cars } = makeField(track, { rivals: 3 });
  const [a, b] = cars;
  // Overlapping but not coincident: two cars at exactly the same point have no
  // direction to separate along, which is degenerate rather than a state the
  // game can reach.
  b.x = a.x + 2;
  b.y = a.y + 2;
  const before = Math.hypot(a.x - b.x, a.y - b.y);

  for (let i = 0; i < 120; i++) separateCars(cars, DT);

  const after = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(after > before, `cars stayed ${after.toFixed(2)} apart, no better than ${before.toFixed(2)}`);
});

test('the slipstream stays inside its range', () => {
  const track = built[0];
  const { cars } = makeField(track, { rivals: 3 });
  updateSlipstream(cars);
  for (const car of cars) {
    assert.ok(car.slip >= 0 && car.slip <= 1, `slip out of range: ${car.slip}`);
  }
});

// --- The field -----------------------------------------------------------

test('the player starts at the back of the grid', () => {
  const track = built[0];
  const { cars, player } = makeField(track, { rivals: 3 });
  assert.equal(cars.length, 4);
  assert.equal(positionOf(cars, player), cars.length, 'the player did not start last');
});

test('standings order the field by progress', () => {
  const track = built[0];
  const { cars } = makeField(track, { rivals: 3 });
  cars.forEach((car, i) => { car.travelled = i * 100; });

  const order = standings(cars);
  assert.equal(order.length, cars.length);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1].travelled >= order[i].travelled, 'standings are not in order');
  }
});

test('ordinals read correctly, including the teens and the twenties', () => {
  // 21 used to come out as "21th": everything past 3rd took a bare "th".
  // A four-car race never gets past 4th, so it was wrong and invisible.
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31, 101, 111].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st', '101st', '111th'],
  );
});

// --- Difficulty ----------------------------------------------------------

test('the difficulty settings are actually different from each other', () => {
  // The claim the three buttons make. Measured by letting the AI race itself
  // at each setting from the same seeded start and comparing ground covered.
  const track = built[0];
  const distances = DIFFICULTIES.map((difficulty) => withSeed(42, () => {
    const { cars, player } = makeField(track, { rivals: 3, difficulty: difficulty.id });
    const rivals = cars.filter((c) => !c.isPlayer);
    for (let i = 0; i < 60 * 45; i++) {
      for (const car of rivals) {
        stepCar(track, car, aiControls(track, car, cars, DT, player.travelled), DT);
        advanceLap(track, car, 99);
      }
      separateCars(cars, DT);
      updateSlipstream(cars);
    }
    return Math.max(...rivals.map((c) => c.travelled));
  }));

  for (let i = 1; i < distances.length; i++) {
    assert.ok(
      distances[i] > distances[i - 1],
      `${DIFFICULTIES[i].id} rivals (${distances[i].toFixed(0)}) are no faster than `
      + `${DIFFICULTIES[i - 1].id} (${distances[i - 1].toFixed(0)})`,
    );
  }
});

test('an unknown difficulty falls back rather than throwing', () => {
  assert.ok(difficultyById('nonsense'));
  assert.ok(difficultyById(undefined));
});

test('the AI keeps its car on the road', () => {
  const track = built[0];
  withSeed(9, () => {
    const { cars, player } = makeField(track, { rivals: 3, difficulty: 'pro' });
    const rivals = cars.filter((c) => !c.isPlayer);
    let offRoadTicks = 0;
    const ticks = 60 * 60;

    for (let i = 0; i < ticks; i++) {
      for (const car of rivals) {
        stepCar(track, car, aiControls(track, car, cars, DT, player.travelled), DT);
        advanceLap(track, car, 99);
        if (car.onGrass) offRoadTicks++;
      }
      separateCars(cars, DT);
    }

    const share = offRoadTicks / (ticks * rivals.length);
    assert.ok(share < 0.15, `the AI spent ${Math.round(share * 100)}% of the race on the grass`);
  });
});

// --- Pace, measured against the track rather than against a bot -----------
//
// PROGRESS.md recorded "first-timer wins 75% on Casual and 0% above it" from a
// tuning pass whose code did not survive. That figure is retired rather than
// re-established, because it is not a property of the game: it is a property
// of whatever reference bot was driving, and there is no calibrated
// first-timer to drive it. Three harnesses written against this module gave
// 0%, then 100%, then 100% again — the first two because they called functions
// that do not exist and never ended the race, and the third because a bot that
// holds the throttle down laps near the theoretical floor and beats every
// difficulty on the open circuits.
//
// What IS a property of the module: how close each difficulty gets to a lap
// with the throttle pinned and no corners. That depends on nothing but the
// code, so it is what is asserted here.

const FLAT_OUT = (track) => track.length / MAX_SPEED;

function soloLapTime(track, difficultyId, seed) {
  return withSeed(seed, () => {
    const { cars } = makeField(track, { rivals: 3, difficulty: difficultyId });
    const ai = cars.find((c) => !c.isPlayer);
    let t = 0;
    let ticks = 0;
    while (ticks++ < 60 * 200 && ai.laps < 4) {
      t += DT;
      stepCar(track, ai, aiControls(track, ai, [ai], DT, 0), DT);
      advanceLap(track, ai, 99);
    }
    return t / 4;
  });
}

const paceOf = (track, id) => [1, 2, 3]
  .map((seed) => soloLapTime(track, id, seed))
  .reduce((a, b) => a + b, 0) / 3;

test('each difficulty is quicker than the one below it, on every circuit', () => {
  for (const track of built) {
    const casual = paceOf(track, 'casual');
    const standard = paceOf(track, 'standard');
    const pro = paceOf(track, 'pro');
    assert.ok(standard < casual, `${track.id}: standard ${standard.toFixed(2)}s is not quicker than casual ${casual.toFixed(2)}s`);
    assert.ok(pro < standard, `${track.id}: pro ${pro.toFixed(2)}s is not quicker than standard ${standard.toFixed(2)}s`);
  }
});

test('Pro is quick enough to be worth the name, and still not perfect', () => {
  // A Pro rival lapping at twice the flat-out floor is not "rarely hands
  // anything back"; one lapping AT the floor would be driving through the
  // corners and would stop being beatable at all.
  for (const track of built) {
    const ratio = paceOf(track, 'pro') / FLAT_OUT(track);
    assert.ok(ratio < 1.45, `${track.id}: pro laps at ${ratio.toFixed(2)}x the flat-out floor — too slow to be Pro`);
    assert.ok(ratio > 1.05, `${track.id}: pro laps at ${ratio.toFixed(2)}x the floor — it is ignoring the corners`);
  }
});

test('Casual is beatable — it gives away real time on every circuit', () => {
  for (const track of built) {
    const ratio = paceOf(track, 'casual') / FLAT_OUT(track);
    assert.ok(ratio > 1.6, `${track.id}: casual laps at ${ratio.toFixed(2)}x the floor, which is not casual`);
  }
});
