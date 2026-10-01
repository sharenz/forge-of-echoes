// Whole Iron Coliseum maps (GAME_SPEC §7, §14): a new character clears Tier 1 with the starting kit through the
// real rules (the map's +25% monster count and the early-tier easing included), a geared one clears Tier 5,
// and every run is deterministic.
import { themeMap } from '../game-progression/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunInternal } from '../../src/sim/run';
import { THEME_ROSTER } from '../../src/contracts/bestiary';
import { SIM_DT, type PlayerIntent } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { createRun } from '../../src/sim';
import { monsterDef } from '../../src/sim/rosters';
import { describePlay, playMap } from '../game-progression/playthrough';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeJoin, strongSkills, strongStats } from '../sim/fixtures';

const MINUTE = 60;

describe('Tier 1: a new character with the starting kit', () => {
  it('clears an Iron Coliseum through the portals (real rules, seeds 1–6: at least 5), under real pressure, and levels up', () => {
    const results = [1, 2, 3, 4, 5, 6].map((seed) => {
      const ch = rules.createCharacter('Gladiator', seed);
      return playMap(ch, themeMap('ironColiseum', 1, `coliseum-t1-${seed}`), { maxMinutes: 25, reenterAfter: 12 });
    });
    const lines = results.map(describePlay);
    console.info(lines.join('\n'));
    const cleared = results.filter((r) => r.result === 'cleared');
    expect(cleared.length, lines.join('\n')).toBeGreaterThanOrEqual(5);
    for (const r of cleared) {
      expect(r.setup.map.baseId).toBe('ironColiseum');
      expect(r.seconds, describePlay(r)).toBeLessThanOrEqual(25 * MINUTE);
      // Not a stroll: it gets to her and she needs her flasks…
      expect(r.minLife, describePlay(r)).toBeLessThan(0.9);
      expect(r.flasksDrunk).toBeGreaterThan(0);
      // …and the first map levels her well past level 1.
      expect(r.levelEnd).toBeGreaterThanOrEqual(4);
      expect(r.heraldKilled).toBe(false);
    }
  }, 120_000);
});

/** A bot plays a tier-5 Iron Coliseum with the given kit; what it met and how it ended. */
function playT5(seed: number, kit: 'strong' | 'fair', record?: PlayerIntent[]) {
  const run = createRun(makeConfig({ theme: 'ironColiseum', seed, arenaRadius: 650, scaling: { ...TIER5 } }));
  const gear = kit === 'strong'
    ? { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT }
    : { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT };
  run.addPlayer(makeJoin(1, gear));
  const bot = createBot();
  const seen = new Set<string>();
  const digests: number[] = [];
  let result: 'cleared' | 'died' | 'timeout' = 'timeout';
  let lieutenant = '';
  let boss = '';
  for (let t = 0; t < Math.round((20 * MINUTE) / SIM_DT); t++) {
    const intent = bot.intent(run.view, 1);
    record?.push(structuredClone(intent));
    run.setIntent(1, intent);
    run.step();
    for (const e of run.drainEvents()) if (e.t === 'monsterSpawn') seen.add(e.kind);
    lieutenant ||= run.view.run.lieutenant?.name ?? '';
    boss ||= run.view.run.boss?.name ?? '';
    if (t % 300 === 299) digests.push(run.digest());
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
  return { result, seen, lieutenant, boss, digests, minutes: (run.view.tick * SIM_DT) / MINUTE };
}

describe('Tier 5', () => {
  it('a well-geared bot clears it through the whole roster, the Chainmaster and Varkus', () => {
    for (const seed of [1, 4]) {
      const r = playT5(seed, 'strong');
      expect(r.result, `seed ${seed} after ${r.minutes.toFixed(1)} min`).toBe('cleared');
      const roster = THEME_ROSTER.ironColiseum;
      for (const k of [...roster.family, roster.boss]) expect(r.seen.has(k), `seed ${seed}: ${k} never appeared`).toBe(true);
      expect(r.lieutenant).toBe('');
      expect(r.boss).toBe(monsterDef('varkus').name);
    }
  }, 60_000);

  it('a fairly geared bot clears at least 5 of seeds 1–6 (the 12-seed sweep: tests/sim/balance-ironColiseum.test.ts)', () => {
    const results = [1, 2, 3, 4, 5, 6].map((seed) => ({ seed, ...playT5(seed, 'fair') }));
    const summary = results.map((r) => `${r.seed}:${r.result === 'cleared' ? r.minutes.toFixed(1) : r.result}`).join(' ');
    console.info(`ironColiseum T5 fair: ${summary}`);
    expect(results.filter((r) => r.result === 'timeout'), summary).toEqual([]);
    expect(results.filter((r) => r.result === 'cleared').length, summary).toBeGreaterThanOrEqual(5);
  }, 60_000);
});

describe('determinism', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the same seed and inputs replay to the same world, and the roster never touches a non-deterministic source', () => {
    const boom = () => {
      throw new Error('non-deterministic source used by the sim');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    const intents: PlayerIntent[] = [];
    const first = playT5(7, 'strong', intents);
    expect(first.result).toBe('cleared');
    vi.restoreAllMocks();
    // Replay the recorded inputs into a fresh run.
    const { run } = createRunInternal(makeConfig({ theme: 'ironColiseum', seed: 7, arenaRadius: 650, scaling: { ...TIER5 } }));
    run.addPlayer(makeJoin(1, { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT }));
    const digests: number[] = [];
    for (let t = 0; t < intents.length; t++) {
      run.setIntent(1, intents[t]);
      run.step();
      run.drainEvents();
      run.drainOutcomes();
      if (t % 300 === 299) digests.push(run.digest());
    }
    expect(digests).toEqual(first.digests);
    expect(digests.length).toBeGreaterThan(20);
    // And a different seed makes a different fight.
    expect(playT5(8, 'strong').digests.slice(0, 5)).not.toEqual(first.digests.slice(0, 5));
  }, 60_000);
});
