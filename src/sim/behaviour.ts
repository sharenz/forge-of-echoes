// Small helpers shared by the monster brains (regular monsters, herald, matriarch).
import { MONSTER_KINDS } from '../contracts/content';
import { MONSTER_ANIM, type MonsterAnimCode } from '../contracts/sim';
import { ARCHETYPE_BY_INDEX } from './archetypes';
import { damagePlayer } from './combat';
import { ATTACKER_IMMUNITY, EMPOWER_BONUS, PLAYER_RADIUS } from './constants';
import { DAMAGE_INDEX } from './math';
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

/** A melee strike on a player (subject to evasion, armour and that player's contact caps). */
export function meleeHit(w: World, i: number, t: PlayerState, mult = 1): void {
  const m = w.monsters;
  const a = ARCHETYPE_BY_INDEX[m.kind[i]];
  damagePlayer(w, t, m.damage[i] * mult * empowerMult(w, i), DAMAGE_INDEX[a.damageType], 'melee');
  if (w.events.lowOpen) {
    w.events.low({ t: 'monsterAttack', kind: MONSTER_KINDS[m.kind[i]], x: m.x[i], y: m.y[i], attack: 'melee' });
  }
  if (m.attackCd[i] < ATTACKER_IMMUNITY) m.attackCd[i] = ATTACKER_IMMUNITY;
}

/** Fire one hostile projectile from a monster (`flight` > 0: a lob that lands after that many seconds). */
export function fireHostile(
  w: World, i: number, kind: number, angle: number, speed: number, range: number, radius: number, damage: number, dtype: number,
  flight = 0,
): void {
  const m = w.monsters;
  const s = projSpec;
  const off = muzzleOffset(w, i);
  s.kind = kind;
  s.hostile = true;
  s.x = m.x[i] + Math.cos(angle) * off;
  s.y = m.y[i] + Math.sin(angle) * off;
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
  spawnProjectile(w, s, flight);
}

/** Where a monster's projectiles leave its body (distance from its centre). */
export function muzzleOffset(w: World, i: number): number {
  return w.monsters.radius[i] + 2;
}

/** Extra projectiles granted to monster ranged attacks by map mods. */
export function extraProjectiles(w: World): number {
  return Math.max(0, Math.floor(w.config.monsters.extraProjectiles || 0));
}

export function toChase(w: World, i: number): void {
  const m = w.monsters;
  m.state[i] = MSTATE.chase;
  m.stateTime[i] = 0;
}
