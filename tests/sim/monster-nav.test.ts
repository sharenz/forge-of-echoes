// Monster wall navigation (src/sim/nav.ts): in every hand-crafted layout a hunting monster that starts where a solid prop blocks its
// straight line to the player walks round the walls and reaches her; the navigation is deterministic and never touches old-generator maps.
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { SIM_DT } from '../../src/contracts/sim';
import { registeredLayouts } from '../../src/data/layouts';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { resolveProps } from '../../src/sim/grid';
import { navStats } from '../../src/sim/nav';
import { createRunInternal } from '../../src/sim/run';
import { spawnMonster } from '../../src/sim/spawn';
import type { World } from '../../src/sim/world';
import { idleIntent, makeConfig, makeJoin, makeStats } from './fixtures';

const CELL = 12;

function lineBlocked(w: World, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (resolveProps(w.propGrid, ax + (bx - ax) * t, ay + (by - ay) * t, r).hit) return true;
  }
  return false;
}

/** Cells (CELL u) reachable from (sx, sy) for a body of radius 14: an independent flood used only to pick fair test spots. */
function reachable(w: World, sx: number, sy: number): (x: number, y: number) => boolean {
  const R = w.arenaRadius;
  const n = Math.ceil((R * 2) / CELL);
  const seen = new Uint8Array(n * n);
  const free = (i: number, j: number) => {
    const x = (i + 0.5) * CELL - R;
    const y = (j + 0.5) * CELL - R;
    return x * x + y * y < (R - 30) * (R - 30) && !resolveProps(w.propGrid, x, y, 14).hit;
  };
  const si = Math.floor((sx + R) / CELL);
  const sj = Math.floor((sy + R) / CELL);
  const q: number[] = [sj * n + si];
  seen[sj * n + si] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h] % n;
    const j = (q[h] - i) / n;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n || seen[b * n + a] || !free(a, b)) continue;
      seen[b * n + a] = 1;
      q.push(b * n + a);
    }
  }
  return (x, y) => {
    const i = Math.floor((x + R) / CELL);
    const j = Math.floor((y + R) / CELL);
    return i >= 0 && j >= 0 && i < n && j < n && seen[j * n + i] === 1;
  };
}

function setup(areaId: AtlasAreaId, seed = 7) {
  const { run, world } = createRunInternal(makeConfig({
    theme: areaTheme(areaId), seed, arenaRadius: areaRadius(areaId), areaId,
    // No waves during the test: a single far-off wave timer.
    waves: { count: 1, baseMonsters: 1, monstersPerWave: 0, waveDuration: 9999, bossWave: 99 },
  }));
  const start = world.layout!.compiled.start;
  run.addPlayer(makeJoin(1, { stats: makeStats({ maxLife: 1e12, evasion: 0 }), x: start.x, y: start.y }));
  run.drainEvents();
  return { run, world, start };
}

/** Up to `count` free spots behind walls from (sx, sy): blocked straight line, reachable on foot, spread out. */
function spotsBehindWalls(w: World, sx: number, sy: number, count: number): { x: number; y: number }[] {
  const ok = reachable(w, sx, sy);
  const R = w.arenaRadius;
  const cands: { x: number; y: number; d: number }[] = [];
  for (let x = -R + 80; x <= R - 80; x += 60) {
    for (let y = -R + 80; y <= R - 80; y += 60) {
      const d = Math.hypot(x - sx, y - sy);
      if (d < 160 || d > 700 || Math.hypot(x, y) > R - 90) continue;
      if (resolveProps(w.propGrid, x, y, 22).hit || !ok(x, y) || !lineBlocked(w, x, y, sx, sy, 12)) continue;
      cands.push({ x, y, d });
    }
  }
  cands.sort((a, b) => b.d - a.d || a.x - b.x || a.y - b.y);
  const out: { x: number; y: number }[] = [];
  for (const c of cands) {
    if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= 220)) out.push(c);
    if (out.length >= count) break;
  }
  return out;
}

describe('monster navigation round layout walls', () => {
  for (const layout of registeredLayouts()) {
    it(`${layout.areaId}: monsters walled off from the player reach her`, () => {
      const { run, world, start } = setup(layout.areaId);
      const spots = spotsBehindWalls(world, start.x, start.y, 4);
      expect(spots.length, `${layout.areaId}: no walled-off test spots`).toBeGreaterThan(0);
      const slots = spots.map((s) => {
        const i = spawnMonster(world, 'ashling', s.x, s.y, { animate: false });
        world.monsters.life[i] = world.monsters.maxLife[i] = 1e12;
        world.monsters.attackCd[i] = 1e9; // no damage numbers to care about
        return i;
      });
      const reached = slots.map(() => -1);
      const m = world.monsters;
      const p = world.players[0];
      for (let t = 0; t < Math.round(75 / SIM_DT); t++) {
        run.setIntent(1, idleIntent());
        run.step();
        run.drainEvents();
        for (let k = 0; k < slots.length; k++) {
          if (reached[k] < 0 && Math.hypot(m.x[slots[k]] - p.x, m.y[slots[k]] - p.y) < m.radius[slots[k]] + PLAYER_RADIUS + 45) reached[k] = t;
        }
        if (reached.every((r) => r >= 0)) break;
      }
      const lost = reached.map((r, k) => (r < 0 ? `${spots[k].x},${spots[k].y}` : '')).filter(Boolean);
      expect(lost, `${layout.areaId}: never reached the player from`).toEqual([]);
      expect(navStats(world)).not.toBeNull();
    }, 60_000);
  }

  it('a layout run is deterministic: two runs of one seed give identical digests', () => {
    const digests = [0, 1].map(() => {
      const { run, world } = setup('glassSepulchre', 11);
      const start = world.layout!.compiled.start;
      for (const s of spotsBehindWalls(world, start.x, start.y, 3)) spawnMonster(world, 'ashling', s.x, s.y, { animate: false });
      for (let t = 0; t < 1200; t++) {
        run.setIntent(1, idleIntent());
        run.step();
        run.drainEvents();
      }
      return run.digest();
    });
    expect(digests[0]).toBe(digests[1]);
  });

  it('old-generator maps never create navigation state', () => {
    const { run, world } = createRunInternal(makeConfig({ theme: 'ashenForge' }));
    run.addPlayer(makeJoin(1, { x: 0, y: 0 }));
    for (let t = 0; t < 120; t++) run.step();
    expect(world.layout).toBeNull();
    expect(navStats(world)).toBeNull();
  });
});
