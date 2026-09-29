// The Ashbound Herald (Cinder Chapel final boss).
import { DT, HERALD_AURA_RADIUS } from '../../constants';
import {
  DAMAGE_INDEX, MONSTER_ANIM as ANIM, MSTATE, PROJ, TAU, empowerMult, extraProjectiles, faceTarget, fieldFull, fireHostile, moveAlong,
  setAnim, spawnArea, spawnMonster, steer, stop, summon, toChase, wander, type PlayerState, type World,
} from '../api';
import { BEHAVIOUR } from './tuning';

/** What the Herald's current cast releases (kept in timerC). */
const HERALD_CAST_ORBS = 0;
const HERALD_CAST_SUMMON = 1;

/**
 * Keeps 90–140 from its player. Aura (radius 110): allies +30% speed and damage.
 * Every 6 s summons 6 ashlings (not while SUMMON_FIELD_CAP monsters are alive); every 3 s fires a
 * 5-orb spread at its player (void orbs: they wither). Both are short casts (windup anim, then the
 * attack anim on release). The timers run through casts, so the cadence holds.
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
      // Never onto a saturated field (it may have filled during the cast): an unkilled Herald must not snowball the horde.
      if (m.timerC[i] === HERALD_CAST_SUMMON) {
        if (!fieldFull(w)) summon(w, i, 'ashling', B.summonCount, 26, 56);
      }
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
  // A due summon waits (no cast) while the field is saturated, and comes as soon as it thins.
  if (m.timerA[i] <= 0 && !fieldFull(w)) {
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

/** Director spawn: opening timers, the empowering aura, and four ashling escorts. */
export function onHeraldSpawn(w: World, i: number, pack: number, x: number, y: number): void {
  const m = w.monsters;
  m.timerA[i] = 3;
  m.timerB[i] = 1.5;
  spawnArea(w, 'heraldAura', x, y, HERALD_AURA_RADIUS, 3600, { follow: m.id[i], hurts: 'none' });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    spawnMonster(w, 'ashling', x + Math.cos(a) * 30, y + Math.sin(a) * 30, { pack, wave: m.wave[i] });
  }
}
