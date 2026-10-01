// Layout pack: ashenChapel (slice L1). Maps areaId -> layout; src/data/layouts/index.ts spreads it into AREA_LAYOUTS, so
// packs never touch the central index. The layout source files live in ./ashen/ and ./chapel/ (one file per area).
import type { AtlasAreaId } from '../../../contracts/atlas';
import type { AreaLayout } from '../schema';
import { CINDER_CROSSING } from '../ashen/cinder-crossing';
import { EMBER_ROAD } from '../ashen/ember-road';
import { FURNACE_YARD } from '../ashen/furnace-yard';
import { SHATTERED_FORGE } from '../ashen/shattered-forge';
import { CROWN_FOUNDRY } from '../ashen/crown-foundry';
import { HEART_OF_FORGE } from '../ashen/heart-of-forge';
import { EMBER_VAULT } from '../chapel/ember-vault';
import { EMBER_CITADEL } from '../chapel/ember-citadel';
import { SHRINE_FIELD } from '../chapel/shrine-field';
import { BLACK_PIT } from '../chapel/black-pit';

export const ASHEN_CHAPEL_LAYOUTS: Partial<Record<AtlasAreaId, AreaLayout>> = {
  cinderCrossing: CINDER_CROSSING,
  emberRoad: EMBER_ROAD,
  furnaceYard: FURNACE_YARD,
  shatteredForge: SHATTERED_FORGE,
  crownFoundry: CROWN_FOUNDRY,
  heartOfForge: HEART_OF_FORGE,
  emberVault: EMBER_VAULT,
  emberCitadel: EMBER_CITADEL,
  shrineField: SHRINE_FIELD,
  blackPit: BLACK_PIT,
};
