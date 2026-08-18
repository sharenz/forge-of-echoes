import type { MapModifierId } from "../domain";
import type { MapBaseDefinition, MapModifierConfig } from "./schema";

export const MAP_BASES = [
  { id: "ashen-crucible", name: "Ashen Crucible", implicit: "Fire Essences are 20% more common" },
  { id: "iron-coliseum", name: "Iron Coliseum", implicit: "Equipment drops with +1 maximum Stability" },
] as const satisfies readonly MapBaseDefinition[];

export type MapBaseId = (typeof MAP_BASES)[number]["id"];
export const MAP_BASES_BY_ID = Object.fromEntries(MAP_BASES.map((base) => [base.id, base])) as Record<MapBaseId, (typeof MAP_BASES)[number]>;

export const MAP_MODIFIERS: MapModifierConfig = {
  teeming: { id: "teeming", name: "Teeming", danger: 14, reward: 22, kind: "threat", modifiers: [{ stat: "monsterCount", mode: "more", base: 30 }] },
  commanded: { id: "commanded", name: "Commanded", danger: 18, reward: 26, kind: "threat", modifiers: [{ stat: "monsterCount", mode: "more", base: 8 }] },
  restless: { id: "restless", name: "Restless", danger: 12, reward: 18, kind: "threat", modifiers: [{ stat: "monsterMoveSpeed", mode: "increased", base: 12 }] },
  volcanic: { id: "volcanic", name: "Volcanic", danger: 16, reward: 24, kind: "reward", modifiers: [{ stat: "monsterDamage", mode: "increased", base: 12 }] },
  vampiric: { id: "vampiric", name: "Vampiric", danger: 15, reward: 23, kind: "reward", modifiers: [{ stat: "monsterLife", mode: "increased", base: 12 }] },
  "twin-crowned": { id: "twin-crowned", name: "Twin Crowned", danger: 25, reward: 42, kind: "threat", modifiers: [{ stat: "monsterLife", mode: "more", base: 25 }] },
  exhausting: { id: "exhausting", name: "Exhausting", danger: 17, reward: 25, kind: "reward", modifiers: [{ stat: "focusRegen", mode: "increased", base: -30 }] },
};

export const MAP_RARITY_LIMITS = { normal: 0, magic: 2, rare: 4, unique: 4 } as const;

export const MAP_MODIFIER_IDS = Object.keys(MAP_MODIFIERS) as MapModifierId[];
