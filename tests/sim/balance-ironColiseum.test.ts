// Balance signal for the ironColiseum roster: see ./balance.ts.
import { describe, expect, it } from 'vitest';
import { BALANCE_MIN_CLEARS, BALANCE_SEEDS, sweepTheme } from './balance';

describe('ironColiseum balance (fair bot, tier 5, seeds 1–12)', () => {
  it(`clears at least ${BALANCE_MIN_CLEARS} of ${BALANCE_SEEDS.length} maps, never gets stuck, and every charge stays in its lane`, () => {
    const r = sweepTheme('ironColiseum');
    console.info(r.summary);
    expect(r.timeouts, r.summary).toEqual([]);
    expect(r.offLane, r.summary).toBe(0);
    expect(r.cleared, r.summary).toBeGreaterThanOrEqual(BALANCE_MIN_CLEARS);
  }, 240_000);
});
