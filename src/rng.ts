// Deterministic pseudo-random numbers. Same seed → same simulation, so replays are reproducible.

export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for simulation noise. */
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

/** Derive an independent stream from a seed and a label (e.g. a company index). */
export function deriveSeed(seed: number, label: string | number): number {
  let h = 2166136261 ^ (seed >>> 0);
  const s = String(label);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Approximately normal noise (Irwin–Hall, 4 samples). Mean 0, sd ≈ sd. */
export function gauss(rng: Rng, sd = 1): number {
  const s = rng() + rng() + rng() + rng() - 2;
  return s * sd * 1.732;
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
