// games/tank-tactics/arena.js
//
// Tank Tactics' simulation: the arena, the tanks, the shells that bounce, the
// cover that comes apart, and the waves that keep coming. No canvas, no input
// device, no clock of its own.
//
// WHY THIS IS NOT IN game.js
// --------------------------
// The game rests on one claim, and it is the sort of claim that is either true
// in the numbers or not true at all:
//
//   THE RICOCHET IS THE SKILL CEILING. A bank shot is something you can READ
//   and AIM, not something that occasionally comes off.
//
// "Occasionally comes off" is what a bouncing projectile does by default. Two
// things have to hold for it to be a skill instead:
//
//   READABLE — a small error in aim must produce a small error at the target.
//   If nudging the barrel by a degree moves the second-bounce impact halfway
//   across the arena, no amount of practice helps and the player is playing a
//   slot machine with a barrel on it. This is measured directly in
//   tests/tank-tactics.arena.test.mjs by differentiating the impact point with
//   respect to aim.
//
//   WORTH IT — a player who can bank must beat one who cannot. If direct fire
//   is as good, the ceiling is decorative. Two bots, one that only takes shots
//   it has line of sight for and one that also solves one-bounce shots, and
//   the gap between them is the value of the skill.
//
// WHY THE MIRROR TRICK, AND NOT A SEARCH
// --------------------------------------
// A one-bounce shot off a flat wall has a closed form: reflect the target
// through the wall and aim straight at the mirror image. That is exact, it is
// cheap, and — the part that matters for the game rather than the code — it is
// exactly the reasoning a player does by eye. The aiming line drawn on screen
// is the same computation the bot uses, so what the game shows you and what
// the game rewards are the same thing.

// --- Tuning ---------------------------------------------------------------
//
// A plain exported object, so a test can clone it, change one figure and run
// both versions side by side. See tests/README.md, convention 3.
export const TUNING = {
  // The arena, in world units. One unit is roughly a tank's width.
  width: 60,
  height: 38,
  wallThickness: 1,

  // The player's tank.
  tankRadius: 1.15,
  moveSpeed: 13.5,
  turretTurnRate: 7.2,      // radians a second when steering the barrel

  // Shells. Fast enough to feel like a gun, slow enough that a bank shot is a
  // thing you watch happen — which is what makes it readable.
  shellSpeed: 30,
  shellRadius: 0.35,
  maxBounces: 3,
  shellLife: 4.0,
  reloadSeconds: 0.62,

  // The shield. One free hit, then a wait — so a mistake costs you position
  // and tempo rather than the run, and so a player can commit to a bank shot
  // without being punished for looking away.
  shieldRecharge: 3.5,

  // Cover. Destructible, because a wall you can shoot away is a wall you can
  // choose to shoot away, and that is a decision.
  coverHp: 6,

  // WHAT MAKES THE RICOCHET WORTH ANYTHING.
  //
  // The first version of this game had neither of these lines and the bots
  // said so immediately: a bot that banked and a bot that never banked cleared
  // exactly the same number of waves, and the banking one was slightly worse.
  // Of course it was. The arena is open and the tank is quick, so walking two
  // metres to the left opens a clean shot faster than solving a bounce — and a
  // skill that is never the best answer is not a ceiling, it is decoration.
  //
  // So a ricochet does more damage, which makes banking worth CHOOSING when
  // you already have a clear shot...
  bankDamage: 2,
  directDamage: 1,
  // ...and dug-in enemies cannot be hurt by direct fire at all, which makes it
  // worth LEARNING. A player who never banks now hits a wall rather than a
  // gentle slope, and that is the honest shape of a skill ceiling.
  dugInKinds: ['sniper'],

  // Enemies, and how the waves grow. No ceiling on either.
  enemyRadius: 1.1,
  // HALF THE SPEED IT WAS. At 7.4 every tank in a wave arrived at once and a
  // wave was one undifferentiated rush; there was no arena to move through
  // because the arena came to you.
  enemySpeed: 3.6,

  // --- Sleeping, waking, engaging -----------------------------------------
  //
  // A tank does not start hunting. It holds its post, or walks a short patrol,
  // until it can SEE the player — and then it takes a moment to react before
  // it does anything about it. Those two states are what turn a wave from a
  // rush into a thing you pick apart from the edges.
  //
  // Sight is line of sight plus a range, both of which the player can reason
  // about: cover blocks it, distance blocks it, and standing still behind a
  // block means nobody is looking for you.
  // Twenty, not twenty-six, and the hand-play picked the number. The player
  // spawns about twenty-five units from the front row, so at 26 two of the
  // three tanks in the first wave had noticed before a new player had touched
  // a control. The opening should start with nobody looking at you.
  sightRange: 20,
  // The beat between being seen and being shot at. Long enough that a player
  // who breaks a sightline immediately can get away with it, which is what
  // makes the sighting moment worth showing.
  alertSeconds: 0.9,
  // A woken tank stays awake, because a tank that forgets you the moment you
  // duck is a tank you can farm from one corner.
  patrolSpeed: 1.9,
  patrolRadius: 5.5,
  // Enemy fire is slow and sloppy on purpose. A bank shot takes a second to
  // set up and a second to land, and a player being shot at four times a
  // second never gets to take one — the skill the game is built around needs
  // room to be used.
  enemyReload: 3.4,
  enemyShellSpeed: 19,
  enemyAimError: 0.18,       // radians of slop on an enemy's shot
  waveBase: 3,
  wavePerRound: 0.7,
  bouncerFromWave: 3,        // enemies that bank at you start turning up here
  sniperFromWave: 5,
  enemyHpPerWave: 0.28,      // enemies get tougher as well as more numerous

  playerHp: 5,
};

/**
 * What a tank is doing about you.
 *
 * HOLDING  has not seen you. Sits on its post or walks a small patrol.
 * ALERTED  has just seen you and is turning to face it. Cannot shoot yet.
 * ENGAGED  hunting. Closes, shoots, and does not go back to sleep.
 *
 * The middle state is the one that matters for the player: it is a whole
 * second of "that one has noticed" before anything comes back, which is what
 * makes a sightline something to manage rather than something to discover.
 */
export const STATE = { HOLDING: 'holding', ALERTED: 'alerted', ENGAGED: 'engaged' };

export const KIND = {
  GRUNT: 'grunt',       // walks at you and shoots straight
  BOUNCER: 'bouncer',   // shoots bank shots, so cover is not safety
  SNIPER: 'sniper',     // dug in: hits hard, and only a ricochet gets through
};

/** Can a shell arriving like this hurt this enemy at all? */
export const canHurt = (enemy, shell, t = TUNING) =>
  !t.dugInKinds.includes(enemy.kind) || shell.bounces > 0;

/** What one hit is worth. A bank is worth more, and that is the whole point. */
export const damageOf = (shell, t = TUNING) =>
  (shell.bounces > 0 ? t.bankDamage : t.directDamage);

export const END = {
  DESTROYED: 'Destroyed',
};

// --- Geometry -------------------------------------------------------------

/** The four inside faces of the arena. */
export function bounds(t = TUNING) {
  const w = t.wallThickness;
  return { left: w, right: t.width - w, top: w, bottom: t.height - w };
}

/**
 * Where a shell fired from `from` at `angle` ends up, bounce by bounce.
 *
 * Returns the list of points it turns at, ending at whatever stopped it. This
 * is the whole of the shell's physics and both the game and the aiming line
 * read it, so what is drawn and what is fired can never disagree.
 *
 * Reflection off an axis-aligned wall is a sign flip on one component, which
 * is why the arena is a rectangle: a shape whose bounces a player cannot
 * predict is a shape that makes the ricochet a lottery.
 */
export function tracePath(from, angle, options = {}) {
  const t = options.tuning ?? TUNING;
  const cover = options.cover ?? [];
  const maxBounces = options.maxBounces ?? t.maxBounces;
  const b = bounds(t);
  const r = t.shellRadius;

  let x = from.x;
  let y = from.y;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let travelled = 0;
  const limit = t.shellSpeed * t.shellLife;

  const points = [{ x, y }];
  let bounces = 0;

  // Note the shape: the loop runs until the shell is OUT OF RANGE, and the
  // bounce budget is spent inside it. Written as `while (bounces <= maxBounces)`
  // it allowed one bounce too many — maxBounces of 1 traced two — which made
  // every aiming line a lie about where the shell would go after the first
  // wall.
  while (travelled < limit) {
    // Distance to each wall along the current heading.
    let best = limit - travelled;
    let hit = null;

    if (dx > 1e-9) { const d = (b.right - r - x) / dx; if (d >= 0 && d < best) { best = d; hit = 'x'; } }
    if (dx < -1e-9) { const d = (b.left + r - x) / dx; if (d >= 0 && d < best) { best = d; hit = 'x'; } }
    if (dy > 1e-9) { const d = (b.bottom - r - y) / dy; if (d >= 0 && d < best) { best = d; hit = 'y'; } }
    if (dy < -1e-9) { const d = (b.top + r - y) / dy; if (d >= 0 && d < best) { best = d; hit = 'y'; } }

    // Cover is checked along the same segment, and stops the shell dead.
    const blocked = firstCoverHit({ x, y }, { x: dx, y: dy }, best, cover, t);
    if (blocked) {
      points.push({ x: blocked.x, y: blocked.y, cover: blocked.block });
      return { points, bounces, stoppedBy: 'cover' };
    }

    x += dx * best;
    y += dy * best;
    travelled += best;

    if (!hit) {
      points.push({ x, y });
      return { points, bounces, stoppedBy: 'range' };
    }

    if (bounces >= maxBounces) {
      points.push({ x, y });
      return { points, bounces, stoppedBy: 'bounces' };
    }

    points.push({ x, y, bounce: true });
    if (hit === 'x') dx = -dx; else dy = -dy;
    bounces++;
  }

  return { points, bounces, stoppedBy: 'range' };
}

/** The nearest destructible block along a ray, or null. */
export function firstCoverHit(origin, dir, maxDistance, cover, t = TUNING) {
  let best = null;
  for (const block of cover) {
    if (block.hp <= 0) continue;
    const hit = raySlab(origin, dir, block, t.shellRadius);
    if (hit === null || hit > maxDistance) continue;
    if (!best || hit < best.distance) {
      best = { distance: hit, block, x: origin.x + dir.x * hit, y: origin.y + dir.y * hit };
    }
  }
  return best;
}

/** Ray against an axis-aligned box, expanded by the shell's radius. */
function raySlab(origin, dir, block, pad = 0) {
  const minX = block.x - block.w / 2 - pad;
  const maxX = block.x + block.w / 2 + pad;
  const minY = block.y - block.h / 2 - pad;
  const maxY = block.y + block.h / 2 + pad;

  let near = -Infinity;
  let far = Infinity;

  for (const [o, d, lo, hi] of [[origin.x, dir.x, minX, maxX], [origin.y, dir.y, minY, maxY]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  if (far < 0) return null;
  return Math.max(near, 0);
}

/** Is there a clear straight line from a to b? */
export function hasLineOfSight(a, b, cover, t = TUNING) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return true;
  const dir = { x: dx / distance, y: dy / distance };
  return firstCoverHit(a, dir, distance, cover, t) === null;
}

// --- The bank shot --------------------------------------------------------

/** Which wall an aim solution bounces off. */
export const WALL = { LEFT: 'left', RIGHT: 'right', TOP: 'top', BOTTOM: 'bottom' };

/**
 * The angle that puts a one-bounce shot off `wall` onto `target`.
 *
 * The mirror trick: reflect the target through the wall and aim at the image.
 * Exact, cheap, and — the part that matters — it is the same reasoning a
 * player does by eye, which is what makes the skill learnable rather than
 * lucky.
 *
 * Returns null when the geometry does not admit the shot: both the shooter and
 * the target have to be on the near side of the wall, and the line to the
 * mirror image has to actually reach the wall rather than sailing past a
 * corner.
 */
export function bankAngle(from, target, wall, t = TUNING) {
  const b = bounds(t);
  const r = t.shellRadius;
  let image;

  switch (wall) {
    case WALL.LEFT: {
      const face = b.left + r;
      if (from.x <= face || target.x <= face) return null;
      image = { x: 2 * face - target.x, y: target.y };
      break;
    }
    case WALL.RIGHT: {
      const face = b.right - r;
      if (from.x >= face || target.x >= face) return null;
      image = { x: 2 * face - target.x, y: target.y };
      break;
    }
    case WALL.TOP: {
      const face = b.top + r;
      if (from.y <= face || target.y <= face) return null;
      image = { x: target.x, y: 2 * face - target.y };
      break;
    }
    case WALL.BOTTOM: {
      const face = b.bottom - r;
      if (from.y >= face || target.y >= face) return null;
      image = { x: target.x, y: 2 * face - target.y };
      break;
    }
    default:
      return null;
  }

  return Math.atan2(image.y - from.y, image.x - from.x);
}

/**
 * Every one-bounce solution onto `target` that actually works, checked by
 * firing it.
 *
 * The mirror gives a candidate; only the trace can say whether cover eats the
 * shell on the way, whether it bounces off the wall you meant, and whether it
 * arrives. Proposing a shot and then proving it is the same discipline the
 * mini golf generator uses, and for the same reason: a solution that does not
 * survive the real physics is not a solution.
 */
export function bankSolutions(from, target, cover, t = TUNING) {
  const found = [];
  for (const wall of [WALL.LEFT, WALL.RIGHT, WALL.TOP, WALL.BOTTOM]) {
    const angle = bankAngle(from, target, wall, t);
    if (angle === null) continue;
    const result = tracePath(from, angle, { tuning: t, cover, maxBounces: 1 });
    if (pathReaches(result, target, t.tankRadius + t.shellRadius) && result.bounces >= 1) {
      found.push({ wall, angle });
    }
  }
  return found;
}

/** Does this traced path pass within `radius` of the point? */
export function pathReaches(path, point, radius) {
  const pts = path.points;
  for (let i = 1; i < pts.length; i++) {
    if (segmentDistance(pts[i - 1], pts[i], point) <= radius) return true;
  }
  return false;
}

/** Closest approach of a segment to a point. */
export function segmentDistance(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/**
 * Where a shot at `angle` first crosses the plane it is aimed into, for
 * measuring how much the impact moves when the aim moves.
 *
 * This is the readability measurement and it is deliberately blunt: the end of
 * the traced path. If a degree of aim moves that end by half an arena, the
 * bank shot is a lottery however pretty the line looks.
 */
export function impactPoint(from, angle, options = {}) {
  const path = tracePath(from, angle, options);
  return path.points[path.points.length - 1];
}

// --- The arena ------------------------------------------------------------

/**
 * Cover for a given wave. Symmetric, so neither side of the arena is the safe
 * side, and sparse enough that there is always more than one bank available.
 */
export function buildCover(wave, t = TUNING) {
  const cover = [];
  const cx = t.width / 2;
  const cy = t.height / 2;
  const add = (x, y, w, h) => cover.push({ x, y, w, h, hp: t.coverHp, maxHp: t.coverHp });

  // A centre block, always, so the middle is never a free firing line.
  add(cx, cy, 6, 2.4);

  // Four shoulders, mirrored. The pattern rotates with the wave so a player
  // cannot learn one board and stop looking.
  const phase = wave % 3;
  const ox = phase === 0 ? 13 : phase === 1 ? 16 : 10;
  const oy = phase === 2 ? 8 : 10;
  add(cx - ox, cy - oy, 2.4, 6);
  add(cx + ox, cy - oy, 2.4, 6);
  add(cx - ox, cy + oy, 2.4, 6);
  add(cx + ox, cy + oy, 2.4, 6);

  if (wave >= 4) {
    add(cx - 22, cy, 2.4, 5);
    add(cx + 22, cy, 2.4, 5);
  }
  return cover;
}

/** How many of each kind turn up in a wave. Grows without a ceiling. */
export function waveRoster(wave, t = TUNING) {
  const total = Math.round(t.waveBase + (wave - 1) * t.wavePerRound);
  const roster = [];
  for (let i = 0; i < total; i++) {
    let kind = KIND.GRUNT;
    if (wave >= t.sniperFromWave && i % 4 === 3) kind = KIND.SNIPER;
    else if (wave >= t.bouncerFromWave && i % 3 === 2) kind = KIND.BOUNCER;
    roster.push(kind);
  }
  return roster;
}

let nextId = 1;

/**
 * One battle. `step(dt, input)` is the whole game; game.js only draws what
 * this says is true.
 */
export class Battle {
  constructor(tuning = TUNING) {
    this.t = tuning;
    this.reset();
  }

  reset() {
    const t = this.t;
    this.wave = 1;
    this.time = 0;
    this.running = true;
    this.reason = null;
    this.shells = [];
    this.cover = buildCover(1, t);
    // Off to one side of centre ON PURPOSE, and the hand-play is why.
    //
    // Spawned dead centre, the barrel's resting angle pointed straight up into
    // the middle block — so the first shot a new player takes, before they
    // have touched the aim, is a blocked one. The opening should ask for an
    // input they could have known to make. Nine units left of centre puts a
    // clean lane up the board and the first wave in front of it.
    this.player = {
      x: t.width / 2 - 9, y: t.height - 6,
      turret: -Math.PI / 2,
      hp: t.playerHp,
      shield: true,
      shieldTimer: 0,
      reload: 0,
    };
    this.enemies = [];
    this.spawnWave();
    this.wavesCleared = 0;
    this.shotsFired = 0;
    this.bankHits = 0;
    this.directHits = 0;
    this.deflections = 0;
    this.sightings = 0;
  }

  spawnWave() {
    const t = this.t;
    const roster = waveRoster(this.wave, t);
    this.enemies = roster.map((kind, i) => {
      const across = (i + 1) / (roster.length + 1);
      const x = t.wallThickness + 3 + across * (t.width - 2 * t.wallThickness - 6);
      const y = t.wallThickness + 3 + (i % 2) * 3;
      return {
        id: nextId++,
        kind,
        x,
        y,
        hp: (kind === KIND.SNIPER ? 4 : 1) + Math.floor((this.wave - 1) * t.enemyHpPerWave),
        reload: t.enemyReload * (0.4 + (i % 5) * 0.2),
        vx: 0, vy: 0,
        // Where it holds while it has not seen anybody, and how far round that
        // post it wanders.
        postX: x,
        postY: y,
        state: STATE.HOLDING,
        alert: 0,
        patrol: (i % 4) * (Math.PI / 2),
      };
    });
    this.cover = buildCover(this.wave, t);
  }

  #hurtPlayer() {
    const p = this.player;
    if (p.shield) {
      p.shield = false;
      p.shieldTimer = this.t.shieldRecharge;
      return;
    }
    p.hp--;
    p.shieldTimer = this.t.shieldRecharge;
    if (p.hp <= 0) {
      p.hp = 0;
      this.running = false;
      this.reason = END.DESTROYED;
    }
  }

  /** Fire from a tank. Returns the shell, or null if it is still reloading. */
  fire(from, angle, friendly) {
    const t = this.t;
    const speed = friendly ? t.shellSpeed : t.enemyShellSpeed;
    const shell = {
      x: from.x + Math.cos(angle) * (t.tankRadius + t.shellRadius + 0.05),
      y: from.y + Math.sin(angle) * (t.tankRadius + t.shellRadius + 0.05),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      friendly,
      bounces: 0,
      life: t.shellLife,
    };
    this.shells.push(shell);
    if (friendly) this.shotsFired++;
    return shell;
  }

  #moveShell(shell, dt) {
    const t = this.t;
    const b = bounds(t);
    const r = t.shellRadius;
    let remaining = dt;

    // Substepped, because a shell moving 30 units a second can cross a metre
    // of cover between frames, and a shot that passes through a block is
    // exactly the kind of thing that makes a ricochet feel arbitrary.
    while (remaining > 1e-6 && shell.life > 0) {
      const speed = Math.hypot(shell.vx, shell.vy);
      const step = Math.min(remaining, (r * 0.9) / Math.max(speed, 1e-6));
      const nx = shell.x + shell.vx * step;
      const ny = shell.y + shell.vy * step;

      // Cover first: it stops the shell and takes a hit.
      const dir = { x: shell.vx / speed, y: shell.vy / speed };
      const blocked = firstCoverHit({ x: shell.x, y: shell.y }, dir, speed * step, this.cover, t);
      if (blocked) {
        blocked.block.hp--;
        shell.life = 0;
        return;
      }

      shell.x = nx;
      shell.y = ny;
      if (shell.x < b.left + r) { shell.x = b.left + r; shell.vx = -shell.vx; shell.bounces++; }
      if (shell.x > b.right - r) { shell.x = b.right - r; shell.vx = -shell.vx; shell.bounces++; }
      if (shell.y < b.top + r) { shell.y = b.top + r; shell.vy = -shell.vy; shell.bounces++; }
      if (shell.y > b.bottom - r) { shell.y = b.bottom - r; shell.vy = -shell.vy; shell.bounces++; }
      if (shell.bounces > t.maxBounces) shell.life = 0;

      shell.life -= step;
      remaining -= step;
    }
  }

  /**
   * One frame.
   *
   * `input` is { x, y, aim, fire } — a movement vector, an absolute turret
   * angle, and whether the trigger is down. game.js turns a stick, a keyboard
   * or a thumb into exactly that and nothing else, so every device is playing
   * the same game.
   */
  step(dt, input) {
    if (!this.running) return;
    const t = this.t;
    this.time += dt;
    const p = this.player;
    const b = bounds(t);

    // --- The player ---
    const move = Math.hypot(input.x ?? 0, input.y ?? 0);
    if (move > 0.15) {
      const scale = Math.min(1, move) / move;
      p.x += (input.x * scale) * t.moveSpeed * dt;
      p.y += (input.y * scale) * t.moveSpeed * dt;
    }
    p.x = Math.max(b.left + t.tankRadius, Math.min(b.right - t.tankRadius, p.x));
    p.y = Math.max(b.top + t.tankRadius, Math.min(b.bottom - t.tankRadius, p.y));
    for (const block of this.cover) {
      if (block.hp <= 0) continue;
      pushOutOfBlock(p, block, t.tankRadius);
    }

    if (typeof input.aim === 'number') p.turret = input.aim;

    p.reload = Math.max(0, p.reload - dt);
    if (input.fire && p.reload === 0) {
      this.fire(p, p.turret, true);
      p.reload = t.reloadSeconds;
    }

    if (!p.shield) {
      p.shieldTimer -= dt;
      if (p.shieldTimer <= 0) { p.shield = true; p.shieldTimer = 0; }
    }

    // --- Enemies ---
    for (const e of this.enemies) {
      this.#stepEnemy(e, dt);
    }

    // --- Shells ---
    for (const shell of this.shells) {
      this.#moveShell(shell, dt);
      if (shell.life <= 0) continue;

      if (shell.friendly) {
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - shell.x, e.y - shell.y) > t.enemyRadius + t.shellRadius) continue;
          if (!canHurt(e, shell, t)) {
            // A direct shot at a dug-in tank sparks off the plate. It still
            // stops the shell, so spraying at one is a real cost.
            shell.life = 0;
            this.deflections++;
            break;
          }
          e.hp -= damageOf(shell, t);
          shell.life = 0;
          if (shell.bounces > 0) this.bankHits++; else this.directHits++;
          break;
        }
      } else if (Math.hypot(p.x - shell.x, p.y - shell.y) <= t.tankRadius + t.shellRadius) {
        shell.life = 0;
        this.#hurtPlayer();
      }
    }

    this.shells = this.shells.filter((s) => s.life > 0);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    this.cover = this.cover.filter((c) => c.hp > 0);

    if (this.running && this.enemies.length === 0) {
      this.wavesCleared++;
      this.wave++;
      this.spawnWave();
      // A breath between waves, and the shield back, so a new wave never opens
      // on a player who has nothing left to survive the first second with.
      this.shells = [];
      p.shield = true;
      p.shieldTimer = 0;
    }
  }

  #stepEnemy(e, dt) {
    const t = this.t;
    const p = this.player;
    const b = bounds(t);
    const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
    const distance = Math.hypot(p.x - e.x, p.y - e.y);
    const clearLine = hasLineOfSight(e, p, this.cover, t);
    const canSee = clearLine && distance <= t.sightRange;

    // --- What it is doing about you ---
    if (e.state === STATE.HOLDING) {
      if (canSee) {
        e.state = STATE.ALERTED;
        e.alert = t.alertSeconds;
        this.sightings++;
      } else {
        // A slow circle round its post. Not a hunt — a patrol you can watch
        // and time, which is what makes approaching one a plan.
        e.patrol += dt * 0.7;
        const px = e.postX + Math.cos(e.patrol) * t.patrolRadius;
        const py = e.postY + Math.sin(e.patrol) * t.patrolRadius;
        const toPost = Math.atan2(py - e.y, px - e.x);
        if (e.kind !== KIND.SNIPER) {
          e.x += Math.cos(toPost) * t.patrolSpeed * dt;
          e.y += Math.sin(toPost) * t.patrolSpeed * dt;
          e.x = Math.max(b.left + t.enemyRadius, Math.min(b.right - t.enemyRadius, e.x));
          e.y = Math.max(b.top + t.enemyRadius, Math.min(b.bottom - t.enemyRadius, e.y));
          for (const block of this.cover) {
            if (block.hp <= 0) continue;
            pushOutOfBlock(e, block, t.enemyRadius);
          }
        }
        e.reload = Math.max(e.reload, t.enemyReload * 0.5);
        return;
      }
    }

    if (e.state === STATE.ALERTED) {
      e.alert -= dt;
      // Break the sightline in time and it settles back down. This is the
      // whole reason the alerted state is a second long rather than instant.
      if (!canSee) { e.state = STATE.HOLDING; e.alert = 0; return; }
      if (e.alert > 0) return;
      e.state = STATE.ENGAGED;
    }

    // Once engaged, it stays engaged. A tank that forgets you the moment you
    // duck is a tank you farm from one corner.
    const sees = clearLine;

    // Snipers hold position. Everything else closes, but stops short so the
    // arena does not turn into a scrum with no room to aim.
    //
    // AND THEY WORK AROUND COVER. Without the strafe the arena deadlocked: the
    // last enemy of a wave would settle behind a block where it could not see
    // the player and the player could not see it, neither would move, and the
    // battle simply stopped — forever, or until the harness cap. A wave that
    // cannot end is worse than a wave that is too hard.
    if (e.kind !== KIND.SNIPER) {
      const want = e.kind === KIND.BOUNCER ? 18 : 9;
      const drive = distance > want ? 1 : -0.5;
      // Which way round the block to go is decided once per enemy and kept,
      // so two of them do not mirror each other into a stalemate of their own.
      const side = (e.id % 2) ? 1 : -1;
      const strafe = sees ? 0 : side * 0.9;
      e.x += (Math.cos(toPlayer) * drive - Math.sin(toPlayer) * strafe) * t.enemySpeed * dt;
      e.y += (Math.sin(toPlayer) * drive + Math.cos(toPlayer) * strafe) * t.enemySpeed * dt;
      e.x = Math.max(b.left + t.enemyRadius, Math.min(b.right - t.enemyRadius, e.x));
      e.y = Math.max(b.top + t.enemyRadius, Math.min(b.bottom - t.enemyRadius, e.y));
      for (const block of this.cover) {
        if (block.hp <= 0) continue;
        pushOutOfBlock(e, block, t.enemyRadius);
      }
    }

    e.reload -= dt;
    if (e.reload > 0) return;

    // A bouncer looks for a bank when it cannot see you, which is what stops
    // cover being a place to park. Everything else needs line of sight.
    let angle = null;
    if (sees) {
      angle = toPlayer + (Math.random() * 2 - 1) * t.enemyAimError;
    } else if (e.kind === KIND.BOUNCER) {
      const solutions = bankSolutions(e, p, this.cover, t);
      if (solutions.length) angle = solutions[(Math.random() * solutions.length) | 0].angle;
    } else {
      // No shot and no bounce: chip at whatever is in the way. Cover is
      // destructible, so a blocked enemy has something to do about it, and a
      // player who parks behind a block watches it come apart.
      const dir = { x: Math.cos(toPlayer), y: Math.sin(toPlayer) };
      if (firstCoverHit(e, dir, distance, this.cover, t)) angle = toPlayer;
    }
    if (angle === null) return;

    this.fire(e, angle, false);
    e.reload = t.enemyReload * (e.kind === KIND.SNIPER ? 1.5 : 1);
  }

  /** Waves fully cleared — the score. */
  get score() { return this.wavesCleared; }
}

/** Slide a circle out of an axis-aligned block, along the shallowest axis. */
export function pushOutOfBlock(body, block, radius) {
  const halfW = block.w / 2 + radius;
  const halfH = block.h / 2 + radius;
  const dx = body.x - block.x;
  const dy = body.y - block.y;
  if (Math.abs(dx) >= halfW || Math.abs(dy) >= halfH) return false;
  const overlapX = halfW - Math.abs(dx);
  const overlapY = halfH - Math.abs(dy);
  if (overlapX < overlapY) body.x += Math.sign(dx || 1) * overlapX;
  else body.y += Math.sign(dy || 1) * overlapY;
  return true;
}
