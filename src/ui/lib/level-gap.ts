// The monster-vs-character level gap as the monster hover shows it (GAME_SPEC: a monster more than LEVEL_GAP.grace levels above
// the character it hits deals +LEVEL_GAP.perLevel per further level, up to +LEVEL_GAP.cap). Same table the sim applies
// (src/sim/constants.ts LEVEL_GAP_*, mirrored from src/data/progression/maps.ts).
import { LEVEL_GAP } from '../../data/progression/maps';

export interface LevelGapInfo {
  monsterLevel: number;
  /** Monster level minus the character's (negative: the character is above). */
  gap: number;
  /** Extra damage the monster deals the character, in % (0..cap x 100). */
  damageMore: number;
  /** 'over' once the gap adds damage, 'near' within the grace levels above, 'even' at or below the character. */
  tone: 'over' | 'near' | 'even';
  /** The hover line, e.g. "Level 34 · 6 above you · deals 15% more damage". */
  text: string;
}

export function levelGapInfo(monsterLevel: number | null | undefined, playerLevel: number): LevelGapInfo | null {
  if (monsterLevel === null || monsterLevel === undefined || !(monsterLevel > 0) || !(playerLevel > 0)) return null;
  const gap = monsterLevel - playerLevel;
  const over = gap - LEVEL_GAP.grace;
  const damageMore = over > 0 ? Math.round(Math.min(LEVEL_GAP.cap, over * LEVEL_GAP.perLevel) * 100) : 0;
  const rel = gap > 0 ? `${gap} above you` : gap < 0 ? `${-gap} below you` : 'your level';
  const tone = damageMore > 0 ? 'over' : gap > 0 ? 'near' : 'even';
  const tail = damageMore > 0 ? ` · deals ${damageMore}% more damage` : '';
  return { monsterLevel, gap, damageMore, tone, text: `Level ${monsterLevel} · ${rel}${tail}` };
}
