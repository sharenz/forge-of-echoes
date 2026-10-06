// The `lodge` primitive (Lodge Ember, Lodged Ice, Soulbind Lodge): a projectile sticks in the first enemy it hits and detonates
// for a share of its hit in a radius: after its fuse, when its host dies (where the host last stood), or, with `burst`, as soon as
// that many lodges of the same skill sit in one host (they all go off together). A player keeps at most `max` lodged at once; a
// projectile meeting the cap simply hits. Lodges are ticked from their owner's tick and vanish with their owner.
import type { SkillId } from '../../../contracts/content';
import type { AugmentRuntime } from '../../../contracts/sim';
import type { PlayerState, World } from '../../world';
import { augmentCue, burstAt } from './burst';
import { augWorld, peekWorld, type Lodge } from './state';

type LodgePrim = Extract<AugmentRuntime, { p: 'lodge' }>;

export interface LodgeShot {
  owner: number;
  skill: SkillId;
  damage: number;
  dtype: number;
  critChance: number;
  critMult: number;
  ailmentChance: number;
}

/** Lodges `owner` currently holds. */
export function lodgesOf(w: World, owner: number): number {
  const s = peekWorld(w);
  if (!s) return 0;
  let n = 0;
  for (const l of s.lodges) if (l.owner === owner) n++;
  return n;
}

/** Try to lodge a shot in monster slot `i` (after its hit). False when the owner is at the cap (the shot just hits). */
export function lodgeIn(w: World, i: number, shot: LodgeShot, k: LodgePrim): boolean {
  const m = w.monsters;
  if (lodgesOf(w, shot.owner) >= k.max) return false;
  const s = augWorld(w);
  const host = m.id[i];
  s.lodges.push({
    owner: shot.owner, skill: shot.skill, host, x: m.x[i], y: m.y[i], at: w.time + k.fuse, damage: shot.damage * k.share,
    dtype: shot.dtype, radius: k.radius, critChance: shot.critChance, critMult: shot.critMult, ailmentChance: shot.ailmentChance,
  });
  augmentCue(w, shot.owner, 'lodge', m.x[i], m.y[i], m.radius[i], shot.dtype);
  if (k.burst > 0) {
    let n = 0;
    for (const l of s.lodges) if (l.host === host && l.owner === shot.owner && l.skill === shot.skill) n++;
    if (n >= k.burst) {
      // Detonate them all now (at the host).
      for (const l of s.lodges) if (l.host === host && l.owner === shot.owner && l.skill === shot.skill) l.at = -Infinity;
      detonateDue(w, shot.owner);
    }
  }
  return true;
}

function detonate(w: World, l: Lodge): void {
  augmentCue(w, l.owner, 'detonate', l.x, l.y, l.radius, l.dtype);
  burstAt(w, {
    owner: l.owner, x: l.x, y: l.y, radius: l.radius, damage: l.damage, dtype: l.dtype, critChance: l.critChance, critMult: l.critMult,
    ailmentChance: l.ailmentChance, knock: 0.5,
  });
}

/** Detonate `owner`'s lodges whose fuse ran out or whose host is gone; the rest follow their host. */
export function detonateDue(w: World, owner: number): void {
  const s = peekWorld(w);
  if (!s || s.lodges.length === 0) return;
  const m = w.monsters;
  const due: Lodge[] = [];
  let write = 0;
  for (let k = 0; k < s.lodges.length; k++) {
    const l = s.lodges[k];
    if (l.owner === owner) {
      const slot = m.slotOf(l.host);
      if (slot >= 0) {
        l.x = m.x[slot];
        l.y = m.y[slot];
      }
      if (slot < 0 || l.at <= w.time + 1e-9) {
        due.push(l);
        continue;
      }
    }
    s.lodges[write++] = l;
  }
  s.lodges.length = write;
  for (const l of due) detonate(w, l);
}

/** The owner's tick: lodges of players who left are dropped, then the owner's due ones go off. */
export function tickLodges(w: World, p: PlayerState): void {
  const s = peekWorld(w);
  if (!s || s.lodges.length === 0) return;
  let write = 0;
  for (const l of s.lodges) {
    const owner = w.playerById[l.owner];
    if (owner && !owner.dead) s.lodges[write++] = l;
  }
  s.lodges.length = write;
  detonateDue(w, p.id);
}
