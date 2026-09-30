// Bot policy for the Laden Caravan: cut down the escorts on the side of the weakest shielded lock, then break the open locks
// (nearest first), then the wheels. Composed with the fair bot's intent in the event sweeps (base = the bot's own intent).
import type { PlayerIntent } from '../../src/contracts/sim';
import type { World } from '../../src/sim/world';

interface CaravanLike { wagon: number; locks: number[]; wheels: number[]; groups: Set<number>[]; shielded: boolean[] }

export function caravanPolicy(w: World, playerId: number, base: PlayerIntent): PlayerIntent {
  const e = w.mapEvent?.live.find(q => q.kind === 'vaultbreakers' && q.phase === 'active');
  const p = w.playerById[playerId];
  if (!e || !p || p.dead) return base;
  const s = e.s as CaravanLike;
  const m = w.monsters;
  const at = (id: number): { x: number; y: number } | null => {
    const i = id ? m.slotOf(id) : -1;
    return i >= 0 ? { x: m.x[i], y: m.y[i] } : null;
  };
  let target: { x: number; y: number } | null = null;
  // 1. an open lock, nearest first
  let best = Infinity;
  s.locks.forEach((id, k) => {
    const t = at(id);
    if (!t || s.shielded[k]) return;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < best) { best = d; target = t; }
  });
  // 2. the escorts of the lock whose group is weakest (fewest guards above the shield threshold)
  if (!target) {
    let weakest = -1, need = Infinity;
    s.locks.forEach((id, k) => {
      if (!id || !s.shielded[k]) return;
      const left = s.groups[k].size - 1;
      if (left < need) { need = left; weakest = k; }
    });
    if (weakest >= 0) {
      let bd = Infinity;
      for (const id of s.groups[weakest]) {
        const t = at(id);
        if (!t) continue;
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d < bd) { bd = d; target = t; }
      }
    }
  }
  // 3. a wheel, else the wagon's side
  if (!target) for (const id of s.wheels) { const t = at(id); if (t) { target = t; break; } }
  if (!target) return base;
  const t = target as { x: number; y: number };
  const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
  const out: PlayerIntent = { ...base, aimX: t.x, aimY: t.y };
  if (d > 170) { out.moveX = dx / d; out.moveY = dy / d; }
  return out;
}
