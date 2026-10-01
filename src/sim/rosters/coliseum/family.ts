// Iron Coliseum regular monsters (GAME_SPEC §14): Pit Hound, Chain Thrall, Iron Crossbowman and Shieldbearer
// (hand-written brains below) and the Tar Slinger (the kit's shooterBrain, tuned, behind a little discipline so
// a late wave stays readable).
//
// State use (MSTATE / anim):
//   Pit Hound         chase (prowl) → windup (crouch, ANIM.windup) → charge (pounce, ANIM.attack) → attack (bite
//                     pose) → chase. The bite is its only damage: a melee hit that bleeds.
//   Chain Thrall      chase → cast (hook whirling overhead, ANIM.windup) → attack (throw pose; 'hook') → chase;
//                     in reach: windup (0.2 s) → attack (rake). timerA: rake cooldown, timerB: the rush after a
//                     hook connected (set by the hook's projectile effect).
//   Iron Crossbowman  chase → cast (aiming: its locked aim lines on the ground, 'aim') → attack ('bolt') → chase.
//   Shieldbearer      chase (guarding, the core turns the shield) → windup (shield hauled back: guard DOWN) →
//                     attack (the bash, 'bash'; guard still down) → chase (guard up).
//   Tar Slinger       the kit's shooterBrain (cast = loading the sling). Before a throw may start, the
//                     discipline check below can push its cooldown back a moment.
import { MONSTER_KINDS } from '../../../contracts/content';
import { shooterBrain } from '../kit';
import {
  DAMAGE_INDEX, DT, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, PROJ, areaAngle, areaVariant, attackEvent, extraProjectiles, faceTarget,
  aimAtPlayer, byLevel, fireHostile, fireHostileFrom, knockPlayer, meleeHit, monsterDamage, moveAlong, muzzleOffset, quantizeAreaAngle, registerProjectileEffect,
  setAnim, setGuard, setProjectileEffect, spawnArea, steer, stop, toChase, wander, type Brain, type PlayerState, type World,
  shotClear, coverClip,
} from '../api';
import { gapLeap } from '../pressure';
import { CROSSBOW, HOUND, SHIELD, TAR, THRALL, THRALL_LEAP } from './tuning';

const CROSSBOWMAN = MONSTER_KINDS.indexOf('ironCrossbowman');
const TAR_SLINGER = MONSTER_KINDS.indexOf('tarSlinger');

// --- Pit Hound -------------------------------------------------------------------------------------------

/**
 * Pit Hound (fast): lopes at its prey (slower than a player), circles it while its bite recharges, then
 * crouches for HOUND.crouch s (the tell) and pounces at where its prey stands when the crouch ends — about
 * 44 units along that line. A player who keeps moving away through the crouch is out of reach when it lands;
 * one who stands still is bitten. A bite that lands bleeds.
 */
export function brainPitHound(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const H = HOUND;
  switch (m.state[i]) {
    case MSTATE.windup: {
      stop(w, i);
      if (!t) {
        toChase(w, i);
        return;
      }
      faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] > 0) return;
      // Spring at where the prey is now.
      m.sx[i] = dx / d;
      m.sy[i] = dy / d;
      m.state[i] = MSTATE.charge;
      m.stateTime[i] = H.lungeTime;
      m.timerA[i] = 0;
      setAnim(w, i, ANIM.attack);
      pounce(w, i, t, d);
      return;
    }
    case MSTATE.charge:
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        stop(w, i);
        m.state[i] = MSTATE.attack;
        m.stateTime[i] = H.recover;
        m.attackCd[i] = H.cooldown + w.worldRng.range(0, H.jitter);
        return;
      }
      pounce(w, i, t, d);
      return;
    case MSTATE.attack:
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) toChase(w, i);
      return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  const touch = m.radius[i] + PLAYER_RADIUS;
  if (m.attackCd[i] <= 0) {
    if (d <= touch + H.pounceReach) {
      m.state[i] = MSTATE.windup;
      m.stateTime[i] = H.crouch;
      setAnim(w, i, ANIM.windup);
      stop(w, i);
      faceTarget(w, i, t);
      return;
    }
    steer(w, i, dx, dy, d, 1);
    return;
  }
  if (d < H.prowlRange) {
    // Circle the prey (each hound its own way round), drifting out when pressed against it.
    const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
    const radial = d < H.prowlRange * 0.6 ? -0.7 : 0.1;
    moveAlong(w, i, (-dy * side) / d + (dx / d) * radial, (dx * side) / d + (dy / d) * radial, H.prowlSpeed);
    return;
  }
  steer(w, i, dx, dy, d, 1);
}

/** One tick of the pounce along its locked line; the first contact bites (bleeding). */
function pounce(w: World, i: number, t: PlayerState | null, d: number): void {
  const m = w.monsters;
  m.vx[i] = m.sx[i] * HOUND.lungeSpeed;
  m.vy[i] = m.sy[i] * HOUND.lungeSpeed;
  if (m.timerA[i] !== 0 || !t || d > m.radius[i] + PLAYER_RADIUS + HOUND.biteReach) return;
  m.timerA[i] = 1;
  meleeHit(w, i, t, 1, 'bleeding');
}

// --- Chain Thrall ----------------------------------------------------------------------------------------

/** Handle of the thrall hook's effect (registered once, by coliseumRoster: see registerFamilyEffects). */
let reelIn = 0;

/**
 * Register the family's projectile effect — a thrall's hook that connects sends it rushing its (now rooted)
 * victim. Called when the roster table is built (after every sim module has loaded); idempotent.
 */
export function registerFamilyEffects(): void {
  if (reelIn !== 0) return;
  reelIn = registerProjectileEffect({
    onHit(w, slot) {
      const m = w.monsters;
      const j = m.slotOf(w.projectiles.src[slot]);
      if (j >= 0) m.timerB[j] = THRALL.reelTime;
    },
  });
}

/**
 * Chain Thrall (hunter): closes in on its prey; between THRALL.hookMin and hookMax with its hook ready, it
 * whirls the hook overhead (the windup pose, THRALL.windup s) and throws it at where the prey stands — a
 * visible chainHook (sidestep it) that drags its victim 40 units toward the thrall and roots them. A hook
 * that connects sends the thrall rushing in; up close it rakes with the hook (a plain hit, no root).
 */
function hookAndRake(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const T = THRALL;
  if (m.timerA[i] > 0) m.timerA[i] -= DT;
  if (m.timerB[i] > 0) m.timerB[i] -= DT;
  switch (m.state[i]) {
    case MSTATE.cast: {
      stop(w, i);
      if (!t) {
        toChase(w, i);
        return;
      }
      faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] > 0) return;
      const slot = fireHostile(
        w, i, PROJ.chainHook, Math.atan2(dy, dx), T.hookSpeed, Math.min(T.hookRange, d + 40), T.hookRadius,
        monsterDamage(w, i) * T.hookMult, DAMAGE_INDEX.physical,
      );
      setProjectileEffect(w, slot, reelIn);
      attackEvent(w, i, 'hook');
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = T.throwPose;
      setAnim(w, i, ANIM.attack);
      m.attackCd[i] = T.cooldown + w.worldRng.range(0, T.jitter);
      return;
    }
    case MSTATE.windup: {
      stop(w, i);
      if (!t) {
        toChase(w, i);
        return;
      }
      faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] > 0) return;
      if (d <= m.radius[i] + PLAYER_RADIUS + T.rakeReach + 4) meleeHit(w, i, t, T.rakeMult);
      m.timerA[i] = T.rakeCooldown;
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = T.rakePose;
      setAnim(w, i, ANIM.attack);
      return;
    }
    case MSTATE.attack:
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) toChase(w, i);
      return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  if (d <= m.radius[i] + PLAYER_RADIUS + T.rakeReach) {
    stop(w, i);
    faceTarget(w, i, t);
    if (m.timerA[i] <= 0) {
      m.state[i] = MSTATE.windup;
      m.stateTime[i] = T.rakeWindup;
      setAnim(w, i, ANIM.windup);
    }
    return;
  }
  if (m.attackCd[i] <= 0 && d >= T.hookMin && d <= T.hookMax && shotClear(w, i, t.x, t.y, T.hookRadius)) {
    m.state[i] = MSTATE.cast;
    m.stateTime[i] = T.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
    faceTarget(w, i, t);
    return;
  }
  steer(w, i, dx, dy, d, m.timerB[i] > 0 ? T.reelSpeed : 1);
}

/**
 * Chain Thrall with its gap-closing leap (THRALL_LEAP). The hook and the reel-in stay its openers: no leap starts while
 * a hook is ready and in range, or while it is rushing a hooked victim.
 */
export const brainChainThrall: Brain = gapLeap(hookAndRake, {
  ...THRALL_LEAP,
  skip: (w, i, d) => {
    const m = w.monsters;
    return m.timerB[i] > 0 || (m.attackCd[i] <= 0 && d >= THRALL.hookMin && d <= THRALL.hookMax);
  },
});

// --- Iron Crossbowman ------------------------------------------------------------------------------------

/**
 * Iron Crossbowman (artillery): keeps CROSSBOW.near–far away; aims for 0.6 s along a locked laser line
 * (chargeLine variant 0, 'aim'), then looses a fast bolt exactly along it ('bolt'; crossbowBolt bleeds).
 * Extra bolts (the Splitting map mod) fan out to one side of the aimed one — each with its own aim line,
 * drawn for the whole windup, so every bolt flies where a line was shown and standing still on the aimed
 * line is still hit.
 * Volley discipline: while CROSSBOW.maxAimers crossbowmen already aim at its target, it waits a moment —
 * a late wave's crossbowmen take turns instead of drawing a curtain of lines nobody could read.
 *
 * State: cast = aiming (m.sx: the aimed line's quantised heading, m.sy: bolts in the volley, m.tx / m.ty:
 * the lines' common start at the muzzle) → attack (release pose) → chase.
 */
export function brainCrossbowman(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const C = CROSSBOW;
  switch (m.state[i]) {
    case MSTATE.cast:
      stop(w, i);
      m.facing[i] = Math.cos(m.sx[i]) >= 0 ? 1 : -1;
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) loose(w, i);
      return;
    case MSTATE.attack:
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) toChase(w, i);
      return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  // Tall cover between it and its target: it holds fire and closes in (the nav field routes it round) until the line opens.
  const ready = m.attackCd[i] <= 0 && d < C.fireRange;
  const clear = !ready || shotClear(w, i, t.x, t.y, C.boltRadius);
  if (!clear) steer(w, i, dx, dy, d, 1);
  else if (d < C.near) moveAlong(w, i, -dx, -dy, 1);
  else if (d > C.far) steer(w, i, dx, dy, d, 1);
  else {
    const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
    moveAlong(w, i, -dy * side, dx * side, 0.4);
  }
  if (!ready || !clear) return;
  if (aimersAt(w, t.id) >= C.maxAimers) {
    m.attackCd[i] = w.worldRng.range(C.hold * 0.5, C.hold);
    return;
  }
  // Aim: lock the (id-quantised) heading and the muzzle point, and draw one line per bolt. The locked line itself must reach the
  // target: a heading that runs into a wall first (a lead round a corner) is no aim at all, so no line is drawn and no bolt flies.
  const a = quantizeAreaAngle(aimAtPlayer(w, i, t, C.boltSpeed, C.boltRange, byLevel(w, C.aim), C.fallbackLead));
  const off = muzzleOffset(w, i);
  if (coverClip(w, m.x[i] + Math.cos(a) * off, m.y[i] + Math.sin(a) * off, a, d, C.boltRadius * 0.5) < d - 2) {
    steer(w, i, dx, dy, d, 1);
    return;
  }
  m.state[i] = MSTATE.cast;
  m.stateTime[i] = C.windup;
  setAnim(w, i, ANIM.windup);
  stop(w, i);
  faceTarget(w, i, t);
  attackEvent(w, i, 'aim');
  m.sx[i] = a;
  m.sy[i] = 1 + extraProjectiles(w);
  m.tx[i] = m.x[i] + Math.cos(a) * off;
  m.ty[i] = m.y[i] + Math.sin(a) * off;
  // Shown until the release tick itself (+ DT): each bolt leaves while its line is still on the ground.
  for (let k = 0; k < m.sy[i]; k++) {
    // The line stops where a wall would stop the bolt: it never shows through cover.
    const lineAngle = boltAngle(w, i, k);
    spawnArea(w, 'chargeLine', m.tx[i], m.ty[i], coverClip(w, m.tx[i], m.ty[i], lineAngle, C.boltRange, C.boltRadius * 0.5), C.windup + DT, {
      angle: lineAngle, variant: 0, owner: m.id[i], hurts: 'none', debuff: null,
    });
  }
}

/**
 * Heading of bolt `k` of monster `i`'s volley: 0 is the aimed line, the extras alternate out to its side
 * (1: one spread over, 2: one spread the other way, …), the side personal to the crossbowman. Computed from
 * the stored (Float32) heading both when the lines are drawn and when the bolts fly, so they are identical.
 */
function boltAngle(w: World, i: number, k: number): number {
  const m = w.monsters;
  if (k === 0) return quantizeAreaAngle(m.sx[i]);
  const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
  const step = Math.ceil(k / 2) * (k % 2 === 1 ? side : -side);
  return quantizeAreaAngle(m.sx[i] + step * CROSSBOW.spread);
}

/** Release: every bolt of the volley from the lines' start, exactly along its line ('bolt'). */
function loose(w: World, i: number): void {
  const m = w.monsters;
  const C = CROSSBOW;
  const dmg = monsterDamage(w, i);
  for (let k = 0; k < m.sy[i]; k++) {
    fireHostileFrom(w, i, PROJ.crossbowBolt, m.tx[i], m.ty[i], boltAngle(w, i, k), C.boltSpeed, C.boltRange, C.boltRadius, dmg, m.dtype[i]);
  }
  attackEvent(w, i, 'bolt');
  setAnim(w, i, ANIM.attack);
  m.state[i] = MSTATE.attack;
  m.stateTime[i] = 0.25;
  m.attackCd[i] = C.cooldown + w.worldRng.range(0, C.jitter);
}

/**
 * Crossbowmen aiming at player `id` right now — each counted once, by its aimed line (a Splitting volley
 * draws several).
 */
function aimersAt(w: World, id: number): number {
  const m = w.monsters;
  const areas = w.areas;
  let n = 0;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.dead || a.kind !== 'chargeLine' || a.owner < 0 || areaVariant(a) !== 0) continue;
    const j = m.slotOf(a.owner);
    if (j >= 0 && m.kind[j] === CROSSBOWMAN && m.target[j] === id && areaAngle(a) === quantizeAreaAngle(m.sx[j])) n++;
  }
  return n;
}

// --- Shieldbearer ----------------------------------------------------------------------------------------

/**
 * Shieldbearer (bruiser): advances behind its tower shield (MonsterDef.block: player projectiles into its 120°
 * front are blocked; the core turns the shield toward its target at SHIELD.turnRate). It pivots slowly when
 * its target gets round its side. A target in front and in reach is bashed: the shield is hauled back
 * (SHIELD.windup, guard DOWN — the opening), then driven forward along the heading it had ('bash'): a hit
 * with knockback on a player still in front of it. The guard comes back up after the recovery.
 */
export function brainShieldbearer(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const S = SHIELD;
  const ux = Math.cos(m.aim[i]);
  const uy = Math.sin(m.aim[i]);
  switch (m.state[i]) {
    case MSTATE.windup: {
      stop(w, i);
      m.facing[i] = ux >= 0 ? 1 : -1;
      m.stateTime[i] -= DT;
      if (m.stateTime[i] > 0) return;
      m.kbX[i] += ux * S.lunge;
      m.kbY[i] += uy * S.lunge;
      attackEvent(w, i, 'bash');
      if (t && d <= m.radius[i] + PLAYER_RADIUS + S.bashReach + 4 && dx * ux + dy * uy >= S.frontCos * d) {
        if (meleeHit(w, i, t, S.mult) >= 0) knockPlayer(w, t, ux, uy, S.knockback);
      }
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = S.recover;
      setAnim(w, i, ANIM.attack);
      m.attackCd[i] = S.cooldown;
      return;
    }
    case MSTATE.attack:
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        setGuard(w, i, true);
        toChase(w, i);
      }
      return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  const inFront = dx * ux + dy * uy >= S.frontCos * d;
  steer(w, i, dx, dy, d, inFront ? 1 : S.flankSpeed);
  if (inFront && m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + S.bashReach) {
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = S.windup;
    setAnim(w, i, ANIM.windup);
    setGuard(w, i, false);
    stop(w, i);
  }
}

// --- Tar Slinger -----------------------------------------------------------------------------------------

/**
 * Tar Slinger (support): keeps TAR.near–far away and lobs a tar glob ('tar') where its target will be
 * TAR.lead s later. The lob flies TAR.flight s (the presenter draws its arc and landing ring) and leaves a
 * tarPool where it lands: 50% slow inside, a root (source 'tar') on first contact. It doesn't waste tar and
 * doesn't carpet the floor: while that spot is already tarred, or TAR.maxNear pools (lying or on their way)
 * are already round its target, it holds its throw a moment.
 */
export function tarSlingerBrain(): Brain {
  const sling = shooterBrain({
    near: TAR.near, far: TAR.far, fireRange: TAR.fireRange, windup: TAR.windup, cooldown: TAR.cooldown, jitter: TAR.jitter,
    projectile: 'tarGlob', speed: 0, range: TAR.range, radius: TAR.radius, flight: TAR.flight, splash: TAR.splash, mult: TAR.mult,
    lead: TAR.lead, attack: 'tar',
  });
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    if (
      t && hunting && m.state[i] === MSTATE.chase && m.attackCd[i] <= 0 && d < TAR.fireRange &&
      (tarred(w, t.x + t.vx * TAR.lead, t.y + t.vy * TAR.lead, TAR.tarredRadius) ||
        tarAround(w, t.x, t.y, TAR.crowdRadius) + slingingAt(w, t) >= TAR.maxNear)
    ) {
      m.attackCd[i] = w.worldRng.range(TAR.hold * 0.5, TAR.hold);
    }
    sling(w, i, t, dx, dy, d, hunting);
  };
}

/** Whether a tar pool already covers (x, y) (within `pad` of its edge). */
function tarred(w: World, x: number, y: number, pad: number): boolean {
  const areas = w.areas;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.dead || a.kind !== 'tarPool') continue;
    const dx = x - a.x;
    const dy = y - a.y;
    const r = a.radius + pad;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/**
 * Tar Slingers loading a throw at player `t` right now (their tar isn't in the air yet). Only asked when a
 * slinger is about to throw: a grid query round the target, as far as a slinger throws.
 */
function slingingAt(w: World, t: PlayerState): number {
  const m = w.monsters;
  const r = TAR.fireRange;
  const cand = w.scratch2;
  const n = w.grid.query(t.x - r, t.y - r, t.x + r, t.y + r, cand);
  let c = 0;
  for (let k = 0; k < n; k++) {
    const j = cand[k];
    if (m.alive[j] && m.kind[j] === TAR_SLINGER && m.state[j] === MSTATE.cast && m.target[j] === t.id) c++;
  }
  return c;
}

/** Tar pools centred within `r` of (x, y): those lying there and the globs in flight that will land there. */
function tarAround(w: World, x: number, y: number, r: number): number {
  const r2 = r * r;
  let n = 0;
  const areas = w.areas;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.dead || a.kind !== 'tarPool') continue;
    const dx = a.x - x;
    const dy = a.y - y;
    if (dx * dx + dy * dy <= r2) n++;
  }
  const pr = w.projectiles;
  for (let k = 0; k < pr.hwm; k++) {
    if (!pr.alive[k] || !pr.hostile[k] || pr.kind[k] !== PROJ.tarGlob) continue;
    // A lob lands where it is heading at age == life (its total flight).
    const left = Math.max(0, pr.life[k] - pr.age[k]);
    const dx = pr.x[k] + pr.vx[k] * left - x;
    const dy = pr.y[k] + pr.vy[k] * left - y;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return n;
}
