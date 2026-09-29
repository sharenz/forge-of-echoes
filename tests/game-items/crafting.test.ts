import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem } from '../../src/contracts/items';
import type { CurrencyId } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { MAGIC_AFFIX_COUNTS, RARE_AFFIX_COUNTS, getAffix } from '../../src/data/items';
import {
  applyEquipmentCurrency, craftEquipment, craftPreview, craftingTargetError, describeEquipment, equipmentCraftError,
  equipmentCraftPreview, findItem, generateEquipment, generateUnique,
} from '../../src/game/items';
import type { EquipmentSpec } from '../../src/game/items';
import { currency, equip, expectErr, expectOk, makeCharacter, map, withBackpack } from './fixtures';

const T = 'target';

/** A character with `item` at (0,0) and one stack per currency (uid = currency id) along the right side. */
function bench(item: EquipmentItem, currencies: Partial<Record<CurrencyId, number>>, rngState = 1): CharacterSave {
  const placements = Object.entries(currencies).map(([id, count], i) =>
    [currency(id as CurrencyId, count, id), 11 - (i % 6), Math.floor(i / 6)] as [ReturnType<typeof currency>, number, number]);
  return withBackpack(makeCharacter({ rngState }), [[item, 0, 0], ...placements]);
}

function item(spec: Omit<EquipmentSpec, 'uid'>): EquipmentItem {
  return equip({ ...spec, uid: T });
}

function target(ch: CharacterSave): EquipmentItem {
  return findItem(ch, T)!.item as EquipmentItem;
}

function count(ch: CharacterSave, uid: string): number {
  const f = findItem(ch, uid);
  return f && f.item.kind === 'currency' ? f.item.count : 0;
}

const MAGIC_RING: Omit<EquipmentSpec, 'uid'> = {
  baseId: 'emberRing', itemLevel: 60, rarity: 'magic',
  affixes: [{ affixId: 'life', tier: 5, value: 30 }, { affixId: 'coldResistance', tier: 5, value: 22 }],
};

describe('validation (nothing is consumed on failure)', () => {
  it('keeps map and equipment currencies apart', () => {
    const m = map('map1');
    const ch = withBackpack(bench(item(MAGIC_RING), { mapDust: 3, scrap: 3 }), [[m, 0, 4]]);
    expect(craftingTargetError(ch, 'mapDust', T)).toBe('Map Dust can only be applied to maps.');
    expect(craftingTargetError(ch, 'scrap', 'map1')).toBe('Forge Scrap can only be applied to equipment.');
    expect(craftingTargetError(ch, 'scrap', 'scrap')).toMatch(/Choose an item/);
    expect(craftingTargetError(ch, 'missing', T)).toMatch(/no longer available/);
    expect(craftingTargetError(ch, 'scrap', 'missing')).toMatch(/no longer exists/);
    expect(craftingTargetError(ch, 'scrap', T)).toBeNull();
    expectErr(applyEquipmentCurrency(ch, 'mapDust', T));
  });

  it('rejects uniques, finished items and crafts the item cannot afford', () => {
    const uniqueItem = { ...generateUnique('cinderwalkers', createRng(1)), uid: T };
    expect(craftingTargetError(bench(uniqueItem, { scrap: 1 }), 'scrap', T)).toBe('Unique items cannot be crafted.');

    const finished = item({ ...MAGIC_RING, stability: 0 });
    expect(craftingTargetError(bench(finished, { seal: 1 }), 'seal', T)).toMatch(/Finished/);

    const low = item({ ...MAGIC_RING, stability: 2 });
    const ch = bench(low, { catalyst: 1 });
    expect(craftingTargetError(ch, 'catalyst', T)).toBe('Tempering Catalyst needs 3 Stability; this item has 2 left.');
    const r = applyEquipmentCurrency(ch, 'catalyst', T, 0);
    expectErr(r);
    expect(count(ch, 'catalyst')).toBe(1);
  });
});

describe('Kindling Shard', () => {
  it('turns a normal item magic with 1–2 affixes', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const ch = bench(item({ baseId: 'ashwoodWand', itemLevel: 30, rarity: 'normal' }), { kindling: 2 }, seed);
      const out = expectOk(applyEquipmentCurrency(ch, 'kindling', T));
      const it = target(out.character);
      expect(it.rarity).toBe('magic');
      expect(it.name).toBeNull();
      expect(it.stability).toBe(7);
      counts.add(it.affixes.length);
      const kinds = it.affixes.map((a) => getAffix(a.affixId)!.kind);
      if (it.affixes.length === 2) expect(kinds).toEqual(['prefix', 'suffix']);
      expect(it.history.at(-1)).toMatch(/^Kindling Shard awakened /);
      expect(count(out.character, 'kindling')).toBe(1);
      expect(out.character.stats.itemsCrafted).toBe(1);
      expect(out.character.rngState).not.toBe(seed);
      expect(out.kind).toBe('success');
      expect(out.targetUid).toBe(T);
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('only works on normal items', () => {
    expect(craftingTargetError(bench(item(MAGIC_RING), { kindling: 1 }), 'kindling', T))
      .toBe('Kindling Shard only works on Normal items.');
  });
});

describe('Forge Scrap', () => {
  const spec: Omit<EquipmentSpec, 'uid'> = {
    baseId: 'boneTalisman', itemLevel: 80, rarity: 'rare', name: 'Bone Vow',
    affixes: [
      { affixId: 'life', tier: 2, value: 51, sealed: true },
      { affixId: 'spellDamage', tier: 2, value: 53, fractured: true },
      { affixId: 'fireDamage', tier: 4, value: 33 },
      { affixId: 'castSpeed', tier: 4, value: 12 },
    ],
  };

  it('rerolls unsealed, unfractured values within their tiers and breaks the seal', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const out = expectOk(applyEquipmentCurrency(bench(item(spec), { scrap: 1 }, seed), 'scrap', T));
      const it = target(out.character);
      const by = (id: string) => it.affixes.find((a) => a.affixId === id)!;
      expect(by('life').value).toBe(51);
      expect(by('life').sealed).toBeUndefined();
      expect(by('spellDamage')).toEqual({ affixId: 'spellDamage', tier: 2, value: 53, fractured: true });
      expect(by('fireDamage').tier).toBe(4);
      expect(by('fireDamage').value).toBeGreaterThanOrEqual(33);
      expect(by('fireDamage').value).toBeLessThanOrEqual(37);
      seen.add(by('fireDamage').value);
      expect(it.history.at(-1)).toBe('Forge Scrap rerolled 2 values (Hale sealed)');
      expect(count(out.character, 'scrap')).toBe(0);
      expect(findItem(out.character, 'scrap')).toBeNull();
    }
    expect(seen.size).toBe(5);
  });

  it('rejects items whose values cannot change', () => {
    expect(craftingTargetError(bench(item({ baseId: 'emberRing', itemLevel: 5, rarity: 'normal' }), { scrap: 1 }), 'scrap', T))
      .toMatch(/needs an item with affixes/);
    const locked = item({
      baseId: 'ashwoodWand', itemLevel: 80, rarity: 'rare', name: 'Ash Veil',
      affixes: [
        { affixId: 'fireDamage', tier: 3, fractured: true },
        { affixId: 'coldDamage', tier: 3, sealed: true },
        { affixId: 'splintering', tier: 1 },
      ],
    });
    expect(craftingTargetError(bench(locked, { scrap: 1 }), 'scrap', T)).toMatch(/No affix value can change/);
  });
});

describe('Reforging Ember', () => {
  it('reforges into a rare with 3–6 affixes, keeping sealed and fractured affixes', () => {
    const totals = new Map<number, number>();
    const N = 1500;
    for (let seed = 0; seed < N; seed++) {
      const start = item({
        baseId: 'rivetedCoat', itemLevel: 70, rarity: 'magic',
        affixes: [{ affixId: 'life', tier: 3, value: 45, sealed: true }, { affixId: 'strength', tier: 4, value: 22, fractured: true }],
      });
      const res = expectOk(craftEquipment(start, 'reforge', createRng(seed)));
      const it = res.item;
      expect(it.rarity).toBe('rare');
      expect(it.name).toMatch(/^\w+ \w+$/);
      expect(it.affixes.length).toBeGreaterThanOrEqual(3);
      expect(it.affixes.length).toBeLessThanOrEqual(6);
      expect(it.affixes.find((a) => a.affixId === 'life')).toEqual({ affixId: 'life', tier: 3, value: 45 });
      expect(it.affixes.find((a) => a.affixId === 'strength')).toEqual({ affixId: 'strength', tier: 4, value: 22, fractured: true });
      expect(new Set(it.affixes.map((a) => getAffix(a.affixId)!.group)).size).toBe(it.affixes.length);
      totals.set(it.affixes.length, (totals.get(it.affixes.length) ?? 0) + 1);
    }
    const w = RARE_AFFIX_COUNTS.reduce((s, c) => s + c.weight, 0);
    for (const c of RARE_AFFIX_COUNTS) {
      expect(Math.abs((totals.get(c.count) ?? 0) / N - c.weight / w)).toBeLessThan(0.04);
    }
  });

  it('works on normal items and records the new name', () => {
    const out = expectOk(applyEquipmentCurrency(bench(item({ baseId: 'chainBelt', itemLevel: 20, rarity: 'normal' }), { reforge: 1 }), 'reforge', T));
    const it = target(out.character);
    expect(it.rarity).toBe('rare');
    expect(it.history.at(-1)).toBe(`Reforging Ember reforged it into ${it.name}, a Rare with ${it.affixes.length} affixes`);
    expect(it.stability).toBe(6);
  });
});

describe('Essences', () => {
  it('turns a normal item magic with one tagged affix', () => {
    for (let seed = 0; seed < 100; seed++) {
      const out = expectOk(applyEquipmentCurrency(bench(item({ baseId: 'ashwoodWand', itemLevel: 40, rarity: 'normal' }), { essenceEmber: 1 }, seed), 'essenceEmber', T));
      const it = target(out.character);
      expect(it.rarity).toBe('magic');
      expect(it.affixes).toHaveLength(1);
      expect(getAffix(it.affixes[0].affixId)!.tags).toContain('fire');
      expect(it.stability).toBe(6);
      expect(out.message).toBe(`Ember Essence added ${getAffix(it.affixes[0].affixId)!.name} (T${it.affixes[0].tier})`);
    }
  });

  it('fills the free slot of a one-affix magic item and upgrades a full magic item to rare', () => {
    const one = item({ baseId: 'ashwoodWand', itemLevel: 40, rarity: 'magic', affixes: [{ affixId: 'fireDamage', tier: 5 }] });
    const r1 = expectOk(craftEquipment(one, 'essenceEmber', createRng(1)));
    expect(r1.item.rarity).toBe('magic');
    expect(r1.item.affixes.map((a) => a.affixId)).toEqual(['fireDamage', 'igniteChance']);

    const two = item({ ...MAGIC_RING });
    const r2 = expectOk(craftEquipment(two, 'essenceStorm', createRng(2)));
    expect(r2.item.rarity).toBe('rare');
    expect(r2.item.name).toMatch(/^\w+ \w+$/);
    expect(r2.item.affixes).toHaveLength(3);
    expect(r2.item.affixes.some((a) => getAffix(a.affixId)!.tags.includes('lightning'))).toBe(true);
  });

  it('explains why an essence cannot apply', () => {
    const belt = item({ baseId: 'chainBelt', itemLevel: 50, rarity: 'normal' });
    expect(craftingTargetError(bench(belt, { essenceSwift: 1 }), 'essenceSwift', T)).toBe('No speed affix can roll on a Belt.');

    const full = item({
      baseId: 'ashwoodWand', itemLevel: 44, rarity: 'magic',
      affixes: [{ affixId: 'fireDamage', tier: 5 }, { affixId: 'igniteChance', tier: 4 }],
    });
    // Magic with 2 → would become rare, but both fire affixes of a wand are present already.
    expect(craftingTargetError(bench(full, { essenceEmber: 1 }), 'essenceEmber', T))
      .toBe('Every fire affix this item can roll is already on it.');

    const ring = item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Rust Loop',
      affixes: [
        { affixId: 'life', tier: 5 }, { affixId: 'focus', tier: 5 }, { affixId: 'coldDamage', tier: 5 },
        { affixId: 'coldResistance', tier: 5 }, { affixId: 'lightningResistance', tier: 5 }, { affixId: 'dexterity', tier: 5 },
      ],
    });
    expect(craftingTargetError(bench(ring, { essenceEmber: 1 }), 'essenceEmber', T))
      .toBe('No room for another fire affix: prefixes or suffixes are full (3/3 prefixes, 3/3 suffixes).');

    const magicPrefix = item({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [{ affixId: 'life', tier: 5 }] });
    // Swift on a ring: only Cast Speed (suffix) qualifies, and the suffix slot is free.
    expect(craftingTargetError(bench(magicPrefix, { essenceSwift: 1 }), 'essenceSwift', T)).toBeNull();
    const magicSuffix = item({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [{ affixId: 'castSpeed', tier: 5 }] });
    expect(craftingTargetError(bench(magicSuffix, { essenceSwift: 1 }), 'essenceSwift', T))
      .toBe('Every speed affix this item can roll is already on it.');
    const magicCold = item({ baseId: 'emberRing', itemLevel: 60, rarity: 'magic', affixes: [{ affixId: 'coldResistance', tier: 5 }] });
    expect(craftingTargetError(bench(magicCold, { essenceSwift: 1 }), 'essenceSwift', T))
      .toBe('No room for another speed affix: suffixes are full (0/1 prefixes, 1/1 suffixes).');
  });

  it('rolls exactly the odds its preview shows', () => {
    const start = item({ baseId: 'ironVisor', itemLevel: 45, rarity: 'normal' });
    const preview = equipmentCraftPreview(start, 'essenceVital');
    const total = preview.outcomes.reduce((s, o) => s + o.chance, 0);
    expect(total).toBeCloseTo(1, 12);
    const freq = new Map<string, number>();
    const N = 12000;
    const rng = createRng(77);
    for (let i = 0; i < N; i++) {
      const res = expectOk(craftEquipment(start, 'essenceVital', rng));
      const name = getAffix(res.item.affixes[0].affixId)!.name;
      freq.set(name, (freq.get(name) ?? 0) + 1);
    }
    for (const o of preview.outcomes) expect(Math.abs((freq.get(o.label) ?? 0) / N - o.chance), o.label).toBeLessThan(0.015);
  });
});

describe('Tempering Catalyst', () => {
  const spec: Omit<EquipmentSpec, 'uid'> = {
    baseId: 'emberRing', itemLevel: 80, rarity: 'rare', name: 'Pyre Mark',
    affixes: [
      { affixId: 'life', tier: 4, value: 39 },
      { affixId: 'fireDamage', tier: 2, value: 50 },
      { affixId: 'voidResistance', tier: 1, value: 24 },
      { affixId: 'strength', tier: 5, value: 18, sealed: true },
      { affixId: 'dexterity', tier: 6, value: 14, fractured: true },
    ],
  };

  it('upgrades the chosen affix one tier and rerolls it inside the new tier', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ch = bench(item(spec), { catalyst: 1 }, seed);
      const idx = target(ch).affixes.findIndex((a) => a.affixId === 'life');
      const out = expectOk(applyEquipmentCurrency(ch, 'catalyst', T, idx));
      const it = target(out.character);
      const life = it.affixes.find((a) => a.affixId === 'life')!;
      expect(life.tier).toBe(3);
      expect(life.value).toBeGreaterThanOrEqual(40);
      expect(life.value).toBeLessThanOrEqual(46);
      expect(it.stability).toBe(4);
      expect(it.history.at(-1)).toBe('Tempering Catalyst raised Hale to T3 (of Brawn sealed)');
      expect(it.affixes.find((a) => a.affixId === 'fireDamage')).toEqual({ affixId: 'fireDamage', tier: 2, value: 50 });
    }
  });

  it('refuses best tiers, item-level gates, protected affixes and a missing choice', () => {
    const it = item(spec);
    const idx = (id: string) => it.affixes.findIndex((a) => a.affixId === id);
    const ch = bench(it, { catalyst: 1 });
    expect(expectErr(applyEquipmentCurrency(ch, 'catalyst', T))).toBe('Choose an affix for Tempering Catalyst.');
    expect(equipmentCraftError(it, 'catalyst', idx('voidResistance'))).toBe('of the Veil is already at its best tier.');
    expect(equipmentCraftError(it, 'catalyst', idx('fireDamage'))).toBe('T1 Blazing needs item level 84 (this item is 80).');
    expect(equipmentCraftError(it, 'catalyst', idx('strength'))).toBe('of Brawn is sealed and protected from this craft.');
    expect(equipmentCraftError(it, 'catalyst', idx('dexterity'))).toBe('of Grace is fractured and immune to crafting.');
    expect(equipmentCraftError(it, 'catalyst', 42)).toBe('Choose an affix on the item.');
    expect(craftingTargetError(ch, 'catalyst', T)).toBeNull();
    const maxed = item({ baseId: 'emberRing', itemLevel: 80, rarity: 'magic', affixes: [{ affixId: 'voidResistance', tier: 1 }] });
    expect(craftingTargetError(bench(maxed, { catalyst: 1 }), 'catalyst', T)).toBe('No affix on this item can be upgraded further.');
  });
});

describe('Forge Solvent', () => {
  it('removes the lowest-tier unprotected affix, breaking ties at random', () => {
    const removed = new Set<string>();
    for (let seed = 0; seed < 120; seed++) {
      const it = item({
        baseId: 'ironVisor', itemLevel: 72, rarity: 'rare', name: 'Hex Crown',
        affixes: [
          { affixId: 'life', tier: 7 }, { affixId: 'focus', tier: 7 }, { affixId: 'armourFlat', tier: 2 },
          { affixId: 'strength', tier: 8, sealed: true }, { affixId: 'coldResistance', tier: 8, fractured: true },
        ],
      });
      const res = expectOk(craftEquipment(it, 'solvent', createRng(seed)));
      const gone = it.affixes.filter((a) => !res.item.affixes.some((b) => b.affixId === a.affixId)).map((a) => a.affixId);
      expect(gone).toHaveLength(1);
      expect(['life', 'focus']).toContain(gone[0]);
      removed.add(gone[0]);
      expect(res.item.rarity).toBe('rare');
      expect(res.item.affixes.find((a) => a.affixId === 'strength')!.sealed).toBeUndefined();
    }
    expect(removed).toEqual(new Set(['life', 'focus']));
  });

  it('makes an item normal when its last affix goes', () => {
    const it = item({ baseId: 'ashwoodWand', itemLevel: 20, rarity: 'rare', name: 'Ash Bite', affixes: [{ affixId: 'fireDamage', tier: 7 }] });
    const res = expectOk(craftEquipment(it, 'solvent', createRng(1)));
    expect(res.item.rarity).toBe('normal');
    expect(res.item.name).toBeNull();
    expect(res.item.affixes).toEqual([]);
    expect(res.message).toBe('Forge Solvent removed Blazing (T7); the item is Normal again');
    expect(describeEquipment(res.item).title).toBe('Ashwood Wand');
  });

  it('rejects items where every affix is protected', () => {
    const it = item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'magic',
      affixes: [{ affixId: 'life', tier: 5, sealed: true }, { affixId: 'coldResistance', tier: 5, fractured: true }],
    });
    expect(equipmentCraftError(it, 'solvent')).toBe('No affix can be removed: sealed and fractured affixes are protected.');
  });
});

describe('Binding Seal', () => {
  it('seals one affix for exactly one operation at no stability cost', () => {
    let ch = bench(item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Oath Loop',
      affixes: [{ affixId: 'life', tier: 8 }, { affixId: 'fireDamage', tier: 5 }, { affixId: 'strength', tier: 3 }],
    }), { seal: 2, solvent: 2 });
    const lifeIdx = target(ch).affixes.findIndex((a) => a.affixId === 'life');
    ch = expectOk(applyEquipmentCurrency(ch, 'seal', T, lifeIdx)).character;
    expect(target(ch).affixes[lifeIdx].sealed).toBe(true);
    expect(target(ch).stability).toBe(7);
    expect(target(ch).history.at(-1)).toBe('Binding Seal sealed Hale');
    expect(craftingTargetError(ch, 'seal', T)).toBe('An affix is already sealed. Only one seal at a time.');
    expect(equipmentCraftError(target(ch), 'seal', lifeIdx)).toBe('Hale is already sealed.');

    // Life is the lowest tier, but sealed: solvent takes Blazing (T5) instead, then the seal breaks.
    ch = expectOk(applyEquipmentCurrency(ch, 'solvent', T)).character;
    const after = target(ch);
    expect(after.affixes.map((a) => a.affixId)).toEqual(['life', 'strength']);
    expect(after.affixes.some((a) => a.sealed)).toBe(false);
    expect(after.history.at(-1)).toBe('Forge Solvent removed Blazing (T5) (Hale sealed)');
    // The seal is gone, so the next solvent removes Hale.
    ch = expectOk(applyEquipmentCurrency(ch, 'solvent', T)).character;
    expect(target(ch).affixes.map((a) => a.affixId)).toEqual(['strength']);
  });

  it('cannot seal fractured affixes and never causes scars', () => {
    const it = item({
      baseId: 'glassboneWand', itemLevel: 40, rarity: 'magic', stability: 1,
      affixes: [{ affixId: 'fireDamage', tier: 5, fractured: true }, { affixId: 'castSpeed', tier: 5 }],
    });
    expect(equipmentCraftError(it, 'seal', 0)).toBe('Blazing is fractured, which is already permanent.');
    for (let seed = 0; seed < 100; seed++) {
      const res = expectOk(craftEquipment(it, 'seal', createRng(seed), 1));
      expect(res.item.scars).toEqual([]);
      expect(res.item.stability).toBe(1);
      expect(res.kind).toBe('success');
    }
  });
});

describe('Fracture Core', () => {
  it('locks an affix permanently against every other currency', () => {
    let ch = bench(item({
      baseId: 'boneTalisman', itemLevel: 80, rarity: 'rare', name: 'Vigil Hymn',
      affixes: [{ affixId: 'spellDamage', tier: 3, value: 48, sealed: true }, { affixId: 'life', tier: 6 }, { affixId: 'castSpeed', tier: 5 }],
    }), { fractureCore: 2, scrap: 3, reforge: 1, catalyst: 1 });
    const idx = target(ch).affixes.findIndex((a) => a.affixId === 'spellDamage');
    ch = expectOk(applyEquipmentCurrency(ch, 'fractureCore', T, idx)).character;
    let it = target(ch);
    expect(it.affixes[idx]).toEqual({ affixId: 'spellDamage', tier: 3, value: 48, fractured: true });
    expect(it.stability).toBe(4);
    expect(it.history.at(-1)).toBe('Fracture Core fractured Arcane (T3)');
    expect(craftingTargetError(ch, 'fractureCore', T)).toBe('This item already has a fractured affix.');
    expect(equipmentCraftError(it, 'catalyst', idx)).toMatch(/fractured/);

    ch = expectOk(applyEquipmentCurrency(ch, 'scrap', T)).character;
    ch = expectOk(applyEquipmentCurrency(ch, 'reforge', T)).character;
    it = target(ch);
    expect(it.affixes.find((a) => a.affixId === 'spellDamage')).toEqual({ affixId: 'spellDamage', tier: 3, value: 48, fractured: true });
  });
});

describe('stability, scars and Finished', () => {
  const ring = (stability: number, scars: EquipmentSpec['scars'] = []) => item({ ...MAGIC_RING, stability, scars });

  it('adds scars only at low stability, at the documented 35%', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(expectOk(craftEquipment(ring(5), 'scrap', createRng(seed))).item.scars).toEqual([]);
    }
    let scarred = 0;
    const N = 3000;
    for (let seed = 0; seed < N; seed++) {
      const res = expectOk(craftEquipment(ring(3), 'scrap', createRng(seed)));
      if (res.item.scars.length) {
        scarred++;
        expect(res.kind).toBe('scar');
        expect(res.item.history.at(-1)).toMatch(/^Scarred: \w+ \(/);
        expect(res.message).toMatch(/ · Scarred: /);
      }
    }
    expect(Math.abs(scarred / N - 0.35)).toBeLessThan(0.03);
  });

  it('starts the scar risk one step earlier on Glassbone', () => {
    const glass = item({ baseId: 'glassboneWand', itemLevel: 40, rarity: 'magic', affixes: [{ affixId: 'fireDamage', tier: 5 }], stability: 4 });
    const ash = item({ baseId: 'ashwoodWand', itemLevel: 40, rarity: 'magic', affixes: [{ affixId: 'fireDamage', tier: 5 }], stability: 4 });
    expect(equipmentCraftPreview(glass, 'scrap').scarChance).toBe(0.35);
    expect(equipmentCraftPreview(ash, 'scrap').scarChance).toBe(0);
  });

  it('caps scars at two distinct ones that fit the base', () => {
    const two = ring(2, [{ scarId: 'frail', value: 6 }, { scarId: 'dim', value: 8 }]);
    expect(equipmentCraftPreview(two, 'scrap').scarChance).toBe(0);
    for (let seed = 0; seed < 200; seed++) {
      expect(expectOk(craftEquipment(two, 'scrap', createRng(seed))).item.scars).toHaveLength(2);
    }
    for (let seed = 0; seed < 400; seed++) {
      const res = expectOk(craftEquipment(ring(2, [{ scarId: 'frail', value: 6 }]), 'scrap', createRng(seed)));
      const ids = res.item.scars.map((s) => s.scarId);
      expect(new Set(ids).size).toBe(ids.length);
      // Rings have no armour/evasion property, so these scars can never apply.
      expect(ids).not.toContain('brittle');
      expect(ids).not.toContain('frayed');
    }
  });

  it('finishes the item at 0 stability and blocks further crafting', () => {
    const ch = bench(ring(1), { scrap: 2 });
    const out = expectOk(applyEquipmentCurrency(ch, 'scrap', T));
    const it = target(out.character);
    expect(it.stability).toBe(0);
    expect(it.history).toContain('Finished at 0 Stability');
    expect(['finished', 'scar']).toContain(out.kind);
    expect(out.message).toMatch(/Finished$/);
    expect(craftingTargetError(out.character, 'scrap', T)).toBe('This item is Finished and can no longer be crafted.');
    expect(describeEquipment(it).headerLines).toContain('Finished');
  });
});

describe('bookkeeping', () => {
  it('crafts equipped and stashed items in place', () => {
    const ring = { ...item(MAGIC_RING), uid: 'eq' };
    let ch = bench(item({ baseId: 'emberRing', itemLevel: 1, rarity: 'normal' }), { scrap: 5 });
    ch = { ...ch, equipment: { ring2: ring } };
    const out = expectOk(applyEquipmentCurrency(ch, 'scrap', 'eq'));
    expect(out.character.equipment.ring2!.stability).toBe(6);
    expect(findItem(out.character, 'eq')!.location).toEqual({ kind: 'equipment', slot: 'ring2' });

    const stashed = { ...item(MAGIC_RING), uid: 'st' };
    let ch2 = bench(item({ baseId: 'emberRing', itemLevel: 1, rarity: 'normal' }), { scrap: 5 });
    ch2 = { ...ch2, stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: stashed, x: 3, y: 3 }] } }] };
    const out2 = expectOk(applyEquipmentCurrency(ch2, 'scrap', 'st'));
    expect(findItem(out2.character, 'st')!.location).toEqual({ kind: 'stash', tab: 0, x: 3, y: 3 });
  });

  it('is deterministic for the same character and pure', () => {
    const ch = bench(item({ baseId: 'ashwoodWand', itemLevel: 50, rarity: 'normal' }), { reforge: 3 }, 999);
    const snapshot = JSON.stringify(ch);
    const a = expectOk(applyEquipmentCurrency(ch, 'reforge', T));
    const b = expectOk(applyEquipmentCurrency(ch, 'reforge', T));
    expect(a).toEqual(b);
    expect(JSON.stringify(ch)).toBe(snapshot);
    // The advanced rng state makes the next craft different.
    const c = expectOk(applyEquipmentCurrency(a.character, 'reforge', T));
    expect(target(c.character).name === target(a.character).name && target(c.character).affixes.length === target(a.character).affixes.length
      && JSON.stringify(target(c.character).affixes) === JSON.stringify(target(a.character).affixes)).toBe(false);
  });

  it('writes one history line per craft', () => {
    let ch = bench(item({ baseId: 'ironrootWand', itemLevel: 60, rarity: 'normal' }), {
      essenceEmber: 1, seal: 1, reforge: 1, scrap: 1,
    });
    ch = expectOk(applyEquipmentCurrency(ch, 'essenceEmber', T)).character;
    ch = expectOk(applyEquipmentCurrency(ch, 'seal', T, 0)).character;
    ch = expectOk(applyEquipmentCurrency(ch, 'reforge', T)).character;
    ch = expectOk(applyEquipmentCurrency(ch, 'scrap', T)).character;
    const it = target(ch);
    expect(it.history).toHaveLength(4);
    expect(it.history[0]).toMatch(/^Ember Essence added /);
    expect(it.history[1]).toMatch(/^Binding Seal sealed /);
    expect(it.history[2]).toMatch(/^Reforging Ember reforged it into .* sealed\)$/);
    expect(it.history[3]).toMatch(/^Forge Scrap rerolled /);
    expect(ch.stats.itemsCrafted).toBe(4);
  });
});

describe('craft preview (exact odds)', () => {
  const parsePct = (line: string) => [...line.matchAll(/ (<?[\d.]+)%/g)]
    .reduce((s, m) => s + (m[1].startsWith('<') ? 0 : Number(m[1])), 0);

  it('returns the reason when the craft is impossible', () => {
    const ch = bench(item(MAGIC_RING), { kindling: 1 });
    expect(craftPreview(ch, 'kindling', T)).toEqual(['Kindling Shard only works on Normal items.']);
  });

  it('shows essence odds that sum to exactly 100%', () => {
    for (const baseId of ['ironVisor', 'chainBelt', 'boneTalisman', 'ashwoodWand', 'pathfinderBoots'] as const) {
      for (const ess of ['essenceVital', 'essenceEmber', 'essenceRime'] as const) {
        const ch = bench(item({ baseId, itemLevel: 70, rarity: 'normal' }), { [ess]: 1 });
        if (craftingTargetError(ch, ess, T)) continue;
        const lines = craftPreview(ch, ess, T);
        if (lines[0].startsWith('Adds the only ')) {
          expect(lines[0]).toMatch(/^Adds the only [a-z, ]+ affix that can roll here: [A-Za-z ]+\.$/);
        } else {
          expect(lines[0]).toMatch(/^Adds one of \d+ /);
          expect(parsePct(lines[0])).toBeCloseTo(100, 6);
        }
        expect(lines).toContain('The item becomes Magic.');
        expect(lines).toContain(`Costs 2 Stability, leaving ${BASE_STAB[baseId] - 2}.`);
      }
    }
  });

  it('shows kindling and reforge outcome distributions that sum to 100%, and exact affix odds', () => {
    const normal = item({ baseId: 'cinderOrb', itemLevel: 50, rarity: 'normal' });
    const kp = equipmentCraftPreview(normal, 'kindling');
    expect(kp.outcomes.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(1, 12);
    expect(parsePct(kp.lines[0])).toBeCloseTo(100, 6);
    const expectedCount = MAGIC_AFFIX_COUNTS.reduce((s, c) => s + c.count * c.weight, 0) / MAGIC_AFFIX_COUNTS.reduce((s, c) => s + c.weight, 0);
    expect(kp.inclusion.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(expectedCount, 9);

    // The DP must agree with what Kindling actually rolls.
    const freq = new Map<string, number>();
    const N = 12000;
    const rng = createRng(123);
    for (let i = 0; i < N; i++) {
      const res = expectOk(craftEquipment(normal, 'kindling', rng));
      for (const a of res.item.affixes) {
        const name = getAffix(a.affixId)!.name;
        freq.set(name, (freq.get(name) ?? 0) + 1);
      }
    }
    for (const o of kp.inclusion) expect(Math.abs((freq.get(o.label) ?? 0) / N - o.chance), o.label).toBeLessThan(0.015);

    const rp = equipmentCraftPreview(normal, 'reforge');
    expect(rp.outcomes.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(1, 12);
    expect(parsePct(rp.lines[0])).toBeCloseTo(100, 6);
    const rareExpected = RARE_AFFIX_COUNTS.reduce((s, c) => s + c.count * c.weight, 0) / RARE_AFFIX_COUNTS.reduce((s, c) => s + c.weight, 0);
    expect(rp.inclusion.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(rareExpected, 9);
  });

  it('merges reforge totals when protected affixes exceed the rolled count', () => {
    const it = item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Dusk Coil',
      affixes: [
        { affixId: 'life', tier: 5, sealed: true }, { affixId: 'focus', tier: 5 }, { affixId: 'coldResistance', tier: 5, fractured: true },
      ],
    });
    const p = equipmentCraftPreview(it, 'reforge');
    expect(p.outcomes.map((o) => o.label)).toEqual(['3 affixes', '4 affixes', '5 affixes', '6 affixes']);
    expect(p.lines).toContain('Keeps Hale (sealed) and of Thaw (fractured)');
    expect(p.inclusion.find((o) => o.label === 'Hale')).toBeUndefined();
  });

  it('lists solvent ties, catalyst targets, costs and scar risk', () => {
    const it = item({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Char Wake', stability: 3,
      affixes: [{ affixId: 'life', tier: 7 }, { affixId: 'fireDamage', tier: 3 }, { affixId: 'coldResistance', tier: 7 }],
    });
    const solvent = equipmentCraftPreview(it, 'solvent');
    expect(solvent.lines[0]).toBe('Removes one of 2 lowest-tier affixes: Hale (T7) 50% · of Thaw (T7) 50%');
    expect(solvent.lines).toContain('Costs 1 Stability, leaving 2.');
    expect(solvent.lines).toContain('Scar risk 35%: Stability drops to 2 (scars can form at 2 or less).');

    const cat = equipmentCraftPreview({ ...it, stability: 8 }, 'catalyst');
    expect(cat.lines).toContain('Hale T7: upgrades to T6 (22–27)');
    expect(cat.lines).toContain('Blazing T3: T2 needs item level 72');
    expect(cat.lines).toContain('No scar risk.');

    const fin = equipmentCraftPreview({ ...it, stability: 1 }, 'scrap');
    expect(fin.lines).toContain('Stability reaches 0: the item will be Finished.');
  });
});

const BASE_STAB = { ironVisor: 9, chainBelt: 8, boneTalisman: 7, ashwoodWand: 8, pathfinderBoots: 8 } as const;

describe('random rolls stay legal through long crafting sessions', () => {
  it('never breaks item invariants across thousands of random crafts', () => {
    const rng = createRng(4242);
    const currencies: CurrencyId[] = [
      'kindling', 'scrap', 'reforge', 'essenceEmber', 'essenceRime', 'essenceStorm', 'essenceVital', 'essenceSwift',
      'catalyst', 'solvent', 'seal', 'fractureCore',
    ];
    const bases = ['ashwoodWand', 'glassboneWand', 'cinderOrb', 'ironVisor', 'rivetedCoat', 'boneTalisman', 'chainBelt', 'voidSignet'] as const;
    for (let n = 0; n < 250; n++) {
      let it = generateEquipment(bases[n % bases.length], rng.int(1, 100), (['normal', 'magic', 'rare'] as const)[n % 3], rng, { uid: T });
      for (let step = 0; step < 30; step++) {
        const cur = rng.pick(currencies);
        const idx = it.affixes.length ? rng.int(0, it.affixes.length - 1) : undefined;
        const res = craftEquipment(it, cur, rng, idx);
        if (!res.ok) continue;
        const next = res.value.item;
        expect(next.stability).toBeGreaterThanOrEqual(0);
        expect(next.stability).toBeLessThanOrEqual(next.maxStability);
        expect(next.scars.length).toBeLessThanOrEqual(2);
        expect(next.affixes.filter((a) => a.sealed).length).toBeLessThanOrEqual(1);
        expect(next.affixes.filter((a) => a.fractured).length).toBeLessThanOrEqual(1);
        const kinds = next.affixes.map((a) => getAffix(a.affixId)!.kind);
        const limits = next.rarity === 'magic' ? 1 : next.rarity === 'rare' ? 3 : 0;
        expect(kinds.filter((k) => k === 'prefix').length).toBeLessThanOrEqual(limits);
        expect(kinds.filter((k) => k === 'suffix').length).toBeLessThanOrEqual(limits);
        expect(new Set(next.affixes.map((a) => getAffix(a.affixId)!.group)).size).toBe(next.affixes.length);
        for (const a of next.affixes) {
          const t = getAffix(a.affixId)!.tiers.find((x) => x.tier === a.tier)!;
          expect(t.itemLevel).toBeLessThanOrEqual(next.itemLevel);
          expect(a.value).toBeGreaterThanOrEqual(t.min);
          expect(a.value).toBeLessThanOrEqual(t.max);
        }
        if (next.rarity === 'rare') expect(next.name).toBeTruthy();
        else expect(next.name).toBeNull();
        expect(next.history.length).toBeGreaterThanOrEqual(Math.min(40, it.history.length + 1));
        it = next;
      }
    }
  });
});
