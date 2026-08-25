import { CHARACTER_CLASSES } from "./config/classes";
import { CURRENCY_DEFINITIONS, STARTING_CURRENCY } from "./config/currencies";
import type { CharacterClassId, CharacterStats, CurrencyId, InventoryItem, PlayerProfile } from "./domain";
import { createCurrencyStack } from "./inventory";
import { createItemContainer } from "./item-container";
import { generateStarterWeapon } from "./items";
import { createMap } from "./maps";
import { createFlaskStack } from "./flasks";
import { createStash } from "./stash";
import { calculateCharacterStats } from "./stats";
import { DEFAULT_SKILL_LOADOUT } from "./skill-loadout";
import { createInitialSkillLevels } from "./domain";

function startingInventory(): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const [currencyId, amount] of Object.entries(STARTING_CURRENCY) as [CurrencyId, number][]) {
    const maximum = CURRENCY_DEFINITIONS[currencyId].maxStackSize;
    for (let remaining = amount; remaining > 0; remaining -= maximum) {
      items.push(createCurrencyStack(currencyId, Math.min(maximum, remaining)));
    }
  }
  return [...items, createMap(1), createMap(1), createMap(2)];
}

export function createInitialProfile(
  name = CHARACTER_CLASSES.sorceress.name,
  classId: CharacterClassId = "sorceress",
): PlayerProfile {
  const classDefinition = CHARACTER_CLASSES[classId];
  return {
    version: 10,
    character: {
      name: name.trim() || classDefinition.name, classId, level: 1, xp: 0,
      allocatedAttributes: { strength: 0, dexterity: 0, intelligence: 0 },
      unspentAttributePoints: 0,
      skillLevels: createInitialSkillLevels(),
      skillLoadout: [...DEFAULT_SKILL_LOADOUT],
      unspentSkillPoints: 0,
      mapsCompleted: 0, highestWave: 0,
    },
    inventory: createItemContainer("backpack", startingInventory()),
    stash: createStash(),
    equipped: { mainHand: generateStarterWeapon(classId) },
    flaskBelt: [createFlaskStack("weak-health-flask", 3), createFlaskStack("weak-mana-flask", 3), null, null, null],
    mapDevice: null,
  };
}

export function deriveStats(profile: PlayerProfile): CharacterStats {
  return calculateCharacterStats(profile).stats;
}
