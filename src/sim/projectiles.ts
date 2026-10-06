// Projectiles: straight movers with swept segment-vs-circle collision (no tunnelling), sorted
// multi-hits per tick for pierce, and a per-projectile hit ring so a piercing bolt never hits
// the same monster twice. Lobbed projectiles (cinder spit, tar globs: ProjectileStore.life > 0)
// instead fly over everything for a fixed flight time and burst where they land.
//
// Hostile projectiles carry a debuff rider (PROJECTILE_RIDERS by kind; setProjectileDebuff overrides
// it per shot) applied to the player they connect with (evaded / invulnerable = no rider), plus the
// kind's built-in follow-up and an optional registered effect (effects.ts):
//   chainHook   on a connecting hit: pulls the player CHAIN_PULL_DISTANCE (setProjectilePull) toward the
//               monster that threw it (or its launch point) and roots them ('pull' event) — pullPlayer.
//   tarGlob     a lob; where it lands it leaves a tarPool (TAR_POOL_RADIUS, TAR_POOL_DURATION).
//   (the rest)  just their rider: webShot roots (web), frostShard chills, crossbowBolt bleeds,
//               cinderSpit / matriarchOrb burn, heraldOrb withers, boneShard nothing.
//
// Cover (docs/atlas-rework/D-territory.md 10.8): a straight shot — player or monster, piercing or not — stops at the first TALL solid
// prop its swept segment touches (cover.ts; low props are flown over; a prop containing the shot's start is ignored, it is leaving
// it) and sparks a 'blocked' event with `cover: true`. Pierce counts bodies, never walls. Lobs fly over everything (above);
// nova rings (PASSES_COVER) burst outward over the scenery too: a nova is a point-blank ring, not an aimed shot.
//
// Frontal shields: a player projectile meeting a guarding blocker (MonsterDef.block, MFLAG.guard)
// travelling INTO its front — within ±arc/2 of `m.aim` — is blocked: no damage, 'blocked' event at
// the contact point, and the projectile is consumed (even a piercing one). From the side or behind it
// hits normally.
import { PLAYER_DEBUFFS, type PlayerDebuff } from '../contracts/bestiary';
import { PROJECTILE_KINDS, type ProjectileKind, type RootSource } from '../contracts/sim';
import { spawnArea } from './areas';
import { applyDecay, damageMonster, hitPlayer, isHittable } from './combat';
import { CHAIN_PULL_DISTANCE, DT, PLAYER_RADIUS, SPIT_SPLASH_RADIUS, TAR_POOL_DURATION, TAR_POOL_RADIUS } from './constants';
import { ROOT_SOURCES } from './debuffs';
import { projectileEffect } from './effects';
import { coverHit, coverNormal, coverNormalOut } from './cover';
import { sweepCircle } from './math';
import { pullPlayer } from './player';
import { monsterDefs } from './rosters';
import { MFLAG, NO_SOURCE } from './stores';
import type { PlayerState, World } from './world';

export const PROJ = Object.fromEntries(PROJECTILE_KINDS.map((k, i) => [k, i])) as Record<ProjectileKind, number>;

/** Debuff each hostile kind applies to the player it connects with (setProjectileDebuff overrides it). */
export const PROJECTILE_RIDERS: Readonly<Partial<Record<ProjectileKind, { debuff: PlayerDebuff; source?: RootSource }>>> = {
  cinderSpit: { debuff: 'burning' },
  matriarchOrb: { debuff: 'burning' },
  heraldOrb: { debuff: 'withered' },
  webShot: { debuff: 'rooted', source: 'web' },
  frostShard: { debuff: 'chilled' },
  crossbowBolt: { debuff: 'bleeding' },
};

/** Kinds that fly over tall cover too (player nova rings); every other straight shot is stopped by it. */
const PASSES_COVER: Uint8Array = new Uint8Array(PROJECTILE_KINDS.length);
PASSES_COVER[PROJ.novaFlame] = 1;
// Frost Orb floats over the scenery and touches nothing (its shards do the hitting).
PASSES_COVER[PROJ.frostOrb] = 1;
const NO_CONTACT: Uint8Array = new Uint8Array(PROJECTILE_KINDS.length);
NO_CONTACT[PROJ.frostOrb] = 1;

const RIDER_CODE: Uint8Array = new Uint8Array(PROJECTILE_KINDS.length);
const RIDER_SOURCE: Uint8Array = new Uint8Array(PROJECTILE_KINDS.length);
for (let k = 0; k < PROJECTILE_KINDS.length; k++) {
  const r = PROJECTILE_RIDERS[PROJECTILE_KINDS[k]];
  if (!r) continue;
  RIDER_CODE[k] = PLAYER_DEBUFFS.indexOf(r.debuff) + 1;
  RIDER_SOURCE[k] = Math.max(0, ROOT_SOURCES.indexOf(r.source ?? 'bone'));
}

export interface ProjectileSpec {
  kind: number;
  hostile: boolean;
  x: number;
  y: number;
  angle: number;
  speed: number;
  range: number;
  radius: number;
  damage: number;
  dtype: number;
  critChance: number;
  critMult: number;
  ailmentChance: number;
  /** Conversion: `convShare` (0..1) of the hit becomes `convTo` damage (a DAMAGE_TYPES index); both types keep their modifiers. 0 = none. */
  convTo?: number;
  convShare?: number;
  /** Remaining pierces; -1 = pierce everything. */
  pierce: number;
  /** Player id credited with this projectile's kills (0 for monster projectiles). */
  owner: number;
  /** Roster batch 1 (player shots; all reset after a projSpec spawn): rebounds, rehit interval, knockback multiplier, Decay share. */
  bounce?: number;
  rehit?: number;
  knock?: number;
  decay?: number;
}

/** Reusable spec object for callers in hot paths. */
export const projSpec: ProjectileSpec = {
  kind: 0, hostile: false, x: 0, y: 0, angle: 0, speed: 0, range: 0, radius: 4,
  damage: 0, dtype: 0, critChance: 0, critMult: 1.5, ailmentChance: 0, pierce: 0, owner: 0,
};

/**
 * Spawn a projectile. `flight` > 0 makes it a lob that lands (and only then hits) after that many
 * seconds. A hostile one gets its kind's default rider. Returns the slot (-1 when the store is full).
 */
export function spawnProjectile(w: World, s: ProjectileSpec, flight = 0): number {
  const pr = w.projectiles;
  const i = pr.alloc();
  if (i < 0) return -1;
  pr.life[i] = flight > 0 ? flight : 0;
  pr.kind[i] = s.kind;
  pr.hostile[i] = s.hostile ? 1 : 0;
  pr.owner[i] = s.hostile ? 0 : s.owner;
  pr.x[i] = s.x;
  pr.y[i] = s.y;
  pr.prevX[i] = s.x;
  pr.prevY[i] = s.y;
  pr.vx[i] = Math.cos(s.angle) * s.speed;
  pr.vy[i] = Math.sin(s.angle) * s.speed;
  pr.radius[i] = s.radius;
  pr.damage[i] = s.damage;
  pr.dtype[i] = s.dtype;
  pr.critChance[i] = s.critChance;
  pr.critMult[i] = s.critMult;
  pr.ailmentChance[i] = s.ailmentChance;
  pr.convTo[i] = s.convTo ?? 0;
  pr.convShare[i] = s.convShare ?? 0;
  pr.bounce[i] = s.bounce ?? 0;
  pr.rehit[i] = s.rehit ?? 0;
  pr.knock[i] = s.knock ?? 1;
  pr.decay[i] = s.decay ?? 0;
  pr.timer[i] = 0;
  pr.groundDamage[i] = 0;
  pr.groundTime[i] = 0;
  pr.groundRadius[i] = 0;
  pr.groundTick[i] = 0;
  // The shared projSpec never carries a conversion (or a roster rider) over to the next spawn.
  if (s === projSpec) { s.convTo = 0; s.convShare = 0; s.bounce = 0; s.rehit = 0; s.knock = 1; s.decay = 0; }
  pr.pierce[i] = s.pierce;
  pr.range[i] = s.range;
  pr.src[i] = NO_SOURCE;
  pr.debuff[i] = s.hostile ? RIDER_CODE[s.kind] ?? 0 : 0;
  pr.rootSrc[i] = s.hostile ? RIDER_SOURCE[s.kind] ?? 0 : 0;
  pr.effect[i] = 0;
  pr.splash[i] = 0;
  pr.pull[i] = 0;
  return i;
}

/** Override a hostile projectile's debuff rider (null = none). */
export function setProjectileDebuff(w: World, slot: number, debuff: PlayerDebuff | null, source: RootSource = 'bone'): void {
  if (slot < 0) return;
  w.projectiles.debuff[slot] = debuff ? PLAYER_DEBUFFS.indexOf(debuff) + 1 : 0;
  w.projectiles.rootSrc[slot] = Math.max(0, ROOT_SOURCES.indexOf(source));
}

/** Attach a registered projectile effect (effects.ts) to a projectile. */
export function setProjectileEffect(w: World, slot: number, handle: number): void {
  if (slot >= 0) w.projectiles.effect[slot] = handle;
}

/** A chain hook's pull distance (default CHAIN_PULL_DISTANCE). */
export function setProjectilePull(w: World, slot: number, distance: number): void {
  if (slot >= 0) w.projectiles.pull[slot] = Math.max(0, distance);
}

/** A lob's landing splash radius (default SPIT_SPLASH_RADIUS). */
export function setProjectileSplash(w: World, slot: number, radius: number): void {
  if (slot >= 0) w.projectiles.splash[slot] = Math.max(0, radius);
}

function riderOf(w: World, i: number): PlayerDebuff | null {
  const code = w.projectiles.debuff[i];
  return code > 0 ? PLAYER_DEBUFFS[code - 1] : null;
}

function endProjectile(w: World, i: number): void {
  const pr = w.projectiles;
  if (w.events.lowOpen) w.events.low({ t: 'projectileEnd', kind: PROJECTILE_KINDS[pr.kind[i]], x: pr.x[i], y: pr.y[i] });
  pr.release(i);
}

/** cos(arc / 2) of each kind's frontal shield (−2 = no shield), built on first use. */
let blockCos: Float64Array | null = null;

function blockCosOf(kind: number): number {
  if (!blockCos) {
    const defs = monsterDefs();
    blockCos = new Float64Array(defs.length).fill(-2);
    for (let k = 0; k < defs.length; k++) {
      const b = defs[k].block;
      if (b) blockCos[k] = Math.cos(Math.max(0, Math.min(Math.PI, b.arc / 2)));
    }
  }
  return blockCos[kind];
}

/** Whether a guarding blocker `j` stops a projectile travelling along (vx, vy): it arrives in its front arc. */
function blocks(w: World, j: number, vx: number, vy: number): boolean {
  const m = w.monsters;
  if ((m.flags[j] & MFLAG.guard) === 0) return false;
  const c = blockCosOf(m.kind[j]);
  if (c < -1) return false;
  const vl = Math.sqrt(vx * vx + vy * vy);
  if (vl < 1e-6) return false;
  // The projectile comes from the direction opposite its velocity.
  const a = m.aim[j];
  return (-vx * Math.cos(a) - vy * Math.sin(a)) / vl >= c;
}

/** A hostile projectile connected with a player: rider, built-in follow-up, registered effect. */
function hostileHit(w: World, i: number, p: PlayerState): void {
  const pr = w.projectiles;
  const r = hitPlayer(w, p, pr.damage[i], pr.dtype[i], 'projectile', riderOf(w, i), ROOT_SOURCES[pr.rootSrc[i]]);
  if (r < 0 || p.dead) return;
  if (pr.kind[i] === PROJ.chainHook) {
    // Toward the thrower if it still stands, else toward where the hook was thrown from.
    const slot = pr.src[i] !== NO_SOURCE ? w.monsters.slotOf(pr.src[i]) : -1;
    const ox = slot >= 0 ? w.monsters.x[slot] : pr.x[i] - pr.vx[i] * pr.age[i];
    const oy = slot >= 0 ? w.monsters.y[slot] : pr.y[i] - pr.vy[i] * pr.age[i];
    pullPlayer(w, p, ox, oy, pr.pull[i] > 0 ? pr.pull[i] : CHAIN_PULL_DISTANCE, 'chain');
  }
  const fx = pr.effect[i] > 0 ? projectileEffect(pr.effect[i]) : undefined;
  fx?.onHit?.(w, i, p);
}

/** A lob landed at (x, y): splash every living player inside, then the kind's landing follow-up. */
function land(w: World, i: number, x: number, y: number): void {
  const pr = w.projectiles;
  if (pr.hostile[i]) {
    const living = w.living;
    const r = (pr.splash[i] > 0 ? pr.splash[i] : SPIT_SPLASH_RADIUS) + PLAYER_RADIUS;
    for (let k = 0; k < living.length; k++) {
      const p = living[k];
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r * r) hostileHit(w, i, p);
    }
    if (pr.kind[i] === PROJ.tarGlob) spawnArea(w, 'tarPool', x, y, TAR_POOL_RADIUS, TAR_POOL_DURATION);
  }
  const fx = pr.effect[i] > 0 ? projectileEffect(pr.effect[i]) : undefined;
  fx?.onLand?.(w, i, x, y);
}

export function updateProjectiles(w: World): void {
  const pr = w.projectiles;
  if (pr.count === 0) return;
  const m = w.monsters;
  const cand = w.scratch;
  const hitSlot = w.scratch2;
  const hitT = w.scratchT;
  const outR = w.arenaRadius + 40;
  const outR2 = outR * outR;
  for (let i = 0; i < pr.hwm; i++) {
    if (!pr.alive[i]) continue;
    pr.age[i] += DT;
    if (pr.effect[i] > 0 && !pr.hostile[i]) {
      projectileEffect(pr.effect[i])?.onTick?.(w, i);
      if (!pr.alive[i]) continue;
    }
    const ax = pr.x[i];
    const ay = pr.y[i];
    const vx = pr.vx[i];
    const vy = pr.vy[i];
    const bx = ax + vx * DT;
    const by = ay + vy * DT;
    const rad = pr.radius[i];
    let endT = 1;
    let ended = false;

    const flight = pr.life[i];
    if (flight > 0) {
      // Lobbed: sails over bodies and props, bursts on landing (age == life; half a tick of
      // slack absorbs the Float32 age accumulation). The splash hurts every player inside it.
      if (pr.age[i] >= flight - DT * 0.5) {
        ended = true;
        pr.x[i] = bx;
        pr.y[i] = by;
        land(w, i, bx, by);
      }
    } else if (pr.hostile[i]) {
      // A flat hostile shot stops on the first living, vulnerable player along its path.
      const living = w.living;
      let first: PlayerState | null = null;
      let firstT = 2;
      for (let k = 0; k < living.length; k++) {
        const p = living[k];
        if (p.dead || p.invulnTime > 0) continue;
        const t = sweepCircle(ax, ay, bx, by, p.x, p.y, rad + PLAYER_RADIUS);
        if (t >= 0 && t < firstT) {
          firstT = t;
          first = p;
        }
      }
      const wallT = PASSES_COVER[pr.kind[i]] ? -1 : coverHit(w.propGrid, ax, ay, bx, by, rad * 0.5);
      if (wallT >= 0 && wallT < firstT) {
        endT = wallT;
        ended = true;
        pr.x[i] = ax + (bx - ax) * endT;
        pr.y[i] = ay + (by - ay) * endT;
        coverImpact(w, pr.x[i], pr.y[i]);
      } else if (first) {
        endT = firstT;
        ended = true;
        pr.x[i] = ax + (bx - ax) * endT;
        pr.y[i] = ay + (by - ay) * endT;
        hostileHit(w, i, first);
      }
    } else {
      // Tall cover along this tick's segment: bodies beyond it cannot be reached, and it ends the shot.
      const wallT = PASSES_COVER[pr.kind[i]] ? -1 : coverHit(w.propGrid, ax, ay, bx, by, rad * 0.5);
      const pad = rad + w.grid.maxRadius;
      const n = NO_CONTACT[pr.kind[i]] ? 0 : w.grid.query(
        (ax < bx ? ax : bx) - pad, (ay < by ? ay : by) - pad, (ax > bx ? ax : bx) + pad, (ay > by ? ay : by) + pad, cand,
      );
      const rehit = pr.rehit[i];
      // Gather every contact along this tick's segment, then resolve them in travel order.
      let hits = 0;
      for (let k = 0; k < n; k++) {
        const j = cand[k];
        if (!isHittable(w, j)) continue;
        const t = sweepCircle(ax, ay, bx, by, m.x[j], m.y[j], rad + m.radius[j]);
        if (t < 0) continue;
        if (rehit > 0) {
          // Spark: the same monster again only once `rehit` seconds have passed since its last hit.
          const last = pr.lastHitAge(i, m.id[j]);
          if (last >= 0 && pr.age[i] - last < rehit) continue;
        } else if (pr.hasHit(i, m.id[j])) continue;
        // insertion sort by t (hit lists per tick are tiny)
        let h = hits++;
        while (h > 0 && hitT[h - 1] > t) {
          hitT[h] = hitT[h - 1];
          hitSlot[h] = hitSlot[h - 1];
          h--;
        }
        hitT[h] = t;
        hitSlot[h] = j;
      }
      for (let k = 0; k < hits; k++) {
        if (wallT >= 0 && hitT[k] > wallT) break;
        const j = hitSlot[k];
        if (!m.alive[j]) continue;
        if (m.flags[j] & MFLAG.guard && blocks(w, j, vx, vy)) {
          // Caught on the shield: consumed, whatever its pierce.
          endT = hitT[k];
          ended = true;
          w.events.push({ t: 'blocked', x: ax + (bx - ax) * endT, y: ay + (by - ay) * endT });
          break;
        }
        pr.recordHit(i, m.id[j]);
        damageMonster(w, j, pr.damage[i], pr.dtype[i], pr.critChance[i], pr.critMult[i], pr.ailmentChance[i], vx, vy, pr.knock[i], true, pr.owner[i],
          pr.convShare[i] > 0 ? pr.convTo[i] : -1, pr.convShare[i]);
        if (pr.decay[i] > 0) applyDecay(w, j, pr.damage[i], pr.decay[i], pr.owner[i]);
        const pierce = pr.pierce[i];
        if (pierce === 0) {
          endT = hitT[k];
          ended = true;
          break;
        }
        if (pierce > 0) pr.pierce[i] = pierce - 1;
      }
      if (!ended && wallT >= 0) {
        endT = wallT;
        const cx = ax + (bx - ax) * endT;
        const cy = ay + (by - ay) * endT;
        coverImpact(w, cx, cy);
        // A bouncing shot rebounds off the wall instead of ending there.
        if (pr.bounce[i] > 0 && coverNormal(w.propGrid, cx, cy, rad * 0.5)) {
          reflect(pr, i, coverNormalOut.x, coverNormalOut.y);
          pr.bounce[i]--;
        } else ended = true;
      }
    }

    if (!pr.alive[i]) continue; // an effect removed it
    const nx = ax + (bx - ax) * endT;
    const ny = ay + (by - ay) * endT;
    pr.x[i] = nx;
    pr.y[i] = ny;
    pr.range[i] -= Math.sqrt(vx * vx + vy * vy) * DT * endT;
    if (!ended && pr.bounce[i] > 0 && flight <= 0) {
      // A bouncing shot rebounds off the arena's edge too.
      const ar = w.arenaRadius;
      const d2 = nx * nx + ny * ny;
      if (d2 > ar * ar) {
        const d = Math.sqrt(d2);
        pr.x[i] = (nx / d) * ar;
        pr.y[i] = (ny / d) * ar;
        reflect(pr, i, -nx / d, -ny / d);
        pr.bounce[i]--;
      }
    }
    if (ended) endProjectile(w, i);
    else if ((flight <= 0 && pr.range[i] <= 0) || nx * nx + ny * ny > outR2) {
      if (pr.effect[i] > 0) projectileEffect(pr.effect[i])?.onExpire?.(w, i);
      if (pr.alive[i]) endProjectile(w, i);
    }
  }
}

/** Mirror a projectile's velocity off a surface with unit normal (nx, ny) (only when it moves into the surface). */
function reflect(pr: World['projectiles'], i: number, nx: number, ny: number): void {
  const vn = pr.vx[i] * nx + pr.vy[i] * ny;
  if (vn >= 0) return;
  pr.vx[i] -= 2 * vn * nx;
  pr.vy[i] -= 2 * vn * ny;
}

/** A straight shot hit tall cover at (x, y): the presenter's dust and sparks. Cosmetic, droppable under load. */
function coverImpact(w: World, x: number, y: number): void {
  if (w.events.lowOpen) w.events.low({ t: 'blocked', x, y, cover: true });
}

/** Remove every hostile projectile (map cleared). */
export function clearHostileProjectiles(w: World): void {
  const pr = w.projectiles;
  for (let i = 0; i < pr.hwm; i++) if (pr.alive[i] && pr.hostile[i]) pr.release(i);
}
