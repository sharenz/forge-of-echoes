// Buff emitters: timed effects on the caster. Cinder Ward is the first (damage reduction plus ember pulses on adjacent enemies).
import type { SkillRuntimeDef } from '../../contracts/sim';
import { damageMonster, isHittable } from '../combat';
import { DT, WARD_PULSE_INTERVAL, WARD_RADIUS, WARD_REDUCTION_CAP } from '../constants';
import { DAMAGE_INDEX, clamp } from '../math';
import type { PlayerState, World } from '../world';
import { hasFlag } from './projectile-mods';
import type { WardBehaviour } from './types';

export function emitWard(w: World, p: PlayerState, def: SkillRuntimeDef, b: WardBehaviour): void {
  const ward = p.ward;
  const duration = def.duration > 0 ? def.duration : b.duration;
  ward.time = duration;
  ward.duration = duration;
  ward.reduction = clamp(def.damageReduction, 0, WARD_REDUCTION_CAP);
  ward.pulse = WARD_PULSE_INTERVAL * 0.5;
  ward.damage = def.damage;
  ward.critChance = def.critChance;
  ward.critMultiplier = def.critMultiplier;
  ward.ailmentChance = def.ailmentChance;
  ward.radius = def.radius > 0 ? def.radius : WARD_RADIUS;
  ward.dtype = DAMAGE_INDEX[def.damageType];
  ward.focusOnPulse = hasFlag(p, def, b.restoreFocus);
  ward.renewOnHit = hasFlag(p, def, b.renew);
  w.events.push({ t: 'ward', playerId: p.id, x: p.x, y: p.y, duration });
}

/** Cinder Ward upkeep: embers burn adjacent monsters every 0.5 s while the ward lasts. */
export function tickWard(w: World, p: PlayerState): void {
  const ward = p.ward;
  if (ward.time <= 0) return;
  ward.time -= DT;
  if (ward.time <= 0) {
    ward.time = 0;
    return;
  }
  ward.pulse -= DT;
  if (ward.pulse > 0) return;
  ward.pulse += WARD_PULSE_INTERVAL;
  if (ward.damage <= 0 && !ward.focusOnPulse) return;
  const m = w.monsters;
  const cand = w.scratch;
  const reach = ward.radius + w.grid.maxRadius;
  const n = w.grid.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach, cand);
  let focus = 0;
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    const r = ward.radius + m.radius[i];
    if (dx * dx + dy * dy > r * r) continue;
    // Embers burn: not a hit, so armour doesn't blunt them.
    if (ward.focusOnPulse) focus = Math.min(6, focus + 2);
    else damageMonster(w, i, ward.damage, ward.dtype, ward.critChance, ward.critMultiplier, ward.ailmentChance, dx, dy, 0.5, false, p.id);
  }
  if (focus) p.focus = Math.min(p.stats.maxFocus, p.focus + focus);
}
