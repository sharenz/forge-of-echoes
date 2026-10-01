// Bot policy for the Stasis Host: walk to the Time Prism and shoot it until it shatters (the big, fast fight), then the ordinary bot
// fights the thawed host. Signature shared by every event policy: (world, playerId, the bot's ordinary intent) -> intent.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

export function hostPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(q => q.kind === 'host' && q.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { prism: number; center: { x: number; y: number }; shattered: boolean };
  if (s.prism < 0 || s.shattered) return base;
  const i = w.monsters.slotOf(s.prism);
  if (i < 0) return base;
  // A horde on top of the bot is the ordinary bot's business (fight first, shatter when it is clear).
  const m = w.monsters;
  let crowd = 0;
  for (let k = 0; k < m.hwm; k++) {
    if (!m.alive[k] || k === i || (m.flags[k] & 1024) || (m.flags[k] & 2048)) continue;
    if (Math.hypot(m.x[k] - p.x, m.y[k] - p.y) < 120) crowd++;
  }
  if (crowd >= 4) return base;
  const px = w.monsters.x[i], py = w.monsters.y[i];
  const dx = px - p.x, dy = py - p.y, d = Math.hypot(dx, dy) || 1;
  // Shoot from about 235 u (outside the statue rings).
  const held = base.held.map((_, k) => k === 0);
  return { ...base, aimX: px, aimY: py, held, moveX: d > 235 ? dx / d : 0, moveY: d > 235 ? dy / d : 0 };
}
