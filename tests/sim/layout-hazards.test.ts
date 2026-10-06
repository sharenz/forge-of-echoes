// Burning ground (roadmap 4, "make the art keep its promises"): slag pools and lava cracks of the Ashen Forge layouts are real
// hazards. The format, the flare schedule, the validator rule and the mechanic in the real sim.
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { compileLayout, layoutFor } from '../../src/data/layouts';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import { HAZARD_CRACK_CYCLE, hazardHits, hazardState, type CompiledHazard } from '../../src/data/layouts/hazards';
import { HAZARD_DAMAGE, onBurningHazard } from '../../src/sim/layout-hazards';
import { validateLayout } from '../../src/sim/layout-validate';
import { createRunInternal } from '../../src/sim/run';
import { isActive } from '../../src/sim/debuffs';
import { idleIntent, makeConfig, makeJoin, makeStats } from './fixtures';

const FY = 'furnaceYard' as const;
const fy = compileLayout(layoutFor(FY)!, areaRadius(FY));
const pool = fy.hazards.find((h) => h.id === 'slag-w')!;
const crack = fy.hazards.find((h) => h.id === 'crack-a')!;

function setup(areaId: AtlasAreaId, at: { x: number; y: number }) {
  const { run, world } = createRunInternal(
    makeConfig({ theme: areaTheme(areaId), seed: 3, arenaRadius: areaRadius(areaId), areaId, waves: { count: 1, baseMonsters: 1, monstersPerWave: 0, waveDuration: 9999, bossWave: 99 } }),
  );
  run.addPlayer(makeJoin(1, { stats: makeStats({ maxLife: 1e6, evasion: 0, moveSpeed: 110 }), x: at.x, y: at.y }));
  run.drainEvents();
  return { run, world, p: world.players[0] };
}

function idle(run: ReturnType<typeof setup>['run'], n: number): void {
  for (let k = 0; k < n; k++) {
    run.setIntent(1, idleIntent());
    run.step();
    run.drainEvents();
  }
}

/** First sim time >= t0 at which the crack is in `state`. */
function nextState(h: CompiledHazard, state: 0 | 1 | 2, t0 = 0): number {
  for (let t = t0; t < t0 + 30; t += 1 / 60) if (hazardState(h, t).state === state) return t;
  throw new Error('never');
}

describe('burning ground: format and schedule', () => {
  it('every Ashen Forge slag pool and lava crack is a hazard, drawn from the decal itself', () => {
    for (const id of ['furnaceYard', 'crownFoundry', 'emberRoad', 'shatteredForge', 'cinderCrossing', 'heartOfForge'] as const) {
      const c = compileLayout(layoutFor(id)!, areaRadius(id));
      const art = c.decals.filter((d) => d.kind === 'crack' || d.kind === 'pool');
      expect(art.length, id).toBeGreaterThan(0);
      expect(c.hazards.map((h) => h.id).sort(), id).toEqual(art.map((d) => d.id).sort());
    }
    expect(pool.shape).toBe('disc');
    expect(pool.cycle).toBeNull();
    expect(pool.r).toBe(66);
    expect(crack.shape).toBe('band');
    expect(crack.cycle).toEqual(HAZARD_CRACK_CYCLE);
  });

  it('a crack warns for 1.5 s before every flare, burns 2.5 s, then rests; the phase is fixed by its id (no seed)', () => {
    const tTele = nextState(crack, 1, nextState(crack, 0));
    const tBurn = nextState(crack, 2, tTele);
    expect(tBurn - tTele).toBeCloseTo(HAZARD_CRACK_CYCLE.telegraph, 1);
    const tRest = nextState(crack, 0, tBurn);
    expect(tRest - tBurn).toBeCloseTo(HAZARD_CRACK_CYCLE.active, 1);
    expect(nextState(crack, 1, tRest) - tTele).toBeCloseTo(HAZARD_CRACK_CYCLE.every, 1);
    const again = compileLayout(layoutFor(FY)!, areaRadius(FY)).hazards.find((h) => h.id === 'crack-a')!;
    expect(again.offset).toBe(crack.offset);
    // Different cracks flare at different times.
    const offsets = new Set(fy.hazards.filter((h) => h.cycle).map((h) => h.offset));
    expect(offsets.size).toBeGreaterThan(1);
  });

  it('the footprint: on the pool, beside it, on the crack line', () => {
    expect(hazardHits(pool, pool.x, pool.y, 0)).toBe(true);
    expect(hazardHits(pool, pool.x + pool.r + 20, pool.y, 0)).toBe(false);
    const a = crack.path[0];
    expect(hazardHits(crack, a.x, a.y, 0)).toBe(true);
    expect(hazardHits(crack, a.x + 80, a.y + 80, 0)).toBe(false);
  });

  it('validator check 11: ground that always burns must not touch the landing or the boss stage', () => {
    const l = structuredClone(layoutFor(FY)!);
    const c = compileLayout(l, areaRadius(FY));
    l.decals.push({ id: 'bad-pool', kind: 'pool', at: [c.start.x / c.R, c.start.y / c.R], r: 40, hazard: { kind: 'burn' } });
    l.decals.push({ id: 'boss-pool', kind: 'pool', at: [c.bossStage.x / c.R, c.bossStage.y / c.R], r: 40, hazard: { kind: 'burn' } });
    l.decals.push({ id: 'fast-crack', kind: 'crack', path: [[0.3, 0.1], [0.4, 0.1]], hazard: { kind: 'burn', cycle: { every: 3, telegraph: 0.5, active: 2 } } });
    const msgs = validateLayout(l).issues.filter((i) => i.check === 11).map((i) => i.message);
    expect(msgs.some((m) => m.includes('bad-pool') && m.includes('start clearing'))).toBe(true);
    expect(msgs.some((m) => m.includes('boss-pool') && m.includes('boss stage'))).toBe(true);
    expect(msgs.some((m) => m.includes('fast-crack') && m.includes('telegraph'))).toBe(true);
  });
});

describe('burning ground in the sim', () => {
  it('standing in a slag pool burns: fire damage every half second and the burning debuff', () => {
    const { run, p } = setup(FY, { x: pool.x, y: pool.y });
    const life0 = p.life;
    idle(run, 70);
    expect(p.life).toBeLessThan(life0);
    expect(isActive(p, 'burning')).toBe(true);
    expect(onBurningHazard(fy.hazards, p.x, p.y, 0)).toBe(true);
    // Roughly two to three burns of HAZARD_DAMAGE x the map's multiplier (plus the burn's own ticks): small, not a one-shot.
    expect(life0 - p.life).toBeLessThan(HAZARD_DAMAGE * 40);
  });

  it('a few steps beside the pool nothing happens', () => {
    const { run, p } = setup(FY, { x: pool.x + pool.r + 40, y: pool.y });
    const life0 = p.life;
    idle(run, 120);
    expect(p.life).toBe(life0);
  });

  it('a lava crack burns only while it flares, never while it warns or rests', () => {
    const a = crack.path[1];
    const { run, world, p } = setup(FY, { x: a.x, y: a.y });
    const life0 = p.life;
    // Rest up to just before the first flare starts (telegraph included): no damage at all.
    const tBurn = nextState(crack, 2, nextState(crack, 1, 0.5));
    while (world.time < tBurn - 0.05) idle(run, 1);
    expect(p.life).toBe(life0);
    idle(run, 60);
    expect(p.life).toBeLessThan(life0);
  });

  it('once the map is cleared the ground stops burning', () => {
    const { run, world, p } = setup(FY, { x: pool.x, y: pool.y });
    world.director.cleared = true;
    const life0 = p.life;
    idle(run, 70);
    expect(p.life).toBe(life0);
  });
});
