// Display-only names and layout tables the rules do not provide. Pure data.
import type { EquipSlot, MonsterKind } from '../../contracts/content';
import type { ItemTone } from '../../contracts/items';

export const MONSTER_NAMES: Readonly<Record<MonsterKind, { one: string; many: string }>> = {
  ashling: { one: 'Ashling', many: 'Ashlings' },
  emberSkitter: { one: 'Ember Skitter', many: 'Ember Skitters' },
  cinderSpitter: { one: 'Cinder Spitter', many: 'Cinder Spitters' },
  riftStalker: { one: 'Rift Stalker', many: 'Rift Stalkers' },
  ironhideBrute: { one: 'Ironhide Brute', many: 'Ironhide Brutes' },
  ashboundHerald: { one: 'Ashbound Herald', many: 'Ashbound Heralds' },
  cinderMatriarch: { one: 'Cinder Matriarch', many: 'Cinder Matriarchs' },
  trainingDummy: { one: 'Training Dummy', many: 'Training Dummies' },
};

/** GAME_SPEC §0: the Ashbound Herald leads wave 3, the Cinder Matriarch wave 6 (an Echo corruption adds a 7th). */
export const LIEUTENANT_WAVE = 3;
export const BOSS_WAVE = 6;

export const SLOT_LABELS: Readonly<Record<EquipSlot, string>> = {
  mainHand: 'Main Hand',
  offHand: 'Off Hand',
  helmet: 'Helmet',
  chest: 'Body Armour',
  gloves: 'Gloves',
  boots: 'Boots',
  belt: 'Belt',
  amulet: 'Amulet',
  ring1: 'Left Ring',
  ring2: 'Right Ring',
};

/**
 * Paperdoll: three columns of two cells (weapon | armour | off-hand), 6 cells tall, 1-cell gutters.
 * x/y/w/h are in cell units; y includes 0.25-cell gaps between stacked slots.
 */
export const PAPERDOLL: Readonly<Record<EquipSlot, { x: number; y: number; w: number; h: number }>> = {
  mainHand: { x: 0, y: 0, w: 2, h: 3 },
  ring1: { x: 0, y: 3.25, w: 1, h: 1 },
  ring2: { x: 1, y: 3.25, w: 1, h: 1 },
  gloves: { x: 0, y: 4.5, w: 2, h: 2 },
  helmet: { x: 3, y: 0, w: 2, h: 2 },
  chest: { x: 3, y: 2.25, w: 2, h: 3 },
  belt: { x: 3, y: 5.5, w: 2, h: 1 },
  amulet: { x: 6, y: 0, w: 1, h: 1 },
  offHand: { x: 6, y: 1.25, w: 2, h: 3 },
  boots: { x: 6, y: 4.5, w: 2, h: 2 },
};
export const PAPERDOLL_SIZE = { w: 8, h: 6.5 } as const;

export const TONE_LABEL: Readonly<Record<ItemTone, string>> = {
  normal: 'Normal',
  magic: 'Magic',
  rare: 'Rare',
  unique: 'Unique',
  currency: 'Currency',
  map: 'Map',
  flask: 'Flask',
};

export const ATTRIBUTE_INFO = {
  str: { label: 'Strength', icon: 'icon/ui/attributeStr' },
  dex: { label: 'Dexterity', icon: 'icon/ui/attributeDex' },
  int: { label: 'Intelligence', icon: 'icon/ui/attributeInt' },
} as const;
