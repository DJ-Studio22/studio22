// games/neon-drift/traffic.js
//
// The other cars, and the reason they are worth a file of their own.
//
// A wall of obstacles sliding down the screen at fixed speeds is the cheap
// version of this, and it plays badly for a specific reason: the gaps never
// change, so weaving is a memory test rather than a driving one. Traffic that
// behaves gives you a road that is different every time without being random —
// a lorry pulls out to overtake and the lane you were aiming at closes; you
// come up fast behind someone and they move over for you.
//
// So every car here runs the same three rules, in this order:
//
//   1. FOLLOW      Never drive into the back of the car ahead. Match its speed
//                  once inside the following gap, brake hard inside half of it.
//   2. OVERTAKE    If held below your own cruising speed for long enough, look
//                  for a lane with room BOTH ahead and behind, indicate, and
//                  move over.
//   3. YIELD       If something much faster is closing from behind in your
//                  lane, treat that as a reason to move over too.
//
// Rule 3 is what makes the player part of the traffic rather than a ghost
// driving through a diorama. It is also a deliberate difficulty valve: driving
// fast makes the road open up in front of you, which is the opposite of what a
// scripted obstacle course does, and it is why going fast here is the safe
// option as well as the profitable one.
//
// Nothing in this file touches the canvas or the DOM. It is given the road's
// geometry and the player's position and it answers with where the cars are.

import { clamp, randInt, randPick, randRange } from '../../engine/util.js';

// How close, in world units, counts as "the car ahead is my problem".
const FOLLOW_GAP = 190;
const PANIC_GAP = 95;

// Held this far below its own cruising speed for this long, a car starts
// looking for a way round. Not instant: a driver tolerates being held up for a
// moment before pulling out, and modelling that is most of what stops the
// traffic from twitching between lanes.
const PATIENCE = 1.1;
const HELD_UP_MARGIN = 0.86;

// Room required in the target lane before pulling into it, ahead and behind.
// The behind figure is the larger one, because merging in front of somebody is
// what causes the pile-ups this rule exists to avoid.
const MERGE_GAP_AHEAD = 150;
const MERGE_GAP_BEHIND = 210;

// Indicating happens before moving, and the move itself takes time. Both are
// readable at a glance, which is the point: a signalling car is a warning the
// player can act on.
const SIGNAL_TIME = 0.45;
const LANE_CHANGE_SPEED = 130;   // px of lateral travel per second

// A car closing from behind faster than this, and near enough, gets let past.
const YIELD_CLOSING_SPEED = 90;
const YIELD_RANGE = 300;

export class Traffic {
  #cars = [];
  #config;

  /**
   * @param {object} config
   * @param {number} config.max            Pool size. Nothing is allocated after this.
   * @param {number} config.laneCount
   * @param {(lane:number)=>number} config.laneX  Centre of a lane, in pixels.
   * @param {string[]} config.colors       Body colours to draw from.
   */
  constructor(config) {
    this.#config = config;

    // Pooled up front, per CLAUDE.md: cars are spawned in a loop for the whole
    // run, and allocating them live is exactly the thing that makes a phone
    // hitch. Every field is initialised so the objects keep one hidden shape.
    for (let i = 0; i < config.max; i++) {
      this.#cars.push({
        active: false,
        x: 0, y: 0,
        lane: 0, targetLane: 0,
        speed: 0, cruise: 0,
        w: 34, h: 62,
        color: '#ffffff',
        oncoming: false,
        heldUp: 0,
        signal: 0,          // counts down before a lane change starts
        signalDir: 0,       // -1 left, 1 right, 0 none
        changing: false,
        wobble: 0,          // phase for the slight lane drift real cars have
        // Set once the player has drawn level with this car, so a single
        // overtake can only ever be scored as one near miss.
        passedBy: false,
      });
    }
  }

  get cars() {
    return this.#cars;
  }

  get activeCount() {
    let n = 0;
    for (const car of this.#cars) if (car.active) n++;
    return n;
  }

  clear() {
    for (const car of this.#cars) car.active = false;
  }

  #free() {
    for (const car of this.#cars) if (!car.active) return car;
    return null;
  }

  /**
   * Puts a car on the road.
   *
   * @param {object} opts
   * @param {number} opts.y         World position.
   * @param {number} opts.lane
   * @param {number} opts.speed     World units per second. Negative is oncoming.
   * @param {boolean} [opts.oncoming]
   * @param {boolean} [opts.large]  A lorry: wider, longer, slower, harder to pass.
   */
  spawn({ y, lane, speed, oncoming = false, large = false }) {
    const car = this.#free();
    if (!car) return null;

    car.active = true;
    car.y = y;
    car.lane = lane;
    car.targetLane = lane;
    car.x = this.#config.laneX(lane);
    car.speed = speed;
    car.cruise = speed;
    car.w = large ? 48 : 34;
    car.h = large ? 96 : 62;
    car.color = randPick(this.#config.colors);
    car.oncoming = oncoming;
    car.heldUp = 0;
    car.signal = 0;
    car.signalDir = 0;
    car.changing = false;
    car.wobble = randRange(0, Math.PI * 2);
    car.passedBy = false;
    return car;
  }

  /**
   * One step of traffic.
   *
   * @param {number} dt
   * @param {object} player   { x, y, speed, w, h } in the same world units.
   * @param {object} bounds   { behind, ahead } world distances outside which a
   *                          car is recycled.
   */
  update(dt, player, bounds) {
    const { laneX, laneCount } = this.#config;

    for (const car of this.#cars) {
      if (!car.active) continue;

      // Oncoming traffic runs its own simple rules: it is in the opposing
      // lanes, everything around it is going the same way it is, and it has no
      // reason to react to a car on the other side of the road. Giving it the
      // full behaviour model would have it politely pulling over for a player
      // it is not sharing a lane with.
      if (!car.oncoming) {
        this.#driveWithTraffic(car, dt, player, laneCount);
      }

      car.y += car.speed * dt;

      // Lateral: ease toward the target lane, plus a small drift so a line of
      // cars is never a line of pixels.
      car.wobble += dt * 1.4;
      const target = laneX(car.targetLane) + Math.sin(car.wobble) * 1.6;
      const dx = target - car.x;
      const step = LANE_CHANGE_SPEED * dt;
      if (Math.abs(dx) <= step) {
        car.x = target;
        if (car.changing) {
          car.changing = false;
          car.lane = car.targetLane;
          car.signalDir = 0;
        }
      } else {
        car.x += Math.sign(dx) * step;
      }

      const behind = player.y - car.y;
      if (behind > bounds.behind || behind < -bounds.ahead) car.active = false;
    }
  }

  #driveWithTraffic(car, dt, player, laneCount) {
    // --- 1. Follow ---------------------------------------------------------
    const lead = this.#leaderFor(car, player);
    let desired = car.cruise;

    if (lead) {
      const gap = lead.y - car.y - (car.h + lead.h) / 2;
      if (gap < PANIC_GAP) {
        // Inside the panic gap, match and then some: a car that only matches
        // speed here never recovers the gap it lost.
        desired = Math.max(0, lead.speed * 0.72);
      } else if (gap < FOLLOW_GAP) {
        desired = Math.min(desired, lead.speed);
      }
    }

    // Braking is stronger than acceleration, as it is in anything with wheels.
    const rate = desired < car.speed ? 260 : 90;
    car.speed += clamp(desired - car.speed, -rate * dt, rate * dt);

    // --- 2 & 3. Reasons to change lane ------------------------------------
    if (car.changing) return;

    if (car.speed < car.cruise * HELD_UP_MARGIN) car.heldUp += dt;
    else car.heldUp = Math.max(0, car.heldUp - dt * 2);

    const yielding = this.#shouldYield(car, player);
    const wantsOut = car.heldUp > PATIENCE || yielding;

    if (car.signal > 0) {
      car.signal -= dt;
      if (car.signal <= 0) {
        // Re-check on the way in. The gap that was there when the indicator
        // went on may have closed while it was blinking, and pulling into it
        // anyway is the one behaviour that would read as a bug.
        const lane = car.lane + car.signalDir;
        if (this.#laneIsClear(car, lane, player)) {
          car.targetLane = lane;
          car.changing = true;
          car.heldUp = 0;
        } else {
          car.signalDir = 0;
        }
      }
      return;
    }

    if (!wantsOut) return;

    // Prefer the outside lane when overtaking, the inside when yielding — the
    // same instinct a driver has, and it keeps the fast lane usable.
    const order = yielding ? [-1, 1] : [1, -1];
    for (const dir of order) {
      const lane = car.lane + dir;
      if (lane < 0 || lane >= laneCount) continue;
      if (!this.#laneIsClear(car, lane, player)) continue;
      car.signal = SIGNAL_TIME;
      car.signalDir = dir;
      return;
    }
  }

  // Something much faster coming up behind in this car's lane.
  #shouldYield(car, player) {
    if (player.lane !== car.lane) return false;
    const behind = car.y - player.y;
    if (behind < 0 || behind > YIELD_RANGE) return false;
    return player.speed - car.speed > YIELD_CLOSING_SPEED;
  }

  // The nearest thing ahead of `car` in its lane, player included.
  #leaderFor(car, player) {
    let best = null;
    let bestGap = Infinity;

    for (const other of this.#cars) {
      if (other === car || !other.active || other.oncoming) continue;
      if (other.lane !== car.lane && other.targetLane !== car.lane) continue;
      const gap = other.y - car.y;
      if (gap <= 0 || gap > bestGap) continue;
      bestGap = gap;
      best = other;
    }

    if (player.lane === car.lane) {
      const gap = player.y - car.y;
      if (gap > 0 && gap < bestGap) best = player;
    }
    return best;
  }

  // Room in `lane` both ahead of and behind this car, counting the player.
  #laneIsClear(car, lane, player) {
    for (const other of this.#cars) {
      if (other === car || !other.active) continue;
      if (other.lane !== lane && other.targetLane !== lane) continue;
      const gap = other.y - car.y;
      if (gap > -MERGE_GAP_BEHIND && gap < MERGE_GAP_AHEAD) return false;
    }
    if (player.lane === lane) {
      const gap = player.y - car.y;
      if (gap > -MERGE_GAP_BEHIND && gap < MERGE_GAP_AHEAD) return false;
    }
    return true;
  }

  /**
   * Tops the road up ahead of the player.
   *
   * Spawning is refused when it would put a car on top of another one, which
   * is why this takes a number of attempts rather than a number of cars: at
   * high density the road is genuinely full, and the right answer then is
   * fewer cars rather than overlapping ones.
   */
  refill(player, { density, spanFrom, spanTo, laneCount, speedRange, lorryChance, oncomingLanes = 0 }) {
    const wanted = Math.round(density);
    let attempts = wanted * 3;

    while (this.activeCount < wanted && attempts-- > 0) {
      const lane = randInt(oncomingLanes, laneCount - 1);
      const y = player.y + randRange(spanFrom, spanTo);
      const large = Math.random() < lorryChance;
      const speed = randRange(speedRange[0], speedRange[1]) * (large ? 0.82 : 1);

      if (!this.#roomAt(y, lane, large ? 96 : 62)) continue;
      this.spawn({ y, lane, speed, large });
    }

    // Oncoming traffic occupies the lanes on the far side of the centre line.
    for (let lane = 0; lane < oncomingLanes; lane++) {
      const inLane = this.#cars.filter((c) => c.active && c.oncoming && c.lane === lane).length;
      if (inLane >= 3) continue;
      const y = player.y + randRange(spanFrom, spanTo);
      if (!this.#roomAt(y, lane, 62)) continue;
      this.spawn({ y, lane, speed: -randRange(180, 260), oncoming: true });
    }
  }

  #roomAt(y, lane, height) {
    for (const other of this.#cars) {
      if (!other.active || other.lane !== lane) continue;
      if (Math.abs(other.y - y) < (height + other.h) / 2 + 70) return false;
    }
    return true;
  }
}
