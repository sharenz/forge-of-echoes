// The Ashbound Herald (lieutenant, wave 3) and the Cinder Matriarch (boss, final wave).
import type { MonsterKind } from '../contracts/content';
import { BEHAVIOUR, KIND_BY_INDEX } from './archetypes';
import { spawnArea, removeOwnedAreas } from './areas';
import {
  MONSTER_ANIM as ANIM, MSTATE, empowerMult, extraProjectiles, faceTarget, fireHostile, meleeHit, moveAlong, setAnim, steer,
  stop, toChase, wander,
} from './behaviour';
import { HERALD_AURA_RADIUS, DT, MAX_LIVE_MONSTERS, PLAYER_RADIUS, SUMMONED_XP_FACTOR } from './constants';
import { DAMAGE_INDEX, TAU, clamp } from './math';
import { PROJ } from './projectiles';
import { spawnMonster } from './spawn';
import { MFLAG } from './stores';
import type { PlayerState, World } from './world';

/**
 * Summon minions in a ring around a monster (skipped when the field is saturated). Summons are
 * flagged: they roll no loot and carry reduced XP.
 */
function summon(w: World, i: number, kind: MonsterKind, count: number, rMin: number, rMax: number): void {
  const m = w.monsters;
  if (m.count + count > MAX_LIVE_MONSTERS) return;
  const rng = w.worldRng;
  const base = rng.range(0, TAU);
  const lim = w.arenaRadius - 16;
  for (let k = 0; k < count; k++) {
    const a = base + (k / count) * TAU;
    const r = rng.range(rMin, rMax);
    let x = m.x[i] + Math.cos(a) * r;
    let y = m.y[i] + Math.sin(a) * r;
    const d = Math.hypot(x, y);
    if (d > lim) {
      x *= lim / d;
      y *= lim / d;
    }
    const j = spawnMonster(w, kind, x, y, { pack: m.pack[i], wave: w.director.wave });
    if (j >= 0) {
      m.flags[j] |= MFLAG.summoned;
      m.xp[j] *= SUMMONED_XP_FACTOR;
    }
  }
  w.events.push({ t: 'monsterAttack', kind: KIND_BY_INDEX[m.kind[i]], x: m.x[i], y: m.y[i], attack: 'summon' });
}

// --- Ashbound Herald -------------------------------------------------------------------------------

/** What the Herald's current cast releases (kept in timerC). */
const HERALD_CAST_ORBS = 0;
const HERALD_CAST_SUMMON = 1;

/**
 * Keeps 110–170 from its player. Aura (radius 110): allies +30% speed and damage.
 * Every 6 s summons 6 ashlings; every 3 s fires a 5-orb spread at its player. Both are short
 * casts (windup anim, then the attack anim on release). The timers run through casts, so the
 * cadence holds.
 */
export function brainHerald(
  w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean,
): void {
  const m = w.monsters;
  const B = BEHAVIOUR.herald;
  if ((w.tick + i) % 6 === 0) {
    const R = HERALD_AURA_RADIUS;
    const cand = w.scratch2;
    const n = w.grid.query(m.x[i] - R, m.y[i] - R, m.x[i] + R, m.y[i] + R, cand);
    for (let k = 0; k < n; k++) {
      const j = cand[k];
      if (j === i || !m.alive[j]) continue;
      const ex = m.x[j] - m.x[i];
      const ey = m.y[j] - m.y[i];
      if (ex * ex + ey * ey <= R * R) m.empowerTime[j] = 0.25;
    }
  }
  if (m.timerA[i] > 0) m.timerA[i] -= DT;
  if (m.timerB[i] > 0) m.timerB[i] -= DT;
  if (m.state[i] === MSTATE.cast) {
    stop(w, i);
    faceTarget(w, i, t);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      if (m.timerC[i] === HERALD_CAST_SUMMON) summon(w, i, 'ashling', B.summonCount, 26, 56);
      else if (t) {
        const count = B.orbCount + extraProjectiles(w);
        const base = Math.atan2(dy, dx);
        const dmg = m.damage[i] * empowerMult(w, i);
        for (let k = 0; k < count; k++) {
          const a = count === 1 ? base : base - B.orbSpread / 2 + (B.orbSpread * k) / (count - 1);
          fireHostile(w, i, PROJ.heraldOrb, a, B.orbSpeed, B.orbRange, B.orbRadius, dmg, DAMAGE_INDEX.void);
        }
        w.events.push({ t: 'monsterAttack', kind: 'ashboundHerald', x: m.x[i], y: m.y[i], attack: 'orb' });
      }
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.releaseTime;
      setAnim(w, i, ANIM.attack);
    }
    return;
  }
  if (m.state[i] === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting) {
    wander(w, i);
    return;
  }
  if (d > B.keepFar) steer(w, i, dx, dy, d, 1);
  else if (d < B.keepNear) moveAlong(w, i, -dx, -dy, 0.8);
  else moveAlong(w, i, -dy, dx, 0.35);
  if (m.timerA[i] <= 0) {
    m.timerA[i] = B.summonEvery;
    beginHeraldCast(w, i, HERALD_CAST_SUMMON, B.summonCastTime);
  } else if (m.timerB[i] <= 0 && d < B.orbRange) {
    m.timerB[i] = B.orbEvery;
    beginHeraldCast(w, i, HERALD_CAST_ORBS, B.castTime);
  }
}

function beginHeraldCast(w: World, i: number, what: number, time: number): void {
  const m = w.monsters;
  m.timerC[i] = what;
  m.state[i] = MSTATE.cast;
  m.stateTime[i] = time;
  setAnim(w, i, ANIM.windup);
  stop(w, i);
}

// --- Cinder Matriarch ------------------------------------------------------------------------------

const M = {
  keep: 64,
  meleeCd: 1.3,
  spiralDuration: 2.0,
  spiralInterval: 0.1,
  spiralTurn: 0.23,
  spiralSpeed: 110,
  spiralRange: 520,
  orbRadius: 7,
  orbDamage: 0.6,
  spiralCd: [6, 5, 4.5],
  slamRadius: 70,
  slamWindup: 1.1,
  slamCd: 5,
  slamRange: 120,
  slamDamage: 2.0,
  slamRecover: 0.5,
  meteorCd: [9, 9, 7],
  meteorRadius: 28,
  meteorDamage: 1.3,
  meteorSpread: 150,
  /** Players within this distance of her share the meteor rain. */
  meteorReach: 520,
  poolDuration: 5,
  poolDamage: 0.25,
  chargeWindup: 0.9,
  chargeSpeed: 480,
  chargeCd: 8,
  chargeDamage: 1.6,
  chargeRadius: 26,
  chargeSpacing: 34,
  chargeRecover: 0.6,
  summonCd: [10, 10, 8],
  summonCount: 5,
  roar: 1.2,
} as const;

export function initBossState(w: World): void {
  const b = w.boss;
  b.phase = 1;
  b.spiral = 0;
  b.spiralAngle = 0;
  b.spiralDir = 1;
  b.spiralEmit = 0;
  b.spiralCd = 2.5;
  b.slamCd = 1.5;
  b.meteorCd = 3;
  b.chargeCd = 3;
  b.summonCd = 4;
  b.roar = 0;
  b.chargeDirX = 0;
  b.chargeDirY = 0;
}

/**
 * Three phases at 100 / 66 / 33 % life. Orb spiral in every phase, slam when her player is close,
 * meteor rain around every living player near her from phase 2 (plus skitter summons), a
 * telegraphed charge in phase 3 at a player in charging range. Each phase change roars (briefly
 * immune) and emits 'bossPhase'.
 */
export function brainMatriarch(
  w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean,
): void {
  const m = w.monsters;
  const b = w.boss;
  const frac = m.life[i] / m.maxLife[i];
  const want = frac <= 0.33 ? 3 : frac <= 0.66 ? 2 : 1;
  // One phase per roar: a single huge hit past both thresholds still plays the phase-2 roar
  // (event, flash, hit-stop) and then the phase-3 one as soon as it ends.
  if (m.state[i] !== MSTATE.roar && want > b.phase) {
    b.phase++;
    b.roar = M.roar;
    b.spiral = 0;
    removeOwnedAreas(w, m.id[i]);
    m.state[i] = MSTATE.roar;
    m.flags[i] = (m.flags[i] | MFLAG.immune) & ~MFLAG.unpushable;
    stop(w, i);
    setAnim(w, i, ANIM.windup);
    w.events.push({ t: 'bossPhase', phase: b.phase });
    return;
  }
  if (m.state[i] === MSTATE.roar) {
    stop(w, i);
    b.roar -= DT;
    if (b.roar <= 0) {
      m.flags[i] &= ~MFLAG.immune;
      toChase(w, i);
      b.meteorCd = Math.min(b.meteorCd, 1);
      b.chargeCd = Math.min(b.chargeCd, 2);
      b.summonCd = Math.min(b.summonCd, 1.5);
    }
    return;
  }

  const dmg = m.damage[i] * empowerMult(w, i);
  // The orb spiral runs alongside whatever else she is doing.
  if (b.spiral > 0) {
    b.spiral -= DT;
    b.spiralEmit -= DT;
    const arms = 2 + b.phase + extraProjectiles(w);
    while (b.spiral > 0 && b.spiralEmit <= 0) {
      b.spiralEmit += M.spiralInterval;
      for (let k = 0; k < arms; k++) {
        const a = b.spiralAngle + (k / arms) * TAU;
        fireHostile(w, i, PROJ.matriarchOrb, a, M.spiralSpeed, M.spiralRange, M.orbRadius, dmg * M.orbDamage, DAMAGE_INDEX.fire);
      }
      b.spiralAngle += M.spiralTurn * b.spiralDir;
    }
  }
  b.spiralCd -= DT;
  b.slamCd -= DT;
  b.meteorCd -= DT;
  b.chargeCd -= DT;
  b.summonCd -= DT;

  switch (m.state[i]) {
    case MSTATE.windup: // slam windup
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        m.state[i] = MSTATE.attack;
        m.stateTime[i] = M.slamRecover;
        setAnim(w, i, ANIM.attack);
        w.events.push({ t: 'monsterAttack', kind: 'cinderMatriarch', x: m.tx[i], y: m.ty[i], attack: 'slam' });
      }
      return;
    case MSTATE.attack:
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) toChase(w, i);
      return;
    case MSTATE.cast: // charge windup
      stop(w, i);
      m.facing[i] = b.chargeDirX >= 0 ? 1 : -1;
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        const len = Math.hypot(m.tx[i] - m.x[i], m.ty[i] - m.y[i]);
        m.state[i] = MSTATE.charge;
        m.stateTime[i] = len / M.chargeSpeed;
        m.flags[i] |= MFLAG.unpushable;
        setAnim(w, i, ANIM.move);
        w.events.push({ t: 'monsterAttack', kind: 'cinderMatriarch', x: m.x[i], y: m.y[i], attack: 'charge' });
      }
      return;
    case MSTATE.charge: {
      stop(w, i);
      const step = Math.min(M.chargeSpeed * DT, Math.max(0, m.stateTime[i]) * M.chargeSpeed);
      m.x[i] += b.chargeDirX * step;
      m.y[i] += b.chargeDirY * step;
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        m.flags[i] &= ~MFLAG.unpushable;
        m.state[i] = MSTATE.attack;
        m.stateTime[i] = M.chargeRecover;
        setAnim(w, i, ANIM.idle);
      }
      return;
    }
  }

  if (!hunting || !t) {
    stop(w, i);
    return;
  }
  if (d > M.keep) steer(w, i, dx, dy, d, 1);
  else {
    stop(w, i);
    faceTarget(w, i, t);
  }
  if (m.attackCd[i] <= 0 && d < m.radius[i] + PLAYER_RADIUS + 6) {
    meleeHit(w, i, t);
    m.attackCd[i] = M.meleeCd;
  }
  if (b.spiral <= 0 && b.spiralCd <= 0 && d < 420) {
    b.spiral = M.spiralDuration;
    b.spiralEmit = 0;
    b.spiralAngle = Math.atan2(dy, dx);
    b.spiralDir = -b.spiralDir;
    b.spiralCd = M.spiralCd[b.phase - 1];
    w.events.push({ t: 'monsterAttack', kind: 'cinderMatriarch', x: m.x[i], y: m.y[i], attack: 'orb' });
  }
  const charge = b.phase >= 3 && b.chargeCd <= 0 ? chargeTarget(w, i, t) : null;
  if (charge) startCharge(w, i, charge.x - m.x[i], charge.y - m.y[i], dmg);
  else if (b.slamCd <= 0 && d < M.slamRange) startSlam(w, i, t, dx, dy, d, dmg);
  if (b.phase >= 2 && b.meteorCd <= 0) meteorRain(w, i, t, dmg);
  if (b.phase >= 2 && b.summonCd <= 0) {
    b.summonCd = M.summonCd[b.phase - 1];
    summon(w, i, 'emberSkitter', M.summonCount, 36, 64);
  }
}

/** Charge victim: her own player when in charging range (90–400), else the nearest other one that is. */
function chargeTarget(w: World, i: number, t: PlayerState): PlayerState | null {
  const m = w.monsters;
  const inBand = (p: PlayerState): number => {
    const d = Math.hypot(p.x - m.x[i], p.y - m.y[i]);
    return d > 90 && d < 400 ? d : -1;
  };
  if (inBand(t) > 0) return t;
  let best: PlayerState | null = null;
  let bd = Infinity;
  for (const p of w.living) {
    const d = inBand(p);
    if (d > 0 && d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function startSlam(w: World, i: number, t: PlayerState, dx: number, dy: number, d: number, dmg: number): void {
  const m = w.monsters;
  const cx = m.x[i] + (dx / d) * 30;
  const cy = m.y[i] + (dy / d) * 30;
  m.tx[i] = cx;
  m.ty[i] = cy;
  spawnArea(w, 'slamWarning', cx, cy, M.slamRadius, M.slamWindup, {
    damage: dmg * M.slamDamage, dtype: DAMAGE_INDEX.physical, hurts: 'player', owner: m.id[i],
  });
  m.state[i] = MSTATE.windup;
  m.stateTime[i] = M.slamWindup;
  faceTarget(w, i, t);
  setAnim(w, i, ANIM.windup);
  stop(w, i);
  w.boss.slamCd = M.slamCd;
}

/** Telegraphed charge: a line of warnings that resolve exactly as she passes over each one. */
function startCharge(w: World, i: number, dx: number, dy: number, dmg: number): void {
  const m = w.monsters;
  const b = w.boss;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const lim = w.arenaRadius - m.radius[i] - 4;
  let len = clamp(d + 80, 160, 380);
  while (len > 60 && Math.hypot(m.x[i] + ux * len, m.y[i] + uy * len) > lim) len -= 10;
  b.chargeDirX = ux;
  b.chargeDirY = uy;
  m.tx[i] = m.x[i] + ux * len;
  m.ty[i] = m.y[i] + uy * len;
  for (let s = M.chargeSpacing * 0.5; s <= len; s += M.chargeSpacing) {
    spawnArea(w, 'slamWarning', m.x[i] + ux * s, m.y[i] + uy * s, M.chargeRadius, M.chargeWindup + s / M.chargeSpeed, {
      damage: dmg * M.chargeDamage, dtype: DAMAGE_INDEX.physical, hurts: 'player', owner: m.id[i],
    });
  }
  m.state[i] = MSTATE.cast;
  m.stateTime[i] = M.chargeWindup;
  m.facing[i] = ux >= 0 ? 1 : -1;
  setAnim(w, i, ANIM.windup);
  stop(w, i);
  b.chargeCd = M.chargeCd;
}

/**
 * Meteor rain around every living player within reach of her (always at least her own player):
 * 6–10 meteors for a lone player, 4–6 each when the party is spread across the field. The first
 * meteor of each volley lands where that player is heading.
 */
function meteorRain(w: World, i: number, t: PlayerState, dmg: number): void {
  const m = w.monsters;
  const b = w.boss;
  const rng = w.worldRng;
  const lim = w.arenaRadius - 20;
  const victims: PlayerState[] = [];
  for (const p of w.living) {
    if (p === t || Math.hypot(p.x - m.x[i], p.y - m.y[i]) <= M.meteorReach) victims.push(p);
  }
  if (victims.length === 0) victims.push(t);
  for (const p of victims) {
    const n = victims.length === 1 ? rng.int(6, 10) : rng.int(4, 6);
    for (let k = 0; k < n; k++) {
      let x: number;
      let y: number;
      if (k === 0) {
        x = p.x + p.vx * 0.6;
        y = p.y + p.vy * 0.6;
      } else {
        const a = rng.range(0, TAU);
        const r = rng.range(20, M.meteorSpread);
        x = p.x + Math.cos(a) * r;
        y = p.y + Math.sin(a) * r;
      }
      const dd = Math.hypot(x, y);
      if (dd > lim) {
        x *= lim / dd;
        y *= lim / dd;
      }
      spawnArea(w, 'meteorWarning', x, y, M.meteorRadius, 1.1 + k * 0.12, {
        damage: dmg * M.meteorDamage, dtype: DAMAGE_INDEX.fire, hurts: 'player',
        poolDuration: M.poolDuration, poolDamage: dmg * M.poolDamage,
      });
    }
  }
  w.events.push({ t: 'monsterAttack', kind: 'cinderMatriarch', x: m.x[i], y: m.y[i], attack: 'meteor' });
  b.meteorCd = M.meteorCd[b.phase - 1];
}
