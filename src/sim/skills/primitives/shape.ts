// Shape changes of the flagship augments (power rework SK5) that are not a plain fan or circle: Glacial Nova's Freezing Core and
// Shatter (its blast with a core and on-kill explosions), Frost Orb's Frozen Heart (`hover`) and Shatter (`blast` at the orb's end).
// Triple Ring and Spiral Arms are part of the burst emitter (../emitters.ts), Rain of Shells of the lob (../roster.ts).
import type { SkillRuntimeDef } from '../../../contracts/sim';
import { DAMAGE_INDEX } from '../../math';
import type { PlayerState, World } from '../../world';
import { blastNow, blastsOf } from './blast';
import { burstAt } from './burst';
import { explodeVictim } from './onkill';
import { attachRider, riderOf } from './riders';
import { prim } from './state';

/** Whether Glacial Nova's blast needs the augmented path. */
export function novaAugmented(def: SkillRuntimeDef): boolean {
  return !!def.augments && (!!prim(def, 'core') || !!prim(def, 'onKill'));
}

/** Glacial Nova with Freezing Core (more damage close to her) and/or Shatter (chilled kills explode). */
export function novaBlast(w: World, p: PlayerState, def: SkillRuntimeDef, radius: number, knock: number): void {
  const core = prim(def, 'core');
  const ok = prim(def, 'onKill');
  const px = p.x;
  const py = p.y;
  const m = w.monsters;
  const hits = burstAt(w, {
    owner: p.id, x: px, y: py, radius, damage: def.damage, dtype: DAMAGE_INDEX[def.damageType], critChance: def.critChance,
    critMult: def.critMultiplier, ailmentChance: def.ailmentChance, knock,
    factor: core ? (_w, i) => {
      const r = core.radius + m.radius[i];
      const dx = m.x[i] - px;
      const dy = m.y[i] - py;
      return dx * dx + dy * dy <= r * r ? 1 + core.more : 1;
    } : undefined,
  });
  if (!ok) return;
  for (const h of hits) if (h.killed) explodeVictim(w, p.id, ok, h, def.damage);
}

/** Frost Orb: does it need a rider (hovering, or bursting at its end)? */
export function orbNeedsRider(def: SkillRuntimeDef): boolean {
  return !!def.augments && (!!prim(def, 'hover') || blastsOf(def, 'orbEnd').length > 0 || !!prim(def, 'convert') || !!prim(def, 'fork'));
}

/** A new orb (slot): its rider remembers when a hovering orb fades and how fast it fires. */
export function orbRider(w: World, slot: number, def: SkillRuntimeDef, owner: number, duration: number): void {
  const r = attachRider(w, slot, def, owner, false);
  const hover = prim(def, 'hover');
  if (hover) {
    r.until = w.time + duration;
    r.rate = Math.max(0.1, hover.rate);
  }
}

/** The rider of an orb, for its shards (Static Frost: they convert and chain once). */
export function orbShardDef(w: World, slot: number): SkillRuntimeDef | null {
  const r = riderOf(w, slot);
  return r && (prim(r.def, 'convert') || prim(r.def, 'fork')) ? r.def : null;
}

/** Fire-rate factor of an orb (Frozen Heart: 2), 1 without a rider. */
export function orbRate(w: World, slot: number): number {
  return riderOf(w, slot)?.rate ?? 1;
}

/** A hovering orb's time ran out: true when it should fade now. */
export function orbFaded(w: World, slot: number): boolean {
  const r = riderOf(w, slot);
  return !!r && r.until > 0 && w.time >= r.until - 1e-9;
}

/** The orb fades at (x, y): Shatter. */
export function orbEnded(w: World, slot: number): void {
  const r = riderOf(w, slot);
  if (!r) return;
  const pr = w.projectiles;
  for (const b of blastsOf(r.def, 'orbEnd')) blastNow(w, r.owner, r.def, b, pr.x[slot], pr.y[slot]);
  r.until = 0;
}
