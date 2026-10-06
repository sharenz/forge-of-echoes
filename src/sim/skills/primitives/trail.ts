// The `trail` primitive: ground a skill leaves that hurts monsters only (Burning Wake along a wave's path, Kiln Ring where a flame
// ends, Frost Comb under each spike, Thunder Mark under each strike, Magma Core where a shell lands). Burning ground reuses the
// fireTrail area (one tick per monster per interval however many overlap); chilling ground and static fields are their own kinds.
// The area effect below adds what the core's area damage does not: the chill / shock of the ground and Magma Core's exposure.
import type { AugmentRuntime } from '../../../contracts/sim';
import { spawnArea } from '../../areas';
import { exposeMonster, isHittable } from '../../combat';
import { SHOCK_DURATION } from '../../constants';
import { registerAreaEffect } from '../../effects';
import { DAMAGE_INDEX } from '../../math';
import type { Area, World } from '../../world';

type Trail = Extract<AugmentRuntime, { p: 'trail' }>;

let QUERY = new Int32Array(0);

/** Chill / shock seconds the ground keeps topping up while a monster stands in it. */
const GROUND_AILMENT = 1;

/** Per-area extras (by area id): exposure points and whether it chills / shocks. */
const EXTRAS = new WeakMap<Area, { expose: number; ailment: boolean }>();

const GROUND = registerAreaEffect({
  onTick(w, a) {
    const x = EXTRAS.get(a);
    if (!x || (!x.ailment && !(x.expose > 0))) return;
    const m = w.monsters;
    if (QUERY.length < m.capacity) QUERY = new Int32Array(m.capacity);
    const reach = a.radius + w.grid.maxRadius;
    const n = w.grid.query(a.x - reach, a.y - reach, a.x + reach, a.y + reach, QUERY);
    for (let k = 0; k < n; k++) {
      const i = QUERY[k];
      if (!isHittable(w, i)) continue;
      const dx = m.x[i] - a.x;
      const dy = m.y[i] - a.y;
      const r = a.radius + m.radius[i];
      if (dx * dx + dy * dy > r * r) continue;
      if (x.expose > 0) exposeMonster(w, i, a.dtype, x.expose);
      if (!x.ailment) continue;
      if (a.kind === 'staticField') {
        if (m.shockTime[i] <= 0 && w.events.lowOpen) w.events.low({ t: 'ailment', ailment: 'shocked', x: m.x[i], y: m.y[i] });
        m.shockTime[i] = Math.max(m.shockTime[i], Math.min(SHOCK_DURATION, GROUND_AILMENT));
      } else {
        if (m.chillTime[i] <= 0 && w.events.lowOpen) w.events.low({ t: 'ailment', ailment: 'chilled', x: m.x[i], y: m.y[i] });
        m.chillTime[i] = Math.max(m.chillTime[i], GROUND_AILMENT);
      }
    }
  },
});

/** Leave the trail's ground at (x, y); `radius` is used when the primitive's own radius is 0 (the strike's or the spike's). */
export function spawnTrail(w: World, owner: number, t: Trail, x: number, y: number, radius = 0): void {
  const r = t.radius > 0 ? t.radius : radius;
  if (!(r > 0) || !(t.duration > 0)) return;
  const dtype = DAMAGE_INDEX[t.damageType];
  const a = spawnArea(w, t.area, x, y, r, t.duration, {
    // Always ticking (a zero-damage tick does nothing), so the ground fades silently instead of resolving like a telegraph.
    damage: t.damage > 0 ? t.damage : 0, dtype, hurts: 'monsters', tickInterval: t.interval > 0 ? t.interval : 0.5, firstTick: t.interval > 0 ? t.interval : 0.5,
    source: owner, debuff: null, effect: t.ailment || t.expose > 0 ? GROUND : 0,
  });
  if (t.ailment || t.expose > 0) EXTRAS.set(a, { expose: t.expose, ailment: t.ailment });
}
