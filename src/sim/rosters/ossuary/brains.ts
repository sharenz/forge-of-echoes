// Rimed Ossuary family brains that the kit doesn't cover: the Rimeshade, the Frost Weaver and the Glacial
// Wisp. (The Bone Thrall and the Ossuary Golem are kit brains configured in ./index.ts.)
import { killMonster } from '../../combat';
import {
  DAMAGE_INDEX, DT, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, PROJ, aimAtPlayer, attackEvent, byLevel, extraProjectiles, faceTarget, fireHostile, hitPlayer,
  levelExtraShots, monsterDamage, moveAlong, registerAreaEffect, setAnim, spawnArea, steer, stop, toChase, wander, type Area,
  type PlayerState, type World,
  shotClear,
} from '../api';
import { markerDropper } from '../pressure';
import { SHADE, WEAVER, WEAVER_MARK, WISP } from './tuning';

/**
 * Rimeshade: a drifting ghost. It weaves toward its player (it passes through other monsters and props:
 * MonsterDef.ghost), glides straight in for the last stretch, reaches for a moment (windup) and touches —
 * a melee hit that chills — then fades back before it comes again. 'melee' on every touch, landed or not
 * (a high-priority cue: the ghost's wail is how a player hears it behind her).
 */
export function brainRimeshade(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const st = m.state[i];
  const reach = m.radius[i] + PLAYER_RADIUS + SHADE.reach;
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
      m.stateTime[i] = SHADE.recoil;
      setAnim(w, i, ANIM.attack);
      attackEvent(w, i, 'melee');
      // The touch lands on whoever is still within its grasp (a step back dodges it). hitPlayer rather than
      // the kit's meleeHit: the cue above is the only one, landed or not.
      if (d <= reach + 4) hitPlayer(w, t, monsterDamage(w, i) * SHADE.mult, m.dtype[i], 'melee', 'chilled');
      m.attackCd[i] = SHADE.cooldown;
    }
    return;
  }
  if (st === MSTATE.attack) {
    // Fading back from the touch (the strike pose plays out first, then it drifts).
    m.stateTime[i] -= DT;
    if (t && d > 1e-3) moveAlong(w, i, -dx, -dy, SHADE.recoilSpeed);
    else stop(w, i);
    if (m.stateTime[i] < SHADE.recoil - SHADE.strikePose) setAnim(w, i, ANIM.move);
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  if (d > SHADE.closeIn) {
    const a = Math.atan2(dy, dx) + Math.sin(w.time * SHADE.weaveFreq + m.phase[i]) * SHADE.weaveAmp;
    const v = m.speed[i];
    m.vx[i] = Math.cos(a) * v;
    m.vy[i] = Math.sin(a) * v;
  } else if (d > reach) moveAlong(w, i, dx, dy, SHADE.glide);
  else stop(w, i);
  if (m.attackCd[i] <= 0 && d <= reach) {
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = SHADE.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** The weaver's rime marker on where its player will be (drops now and then; a held player is spared). */
const markWeb = markerDropper(WEAVER_MARK);

/** The web leaves: aimed at the intercept (WEAVER in ./tuning.ts), or with the short fallback lead. */
function spitWeb(w: World, i: number, t: PlayerState): void {
  const m = w.monsters;
  const speed = byLevel(w, WEAVER.speed);
  const base = aimAtPlayer(w, i, t, speed, WEAVER.range, byLevel(w, WEAVER.aim), WEAVER.fallbackLead);
  const n = 1 + extraProjectiles(w) + levelExtraShots(w, WEAVER.extraShots);
  const dmg = monsterDamage(w, i) * WEAVER.mult;
  for (let k = 0; k < n; k++) {
    // webShot's default rider roots (source 'web').
    fireHostile(w, i, PROJ.webShot, base + (k - (n - 1) / 2) * WEAVER.spread, speed, WEAVER.range, WEAVER.radius, dmg, m.dtype[i]);
  }
  attackEvent(w, i, 'web');
  markWeb(w, i, t);
}

/**
 * Frost Weaver: a spindly bone spider that keeps 150–230 from its player — backs off inside, closes in
 * beyond, strafes in between — and spits a web (120 units/s on a tier-1 map, up to 300 at high tiers) after a 0.6 s windup: 'web' as it
 * leaves (anim windup, then attack). The web roots (source 'web') whoever it touches; see WEAVER for
 * where it aims.
 */
export function brainWeaver(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const st = m.state[i];
  if (st === MSTATE.cast) {
    stop(w, i);
    if (!t) {
      toChase(w, i);
      return;
    }
    faceTarget(w, i, t);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] > 0) return;
    spitWeb(w, i, t);
    setAnim(w, i, ANIM.attack);
    m.state[i] = MSTATE.attack;
    m.stateTime[i] = WEAVER.recover;
    m.attackCd[i] = WEAVER.cooldown + w.worldRng.range(0, WEAVER.jitter);
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  // Tall cover between it and its prey: no web into a wall; it closes in (the nav field routes it round) until the line opens.
  const ready = m.attackCd[i] <= 0 && d < WEAVER.fireRange;
  const clear = !ready || shotClear(w, i, t.x, t.y, WEAVER.radius);
  if (!clear) steer(w, i, dx, dy, d, 1);
  else if (d < WEAVER.near) moveAlong(w, i, -dx, -dy, 1);
  else if (d > WEAVER.far) steer(w, i, dx, dy, d, 1);
  else {
    const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
    moveAlong(w, i, -dy * side, dx * side, 0.4);
  }
  if (clear && ready) {
    m.state[i] = MSTATE.cast;
    m.stateTime[i] = WEAVER.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
    faceTarget(w, i, t);
  }
}

/**
 * The wisp's burst: when its pulse telegraph resolves (the core has just chilled everyone in the ring and
 * frozen everyone in its inner 40%), the shard flies apart — 'burst' at the ring, then the wisp dies. The
 * death is credited (to nobody), so a shattered wisp still drops its loot and grants XP like a kill: the
 * Ossuary gives the same loot per monster as every other map. A wisp killed during its pulse takes the
 * telegraph with it (removeOwnedAreas): no burst.
 *
 * api.ts offers no way for a monster to remove itself, so this is the one place the roster reaches into the
 * core (combat.ts killMonster) — the same call the director uses when the boss falls.
 */
const WISP_SHATTER = registerAreaEffect({
  onResolve(w: World, a: Area): void {
    const m = w.monsters;
    const slot = a.owner >= 0 ? m.slotOf(a.owner) : -1;
    if (slot < 0) return;
    attackEvent(w, slot, 'burst', a.x, a.y);
    killMonster(w, slot, DAMAGE_INDEX.cold, true, 0);
  },
});

/**
 * Glacial Wisp: a floating ice shard. It weaves in like a skitter; within rushing range it streaks straight
 * at its player; next to them it stops and pulses for 0.7 s (a wispBurst ring: chill in the ring, freeze in
 * its inner 40% — the point blank a player has 0.7 s to step out of) and shatters in the burst.
 */
export function brainWisp(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  if (m.state[i] === MSTATE.windup) {
    // Pulsing: it holds still until the burst shatters it (WISP_SHATTER). Should the pulse vanish without
    // resolving (the map was cleared under it), it drifts on after a moment.
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      toChase(w, i);
      m.attackCd[i] = 1;
    }
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  const ready = m.attackCd[i] <= 0;
  if (ready && d <= m.radius[i] + PLAYER_RADIUS + WISP.trigger) {
    spawnArea(w, 'wispBurst', m.x[i], m.y[i], WISP.radius, WISP.pulse, {
      damage: monsterDamage(w, i) * WISP.mult, dtype: DAMAGE_INDEX.cold, hurts: 'player', owner: m.id[i], effect: WISP_SHATTER,
    });
    attackEvent(w, i, 'pulse');
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = WISP.pulse + 0.25;
    setAnim(w, i, ANIM.windup);
    faceTarget(w, i, t);
    stop(w, i);
    return;
  }
  if (ready && d < WISP.rushRange) {
    moveAlong(w, i, dx, dy, WISP.rush);
    return;
  }
  const a = Math.atan2(dy, dx) + Math.sin(w.time * WISP.weaveFreq + m.phase[i]) * WISP.weaveAmp * (d > 60 ? 1 : 0.3);
  const v = m.speed[i];
  m.vx[i] = Math.cos(a) * v;
  m.vy[i] = Math.sin(a) * v;
}
