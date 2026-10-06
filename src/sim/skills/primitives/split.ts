// The `split` primitive: child projectiles of a player projectile, at a share of its damage. Children are plain shots of the same
// kind (the parent's conversion rides along) and never split, lodge or return themselves.
//   kill  Cinder Fragments: from the corpse, one fragment at each of the nearest enemies within `seek` (the rest fan out evenly)
//   end   Splintering: where the shot ends (range or wall), `count` splinters spread evenly round
//   hit   Entropic Split: at the first hit, two bolts at ±arc/2 of its heading (sparing the struck enemy)
// (`land`, Cluster Shell's bomblets, lives with the mortar: ./mortar.ts.)
import type { AugmentRuntime } from '../../../contracts/sim';
import { isHittable } from '../../combat';
import { coverBlocked } from '../../cover';
import { TAU } from '../../math';
import { projSpec, spawnProjectile } from '../../projectiles';
import type { World } from '../../world';
import { augmentCue } from './burst';
import { attachRider } from './riders';
import type { Rider } from './state';

type Split = Extract<AugmentRuntime, { p: 'split' }>;

let QUERY = new Int32Array(0);

/** Spawn one child of projectile slot `parent` from (x, y) heading `angle`. */
function child(w: World, parent: number, rider: Rider, x: number, y: number, angle: number, k: Split, skip: number): void {
  const pr = w.projectiles;
  const s = projSpec;
  s.kind = pr.kind[parent];
  s.hostile = false;
  s.owner = pr.owner[parent];
  s.x = x;
  s.y = y;
  s.angle = angle;
  s.speed = Math.hypot(pr.vx[parent], pr.vy[parent]) || 300;
  s.range = k.range;
  s.radius = pr.radius[parent];
  s.damage = pr.damage[parent] * k.share;
  s.dtype = pr.dtype[parent];
  s.critChance = pr.critChance[parent];
  s.critMult = pr.critMult[parent];
  s.ailmentChance = pr.ailmentChance[parent];
  s.convTo = pr.convTo[parent];
  s.convShare = pr.convShare[parent];
  s.pierce = 0;
  const slot = spawnProjectile(w, s);
  if (slot < 0) return;
  if (skip >= 0) pr.recordHit(slot, skip);
  attachRider(w, slot, rider.def, rider.owner, true);
}

/** Children of projectile slot `parent` (rider `rider`) for trigger `on` at (x, y). `skip`: a monster id they spare. */
export function splitAt(w: World, parent: number, rider: Rider, k: Split, x: number, y: number, skip = -1): void {
  const pr = w.projectiles;
  const heading = Math.atan2(pr.vy[parent], pr.vx[parent]);
  augmentCue(w, rider.owner, 'split', x, y, 10, pr.dtype[parent]);
  if (k.on === 'hit') {
    for (let c = 0; c < k.count; c++) {
      const a = k.count === 1 ? heading : heading - k.arc / 2 + (k.arc * c) / (k.count - 1);
      child(w, parent, rider, x, y, a, k, skip);
    }
    return;
  }
  if (k.on === 'end') {
    // At a wall the splinters come back out of it: spread round from the reverse heading.
    for (let c = 0; c < k.count; c++) child(w, parent, rider, x, y, heading + Math.PI + (TAU * c) / k.count, k, skip);
    return;
  }
  // kill: aim at the nearest enemies in reach (each once), spread the rest evenly from the heading.
  const m = w.monsters;
  if (QUERY.length < m.capacity) QUERY = new Int32Array(m.capacity);
  const pad = k.seek + w.grid.maxRadius;
  const n = w.grid.query(x - pad, y - pad, x + pad, y + pad, QUERY);
  const near: { d: number; a: number; id: number }[] = [];
  for (let q = 0; q < n; q++) {
    const i = QUERY[q];
    if (!isHittable(w, i) || m.id[i] === skip) continue;
    const dx = m.x[i] - x;
    const dy = m.y[i] - y;
    const d = Math.hypot(dx, dy);
    if (d > k.seek + m.radius[i] || coverBlocked(w, x, y, m.x[i], m.y[i], 0)) continue;
    near.push({ d, a: Math.atan2(dy, dx), id: m.id[i] });
  }
  near.sort((a, b) => a.d - b.d || a.id - b.id);
  for (let c = 0; c < k.count; c++) {
    const a = c < near.length ? near[c].a : heading + (TAU * c) / k.count;
    child(w, parent, rider, x, y, a, k, skip);
  }
}
