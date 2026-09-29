// Small helpers shared by the Iron Coliseum's brains.
import { hasDebuff, type PlayerState } from '../api';

/**
 * Held in place: rooted (a thrall's or the Chainmaster's hook, tar) or being dragged by a chain hook. Nothing on an
 * Iron Coliseum freezes. A held player can't dodge, so the leaders never start a telegraph on one and never walk
 * their spinning blades into one (varkus.ts, chainmaster.ts).
 */
export function held(p: PlayerState): boolean {
  return hasDebuff(p, 'rooted') || p.pullTime > 0;
}
