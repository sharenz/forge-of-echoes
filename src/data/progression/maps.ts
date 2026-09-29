// Maps (GAME_SPEC §6–§7): bases with rule-changing implicits, danger+reward mods, reward-only mods
// (Reward Ink), corrupted mods (Void Needle), tier scaling and map crafting constants.
import type { MapBaseId } from '../../contracts/content';
import { THEME_ROSTER } from '../../contracts/bestiary';
import type { MapBaseDef, MapEffectDef, MapModDef } from './types';

// ---------------------------------------------------------------------------------------------
// Tiers & scaling
// ---------------------------------------------------------------------------------------------

export const MIN_MAP_TIER = 1;
export const MAX_MAP_TIER = 15;
export const MAX_MAP_QUALITY = 20;

/**
 * Monster level (= item level of drops) = clamp(base + perTier × tier, 1, cap). Tier 1 is level 4, so a fresh
 * character can still earn XP from the early deaths the balance pass intends; Tier 15 is level 88.
 */
export const MONSTER_LEVEL = { base: -2, perTier: 6, cap: 90 } as const;

/**
 * Monster stats scale with monster level, not tier (Path of Exile style): life and damage compound per level
 * above `referenceLevel` (the level at which the sim's base monster table applies unchanged), and below it
 * they shrink the same way. Applied as "more" multipliers so the map breakdown stays honest.
 * Tuned with the balance playthroughs (tests/game-progression/balance*.test.ts).
 */
export const MONSTER_LEVEL_SCALING = { life: 1.09, damage: 1.065, referenceLevel: 10 } as const;

/** Deeper maps require more resistance investment; the first two tiers have no penalty. */
export const PLAYER_RESISTANCE_SCALING = { startLevel: 10, perLevel: 0.5, cap: 40 } as const;

/** Tier still drives experience and item rarity; life and damage come from the monster level. */
export const TIER_SCALING = {
  /** Experience compounds per tier so deeper maps keep pace with the XP curve. */
  experience: 1.28,
  /** Additive % increased item rarity per tier above 1. */
  itemRarity: 5,
} as const;

/**
 * Party scaling (GAME_SPEC §11), applied INSIDE the sim from the number n of living players: monster
 * life ×(1 + 0.5·(n−1)) at spawn, wave budget ×(1 + 0.25·(n−1)), magic and rare pack chance
 * ×(1 + 0.1·(n−1)). The rules only explain it (map readout, partyScalingLines); the sim owns the
 * behaviour. Percent per player beyond the first — kept equal to src/sim/constants.ts
 * (PARTY_LIFE_PER_PLAYER, PARTY_BUDGET_PER_PLAYER, PARTY_ELITE_PER_PLAYER) by tests/game-progression/maps.test.ts.
 */
export const PARTY_SCALING = { monsterLife: 50, waveBudget: 25, packRarity: 10 } as const;

/** Baseline pack rarity chances (sim MonsterScaling), multiplied by pack-rarity modifiers. */
export const BASE_MAGIC_PACK_CHANCE = 0.1;
export const BASE_RARE_PACK_CHANCE = 0.03;

/** Waves (GAME_SPEC §0/§8). The Echo corruption adds one wave after the boss. */
export const WAVES = {
  count: 6,
  baseMonsters: 40,
  monstersPerWave: 18,
  waveDuration: 60,
  tellDuration: 3,
  lieutenantWave: 0,
  bossWave: 6,
} as const;

/** Kills in the Echo wave drop loot as if the map had this much more item quantity (double loot). */
export const ECHO_WAVE_QUANTITY_MORE = 100;

/** The hideout arena. */
export const HIDEOUT_ARENA_RADIUS = 260;

/**
 * Seed of a hideout instance. buildRunConfig(null, hooks) has no character, so every hideout starts
 * from this seed; a server that wants per-owner decor may overwrite RunConfig.seed before createRun.
 */
export const HIDEOUT_SEED = 0x41de0;

/**
 * Rolled mod value = percent of the nominal magnitude. Values scale slightly with tier:
 * roll uniformly in [min, max] + perTier × (tier − 1).
 */
export const MOD_VALUE_ROLL = { min: 100, max: 110, perTier: 3 } as const;

// ---------------------------------------------------------------------------------------------
// Map crafting
// ---------------------------------------------------------------------------------------------

/** Danger mods by rarity: Normal 0, Magic 1–2, Rare 3–4 (a map becomes Rare at 3). */
export const MAP_DANGER_LIMITS = { magic: { min: 1, max: 2 }, rare: { min: 3, max: 4 } } as const;
export const MAX_DANGER_MODS = 4;
/** Reward Ink: at most one reward-only mod per map (it does not count toward rarity). */
export const MAX_REWARD_MODS = 1;

/** Map Dust on a Normal map, and when rerolling: number of danger mods by rarity band. */
export const MAP_DUST_COUNTS = {
  magic: [{ count: 1, weight: 50 }, { count: 2, weight: 50 }],
  rare: [{ count: 3, weight: 50 }, { count: 4, weight: 50 }],
} as const;

export type VoidOutcomeId = 'corruptedMod' | 'tierUp' | 'rareFour' | 'echoWave' | 'nothing';

/** Void Needle outcomes (GAME_SPEC §6). An impossible outcome (+1 tier at the cap) is left out. */
export const VOID_NEEDLE_OUTCOMES: readonly { id: VoidOutcomeId; label: string; weight: number }[] = [
  { id: 'corruptedMod', label: 'Corrupted mod', weight: 30 },
  { id: 'tierUp', label: '+1 Tier', weight: 20 },
  { id: 'rareFour', label: 'Rare with 4 danger mods', weight: 20 },
  { id: 'echoWave', label: 'Echo wave', weight: 15 },
  { id: 'nothing', label: 'Only corruption', weight: 15 },
];

/** Quality of dropped maps: none most of the time, otherwise a small uniform roll. */
export const DROPPED_MAP_QUALITY = { chance: 0.25, min: 1, max: 10 } as const;
/** The completion chest's map always carries some quality. */
export const CHEST_MAP_QUALITY = { min: 4, max: 12 } as const;

// ---------------------------------------------------------------------------------------------
// Bases
// ---------------------------------------------------------------------------------------------

const more = (stat: MapEffectDef['stat'], value: number): MapEffectDef => ({ stat, mode: 'more', value, fixed: true });

/** A map base's monsters, straight from the sim's roster for its theme (GAME_SPEC §14). */
function roster(theme: keyof typeof THEME_ROSTER): Pick<MapBaseDef, 'family' | 'lieutenant' | 'boss'> {
  const r = THEME_ROSTER[theme];
  return { family: [...r.family], lieutenant: r.lieutenant, boss: r.boss };
}

export const MAP_BASES: Record<MapBaseId, MapBaseDef> = {
  cinderChapel: {
    id: 'cinderChapel', name: 'Cinder Chapel', theme: 'cinderChapel',
    description: 'A charcoal chapel of broken aisles and ember-lit altars. The Ashbound Herald guards its last rite with void orbs and an empowering host.',
    arenaRadius: 800, ...roster('cinderChapel'),
    implicitEffects: [
      { stat: 'packRarity', mode: 'increased', value: 25, fixed: true },
      more('essenceDropChance', 100),
    ],
    dropWeight: 100,
  },
  choralCrypt: {
    id: 'choralCrypt', name: 'Choral Crypt', theme: 'choralCrypt',
    description: 'Violet stone and bone-lined choirs beneath a silent cathedral. The Bone Chorister raises the fallen and sings expanding rings of frost.',
    arenaRadius: 850, ...roster('choralCrypt'),
    implicitEffects: [
      { stat: 'monsterSpeed', mode: 'increased', value: 10, fixed: true },
      { stat: 'itemRarity', mode: 'increased', value: 25, fixed: true },
    ],
    dropWeight: 100,
  },
  chainworks: {
    id: 'chainworks', name: 'Chainworks', theme: 'chainworks', arenaNote: 'Compact factory floor',
    description: 'Rusted grates and abandoned hauling lines in a cramped iron works. The Chainmaster drags intruders into his whirling chains.',
    arenaRadius: 700, ...roster('chainworks'),
    implicitEffects: [
      { stat: 'monsterCount', mode: 'increased', value: 15, fixed: true },
      { stat: 'itemQuantity', mode: 'increased', value: 10, fixed: true },
    ],
    dropWeight: 100,
  },
  ashenForge: {
    id: 'ashenForge',
    name: 'Ashen Forge',
    theme: 'ashenForge',
    description: 'A sunken smithy of lava-cracked basalt where the forge fires never went out. '
      + 'Its boss is the Cinder Matriarch, mother of every ember in the deep.',
    arenaRadius: 900,
    ...roster('ashenForge'),
    implicitEffects: [
      more('emberEssenceChance', 200),
      { stat: 'monsterResist', mode: 'flat', value: 10, fixed: true },
    ],
    dropWeight: 100,
  },
  rimedOssuary: {
    id: 'rimedOssuary',
    name: 'Rimed Ossuary',
    theme: 'rimedOssuary',
    description: 'Frosted bone tiles under cold blue crystal light. The dead here keep very still. '
      + 'Its boss is The Hollow Warden, a crowned rime-lich with a frozen lantern.',
    arenaRadius: 900,
    ...roster('rimedOssuary'),
    implicitEffects: [
      more('rimeEssenceChance', 200),
      { stat: 'monsterLife', mode: 'increased', value: 20, fixed: true },
      { stat: 'itemRarity', mode: 'increased', value: 15, fixed: true },
    ],
    dropWeight: 100,
  },
  ironColiseum: {
    id: 'ironColiseum',
    name: 'Iron Coliseum',
    theme: 'ironColiseum',
    arenaNote: 'Small arena',
    description: 'A tight ring of rusted iron plates and sand, lit by torches. The crowd is long gone; the fighting is not. '
      + 'Its boss is Varkus, the Iron Champion, who has never left the sand.',
    arenaRadius: 650,
    ...roster('ironColiseum'),
    implicitEffects: [
      { stat: 'monsterCount', mode: 'increased', value: 25, fixed: true },
      { stat: 'armourStability', mode: 'flat', value: 2, fixed: true },
    ],
    dropWeight: 100,
  },
};

// ---------------------------------------------------------------------------------------------
// Mods
// ---------------------------------------------------------------------------------------------

function mod(id: string, name: string, kind: MapModDef['kind'], danger: MapEffectDef[], reward: MapEffectDef[], weight = 100): MapModDef {
  return { id, name, kind, danger, reward, weight };
}
const inc = (stat: MapEffectDef['stat'], value: number, fixed = false): MapEffectDef =>
  ({ stat, mode: 'increased', value, ...(fixed ? { fixed } : {}) });
const flat = (stat: MapEffectDef['stat'], value: number, fixed = false): MapEffectDef =>
  ({ stat, mode: 'flat', value, ...(fixed ? { fixed } : {}) });

/** Danger mods: every one pairs a threat with its reward (Threat Glyph, Map Dust). */
export const DANGER_MODS: readonly MapModDef[] = [
  mod('teeming', 'Teeming', 'danger', [inc('monsterCount', 35)], [inc('itemQuantity', 20)]),
  mod('commanded', 'Commanded', 'danger', [inc('packRarity', 60)], [inc('itemRarity', 25)]),
  mod('restless', 'Restless', 'danger', [inc('monsterSpeed', 20)], [inc('itemQuantity', 15)]),
  mod('volcanic', 'Volcanic', 'danger', [flat('hazards', 1, true)], [inc('itemQuantity', 20)], 80),
  mod('fortified', 'Fortified', 'danger', [inc('monsterLife', 40)], [inc('itemQuantity', 18)]),
  mod('ferocious', 'Ferocious', 'danger', [inc('monsterDamage', 25)], [inc('itemQuantity', 22)]),
  mod('twinCrowned', 'Twin-Crowned', 'danger', [{ stat: 'monsterLife', mode: 'more', value: 25 }], [inc('itemRarity', 40)], 60),
  mod('exhausting', 'Exhausting', 'danger', [inc('playerFocusRegen', -40, true)], [inc('itemQuantity', 20)], 80),
  mod('hexed', 'Hexed', 'danger', [flat('playerResist', -20, true)], [inc('itemRarity', 18)], 80),
  mod('splitting', 'Splitting', 'danger', [flat('monsterProjectiles', 1, true)], [inc('itemQuantity', 15)], 80),
];

/** Reward-only mods (Reward Ink, at most one per map). */
export const REWARD_MODS: readonly MapModDef[] = [
  mod('gilded', 'Gilded', 'reward', [], [inc('itemRarity', 30)]),
  mod('bountiful', 'Bountiful', 'reward', [], [inc('itemQuantity', 25)]),
  mod('cartographers', "Cartographer's", 'reward', [], [more('mapDropChance', 200)]),
  mod('essenceLaden', 'Essence-laden', 'reward', [], [more('essenceDropChance', 200)]),
];

/**
 * Corrupted mods (Void Needle): a strong threat for a strong payout. The Wrath rolls on every map base and is named
 * after that base's boss; its id stays 'matriarchsWrath' everywhere (saved maps keep it).
 */
export const CORRUPTED_MODS: readonly MapModDef[] = [
  mod('seethingHorde', 'Seething Horde', 'corrupted', [inc('monsterCount', 60)], [inc('itemQuantity', 35)]),
  {
    ...mod('matriarchsWrath', "Matriarch's Wrath", 'corrupted', [inc('monsterDamage', 40)], [inc('itemRarity', 50)]),
    nameByBase: { ashenForge: "Matriarch's Wrath", rimedOssuary: "The Warden's Wrath", ironColiseum: "Varkus's Wrath", cinderChapel: "The Herald's Wrath", choralCrypt: "The Chorister's Wrath", chainworks: "The Chainmaster's Wrath" },
  },
  mod('bloodbound', 'Bloodbound', 'corrupted', [{ stat: 'monsterLife', mode: 'more', value: 40 }],
    [inc('itemQuantity', 25), inc('itemRarity', 25)]),
  mod('unravelling', 'Unravelling', 'corrupted', [flat('playerResist', -30, true)], [inc('itemRarity', 55)]),
  mod('crownedHost', 'Crowned Host', 'corrupted', [inc('packRarity', 100)], [inc('itemQuantity', 20), inc('itemRarity', 30)]),
];

/** Void Needle "+1 wave": the map carries this corrupted mod. */
export const ECHO_MOD: MapModDef = mod('echo', 'Echoing', 'echo', [], [flat('echoWave', 1, true)], 0);

/** Rare map names: one word from each list, picked from the map's uid (stable for the map's life). */
export const MAP_NAME_FIRST: readonly string[] = [
  'Howling', 'Sunken', 'Hollow', 'Gilded', 'Weeping', 'Shattered', 'Silent', 'Burning', 'Forsaken', 'Crimson',
  'Veiled', 'Ruined', 'Blighted', 'Starless', 'Molten', 'Bleak', 'Gnawing', 'Smouldering', 'Bitter', 'Drowned',
  'Ashen', 'Broken', 'Hungering', 'Sleepless',
];
export const MAP_NAME_SECOND: readonly string[] = [
  'Reach', 'Crypt', 'Descent', 'Gate', 'Pyre', 'Maw', 'Vault', 'Sanctum', 'Mire', 'Crucible',
  'Barrow', 'Spire', 'Anvil', 'Throne', 'Pit', 'Hearth', 'Cloister', 'Furnace', 'Rookery', 'Chapel',
  'Hollows', 'Kiln', 'Warren', 'Altar',
];
