// Skill behaviour (GAME_SPEC §4). The numbers come pre-resolved in SkillRuntimeDef; this file only
// decides what each skill *does* when its cast releases.
import type { PlayerDebuff } from '../contracts/bestiary';
import type { SkillId } from '../contracts/content';
import type { SkillRuntimeDef } from '../contracts/sim';
import { spawnArea } from './areas';
import { damageMonster, isHittable } from './combat';
import { cleanseDebuffs } from './debuffs';
import {
  ARC_JUMP_RANGE, ARC_TARGET_RANGE, DASH_ANIM, DASH_INVULN, FIRE_TRAIL_DAMAGE, FIRE_TRAIL_DURATION, FIRE_TRAIL_INTERVAL, FIRE_TRAIL_RADIUS,
  FIRE_TRAIL_TICK, MUZZLE_OFFSET, NOVA_ECHO_DELAY, WARD_PULSE_INTERVAL,
  WARD_RADIUS, WARD_REDUCTION_CAP, DT,
} from './constants';
import { DAMAGE_INDEX, TAU, clamp } from './math';
import { resolvePlayerAt } from './movement';
import { PROJ, projSpec, spawnProjectile } from './projectiles';
import type { PlayerState, World } from './world';

/** Behaviour defaults used when a runtime def leaves a field at 0. */
const DEFAULTS = {
  emberLance: { speed: 420, range: 320, radius: 4 },
  emberNova: { speed: 260, range: 170, radius: 5 },
  flameWave: { speed: 180, range: 170, radius: 14, spread: 0.9 },
  rimeShards: { speed: 360, range: 260, radius: 3.5, spread: 0.35 },
  riftStep: { distance: 100 },
  cinderWard: { duration: 5 },
} as const;

function hasFlag(p: PlayerState, def: SkillRuntimeDef, skillFlag: string, playerFlag: string): boolean {
  return def.flags.includes(skillFlag) || p.flags.has(playerFlag);
}

/** Aim angle from the player to the cursor (falls back to the facing direction). */
function aimAngle(p: PlayerState, aimX: number, aimY: number): number {
  const dx = aimX - p.x;
  const dy = aimY - p.y;
  if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
  switch (p.facing) {
    case 'north': return -Math.PI / 2;
    case 'east': return 0;
    case 'west': return Math.PI;
    default: return Math.PI / 2;
  }
}

/** Release a skill: the effect happens now, from the player's current position. */
export function releaseSkill(w: World, p: PlayerState, def: SkillRuntimeDef, aimX: number, aimY: number): void {
  const angle = aimAngle(p, aimX, aimY);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const id: SkillId = def.id;
  if (id !== 'riftStep') w.events.push({ t: 'cast', playerId: p.id, skill: id, x: p.x, y: p.y, dirX, dirY });
  switch (id) {
    case 'emberLance': {
      const count = Math.max(1, Math.floor(def.projectiles));
      const spread = count > 1 ? (def.spread > 0 ? def.spread : Math.min(0.6, 0.12 * (count - 1))) : 0;
      const pierce = hasFlag(p, def, 'pierceAll', 'lancePierceAll') ? -1 : Math.max(0, Math.floor(def.pierce));
      fireFan(w, p, def, PROJ.emberLance, angle, count, spread, DEFAULTS.emberLance, pierce, def.radius > 0 ? def.radius : DEFAULTS.emberLance.radius);
      break;
    }
    case 'emberNova':
      novaBurst(w, p, def, angle);
      if (hasFlag(p, def, 'echo', 'novaEcho')) p.pendingNovas.push({ at: w.time + NOVA_ECHO_DELAY, def });
      break;
    case 'flameWave': {
      const count = Math.max(1, Math.floor(def.projectiles));
      const spread = def.spread > 0 ? def.spread : DEFAULTS.flameWave.spread;
      fireFan(w, p, def, PROJ.flameWave, angle, count, spread, DEFAULTS.flameWave, -1, def.radius > 0 ? def.radius : DEFAULTS.flameWave.radius);
      break;
    }
    case 'rimeShards': {
      const count = Math.max(1, Math.floor(def.projectiles));
      const spread = def.spread > 0 ? def.spread : DEFAULTS.rimeShards.spread;
      fireFan(w, p, def, PROJ.rimeShard, angle, count, spread, DEFAULTS.rimeShards, Math.max(0, Math.floor(def.pierce)), DEFAULTS.rimeShards.radius);
      break;
    }
    case 'arcChain':
      arcChain(w, p, def, aimX, aimY, dirX, dirY);
      break;
    case 'riftStep':
      riftStep(w, p, def, aimX, aimY, dirX, dirY);
      break;
    case 'cinderWard':
      cinderWard(w, p, def);
      break;
  }
}

function fireFan(
  w: World, p: PlayerState, def: SkillRuntimeDef, kind: number, angle: number, count: number, spread: number,
  defaults: { speed: number; range: number }, pierce: number, radius: number,
): void {
  const s = projSpec;
  s.kind = kind;
  s.hostile = false;
  s.owner = p.id;
  s.speed = def.projectileSpeed > 0 ? def.projectileSpeed : defaults.speed;
  s.range = def.range > 0 ? def.range : defaults.range;
  s.radius = radius;
  s.damage = def.damage;
  s.dtype = DAMAGE_INDEX[def.damageType];
  s.critChance = def.critChance;
  s.critMult = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pierce = pierce;
  for (let k = 0; k < count; k++) {
    const a = count === 1 ? angle : angle - spread / 2 + (spread * k) / (count - 1);
    s.angle = a;
    s.x = p.x + Math.cos(a) * MUZZLE_OFFSET;
    s.y = p.y + Math.sin(a) * MUZZLE_OFFSET;
    spawnProjectile(w, s);
  }
}

/** A ring of flames bursting outward from the player, rotated so one flame leads toward the aim. */
export function novaBurst(w: World, p: PlayerState, def: SkillRuntimeDef, angle: number): void {
  const count = Math.max(1, Math.floor(def.projectiles));
  const range = def.range > 0 ? def.range : DEFAULTS.emberNova.range;
  const s = projSpec;
  s.kind = PROJ.novaFlame;
  s.hostile = false;
  s.owner = p.id;
  s.speed = def.projectileSpeed > 0 ? def.projectileSpeed : DEFAULTS.emberNova.speed;
  s.range = range;
  s.radius = DEFAULTS.emberNova.radius;
  s.damage = def.damage;
  s.dtype = DAMAGE_INDEX[def.damageType];
  s.critChance = def.critChance;
  s.critMult = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pierce = Math.max(0, Math.floor(def.pierce));
  for (let k = 0; k < count; k++) {
    s.angle = angle + (k / count) * TAU;
    s.x = p.x;
    s.y = p.y;
    spawnProjectile(w, s);
  }
  w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x: p.x, y: p.y, radius: range });
}

/**
 * Lightning strikes the enemy nearest the cursor (among those within 240 of the player), then
 * jumps up to `chains` times, each time to the nearest enemy it has not hit yet within jump range.
 */
function arcChain(w: World, p: PlayerState, def: SkillRuntimeDef, aimX: number, aimY: number, dirX: number, dirY: number): void {
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
    const cx = m.x[i] - aimX;
    const cy = m.y[i] - aimY;
    const dc = cx * cx + cy * cy;
    if (dc < bestD) {
      bestD = dc;
      best = i;
    }
  }
  const dtype = DAMAGE_INDEX[def.damageType];
  const points: number[] = [p.x + dirX * MUZZLE_OFFSET, p.y + dirY * MUZZLE_OFFSET];
  if (best < 0) {
    // Nothing in reach: the bolt forks harmlessly toward the cursor.
    const reach = Math.min(range * 0.6, Math.hypot(aimX - p.x, aimY - p.y));
    points.push(p.x + dirX * Math.max(24, reach), p.y + dirY * Math.max(24, reach));
    w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });
    return;
  }
  const jump = def.radius > 0 ? def.radius : ARC_JUMP_RANGE;
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
      if (!isHittable(w, i) || hitIds.includes(m.id[i])) continue;
      const dx = m.x[i] - x;
      const dy = m.y[i] - y;
      const d2 = dx * dx + dy * dy;
      const r = jump + m.radius[i];
      if (d2 <= r * r && d2 < nextD) {
        nextD = d2;
        next = i;
      }
    }
    cur = next;
  }
  w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });
}

const RIFT_BREAKS: readonly PlayerDebuff[] = ['rooted'];

function riftStep(w: World, p: PlayerState, def: SkillRuntimeDef, aimX: number, aimY: number, dirX: number, dirY: number): void {
  const maxDist = def.distance > 0 ? def.distance : DEFAULTS.riftStep.distance;
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
  cleanseDebuffs(w, p, RIFT_BREAKS);
  p.x = tx;
  p.y = ty;
  // A blink is a teleport: no interpolated slide between the two points.
  p.prevX = tx;
  p.prevY = ty;
  p.invulnTime = Math.max(p.invulnTime, DASH_INVULN);
  p.dashTime = DASH_ANIM;
}

function cinderWard(w: World, p: PlayerState, def: SkillRuntimeDef): void {
  const ward = p.ward;
  const duration = def.duration > 0 ? def.duration : DEFAULTS.cinderWard.duration;
  ward.time = duration;
  ward.duration = duration;
  ward.reduction = clamp(def.damageReduction, 0, WARD_REDUCTION_CAP);
  ward.pulse = WARD_PULSE_INTERVAL * 0.5;
  ward.damage = def.damage;
  ward.critChance = def.critChance;
  ward.critMultiplier = def.critMultiplier;
  ward.ailmentChance = def.ailmentChance;
  ward.radius = def.radius > 0 ? def.radius : WARD_RADIUS;
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
  if (ward.damage <= 0) return;
  const m = w.monsters;
  const cand = w.scratch;
  const reach = ward.radius + w.grid.maxRadius;
  const n = w.grid.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach, cand);
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    const r = ward.radius + m.radius[i];
    if (dx * dx + dy * dy > r * r) continue;
    // Embers burn: not a hit, so armour doesn't blunt them.
    damageMonster(w, i, ward.damage, DAMAGE_INDEX.fire, ward.critChance, ward.critMultiplier, ward.ailmentChance, dx, dy, 0.5, false, p.id);
  }
}

/** Cinderwalkers: while moving, leave burning ground behind that damages monsters. */
export function tickFireTrail(w: World, p: PlayerState, moving: boolean): void {
  if (!p.flags.has('fireTrail')) return;
  p.trailTimer -= DT;
  if (!moving || p.trailTimer > 0) return;
  p.trailTimer = FIRE_TRAIL_INTERVAL;
  const basicId = p.loadout[0] ?? 'emberLance';
  const basic = p.skills.get(basicId) ?? p.skills.get('emberLance');
  const damage = (basic ? basic.damage : 5) * FIRE_TRAIL_DAMAGE;
  spawnArea(w, 'fireTrail', p.x, p.y, FIRE_TRAIL_RADIUS, FIRE_TRAIL_DURATION, {
    damage, dtype: DAMAGE_INDEX.fire, hurts: 'monsters', tickInterval: FIRE_TRAIL_TICK, firstTick: 0.1, source: p.id,
  });
}

/** Ember Nova echoes (0.4 s later, from wherever the player is then). */
export function tickPendingNovas(w: World, p: PlayerState): void {
  const list = p.pendingNovas;
  if (list.length === 0) return;
  let write = 0;
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    if (p.dead) continue;
    if (e.at <= w.time + 1e-9) novaBurst(w, p, e.def, aimAngle(p, p.aimX, p.aimY) + Math.PI / Math.max(1, e.def.projectiles));
    else list[write++] = e;
  }
  list.length = write;
}
