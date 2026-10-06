// The Atlas chart's node positions in art pixels on the 640 x 360 chart (brief A, section 4). Data, not art: the beacon radius rule
// (brief D 6.2) measures chart distance between node centres, so the rules and the chart read the same table.
import type { AtlasAreaId } from '../../contracts/atlas';

export const ATLAS_POS: Readonly<Record<AtlasAreaId, { x: number; y: number }>> = {
  cinderCrossing: { x: 50, y: 180 },
  emberRoad: { x: 120, y: 88 },
  boneApproach: { x: 118, y: 262 },
  emberVault: { x: 72, y: 40 },
  furnaceYard: { x: 190, y: 74 },
  glassSepulchre: { x: 190, y: 190 },
  ironMarch: { x: 190, y: 296 },
  shatteredForge: { x: 262, y: 60 },
  championsApproach: { x: 268, y: 306 },
  crownFoundry: { x: 334, y: 52 },
  winterThrone: { x: 334, y: 262 },
  sealedReliquary: { x: 330, y: 168 },
  emberCitadel: { x: 402, y: 48 },
  frozenPassage: { x: 402, y: 255 },
  lastKiln: { x: 470, y: 60 },
  echoBastion: { x: 470, y: 248 },
  heartOfForge: { x: 545, y: 68 },
  eternalArena: { x: 548, y: 286 },
  hollowOssuary: { x: 250, y: 228 },
  pitOfEchoes: { x: 108, y: 326 },
  shrineField: { x: 604, y: 36 },
  gildedVault: { x: 400, y: 168 },
  blackPit: { x: 470, y: 168 },
  huntingGround: { x: 545, y: 176 },
  riftNexus: { x: 604, y: 168 },
};
