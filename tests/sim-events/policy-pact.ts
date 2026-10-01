// Bot policy for the Pact Altar: walk to the first bold stone and stand on it (the altar is otherwise ignored). Fights on when
// the horde crowds in. Signature shared by the sweeps: (world, player id, the ordinary bot's intent) -> intent.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

/** Monsters within `r` of (x, y). */
export function crowd(w: World, x: number, y: number, r: number): number {
  const m = w.monsters;
  let n = 0;
  for (let i = 0; i < m.hwm; i++) if (m.alive[i] && Math.hypot(m.x[i] - x, m.y[i] - y) <= r) n++;
  return n;
}

/** Steer `base` toward (x, y) (stop when within `stop`). */
export function walkToward(w: World, playerId: number, base: PlayerIntent, x: number, y: number, stop = 8): PlayerIntent {
  const p = w.playerById[playerId];
  if (!p) return base;
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d <= stop) return { ...base, moveX: 0, moveY: 0 };
  return { ...base, moveX: dx / d, moveY: dy / d };
}

export function pactPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(x => x.kind === 'pactAltar' && x.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { open: boolean; stones: { x: number; y: number; state: number }[] };
  if (!s.open) return base;
  const stone = s.stones[0];
  if (!stone || stone.state !== 0) return base;
  if (crowd(w, p.x, p.y, 110) > 4) return base;
  return walkToward(w, playerId, base, stone.x, stone.y, 6);
}
