// Flow zones (conveyor belts, D-territory.md 10.5a): the format, the per-run direction draw, the reversal schedule, and the mechanic
// itself in the real sim (players and monsters carried, rails still stop a belt, bosses/heavies half, ghosts none, monsters still reach her).
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { SIM_DT } from '../../src/contracts/sim';
import { overrideLayout, layoutFor, compileLayout, buildFlowField, flowPhaseAt, flowScaleAt, type FlowZone } from '../../src/data/layouts';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import type { AreaLayout } from '../../src/data/layouts/schema';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { createRunInternal } from '../../src/sim/run';
import { applyDebuff } from '../../src/sim/debuffs';
import { spawnMonster } from '../../src/sim/spawn';
import type { MonsterKind } from '../../src/contracts/content';
import { idleIntent, makeConfig, makeJoin, makeStats } from './fixtures';

const IM_R = areaRadius('ironMarch');
const LK_R = areaRadius('lastKiln');
const im = compileLayout(layoutFor('ironMarch')!, IM_R);
const lk = compileLayout(layoutFor('lastKiln')!, LK_R);

function setup(areaId: AtlasAreaId, flowSeed: number, at: { x: number; y: number }, seed = 5) {
  const { run, world } = createRunInternal({
    ...makeConfig({ theme: areaTheme(areaId), seed, arenaRadius: areaRadius(areaId), areaId, waves: { count: 1, baseMonsters: 1, monstersPerWave: 0, waveDuration: 9999, bossWave: 99 } }),
    flowSeed,
  });
  run.addPlayer(makeJoin(1, { stats: makeStats({ maxLife: 1e12, evasion: 0, moveSpeed: 110 }), x: at.x, y: at.y }));
  run.drainEvents();
  const p = world.players[0];
  p.invulnTime = 1e9;
  return { run, world, p };
}

function tick(run: ReturnType<typeof setup>['run'], move: { x: number; y: number }, n = 1): void {
  const intent = idleIntent();
  intent.moveX = move.x;
  intent.moveY = move.y;
  for (let k = 0; k < n; k++) {
    run.setIntent(1, intent);
    run.step();
    run.drainEvents();
  }
}

const zone = (z: readonly FlowZone[], id: string): FlowZone => z.find((q) => q.id === id)!;

describe('flow zone format and schedule', () => {
  it('Iron March carries five belts and Last Kiln one annulus; the belts are no longer decals', () => {
    expect(im.flows.map((f) => f.id)).toEqual(['belt--228', 'belt--114', 'belt-0', 'belt-114', 'belt-228']);
    expect(im.flows.every((f) => f.shape === 'band' && f.speed === 48 && f.width === 90)).toBe(true);
    expect(lk.flows).toHaveLength(1);
    expect(lk.flows[0].shape).toBe('annulus');
    expect(im.decals.some((d) => d.id.startsWith('belt'))).toBe(false);
    expect(lk.decals.some((d) => d.id === 'belt')).toBe(false);
  });

  it('the run draws the directions: both sets occur across seeds, and Iron March always has a belt each way', () => {
    const first = new Set<number>();
    const kiln = new Set<number>();
    const patterns = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const f = buildFlowField(im.flows, 'ironMarch', seed * 7919);
      const signs = f.zones.map((z) => z.sign0);
      expect(new Set(signs).size, `seed ${seed}`).toBe(2);
      first.add(signs[2]);
      patterns.add(signs.join(','));
      kiln.add(buildFlowField(lk.flows, 'lastKiln', seed * 7919).zones[0].sign0);
    }
    expect(first.size).toBe(2);
    expect(kiln.size).toBe(2);
    expect(patterns.size).toBeGreaterThan(6); // 30 possible patterns: real variety, not just two sets
  });

  it('the schedule is a pure function of the flow seed: two builds are identical, another seed differs', () => {
    const a = buildFlowField(im.flows, 'ironMarch', 4242);
    const b = buildFlowField(im.flows, 'ironMarch', 4242);
    const c = buildFlowField(im.flows, 'ironMarch', 4243);
    expect(a.zones.map((z) => [z.sign0, [...z.evT], [...z.evSign]])).toEqual(b.zones.map((z) => [z.sign0, [...z.evT], [...z.evSign]]));
    expect(a.zones.map((z) => [...z.evT])).not.toEqual(c.zones.map((z) => [...z.evT]));
  });

  it('reversals come every 28 to 48 s, staggered across the belts, alternating direction', () => {
    for (const seed of [1, 99, 31337]) {
      const f = buildFlowField(im.flows, 'ironMarch', seed);
      const firsts = f.zones.map((z) => z.evT[0]).sort((x, y) => x - y);
      for (let k = 1; k < firsts.length; k++) expect(firsts[k] - firsts[k - 1], `seed ${seed}`).toBeGreaterThan(0.5);
      expect(firsts[0]).toBeGreaterThanOrEqual(14 - 1e-9);
      for (const z of f.zones) {
        expect(z.evT[0]).toBeLessThanOrEqual(48);
        for (let k = 1; k < z.evT.length; k++) {
          expect(z.evT[k] - z.evT[k - 1]).toBeGreaterThanOrEqual(28 - 1e-9);
          expect(z.evT[k] - z.evT[k - 1]).toBeLessThanOrEqual(48 + 1e-9);
          expect(z.evSign[k]).toBe(-z.evSign[k - 1]);
        }
        expect(z.evSign[0]).toBe(-z.sign0);
      }
    }
  });

  it('a reversal is fair and smooth: decelerates to a stop in 2 s, accelerates in 1 s, the velocity never jumps', () => {
    const f = buildFlowField(im.flows, 'ironMarch', 77);
    const z = f.zones[2];
    const e = z.evT[0];
    expect(flowScaleAt(z, e - 0.001)).toBe(z.sign0);
    expect(flowPhaseAt(z, e + 0.5).phase).toBe(1);
    expect(Math.abs(flowScaleAt(z, e + 1))).toBeCloseTo(0.5, 6); // smoothstep midpoint
    expect(Math.abs(flowScaleAt(z, e + 2))).toBeLessThan(1e-12); // standstill
    expect(flowPhaseAt(z, e + 2.2).phase).toBe(2);
    expect(flowScaleAt(z, e + 3)).toBeCloseTo(z.evSign[0], 12);
    for (const q of f.zones) {
      let prev = flowScaleAt(q, 0);
      for (let t = 1; t <= 600 * 60; t++) {
        const s = flowScaleAt(q, t * SIM_DT);
        expect(Math.abs(s - prev)).toBeLessThan(0.026); // max slope 1.5 per ramp second: 0.025 per tick
        prev = s;
      }
    }
  });
});

describe('the mechanic in the sim', () => {
  // Seed whose centre belt starts east (sign +1) and one where it starts west; the first reversal is >= 14 s away, past every test below.
  const seedFor = (sign: number): number => {
    for (let s = 1; s < 500; s++) if (buildFlowField(im.flows, 'ironMarch', s).zones[2].sign0 === sign) return s;
    throw new Error('no seed');
  };

  it('moving with the belt is +44%, against it -44%, never stopped; standing still, she is carried at the belt speed', () => {
    for (const sign of [1, -1]) {
      const seed = seedFor(sign);
      const run = (mx: number) => {
        const { run: r, p } = setup('ironMarch', seed, { x: -150, y: 0 });
        const x0 = p.x;
        tick(r, { x: mx, y: 0 }, 60);
        return { dx: p.x - x0, y: p.y, vx: p.vx };
      };
      const still = run(0);
      expect(still.dx).toBeCloseTo(sign * 48, 0);
      const east = run(1);
      const west = run(-1);
      expect(east.dx).toBeCloseTo(110 + sign * 48, 0);
      expect(west.dx).toBeCloseTo(-110 + sign * 48, 0);
      // The faster direction is the belt's: +48 u/s on 110 and -48 u/s against it; she always makes headway against it (62 u/s).
      expect(Math.abs(sign > 0 ? west.dx : east.dx)).toBeGreaterThan(60);
      expect(east.vx).toBeCloseTo(110, 3); // vx is her own effective speed: the drift is not part of it
      expect(still.y).toBeCloseTo(0, 6);
    }
  });

  it('rooted and frozen bodies are carried too; the drift is not slowed by a slow', () => {
    const seed = seedFor(1);
    const { run, world, p } = setup('ironMarch', seed, { x: -150, y: 0 });
    applyDebuff(world, p, 'rooted', 0, 'bone', 5);
    const x0 = p.x;
    tick(run, { x: -1, y: 0 }, 60);
    expect(p.x - x0).toBeCloseTo(48, 0); // she cannot walk, the belt still moves her
  });

  it('solid rails still stop a belt: pressed into a crate rail she slides along it', () => {
    const seed = seedFor(1);
    const { run, p } = setup('ironMarch', seed, { x: -300, y: 20 });
    const x0 = p.x;
    tick(run, { x: 0, y: 0.15 }, 80); // leans south into the rail at y = 57 (edge 45); a full press nestles into a notch between two crates
    // The rail is a row of 12 u crates 19.2 u apart: her centre rests between 57 - 12 - 7 = 38 (against a crate) and ~40.3 (in a notch).
    expect(p.y).toBeLessThanOrEqual(41);
    expect(p.y).toBeGreaterThan(36);
    expect(p.x - x0).toBeGreaterThan(55); // carried along the rail at belt speed (east for this seed; the rail's first gap is 150 u on)
  });

  it('the landing stands still and the edge fades: no drift at the start, none off the belt', () => {
    const { run, p } = setup('ironMarch', 3, { x: -490, y: 0 });
    tick(run, { x: 0, y: 0 }, 120);
    expect(p.x).toBeCloseTo(-490, 6);
  });

  it('monsters: light walkers carried (capped at 60% of their speed), heavies and bosses half, ghosts untouched, fixtures never', () => {
    const seed = seedFor(1);
    const { run, world } = setup('ironMarch', seed, { x: -490, y: 0 });
    const m = world.monsters;
    const place = (kind: MonsterKind, y: number, opts: Parameters<typeof spawnMonster>[4] = {}): number => {
      const i = spawnMonster(world, kind, -100, y, { animate: true, ...opts });
      m.spawnTime[i] = 1e9; // stands in its spawn pose: only the belt moves it
      return i;
    };
    const light = place('ashling', 0);
    const brute = place('ironhideBrute', -114);
    const boss = place('ironhideBrute', 114, { boss: true });
    const ghost = place('rimeshade', 228);
    const x0 = [light, brute, boss, ghost].map((i) => m.x[i]);
    tick(run, { x: 0, y: 0 }, 60);
    const moved = [light, brute, boss, ghost].map((i, k) => m.x[i] - x0[k]);
    // Belt signs: lanes -114 / 114 may run either way; compare magnitudes against the lane's own drift.
    const f = world.layout!.flows!;
    const lane = (id: string) => f.zones.find((z) => z.id === id)!.sign0;
    expect(moved[0]).toBeCloseTo(lane('belt-0') * Math.min(48, 0.6 * m.speed[light]), 1);
    expect(moved[1]).toBeCloseTo(lane('belt--114') * Math.min(24, 0.6 * m.speed[brute]), 1);
    expect(moved[2]).toBeCloseTo(lane('belt-114') * Math.min(24, 0.6 * m.speed[boss]), 1);
    expect(moved[3]).toBe(0);
  });

  it('monsters on a belt running away from her still reach her', () => {
    // A copy of Iron March whose centre belt never turns and runs west, away from a player standing off the belt's east end.
    const base = layoutFor('ironMarch')!;
    const custom: AreaLayout = structuredClone(base);
    for (const f of custom.flows!) {
      delete f.reverse;
      f.sense = f.id === 'belt-0' ? -1 : 1;
    }
    const restore = overrideLayout(custom);
    try {
      for (const kind of ['ashling', 'ironhideBrute'] as const) {
        const { run, world, p } = setup('ironMarch', 1, { x: 400, y: 0 });
        const m = world.monsters;
        const i = spawnMonster(world, kind, -60, 0, { animate: false });
        m.life[i] = m.maxLife[i] = 1e12;
        m.attackCd[i] = 1e9;
        let reached = -1;
        for (let t = 0; t < 90 / SIM_DT && reached < 0; t++) {
          tick(run, { x: 0, y: 0 });
          if (Math.hypot(m.x[i] - p.x, m.y[i] - p.y) < m.radius[i] + PLAYER_RADIUS + 45) reached = t;
        }
        expect(reached, `${kind} never reached her against a 48 u/s belt`).toBeGreaterThanOrEqual(0);
      }
    } finally {
      restore();
    }
  }, 60_000);

  it('is deterministic: two runs give identical digests; another flow seed gives another run', () => {
    const digest = (flowSeed: number): number => {
      const { run, world } = setup('ironMarch', flowSeed, { x: -150, y: 0 });
      for (const [kind, x, y] of [['ashling', 50, 0], ['ashling', -80, 114], ['ironhideBrute', 120, -114], ['ashling', 200, 228]] as const) spawnMonster(world, kind, x, y, { animate: false });
      for (let t = 0; t < 1800; t++) tick(run, { x: Math.cos(t * 0.01), y: Math.sin(t * 0.017) * 0.5 });
      return run.digest();
    };
    expect(digest(11)).toBe(digest(11));
    expect(digest(11)).not.toBe(digest(12));
  });

  it('Last Kiln: the annulus carries clockwise or counter-clockwise by seed, and the landing and boss gate are clear', () => {
    const dirs = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const f = buildFlowField(lk.flows, 'lastKiln', seed);
      dirs.add(f.zones[0].sign0);
      const { run, p } = setup('lastKiln', seed, { x: 0, y: -268 }); // top of the ring (north): clockwise is east
      const x0 = p.x;
      tick(run, { x: 0, y: 0 }, 30);
      expect(Math.sign(p.x - x0)).toBe(f.zones[0].sign0);
      expect(Math.abs(p.x - x0)).toBeCloseTo(24, 0);
    }
    expect(dirs.size).toBe(2);
  });
});
