// FROZEN CONTRACT — item, character and save domain types.
import type {
  Attribute, BaseId, ClassId, CurrencyId, EquipSlot, FlaskId, ItemClass, MapBaseId, SkillId, UniqueId,
} from './content';
import type { AtlasAreaId, AtlasProgress } from './atlas';
import type { GuideState } from './guide';
import type { PassiveNodeId } from './passives';

// ---------------------------------------------------------------------------
// Modifiers & stats
// ---------------------------------------------------------------------------

export type ModifierMode = 'flat' | 'increased' | 'more';

export const STAT_IDS = [
  // attributes
  'str', 'dex', 'int',
  // life & focus
  'maxLife', 'lifeRegen', 'maxFocus', 'focusRegen', 'lifeOnKill', 'focusOnKill',
  // defences (evasion is a rating; resolved to a chance by the rules)
  'armor', 'evasion', 'fireRes', 'coldRes', 'lightningRes', 'voidRes', 'allRes', 'damageTaken',
  // offence
  'spellDamage',            // generic % increased (applies to all player skills)
  'addedSpellDamage',       // flat added to every skill hit before effectiveness
  'fireDamage', 'coldDamage', 'lightningDamage', 'voidDamage', 'physicalDamage', 'elementalDamage',
  'castSpeed', 'critChance', 'critMultiplier',
  'projectileSpeed', 'area', 'duration', 'cooldownRecovery',
  'extraProjectiles', 'pierce',
  'igniteChance', 'chillChance', 'shockChance',
  // utility & luck
  'moveSpeed', 'pickupRadius', 'flaskEffect',
  'itemQuantity', 'itemRarity',
  // power rework R1 (append-only): penetration, damage-type scaling, max resistance, chains, flask charge
  'firePen', 'coldPen', 'lightningPen', 'voidPen', 'physicalPen', 'elementalPen',
  'projectileDamage', 'areaDamage', 'damageOverTime', 'maxResistance', 'extraChains', 'flaskChargeOnKill',
] as const;
export type StatId = (typeof STAT_IDS)[number];

export interface StatModifier {
  stat: StatId;
  mode: ModifierMode;
  value: number;
  /** Where it came from, e.g. "Ashwood Wand (implicit)", "Level 12", "Intelligence". */
  source: string;
  label?: string;
}

export interface StatBreakdown {
  stat: StatId;
  value: number;
  base: number;
  flat: number;
  increased: number;
  more: number[];
  sources: StatModifier[];
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';
export type AffixKind = 'prefix' | 'suffix';
export type AffixTag =
  | 'fire' | 'cold' | 'lightning' | 'void' | 'physical' | 'elemental'
  | 'life' | 'focus' | 'defense' | 'resistance'
  | 'caster' | 'critical' | 'speed' | 'luck' | 'utility' | 'penetration';

export interface RolledAffix {
  affixId: string;
  /** 1 = best tier. */
  tier: number;
  value: number;
  /** Protected from the next crafting operation, then the seal breaks. */
  sealed?: boolean;
  /** Permanently locked; immune to all crafting. */
  fractured?: boolean;
  /** Added at the crafting bench (deterministic). At most one per item; removable at the bench for free. */
  crafted?: boolean;
}

export interface RolledScar {
  scarId: string;
  value: number;
}

export interface EquipmentItem {
  kind: 'equipment';
  uid: string;
  baseId: BaseId;
  itemLevel: number;
  rarity: Rarity;
  /** Generated name for rare items / fixed name for uniques; null for normal/magic (UI derives). */
  name: string | null;
  uniqueId?: UniqueId;
  /** Rolled values of the base's implicit modifiers (same order as the base definition). */
  implicitValues: number[];
  /** Affix balance revision; missing means pre-phase-2 saved equipment. */
  affixVersion?: number;
  affixes: RolledAffix[];
  scars: RolledScar[];
  /** Crafting budget. At 0 the item is finished (never destroyed). */
  stability: number;
  maxStability: number;
  /** Short human-readable crafting history ("Ember Essence added Blazing (T4)"). */
  history: string[];
  /** Lifetime craft count; independent of the capped display history. Missing on legacy items. */
  craftCount?: number;
  /** Paid Stability points restored at the bench; never reset by other crafting. */
  repairCount?: number;
  isNew?: boolean;
}

export interface CurrencyStack {
  kind: 'currency';
  uid: string;
  currencyId: CurrencyId;
  count: number;
  isNew?: boolean;
}

export interface RolledMapMod {
  modId: string;
  value: number;
  /** Added by corruption. */
  corrupted?: boolean;
}

export interface MapItem {
  kind: 'map';
  uid: string;
  /** The Atlas area this map opens (brief D). Every map is bound to ONE area; `baseId` always equals that area's theme. */
  areaId: AtlasAreaId;
  baseId: MapBaseId;
  /** 1–15. */
  tier: number;
  rarity: Exclude<Rarity, 'unique'>;
  mods: RolledMapMod[];
  /** 0–20 (% increased item quantity & map drop chance). */
  quality: number;
  corrupted: boolean;
  /** A paid commission: guarantees The Stalker when this map is opened. */
  bounty?: boolean;
  /** Compass: the progression map in the completion chest upgrades by one tier. */
  charted?: boolean;
  /** Twin Ink allows a second reward-only modifier (ordinary Reward Ink still adds at most one). */
  twinInked?: boolean;
  /** How many times Re-chart has moved it (raises the next Re-chart price). Filled by a later slice. */
  rechart?: number;
  /**
   * Load-time only: a legacy map (saved before maps were bound) whose `areaId` is provisional until
   * bindLegacyMaps has seen the account's Atlas. Never present on a map the rules or the server hand out.
   */
  unbound?: true;
  /** One-time tooltip note: the legacy map moved to another theme ('theme') or revealed its area ('fog') when it was bound. */
  migrated?: 'theme' | 'fog';
  isNew?: boolean;
}

export interface FlaskStack {
  kind: 'flask';
  uid: string;
  flaskId: FlaskId;
  count: number;
  isNew?: boolean;
}

export type Item = EquipmentItem | CurrencyStack | MapItem | FlaskStack;

/** What the Crafting Stash work slot can hold. */
export type CraftSlotItem = EquipmentItem | MapItem;

export interface GridEntry {
  item: Item;
  x: number;
  y: number;
}

export interface GridContainer {
  w: number;
  h: number;
  entries: GridEntry[];
}

export interface StashTab {
  name: string;
  grid: GridContainer;
}

/** A place an item can be moved to. */
export type ItemLocation =
  | { kind: 'backpack'; x: number; y: number }
  | { kind: 'stash'; tab: number; x: number; y: number }
  | { kind: 'equipment'; slot: EquipSlot }
  | { kind: 'belt'; index: number }
  | { kind: 'mapDevice' }
  | { kind: 'scarabSlot'; index: number }
  /** The Crafting Stash: a currency always files into its own slot (position-free). */
  | { kind: 'currencyStash' }
  /** The Map Stash: maps file by tier/base (position-free). */
  | { kind: 'mapStash' }
  /** The Crafting Stash work slot: one piece of gear or one map, crafted on in place (account-wide). */
  | { kind: 'craftSlot' };

// ---------------------------------------------------------------------------
// Character & save
// ---------------------------------------------------------------------------

export interface BeltSlot {
  flaskId: FlaskId;
  /** Charges loaded in this belt slot (max 5). 0 keeps the slot assigned. */
  count: number;
}

export interface CharacterStatsLog {
  mapsCompleted: number;
  mapsFailed: number;
  highestTierCompleted: number;
  kills: number;
  deaths: number;
  raresFound: number;
  uniquesFound: number;
  itemsCrafted: number;
  playSeconds: number;
}

/** Eight freely assignable slots: LMB, RMB, Q, E, R, F, Space, Z (power rework R2; saves from six slots pad with null). */
export const LOADOUT_SLOTS = 8;
export const LOADOUT_KEYS = ['LMB', 'RMB', 'Q', 'E', 'R', 'F', 'Space', 'Z'] as const;
/** Named loadout presets per character (switched in the hideout only). */
export const LOADOUT_PRESETS = 3;

/** One saved loadout (CharacterSave.loadoutPresets). */
export interface LoadoutPreset {
  /** Player-chosen label (at most 24 characters). */
  name: string;
  /** LOADOUT_SLOTS entries; a skill unlearned since saving reads as an empty slot. */
  loadout: (SkillId | null)[];
}
export const BELT_SLOTS = 4;
export const SCARAB_SLOTS = 4;
export const BACKPACK_SIZE = { w: 12, h: 5 } as const;
export const STASH_TAB_SIZE = { w: 12, h: 8 } as const;
export const MAX_STASH_TABS = 8;
/** Upper bound for tabs retained when legacy character stashes are merged into one account. */
export const MAX_PRESERVED_STASH_TABS = 1024;
/** Max count per currency slot in the Crafting Stash. */
export const CURRENCY_STASH_MAX = 5000;
/** Max maps in the Map Stash. */
export const MAP_STASH_CAPACITY = 400;
/** Synthetic uid of a Crafting Stash slot (like belt:<i>). */
export function currencyStashUid(id: CurrencyId): string { return `cstash:${id}`; }
/** Special stash tabs shown after the normal tabs. */
export type SpecialStashTab = 'maps' | 'currency' | 'mapCurrency';

export interface WaresState {
  /** Forge-time rotation index (6 h slices from 04:00 UTC). */
  rotation: number;
  /** The character level the board was built for: a level-up starts a new epoch. */
  level: number;
  /** "Ask for new wares" uses in this rotation (the salt, and the price exponent). */
  rerolls: number;
  /** Sold slot indices (greyed out until the epoch changes). */
  sold: number[];
  /** Highest map tier the character had completed when the epoch started. */
  tier: number;
  /** Atlas areas open to the character when the epoch started (discovered and bindable). */
  areas: string[];
}

export interface CharacterSave {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  /** XP into the current level. */
  xp: number;
  unspentAttributePoints: number;
  allocated: Record<Attribute, number>;
  unspentSkillPoints: number;
  /** Rank 0 (not learned) to MAX_SKILL_RANK (10) per skill; Ember Lance is always at least 1. */
  skillRanks: Partial<Record<SkillId, number>>;
  /** LOADOUT_SLOTS entries. */
  loadout: (SkillId | null)[];
  /**
   * Augments picked per skill (ids of the skill's AugmentDefs, docs/power-rework/skills.md 4). Missing or absent skill = none.
   * Item-granted augment effects (unique flags) are not listed here: they need no slot.
   */
  augments?: Partial<Record<SkillId, string[]>>;
  /** LOADOUT_PRESETS saved loadouts (missing on older saves: three empty presets). */
  loadoutPresets?: LoadoutPreset[];
  /** Free full respecs left (skills, augments and attributes). The skill rework migration grants one. */
  respecTokens?: number;
  /** Skill and augment points this character has refunded for free so far (the first RESPEC.freePoints are free). */
  respecFreeUsed?: number;
  /**
   * The 1-to-20 skill ranks this character had before the skill rework (save version 3), kept for one release so a revert can
   * restore them. Its presence also marks the character as migrated.
   */
  legacySkillRanks?: Partial<Record<SkillId, number>>;
  /**
   * The Orrery (docs/power-rework/passive-tree.md): allocated passive nodes in canonical order (Spark is implicit, never listed).
   * Missing on older saves = nothing allocated: every earned point is unspent.
   */
  passives?: PassiveNodeId[];
  /** Chosen rider (0 to MASTERY_CHOICES − 1) of each allocated mastery; an allocated mastery without an entry has none yet. */
  masteries?: Partial<Record<PassiveNodeId, number>>;
  /**
   * Boss Marks: the final bosses (monster kinds) this character has killed, one passive point each. Missing = a character from
   * before the Orrery, credited once from the account's Atlas first kills when it is loaded.
   */
  bossMarks?: string[];
  /** Passive refunds and mastery changes made so far (the first PASSIVE_RESPEC.freeRefunds are free). */
  passiveRefunds?: number;
  /** Scrap paid for passive refunds in the current respec session (capped; reset when a map is opened). */
  passiveRespecSpent?: number;
  equipment: Partial<Record<EquipSlot, EquipmentItem>>;
  backpack: GridContainer;
  stash: StashTab[];
  /** Account migration may preserve more than eight legacy tabs; new accounts have eight at most. */
  stashCapacity?: number;
  /** Crafting Stash: count per currency (equipment and map currencies; the UI shows them as two tabs). */
  currencyStash: Partial<Record<CurrencyId, number>>;
  /** Map Stash (≤ MAP_STASH_CAPACITY maps). */
  mapStash: MapItem[];
  /** Account-wide Atlas discovery, projected alongside shared storage by the server. */
  atlas?: AtlasProgress;
  /**
   * The Crafting Stash work slot (account-wide, part of shared storage): the one item (gear or a map) being crafted
   * on. It physically holds the item (it is in no other container); missing on older saves means empty.
   */
  craftSlot?: CraftSlotItem | null;
  /**
   * The first-run guide (account-wide, part of shared storage; contracts/guide.ts). Missing on older saves means
   * "not decided yet": the server decides it once at load (veterans are skipped).
   */
  guide?: GuideState;
  /** BELT_SLOTS entries. */
  belt: (BeltSlot | null)[];
  mapDevice: MapItem | null;
  /** One consumable per socket. Missing on older saves means four empty sockets. */
  mapScarabs?: (CurrencyStack | null)[];
  /**
   * Rook's wares state (per character): the stock epoch (rotation, level, rerolls), the sold slots and the inputs snapshotted when
   * the epoch started (highest tier completed, the areas open to the character), so the board cannot shift while the epoch lasts.
   * Missing on older saves: Rook starts a fresh epoch at the next visit.
   */
  wares?: WaresState;
  /** Deterministic RNG state for out-of-run randomness (crafting, merchant, gambling). */
  rngState: number;
  /** Monotonic counter used to mint item uids. */
  nextUid: number;
  /** Server-assigned namespace keeps minted item IDs distinct across characters sharing a stash. */
  uidNamespace?: string;
  stats: CharacterStatsLog;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  masterVolume: number; // 0..1
  musicVolume: number;  // 0..1
  sfxVolume: number;    // 0..1
  screenShake: number;  // 0..1
  showFps: boolean;
  /** Basic attack auto-fires at the nearest enemy near the cursor. */
  autoAttack: boolean;
  /** Show the coach cards (first-time hints). Missing means on. */
  hints?: boolean;
}

export interface SaveGame {
  version: number;
  characters: CharacterSave[];
  lastCharacterId: string | null;
  settings: Settings;
}

// ---------------------------------------------------------------------------
// Presentation-oriented descriptions (built by the rules, rendered by the UI)
// ---------------------------------------------------------------------------

export type ItemTone = Rarity | 'currency' | 'map' | 'flask';

export interface TooltipLine {
  text: string;
  kind: 'implicit' | AffixKind | 'scar' | 'unique' | 'mapMod' | 'corrupted' | 'info';
  tier?: number;
  /** Roll range shown with Alt, e.g. "(12–18)". */
  range?: string;
  /** Affix name shown with Alt, e.g. "Blazing". */
  affixName?: string;
  tags?: string[];
  sealed?: boolean;
  fractured?: boolean;
  /** Bench-crafted affix. */
  crafted?: boolean;
  negative?: boolean;
}

export interface ItemDescription {
  title: string;
  /** Base type line under a rare/unique/magic name; null when title already is the base. */
  subtitle: string | null;
  tone: ItemTone;
  iconId: string;
  classLabel: string;             // "Wand", "Ring", "Map", "Currency", "Flask"
  size: { w: number; h: number };
  /** e.g. "Item Level 34", "Tier 5 Map", "Stack 12 / 40". */
  headerLines: string[];
  /** e.g. { label: 'Armour', value: '42' }. */
  properties: { label: string; value: string }[];
  implicits: TooltipLine[];
  affixes: TooltipLine[];
  scars: TooltipLine[];
  stability?: { current: number; max: number };
  /** Currency / flask / map explanatory text. */
  description?: string;
  flavor?: string;
  requirements?: string;
  corrupted?: boolean;
  history?: string[];
  /** Contextual usage hint ("Right-click to arm, then left-click an item"). */
  hint?: string;
}
