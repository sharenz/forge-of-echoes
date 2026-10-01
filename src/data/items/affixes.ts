// Affixes (GAME_SPEC §5): prefix/suffix split, exclusive groups, tags, class allow-lists and 7–10 tiers.
//
// Tiers are written worst → best as value ranges; `ladder()` attaches the shared item-level gates and
// steeply falling weights, so the best tiers need ilvl 78–84 and are rare even then.
import type { AffixKind, AffixTag, ModifierMode, StatId } from '../../contracts/items';
import type { ItemClass } from '../../contracts/content';
import type { AffixDef, AffixTierDef } from './types';

interface Ladder {
  itemLevel: readonly number[];
  weight: readonly number[];
}

export const AFFIX_VERSION = 2;

/** Item-level gates and weights by tier count, listed worst tier → best tier. */
export const TIER_LADDERS: Readonly<Record<number, Ladder>> = {
  7: { itemLevel: [1, 12, 26, 40, 54, 66, 78], weight: [1000, 800, 600, 400, 220, 90, 25] },
  8: { itemLevel: [1, 10, 20, 32, 44, 56, 68, 80], weight: [1000, 800, 600, 400, 250, 120, 50, 15] },
  9: { itemLevel: [1, 8, 16, 24, 34, 46, 58, 70, 82], weight: [1000, 850, 700, 550, 400, 250, 120, 50, 15] },
  10: { itemLevel: [1, 6, 12, 20, 28, 38, 48, 60, 72, 84], weight: [1000, 850, 700, 550, 400, 280, 180, 100, 40, 10] },
};

/** Build tiers from value ranges listed worst → best. Returns T1 first. */
function ladder(ranges: readonly (readonly [number, number])[]): AffixTierDef[] {
  const n = ranges.length;
  const l = TIER_LADDERS[n];
  if (!l) throw new Error(`No tier ladder for ${n} tiers`);
  return ranges
    .map(([min, max], i) => ({ tier: n - i, itemLevel: l.itemLevel[i], weight: l.weight[i], min, max }))
    .reverse();
}

// Class sets ------------------------------------------------------------------------------------
const WEAPON: ItemClass[] = ['wand', 'sceptre'];
const ARMOUR: ItemClass[] = ['helmet', 'chest', 'gloves', 'boots'];
/** Armour and Evasion lines also fit belts that carry the matching base property. */
const DEFENCE_CLASSES: ItemClass[] = [...ARMOUR, 'belt'];
const JEWEL: ItemClass[] = ['amulet', 'ring'];
const CASTER_GEAR: ItemClass[] = [...WEAPON, 'focus', ...JEWEL];

interface AffixSpec {
  name: string;
  kind: AffixKind;
  stat: StatId;
  mode: ModifierMode;
  tags: AffixTag[];
  classes: ItemClass[];
  tiers: AffixTierDef[];
  group?: string;
  requiresProperty?: StatId;
  text?: string;
}

function affix(id: string, s: AffixSpec): AffixDef {
  return {
    id,
    name: s.name,
    kind: s.kind,
    group: s.group ?? id,
    tags: s.tags,
    classes: s.classes,
    stats: [s.stat],
    mode: s.mode,
    tiers: s.tiers,
    ...(s.requiresProperty ? { requiresProperty: s.requiresProperty } : {}),
    ...(s.text ? { text: s.text } : {}),
  };
}

// Shared value ladders --------------------------------------------------------------------------
const ELEMENT_DAMAGE = ladder([[8, 12], [13, 14], [15, 18], [19, 22], [23, 27], [28, 32], [33, 37], [38, 43], [44, 50], [51, 56]]);
const ELEMENT_RES = ladder([[6, 10], [11, 11], [12, 13], [14, 16], [17, 19], [20, 22], [23, 25], [26, 29], [30, 32], [33, 36]]);
const DEFENCE_FLAT = ladder([[6, 12], [13, 19], [20, 29], [30, 41], [42, 55], [56, 70], [71, 86], [87, 103], [104, 121], [122, 140]]);
const DEFENCE_PCT = ladder([[10, 16], [17, 19], [20, 24], [25, 30], [31, 36], [37, 44], [45, 51], [52, 59], [60, 68]]);
const ATTRIBUTE = ladder([[3, 6], [7, 8], [9, 10], [11, 13], [14, 16], [17, 20], [21, 24], [25, 28], [29, 32], [33, 37]]);
const AILMENT = ladder([[3, 5], [6, 6], [7, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17]]);
const ATTR_CLASSES: ItemClass[] = [...ARMOUR, 'belt', ...JEWEL];
const RES_CLASSES: ItemClass[] = [...ARMOUR, 'belt', ...JEWEL];

/** Every affix, in canonical display order (prefixes first). */
export const AFFIXES: readonly AffixDef[] = [
  // ============================== prefixes ==============================
  affix('life', {
    name: 'Hale', kind: 'prefix', stat: 'maxLife', mode: 'flat', tags: ['life'],
    classes: ['focus', ...ARMOUR, 'belt', ...JEWEL],
    tiers: ladder([[6, 10], [11, 13], [14, 17], [18, 21], [22, 27], [28, 33], [34, 39], [40, 46], [47, 53], [54, 60]]),
  }),
  affix('focus', {
    name: 'Lucid', kind: 'prefix', stat: 'maxFocus', mode: 'flat', tags: ['focus'],
    classes: [...WEAPON, 'focus', ...ARMOUR, 'belt', ...JEWEL],
    tiers: ladder([[5, 8], [9, 10], [11, 13], [14, 17], [18, 22], [23, 27], [28, 32], [33, 37], [38, 43]]),
  }),
  affix('addedSpellDamage', {
    name: 'Sorcerous', kind: 'prefix', stat: 'addedSpellDamage', mode: 'flat', tags: ['caster'],
    classes: CASTER_GEAR,
    tiers: ladder([[1, 2], [3, 3], [4, 4], [5, 6], [7, 8], [9, 11], [12, 13], [14, 16], [17, 18], [19, 21]]),
  }),
  affix('spellDamage', {
    name: 'Arcane', kind: 'prefix', stat: 'spellDamage', mode: 'increased', tags: ['caster'],
    classes: [...WEAPON, 'focus', 'amulet'],
    tiers: ladder([[8, 12], [13, 15], [16, 19], [20, 23], [24, 29], [30, 35], [36, 41], [42, 48], [49, 55], [56, 62]]),
  }),
  affix('fireDamage', {
    name: 'Blazing', kind: 'prefix', stat: 'fireDamage', mode: 'increased', tags: ['fire'],
    classes: CASTER_GEAR, tiers: ELEMENT_DAMAGE,
  }),
  affix('coldDamage', {
    name: 'Frigid', kind: 'prefix', stat: 'coldDamage', mode: 'increased', tags: ['cold'],
    classes: CASTER_GEAR, tiers: ELEMENT_DAMAGE,
  }),
  affix('lightningDamage', {
    name: 'Crackling', kind: 'prefix', stat: 'lightningDamage', mode: 'increased', tags: ['lightning'],
    classes: CASTER_GEAR, tiers: ELEMENT_DAMAGE,
  }),
  affix('elementalDamage', {
    name: 'Prismatic', kind: 'prefix', stat: 'elementalDamage', mode: 'increased',
    tags: ['elemental', 'fire', 'cold', 'lightning'], classes: JEWEL,
    tiers: ladder([[6, 9], [10, 11], [12, 13], [14, 16], [17, 19], [20, 22], [23, 26], [27, 30]]),
  }),
  affix('armourFlat', {
    name: 'Plated', kind: 'prefix', stat: 'armor', mode: 'flat', tags: ['defense'],
    classes: DEFENCE_CLASSES, requiresProperty: 'armor', tiers: DEFENCE_FLAT,
  }),
  affix('evasionFlat', {
    name: 'Lithe', kind: 'prefix', stat: 'evasion', mode: 'flat', tags: ['defense'],
    classes: DEFENCE_CLASSES, requiresProperty: 'evasion', tiers: DEFENCE_FLAT,
  }),
  affix('armourPercent', {
    name: 'Ironclad', kind: 'prefix', stat: 'armor', mode: 'increased', tags: ['defense'],
    classes: DEFENCE_CLASSES, requiresProperty: 'armor', tiers: DEFENCE_PCT,
  }),
  affix('evasionPercent', {
    name: 'Elusive', kind: 'prefix', stat: 'evasion', mode: 'increased', tags: ['defense'],
    classes: DEFENCE_CLASSES, requiresProperty: 'evasion', tiers: DEFENCE_PCT,
  }),
  affix('itemRarity', {
    name: 'Fortunate', kind: 'prefix', stat: 'itemRarity', mode: 'increased', tags: ['luck'],
    classes: ['helmet', 'gloves', 'boots', ...JEWEL],
    tiers: ladder([[5, 8], [9, 9], [10, 11], [12, 13], [14, 16], [17, 19], [20, 22], [23, 25]]),
  }),
  affix('lifeOnKill', {
    name: 'Ravenous', kind: 'prefix', stat: 'lifeOnKill', mode: 'flat', tags: ['life'],
    classes: [...WEAPON, 'gloves', 'belt', 'ring'],
    tiers: ladder([[1, 2], [3, 3], [4, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14]]),
  }),
  affix('focusOnKill', {
    name: 'Siphoning', kind: 'prefix', stat: 'focusOnKill', mode: 'flat', tags: ['focus'],
    classes: [...WEAPON, 'focus', 'gloves', 'belt', 'amulet'],
    tiers: ladder([[1, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]]),
  }),

  // ============================== suffixes ==============================
  affix('castSpeed', {
    name: 'of Haste', kind: 'suffix', stat: 'castSpeed', mode: 'increased', tags: ['caster', 'speed'],
    classes: [...WEAPON, 'gloves', ...JEWEL],
    tiers: ladder([[3, 5], [6, 6], [7, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 18], [19, 20]]),
  }),
  affix('critChance', {
    name: 'of Omens', kind: 'suffix', stat: 'critChance', mode: 'increased', tags: ['critical'],
    classes: [...WEAPON, 'focus', 'helmet', 'amulet'],
    tiers: ladder([[10, 14], [15, 16], [17, 20], [21, 24], [25, 28], [29, 33], [34, 39], [40, 45], [46, 51], [52, 57]]),
  }),
  affix('critMultiplier', {
    name: 'of Ruin', kind: 'suffix', stat: 'critMultiplier', mode: 'flat', tags: ['critical'],
    classes: [...WEAPON, 'amulet'],
    tiers: ladder([[8, 12], [13, 14], [15, 16], [17, 19], [20, 22], [23, 25], [26, 29], [30, 33]]),
  }),
  affix('fireResistance', {
    name: 'of the Kiln', kind: 'suffix', stat: 'fireRes', mode: 'flat', tags: ['fire', 'resistance'],
    classes: RES_CLASSES, tiers: ELEMENT_RES,
  }),
  affix('coldResistance', {
    name: 'of Thaw', kind: 'suffix', stat: 'coldRes', mode: 'flat', tags: ['cold', 'resistance'],
    classes: RES_CLASSES, tiers: ELEMENT_RES,
  }),
  affix('lightningResistance', {
    name: 'of Grounding', kind: 'suffix', stat: 'lightningRes', mode: 'flat', tags: ['lightning', 'resistance'],
    classes: RES_CLASSES, tiers: ELEMENT_RES,
  }),
  affix('voidResistance', {
    name: 'of the Veil', kind: 'suffix', stat: 'voidRes', mode: 'flat', tags: ['void', 'resistance'],
    classes: RES_CLASSES,
    tiers: ladder([[5, 8], [9, 9], [10, 11], [12, 13], [14, 16], [17, 18], [19, 21], [22, 24]]),
  }),
  affix('allResistances', {
    name: 'of Shelter', kind: 'suffix', stat: 'allRes', mode: 'flat', tags: ['resistance'],
    classes: JEWEL,
    tiers: ladder([[3, 5], [6, 6], [7, 7], [8, 8], [9, 10], [11, 11], [12, 13]]),
  }),
  affix('moveSpeed', {
    name: 'of Striding', kind: 'suffix', stat: 'moveSpeed', mode: 'increased', tags: ['speed'],
    classes: ['boots'],
    tiers: ladder([[4, 6], [7, 7], [8, 8], [9, 10], [11, 12], [13, 14], [15, 17], [18, 19]]),
  }),
  affix('focusRegen', {
    name: 'of Clarity', kind: 'suffix', stat: 'focusRegen', mode: 'increased', tags: ['focus'],
    classes: ['helmet', 'focus', ...JEWEL],
    tiers: ladder([[10, 15], [16, 18], [19, 21], [22, 26], [27, 31], [32, 37], [38, 43], [44, 50], [51, 57]]),
  }),
  affix('lifeRegen', {
    name: 'of Mending', kind: 'suffix', stat: 'lifeRegen', mode: 'flat', tags: ['life'],
    classes: ['chest', 'belt', 'ring'],
    tiers: ladder([[1, 2], [3, 3], [4, 5], [6, 8], [9, 11], [12, 14], [15, 17], [18, 20], [21, 24]]),
  }),
  affix('strength', {
    name: 'of Brawn', kind: 'suffix', stat: 'str', mode: 'flat', tags: ['utility'],
    classes: ATTR_CLASSES, tiers: ATTRIBUTE,
  }),
  affix('dexterity', {
    name: 'of Grace', kind: 'suffix', stat: 'dex', mode: 'flat', tags: ['utility'],
    classes: ATTR_CLASSES, tiers: ATTRIBUTE,
  }),
  affix('intelligence', {
    name: 'of Insight', kind: 'suffix', stat: 'int', mode: 'flat', tags: ['utility'],
    classes: [...WEAPON, 'focus', ...ATTR_CLASSES], tiers: ATTRIBUTE,
  }),
  affix('projectileSpeed', {
    name: 'of Flight', kind: 'suffix', stat: 'projectileSpeed', mode: 'increased', tags: ['speed'],
    classes: WEAPON,
    tiers: ladder([[8, 12], [13, 14], [15, 16], [17, 20], [21, 23], [24, 27], [28, 31], [32, 36]]),
  }),
  affix('area', {
    name: 'of Expanse', kind: 'suffix', stat: 'area', mode: 'increased', tags: ['caster'],
    classes: ['focus', 'amulet'],
    tiers: ladder([[5, 8], [9, 9], [10, 11], [12, 13], [14, 16], [17, 19], [20, 22], [23, 25]]),
  }),
  affix('cooldownRecovery', {
    name: 'of Recurrence', kind: 'suffix', stat: 'cooldownRecovery', mode: 'increased', tags: ['caster'],
    classes: ['helmet', 'amulet'],
    tiers: ladder([[4, 6], [7, 7], [8, 8], [9, 10], [11, 12], [13, 14], [15, 16]]),
  }),
  affix('pickupRadius', {
    name: 'of Gathering', kind: 'suffix', stat: 'pickupRadius', mode: 'increased', tags: ['utility'],
    classes: ['belt', 'boots'],
    tiers: ladder([[10, 15], [16, 17], [18, 21], [22, 25], [26, 29], [30, 35], [36, 40]]),
  }),
  affix('itemQuantity', {
    name: 'of Plenty', kind: 'suffix', stat: 'itemQuantity', mode: 'increased', tags: ['luck'],
    classes: ['belt', 'amulet'],
    tiers: ladder([[3, 5], [6, 6], [7, 7], [8, 9], [10, 10], [11, 12], [13, 14]]),
  }),
  affix('flaskEffect', {
    name: 'of Tinctures', kind: 'suffix', stat: 'flaskEffect', mode: 'increased', tags: ['utility'],
    classes: ['belt'],
    tiers: ladder([[6, 9], [10, 10], [11, 13], [14, 15], [16, 18], [19, 22], [23, 25]]),
  }),
  affix('igniteChance', {
    name: 'of Immolation', kind: 'suffix', stat: 'igniteChance', mode: 'flat', tags: ['fire'],
    classes: [...WEAPON, 'gloves'], tiers: AILMENT,
  }),
  affix('chillChance', {
    name: 'of Frostbite', kind: 'suffix', stat: 'chillChance', mode: 'flat', tags: ['cold'],
    classes: [...WEAPON, 'gloves'], tiers: AILMENT,
  }),
  affix('shockChance', {
    name: 'of Static', kind: 'suffix', stat: 'shockChance', mode: 'flat', tags: ['lightning'],
    classes: [...WEAPON, 'gloves'], tiers: AILMENT,
  }),
  // The one exception to the 7–10 tier rule: a single, very rare T1 that needs ilvl 70 (GAME_SPEC §5).
  affix('splintering', {
    name: 'of Splintering', kind: 'suffix', stat: 'extraProjectiles', mode: 'flat', tags: ['caster'],
    classes: ['wand'],
    tiers: [{ tier: 1, itemLevel: 70, weight: 15, min: 1, max: 1 }],
  }),
];
