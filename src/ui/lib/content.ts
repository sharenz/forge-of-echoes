// Display-only names and layout tables the rules do not provide. Pure data (plus two pure lookups over it).
import { MONSTER_KINDS, type EquipSlot, type MapBaseId, type MonsterKind } from '../../contracts/content';
import { THEME_ROSTER } from '../../contracts/bestiary';
import type { ItemTone } from '../../contracts/items';

export interface MonsterName {
  one: string;
  many: string;
  /** How a lieutenant or boss is announced ("The Hollow Warden", "Varkus, the Iron Champion"). */
  title?: string;
}

export const MONSTER_NAMES: Readonly<Record<MonsterKind, MonsterName>> = {
  ashling: { one: 'Ashling', many: 'Ashlings' },
  emberSkitter: { one: 'Ember Skitter', many: 'Ember Skitters' },
  cinderSpitter: { one: 'Cinder Spitter', many: 'Cinder Spitters' },
  riftStalker: { one: 'Rift Stalker', many: 'Rift Stalkers' },
  ironhideBrute: { one: 'Ironhide Brute', many: 'Ironhide Brutes' },
  ashboundHerald: { one: 'Ashbound Herald', many: 'Ashbound Heralds', title: 'The Ashbound Herald' },
  cinderMatriarch: { one: 'Cinder Matriarch', many: 'Cinder Matriarchs', title: 'The Cinder Matriarch' },
  trainingDummy: { one: 'Training Dummy', many: 'Training Dummies' },
  // Rimed Ossuary (GAME_SPEC §14)
  boneThrall: { one: 'Bone Thrall', many: 'Bone Thralls' },
  rimeshade: { one: 'Rimeshade', many: 'Rimeshades' },
  frostWeaver: { one: 'Frost Weaver', many: 'Frost Weavers' },
  glacialWisp: { one: 'Glacial Wisp', many: 'Glacial Wisps' },
  ossuaryGolem: { one: 'Ossuary Golem', many: 'Ossuary Golems' },
  boneChorister: { one: 'Bone Chorister', many: 'Bone Choristers', title: 'The Bone Chorister' },
  hollowWarden: { one: 'Hollow Warden', many: 'Hollow Wardens', title: 'The Hollow Warden' },
  // Iron Coliseum
  pitHound: { one: 'Pit Hound', many: 'Pit Hounds' },
  chainThrall: { one: 'Chain Thrall', many: 'Chain Thralls' },
  ironCrossbowman: { one: 'Iron Crossbowman', many: 'Iron Crossbowmen' },
  shieldbearer: { one: 'Shieldbearer', many: 'Shieldbearers' },
  tarSlinger: { one: 'Tar Slinger', many: 'Tar Slingers' },
  chainmaster: { one: 'Chainmaster', many: 'Chainmasters', title: 'The Chainmaster' },
  varkus: { one: 'Varkus', many: 'Varkus', title: 'Varkus, the Iron Champion' },
};

/** GAME_SPEC §0: the lieutenant leads wave 3, the boss wave 6 (an Echo corruption adds a 7th). */
export const LIEUTENANT_WAVE = 3;
export const BOSS_WAVE = 6;

type RosterKey = keyof typeof THEME_ROSTER;

/**
 * The lieutenant and boss of a map (GAME_SPEC §14). The map base names the roster; without one (or for a base with no
 * roster of its own) the wave's families decide, and the Ashen Forge roster is the fallback.
 */
export function rosterFor(
  baseId: MapBaseId | null | undefined,
  families: readonly MonsterKind[] = [],
): { lieutenant: MonsterKind; boss: MonsterKind } {
  let key: RosterKey | null = baseId && baseId in THEME_ROSTER ? (baseId as RosterKey) : null;
  if (!key) {
    for (const k of Object.keys(THEME_ROSTER) as RosterKey[]) {
      const family = THEME_ROSTER[k].family as readonly string[];
      if (families.some((f) => family.includes(f))) {
        key = k;
        break;
      }
    }
  }
  const r = THEME_ROSTER[key ?? 'ashenForge'];
  return { lieutenant: r.lieutenant, boss: r.boss };
}

/** The announced name of a monster kind ("The Hollow Warden"; plain name for the rank and file). */
export function monsterTitle(kind: MonsterKind): string {
  const n = MONSTER_NAMES[kind];
  return n.title ?? n.one;
}

const KIND_BY_TEXT: ReadonlyMap<string, MonsterKind> = (() => {
  const m = new Map<string, MonsterKind>();
  const key = (s: string): string => s.toLowerCase().replace(/^the\s+/, '').trim();
  for (const kind of MONSTER_KINDS) {
    const n = MONSTER_NAMES[kind];
    m.set(kind.toLowerCase(), kind);
    m.set(key(n.one), kind);
    if (n.title) m.set(key(n.title), kind);
  }
  return m;
})();

/**
 * The display name of a lieutenant or boss bar. The sim sends a name string; a kind id ("hollowWarden") or a bare
 * name ("Varkus") becomes the full title ("The Hollow Warden", "Varkus, the Iron Champion"); anything unknown shows
 * as sent.
 */
export function eliteDisplayName(name: string): string {
  const kind = KIND_BY_TEXT.get(name.toLowerCase().replace(/^the\s+/, '').trim());
  return kind ? monsterTitle(kind) : name;
}

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
