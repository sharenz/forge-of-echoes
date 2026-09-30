// Bot policy for the Ashseed Orchard: once the blooms near full ripeness, walk to the ripest one and stand there until it is
// harvested; fight on when the horde crowds in. Signature shared by the sweeps: (world, player id, base intent) -> intent.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';
import { crowd, walkToward } from './policy-pact';

export function orchardPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(x => x.kind === 'orchard' && x.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as { t: number; blooms: { x: number; y: number; stage: number; state: string }[] };
  // Wait for stage 3 (the Gold line); after 75 s take whatever is left.
  const want = s.t >= 75 ? 1 : 3;
  const ripe = s.blooms.filter(b => b.state === 'growing' && b.stage >= want);
  if (ripe.length === 0 || crowd(w, p.x, p.y, 110) > 4) return base;
  const b = ripe.reduce((a, c) => (Math.hypot(a.x - p.x, a.y - p.y) <= Math.hypot(c.x - p.x, c.y - p.y) ? a : c));
  return walkToward(w, playerId, base, b.x, b.y, 10);
}
