// Display text for every stat × modifier mode, plus shared labels.
//
// Template placeholders (resolved by src/game/items/format.ts):
//   {v}     absolute value                         "18"
//   {+v}    signed value with a typographic minus  "+24" / "−8"
//   {inc}   "increased" / "reduced" by sign
//   {more}  "more" / "less" by sign
//   {s}     plural "s" unless |value| is 1
import type { AffixTag, ModifierMode, StatId } from '../../contracts/items';
import type { ItemClass } from '../../contracts/content';

type Templates = Partial<Record<ModifierMode, string>>;

export const STAT_TEXT: Record<StatId, Templates> = {
  str: { flat: '{+v} to Strength', increased: '{v}% {inc} Strength' },
  dex: { flat: '{+v} to Dexterity', increased: '{v}% {inc} Dexterity' },
  int: { flat: '{+v} to Intelligence', increased: '{v}% {inc} Intelligence' },

  maxLife: { flat: '{+v} to maximum Life', increased: '{v}% {inc} maximum Life', more: '{v}% {more} maximum Life' },
  lifeRegen: { flat: 'Regenerate {v} Life per second', increased: '{v}% {inc} Life Regeneration Rate' },
  maxFocus: { flat: '{+v} to maximum Focus', increased: '{v}% {inc} maximum Focus', more: '{v}% {more} maximum Focus' },
  focusRegen: { flat: 'Regenerate {v} Focus per second', increased: '{v}% {inc} Focus Regeneration Rate' },
  lifeOnKill: { flat: 'Gain {v} Life per enemy killed' },
  focusOnKill: { flat: 'Gain {v} Focus per enemy killed' },

  armor: { flat: '{+v} to Armour', increased: '{v}% {inc} Armour', more: '{v}% {more} Armour' },
  evasion: { flat: '{+v} to Evasion Rating', increased: '{v}% {inc} Evasion Rating', more: '{v}% {more} Evasion Rating' },
  fireRes: { flat: '{+v}% to Fire Resistance' },
  coldRes: { flat: '{+v}% to Cold Resistance' },
  lightningRes: { flat: '{+v}% to Lightning Resistance' },
  voidRes: { flat: '{+v}% to Void Resistance' },
  allRes: { flat: '{+v}% to all Resistances' },
  damageTaken: { increased: '{v}% {inc} Damage taken', more: '{v}% {more} Damage taken' },

  spellDamage: { increased: '{v}% {inc} Spell Damage', more: '{v}% {more} Spell Damage' },
  addedSpellDamage: { flat: 'Adds {v} Spell Damage' },
  fireDamage: { increased: '{v}% {inc} Fire Damage', more: '{v}% {more} Fire Damage' },
  coldDamage: { increased: '{v}% {inc} Cold Damage', more: '{v}% {more} Cold Damage' },
  lightningDamage: { increased: '{v}% {inc} Lightning Damage', more: '{v}% {more} Lightning Damage' },
  voidDamage: { increased: '{v}% {inc} Void Damage', more: '{v}% {more} Void Damage' },
  physicalDamage: { increased: '{v}% {inc} Physical Damage', more: '{v}% {more} Physical Damage' },
  elementalDamage: { increased: '{v}% {inc} Elemental Damage', more: '{v}% {more} Elemental Damage' },
  castSpeed: { increased: '{v}% {inc} Cast Speed', more: '{v}% {more} Cast Speed' },
  critChance: { flat: '{+v}% to Critical Strike Chance', increased: '{v}% {inc} Critical Strike Chance' },
  critMultiplier: { flat: '{+v}% to Critical Strike Multiplier' },
  projectileSpeed: { increased: '{v}% {inc} Projectile Speed' },
  area: { increased: '{v}% {inc} Area of Effect' },
  duration: { increased: '{v}% {inc} Skill Duration' },
  cooldownRecovery: { increased: '{v}% {inc} Cooldown Recovery Rate' },
  extraProjectiles: { flat: 'Skills fire {v} additional Projectile{s}' },
  pierce: { flat: 'Projectiles Pierce {v} additional Target{s}' },
  igniteChance: { flat: '{+v}% chance to Ignite' },
  chillChance: { flat: '{+v}% chance to Chill' },
  shockChance: { flat: '{+v}% chance to Shock' },

  moveSpeed: { increased: '{v}% {inc} Movement Speed' },
  pickupRadius: { increased: '{v}% {inc} Pickup Radius' },
  flaskEffect: { increased: '{v}% {inc} Flask Effect' },
  itemQuantity: { increased: '{v}% {inc} Quantity of Items found' },
  itemRarity: { increased: '{v}% {inc} Rarity of Items found' },
};

/** Human stat names (character sheet rows, property labels, fallbacks). */
export const STAT_LABEL: Record<StatId, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  int: 'Intelligence',
  maxLife: 'Maximum Life',
  lifeRegen: 'Life Regeneration',
  maxFocus: 'Maximum Focus',
  focusRegen: 'Focus Regeneration',
  lifeOnKill: 'Life per Kill',
  focusOnKill: 'Focus per Kill',
  armor: 'Armour',
  evasion: 'Evasion Rating',
  fireRes: 'Fire Resistance',
  coldRes: 'Cold Resistance',
  lightningRes: 'Lightning Resistance',
  voidRes: 'Void Resistance',
  allRes: 'All Resistances',
  damageTaken: 'Damage Taken',
  spellDamage: 'Spell Damage',
  addedSpellDamage: 'Added Spell Damage',
  fireDamage: 'Fire Damage',
  coldDamage: 'Cold Damage',
  lightningDamage: 'Lightning Damage',
  voidDamage: 'Void Damage',
  physicalDamage: 'Physical Damage',
  elementalDamage: 'Elemental Damage',
  castSpeed: 'Cast Speed',
  critChance: 'Critical Strike Chance',
  critMultiplier: 'Critical Strike Multiplier',
  projectileSpeed: 'Projectile Speed',
  area: 'Area of Effect',
  duration: 'Skill Duration',
  cooldownRecovery: 'Cooldown Recovery Rate',
  extraProjectiles: 'Additional Projectiles',
  pierce: 'Pierce',
  igniteChance: 'Chance to Ignite',
  chillChance: 'Chance to Chill',
  shockChance: 'Chance to Shock',
  moveSpeed: 'Movement Speed',
  pickupRadius: 'Pickup Radius',
  flaskEffect: 'Flask Effect',
  itemQuantity: 'Item Quantity',
  itemRarity: 'Item Rarity',
};

/** Display labels for affix tags (tooltip chips). */
export const TAG_LABEL: Record<AffixTag, string> = {
  fire: 'Fire',
  cold: 'Cold',
  lightning: 'Lightning',
  void: 'Void',
  physical: 'Physical',
  elemental: 'Elemental',
  life: 'Life',
  focus: 'Focus',
  defense: 'Defence',
  resistance: 'Resistance',
  caster: 'Caster',
  critical: 'Critical',
  speed: 'Speed',
  luck: 'Luck',
  utility: 'Utility',
};

/** Item class labels ("Wand", "Body Armour"…). */
export const CLASS_LABEL: Record<ItemClass, string> = {
  wand: 'Wand',
  sceptre: 'Sceptre',
  focus: 'Focus',
  helmet: 'Helmet',
  chest: 'Body Armour',
  gloves: 'Gloves',
  boots: 'Boots',
  belt: 'Belt',
  amulet: 'Amulet',
  ring: 'Ring',
};
