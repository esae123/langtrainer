// Deterministic randomness. Everything in the engine takes an Rng so plans and
// shuffles can be reproduced in tests (and re-derived from a persisted seed).

export type Rng = () => number;

/** Small, fast, well-distributed PRNG; same seed always yields the same stream. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash, used to seed per-exercise shuffles from string ids. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Picks one entry with probability proportional to its weight; ignores non-positive weights. */
export function pickWeighted<T>(entries: { item: T; weight: number }[], rng: Rng): T | undefined {
  const positive = entries.filter((e) => e.weight > 0);
  const total = positive.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return undefined;
  let threshold = rng() * total;
  for (const entry of positive) {
    threshold -= entry.weight;
    if (threshold < 0) return entry.item;
  }
  return positive[positive.length - 1].item;
}
