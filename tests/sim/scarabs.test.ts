import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { makeParty, makeSolo, makeStats } from './fixtures';
import { waveBudget } from '../../src/sim/waves';
import { spawnDrops } from '../../src/sim/loot';
import { rules } from '../../src/game';

describe('scarab wave director', () => {
  it('bonus scarab tosses preserve the ordinary loot ring and future world randomness', () => {
    const scarab = rules.dropSpec({ kind: 'currency', uid: 'bonus', currencyId: 'hasteScarab1', count: 1 }, 9, 1);
    expect(scarab.scatterSeed).toBeTypeOf('number');
    for (const fountain of [false, true]) for (const count of [0, 1, 2]) {
      const a = makeSolo().world, b = makeSolo().world;
      const ordinary = Array.from({ length: count }, (_, i) => rules.dropSpec({ kind: 'currency', uid: `scrap-${i}`, currencyId: 'scrap', count: 1 }, i, 1));
      spawnDrops(a, ordinary, 200, 200, fountain);
      spawnDrops(b, [scarab, ...ordinary], 200, 200, fountain);
      expect(b.worldRng.state()).toBe(a.worldRng.state());
      expect(b.drops.filter(d => d.spec.token !== 9)).toEqual(a.drops);
      expect(b.drops.filter(d => d.spec.token === 9)).toHaveLength(1);
    }
  });

  it.each([2, 3, 4, 5])('opens on wave %i with every earlier pack AND streaming monster already spawned', startWave => {
    const { run, world } = makeSolo({ waves: { startWave }, stats: makeStats({ maxLife: 1e9 }) });
    for (let t = 0; t < 300 && world.director.wave < startWave; t++) run.step();
    expect(world.director.wave).toBe(startWave);
    expect(world.director.stream.remaining).toBe(0);
    const counts = new Map<number, number>();
    for (let i = 0; i < world.monsters.hwm; i++) if (world.monsters.alive[i]) counts.set(world.monsters.wave[i], (counts.get(world.monsters.wave[i]) ?? 0) + 1);
    expect(counts.size).toBe(startWave);
    for (let wave = 1; wave <= startWave; wave++) expect(counts.get(wave)).toBe(waveBudget(world, wave, 1));
    expect(world.director.bossSpawned).toBe(false);
    const before = world.monsters.count;
    for (let t = 0; t < 100; t++) run.step();
    expect(world.monsters.count).toBe(before);
  });

  it('supports the full dense party opening above the normal streaming cap without discarding monsters', () => {
    const { run, world } = makeParty({ waves: { startWave: 5 }, scaling: { countMultiplier: 4 } }, Array.from({ length: 4 }, () => ({ stats: makeStats({ maxLife: 1e9 }) })));
    for (let t = 0; t < 300 && world.director.wave < 5; t++) run.step();
    expect(world.monsters.count).toBe([1, 2, 3, 4, 5].reduce((n, wave) => n + waveBudget(world, wave, 4), 0));
    expect(world.director.stream.remaining).toBe(0);
  });

  it('a half-duration scarab brings the next wave after 30 seconds while living monsters remain', () => {
    const { run, world } = makeSolo({ waves: { waveDuration: 30 }, stats: makeStats({ maxLife: 1e9 }) });
    while (world.director.wave < 1) run.step();
    let ticks = 0;
    while (world.director.wave < 2 && ticks < 2000) { run.step(); ticks++; }
    expect(ticks * SIM_DT).toBeCloseTo(30, 0);
    expect(world.monsters.count).toBeGreaterThan(40);
  });
});
