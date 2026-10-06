// The `onKill` primitive (Shatter Rounds, Static Discharge, Glacial Nova's Shatter): an enemy the skill kills explodes for a share
// of the killing hit or of its own maximum life. Explosions that kill chain, at most `depth` deep, and every player may trigger
// at most ON_KILL_CAP of them per tick (build-plan risk table: on-kill chains must never flood the projectile or event caps).
import type { AugmentRuntime } from '../../../contracts/sim';
import type { World } from '../../world';
import { augmentCue, burstAt, dtypeIndex } from './burst';
import { augWorld } from './state';

type OnKill = Extract<AugmentRuntime, { p: 'onKill' }>;

export const ON_KILL_CAP = 8;

/** Whether `owner` may trigger one more on-kill effect this tick (and counts it). */
export function takeTrigger(w: World, owner: number): boolean {
  const s = augWorld(w);
  if (s.triggerTime !== w.time) {
    s.triggerTime = w.time;
    s.triggers.clear();
  }
  const n = s.triggers.get(owner) ?? 0;
  if (n >= ON_KILL_CAP) return false;
  s.triggers.set(owner, n + 1);
  return true;
}

/** A victim of the skill: what the explosion needs to know about it. */
export interface Victim {
  id: number;
  x: number;
  y: number;
  maxLife: number;
  shocked: boolean;
  chilled: boolean;
}

/** Whether the victim qualifies (shocked / chilled as the primitive needs). */
export function qualifies(k: OnKill, v: Victim): boolean {
  return k.needs === 'any' || (k.needs === 'shocked' ? v.shocked : v.chilled);
}

/** The victim killed by a hit of `hit` damage explodes (and its explosion's kills chain). Returns explosions set off. */
export function explodeVictim(w: World, owner: number, k: OnKill, v: Victim, hit: number, depth = 1): number {
  if (!qualifies(k, v) || depth > k.depth || !takeTrigger(w, owner)) return 0;
  const damage = k.of === 'life' ? v.maxLife * k.share : hit * k.share;
  const dtype = dtypeIndex(k.damageType);
  augmentCue(w, owner, 'explode', v.x, v.y, k.radius, dtype);
  const hits = burstAt(w, { owner, x: v.x, y: v.y, radius: k.radius, damage, dtype, critChance: 0, critMult: 1.5, ailmentChance: 0, knock: 0.5, skip: v.id });
  let n = 1;
  for (const h of hits) if (h.killed) n += explodeVictim(w, owner, k, h, damage, depth + 1);
  return n;
}
