import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { UNIQUE_IDS } from '../../src/contracts/content';
import { ATLAS_AREAS, atlasTierCeiling, KEYSTONE_UNIQUE_CHANCE } from '../../src/data/progression/atlas';
import { UNIQUES } from '../../src/data/items';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { generateUnique, uniqueIdsFor, uniqueLevelRequirement } from '../../src/game/items';
import { mapBosses } from '../../src/game/progression/maps';
import { keystoneRewards } from '../../src/game/progression/keystones';
import { bareCharacter, expectOk, kill, map, withBackpack, currency, openAt } from './fixtures';

const atlas = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 };
const exclusive = UNIQUE_IDS.filter(id => UNIQUES[id].bossSource);

describe('boss-exclusive uniques', () => {
  it('has two attainable uniques for each of six keystone bosses, outside every world/gamble pool', () => {
    expect(exclusive).toHaveLength(12);
    expect(uniqueIdsFor()).toEqual(['thePatientSpark', 'cinderwalkers', 'echoOfTheMatriarch', 'ruinheartBand']);
    const bosses = [...new Set(exclusive.map(id => UNIQUES[id].bossSource!))];
    expect(bosses).toHaveLength(6);
    for (const boss of bosses) {
      const pool = uniqueIdsFor({ bossSource: boss });
      expect(pool).toHaveLength(2);
      for (const id of pool) {
        const tier = Math.ceil((uniqueLevelRequirement(id) + 2) / 6);
        expect(ATLAS_AREAS.some(a => a.uniquePool === boss && atlasTierCeiling(a) >= tier)).toBe(true);
        expect(uniqueIdsFor({ bossSource: boss, maxLevel: uniqueLevelRequirement(id) - 1 })).not.toContain(id);
        expect(uniqueIdsFor({ bossSource: boss, maxLevel: uniqueLevelRequirement(id) })).toContain(id);
      }
    }
    for (const a of ATLAS_AREAS.filter(a => a.uniquePool)) expect(mapBosses(a.baseId).boss.kind).toBe(a.uniquePool);
    expect(keystoneRewards('crownFoundry', 9)!.pool.map(i => i.id)).toEqual(['everburn']);
    expect(keystoneRewards('winterThrone', 9)!.pool.map(i => i.id)).toEqual(['winterstride']);
  });

  it('pays only the selected keystone pool at the displayed personal rarity chance and respects item levels', () => {
    const looter = bareCharacter();
    for (const area of ATLAS_AREAS.filter(a => a.uniquePool && atlasTierCeiling(a) >= 10)) {
      const setup = expectOk(openAt(rules, bareCharacter({ atlas, mapDevice: map(area.baseId, 10), currencyStash: { scrap: 100 } }), area.id)).setup;
      const info = keystoneRewards(area.id, 10, rules.lootLuck(setup, looter).itemRarity)!;
      const seen = new Set<string>(); let count = 0;
      for (let seed = 0; seed < 800; seed++) {
        const drops = rules.rollKillLoot(setup, kill({ kind: area.uniquePool!, isBoss: true }), createRng(seed), looter);
        for (const item of drops) if (item.kind === 'equipment' && item.uniqueId && UNIQUES[item.uniqueId].bossSource) {
          expect(UNIQUES[item.uniqueId].bossSource).toBe(area.uniquePool);
          expect(item.itemLevel).toBe(58); seen.add(item.uniqueId); count++;
        }
      }
      expect(seen.size).toBe(2);
      expect(count / 800).toBeCloseTo(info.chance, 1);
      expect(info.chance).toBeCloseTo(KEYSTONE_UNIQUE_CHANCE * rules.lootLuck(setup, looter).itemRarity / 100);
      const early = expectOk(openAt(rules, bareCharacter({ atlas, mapDevice: map(area.baseId, 7), currencyStash: { scrap: 100 } }), area.id)).setup;
      expect(keystoneRewards(area.id, 7)!.chance).toBe(0);
      for (let seed = 0; seed < 40; seed++) {
        const boss = kill({ kind: area.uniquePool!, isBoss: true });
        // Shrine Field is the one deep area without an exclusive-unique boss: bosses there pay no keystone pool
        const ordinary = expectOk(rules.openMap(bareCharacter({ mapDevice: map('shrineField', 10), currencyStash: { scrap: 100 } }))).setup;
        const excluded = [
          ...rules.rollKillLoot(early, boss, createRng(seed), looter),
          ...rules.rollKillLoot(ordinary, boss, createRng(seed), looter),
          ...rules.rollKillLoot(setup, { ...boss, isBoss: false }, createRng(seed), looter),
          ...rules.rollChestLoot(setup, createRng(seed), looter),
        ];
        expect(excluded.some(i => i.kind === 'equipment' && i.uniqueId && UNIQUES[i.uniqueId].bossSource)).toBe(false);
      }
    }
  });

  it('keeps every new unique identity, effect, source and implicit through Crown crafting and save reload', () => {
    for (const id of exclusive) {
      const item = generateUnique(id, createRng(42), { itemLevel: 88, origin: 'Earned from its keystone' });
      const ch = withBackpack(bareCharacter({ level: 88 }), [[item, 0, 0], [currency('crownFragment', 2), 4, 0]]);
      const crown = ch.backpack.entries[1].item;
      const crafted = expectOk(rules.applyCurrency(ch, crown.uid, item.uid)).character;
      const save = rules.parseSave(rules.serializeSave({ ...rules.parseSave(null), characters: [crafted], lastCharacterId: crafted.id }));
      const actual = save.characters[0].backpack.entries.find(e => e.item.uid === item.uid)!.item;
      expect(actual).toMatchObject({ uniqueId: id, implicitValues: item.implicitValues, stability: 0, baseId: item.baseId });
      const desc = rules.describeItem(actual, crafted);
      expect(desc.description).toContain('Exclusive keystone drop');
      expect(desc.description).toContain(`Tier ${Math.ceil((uniqueLevelRequirement(id) + 2) / 6)}+`);
      if (id === 'sunkenSun') expect(desc.description).not.toContain('Crown Foundry');
      if (id === 'stillwinter') expect(desc.description).not.toContain('Winter Throne');
      expect(desc.affixes.map(a => a.text).join(' ')).toContain(UNIQUES[id].flags[0].text);
    }
  });
});
