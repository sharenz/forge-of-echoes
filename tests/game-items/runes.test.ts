import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { getAffix } from '../../src/data/items';
import { rules, withItemLocks } from '../../src/game';
import { craftEquipment, equipmentCraftPreview, tradeOfferError } from '../../src/game/items';
import { normalizeCharacter } from '../../src/game/progression/save';
import { currency, equip, expectOk, makeCharacter, withBackpack } from './fixtures';

const project = () => equip({
  uid: 'project', baseId: 'prismaticAmulet', itemLevel: 80, rarity: 'rare', name: 'Ash Covenant',
  affixes: [
    { affixId: 'life', tier: 4 }, { affixId: 'focus', tier: 4 }, { affixId: 'spellDamage', tier: 4 },
    { affixId: 'castSpeed', tier: 4 }, { affixId: 'coldResistance', tier: 4 }, { affixId: 'critChance', tier: 4 },
  ],
});

for (const [rune, side] of [['prefixRune', 'prefix'], ['suffixRune', 'suffix']] as const) describe(rune, () => {
  it('reforges only its half, keeping count, rarity, identity, and the opposite rolls across seeds', () => {
    const item = project();
    const original = structuredClone(item);
    const other = item.affixes.filter(a => getAffix(a.affixId)!.kind !== side);
    const changed = new Set<string>();
    for (let seed = 0; seed < 150; seed++) {
      const next = expectOk(craftEquipment(item, rune, createRng(seed))).item;
      expect(next.affixes.filter(a => getAffix(a.affixId)!.kind !== side)).toEqual(other);
      expect(next.affixes.filter(a => getAffix(a.affixId)!.kind === side)).toHaveLength(3);
      expect(new Set(next.affixes.map(a => getAffix(a.affixId)!.group)).size).toBe(6);
      expect(next).toMatchObject({ uid: item.uid, baseId: item.baseId, itemLevel: 80, name: 'Ash Covenant', rarity: 'rare', stability: 5 });
      expect(next.history.at(-1)).toContain(`3 ${side}es`);
      changed.add(JSON.stringify(next.affixes));
    }
    expect(changed.size).toBeGreaterThan(100);
    expect(item).toEqual(original);
  });

  it('keeps seals and fractures on the target side, consumes the seal and preserves bench marks on the other', () => {
    const item = project();
    const chosen = item.affixes.filter(a => getAffix(a.affixId)!.kind === side);
    chosen[0].sealed = true;
    chosen[1].fractured = true;
    item.affixes.find(a => getAffix(a.affixId)!.kind !== side)!.crafted = true;
    for (let seed = 0; seed < 20; seed++) {
      const next = expectOk(craftEquipment(item, rune, createRng(seed))).item;
      const { sealed: _seal, ...preserved } = chosen[0];
      expect(next.affixes.find(a => a.affixId === chosen[0].affixId)).toEqual(preserved);
      expect(next.affixes.find(a => a.affixId === chosen[1].affixId)).toEqual(chosen[1]);
      expect(next.affixes.some(a => a.crafted)).toBe(true);
      expect(next.affixes).toHaveLength(6);
    }
  });

  it('keeps magic rarity and one affix per side', () => {
    const item = equip({ baseId: 'emberRing', itemLevel: 16, rarity: 'magic',
      affixes: [{ affixId: 'life', tier: 8 }, { affixId: 'coldResistance', tier: 8 }] });
    const next = expectOk(craftEquipment(item, rune, createRng(7))).item;
    expect(next.rarity).toBe('magic');
    expect(next.affixes.map(a => getAffix(a.affixId)!.kind)).toEqual(['prefix', 'suffix']);
  });

  it('rejects an empty or fully protected side, finished gear and insufficient stability without spending RNG', () => {
    const item = project();
    const protectedItem = { ...item, affixes: item.affixes.filter(a => getAffix(a.affixId)!.kind !== side || a === item.affixes.find(b => getAffix(b.affixId)!.kind === side))
      .map(a => ({ ...a, fractured: getAffix(a.affixId)!.kind === side })) };
    for (const invalid of [{ ...item, affixes: [] }, protectedItem, { ...item, stability: 0 }, { ...item, stability: 2 }]) {
      const rng = createRng(45);
      expect(craftEquipment(invalid, rune, rng).ok).toBe(false);
      expect(rng.state()).toBe(45);
      const ch = makeCharacter({ equipment: { amulet: invalid }, currencyStash: { [rune]: 2 } });
      const saved = structuredClone(ch);
      expect(rules.applyCurrency(ch, `cstash:${rune}`, item.uid).ok).toBe(false);
      expect(ch).toEqual(saved);
    }
  });

  it('shows exact family odds agreeing with real rolls and never offers the opposite side', () => {
    const item = project();
    const preview = equipmentCraftPreview(item, rune);
    expect(preview.inclusionExact).toBe(true);
    expect(preview.inclusion.reduce((n, o) => n + o.chance, 0)).toBeCloseTo(3, 9);
    const counts = new Map<string, number>();
    const rng = createRng(931);
    for (let n = 0; n < 4000; n++) for (const a of expectOk(craftEquipment(item, rune, rng)).item.affixes) {
      const def = getAffix(a.affixId)!;
      if (def.kind === side) counts.set(def.name, (counts.get(def.name) ?? 0) + 1);
    }
    for (const o of preview.inclusion) expect(Math.abs((counts.get(o.label) ?? 0) / 4000 - o.chance), o.label).toBeLessThan(0.035);
  });

  it('spends exactly one stored rune, remains tradeable and survives save normalization', () => {
    const item = project();
    const ch = makeCharacter({ equipment: { amulet: item }, currencyStash: { [rune]: 2 } });
    const next = expectOk(rules.applyCurrency(ch, `cstash:${rune}`, item.uid)).character;
    expect(next.currencyStash[rune]).toBe(1);
    expect(next.stats.itemsCrafted).toBe(ch.stats.itemsCrafted + 1);
    expect(normalizeCharacter(JSON.parse(JSON.stringify(next)))?.equipment.amulet).toEqual(next.equipment.amulet);
    expect(normalizeCharacter(next)?.currencyStash[rune]).toBe(1);
    const carried = withBackpack(makeCharacter(), [[currency(rune, 2, 'rune'), 0, 0]]);
    expect(tradeOfferError(carried, ['rune'])).toBeNull();
    const locked = withItemLocks(rules, () => new Set([item.uid]));
    expect(locked.applyCurrency(ch, `cstash:${rune}`, item.uid).ok).toBe(false);
    expect(ch.currencyStash[rune]).toBe(2);
  });
});
