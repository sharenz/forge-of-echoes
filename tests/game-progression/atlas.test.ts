import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { ATLAS_AREAS, ATLAS_START, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { atlasAccessError, discoverAfterBoss, newAtlas, normalizeAtlas } from '../../src/game/progression/atlas';
import { restoreRunSetup, rules, withItemLocks } from '../../src/game';
import { createRng } from '../../src/core/rng';
import { getBase } from '../../src/data/items';
import { bareCharacter, expectErr, expectOk, kill, map, withBackpack } from './fixtures';

describe('Atlas routes and discovery', () => {
  it('has connected destinations, optional dead ends and sealed doors outside the tier routes', () => {
    expect(ATLAS_AREAS.map((a) => a.id)).toEqual([...ATLAS_AREA_IDS]);
    const ordinary = ATLAS_AREAS.filter((a) => !a.sealed);
    const reached = new Set([ATLAS_START]);
    for (let n = 0; n < ordinary.length; n++) for (const area of ordinary) {
      for (const next of area.neighbours) {
        expect(findAtlasArea(next)?.neighbours).toContain(area.id);
        if (reached.has(area.id)) reached.add(next);
      }
    }
    expect(reached.size).toBe(ordinary.length);
    expect(Math.max(...ordinary.map(atlasTierCeiling))).toBe(15);
    const vault = findAtlasArea('emberVault')!;
    expect(vault.neighbours).toHaveLength(1);
    expect(atlasTierCeiling(vault)).toBe(atlasTierCeiling(findAtlasArea(vault.neighbours[0])!));
    expect(findAtlasArea('sealedReliquary')?.neighbours).toEqual([]);
    for (const end of ordinary.filter((a) => a.depth === 4)) expect(end.neighbours.length).toBeGreaterThanOrEqual(2);
  });

  it('reveals two unexplored neighbours, supports repeat clears and makes both deep routes reachable', () => {
    const fresh = newAtlas();
    const first = discoverAfterBoss(fresh, ATLAS_START, false);
    expect(first.revealed).toEqual(['emberRoad', 'boneApproach']);
    expect(fresh.discovered).toEqual([ATLAS_START]);
    let progress = first.progress;
    for (let round = 0; round < ATLAS_AREAS.length; round++) for (const id of [...progress.discovered]) {
      const result = discoverAfterBoss(progress, id, false);
      expect(result.revealed.length).toBeLessThanOrEqual(2);
      progress = result.progress;
    }
    expect(progress.discovered).toHaveLength(ATLAS_AREAS.filter(a => !a.sealed).length);
    expect(progress.discovered).toContain('crownFoundry');
    expect(progress.discovered).toContain('winterThrone');
    expect(progress.discovered).not.toContain('sealedReliquary');
    expect(new Set(progress.completed).size).toBe(progress.completed.length);
  });

  it('credits a party destination, rolls a rare door separately and keeps sealed areas out of progression', () => {
    const credit = discoverAfterBoss(newAtlas(), 'shatteredForge', true);
    expect(credit.revealed).toEqual(['shatteredForge', 'furnaceYard', 'crownFoundry', 'sealedReliquary']);
    const door = discoverAfterBoss(newAtlas(), 'sealedReliquary', true);
    expect(door.revealed).toEqual(['sealedReliquary']);
    expect(door.progress.clears).toBe(1);
  });

  it('gates undiscovered areas and high tiers, while allowing low-tier maps at any revealed depth', () => {
    const fresh = newAtlas();
    expect(atlasAccessError(fresh, ATLAS_START, 1)).toBeNull();
    expect(atlasAccessError(fresh, ATLAS_START, 2)).toContain('Tier 1');
    expect(atlasAccessError(fresh, 'crownFoundry', 1)).toContain('reveal');
    const deep = discoverAfterBoss(fresh, 'crownFoundry', false).progress;
    for (const tier of [1, 5, 9]) expect(atlasAccessError(deep, 'crownFoundry', tier)).toBeNull();
    expect(atlasAccessError(deep, 'crownFoundry', 10)).toContain('Tier 9');
    expect(atlasAccessError(deep, '__proto__', 1)).toContain('Choose');
  });

  it('normalizes saved discovery without duplicate IDs or invisible completed areas', () => {
    expect(normalizeAtlas(null)).toEqual(newAtlas());
    expect(normalizeAtlas({ discovered: ['bad', 'emberRoad', 'emberRoad'], completed: ['winterThrone', 1], clears: NaN })).toEqual({
      discovered: ['cinderCrossing', 'emberRoad', 'winterThrone'], completed: ['winterThrone'], clears: 1, treeVersion: 2,
    });
  });
});

describe('Atlas map expeditions', () => {
  const explored = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 };
  const character = (tier = 3) => bareCharacter({ atlas: explored, mapDevice: map('ashenForge', tier, { quality: 9, mods: [{ modId: 'teeming', value: 100 }] }) });

  it('takes tier, quality and mods from any item and theme, implicit and arena from the chosen area', () => {
    const ch = character();
    const result = expectOk(rules.openMap(ch, 'boneApproach'));
    expect(result.setup.map).toEqual({ ...ch.mapDevice, baseId: 'rimedOssuary' });
    expect(result.setup.sourceMap).toEqual(ch.mapDevice);
    expect(result.setup.atlasAreaId).toBe('boneApproach');
    expect(result.character.mapDevice).toBeNull();
    expect(ch.mapDevice).not.toBeNull();
    const config = rules.buildRunConfig(result.setup, { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => true });
    expect(config.theme).toBe('rimedOssuary');
    expect(config.mapName).toBe('Bone Approach');
    expect(config.monsters.level).toBe(16);
    expect(restoreRunSetup(JSON.stringify(result.setup), result.setup.seed)).toEqual(result.setup);
    expect(restoreRunSetup({ ...result.setup, atlasAreaId: 'unknown' }, result.setup.seed)).toBeNull();
  });

  it('refuses fog or an excessive tier without spending the map or an entrance key', () => {
    const ch = { ...character(), atlas: newAtlas(), currencyStash: { reliquaryKey: 1 } };
    expect(expectErr(rules.openMap(ch, 'boneApproach'))).toContain('reveal');
    expect(expectErr(rules.openMap(ch, 'cinderCrossing'))).toContain('Tier 1');
    expect(ch.mapDevice).not.toBeNull();
    expect(ch.currencyStash.reliquaryKey).toBe(1);
  });

  it('consumes one key per sealed expedition, including shared-stash keys, but never a key in a trade offer', () => {
    const ch = character();
    expect(expectErr(rules.openMap(ch, 'sealedReliquary'))).toContain('Reliquary Key');
    const funded = { ...ch, currencyStash: { reliquaryKey: 2 } };
    const result = expectOk(rules.openMap(funded, 'sealedReliquary'));
    expect(result.character.currencyStash.reliquaryKey).toBe(1);
    expect(funded.currencyStash.reliquaryKey).toBe(2);
    const offered = withBackpack(ch, [[{ kind: 'currency', currencyId: 'reliquaryKey', uid: 'key', count: 1 }, 0, 0]]);
    expect(withItemLocks(rules, () => new Set(['key'])).openMap(offered, 'sealedReliquary').ok).toBe(false);
    expect(rules.openMap(offered, 'sealedReliquary').ok).toBe(true);
  });

  it('makes the vault a targeted key source and raises the crypt jewellery share without inflating total equipment', () => {
    const looter = bareCharacter();
    const vault = expectOk(rules.openMap(character(1), 'emberVault')).setup;
    const crypt = expectOk(rules.openMap(character(3), 'glassSepulchre')).setup;
    const ordinary = expectOk(rules.openMap({ ...character(3), mapDevice: { ...character(3).mapDevice!, baseId: 'rimedOssuary' } })).setup;
    let keys = 0, jewellery = 0, baseline = 0, pieces = 0, basePieces = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      const drops = rules.rollKillLoot(vault, kill({ isBoss: true }), createRng(seed), looter);
      keys += drops.filter((i) => i.kind === 'currency' && i.currencyId === 'reliquaryKey').length;
      for (const [setup, biased] of [[crypt, true], [ordinary, false]] as const) {
        for (const item of rules.rollChestLoot(setup, createRng(seed), looter)) if (item.kind === 'equipment') {
          const isJewellery = ['ring', 'amulet'].includes(getBase(item.baseId).itemClass);
          if (biased) { pieces++; jewellery += Number(isJewellery); }
          else { basePieces++; baseline += Number(isJewellery); }
        }
      }
    }
    expect(keys / 1200).toBeGreaterThan(0.20);
    expect(keys / 1200).toBeLessThan(0.30);
    expect(pieces).toBe(basePieces);
    expect(jewellery).toBeGreaterThan(baseline * 1.2);
  });

  it('gives a sealed-area boss its extra Unique when eligible and an extra Rare below that level', () => {
    for (const tier of [1, 2]) {
      const ch = { ...character(tier), currencyStash: { reliquaryKey: 1 } };
      const setup = expectOk(rules.openMap(ch, 'sealedReliquary')).setup;
      for (let seed = 1; seed <= 20; seed++) {
        const drops = rules.rollKillLoot(setup, kill({ isBoss: true, eventReward: 'secondCrown' }), createRng(seed), bareCharacter());
        expect(drops.at(-1)).toMatchObject({ kind: 'equipment', rarity: tier === 1 ? 'rare' : 'unique' });
        expect(drops.some((i) => i.kind === 'currency' && i.currencyId === 'reliquaryKey')).toBe(false);
      }
    }
  });
});
