// The tree's wave rules reach the real sim: Early Crown puts the boss on wave 3 (waves 4 to 6 follow it and the map
// still clears once), Overrun Doctrine shortens waves without breaking the 25 second floor.
import { describe, expect, it } from 'vitest';
import { SIM_DT, type SimOutcome } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, makeHooks, makeSolo, strongSkills, strongStats } from '../sim/fixtures';
import { stepWith } from '../sim/helpers';
import { currency, expectOk } from './fixtures';
import { pathTo, treeCharacter } from './atlas-tree-helpers';

const configFor = (nodes: string[]) => rules.buildRunConfig(expectOk(rules.openMap(treeCharacter(nodes, {}, 5), 'heartOfForge')).setup, {} as never);

describe('tree wave rules in the real sim', () => {
  it('runs a map with the boss on wave 3 and still clears it once', () => {
    const cfg = configFor(pathTo('earlyCrown'));
    expect(cfg.waves.bossWave).toBe(3);
    const { hooks } = makeHooks({ dropChance: 0.05 });
    const { run } = makeSolo({ seed: 5, stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT, scaling: TIER5, hooks, waves: cfg.waves });
    const bot = createBot();
    const outcomes: SimOutcome[] = [];
    let bossSeenOnWave = 0;
    for (let t = 0; t < Math.round((14 * 60) / SIM_DT); t++) {
      stepWith(run, bot.intent(run.view, 1));
      run.drainEvents();
      const out = run.drainOutcomes();
      outcomes.push(...out);
      if (!bossSeenOnWave && run.view.run.boss) bossSeenOnWave = run.view.run.wave;
      if (out.some(o => o.t === 'returnPortal' || o.t === 'playerDied')) break;
    }
    const kinds = outcomes.map(o => o.t);
    expect(kinds).not.toContain('playerDied');
    expect(bossSeenOnWave).toBe(3);
    expect(outcomes.filter((o): o is Extract<SimOutcome, { t: 'waveStart' }> => o.t === 'waveStart').map(o => o.wave)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(kinds.indexOf('bossDefeated')).toBeLessThan(kinds.lastIndexOf('waveStart'));
    expect(kinds.filter(k => k === 'cleared')).toHaveLength(1);
  });

  it('shortens waves with Overrun Doctrine and keeps the floor', () => {
    expect(configFor([]).waves.waveDuration).toBe(60);
    expect(configFor(pathTo('overrunDoctrine')).waves.waveDuration).toBeCloseTo(42);
    // stacked with the strongest Haste scarab the wave duration bottoms out at the floor
    const scarabs = [currency('hasteScarab4'), null, null, null];
    const ch = { ...treeCharacter(pathTo('overrunDoctrine'), {}, 5), mapScarabs: scarabs };
    const setup = expectOk(rules.openMap(ch, 'heartOfForge')).setup;
    const duration = rules.buildRunConfig(setup, {} as never).waves.waveDuration;
    expect(duration).toBeGreaterThanOrEqual(25);
    expect(duration).toBeLessThan(42);
    const twoHaste = { ...ch, mapScarabs: [currency('hasteScarab4'), currency('invasionScarab4'), null, null] };
    expect(rules.buildRunConfig(expectOk(rules.openMap(twoHaste, 'heartOfForge')).setup, {} as never).waves.waveDuration).toBeGreaterThanOrEqual(25);
  });
});
