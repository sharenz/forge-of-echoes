// FROZEN CONTRACT — the pure game-rules API (src/game/index.ts must `export const rules: GameRulesApi`).
// Every function is pure: it takes a CharacterSave and returns a NEW CharacterSave (never mutates input).
// Randomness outside runs comes from CharacterSave.rngState (advance it and store the new state).
import type {
  Attribute, BaseId, CurrencyId, DamageType, EquipSlot, FlaskId, ItemClass, MapBaseId, SkillId, Theme, UniqueId,
} from './content';
import type {
  CharacterSave, Item, ItemDescription, ItemLocation, MapItem, SaveGame, StatBreakdown, StatId,
} from './items';
import type { DropSpec, KillLootContext, PlayerCombatStats, PlayerRuntime, RunConfig, RunHooks, SkillRuntimeDef } from './sim';
import type { Rng } from './rng';
import type { AtlasAreaId, MapTreeNodeId } from './atlas';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Read-only content info for the UI
// ---------------------------------------------------------------------------

export interface BaseInfo {
  id: BaseId;
  name: string;
  itemClass: ItemClass;
  slots: EquipSlot[];
  size: { w: number; h: number };
  levelRequirement: number;
  maxStability: number;
  /** Short material note, e.g. "Ashwood: fire affixes are twice as likely". */
  materialNote: string;
}

export interface CurrencyInfo {
  id: CurrencyId;
  name: string;
  /** Verb-first effect text, e.g. "Reforges all unsealed affixes into a new rare item." */
  description: string;
  family: 'shape' | 'refine' | 'remove' | 'preserve' | 'transform' | 'map';
  stabilityCost: number;
  maxStack: number;
  /** Needs the player to pick one affix line on the target after clicking the item. */
  needsAffixChoice: boolean;
}

export interface SkillInfo {
  id: SkillId;
  name: string;
  description: string;
  branch: 'basic' | 'destruction' | 'survival' | 'mobility';
  /** Row in the skill tree (1 = top). */
  tier: number;
  prerequisite: { skillId: SkillId; rank: number } | null;
  maxRank: number;
  tags: string[];
  damageType: DamageType | null;
}

export interface MapBaseInfo {
  id: MapBaseId;
  name: string;
  theme: Theme;
  implicit: string;
  description: string;
}

export interface FlaskInfo {
  id: FlaskId;
  name: string;
  description: string;
  resource: 'life' | 'focus';
}

export interface UniqueInfo {
  id: UniqueId;
  name: string;
  baseId: BaseId;
  flavor: string;
}

export interface ContentInfo {
  bases: Record<BaseId, BaseInfo>;
  currencies: Record<CurrencyId, CurrencyInfo>;
  skills: Record<SkillId, SkillInfo>;
  mapBases: Record<MapBaseId, MapBaseInfo>;
  flasks: Record<FlaskId, FlaskInfo>;
  uniques: Record<UniqueId, UniqueInfo>;
}

// ---------------------------------------------------------------------------
// Derived character stats (character sheet)
// ---------------------------------------------------------------------------

export interface SheetLine {
  label: string;       // "Maximum Life"
  value: string;       // "412"
  /** Human breakdown lines: "Base 90", "+48 from Strength", "+30% increased from items" … */
  breakdown: string[];
}

export interface SheetSection {
  title: string;       // "Offence", "Defence", "Resources", "Luck"
  lines: SheetLine[];
}

export interface SkillSheet {
  skillId: SkillId;
  rank: number;
  runtime: SkillRuntimeDef;
  /** Human-readable lines for tooltips: "Deals 38–57 Fire damage", "Fires 18 projectiles"… */
  lines: string[];
  /** Lines describing what the next rank adds (empty at max rank). */
  nextRankLines: string[];
  dps: number | null;  // average damage per second for a single target estimate
}

export interface DerivedStats {
  combat: PlayerCombatStats;
  attributes: Record<Attribute, number>;
  itemQuantity: number;  // % increased from gear
  itemRarity: number;    // % increased from gear
  sections: SheetSection[];
  /** Raw resolver breakdowns per stat (for debugging / detailed tooltips). */
  breakdowns: Partial<Record<StatId, StatBreakdown>>;
}

// ---------------------------------------------------------------------------
// Maps & runs
// ---------------------------------------------------------------------------

export interface BenchService {
  id: string;
  label: string;
  lines: string[];
  cost: { currencyId: CurrencyId; count: number }[];
  available: boolean;
  reason?: string;
}

export interface MapSummaryLine {
  label: string;        // "Item Quantity"
  value: string;        // "+64%"
  breakdown: string[];  // "+22% Teeming", "+12% Tier 4" …
}

/** How a map reaches an area other than its own (brief D 2.5). */
export type RunPassage = { kind: 'key'; currencyId: import('./content').CurrencyId } | { kind: 'bounty' };

/** One sigil frozen into an expedition (brief D 6.3): which beacon slot it sat in and the share it works at (stacking rule). */
export interface RunTerritory {
  sigilId: import('./content').SigilId;
  /** The beacon (a completed area) holding the sigil. */
  fromAreaId: AtlasAreaId;
  /** The slot index in that beacon: a server-loss refund gives the use back to exactly this slot. */
  slot: number;
  /** 1 = the strongest sigil of its kind on this run, 0.5 = every other one of that kind. */
  share: number;
}

/** How a routing candidate relates to the run's area (brief D 4.2); the readout groups by it. */
export type RouteKind = 'own' | 'neighbour' | 'deadEnd' | 'wander' | 'pending' | 'pinned';

/** Frozen drop routing of an expedition (brief D 2.2, built by slice R1 in game/progression/map-routing.ts). */
export interface MapRouting {
  /** The area the table is centred on: the map's bound area (a passage run keeps the map's own area, not the sealed one). */
  from: AtlasAreaId;
  /** Final weights (pins and scarab biases already multiplied in). `kind` is the base class, `pinned` marks a pin. */
  candidates: { areaId: AtlasAreaId; weight: number; kind?: RouteKind; pinned?: true; pending?: true }[];
  /** The chest upgrade's destination for the map's own tier (D 4.4); absent when no charted or pending area accepts the next tier. */
  advance?: AtlasAreaId;
  tierOffsets: { offset: number; weight: number }[];
  chestUpgradeBonus: number;
}

/** What the player chose at the Map Device. The map itself decides the area; there is no area argument. */
export interface OpenMapOptions {
  lootClass?: import('./content').ItemClass;
  /** A loaded key or the Bounty/Pit passage; absent = the map runs its own area. */
  passage?: RunPassage;
  /** Spend one surge charge of the run's area for the surge bonus (brief D 7.2). Absent or false: the run is normal and keeps its charge. */
  useSurge?: boolean;
  /** Server clock (ms): decides the forge day. Without it no surge can be spent (the run is simply normal). */
  now?: number;
}

export interface RunSetup {
  /** Consumed scarabs, fixed for this expedition and shared by its party. */
  scarabs?: import('./content').ScarabId[];
  /** Opening account’s map nodes, frozen for the whole expedition and all party members. */
  mapTree?: MapTreeNodeId[];
  /** Tree edition of `mapTree` (absent on expeditions frozen before the Codex redraw: their ids are the legacy tree). */
  mapTreeV?: number;
  /** Creation roll, omitted from client projections; absent on pre-event maps. */
  event?: import('./map-events').MapEventPlan | null;
  map: MapItem;         // effective map: item tier/quality/mods with the Atlas area's theme/implicit
  /** Original item for restart refunds when the chosen area changed its base. */
  sourceMap?: MapItem;
  /** The area actually run: `sourceMap.areaId`, or the passage destination (a sealed area through its key, the Pit of Echoes through a Bounty). */
  atlasAreaId?: AtlasAreaId;
  /** Set when a passage redirected the map; `sourceMap.areaId` is then the bound area that was bypassed. */
  passage?: RunPassage;
  /** Frozen drop routing for every map this expedition drops (brief D 2.2, 4). Built by openMap (map-routing.ts), persisted and restored; absent on runs frozen before routing (their maps roll a theme). */
  routing?: MapRouting;
  /**
   * The surge of this expedition (brief D 7): the area whose charge was spent, the "more" bonuses it gives (item quantity everywhere
   * except the map category, item rarity) and the forge day. `kept` = the tree's Afterglow kept the charge: the bonus applies but
   * nothing was spent, so nothing is refunded. Frozen, persisted and restored with the run; guests get the bonus but never spend.
   */
  surge?: { areaId: AtlasAreaId; quantityMore: number; rarityMore: number; day: number; kept?: true };
  /**
   * Territory (brief D 6, slice B1): the sigils of the opener's beacons covering the run's area, frozen at activation (I5). One entry per
   * sigil whose effect applied (that sigil spent one use); `share` is 1 for the strongest of a kind and 0.5 for every other of that kind.
   * The effects are read by the rules through `territory.ts` (map modifiers, event chance, reveal chance, currency and class weights).
   */
  territory?: RunTerritory[];
  /** Layout edition run (slice L0; unused in T0). */
  layoutV?: number;
  /** Actual Scrap entry fee paid; absent on legacy/free maps. Returned only for server-side run loss. */
  entranceScrap?: number;
  /** Exact key paid at entry, retained for atomic restart refunds. */
  entranceKey?: import('./content').CurrencyId;
  /** Owner's chosen Hunting Ground reward class, fixed for the expedition and its party. */
  lootClass?: import('./content').ItemClass;
  /** The account's first map (first-run guide): a gentle opening, see RunConfig.warmup. Set by the server at activation; not persisted across restarts. */
  warmup?: true;
  seed: number;
  monsterLevel: number;
  /** Map-side item quantity % (100 = base): tier + mods + quality + implicit. Excludes any player's gear. */
  itemQuantity: number;
  /** Map-side item rarity % (100 = base). Excludes any player's gear. */
  itemRarity: number;
  /** Map-side summary lines (danger, monster scaling, map luck). */
  summary: MapSummaryLine[];
}

export interface RunEndInput {
  result: 'cleared' | 'failed' | 'abandoned';
  tier: number;
  kills: number;
  seconds: number;
  raresFound: number;
  uniquesFound: number;
}

// ---------------------------------------------------------------------------
// Merchant
// ---------------------------------------------------------------------------

export interface MerchantOffer {
  id: string;
  kind: 'map' | 'flask' | 'currency' | 'gamble';
  label: string;
  description: string;
  /** Preview of the item received (null for gambles). */
  item: Item | null;
  /** Gamble target class. */
  gambleClass?: ItemClass;
  price: { currencyId: CurrencyId; count: number }[];
  affordable: boolean;
}

/** How lucky a ware is: the luck model of Rook's wares board (GAME_SPEC §9). */
export type WareQuality = 'junk' | 'okay' | 'good' | 'jackpot';

/** One slot of a character's wares board: the exact item (a preview with uid `ware:<epoch>:<slot>`), its price and whether it is sold. */
export interface MerchantWare {
  /** `ware:<epoch>:<slot>`: what `buyWare` takes. The epoch is part of the id, so a stale purchase is refused. */
  id: string;
  /** 0-3 maps (0 is Rook's plain map), 4-11 items (4 is Rook's pick). */
  slot: number;
  kind: 'map' | 'item';
  item: Item;
  quality: WareQuality;
  /** The first item slot: doubled odds of a good find. */
  featured: boolean;
  /** The one cheap plain map every board carries. */
  guaranteed: boolean;
  price: { currencyId: CurrencyId; count: number }[];
  sold: boolean;
}

/** A character's wares board, built by the server (stock is deterministic per epoch; the client never rolls it). */
export interface MerchantBoard {
  /** `<rotation>.<level>.<rerolls>`: any change means new wares. */
  epoch: string;
  rotation: number;
  level: number;
  rerolls: number;
  wares: MerchantWare[];
  /** Server time (ms) the rotation ends, and the server time this board was built at. */
  nextRotationAt: number;
  serverNow: number;
  /** Scrap price of "Ask for new wares" right now. */
  rerollCost: number;
}

export interface DebugMerchantOptions {
  quantity: number;
  itemLevel: number;
  mapTier: number;
  rarity: 'normal' | 'magic' | 'rare';
}

// ---------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------

export interface CraftOutcome {
  character: CharacterSave;
  /** Short line for a toast/history: "Ember Essence added Blazing (T4)". */
  message: string;
  kind: 'success' | 'scar' | 'finished' | 'corrupted' | 'nothing';
  targetUid: string;
}

// ---------------------------------------------------------------------------
// Crafting bench (deterministic "scaffolding": add a chosen affix at a fixed, modest tier for a price)
// ---------------------------------------------------------------------------

export interface BenchRecipe {
  id: string;
  affixId: string;
  kind: 'prefix' | 'suffix';
  /** Display text with the value range, e.g. "+(22–34) to maximum Life". */
  label: string;
  /** Affix tier the bench grants for this item (bench tiers are capped — never the best tiers). */
  tier: number;
  tags: string[];
  cost: { currencyId: CurrencyId; count: number }[];
  stabilityCost: number;
  /** Can be applied right now to the target (room, group free, item level, not finished, affordable, no crafted affix yet). */
  available: boolean;
  /** Player-facing reason when not available. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

export interface GameRulesApi {
  readonly content: ContentInfo;

  // --- save ---
  newSave(): SaveGame;
  /** Parse + migrate + normalise; never throws (returns a fresh save on garbage). */
  parseSave(json: string | null): SaveGame;
  serializeSave(save: SaveGame): string;

  // --- character ---
  createCharacter(name: string, seed: number): CharacterSave;
  /** `setup` (optional) folds in map penalties that affect the player (Hexed, Exhausting, …). */
  deriveStats(ch: CharacterSave, setup?: RunSetup | null): DerivedStats;
  xpToNext(level: number): number;
  grantXp(ch: CharacterSave, amount: number): { character: CharacterSave; levelsGained: number };
  allocateAttribute(ch: CharacterSave, attr: Attribute): Result<CharacterSave>;
  canRankUpSkill(ch: CharacterSave, skillId: SkillId): { ok: boolean; reason?: string };
  rankUpSkill(ch: CharacterSave, skillId: SkillId): Result<CharacterSave>;
  /** Slot 0 accepts only the basic attack; skills need rank >= 1; a skill may occupy only one slot. */
  setLoadoutSlot(ch: CharacterSave, slot: number, skillId: SkillId | null): Result<CharacterSave>;
  skillSheet(ch: CharacterSave, skillId: SkillId, rank?: number): SkillSheet;

  // --- items & inventory ---
  describeItem(item: Item, ch?: CharacterSave): ItemDescription;
  itemSize(item: Item): { w: number; h: number };
  findItem(ch: CharacterSave, uid: string): { item: Item; location: ItemLocation } | null;
  canEquip(ch: CharacterSave, item: Item, slot: EquipSlot): { ok: boolean; reason?: string };
  /** Move an item (grid ↔ grid, equip/unequip, belt, map device). Merges stacks; swaps with a single blocking item when it fits back. */
  moveItem(ch: CharacterSave, uid: string, to: ItemLocation, count?: number): Result<CharacterSave>;
  /** Ctrl-click: backpack ↔ open stash tab (normal or special), or equip/unequip, or load flasks into the belt. `count` withdraws a partial stack. */
  quickMove(ch: CharacterSave, uid: string, ctx: { stashTab: number | 'currency' | 'mapCurrency' | 'maps' | null; count?: number }): Result<CharacterSave>;
  /** Move every currency stack from the backpack into the Crafting Stash. */
  depositAllCurrency(ch: CharacterSave): Result<CharacterSave>;
  /** Place a new item into the backpack (stacking where possible). Fails when there is no room. */
  addToBackpack(ch: CharacterSave, item: Item): Result<CharacterSave>;
  discardItem(ch: CharacterSave, uid: string): Result<CharacterSave>;
  addStashTab(ch: CharacterSave): Result<CharacterSave>;
  renameStashTab(ch: CharacterSave, tab: number, name: string): Result<CharacterSave>;
  clearNewFlags(ch: CharacterSave): CharacterSave;
  /** Stat deltas (current → candidate) for Alt-compare; one entry per equipped item it would replace. */
  compareWithEquipped(ch: CharacterSave, item: Item): { slot: EquipSlot; lines: { label: string; from: string; to: string; delta: number }[] }[];

  // --- crafting ---
  /** null when the currency can be applied to the target; otherwise a player-facing reason. */
  craftingTargetError(ch: CharacterSave, currencyUid: string, targetUid: string): string | null;
  /** Exact odds / effects preview lines for the tooltip, e.g. "Adds one of 4 fire affixes: Blazing 38% …". */
  craftPreview(ch: CharacterSave, currencyUid: string, targetUid: string): string[];
  applyCurrency(ch: CharacterSave, currencyUid: string, targetUid: string, affixIndex?: number): Result<CraftOutcome>;
  /** Every bench recipe that fits the target's item class, with availability and cost. Empty for non-equipment. */
  benchRecipes(ch: CharacterSave, targetUid: string): BenchRecipe[];
  benchServices(ch: CharacterSave, targetUid: string): BenchService[];
  applyBenchRecipe(ch: CharacterSave, targetUid: string, recipeId: string): Result<CraftOutcome>;
  /** Remove the target's bench-crafted affix (free; keeps stability spent). */
  clearCraftedAffix(ch: CharacterSave, targetUid: string): Result<CraftOutcome>;

  setMapTreeNode(ch: CharacterSave, nodeId: MapTreeNodeId, allocate: boolean): Result<CharacterSave>;
  /** Pin or unpin an Atlas area (brief D 5.1): free and instant, at most `pinSlotCount` pins; validated like the server. */
  setPin(ch: CharacterSave, areaId: AtlasAreaId, pinned: boolean): Result<CharacterSave>;
  /** Preview of Recycle (three maps of one tier into one Normal map, brief D 5.3): price, output quality, legal target areas, why not. */
  recycleQuote(ch: CharacterSave, uids: readonly string[], areaId?: AtlasAreaId): { error: string | null; scrap: number; quality: number; tier: number | null; targets: AtlasAreaId[] };
  /** Recycle three maps into one Normal map of `areaId` (atomic: pays Scrap, removes the three, files the new one in the backpack). */
  recycleMaps(ch: CharacterSave, uids: readonly string[], areaId: AtlasAreaId): Result<CraftOutcome & { item: MapItem; scrap: number }>;

  // --- maps & runs ---
  mapSummary(ch: CharacterSave, map: MapItem): MapSummaryLine[];
  /** Consume the map in the device and produce run parameters (map-side luck only). */
  openMap(ch: CharacterSave, opts?: OpenMapOptions): Result<{ character: CharacterSave; setup: RunSetup; /** Beacon slots that burned out at activation (the banner). */ notices?: string[] }>;
  /**
   * Use one Hourglass Sand on an Atlas area, or one Grand Hourglass on every area (brief D 7.4): the item leaves the inventory or stash and
   * the daily surge ledger is reset. Refused, spending nothing, when everything it would refill is already full. `now` is the server clock.
   */
  refillSurge(ch: CharacterSave, target: { kind: 'area'; areaId: AtlasAreaId } | { kind: 'all' }, now: number): Result<{ character: CharacterSave; message: string }>;
  /**
   * Slot one sigil from the backpack stack `uid` into slot `slot` of the beacon `areaId` (brief D 6, a completed area). A filled slot is
   * replaced: the old sigil is consumed (a never-used one goes back to the backpack). Atomic; validated like the server.
   */
  slotSigil(ch: CharacterSave, areaId: AtlasAreaId, slot: number, uid: string): Result<{ character: CharacterSave; message: string }>;
  /** Take the sigil out of a beacon slot: a never-used one returns to the backpack, a used one is consumed (its uses cannot be recovered). */
  unslotSigil(ch: CharacterSave, areaId: AtlasAreaId, slot: number): Result<{ character: CharacterSave; message: string }>;
  /** Build the instance sim config (players join separately via SimRun.addPlayer). `setup` null = hideout. */
  buildRunConfig(setup: RunSetup | null, hooks: RunHooks): RunConfig;
  /** One player's resolved stats/skills/loadout/belt for an instance (after joining, level-ups, gear or flask changes). */
  playerRuntime(ch: CharacterSave, setup: RunSetup | null): PlayerRuntime;
  /** Personal luck: final quantity/rarity % for `looter` in this map (map-side luck + looter's gear). */
  lootLuck(setup: RunSetup, looter: CharacterSave): { itemQuantity: number; itemRarity: number };
  /** Instanced loot for ONE player (uses lootLuck(setup, looter)). */
  rollKillLoot(setup: RunSetup, ctx: KillLootContext, rng: Rng, looter: CharacterSave): Item[];
  /** `boons`: the Wayside Anvil's boons for the chest's equipment (absent = the ordinary chest). */
  rollChestLoot(setup: RunSetup, rng: Rng, looter: CharacterSave, boons?: import('./map-events').ChestBoons): Item[];
  /** What one map event pays ONE player (Event Director v2; Bronze = the classic payout). */
  rollEventReward(setup: RunSetup, ctx: import('./map-events').EventRewardContext, rng: Rng, looter: CharacterSave): Item[];
  /**
   * Describe a ground drop (label/tone/sprite/icon/autoPickup) — token and owner are assigned by the caller.
   * autoPickup: equipment false, everything else true; `playerDropped` forces false (anything thrown on the floor).
   */
  dropSpec(item: Item, token: number, owner: number, playerDropped?: boolean): DropSpec;
  /** A flask charge was consumed in-run (belt slot index). */
  consumeFlask(ch: CharacterSave, slot: number): CharacterSave;
  applyRunEnd(ch: CharacterSave, input: RunEndInput): CharacterSave;

  // --- merchant ---
  merchantOffers(ch: CharacterSave): MerchantOffer[];
  /**
   * Legacy picker rows (cleared areas x T1-T2 x quality grades, `map:<area>:<tier>:<grade>`). Rook no longer sells them (the server refuses these ids and the UI has no
   * Maps tab): maps come from the wares board. Kept as a pure fixture for tests and simulations.
   */
  rookMapAreas(ch: CharacterSave): AtlasAreaId[];
  rookMapOffers(ch: CharacterSave, areaId: AtlasAreaId): MerchantOffer[];
  /**
   * Rook's wares board (GAME_SPEC §9): a deterministic function of the character, the 6-hour rotation (`now`, server ms), the
   * character level and the reroll count. Returns the board and the character with its wares state initialised (the server saves it).
   */
  waresBoard(ch: CharacterSave, now: number): { character: CharacterSave; board: MerchantBoard };
  /** Buy one ware by its id (`ware:<epoch>:<slot>`); refused when the epoch changed, the slot is sold or the price cannot be paid. */
  buyWare(ch: CharacterSave, wareId: string, now: number, at?: { x: number; y: number }): Result<{ character: CharacterSave; item: Item }>;
  /** "Ask for new wares": pays the doubling Scrap price, bumps the reroll count (a fresh salt) and clears the sold slots. */
  rerollWares(ch: CharacterSave, now: number, expect?: { epoch: string; cost: number }): Result<{ character: CharacterSave }>;
  sellQuote(item: Item): { scrap: number; lines: string[] } | null;
  sellItems(ch: CharacterSave, uids: readonly string[], expectedScrap: number): Result<{ character: CharacterSave; scrap: number }>;
  buyOffer(ch: CharacterSave, offerId: string, at?: { x: number; y: number }): Result<{ character: CharacterSave; item: Item }>;
  buyDebugOffer(ch: CharacterSave, offerId: string, options: DebugMerchantOptions, at?: { x: number; y: number }): Result<{ character: CharacterSave; message: string }>;
}
