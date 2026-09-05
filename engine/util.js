// engine/util.js
//
// Shared helpers every Studio 22 game reaches for: math, collision, easing,
// particles, timers, and color.
//
// Two conventions run through the whole file:
//
//   1. Collision and math helpers take plain numbers, never objects. A game
//      checking a hundred pairs per frame shouldn't be allocating a hundred
//      throwaway { x, y, w, h } literals to do it -- that's garbage the
//      collector has to sweep mid-frame, which is exactly where a dropped
//      frame on a mid-range phone comes from.
//
//   2. Anything time-based takes dt in seconds and behaves identically at
//      any frame rate, matching the fixed timestep in loop.js.
//
// Colors are never defined here. Functions that need one take it from the
// caller, so the palette stays in styles/tokens.css and nowhere else.

// --- Math ---------------------------------------------------------------

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

// Linear interpolation. t is normally 0..1 but isn't clamped, because
// extrapolating slightly past either end is genuinely useful (overshoot on
// a camera, a value that keeps easing past its target).
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Re-ranges a value from one span to another. Deliberately unclamped -- wrap
// it in clamp() when you need the output pinned.
export function map(value, inMin, inMax, outMin, outMax) {
  // A zero-width input range has no meaningful answer; return the low end
  // rather than dividing by zero and poisoning everything downstream.
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

// Random float in [min, max).
export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// Random integer, INCLUSIVE of both ends -- randInt(1, 6) really does roll
// a six. The exclusive-max version is the more common source of off-by-one
// bugs, so this file picks the one that reads the way people say it.
export function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Random element, or undefined for an empty array (never throws).
export function randPick(array) {
  if (!array || array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

// Fisher-Yates on a COPY. Returns a new array and leaves the caller's alone,
// because a shuffled-in-place source array is a nasty surprise when it was
// also the canonical list of something.
export function shuffle(array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

// Radians from point 1 to point 2, matching canvas convention (+y is down,
// so a positive angle rotates clockwise on screen).
export function angleTo(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

// --- Collision ----------------------------------------------------------

// Circle vs circle. Compares squared distances so there's no square root in
// the hot path -- this gets called a lot.
export function circleHit(x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const radii = r1 + r2;
  return dx * dx + dy * dy < radii * radii;
}

// Axis-aligned rectangle overlap. Rectangles are x/y (top-left) plus w/h.
export function rectHit(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

// Circle vs axis-aligned rectangle. Works by finding the point on the rect
// closest to the circle's center and asking whether that point is inside the
// circle -- which handles edges and corners correctly, unlike the common
// shortcut of testing the center against an inflated rectangle.
export function circleRectHit(cx, cy, cr, rx, ry, rw, rh) {
  const nearestX = clamp(cx, rx, rx + rw);
  const nearestY = clamp(cy, ry, ry + rh);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < cr * cr;
}

// --- Easing -------------------------------------------------------------
//
// Every function maps t in 0..1 to an eased 0..1. "In" starts slow, "Out"
// ends slow, "InOut" does both. Use them for menu slides, score counters,
// squash-and-stretch -- anything that should feel like it has weight.

export const Ease = {
  linear: (t) => t,

  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),

  cubicIn: (t) => t * t * t,
  cubicOut: (t) => 1 - (1 - t) ** 3,
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2),

  // Elastic overshoots and wobbles back, like a released spring. The magic
  // constants are the standard Penner values; they're tuned by ear, not
  // derived, which is why they look arbitrary.
  elasticIn: (t) => {
    if (t === 0 || t === 1) return t;
    return -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
  },
  elasticOut: (t) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  elasticInOut: (t) => {
    if (t === 0 || t === 1) return t;
    const c5 = (2 * Math.PI) / 4.5;
    return t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },

  bounceOut: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  bounceIn: (t) => 1 - Ease.bounceOut(1 - t),
  bounceInOut: (t) => (t < 0.5
    ? (1 - Ease.bounceOut(1 - 2 * t)) / 2
    : (1 + Ease.bounceOut(2 * t - 1)) / 2),
};

// --- Color --------------------------------------------------------------

// Parses '#rgb' or '#rrggbb' into [r, g, b]. Returns null for anything else
// (a CSS keyword, an rgb() string) rather than throwing, so a caller that
// passes something unexpected degrades instead of crashing mid-frame.
function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let value = hex.trim().replace('#', '');
  // Expand the '#abc' shorthand to '#aabbcc'.
  if (value.length === 3) {
    value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
  }
  if (value.length !== 6) return null;
  const num = Number.parseInt(value, 16);
  if (Number.isNaN(num)) return null;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function hexToRgba(hex, alpha = 1) {
  const rgb = parseHex(hex);
  if (!rgb) return hex; // hand back whatever came in; canvas may still take it
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// amount is 0..1 -- lighten(c, 0.2) moves the color 20% toward white.
export function lighten(hex, amount) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const t = clamp(amount, 0, 1);
  return `rgb(${rgb.map((c) => Math.round(lerp(c, 255, t))).join(', ')})`;
}

export function darken(hex, amount) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const t = clamp(amount, 0, 1);
  return `rgb(${rgb.map((c) => Math.round(lerp(c, 0, t))).join(', ')})`;
}

// Blends two hex colors. t=0 is `from`, t=1 is `to`.
export function lerpColor(from, to, t) {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(lerp(a[0], b[0], k))}, ${Math.round(lerp(a[1], b[1], k))}, ${Math.round(lerp(a[2], b[2], k))})`;
}

// --- Timer --------------------------------------------------------------

/**
 * Cooldowns and delays, in seconds, driven by the fixed timestep.
 *
 *   const shotCooldown = new Timer(0.25, { repeat: true });
 *   if (shotCooldown.update(dt)) fire();
 */
export class Timer {
  #duration;
  #elapsed = 0;
  #running;
  #repeat;

  constructor(duration, { repeat = false, autoStart = true } = {}) {
    this.#duration = duration;
    this.#repeat = repeat;
    this.#running = autoStart;
  }

  // Advances the clock. Returns true on the frame it completes -- and for a
  // repeating timer, rolls the leftover time into the next cycle rather than
  // resetting to zero, so a 0.25s cooldown really does fire four times a
  // second instead of drifting slower by up to one frame each cycle.
  update(dt) {
    if (!this.#running) return false;

    this.#elapsed += dt;
    // Epsilon, because accumulating dt in floating point lands just under the
    // target: fifteen steps of 1/60 sums to 0.24999999999999997, not 0.25, so
    // a quarter-second cooldown would take sixteen frames on its first cycle
    // and fifteen on every one after. A nanosecond is far below any real
    // frame time, so it can never let a cycle through early.
    if (this.#elapsed + 1e-9 < this.#duration) return false;

    if (this.#repeat) {
      this.#elapsed -= this.#duration;
    } else {
      this.#elapsed = this.#duration;
      this.#running = false;
    }
    return true;
  }

  reset() {
    this.#elapsed = 0;
    this.#running = true;
  }

  stop() {
    this.#running = false;
  }

  start() {
    this.#running = true;
  }

  get isRunning() {
    return this.#running;
  }

  // 0..1 through the current cycle -- feed it straight into an Ease function.
  get progress() {
    return this.#duration <= 0 ? 1 : clamp(this.#elapsed / this.#duration, 0, 1);
  }

  get remaining() {
    return Math.max(0, this.#duration - this.#elapsed);
  }
}

// --- Particles ----------------------------------------------------------

// Shape and physics only -- no colors, because the palette lives in
// tokens.css. Pass a `colors` array of resolved token values when emitting.
export const ParticlePresets = {
  // A hit, a death, a block breaking: fast outward burst that falls.
  explosion: {
    count: 24,
    speed: [90, 280],
    life: [0.35, 0.8],
    size: [3, 7],
    gravity: 420,
    drag: 0.6,
    spread: Math.PI * 2,
    shape: 'circle',
    shrink: true,
  },
  // Something moving leaves this behind: slow, driftless, fades in place.
  trail: {
    count: 3,
    speed: [5, 30],
    life: [0.2, 0.45],
    size: [2, 5],
    gravity: 0,
    drag: 0.2,
    spread: Math.PI * 2,
    shape: 'square',
    shrink: true,
  },
  // Pickups and celebrations: drifts upward, lingers, doesn't shrink.
  sparkle: {
    count: 12,
    speed: [20, 90],
    life: [0.5, 1.1],
    size: [2, 4],
    gravity: -60,
    drag: 0.9,
    spread: Math.PI * 2,
    shape: 'square',
    shrink: false,
  },
};

const PARTICLE_DEFAULTS = {
  count: 10,
  speed: [40, 120],
  life: [0.3, 0.7],
  size: [2, 6],
  gravity: 0,
  drag: 0,
  angle: 0,          // base direction in radians
  spread: Math.PI * 2, // cone width around `angle`
  shape: 'circle',
  shrink: true,
  colors: ['white'],   // caller should pass token-derived colors
};

/**
 * Object-pooled particle system.
 *
 * CLAUDE.md requires pooling anything spawned in a loop, and particles are
 * the worst offender: an explosion is dozens of short-lived objects, several
 * times a second. Allocating them fresh means the garbage collector runs
 * mid-gameplay, which on a mid-range phone is a visible hitch.
 *
 * So every particle is allocated once, up front, and reused forever. Live
 * particles are kept packed at the front of the array and a dead one is
 * swapped with the last live one, which keeps the update loop over a
 * contiguous run with no holes to skip and no allocation at all after
 * construction.
 */
export class ParticleSystem {
  #pool;
  #activeCount = 0;

  constructor({ max = 300 } = {}) {
    // Pre-allocate the whole pool. Fields are set to zero rather than left
    // undefined so the objects keep one hidden shape for the JIT.
    this.#pool = new Array(max);
    for (let i = 0; i < max; i++) {
      this.#pool[i] = {
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1,
        size: 1, startSize: 1,
        gravity: 0, drag: 0,
        color: 'white', shape: 'circle', shrink: true,
      };
    }
  }

  get activeCount() {
    return this.#activeCount;
  }

  get capacity() {
    return this.#pool.length;
  }

  /**
   * Spawns particles at (x, y). `options` overrides PARTICLE_DEFAULTS -- pass
   * a preset spread in, e.g. { ...ParticlePresets.explosion, colors }.
   *
   * When the pool is full the extra particles are simply dropped. Dropping is
   * the right failure: recycling the oldest live particle would make existing
   * effects visibly pop out of existence, and growing the pool would
   * reintroduce the allocation this class exists to avoid.
   */
  emit(x, y, options = {}) {
    const config = { ...PARTICLE_DEFAULTS, ...options };
    const colors = config.colors && config.colors.length ? config.colors : PARTICLE_DEFAULTS.colors;

    for (let i = 0; i < config.count; i++) {
      if (this.#activeCount >= this.#pool.length) return; // pool exhausted

      const p = this.#pool[this.#activeCount];
      this.#activeCount++;

      const angle = config.angle + randRange(-config.spread / 2, config.spread / 2);
      const speed = randRange(config.speed[0], config.speed[1]);
      const life = randRange(config.life[0], config.life[1]);
      const size = randRange(config.size[0], config.size[1]);

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = life;
      p.maxLife = life;
      p.size = size;
      p.startSize = size;
      p.gravity = config.gravity;
      p.drag = config.drag;
      p.shape = config.shape;
      p.shrink = config.shrink;
      p.color = randPick(colors);
    }
  }

  // Convenience wrappers so a game doesn't have to spread the preset itself.
  explosion(x, y, options = {}) {
    this.emit(x, y, { ...ParticlePresets.explosion, ...options });
  }

  trail(x, y, options = {}) {
    this.emit(x, y, { ...ParticlePresets.trail, ...options });
  }

  sparkle(x, y, options = {}) {
    this.emit(x, y, { ...ParticlePresets.sparkle, ...options });
  }

  update(dt) {
    for (let i = 0; i < this.#activeCount; i++) {
      const p = this.#pool[i];

      p.life -= dt;
      if (p.life <= 0) {
        // Swap-remove: move the last live particle into this slot and shrink
        // the live range. Then step back so the swapped-in particle gets its
        // turn this frame instead of being skipped.
        this.#activeCount--;
        this.#pool[i] = this.#pool[this.#activeCount];
        this.#pool[this.#activeCount] = p;
        i--;
        continue;
      }

      // Exponential damping, so drag behaves the same at any frame rate --
      // a linear `v -= v * drag * dt` would vary with step size.
      if (p.drag > 0) {
        const damp = (1 - p.drag) ** dt;
        p.vx *= damp;
        p.vy *= damp;
      }

      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.shrink) p.size = p.startSize * (p.life / p.maxLife);
    }
  }

  draw(ctx) {
    // globalAlpha is saved once around the whole batch rather than per
    // particle -- each save/restore pair is real work when there are
    // hundreds of them.
    ctx.save();
    for (let i = 0; i < this.#activeCount; i++) {
      const p = this.#pool[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;

      if (p.shape === 'square') {
        // Cheaper than a path: no arc, no fill() setup. Worth it when a
        // burst puts a couple of hundred of these on screen at once.
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Drops every live particle without deallocating anything.
  clear() {
    this.#activeCount = 0;
  }
}

// -------------------------------------------------------------------
// Usage example (not executed -- for games importing this module)
// -------------------------------------------------------------------
//
// import { ParticleSystem, Timer, Ease, clamp, circleHit } from '../../engine/util.js';
//
// const particles = new ParticleSystem({ max: 400 });
// const fireCooldown = new Timer(0.2, { repeat: true });
//
// function update(dt) {
//   if (fireCooldown.update(dt)) shoot();
//   if (circleHit(player.x, player.y, 12, enemy.x, enemy.y, 16)) {
//     particles.explosion(enemy.x, enemy.y, { colors: [accent, accent2] });
//   }
//   particles.update(dt);
// }
//
// function render() {
//   particles.draw(ctx);
//   // Ease a menu panel in over half a second:
//   panelY = lerp(-200, 40, Ease.cubicOut(introTimer.progress));
// }
