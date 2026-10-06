// Buff emitters: timed effects on the caster. Cinder Ward (damage reduction plus ember pulses on adjacent enemies), Phase Stride
// (movement: its `stride` primitive) and Arcane Reprieve (its `restore` primitive over the duration).
import type { SkillRuntimeDef } from '../../contracts/sim';
import type { PlayerDebuff } from '../../contracts/bestiary';
import { damageMonster, isHittable } from '../combat';
import { cleanseDebuffs } from '../debuffs';
import { DT, WARD_PULSE_INTERVAL, WARD_RADIUS, WARD_REDUCTION_CAP } from '../constants';
import { DAMAGE_INDEX, clamp } from '../math';
import type { PlayerState, World } from '../world';
import { augmentOf, hasFlag } from './projectile-mods';
import type { RestoreBehaviour, StrideBehaviour, WardBehaviour } from './types';

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

const STRIDE_CLEANSE: readonly PlayerDebuff[] = ['chilled', 'rooted'];
const REPRIEVE_CLEANSE: readonly PlayerDebuff[] = ['chilled', 'withered'];

/** Phase Stride: faster, no crowd slow, through allies (player.ts reads p.stride) for the def's duration; a recast refreshes it. */
export function emitStride(w: World, p: PlayerState, def: SkillRuntimeDef, b: StrideBehaviour): void {
  const s = augmentOf(def, 'stride');
  const duration = def.duration > 0 ? def.duration : b.duration;
  p.stride.time = duration;
  p.stride.speed = s ? Math.max(0, s.speed) : 0;
  p.stride.evasion = s ? Math.max(0, s.evasion) : 0;
  if (hasFlag(p, def, b.cleanse)) cleanseDebuffs(w, p, STRIDE_CLEANSE);
  w.events.push({ t: 'buff', playerId: p.id, skill: def.id, x: p.x, y: p.y, duration });
}

/** Arcane Reprieve: its shares of maximum Focus and life flow back evenly over the duration; chill and Withered end at once. */
export function emitRestore(w: World, p: PlayerState, def: SkillRuntimeDef, b: RestoreBehaviour): void {
  const s = augmentOf(def, 'restore');
  const duration = def.duration > 0 ? def.duration : b.duration;
  p.restore.time = duration;
  p.restore.focusRate = s ? (Math.max(0, s.focus) * p.stats.maxFocus) / duration : 0;
  p.restore.lifeRate = s ? (Math.max(0, s.life) * p.stats.maxLife) / duration : 0;
  cleanseDebuffs(w, p, REPRIEVE_CLEANSE);
  w.events.push({ t: 'buff', playerId: p.id, skill: def.id, x: p.x, y: p.y, duration });
}

/** Phase Stride and Arcane Reprieve upkeep (one tick). */
export function tickSelfBuffs(p: PlayerState): void {
  if (p.stride.time > 0) p.stride.time = Math.max(0, p.stride.time - DT);
  const r = p.restore;
  if (r.time > 0) {
    const step = Math.min(DT, r.time);
    r.time = Math.max(0, r.time - DT);
    if (r.focusRate > 0) p.focus = Math.min(p.stats.maxFocus, p.focus + r.focusRate * step);
    if (r.lifeRate > 0) p.life = Math.min(p.stats.maxLife, p.life + r.lifeRate * step);
  }
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
