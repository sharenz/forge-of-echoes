// Whole Rimed Ossuary maps played by the bot (tests/sim/bot.ts): a new-ish character clears Tier 1 (and a
// fresh one, built by the real rules, clears the Tier 1 Ossuary from her starting kit), the fair Tier 5
// character clears Tier 5 through the whole roster, and a run replays to the same digests.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OSSUARY_MONSTERS } from '../../src/contracts/bestiary';
import type { PlayerIntent } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { monsterDef } from '../../src/sim/rosters';
import { describePlay, mapInBag, playMap } from '../game-progression/playthrough';
import { TIER1_OSSUARY, TIER5, fairPlayer, newishPlayer, playOssuary, replayOssuary } from './helpers';

const summary = (label: string, r: ReturnType<typeof playOssuary>) =>
  `${label}: ${r.result} in ${r.minutes.toFixed(1)} min, lowest life ${Math.round(r.minLife * 100)}% `
  + `(Warden ${Math.round(r.bossMinLife * 100)}%), flasks ${r.flasks}, debuffs ${JSON.stringify(Object.fromEntries(r.debuffs))}`;

describe('Tier 1 Rimed Ossuary', () => {
  it('a new-ish character (level 6, starting gear) clears it on every seed, and it pushes back', () => {
    const results = [1, 2, 3].map((seed) => playOssuary(seed, newishPlayer(), { ...TIER1_OSSUARY }));
    results.forEach((r, k) => console.info(summary(`T1 new-ish seed ${k + 1}`, r)));
    for (const r of results) {
      expect(r.result, summary('T1', r)).toBe('cleared');
      expect(r.unfair).toEqual([]);
    }
    // Not a stroll: the horde and the Warden get to her, and even the dodging bot gets webbed now and then.
    expect(Math.min(...results.map((r) => r.minLife))).toBeLessThan(0.85);
    expect(results.some((r) => r.flasks > 0)).toBe(true);
    expect(results.reduce((n, r) => n + r.roots, 0)).toBeGreaterThan(0);
  }, 120_000);

  it('a fresh character (the real rules, her starting kit) clears the Tier 1 Ossuary she starts with, through the portals', () => {
    for (const seed of [1, 2]) {
      const ch = rules.createCharacter('Rimewalker', seed);
      const map = mapInBag(ch, (m) => m.baseId === 'rimedOssuary' && m.tier === 1);
      expect(map, 'the starting kit has a Tier 1 Rimed Ossuary').not.toBeNull();
      const r = playMap(ch, map!, { maxMinutes: 25, reenterAfter: 12 });
      console.info(`fresh character seed ${seed}: ${describePlay(r)}`);
      expect(r.result, describePlay(r)).toBe('cleared');
      expect(r.levelEnd).toBeGreaterThanOrEqual(4);
    }
  }, 120_000);
});

describe('Tier 5 Rimed Ossuary', () => {
  it('the fair character clears it through the whole roster, the Chorister and the Warden', () => {
    const results = [3, 4].map((seed) => {
      const r = playOssuary(seed, fairPlayer(), { ...TIER5 });
      console.info(summary(`T5 fair seed ${seed}`, r));
      return r;
    });
    for (const r of results) {
      expect(r.result, summary('T5', r)).toBe('cleared');
      for (const k of OSSUARY_MONSTERS) expect(r.seen.has(k), `${k} never appeared`).toBe(true);
      expect(r.lieutenant).toBe(monsterDef('boneChorister').name);
      expect(r.boss).toBe(monsterDef('hollowWarden').name);
      expect(r.debuffs.get('chilled') ?? 0).toBeGreaterThan(0);
      expect(r.unfair).toEqual([]);
      // The Warden makes her drink.
      expect(r.flasks, summary('T5', r)).toBeGreaterThan(0);
    }
    // It hurts, at least as much as the Ashen Forge: over seeds 1–12 this well-geared character's Forge runs bottom out
    // at 71–96% life (median 92%), its Ossuary runs at 65–96% (median 83%). It fells the Warden in 10–50 s, and she
    // still lands her blows.
    expect(Math.min(...results.map((r) => r.minLife))).toBeLessThan(0.9);
    expect(Math.min(...results.map((r) => r.bossMinLife))).toBeLessThan(0.97);
  }, 120_000);
});

describe('determinism', () => {
  afterEach(() => vi.restoreAllMocks());

  it('same seed and intents give the same digests; the roster never touches Math.random or the clock', () => {
    const boom = () => {
      throw new Error('non-deterministic source used by the sim');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    const intents: PlayerIntent[] = [];
    const r = playOssuary(7, fairPlayer(), { ...TIER5 }, { record: intents });
    expect(r.result).toBe('cleared');
    expect(r.digests.length).toBeGreaterThan(10);
    vi.restoreAllMocks();
    expect(replayOssuary(7, fairPlayer(), { ...TIER5 }, intents)).toEqual(r.digests);
  }, 120_000);

  it('no clock or unseeded randomness anywhere in the roster source', () => {
    const dir = fileURLToPath(new URL('../../src/sim/rosters/ossuary/', import.meta.url));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });
});
