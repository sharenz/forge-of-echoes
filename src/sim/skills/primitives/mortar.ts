// Cinder Mortar's flagship augments (power rework SK5), applied where a shell lands (../roster.ts MORTAR_SHELL calls in):
//   split 'land'  Cluster Shell: the shell bursts into bomblets that land within `range` of it, each a smaller blast at `share`
//   fuse          Delayed Fuse: the shell lies `delay` s, then explodes harder and wider (and only then leaves its burning ground)
//   skip          Skip Shot: after its blast the shell skips on toward where it flew, blasting again `count` times
//   trail 'land'  Magma Core: a molten pool that chills and exposes fire
// Rain of Shells (`scatter`) is in the lob emitter itself.
import type { AugmentRuntime } from '../../../contracts/sim';
import { spawnArea } from '../../areas';
import { TAU } from '../../math';
import { projSpec, spawnProjectile } from '../../projectiles';
import type { World } from '../../world';
import { augmentCue, burstAt } from './burst';
import { attachRider, riderOf } from './riders';
import { prim, schedule, type Rider } from './state';
import { spawnTrail } from './trail';

/** Seconds between Skip Shot's blasts and a bomblet's flight. */
export const SKIP_STEP = 0.2;
export const BOMBLET_FLIGHT = 0.25;

interface Shell {
  owner: number;
  damage: number;
  dtype: number;
  critChance: number;
  critMult: number;
  ailmentChance: number;
  radius: number;
  ground: { damage: number; time: number; radius: number; tick: number } | null;
}

function shellOf(w: World, slot: number): Shell {
  const pr = w.projectiles;
  return {
    owner: pr.owner[slot], damage: pr.damage[slot], dtype: pr.dtype[slot], critChance: pr.critChance[slot], critMult: pr.critMult[slot],
    ailmentChance: pr.ailmentChance[slot], radius: pr.splash[slot],
    ground: pr.groundDamage[slot] > 0 && pr.groundTime[slot] > 0 && pr.groundRadius[slot] > 0
      ? { damage: pr.groundDamage[slot], time: pr.groundTime[slot], radius: pr.groundRadius[slot], tick: pr.groundTick[slot] }
      : null,
  };
}

function blast(w: World, s: Shell, x: number, y: number, damage: number, radius: number): void {
  burstAt(w, {
    owner: s.owner, x, y, radius, damage, dtype: s.dtype, critChance: s.critChance, critMult: s.critMult, ailmentChance: s.ailmentChance,
    knock: 1,
  });
}

function ground(w: World, s: Shell, x: number, y: number): void {
  const g = s.ground;
  if (!g) return;
  spawnArea(w, 'fireTrail', x, y, g.radius, g.time, {
    damage: g.damage, dtype: s.dtype, hurts: 'monsters', tickInterval: g.tick, firstTick: g.tick, source: s.owner,
  });
}

/**
 * A shell with a rider landed at (x, y). Returns true when an augment took over the landing (Cluster Shell, Delayed Fuse); false
 * lets the plain blast and ground happen (then afterShell adds Skip Shot and Magma Core).
 */
export function shellLanded(w: World, slot: number, x: number, y: number, shellEffect: number): boolean {
  const r = riderOf(w, slot);
  if (!r || r.child) return false;
  const def = r.def;
  const s = shellOf(w, slot);
  const cluster = prim(def, 'split');
  if (cluster && cluster.on === 'land') {
    augmentCue(w, s.owner, 'split', x, y, cluster.range, s.dtype);
    const rng = w.combatRng;
    for (let k = 0; k < cluster.count; k++) {
      const d = cluster.range * Math.sqrt(rng.next());
      const a = rng.next() * TAU;
      const sp = projSpec;
      sp.kind = w.projectiles.kind[slot];
      sp.hostile = false;
      sp.owner = s.owner;
      sp.x = x;
      sp.y = y;
      sp.angle = a;
      sp.speed = d / BOMBLET_FLIGHT;
      sp.range = d;
      sp.radius = 4;
      sp.damage = s.damage * cluster.share;
      sp.dtype = s.dtype;
      sp.critChance = s.critChance;
      sp.critMult = s.critMult;
      sp.ailmentChance = s.ailmentChance;
      sp.pierce = 0;
      const b = spawnProjectile(w, sp, BOMBLET_FLIGHT);
      if (b < 0) continue;
      w.projectiles.splash[b] = s.radius * cluster.seek;
      w.projectiles.effect[b] = shellEffect;
      attachRider(w, b, def, s.owner, true);
    }
    ground(w, s, x, y);
    afterShell(w, r, s, x, y);
    return true;
  }
  const fuse = prim(def, 'fuse');
  if (fuse) {
    augmentCue(w, s.owner, 'lodge', x, y, s.radius, s.dtype);
    const p = w.playerById[s.owner];
    if (!p) return true;
    schedule(p, w.time + fuse.delay, (ww) => {
      const radius = s.radius * (1 + fuse.radiusPct / 100);
      augmentCue(ww, s.owner, 'detonate', x, y, radius, s.dtype);
      blast(ww, s, x, y, s.damage * (1 + fuse.more), radius);
      ground(ww, s, x, y);
      afterShell(ww, r, s, x, y);
    });
    return true;
  }
  return false;
}

/** After the plain landing: Skip Shot's skips and Magma Core's pool. */
export function afterShellAt(w: World, slot: number, x: number, y: number): void {
  const r = riderOf(w, slot);
  if (!r || r.child) return;
  afterShell(w, r, shellOf(w, slot), x, y);
}

function afterShell(w: World, r: Rider, s: Shell, x: number, y: number): void {
  const def = r.def;
  const magma = prim(def, 'trail');
  if (magma && magma.at === 'land') spawnTrail(w, s.owner, magma, x, y, s.radius);
  const skip = prim(def, 'skip');
  if (!skip) return;
  const p = w.playerById[s.owner];
  if (!p) return;
  let dx = x - r.fromX;
  let dy = y - r.fromY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const lim = Math.max(0, w.arenaRadius - 8);
  for (let k = 1; k <= skip.count; k++) {
    const sx = x + dx * skip.gap * k;
    const sy = y + dy * skip.gap * k;
    if (sx * sx + sy * sy > lim * lim) break;
    schedule(p, w.time + SKIP_STEP * k, (ww) => {
      augmentCue(ww, s.owner, 'detonate', sx, sy, s.radius, s.dtype);
      blast(ww, s, sx, sy, s.damage * skip.share, s.radius);
    });
  }
}
