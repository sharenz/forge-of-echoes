// The `expose` primitive (Searing Brand, Brittle Shards, Void Exposure, Magma Core's pool): hits lower the target's resistances
// for EXPOSURE.duration seconds (the strongest value per type applies; bosses and lieutenants take half: sim/combat.ts).
import type { AugmentRuntime } from '../../../contracts/sim';
import { exposeMonster } from '../../combat';
import type { World } from '../../world';

/** Expose monster slot `i` by the primitive's points per damage type (DAMAGE_TYPES order). */
export function applyExposure(w: World, i: number, e: Extract<AugmentRuntime, { p: 'expose' }>): void {
  const pts = e.points;
  for (let k = 0; k < pts.length; k++) if (pts[k] > 0) exposeMonster(w, i, k, pts[k]);
}
