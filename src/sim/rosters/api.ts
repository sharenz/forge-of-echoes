// The roster API: everything a monster's brain, boss script or effect may use (see ./index.ts for the
// guide). Roster code imports from here (and ./kit, ./types) only — never from other sim modules — so the
// core can change underneath without touching the rosters.
import type { PlayerDebuff } from '../../contracts/bestiary';
import type { AreaKind, ProjectileKind, RootSource, SimEvent } from '../../contracts/sim';
import { KIND_BY_INDEX } from '../archetypes';
import { spawnArea, type AreaOptions } from '../areas';
import { empowerMult, fireHostile, muzzleOffset } from '../behaviour';
import { hitPlayer } from '../combat';
import { DT, PLAYER_RADIUS } from '../constants';
import { applyDebuff as coreApplyDebuff } from '../debuffs';
import { TAU } from '../math';
import { nearestLiving, pullPlayer as corePullPlayer } from '../player';
import { PROJ } from '../projectiles';
import { MFLAG } from '../stores';
import type { Area, PlayerState, World } from '../world';

// --- state, movement, poses ---------------------------------------------------------------------------
export { MONSTER_ANIM, MSTATE } from '../behaviour';
export {
  empowerMult, extraProjectiles, faceTarget, fireHostile, fireHostileFrom, meleeHit, memoryOf, moveAlong, muzzleOffset, setAnim, steer,
  stop, toChase, turnToward, wander,
} from '../behaviour';
export { aimAtPlayer, byLevel, interceptTime, levelExtraShots, projectileRamp, shotClear } from '../behaviour';
export { coverClip } from '../cover';
export { MFLAG } from '../stores';
export { DT, HASTE_BONUS, PLAYER_RADIUS, PULL_MAX_DISTANCE, ROOT_DURATION } from '../constants';
export { DAMAGE_INDEX, TAU, clamp } from '../math';
export { nearestLiving } from '../player';

// --- players: damage, debuffs, forces -----------------------------------------------------------------
export { damagePlayer, hitPlayer, takeCorpses } from '../combat';
export { cleanseDebuffs, isActive as hasDebuff } from '../debuffs';
export { knockPlayer } from '../player';

/**
 * Apply (or refresh) a debuff on a player directly (GAME_SPEC §13 rules: debuffs.ts). Like a hit, it
 * lands on nobody invulnerable — Rift Step's i-frames dodge everything. Prefer a rider on a hit or an
 * area; use this for effects without a hit of their own. Returns true when something changed.
 */
export function applyDebuff(
  w: World, p: PlayerState, id: PlayerDebuff, hit = 0, source?: RootSource, duration?: number,
): boolean {
  if (p.dead || p.invulnTime > 0) return false;
  return coreApplyDebuff(w, p, id, hit, source, duration);
}

/**
 * Drag a player up to `distance` units (capped at PULL_MAX_DISTANCE) toward (x, y) over PULL_TIME,
 * then root them (`source`); emits 'pull'. Nothing happens to an invulnerable (blinking) player. Call it
 * after a hit that connected. (A chainHook projectile does all of this itself: setProjectilePull.)
 */
export function pullPlayer(w: World, p: PlayerState, x: number, y: number, distance: number, source: RootSource = 'chain'): void {
  if (p.dead || p.invulnTime > 0) return;
  corePullPlayer(w, p, x, y, distance, source);
}

// --- projectiles and areas ------------------------------------------------------------------------------
export { removeOwnedAreas, spawnArea, type AreaOptions } from '../areas';
export {
  PROJ, PROJECTILE_RIDERS, setProjectileDebuff, setProjectileEffect, setProjectilePull, setProjectileSplash,
} from '../projectiles';
export { registerAreaEffect, registerProjectileEffect, type AreaEffect, type ProjectileEffect } from '../effects';
export {
  CHARGE_LINE_HALF_WIDTH, CHOIR_GAP_HALF_ANGLE, CHOIR_RING_HALF_WIDTH, ICE_PRISON_END_FRACTION, TAR_SLOW, WISP_FREEZE_FRACTION,
  areaAngle, areaContains, areaVariant, quantizeAreaAngle,
} from '../area-geometry';
export { NO_SOURCE } from '../stores';

// --- summons and bosses -----------------------------------------------------------------------------------
export { bossState, bossRuntime, fieldFull, summon, summonAt } from '../bosses';
export { SUMMON_FIELD_CAP } from '../constants';
export { spawnMonster } from '../spawn';

export type { Area, PlayerState, World } from '../world';
export type { BlockSpec, BossScript, Brain, MonsterDef, MonsterRole, Roster } from './types';

/** The 'monsterAttack' attack names (SimEvent). */
export type MonsterAttack = Extract<SimEvent, { t: 'monsterAttack' }>['attack'];

/** Emit 'monsterAttack' for monster `i` (the presenter's cue: pose, sound), at (x, y) or at the monster. */
export function attackEvent(w: World, i: number, attack: MonsterAttack, x?: number, y?: number): void {
  const m = w.monsters;
  w.events.push({ t: 'monsterAttack', kind: KIND_BY_INDEX[m.kind[i]], x: x ?? m.x[i], y: y ?? m.y[i], attack });
}

/** Monster `i`'s current hit damage (its scaled damage × the Herald-style empower bonus). */
export function monsterDamage(w: World, i: number): number {
  return w.monsters.damage[i] * empowerMult(w, i);
}

/** The boss phase monster `i` is in (1 for anything but the run's boss). */
export function phaseOf(w: World, i: number): number {
  return w.bossStates.get(w.monsters.id[i])?.phase ?? (w.monsters.flags[i] & MFLAG.boss ? w.boss.phase : 1);
}

/** Whether monster `i` is guarding with its shield (MonsterDef.block). */
export function isGuarding(w: World, i: number): boolean {
  return (w.monsters.flags[i] & MFLAG.guard) !== 0;
}

/** Raise or lower monster `i`'s shield (drop it while bashing: that's the opening). */
export function setGuard(w: World, i: number, on: boolean): void {
  const m = w.monsters;
  if (on) m.flags[i] |= MFLAG.guard;
  else m.flags[i] &= ~MFLAG.guard;
}

/**
 * Lob a projectile from monster `i` so it lands on (tx, ty) after `flight` seconds (clamped to
 * `maxRange` from the muzzle). Its landing splash hurts players within the splash radius (default
 * SPIT_SPLASH_RADIUS; setProjectileSplash). Returns the slot or -1.
 */
export function lobAt(
  w: World, i: number, kind: ProjectileKind, tx: number, ty: number, flight: number, radius: number, damage: number, dtype: number,
  maxRange = 400,
): number {
  const m = w.monsters;
  const dx = tx - m.x[i];
  const dy = ty - m.y[i];
  const a = Math.atan2(dy, dx);
  const dist = Math.max(0, Math.min(maxRange, Math.hypot(dx, dy)) - muzzleOffset(w, i));
  return fireHostile(w, i, PROJ[kind], a, dist / Math.max(DT, flight), dist, radius, damage, dtype, flight);
}

/** The living player farthest from (x, y) within `maxDist` (null when none). */
export function farthestLiving(w: World, x: number, y: number, maxDist = Infinity): PlayerState | null {
  let best: PlayerState | null = null;
  let bd = -1;
  const lim = maxDist * maxDist;
  for (const p of w.living) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= lim && d2 > bd) {
      bd = d2;
      best = p;
    }
  }
  return best;
}

/** A random living player (world rng; null when nobody is alive). */
export function randomLiving(w: World): PlayerState | null {
  const l = w.living;
  if (l.length === 0) return null;
  return l.length === 1 ? l[0] : w.worldRng.pick(l);
}

const clamped = { x: 0, y: 0 };

/** (x, y) pulled inside the arena by `margin` (a scratch object: copy the fields before the next call). */
export function clampToArena(w: World, x: number, y: number, margin = 20): { x: number; y: number } {
  const lim = Math.max(0, w.arenaRadius - margin);
  const d = Math.hypot(x, y);
  const s = d > lim ? lim / d : 1;
  clamped.x = x * s;
  clamped.y = y * s;
  return clamped;
}

/**
 * A line of `count` telegraphs of `kind` from (x, y) along `angle`, `spacing` apart, each resolving
 * `stepDelay` after the previous one (the first after `firstDelay`) — glacial spikes, spike runs,
 * charge lanes. Points outside the arena are skipped. Returns how many were placed.
 */
export function areaLine(
  w: World, kind: AreaKind, x: number, y: number, angle: number, count: number, spacing: number, radius: number,
  firstDelay: number, stepDelay: number, opts: AreaOptions = {},
): number {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const lim = w.arenaRadius - radius * 0.5;
  let n = 0;
  for (let k = 0; k < count; k++) {
    const px = x + ux * spacing * (k + 1);
    const py = y + uy * spacing * (k + 1);
    if (px * px + py * py > lim * lim) break;
    spawnArea(w, kind, px, py, radius, firstDelay + stepDelay * k, { angle, ...opts });
    n++;
  }
  return n;
}

/**
 * Hit every living player whose body touches the circle (x, y, r) and isn't in `already` (player ids;
 * pushed as they are hit) — contact damage of a charge or a sweep. Returns how many connected.
 * `onHit` runs for each connecting hit (knockback…).
 */
export function hitPlayersIn(
  w: World, x: number, y: number, r: number, damage: number, dtype: number, debuff: PlayerDebuff | null, already: number[],
  onHit?: (p: PlayerState) => void, source?: RootSource,
): number {
  let n = 0;
  const rr = r + PLAYER_RADIUS;
  for (const p of w.living) {
    if (already.includes(p.id)) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy > rr * rr) continue;
    already.push(p.id);
    const res = hitPlayer(w, p, damage, dtype, 'area', debuff, source);
    if (res >= 0 && !p.dead) {
      n++;
      onHit?.(p);
    }
  }
  return n;
}

/** Angle from monster `i` to a point. */
export function angleTo(w: World, i: number, x: number, y: number): number {
  return Math.atan2(y - w.monsters.y[i], x - w.monsters.x[i]);
}

/** A uniformly random angle from the world rng. */
export function randomAngle(w: World): number {
  return w.worldRng.range(0, TAU);
}

/** The nearest living player to monster `i` (null when nobody is alive). */
export function nearestTo(w: World, i: number): PlayerState | null {
  return nearestLiving(w, w.monsters.x[i], w.monsters.y[i]);
}

/** The area with this id, if it still exists. */
export function areaById(w: World, id: number): Area | undefined {
  for (const a of w.areas) if (a.id === id && !a.dead) return a;
  return undefined;
}
