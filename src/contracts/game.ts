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
import type { AtlasAreaId } from './atlas';

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

export interface MapSummaryLine {
  label: string;        // "Item Quantity"
  value: string;        // "+64%"
  breakdown: string[];  // "+22% Teeming", "+12% Tier 4" …
}

export interface RunSetup {
  map: MapItem;         // effective map: item tier/quality/mods with the Atlas area's theme/implicit
  /** Original item for restart refunds when the chosen area changed its base. */
  sourceMap?: MapItem;
  atlasAreaId?: AtlasAreaId;
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
  applyBenchRecipe(ch: CharacterSave, targetUid: string, recipeId: string): Result<CraftOutcome>;
  /** Remove the target's bench-crafted affix (free; keeps stability spent). */
  clearCraftedAffix(ch: CharacterSave, targetUid: string): Result<CraftOutcome>;

  // --- maps & runs ---
  mapSummary(ch: CharacterSave, map: MapItem): MapSummaryLine[];
  /** Consume the map in the device and produce run parameters (map-side luck only). */
  openMap(ch: CharacterSave, areaId?: AtlasAreaId): Result<{ character: CharacterSave; setup: RunSetup }>;
  /** Build the instance sim config (players join separately via SimRun.addPlayer). `setup` null = hideout. */
  buildRunConfig(setup: RunSetup | null, hooks: RunHooks): RunConfig;
  /** One player's resolved stats/skills/loadout/belt for an instance (after joining, level-ups, gear or flask changes). */
  playerRuntime(ch: CharacterSave, setup: RunSetup | null): PlayerRuntime;
  /** Personal luck: final quantity/rarity % for `looter` in this map (map-side luck + looter's gear). */
  lootLuck(setup: RunSetup, looter: CharacterSave): { itemQuantity: number; itemRarity: number };
  /** Instanced loot for ONE player (uses lootLuck(setup, looter)). */
  rollKillLoot(setup: RunSetup, ctx: KillLootContext, rng: Rng, looter: CharacterSave): Item[];
  rollChestLoot(setup: RunSetup, rng: Rng, looter: CharacterSave): Item[];
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
  buyOffer(ch: CharacterSave, offerId: string): Result<{ character: CharacterSave; item: Item }>;
}
