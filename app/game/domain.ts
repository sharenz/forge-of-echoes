export type Rarity = "normal" | "magic" | "rare" | "unique";
export type EquipmentSlot = "weapon" | "chest" | "ring" | "boots";
export type AffixTag = "fire" | "life" | "speed" | "damage" | "defense";
export type CharacterClassId = "amazon" | "barbarian" | "sorceress";
export type CurrencyId = "scrap" | "essence" | "seal" | "solvent" | "mapDust" | "threatGlyph" | "rewardInk";

export type AttributeKey = "strength" | "dexterity" | "intelligence";
export type DerivedStatKey =
  | "maxLife"
  | "maxFocus"
  | "moveSpeed"
  | "attackDamage"
  | "attackSpeed"
  | "armor"
  | "evadeChance";
export type StatKey = AttributeKey | DerivedStatKey;
export type ModifierMode = "flat" | "increased" | "more";

/**
 * Every numerical effect in the game resolves through this representation.
 * flat values are added first, increased values are summed into one multiplier,
 * and each more value is a separate multiplicative multiplier.
 */
export interface StatModifier {
  stat: StatKey;
  mode: ModifierMode;
  value: number;
  source: string;
}

export interface AffixRoll extends StatModifier {
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
  /** Compatibility summary for compact UI. Calculation uses rolls. */
  value: number;
  unit: "flat" | "percent";
}

export interface EquipmentItem {
  kind: "equipment";
  id: string;
  baseId: string;
  baseName: string;
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

export interface MapModifier {
  id: MapModifierId;
  name: string;
  description: string;
  rewardDescription: string;
  danger: number;
  reward: number;
  kind: "threat" | "reward";
}

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

export type InventoryItem = EquipmentItem | MapItem | CurrencyItem;
export type CurrencyAmounts = Record<CurrencyId, number>;

export interface CharacterProgress {
  name: string;
  archetype: string;
  classId: CharacterClassId | null;
  created: boolean;
  level: number;
  xp: number;
  unspentPassives: number;
  mapsCompleted: number;
  highestWave: number;
}

export interface PlayerProfile {
  version: 4;
  character: CharacterProgress;
  inventory: InventoryItem[];
  stash: InventoryItem[];
  equipped: Partial<Record<EquipmentSlot, EquipmentItem>>;
  mapDevice: MapItem | null;
  openedMap: MapItem | null;
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
  armor: number;
  evadeChance: number;
}

export interface RunLoot {
  items: InventoryItem[];
  xp: number;
}

export interface RunResult {
  completed: boolean;
  wave: number;
  enemiesSlain: number;
  elapsedSeconds: number;
  loot: RunLoot;
}
