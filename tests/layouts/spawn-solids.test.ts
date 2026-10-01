// No monster may ever appear inside a solid prop: packs, stream groups, lieutenant, boss and summons all resolve to a free point
// (src/sim/spawn.ts freeSpawnPoint). Every one of the 25 layouts is played by the fair bot (real RunConfig.areaId) for a few
// minutes on a seed, and the old generator is checked the same way. The long audit lives in tests/sim-events/layout-sweep.test.ts.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { overrideLayout, registeredLayouts } from '../../src/data/layouts';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import { createRunInternal } from '../../src/sim/run';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeJoin } from '../sim/fixtures';
import type { AtlasAreaId } from '../../src/contracts/atlas';

function spawnsInSolids(areaId: AtlasAreaId, seed: number, minutes: number): { spawned: number; bad: string[] } {
  const { run, world } = createRunInternal(makeConfig({ theme: areaTheme(areaId), seed, arenaRadius: areaRadius(areaId), scaling: { ...TIER5 }, areaId }));
  run.addPlayer(makeJoin(1, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
  const bot = createBot();
  const seen = new Set<number>();
  const solids = world.props.filter((p) => p.solid);
  const bad: string[] = [];
  let spawned = 0;
  for (let t = 0; t < Math.round((minutes * 60) / SIM_DT); t++) {
    run.setIntent(1, bot.intent(run.view, 1));
    run.step();
    run.drainEvents();
    const m = world.monsters;
    for (let i = 0; i < m.hwm; i++) {
      if (!m.alive[i] || seen.has(m.id[i])) continue;
      seen.add(m.id[i]);
      spawned++;
      for (const p of solids) {
        if (Math.hypot(m.x[i] - p.x, m.y[i] - p.y) < p.radius - 2) {
          bad.push(`seed ${seed} t=${world.time.toFixed(0)}s wave ${world.director.wave} kind#${m.kind[i]} at ${m.x[i].toFixed(0)},${m.y[i].toFixed(0)} inside ${p.kind}@${p.x.toFixed(0)},${p.y.toFixed(0)} r${p.radius}`);
          break;
        }
      }
    }
    const o = run.drainOutcomes();
    if (o.some((x) => x.t === 'playerDied' || x.t === 'cleared')) break;
  }
  return { spawned, bad };
}

describe('spawns never land inside solid props', () => {
  const areas = registeredLayouts().map((l) => l.areaId);
  it('registers all 25 layouts', () => expect(areas.length).toBe(25));
  for (const areaId of areas) {
    it(`${areaId}`, () => {
      for (const seed of [2]) {
        const r = spawnsInSolids(areaId, seed, 7);
        expect(r.spawned).toBeGreaterThan(20);
        expect(r.bad).toEqual([]);
      }
    }, 120_000);
  }
  it('the old generator path (same areas, layouts switched off) is clean too', () => {
    for (const areaId of ['furnaceYard', 'hollowOssuary'] as AtlasAreaId[]) {
      const restore = overrideLayout(null, areaId);
      try {
        expect(spawnsInSolids(areaId, 2, 8).bad).toEqual([]);
      } finally { restore(); }
    }
  }, 120_000);
});
