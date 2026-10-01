// Slice G1 economy (brief D 7.3, 15.3 and 12 item 11): what the daily surge is worth. The kill-stream bot of the Atlas tree harness plays the
// real map and loot rules twice per seed (same seeds, same rng streams): once normally, once with the surge frozen into the setup, and values
// every drop in Scrap. The spec accepts about +18-24% blended income for a player who rotates the chart and lists data-only levers to TRIM it
// (SURGE_BONUS +25% quantity / +12% rarity, SURGE_CHARGES 2). Measured with the spec's numbers: +8 to +14% per boosted run (mean +10%), because the
// surge touches only ordinary kill drops (boss and chest guarantees, events and maps are exempt by rule) - below the accepted band, so no trim is
// needed; the guard bands below pin the measured figure and fail on a runaway. BALANCE=1 prints the table:
//   BALANCE=1 npx vitest run tests/game-progression/surge-economy.test.ts
import { describe, expect, it } from 'vitest';
import { GRAND_HOURGLASS, HOURGLASS_SAND, SURGE_BONUS, SURGE_CHARGES } from '../../src/data/progression/territory';
import { CURRENCY_VALUE, measure, valueOf } from './atlas-tree-harness';
import { rules } from '../../src/game';
import { createRng } from '../../src/core/rng';
import { bareCharacter, expectOk } from './fixtures';
import { standardMap } from './atlas-tree-harness';
import { openAt } from './fixtures';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const CELLS: readonly { tier: number; area: Parameters<typeof openAt>[2] }[] = [
  { tier: 3, area: 'emberRoad' }, { tier: 7, area: 'shatteredForge' }, { tier: 11, area: 'emberCitadel' }, { tier: 15, area: 'heartOfForge' },
];
const report = !!process.env.BALANCE;

/** Run value per map in Scrap, normal and boosted, for the same seeds. The Sand/Grand drops are excluded here: they are priced separately below. */
function lift(tier: number, area: Parameters<typeof openAt>[2]) {
  const keep = { sand: CURRENCY_VALUE.hourglassSand, grand: CURRENCY_VALUE.grandHourglass };
  CURRENCY_VALUE.hourglassSand = 0; CURRENCY_VALUE.grandHourglass = 0;
  try {
    const normal = measure([], tier, area, SEEDS);
    const boosted = measure([], tier, area, SEEDS, false, true);
    return { normal, boosted, ratio: boosted.valuePerMap / normal.valuePerMap, gain: boosted.valuePerMap - normal.valuePerMap };
  } finally {
    CURRENCY_VALUE.hourglassSand = keep.sand; CURRENCY_VALUE.grandHourglass = keep.grand;
  }
}

describe('what a spent charge is worth', () => {
  it('lifts a boosted run by about a tenth at every tier (measured +8 to +14%; the spec would accept up to +24%)', () => {
    const rows = CELLS.map((c) => ({ ...c, ...lift(c.tier, c.area) }));
    for (const r of rows) {
      expect(r.ratio, `T${r.tier} ${r.area}`).toBeGreaterThan(1.05);
      expect(r.ratio, `T${r.tier} ${r.area}`).toBeLessThan(1.24);
    }
    if (report) console.log(['tier area               normal  boosted  lift'].concat(rows.map((r) => `T${String(r.tier).padEnd(3)} ${r.area.padEnd(18)} ${r.normal.valuePerMap.toFixed(1).padStart(6)} ${r.boosted.valuePerMap.toFixed(1).padStart(8)} ${((r.ratio - 1) * 100).toFixed(1).padStart(5)}%`)).join('\n'));
  });

  it('never changes how many maps a run drops, only their addressee stays as it was', () => {
    // I1: the maps of a boosted run equal the maps of a normal run in expectation (the drop streams drift because currency draws more).
    let normal = 0, boosted = 0;
    for (const seed of SEEDS) {
      for (const [flag, add] of [[false, (n: number) => { normal += n; }], [true, (n: number) => { boosted += n; }]] as const) {
        const ch = bareCharacter({ mapDevice: standardMap(7), currencyStash: { scrap: 99 }, rngState: seed * 977 });
        const setup = expectOk(openAt(rules, ch, 'shatteredForge', 'wand')).setup;
        const live = flag ? { ...setup, surge: { areaId: 'shatteredForge' as const, ...SURGE_BONUS, day: 0 } } : setup;
        let maps = 0;
        const rng = createRng(seed);
        for (let i = 0; i < 1200; i++) maps += rules.rollKillLoot(live, { kind: 'ashling', summoned: false, rarity: 'normal', isLieutenant: false, isBoss: false, wave: 1, x: 0, y: 0 }, rng.fork(i + 1), ch).filter((x) => x.kind === 'map').length;
        add(maps);
      }
    }
    expect(Math.abs(boosted - normal)).toBeLessThan(5 * Math.sqrt(normal));
  });
});

describe('blended income for the two kinds of player (D 7.3)', () => {
  const RUNS_PER_DAY = 20; // about 5 runs an hour for 4 hours
  it('a rotating player boosts nearly every run, a focus farmer about a seventh of them', () => {
    const ratios = CELLS.map((c) => lift(c.tier, c.area).ratio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const rotating = 1 + (mean - 1) * (Math.min(RUNS_PER_DAY, 25 * SURGE_CHARGES) / RUNS_PER_DAY);
    const focus = 1 + (mean - 1) * (SURGE_CHARGES / RUNS_PER_DAY);
    expect(rotating).toBeGreaterThan(1.05);
    expect(rotating).toBeLessThan(1.24);
    expect(focus).toBeGreaterThan(1.005);
    expect(focus).toBeLessThan(1.05);
    if (report) console.log(`blended: rotating player +${((rotating - 1) * 100).toFixed(1)}%, focus farmer +${((focus - 1) * 100).toFixed(1)}% (mean per boosted run +${((mean - 1) * 100).toFixed(1)}%)`);
  });

  it('prices Sand by what it buys: three boosted runs of one area; its drop rate adds a few percent for a player who spends it', () => {
    // Value of one Sand = 3 boosted runs' gain; sources per run: boss (T3+), chest, Gold events (about one in ten runs reaches Gold).
    const cells = CELLS.map((c) => ({ ...c, ...lift(c.tier, c.area) }));
    const rows = cells.map((c) => {
      const sandPerRun = HOURGLASS_SAND.bossChance * 1.1 + HOURGLASS_SAND.chestChance + HOURGLASS_SAND.goldEventChance * 0.1;
      const grandPerRun = c.tier >= GRAND_HOURGLASS.bossMinTier ? GRAND_HOURGLASS.bossChance : 0;
      const sandValue = 3 * c.gain;
      const adjusted = (sandPerRun * sandValue + grandPerRun * 25 * 3 * c.gain * 0.5) / c.normal.valuePerMap;
      return { tier: c.tier, sandPerRun, adjusted };
    });
    for (const r of rows) {
      expect(r.sandPerRun, `T${r.tier}`).toBeGreaterThan(0.05);
      expect(r.sandPerRun, `T${r.tier}`).toBeLessThan(0.14);
      expect(r.adjusted, `T${r.tier}`).toBeLessThan(0.05); // measured 3.0 to 3.9% of a run: the spec's placeholder target is +3%, see the report
    }
    if (report) console.log(rows.map((r) => `T${r.tier}: Sand per run ${(r.sandPerRun * 100).toFixed(1)}%, Sand-adjusted value ${(r.adjusted * 100).toFixed(1)}% of a run`).join('\n'));
    expect(valueOf({ kind: 'currency', uid: 'x', currencyId: 'hourglassSand', count: 1 })).toBeGreaterThan(0);
  });
});
