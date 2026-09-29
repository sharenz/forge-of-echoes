import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import type { CurrencyId } from '../../src/contracts/content';
import type { MapItem } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { CORRUPTED_MODS, CURRENCY_DROPS, ECHO_MOD, REWARD_MODS } from '../../src/data/progression';
import { rules } from '../../src/game';
import { craftMap, mapCraftError, mapCraftPreview } from '../../src/game/progression/maps';
import { normalizeItem } from '../../src/game/progression/save';
import { bareCharacter, expectOk, kill, map, setupFor } from './fixtures';

const saved = (m: MapItem) => normalizeItem(JSON.parse(JSON.stringify(m)), m.uid);
const rewards = (m: MapItem) => m.mods.filter(r => REWARD_MODS.some(d => d.id === r.modId));

describe('advanced map ingredients', () => {
  it('Compass guarantees only the progression map upgrade, survives reload and rejects redundant crafts', () => {
    const original = map('ashenForge', 3, { quality: 17, mods: [{ modId: 'teeming', value: 110 }] });
    const charted = craftMap(original, 'compass', createRng(8)).map;
    expect(charted).toEqual({ ...original, charted: true });
    expect(saved(charted)).toEqual(charted);
    const setup = setupFor(charted), rng = createRng(186);
    let extras = 0, lowerExtras = 0;
    for (let i = 0; i < 500; i++) {
      const drops = rules.rollChestLoot(setup, rng, bareCharacter()).filter((i): i is MapItem => i.kind === 'map');
      expect(drops[0].tier).toBe(4);
      if (drops[1]) { extras++; if (drops[1].tier <= 3) lowerExtras++; }
    }
    expect(extras).toBeGreaterThan(200); expect(extras).toBeLessThan(300);
    expect(lowerExtras).toBeGreaterThan(100);
    expect(mapCraftPreview(original, 'compass').join(' ')).toContain('Tier 4 (100%');
    expect(mapCraftError(charted, 'compass')).toMatch(/already charted/);
    expect(mapCraftError(map('ashenForge', 15), 'compass')).toMatch(/highest/);
    // A later Void Needle tier upgrade cannot take the charted chest beyond the tier cap.
    const cap = setupFor({ ...charted, tier: 15 });
    expect(rules.rollChestLoot(cap, rng, bareCharacter()).filter(i => i.kind === 'map').every(i => i.tier <= 15)).toBe(true);
  });

  it('Twin Ink adds one distinct reward, which Map Dust and save/reload both preserve', () => {
    const original = map('ashenForge', 5, { mods: [{ modId: 'teeming', value: 100 }, { modId: REWARD_MODS[0].id, value: 99 }] });
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const rng = createRng(seed), twin = craftMap(original, 'twinInk', rng).map;
      expect(twin.rarity).toBe(original.rarity);
      expect(rewards(twin)).toHaveLength(2);
      expect(new Set(rewards(twin).map(m => m.modId)).size).toBe(2);
      seen.add(rewards(twin).find(m => m.modId !== REWARD_MODS[0].id)!.modId);
      expect(saved(twin)).toEqual(twin);
      expect(rewards(craftMap(twin, 'mapDust', rng).map)).toEqual(rewards(twin));
      expect(mapCraftError(twin, 'twinInk')).toMatch(/once per map/);
      expect(mapCraftError(twin, 'rewardInk')).toMatch(/at most one/);
      const unmarked = normalizeItem({ ...twin, twinInked: false }, twin.uid) as MapItem;
      expect(rewards(unmarked)).toHaveLength(1);
    }
    expect(seen.size).toBe(REWARD_MODS.length - 1);
    expect(mapCraftError(map(), 'twinInk')).toMatch(/exactly one/);
  });

  it('Void Splinter removes all corruption effects and quality while retaining ordinary rewards and commissions', () => {
    const ordinary = [{ modId: 'teeming', value: 104 }, { modId: REWARD_MODS[0].id, value: 108 }, { modId: REWARD_MODS[1].id, value: 112 }];
    const original: MapItem = { ...map('ashenForge', 8, { quality: 20, mods: [...ordinary,
      { modId: 'commanded', value: 122, corrupted: true }, { modId: CORRUPTED_MODS[0].id, value: 115 },
      { modId: ECHO_MOD.id, value: 100 }] }), corrupted: true, bounty: true, charted: true, twinInked: true };
    const before = structuredClone(original), next = craftMap(original, 'voidSplinter', createRng(3)).map;
    expect(next).toMatchObject({ uid: original.uid, tier: 8, quality: 0, corrupted: false, bounty: true, charted: true, twinInked: true });
    expect(next.mods).toEqual(ordinary);
    expect(next.rarity).toBe('magic');
    expect(saved(next)).toEqual(next);
    expect(mapCraftError(next, 'mapDust')).toBeNull();
    expect(mapCraftError(next, 'voidSplinter')).toMatch(/not corrupted/);
    expect(original).toEqual(before);
  });

  it('consumes one shared-stash material only for a valid craft and rejects stale repeats', () => {
    const ch = bareCharacter({ mapDevice: map(), currencyStash: { compass: 2, twinInk: 1, voidSplinter: 1 } });
    const before = structuredClone(ch), uid = ch.mapDevice!.uid;
    expect(rules.applyCurrency(ch, 'cstash:twinInk', uid).ok).toBe(false);
    expect(rules.applyCurrency(ch, 'cstash:voidSplinter', uid).ok).toBe(false);
    expect(ch).toEqual(before);
    const next = expectOk(rules.applyCurrency(ch, 'cstash:compass', uid)).character;
    expect(next.currencyStash).toEqual({ compass: 1, twinInk: 1, voidSplinter: 1 });
    expect(next.mapDevice?.charted).toBe(true);
    const snapshot = structuredClone(next);
    expect(rules.applyCurrency(next, 'cstash:compass', uid).ok).toBe(false);
    expect(next).toEqual(snapshot);
  });
});

describe('advanced ingredient sources', () => {
  it('gates targeted boss ingredients by area and tier, outside normal kills, chests and currency rolls', () => {
    const sources = [
      ['glassSepulchre', 'scarBalm', 3, 0.15], ['emberVault', 'transmute', 3, 0.15],
      ['crownFoundry', 'anneal', 5, 0.2], ['winterThrone', 'graft', 5, 0.2],
      ['championsApproach', 'compass', 5, 0.2],
    ] as const;
    const ids: readonly CurrencyId[] = sources.map(s => s[1]);
    for (const [area, ingredient, tier, chance] of sources) {
      const ch = bareCharacter({ atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 },
        currencyStash: { scrap: 10 }, mapDevice: map('ashenForge', tier) });
      const setup = expectOk(rules.openMap(ch, area)).setup;
      const low = expectOk(rules.openMap({ ...ch, mapDevice: map('ashenForge', tier - 1) }, area)).setup;
      const rng = createRng(573), n = 1000;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const drops = rules.rollKillLoot(setup, kill({ isBoss: true }), rng, ch);
        count += drops.filter(i => i.kind === 'currency' && i.currencyId === ingredient).length;
        expect(drops.some(i => i.kind === 'currency' && ids.includes(i.currencyId) && i.currencyId !== ingredient)).toBe(false);
        if (i < 50) for (const other of [rules.rollKillLoot(low, kill({ isBoss: true }), rng, ch),
          rules.rollKillLoot(setup, kill({ rarity: 'rare' }), rng, ch), rules.rollChestLoot(setup, rng, ch)]) {
          expect(other.some(i => i.kind === 'currency' && i.currencyId === ingredient)).toBe(false);
        }
      }
      expect(Math.abs(count / n - chance)).toBeLessThan(0.055);
    }
    expect(CURRENCY_DROPS.some(d => ids.includes(d.currencyId) || ['echoShard', 'twinInk', 'voidSplinter', 'crownFragment'].includes(d.currencyId))).toBe(false);
  });

  it('Echo Rift gives Echo Shards at 50% only on Tier 3+, in addition to its existing materials', () => {
    const rng = createRng(481), setup = setupFor(map('ashenForge', 3)), low = setupFor(map('ashenForge', 2));
    let found = 0;
    for (let i = 0; i < 500; i++) {
      const drops = rules.rollKillLoot(setup, kill({ eventReward: 'echoRift' }), rng, bareCharacter());
      const currencies = drops.filter(i => i.kind === 'currency').map(i => i.currencyId);
      expect(currencies).toEqual(expect.arrayContaining(['reforge', 'mapDust']));
      if (currencies.includes('echoShard')) found++;
      if (i < 50) for (const other of [rules.rollKillLoot(low, kill({ eventReward: 'echoRift' }), rng, bareCharacter()),
        rules.rollKillLoot(setup, kill({ eventReward: 'hunted' }), rng, bareCharacter())]) {
        expect(other.some(i => i.kind === 'currency' && i.currencyId === 'echoShard')).toBe(false);
      }
    }
    expect(found).toBeGreaterThan(200); expect(found).toBeLessThan(300);
  });
});
