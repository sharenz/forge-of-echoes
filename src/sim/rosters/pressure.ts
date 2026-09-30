// Anti-kiting pressure for the regular roster (tuning-level, no new archetypes). Two reusable pieces:
//
//   gapLeap(base, cfg)       wraps a melee brain: at mid range a short, telegraphed leap onto where its player
//                            will be (windup crouch + a leapWarning disc on the landing spot, 0.25 s in the air,
//                            a recovery that is the opening). Reuses the Rift Stalker's leap (state, anim, area).
//   dropMarker(w, i, t, cfg) for artillery: a delayed ground marker on the player's *predicted* position (an
//                            area, optionally leaving a lingering pool/storm) so walking predictably in a
//                            straight line or circle, or standing still on the spot, is punished.
//
// Every strength is a [tier-1 map, full ramp] pair (behaviour.ts byLevel, the projectile tier ramp): tier 1 is
// rare, slow and weak (close to no pressure at all), the full ramp is frequent, quick and predictive.
//
// Fairness: nothing starts on a held player (rooted, frozen, dragged: `isHeld`), the landing / marker is drawn
// for its whole windup and both are dodgeable by changing direction, they carry no debuff of their own unless
// the area kind's visible rider is asked for, and every roll is the world rng (deterministic).
//
// Per-monster memory: timerD = sim time before which the monster may not start another one (0 = not armed
// yet: the first eligible tick arms it with a random delay, so a pack that arrives together doesn't leap or
// mark in unison). The leap uses MSTATE.charge for its windup and MSTATE.leap for the flight; the landing hands
// over to the wrapped brain's MSTATE.attack (all kit and hand-written melee brains end that state with toChase).
import type { PlayerDebuff } from '../../contracts/bestiary';
import type { AreaKind } from '../../contracts/sim';
import {
  DT, MFLAG, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, attackEvent, byLevel, empowerMult, faceTarget, hasDebuff, registerAreaEffect, removeOwnedAreas,
  setAnim, spawnArea, stop, toChase, type Area, type AreaOptions, type PlayerState, type World,
} from './api';
import type { Brain } from './types';

/** [tier-1 map, full ramp]. */
type Pair = readonly [number, number];

/** A player who can't dodge: rooted, frozen or being dragged. Nothing here telegraphs on one. */
export function isHeld(p: PlayerState): boolean {
  return p.pullTime > 0 || hasDebuff(p, 'rooted') || hasDebuff(p, 'frozen');
}

/** Seconds in the air (the presenter's default leap arc, src/present/bestiary.ts DEFAULT_LEAP). */
export const GAP_LEAP_FLIGHT = 0.25;

export interface GapLeapConfig {
  /** Leaps only from at least this centre distance (closer, the plain melee does the work)… */
  minRange: number;
  /** …and up to this far away (tier 1 to full ramp). */
  maxRange: Pair;
  /** Seconds between leaps (plus 0..jitter), and the random head start of a monster's first one (0..cooldown × 0.6). */
  cooldown: Pair;
  jitter: number;
  /** The visible crouch + landing telegraph before the flight. */
  windup: Pair;
  /** The opening after landing. */
  recover: Pair;
  /** Furthest it covers in one leap (units). */
  hop: Pair;
  /** Share (0..1) of the player's walk over windup + flight the landing spot leads by: 0 = where they stand now. */
  aim: Pair;
  /** Landing disc radius and damage (multiples of the monster's scaled damage). */
  radius: number;
  mult: Pair;
  /** A brain with a better opener at this moment (a hook about to fly) says so: no leap starts while it returns true. */
  skip?: (w: World, i: number, d: number) => boolean;
}

/**
 * The leap wrapped round `base` (a melee brain). While the leap's states are running it owns the monster; in
 * every other tick `base` runs, except on the tick a leap starts.
 */
export function gapLeap(base: Brain, cfg: GapLeapConfig): Brain {
  const farthest = Math.max(cfg.maxRange[0], cfg.maxRange[1]);
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    const st = m.state[i];
    if (st === MSTATE.charge) {
      stop(w, i);
      if (!t) {
        removeOwnedAreas(w, m.id[i]);
        toChase(w, i);
        return;
      }
      m.facing[i] = m.tx[i] >= m.x[i] ? 1 : -1;
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        m.state[i] = MSTATE.leap;
        m.stateTime[i] = GAP_LEAP_FLIGHT;
        m.sx[i] = m.x[i];
        m.sy[i] = m.y[i];
        m.flags[i] |= MFLAG.unpushable;
        setAnim(w, i, ANIM.leap);
        attackEvent(w, i, 'leap');
      }
      return;
    }
    if (st === MSTATE.leap) {
      stop(w, i);
      m.stateTime[i] -= DT;
      const u = Math.min(1, 1 - m.stateTime[i] / GAP_LEAP_FLIGHT);
      m.x[i] = m.sx[i] + (m.tx[i] - m.sx[i]) * u;
      m.y[i] = m.sy[i] + (m.ty[i] - m.sy[i]) * u;
      if (m.stateTime[i] <= 0) {
        m.flags[i] &= ~MFLAG.unpushable;
        m.state[i] = MSTATE.attack; // the wrapped brain plays the recovery out and returns to the chase
        m.stateTime[i] = byLevel(w, cfg.recover);
        setAnim(w, i, ANIM.attack);
      }
      return;
    }
    if (st === MSTATE.chase && hunting && t && d >= cfg.minRange && d < farthest && d < byLevel(w, cfg.maxRange)) {
      const cd = byLevel(w, cfg.cooldown);
      if (m.timerD[i] === 0) m.timerD[i] = w.time + w.worldRng.range(0, cd * 0.6);
      else if (w.time >= m.timerD[i] && !isHeld(t) && !(cfg.skip && cfg.skip(w, i, d))) {
        startLeap(w, i, t, cfg, cd);
        return;
      }
    }
    base(w, i, t, dx, dy, d, hunting);
  };
}

function startLeap(w: World, i: number, t: PlayerState, cfg: GapLeapConfig, cd: number): void {
  const m = w.monsters;
  const windup = byLevel(w, cfg.windup);
  const lead = (windup + GAP_LEAP_FLIGHT) * byLevel(w, cfg.aim);
  // Land where the player will be if they keep walking as they are, at most `hop` away, inside the arena.
  // Its own spot on the ring round them (like steer's personal offset), so a pack lands around a player, not in a pile.
  const ring = m.radius[i] + PLAYER_RADIUS + 2;
  let ex = t.x + t.vx * lead + Math.cos(m.offsetAngle[i]) * ring - m.x[i];
  let ey = t.y + t.vy * lead + Math.sin(m.offsetAngle[i]) * ring - m.y[i];
  const hop = byLevel(w, cfg.hop);
  const el = Math.hypot(ex, ey);
  if (el > hop) {
    ex *= hop / el;
    ey *= hop / el;
  }
  let tx = m.x[i] + ex;
  let ty = m.y[i] + ey;
  const lim = w.arenaRadius - m.radius[i];
  const tl = Math.hypot(tx, ty);
  if (tl > lim) {
    tx *= lim / tl;
    ty *= lim / tl;
  }
  m.tx[i] = tx;
  m.ty[i] = ty;
  spawnArea(w, 'leapWarning', tx, ty, cfg.radius, windup + GAP_LEAP_FLIGHT, {
    damage: m.damage[i] * byLevel(w, cfg.mult) * empowerMult(w, i), dtype: m.dtype[i], hurts: 'player', owner: m.id[i], debuff: null,
  });
  m.state[i] = MSTATE.charge;
  m.stateTime[i] = windup;
  m.timerD[i] = w.time + cd + w.worldRng.range(0, cfg.jitter);
  setAnim(w, i, ANIM.windup);
  faceTarget(w, i, t);
  stop(w, i);
}

// --- predictive ground markers -----------------------------------------------------------------------------

export interface MarkerConfig {
  /** The telegraph disc (a slam / eruption / frost nova warning …): it resolves after `delay`. */
  kind: AreaKind;
  radius: number;
  /** Seconds from drop to resolve (tier 1 to full ramp). */
  delay: Pair;
  /** Seconds between drops per monster (plus 0..jitter), and a random head start on the first (0..cooldown × 0.6). */
  cooldown: Pair;
  jitter: number;
  /** Share (0..1) of the player's walk over `delay` the marker leads by: 0 = where they stand, 1 = the full intercept. */
  lead: Pair;
  /** Damage (multiple of the monster's scaled damage). */
  mult: Pair;
  /** null = no rider (default: the kind's visible rider). */
  debuff?: PlayerDebuff | null;
  /**
   * Ground left where the marker resolved, ticking every 0.5 s for `duration` s at `mult` × the marker's damage
   * (tier 1 to full ramp): a 'firePool' (the core's own pool: burning) or a 'blizzard' (a stationary storm: chills).
   */
  linger?: { kind: 'firePool' | 'blizzard'; mult: Pair; duration: Pair };
  /** Another marker of this kind within this distance of the drop point suppresses it (no stacked carpets). */
  spacing: number;
}

/**
 * A dropper for `cfg`: `(w, i, t)` drops a marker for monster `i` on its player `t` if its timer allows (call it
 * at the release of an attack) and returns whether one was dropped. Skips a held player and a spot another marker
 * of the kind already covers. Build it once, at module load (a lingering storm registers an area effect).
 */
export function markerDropper(cfg: MarkerConfig): (w: World, i: number, t: PlayerState) => boolean {
  const linger = cfg.linger;
  const storm =
    linger && linger.kind === 'blizzard'
      ? registerAreaEffect({
          onResolve(w: World, a: Area): void {
            spawnArea(w, 'blizzard', a.x, a.y, a.radius * 0.85, byLevel(w, linger.duration), {
              damage: a.damage * byLevel(w, linger.mult), dtype: a.dtype, hurts: 'player', tickInterval: 0.5, firstTick: 0.25, owner: a.owner,
            });
          },
        })
      : 0;
  return (w, i, t) => {
    const m = w.monsters;
    const cd = byLevel(w, cfg.cooldown);
    if (m.timerD[i] === 0) m.timerD[i] = w.time + w.worldRng.range(0, cd * 0.6);
    if (w.time < m.timerD[i] || isHeld(t)) return false;
    const delay = byLevel(w, cfg.delay);
    const lead = delay * byLevel(w, cfg.lead);
    let x = t.x + t.vx * lead;
    let y = t.y + t.vy * lead;
    const lim = w.arenaRadius - cfg.radius * 0.5;
    const l = Math.hypot(x, y);
    if (l > lim) {
      x *= lim / l;
      y *= lim / l;
    }
    const areas = w.areas;
    const s2 = cfg.spacing * cfg.spacing;
    for (let k = 0; k < areas.length; k++) {
      const a = areas[k];
      if (a.dead || a.kind !== cfg.kind) continue;
      const ax = a.x - x;
      const ay = a.y - y;
      if (ax * ax + ay * ay < s2) return false;
    }
    m.timerD[i] = w.time + cd + w.worldRng.range(0, cfg.jitter);
    const damage = m.damage[i] * byLevel(w, cfg.mult) * empowerMult(w, i);
    const opts: AreaOptions = { damage, dtype: m.dtype[i], hurts: 'player', owner: m.id[i], debuff: cfg.debuff };
    if (linger) {
      if (linger.kind === 'firePool') {
        opts.poolDuration = byLevel(w, linger.duration);
        opts.poolDamage = damage * byLevel(w, linger.mult);
      } else opts.effect = storm;
    }
    spawnArea(w, cfg.kind, x, y, cfg.radius, delay, opts);
    return true;
  };
}
