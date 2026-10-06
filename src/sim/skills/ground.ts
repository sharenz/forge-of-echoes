// Ground effects the player leaves (the `trail` primitive's first user: Cinderwalkers' burning footsteps).
import { spawnArea } from '../areas';
import { DT, FIRE_TRAIL_DAMAGE, FIRE_TRAIL_DURATION, FIRE_TRAIL_INTERVAL, FIRE_TRAIL_RADIUS, FIRE_TRAIL_TICK } from '../constants';
import { DAMAGE_INDEX } from '../math';
import type { PlayerState, World } from '../world';

/** Cinderwalkers: while moving, leave burning ground behind that damages monsters. */
export function tickFireTrail(w: World, p: PlayerState, moving: boolean): void {
  if (!p.flags.has('fireTrail')) return;
  p.trailTimer -= DT;
  if (!moving || p.trailTimer > 0) return;
  p.trailTimer = FIRE_TRAIL_INTERVAL;
  const basic = p.skills.get('emberLance');
  const damage = (basic ? basic.damage : 5) * FIRE_TRAIL_DAMAGE;
  spawnArea(w, 'fireTrail', p.x, p.y, FIRE_TRAIL_RADIUS, FIRE_TRAIL_DURATION, {
    damage, dtype: DAMAGE_INDEX.fire, hurts: 'monsters', tickInterval: FIRE_TRAIL_TICK, firstTick: 0.1, source: p.id,
  });
}
