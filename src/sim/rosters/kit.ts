// Reusable brains for rosters (see ./index.ts). Each factory returns a Brain closed over its config;
// nothing allocates per tick. They are the building blocks of the skeleton rosters and are meant to be
// reused, wrapped or replaced by the roster specialists.
//
//   meleeBrain      walk up, wind up, strike (lunge, knockback, debuff rider, optional shield drop)
//   skirmishBrain   fast zig-zag biter without windup (Ember Skitter style)
//   shooterBrain    keep a distance band, wind up, fire flat shots or lobs (optional honest aim line,
//                   optional point-blank strike)
//   slamBrain       telegraphed ground slam in front of the body (any area kind, debuff rider)
//   pulseBrain      rush in, stop, pulse a telegraph around itself, burst
//   commanderBrain  lieutenants / bosses: keep a distance band, a prioritised list of timed actions
//                   (cast → release → optional channel such as a dash or a whirl), optional melee, an
//                   empowering aura (speed + damage) and/or a haste aura (speed only). Timers live in
//                   memoryOf() (per run, per monster).
//   empowerAround / hasteAround   the two auras, for hand-written brains
import type { PlayerDebuff } from '../../contracts/bestiary';
import type { DamageType } from '../../contracts/content';
import type { AreaKind, ProjectileKind, RootSource } from '../../contracts/sim';
import {
  DAMAGE_INDEX, DT, aimAtPlayer, byLevel, levelExtraShots, MFLAG, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, PROJ, attackEvent, extraProjectiles, faceTarget, fireHostile,
  fireHostileFrom, knockPlayer, lobAt, meleeHit, memoryOf, monsterDamage, moveAlong, muzzleOffset, phaseOf, quantizeAreaAngle, setAnim,
  setGuard, setProjectileDebuff, shotClear, coverClip,
  setProjectileEffect, setProjectilePull, setProjectileSplash, spawnArea, steer, stop, toChase, wander, type MonsterAttack,
  type PlayerState, type World,
} from './api';
import type { Brain } from './types';

// --- melee -----------------------------------------------------------------------------------------------

export interface StrikeConfig {
  /** Extra reach beyond touching (units). */
  reach: number;
  /** Seconds of windup pose before the strike. */
  windup: number;
  /** Seconds of attack pose after the strike. */
  recover: number;
  /** Seconds between strikes. */
  cooldown: number;
  /** Damage multiplier of the strike (default 1). */
  mult?: number;
  /** Debuff the strike applies when it connects. */
  debuff?: PlayerDebuff | null;
  rootSource?: RootSource;
  /** Units the strike carries the monster forward. */
  lunge?: number;
  /** Units a connecting strike shoves the player back. */
  knockback?: number;
  /** An extra 'monsterAttack' cue on the strike ('bash', 'melee'…); meleeHit always sends a low-priority 'melee'. */
  attack?: MonsterAttack;
  /** A shield-bearer lowers its guard from the windup until it has recovered (the opening). */
  dropGuard?: boolean;
}

/** Walk at the target; in reach, wind up, then strike once. */
export function meleeBrain(cfg: StrikeConfig): Brain {
  const mult = cfg.mult ?? 1;
  const debuff = cfg.debuff ?? null;
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    const st = m.state[i];
    if (st === MSTATE.windup) {
      stop(w, i);
      if (!t) {
        endStrike(w, i, cfg);
        return;
      }
      faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        m.state[i] = MSTATE.attack;
        m.stateTime[i] = cfg.recover;
        setAnim(w, i, ANIM.attack);
        if (cfg.lunge) {
          m.kbX[i] += (dx / d) * cfg.lunge;
          m.kbY[i] += (dy / d) * cfg.lunge;
        }
        if (cfg.attack) attackEvent(w, i, cfg.attack);
        if (d <= m.radius[i] + PLAYER_RADIUS + cfg.reach + 4) {
          const r = meleeHit(w, i, t, mult, debuff, cfg.rootSource);
          if (r >= 0 && cfg.knockback) knockPlayer(w, t, dx, dy, cfg.knockback);
        }
        m.attackCd[i] = cfg.cooldown;
      }
      return;
    }
    if (st === MSTATE.attack) {
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) endStrike(w, i, cfg);
      return;
    }
    if (!hunting) {
      wander(w, i);
      return;
    }
    steer(w, i, dx, dy, d, 1);
    if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + cfg.reach) {
      m.state[i] = MSTATE.windup;
      m.stateTime[i] = cfg.windup;
      setAnim(w, i, ANIM.windup);
      if (cfg.dropGuard) setGuard(w, i, false);
      stop(w, i);
    }
  };
}

function endStrike(w: World, i: number, cfg: StrikeConfig): void {
  toChase(w, i);
  if (cfg.dropGuard) setGuard(w, i, true);
}

export interface SkirmishConfig {
  reach: number;
  biteTime: number;
  cooldown: number;
  zigzagFreq: number;
  zigzagAmp: number;
  burstFreq: number;
  mult?: number;
  debuff?: PlayerDebuff | null;
}

/** Fast, zig-zagging in bursts; bites on contact without a windup. */
export function skirmishBrain(cfg: SkirmishConfig): Brain {
  const mult = cfg.mult ?? 1;
  const debuff = cfg.debuff ?? null;
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
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
    const ph = m.phase[i];
    const weave = Math.sin(w.time * cfg.zigzagFreq + ph) * cfg.zigzagAmp * (d > 40 ? 1 : 0.3);
    const burst = 0.55 + 0.9 * Math.max(0, Math.sin(w.time * cfg.burstFreq + ph * 1.7));
    const ang = Math.atan2(dy, dx) + weave;
    const v = m.speed[i] * burst;
    m.vx[i] = Math.cos(ang) * v;
    m.vy[i] = Math.sin(ang) * v;
    if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + cfg.reach) {
      meleeHit(w, i, t, mult, debuff);
      m.attackCd[i] = cfg.cooldown;
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = cfg.biteTime;
      setAnim(w, i, ANIM.attack);
      stop(w, i);
    }
  };
}

// --- ranged ---------------------------------------------------------------------------------------------

export interface ShooterConfig {
  /** Backs off inside `near`, closes in beyond `far`, strafes in between. */
  near: number;
  far: number;
  /** Starts a shot when the target is closer than this. */
  fireRange: number;
  windup: number;
  cooldown: number;
  /** Random extra cooldown (0..jitter s, world rng). */
  jitter?: number;
  projectile: ProjectileKind;
  /** Flat speed, or [tier-1 map, full ramp] (behaviour.ts byLevel). Lobs ignore it (they land after `flight`). */
  speed: number | readonly [number, number];
  range: number;
  radius: number;
  mult?: number;
  /** Damage type (default: the monster's own). */
  dtype?: DamageType;
  /** Shots per volley (+ map-mod extra projectiles), `spread` radians apart. */
  count?: number;
  spread?: number;
  /** Aim where the target will be after this many seconds (partial lead: walking dodges it). Lobs and shots without `aim`. */
  lead?: number;
  /**
   * Flat shots: aim at the intercept of the target's walk instead, this share of the way (0..1, or [tier 1, full ramp]);
   * `lead` (default 0.25 s) is the fallback lead when no intercept lies within range.
   */
  aim?: number | readonly [number, number];
  /** Extra shots per volley at the full ramp (rounded down the ramp), on top of `count`. */
  extraShots?: number;
  /** > 0: a lob that lands on the aim point after this many seconds. */
  flight?: number;
  splash?: number;
  /** Chain hooks: pull distance. */
  pull?: number;
  /** Override the projectile kind's debuff rider (null = none). */
  debuff?: PlayerDebuff | null;
  rootSource?: RootSource;
  /** A registered projectile effect (effects.ts). */
  effect?: number;
  /** Cue on release. */
  attack: MonsterAttack;
  /** Cue when the windup starts (e.g. the crossbow's 'aim'). */
  aimAttack?: MonsterAttack;
  /**
   * Honest aim line: the direction locks when the windup starts and a harmless chargeLine (variant 0)
   * shows it for the whole windup; the shot then leaves from the line's start and flies exactly along
   * it (sidestep to dodge), even if the shooter was shoved meanwhile.
   */
  aimLine?: boolean;
  /** Strikes without windup when the target is in melee reach (a hunter with a thrown weapon). */
  melee?: { reach: number; cooldown: number; mult?: number; debuff?: PlayerDebuff | null };
}

/**
 * Keep a distance band and shoot (flat shots or lobs). With an aim line, the locked angle lives in m.sx
 * and the line's start in m.tx / m.ty during the windup.
 */
export function shooterBrain(cfg: ShooterConfig): Brain {
  const kind = PROJ[cfg.projectile];
  const mult = cfg.mult ?? 1;
  const count = cfg.count ?? 1;
  const spread = cfg.spread ?? 0.15;
  const lead = cfg.lead ?? 0;
  const flight = cfg.flight ?? 0;
  const pick = (v: number | readonly [number, number], w: World): number => (typeof v === 'number' ? v : byLevel(w, v));
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    if (m.state[i] === MSTATE.cast) {
      stop(w, i);
      if (!t) {
        toChase(w, i);
        return;
      }
      if (cfg.aimLine) m.facing[i] = Math.cos(m.sx[i]) >= 0 ? 1 : -1;
      else faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] > 0) return;
      const dtype = cfg.dtype ? DAMAGE_INDEX[cfg.dtype] : m.dtype[i];
      const dmg = monsterDamage(w, i) * mult;
      const n = count + extraProjectiles(w) + (cfg.extraShots ? levelExtraShots(w, cfg.extraShots) : 0);
      const speed = flight > 0 ? 0 : pick(cfg.speed, w);
      let base: number;
      let tx = t.x + t.vx * lead;
      let ty = t.y + t.vy * lead;
      if (cfg.aimLine) {
        base = m.sx[i];
        tx = m.x[i] + Math.cos(base) * cfg.range;
        ty = m.y[i] + Math.sin(base) * cfg.range;
      } else if (cfg.aim !== undefined && flight <= 0) base = aimAtPlayer(w, i, t, speed, cfg.range, pick(cfg.aim, w), cfg.lead ?? 0.25);
      else base = Math.atan2(ty - m.y[i], tx - m.x[i]);
      for (let k = 0; k < n; k++) {
        const a = base + (k - (n - 1) / 2) * spread;
        let slot: number;
        if (flight > 0) {
          const dist = Math.hypot(tx - m.x[i], ty - m.y[i]);
          slot = lobAt(w, i, cfg.projectile, m.x[i] + Math.cos(a) * dist, m.y[i] + Math.sin(a) * dist, flight, cfg.radius, dmg, dtype, cfg.range);
        } else if (cfg.aimLine) slot = fireHostileFrom(w, i, kind, m.tx[i], m.ty[i], a, speed, cfg.range, cfg.radius, dmg, dtype);
        else slot = fireHostile(w, i, kind, a, speed, cfg.range, cfg.radius, dmg, dtype);
        if (slot < 0) continue;
        if (cfg.debuff !== undefined) setProjectileDebuff(w, slot, cfg.debuff, cfg.rootSource);
        if (cfg.effect) setProjectileEffect(w, slot, cfg.effect);
        if (cfg.splash) setProjectileSplash(w, slot, cfg.splash);
        if (cfg.pull) setProjectilePull(w, slot, cfg.pull);
      }
      attackEvent(w, i, cfg.attack);
      setAnim(w, i, ANIM.attack);
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = 0.25;
      m.attackCd[i] = cfg.cooldown + (cfg.jitter ? w.worldRng.range(0, cfg.jitter) : 0);
      return;
    }
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
    if (cfg.melee && d <= m.radius[i] + PLAYER_RADIUS + cfg.melee.reach) {
      stop(w, i);
      faceTarget(w, i, t);
      if (m.timerA[i] > 0) m.timerA[i] -= DT;
      if (m.timerA[i] <= 0) {
        meleeHit(w, i, t, cfg.melee.mult ?? 1, cfg.melee.debuff ?? null);
        m.timerA[i] = cfg.melee.cooldown;
        setAnim(w, i, ANIM.attack);
      }
      return;
    }
    // Tall cover between it and its target: nothing to shoot at, so it holds the volley and closes in (the nav flow field takes
    // it round the wall) until the line opens. Lobs fly over cover and never wait.
    const ready = m.attackCd[i] <= 0 && d < cfg.fireRange;
    const clear = flight > 0 || !ready || shotClear(w, i, t.x, t.y, cfg.radius);
    if (!clear) steer(w, i, dx, dy, d, 1);
    else if (d < cfg.near) moveAlong(w, i, -dx, -dy, 1);
    else if (d > cfg.far) steer(w, i, dx, dy, d, 1);
    else {
      const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
      moveAlong(w, i, -dy * side, dx * side, 0.4);
    }
    if (clear && ready) {
      // Honest aim line: lock the (id-quantised) heading and the muzzle point first; a heading that runs into a wall before it
      // reaches the target is no aim at all (no line, no shot): close in instead.
      let a = 0;
      const off = muzzleOffset(w, i);
      if (cfg.aimLine) {
        const raw = cfg.aim !== undefined && flight <= 0
          ? aimAtPlayer(w, i, t, pick(cfg.speed, w), cfg.range, pick(cfg.aim, w), cfg.lead ?? 0.25)
          : Math.atan2(t.y + t.vy * lead - m.y[i], t.x + t.vx * lead - m.x[i]);
        a = quantizeAreaAngle(raw);
        if (flight <= 0 && coverClip(w, m.x[i] + Math.cos(a) * off, m.y[i] + Math.sin(a) * off, a, d, cfg.radius * 0.5) < d - 2) {
          steer(w, i, dx, dy, d, 1);
          return;
        }
      }
      m.state[i] = MSTATE.cast;
      m.stateTime[i] = cfg.windup;
      setAnim(w, i, ANIM.windup);
      stop(w, i);
      faceTarget(w, i, t);
      if (cfg.aimAttack) attackEvent(w, i, cfg.aimAttack);
      if (cfg.aimLine) {
        m.sx[i] = a;
        m.tx[i] = m.x[i] + Math.cos(a) * off;
        m.ty[i] = m.y[i] + Math.sin(a) * off;
        spawnArea(w, 'chargeLine', m.tx[i], m.ty[i], coverClip(w, m.tx[i], m.ty[i], a, cfg.range, cfg.radius * 0.5), cfg.windup, {
          angle: a, variant: 0, owner: m.id[i], hurts: 'none', debuff: null,
        });
      }
    }
  };
}

// --- ground ---------------------------------------------------------------------------------------------

export interface SlamConfig {
  windup: number;
  radius: number;
  /** Distance from the body's edge to the slam centre. */
  offset: number;
  cooldown: number;
  recover: number;
  mult?: number;
  dtype?: DamageType;
  /** Telegraph kind (default 'slamWarning'). */
  area?: AreaKind;
  /** Rider (default: the area kind's). */
  debuff?: PlayerDebuff | null;
  /** Cue when the slam lands (default 'slam'). */
  attack?: MonsterAttack;
}

/** Telegraphed slam in front of the body when the target is in its reach (Ironhide Brute style). */
export function slamBrain(cfg: SlamConfig): Brain {
  const mult = cfg.mult ?? 1;
  const area = cfg.area ?? 'slamWarning';
  const attack = cfg.attack ?? 'slam';
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    const st = m.state[i];
    if (st === MSTATE.windup) {
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        m.state[i] = MSTATE.attack;
        m.stateTime[i] = cfg.recover;
        setAnim(w, i, ANIM.attack);
        attackEvent(w, i, attack, m.tx[i], m.ty[i]);
      }
      return;
    }
    if (st === MSTATE.attack) {
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        toChase(w, i);
        m.attackCd[i] = cfg.cooldown;
      }
      return;
    }
    if (!hunting) {
      wander(w, i);
      return;
    }
    steer(w, i, dx, dy, d, 1);
    const r = m.radius[i];
    if (m.attackCd[i] <= 0 && d < r + cfg.offset + cfg.radius + PLAYER_RADIUS * 0.5) {
      const cx = m.x[i] + (dx / d) * (r + cfg.offset);
      const cy = m.y[i] + (dy / d) * (r + cfg.offset);
      m.tx[i] = cx;
      m.ty[i] = cy;
      faceTarget(w, i, t);
      spawnArea(w, area, cx, cy, cfg.radius, cfg.windup, {
        damage: monsterDamage(w, i) * mult, dtype: cfg.dtype ? DAMAGE_INDEX[cfg.dtype] : m.dtype[i], hurts: 'player', owner: m.id[i],
        ...(cfg.debuff !== undefined ? { debuff: cfg.debuff } : {}),
      });
      m.state[i] = MSTATE.windup;
      m.stateTime[i] = cfg.windup;
      setAnim(w, i, ANIM.windup);
      stop(w, i);
    }
  };
}

export interface PulseConfig {
  /** Starts pulsing when the target is this close. */
  trigger: number;
  /** Seconds of the pulse telegraph. */
  pulse: number;
  radius: number;
  cooldown: number;
  recover: number;
  mult?: number;
  /** Telegraph kind (default 'wispBurst': chills inside, freezes at point blank). */
  area?: AreaKind;
  /** Speed factor while rushing in. */
  rush?: number;
}

/** Rush the target, stop, pulse a telegraph around itself, burst (Glacial Wisp style). */
export function pulseBrain(cfg: PulseConfig): Brain {
  const mult = cfg.mult ?? 1;
  const area = cfg.area ?? 'wispBurst';
  const rush = cfg.rush ?? 1;
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    const st = m.state[i];
    if (st === MSTATE.windup) {
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        attackEvent(w, i, 'burst');
        m.state[i] = MSTATE.attack;
        m.stateTime[i] = cfg.recover;
        setAnim(w, i, ANIM.attack);
      }
      return;
    }
    if (st === MSTATE.attack) {
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) {
        toChase(w, i);
        m.attackCd[i] = cfg.cooldown;
      }
      return;
    }
    if (!hunting) {
      wander(w, i);
      return;
    }
    steer(w, i, dx, dy, d, rush);
    if (m.attackCd[i] <= 0 && d < cfg.trigger) {
      spawnArea(w, area, m.x[i], m.y[i], cfg.radius, cfg.pulse, {
        damage: monsterDamage(w, i) * mult, dtype: m.dtype[i], hurts: 'player', owner: m.id[i],
      });
      attackEvent(w, i, 'pulse');
      m.state[i] = MSTATE.windup;
      m.stateTime[i] = cfg.pulse;
      setAnim(w, i, ANIM.windup);
      stop(w, i);
    }
  };
}

// --- commanders (lieutenants and bosses) ------------------------------------------------------------------

export interface CommanderAction {
  /** Seconds between uses. */
  every: number;
  /** Seconds before the first use (default `every`). */
  first?: number;
  /** Windup pose before the release (default 0.5 s). */
  cast?: number;
  /** Pose held after the release / channel (default 0.3 s). */
  release?: number;
  /** Only from this boss phase on (default 1). */
  phase?: number;
  /** Only when the target is within this distance (default: any). */
  range?: number;
  /** Extra condition. */
  when?(w: World, i: number, t: PlayerState, d: number): boolean;
  /** Cue when the cast starts. */
  castAttack?: MonsterAttack;
  /** When the cast starts (a telegraph that must be visible for the whole windup). */
  onCast?(w: World, i: number, t: PlayerState, dx: number, dy: number, d: number): void;
  /** Cue on release. */
  attack?: MonsterAttack;
  /** The effect, at release — and `repeats − 1` more times, `gap` seconds apart (the monster keeps walking). */
  run(w: World, i: number, t: PlayerState, dx: number, dy: number, d: number): void;
  repeats?: number;
  gap?: number;
  /**
   * Up to this many seconds after the release `tick` drives the monster instead of walking (a dash, a
   * whirl); `tick` returning true ends it early.
   */
  channel?: number;
  tick?(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, elapsed: number): boolean | void;
}

export interface CommanderConfig {
  /** Distance band: closes in beyond `keepFar`, backs off inside `keepNear`, strafes in between. */
  keepNear: number;
  keepFar: number;
  /** Strikes without windup when the target is in reach. */
  melee?: { reach: number; cooldown: number; mult?: number; debuff?: PlayerDebuff | null };
  /** Allies within this radius are empowered (+30% speed and damage; AILMENT_BIT.empowered). */
  aura?: number;
  /** Allies within this radius are hastened (HASTE_BONUS faster, speed only; the Bone Chorister). */
  haste?: number;
  actions: readonly CommanderAction[];
}

/** memoryOf layout: [0] init, [1] action being cast / channelled (-1 none), [2] channel elapsed,
 *  [3] repeat action, [4] repeats left, [5] repeat timer, [6] melee cooldown, [7..] action timers. */
const MEM_HEADER = 7;

/** A lieutenant / boss: a distance band plus a prioritised list of timed actions (see CommanderAction). */
export function commanderBrain(cfg: CommanderConfig): Brain {
  const n = cfg.actions.length;
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    const mem = memoryOf(w, i, MEM_HEADER + n);
    if (mem[0] === 0) {
      mem[0] = 1;
      mem[1] = -1;
      mem[3] = -1;
      for (let k = 0; k < n; k++) mem[MEM_HEADER + k] = cfg.actions[k].first ?? cfg.actions[k].every;
    }
    if (cfg.aura && (w.tick + i) % 6 === 0) empowerAround(w, i, cfg.aura);
    if (cfg.haste && (w.tick + i) % 6 === 0) hasteAround(w, i, cfg.haste);
    for (let k = 0; k < n; k++) if (mem[MEM_HEADER + k] > 0) mem[MEM_HEADER + k] -= DT;
    if (mem[6] > 0) mem[6] -= DT;
    // Pending repeats of a released action (the monster keeps moving meanwhile).
    if (mem[4] > 0) {
      mem[5] -= DT;
      if (mem[5] <= 0) {
        const a = cfg.actions[mem[3]];
        mem[4]--;
        mem[5] = a.gap ?? 0.5;
        if (t && !t.dead) a.run(w, i, t, dx, dy, d);
      }
    }
    const st = m.state[i];
    if (st === MSTATE.cast) {
      stop(w, i);
      faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) release(w, i, t, dx, dy, d, cfg, mem);
      return;
    }
    if (st === MSTATE.charge) {
      const a = cfg.actions[mem[1]];
      mem[2] += DT;
      const done = a.tick?.(w, i, t, dx, dy, d, mem[2]) === true;
      if (m.alive[i] && m.state[i] === MSTATE.charge && (done || mem[2] >= (a.channel ?? 0))) finishRelease(w, i, a);
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
    if (d > cfg.keepFar) steer(w, i, dx, dy, d, 1);
    else if (d < cfg.keepNear) moveAlong(w, i, -dx, -dy, 0.8);
    else moveAlong(w, i, -dy, dx, 0.35);
    if (cfg.melee && mem[6] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + cfg.melee.reach) {
      meleeHit(w, i, t, cfg.melee.mult ?? 1, cfg.melee.debuff ?? null);
      mem[6] = cfg.melee.cooldown;
    }
    const phase = phaseOf(w, i);
    for (let k = 0; k < n; k++) {
      const a = cfg.actions[k];
      if (mem[MEM_HEADER + k] > 0 || (a.phase ?? 1) > phase) continue;
      if (a.range !== undefined && d > a.range) continue;
      if (a.when && !a.when(w, i, t, d)) continue;
      mem[MEM_HEADER + k] = a.every;
      mem[1] = k;
      m.state[i] = MSTATE.cast;
      m.stateTime[i] = a.cast ?? 0.5;
      setAnim(w, i, ANIM.windup);
      stop(w, i);
      if (a.castAttack) attackEvent(w, i, a.castAttack);
      a.onCast?.(w, i, t, dx, dy, d);
      if (m.stateTime[i] <= 0) release(w, i, t, dx, dy, d, cfg, mem);
      break;
    }
  };
}

function release(
  w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, cfg: CommanderConfig, mem: Float64Array,
): void {
  const m = w.monsters;
  const k = mem[1];
  const a = cfg.actions[k];
  if (a.attack) attackEvent(w, i, a.attack);
  if (t && !t.dead) {
    a.run(w, i, t, dx, dy, d);
    if ((a.repeats ?? 1) > 1) {
      mem[3] = k;
      mem[4] = (a.repeats ?? 1) - 1;
      mem[5] = a.gap ?? 0.5;
    }
  }
  if (!m.alive[i]) return;
  if (a.channel && a.channel > 0 && m.state[i] === MSTATE.cast) {
    m.state[i] = MSTATE.charge;
    mem[2] = 0;
    setAnim(w, i, ANIM.move);
    return;
  }
  if (m.state[i] === MSTATE.cast) finishRelease(w, i, a);
}

function finishRelease(w: World, i: number, a: CommanderAction): void {
  const m = w.monsters;
  m.flags[i] &= ~MFLAG.unpushable;
  m.state[i] = MSTATE.attack;
  m.stateTime[i] = a.release ?? 0.3;
  setAnim(w, i, ANIM.attack);
  stop(w, i);
}

/** Herald-style aura: allies within `radius` are empowered for a moment (refreshed every 6 ticks). */
export function empowerAround(w: World, i: number, radius: number): void {
  auraAround(w, i, radius, w.monsters.empowerTime);
}

/**
 * Haste aura: allies within `radius` move HASTE_BONUS faster for a moment (speed only; refresh it
 * every few ticks). There is no ailment bit for it in the frozen contract, so allies show nothing.
 */
export function hasteAround(w: World, i: number, radius: number): void {
  auraAround(w, i, radius, w.monsters.hasteTime);
}

function auraAround(w: World, i: number, radius: number, timer: Float32Array): void {
  const m = w.monsters;
  const cand = w.scratch2;
  const n = w.grid.query(m.x[i] - radius, m.y[i] - radius, m.x[i] + radius, m.y[i] + radius, cand);
  for (let k = 0; k < n; k++) {
    const j = cand[k];
    if (j === i || !m.alive[j]) continue;
    const ex = m.x[j] - m.x[i];
    const ey = m.y[j] - m.y[i];
    if (ex * ex + ey * ey <= radius * radius) timer[j] = 0.25;
  }
}
