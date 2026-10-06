// Emitters of the roster skills (power rework SK2, docs/power-rework/skills.md 3): Glacial Nova's instant blast, Cinder Mortar's
// lobbed shell and burning ground, Frost Orb's shard turret, Storm Call's telegraphed strikes and Glacial Spikes' row. Every
// number comes from the resolved runtime def (or its behaviour primitives); the behaviour data only fills in fallbacks and timings
// (data/progression SKILL_TIMING, which the tooltips read too). Randomness only from w.combatRng.
import type { SkillRuntimeDef } from '../../contracts/sim';
import { spawnArea } from '../areas';
import { damageMonster, isHittable } from '../combat';
import { coverBlocked } from '../cover';
import { DT, MUZZLE_OFFSET } from '../constants';
import { registerProjectileEffect } from '../effects';
import { DAMAGE_INDEX, TAU } from '../math';
import { PROJ, projSpec, spawnProjectile } from '../projectiles';
import type { PendingStrike, PlayerState, World } from '../world';
import { augmentOf, hasFlag } from './projectile-mods';
import {
  afterShellAt, attachRider, blastsOf, conductFrom, convertSpec, novaAugmented, novaBlast, orbEnded, orbFaded, orbNeedsRider, orbRate,
  orbRider, orbShardDef, prim, shellLanded, spawnTrail,
} from './primitives';
import { COLD_BEHAVIOURS } from './behaviours/cold';
import type { BlastBehaviour, LobBehaviour, OrbBehaviour, SpikesBehaviour, StrikesBehaviour } from './types';

/** Every hittable monster within `radius` of (x, y) takes one hit (pushed outward by `knock`). Ignores cover and shields. */
export function blastAt(
  w: World, x: number, y: number, radius: number, damage: number, dtype: number, critChance: number, critMult: number,
  ailmentChance: number, owner: number, knock: number, group: number[] | null = null,
): void {
  if (!(damage > 0) || !(radius > 0)) return;
  const m = w.monsters;
  const cand = w.scratch2;
  const reach = radius + w.grid.maxRadius;
  const n = w.grid.query(x - reach, y - reach, x + reach, y + reach, cand);
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - x;
    const dy = m.y[i] - y;
    const r = radius + m.radius[i];
    if (dx * dx + dy * dy > r * r) continue;
    if (group) {
      if (group.includes(m.id[i])) continue;
      group.push(m.id[i]);
    }
    damageMonster(w, i, damage, dtype, critChance, critMult, ailmentChance, dx, dy, knock, true, owner);
  }
}

/** Glacial Nova: an instant circle of frost around the caster (not a projectile: it passes cover and shields). */
export function emitBlast(w: World, p: PlayerState, def: SkillRuntimeDef, b: BlastBehaviour): void {
  const radius = def.radius > 0 ? def.radius : b.radius;
  w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x: p.x, y: p.y, radius });
  // Freezing Core / Shatter (SK5).
  if (novaAugmented(def)) {
    novaBlast(w, p, def, radius, b.knock);
    return;
  }
  blastAt(w, p.x, p.y, radius, def.damage, DAMAGE_INDEX[def.damageType], def.critChance, def.critMultiplier, def.ailmentChance, p.id, b.knock);
}

// --- Cinder Mortar ---------------------------------------------------------------------------------------------------------

/**
 * The shell landed: the blast (radius = its splash), then the burning ground (fireTrail areas hurt monsters, one tick per interval
 * per monster however many overlap).
 */
const MORTAR_SHELL: number = registerProjectileEffect({
  onLand(w, slot, x, y) {
    // Cluster Shell / Delayed Fuse take the landing over (SK5).
    if (shellLanded(w, slot, x, y, MORTAR_SHELL)) return;
    const pr = w.projectiles;
    const owner = pr.owner[slot];
    blastAt(w, x, y, pr.splash[slot], pr.damage[slot], pr.dtype[slot], pr.critChance[slot], pr.critMult[slot], pr.ailmentChance[slot], owner, 1);
    if (pr.groundDamage[slot] > 0 && pr.groundTime[slot] > 0 && pr.groundRadius[slot] > 0) {
      spawnArea(w, 'fireTrail', x, y, pr.groundRadius[slot], pr.groundTime[slot], {
        damage: pr.groundDamage[slot], dtype: pr.dtype[slot], hurts: 'monsters', tickInterval: pr.groundTick[slot], firstTick: pr.groundTick[slot],
        source: owner,
      });
    }
    // Skip Shot, Magma Core (SK5).
    afterShellAt(w, slot, x, y);
  },
});

/** Cinder Mortar: a shell lobbed at the cursor (at most `range` away, inside the arena), landing after `flight` seconds. */
export function emitLob(w: World, p: PlayerState, def: SkillRuntimeDef, b: LobBehaviour, aimX: number, aimY: number, angle: number): void {
  const maxRange = def.range > 0 ? def.range : b.range;
  const dist = Math.min(maxRange, Math.max(12, Math.hypot(aimX - p.x, aimY - p.y)));
  const scatter = def.augments ? prim(def, 'scatter') : undefined;
  if (!scatter) {
    lobAt(w, p, def, b, p.x + Math.cos(angle) * dist, p.y + Math.sin(angle) * dist, angle);
    return;
  }
  // Rain of Shells (SK5): shells at random points round the cursor.
  const cx = p.x + Math.cos(angle) * dist;
  const cy = p.y + Math.sin(angle) * dist;
  const rng = w.combatRng;
  for (let k = 0; k < scatter.count; k++) {
    const r = scatter.radius * Math.sqrt(rng.next());
    const a = rng.next() * TAU;
    const tx = cx + Math.cos(a) * r;
    const ty = cy + Math.sin(a) * r;
    lobAt(w, p, def, b, tx, ty, Math.atan2(ty - p.y, tx - p.x));
  }
}

/** One shell toward (tx, ty), kept inside the arena. */
function lobAt(w: World, p: PlayerState, def: SkillRuntimeDef, b: LobBehaviour, tx: number, ty: number, angle: number): void {
  const lim = Math.max(0, w.arenaRadius - 8);
  const d2 = tx * tx + ty * ty;
  if (d2 > lim * lim) {
    const d = Math.sqrt(d2);
    tx = (tx / d) * lim;
    ty = (ty / d) * lim;
  }
  const len = Math.hypot(tx - p.x, ty - p.y);
  const s = projSpec;
  s.kind = PROJ[b.kind];
  s.hostile = false;
  s.owner = p.id;
  s.x = p.x;
  s.y = p.y;
  s.angle = len > 1e-6 ? Math.atan2(ty - p.y, tx - p.x) : angle;
  s.speed = len / b.flight;
  s.range = len;
  s.radius = 5;
  s.damage = def.damage;
  s.dtype = DAMAGE_INDEX[def.damageType];
  s.critChance = def.critChance;
  s.critMult = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pierce = 0;
  const slot = spawnProjectile(w, s, b.flight);
  if (slot < 0) return;
  const pr = w.projectiles;
  pr.splash[slot] = def.radius > 0 ? def.radius : b.radius;
  pr.effect[slot] = MORTAR_SHELL;
  const ground = augmentOf(def, 'ground');
  if (ground) {
    pr.groundDamage[slot] = ground.damage;
    pr.groundTime[slot] = ground.duration;
    pr.groundRadius[slot] = ground.radius;
    pr.groundTick[slot] = ground.interval;
  }
  if (def.augments && (prim(def, 'split') || prim(def, 'fuse') || prim(def, 'skip') || prim(def, 'trail'))) attachRider(w, slot, def, p.id, false);
}

// --- Frost Orb -------------------------------------------------------------------------------------------------------------

/** The orb's shards (fixed per skill); the orb itself carries the hit (damage, crit, chill) and its reach (`splash`). */
const ORB_SHARD: OrbBehaviour['shard'] = COLD_BEHAVIOURS.frostOrb.shard;

/** Each tick: count down to the next shard; then fire one at the nearest enemy in reach that the orb can see. */
const FROST_ORB = registerProjectileEffect({
  onExpire(w, slot) {
    orbEnded(w, slot); // Shatter (SK5)
  },
  onTick(w, slot) {
    const pr = w.projectiles;
    const shard = ORB_SHARD;
    // Frozen Heart (SK5): a hovering orb fades by its timer (it does not travel), and fires faster.
    if (orbFaded(w, slot)) {
      orbEnded(w, slot);
      if (w.events.lowOpen) w.events.low({ t: 'projectileEnd', kind: 'frostOrb', x: pr.x[slot], y: pr.y[slot] });
      pr.release(slot);
      return;
    }
    pr.timer[slot] -= DT;
    if (pr.timer[slot] > 1e-6) return;
    pr.timer[slot] += shard.interval / orbRate(w, slot);
    const ox = pr.x[slot];
    const oy = pr.y[slot];
    const reach = pr.splash[slot];
    const m = w.monsters;
    const cand = w.scratch2;
    const pad = reach + w.grid.maxRadius;
    const n = w.grid.query(ox - pad, oy - pad, ox + pad, oy + pad, cand);
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const i = cand[k];
      if (!isHittable(w, i)) continue;
      const dx = m.x[i] - ox;
      const dy = m.y[i] - oy;
      const r = reach + m.radius[i];
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r || d2 >= bestD) continue;
      if (coverBlocked(w, ox, oy, m.x[i], m.y[i], 0)) continue;
      bestD = d2;
      best = i;
    }
    if (best < 0) return;
    const s = projSpec;
    s.kind = PROJ[shard.kind];
    s.hostile = false;
    s.owner = pr.owner[slot];
    s.x = ox;
    s.y = oy;
    s.angle = Math.atan2(m.y[best] - oy, m.x[best] - ox);
    s.speed = shard.speed;
    s.range = shard.range;
    s.radius = shard.radius;
    s.damage = pr.damage[slot];
    s.dtype = pr.dtype[slot];
    s.critChance = pr.critChance[slot];
    s.critMult = pr.critMult[slot];
    s.ailmentChance = pr.ailmentChance[slot];
    s.pierce = 0;
    // Static Frost (SK5): the shards convert and chain once.
    const sd = orbShardDef(w, slot);
    if (sd) {
      const conv = prim(sd, 'convert');
      if (conv) convertSpec(s, sd, conv);
    }
    const shot = spawnProjectile(w, s);
    if (sd && shot >= 0) attachRider(w, shot, sd, s.owner, true);
  },
});

/** Frost Orb: slow orbs toward the cursor that live the def's duration and fire a shard every `shard.interval` seconds. */
export function emitOrb(
  w: World, p: PlayerState, def: SkillRuntimeDef, b: OrbBehaviour, angle: number, aimX = p.aimX, aimY = p.aimY,
): void {
  const count = Math.max(1, Math.floor(def.projectiles));
  const speed = def.projectileSpeed > 0 ? def.projectileSpeed : b.speed;
  const duration = def.duration > 0 ? def.duration : b.duration;
  const s = projSpec;
  const hover = def.augments ? prim(def, 'hover') : undefined;
  if (hover) {
    hoverOrbs(w, p, def, b, angle, count, duration, aimX, aimY);
    return;
  }
  for (let k = 0; k < count; k++) {
    s.kind = PROJ[b.kind];
    s.hostile = false;
    s.owner = p.id;
    s.angle = count === 1 ? angle : angle - b.spread / 2 + (b.spread * k) / (count - 1);
    s.x = p.x + Math.cos(s.angle) * MUZZLE_OFFSET;
    s.y = p.y + Math.sin(s.angle) * MUZZLE_OFFSET;
    s.speed = speed;
    // Half a tick of slack so the last shard (at age == duration) still fires before the orb fades.
    s.range = speed * (duration + DT * 0.5);
    s.radius = 8;
    s.damage = def.damage;
    s.dtype = DAMAGE_INDEX[def.damageType];
    s.critChance = def.critChance;
    s.critMult = def.critMultiplier;
    s.ailmentChance = def.ailmentChance;
    s.pierce = -1;
    const slot = spawnProjectile(w, s);
    if (slot < 0) continue;
    w.projectiles.splash[slot] = def.radius > 0 ? def.radius : b.seek;
    w.projectiles.timer[slot] = b.shard.interval;
    w.projectiles.effect[slot] = FROST_ORB;
    if (orbNeedsRider(def)) orbRider(w, slot, def, p.id, duration);
  }
}

/** Frozen Heart (SK5): the orbs hover at the cursor (within the orb's normal reach), side by side, for the def's duration. */
const HOVER_REACH = 300;
function hoverOrbs(
  w: World, p: PlayerState, def: SkillRuntimeDef, b: OrbBehaviour, angle: number, count: number, duration: number, aimX: number, aimY: number,
): void {
  const aimD = Math.min(HOVER_REACH, Math.hypot(aimX - p.x, aimY - p.y));
  const lim = Math.max(0, w.arenaRadius - 8);
  const s = projSpec;
  for (let k = 0; k < count; k++) {
    // Twin orbs hover 30 units apart across the aim.
    const off = count === 1 ? 0 : (k - (count - 1) / 2) * 30;
    let x = p.x + Math.cos(angle) * aimD - Math.sin(angle) * off;
    let y = p.y + Math.sin(angle) * aimD + Math.cos(angle) * off;
    const d2 = x * x + y * y;
    if (d2 > lim * lim) {
      const d = Math.sqrt(d2);
      x = (x / d) * lim;
      y = (y / d) * lim;
    }
    s.kind = PROJ[b.kind];
    s.hostile = false;
    s.owner = p.id;
    s.angle = angle;
    s.x = x;
    s.y = y;
    s.speed = 0;
    s.range = 1;
    s.radius = 8;
    s.damage = def.damage;
    s.dtype = DAMAGE_INDEX[def.damageType];
    s.critChance = def.critChance;
    s.critMult = def.critMultiplier;
    s.ailmentChance = def.ailmentChance;
    s.pierce = -1;
    const slot = spawnProjectile(w, s);
    if (slot < 0) continue;
    w.projectiles.splash[slot] = def.radius > 0 ? def.radius : b.seek;
    w.projectiles.effect[slot] = FROST_ORB;
    orbRider(w, slot, def, p.id, duration);
    w.projectiles.timer[slot] = b.shard.interval / orbRate(w, slot);
  }
}

// --- Storm Call and Glacial Spikes: telegraphed ground strikes ---------------------------------------------------------------

/** Storm Call: strikes scattered uniformly over a circle round the cursor (or evenly along the line to it), after a telegraph. */
export function emitStrikes(w: World, p: PlayerState, def: SkillRuntimeDef, b: StrikesBehaviour, aimX: number, aimY: number): void {
  const count = Math.max(1, Math.floor(def.projectiles));
  const scatter = def.range > 0 ? def.range : b.scatter;
  const radius = def.radius > 0 ? def.radius : b.radius;
  let cx = aimX;
  let cy = aimY;
  const toCursor = Math.hypot(cx - p.x, cy - p.y);
  if (toCursor > b.reach) {
    cx = p.x + ((cx - p.x) / toCursor) * b.reach;
    cy = p.y + ((cy - p.y) / toCursor) * b.reach;
  }
  const tethered = hasFlag(p, def, b.tethered);
  const at = w.time + b.telegraph;
  const rng = w.combatRng;
  for (let k = 0; k < count; k++) {
    let x: number;
    let y: number;
    if (tethered) {
      const f = (k + 1) / count;
      x = p.x + (cx - p.x) * f;
      y = p.y + (cy - p.y) * f;
    } else {
      const r = scatter * Math.sqrt(rng.next());
      const a = rng.next() * TAU;
      x = cx + Math.cos(a) * r;
      y = cy + Math.sin(a) * r;
    }
    queueStrike(w, p, 'stormCall', x, y, radius, b.telegraph, at, def, null);
  }
  // Eye of the Storm (SK5): a final strike at the cursor after the last one.
  for (const f of def.augments ? blastsOf(def, 'final') : []) {
    const fin: SkillRuntimeDef = { ...def, damage: f.damage, augments: def.augments!.filter((a) => a.p !== 'blast') };
    queueStrike(w, p, 'stormCall', cx, cy, f.radius, b.telegraph + f.delay, at + f.delay, fin, null);
  }
}

/** Glacial Spikes: `projectiles` spikes evenly along `range` toward the cursor, erupting in sequence; Twin Lines makes two rows. */
export function emitSpikes(w: World, p: PlayerState, def: SkillRuntimeDef, b: SpikesBehaviour, angle: number): void {
  const count = Math.max(1, Math.floor(def.projectiles));
  const length = def.range > 0 ? def.range : b.length;
  const radius = def.radius > 0 ? def.radius : b.radius;
  const twin = hasFlag(p, def, b.twin);
  const lim = w.arenaRadius;
  for (let line = 0; line < (twin ? 2 : 1); line++) {
    const a = twin ? angle + (line === 0 ? -b.twinAngle : b.twinAngle) : angle;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const group: number[] = [];
    let lastX = NaN;
    let lastY = NaN;
    let lastDelay = 0;
    for (let k = 0; k < count; k++) {
      const d = (length * (k + 1)) / count;
      const x = p.x + cos * d;
      const y = p.y + sin * d;
      if (x * x + y * y > lim * lim) break;
      const delay = b.lead + b.step * k;
      queueStrike(w, p, 'frostSpike', x, y, radius, delay, w.time + delay, def, group);
      lastX = x;
      lastY = y;
      lastDelay = delay;
    }
    // Shattering Rows (SK5): the row's last spike explodes.
    if (Number.isNaN(lastX)) continue;
    for (const f of def.augments ? blastsOf(def, 'rowEnd') : []) {
      const end: SkillRuntimeDef = { ...def, damage: f.damage, augments: def.augments!.filter((a) => a.p !== 'blast' && a.p !== 'trail') };
      const delay = lastDelay + b.step + f.delay;
      queueStrike(w, p, 'frostSpike', lastX, lastY, f.radius, delay, w.time + delay, end, null);
    }
  }
}

function queueStrike(
  w: World, p: PlayerState, kind: 'stormCall' | 'frostSpike', x: number, y: number, radius: number, delay: number, at: number,
  def: SkillRuntimeDef, group: number[] | null,
): void {
  // The telegraph is the player's own: harmless to players (hurts 'none', no rider); the strike's damage is dealt below.
  spawnArea(w, kind, x, y, radius, delay, { hurts: 'none', debuff: null, source: p.id });
  p.pendingStrikes.push({ at, x, y, radius, def, group });
}

function resolveStrike(w: World, p: PlayerState, e: PendingStrike): void {
  const def = e.def;
  // Conduction (SK5) needs the strike's victims: a private group (it never spares anything the strike itself would hit).
  const fork = def.augments ? prim(def, 'fork') : undefined;
  const group = e.group ?? (fork ? [] : null);
  const before = group ? group.length : 0;
  blastAt(w, e.x, e.y, e.radius, def.damage, DAMAGE_INDEX[def.damageType], def.critChance, def.critMultiplier, def.ailmentChance, p.id, 0.5, group);
  if (!def.augments) return;
  // Frost Comb / Thunder Mark (SK5): ground under the strike.
  const trail = prim(def, 'trail');
  if (trail && trail.at === 'strike') spawnTrail(w, p.id, trail, e.x, e.y, e.radius);
  if (fork && group) conductFrom(w, p, def, e.x, e.y, group.slice(before), { links: fork.links, share: fork.share, jump: fork.jump });
}

/** Strikes whose telegraph ran out fall now (dropped if she died meanwhile). */
export function tickPendingStrikes(w: World, p: PlayerState): void {
  const list = p.pendingStrikes;
  if (list.length === 0) return;
  let write = 0;
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    if (p.dead) continue;
    if (e.at <= w.time + 1e-9) resolveStrike(w, p, e);
    else list[write++] = e;
  }
  list.length = write;
}
