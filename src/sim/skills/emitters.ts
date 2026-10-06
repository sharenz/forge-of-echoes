// The base emitters of the skill executor (docs/power-rework/skills.md 4.2): projectile fans, bursts, chains and blinks. Each
// reads only the resolved runtime def, its behaviour data and the world; the order of spawns, events and damage is the order the
// pre-executor code used, so the determinism goldens are unchanged.
import type { PlayerDebuff } from '../../contracts/bestiary';
import type { SkillRuntimeDef } from '../../contracts/sim';
import { damageMonster, isHittable } from '../combat';
import { cleanseAll, cleanseDebuffs } from '../debuffs';
import { ARC_TARGET_RANGE, DASH_ANIM, DASH_INVULN, MUZZLE_OFFSET } from '../constants';
import { coverBlocked, coverClip, insideCover } from '../cover';
import { DAMAGE_INDEX, TAU } from '../math';
import { resolvePlayerAt } from '../movement';
import { PROJ, projSpec, spawnProjectile } from '../projectiles';
import type { PlayerState, World } from '../world';
import { augmentOf, fanSpread, hasFlag, projectileCount, projectilePierce, projectileRadius } from './projectile-mods';
import { afterBlink, attachRider, convertSpec, emitChainAugmented, needsRider, prim, schedule } from './primitives';
import type { CastTally } from './primitives/state';
import type { BurstBehaviour, ChainBehaviour, DashBehaviour, ProjectileBehaviour } from './types';

/** A fan of straight projectiles centred on `angle`. */
export function emitProjectiles(w: World, p: PlayerState, def: SkillRuntimeDef, b: ProjectileBehaviour, angle: number): void {
  const count = projectileCount(def);
  const spread = fanSpread(p, def, b, count);
  const s = projSpec;
  s.kind = PROJ[b.kind];
  s.hostile = false;
  s.owner = p.id;
  s.speed = def.projectileSpeed > 0 ? def.projectileSpeed : b.speed;
  s.range = def.range > 0 ? def.range : b.range;
  s.radius = projectileRadius(def, b);
  s.damage = def.damage;
  s.dtype = DAMAGE_INDEX[def.damageType];
  s.critChance = def.critChance;
  s.critMult = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pierce = projectilePierce(p, def, b);
  const bounce = augmentOf(def, 'bounce');
  const decay = augmentOf(def, 'decay');
  // Flagship augments (SK5): conversion, the rehit of Slow Tide, Hollow Shell's pierce, and the rider of everything else.
  const conv = def.augments ? prim(def, 'convert') : undefined;
  const rehit = def.augments ? prim(def, 'rehit') : undefined;
  if (def.augments && prim(def, 'falloff')) s.pierce = -1;
  const rider = needsRider(def);
  const cast: CastTally | null = rider && prim(def, 'refund') ? { ids: [], done: false } : null;
  for (let k = 0; k < count; k++) {
    // Roster riders (spawnProjectile resets them on projSpec after every spawn, so they are set per bolt).
    s.bounce = bounce ? bounce.count : 0;
    s.rehit = rehit ? rehit.interval : b.rehit ?? 0;
    s.knock = b.knock ?? 1;
    s.decay = decay ? decay.share : 0;
    if (conv) convertSpec(s, def, conv);
    const a = count === 1 ? angle : angle - spread / 2 + (spread * k) / (count - 1);
    s.angle = a;
    // A muzzle inside a tall prop (she stands against it) fires from her centre: the shot meets the prop, it does not skip it.
    const mx = p.x + Math.cos(a) * MUZZLE_OFFSET;
    const my = p.y + Math.sin(a) * MUZZLE_OFFSET;
    const inside = insideCover(w.propGrid, mx, my);
    s.x = inside ? p.x : mx;
    s.y = inside ? p.y : my;
    const slot = spawnProjectile(w, s);
    if (rider && slot >= 0) attachRider(w, slot, def, p.id, false, cast);
  }
}

/** The fan arc of a burst (an augment's, else an item-granted 150°), or null for a full ring. */
export function burstFanArc(p: PlayerState, def: SkillRuntimeDef, b: BurstBehaviour): number | null {
  const aug = augmentOf(def, 'fan');
  if (aug) return aug.arc;
  return hasFlag(p, def, b.fan) ? Math.PI * 5 / 6 : null;
}

/** A ring of projectiles bursting outward from the player, rotated so one leads toward the aim; a fan concentrates them. */
export function emitBurst(w: World, p: PlayerState, def: SkillRuntimeDef, b: BurstBehaviour, angle: number): void {
  if (def.augments && (prim(def, 'rings') || prim(def, 'spiral'))) {
    shapedBurst(w, p, def, b, angle);
    return;
  }
  const count = projectileCount(def);
  const range = def.range > 0 ? def.range : b.range;
  const arc = burstFanArc(p, def, b);
  const s = projSpec;
  s.kind = PROJ[b.kind];
  s.hostile = false;
  s.owner = p.id;
  s.speed = def.projectileSpeed > 0 ? def.projectileSpeed : b.speed;
  s.range = range;
  s.radius = b.radius;
  s.damage = def.damage;
  s.dtype = DAMAGE_INDEX[def.damageType];
  s.critChance = def.critChance;
  s.critMult = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pierce = Math.max(0, Math.floor(def.pierce));
  const rider = needsRider(def);
  const cast: CastTally | null = rider && prim(def, 'refund') ? { ids: [], done: false } : null;
  for (let k = 0; k < count; k++) {
    s.angle = arc !== null
      ? angle + (count === 1 ? 0 : -arc / 2 + arc * k / (count - 1))
      : angle + (k / count) * TAU;
    s.x = p.x;
    s.y = p.y;
    const slot = spawnProjectile(w, s);
    if (rider && slot >= 0) attachRider(w, slot, def, p.id, false, cast);
  }
  w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x: p.x, y: p.y, radius: range });
}

/** One flame of a shaped burst (Spiral Arms) from her current position. */
function burstFlame(w: World, p: PlayerState, def: SkillRuntimeDef, b: BurstBehaviour, angle: number, cast: CastTally | null): void {
  const s = projSpec;
  s.kind = PROJ[b.kind];
  s.hostile = false;
  s.owner = p.id;
  s.speed = def.projectileSpeed > 0 ? def.projectileSpeed : b.speed;
  s.range = def.range > 0 ? def.range : b.range;
  s.radius = b.radius;
  s.damage = def.damage;
  s.dtype = DAMAGE_INDEX[def.damageType];
  s.critChance = def.critChance;
  s.critMult = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pierce = Math.max(0, Math.floor(def.pierce));
  s.angle = angle;
  s.x = p.x;
  s.y = p.y;
  const slot = spawnProjectile(w, s);
  if (slot >= 0 && needsRider(def)) attachRider(w, slot, def, p.id, false, cast);
}

/**
 * Ember Nova's shapes (SK5): Triple Ring (concentric waves of `flames`, `gap` s apart, reaching evenly out to the range, without
 * pierce: the later rings ride the echo queue, which never echoes) and Spiral Arms (two arms turning half a circle over `seconds`).
 */
function shapedBurst(w: World, p: PlayerState, def: SkillRuntimeDef, b: BurstBehaviour, angle: number): void {
  const range = def.range > 0 ? def.range : b.range;
  const rings = prim(def, 'rings');
  if (rings) {
    const rest = (def.augments ?? []).filter((a) => a.p !== 'rings' && a.p !== 'echo' && a.p !== 'spiral');
    for (let k = 0; k < rings.count; k++) {
      const ring: SkillRuntimeDef = {
        ...def, range: (range * (k + 1)) / rings.count, projectiles: rings.flames, pierce: 0, augments: rest,
      };
      if (k === 0) emitBurst(w, p, ring, b, angle);
      else p.pendingNovas.push({ at: w.time + rings.gap * k, def: ring });
    }
    return;
  }
  const spiral = prim(def, 'spiral')!;
  const count = projectileCount(def);
  const perArm = Math.max(1, Math.ceil(count / 2));
  const cast: CastTally | null = prim(def, 'refund') ? { ids: [], done: false } : null;
  w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x: p.x, y: p.y, radius: range });
  for (let k = 0; k < perArm; k++) {
    const turn = (k / perArm) * Math.PI;
    const fire = (ww: World, pp: PlayerState) => {
      for (let arm = 0; arm < 2; arm++) if (k * 2 + arm < count) burstFlame(ww, pp, def, b, angle + turn + arm * Math.PI, cast);
    };
    if (k === 0) fire(w, p);
    else schedule(p, w.time + (spiral.seconds * k) / perArm, fire);
  }
}

/**
 * Lightning strikes the enemy nearest the cursor (among those within 240 of the player), then
 * jumps up to `chains` times, each time to the nearest enemy it has not hit yet within jump range.
 */
export function emitChain(
  w: World, p: PlayerState, def: SkillRuntimeDef, b: ChainBehaviour, aimX: number, aimY: number, dirX: number, dirY: number,
): void {
  const m = w.monsters;
  const cand = w.scratch;
  const range = ARC_TARGET_RANGE;
  const pad = range + w.grid.maxRadius;
  const n = w.grid.query(p.x - pad, p.y - pad, p.x + pad, p.y + pad, cand);
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    const r = range + m.radius[i];
    if (dx * dx + dy * dy > r * r) continue;
    // Lightning needs a line: a target behind tall cover is not struck.
    if (coverBlocked(w, p.x, p.y, m.x[i], m.y[i], 0)) continue;
    const cx = m.x[i] - aimX;
    const cy = m.y[i] - aimY;
    const dc = cx * cx + cy * cy;
    if (dc < bestD) {
      bestD = dc;
      best = i;
    }
  }
  const dtype = DAMAGE_INDEX[def.damageType];
  if (def.augments && (prim(def, 'fork') || prim(def, 'return') || prim(def, 'ramp') || prim(def, 'mark') || prim(def, 'onKill'))) {
    // Flagship augments (SK5): the same targeting, with fork / return / ramp / mark / on-kill.
    emitChainAugmented(w, p, def, def.radius > 0 ? def.radius : b.jump, hasFlag(p, def, b.revisit), aimX, aimY, dirX, dirY);
    return;
  }
  const points: number[] = [p.x + dirX * MUZZLE_OFFSET, p.y + dirY * MUZZLE_OFFSET];
  if (best < 0) {
    // Nothing in reach: the bolt forks harmlessly toward the cursor.
    const reach = Math.min(range * 0.6, Math.hypot(aimX - p.x, aimY - p.y));
    const fork = coverClip(w, p.x, p.y, Math.atan2(dirY, dirX), Math.max(24, reach), 0);
    points.push(p.x + dirX * fork, p.y + dirY * fork);
    w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });
    return;
  }
  const jump = def.radius > 0 ? def.radius : b.jump;
  const revisit = hasFlag(p, def, b.revisit);
  const hitIds: number[] = [];
  let cur = best;
  let fromX = p.x;
  let fromY = p.y;
  const total = 1 + Math.max(0, Math.floor(def.chains));
  for (let c = 0; c < total && cur >= 0; c++) {
    const x = m.x[cur];
    const y = m.y[cur];
    hitIds.push(m.id[cur]);
    points.push(x, y);
    damageMonster(w, cur, def.damage, dtype, def.critChance, def.critMultiplier, def.ailmentChance, x - fromX, y - fromY, 0.5, true, p.id);
    fromX = x;
    fromY = y;
    if (c + 1 >= total) break;
    // Next jump: the nearest living monster not hit yet.
    const jp = jump + w.grid.maxRadius;
    const nn = w.grid.query(x - jp, y - jp, x + jp, y + jp, cand);
    let next = -1;
    let nextD = Infinity;
    for (let k = 0; k < nn; k++) {
      const i = cand[k];
      if (!isHittable(w, i) || (revisit ? i === cur : hitIds.includes(m.id[i]))) continue;
      const dx = m.x[i] - x;
      const dy = m.y[i] - y;
      const d2 = dx * dx + dy * dy;
      const r = jump + m.radius[i];
      if (d2 <= r * r && d2 < nextD && !coverBlocked(w, x, y, m.x[i], m.y[i], 0)) {
        nextD = d2;
        next = i;
      }
    }
    cur = next;
  }
  w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });
}

const DASH_BREAKS: readonly PlayerDebuff[] = ['rooted'];

/** A blink toward the cursor: lands clear of props, breaks roots, grants invulnerability. */
export function emitDash(
  w: World, p: PlayerState, def: SkillRuntimeDef, b: DashBehaviour, aimX: number, aimY: number, dirX: number, dirY: number,
): void {
  const maxDist = def.distance > 0 ? def.distance : b.distance;
  const fromX = p.x;
  const fromY = p.y;
  const toCursor = Math.hypot(aimX - p.x, aimY - p.y);
  // Blink to the cursor when it is closer than the full distance.
  const dist = toCursor > 1 ? Math.min(maxDist, Math.max(12, toCursor)) : maxDist;
  let tx = p.x + dirX * dist;
  let ty = p.y + dirY * dist;
  // Land clear of solid props and inside the arena (settled over a few passes when the landing
  // spot touches several props at once).
  for (let k = 0; k < 3; k++) {
    const o = resolvePlayerAt(tx, ty, w.arenaRadius, w.props);
    const moved = o.x !== tx || o.y !== ty;
    tx = o.x;
    ty = o.y;
    if (!moved) break;
  }
  w.events.push({ t: 'dash', playerId: p.id, fromX: p.x, fromY: p.y, toX: tx, toY: ty });
  // Rift Step is the answer to a root (GAME_SPEC §13): it breaks the root and a chain hook's drag.
  p.pullTime = 0;
  if (hasFlag(p, def, b.cleanse)) cleanseAll(w, p);
  else cleanseDebuffs(w, p, DASH_BREAKS);
  p.x = tx;
  p.y = ty;
  // A blink is a teleport: no interpolated slide between the two points.
  p.prevX = tx;
  p.prevY = ty;
  const invuln = augmentOf(def, 'invulnerable');
  p.invulnTime = Math.max(p.invulnTime, invuln ? invuln.seconds : DASH_INVULN);
  p.dashTime = DASH_ANIM;
  if (hasFlag(p, def, b.chillLanding)) {
    const m = w.monsters, candidates = w.scratch;
    const n = w.grid.query(tx - 100, ty - 100, tx + 100, ty + 100, candidates);
    for (let k = 0; k < n; k++) {
      const i = candidates[k];
      if (!isHittable(w, i) || Math.hypot(m.x[i] - tx, m.y[i] - ty) > 100) continue;
      m.chillTime[i] = Math.max(m.chillTime[i], 2);
      w.events.low({ t: 'ailment', ailment: 'chilled', x: m.x[i], y: m.y[i] });
    }
  }
  // Flagship augments (SK5): Afterimage, Static Arrival, Phase Weave.
  if (def.augments) afterBlink(w, p, def, fromX, fromY, tx, ty);
}
