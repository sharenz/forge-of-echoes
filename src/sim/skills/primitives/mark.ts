// The `mark` primitive (Conductive Mark, Pinning): a marked enemy takes more damage from everything (sim/combat.ts reads
// markTakenMult), the marking skill gains ailment chance against it, and a pinning mark chills it. One mark per monster: a new
// mark replaces an older one when it is at least as strong.
import type { SkillId } from '../../../contracts/content';
import type { AugmentRuntime } from '../../../contracts/sim';
import { CHILL_DURATION } from '../../constants';
import type { World } from '../../world';
import { augmentCue } from './burst';
import { augWorld, peekWorld } from './state';

type MarkPrim = Extract<AugmentRuntime, { p: 'mark' }>;

export function markMonster(w: World, i: number, owner: number, skill: SkillId, k: MarkPrim): void {
  const m = w.monsters;
  if (!m.alive[i]) return;
  const s = augWorld(w);
  const id = m.id[i];
  const old = s.marks.get(id);
  const fresh = !old || old.until <= w.time;
  if (fresh || old.taken <= k.taken) s.marks.set(id, { owner, until: w.time + k.seconds, taken: k.taken, shock: k.shock, skill });
  if (k.chill) m.chillTime[i] = Math.max(m.chillTime[i], Math.min(CHILL_DURATION, k.seconds));
  if (fresh) augmentCue(w, owner, 'mark', m.x[i], m.y[i], m.radius[i], k.chill ? 'physical' : 'lightning');
}

/** Ailment chance the marking skill `skill` of `owner` gains against monster slot `i` (0 when unmarked). */
export function markShock(w: World, i: number, owner: number, skill: SkillId): number {
  const s = peekWorld(w);
  if (!s || s.marks.size === 0) return 0;
  const mk = s.marks.get(w.monsters.id[i]);
  return mk && mk.until > w.time && mk.owner === owner && mk.skill === skill ? mk.shock : 0;
}

/** Drop marks that ran out (keeps the map small). */
export function pruneMarks(w: World): void {
  const s = peekWorld(w);
  if (!s || s.marks.size === 0) return;
  for (const [id, mk] of s.marks) if (mk.until <= w.time) s.marks.delete(id);
}
