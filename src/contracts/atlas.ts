// Persistent account discovery. Area definitions live in data; characters receive this shared projection.
export const ATLAS_AREA_IDS = [
  'cinderCrossing', 'emberRoad', 'boneApproach', 'emberVault', 'furnaceYard', 'glassSepulchre',
  'ironMarch', 'shatteredForge', 'championsApproach', 'crownFoundry', 'winterThrone', 'sealedReliquary',
  'emberCitadel', 'frozenPassage', 'lastKiln', 'echoBastion', 'heartOfForge', 'eternalArena',
  'hollowOssuary', 'pitOfEchoes', 'shrineField', 'gildedVault', 'blackPit', 'huntingGround', 'riftNexus',
] as const;
export type AtlasAreaId = (typeof ATLAS_AREA_IDS)[number];

export const MAP_TREE_NODE_IDS = ['trailblazer', 'chartKeeper', 'farHorizon', 'essenceSeeker', 'soundFoundations', 'deepSeams',
  'markedPrey', 'crowdedGrounds', 'apexHunt', 'scavenger', 'discerningEye', 'crownedChallenge',
  'strangeSigns', 'echoCompass', 'beyondTheVeil'] as const;
export type MapTreeNodeId = (typeof MAP_TREE_NODE_IDS)[number];

export interface AtlasProgress {
  /** Visible areas; unrevealed areas do not disclose their name, type or rewards. */
  discovered: AtlasAreaId[];
  /** Areas whose boss or required completion objective this account has defeated. */
  completed: AtlasAreaId[];
  /** Total credited objectives (a server run grants credit at most once per account). */
  clears: number;
  /** Account-wide map specialization. Missing on accounts that have not allocated a node. */
  nodes?: MapTreeNodeId[];
}
