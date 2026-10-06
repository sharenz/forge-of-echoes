// The shared circle of damage every flagship augment detonates with (lodges, on-kill explosions, delayed blasts, bomblets): every
// hittable monster within `radius` of (x, y) takes one hit. Ground damage: it ignores cover and frontal shields. Re-entrant: the
// candidates are copied before any damage lands, so an explosion that kills and triggers another explosion is safe, and it never
// touches the world's shared scratch buffers (the projectile pass is iterating them).
import { DAMAGE_TYPES, type DamageType } from '../../../contracts/content';
import type { AugmentFx } from '../../../contracts/sim';
import { damageMonster, isHittable } from '../../combat';
import { DAMAGE_INDEX } from '../../math';
import type { World } from '../../world';

let QUERY = new Int32Array(0);

export interface BurstHit {
  slot: number;
  id: number;
  x: number;
  y: number;
  maxLife: number;
  shocked: boolean;
  chilled: boolean;
  killed: boolean;
}

export interface BurstSpec {
  owner: number;
  x: number;
  y: number;
  radius: number;
  damage: number;
  dtype: number;
  critChance: number;
  critMult: number;
  ailmentChance: number;
  /** Knockback of the hits (outward); 0 = none. */
  knock: number;
  /** Monster id spared (the one an explosion came from). */
  skip?: number;
  /** Per-target damage factor (Freezing Core); absent = 1. */
  factor?: (w: World, slot: number) => number;
}

/** Hit every monster in the circle once; returns what was hit (and whether each died), in grid order. */
export function burstAt(w: World, s: BurstSpec): BurstHit[] {
  const out: BurstHit[] = [];
  if (!(s.damage > 0) || !(s.radius > 0)) return out;
  const m = w.monsters;
  if (QUERY.length < m.capacity) QUERY = new Int32Array(m.capacity);
  const reach = s.radius + w.grid.maxRadius;
  const n = w.grid.query(s.x - reach, s.y - reach, s.x + reach, s.y + reach, QUERY);
  for (let k = 0; k < n; k++) {
    const i = QUERY[k];
    if (!isHittable(w, i) || m.id[i] === s.skip) continue;
    const dx = m.x[i] - s.x;
    const dy = m.y[i] - s.y;
    const r = s.radius + m.radius[i];
    if (dx * dx + dy * dy > r * r) continue;
    out.push({
      slot: i, id: m.id[i], x: m.x[i], y: m.y[i], maxLife: m.maxLife[i], shocked: m.shockTime[i] > 0, chilled: m.chillTime[i] > 0,
      killed: false,
    });
  }
  for (const h of out) {
    const i = h.slot;
    if (m.id[i] !== h.id || !isHittable(w, i)) continue;
    const f = s.factor ? s.factor(w, i) : 1;
    h.killed = damageMonster(
      w, i, s.damage * f, s.dtype, s.critChance, s.critMult, s.ailmentChance, h.x - s.x, h.y - s.y, s.knock, true, s.owner,
    );
  }
  return out;
}

/** The presenter's cue for an augment effect (droppable under load except detonations and bursts). */
export function augmentCue(w: World, owner: number, fx: AugmentFx, x: number, y: number, radius: number, dtype: number | DamageType): void {
  const damageType = typeof dtype === 'number' ? DAMAGE_TYPES[dtype] : dtype;
  const e = { t: 'augment' as const, playerId: owner, fx, x, y, radius, damageType };
  if (fx === 'detonate' || fx === 'blast' || fx === 'explode') w.events.push(e);
  else if (w.events.lowOpen) w.events.low(e);
}

export function dtypeIndex(t: DamageType): number {
  return DAMAGE_INDEX[t];
}
