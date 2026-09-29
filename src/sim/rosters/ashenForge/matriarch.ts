// The Cinder Matriarch (Ashen Forge boss, final wave).
import {
  DAMAGE_INDEX, DT, MFLAG, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, PROJ, TAU, bossState, clamp, empowerMult, extraProjectiles,
  faceTarget, fieldFull, fireHostile, meleeHit, setAnim, spawnArea, steer, stop, summon, toChase, type BossScript, type PlayerState, type World,
} from '../api';
import { MATRIARCH as M } from './tuning';

/** Her encounter state (BossScript state). */
export interface MatriarchState {
  /** Remaining seconds of the active orb spiral (0 = none). */
  spiral: number;
  spiralAngle: number;
  /** +1 / -1: spirals alternate their rotation. */
  spiralDir: number;
  spiralEmit: number;
  spiralCd: number;
  slamCd: number;
  meteorCd: number;
  chargeCd: number;
  summonCd: number;
  chargeDirX: number;
  chargeDirY: number;
}

/** Three phases at 100 / 66 / 33 % life; each change roars (briefly immune) and emits 'bossPhase'. */
export const MATRIARCH_SCRIPT: BossScript<MatriarchState> = {
  phases: [0.66, 0.33],
  roar: M.roar,
  init: () => ({
    spiral: 0, spiralAngle: 0, spiralDir: 1, spiralEmit: 0, spiralCd: 2.5, slamCd: 1.5, meteorCd: 3, chargeCd: 3, summonCd: 4,
    chargeDirX: 0, chargeDirY: 0,
  }),
  onPhase: (_w, _i, s) => {
    s.spiral = 0;
  },
  onRoarEnd: (_w, _i, s) => {
    s.meteorCd = Math.min(s.meteorCd, 1);
    s.chargeCd = Math.min(s.chargeCd, 2);
    s.summonCd = Math.min(s.summonCd, 1.5);
  },
};

/**
 * Orb spiral in every phase, slam when her player is close, meteor rain around every living player
 * near her from phase 2 (plus skitter summons), a telegraphed charge in phase 3 at a player in
 * charging range. Her orbs and the meteors' fire pools set players burning.
 */
export function brainMatriarch(
  w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean,
): void {
  const m = w.monsters;
  const b = bossState<MatriarchState>(w);
  const phase = w.boss.phase;
  const dmg = m.damage[i] * empowerMult(w, i);
  // The orb spiral runs alongside whatever else she is doing.
  if (b.spiral > 0) {
    b.spiral -= DT;
    b.spiralEmit -= DT;
    const arms = 2 + phase + extraProjectiles(w);
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
    b.spiralCd = M.spiralCd[phase - 1];
    w.events.push({ t: 'monsterAttack', kind: 'cinderMatriarch', x: m.x[i], y: m.y[i], attack: 'orb' });
  }
  const charge = phase >= 3 && b.chargeCd <= 0 ? chargeTarget(w, i, t) : null;
  if (charge) startCharge(w, i, b, charge.x - m.x[i], charge.y - m.y[i], dmg);
  else if (b.slamCd <= 0 && d < M.slamRange) startSlam(w, i, b, t, dx, dy, d, dmg);
  if (phase >= 2 && b.meteorCd <= 0) meteorRain(w, i, b, t, dmg);
  // Skitters from phase 2 — none onto a saturated field (a due call waits for it to thin).
  if (phase >= 2 && b.summonCd <= 0 && !fieldFull(w)) {
    b.summonCd = M.summonCd[phase - 1];
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

function startSlam(
  w: World, i: number, b: MatriarchState, t: PlayerState, dx: number, dy: number, d: number, dmg: number,
): void {
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
  b.slamCd = M.slamCd;
}

/** Telegraphed charge: a line of warnings that resolve exactly as she passes over each one. */
function startCharge(w: World, i: number, b: MatriarchState, dx: number, dy: number, dmg: number): void {
  const m = w.monsters;
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
function meteorRain(w: World, i: number, b: MatriarchState, t: PlayerState, dmg: number): void {
  const m = w.monsters;
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
  b.meteorCd = M.meteorCd[w.boss.phase - 1];
}
