// Twin Omens: two events of different kinds run side by side. A deterministic sample of pairs (every kind appears as first and as
// second) plays 110 s of a tier-5 map with the fair bot: no exception, no hook error, at most three live, every finite position.
import { describe, expect, it } from 'vitest';
import { MAP_EVENT_KINDS, type MapEventKind, type MapEventPlan } from '../../src/contracts/map-events';
import { SIM_DT } from '../../src/contracts/sim';
import { MAP_EVENT_WINDOW } from '../../src/data/progression/map-events';
import { createRunInternal } from '../../src/sim/run';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeHooks, makeJoin } from '../sim/fixtures';
import { POLICIES } from './sweep';

const KINDS = MAP_EVENT_KINDS.filter(k => k !== 'secondCrown');
const PAIRS: [MapEventKind, MapEventKind][] = KINDS.flatMap((a, i) => [1, 4, 7].map((d): [MapEventKind, MapEventKind] => [a, KINDS[(i + d) % KINDS.length]])).filter(([a, b]) => a !== b);

describe('two concurrent events', () => {
  it.each(PAIRS)('%s with %s', (a, b) => {
    const { hooks } = makeHooks();
    const plan = (kind: MapEventKind, wave: number, angle: number): MapEventPlan => ({ kind, wave: Math.max(MAP_EVENT_WINDOW[kind][0], Math.min(MAP_EVENT_WINDOW[kind][1], wave)), angle, variant: 11 });
    const { run, world } = createRunInternal({ ...makeConfig({ theme: 'rimedOssuary', seed: 5, hooks, arenaRadius: 900, scaling: { ...TIER5 } }),
      event: { ...plan(a, 2, 0.4), also: plan(b, 3, 2.6) } });
    run.addPlayer(makeJoin(1, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
    run.addPlayer(makeJoin(2, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
    const bots = [createBot(), createBot()];
    const pol = [POLICIES[a], POLICIES[b]];
    for (let t = 0; t < Math.round(110 / SIM_DT); t++) {
      for (let k = 0; k < 2; k++) {
        let intent = bots[k].intent(run.view, k + 1);
        // One player follows each event's policy (whatever it needs: a site, a stone): the pair is played for real.
        const p = pol[k]; if (p) intent = p(world, k + 1, intent);
        run.setIntent(k + 1, intent);
      }
      run.step();
      run.drainEvents();
      run.drainOutcomes();
      expect(world.mapEvent!.live.length).toBeLessThanOrEqual(3);
      if (t % 300 === 0) for (const p of world.players) expect(Number.isFinite(p.x + p.y + p.life)).toBe(true);
    }
    expect(world.hookErrors.total).toBe(0);
  }, 120_000);
});
