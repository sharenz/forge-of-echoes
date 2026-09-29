// Projectiles: straight movers with swept segment-vs-circle collision (no tunnelling), sorted
// multi-hits per tick for pierce, and a per-projectile hit ring so a piercing bolt never hits
// the same monster twice. Lobbed projectiles (cinder spit) instead fly over everything for a
// fixed flight time and burst where they land.
import { PROJECTILE_KINDS, type ProjectileKind } from '../contracts/sim';
import { damageMonster, damagePlayer, isHittable } from './combat';
import { DT, PLAYER_RADIUS, SPIT_SPLASH_RADIUS } from './constants';
import { sweepCircle } from './math';
import type { PlayerState, World } from './world';

export const PROJ = Object.fromEntries(PROJECTILE_KINDS.map((k, i) => [k, i])) as Record<ProjectileKind, number>;

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
  /** Remaining pierces; -1 = pierce everything. */
  pierce: number;
  /** Player id credited with this projectile's kills (0 for monster projectiles). */
  owner: number;
}

/** Reusable spec object for callers in hot paths. */
export const projSpec: ProjectileSpec = {
  kind: 0, hostile: false, x: 0, y: 0, angle: 0, speed: 0, range: 0, radius: 4,
  damage: 0, dtype: 0, critChance: 0, critMult: 1.5, ailmentChance: 0, pierce: 0, owner: 0,
};

/** Spawn a projectile. `flight` > 0 makes it a lob that lands (and only then hits) after that many seconds. */
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
  pr.pierce[i] = s.pierce;
  pr.range[i] = s.range;
  return i;
}

function endProjectile(w: World, i: number): void {
  const pr = w.projectiles;
  if (w.events.lowOpen) w.events.low({ t: 'projectileEnd', kind: PROJECTILE_KINDS[pr.kind[i]], x: pr.x[i], y: pr.y[i] });
  pr.release(i);
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
        if (pr.hostile[i]) {
          const living = w.living;
          const r = SPIT_SPLASH_RADIUS + PLAYER_RADIUS;
          for (let k = 0; k < living.length; k++) {
            const p = living[k];
            const dx = p.x - bx;
            const dy = p.y - by;
            if (dx * dx + dy * dy <= r * r) damagePlayer(w, p, pr.damage[i], pr.dtype[i], 'projectile');
          }
        }
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
      if (first) {
        endT = firstT;
        ended = true;
        damagePlayer(w, first, pr.damage[i], pr.dtype[i], 'projectile');
      }
    } else {
      const pad = rad + w.grid.maxRadius;
      const n = w.grid.query(
        (ax < bx ? ax : bx) - pad, (ay < by ? ay : by) - pad, (ax > bx ? ax : bx) + pad, (ay > by ? ay : by) + pad, cand,
      );
      // Gather every contact along this tick's segment, then resolve them in travel order.
      let hits = 0;
      for (let k = 0; k < n; k++) {
        const j = cand[k];
        if (!isHittable(w, j)) continue;
        const t = sweepCircle(ax, ay, bx, by, m.x[j], m.y[j], rad + m.radius[j]);
        if (t < 0 || pr.hasHit(i, m.id[j])) continue;
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
        const j = hitSlot[k];
        if (!m.alive[j]) continue;
        pr.recordHit(i, m.id[j]);
        damageMonster(w, j, pr.damage[i], pr.dtype[i], pr.critChance[i], pr.critMult[i], pr.ailmentChance[i], vx, vy, 1, true, pr.owner[i]);
        const pierce = pr.pierce[i];
        if (pierce === 0) {
          endT = hitT[k];
          ended = true;
          break;
        }
        if (pierce > 0) pr.pierce[i] = pierce - 1;
      }
    }

    const nx = ax + (bx - ax) * endT;
    const ny = ay + (by - ay) * endT;
    pr.x[i] = nx;
    pr.y[i] = ny;
    pr.range[i] -= Math.sqrt(vx * vx + vy * vy) * DT * endT;
    if (ended || (flight <= 0 && pr.range[i] <= 0) || nx * nx + ny * ny > outR2) endProjectile(w, i);
  }
}

/** Remove every hostile projectile (map cleared). */
export function clearHostileProjectiles(w: World): void {
  const pr = w.projectiles;
  for (let i = 0; i < pr.hwm; i++) if (pr.alive[i] && pr.hostile[i]) pr.release(i);
}
