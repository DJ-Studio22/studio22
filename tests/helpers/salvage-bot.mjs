// tests/helpers/salvage-bot.mjs
//
// Bots for Asteroid Salvage.
//
// Unusually for this project, the interesting difference between them is NOT
// how they fly. Every one of them flies identically — same dodging, same
// greed, same reflexes — and they differ only in WHAT THEY BUY. That is
// deliberate: the claim under test is about the shop, so flying has to be a
// constant or the comparison measures piloting instead.
//
//   engineFirst  buys engine to the cap, then hull, then cargo
//   hullFirst    buys hull to the cap, then engine, then cargo
//   cargoFirst   buys cargo to the cap, then engine, then hull
//   adaptive     reads the field it is about to fly and buys for it
//
// If any fixed order beat the others everywhere, the shop would be a shopping
// list — the exact failure the real-time Winter prototype was rejected for.
// And if `adaptive` did not beat all three, reading the field would be worth
// nothing and the field's character would be decoration.

import { Flight, TUNING, UPGRADE, UPGRADES } from '../../games/asteroid-salvage/flight.js';

export const ORDERS = {
  engineFirst: [UPGRADE.ENGINE, UPGRADE.HULL, UPGRADE.CARGO],
  hullFirst: [UPGRADE.HULL, UPGRADE.ENGINE, UPGRADE.CARGO],
  cargoFirst: [UPGRADE.CARGO, UPGRADE.ENGINE, UPGRADE.HULL],
};

export const SKILLS = {
  engineFirst: { adapts: false, order: ORDERS.engineFirst },
  hullFirst: { adapts: false, order: ORDERS.hullFirst },
  cargoFirst: { adapts: false, order: ORDERS.cargoFirst },
  adaptive: { adapts: true, order: null },
};

/**
 * How to fly, and every bot does it the same way.
 *
 * Head for the nearest salvage, unless a rock is close enough to matter, in
 * which case get out of its line. Crude, and crude on purpose: a clever pilot
 * would paper over a bad build, and a bad build is what this is trying to see.
 */
export function steer(flight) {
  const t = flight.t;

  // The most pressing rock: near, and coming at us rather than past us.
  let threat = null;
  for (const rock of flight.rocks) {
    if (rock.x < flight.x - 2) continue;
    const dx = rock.x - flight.x;
    const dy = rock.y - flight.y;
    const distance = Math.hypot(dx, dy);
    const room = rock.r + t.shipRadius + 4.5;
    if (distance > room + 14) continue;
    if (!threat || distance < threat.distance) threat = { rock, distance, dx, dy };
  }

  if (threat) {
    // Straight up or down out of its path, whichever side there is room on.
    const away = threat.dy > 0 ? -1 : 1;
    const edgeUp = flight.y < t.height * 0.2;
    const edgeDown = flight.y > t.height * 0.8;
    const dodge = edgeUp ? 1 : edgeDown ? -1 : away;
    return { x: -0.35, y: dodge };
  }

  let target = null;
  for (const piece of flight.salvagePieces) {
    if (piece.taken) continue;
    const distance = Math.hypot(piece.x - flight.x, piece.y - flight.y);
    if (!target || distance < target.distance) target = { piece, distance };
  }
  if (!target) return { x: 0.2, y: 0 };
  const dx = target.piece.x - flight.x;
  const dy = target.piece.y - flight.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

/**
 * What to buy, given the field about to be flown.
 *
 * The adaptive bot is the one that reads `shape.mix`: a dense field wants a
 * ship that can thread it, a fast one wants a ship that can take the hit it
 * did not see. It also buys cargo when it is comfortably alive, because income
 * compounds and a ship that never buys cargo never gets to buy anything else.
 */
export function nextPurchase(flight, s) {
  const prices = flight.prices;
  const affordable = UPGRADES.filter((k) => prices[k].afford);
  if (!affordable.length) return null;

  if (!s.adapts) {
    for (const kind of s.order) if (prices[kind].afford) return kind;
    return affordable[0];
  }

  // The next field is announced in the shop, so this reads the field it is
  // about to fly rather than the one it has just survived. Reading the past
  // was the first version and it measured as worthless, correctly: the draw is
  // independent, so a bot adapting to the last field was adapting to noise.
  const mix = (flight.nextShape ?? flight.shape).mix;
  const wanted = [];
  if (mix > 0.5) wanted.push(UPGRADE.HULL, UPGRADE.ENGINE);
  else wanted.push(UPGRADE.ENGINE, UPGRADE.HULL);
  // Cargo when the hull is comfortable, because income is what pays for the
  // rest and a ship that is not in trouble should be earning.
  if (flight.hull >= flight.hullMax - 1) wanted.unshift(UPGRADE.CARGO);
  else wanted.push(UPGRADE.CARGO);

  for (const kind of wanted) if (prices[kind].afford) return kind;
  return affordable[0];
}

/** One run. Returns salvage banked and how far it got. */
export function runOnce(skill, tuning = TUNING, maxFields = 40) {
  const s = SKILLS[skill];
  const flight = new Flight(tuning);
  const dt = 1 / 60;

  while (flight.running && flight.field <= maxFields) {
    if (flight.shopOpen) {
      // Spend until nothing else is worth buying, then go.
      let guard = 0;
      for (;;) {
        const pick = nextPurchase(flight, s);
        if (!pick || guard++ > 30) break;
        if (!flight.buy(pick)) break;
      }
      flight.launch();
      continue;
    }
    flight.step(dt, steer(flight));
  }

  return {
    banked: flight.banked,
    fields: flight.fieldsCleared,
    reason: flight.reason,
    alive: flight.running,
    hits: flight.hits,
    build: { engine: flight.engine, hull: flight.hullLevel, cargo: flight.cargo },
  };
}
