// The assembled GameRulesApi: type-level conformance and content completeness.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { GameRulesApi } from '../../src/contracts/game';
import {
  BASE_IDS, CURRENCY_IDS, FLASK_IDS, MAP_BASE_IDS, SKILL_IDS, UNIQUE_IDS,
} from '../../src/contracts/content';
import { rules } from '../../src/game';

// Compile-time: the exported object satisfies the frozen contract exactly.
const conforms = rules satisfies GameRulesApi;
void conforms;

describe('rules assembly', () => {
  it('is typed as GameRulesApi', () => {
    expectTypeOf(rules).toEqualTypeOf<GameRulesApi>();
    expectTypeOf(rules.rollKillLoot).parameters.toEqualTypeOf<Parameters<GameRulesApi['rollKillLoot']>>();
    expectTypeOf(rules.skillSheet).returns.toEqualTypeOf<ReturnType<GameRulesApi['skillSheet']>>();
  });

  it('implements every API function', () => {
    const fns = [
      'newSave', 'parseSave', 'serializeSave', 'createCharacter', 'deriveStats', 'xpToNext', 'grantXp',
      'allocateAttribute', 'canRankUpSkill', 'rankUpSkill', 'setLoadoutSlot', 'skillSheet', 'describeItem', 'itemSize',
      'findItem', 'canEquip', 'moveItem', 'quickMove', 'addToBackpack', 'discardItem', 'addStashTab', 'renameStashTab',
      'clearNewFlags', 'compareWithEquipped', 'craftingTargetError', 'craftPreview', 'applyCurrency', 'benchRecipes',
      'applyBenchRecipe', 'clearCraftedAffix', 'mapSummary',
      'openMap', 'buildRunConfig', 'playerRuntime', 'lootLuck', 'rollKillLoot', 'rollChestLoot', 'dropSpec', 'consumeFlask',
      'applyRunEnd', 'merchantOffers', 'buyOffer',
    ] as const;
    for (const f of fns) expect(typeof rules[f], f).toBe('function');
  });

  it('exposes content info for every id', () => {
    const c = rules.content;
    expect(Object.keys(c.bases).sort()).toEqual([...BASE_IDS].sort());
    expect(Object.keys(c.currencies).sort()).toEqual([...CURRENCY_IDS].sort());
    expect(Object.keys(c.skills).sort()).toEqual([...SKILL_IDS].sort());
    expect(Object.keys(c.mapBases).sort()).toEqual([...MAP_BASE_IDS].sort());
    expect(Object.keys(c.flasks).sort()).toEqual([...FLASK_IDS].sort());
    expect(Object.keys(c.uniques).sort()).toEqual([...UNIQUE_IDS].sort());
  });

  it('describes the skill tree per GAME_SPEC §4', () => {
    const s = rules.content.skills;
    expect(s.emberLance).toMatchObject({ branch: 'basic', prerequisite: null, maxRank: 10, damageType: 'fire', unlockLevel: 1, available: true });
    expect(s.emberNova).toMatchObject({ branch: 'destruction', tier: 1, prerequisite: null, unlockLevel: 1 });
    expect(s.flameWave).toMatchObject({ prerequisite: null, unlockLevel: 12, element: 'fire' });
    expect(s.rimeShards).toMatchObject({ prerequisite: null, unlockLevel: 3, element: 'cold' });
    expect(s.arcChain).toMatchObject({ tier: 3, prerequisite: null, unlockLevel: 6, damageType: 'lightning' });
    expect(s.riftStep).toMatchObject({ branch: 'mobility', damageType: null, element: 'void' });
    expect(s.cinderWard).toMatchObject({ branch: 'survival', unlockLevel: 2 });
    expect(Object.values(s).filter((i) => i.available).map((i) => i.id)).toEqual([
      'emberLance', 'emberNova', 'flameWave', 'rimeShards', 'arcChain', 'riftStep', 'cinderWard',
      // SK2 roster batch 1 (levels 5 to 18)
      'phaseStride', 'glacialNova', 'spark', 'cinderMortar', 'arcaneReprieve', 'umbralBolt', 'kineticLance', 'frostOrb', 'stormCall',
      'glacialSpikes',
      // SK3 roster batch 2 (levels 20 to 40)
      'gravityWell', 'rimeBulwark', 'immolationSigil', 'staticAegis', 'voltaicPulse', 'entropyHex', 'concussiveBlast', 'staticLash',
      'echoSigil', 'witherField',
      // SK4 roster batch 3 (levels 44 to 62): all 32 are playable
      'meteorRain', 'stormStep', 'tempestSurge', 'blizzard', 'eventHorizon',
    ]);
  });

  it('describes map bases with their implemented implicits', () => {
    const m = rules.content.mapBases;
    expect(m.ashenForge.theme).toBe('ashenForge');
    expect(m.ashenForge.implicit).toContain('Ember Essences are 3 times as likely to drop');
    expect(m.rimedOssuary.implicit).toContain('Rime Essences are 3 times as likely to drop');
    expect(m.rimedOssuary.implicit).toContain('20% increased Monster Life');
    expect(m.rimedOssuary.implicit).toContain('15% increased Rarity of Items found');
    expect(m.ironColiseum.implicit).toContain('25% increased number of Monsters');
    expect(m.ironColiseum.implicit).toContain('Armour bases drop with +2 Stability');
  });
});
