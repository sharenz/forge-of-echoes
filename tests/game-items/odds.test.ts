// The odds engine behind the Workbench previews: exact inclusion odds (checked against brute-force
// enumeration and against real rolls), tier odds, and the preview wording built from them.
import { describe, expect, it } from 'vitest';
import type { AffixKind } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { AFFIX_LIMITS, RARE_AFFIX_COUNTS, getAffix } from '../../src/data/items';
import type { AffixDef, AffixLimits } from '../../src/data/items';
import {
  craftEquipment, equipmentCraftPreview, inclusionOdds,
} from '../../src/game/items';
import type { AffixCandidate, CountChance } from '../../src/game/items';
import { equip, expectOk } from './fixtures';

function synth(id: string, kind: AffixKind, weight: number, group = id): AffixCandidate {
  const affix: AffixDef = {
    id, name: id, kind, group, tags: [], classes: ['wand'], stats: ['maxLife'], mode: 'flat',
    tiers: [{ tier: 1, itemLevel: 1, weight, min: 1, max: 2 }],
  };
  return { affix, tiers: affix.tiers, weight };
}

/** Reference: enumerate every pick sequence of the sequential weighted model. */
function bruteForce(pool: readonly AffixCandidate[], limits: AffixLimits, counts: readonly CountChance[]): Map<string, number> {
  const out = new Map(pool.map((c) => [c.affix.id, 0]));
  const total = counts.reduce((s, c) => s + c.chance, 0);
  for (const { count, chance } of counts) {
    const walk = (picked: AffixCandidate[], p: number, left: number): void => {
      const groups = new Set(picked.map((c) => c.affix.group));
      const n = (k: AffixKind) => picked.filter((c) => c.affix.kind === k).length;
      const eligible = left <= 0 ? [] : pool.filter((c) => !groups.has(c.affix.group) && n(c.affix.kind) < limits[c.affix.kind]);
      const w = eligible.reduce((s, c) => s + c.weight, 0);
      if (w <= 0) {
        for (const c of picked) out.set(c.affix.id, out.get(c.affix.id)! + p * (chance / total));
        return;
      }
      for (const c of eligible) walk([...picked, c], (p * c.weight) / w, left - 1);
    };
    walk([], 1, count);
  }
  return out;
}

function randomPool(seed: number): { pool: AffixCandidate[]; limits: AffixLimits; counts: CountChance[] } {
  const rng = createRng(seed);
  const n = rng.int(3, 8);
  const pool: AffixCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const kind: AffixKind = rng.chance(0.5) ? 'prefix' : 'suffix';
    const sameKind = pool.filter((c) => c.affix.kind === kind);
    // Sometimes join an existing same-kind group (exclusive siblings), with shared weights for classes.
    const group = sameKind.length && rng.chance(0.25) ? rng.pick(sameKind).affix.group : `g${seed}-${i}`;
    pool.push(synth(`s${seed}-${i}`, kind, rng.pick([100, 250, 400, 400]), group));
  }
  const limits = { prefix: rng.int(1, 3), suffix: rng.int(1, 3) };
  const counts = [1, 2, 3, 4].filter(() => rng.chance(0.6)).map((count) => ({ count, chance: rng.int(1, 5) }));
  return { pool, limits, counts: counts.length ? counts : [{ count: 2, chance: 1 }] };
}

describe('inclusion odds engine', () => {
  it('matches brute-force enumeration exactly, including exclusive groups and weight classes', () => {
    for (let seed = 1; seed <= 250; seed++) {
      const { pool, limits, counts } = randomPool(seed);
      const got = inclusionOdds(pool, [], limits, counts);
      expect(got.exact).toBe(true);
      const want = bruteForce(pool, limits, counts);
      for (const [id, p] of want) expect(Math.abs(got.odds.get(id)! - p), `seed ${seed} ${id}`).toBeLessThan(1e-12);
    }
  });

  it('falls back to a deterministic estimate only when a group mixes prefixes and suffixes', () => {
    const pool = [
      synth('mixA', 'prefix', 300, 'mixed'), synth('mixB', 'suffix', 200, 'mixed'),
      synth('p1', 'prefix', 400), synth('p2', 'prefix', 100), synth('s1', 'suffix', 250), synth('s2', 'suffix', 250),
    ];
    const limits = { prefix: 1, suffix: 2 };
    const counts = [{ count: 2, chance: 1 }, { count: 3, chance: 1 }];
    const est = inclusionOdds(pool, [], limits, counts);
    expect(est.exact).toBe(false);
    const want = bruteForce(pool, limits, counts);
    for (const [id, p] of want) expect(Math.abs(est.odds.get(id)! - p), id).toBeLessThan(0.015);
    // Same seed → same numbers, cache or not.
    const again = inclusionOdds([...pool], [], limits, counts.map((c) => ({ ...c })));
    expect([...again.odds]).toEqual([...est.odds]);
  });

  it('agrees with real Reforge rolls that keep sealed and fractured affixes', () => {
    const item = equip({
      baseId: 'cinderPendant', itemLevel: 70, rarity: 'rare', name: 'Ash Knell', uid: 'r',
      affixes: [{ affixId: 'life', tier: 4, sealed: true }, { affixId: 'critChance', tier: 5, fractured: true }],
    });
    const preview = equipmentCraftPreview(item, 'reforge');
    expect(preview.inclusionExact).toBe(true);
    const rng = createRng(77);
    const N = 8000;
    const freq = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const res = expectOk(craftEquipment(item, 'reforge', rng));
      for (const a of res.item.affixes) {
        if (a.affixId === 'life' || a.affixId === 'critChance') continue;
        const name = getAffix(a.affixId)!.name;
        freq.set(name, (freq.get(name) ?? 0) + 1);
      }
    }
    for (const o of preview.inclusion) expect(Math.abs((freq.get(o.label) ?? 0) / N - o.chance), o.label).toBeLessThan(0.02);
  });

  it('computes the largest real pool (a full rare on an amulet) exactly and quickly', () => {
    const item = equip({ baseId: 'cinderPendant', itemLevel: 100, rarity: 'normal', uid: 'a' });
    const t0 = performance.now();
    const p = equipmentCraftPreview(item, 'reforge');
    expect(performance.now() - t0).toBeLessThan(50);
    expect(p.inclusionExact).toBe(true);
    const expected = RARE_AFFIX_COUNTS.reduce((s, c) => s + c.count * c.weight, 0) / RARE_AFFIX_COUNTS.reduce((s, c) => s + c.weight, 0);
    expect(p.inclusion.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(expected, 9);
    expect(inclusionOdds([], [], AFFIX_LIMITS.rare, [{ count: 3, chance: 1 }]).odds.size).toBe(0);
  });
});

describe('tier odds in previews', () => {
  const sumPct = (line: string) => [...line.matchAll(/ (<?[\d.]+)%/g)].reduce((s, m) => s + (m[1].startsWith('<') ? 0 : Number(m[1])), 0);

  it('shows each essence outcome with its exact tier split, matching real rolls', () => {
    const wand = equip({ baseId: 'ashwoodWand', itemLevel: 30, rarity: 'normal', uid: 'w' });
    const lines = equipmentCraftPreview(wand, 'essenceEmber').lines;
    expect(lines[0]).toBe('Adds one of 2 fire affixes: Blazing 55% · of Immolation 45%');
    expect(lines).toContain('Tier odds by affix:');
    expect(lines).toContain('Blazing: T8 36% · T7 29% · T6 21% · T5 14%');
    expect(lines).toContain('of Immolation: T6 45% · T5 33% · T4 22%');

    const rng = createRng(5);
    const N = 10000;
    const tiers = new Map<number, number>();
    let blazing = 0;
    for (let i = 0; i < N; i++) {
      const a = expectOk(craftEquipment(wand, 'essenceEmber', rng)).item.affixes[0];
      if (a.affixId !== 'fireDamage') continue;
      blazing++;
      tiers.set(a.tier, (tiers.get(a.tier) ?? 0) + 1);
    }
    const weights = { 8: 1000, 7: 800, 6: 600, 5: 400 } as const;
    for (const [tier, w] of Object.entries(weights)) {
      expect(Math.abs((tiers.get(Number(tier)) ?? 0) / blazing - w / 2800), `T${tier}`).toBeLessThan(0.02);
    }
  });

  it('groups affixes that share a tier split and keeps every split at exactly 100%', () => {
    const chest = equip({ baseId: 'rivetedCoat', itemLevel: 75, rarity: 'normal', uid: 'c' });
    const lines = equipmentCraftPreview(chest, 'essenceVital').lines;
    const start = lines.indexOf('Tier odds by affix:');
    expect(start).toBeGreaterThan(0);
    const tierLines = lines.slice(start + 1).filter((l) => / T\d+ /.test(` ${l}`) && l.includes(': T'));
    expect(tierLines.length).toBeGreaterThanOrEqual(2);
    for (const l of tierLines) expect(sumPct(l.slice(l.indexOf(': T'))), l).toBeCloseTo(100, 6);
    expect(tierLines[0]).toMatch(/^Hale, Plated, of the Kiln, of Thaw and of Grounding: T8 30\.9% · /);
  });

  it('shortens long name lists for Kindling and Reforge and explains item level 1', () => {
    const wand = equip({ baseId: 'ashwoodWand', itemLevel: 30, rarity: 'normal', uid: 'w' });
    const kindling = equipmentCraftPreview(wand, 'kindling').lines;
    expect(kindling).toContain('Blazing, of Omens, of Insight and 4 more: T8 36% · T7 29% · T6 21% · T5 14%');
    expect(kindling.find((l) => l.startsWith('Chance for each affix:'))).toMatch(/ · and 8 others at [\d.]+% or less$/);

    const fresh = equip({ baseId: 'ashwoodWand', itemLevel: 1, rarity: 'normal', uid: 'f' });
    expect(equipmentCraftPreview(fresh, 'reforge').lines).toContain('At item level 1 only the lowest tier of each affix can roll.');
  });

  it('words single-option essences and catalyst targets plainly', () => {
    const ring = equip({
      baseId: 'emberRing', itemLevel: 60, rarity: 'magic', uid: 'r', affixes: [{ affixId: 'life', tier: 5, value: 30 }],
    });
    const storm = equipmentCraftPreview(ring, 'essenceStorm').lines;
    expect(storm[0]).toBe('Adds the only lightning affix that can roll here: of Grounding.');
    expect(storm[1]).toBe('Tier odds: T8 31% · T7 25% · T6 19% · T5 13% · T4 8% · T3 4%');
    expect(equipmentCraftPreview(ring, 'catalyst').lines).toContain('Hale T5: upgrades to T4 (32–40)');
  });
});
