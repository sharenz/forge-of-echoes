// Layout pack: ossuaryCrypt (L2). areaId -> layout for the Rimed Ossuary and Choral Crypt areas; src/data/layouts/index.ts
// spreads this record into AREA_LAYOUTS, so the central index is never touched. Sources: ../ossuary/*, ../crypt/*.
import type { AtlasAreaId } from '../../../contracts/atlas';
import type { AreaLayout } from '../schema';
import { BONE_APPROACH } from '../ossuary/boneApproach';
import { WINTER_THRONE } from '../ossuary/winterThrone';
import { SEALED_RELIQUARY } from '../ossuary/sealedReliquary';
import { ECHO_BASTION } from '../ossuary/echoBastion';
import { HOLLOW_OSSUARY } from '../ossuary/hollowOssuary';
import { GLASS_SEPULCHRE } from '../crypt/glassSepulchre';
import { FROZEN_PASSAGE } from '../crypt/frozenPassage';
import { RIFT_NEXUS } from '../crypt/riftNexus';

export const OSSUARY_CRYPT_LAYOUTS: Partial<Record<AtlasAreaId, AreaLayout>> = {
  boneApproach: BONE_APPROACH,
  winterThrone: WINTER_THRONE,
  sealedReliquary: SEALED_RELIQUARY,
  echoBastion: ECHO_BASTION,
  hollowOssuary: HOLLOW_OSSUARY,
  glassSepulchre: GLASS_SEPULCHRE,
  frozenPassage: FROZEN_PASSAGE,
  riftNexus: RIFT_NEXUS,
};
