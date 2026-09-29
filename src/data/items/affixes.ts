// Affixes (GAME_SPEC §5): prefix/suffix split, exclusive groups, tags, class allow-lists and 5–8 tiers.
//
// Tiers are written worst → best as value ranges; `ladder()` attaches the shared item-level gates and
// steeply falling weights, so the best tiers need ilvl 68–75 and are rare even then.
import type { AffixKind, AffixTag, ModifierMode, StatId } from '../../contracts/items';
import type { ItemClass } from '../../contracts/content';
import type { AffixDef, AffixTierDef } from './types';

interface Ladder {
  itemLevel: readonly number[];
  weight: readonly number[];
}

/** Item-level gates and weights by tier count, listed worst tier → best tier. */
export const TIER_LADDERS: Readonly<Record<number, Ladder>> = {
  5: { itemLevel: [1, 14, 32, 50, 68], weight: [1000, 700, 400, 150, 40] },
  6: { itemLevel: [1, 10, 24, 40, 56, 70], weight: [1000, 750, 500, 280, 110, 30] },
  7: { itemLevel: [1, 8, 18, 30, 44, 58, 72], weight: [1000, 800, 600, 400, 220, 90, 25] },
  8: { itemLevel: [1, 6, 14, 24, 36, 48, 62, 75], weight: [1000, 800, 600, 400, 250, 120, 50, 15] },
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
const ELEMENT_DAMAGE = ladder([[8, 12], [13, 17], [18, 23], [24, 30], [31, 38], [39, 47], [48, 58], [59, 70]]);
const ELEMENT_RES = ladder([[6, 10], [11, 15], [16, 20], [21, 25], [26, 30], [31, 35], [36, 40], [41, 45]]);
const DEFENCE_FLAT = ladder([[6, 12], [13, 22], [23, 35], [36, 52], [53, 74], [75, 100], [101, 135], [136, 175]]);
const DEFENCE_PCT = ladder([[10, 16], [17, 24], [25, 33], [34, 44], [45, 56], [57, 70], [71, 86]]);
const ATTRIBUTE = ladder([[3, 6], [7, 10], [11, 15], [16, 20], [21, 26], [27, 32], [33, 39], [40, 47]]);
const AILMENT = ladder([[3, 5], [6, 8], [9, 11], [12, 14], [15, 18], [19, 22]]);
const ATTR_CLASSES: ItemClass[] = [...ARMOUR, 'belt', ...JEWEL];
const RES_CLASSES: ItemClass[] = [...ARMOUR, 'belt', ...JEWEL];

/** Every affix, in canonical display order (prefixes first). */
export const AFFIXES: readonly AffixDef[] = [
  // ============================== prefixes ==============================
  affix('life', {
    name: 'Hale', kind: 'prefix', stat: 'maxLife', mode: 'flat', tags: ['life'],
    classes: ['focus', ...ARMOUR, 'belt', ...JEWEL],
    tiers: ladder([[6, 10], [11, 16], [17, 23], [24, 31], [32, 40], [41, 50], [51, 62], [63, 76]]),
  }),
  affix('focus', {
    name: 'Lucid', kind: 'prefix', stat: 'maxFocus', mode: 'flat', tags: ['focus'],
    classes: [...WEAPON, 'focus', ...ARMOUR, 'belt', ...JEWEL],
    tiers: ladder([[5, 8], [9, 13], [14, 19], [20, 26], [27, 34], [35, 43], [44, 54]]),
  }),
  affix('addedSpellDamage', {
    name: 'Sorcerous', kind: 'prefix', stat: 'addedSpellDamage', mode: 'flat', tags: ['caster'],
    classes: CASTER_GEAR,
    tiers: ladder([[1, 2], [3, 4], [5, 6], [7, 9], [10, 12], [13, 16], [17, 21], [22, 27]]),
  }),
  affix('spellDamage', {
    name: 'Arcane', kind: 'prefix', stat: 'spellDamage', mode: 'increased', tags: ['caster'],
    classes: [...WEAPON, 'focus', 'amulet'],
    tiers: ladder([[8, 12], [13, 18], [19, 25], [26, 33], [34, 42], [43, 52], [53, 64], [65, 78]]),
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
    tiers: ladder([[6, 9], [10, 14], [15, 19], [20, 25], [26, 31], [32, 38]]),
  }),
  affix('armourFlat', {
    name: 'Plated', kind: 'prefix', stat: 'armor', mode: 'flat', tags: ['defense'],
    classes: ARMOUR, requiresProperty: 'armor', tiers: DEFENCE_FLAT,
  }),
  affix('evasionFlat', {
    name: 'Lithe', kind: 'prefix', stat: 'evasion', mode: 'flat', tags: ['defense'],
    classes: ARMOUR, requiresProperty: 'evasion', tiers: DEFENCE_FLAT,
  }),
  affix('armourPercent', {
    name: 'Ironclad', kind: 'prefix', stat: 'armor', mode: 'increased', tags: ['defense'],
    classes: ARMOUR, requiresProperty: 'armor', tiers: DEFENCE_PCT,
  }),
  affix('evasionPercent', {
    name: 'Elusive', kind: 'prefix', stat: 'evasion', mode: 'increased', tags: ['defense'],
    classes: ARMOUR, requiresProperty: 'evasion', tiers: DEFENCE_PCT,
  }),
  affix('itemRarity', {
    name: 'Fortunate', kind: 'prefix', stat: 'itemRarity', mode: 'increased', tags: ['luck'],
    classes: ['helmet', 'gloves', 'boots', ...JEWEL],
    tiers: ladder([[5, 8], [9, 12], [13, 16], [17, 21], [22, 26], [27, 32]]),
  }),
  affix('lifeOnKill', {
    name: 'Ravenous', kind: 'prefix', stat: 'lifeOnKill', mode: 'flat', tags: ['life'],
    classes: [...WEAPON, 'gloves', 'belt', 'ring'],
    tiers: ladder([[1, 2], [3, 4], [5, 6], [7, 9], [10, 13], [14, 18]]),
  }),
  affix('focusOnKill', {
    name: 'Siphoning', kind: 'prefix', stat: 'focusOnKill', mode: 'flat', tags: ['focus'],
    classes: [...WEAPON, 'focus', 'gloves', 'belt', 'amulet'],
    tiers: ladder([[1, 2], [3, 4], [5, 6], [7, 8], [9, 11]]),
  }),

  // ============================== suffixes ==============================
  affix('castSpeed', {
    name: 'of Haste', kind: 'suffix', stat: 'castSpeed', mode: 'increased', tags: ['caster', 'speed'],
    classes: [...WEAPON, 'gloves', ...JEWEL],
    tiers: ladder([[3, 5], [6, 8], [9, 11], [12, 14], [15, 17], [18, 21], [22, 26]]),
  }),
  affix('critChance', {
    name: 'of Omens', kind: 'suffix', stat: 'critChance', mode: 'increased', tags: ['critical'],
    classes: [...WEAPON, 'focus', 'helmet', 'amulet'],
    tiers: ladder([[10, 14], [15, 19], [20, 25], [26, 32], [33, 40], [41, 49], [50, 60], [61, 72]]),
  }),
  affix('critMultiplier', {
    name: 'of Ruin', kind: 'suffix', stat: 'critMultiplier', mode: 'flat', tags: ['critical'],
    classes: [...WEAPON, 'amulet'],
    tiers: ladder([[8, 12], [13, 17], [18, 23], [24, 29], [30, 35], [36, 42]]),
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
    tiers: ladder([[5, 8], [9, 12], [13, 16], [17, 20], [21, 25], [26, 30]]),
  }),
  affix('allResistances', {
    name: 'of Shelter', kind: 'suffix', stat: 'allRes', mode: 'flat', tags: ['resistance'],
    classes: JEWEL,
    tiers: ladder([[3, 5], [6, 8], [9, 11], [12, 14], [15, 17]]),
  }),
  affix('moveSpeed', {
    name: 'of Striding', kind: 'suffix', stat: 'moveSpeed', mode: 'increased', tags: ['speed'],
    classes: ['boots'],
    tiers: ladder([[4, 6], [7, 9], [10, 12], [13, 15], [16, 19], [20, 24]]),
  }),
  affix('focusRegen', {
    name: 'of Clarity', kind: 'suffix', stat: 'focusRegen', mode: 'increased', tags: ['focus'],
    classes: ['helmet', 'focus', ...JEWEL],
    tiers: ladder([[10, 15], [16, 22], [23, 30], [31, 39], [40, 49], [50, 60], [61, 72]]),
  }),
  affix('lifeRegen', {
    name: 'of Mending', kind: 'suffix', stat: 'lifeRegen', mode: 'flat', tags: ['life'],
    classes: ['chest', 'belt', 'ring'],
    tiers: ladder([[1, 2], [3, 4], [5, 7], [8, 11], [12, 16], [17, 22], [23, 30]]),
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
    tiers: ladder([[8, 12], [13, 18], [19, 24], [25, 31], [32, 38], [39, 46]]),
  }),
  affix('area', {
    name: 'of Expanse', kind: 'suffix', stat: 'area', mode: 'increased', tags: ['caster'],
    classes: ['focus', 'amulet'],
    tiers: ladder([[5, 8], [9, 12], [13, 16], [17, 21], [22, 26], [27, 32]]),
  }),
  affix('cooldownRecovery', {
    name: 'of Recurrence', kind: 'suffix', stat: 'cooldownRecovery', mode: 'increased', tags: ['caster'],
    classes: ['helmet', 'amulet'],
    tiers: ladder([[4, 6], [7, 9], [10, 12], [13, 16], [17, 20]]),
  }),
  affix('pickupRadius', {
    name: 'of Gathering', kind: 'suffix', stat: 'pickupRadius', mode: 'increased', tags: ['utility'],
    classes: ['belt', 'boots'],
    tiers: ladder([[10, 15], [16, 22], [23, 30], [31, 40], [41, 50]]),
  }),
  affix('itemQuantity', {
    name: 'of Plenty', kind: 'suffix', stat: 'itemQuantity', mode: 'increased', tags: ['luck'],
    classes: ['belt', 'amulet'],
    tiers: ladder([[3, 5], [6, 8], [9, 11], [12, 14], [15, 18]]),
  }),
  affix('flaskEffect', {
    name: 'of Tinctures', kind: 'suffix', stat: 'flaskEffect', mode: 'increased', tags: ['utility'],
    classes: ['belt'],
    tiers: ladder([[6, 9], [10, 14], [15, 19], [20, 25], [26, 32]]),
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
  // The one exception to the 5–8 tier rule: a single, very rare T1 that needs ilvl 70 (GAME_SPEC §5).
  affix('splintering', {
    name: 'of Splintering', kind: 'suffix', stat: 'extraProjectiles', mode: 'flat', tags: ['caster'],
    classes: ['wand'],
    tiers: [{ tier: 1, itemLevel: 70, weight: 15, min: 1, max: 1 }],
  }),
];
