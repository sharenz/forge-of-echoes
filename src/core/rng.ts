import type { Rng } from '../contracts/rng';

/** Mix a u32 (splitmix-style finalizer) so nearby seeds give unrelated streams. */
export function hashU32(x: number): number {
  x = (x ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Hash a string to a u32 (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). `createRng(rng.state())` resumes the same sequence. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick on empty array');
      return items[Math.floor(next() * items.length)];
    },
    weighted(items, weight) {
      let total = 0;
      for (const it of items) {
        const w = weight(it);
        if (w > 0) total += w;
      }
      if (total <= 0) return undefined;
      let r = next() * total;
      for (const it of items) {
        const w = weight(it);
        if (w <= 0) continue;
        r -= w;
        if (r < 0) return it;
      }
      // floating point fallthrough: last positive-weight item
      for (let i = items.length - 1; i >= 0; i--) if (weight(items[i]) > 0) return items[i];
      return undefined;
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    state() {
      return s >>> 0;
    },
    fork(salt) {
      return createRng(hashU32((s ^ hashU32(salt >>> 0)) >>> 0));
    },
  };
  return rng;
}
