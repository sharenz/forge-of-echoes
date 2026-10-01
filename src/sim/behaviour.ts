// Small helpers shared by the monster brains (regular monsters, herald, matriarch).
import type { PlayerDebuff } from '../contracts/bestiary';
import { MONSTER_KINDS } from '../contracts/content';
import { MONSTER_ANIM, type MonsterAnimCode, type RootSource } from '../contracts/sim';
import { hitPlayer } from './combat';
import { coverBlocked, insideCover } from './cover';
import { ATTACKER_IMMUNITY, DT, EMPOWER_BONUS, PLAYER_RADIUS, PROJECTILE_SCALING } from './constants';
import { TAU } from './math';
import { projSpec, spawnProjectile } from './projectiles';
import { MSTATE } from './stores';
import type { PlayerState, World } from './world';

export { MONSTER_ANIM, MSTATE };

export function setAnim(w: World, i: number, code: MonsterAnimCode): void {
  const m = w.monsters;
  if (m.anim[i] !== code) {
    m.anim[i] = code;
    m.animTime[i] = 0;
  }
}

export function stop(w: World, i: number): void {
  w.monsters.vx[i] = 0;
  w.monsters.vy[i] = 0;
}

/** Turn to face a player (no-op without one). */
export function faceTarget(w: World, i: number, t: PlayerState | null): void {
  if (!t) return;
  const m = w.monsters;
  m.facing[i] = t.x >= m.x[i] ? 1 : -1;
}

/** Damage multiplier from the herald's aura. */
export function empowerMult(w: World, i: number): number {
  return w.monsters.empowerTime[i] > 0 ? 1 + EMPOWER_BONUS : 1;
}

/**
 * Head for the target player (dx, dy: vector to them, d: its length), aiming at a point offset
 * around them by the monster's personal angle. The offset shrinks as the monster closes in, so a
 * horde wraps around the player instead of piling into one line.
 */
export function steer(w: World, i: number, dx: number, dy: number, d: number, speedFactor: number): void {
  const m = w.monsters;
  // Arrived: already pressed against the player, so stop pushing (the crowd spreads instead).
  if (d <= m.radius[i] + PLAYER_RADIUS + 1) {
    stop(w, i);
    return;
  }
  const off = Math.min(d * 0.45, 40);
  const a = m.offsetAngle[i];
  const tx = dx + Math.cos(a) * off;
  const ty = dy + Math.sin(a) * off;
  const l = Math.sqrt(tx * tx + ty * ty);
  if (l < 1e-4) {
    stop(w, i);
    return;
  }
  const v = m.speed[i] * speedFactor;
  m.vx[i] = (tx / l) * v;
  m.vy[i] = (ty / l) * v;
}

/** Move directly along a vector at a fraction of the monster's speed. */
export function moveAlong(w: World, i: number, dx: number, dy: number, speedFactor: number): void {
  const m = w.monsters;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l < 1e-4) {
    stop(w, i);
    return;
  }
  const v = m.speed[i] * speedFactor;
  m.vx[i] = (dx / l) * v;
  m.vy[i] = (dy / l) * v;
}

/**
 * Idle packs drift around their home point; each member keeps its own spot in the group. Hunters
 * that lost every target (the whole party is down) and loose monsters just stand their ground.
 */
export function wander(w: World, i: number): void {
  const m = w.monsters;
  const pk = m.pack[i];
  const pack = pk >= 0 ? w.packs[pk] : null;
  if (!pack || pack.aggro) {
    stop(w, i);
    return;
  }
  const a = m.offsetAngle[i];
  const gx = pack.goalX + Math.cos(a) * 18 - m.x[i];
  const gy = pack.goalY + Math.sin(a) * 18 - m.y[i];
  if (gx * gx + gy * gy < 36) {
    stop(w, i);
    return;
  }
  moveAlong(w, i, gx, gy, 0.35);
}

/**
 * A melee strike on a player (subject to evasion, armour and that player's contact caps), with an
 * optional debuff rider. Returns hitPlayer's result: −1 when it didn't connect (evaded, invulnerable,
 * dead), else the damage dealt — follow up (knockback…) only on a connecting hit.
 */
export function meleeHit(
  w: World, i: number, t: PlayerState, mult = 1, debuff: PlayerDebuff | null = null, source?: RootSource,
): number {
  const m = w.monsters;
  const r = hitPlayer(w, t, m.damage[i] * mult * empowerMult(w, i), m.dtype[i], 'melee', debuff, source);
  if (w.events.lowOpen) {
    w.events.low({ t: 'monsterAttack', kind: MONSTER_KINDS[m.kind[i]], x: m.x[i], y: m.y[i], attack: 'melee' });
  }
  if (m.attackCd[i] < ATTACKER_IMMUNITY) m.attackCd[i] = ATTACKER_IMMUNITY;
  return r;
}

/**
 * A monster's own scratch memory (bosses and lieutenants with more timers than timerA–D): `size`
 * numbers, zeroed on first use, kept per run and dropped when the monster dies.
 */
export function memoryOf(w: World, i: number, size: number): Float64Array {
  const id = w.monsters.id[i];
  let mem = w.memory.get(id);
  if (!mem || mem.length < size) {
    const next = new Float64Array(size);
    if (mem) next.set(mem);
    mem = next;
    w.memory.set(id, mem);
  }
  return mem;
}

/**
 * Fire one hostile projectile from a monster (`flight` > 0: a lob that lands after that many seconds).
 * Returns its slot (-1 when the store is full). The kind's default rider (projectiles.ts
 * PROJECTILE_RIDERS) applies; override it with setProjectileDebuff / setProjectileEffect.
 */
export function fireHostile(
  w: World, i: number, kind: number, angle: number, speed: number, range: number, radius: number, damage: number, dtype: number,
  flight = 0,
): number {
  const m = w.monsters;
  const off = muzzleOffset(w, i);
  return fireHostileFrom(
    w, i, kind, m.x[i] + Math.cos(angle) * off, m.y[i] + Math.sin(angle) * off, angle, speed, range, radius, damage, dtype, flight,
  );
}

/**
 * fireHostile from an explicit point (x, y) instead of monster `i`'s muzzle — e.g. the start of an aim
 * line drawn during the windup, so the shot flies exactly along it even if the body was shoved since.
 * Still credited to monster `i` (a chain hook pulls toward it).
 */
export function fireHostileFrom(
  w: World, i: number, kind: number, x: number, y: number, angle: number, speed: number, range: number, radius: number,
  damage: number, dtype: number, flight = 0,
): number {
  const m = w.monsters;
  const s = projSpec;
  s.kind = kind;
  s.hostile = true;
  // A muzzle inside a tall prop's footprint (a shooter pressed against a wall) falls back to the body's centre, which is always clear.
  const inside = insideCover(w.propGrid, x, y);
  s.x = inside ? m.x[i] : x;
  s.y = inside ? m.y[i] : y;
  s.angle = angle;
  s.speed = speed;
  s.range = range;
  s.radius = radius;
  s.damage = damage;
  s.dtype = dtype;
  s.critChance = 0;
  s.critMult = 1;
  s.ailmentChance = 0;
  s.pierce = 0;
  s.owner = 0;
  const slot = spawnProjectile(w, s, flight);
  if (slot >= 0) w.projectiles.src[slot] = m.id[i];
  return slot;
}

/**
 * Whether monster `i` has a clear straight shot at (tx, ty) for a projectile of radius `radius`: no tall prop between its body and
 * the target. Ranged brains hold their volley while this is false and close in (the nav flow field takes them round the wall)
 * instead of spending shots on scenery. Lobs and boss patterns never ask.
 */
export function shotClear(w: World, i: number, tx: number, ty: number, radius: number): boolean {
  const m = w.monsters;
  return !coverBlocked(w, m.x[i], m.y[i], tx, ty, radius);
}

/** Where a monster's projectiles leave its body (distance from its centre). */
export function muzzleOffset(w: World, i: number): number {
  return w.monsters.radius[i] + 2;
}

/** Extra projectiles granted to monster ranged attacks by map mods. */
export function extraProjectiles(w: World): number {
  return Math.max(0, Math.floor(w.config.monsters.extraProjectiles || 0));
}

/**
 * Turn monster `i`'s aim (m.aim, radians) toward the vector (dx, dy) by at most `rate` rad/s; its
 * sprite faces the same way. The core does this for a guarding blocker every tick.
 */
export function turnToward(w: World, i: number, dx: number, dy: number, rate: number): void {
  const m = w.monsters;
  const want = Math.atan2(dy, dx);
  let diff = want - m.aim[i];
  diff -= Math.round(diff / TAU) * TAU;
  const max = rate * DT;
  let a = m.aim[i] + (diff > max ? max : diff < -max ? -max : diff);
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  m.aim[i] = a;
  m.facing[i] = Math.cos(a) >= 0 ? 1 : -1;
}

export function toChase(w: World, i: number): void {
  const m = w.monsters;
  m.state[i] = MSTATE.chase;
  m.stateTime[i] = 0;
}

// --- aimed shots: level scaling and intercept aim ----------------------------------------------------

/** How far this map's monster level has ramped from the forgiving tier-1 shots (0) to the full ones (1). */
export function projectileRamp(w: World): number {
  const S = PROJECTILE_SCALING;
  const r = (w.config.monsters.level - S.levelFloor) / (S.levelFull - S.levelFloor);
  return r <= 0 ? 0 : r >= 1 ? 1 : r;
}

/** A tuning pair [tier-1 value, full value] at this map's monster level. */
export function byLevel(w: World, pair: readonly [number, number]): number {
  return pair[0] + (pair[1] - pair[0]) * projectileRamp(w);
}

/** Extra shots per volley at this map's monster level: 0 at tier 1, up to `max` (rounded) at the full ramp. */
export function levelExtraShots(w: World, max: number): number {
  return Math.round(max * projectileRamp(w));
}

/**
 * Seconds until a shot at `speed`, leaving `off` ahead of its shooter, meets a target at (dx, dy) from the
 * shooter moving steadily at (vx, vy): the smallest t >= 0 with |D + V*t| = off + speed*t. -1 when there is
 * no such meeting within `maxTime` (the target outpaces the shot, or the meeting lies beyond its range).
 */
export function interceptTime(dx: number, dy: number, vx: number, vy: number, speed: number, off: number, maxTime: number): number {
  const c = dx * dx + dy * dy - off * off;
  if (c <= 0) return 0; // already inside the muzzle
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (dx * vx + dy * vy - off * speed);
  let t = -1;
  if (Math.abs(a) < 1e-9) {
    if (b < 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      const t1 = (-b - r) / (2 * a);
      const t2 = (-b + r) / (2 * a);
      const lo = Math.min(t1, t2);
      const hi = Math.max(t1, t2);
      t = lo >= 0 ? lo : hi;
    }
  }
  return t >= 0 && t <= maxTime ? t : -1;
}

/**
 * Heading for a shot from monster `i` (its muzzle, from `fromX/fromY` when given) at player `t`: the intercept
 * of a player who keeps walking as they are, `accuracy` (0..1) of the way (0 = the current position). With no
 * intercept inside the shot's range (a player crossing squarely outpaces a slow shot) it falls back to
 * `fallbackLead` seconds of lead, scaled by the same accuracy: a partial lead that catches slowing players.
 */
export function aimAtPlayer(
  w: World, i: number, t: PlayerState, speed: number, range: number, accuracy: number, fallbackLead = 0.25, fromX?: number, fromY?: number,
): number {
  const m = w.monsters;
  const ox = fromX ?? m.x[i];
  const oy = fromY ?? m.y[i];
  const dx = t.x - ox;
  const dy = t.y - oy;
  const off = fromX === undefined ? muzzleOffset(w, i) : 0;
  const meet = speed > 0 ? interceptTime(dx, dy, t.vx, t.vy, speed, off, Math.max(0, range - off) / speed) : -1;
  const lead = (meet >= 0 ? meet : fallbackLead) * accuracy;
  return Math.atan2(dy + t.vy * lead, dx + t.vx * lead);
}
