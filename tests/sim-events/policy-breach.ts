// Bot policy for the Void Breach: walk to the eye to open it, then stay INSIDE the safe ring (stepping in ahead of the next band, a
// few seconds before it telegraphs), fight the Voidcallers, and once the ward is down stand at the Heart and shoot it.
// Signature shared by every event policy: (world, playerId, the bot's ordinary intent) -> intent.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

interface BreachShape { center: { x: number; y: number }; safe: number[]; step: number; t: number; heart: number; warded: boolean; callers: Set<number> }

export function breachPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(q => q.kind === 'voidBreach' && q.phase !== 'complete' && q.phase !== 'failed');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as BreachShape;
  const dx = s.center.x - p.x, dy = s.center.y - p.y, d = Math.hypot(dx, dy) || 1;
  const toward = (x: number, y: number, stop: number): PlayerIntent => {
    const ex = x - p.x, ey = y - p.y, l = Math.hypot(ex, ey) || 1;
    return l <= stop ? { ...base, moveX: 0, moveY: 0 } : { ...base, moveX: ex / l, moveY: ey / l };
  };
  if (e.phase === 'available') return toward(s.center.x, s.center.y, 40);
  if (e.phase !== 'active') return base;
  // The safe radius now, and the next one once a step is within five seconds (plus a margin for the walk).
  const level = Math.max(0, s.step - 1);
  let safe = s.safe[level] - 50;
  const untilStep = s.step < s.safe.length ? s.step * 14 - s.t : Infinity;
  if (untilStep < 6 && s.step < s.safe.length) safe = Math.min(safe, s.safe[s.step] - 50);
  if (d > safe) return { ...base, moveX: dx / d, moveY: dy / d };
  // The ward is down: stand near the Heart and shoot it.
  if (!s.warded && s.heart >= 0) {
    const i = w.monsters.slotOf(s.heart);
    if (i >= 0) {
      const hx = w.monsters.x[i], hy = w.monsters.y[i];
      const held = base.held.map((_, k) => k === 0);
      const moved = toward(hx, hy, 150);
      return { ...moved, aimX: hx, aimY: hy, held, moveX: d > safe - 20 ? dx / d : moved.moveX, moveY: d > safe - 20 ? dy / d : moved.moveY };
    }
  }
  return base;
}
