// Power rework slice P2 (docs/power-rework/power-curve.md 10): the new affixes, bench recipes, Umbral Essence, utility flasks and
// the ten uniques. Data checks here; the sim half of the flasks is tests/sim/flask-utility.test.ts.
import { describe, expect, it } from 'vitest';
import { PLAYER_FLAGS, UNIQUE_IDS } from '../../src/contracts/content';
import type { AffixTag } from '../../src/contracts/items';
import { STAT_IDS } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import {
  AFFIXES, AFFIX_VERSION, BASES, BENCH_BEST_TIER, BENCH_RECIPES, CURRENCIES, FLASKS, STAT_LABEL, STAT_TEXT, TAG_LABEL, UNIQUES, getAffix,
} from '../../src/data/items';
import {
  benchCost, benchEssence, benchRecipes, benchTier, describeEquipment, describeFlask, flaskStack, generateUnique, itemFlags, itemModifiers,
  pickRandomUnique, uniqueIdsFor,
} from '../../src/game/items';
import { currency, equip, makeCharacter, withBackpack } from './fixtures';

const PEN_IDS = ['firePen', 'coldPen', 'lightningPen', 'voidPen', 'physicalPen'] as const;
const range = (id: string) => getAffix(id)!.tiers.map((t) => [t.min, t.max]);

describe('new affixes (power-curve 10.1)', () => {
  it('has the elemental penetration ladder: 2-3 up to 14-15 over seven tiers, T4 at item level 40, T1 at 78', () => {
    for (const id of PEN_IDS) {
      const a = getAffix(id)!;
      expect(a.kind, id).toBe('suffix');
      expect(a.mode, id).toBe('flat');
      expect(a.tags, id).toContain('penetration');
      expect(a.classes, id).toEqual(['wand', 'sceptre', 'focus', 'amulet']);
      expect(range(id), id).toEqual([[14, 15], [12, 13], [10, 11], [8, 9], [6, 7], [4, 5], [2, 3]]);
      expect(a.tiers.map((t) => t.itemLevel), id).toEqual([78, 66, 54, 40, 26, 12, 1]);
      expect(a.group, id).toBe(`pen:${id.replace('Pen', '')}`);
    }
    // One exclusive group per type: an item can carry fire and cold penetration together.
    expect(new Set(PEN_IDS.map((id) => getAffix(id)!.group)).size).toBe(5);
  });

  it('has Prisms at half value, and the damage / scope / resistance / flask affixes with their ladders and slots', () => {
    expect(range('elementalPen')).toEqual([[8, 8], [7, 7], [6, 6], [5, 5], [4, 4], [3, 3], [1, 2]]);
    expect(getAffix('elementalPen')!.classes).toEqual(['focus', 'amulet', 'ring']);
    // Entropic and Concussive reuse the 10-tier element ladder (T1 51-56%).
    expect(range('voidDamage')).toEqual(range('fireDamage'));
    expect(range('physicalDamage')).toEqual(range('fireDamage'));
    expect(getAffix('voidDamage')).toMatchObject({ name: 'Entropic', kind: 'prefix', mode: 'increased' });
    expect(getAffix('voidDamage')!.classes).toEqual(['wand', 'sceptre', 'focus', 'amulet', 'ring']);
    expect(getAffix('physicalDamage')).toMatchObject({ name: 'Concussive', kind: 'prefix' });
    expect(getAffix('physicalDamage')!.classes).toEqual(['wand', 'sceptre', 'focus', 'amulet']);
    expect(range('damageOverTime')[0]).toEqual([54, 63]);
    expect(range('damageOverTime')[7]).toEqual([10, 14]);
    expect(getAffix('damageOverTime')!.classes).toEqual(['wand', 'sceptre', 'focus', 'gloves']);
    expect(range('projectileDamage')[0]).toEqual([36, 41]);
    expect(range('projectileDamage')[7]).toEqual([8, 12]);
    expect(getAffix('projectileDamage')!.classes).toEqual(['wand', 'gloves']);
    expect(range('areaDamage')).toEqual(range('projectileDamage'));
    expect(getAffix('areaDamage')!.classes).toEqual(['focus', 'amulet', 'gloves']);
    for (const id of ['damageOverTime', 'projectileDamage', 'areaDamage']) {
      expect(getAffix(id)!.tiers, id).toHaveLength(8);
      expect(getAffix(id)!.kind, id).toBe('suffix');
    }
    // Warding moves the cap by 1 to 3 points: the 75 base never reaches the 85 ceiling.
    expect(range('maxResistance').map(([a]) => a)).toEqual([3, 3, 2, 2, 1, 1, 1]);
    expect(getAffix('maxResistance')!.classes).toEqual(['amulet', 'ring']);
    expect(getAffix('maxResistance')!.tiers[0].itemLevel).toBe(78);
    // Reserves: a belt suffix that shortens the 40-kill base to 25.
    expect(getAffix('flaskChargeOnKill')!.classes).toEqual(['belt']);
    expect(Math.max(...getAffix('flaskChargeOnKill')!.tiers.map((t) => t.max))).toBe(15);
  });

  it('keeps AFFIX_VERSION at 2 and changes no existing affix (old saves load unchanged)', () => {
    expect(AFFIX_VERSION).toBe(2);
    expect(range('fireDamage')[0]).toEqual([51, 56]);
    expect(range('castSpeed')[0]).toEqual([19, 20]);
    expect(AFFIXES.slice(0, 15).map((a) => a.id)).toEqual([
      'life', 'focus', 'addedSpellDamage', 'spellDamage', 'fireDamage', 'coldDamage', 'lightningDamage', 'elementalDamage',
      'voidDamage', 'physicalDamage', 'armourFlat', 'evasionFlat', 'armourPercent', 'evasionPercent', 'itemRarity',
    ]);
  });

  it('has text and labels for every new stat and tag, and every affix rolls on a base that exists', () => {
    for (const stat of ['firePen', 'coldPen', 'lightningPen', 'voidPen', 'physicalPen', 'elementalPen', 'projectileDamage', 'areaDamage',
      'damageOverTime', 'maxResistance', 'extraChains', 'flaskChargeOnKill'] as const) {
      expect(STAT_IDS).toContain(stat);
      expect(Object.values(STAT_TEXT[stat]).join(' '), stat).not.toMatch(/TODO/);
      expect(STAT_LABEL[stat], stat).not.toMatch(/TODO/);
    }
    expect(TAG_LABEL.penetration).toBe('Penetration');
    const tags = new Set<AffixTag>(AFFIXES.flatMap((a) => a.tags));
    for (const t of tags) expect(TAG_LABEL[t], t).toBeTruthy();
    for (const a of AFFIXES) expect(Object.values(BASES).some((b) => a.classes.includes(b.itemClass)), a.id).toBe(true);
  });
});

describe('bench and essences', () => {
  const wand = (itemLevel: number) => equip({ baseId: 'ashwoodWand', itemLevel, rarity: 'normal', uid: 'w' });
  const ch = (itemLevel: number, extra = {}) => withBackpack(makeCharacter(), [
    [wand(itemLevel), 0, 0], [currency('scrap', 40, 'scrap'), 11, 0], [currency('essenceEmber', 3, 'ember'), 10, 0],
    [currency('essenceRime', 3, 'rime'), 9, 0], [currency('essenceStorm', 3, 'storm'), 8, 0], [currency('umbralEssence', 3, 'umbral'), 7, 0],
    ...Object.entries(extra).map(([id, n], i) => [currency(id as never, n as number, id), 11 - i, 1] as [never, number, number]),
  ]);

  it('offers T4 penetration (8-9) on a wand from item level 40, and nothing better however high the item level', () => {
    for (const id of PEN_IDS) {
      const def = getAffix(id)!;
      expect(benchTier(def, 39)!.tier).toBe(5);
      expect(benchTier(def, 40)!.tier).toBe(BENCH_BEST_TIER);
      expect(benchTier(def, 90)!.tier).toBe(BENCH_BEST_TIER);
      expect(def.tiers.find((t) => t.tier === 4)).toMatchObject({ min: 8, max: 9, itemLevel: 40 });
    }
    const recipes = benchRecipes(ch(45), 'w');
    for (const id of PEN_IDS) {
      const r = recipes.find((x) => x.id === `bench:${id}`)!;
      expect(r, id).toBeDefined();
      expect(r.tier, id).toBe(4);
      expect(r.kind, id).toBe('suffix');
      expect(r.available, `${id}: ${r.reason}`).toBe(true);
      expect(r.label, id).toMatch(/Penetrate \(8–9\)% of enemy \w+ Resistance/);
      expect(r.tags, id).toContain('Penetration');
    }
    expect(recipes.find((x) => x.id === 'bench:maxResistance')).toBeUndefined();
    expect(recipes.find((x) => x.id === 'bench:elementalPen')).toBeUndefined(); // wands cannot roll Prisms
    for (const id of ['voidDamage', 'physicalDamage', 'damageOverTime', 'projectileDamage']) expect(recipes.some((x) => x.id === `bench:${id}`), id).toBe(true);
  });

  it('prices each penetration recipe with the essence of its type and 7 to 12 Scrap', () => {
    const e = (id: string) => benchEssence(getAffix(id)!);
    expect(e('firePen')).toBe('essenceEmber');
    expect(e('coldPen')).toBe('essenceRime');
    expect(e('lightningPen')).toBe('essenceStorm');
    expect(e('voidPen')).toBe('umbralEssence');
    expect(e('physicalPen')).toBe('umbralEssence');
    expect(e('voidDamage')).toBe('umbralEssence');
    expect(e('physicalDamage')).toBe('umbralEssence');
    expect(e('elementalPen')).toBe('essenceEmber');
    expect(e('voidResistance')).toBe('essenceVital'); // unchanged
    expect(e('maxResistance')).toBe('essenceVital');
    expect(e('flaskChargeOnKill')).toBeNull();
    for (const id of PEN_IDS) {
      const def = getAffix(id)!;
      const price = benchCost(def, def.tiers.find((t) => t.tier === 4)!);
      const scrap = price.find((p) => p.currencyId === 'scrap')!.count;
      expect(scrap, id).toBeGreaterThanOrEqual(7);
      expect(scrap, id).toBeLessThanOrEqual(12);
      expect(price, id).toHaveLength(2);
    }
    for (const r of BENCH_RECIPES) expect(getAffix(r.affixId), r.id).toBeDefined();
  });

  it('defines the Umbral Essence for void and physical (damage and penetration), never for anything else', () => {
    const umbral = CURRENCIES.umbralEssence;
    expect(umbral.name).toBe('Umbral Essence');
    expect(umbral.essenceTags).toEqual(['void', 'physical']);
    expect(umbral.description).toMatch(/void or physical/);
    for (const a of AFFIXES) {
      const matches = a.tags.some((t) => umbral.essenceTags!.includes(t));
      const expected = ['voidDamage', 'physicalDamage', 'voidPen', 'physicalPen', 'voidResistance'].includes(a.id);
      expect(matches, a.id).toBe(expected);
    }
    // The element essences also add their penetration affix.
    for (const [essence, pen] of [['essenceEmber', 'firePen'], ['essenceRime', 'coldPen'], ['essenceStorm', 'lightningPen']] as const) {
      expect(getAffix(pen)!.tags.some((t) => CURRENCIES[essence].essenceTags!.includes(t)), pen).toBe(true);
    }
  });
});

describe('utility flasks (power-curve 10.3)', () => {
  it('define real effects, no recovery and no TODO text', () => {
    for (const id of ['quickstep', 'aegis', 'quicksilverMind'] as const) {
      const f = FLASKS[id];
      expect(f.description, id).not.toMatch(/TODO/);
      expect(f.utility, id).toBeDefined();
      expect(f.recoverBase, id).toBe(0);
      expect(f.recoverPerLevel, id).toBe(0);
    }
    expect(FLASKS.quickstep).toMatchObject({ duration: 4 });
    expect(FLASKS.aegis).toMatchObject({ duration: 6 });
    expect(FLASKS.quicksilverMind).toMatchObject({ duration: 5, resource: 'focus' });
    // The two recovery flasks are unchanged.
    expect(FLASKS.lifeFlask).toMatchObject({ recoverBase: 40, recoverPerLevel: 8, duration: 3 });
    expect(FLASKS.focusFlask).toMatchObject({ recoverBase: 30, recoverPerLevel: 4, duration: 3 });
  });

  it('describe themselves by effect, not by recovery', () => {
    const d = describeFlask(flaskStack('aegis', 3, 'f'), { characterLevel: 30 });
    expect(d.properties.map((p) => p.value)).toEqual(['+15% to all Resistances', '6 seconds']);
    expect(d.properties.some((p) => p.label === 'Recovers')).toBe(false);
    const q = describeFlask(flaskStack('quicksilverMind', 1, 'f'));
    expect(q.properties.map((p) => p.value)).toContain('+25% Focus Regeneration Rate');
    expect(describeFlask(flaskStack('lifeFlask', 1, 'f'), { characterLevel: 10 }).properties[0]).toMatchObject({ label: 'Recovers' });
  });
});

describe('the ten new uniques (power-curve 10.4)', () => {
  const NEW = ['frostfireSpiral', 'stormcallersLattice', 'penitentsPrism', 'hollowCrown', 'weepingHearth', 'gravewindBoots', 'anchoritesSeal',
    'bellwether', 'needlepoint', 'twiceStruckBell'] as const;
  const LEVEL = { frostfireSpiral: 30, stormcallersLattice: 46, penitentsPrism: 44, hollowCrown: 52, weepingHearth: 22, gravewindBoots: 40,
    anchoritesSeal: 48, bellwether: 38, needlepoint: 36, twiceStruckBell: 34 } as const;
  const BASE = { frostfireSpiral: 'glassboneWand', stormcallersLattice: 'stormglassSceptre', penitentsPrism: 'prismaticAmulet',
    hollowCrown: 'duskweaveRobe', weepingHearth: 'emberSceptre', gravewindBoots: 'wayfarerGreaves', anchoritesSeal: 'dusksteelRing',
    bellwether: 'boneTalisman', needlepoint: 'cinderOrb', twiceStruckBell: 'runedTome' } as const;

  it('are real: bases, levels, flavour, drop weights, and no placeholder text', () => {
    for (const id of NEW) {
      const u = UNIQUES[id];
      expect(UNIQUE_IDS).toContain(id);
      expect(u.baseId, id).toBe(BASE[id]);
      expect(u.levelRequirement, id).toBe(LEVEL[id]);
      expect(u.dropWeight, id).toBeGreaterThan(0);
      expect(u.flavor, id).not.toMatch(/TODO/);
      expect(u.flavor.length, id).toBeGreaterThan(20);
      expect(u.flags.length, id).toBeGreaterThan(0);
      for (const f of u.flags) {
        expect(PLAYER_FLAGS, `${id}: ${f.flag}`).toContain(f.flag);
        expect(f.text, id).not.toMatch(/TODO/);
        expect(f.awaits, `${id} is gated until its behaviour ships`).toBeTruthy();
      }
    }
  });

  it('obey the design rules: no more above 25%, no penetration above 16', () => {
    for (const id of NEW) {
      for (const m of UNIQUES[id].mods) {
        if (m.mode === 'more') expect(m.max, id).toBeLessThanOrEqual(25);
        if (m.stats.some((s) => s.endsWith('Pen'))) expect(m.max, id).toBeLessThanOrEqual(16);
      }
    }
    expect(UNIQUES.stormcallersLattice.mods.find((m) => m.stats[0] === 'lightningPen')).toMatchObject({ min: 12, max: 16 });
    expect(UNIQUES.penitentsPrism.mods.find((m) => m.stats[0] === 'elementalPen')).toMatchObject({ min: 10, max: 14 });
  });

  it('join the right pools: two boss-exclusive entries, eight world-pool, all droppable', () => {
    expect(UNIQUES.stormcallersLattice.bossSource).toBe('varkus');
    expect(UNIQUES.hollowCrown.bossSource).toBe('hollowWarden');
    const world = uniqueIdsFor();
    for (const id of NEW) expect(world.includes(id), id).toBe(id !== 'stormcallersLattice' && id !== 'hollowCrown');
    expect(uniqueIdsFor({ bossSource: 'varkus' })).toContain('stormcallersLattice');
    expect(uniqueIdsFor({ bossSource: 'hollowWarden' })).toContain('hollowCrown');
    // Level-gated: nothing below its level requirement.
    expect(uniqueIdsFor({ maxLevel: 21 })).not.toContain('weepingHearth');
    expect(uniqueIdsFor({ maxLevel: 22 })).toContain('weepingHearth');
    expect(pickRandomUnique(createRng(5), { classes: ['focus'], maxLevel: 33 })).toBeNull();
    expect(pickRandomUnique(createRng(5), { classes: ['focus'], maxLevel: 34 })).toBe('twiceStruckBell');
  });

  it('roll their numbers and grant no flag while the behaviour is gated, but show every stat line', () => {
    for (const id of NEW) {
      const item = generateUnique(id, createRng(7), { itemLevel: 60 });
      expect(itemFlags(item), id).toEqual([]);
      const d = describeEquipment(item);
      expect(d.affixes.length, id).toBe(UNIQUES[id].mods.length);
      for (const f of UNIQUES[id].flags) expect(d.affixes.some((l) => l.text === f.text), `${id} shows no gated text`).toBe(false);
    }
    const lattice = generateUnique('stormcallersLattice', createRng(1), { itemLevel: 60 });
    expect(itemModifiers(lattice).some((m) => m.stat === 'lightningPen' && m.value >= 12 && m.value <= 16)).toBe(true);
    const hollow = describeEquipment(generateUnique('hollowCrown', createRng(1), { itemLevel: 60 }));
    expect(hollow.affixes.map((l) => l.text).join(' ')).toContain('−10% to all Resistances');
  });
});
