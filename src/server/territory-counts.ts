// Lightweight Atlas telemetry (brief D slice F1): how often the territory loop is used, counted in memory and said in the
// server's periodic `status` log line (the repo's only telemetry channel), then reset. No identities, no storage, no network.
export const TERRITORY_COUNTS = [
  'revealed', 'pinned', 'unpinned', 'surgeSpent', 'surgeKept', 'sandUsed', 'grandUsed', 'sigilSlotted', 'sigilUnslotted',
] as const;
export type TerritoryCount = (typeof TERRITORY_COUNTS)[number];

export class TerritoryCounts {
  private readonly counts = new Map<TerritoryCount, number>();

  add(kind: TerritoryCount, n = 1): void {
    if (!(n > 0)) return;
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + Math.floor(n));
  }

  /** The counts since the last drain (only the non-zero ones, in a fixed order), then zero; undefined when nothing happened. */
  drain(): Partial<Record<TerritoryCount, number>> | undefined {
    if (!this.counts.size) return undefined;
    const out: Partial<Record<TerritoryCount, number>> = {};
    for (const k of TERRITORY_COUNTS) {
      const v = this.counts.get(k);
      if (v) out[k] = v;
    }
    this.counts.clear();
    return out;
  }
}
