// Balance signal for the rosters (GAME_SPEC §14): the fair bot (tier-5 gear, no flanking, fire-leaning
// resistances) plays seeds 1..12 of a theme's tier-5 map. Used by tests/sim/balance-<theme>.test.ts (one
// file per theme, so they run in parallel). It also checks a fairness invariant every tick of every
// fight: a monster never leaves its own charge lane (a chargeLine of variant ≥ 1) while that lane is shown.
import type { Theme } from '../../src/contracts/content';
import { SIM_DT } from '../../src/contracts/sim';
import { areaVariant, inChargeLine } from '../../src/sim/area-geometry';
import { createRunInternal } from '../../src/sim/run';
import { createBot } from './bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeJoin } from './fixtures';

export type MapTheme = Exclude<Theme, 'hideout'>;

export const BALANCE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/** At least this many of BALANCE_SEEDS must clear per theme (3 in 4). */
export const BALANCE_MIN_CLEARS = 9;

const ARENA: Record<MapTheme, number> = { ashenForge: 900, rimedOssuary: 900, ironColiseum: 650 };
/** A map that isn't over after this long is stuck (a softlock, e.g. a boss wedged out of reach). */
const LIMIT_MINUTES = 20;

export interface SweepResult {
  cleared: number;
  died: number[];
  timeouts: number[];
  /** Ticks a monster stood outside its own shown charge lane (must be 0). */
  offLane: number;
  /** One line for the test output: per-seed results and the clear rate. */
  summary: string;
}

export function sweepTheme(theme: MapTheme, seeds: readonly number[] = BALANCE_SEEDS): SweepResult {
  const died: number[] = [];
  const timeouts: number[] = [];
  const minutes: string[] = [];
  let cleared = 0;
  let offLane = 0;
  for (const seed of seeds) {
    const { run, world } = createRunInternal(makeConfig({ theme, seed, arenaRadius: ARENA[theme], scaling: { ...TIER5 } }));
    run.addPlayer(makeJoin(1, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
    const bot = createBot();
    const m = world.monsters;
    let result: 'cleared' | 'died' | 'timeout' = 'timeout';
    for (let t = 0; t < Math.round((LIMIT_MINUTES * 60) / SIM_DT); t++) {
      run.setIntent(1, bot.intent(run.view, 1));
      run.step();
      run.drainEvents();
      for (const a of world.areas) {
        if (a.dead || a.kind !== 'chargeLine' || areaVariant(a) < 1 || a.owner < 0) continue;
        const i = m.slotOf(a.owner);
        if (i >= 0 && !inChargeLine(a, m.x[i], m.y[i], 0.5)) offLane++;
      }
      const out = run.drainOutcomes();
      if (out.some((o) => o.t === 'playerDied')) {
        result = 'died';
        break;
      }
      if (out.some((o) => o.t === 'cleared')) {
        result = 'cleared';
        break;
      }
    }
    if (result === 'cleared') cleared++;
    else if (result === 'died') died.push(seed);
    else timeouts.push(seed);
    minutes.push(`${seed}:${result === 'cleared' ? ((world.tick * SIM_DT) / 60).toFixed(1) : result}`);
  }
  const summary = `${theme}: cleared ${cleared}/${seeds.length} (fair bot, tier 5) — ${minutes.join(' ')}` +
    (offLane > 0 ? ` — ${offLane} ticks off a shown charge lane` : '');
  return { cleared, died, timeouts, offLane, summary };
}
