// Bot policy for the Champion's Ring: walk onto a vow (Iron Pride, so flasks stay available), then step into the ring and let the
// ordinary bot fight the Champion. Signature shared by every event policy: (world, playerId, the bot's ordinary intent) -> intent.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

export const RING_POLICY_VOW = 1;

function walk(p: { x: number; y: number }, x: number, y: number, base: PlayerIntent): PlayerIntent {
  const dx = x - p.x, dy = y - p.y, l = Math.hypot(dx, dy) || 1;
  return { ...base, moveX: dx / l, moveY: dy / l };
}

export function ringPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(q => q.kind === 'ring' && q.phase !== 'complete' && q.phase !== 'failed');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { center: { x: number; y: number }; stones: { x: number; y: number }[] };
  if (e.phase === 'available') {
    const st = s.stones[RING_POLICY_VOW];
    return Math.hypot(p.x - st.x, p.y - st.y) > 8 ? walk(p, st.x, st.y, base) : { ...base, moveX: 0, moveY: 0 };
  }
  // In the ring: fight from inside (the ordinary bot kites; keep it from wandering out past the chains).
  const d = Math.hypot(p.x - s.center.x, p.y - s.center.y);
  if (d > 140) return walk(p, s.center.x, s.center.y, base);
  return base;
}
