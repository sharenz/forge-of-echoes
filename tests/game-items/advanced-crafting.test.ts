import { describe, expect, it } from 'vitest';
import type { EquipmentItem } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { getAffix, SCARS } from '../../src/data/items';
import { rules } from '../../src/game';
import { craftEquipment, equipmentCraftError, equipmentCraftPreview, generateUnique } from '../../src/game/items';
import { graftPool, transmuteBases } from '../../src/game/items/advanced-crafting';
import { normalizeItem } from '../../src/game/progression/save';
import { findBase } from '../../src/data/items';
import { equip, expectOk, makeCharacter, withBackpack } from './fixtures';

const ring = (): EquipmentItem => equip({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', uid: 'craft:i1',
  affixes: [{ affixId: 'life', tier: 5, value: 30 }, { affixId: 'coldResistance', tier: 5, value: 22, sealed: true }],
});
const saved = (item: EquipmentItem) => normalizeItem(JSON.parse(JSON.stringify(item)), item.uid);

describe('advanced equipment ingredients', () => {
  it('removes the oldest scar from Finished gear without touching its affixes, protections or budget', () => {
    const original = { ...ring(), stability: 0, repairCount: 4, craftCount: 31,
      scars: SCARS.slice(0, 2).map(s => ({ scarId: s.id, value: s.min })) };
    const snapshot = structuredClone(original);
    const next = expectOk(craftEquipment(original, 'scarBalm', createRng(6))).item;
    expect(original).toEqual(snapshot);
    expect(next.scars).toEqual(original.scars.slice(1));
    expect(next.affixes).toEqual(original.affixes);
    expect(next).toMatchObject({ uid: original.uid, stability: 0, maxStability: original.maxStability, repairCount: 4, craftCount: 32 });
    expect(saved(next)).toEqual(next);
    expect(equipmentCraftError({ ...next, scars: [] }, 'scarBalm')).toMatch(/no scar/);
  });

  it('Anneal restores a Finished item at a permanent maximum cost, retaining scars and lifetime counters', () => {
    const original = { ...ring(), stability: 0, craftCount: 24, repairCount: 7, scars: [{ scarId: SCARS[0].id, value: SCARS[0].min }] };
    const next = expectOk(craftEquipment(original, 'anneal', createRng(1))).item;
    expect(next.stability).toBe(original.maxStability - 1);
    expect(next.maxStability).toBe(next.stability);
    expect(next.affixes).toEqual(original.affixes);
    expect(next.scars).toEqual(original.scars);
    expect(next).toMatchObject({ craftCount: 25, repairCount: 7 });
    expect(saved(next)).toEqual(next);
    expect(equipmentCraftPreview(original, 'anneal').stabilityAfter).toBe(next.stability);
    expect(equipmentCraftError(next, 'anneal')).toMatch(/two missing/);
    expect(equipmentCraftError({ ...next, maxStability: 1, stability: 0 }, 'anneal')).toMatch(/two maximum/);
  });

  it('Graft changes exactly one family at the same side and tier, respecting every other group and protection', () => {
    const original = ring(), def = getAffix(original.affixes[0].affixId)!;
    const seen = new Set<string>();
    for (let seed = 0; seed < 250; seed++) {
      const next = expectOk(craftEquipment(original, 'graft', createRng(seed), 0)).item;
      expect(next.affixes).toHaveLength(2);
      const changed = next.affixes.find(a => getAffix(a.affixId)?.kind === def.kind)!;
      seen.add(changed.affixId);
      expect(getAffix(changed.affixId)!.group).not.toBe(def.group);
      expect(changed.tier).toBe(5);
      expect(next.affixes.find(a => a.affixId === 'coldResistance')).toEqual({ affixId: 'coldResistance', tier: 5, value: 22 });
      expect(next.rarity).toBe('magic');
      expect(saved(next)).toEqual(next);
    }
    expect(seen.size).toBe(graftPool(original, findBase(original.baseId)!, 0).length);
    expect(equipmentCraftError(original, 'graft', 1)).toMatch(/Sealed/);
    expect(equipmentCraftError({ ...original, affixes: original.affixes.map(a => ({ ...a, fractured: true })) }, 'graft', 0)).toMatch(/fractured/);
    expect(equipmentCraftPreview(original, 'graft').lines.join(' ')).toMatch(/chance|%/);
  });

  it('Transmute changes only to a compatible base, preserves item identity and refuses equipped targets', () => {
    const original = { ...ring(), repairCount: 5, craftCount: 70 };
    const candidates = transmuteBases(original);
    expect(candidates.length).toBeGreaterThan(1);
    for (let seed = 0; seed < 50; seed++) {
      const next = expectOk(craftEquipment(original, 'transmute', createRng(seed))).item;
      expect(candidates.some(b => b.id === next.baseId)).toBe(true);
      expect(next.uid).toBe(original.uid);
      expect(next.affixes.map(({ sealed: _s, ...a }) => a)).toEqual(original.affixes.map(({ sealed: _s, ...a }) => a));
      expect(next).toMatchObject({ maxStability: original.maxStability, stability: original.stability - 3, repairCount: 5, craftCount: 71 });
      expect(saved(next)).toEqual(next);
    }
    const ch = makeCharacter({ equipment: { ring1: original }, currencyStash: { transmute: 1 } });
    const before = structuredClone(ch);
    expect(rules.applyCurrency(ch, 'cstash:transmute', original.uid)).toMatchObject({ ok: false });
    expect(rules.craftPreview(ch, 'cstash:transmute', original.uid).join(' ')).toMatch(/Unequip/);
    expect(ch).toEqual(before);
  });

  it('Transmute at low Stability rolls scars for the resulting base properties', () => {
    for (const baseId of ['ironVisor', 'ritualCirclet'] as const) {
      const original = { ...equip({ baseId, itemLevel: 22, rarity: 'normal' }), stability: 3 };
      let propertyScars = 0;
      for (let seed = 0; seed < 500; seed++) {
        const next = expectOk(craftEquipment(original, 'transmute', createRng(seed))).item;
        const base = findBase(next.baseId)!;
        expect(next.baseId).not.toBe(baseId);
        for (const rolled of next.scars) {
          const scar = SCARS.find(s => s.id === rolled.scarId)!;
          if (scar.requiresProperty) {
            propertyScars++;
            expect(base.properties.some(p => p.stat === scar.requiresProperty)).toBe(true);
          }
        }
        expect(saved(next)).toEqual(next);
      }
      expect(propertyScars).toBeGreaterThan(10);
    }
  });

  it('Echo Shard produces the higher-of-two distribution and keeps protected values', () => {
    const original = ring(), tier = getAffix('life')!.tiers.find(t => t.tier === 5)!;
    const rng = createRng(992), values: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const next = expectOk(craftEquipment(original, 'echoShard', rng)).item;
      values.push(next.affixes.find(a => a.affixId === 'life')!.value);
      expect(next.affixes.find(a => a.affixId === 'coldResistance')!.value).toBe(22);
    }
    const normalized = values.reduce((n, v) => n + (v - tier.min) / (tier.max - tier.min), 0) / values.length;
    expect(normalized).toBeGreaterThan(0.62); expect(normalized).toBeLessThan(0.73);
    expect(Math.min(...values)).toBeLessThan(30);
    expect(equipmentCraftPreview(original, 'echoShard').lines.join(' ')).toMatch(/chance to exceed 30/);
  });

  it('Crown Fragments refine Unique values without changing their implicit or special behaviour and survive reload', () => {
    const original = generateUnique('thePatientSpark', createRng(8), { uid: 'crown:i1' });
    const seen = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      const result = expectOk(craftEquipment(original, 'crownFragment', createRng(seed)));
      expect(result.kind).toBe('success');
      const next = result.item;
      expect(next).toMatchObject({ uid: original.uid, baseId: original.baseId, uniqueId: original.uniqueId, stability: 0, craftCount: 1 });
      expect(next.implicitValues).toEqual(original.implicitValues);
      expect(next.affixes[1]).toEqual(original.affixes[1]);
      expect(saved(next)).toEqual(next);
      expect(rules.describeItem(next).affixes.at(-1)?.text).toContain('pierces all');
      seen.add(next.affixes[0].value);
    }
    expect(seen.size).toBeGreaterThan(8);
    expect(equipmentCraftError(ring(), 'crownFragment')).toMatch(/Unique items only/);
  });

  it('pays from the shared crafting slot only on success, without mutating rejected inputs or RNG', () => {
    const item = ring();
    const ch = withBackpack(makeCharacter({ currencyStash: { graft: 2, scarBalm: 1 } }), [[item, 0, 0]]);
    const before = structuredClone(ch);
    expect(rules.applyCurrency(ch, 'cstash:graft', item.uid, 1).ok).toBe(false);
    expect(rules.applyCurrency(ch, 'cstash:scarBalm', item.uid).ok).toBe(false);
    expect(ch).toEqual(before);
    const result = expectOk(rules.applyCurrency(ch, 'cstash:graft', item.uid, 0)).character;
    expect(result.currencyStash.graft).toBe(1);
    expect(result.currencyStash.scarBalm).toBe(1);
    expect(result.stats.itemsCrafted).toBe(ch.stats.itemsCrafted + 1);
    expect(result.rngState).not.toBe(ch.rngState);
    expect(ch).toEqual(before);
  });
});
