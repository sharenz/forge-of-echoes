// Bot policy for Rival Crowns: go for the rival (60% life: the faster kill) and hold it in range; the bot's own kiting does the rest.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

export function rivalPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(q => q.kind === 'secondCrown' && q.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { b: number };
  const m = w.monsters;
  const i = s.b ? m.slotOf(s.b) : -1;
  if (i < 0) return base;
  const dx = m.x[i] - p.x, dy = m.y[i] - p.y, d = Math.hypot(dx, dy) || 1;
  const out: PlayerIntent = { ...base, aimX: m.x[i], aimY: m.y[i] };
  if (d > 320) { out.moveX = dx / d; out.moveY = dy / d; }
  return out;
}
