// The Crafting Bench (GAME_SPEC §12): recipe data, tier cap and item-level gating, prices, availability
// reasons, payment from the backpack, stability, history, clearing, and the interplay with every currency.
import { describe, expect, it } from 'vitest';
import type { BenchRecipe } from '../../src/contracts/game';
import type { CharacterSave, EquipmentItem, Item, RolledAffix } from '../../src/contracts/items';
import type { BaseId, CurrencyId } from '../../src/contracts/content';
import { BASE_IDS } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import {
  AFFIXES, BASES, BENCH_BEST_TIER, BENCH_LUCK_PRICE_MULTIPLIER, BENCH_PRICE_BANDS, BENCH_RECIPES, BENCH_RECIPE_PREFIX,
  CURRENCIES, getAffix,
} from '../../src/data/items';
import { affixAllowedOnBase } from '../../src/game/items/affix-pool';
import {
  applyBenchRecipe, applyEquipmentCurrency, backpackCurrency, benchCost, benchCurrency, benchEssence, benchRecipes, benchTier,
  clearCraftedAffix, craftPreview, craftingTargetError, describeEquipment, findItem, formatRangeLine, generateUnique,
  itemModifiers,
} from '../../src/game/items';
import type { EquipmentSpec } from '../../src/game/items';
import { currency, equip, expectErr, expectOk, makeCharacter, map, withBackpack } from './fixtures';

const T = 'target';

/** A character with `item` at (0,0) and one backpack stack per currency (uid = currency id) on the right. */
function bench(item: Item, currencies: Partial<Record<CurrencyId, number>> = {}, rngState = 1): CharacterSave {
  const placements = Object.entries(currencies).map(([id, count], i) =>
    [currency(id as CurrencyId, count, id), 11 - (i % 6), Math.floor(i / 6)] as [Item, number, number]);
  return withBackpack(makeCharacter({ rngState }), [[item, 0, 0], ...placements]);
}

function item(spec: Omit<EquipmentSpec, 'uid'>): EquipmentItem {
  return equip({ ...spec, uid: T });
}

function target(ch: CharacterSave, uid = T): EquipmentItem {
  return findItem(ch, uid)!.item as EquipmentItem;
}

function count(ch: CharacterSave, id: CurrencyId): number {
  return ch.backpack.entries.reduce((s, e) => s + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0);
}

function recipe(ch: CharacterSave, id: string, uid = T): BenchRecipe {
  const r = benchRecipes(ch, uid).find((x) => x.id === id);
  if (!r) throw new Error(`recipe ${id} not listed`);
  return r;
}

const RICH: Partial<Record<CurrencyId, number>> = {
  scrap: 40, essenceEmber: 5, essenceRime: 5, essenceStorm: 5, essenceVital: 5, essenceSwift: 5,
};

// A crafted T4 life line on a high item-level ring (for interplay tests).
const CRAFTED_LIFE: RolledAffix = { affixId: 'life', tier: 4, value: 35, crafted: true };

describe('recipe data', () => {
  it('resolves every recipe to a benchable affix, once each, prefixes first', () => {
    const ids = new Set<string>();
    const affixIds = new Set<string>();
    let seenSuffix = false;
    for (const r of BENCH_RECIPES) {
      const def = getAffix(r.affixId);
      expect(def, r.id).toBeDefined();
      expect(r.id).toBe(`${BENCH_RECIPE_PREFIX}${r.affixId}`);
      expect(ids.has(r.id)).toBe(false);
      expect(affixIds.has(r.affixId)).toBe(false);
      ids.add(r.id);
      affixIds.add(r.affixId);
      // Every recipe has a tier the bench may grant (T4 or worse), unlocked at item level 1.
      expect(def!.tiers.some((t) => t.tier >= BENCH_BEST_TIER), r.id).toBe(true);
      expect(benchTier(def!, 1), r.id).not.toBeNull();
      if (def!.kind === 'suffix') seenSuffix = true;
      else expect(seenSuffix, `${r.id} is a prefix after a suffix`).toBe(false);
    }
    // One recipe per affix family; only "of Splintering" (a lone T1) is left out.
    expect(AFFIXES.filter((a) => !affixIds.has(a.id)).map((a) => a.name)).toEqual(['of Splintering']);
  });

  it('prices climb with the tier and an essence always matches the affix tags', () => {
    for (let i = 1; i < BENCH_PRICE_BANDS.length; i++) {
      const [a, b] = [BENCH_PRICE_BANDS[i - 1], BENCH_PRICE_BANDS[i]];
      expect(b.minItemLevel).toBeGreaterThan(a.minItemLevel);
      expect(b.scrap).toBeGreaterThan(a.scrap);
      expect(b.scrapWithoutEssence).toBeGreaterThan(a.scrapWithoutEssence);
      expect(a.scrapWithoutEssence).toBeGreaterThan(a.scrap);
    }
    expect(BENCH_PRICE_BANDS[0].minItemLevel).toBe(1);
    for (const r of BENCH_RECIPES) {
      const def = getAffix(r.affixId)!;
      const essence = benchEssence(def);
      if (essence) expect(CURRENCIES[essence].essenceTags!.some((t) => def.tags.includes(t)), r.id).toBe(true);
      else {
        const essenceTags = new Set(Object.values(CURRENCIES).flatMap((c) => c.essenceTags ?? []));
        expect(def.tags.some((t) => essenceTags.has(t)), r.id).toBe(false);
      }
    }
  });

  it('picks the essence by the affix tags (element first, then life / defence / resistance, then speed)', () => {
    const e = (id: string) => benchEssence(getAffix(id)!);
    expect(e('fireDamage')).toBe('essenceEmber');
    expect(e('fireResistance')).toBe('essenceEmber');
    expect(e('igniteChance')).toBe('essenceEmber');
    expect(e('elementalDamage')).toBe('essenceEmber');
    expect(e('coldResistance')).toBe('essenceRime');
    expect(e('chillChance')).toBe('essenceRime');
    expect(e('lightningDamage')).toBe('essenceStorm');
    expect(e('shockChance')).toBe('essenceStorm');
    expect(e('life')).toBe('essenceVital');
    expect(e('lifeRegen')).toBe('essenceVital');
    expect(e('armourFlat')).toBe('essenceVital');
    expect(e('evasionPercent')).toBe('essenceVital');
    expect(e('voidResistance')).toBe('essenceVital');
    expect(e('allResistances')).toBe('essenceVital');
    expect(e('castSpeed')).toBe('essenceSwift');
    expect(e('moveSpeed')).toBe('essenceSwift');
    expect(e('projectileSpeed')).toBe('essenceSwift');
    for (const id of ['critChance', 'critMultiplier', 'itemRarity', 'itemQuantity', 'focus', 'focusRegen', 'spellDamage', 'intelligence']) {
      expect(e(id), id).toBeNull();
    }
  });

  it('charges luck affixes a premium, on par with an essence recipe of the same band', () => {
    const luck = BENCH_RECIPES.map((r) => getAffix(r.affixId)!).filter((d) => d.tags.includes('luck'));
    expect(luck.map((d) => d.id).sort()).toEqual(['itemQuantity', 'itemRarity']);
    const scrapOf = (price: { currencyId: CurrencyId; count: number }[]) => price.find((p) => p.currencyId === 'scrap')!.count;
    for (const def of luck) {
      for (const tier of def.tiers.filter((t) => t.tier >= BENCH_BEST_TIER)) {
        let band = BENCH_PRICE_BANDS[0];
        for (const b of BENCH_PRICE_BANDS) if (tier.itemLevel >= b.minItemLevel) band = b;
        const price = benchCost(def, tier);
        expect(price, `${def.id} T${tier.tier}`).toEqual([
          { currencyId: 'scrap', count: Math.ceil(band.scrapWithoutEssence * BENCH_LUCK_PRICE_MULTIPLIER) },
        ]);
        // Dearer than any other Scrap-only recipe of the band (critical strike, focus, caster, utility).
        const crit = getAffix('critChance')!;
        const critTier = crit.tiers.find((t) => t.itemLevel === tier.itemLevel);
        if (critTier) expect(scrapOf(price)).toBeGreaterThan(scrapOf(benchCost(crit, critTier)));
      }
    }
    // The six luck slots (helmet, gloves, boots, amulet, two rings) at T4 no longer come for ~70 Scrap.
    const fortunate = getAffix('itemRarity')!;
    const t4 = fortunate.tiers.find((t) => t.tier === 4)!;
    expect(scrapOf(benchCost(fortunate, t4)) * 6).toBeGreaterThanOrEqual(180);
  });
});

describe('recipe list', () => {
  it('lists exactly the recipes that fit each base (class allow-list and base property)', () => {
    for (const baseId of BASE_IDS) {
      const ch = bench(item({ baseId, itemLevel: 50, rarity: 'normal' }), RICH);
      const listed = benchRecipes(ch, T);
      const expected = BENCH_RECIPES.filter((r) => affixAllowedOnBase(getAffix(r.affixId)!, BASES[baseId]));
      expect(listed.map((r) => r.id), baseId).toEqual(expected.map((r) => r.id));
      expect(listed.length, baseId).toBeGreaterThan(5);
      for (const r of listed) {
        const def = getAffix(r.affixId)!;
        const tier = def.tiers.find((t) => t.tier === r.tier)!;
        expect(r.kind).toBe(def.kind);
        expect(r.label).toBe(formatRangeLine(def, tier.min, tier.max));
        expect(r.stabilityCost).toBe(1);
        expect(r.tier).toBeGreaterThanOrEqual(BENCH_BEST_TIER);
        expect(r.tags.length).toBeGreaterThan(0);
        expect(r.available, `${baseId} ${r.id}: ${r.reason}`).toBe(true);
        expect(r.reason).toBeUndefined();
      }
    }
  });

  it('labels a recipe with its tier range, tooltip-style', () => {
    const ch = bench(item({ baseId: 'emberRing', itemLevel: 80, rarity: 'normal' }), RICH);
    expect(recipe(ch, 'bench:life')).toMatchObject({
      affixId: 'life', kind: 'prefix', tier: 4, label: '+(34–39) to maximum Life', tags: ['Life'],
      cost: [{ currencyId: 'scrap', count: 9 }, { currencyId: 'essenceVital', count: 1 }],
    });
    expect(recipe(ch, 'bench:fireDamage').label).toBe('(33–37)% increased Fire Damage');
    expect(recipe(ch, 'bench:lifeRegen').label).toBe('Regenerate (12–14) Life per second');
    expect(recipe(ch, 'bench:fireResistance')).toMatchObject({ kind: 'suffix', label: '+(23–25)% to Fire Resistance', tags: ['Fire', 'Resistance'] });
    expect(recipe(ch, 'bench:allResistances')).toMatchObject({ tier: 4, label: '+8% to all Resistances' });
    expect(recipe(ch, 'bench:castSpeed').cost).toEqual([{ currencyId: 'scrap', count: 9 }, { currencyId: 'essenceSwift', count: 1 }]);
    // Luck pays a premium on the Scrap-only price (12 at this band).
    expect(recipe(ch, 'bench:itemRarity').cost).toEqual([{ currencyId: 'scrap', count: 38 }]);
  });

  it('is empty for anything that is not equipment, or that does not exist', () => {
    const m = map('the-map');
    const ch = withBackpack(bench(item({ baseId: 'emberRing', itemLevel: 20, rarity: 'normal' }), RICH), [[m, 0, 4]]);
    expect(benchRecipes(ch, 'the-map')).toEqual([]);
    expect(benchRecipes(ch, 'scrap')).toEqual([]);
    expect(benchRecipes(ch, 'nope')).toEqual([]);
    expect(benchRecipes(ch, 42 as unknown as string)).toEqual([]);
  });
});

describe('tier: the best the item level allows, capped at T4', () => {
  const tierAt = (affixId: string, ilvl: number) => benchTier(getAffix(affixId)!, ilvl)!.tier;

  it('follows each ladder up to T4 and never beyond', () => {
    // 10 tiers: T10 @1 through T4 @48; T3 @60 and above are never granted.
    expect([1, 5, 6, 13, 14, 23, 24, 35, 36, 47, 48, 75, 100].map((l) => tierAt('life', l)))
      .toEqual([10, 10, 9, 8, 8, 7, 7, 6, 6, 5, 4, 4, 4]);
    // 9 tiers: T9 @1 through T4 @46.
    expect([1, 8, 18, 29, 30, 72].map((l) => tierAt('focus', l))).toEqual([9, 8, 7, 6, 6, 4]);
    // 8 tiers: T8 @1 through T4 @44.
    expect([1, 9, 10, 24, 70].map((l) => tierAt('critMultiplier', l))).toEqual([8, 8, 7, 6, 4]);
    // 7 tiers: T7 @1 through T4 @40.
    expect([1, 13, 14, 68].map((l) => tierAt('allResistances', l))).toEqual([7, 6, 6, 4]);
  });

  it('prices the granted tier by the item level that unlocks it', () => {
    const life = getAffix('life')!;
    const price = (ilvl: number) => benchCost(life, benchTier(life, ilvl)!);
    expect(price(1)).toEqual([{ currencyId: 'scrap', count: 2 }, { currencyId: 'essenceVital', count: 1 }]);
    expect(price(6)[0].count).toBe(3);
    expect(price(14)[0].count).toBe(3);
    expect(price(24)[0].count).toBe(5);
    expect(price(36)[0].count).toBe(7);
    expect(price(90)[0].count).toBe(9);
    const crit = getAffix('critChance')!;
    expect(benchCost(crit, benchTier(crit, 1)!)).toEqual([{ currencyId: 'scrap', count: 4 }]);
    expect(benchCost(crit, benchTier(crit, 80)!)).toEqual([{ currencyId: 'scrap', count: 15 }]);
    // Never cheaper for a better tier, on every recipe.
    for (const r of BENCH_RECIPES) {
      const def = getAffix(r.affixId)!;
      let last = 0;
      for (let ilvl = 1; ilvl <= 100; ilvl++) {
        const c = benchCost(def, benchTier(def, ilvl)!)[0].count;
        expect(c, `${r.id} @${ilvl}`).toBeGreaterThanOrEqual(last);
        last = c;
      }
    }
  });

  it('rolls the value inside the granted tier', () => {
    const values = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const ch = bench(item({ baseId: 'emberRing', itemLevel: 20, rarity: 'normal' }), RICH, seed);
      const out = expectOk(applyBenchRecipe(ch, T, 'bench:life'));
      const added = target(out.character).affixes.find((a) => a.crafted)!;
      expect(added).toMatchObject({ affixId: 'life', tier: 7, crafted: true });
      expect(added.value).toBeGreaterThanOrEqual(18);
      expect(added.value).toBeLessThanOrEqual(21);
      values.add(added.value);
    }
    expect(values.size).toBe(4);
  });
});

describe('availability and reasons', () => {
  const reasonOf = (ch: CharacterSave, id: string) => recipe(ch, id).reason;

  it('refuses uniques and Finished items', () => {
    const u = { ...generateUnique('ruinheartBand', createRng(1)), uid: T };
    const all = benchRecipes(bench(u, RICH), T);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => !r.available && r.reason === 'Unique items cannot use bench recipes.')).toBe(true);
    expect(expectErr(applyBenchRecipe(bench(u, RICH), T, 'bench:life'))).toBe('Unique items cannot use bench recipes.');

    const done = bench(item({ baseId: 'emberRing', itemLevel: 40, rarity: 'normal', stability: 0 }), RICH);
    expect(reasonOf(done, 'bench:life')).toBe('This item is Finished. Repair Stability at the bench to continue.');
  });

  it('allows one crafted affix per item', () => {
    const ch = bench(item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [CRAFTED_LIFE],
    }), RICH);
    const all = benchRecipes(ch, T);
    expect(all.every((r) => !r.available)).toBe(true);
    expect(reasonOf(ch, 'bench:castSpeed'))
      .toBe('This item already has a crafted affix, “Hale” (T4). Clear it to craft another.');
  });

  it('names the affix group that is already on the item', () => {
    const ch = bench(item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', affixes: [{ affixId: 'life', tier: 5 }, { affixId: 'castSpeed', tier: 3 }],
    }), RICH);
    expect(reasonOf(ch, 'bench:life')).toBe('This item already has “Hale” (T5).');
    // Suffix names are quoted too, so the sentence reads right.
    expect(reasonOf(ch, 'bench:castSpeed')).toBe('This item already has “of Haste” (T3).');
    expect(recipe(ch, 'bench:focus').available).toBe(true);
  });

  it('respects the item\'s own prefix / suffix room (Normal counts as Magic; the bench never makes a Rare)', () => {
    const normal = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal' }), RICH);
    expect(benchRecipes(normal, T).every((r) => r.available)).toBe(true);

    const magic = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [{ affixId: 'focus', tier: 5 }] }), RICH);
    expect(reasonOf(magic, 'bench:life')).toBe('No room for another prefix: 1/1 prefixes on this Magic item.');
    expect(recipe(magic, 'bench:castSpeed').available).toBe(true);

    const full = bench(item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare',
      affixes: [{ affixId: 'life', tier: 5 }, { affixId: 'focus', tier: 5 }, { affixId: 'fireDamage', tier: 5 }, { affixId: 'castSpeed', tier: 5 }],
    }), RICH);
    expect(reasonOf(full, 'bench:coldDamage')).toBe('No room for another prefix: 3/3 prefixes on this Rare item.');
    expect(recipe(full, 'bench:coldResistance').available).toBe(true);
  });

  it('checks the price against the backpack and the Crafting Stash, naming what is missing', () => {
    const ch = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal' }), { scrap: 3 });
    expect(reasonOf(ch, 'bench:life'))
      .toBe('Not enough currency in your backpack or Crafting Stash: needs 9 Forge Scrap (you have 3) and 1 Vital Essence (you have 0).');
    expect(benchRecipes(ch, T).some((r) => r.id === 'bench:critChance')).toBe(false); // not a ring affix
    expect(reasonOf(ch, 'bench:itemRarity'))
      .toBe('Not enough currency in your backpack or Crafting Stash: needs 38 Forge Scrap (you have 3).');
    // Currency in normal stash tabs does not count.
    const stashed = { ...ch, stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [
      { item: currency('scrap', 40, 'stash-scrap'), x: 0, y: 0 }, { item: currency('essenceVital', 9, 'stash-vital'), x: 1, y: 0 },
    ] } }] };
    expect(recipe(stashed, 'bench:life').available).toBe(false);
    expect(expectErr(applyBenchRecipe(stashed, T, 'bench:life'))).toMatch(/^Not enough currency in your backpack or Crafting Stash/);
    // The Crafting Stash does: the backpack pays first, the slot covers the rest.
    const banked = { ...ch, currencyStash: { scrap: 100, essenceVital: 2 } };
    expect(benchCurrency(banked, 'scrap')).toBe(103);
    expect(recipe(banked, 'bench:life').available).toBe(true);
    const out = expectOk(applyBenchRecipe(banked, T, 'bench:life')).character;
    expect(backpackCurrency(out, 'scrap')).toBe(0);
    expect(out.currencyStash).toEqual({ scrap: 94, essenceVital: 1 });
  });

  it('rejects unknown recipes, foreign targets and affixes that do not fit the base', () => {
    const robe = bench(item({ baseId: 'ashenRobe', itemLevel: 40, rarity: 'normal' }), RICH);
    expect(benchRecipes(robe, T).some((r) => r.affixId === 'armourFlat')).toBe(false);
    expect(expectErr(applyBenchRecipe(robe, T, 'bench:armourFlat'))).toBe('“Plated” only fits bases with Armour.');
    expect(expectErr(applyBenchRecipe(robe, T, 'bench:moveSpeed'))).toBe('“of Striding” cannot be crafted on a Body Armour.');
    for (const bad of ['bench:splintering', 'life', 'constructor', '__proto__', 7, null]) {
      expect(expectErr(applyBenchRecipe(robe, T, bad as unknown as string))).toBe('The Crafting Bench has no such recipe.');
    }
    expect(expectErr(applyBenchRecipe(robe, 'nope', 'bench:life'))).toBe('That item no longer exists.');
    expect(expectErr(applyBenchRecipe(robe, 'scrap', 'bench:life'))).toBe('The Crafting Bench only works on equipment.');
    const m = withBackpack(robe, [[map('mp'), 5, 4]]);
    expect(expectErr(applyBenchRecipe(m, 'mp', 'bench:life'))).toBe('The Crafting Bench only works on equipment.');
  });
});

describe('applying a recipe', () => {
  it('pays from backpack stacks (smallest first), adds a crafted affix, costs 1 Stability and logs the history', () => {
    const ring = item({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal' });
    let ch = withBackpack(makeCharacter({ rngState: 99 }), [
      [ring, 0, 0], [currency('scrap', 5, 's5'), 5, 0], [currency('scrap', 3, 's3a'), 6, 0], [currency('scrap', 3, 's3b'), 7, 0],
      [currency('essenceVital', 2, 'vital'), 8, 0],
    ]);
    const before = JSON.stringify(ch);
    const out = expectOk(applyBenchRecipe(ch, T, 'bench:life'));
    expect(JSON.stringify(ch)).toBe(before); // pure
    ch = out.character;
    const it = target(ch);
    expect(it.rarity).toBe('magic');
    expect(it.name).toBeNull();
    expect(it.stability).toBe(ring.stability - 1);
    expect(it.scars).toEqual([]);
    expect(it.affixes).toHaveLength(1);
    expect(it.affixes[0]).toMatchObject({ affixId: 'life', tier: 4, crafted: true });
    expect(it.history.at(-1)).toBe('Bench: added Hale (T4)');
    expect(out.message).toBe(`Bench: added Hale (T4): +${it.affixes[0].value} to maximum Life`);
    expect(out.kind).toBe('success');
    expect(out.targetUid).toBe(T);
    // 9 Scrap: both stacks of 3, then 3 of the 5. One Vital Essence.
    expect(findItem(ch, 's3a')).toBeNull();
    expect(findItem(ch, 's3b')).toBeNull();
    expect((findItem(ch, 's5')!.item as { count: number }).count).toBe(2);
    expect(count(ch, 'essenceVital')).toBe(1);
    expect(ch.stats.itemsCrafted).toBe(1);
    expect(ch.rngState).not.toBe(99);
    // Deterministic: same character, same result.
    expect(applyBenchRecipe(withBackpack(makeCharacter({ rngState: 99 }), [
      [ring, 0, 0], [currency('scrap', 5, 's5'), 5, 0], [currency('scrap', 3, 's3a'), 6, 0], [currency('scrap', 3, 's3b'), 7, 0],
      [currency('essenceVital', 2, 'vital'), 8, 0],
    ]), T, 'bench:life')).toEqual({ ok: true, value: out });
  });

  it('keeps a Magic or Rare item\'s rarity and name, and leaves seals in place', () => {
    const rare = item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Grave Coil',
      affixes: [{ affixId: 'life', tier: 5, sealed: true }, { affixId: 'castSpeed', tier: 4 }],
    });
    const out = target(expectOk(applyBenchRecipe(bench(rare, RICH), T, 'bench:coldResistance')).character);
    expect(out.rarity).toBe('rare');
    expect(out.name).toBe('Grave Coil');
    expect(out.affixes.map((a) => a.affixId)).toEqual(['life', 'castSpeed', 'coldResistance']);
    expect(out.affixes[0].sealed).toBe(true);
    expect(out.affixes.filter((a) => a.crafted).map((a) => a.affixId)).toEqual(['coldResistance']);
    expect(out.history.at(-1)).toBe('Bench: added of Thaw (T4)');
  });

  it('never rolls a scar, and Finishes the item at 0 Stability', () => {
    for (let seed = 0; seed < 100; seed++) {
      const low = item({ baseId: 'glassboneWand', itemLevel: 40, rarity: 'normal', stability: 1 });
      const out = expectOk(applyBenchRecipe(bench(low, RICH, seed), T, 'bench:castSpeed'));
      const it = target(out.character);
      expect(it.scars).toEqual([]);
      expect(it.stability).toBe(0);
      expect(out.kind).toBe('finished');
      expect(out.message).toMatch(/· Finished$/);
      expect(it.history.slice(-2)).toEqual(['Bench: added of Haste (T5)', 'Finished at 0 Stability']);
    }
  });

  it('crafts items in the stash and equipped items, paying from the backpack', () => {
    const ring = equip({ baseId: 'emberRing', itemLevel: 30, rarity: 'normal', uid: 'worn' });
    const tome = equip({ baseId: 'runedTome', itemLevel: 30, rarity: 'normal', uid: 'stashed' });
    let ch = withBackpack(makeCharacter({ equipment: { ring1: ring } }), [
      [currency('scrap', 40, 'scrap'), 0, 0], [currency('scrap', 10, 'scrap-small'), 1, 0],
    ]);
    ch = { ...ch, stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: tome, x: 0, y: 0 }] } }] };
    ch = expectOk(applyBenchRecipe(ch, 'worn', 'bench:itemRarity')).character;
    expect(ch.equipment.ring1!.affixes[0]).toMatchObject({ affixId: 'itemRarity', crafted: true });
    // Smallest stack first: the 10 are spent entirely, the rest comes out of the 40.
    expect(findItem(ch, 'scrap-small')).toBeNull();
    ch = expectOk(applyBenchRecipe(ch, 'stashed', 'bench:critChance')).character;
    expect(target(ch, 'stashed').affixes[0]).toMatchObject({ affixId: 'critChance', crafted: true });
    expect(count(ch, 'scrap')).toBe(50 - 23 - 12);
  });

  it('changes nothing when it fails', () => {
    const ch = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal' }), { scrap: 1, essenceVital: 1 });
    expectErr(applyBenchRecipe(ch, T, 'bench:life'));
    expect(count(ch, 'scrap')).toBe(1);
    expect(target(ch).affixes).toEqual([]);
  });
});

describe('clearing the crafted affix', () => {
  it('removes it for free and keeps the Stability spent', () => {
    let ch = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal' }), RICH);
    ch = expectOk(applyBenchRecipe(ch, T, 'bench:life')).character;
    const crafted = target(ch);
    const scrap = count(ch, 'scrap');
    const out = expectOk(clearCraftedAffix(ch, T));
    const it = target(out.character);
    expect(it.affixes).toEqual([]);
    expect(it.rarity).toBe('normal');
    expect(it.name).toBeNull();
    expect(it.stability).toBe(crafted.stability);
    expect(count(out.character, 'scrap')).toBe(scrap);
    expect(out.character.rngState).toBe(ch.rngState);
    expect(out.message).toBe('Bench: cleared Hale (T4); the item is Normal again');
    expect(it.history.at(-1)).toBe(out.message);
    // And the bench is open again.
    expect(recipe(out.character, 'bench:life').available).toBe(true);
  });

  it('keeps a Rare item Rare (like Solvent) and works on a Finished item', () => {
    const rare = item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Ember Bite', stability: 0,
      affixes: [{ affixId: 'focus', tier: 5 }, { ...CRAFTED_LIFE }, { affixId: 'castSpeed', tier: 4 }],
    });
    const out = expectOk(clearCraftedAffix(bench(rare), T));
    const it = target(out.character);
    expect(it.rarity).toBe('rare');
    expect(it.name).toBe('Ember Bite');
    expect(it.affixes.map((a) => a.affixId)).toEqual(['focus', 'castSpeed']);
    expect(out.message).toBe('Bench: cleared Hale (T4)');
  });

  it('explains when there is nothing to clear', () => {
    const plain = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [{ affixId: 'life', tier: 5 }] }));
    expect(expectErr(clearCraftedAffix(plain, T))).toBe('This item has no crafted affix to clear.');
    expect(expectErr(clearCraftedAffix(plain, 'nope'))).toBe('That item no longer exists.');
    const u = { ...generateUnique('cinderwalkers', createRng(1)), uid: T };
    expect(expectErr(clearCraftedAffix(bench(u), T))).toBe('Unique items cannot use bench recipes.');
  });
});

describe('crafted affixes and the currencies', () => {
  // Stored in canonical order: Hale (crafted, index 0), Lucid (1), of Haste (2).
  const RING: Omit<EquipmentSpec, 'uid'> = {
    baseId: 'emberRing', itemLevel: 80, rarity: 'rare', name: 'Hollow Loop',
    affixes: [{ affixId: 'focus', tier: 6 }, { ...CRAFTED_LIFE }, { affixId: 'castSpeed', tier: 3 }],
  };

  it('Scrap rerolls a crafted value within its tier and it stays crafted', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const out = expectOk(applyEquipmentCurrency(bench(item(RING), { scrap: 1 }, seed), 'scrap', T));
      const life = target(out.character).affixes.find((a) => a.affixId === 'life')!;
      expect(life).toMatchObject({ tier: 4, crafted: true });
      expect(life.value).toBeGreaterThanOrEqual(34);
      expect(life.value).toBeLessThanOrEqual(39);
      seen.add(life.value);
    }
    expect(seen.size).toBeGreaterThan(4);
    expect(craftPreview(bench(item(RING), { scrap: 1 }), 'scrap', T)[0]).toContain('Hale (crafted) 34–39');
  });

  it('Reforge replaces a crafted affix unless it is sealed', () => {
    for (let seed = 0; seed < 30; seed++) {
      const out = target(expectOk(applyEquipmentCurrency(bench(item(RING), { reforge: 1 }, seed), 'reforge', T)).character);
      expect(out.affixes.some((a) => a.crafted)).toBe(false);
    }
    expect(craftPreview(bench(item(RING), { reforge: 1 }), 'reforge', T))
      .toContain('The crafted affix Hale (T4) is reforged away like the others.');
    const sealed = item({ ...RING, affixes: [{ affixId: 'focus', tier: 6 }, { ...CRAFTED_LIFE, sealed: true }, { affixId: 'castSpeed', tier: 3 }] });
    for (let seed = 0; seed < 30; seed++) {
      const out = target(expectOk(applyEquipmentCurrency(bench(sealed, { reforge: 1 }, seed), 'reforge', T)).character);
      const kept = out.affixes.filter((a) => a.crafted);
      expect(kept).toEqual([{ affixId: 'life', tier: 4, value: 35, crafted: true }]);
    }
    expect(craftPreview(bench(sealed, { reforge: 1 }), 'reforge', T).join('\n')).toContain('Hale (sealed, crafted)');
  });

  it('Solvent may remove it like any other affix', () => {
    const ring = item({ ...RING, affixes: [{ affixId: 'focus', tier: 4 }, { ...CRAFTED_LIFE }, { affixId: 'castSpeed', tier: 3 }] });
    const lines = craftPreview(bench(ring, { solvent: 1 }), 'solvent', T);
    expect(lines[0]).toMatch(/Removes one of 2 lowest-tier affixes: .*Hale \(T4, crafted\) 50%/);
    const removed = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const out = target(expectOk(applyEquipmentCurrency(bench(ring, { solvent: 1 }, seed), 'solvent', T)).character);
      const gone = ['focus', 'life'].find((id) => !out.affixes.some((a) => a.affixId === id))!;
      removed.add(gone);
    }
    expect([...removed].sort()).toEqual(['focus', 'life']);
  });

  it('Seal protects it', () => {
    const ch = bench(item(RING), { seal: 1 });
    expect(craftPreview(ch, 'seal', T).join('\n')).toContain('Hale (crafted)');
    expect(target(ch).affixes[0]).toEqual(CRAFTED_LIFE);
    const out = target(expectOk(applyEquipmentCurrency(ch, 'seal', T, 0)).character);
    expect(out.affixes[0]).toEqual({ ...CRAFTED_LIFE, sealed: true });
  });

  it('Fracture Core cannot fracture it', () => {
    const ch = bench(item(RING), { fractureCore: 1 });
    expect(craftingTargetError(ch, 'fractureCore', T)).toBeNull(); // the other affixes still can be
    expect(expectErr(applyEquipmentCurrency(ch, 'fractureCore', T, 0)))
      .toBe('Hale is bench-crafted: crafted affixes cannot be fractured.');
    expect(target(expectOk(applyEquipmentCurrency(ch, 'fractureCore', T, 1)).character).affixes[1].fractured).toBe(true);
    expect(craftPreview(ch, 'fractureCore', T)).toContain('The crafted affix Hale (T4) cannot be fractured.');
    const only = bench(item({ baseId: 'emberRing', itemLevel: 80, rarity: 'magic', affixes: [{ ...CRAFTED_LIFE }] }), { fractureCore: 1 });
    expect(craftingTargetError(only, 'fractureCore', T)).toBe('Crafted affixes cannot be fractured, and this item has no other affix.');
  });

  it('Tempering Catalyst cannot raise it above T4', () => {
    const ch = bench(item(RING), { catalyst: 1 });
    expect(expectErr(applyEquipmentCurrency(ch, 'catalyst', T, 0)))
      .toBe('Hale is bench-crafted: crafted affixes cannot be raised above T4.');
    expect(craftPreview(ch, 'catalyst', T)).toContain('Hale (crafted) T4: crafted affixes stop at T4');
    // An ordinary T4 goes to T3 on the same item.
    const plain = item({ ...RING, affixes: [{ affixId: 'focus', tier: 6 }, { affixId: 'life', tier: 4, value: 36 }, { affixId: 'castSpeed', tier: 3 }] });
    const up = target(expectOk(applyEquipmentCurrency(bench(plain, { catalyst: 1 }), 'catalyst', T, 0)).character);
    expect(up.affixes[0]).toMatchObject({ affixId: 'life', tier: 3 });
    // Below T4 the item level decides, as for any affix.
    const low = item({ baseId: 'emberRing', itemLevel: 28, rarity: 'magic', affixes: [{ affixId: 'life', tier: 6, value: 22, crafted: true }] });
    expect(expectErr(applyEquipmentCurrency(bench(low, { catalyst: 1 }), 'catalyst', T, 0)))
      .toBe('T5 Hale needs item level 38 (this item is 28).');
  });

  it('counts toward the room an Essence needs', () => {
    // A Magic ring whose one prefix is the crafted Hale: the prefix is taken, so of the Ember Essence's ring
    // affixes (Blazing, Prismatic — prefixes — and of the Kiln) only the suffix of the Kiln can be added.
    const ch = bench(item({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [{ ...CRAFTED_LIFE }] }), { essenceEmber: 1 });
    expect(craftPreview(ch, 'essenceEmber', T)[0]).toBe('Adds the only fire affix that can roll here: of the Kiln.');
    const out = target(expectOk(applyEquipmentCurrency(ch, 'essenceEmber', T)).character);
    expect(out.affixes.map((a) => [a.affixId, a.crafted === true])).toEqual([['life', true], ['fireResistance', false]]);
    expect(out.rarity).toBe('magic');
  });
});

describe('tooltips and modifiers mark crafted affixes', () => {
  it('flags the crafted line only and labels its stat source', () => {
    const ring = item({
      baseId: 'emberRing', itemLevel: 80, rarity: 'rare', name: 'Hollow Loop',
      affixes: [{ affixId: 'focus', tier: 6 }, { ...CRAFTED_LIFE }, { affixId: 'castSpeed', tier: 3 }],
    });
    const d = describeEquipment(ring);
    expect(d.affixes.map((l) => l.crafted === true)).toEqual([true, false, false]);
    expect(d.affixes[0].text).toBe('+35 to maximum Life');
    expect(d.hint).toBe('The crafted affix can be removed for free at the Crafting Bench.');
    expect(itemModifiers(ring).find((m) => m.stat === 'maxLife')!.source).toBe('Hollow Loop (Hale T4, crafted)');
    expect(describeEquipment(item({ baseId: 'emberRing', itemLevel: 1, rarity: 'normal' })).hint).toMatch(/Crafting Bench/);
  });
});

describe('every base and item level', () => {
  it('can apply and clear every listed recipe', () => {
    for (const baseId of BASE_IDS as readonly BaseId[]) {
      for (const ilvl of [1, 20, 45, 90]) {
        const ch = bench(item({ baseId, itemLevel: ilvl, rarity: 'normal' }), RICH, ilvl);
        for (const r of benchRecipes(ch, T)) {
          expect(r.available, `${baseId} ${r.id}`).toBe(true);
          const out = expectOk(applyBenchRecipe(ch, T, r.id));
          const it = target(out.character);
          expect(it.affixes).toEqual([expect.objectContaining({ affixId: r.affixId, tier: r.tier, crafted: true })]);
          for (const c of r.cost) expect(count(out.character, c.currencyId), `${r.id} ${c.currencyId}`).toBe(RICH[c.currencyId]! - c.count);
          const cleared = target(expectOk(clearCraftedAffix(out.character, T)).character);
          expect(cleared.affixes).toEqual([]);
          expect(cleared.rarity).toBe('normal');
        }
      }
    }
  });
});
