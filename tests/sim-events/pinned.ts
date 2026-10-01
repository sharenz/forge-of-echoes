// "Pinned" monster metric for the layout sweep, independent of the navigation code: a hunting, walking monster that has not moved
// 12 u in 5 s while a solid prop stands between it and the nearest living player (so it is held behind scenery, not queuing).
import { SIM_DT } from '../../src/contracts/sim';
import { resolveProps } from '../../src/sim/grid';
import { MFLAG, MSTATE } from '../../src/sim/stores';
import type { World } from '../../src/sim/world';

const WINDOW = 5;
const MOVED = 12;

function lineBlocked(w: World, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / 6));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (resolveProps(w.propGrid, ax + (bx - ax) * t, ay + (by - ay) * t, r).hit) return true;
  }
  return false;
}

export function pinnedMonsters() {
  const anchor = new Map<number, { x: number; y: number; t: number }>();
  const ids = new Set<number>();
  const examples: string[] = [];
  return {
    ids,
    examples,
    /** Call every ~0.5 s of sim time. */
    sample(w: World): void {
      const m = w.monsters;
      const now = w.tick * SIM_DT;
      for (let i = 0; i < m.hwm; i++) {
        if (!m.alive[i]) continue;
        const id = m.id[i];
        // Only a monster that has been hunting and walking the whole window can be pinned: anything else restarts the clock.
        const walking = !(m.flags[i] & (MFLAG.boss | MFLAG.frozen | MFLAG.fixture | MFLAG.ghost)) && m.state[i] === MSTATE.chase && m.spawnTime[i] <= 0
          && (m.pack[i] < 0 || w.packs[m.pack[i]].aggro);
        const a = anchor.get(id);
        if (!a || !walking || Math.hypot(m.x[i] - a.x, m.y[i] - a.y) >= MOVED) {
          anchor.set(id, { x: m.x[i], y: m.y[i], t: now });
          continue;
        }
        if (now - a.t < WINDOW || ids.has(id)) continue;
        let near = null as (typeof w.living)[number] | null;
        let nd = Infinity;
        for (const p of w.living) {
          const d = Math.hypot(p.x - m.x[i], p.y - m.y[i]);
          if (d < nd) { nd = d; near = p; }
        }
        if (!near || nd < 90 || nd > 900) continue;
        if (!lineBlocked(w, m.x[i], m.y[i], near.x, near.y, Math.min(m.radius[i], 12))) continue;
        ids.add(id);
        examples.push(`t=${now.toFixed(0)}s kind#${m.kind[i]} at ${m.x[i].toFixed(0)},${m.y[i].toFixed(0)} -> player ${near.x.toFixed(0)},${near.y.toFixed(0)}`);
      }
    },
  };
}
