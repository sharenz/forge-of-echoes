import type { AffixDefinition, AffixRollDefinition } from "./schema";

const tier = (tierNumber: number, requiredItemLevel: number, weight: number, min: number, max: number, roll: Omit<AffixRollDefinition, "min" | "max">) => ({
  tier: tierNumber,
  requiredItemLevel,
  weight,
  rolls: [{ ...roll, min, max }],
});

export const AFFIX_DEFINITIONS = [
  {
    id: "vigorous", name: "Vigorous", tag: "life", group: "maximum-life", slots: ["chest", "ring", "boots"],
    tiers: [
      tier(6, 1, 1000, 7, 12, { stat: "maxLife", mode: "flat" }),
      tier(5, 8, 700, 13, 21, { stat: "maxLife", mode: "flat" }),
      tier(4, 20, 450, 22, 34, { stat: "maxLife", mode: "flat" }),
      tier(3, 35, 250, 35, 50, { stat: "maxLife", mode: "flat" }),
      tier(2, 55, 110, 51, 69, { stat: "maxLife", mode: "flat" }),
      tier(1, 75, 35, 70, 92, { stat: "maxLife", mode: "flat" }),
    ],
  },
  {
    id: "honed", name: "Honed", tag: "damage", group: "flat-attack-damage", slots: ["weapon", "ring"],
    tiers: [
      tier(6, 1, 1000, 2, 4, { stat: "attackDamage", mode: "flat" }),
      tier(5, 10, 700, 5, 8, { stat: "attackDamage", mode: "flat" }),
      tier(4, 24, 450, 9, 13, { stat: "attackDamage", mode: "flat" }),
      tier(3, 40, 250, 14, 20, { stat: "attackDamage", mode: "flat" }),
      tier(2, 60, 110, 21, 29, { stat: "attackDamage", mode: "flat" }),
      tier(1, 82, 35, 30, 41, { stat: "attackDamage", mode: "flat" }),
    ],
  },
  {
    id: "scorching", name: "Scorching", tag: "fire", group: "increased-fire-damage", slots: ["weapon", "ring"],
    tiers: [
      tier(6, 1, 1000, 6, 11, { stat: "attackDamage", mode: "increased" }),
      tier(5, 12, 700, 12, 19, { stat: "attackDamage", mode: "increased" }),
      tier(4, 26, 450, 20, 29, { stat: "attackDamage", mode: "increased" }),
      tier(3, 42, 250, 30, 41, { stat: "attackDamage", mode: "increased" }),
      tier(2, 62, 110, 42, 55, { stat: "attackDamage", mode: "increased" }),
      tier(1, 84, 35, 56, 72, { stat: "attackDamage", mode: "increased" }),
    ],
  },
  {
    id: "quickened", name: "Quickened", tag: "speed", group: "movement-speed", slots: ["boots"],
    tiers: [
      tier(6, 1, 1000, 3, 5, { stat: "moveSpeed", mode: "increased" }),
      tier(5, 14, 700, 6, 8, { stat: "moveSpeed", mode: "increased" }),
      tier(4, 30, 450, 9, 12, { stat: "moveSpeed", mode: "increased" }),
      tier(3, 48, 250, 13, 16, { stat: "moveSpeed", mode: "increased" }),
      tier(2, 68, 110, 17, 21, { stat: "moveSpeed", mode: "increased" }),
      tier(1, 86, 35, 22, 27, { stat: "moveSpeed", mode: "increased" }),
    ],
  },
  {
    id: "of-haste", name: "of Haste", tag: "speed", group: "attack-speed", slots: ["weapon", "ring"],
    tiers: [
      tier(6, 1, 1000, 3, 5, { stat: "attackSpeed", mode: "increased" }),
      tier(5, 16, 700, 6, 8, { stat: "attackSpeed", mode: "increased" }),
      tier(4, 32, 450, 9, 12, { stat: "attackSpeed", mode: "increased" }),
      tier(3, 50, 250, 13, 16, { stat: "attackSpeed", mode: "increased" }),
      tier(2, 70, 110, 17, 21, { stat: "attackSpeed", mode: "increased" }),
      tier(1, 88, 35, 22, 27, { stat: "attackSpeed", mode: "increased" }),
    ],
  },
  {
    id: "plated", name: "Plated", tag: "defense", group: "flat-armor", slots: ["chest", "boots"],
    tiers: [
      tier(6, 1, 1000, 7, 13, { stat: "armor", mode: "flat" }),
      tier(5, 9, 700, 14, 24, { stat: "armor", mode: "flat" }),
      tier(4, 22, 450, 25, 39, { stat: "armor", mode: "flat" }),
      tier(3, 38, 250, 40, 58, { stat: "armor", mode: "flat" }),
      tier(2, 58, 110, 59, 82, { stat: "armor", mode: "flat" }),
      tier(1, 80, 35, 83, 112, { stat: "armor", mode: "flat" }),
    ],
  },
  {
    id: "steadfast", name: "Steadfast", tag: "defense", group: "increased-armor", slots: ["chest", "boots"],
    tiers: [
      tier(6, 1, 1000, 7, 12, { stat: "armor", mode: "increased" }),
      tier(5, 18, 700, 13, 20, { stat: "armor", mode: "increased" }),
      tier(4, 36, 450, 21, 30, { stat: "armor", mode: "increased" }),
      tier(3, 54, 250, 31, 42, { stat: "armor", mode: "increased" }),
      tier(2, 72, 110, 43, 56, { stat: "armor", mode: "increased" }),
      tier(1, 90, 35, 57, 72, { stat: "armor", mode: "increased" }),
    ],
  },
] as const satisfies readonly AffixDefinition[];

export const AFFIX_DEFINITIONS_BY_ID = Object.fromEntries(AFFIX_DEFINITIONS.map((affix) => [affix.id, affix])) as Record<string, AffixDefinition>;
