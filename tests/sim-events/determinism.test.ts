// Determinism with events on: the same seed and the same scripted inputs give the same digest, for every event on every roster family
// (the digest covers event state, the pact seam, boons and the carried-object slow).
import { describe, expect, it } from 'vitest';
import type { Theme } from '../../src/contracts/content';
import { MAP_EVENT_KINDS, type MapEventKind } from '../../src/contracts/map-events';
import { SIM_DT } from '../../src/contracts/sim';
import { MAP_EVENT_WINDOW } from '../../src/data/progression/map-events';
import { digestWorld } from '../../src/sim/digest';
import { createRunInternal } from '../../src/sim/run';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeHooks, makeJoin } from '../sim/fixtures';
import { POLICIES } from './sweep';

function play(kind: MapEventKind, theme: Theme, seed: number, seconds: number): number[] {
  const { hooks } = makeHooks();
  const wave = MAP_EVENT_WINDOW[kind][0];
  const { run, world } = createRunInternal({ ...makeConfig({ theme, seed, hooks, arenaRadius: theme === 'ironColiseum' ? 650 : 900, scaling: { ...TIER5 } }),
    event: { kind, wave: kind === 'secondCrown' ? 6 : wave, angle: seed * 1.37, variant: (seed * 37) & 255 } });
  run.addPlayer(makeJoin(1, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
  const bot = createBot();
  const policy = POLICIES[kind];
  const digests: number[] = [];
  for (let t = 0; t < Math.round(seconds / SIM_DT); t++) {
    let intent = bot.intent(run.view, 1);
    if (policy) intent = policy(world, 1, intent);
    run.setIntent(1, intent);
    run.step();
    run.drainEvents();
    run.drainOutcomes();
    if (t % 600 === 0) digests.push(digestWorld(world));
  }
  digests.push(digestWorld(world));
  return digests;
}

describe.each<Theme>(['ashenForge', 'rimedOssuary', 'ironColiseum'])('determinism with events on %s', (theme) => {
  it.each([...MAP_EVENT_KINDS])('%s replays to the same digest', (kind) => {
    const seconds = kind === 'secondCrown' ? 330 : 130;
    expect(play(kind, theme, 7, seconds)).toEqual(play(kind, theme, 7, seconds));
  }, 300_000);
});
