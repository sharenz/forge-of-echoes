// Persistent account discovery. Area definitions live in data; characters receive this shared projection.
export const ATLAS_AREA_IDS = [
  'cinderCrossing', 'emberRoad', 'boneApproach', 'emberVault', 'furnaceYard', 'glassSepulchre',
  'ironMarch', 'shatteredForge', 'championsApproach', 'crownFoundry', 'winterThrone', 'sealedReliquary',
  'emberCitadel', 'frozenPassage', 'lastKiln', 'echoBastion', 'heartOfForge', 'eternalArena',
  'hollowOssuary', 'pitOfEchoes', 'shrineField', 'gildedVault', 'blackPit', 'huntingGround', 'riftNexus',
] as const;
export type AtlasAreaId = (typeof ATLAS_AREA_IDS)[number];

/** Atlas tree node id (data-driven: the ~148 node ids live in data/progression/map-tree; `legacy:` ids belong to expeditions frozen before the Codex redraw). */
export type MapTreeNodeId = string;

/** Bumped when the tree is redrawn; an account below it gets one free refund of its old allocation. */
export const ATLAS_TREE_VERSION = 2;

/** The twelve encounter kinds that each grant one Atlas point on their first completion (brief C). */
export const ATLAS_EVENT_KIND_IDS = [
  'stalker', 'echoing', 'caravan', 'rivalCrowns', 'fault', 'emberRelay',
  'pactAltar', 'orchard', 'ring', 'host', 'anvil', 'bellwatch',
] as const;
export type AtlasEventKindId = (typeof ATLAS_EVENT_KIND_IDS)[number];

export interface AtlasProgress {
  /** Visible areas; unrevealed areas do not disclose their name, type or rewards. */
  discovered: AtlasAreaId[];
  /** Areas whose boss or required completion objective this account has defeated. */
  completed: AtlasAreaId[];
  /** Total credited objectives (a server run grants credit at most once per account). */
  clears: number;
  /** Account-wide map specialization. Missing on accounts that have not allocated a node. */
  nodes?: MapTreeNodeId[];
  /** Tree edition of `nodes`; missing or old = the pre-Codex 15-node tree (migrated once, see normalizeAtlas). */
  treeVersion?: number;
  /** Map tiers (2..15) this account has cleared at least once: one Atlas point each. */
  tiersCleared?: number[];
  /** Encounter kinds completed at least once: one Atlas point each. */
  eventsSeen?: AtlasEventKindId[];
  /** Final bosses (monster kinds) killed at least once: one Atlas point each. */
  bossesSeen?: string[];
  /** Refunds ever made (the first ATLAS_FREE_REFUNDS cost nothing). */
  refunds?: number;
  /** Scrap paid for refunds in the current respec session (capped; reset when a map is opened). */
  respecSpent?: number;
  /** True once the old tree was refunded free by the Codex redraw (UI shows the notice). */
  redrawn?: boolean;
  /** Daily surge ledger (brief D 7.1): the forge-day index (04:00 UTC to 04:00 UTC) and the charges spent per area that day. Reset lazily by the server clock. */
  surge?: AtlasSurge;
  /**
   * Pinned areas (brief D 5.1): their maps drop x3 more often (frozen into every expedition at activation). Discovered,
   * non-sealed, non-Pit areas only; at most `pinSlotCount(nodes)` (3, more through the tree). Account-wide, free to change.
   */
  pins?: AtlasAreaId[];
  /**
   * Beacons (brief D 6): every completed area is a beacon with 1 or 2 slots; a slot holds one sigil and its remaining uses (null = empty).
   * Keys are completed areas only; slot arrays never exceed the area's slot count. Account-wide; changed in a hideout only.
   */
  beacons?: Partial<Record<AtlasAreaId, (BeaconSlot | null)[]>>;
}

/** One filled beacon slot: the sigil and the activations it has left (it empties at 0). */
export interface BeaconSlot {
  sigilId: import('./content').SigilId;
  uses: number;
  /** Uses it was slotted with (12 or 10, more with Lamp Oil): a sigil taken out unused (uses === max) goes back to the backpack. */
  max: number;
}

/** Charges spent per area on one forge day. `day` is `forgeDay(server now)`; a stored day before today means nothing is spent. */
export interface AtlasSurge {
  day: number;
  spent: Partial<Record<AtlasAreaId, number>>;
}
