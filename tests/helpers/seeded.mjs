// tests/helpers/seeded.mjs
//
// Determinism and distribution helpers shared by the bot harnesses.
//
// Several rule modules reach for Math.random — city generation, piece bags,
// problem sets. A before/after comparison that lets them run free is comparing
// two different worlds and averaging the difference away. Seeding means both
// sides play the same cities, draw the same pieces, and get the same coin
// flips, so a change of a few percent is visible instead of drowned.

const REAL_RANDOM = Math.random;

/**
 * Replaces Math.random with a seeded generator and returns the restore
 * function. Always restore — a leaked generator makes every later test in the
 * same process deterministic in a way nobody asked for.
 *
 * A small LCG rather than anything cryptographic: this needs to be repeatable
 * and cheap, not unpredictable.
 */
export function seedRandom(seed) {
  let s = (seed * 2654435761) >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return () => { Math.random = REAL_RANDOM; };
}

/** Runs `fn` with Math.random seeded, and restores it even if fn throws. */
export function withSeed(seed, fn) {
  const restore = seedRandom(seed);
  try {
    return fn();
  } finally {
    restore();
  }
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function mean(values) {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

/** Median, mean, tails and best, which is what every bot report wants. */
export function summarise(values) {
  return {
    min: Math.min(...values),
    p10: percentile(values, 0.10),
    median: percentile(values, 0.50),
    p90: percentile(values, 0.90),
    max: Math.max(...values),
    mean: +mean(values).toFixed(1),
  };
}
