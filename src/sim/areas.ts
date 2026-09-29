// Ground areas: telegraphs that resolve once (slam / leap / eruption / meteor and the bestiary's nova,
// spikes, prison, wisp burst, charge line, execution mark), ground that ticks (fire pools and blizzards
// hurt players, fire trails hurt monsters, whirlwinds follow their monster), and persistent ground with
// its own rules (tar pools, choir rings, the herald's aura).
//
// Generic behaviour the core gives every area (AreaOptions):
//  - `follow` (monster id) / `followPlayer` + `lockAt`: the area moves with its owner (a player's mark
//    stops following at `lockAt` seconds of age, so the strike can be dodged).
//  - `vx`/`vy`: drift (the blizzard), bouncing off the arena edge.
//  - `endRadius`: the radius changes linearly from `radius` (age 0) to `endRadius` (age = duration) —
//    the choir ring grows, the ice prison shrinks (to ICE_PRISON_END_FRACTION by default).
//  - `hurts` decides who takes the area's DAMAGE ('player' / 'monsters' / 'none'); `debuff` is a rider
//    applied to every player the area touches when it acts — at the resolve, on each tick, on a choir
//    ring's or tar pool's contact — whenever `hurts` isn't 'monsters' (default per kind: AREA_RIDERS;
//    null = none). So an icePrison or wispBurst left at hurts 'none' still freezes / chills (it just
//    deals no damage); a purely cosmetic area of a kind with a default rider passes `debuff: null`.
//    Burning and bleeding need a hit that dealt damage, so they never ride a harmless area.
//  - Shape (area-geometry.ts areaContains): discs, except the chargeLine lane and the choir band.
// Per kind on top:
//  - icePrison: a `target` player who gets out of the ring before it closes breaks it (it vanishes with
//    an 'areaResolve'); when it closes, everyone still inside is frozen.
//  - wispBurst: at the burst, players within WISP_FREEZE_FRACTION of the radius are frozen instead of
//    chilled.
//  - choirWave: hits each player once, where the band passes them outside a gap.
//  - tarPool: roots each player once, on first contact, for ROOT_DURATION (roots don't chain:
//    ROOT_GRACE); its 50% slow is part of movement (movement.ts).
//  - choirWave, tarPool, heraldAura and ticking areas end silently; every other kind resolves at
//    age == duration ('areaResolve', damage and rider inside) — a chargeLine without the event (it
//    can't carry the lane's heading; the monster's 'monsterAttack' marks the moment).
import type { PlayerDebuff } from '../contracts/bestiary';
import type { AreaKind, RootSource } from '../contracts/sim';
import { ICE_PRISON_END_FRACTION, WISP_FREEZE_FRACTION, areaContains, encodeAreaId, quantizeAreaAngle } from './area-geometry';
import { damageMonster, damagePlayer, isHittable } from './combat';
import { DT, FIRE_TRAIL_TICK, PLAYER_RADIUS } from './constants';
import { applyDebuff } from './debuffs';
import { areaEffect } from './effects';
import { DAMAGE_INDEX } from './math';
import type { Area, PlayerState, World } from './world';

export interface AreaOptions {
  damage?: number;
  dtype?: number;
  hurts?: Area['hurts'];
  tickInterval?: number;
  /** Delay before the first damage tick of a ticking area (default: one interval). */
  firstTick?: number;
  owner?: number;
  /** Player id credited with damage from a player-made area. */
  source?: number;
  follow?: number;
  poolDuration?: number;
  poolDamage?: number;
  /** Debuff rider: undefined = the kind's default (AREA_RIDERS), null = none. */
  debuff?: PlayerDebuff | null;
  /** What a 'rooted' rider shows (default: 'tar' for tarPool, else 'bone'). */
  rootSource?: RootSource;
  /** Heading in radians (packed into the id: chargeLine direction, choir gaps, drift, spike lean). */
  angle?: number;
  /** 0..3, packed into the id (chargeLine width, choir gap count − 1). */
  variant?: number;
  /** Drift velocity in units/s. */
  vx?: number;
  vy?: number;
  /** Radius at age = duration (default: `radius`; icePrison: radius × ICE_PRISON_END_FRACTION). */
  endRadius?: number;
  /** Follow this player until `lockAt` seconds of age. */
  followPlayer?: number;
  lockAt?: number;
  /** icePrison: the player it closes on (leaving the ring breaks it). */
  target?: number;
  /** Handle of a registered area effect (effects.ts). */
  effect?: number;
}

/** Debuff each kind applies to the players it damages or touches unless AreaOptions.debuff says otherwise. */
export const AREA_RIDERS: Readonly<Partial<Record<AreaKind, PlayerDebuff>>> = {
  firePool: 'burning',
  eruptionWarning: 'burning',
  leapWarning: 'withered',
  frostNovaWarning: 'chilled',
  glacialSpike: 'chilled',
  icePrison: 'frozen',
  blizzard: 'chilled',
  choirWave: 'chilled',
  wispBurst: 'chilled',
  tarPool: 'rooted',
};

/** Kinds that end silently at age == duration instead of resolving (their effect is continuous). */
const PERSISTENT: ReadonlySet<AreaKind> = new Set<AreaKind>([
  'heraldAura', 'firePool', 'fireTrail', 'blizzard', 'choirWave', 'tarPool', 'whirlwind',
]);

export function spawnArea(
  w: World, kind: AreaKind, x: number, y: number, radius: number, duration: number, opts: AreaOptions = {},
): Area {
  const tickInterval = opts.tickInterval ?? 0;
  const angle = quantizeAreaAngle(opts.angle ?? 0);
  const variant = (opts.variant ?? 0) & 3;
  w.areaSeq++;
  const endRadius = opts.endRadius ?? (kind === 'icePrison' ? radius * ICE_PRISON_END_FRACTION : radius);
  const area: Area = {
    id: encodeAreaId(w.areaSeq, angle, variant),
    kind,
    x,
    y,
    radius,
    age: 0,
    duration,
    damage: opts.damage ?? 0,
    dtype: opts.dtype ?? DAMAGE_INDEX.fire,
    hurts: opts.hurts ?? 'none',
    tickInterval,
    tickTimer: opts.firstTick ?? tickInterval,
    owner: opts.owner ?? -1,
    source: opts.source ?? 0,
    follow: opts.follow ?? -1,
    poolDuration: opts.poolDuration ?? 0,
    poolDamage: opts.poolDamage ?? 0,
    dead: false,
    debuff: opts.debuff === undefined ? AREA_RIDERS[kind] ?? null : opts.debuff,
    rootSource: opts.rootSource ?? (kind === 'tarPool' ? 'tar' : 'bone'),
    angle,
    variant,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? 0,
    startRadius: radius,
    endRadius,
    followPlayer: opts.followPlayer ?? 0,
    lockAt: opts.lockAt ?? Infinity,
    target: opts.target ?? 0,
    touched: [],
    effect: opts.effect ?? 0,
  };
  w.areas.push(area);
  return area;
}

/** Cancel the unresolved telegraphs of a monster that died or was interrupted. */
export function removeOwnedAreas(w: World, ownerId: number): void {
  const areas = w.areas;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.owner === ownerId || a.follow === ownerId) a.dead = true;
  }
}

/** Remove everything the monsters left on the ground (map cleared); players' own ground stays. */
export function removeHostileAreas(w: World): void {
  for (const a of w.areas) if (a.source === 0) a.dead = true;
}

/** Remove the ground effects a player made (they left the instance). */
export function removePlayerAreas(w: World, playerId: number): void {
  const areas = w.areas;
  let write = 0;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.source !== playerId || a.dead) areas[write++] = a;
  }
  areas.length = write;
}

export function updateAreas(w: World): void {
  const areas = w.areas;
  const n = areas.length;
  const m = w.monsters;
  for (let k = 0; k < n; k++) {
    const a = areas[k];
    if (a.dead) continue;
    if (a.follow >= 0) {
      const slot = m.slotOf(a.follow);
      if (slot < 0) {
        a.dead = true;
        continue;
      }
      a.x = m.x[slot];
      a.y = m.y[slot];
    } else if (a.followPlayer > 0 && a.age < a.lockAt) {
      const p = w.playerById[a.followPlayer];
      if (p && !p.dead) {
        a.x = p.x;
        a.y = p.y;
      }
    }
    if (a.vx !== 0 || a.vy !== 0) drift(w, a);
    a.age += DT;
    if (a.startRadius !== a.endRadius) a.radius = a.startRadius + (a.endRadius - a.startRadius) * Math.min(1, a.age / a.duration);
    switch (a.kind) {
      case 'icePrison':
        if (prisonBroken(w, a)) {
          a.dead = true;
          w.events.push({ t: 'areaResolve', kind: a.kind, x: a.x, y: a.y, radius: a.radius });
          continue;
        }
        break;
      case 'choirWave':
        if (a.hurts !== 'monsters') touchRing(w, a);
        break;
      case 'tarPool':
        if (a.hurts !== 'monsters') touchTar(w, a);
        break;
    }
    const fx = a.effect > 0 ? areaEffect(a.effect) : undefined;
    fx?.onTick?.(w, a);
    if (a.tickInterval > 0) {
      a.tickTimer -= DT;
      if (a.tickTimer <= 0) {
        a.tickTimer += a.tickInterval;
        applyAreaDamage(w, a, true);
      }
    }
    if (a.age >= a.duration) {
      a.dead = true;
      if (a.tickInterval > 0 || PERSISTENT.has(a.kind)) continue;
      a.age = a.duration;
      // A lane has no heading in the event: it resolves silently (its monster's 'monsterAttack' marks it).
      if (a.kind !== 'chargeLine') w.events.push({ t: 'areaResolve', kind: a.kind, x: a.x, y: a.y, radius: a.radius });
      applyAreaDamage(w, a, false);
      if (a.poolDuration > 0) {
        spawnArea(w, 'firePool', a.x, a.y, a.radius * 0.85, a.poolDuration, {
          damage: a.poolDamage, dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 0.25,
        });
      }
      fx?.onResolve?.(w, a);
    }
  }
  // Compact in place, preserving order (deterministic and stable for the presenter).
  let write = 0;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (!a.dead) areas[write++] = a;
  }
  areas.length = write;
}

/** Move a drifting area, bouncing off the arena edge. */
function drift(w: World, a: Area): void {
  let x = a.x + a.vx * DT;
  let y = a.y + a.vy * DT;
  const lim = Math.max(0, w.arenaRadius - a.radius);
  const d2 = x * x + y * y;
  if (d2 > lim * lim) {
    const d = Math.sqrt(d2);
    const nx = x / d;
    const ny = y / d;
    const vn = a.vx * nx + a.vy * ny;
    if (vn > 0) {
      a.vx -= 2 * vn * nx;
      a.vy -= 2 * vn * ny;
    }
    x = nx * lim;
    y = ny * lim;
  }
  a.x = x;
  a.y = y;
}

/** An ice prison breaks when its player has walked out of the ring before it closed. */
function prisonBroken(w: World, a: Area): boolean {
  if (a.target <= 0) return false;
  const p = w.playerById[a.target];
  if (!p || p.dead) return false;
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  return dx * dx + dy * dy > a.radius * a.radius;
}

/** A choir ring hits each living player once where its band (outside the gaps) passes them. */
function touchRing(w: World, a: Area): void {
  const living = w.living;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    if (a.touched.includes(p.id) || !areaContains(a, p.x, p.y, PLAYER_RADIUS * 0.5)) continue;
    a.touched.push(p.id);
    damagePlayer(w, p, a.hurts === 'player' ? a.damage : 0, a.dtype, 'area', a.debuff, a.rootSource);
  }
}

/**
 * Tar roots each living player once, the first time their feet touch it, for ROOT_DURATION (roots
 * don't chain: see ROOT_GRACE in debuffs.ts; the slow still applies).
 */
function touchTar(w: World, a: Area): void {
  const living = w.living;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    if (a.touched.includes(p.id)) continue;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    // A player blinking through it (invulnerable) isn't caught; one still standing in it afterwards is.
    if (dx * dx + dy * dy > a.radius * a.radius || p.invulnTime > 0) continue;
    a.touched.push(p.id);
    if (a.debuff) applyDebuff(w, p, a.debuff, 0, a.rootSource);
  }
}

/** The rider a player inside `a` gets (a wisp burst with its rider freezes at point blank). */
function riderFor(a: Area, p: PlayerState): PlayerDebuff | null {
  if (a.kind === 'wispBurst' && a.debuff) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const core = a.radius * WISP_FREEZE_FRACTION;
    if (dx * dx + dy * dy <= core * core) return 'frozen';
  }
  return a.debuff;
}

function applyAreaDamage(w: World, a: Area, ticking: boolean): void {
  if (a.hurts !== 'monsters') {
    // Telegraphs and hostile ground act on every living player standing in them: damage when they
    // hurt players, their rider either way (see the header).
    const damage = a.hurts === 'player' ? a.damage : 0;
    if (damage <= 0 && !a.debuff) return;
    const living = w.living;
    const pad = PLAYER_RADIUS * 0.5;
    for (let k = 0; k < living.length; k++) {
      const p = living[k];
      if (p.dead || !areaContains(a, p.x, p.y, pad)) continue;
      damagePlayer(w, p, damage, a.dtype, ticking ? 'dot' : 'area', riderFor(a, p), a.rootSource);
    }
  } else {
    if (a.damage <= 0) return;
    const m = w.monsters;
    const out = w.scratch2;
    const reach = a.radius + w.grid.maxRadius;
    const n = w.grid.query(a.x - reach, a.y - reach, a.x + reach, a.y + reach, out);
    const trail = a.kind === 'fireTrail';
    for (let k = 0; k < n; k++) {
      const i = out[k];
      if (!isHittable(w, i)) continue;
      const dx = m.x[i] - a.x;
      const dy = m.y[i] - a.y;
      const r = a.radius + m.radius[i];
      if (dx * dx + dy * dy > r * r) continue;
      if (trail) {
        // Overlapping trail segments must not stack: one trail tick per monster per interval.
        if (m.groundCd[i] > 0) continue;
        m.groundCd[i] = FIRE_TRAIL_TICK * 0.9;
      }
      damageMonster(w, i, a.damage, a.dtype, 0, 1.5, 0, 0, 0, 0, false, a.source); // burning ground, not a hit
    }
  }
}
