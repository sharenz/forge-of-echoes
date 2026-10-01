// Ashen Forge regular monsters: Ashling, Ember Skitter, Cinder Spitter, Rift Stalker, Ironhide Brute.
import { MONSTER_KINDS } from '../../../contracts/content';
import { SPIT_FLIGHT } from '../../constants';
import {
  DAMAGE_INDEX, DT, MFLAG, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, PROJ, empowerMult, extraProjectiles, faceTarget, fireHostile,
  meleeHit, moveAlong, muzzleOffset, setAnim, spawnArea, steer, stop, toChase, wander, type Brain, type PlayerState, type World,
} from '../api';
import { gapLeap, markerDropper } from '../pressure';
import { BEHAVIOUR } from './tuning';

/** The plain Ashling: walks at its player; a short windup, then a lunge-bite. */
function meleeAshling(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.ashling;
  const st = m.state[i];
  if (st === MSTATE.windup) {
    stop(w, i);
    if (!t) {
      toChase(w, i);
      return;
    }
    faceTarget(w, i, t);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.lungeTime;
      setAnim(w, i, ANIM.attack);
      // The lunge carries the ashling forward a few units.
      m.kbX[i] += (dx / d) * B.lungeSpeed * B.lungeTime * 0.5;
      m.kbY[i] += (dy / d) * B.lungeSpeed * B.lungeTime * 0.5;
      if (d <= m.radius[i] + PLAYER_RADIUS + B.reach + 4) meleeHit(w, i, t);
      m.attackCd[i] = B.cooldown;
    }
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting) {
    wander(w, i);
    return;
  }
  steer(w, i, dx, dy, d, 1);
  if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + B.reach) {
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** Ashling: the plain melee, plus a short telegraphed gap-closing leap at mid range (BEHAVIOUR.ashlingLeap). */
export const brainAshling: Brain = gapLeap(meleeAshling, BEHAVIOUR.ashlingLeap);

/** Ember Skitter: fast, zig-zagging in bursts; quick bites without windup. */
export function brainSkitter(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.skitter;
  if (m.state[i] === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  const time = w.time;
  const ph = m.phase[i];
  const weave = Math.sin(time * B.zigzagFreq + ph) * B.zigzagAmp * (d > 40 ? 1 : 0.3);
  const burst = 0.55 + 0.9 * Math.max(0, Math.sin(time * B.burstFreq + ph * 1.7));
  const ang = Math.atan2(dy, dx) + weave;
  const v = m.speed[i] * burst;
  m.vx[i] = Math.cos(ang) * v;
  m.vy[i] = Math.sin(ang) * v;
  if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + B.reach) {
    meleeHit(w, i, t);
    m.attackCd[i] = B.cooldown;
    m.state[i] = MSTATE.attack;
    m.stateTime[i] = B.biteTime;
    setAnim(w, i, ANIM.attack);
    stop(w, i);
  }
}

/** The spitter's ember marker on where its player will be (drops now and then; a held player is spared). */
const markSpit = markerDropper(BEHAVIOUR.spitterMark);

/**
 * Cinder Spitter: keeps 140–220 away and lobs fire spit every 2.4 s. The spit is a true lob:
 * it flies for exactly SPIT_FLIGHT seconds toward where its player is heading and bursts where
 * it lands (radius SPIT_SPLASH_RADIUS), so its landing spot is readable and dodgeable. The
 * presenter draws its height as 4h·u(1−u) with u = age / life. The splash sets the player burning.
 */
export function brainSpitter(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.spitter;
  if (m.state[i] === MSTATE.cast) {
    stop(w, i);
    if (!t) {
      toChase(w, i);
      return;
    }
    faceTarget(w, i, t);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      const tx = t.x + t.vx * B.lead - m.x[i];
      const ty = t.y + t.vy * B.lead - m.y[i];
      const base = Math.atan2(ty, tx);
      // Ground distance from the muzzle to the landing point; the speed makes it land on time.
      const dist = Math.min(B.range, Math.max(B.minRange, Math.hypot(tx, ty))) - muzzleOffset(w, i);
      const speed = Math.max(0, dist) / SPIT_FLIGHT;
      const count = 1 + extraProjectiles(w);
      const dmg = m.damage[i] * empowerMult(w, i);
      for (let k = 0; k < count; k++) {
        const a = base + (k - (count - 1) / 2) * B.spread;
        fireHostile(w, i, PROJ.cinderSpit, a, speed, dist, B.radius, dmg, DAMAGE_INDEX.fire, SPIT_FLIGHT);
      }
      w.events.push({ t: 'monsterAttack', kind: MONSTER_KINDS[m.kind[i]], x: m.x[i], y: m.y[i], attack: 'spit' });
      markSpit(w, i, t);
      setAnim(w, i, ANIM.attack);
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = 0.25;
      m.attackCd[i] = B.cooldown + w.worldRng.range(0, 0.5);
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
  if (d < B.near) moveAlong(w, i, -dx, -dy, 1);
  else if (d > B.far) steer(w, i, dx, dy, d, 1);
  else {
    // Strafe around the player while in the comfort band.
    const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
    moveAlong(w, i, -dy * side, dx * side, 0.4);
  }
  if (m.attackCd[i] <= 0 && d < B.fireRange) {
    m.state[i] = MSTATE.cast;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** Rift Stalker: every 4 s marks its player's position (0.6 s) and leaps onto it; the landing withers. */
export function brainStalker(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.stalker;
  const st = m.state[i];
  if (st === MSTATE.windup) {
    stop(w, i);
    m.facing[i] = m.tx[i] >= m.x[i] ? 1 : -1;
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      m.state[i] = MSTATE.leap;
      m.stateTime[i] = B.flight;
      m.sx[i] = m.x[i];
      m.sy[i] = m.y[i];
      m.flags[i] |= MFLAG.unpushable;
      setAnim(w, i, ANIM.leap);
      w.events.push({ t: 'monsterAttack', kind: 'riftStalker', x: m.x[i], y: m.y[i], attack: 'leap' });
    }
    return;
  }
  if (st === MSTATE.leap) {
    stop(w, i);
    m.stateTime[i] -= DT;
    const u = Math.min(1, 1 - m.stateTime[i] / B.flight);
    m.x[i] = m.sx[i] + (m.tx[i] - m.sx[i]) * u;
    m.y[i] = m.sy[i] + (m.ty[i] - m.sy[i]) * u;
    if (m.stateTime[i] <= 0) {
      m.flags[i] &= ~MFLAG.unpushable;
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.recover;
      setAnim(w, i, ANIM.attack);
    }
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      toChase(w, i);
      m.attackCd[i] = B.cooldown;
    }
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  steer(w, i, dx, dy, d, 1);
  if (m.attackCd[i] <= 0 && d < B.trigger && d > B.minTrigger) {
    let tx = t.x;
    let ty = t.y;
    const lim = w.arenaRadius - m.radius[i];
    const tl = Math.hypot(tx, ty);
    if (tl > lim) {
      tx *= lim / tl;
      ty *= lim / tl;
    }
    m.tx[i] = tx;
    m.ty[i] = ty;
    spawnArea(w, 'leapWarning', tx, ty, B.radius, B.windup + B.flight, {
      damage: m.damage[i] * empowerMult(w, i), dtype: DAMAGE_INDEX.void, hurts: 'player', owner: m.id[i],
    });
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** Ironhide Brute: slow and armoured; a 0.9 s telegraphed slam. */
export function brainBrute(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.brute;
  const st = m.state[i];
  if (st === MSTATE.windup) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.recover;
      setAnim(w, i, ANIM.attack);
      w.events.push({ t: 'monsterAttack', kind: 'ironhideBrute', x: m.tx[i], y: m.ty[i], attack: 'slam' });
    }
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      toChase(w, i);
      m.attackCd[i] = B.cooldown;
    }
    return;
  }
  if (!hunting) {
    wander(w, i);
    return;
  }
  steer(w, i, dx, dy, d, 1);
  const r = m.radius[i];
  if (m.attackCd[i] <= 0 && d < r + B.radius + PLAYER_RADIUS * 0.5) {
    const ux = dx / d;
    const uy = dy / d;
    const cx = m.x[i] + ux * (r + 12);
    const cy = m.y[i] + uy * (r + 12);
    m.tx[i] = cx;
    m.ty[i] = cy;
    faceTarget(w, i, t);
    spawnArea(w, 'slamWarning', cx, cy, B.radius, B.windup, {
      damage: m.damage[i] * empowerMult(w, i), dtype: DAMAGE_INDEX.physical, hurts: 'player', owner: m.id[i],
    });
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}
