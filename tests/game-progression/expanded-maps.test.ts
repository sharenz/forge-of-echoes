import { describe, expect, it } from 'vitest';
import { MAP_BASE_IDS } from '../../src/contracts/content';
import type { KillLootContext, SimOutcome } from '../../src/contracts/sim';
import { ATLAS_AREAS } from '../../src/data/progression/atlas';
import { MAP_BASES } from '../../src/data/progression/maps';
import { rules, restoreRunSetup } from '../../src/game';
import { normalizeItem } from '../../src/game/progression/save';
import { createRunInternal } from '../../src/sim/run';
import { killMonster } from '../../src/sim/combat';
import { makeJoin, strongStats } from '../sim/fixtures';
import { bareCharacter, map, setupFor } from './fixtures';

describe('six maps with one final encounter each', () => {
  it('gives the three promoted bosses distinct reachable maps, packs and implicits', () => {
    expect(MAP_BASE_IDS).toHaveLength(6);
    expect(new Set(MAP_BASE_IDS.map(id => MAP_BASES[id].boss)).size).toBe(6);
    for (const id of MAP_BASE_IDS) {
      expect(ATLAS_AREAS.some(a => a.baseId === id), `${id} has an Atlas destination`).toBe(true);
      const item = map(id, 3);
      expect(normalizeItem(item, item.uid)).toEqual(item);
      const setup = setupFor(item);
      expect(restoreRunSetup(setup, setup.seed)?.map).toEqual(item);
      const summary = rules.mapSummary(bareCharacter(), item).find(l => l.label === 'Waves')!;
      expect(summary.breakdown.some(l => l.startsWith('Wave 3:'))).toBe(false);
    }
    expect(MAP_BASES.cinderChapel.boss).toBe('ashboundHerald');
    expect(MAP_BASES.choralCrypt.boss).toBe('boneChorister');
    expect(MAP_BASES.chainworks.boss).toBe('chainmaster');
    for (const [fresh, old] of [['cinderChapel', 'ashenForge'], ['choralCrypt', 'rimedOssuary'], ['chainworks', 'ironColiseum']] as const) {
      expect(MAP_BASES[fresh].family).not.toEqual(MAP_BASES[old].family);
      expect(MAP_BASES[fresh].implicitEffects).not.toEqual(MAP_BASES[old].implicitEffects);
      expect(MAP_BASES[fresh].theme).not.toBe(MAP_BASES[old].theme);
    }
  });

  it.each(MAP_BASE_IDS)('%s: wave 3 has no lieutenant; the sole boss grants boss loot and clears the map once', id => {
    const kills: KillLootContext[] = [];
    const config = rules.buildRunConfig(setupFor(map(id, 1)), {
      rollKillLoot: ctx => { kills.push({ ...ctx }); return []; }, rollChestLoot: () => [], tryPickup: () => true,
    });
    expect(config.waves).toMatchObject({ count: 6, lieutenantWave: 0, bossWave: 6 });
    // Compress only the clock and ordinary budget; encounter choice and spawn/kill wiring are real.
    config.waves = { ...config.waves, tellDuration: 0, waveDuration: 0.1, baseMonsters: 0, monstersPerWave: 0 };
    const { run, world } = createRunInternal(config);
    run.addPlayer(makeJoin(1, { stats: strongStats() }));
    const outcomes: SimOutcome[] = [];
    for (let t = 0; t < 600 && !world.director.bossSpawned; t++) {
      run.step(); outcomes.push(...run.drainOutcomes());
      expect(run.view.run.lieutenant).toBeNull();
    }
    expect(world.director.bossSpawned).toBe(true);
    expect(world.director.wave).toBe(6);
    const bossSlot = world.monsters.slotOf(world.director.bossId);
    expect(bossSlot).toBeGreaterThanOrEqual(0);
    killMonster(world, bossSlot, 1, true, 1);
    for (let t = 0; t < 3; t++) { run.step(); outcomes.push(...run.drainOutcomes()); }
    const bossKills = kills.filter(k => k.isBoss);
    expect(bossKills).toHaveLength(1);
    expect(bossKills[0].kind).toBe(MAP_BASES[id].boss);
    expect(kills.some(k => k.isLieutenant)).toBe(false);
    expect(outcomes.filter(o => o.t === 'bossDefeated')).toHaveLength(1);
    expect(outcomes.filter(o => o.t === 'cleared')).toHaveLength(1);
    expect(world.props.some(p => p.kind === 'chest')).toBe(true);
  });
});
