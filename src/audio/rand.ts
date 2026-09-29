/**
 * Small seeded PRNG for sound variation (pitch jitter, noise offsets, generative music).
 * Audio is presentation, so it is allowed to be non-deterministic, but a seedable source keeps
 * offline analysis and tests reproducible.
 */
export class Rand {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform float in [0, 1) (mulberry32). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform integer in [a, b]. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Symmetric jitter: 1 ± amount. */
  jitter(amount: number): number {
    return 1 + (this.next() * 2 - 1) * amount;
  }
}

/** A seed that differs between sessions (presentation only). */
export function sessionSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
