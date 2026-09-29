import { describe, expect, it } from 'vitest';
import { BASE_IDS, UNIQUE_IDS } from '../../src/contracts/content';
import type { EquipmentItem } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import {
  AFFIX_LIMITS, BASES, RARE_NAME_FIRST, RARE_NAME_SECOND, UNIQUES, affixOrder, getAffix,
} from '../../src/data/items';
import {
  affixCandidates, baseWeights, buildEquipment, generateEquipment, generateUnique, itemFlags, pickRandomBase,
  pickRandomUnique, rollNewAffixes, rollRareName, uniqueIdsFor,
} from '../../src/game/items';
import type { CraftableRarity } from '../../src/game/items';

/** Assert every structural invariant of a generated non-unique item. */
function checkItem(item: EquipmentItem): void {
  const base = BASES[item.baseId];
  const label = `${item.baseId} ilvl ${item.itemLevel} ${item.rarity}`;
  let prefixes = 0;
  let suffixes = 0;
  const groups = new Set<string>();
  let lastOrder = -1;
  let seenSuffix = false;
  for (const a of item.affixes) {
    const def = getAffix(a.affixId);
    expect(def, label).toBeDefined();
    if (!def) continue;
    expect(def.classes, label).toContain(base.itemClass);
    if (def.requiresProperty) expect(base.properties.some((p) => p.stat === def.requiresProperty), label).toBe(true);
    const tier = def.tiers.find((t) => t.tier === a.tier);
    expect(tier, `${label} ${a.affixId} T${a.tier}`).toBeDefined();
    expect(tier!.itemLevel, `${label} ${a.affixId}`).toBeLessThanOrEqual(item.itemLevel);
    expect(a.value).toBeGreaterThanOrEqual(tier!.min);
    expect(a.value).toBeLessThanOrEqual(tier!.max);
    expect(Number.isInteger(a.value)).toBe(true);
    expect(groups.has(def.group), `${label} duplicate group ${def.group}`).toBe(false);
    groups.add(def.group);
    if (def.kind === 'prefix') {
      prefixes++;
      expect(seenSuffix, `${label}: prefix after suffix`).toBe(false);
    } else {
      suffixes++;
      if (!seenSuffix) lastOrder = -1;
      seenSuffix = true;
    }
    expect(affixOrder(a.affixId)).toBeGreaterThan(lastOrder);
    lastOrder = affixOrder(a.affixId);
  }
  const n = item.affixes.length;
  if (item.rarity === 'normal') expect(n).toBe(0);
  if (item.rarity === 'magic') {
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
    expect(prefixes).toBeLessThanOrEqual(AFFIX_LIMITS.magic.prefix);
    expect(suffixes).toBeLessThanOrEqual(AFFIX_LIMITS.magic.suffix);
    expect(item.name).toBeNull();
  }
  if (item.rarity === 'rare') {
    expect(n, label).toBeGreaterThanOrEqual(3);
    expect(n, label).toBeLessThanOrEqual(6);
    expect(prefixes).toBeLessThanOrEqual(3);
    expect(suffixes).toBeLessThanOrEqual(3);
    const [first, second, ...rest] = item.name!.split(' ');
    expect(rest).toHaveLength(0);
    expect(RARE_NAME_FIRST).toContain(first);
    expect(RARE_NAME_SECOND).toContain(second);
    expect(first).not.toBe(second);
  }
  expect(item.implicitValues).toHaveLength(base.implicits.length);
  base.implicits.forEach((imp, i) => {
    expect(item.implicitValues[i]).toBeGreaterThanOrEqual(imp.min);
    expect(item.implicitValues[i]).toBeLessThanOrEqual(imp.max);
  });
  expect(item.maxStability).toBe(base.maxStability);
  expect(item.stability).toBe(item.maxStability);
  expect(item.scars).toEqual([]);
}

describe('generateEquipment', () => {
  it('holds every invariant over thousands of seeded rolls', () => {
    const rarities: CraftableRarity[] = ['normal', 'magic', 'rare'];
    const rng = createRng(2024);
    for (let i = 0; i < 6000; i++) {
      const baseId = BASE_IDS[i % BASE_IDS.length];
      const ilvl = 1 + ((i * 37) % 100);
      const rarity = rarities[i % 3];
      checkItem(generateEquipment(baseId, ilvl, rarity, rng));
    }
  });

  it('only rolls the bottom tier at item level 1', () => {
    const rng = createRng(5);
    for (let i = 0; i < 1500; i++) {
      const item = generateEquipment(BASE_IDS[i % BASE_IDS.length], 1, 'rare', rng);
      for (const a of item.affixes) {
        const def = getAffix(a.affixId)!;
        expect(a.tier).toBe(def.tiers.length);
      }
    }
  });

  it('never rolls +1 projectile below item level 70 or off wands', () => {
    const rng = createRng(77);
    let seenHigh = 0;
    for (let i = 0; i < 20000; i++) {
      const wandLow = generateEquipment('glassboneWand', 69, 'rare', rng);
      expect(wandLow.affixes.some((a) => a.affixId === 'splintering')).toBe(false);
      const high = generateEquipment('ashwoodWand', 85, 'rare', rng);
      if (high.affixes.some((a) => a.affixId === 'splintering')) seenHigh++;
    }
    for (let i = 0; i < 2000; i++) {
      const sceptre = generateEquipment('emberSceptre', 100, 'rare', rng);
      expect(sceptre.affixes.some((a) => a.affixId === 'splintering')).toBe(false);
    }
    // Very rare, but reachable.
    expect(seenHigh).toBeGreaterThan(0);
    expect(seenHigh / 20000).toBeLessThan(0.05);
  });

  it('picks tiers in proportion to their weights', () => {
    const base = BASES.emberRing;
    const cand = affixCandidates(base, 100).find((c) => c.affix.id === 'fireDamage')!;
    const rng = createRng(31);
    const counts = new Map<number, number>();
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const [a] = rollNewAffixes(rng, [cand], [], AFFIX_LIMITS.magic, 1);
      counts.set(a.tier, (counts.get(a.tier) ?? 0) + 1);
    }
    const total = cand.tiers.reduce((s, t) => s + t.weight, 0);
    for (const t of cand.tiers) {
      const expected = t.weight / total;
      expect(Math.abs((counts.get(t.tier) ?? 0) / N - expected), `T${t.tier}`).toBeLessThan(0.012);
    }
  });

  it('doubles fire-affix weight on Ashwood (material)', () => {
    const fireShare = (baseId: 'ashwoodWand' | 'ironrootWand') => {
      const cands = affixCandidates(BASES[baseId], 30);
      const fire = cands.filter((c) => c.affix.tags.includes('fire')).reduce((s, c) => s + c.weight, 0);
      const all = cands.reduce((s, c) => s + c.weight, 0);
      return { fire, all };
    };
    const ash = fireShare('ashwoodWand');
    const iron = fireShare('ironrootWand');
    expect(ash.fire).toBeCloseTo(iron.fire * 2);
    // Empirical check against the analytical first-pick share.
    const rng = createRng(8);
    let fireFirst = 0;
    const N = 20000;
    const cands = affixCandidates(BASES.ashwoodWand, 30);
    for (let i = 0; i < N; i++) {
      const [a] = rollNewAffixes(rng, cands, [], AFFIX_LIMITS.rare, 1);
      if (getAffix(a.affixId)!.tags.includes('fire')) fireFirst++;
    }
    expect(Math.abs(fireFirst / N - ash.fire / ash.all)).toBeLessThan(0.012);
  });

  it('applies options: uid, extra stability, forced count, origin, isNew, tag weights', () => {
    const rng = createRng(1);
    const item = generateEquipment('rivetedCoat', 40, 'rare', rng, {
      uid: 'fixed', extraStability: 2, affixCount: 6, origin: 'Dropped in Iron Coliseum (T3)', isNew: true,
    });
    expect(item.uid).toBe('fixed');
    expect(item.maxStability).toBe(11);
    expect(item.stability).toBe(11);
    expect(item.affixes).toHaveLength(6);
    expect(item.history).toEqual(['Dropped in Iron Coliseum (T3)']);
    expect(item.isNew).toBe(true);
    const magic = generateEquipment('emberRing', 50, 'magic', rng, { affixCount: 9 });
    expect(magic.affixes.length).toBe(2);
    // A huge life multiplier makes life-tagged affixes dominate.
    let life = 0;
    for (let i = 0; i < 300; i++) {
      const it2 = generateEquipment('chainBelt', 50, 'magic', rng, { affixCount: 1, tagWeights: { life: 1000 } });
      if (getAffix(it2.affixes[0].affixId)!.tags.includes('life')) life++;
    }
    expect(life).toBeGreaterThan(290);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = generateEquipment('boneTalisman', 70, 'rare', createRng(99));
    const b = generateEquipment('boneTalisman', 70, 'rare', createRng(99));
    expect(a).toEqual(b);
    const names = new Set<string>();
    for (let s = 0; s < 50; s++) names.add(JSON.stringify(generateEquipment('boneTalisman', 70, 'rare', createRng(s))));
    expect(names.size).toBe(50);
  });

  it('clamps item level into 1–100', () => {
    const rng = createRng(3);
    expect(generateEquipment('emberRing', -5, 'normal', rng).itemLevel).toBe(1);
    expect(generateEquipment('emberRing', 500, 'normal', rng).itemLevel).toBe(100);
  });
});

describe('uniques', () => {
  it('generates every unique on its base with rolled values and flags', () => {
    const rng = createRng(12);
    for (const id of UNIQUE_IDS) {
      for (let i = 0; i < 50; i++) {
        const item = generateUnique(id, rng);
        const def = UNIQUES[id];
        expect(item.rarity).toBe('unique');
        expect(item.uniqueId).toBe(id);
        expect(item.baseId).toBe(def.baseId);
        expect(item.name).toBe(def.name);
        expect(item.stability).toBe(0);
        expect(item.maxStability).toBe(0);
        expect(item.affixes).toHaveLength(def.mods.length);
        item.affixes.forEach((a, k) => {
          expect(a.value).toBeGreaterThanOrEqual(def.mods[k].min);
          expect(a.value).toBeLessThanOrEqual(def.mods[k].max);
        });
        expect(itemFlags(item)).toEqual(def.flags.map((f) => f.flag));
      }
    }
    expect(generateUnique('cinderwalkers', rng, { itemLevel: 55 }).itemLevel).toBe(55);
  });

  it('filters and picks uniques by class', () => {
    expect(uniqueIdsFor({ classes: ['ring'] })).toEqual(['ruinheartBand']);
    expect(uniqueIdsFor({ baseId: 'ashwoodWand' })).toEqual(['thePatientSpark']);
    expect(pickRandomUnique(createRng(1), { classes: ['helmet'] })).toBeNull();
    expect(pickRandomUnique(createRng(1), { classes: ['boots'] })).toBe('cinderwalkers');
  });
});

describe('base picking', () => {
  it('respects class filters, level filters and weight overrides', () => {
    const rng = createRng(4);
    for (let i = 0; i < 500; i++) {
      const id = pickRandomBase(rng, { classes: ['ring'] })!;
      expect(BASES[id].itemClass).toBe('ring');
    }
    for (let i = 0; i < 500; i++) {
      const id = pickRandomBase(rng, { itemLevel: 5 })!;
      expect(BASES[id].levelRequirement).toBeLessThanOrEqual(5);
    }
    for (let i = 0; i < 200; i++) {
      expect(pickRandomBase(rng, { classes: ['wand'], weights: { ashwoodWand: 0, glassboneWand: 0 } })).toBe('ironrootWand');
    }
    expect(pickRandomBase(rng, { classes: ['ring'], weights: { emberRing: 0, rimeBand: 0, stormLoop: 0, voidSignet: 0 } })).toBeNull();
  });

  it('is uniform by default', () => {
    expect(new Set(baseWeights().map((b) => b.weight)).size).toBe(1);
    const rng = createRng(10);
    const counts = new Map<string, number>();
    const N = 22000;
    for (let i = 0; i < N; i++) {
      const id = pickRandomBase(rng)!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of BASE_IDS) expect(Math.abs((counts.get(id) ?? 0) / N - 1 / 22)).toBeLessThan(0.008);
  });

  it('boosts classes via class weights', () => {
    const w = baseWeights({ classWeights: { ring: 3 } });
    const ring = w.filter((b) => b.base.itemClass === 'ring')[0].weight;
    const wand = w.filter((b) => b.base.itemClass === 'wand')[0].weight;
    expect(ring).toBe(wand * 3);
  });
});

describe('buildEquipment & names', () => {
  it('builds explicit items and rolls missing values', () => {
    const item = buildEquipment({
      baseId: 'ashwoodWand', itemLevel: 1, rarity: 'magic', uid: 'kit-wand',
      affixes: [{ affixId: 'fireDamage', tier: 8 }],
    }, createRng(3));
    expect(item.affixes[0].affixId).toBe('fireDamage');
    expect(item.affixes[0].value).toBeGreaterThanOrEqual(8);
    expect(item.affixes[0].value).toBeLessThanOrEqual(12);
    expect(item.name).toBeNull();
  });

  it('rejects impossible explicit items', () => {
    const rng = createRng(1);
    expect(() => buildEquipment({ baseId: 'emberRing', itemLevel: 1, rarity: 'magic', affixes: [{ affixId: 'nope', tier: 1 }] }, rng)).toThrow();
    expect(() => buildEquipment({ baseId: 'emberRing', itemLevel: 1, rarity: 'magic', affixes: [{ affixId: 'moveSpeed', tier: 6 }] }, rng)).toThrow();
    expect(() => buildEquipment({ baseId: 'emberRing', itemLevel: 1, rarity: 'magic', affixes: [{ affixId: 'fireDamage', tier: 1 }] }, rng)).toThrow();
    expect(() => buildEquipment({
      baseId: 'emberRing', itemLevel: 80, rarity: 'magic',
      affixes: [{ affixId: 'fireDamage', tier: 3 }, { affixId: 'coldDamage', tier: 3 }],
    }, rng)).toThrow();
  });

  it('rejects everything a rolled item could never be', () => {
    const rng = createRng(2);
    const rare = { baseId: 'rivetedCoat', itemLevel: 80, rarity: 'rare' } as const;
    const throws = (spec: Parameters<typeof buildEquipment>[0], msg: RegExp) => expect(() => buildEquipment(spec, rng)).toThrow(msg);
    // % / flat Armour need an Armour base, even though body armour is an allowed class.
    throws({ baseId: 'ashenRobe', itemLevel: 80, rarity: 'magic', affixes: [{ affixId: 'armourFlat', tier: 3 }] }, /cannot roll on Ashen Robe/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3, sealed: true }, { affixId: 'strength', tier: 3, sealed: true }] }, /one affix can be sealed/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3, fractured: true }, { affixId: 'strength', tier: 3, fractured: true }] }, /one affix can be fractured/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3, sealed: true, fractured: true }] }, /both sealed and fractured/);
    throws({ ...rare, affixes: [] }, /needs at least one affix/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3 }], implicitValues: [99] }, /implicit 0 value 99/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3 }], implicitValues: [50, 1] }, /expected 1 implicit/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3 }], scars: [{ scarId: 'nope', value: 1 }] }, /unknown scar/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3 }], scars: [{ scarId: 'frail', value: 40 }] }, /outside 5-10/);
    throws({ ...rare, affixes: [{ affixId: 'life', tier: 3 }], scars: [{ scarId: 'frail', value: 6 }, { scarId: 'frail', value: 7 }] }, /duplicate scar/);
    throws({
      ...rare, affixes: [{ affixId: 'life', tier: 3 }],
      scars: [{ scarId: 'frail', value: 6 }, { scarId: 'dim', value: 7 }, { scarId: 'hollow', value: 7 }],
    }, /at most 2 scars/);
    const legal = buildEquipment({
      ...rare, name: 'Iron Vow', implicitValues: [50],
      affixes: [{ affixId: 'life', tier: 3, sealed: true }, { affixId: 'armourPercent', tier: 2, fractured: true }],
      scars: [{ scarId: 'brittle', value: 20 }],
    }, rng);
    expect(legal.implicitValues).toEqual([50]);
    expect(legal.scars).toEqual([{ scarId: 'brittle', value: 20 }]);
  });

  it('builds the starting-kit wand at item level 1, and scripted tiers only on request', () => {
    // GAME_SPEC §3 asks for a "T7-ish" fire affix; T8 is the best tier item level 1 can roll.
    const kit = buildEquipment({ baseId: 'ashwoodWand', itemLevel: 1, rarity: 'magic', uid: 'kit', affixes: [{ affixId: 'fireDamage', tier: 8 }] }, createRng(4));
    expect(kit.affixes).toHaveLength(1);
    expect(kit.itemLevel).toBe(1);
    const t7 = { baseId: 'ashwoodWand', itemLevel: 1, rarity: 'magic', affixes: [{ affixId: 'fireDamage', tier: 7, value: 15 }] } as const;
    expect(() => buildEquipment(t7, createRng(4))).toThrow(/T7 needs item level 6 \(pass ignoreItemLevel/);
    const scripted = buildEquipment({ ...t7, ignoreItemLevel: true }, createRng(4));
    expect(scripted.affixes[0]).toEqual({ affixId: 'fireDamage', tier: 7, value: 15 });
    // ignoreItemLevel skips only the item-level gate.
    expect(() => buildEquipment({ ...t7, ignoreItemLevel: true, affixes: [{ affixId: 'moveSpeed', tier: 6 }] }, createRng(4))).toThrow();
  });

  it('never repeats a word in rare names', () => {
    const rng = createRng(0);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const name = rollRareName(rng);
      const [a, b] = name.split(' ');
      expect(a).not.toBe(b);
      seen.add(name);
    }
    expect(seen.size).toBeGreaterThan(500);
  });
});
