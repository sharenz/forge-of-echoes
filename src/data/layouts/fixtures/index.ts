// Test fixtures and viewer samples. NOT registered for real areas (src/data/layouts/index.ts AREA_LAYOUTS stays empty
// until a layout pack lands), so no shipped behaviour or golden digest depends on them.
import type { AreaLayout } from '../schema';
import { SAND_RING } from './sand-ring';
import { SLAG_YARD } from './slag-yard';

export { SAND_RING, SLAG_YARD };
export const FIXTURE_LAYOUTS: readonly AreaLayout[] = [SLAG_YARD, SAND_RING];
