/**
 * Compatibility barrel for UI imports. Game definitions live in dedicated,
 * data-only config modules under ./config; simulation logic must not live here.
 */
export { CHARACTER_CLASSES } from "./config/classes";
export { MAP_MODIFIERS, MAP_RARITY_LIMITS } from "./config/maps";
export { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "./config/progression";
export type { CharacterClassDefinition } from "./config/schema";
