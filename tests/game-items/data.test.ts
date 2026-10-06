import { describe, expect, it } from 'vitest';
import {
  BASE_IDS, CURRENCY_IDS, EQUIPMENT_CURRENCY_IDS, FLASK_IDS, ITEM_CLASSES, MAP_CURRENCY_IDS, PLAYER_FLAGS, UNIQUE_IDS,
} from '../../src/contracts/content';
import type { BaseId, ItemClass } from '../../src/contracts/content';
import { STAT_IDS } from '../../src/contracts/items';
import {
  AFFIXES, BASES, CLASS_SIZE, CURRENCIES, FLASKS, RARE_NAME_FIRST, RARE_NAME_SECOND, SCARS, STAT_TEXT, TIER_LADDERS,
  UNIQUES, getAffix,
} from '../../src/data/items';
import type { ModLineDef } from '../../src/data/items';
import {
  BASE_INFO, CURRENCY_INFO, FLASK_INFO, UNIQUE_INFO, affixCandidates, formatLine,
} from '../../src/game/items';

const SPEC_STABILITY: Record<BaseId, number> = {
  ashwoodWand: 8, glassboneWand: 6, ironrootWand: 10, emberSceptre: 8, cinderOrb: 8, runedTome: 8,
  ritualCirclet: 8, ironVisor: 9, ashenRobe: 8, rivetedCoat: 9, silkWraps: 8, graspingGauntlets: 9,
  pathfinderBoots: 8, ashenSandals: 8, chainBelt: 8, runedSash: 8, cinderPendant: 7, boneTalisman: 7,
  emberRing: 7, rimeBand: 7, stormLoop: 7, voidSignet: 7,
  emberheartWand: 9, stormglassSceptre: 8, echoingFocus: 9, bastionHelm: 10, duskweaveRobe: 9,
  forgemasterGloves: 10, wayfarerGreaves: 9, ironweaveGirdle: 10, prismaticAmulet: 8, dusksteelRing: 8,
  scaleCowl: 8, quiltedJerkin: 8, wardedVestment: 8, studdedGloves: 8, ironshodBoots: 9, studdedBelt: 8,
};

const SPEC_SIZE: Record<ItemClass, [number, number]> = {
  wand: [1, 3], sceptre: [2, 3], focus: [2, 2], helmet: [2, 2], chest: [2, 3], gloves: [2, 2], boots: [2, 2],
  belt: [2, 1], amulet: [1, 1], ring: [1, 1],
};

function lineHasTemplate(line: ModLineDef): boolean {
  if (line.text) return true;
  return line.stats.length === 1 && !!STAT_TEXT[line.stats[0]][line.mode];
}

describe('bases', () => {
  it('defines all 38 bases with the spec stability, class footprint and slots', () => {
    expect(Object.keys(BASES).sort()).toEqual([...BASE_IDS].sort());
    for (const id of BASE_IDS) {
      const b = BASES[id];
      expect(b.id).toBe(id);
      expect(b.maxStability, id).toBe(SPEC_STABILITY[id]);
      expect([b.size.w, b.size.h], id).toEqual(SPEC_SIZE[b.itemClass]);
      expect(b.size).toEqual(CLASS_SIZE[b.itemClass]);
      expect(b.slots.length).toBeGreaterThan(0);
      expect(b.levelRequirement).toBeGreaterThanOrEqual(1);
      expect(b.materialNote.length).toBeGreaterThan(0);
      expect(b.implicits.length).toBeGreaterThan(0);
      for (const imp of b.implicits) {
        expect(imp.min).toBeLessThanOrEqual(imp.max);
        expect(lineHasTemplate(imp), `${id} implicit`).toBe(true);
      }
    }
    expect(BASES.emberRing.slots).toEqual(['ring1', 'ring2']);
    expect(BASES.cinderOrb.slots).toEqual(['offHand']);
    expect(BASES.emberSceptre.slots).toEqual(['mainHand']);
  });

  it('carries the spec implicits', () => {
    expect(BASES.ashwoodWand.implicits[0]).toMatchObject({ stats: ['fireDamage'], mode: 'increased', min: 12, max: 16 });
    expect(BASES.glassboneWand.implicits.map((i) => i.stats[0])).toEqual(['projectileSpeed', 'addedSpellDamage']);
    expect(BASES.cinderOrb.implicits[0]).toMatchObject({ stats: ['critChance'], mode: 'flat', min: 4, max: 6 });
    expect(BASES.boneTalisman.implicits[0].stats).toEqual(['str', 'dex', 'int']);
    expect(BASES.voidSignet.implicits[0]).toMatchObject({ stats: ['voidRes'], min: 10, max: 14 });
    expect(BASES.ashenRobe.implicits).toHaveLength(2);
  });

  it('encodes the crafting materials', () => {
    expect(BASES.ashwoodWand.material?.tagWeights).toEqual({ fire: 2 });
    expect(BASES.cinderOrb.material?.tagWeights).toEqual({ critical: 2 });
    expect(BASES.ironVisor.material?.tagWeights).toEqual({ defense: 2 });
    expect(BASES.glassboneWand.material?.scarThreshold).toBe(3);
    expect(BASES.ironrootWand.maxStability - BASES.ashwoodWand.maxStability).toBe(2);
  });

  it('scales base properties with item level', () => {
    const coat = BASES.rivetedCoat.properties[0];
    expect(coat.stat).toBe('armor');
    expect(coat.perItemLevel).toBeGreaterThan(0);
    for (const b of Object.values(BASES)) {
      if (['helmet', 'chest', 'gloves', 'boots'].includes(b.itemClass)) {
        expect(b.properties.some((p) => p.stat === 'armor' || p.stat === 'evasion'), b.id).toBe(true);
      }
    }
  });

  it('lets every base fill a full rare (3 prefixes + 3 suffixes) from item level 1', () => {
    for (const b of Object.values(BASES)) {
      const cands = affixCandidates(b, 1);
      const groups = (kind: string) => new Set(cands.filter((c) => c.affix.kind === kind).map((c) => c.affix.group)).size;
      expect(groups('prefix'), `${b.id} prefixes`).toBeGreaterThanOrEqual(3);
      expect(groups('suffix'), `${b.id} suffixes`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every exclusive group within one kind (the precondition for exact reforge odds)', () => {
    const kinds = new Map<string, Set<string>>();
    for (const a of AFFIXES) kinds.set(a.group, (kinds.get(a.group) ?? new Set()).add(a.kind));
    for (const [group, set] of kinds) expect(set.size, group).toBe(1);
  });
});

describe('affixes', () => {
  it('has about 30+ affixes with unique ids and names, split into prefixes and suffixes', () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(AFFIXES.map((a) => a.id)).size).toBe(AFFIXES.length);
    expect(new Set(AFFIXES.map((a) => a.name)).size).toBe(AFFIXES.length);
    expect(AFFIXES.filter((a) => a.kind === 'prefix').length).toBeGreaterThanOrEqual(12);
    expect(AFFIXES.filter((a) => a.kind === 'suffix').length).toBeGreaterThanOrEqual(12);
    for (const a of AFFIXES) {
      if (a.kind === 'suffix') expect(a.name.startsWith('of '), a.id).toBe(true);
      else expect(a.name.startsWith('of '), a.id).toBe(false);
    }
  });

  it('lists prefixes before suffixes (canonical display order)', () => {
    const firstSuffix = AFFIXES.findIndex((a) => a.kind === 'suffix');
    expect(AFFIXES.slice(firstSuffix).every((a) => a.kind === 'suffix')).toBe(true);
  });

  it('has 7–10 well-formed tiers per affix (T1 best, gated by item level, steeply weighted)', () => {
    for (const a of AFFIXES) {
      if (a.id === 'splintering') continue;
      expect(a.tiers.length, a.id).toBeGreaterThanOrEqual(7);
      expect(a.tiers.length, a.id).toBeLessThanOrEqual(10);
      a.tiers.forEach((t, i) => {
        expect(t.tier).toBe(i + 1);
        expect(t.min).toBeLessThanOrEqual(t.max);
        expect(Number.isInteger(t.min) && Number.isInteger(t.max)).toBe(true);
        if (i > 0) {
          const better = a.tiers[i - 1];
          expect(better.itemLevel, a.id).toBeGreaterThan(t.itemLevel);
          expect(better.weight, a.id).toBeLessThan(t.weight);
          // Narrow integer ladders (maximum resistance moves the cap 1 to 3 points) repeat a value in neighbouring tiers.
          if (a.id === 'maxResistance') expect(better.min, a.id).toBeGreaterThanOrEqual(t.max);
          else expect(better.min, a.id).toBeGreaterThan(t.max);
        }
      });
      expect(a.tiers[a.tiers.length - 1].itemLevel, a.id).toBe(1);
      expect(a.tiers[0].itemLevel, `${a.id} top tier`).toBeGreaterThanOrEqual(60);
      expect(a.classes.length).toBeGreaterThan(0);
      expect(a.tags.length).toBeGreaterThan(0);
      expect(lineHasTemplate(a), a.id).toBe(true);
    }
    for (const n of [7, 8, 9, 10]) expect(TIER_LADDERS[n].weight).toHaveLength(n);
  });

  it('makes "of Splintering" a very rare wand-only T1 at ilvl 70+', () => {
    const s = getAffix('splintering')!;
    expect(s.classes).toEqual(['wand']);
    expect(s.tiers).toHaveLength(1);
    expect(s.tiers[0].tier).toBe(1);
    expect(s.tiers[0].itemLevel).toBeGreaterThanOrEqual(70);
    expect(s.tiers[0].weight).toBeLessThanOrEqual(20);
    expect(s.stats).toEqual(['extraProjectiles']);
  });

  it('only references real stats and classes', () => {
    for (const a of AFFIXES) {
      for (const s of a.stats) expect(STAT_IDS).toContain(s);
      for (const c of a.classes) expect(ITEM_CLASSES).toContain(c);
    }
  });

  it('covers every item class with prefixes and suffixes', () => {
    for (const c of ITEM_CLASSES) {
      expect(AFFIXES.some((a) => a.kind === 'prefix' && a.classes.includes(c)), c).toBe(true);
      expect(AFFIXES.some((a) => a.kind === 'suffix' && a.classes.includes(c)), c).toBe(true);
    }
  });
});

describe('currencies', () => {
  it('defines crafting currencies and the Reliquary Key with their costs, families and stacks', () => {
    expect(Object.keys(CURRENCIES).sort()).toEqual([...CURRENCY_IDS].sort());
    const cost = (id: keyof typeof CURRENCIES) => CURRENCIES[id].stabilityCost;
    expect([cost('kindling'), cost('scrap'), cost('reforge'), cost('catalyst'), cost('solvent'), cost('seal'), cost('fractureCore')])
      .toEqual([1, 1, 2, 3, 1, 0, 3]);
    for (const id of ['essenceEmber', 'essenceRime', 'essenceStorm', 'essenceVital', 'essenceSwift'] as const) {
      expect(cost(id)).toBe(2);
      expect(CURRENCIES[id].essenceTags?.length).toBeGreaterThan(0);
    }
    for (const id of CURRENCY_IDS) {
      const c = CURRENCIES[id];
      const rare = id.includes('Scarab') || id.includes('Sigil') || id === 'fractureCore' || id === 'voidNeedle' || id.endsWith('Key') || id === 'prefixRune' || id === 'suffixRune' || ['scarBalm', 'anneal', 'graft', 'transmute', 'echoShard', 'crownFragment', 'compass', 'twinInk', 'voidSplinter', 'hourglassSand'].includes(id);
      expect(c.maxStack, id).toBe(id === 'grandHourglass' ? 5 : rare ? 20 : 40);
      expect(c.needsAffixChoice, id).toBe(id === 'catalyst' || id === 'seal' || id === 'fractureCore' || id === 'graft');
      expect(c.description, id).toMatch(/^[A-Z][a-z]+s\b/);
      expect(c.description.endsWith('.'), id).toBe(true);
    }
    for (const id of MAP_CURRENCY_IDS) expect(CURRENCIES[id].family).toBe('map');
    for (const id of EQUIPMENT_CURRENCY_IDS) expect(CURRENCIES[id].family).not.toBe('map');
    expect(CURRENCIES.catalyst.family).toBe('refine');
    expect(CURRENCIES.solvent.family).toBe('remove');
    expect(CURRENCIES.seal.family).toBe('preserve');
    expect(CURRENCIES.fractureCore.family).toBe('transform');
  });

  it('maps essences to their tag families', () => {
    expect(CURRENCIES.essenceEmber.essenceTags).toEqual(['fire']);
    expect(CURRENCIES.essenceVital.essenceTags).toEqual(['life', 'defense', 'resistance']);
    expect(CURRENCIES.essenceSwift.essenceTags).toEqual(['speed']);
  });
});

describe('uniques, scars, flasks, names', () => {
  it('defines 26 uniques on real bases with valid flags', () => {
    expect(Object.keys(UNIQUES).sort()).toEqual([...UNIQUE_IDS].sort());
    for (const u of Object.values(UNIQUES)) {
      expect(BASES[u.baseId]).toBeDefined();
      expect(u.flavor.length).toBeGreaterThan(0);
      for (const f of u.flags) expect(PLAYER_FLAGS).toContain(f.flag);
      for (const m of u.mods) {
        expect(m.min).toBeLessThanOrEqual(m.max);
        expect(lineHasTemplate(m), `${u.id}: ${m.stats.join(',')}`).toBe(true);
      }
    }
    expect(UNIQUES.thePatientSpark.flags[0].flag).toBe('lancePierceAll');
    expect(UNIQUES.cinderwalkers.flags[0].flag).toBe('fireTrail');
    expect(UNIQUES.echoOfTheMatriarch.flags[0].flag).toBe('novaEcho');
    expect(UNIQUES.ruinheartBand.mods[0].stats).toEqual(['extraProjectiles']);
  });

  it('defines distinct scars that read as drawbacks', () => {
    expect(SCARS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SCARS.map((s) => s.id)).size).toBe(SCARS.length);
    for (const s of SCARS) {
      expect(s.min).toBeGreaterThan(0);
      expect(s.min).toBeLessThanOrEqual(s.max);
      const text = formatLine(s, s.sign * s.max);
      expect(text, s.id).toMatch(/reduced|−|increased Damage taken/);
    }
  });

  it('defines both flasks', () => {
    expect(Object.keys(FLASKS).sort()).toEqual([...FLASK_IDS].sort());
    expect(FLASKS.lifeFlask.resource).toBe('life');
    expect(FLASKS.focusFlask.resource).toBe('focus');
  });

  it('has 30+ distinct rare-name words on each side', () => {
    expect(RARE_NAME_FIRST.length).toBeGreaterThanOrEqual(30);
    expect(RARE_NAME_SECOND.length).toBeGreaterThanOrEqual(30);
    expect(new Set(RARE_NAME_FIRST).size).toBe(RARE_NAME_FIRST.length);
    expect(new Set(RARE_NAME_SECOND).size).toBe(RARE_NAME_SECOND.length);
  });

  it('exposes plain ContentInfo records', () => {
    expect(Object.keys(BASE_INFO)).toHaveLength(38);
    expect(Object.keys(CURRENCY_INFO).sort()).toEqual([...CURRENCY_IDS].sort());
    expect(Object.keys(FLASK_INFO)).toHaveLength(5);
    expect(Object.keys(UNIQUE_INFO)).toHaveLength(26);
    expect(BASE_INFO.ashwoodWand).toEqual({
      id: 'ashwoodWand', name: 'Ashwood Wand', itemClass: 'wand', slots: ['mainHand'], size: { w: 1, h: 3 },
      levelRequirement: 1, maxStability: 8, materialNote: BASES.ashwoodWand.materialNote,
    });
    expect(Object.keys(CURRENCY_INFO.essenceEmber).sort()).toEqual(
      ['description', 'family', 'id', 'maxStack', 'name', 'needsAffixChoice', 'stabilityCost'],
    );
    expect(UNIQUE_INFO.cinderwalkers.baseId).toBe('ashenSandals');
  });
});
