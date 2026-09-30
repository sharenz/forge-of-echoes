import { describe, expect, it } from 'vitest';
import { SCARAB_IDS } from '../../src/contracts/content';
import { currencyStashUid } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { findScarab, SCARABS } from '../../src/data/scarabs';
import { rules, restoreRunSetup, withItemLocks } from '../../src/game';
import { allItems } from '../../src/game/items';
import { bareCharacter, currency, expectOk, kill, map, withBackpack } from './fixtures';

describe('scarab sockets and expeditions', () => {
  it('loads one from backpack or shared stash, moves and removes it without duplication, and protects trade locks', () => {
    const original = withBackpack(bareCharacter({ currencyStash: { invasionScarab4: 2 } }), [[currency('hasteScarab4', 3, 'haste'), 0, 0]]);
    const locked = withItemLocks(rules, () => new Set(['haste']));
    expect(locked.moveItem(original, 'haste', { kind: 'scarabSlot', index: 0 }).ok).toBe(false);
    let ch = expectOk(rules.moveItem(original, 'haste', { kind: 'scarabSlot', index: 0 }));
    expect((ch.backpack.entries[0].item as { count: number }).count).toBe(2);
    expect(ch.mapScarabs![0]!.count).toBe(1);
    expect(ch.mapScarabs![0]!.uid).not.toBe('haste');
    expect(rules.moveItem(ch, 'haste', { kind: 'scarabSlot', index: 2 }).ok).toBe(false);
    ch = expectOk(rules.moveItem(ch, currencyStashUid('invasionScarab4'), { kind: 'scarabSlot', index: 1 }));
    expect(ch.currencyStash.invasionScarab4).toBe(1);
    expect(rules.moveItem(ch, currencyStashUid('invasionScarab4'), { kind: 'scarabSlot', index: 2 }).ok).toBe(false);
    expect(rules.moveItem(ch, 'haste', { kind: 'scarabSlot', index: 4 }).ok).toBe(false);
    expect(rules.moveItem(ch, 'haste', { kind: 'scarabSlot', index: 0 }).ok).toBe(false);
    ch = expectOk(rules.moveItem(ch, ch.mapScarabs![1]!.uid, { kind: 'scarabSlot', index: 3 }));
    expect(ch.mapScarabs![1]).toBeNull();
    ch = expectOk(rules.moveItem(ch, ch.mapScarabs![3]!.uid, { kind: 'currencyStash' }));
    expect(ch.currencyStash.invasionScarab4).toBe(2);
    ch = expectOk(rules.quickMove(ch, ch.mapScarabs![0]!.uid, { stashTab: null }));
    expect((ch.backpack.entries[0].item as { count: number }).count).toBe(3);
    expect(new Set(allItems(ch).map(i => i.item.uid)).size).toBe(allItems(ch).length);
    expect(original.mapScarabs).toBeUndefined();
  });

  it('keeps sockets through saves and failed opening; consumes exactly the loaded items on success', () => {
    const ch = bareCharacter({ mapScarabs: [currency('hasteScarab4'), null, null, currency('invasionScarab4')] });
    expect(rules.openMap(ch).ok).toBe(false);
    expect(ch.mapScarabs).toHaveLength(4);
    const saved = rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [ch] })).characters[0];
    expect(saved.mapScarabs).toEqual(ch.mapScarabs);
    const opened = expectOk(rules.openMap({ ...saved, mapDevice: map() }));
    expect(opened.character.mapScarabs).toEqual([null, null, null, null]);
    expect(opened.character.mapDevice).toBeNull();
    const config = rules.buildRunConfig(opened.setup, {} as never);
    expect(config.waves.startWave).toBe(5);
    expect(config.waves.waveDuration).toBe(30);
    expect(restoreRunSetup(JSON.stringify(opened.setup), opened.setup.seed)).toEqual(opened.setup);
    expect(rules.openMap(opened.character).ok).toBe(false);
    const normal = expectOk(rules.openMap(bareCharacter({ mapDevice: map() }))).setup;
    expect(normal.scarabs).toBeUndefined();
    expect(rules.buildRunConfig(normal, {} as never).waves.waveDuration).toBe(60);
    expect(restoreRunSetup({ ...opened.setup, scarabs: ['bad'] }, 1)).toBeNull();
    expect(rules.openMap({ ...saved, mapDevice: map(), mapScarabs: [currency('hasteScarab1'), currency('hasteScarab4')] }).ok).toBe(false);
    expect(restoreRunSetup({ ...opened.setup, scarabs: ['hasteScarab1', 'hasteScarab4'] }, 1)).toBeNull();
  });

  it('recovers excess stacks and invalid socket contents to storage without losing items', () => {
    const ch = bareCharacter({ mapScarabs: [currency('hasteScarab1', 9), currency('scrap', 3), currency('invasionScarab1'), currency('invasionScarab2')] });
    const normalized = rules.parseSave(JSON.stringify({ ...rules.newSave(), characters: [ch] })).characters[0];
    expect(normalized.mapScarabs?.filter(Boolean)).toHaveLength(2);
    const counts = new Map<string, number>();
    for (const { item } of allItems(normalized)) if (item.kind === 'currency') counts.set(item.currencyId, (counts.get(item.currencyId) ?? 0) + item.count);
    expect(counts.get('hasteScarab1')).toBe(9);
    expect(counts.get('scrap')).toBe(3);
    expect(counts.get('invasionScarab2')).toBe(1);
    expect(new Set(allItems(normalized).map(i => i.item.uid)).size).toBe(allItems(normalized).length);
  });

  it('drops rare scarabs with level gates, decreasing tier weights, and lower tiers still eligible at high levels', () => {
    const low = expectOk(rules.openMap(bareCharacter({ mapDevice: map() }))).setup;
    const high = { ...low, monsterLevel: 88 };
    const rng = createRng(315), counts = [0, 0, 0, 0];
    for (let n = 0; n < 350_000; n++) {
      const level = n < 50_000 ? 4 : 88;
      const setup = level === 4 ? low : high;
      for (const item of rules.rollKillLoot(setup, kill({ rarity: 'rare' }), rng, bare)) {
        if (item.kind !== 'currency') continue;
        const def = findScarab(item.currencyId);
        if (!def) continue;
        expect(def.minMonsterLevel).toBeLessThanOrEqual(level);
        expect(item.count).toBe(1);
        if (level === 88) counts[def.tier - 1]++;
      }
    }
    expect(counts[0]).toBeGreaterThan(counts[1]); expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]); expect(counts[3]).toBeGreaterThan(0);
    expect(counts.reduce((n, x) => n + x, 0)).toBeLessThan(1200);
    expect(SCARABS.map(s => s.id)).toEqual(SCARAB_IDS);
    expect(SCARABS.slice(0, 4).map(s => s.minMonsterLevel)).toEqual([4, 22, 46, 70]);
    expect(rules.rollKillLoot(high, kill({ summoned: true }), rng, bare)).toEqual([]);
  });

  it('scarab rolls and item IDs never advance the ordinary loot stream', () => {
    const setup = expectOk(rules.openMap(bareCharacter({ mapDevice: map() }))).setup;
    const roll = (drop: boolean) => {
      const rng = createRng(71), fork = rng.fork;
      rng.fork = salt => { const separate = fork(salt); separate.chance = () => drop; return separate; };
      const items = rules.rollKillLoot(setup, kill({ isBoss: true }), rng, bare);
      return { rng: rng.state(), normal: items.filter(i => i.kind !== 'currency' || !findScarab(i.currencyId)), scarabs: items.filter(i => i.kind === 'currency' && findScarab(i.currencyId)) };
    };
    const without = roll(false), withScarab = roll(true);
    expect(withScarab.scarabs).toHaveLength(1); expect(without.scarabs).toHaveLength(0);
    expect(withScarab.normal).toEqual(without.normal);
    expect(withScarab.rng).toBe(without.rng);
  });
});
const bare = bareCharacter();
