/**
 * mulberry32 — a tiny, fast, deterministic PRNG (zero dependencies).
 * Same seed always produces the same sequence, which is what makes mock chat
 * reproducible in tests and in recorded demos.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Integer in [min, max] inclusive. */
  between(min: number, max: number): number;
  /** Picks one element; throws only if the array is empty. */
  pick<T>(items: readonly T[]): T;
  /** True with the given probability (0..1). */
  chance(probability: number): boolean;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number =>
    maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    between: (min, max) => min + int(max - min + 1),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('mulberry32: cannot pick from an empty list');
      // Safe: index is within bounds and the list is non-empty.
      return items[int(items.length)] as T;
    },
    chance: (probability) => next() < probability,
  };
}
