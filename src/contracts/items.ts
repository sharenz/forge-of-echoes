// FROZEN CONTRACT — item, character and save domain types.
import type {
  Attribute, BaseId, ClassId, CurrencyId, EquipSlot, FlaskId, ItemClass, MapBaseId, SkillId, UniqueId,
} from './content';
import type { AtlasProgress } from './atlas';

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
  | 'caster' | 'critical' | 'speed' | 'luck' | 'utility';

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
  baseId: MapBaseId;
  /** 1–15. */
  tier: number;
  rarity: Exclude<Rarity, 'unique'>;
  mods: RolledMapMod[];
  /** 0–20 (% increased item quantity & map drop chance). */
  quality: number;
  corrupted: boolean;
  /** A paid commission: guarantees The Hunted when this map is opened. */
  bounty?: boolean;
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
  /** The Crafting Stash: a currency always files into its own slot (position-free). */
  | { kind: 'currencyStash' }
  /** The Map Stash: maps file by tier/base (position-free). */
  | { kind: 'mapStash' };

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

/** Six freely assignable slots: LMB, RMB, Q, E, R, F. */
export const LOADOUT_SLOTS = 6;
export const LOADOUT_KEYS = ['LMB', 'RMB', 'Q', 'E', 'R', 'F'] as const;
export const BELT_SLOTS = 4;
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
  skillRanks: Record<SkillId, number>;
  /** LOADOUT_SLOTS entries. */
  loadout: (SkillId | null)[];
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
  /** BELT_SLOTS entries. */
  belt: (BeltSlot | null)[];
  mapDevice: MapItem | null;
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
