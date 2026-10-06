// Rosters (GAME_SPEC §14): the registry, which monsters each map theme uses, and that every theme is
// playable end to end — the bot clears a tier-5 map of each, deterministically.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_ROSTER } from '../../src/contracts/bestiary';
import { MAP_BASE_IDS, MONSTER_KINDS, type MonsterKind, type Theme } from '../../src/contracts/content';
import { SIM_DT, type PlayerIntent, type SimRun } from '../../src/contracts/sim';
import { createRun } from '../../src/sim';
import { monsterDef, monsterDefs, rosterFor } from '../../src/sim/rosters';
import { createRunInternal } from '../../src/sim/run';
import { planWave } from '../../src/sim/waves';
import { createBot } from './bot';
import { STRONG_LOADOUT, TIER5, makeConfig, makeJoin, strongSkills, strongStats } from './fixtures';

const MAP_THEMES = MAP_BASE_IDS;
const ARENA: Record<(typeof MAP_THEMES)[number], number> = { ashenForge: 900, rimedOssuary: 900, ironColiseum: 650, cinderChapel: 800, choralCrypt: 850, chainworks: 700 };

describe('the registry', () => {
  it('has exactly one MonsterDef per monster kind, with sane stats', () => {
    const defs = monsterDefs();
    expect(defs).toHaveLength(MONSTER_KINDS.length);
    defs.forEach((d, k) => {
      expect(d.kind).toBe(MONSTER_KINDS[k]);
      expect(d.name.length).toBeGreaterThan(2);
      expect(d.radius).toBeGreaterThan(0);
      expect(d.life).toBeGreaterThan(0);
      expect(d.resist).toHaveLength(5);
      expect(typeof d.brain).toBe('function');
    });
  });

  it('every roster family is spawnable, its final boss is heavy and existing phase scripts remain', () => {
    for (const theme of MAP_THEMES) {
      const r = rosterFor(theme);
      expect(r).toEqual(THEME_ROSTER[theme]);
      for (const kind of r.family) expect(monsterDef(kind).fromWave, kind).toBeGreaterThan(0);
      expect(monsterDef(r.lieutenant).role).toBe('boss');
      expect(monsterDef(r.boss).role).toBe('boss');
      if (monsterDef(r.boss).boss) expect(monsterDef(r.boss).boss!.phases.length).toBeGreaterThanOrEqual(2);
      expect(monsterDef(r.boss).heavy).toBe(true);
      // GAME_SPEC §14: lieutenants ≈ Herald, bosses ≈ Matriarch.
      expect(monsterDef(r.lieutenant).life).toBeCloseTo(monsterDef('ashboundHerald').life, -2);
      // Bosses sit near the Matriarch; the Warden's base is lower because her map adds +20% monster life
      // (tests/sim-ossuary checks the effective value exactly).
      const bossLife = monsterDef(r.boss).life;
      const matriarch = monsterDef('cinderMatriarch').life;
      expect(Math.abs(bossLife - matriarch) / matriarch).toBeLessThanOrEqual(r.boss === r.lieutenant ? 0.25 : 0.2);
    }
    expect(rosterFor('hideout')).toEqual(THEME_ROSTER.ashenForge);
  });

  it('the special flags are where GAME_SPEC §14 puts them', () => {
    expect(monsterDef('rimeshade').ghost).toBe(true);
    expect(monsterDef('shieldbearer').block?.arc).toBeCloseTo((2 * Math.PI) / 3, 9);
    expect(monsterDef('ironhideBrute').hitReduction).toBeCloseTo(0.4, 9);
  });
});

describe('roster selection by theme', () => {
  it('plans every wave from the theme family only', () => {
    for (const theme of MAP_THEMES) {
      const { run, world } = createRunInternal(makeConfig({ theme, seed: 5, arenaRadius: ARENA[theme] }));
      run.addPlayer(makeJoin(1));
      const family = new Set<MonsterKind>(THEME_ROSTER[theme].family);
      for (let wave = 1; wave <= 6; wave++) {
        const plan = planWave(world, wave);
        for (const pk of plan.packs) for (const k of pk.members) expect(family.has(k), `${theme} wave ${wave}: ${k}`).toBe(true);
        for (const e of plan.streamWeights) expect(family.has(e.kind)).toBe(true);
        for (const k of plan.families) expect(family.has(k)).toBe(true);
      }
      // Heavier kinds join later waves: wave 6 has more kinds than wave 1.
      expect(planWave(world, 6).families.length).toBeGreaterThan(planWave(world, 1).families.length);
    }
  });
});

/** The bot plays a whole map; returns what happened. */
function playMap(theme: (typeof MAP_THEMES)[number], seed: number, record?: PlayerIntent[]) {
  const run = createRun(makeConfig({ theme, seed, arenaRadius: ARENA[theme], scaling: { ...TIER5 } }));
  run.addPlayer(makeJoin(1, { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT }));
  const bot = createBot();
  const seen = new Set<string>();
  const debuffs = new Set<string>();
  let result: 'cleared' | 'died' | 'timeout' = 'timeout';
  let lieutenant = '';
  let boss = '';
  const digests: number[] = [];
  const limit = Math.round((20 * 60) / SIM_DT);
  for (let t = 0; t < limit; t++) {
    const intent = bot.intent(run.view, 1);
    record?.push(structuredClone(intent));
    run.setIntent(1, intent);
    run.step();
    for (const e of run.drainEvents()) {
      if (e.t === 'monsterSpawn') seen.add(e.kind);
      if (e.t === 'debuff') debuffs.add(e.debuff);
    }
    lieutenant ||= run.view.run.lieutenant?.name ?? '';
    boss ||= run.view.run.boss?.name ?? '';
    if (t % 300 === 299) digests.push(run.digest());
    const out = run.drainOutcomes();
    if (out.some((o) => o.t === 'playerDied')) {
      result = 'died';
      break;
    }
    // The map is done when the boss falls (the bot's walk to the chest and portal isn't under test here).
    if (out.some((o) => o.t === 'cleared')) {
      result = 'cleared';
      break;
    }
  }
  return { result, seen, debuffs, lieutenant, boss, digests, digest: run.digest(), minutes: (run.view.tick * SIM_DT) / 60, run };
}

function replayMap(theme: (typeof MAP_THEMES)[number], seed: number, intents: PlayerIntent[]): number[] {
  const run: SimRun = createRun(makeConfig({ theme, seed, arenaRadius: ARENA[theme], scaling: { ...TIER5 } }));
  run.addPlayer(makeJoin(1, { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT }));
  const digests: number[] = [];
  for (let t = 0; t < intents.length; t++) {
    run.setIntent(1, intents[t]);
    run.step();
    run.drainEvents();
    run.drainOutcomes();
    if (t % 300 === 299) digests.push(run.digest());
  }
  return digests;
}

describe('every theme is playable end to end', () => {
  afterEach(() => vi.restoreAllMocks());

  for (const theme of MAP_THEMES) {
    it(`${theme}: the bot clears a tier-5 map through its whole roster and final boss — deterministically`, () => {
      const boom = () => {
        throw new Error('non-deterministic source used by the sim');
      };
      vi.spyOn(Math, 'random').mockImplementation(boom);
      vi.spyOn(Date, 'now').mockImplementation(boom);
      const intents: PlayerIntent[] = [];
      const r = playMap(theme, 32, intents);
      expect(r.result, `${theme} after ${r.minutes.toFixed(1)} min`).toBe('cleared');
      const roster = THEME_ROSTER[theme];
      for (const k of [...roster.family, roster.boss]) expect(r.seen.has(k), `${theme}: ${k} never appeared`).toBe(true);
      expect(r.lieutenant).toBe('');
      expect(r.boss).toBe(monsterDef(roster.boss).name);
      expect(r.debuffs.size).toBeGreaterThan(0);
      vi.restoreAllMocks();
      expect(replayMap(theme, 32, intents)).toEqual(r.digests);
    }, 120_000);
  }

  // How reliably a fairly geared character clears each theme (a guard against a roster drifting toward
  // unbeatable) is measured over 12 seeds per theme in tests/sim/balance-<theme>.test.ts.
});

describe('themes in a party', () => {
  it('two bots clear an Iron Coliseum together', () => {
    const run = createRun(makeConfig({ theme: 'ironColiseum' as Theme, seed: 12, arenaRadius: 650, scaling: { ...TIER5 } }));
    const kit = { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT };
    run.addPlayer(makeJoin(1, kit));
    run.addPlayer(makeJoin(2, { ...kit, name: 'Second' }));
    const bots = [createBot(), createBot()];
    let cleared = false;
    for (let t = 0; t < Math.round((15 * 60) / SIM_DT) && !cleared; t++) {
      for (const p of run.view.players) run.setIntent(p.id, bots[p.id - 1].intent(run.view, p.id));
      run.step();
      run.drainEvents();
      if (run.drainOutcomes().some((o) => o.t === 'cleared')) cleared = true;
    }
    expect(cleared).toBe(true);
  }, 120_000);
});
