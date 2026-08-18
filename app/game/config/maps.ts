import type { MapModifierId } from "../domain";
import type { MapBaseDefinition, MapModifierConfig } from "./schema";

export const MAP_BASES = [
  { id: "ashen-crucible", name: "Ashen Crucible", implicit: "Fire Essences are 20% more common" },
  { id: "iron-coliseum", name: "Iron Coliseum", implicit: "Equipment drops with +1 maximum Stability" },
] as const satisfies readonly MapBaseDefinition[];

export type MapBaseId = (typeof MAP_BASES)[number]["id"];
export const MAP_BASES_BY_ID = Object.fromEntries(MAP_BASES.map((base) => [base.id, base])) as Record<MapBaseId, (typeof MAP_BASES)[number]>;

export const MAP_MODIFIERS: MapModifierConfig = {
  teeming: { id: "teeming", name: "Teeming", description: "Waves contain 30% more monsters.", rewardDescription: "+22% material and item yield", danger: 14, reward: 22, kind: "threat" },
  commanded: { id: "commanded", name: "Commanded", description: "Each wave contains an additional elite.", rewardDescription: "+26% rare item chance", danger: 18, reward: 26, kind: "threat" },
  restless: { id: "restless", name: "Restless", description: "Enemies arrive faster and move 12% faster.", rewardDescription: "+18% quantity", danger: 12, reward: 18, kind: "threat" },
  volcanic: { id: "volcanic", name: "Volcanic", description: "Volatile enemies erupt when slain.", rewardDescription: "+35% Essence yield", danger: 16, reward: 24, kind: "reward" },
  vampiric: { id: "vampiric", name: "Vampiric", description: "Enemies recover life while near wounded allies.", rewardDescription: "+28% equipment yield", danger: 15, reward: 23, kind: "reward" },
  "twin-crowned": { id: "twin-crowned", name: "Twin Crowned", description: "The final wave contains two linked bosses.", rewardDescription: "Final rewards are doubled", danger: 25, reward: 42, kind: "threat" },
  exhausting: { id: "exhausting", name: "Exhausting", description: "Focus recovery is reduced by 30%.", rewardDescription: "+30% crafting material yield", danger: 17, reward: 25, kind: "reward" },
};

export const MAP_RARITY_LIMITS = { normal: 0, magic: 2, rare: 4, unique: 4 } as const;

export const MAP_MODIFIER_IDS = Object.keys(MAP_MODIFIERS) as MapModifierId[];
