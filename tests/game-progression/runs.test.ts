// Opening maps, building an instance's sim RunConfig (hideout and map) and each player's runtime.
import { describe, expect, it } from 'vitest';
import type { RunHooks } from '../../src/contracts/sim';
import { restoreRunSetup, rules } from '../../src/game';
import { HIDEOUT_SEED } from '../../src/data/progression';
import { bareCharacter, expectErr, expectOk, luckyAmulet, map, setupFor, withBackpack } from './fixtures';

const hooks: RunHooks = { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => true };

describe('openMap', () => {
  it('needs a map in the device', () => {
    expect(expectErr(rules.openMap(bareCharacter()))).toBe('Place a map in the Map Device first.');
  });

  it('consumes the map and derives the run from it', () => {
    const m = { ...map('rimedOssuary', 4, { quality: 8, mods: [{ modId: 'teeming', value: 100 }] }), isNew: true };
    const ch = expectOk(rules.moveItem(withBackpack(bareCharacter(), [[m, 0, 0]]), m.uid, { kind: 'mapDevice' }));
    const { character, setup } = expectOk(rules.openMap(ch));
    expect(character.mapDevice).toBeNull();
    expect(character.rngState).not.toBe(ch.rngState);
    expect(setup.map.uid).toBe(m.uid);
    expect(setup.map.isNew).toBeUndefined();
    expect(setup.monsterLevel).toBe(22);
    expect(setup.itemQuantity).toBe(128);
    expect(setup.itemRarity).toBe(130);
    expect(setup.summary.map((l) => l.label)).toContain('Map Item Quantity');
    expect(setup.summary).toEqual(rules.mapSummary(ch, m));
    expect(Number.isInteger(setup.seed) && setup.seed >= 0 && setup.seed < 2 ** 32).toBe(true);
    // Deterministic: the same character opens the same run.
    expect(expectOk(rules.openMap(ch)).setup).toEqual(setup);
  });

  it('records map-side luck only: the opener\'s gear stays personal', () => {
    const m = map('ashenForge', 2, { quality: 5 });
    const geared = bareCharacter({ equipment: { amulet: luckyAmulet(25, 12) } });
    const open = (who: typeof geared) =>
      expectOk(rules.openMap(expectOk(rules.moveItem(withBackpack(who, [[m, 0, 0]]), m.uid, { kind: 'mapDevice' })))).setup;
    const mine = open(geared);
    expect(mine).toMatchObject({ itemQuantity: 105, itemRarity: 105 });
    expect(open(bareCharacter()).summary).toEqual(mine.summary);
    expect(rules.lootLuck(mine, geared)).toEqual({ itemQuantity: 117, itemRarity: 130 });
    const q = mine.summary.find((l) => l.label === 'Map Item Quantity')!;
    expect(q.value).toBe('+5%');
    expect(q.breakdown.some((l) => l.includes('Your gear'))).toBe(false);
  });
});

describe('restoreRunSetup (restart safety: open maps survive a deploy)', () => {
  const opened = () => {
    const m = map('rimedOssuary', 4, { quality: 8, mods: [{ modId: 'teeming', value: 100 }] });
    const ch = expectOk(rules.moveItem(withBackpack(bareCharacter(), [[m, 0, 0]]), m.uid, { kind: 'mapDevice' }));
    return expectOk(rules.openMap(ch)).setup;
  };

  it('rebuilds exactly the setup the map was opened with, from the persisted map and seed', () => {
    const setup = opened();
    const row = JSON.parse(JSON.stringify({ map: setup.map, seed: setup.seed }));
    expect(restoreRunSetup(row.map, row.seed)).toEqual(setup);
    // The whole persisted RunSetup works too; its map is what counts. So does the JSON text of a column.
    expect(restoreRunSetup(JSON.parse(JSON.stringify(setup)), setup.seed)).toEqual(setup);
    expect(restoreRunSetup(JSON.stringify(setup.map), setup.seed)).toEqual(setup);
    expect(restoreRunSetup(JSON.stringify(setup), setup.seed)).toEqual(setup);
    // Same instance config as the original run.
    const hooksNone: RunHooks = { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => true };
    const { hooks: _a, ...before } = rules.buildRunConfig(setup, hooksNone);
    const { hooks: _b, ...after } = rules.buildRunConfig(restoreRunSetup(row.map, row.seed)!, hooksNone);
    expect(after).toEqual(before);
  });

  it('recomputes level, luck and summary with the current rules instead of trusting the row', () => {
    const setup = opened();
    const stale = { ...setup, monsterLevel: 999, itemQuantity: 1, itemRarity: 1, summary: [] };
    expect(restoreRunSetup(stale, setup.seed)).toEqual(setup);
  });

  it('normalises the map like a saved one (unknown mods dropped, tier clamped)', () => {
    const setup = opened();
    const tampered = { ...setup.map, tier: 99, isNew: true, mods: [...setup.map.mods, { modId: 'noSuchMod', value: 5 }] };
    const restored = restoreRunSetup(tampered, 7)!;
    expect(restored.map.tier).toBe(15);
    expect(restored.map.mods.map((m) => m.modId)).toEqual(setup.map.mods.map((m) => m.modId));
    expect(restored.map.isNew).toBeUndefined();
    expect(restored.seed).toBe(7);
  });

  it('returns null for anything that is not a restorable map, and never throws', () => {
    const setup = opened();
    for (const raw of [
      null, undefined, 'map', '{"kind":"map",', '', 42, [], {}, { kind: 'equipment' }, { map: null }, { ...setup.map, baseId: 'moonPalace' },
    ]) {
      expect(restoreRunSetup(raw, 1), JSON.stringify(raw)).toBeNull();
    }
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number]) expect(restoreRunSetup(setup.map, seed)).toBeNull();
    expect(restoreRunSetup(setup.map, -1)?.seed).toBe(2 ** 32 - 1);
  });
});

describe('buildRunConfig', () => {
  it('builds the hideout instance: small arena, no waves, no players', () => {
    const cfg = rules.buildRunConfig(null, hooks);
    expect(cfg).toMatchObject({ mode: 'hideout', theme: 'hideout', mapName: 'Hideout', tier: 0, arenaRadius: 260, seed: HIDEOUT_SEED });
    expect(cfg.waves.count).toBe(0);
    expect(cfg.waves.bossWave).toBe(0);
    expect(cfg.monsters).toMatchObject({ level: 1, xpMultiplier: 0, magicPackChance: 0, rarePackChance: 0, hazards: false });
    expect(cfg.hooks).toBe(hooks);
    expect('player' in cfg).toBe(false);
    expect(rules.buildRunConfig(null, hooks)).toEqual(cfg);
  });

  it('builds a map instance from the setup alone', () => {
    const m = map('ironColiseum', 2, { mods: [{ modId: 'volcanic', value: 100 }] });
    const ch = expectOk(rules.moveItem(withBackpack(bareCharacter(), [[m, 0, 0]]), m.uid, { kind: 'mapDevice' }));
    const { setup } = expectOk(rules.openMap(ch));
    const cfg = rules.buildRunConfig(setup, hooks);
    expect(cfg).toMatchObject({ mode: 'map', theme: 'ironColiseum', tier: 2, arenaRadius: 650, seed: setup.seed, mapName: 'Volcanic Iron Coliseum' });
    expect(cfg.monsters).toMatchObject({ level: 10, hazards: true });
    expect(cfg.monsters.countMultiplier).toBeCloseTo(1.25, 10);
    expect(cfg.waves).toEqual({ count: 6, baseMonsters: 40, monstersPerWave: 18, waveDuration: 60, tellDuration: 3, lieutenantWave: 3, bossWave: 6 });
  });
});

describe('playerRuntime', () => {
  it('hands the sim stats, ranked skills, the loadout and flask runtimes', () => {
    const ch = rules.createCharacter('A', 3);
    const rt = rules.playerRuntime(ch, null);
    expect(rt.stats.maxLife).toBe(rules.deriveStats(ch).combat.maxLife);
    expect(rt.skills.map((s) => s.id)).toEqual(['emberLance']);
    expect(rt.loadout).toEqual(['emberLance', null, null, null, null, null]);
    expect(rt.flasks).toEqual([
      { flaskId: 'lifeFlask', count: 3, resource: 'life', amount: 48, duration: 3 },
      { flaskId: 'lifeFlask', count: 3, resource: 'life', amount: 48, duration: 3 },
      { flaskId: 'focusFlask', count: 3, resource: 'focus', amount: 34, duration: 3 },
      null,
    ]);
  });

  it('follows flask use and level-ups', () => {
    let ch = rules.createCharacter('A', 3);
    ch = rules.consumeFlask(ch, 1);
    expect(rules.playerRuntime(ch, null).flasks[1]?.count).toBe(2);
    ch = rules.grantXp(ch, 1000).character;
    expect(ch.level).toBeGreaterThan(1);
    expect(rules.playerRuntime(ch, null).flasks[0]?.amount).toBe(40 + 8 * ch.level);
  });

  it('is per player: everyone in the same map gets their own numbers, map penalties included', () => {
    const setup = setupFor(map('ashenForge', 3, { mods: [{ modId: 'hexed', value: 100 }] }));
    const a = rules.createCharacter('Alice', 3);
    const b = rules.grantXp(rules.createCharacter('Bob', 4), 5000).character;
    const ra = rules.playerRuntime(a, setup);
    const rb = rules.playerRuntime(b, setup);
    expect(rb.stats.maxLife).toBeGreaterThan(ra.stats.maxLife);
    for (const [ch, rt] of [[a, ra], [b, rb]] as const) {
      expect(rt.stats).toEqual(rules.deriveStats(ch, setup).combat);
      expect(rt.stats.resist.fire).toBeCloseTo(-0.23, 10);
      expect(rules.playerRuntime(ch, null).stats.resist.fire).toBe(0);
    }
  });
});
