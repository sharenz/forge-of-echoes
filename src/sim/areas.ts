// Ground areas: telegraphs that resolve once (slam / leap / eruption / meteor), damage-over-time
// ground (fire pools hurt players, fire trails hurt monsters) and the herald's following aura.
import type { AreaKind } from '../contracts/sim';
import { damageMonster, damagePlayer, isHittable } from './combat';
import { DT, FIRE_TRAIL_TICK, PLAYER_RADIUS } from './constants';
import { DAMAGE_INDEX } from './math';
import type { Area, World } from './world';

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
}

export function spawnArea(
  w: World, kind: AreaKind, x: number, y: number, radius: number, duration: number, opts: AreaOptions = {},
): Area {
  const tickInterval = opts.tickInterval ?? 0;
  const area: Area = {
    id: w.nextAreaId++,
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

/** Remove everything that could still hurt a player (map cleared). */
export function removeHostileAreas(w: World): void {
  for (const a of w.areas) if (a.hurts === 'player') a.dead = true;
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
    }
    a.age += DT;
    if (a.tickInterval > 0) {
      a.tickTimer -= DT;
      if (a.tickTimer <= 0) {
        a.tickTimer += a.tickInterval;
        applyAreaDamage(w, a, true);
      }
      if (a.age >= a.duration) a.dead = true;
    } else if (a.age >= a.duration) {
      a.age = a.duration;
      a.dead = true;
      if (a.kind !== 'heraldAura') {
        w.events.push({ t: 'areaResolve', kind: a.kind, x: a.x, y: a.y, radius: a.radius });
        applyAreaDamage(w, a, false);
        if (a.poolDuration > 0) {
          spawnArea(w, 'firePool', a.x, a.y, a.radius * 0.85, a.poolDuration, {
            damage: a.poolDamage, dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 0.25,
          });
        }
      }
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

function applyAreaDamage(w: World, a: Area, ticking: boolean): void {
  if (a.damage <= 0) return;
  if (a.hurts === 'player') {
    // Telegraphs and burning ground hurt every living player standing in them.
    const living = w.living;
    const r = a.radius + PLAYER_RADIUS * 0.5;
    for (let k = 0; k < living.length; k++) {
      const p = living[k];
      if (p.dead) continue;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      if (dx * dx + dy * dy <= r * r) damagePlayer(w, p, a.damage, a.dtype, ticking ? 'dot' : 'area');
    }
  } else if (a.hurts === 'monsters') {
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
