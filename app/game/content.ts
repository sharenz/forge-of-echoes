import type { Bargain, MapModifier, MapModifierId } from "./domain";

export const MAP_MODIFIERS: Record<MapModifierId, MapModifier> = {
  teeming: {
    id: "teeming",
    name: "Teeming",
    description: "Waves contain 30% more monsters.",
    rewardDescription: "+22% material and item yield",
    danger: 14,
    reward: 22,
    kind: "threat",
  },
  commanded: {
    id: "commanded",
    name: "Commanded",
    description: "Each wave contains an additional elite.",
    rewardDescription: "+26% rare item chance",
    danger: 18,
    reward: 26,
    kind: "threat",
  },
  restless: {
    id: "restless",
    name: "Restless",
    description: "Enemies arrive faster and move 12% faster.",
    rewardDescription: "+18% quantity",
    danger: 12,
    reward: 18,
    kind: "threat",
  },
  volcanic: {
    id: "volcanic",
    name: "Volcanic",
    description: "Volatile enemies erupt when slain.",
    rewardDescription: "+35% Essence yield",
    danger: 16,
    reward: 24,
    kind: "reward",
  },
  vampiric: {
    id: "vampiric",
    name: "Vampiric",
    description: "Enemies recover life while near wounded allies.",
    rewardDescription: "+28% equipment yield",
    danger: 15,
    reward: 23,
    kind: "reward",
  },
  "twin-crowned": {
    id: "twin-crowned",
    name: "Twin Crowned",
    description: "The final wave contains two linked bosses.",
    rewardDescription: "Final rewards are doubled",
    danger: 25,
    reward: 42,
    kind: "threat",
  },
  exhausting: {
    id: "exhausting",
    name: "Exhausting",
    description: "Focus recovery is reduced by 30%.",
    rewardDescription: "+30% crafting material yield",
    danger: 17,
    reward: 25,
    kind: "reward",
  },
};

export const BARGAINS: Bargain[] = [
  {
    id: "swarming",
    name: "Call the Swarm",
    danger: "Future waves contain 25% more enemies.",
    reward: "+24% material yield",
    packMultiplier: 1.25,
    rewardMultiplier: 1.24,
  },
  {
    id: "frenzied",
    name: "Feed the Frenzy",
    danger: "Enemies move and attack 18% faster.",
    reward: "+22% item yield",
    speedMultiplier: 1.18,
    rewardMultiplier: 1.22,
  },
  {
    id: "armored",
    name: "Temper Their Flesh",
    danger: "Enemies gain 35% maximum life.",
    reward: "+30% rare-item chance",
    healthMultiplier: 1.35,
    rewardMultiplier: 1.3,
  },
  {
    id: "volatile",
    name: "Unseal the Crucible",
    danger: "Enemies deal 22% more damage.",
    reward: "+28% Essence yield",
    damageMultiplier: 1.22,
    rewardMultiplier: 1.28,
  },
  {
    id: "bountiful",
    name: "Demand Tribute",
    danger: "Future waves gain an additional elite.",
    reward: "+20% to all rewards",
    healthMultiplier: 1.12,
    damageMultiplier: 1.08,
    rewardMultiplier: 1.2,
  },
];

export const XP_BY_LEVEL = (level: number): number =>
  Math.max(80, Math.floor(65 * Math.pow(level, 1.58)));

export const MAP_RARITY_LIMITS = {
  normal: 0,
  magic: 2,
  rare: 4,
  unique: 4,
} as const;

