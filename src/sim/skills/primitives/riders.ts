// Augment riders on player projectiles (power rework SK5). A projectile of an augmented skill carries the AUG_RIDER effect handle;
// its Rider (state.ts, by projectile id) holds the runtime def whose primitives act on its hits, its end and its flight:
//   hit     falloff (Hollow Shell), expose, convert's ailment, Overheat's ignite, mark (Pinning), the cast's Heartfire tally,
//           on-kill explosions, Cinder Fragments, Entropic Split, and last the lodge (which ends the shot)
//   flight  Burning Wake's trail; the rehit cap (Slow Tide)
//   range   Tide Returns turns it back once
//   end     Splintering's splinters, Kiln Ring's ground
// Children (splits) carry a rider too, marked `child`: they never split, lodge or return.
import type { SkillRuntimeDef } from '../../../contracts/sim';
import { DT } from '../../constants';
import { registerProjectileEffect, type MonsterHitInfo } from '../../effects';
import type { World } from '../../world';
import { augmentCue } from './burst';
import { conductFrom } from './chain';
import { convertedHit } from './convert';
import { applyExposure } from './expose';
import { lodgeIn } from './lodge';
import { markMonster } from './mark';
import { explodeVictim, takeTrigger } from './onkill';
import { splitAt } from './split';
import { augWorld, peekWorld, prim, type CastTally, type Rider } from './state';
import { spawnTrail } from './trail';

/** Primitives that act through a projectile rider. */
const RIDER_PRIMS = new Set([
  'expose', 'convert', 'lodge', 'split', 'return', 'mark', 'trail', 'onKill', 'refund', 'ignite', 'rehit', 'falloff', 'fork',
]);

const NEEDS = new WeakMap<SkillRuntimeDef, boolean>();

/** Whether the projectiles of `def` need a rider. */
export function needsRider(def: SkillRuntimeDef): boolean {
  const list = def.augments;
  if (!list || list.length === 0) return false;
  let v = NEEDS.get(def);
  if (v === undefined) {
    v = list.some((a) => RIDER_PRIMS.has(a.p) && !(a.p === 'convert' && a.ailment === 'keep') && !(a.p === 'trail' && a.at !== 'path' && a.at !== 'end'));
    NEEDS.set(def, v);
  }
  return v;
}

export function riderOf(w: World, slot: number): Rider | undefined {
  const s = peekWorld(w);
  return s?.riders.get(w.projectiles.id[slot]);
}

/** Give projectile `slot` a rider (and the rider effect, unless it already carries an effect of its own: mortar shells, orbs). */
export function attachRider(w: World, slot: number, def: SkillRuntimeDef, owner: number, child: boolean, cast: CastTally | null = null): Rider {
  const pr = w.projectiles;
  const r: Rider = {
    owner, def, child, hits: 0, perMonster: null, returned: false, startRange: pr.range[slot], trail: 0, cast, until: 0, rate: 1,
    fromX: pr.x[slot], fromY: pr.y[slot],
  };
  augWorld(w).riders.set(pr.id[slot], r);
  if (pr.effect[slot] === 0) pr.effect[slot] = AUG_RIDER;
  return r;
}

/** Heartfire: a cast that has hit `hits` distinct enemies refunds part of its Focus and cooldown, once. */
function tally(w: World, r: Rider, id: number): void {
  const t = r.cast;
  const k = prim(r.def, 'refund');
  if (!t || !k || t.done) return;
  if (!t.ids.includes(id)) t.ids.push(id);
  if (t.ids.length < k.hits) return;
  t.done = true;
  const p = w.playerById[r.owner];
  if (!p || p.dead) return;
  p.focus = Math.min(p.stats.maxFocus, p.focus + r.def.focusCost * k.focus);
  const ch = p.charges.get(r.def.id);
  if (ch && ch.timer > 0) ch.timer = Math.max(DT, ch.timer - k.cooldown);
  augmentCue(w, r.owner, 'refund', p.x, p.y, 24, r.def.damageType);
}

function onHit(w: World, slot: number, j: number, hit: MonsterHitInfo): boolean {
  const r = riderOf(w, slot);
  if (!r) return false;
  const pr = w.projectiles;
  const m = w.monsters;
  const def = r.def;
  const dealt = pr.damage[slot];
  r.hits++;
  if (r.perMonster) r.perMonster.set(hit.id, (r.perMonster.get(hit.id) ?? 0) + 1);
  const falloff = prim(def, 'falloff');
  if (falloff && r.hits === 1) pr.damage[slot] = dealt * falloff.share;
  const alive = !hit.killed && m.alive[j] === 1 && m.id[j] === hit.id;
  if (alive) {
    const expose = prim(def, 'expose');
    if (expose) applyExposure(w, j, expose);
    const conv = prim(def, 'convert');
    if (conv) convertedHit(w, j, r.owner, dealt, def, conv);
    const ignite = prim(def, 'ignite');
    if (ignite && m.igniteSrc[j] === r.owner && m.igniteTime[j] > 0 && m.igniteDps[j] !== hit.igniteDps) m.igniteDps[j] *= 1 + ignite.more;
    const mark = prim(def, 'mark');
    if (mark && (!mark.first || r.hits === 1)) markMonster(w, j, r.owner, def.id, mark);
  }
  tally(w, r, hit.id);
  // Static Frost: a shard's hit chains on once (from where it struck).
  const fork = prim(def, 'fork');
  if (fork) {
    const p = w.playerById[r.owner];
    if (p && !p.dead) conductFrom(w, p, def, hit.x, hit.y, [hit.id], { links: fork.links, share: fork.share, jump: fork.jump });
  }
  if (hit.killed) {
    const ok = prim(def, 'onKill');
    if (ok) explodeVictim(w, r.owner, ok, hit, dealt);
    const split = prim(def, 'split');
    if (split && split.on === 'kill' && !r.child && takeTrigger(w, r.owner)) splitAt(w, slot, r, split, hit.x, hit.y, hit.id);
  }
  if (r.child) return false;
  const split = prim(def, 'split');
  if (split && split.on === 'hit' && r.hits === 1) splitAt(w, slot, r, split, hit.x, hit.y, hit.id);
  const lodge = prim(def, 'lodge');
  if (lodge && alive && r.hits === 1) {
    const shot = {
      owner: r.owner, skill: def.id, damage: dealt, dtype: pr.dtype[slot], critChance: pr.critChance[slot], critMult: pr.critMult[slot],
      ailmentChance: pr.ailmentChance[slot],
    };
    if (lodgeIn(w, j, shot, lodge)) {
      r.returned = true; // a lodged shot does nothing at its end
      return true;
    }
  }
  return false;
}

export const AUG_RIDER = registerProjectileEffect({
  onTick(w, slot) {
    const r = riderOf(w, slot);
    if (!r) return;
    const t = prim(r.def, 'trail');
    if (!t || t.at !== 'path' || !(t.spacing > 0)) return;
    const pr = w.projectiles;
    r.trail += Math.hypot(pr.vx[slot], pr.vy[slot]) * DT;
    if (r.trail < t.spacing) return;
    r.trail -= t.spacing;
    spawnTrail(w, r.owner, t, pr.x[slot], pr.y[slot], pr.radius[slot]);
  },
  canHit(w, slot, j) {
    const r = riderOf(w, slot);
    const k = r ? prim(r.def, 'rehit') : undefined;
    if (!r || !k) return true;
    if (!r.perMonster) r.perMonster = new Map();
    return (r.perMonster.get(w.monsters.id[j]) ?? 0) < k.max;
  },
  onMonsterHit: onHit,
  onExpire(w, slot) {
    const r = riderOf(w, slot);
    const k = r ? prim(r.def, 'return') : undefined;
    if (!r || !k || r.child || r.returned) return false;
    const pr = w.projectiles;
    r.returned = true;
    pr.vx[slot] = -pr.vx[slot];
    pr.vy[slot] = -pr.vy[slot];
    pr.range[slot] = r.startRange;
    pr.damage[slot] *= k.share;
    // A fresh pass: everything it hit on the way out can be hit again on the way back.
    pr.hitCount[slot] = 0;
    pr.hitCursor[slot] = 0;
    if (r.perMonster) r.perMonster.clear();
    augmentCue(w, r.owner, 'return', pr.x[slot], pr.y[slot], pr.radius[slot], pr.dtype[slot]);
    return true;
  },
  onEnd(w, slot, x, y) {
    const r = riderOf(w, slot);
    if (!r) return;
    const s = augWorld(w);
    s.riders.delete(w.projectiles.id[slot]);
    if (r.returned && prim(r.def, 'lodge')) return;
    const t = prim(r.def, 'trail');
    if (t && t.at === 'end') spawnTrail(w, r.owner, t, x, y, w.projectiles.radius[slot]);
    const split = prim(r.def, 'split');
    if (split && split.on === 'end' && !r.child) splitAt(w, slot, r, split, x, y);
  },
});

/** Forget riders whose projectile is gone (blocked on a shield, cleared): called about once a second. */
export function pruneRiders(w: World): void {
  const s = peekWorld(w);
  if (!s || s.riders.size === 0 || w.time < s.pruneAt) return;
  s.pruneAt = w.time + 1;
  const pr = w.projectiles;
  for (const id of s.riders.keys()) {
    const slot = id & 0xffff;
    if (!pr.alive[slot] || pr.id[slot] !== id) s.riders.delete(id);
  }
}
