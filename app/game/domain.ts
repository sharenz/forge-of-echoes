export type Rarity = "normal" | "magic" | "rare" | "unique";
/** The type of character position an item may occupy. */
export type EquipmentSlot = "helmet" | "mainHand" | "offHand" | "amulet" | "ring" | "chest" | "gloves" | "boots" | "belt";
/** A concrete position on the character. Rings deliberately have two positions. */
export type CharacterEquipmentSlot = "helmet" | "mainHand" | "offHand" | "amulet" | "ringLeft" | "ringRight" | "chest" | "gloves" | "boots" | "belt";
export type AffixTag = "fire" | "life" | "speed" | "damage" | "defense";
export type CharacterClassId = "amazon" | "barbarian" | "sorceress";
export type CurrencyId = "scrap" | "essence" | "seal" | "solvent" | "mapDust" | "threatGlyph" | "rewardInk";
export type FlaskId = "weak-health-flask" | "weak-mana-flask";
export type FlaskResource = "life" | "mana";

export type AttributeKey = "strength" | "dexterity" | "intelligence";
export type DerivedStatKey =
  | "maxLife"
  | "maxFocus"
  | "moveSpeed"
  | "attackDamage"
  | "attackSpeed"
  | "castSpeed"
  | "focusRegen"
  | "skillCooldown"
  | "armor"
  | "evadeChance";
export type StatKey = AttributeKey | DerivedStatKey;
export type ArenaStatKey =
  | "focusRegen"
  | "itemQuantity"
  | "itemRarity"
  | "monsterCount"
  | "monsterRarity"
  | "monsterLife"
  | "monsterMoveSpeed"
  | "monsterDamage"
  | "monsterArmor"
  | "monsterEvadeChance";
export type ModifierStatKey = StatKey | ArenaStatKey;
export type ModifierMode = "flat" | "increased" | "more";
export type MonsterRarity = "normal" | "magic" | "rare";
export type DamageType = "physical" | "fire" | "cold" | "lightning" | "chaos";
export type SkillAnimationId = "attack" | "cast" | "dash";
export type SkillVfxId = "ember-lance" | "ember-nova" | "rift-step" | "cinder-ward" | "flame-wave";
export type SkillAudioId = "ember-lance" | "ember-nova" | "rift-step" | "cinder-ward" | "flame-wave";
export type ActiveSkillId = "nova" | "dash" | "ward" | "flameWave";
export type SkillLevels = Record<ActiveSkillId, number>;

/**
 * Every numerical effect in the game resolves through this representation.
 * flat values are added first, increased values are summed into one multiplier,
 * and each more value is a separate multiplicative multiplier.
 */
export interface StatModifier<TStat extends ModifierStatKey = StatKey> {
  stat: TStat;
  mode: ModifierMode;
  value: number;
  source: string;
  /** Human-readable origin used by stat breakdowns; source remains the stable ID. */
  label?: string;
}

export interface AffixRoll extends StatModifier<StatKey> {
  min: number;
  max: number;
}

export interface Affix {
  id: string;
  definitionId: string;
  name: string;
  tag: AffixTag;
  tier: number;
  requiredItemLevel: number;
  group: string;
  rolls: AffixRoll[];
}

export interface EquipmentItem {
  kind: "equipment";
  id: string;
  baseId: string;
  baseName: string;
  /** Optional authored name for unique or fixed equipment. */
  displayName?: string;
  slot: EquipmentSlot;
  rarity: Rarity;
  itemLevel: number;
  stability: number;
  maxStability: number;
  implicit: string;
  baseStats: StatModifier[];
  implicitModifiers: StatModifier[];
  affixes: Affix[];
}

export type MapModifierId =
  | "teeming"
  | "commanded"
  | "restless"
  | "volcanic"
  | "vampiric"
  | "twin-crowned"
  | "exhausting";

export interface MapItem {
  kind: "map";
  id: string;
  baseId: string;
  baseName: string;
  tier: number;
  rarity: Rarity;
  quality: number;
  corrupted: boolean;
  implicit: string;
  modifiers: MapModifierId[];
}

export interface CurrencyItem {
  kind: "currency";
  id: string;
  baseId: CurrencyId;
  stackSize: number;
}

export interface FlaskItem {
  kind: "flask";
  id: string;
  baseId: FlaskId;
  stackSize: number;
}

export type InventoryItem = EquipmentItem | MapItem | CurrencyItem | FlaskItem;
/** A zero-sized flask stack is valid only in the belt and preserves its refill assignment. */
export type FlaskBelt = [
  FlaskItem | null,
  FlaskItem | null,
  FlaskItem | null,
  FlaskItem | null,
  FlaskItem | null,
];
export type CurrencyAmounts = Record<CurrencyId, number>;
export type ItemContainerId = "backpack" | "stash";

export interface PlacedInventoryItem {
  item: InventoryItem;
  x: number;
  y: number;
}

/**
 * A persistent spatial container. Coordinates are part of the save state so
 * rendering, transfers, crafting, and reloads can never implicitly re-sort it.
 */
export interface ItemContainer {
  id: ItemContainerId;
  entries: PlacedInventoryItem[];
}

export interface StashTab {
  id: string;
  name: string;
  container: ItemContainer;
}

export interface StashState {
  activeTabId: string;
  tabs: StashTab[];
}

export interface CharacterProgress {
  name: string;
  classId: CharacterClassId;
  level: number;
  xp: number;
  allocatedAttributes: Record<AttributeKey, number>;
  unspentAttributePoints: number;
  skillLevels: SkillLevels;
  unspentSkillPoints: number;
  mapsCompleted: number;
  highestWave: number;
}

export interface PlayerProfile {
  version: 9;
  character: CharacterProgress;
  inventory: ItemContainer;
  stash: StashState;
  equipped: Partial<Record<CharacterEquipmentSlot, EquipmentItem>>;
  flaskBelt: FlaskBelt;
  mapDevice: MapItem | null;
}

export interface CharacterStats {
  strength: number;
  dexterity: number;
  intelligence: number;
  maxLife: number;
  maxFocus: number;
  moveSpeed: number;
  attackDamage: number;
  attackSpeed: number;
  /** Multiplier applied to the base cast time of cast-tagged skills. */
  castSpeed: number;
  /** Focus (mana) recovered per second before map modifiers. */
  focusRegen: number;
  /** Multiplier applied to active-skill cooldown and charge-recovery durations. */
  skillCooldown: number;
  armor: number;
  evadeChance: number;
}
