// Bot policy for the Wayside Anvil: fight near the anvil (it counts kills within 260 u), then stand on a boon stone until it is chosen.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

function toward(base: PlayerIntent, fromX: number, fromY: number, x: number, y: number): PlayerIntent {
  const dx = x - fromX, dy = y - fromY, l = Math.hypot(dx, dy) || 1;
  return { ...base, moveX: dx / l, moveY: dy / l };
}

export function anvilPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(x => x.kind === 'anvil' && x.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { site: { x: number; y: number }; stage: string; stones: { x: number; y: number; state: number }[] };
  if (s.stage === 'pick') {
    const st = s.stones.find(z => z.state === 0);
    if (!st) return base;
    return Math.hypot(st.x - p.x, st.y - p.y) > 10 ? toward(base, p.x, p.y, st.x, st.y) : { ...base, moveX: 0, moveY: 0 };
  }
  // Charging: stay within the anvil's hearing (leave the bot's own kiting alone while inside). With nothing left to fight within reach
  // of the anvil (the horde is held behind a wall, say) the pull-back would only fight the bot's own hunt at the edge of the range
  // for ever: let it go and find them.
  let nearest = Infinity;
  const m = w.monsters;
  for (let i = 0; i < m.hwm; i++) if (m.alive[i]) nearest = Math.min(nearest, Math.hypot(m.x[i] - s.site.x, m.y[i] - s.site.y));
  if (nearest > 330) return base;
  return Math.hypot(s.site.x - p.x, s.site.y - p.y) > 200 ? toward(base, p.x, p.y, s.site.x, s.site.y) : base;
}
