// FROZEN CONTRACT — canonical content identifiers shared by every module.
// Data tables (src/data), art (icons/sprites), sim (behaviour) and UI all key off these ids.
// Do not rename or remove ids; if an addition is genuinely required, report it to the orchestrator.

export const DAMAGE_TYPES = ['physical', 'fire', 'cold', 'lightning', 'void'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const ATTRIBUTES = ['str', 'dex', 'int'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const ITEM_CLASSES = ['wand', 'sceptre', 'focus', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring'] as const;
export type ItemClass = (typeof ITEM_CLASSES)[number];

export const EQUIP_SLOTS = ['mainHand', 'offHand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Equipment bases. Icon id for each base is `icon/base/<id>`. */
export const BASE_IDS = [
  // main hand
  'ashwoodWand', 'glassboneWand', 'ironrootWand', 'emberSceptre',
  // off hand
  'cinderOrb', 'runedTome',
  // armour
  'ritualCirclet', 'ironVisor',
  'ashenRobe', 'rivetedCoat',
  'silkWraps', 'graspingGauntlets',
  'pathfinderBoots', 'ashenSandals',
  'chainBelt', 'runedSash',
  // jewellery
  'cinderPendant', 'boneTalisman',
  'emberRing', 'rimeBand', 'stormLoop', 'voidSignet',
] as const;
export type BaseId = (typeof BASE_IDS)[number];

/** Uniques. Icon id is `icon/unique/<id>`. */
export const UNIQUE_IDS = ['thePatientSpark', 'cinderwalkers', 'echoOfTheMatriarch', 'ruinheartBand'] as const;
export type UniqueId = (typeof UNIQUE_IDS)[number];

/** Crafting currencies. Icon id is `icon/currency/<id>`. */
export const EQUIPMENT_CURRENCY_IDS = [
  'kindling',       // Shape: normal → magic with 1–2 random affixes
  'scrap',          // Shape: reroll the values of all unsealed affixes within their tiers (also the merchant money)
  'reforge',        // Shape: reroll all unsealed affixes; item becomes rare (3–6 affixes)
  'essenceEmber',   // Shape: add one fire-tagged affix
  'essenceRime',    // Shape: add one cold-tagged affix
  'essenceStorm',   // Shape: add one lightning-tagged affix
  'essenceVital',   // Shape: add one life/defence-tagged affix
  'essenceSwift',   // Shape: add one speed-tagged affix
  'catalyst',       // Refine: upgrade one chosen affix by one tier (bounded by item level)
  'solvent',        // Remove: remove the lowest-tier unsealed, unfractured affix
  'seal',           // Preserve: seal one chosen affix for the next operation
  'fractureCore',   // Transform: fracture one chosen affix permanently (immune to all crafting)
] as const;
export const MAP_CURRENCY_IDS = [
  'mapDust',        // normal → magic, or reroll a magic/rare map's mods
  'threatGlyph',    // add one danger mod (danger paired with reward)
  'rewardInk',      // add one reward-only mod (costs map quality / is rarer)
  'voidNeedle',     // corrupt a map: random powerful outcome, then locked
  'reliquaryKey',   // consumed by the map device to enter the Sealed Reliquary
] as const;
export const CURRENCY_IDS = [...EQUIPMENT_CURRENCY_IDS, ...MAP_CURRENCY_IDS] as const;
export type CurrencyId = (typeof CURRENCY_IDS)[number];

/** Flasks. Icon id is `icon/flask/<id>`. */
export const FLASK_IDS = ['lifeFlask', 'focusFlask'] as const;
export type FlaskId = (typeof FLASK_IDS)[number];

/** Map bases. Icon id is `icon/map/<id>`. Each base has its own visual theme. */
export const MAP_BASE_IDS = ['ashenForge', 'rimedOssuary', 'ironColiseum'] as const;
export type MapBaseId = (typeof MAP_BASE_IDS)[number];

export const THEMES = ['hideout', 'ashenForge', 'rimedOssuary', 'ironColiseum'] as const;
export type Theme = (typeof THEMES)[number];

/** Sorceress skills. Icon id is `icon/skill/<id>`. `emberLance` is the innate basic attack. */
export const SKILL_IDS = ['emberLance', 'emberNova', 'flameWave', 'rimeShards', 'arcChain', 'riftStep', 'cinderWard'] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export const MONSTER_KINDS = [
  'ashling',         // swarmer: small melee, the bulk of every wave
  'emberSkitter',    // fast, fragile, erratic
  'cinderSpitter',   // artillery: keeps distance, lobs fire spit
  'riftStalker',     // hunter: telegraphed leap onto the player
  'ironhideBrute',   // bruiser: slow, armoured, heavy telegraphed slam
  'ashboundHerald',  // lieutenant (wave 3): shields/empowers nearby monsters, summons ashlings
  'cinderMatriarch', // boss (final wave): multi-phase, telegraphed attacks
  'trainingDummy',   // hideout only: never dies, shows damage numbers
  // Rimed Ossuary roster (GAME_SPEC §14) — appended so existing wire indices stay stable
  'boneThrall', 'rimeshade', 'frostWeaver', 'glacialWisp', 'ossuaryGolem', 'boneChorister', 'hollowWarden',
  // Iron Coliseum roster
  'pitHound', 'chainThrall', 'ironCrossbowman', 'shieldbearer', 'tarSlinger', 'chainmaster', 'varkus',
] as const;
export type MonsterKind = (typeof MONSTER_KINDS)[number];

export const CLASS_IDS = ['sorceress'] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/** Special behaviours granted by uniques; resolved by the rules into PlayerCombatStats.flags / SkillRuntimeDef.flags. */
export const PLAYER_FLAGS = [
  'lancePierceAll',   // The Patient Spark: Ember Lance pierces all targets
  'fireTrail',        // Cinderwalkers: moving leaves burning ground that damages monsters
  'novaEcho',         // Echo of the Matriarch: Ember Nova repeats once after 0.4 s
] as const;
export type PlayerFlag = (typeof PLAYER_FLAGS)[number];

/** Icon ids used by the DOM UI. Art must provide every one of these. */
export function iconIdForBase(id: BaseId): string { return `icon/base/${id}`; }
export function iconIdForUnique(id: UniqueId): string { return `icon/unique/${id}`; }
export function iconIdForCurrency(id: CurrencyId): string { return `icon/currency/${id}`; }
export function iconIdForFlask(id: FlaskId): string { return `icon/flask/${id}`; }
export function iconIdForMap(id: MapBaseId): string { return `icon/map/${id}`; }
export function iconIdForSkill(id: SkillId): string { return `icon/skill/${id}`; }

export const ALL_ICON_IDS: readonly string[] = [
  ...BASE_IDS.map(iconIdForBase),
  ...UNIQUE_IDS.map(iconIdForUnique),
  ...CURRENCY_IDS.map(iconIdForCurrency),
  ...FLASK_IDS.map(iconIdForFlask),
  ...MAP_BASE_IDS.map(iconIdForMap),
  ...SKILL_IDS.map(iconIdForSkill),
  'icon/ui/attributeStr', 'icon/ui/attributeDex', 'icon/ui/attributeInt',
  'icon/ui/locked', 'icon/ui/stability', 'icon/ui/scar', 'icon/ui/seal', 'icon/ui/fracture',
];
