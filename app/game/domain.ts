export type Rarity = "normal" | "magic" | "rare" | "unique";
export type EquipmentSlot = "weapon" | "chest" | "ring" | "boots";
export type AffixTag = "fire" | "life" | "speed" | "damage" | "defense";
export type CharacterClassId = "amazon" | "barbarian" | "sorceress";

export interface Affix {
  id: string;
  name: string;
  tag: AffixTag;
  tier: number;
  value: number;
  unit: "flat" | "percent";
}

export interface EquipmentItem {
  id: string;
  baseId: string;
  baseName: string;
  slot: EquipmentSlot;
  rarity: Rarity;
  itemLevel: number;
  stability: number;
  maxStability: number;
  implicit: string;
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

export interface Materials {
  scrap: number;
  essence: number;
  seal: number;
  solvent: number;
  mapDust: number;
  threatGlyph: number;
  rewardInk: number;
}

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
  version: 2;
  character: CharacterProgress;
  materials: Materials;
  inventory: EquipmentItem[];
  stash: EquipmentItem[];
  equipped: Partial<Record<EquipmentSlot, EquipmentItem>>;
  maps: MapItem[];
  openedMap: MapItem | null;
}

export interface CharacterStats {
  maxLife: number;
  maxFocus: number;
  moveSpeed: number;
  attackDamage: number;
  attackSpeed: number;
  armor: number;
  evadeChance: number;
}

export interface RunLoot {
  materials: Partial<Materials>;
  items: EquipmentItem[];
  xp: number;
}

export interface RunResult {
  completed: boolean;
  wave: number;
  enemiesSlain: number;
  elapsedSeconds: number;
  loot: RunLoot;
}
