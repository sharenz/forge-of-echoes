// Layout pack: chainworksColiseum. The pack agent fills this record (areaId -> layout); src/data/layouts/index.ts spreads it into
// AREA_LAYOUTS, so packs never touch the central index. Layout source files live in a folder next to this one.
import type { AtlasAreaId } from '../../../contracts/atlas';
import type { AreaLayout } from '../schema';
import { IRON_MARCH } from '../chainworks/ironMarch';
import { LAST_KILN } from '../chainworks/lastKiln';
import { GILDED_VAULT } from '../chainworks/gildedVault';
import { CHAMPIONS_APPROACH } from '../coliseum/championsApproach';
import { ETERNAL_ARENA } from '../coliseum/eternalArena';
import { PIT_OF_ECHOES } from '../coliseum/pitOfEchoes';
import { HUNTING_GROUND } from '../coliseum/huntingGround';

export const CHAINWORKS_COLISEUM_LAYOUTS: Partial<Record<AtlasAreaId, AreaLayout>> = {
  ironMarch: IRON_MARCH,
  lastKiln: LAST_KILN,
  gildedVault: GILDED_VAULT,
  championsApproach: CHAMPIONS_APPROACH,
  eternalArena: ETERNAL_ARENA,
  pitOfEchoes: PIT_OF_ECHOES,
  huntingGround: HUNTING_GROUND,
};
