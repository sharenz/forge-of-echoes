import { describe, expect, it } from 'vitest';
import { rules, withItemLocks } from '../../src/game';
import { generateEquipment, generateUnique } from '../../src/game/items';
import { createRng } from '../../src/core/rng';
import { getAffix, BASES, UNIQUES } from '../../src/data/items';
import { gambleOdds } from '../../src/game/progression';
import { bareCharacter, currency, equip, expectErr, expectOk, map, withBackpack } from './fixtures';
import type { EquipmentItem } from '../../src/contracts/items';

const quote = (item: EquipmentItem) => rules.sellQuote(item)!;
const good = (uid = 'good'): EquipmentItem => equip({ baseId: 'dusksteelRing', itemLevel: 88, rarity: 'rare', uid,
  affixes: ['life', 'focus', 'fireDamage', 'fireResistance', 'coldResistance', 'lightningResistance'].map(affixId => ({ affixId, tier: 1 })) });

describe('Rook appraises equipment', () => {
  it('values item level, the base, affix count and actual tier strength', () => {
    const plain = equip({ baseId: 'ashwoodWand', itemLevel: 1, rarity: 'normal' });
    expect(quote(plain).scrap).toBe(1);
    expect(quote({ ...plain, itemLevel: 99 }).scrap).toBeGreaterThan(quote(plain).scrap);
    const lowBase = { ...plain, itemLevel: 40 };
    expect(quote({ ...lowBase, baseId: 'emberheartWand' }).scrap).toBeGreaterThan(quote(lowBase).scrap);
    const strong = good();
    const weak = { ...strong, affixes: strong.affixes.map(a => ({ ...a, tier: Math.max(...getAffix(a.affixId)!.tiers.map(t => t.tier)) })) };
    expect(quote(strong).scrap).toBe(8);
    expect(quote(strong).scrap).toBeGreaterThan(quote(weak).scrap);
    expect(quote(strong).scrap).toBeGreaterThan(quote({ ...strong, affixes: strong.affixes.slice(0, 3) }).scrap);
    expect(quote({ ...strong, rarity: 'magic' })).toEqual(quote(strong)); // the colour does not determine value
    expect(quote(strong).lines).toEqual(expect.arrayContaining([expect.stringContaining('Item level 88'), expect.stringContaining('T1')]));
    expect(rules.sellQuote(currency('scrap'))).toBeNull();
    expect(rules.sellQuote(map())).toBeNull();
  });

  it('appraises every base and unique without treating fixed unique modifiers as T1 affixes', () => {
    for (const id of Object.keys(BASES) as (keyof typeof BASES)[]) {
      const item = generateEquipment(id, 88, 'rare', createRng(42));
      expect(quote(item).scrap).toBeGreaterThan(0);
      expect(Number.isInteger(quote(item).scrap)).toBe(true);
    }
    for (const id of Object.keys(UNIQUES) as (keyof typeof UNIQUES)[]) {
      const item = generateUnique(id, createRng(42), { itemLevel: 88 });
      expect(quote(item).lines.filter(l => l.startsWith('Unique modifier'))).toHaveLength(item.affixes.length);
    }
  });

  it('keeps even the upper-bound expected gamble resale below its purchase cost at maximum rarity', () => {
    // At ilvl99 and the most valuable base, normal/magic/rare with every affix T1 pay at most 2/4/8.
    const item = good();
    const maxBase = Math.max(...Object.values(BASES).map(b => b.levelRequirement));
    const upper = (n: number) => Math.ceil((50 + maxBase + 99 + n * 100) / 100);
    const maxUnique = Math.max(...Object.values(UNIQUES).filter(u => !u.bossSource).map(u => quote(generateUnique(u.id, createRng(1), { itemLevel: 99 })).scrap));
    for (const cls of new Set(Object.values(BASES).map(b => b.itemClass))) {
      for (const rarity of [1, 10, 100000]) {
        const odds = gambleOdds(cls, rarity, 99);
        const bound = odds.normal * upper(0) + odds.magic * upper(2) + odds.rare * upper(6) + odds.unique * maxUnique;
        expect(bound).toBeLessThan(6);
      }
    }
    expect(quote(item).scrap).toBeLessThanOrEqual(upper(6));
  });
});

describe('selling equipment atomically', () => {
  it('pays the appraised total into the shared Crafting Stash and cannot sell an item twice', () => {
    const a = good('a'), b = { ...good('b'), itemLevel: 46 };
    const ch = withBackpack(bareCharacter({ currencyStash: { scrap: 7 } }), [[a, 0, 0], [b, 1, 0], [currency('kindling', 3, 'keep'), 2, 0]]);
    const before = JSON.stringify(ch), price = quote(a).scrap + quote(b).scrap;
    const out = expectOk(rules.sellItems(ch, ['a', 'b'], price));
    expect(out.scrap).toBe(price);
    expect(out.character.currencyStash.scrap).toBe(7 + price);
    expect(out.character.backpack.entries.map(e => e.item.uid)).toEqual(['keep']);
    expect(JSON.stringify(ch)).toBe(before);
    expect(rules.sellItems(out.character, ['a'], quote(a).scrap).ok).toBe(false);
    expect(rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [out.character] })).characters[0].currencyStash).toEqual(out.character.currencyStash);
  });

  it('uses freed backpack space for overflow, including when trade-locked Scrap cannot be merged', () => {
    const item = good('sell');
    const ch = withBackpack(bareCharacter({ currencyStash: { scrap: 4999 } }), [[item, 0, 0], [currency('scrap', 3, 'locked'), 1, 0]]);
    const locked = withItemLocks(rules, () => new Set(['locked']));
    const out = expectOk(locked.sellItems(ch, ['sell'], quote(item).scrap)).character;
    expect(out.currencyStash.scrap).toBe(5000);
    expect(rules.findItem(out, 'locked')?.item).toMatchObject({ count: 3 });
    expect(out.backpack.entries.filter(e => e.item.kind === 'currency' && e.item.currencyId === 'scrap').reduce((n, e) => n + (e.item.kind === 'currency' ? e.item.count : 0), 0)).toBe(10);
  });

  it('refuses partial, duplicate, stale, equipped, stashed, non-equipment and trade-locked sales', () => {
    const item = good('sell'), worn = good('worn'), stashed = good('stashed');
    const ch = withBackpack(bareCharacter({ equipment: { ring1: worn } }), [[item, 0, 0], [currency('scrap', 10, 'cash'), 1, 0], [map('ashenForge', 1, { uid: 'map' }), 2, 0]]);
    ch.stash[0].grid.entries = [{ item: stashed, x: 0, y: 0 }];
    const before = JSON.stringify(ch), price = quote(item).scrap;
    for (const ids of [[], ['sell', 'sell'], ['sell', 'missing'], ['worn'], ['stashed'], ['cash'], ['map']]) expect(rules.sellItems(ch, ids, price).ok).toBe(false);
    expect(expectErr(rules.sellItems(ch, ['sell'], price + 1))).toContain('value changed');
    expect(withItemLocks(rules, () => new Set(['sell'])).sellItems(ch, ['sell'], price).ok).toBe(false);
    expect(JSON.stringify(ch)).toBe(before);
  });
});
