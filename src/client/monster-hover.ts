import { MONSTER_KINDS } from '../contracts/content';
import { RARITY_CODE, type MonsterStoreView } from '../contracts/sim';
import type { HudState } from '../contracts/ui';
import type { Point } from './autoattack';

/** Pick the visible body of an elite at its interpolated position; empty world space yields no card. */
export function hoveredMonster(m: MonsterStoreView, cursor: Point | null, alpha = 1): HudState['hoveredMonster'] {
  if (!cursor) return null;
  const a = Math.max(0, Math.min(1, alpha));
  let best = -1;
  let distance = 1;
  for (let i = 0; i < m.capacity; i++) {
    if (!m.alive[i] || (m.rarity[i] !== RARITY_CODE.magic && m.rarity[i] !== RARITY_CODE.rare)) continue;
    const x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
    const y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
    const rx = Math.max(10, m.radius[i] * 1.4);
    const ry = Math.max(16, m.radius[i] * 2);
    const d = ((cursor.x - x) / rx) ** 2 + ((cursor.y - (y - ry * 0.45)) / ry) ** 2;
    if (d <= distance) { best = i; distance = d; }
  }
  if (best < 0) return null;
  return { id: m.id[best], kind: MONSTER_KINDS[m.kind[best]], rarity: m.rarity[best] === RARITY_CODE.rare ? 'rare' : 'magic', mods: m.mods[best], life: m.maxLife[best] > 0 ? Math.max(0, Math.min(1, m.life[best] / m.maxLife[best])) : 0 };
}
