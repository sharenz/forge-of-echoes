// Small in-memory rate limiters (single process; state is lost on restart, which is fine for abuse control).

/** Token bucket: `capacity` burst, refilled at `perSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Take one token; false when the bucket is empty. */
  take(now: number, cost = 1): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

interface WindowEntry {
  /** Hit timestamps (ms) inside the window, oldest first. */
  hits: number[];
}

/**
 * Sliding-window counter per key: at most `limit` hits per `windowMs`. `check` does not count; `hit`
 * records one. Old keys are swept lazily so the map cannot grow without bound.
 */
export class WindowLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  private prune(entry: WindowEntry, now: number): void {
    const cutoff = now - this.windowMs;
    let k = 0;
    while (k < entry.hits.length && entry.hits[k] <= cutoff) k++;
    if (k > 0) entry.hits.splice(0, k);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, entry] of this.entries) {
      this.prune(entry, now);
      if (entry.hits.length === 0) this.entries.delete(key);
    }
  }

  /** Milliseconds until `key` may act again (0 = allowed now). */
  retryAfter(key: string, now: number): number {
    this.sweep(now);
    const entry = this.entries.get(key);
    if (!entry) return 0;
    this.prune(entry, now);
    if (entry.hits.length < this.limit) return 0;
    return Math.max(1, entry.hits[0] + this.windowMs - now);
  }

  hit(key: string, now: number): void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { hits: [] };
      this.entries.set(key, entry);
    }
    this.prune(entry, now);
    entry.hits.push(now);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

/** "3 minutes" / "40 seconds" for player-facing retry messages. */
export function describeWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}
