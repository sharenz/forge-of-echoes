import type { CurrencyId } from "../domain";

export interface CurrencyDefinition {
  id: CurrencyId;
  name: string;
  icon: string;
  symbol: string;
  description: string;
  maxStackSize: number;
}

const DEFAULT_MAX_STACK_SIZE = 40;

export const CURRENCY_DEFINITIONS: Record<CurrencyId, CurrencyDefinition> = {
  scrap: { id: "scrap", name: "Forged Scrap", icon: "/item-icons/scrap.png", symbol: "S", description: "Rerolls the values of existing equipment affixes.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
  essence: { id: "essence", name: "Ember Essence", icon: "/item-icons/essence.png", symbol: "E", description: "Adds a fire-tagged affix to compatible equipment.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
  seal: { id: "seal", name: "Binding Seal", icon: "/item-icons/seal.png", symbol: "B", description: "Protects an affix during advanced crafting.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
  solvent: { id: "solvent", name: "Forge Solvent", icon: "/item-icons/solvent.png", symbol: "V", description: "Removes an affix using a visible targeting rule.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
  mapDust: { id: "mapDust", name: "Map Dust", icon: "/item-icons/map-dust.png", symbol: "D", description: "Rerolls every explicit modifier on a map item.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
  threatGlyph: { id: "threatGlyph", name: "Threat Glyph", icon: "/item-icons/threat-glyph.png", symbol: "T", description: "Adds a dangerous modifier to a map item.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
  rewardInk: { id: "rewardInk", name: "Reward Ink", icon: "/item-icons/reward-ink.png", symbol: "R", description: "Adds a reward-focused modifier to a map item.", maxStackSize: DEFAULT_MAX_STACK_SIZE },
};

export const STARTING_CURRENCY: Partial<Record<CurrencyId, number>> = {
  scrap: 12,
  essence: 4,
  seal: 1,
  solvent: 1,
  mapDust: 4,
  threatGlyph: 3,
  rewardInk: 3,
};
