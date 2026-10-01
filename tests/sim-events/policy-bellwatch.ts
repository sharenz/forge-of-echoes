// Bot policy for Bellwatch: hunt the Cantors that can be hurt (outer first; inner ones once no outer lives), closing to bow range.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

export function bellwatchPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(x => x.kind === 'bellwatch' && x.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { cantors: { id: number; inner: boolean; dead: boolean }[] };
  let best = -1, bestD = Infinity;
  for (const c of s.cantors) {
    if (c.dead) continue;
    const i = w.monsters.slotOf(c.id);
    if (i < 0) continue;
    const outerAlive = s.cantors.some(q => !q.dead && !q.inner);
    if (c.inner && outerAlive) continue;
    const d = Math.hypot(w.monsters.x[i] - p.x, w.monsters.y[i] - p.y);
    if (d < bestD) { best = i; bestD = d; }
  }
  if (best < 0 || bestD < 170) return best >= 0 ? { ...base, aimX: w.monsters.x[best], aimY: w.monsters.y[best] } : base;
  const dx = w.monsters.x[best] - p.x, dy = w.monsters.y[best] - p.y, l = Math.hypot(dx, dy) || 1;
  return { ...base, moveX: dx / l, moveY: dy / l, aimX: w.monsters.x[best], aimY: w.monsters.y[best] };
}
