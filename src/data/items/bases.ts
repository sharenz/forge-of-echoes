// Equipment bases (GAME_SPEC §5). Every base has one implicit line (a few have two), a grid
// footprint by class, a stability budget and, for some, a crafting material that bends the rules.
import type { ModifierMode, StatId } from '../../contracts/items';
import type { BaseId, EquipSlot, ItemClass } from '../../contracts/content';
import type { BaseDef, BasePropertyDef, ImplicitDef } from './types';

/** Equipment slots per item class. Rings fit either ring slot. */
export const CLASS_SLOTS: Record<ItemClass, readonly EquipSlot[]> = {
  wand: ['mainHand'],
  sceptre: ['mainHand'],
  focus: ['offHand'],
  helmet: ['helmet'],
  chest: ['chest'],
  gloves: ['gloves'],
  boots: ['boots'],
  belt: ['belt'],
  amulet: ['amulet'],
  ring: ['ring1', 'ring2'],
};

/** Grid footprint per item class (cells). */
export const CLASS_SIZE: Record<ItemClass, { w: number; h: number }> = {
  wand: { w: 1, h: 3 },
  sceptre: { w: 2, h: 3 },
  focus: { w: 2, h: 2 },
  helmet: { w: 2, h: 2 },
  chest: { w: 2, h: 3 },
  gloves: { w: 2, h: 2 },
  boots: { w: 2, h: 2 },
  belt: { w: 2, h: 1 },
  amulet: { w: 1, h: 1 },
  ring: { w: 1, h: 1 },
};

function imp(stat: StatId, mode: ModifierMode, min: number, max: number): ImplicitDef {
  return { stats: [stat], mode, min, max };
}

const armour = (base: number, perItemLevel: number): BasePropertyDef =>
  ({ stat: 'armor', label: 'Armour', base, perItemLevel });
const evasion = (base: number, perItemLevel: number): BasePropertyDef =>
  ({ stat: 'evasion', label: 'Evasion Rating', base, perItemLevel });
const spell = (base: number, perItemLevel: number): BasePropertyDef =>
  ({ stat: 'addedSpellDamage', label: 'Added Spell Damage', base, perItemLevel });

const PLAIN = 'No special material.';
const IRON_BOUND = 'Iron-bound: 9 Stability, one more than most bases.';
const DELICATE = 'Delicate: 7 Stability, one less than most bases.';

type BaseSpec = Omit<BaseDef, 'id' | 'slots' | 'size' | 'dropWeight'> & { dropWeight?: number };

function base(id: BaseId, spec: BaseSpec): BaseDef {
  return {
    id,
    slots: [...CLASS_SLOTS[spec.itemClass]],
    size: { ...CLASS_SIZE[spec.itemClass] },
    dropWeight: 100,
    ...spec,
  };
}

export const BASES: Record<BaseId, BaseDef> = {
  // --- main hand -------------------------------------------------------------------------------
  ashwoodWand: base('ashwoodWand', {
    name: 'Ashwood Wand',
    itemClass: 'wand',
    levelRequirement: 1,
    maxStability: 8,
    materialNote: 'Ashwood: fire affixes are twice as likely.',
    implicits: [imp('fireDamage', 'increased', 12, 16)],
    properties: [spell(1, 0.06)],
    material: { name: 'Ashwood', tagWeights: { fire: 2 } },
  }),
  glassboneWand: base('glassboneWand', {
    name: 'Glassbone Wand',
    itemClass: 'wand',
    levelRequirement: 8,
    maxStability: 6,
    materialNote: 'Glassbone: brittle. Scar risk begins at 3 Stability instead of 2.',
    implicits: [imp('projectileSpeed', 'increased', 8, 12), imp('addedSpellDamage', 'flat', 2, 4)],
    properties: [spell(1, 0.06)],
    material: { name: 'Glassbone', scarThreshold: 3 },
  }),
  ironrootWand: base('ironrootWand', {
    name: 'Ironroot Wand',
    itemClass: 'wand',
    levelRequirement: 14,
    maxStability: 10,
    materialNote: 'Ironroot: tough. 2 extra Stability for longer crafting projects.',
    implicits: [imp('addedSpellDamage', 'flat', 3, 5)],
    properties: [spell(1, 0.06)],
    material: { name: 'Ironroot' },
  }),
  emberSceptre: base('emberSceptre', {
    name: 'Ember Sceptre',
    itemClass: 'sceptre',
    levelRequirement: 20,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('spellDamage', 'increased', 18, 24)],
    properties: [spell(2, 0.09)],
  }),

  // --- off hand --------------------------------------------------------------------------------
  cinderOrb: base('cinderOrb', {
    name: 'Cinder Orb',
    itemClass: 'focus',
    levelRequirement: 10,
    maxStability: 8,
    materialNote: 'Cinderglass: critical affixes are twice as likely.',
    implicits: [imp('critChance', 'flat', 4, 6)],
    properties: [],
    material: { name: 'Cinderglass', tagWeights: { critical: 2 } },
  }),
  runedTome: base('runedTome', {
    name: 'Runed Tome',
    itemClass: 'focus',
    levelRequirement: 5,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('castSpeed', 'increased', 6, 10)],
    properties: [],
  }),

  // --- armour ----------------------------------------------------------------------------------
  ritualCirclet: base('ritualCirclet', {
    name: 'Ritual Circlet',
    itemClass: 'helmet',
    levelRequirement: 1,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('maxFocus', 'flat', 10, 16)],
    properties: [evasion(8, 0.4)],
  }),
  ironVisor: base('ironVisor', {
    name: 'Iron Visor',
    itemClass: 'helmet',
    levelRequirement: 6,
    maxStability: 9,
    materialNote: 'Forged iron: defence affixes are twice as likely.',
    implicits: [imp('armor', 'flat', 20, 30)],
    properties: [armour(10, 0.5)],
    material: { name: 'Forged iron', tagWeights: { defense: 2 } },
  }),
  ashenRobe: base('ashenRobe', {
    name: 'Ashen Robe',
    itemClass: 'chest',
    levelRequirement: 1,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('evasion', 'flat', 30, 45), imp('maxFocus', 'flat', 8, 12)],
    properties: [evasion(12, 0.8)],
  }),
  rivetedCoat: base('rivetedCoat', {
    name: 'Riveted Coat',
    itemClass: 'chest',
    levelRequirement: 12,
    maxStability: 9,
    materialNote: IRON_BOUND,
    implicits: [imp('armor', 'flat', 45, 60)],
    properties: [armour(18, 1)],
  }),
  silkWraps: base('silkWraps', {
    name: 'Silk Wraps',
    itemClass: 'gloves',
    levelRequirement: 1,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('castSpeed', 'increased', 4, 7)],
    properties: [evasion(6, 0.35)],
  }),
  graspingGauntlets: base('graspingGauntlets', {
    name: 'Grasping Gauntlets',
    itemClass: 'gloves',
    levelRequirement: 8,
    maxStability: 9,
    materialNote: IRON_BOUND,
    implicits: [imp('armor', 'flat', 15, 22)],
    properties: [armour(8, 0.4)],
  }),
  pathfinderBoots: base('pathfinderBoots', {
    name: 'Pathfinder Boots',
    itemClass: 'boots',
    levelRequirement: 1,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('moveSpeed', 'increased', 6, 10)],
    properties: [armour(4, 0.25), evasion(4, 0.25)],
  }),
  ashenSandals: base('ashenSandals', {
    name: 'Ashen Sandals',
    itemClass: 'boots',
    levelRequirement: 6,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('evasion', 'flat', 20, 30)],
    properties: [evasion(8, 0.4)],
  }),
  chainBelt: base('chainBelt', {
    name: 'Chain Belt',
    itemClass: 'belt',
    levelRequirement: 1,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('maxLife', 'flat', 18, 26)],
    properties: [],
  }),
  runedSash: base('runedSash', {
    name: 'Runed Sash',
    itemClass: 'belt',
    levelRequirement: 10,
    maxStability: 8,
    materialNote: PLAIN,
    implicits: [imp('flaskEffect', 'increased', 10, 15)],
    properties: [],
  }),

  // --- armour economy: hybrids and armoured variants for every armour slot ---------------------
  // Armour / Evasion hybrids give roughly half of each; the Warded Vestment keeps a robe's focus
  // identity but carries a little armour so caster chests can still invest in armour.
  scaleCowl: base('scaleCowl', {
    name: 'Scale Cowl', itemClass: 'helmet', levelRequirement: 4, maxStability: 8, materialNote: PLAIN,
    implicits: [imp('maxLife', 'flat', 8, 14)], properties: [armour(6, 0.3), evasion(6, 0.3)],
  }),
  quiltedJerkin: base('quiltedJerkin', {
    name: 'Quilted Jerkin', itemClass: 'chest', levelRequirement: 6, maxStability: 8, materialNote: PLAIN,
    implicits: [imp('maxLife', 'flat', 14, 22)], properties: [armour(10, 0.55), evasion(10, 0.55)],
  }),
  wardedVestment: base('wardedVestment', {
    name: 'Warded Vestment', itemClass: 'chest', levelRequirement: 10, maxStability: 8, materialNote: PLAIN,
    implicits: [imp('maxFocus', 'flat', 10, 16)], properties: [armour(6, 0.3), evasion(8, 0.55)],
  }),
  studdedGloves: base('studdedGloves', {
    name: 'Studded Gloves', itemClass: 'gloves', levelRequirement: 4, maxStability: 8, materialNote: PLAIN,
    implicits: [imp('maxLife', 'flat', 6, 10)], properties: [armour(4, 0.2), evasion(4, 0.2)],
  }),
  ironshodBoots: base('ironshodBoots', {
    name: 'Ironshod Boots', itemClass: 'boots', levelRequirement: 8, maxStability: 9, materialNote: IRON_BOUND,
    implicits: [imp('moveSpeed', 'increased', 4, 7)], properties: [armour(9, 0.45)],
  }),
  studdedBelt: base('studdedBelt', {
    name: 'Studded Belt', itemClass: 'belt', levelRequirement: 8, maxStability: 8, materialNote: PLAIN,
    implicits: [imp('maxLife', 'flat', 10, 16)], properties: [armour(8, 0.4)],
  }),

  // --- jewellery -------------------------------------------------------------------------------
  cinderPendant: base('cinderPendant', {
    name: 'Cinder Pendant',
    itemClass: 'amulet',
    levelRequirement: 1,
    maxStability: 7,
    materialNote: DELICATE,
    implicits: [imp('maxFocus', 'flat', 12, 18)],
    properties: [],
  }),
  boneTalisman: base('boneTalisman', {
    name: 'Bone Talisman',
    itemClass: 'amulet',
    levelRequirement: 12,
    maxStability: 7,
    materialNote: DELICATE,
    implicits: [{ stats: ['str', 'dex', 'int'], mode: 'flat', min: 8, max: 12, text: '{+v} to all Attributes' }],
    properties: [],
  }),
  emberRing: base('emberRing', {
    name: 'Ember Ring',
    itemClass: 'ring',
    levelRequirement: 1,
    maxStability: 7,
    materialNote: DELICATE,
    implicits: [imp('fireRes', 'flat', 15, 20)],
    properties: [],
  }),
  rimeBand: base('rimeBand', {
    name: 'Rime Band',
    itemClass: 'ring',
    levelRequirement: 1,
    maxStability: 7,
    materialNote: DELICATE,
    implicits: [imp('coldRes', 'flat', 15, 20)],
    properties: [],
  }),
  stormLoop: base('stormLoop', {
    name: 'Storm Loop',
    itemClass: 'ring',
    levelRequirement: 1,
    maxStability: 7,
    materialNote: DELICATE,
    implicits: [imp('lightningRes', 'flat', 15, 20)],
    properties: [],
  }),
  voidSignet: base('voidSignet', {
    name: 'Void Signet',
    itemClass: 'ring',
    levelRequirement: 16,
    maxStability: 7,
    materialNote: DELICATE,
    implicits: [imp('voidRes', 'flat', 10, 14)],
    properties: [],
  }),

  // --- advanced bases: first available from Tier 8 (monster/item level 46) -----------------------
  emberheartWand: base('emberheartWand', {
    name: 'Emberheart Wand', itemClass: 'wand', levelRequirement: 42, maxStability: 9,
    materialNote: 'Emberheart: fire affixes are twice as likely.',
    implicits: [imp('fireDamage', 'increased', 18, 24)], properties: [spell(3, 0.11)],
    material: { name: 'Emberheart', tagWeights: { fire: 2 } },
  }),
  stormglassSceptre: base('stormglassSceptre', {
    name: 'Stormglass Sceptre', itemClass: 'sceptre', levelRequirement: 46, maxStability: 8,
    materialNote: 'Stormglass: lightning affixes are twice as likely.',
    implicits: [imp('spellDamage', 'increased', 24, 30)], properties: [spell(4, 0.14)],
    material: { name: 'Stormglass', tagWeights: { lightning: 2 } },
  }),
  echoingFocus: base('echoingFocus', {
    name: 'Echoing Focus', itemClass: 'focus', levelRequirement: 42, maxStability: 9,
    materialNote: 'Echo crystal: speed affixes are twice as likely.',
    implicits: [imp('castSpeed', 'increased', 10, 14), imp('maxFocus', 'flat', 20, 28)], properties: [],
    material: { name: 'Echo crystal', tagWeights: { speed: 2 } },
  }),
  bastionHelm: base('bastionHelm', {
    name: 'Bastion Helm', itemClass: 'helmet', levelRequirement: 42, maxStability: 10,
    materialNote: 'Bastion plate: defence affixes are twice as likely.',
    implicits: [imp('maxLife', 'flat', 25, 35)], properties: [armour(30, 0.85)],
    material: { name: 'Bastion plate', tagWeights: { defense: 2 } },
  }),
  duskweaveRobe: base('duskweaveRobe', {
    name: 'Duskweave Robe', itemClass: 'chest', levelRequirement: 46, maxStability: 9,
    materialNote: 'Duskweave: void affixes are twice as likely.',
    implicits: [imp('evasion', 'flat', 45, 60), imp('maxFocus', 'flat', 25, 35)], properties: [evasion(35, 1.3)],
    material: { name: 'Duskweave', tagWeights: { void: 2 } },
  }),
  forgemasterGloves: base('forgemasterGloves', {
    name: 'Forgemaster Gloves', itemClass: 'gloves', levelRequirement: 42, maxStability: 10,
    materialNote: 'Forgemaster steel: 10 Stability for longer crafting projects.',
    implicits: [imp('castSpeed', 'increased', 7, 10)], properties: [armour(20, 0.65)],
  }),
  wayfarerGreaves: base('wayfarerGreaves', {
    name: 'Wayfarer Greaves', itemClass: 'boots', levelRequirement: 42, maxStability: 9,
    materialNote: 'Wayfarer leather: speed affixes are twice as likely.',
    implicits: [imp('moveSpeed', 'increased', 10, 14)], properties: [armour(14, 0.45), evasion(14, 0.45)],
    material: { name: 'Wayfarer leather', tagWeights: { speed: 2 } },
  }),
  ironweaveGirdle: base('ironweaveGirdle', {
    name: 'Ironweave Girdle', itemClass: 'belt', levelRequirement: 46, maxStability: 10,
    materialNote: 'Ironweave: life affixes are twice as likely.',
    implicits: [imp('maxLife', 'flat', 30, 42)], properties: [],
    material: { name: 'Ironweave', tagWeights: { life: 2 } },
  }),
  prismaticAmulet: base('prismaticAmulet', {
    name: 'Prismatic Amulet', itemClass: 'amulet', levelRequirement: 42, maxStability: 8,
    materialNote: 'Prismatic crystal: resistance affixes are twice as likely.',
    implicits: [{ stats: ['str', 'dex', 'int'], mode: 'flat', min: 12, max: 16, text: '{+v} to all Attributes' }], properties: [],
    material: { name: 'Prismatic crystal', tagWeights: { resistance: 2 } },
  }),
  dusksteelRing: base('dusksteelRing', {
    name: 'Dusksteel Ring', itemClass: 'ring', levelRequirement: 46, maxStability: 8,
    materialNote: 'Dusksteel: void affixes are twice as likely.',
    implicits: [imp('voidRes', 'flat', 18, 24), imp('maxFocus', 'flat', 18, 24)], properties: [],
    material: { name: 'Dusksteel', tagWeights: { void: 2 } },
  }),
};
