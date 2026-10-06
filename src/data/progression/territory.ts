// Territory layer constants (brief D sections 6 and 7): the daily surge (slice G1), then beacons and sigils (slice B1). Every number
// of a rule lives here, never in the rules files (src/game/progression/surge.ts, src/game/progression/territory.ts).
import { SIGIL_IDS, type CurrencyId, type MapBaseId, type SigilId, type SigilKind, type SigilStrength } from '../../contracts/content';

// ---------------------------------------------------------------------------------------------
// Daily surge (D 7)
// ---------------------------------------------------------------------------------------------

/** Free surge charges per area per forge day, before the tree. */
export const SURGE_CHARGES = 3;
/** The forge day starts at this UTC hour (06:00 in central Europe, night in the Americas). */
export const SURGE_RESET_UTC_HOUR = 4;
export const SURGE_DAY_MS = 86_400_000;
/** What a spent charge adds to the expedition: "more" multipliers on the map-side luck. Quantity never applies to the map category (I1). */
export const SURGE_BONUS = { quantityMore: 30, rarityMore: 15 } as const;
/** A save can never hold more charges per area than this, whatever the tree says (defensive bound for normalisation). */
export const SURGE_MAX_CHARGES = 12;

/** Hourglass Sand: refills one area (D 7.4). Chances are per event, before personal rarity (capped at 100%). */
export const HOURGLASS_SAND = {
  /** Final-boss kill on a map of at least this tier. */
  bossMinTier: 3,
  bossChance: 0.05,
  /** Sealed areas' bosses roll this many times as often. */
  sealedBossMultiplier: 2,
  /** Completion chest, any tier. */
  chestChance: 0.03,
  /** Gold-grade event completion. */
  goldEventChance: 0.10,
  stack: 20,
} as const;

/** Grand Hourglass: refills every area (D 7.4). Final bosses of high tiers only. */
export const GRAND_HOURGLASS = { bossMinTier: 9, bossChance: 0.005, stack: 5 } as const;

// ---------------------------------------------------------------------------------------------
// Beacons and sigils (D 6, slice B1)
// ---------------------------------------------------------------------------------------------

/**
 * Every completed area is a beacon (D 6.1). Slots: depth 0..4 through-route areas 1, depth 5+ 2, sealed areas 2, dead ends 1;
 * Lightkeeper (tree, `beaconSlots`) gives every one-slot beacon a second slot. Nothing else adds slots.
 */
export const BEACON_SLOTS = { shallow: 1, deep: 2, deepFromDepth: 5, sealed: 2, deadEnd: 1, max: 2 } as const;

/**
 * Coverage radius in chart art pixels between node centres (`ATLAS_POS`, the 640 x 360 chart; D 6.2). An area is covered when its centre
 * lies within the radius. Survey Stake (tree, `beaconRadius`) adds its pixels to every beacon.
 */
export const BEACON_RADIUS = {
  /** depth <= 3 */ shallow: 120,
  /** depth 4..6 */ middle: 140,
  /** depth >= 7 */ deep: 160,
  middleFromDepth: 4,
  deepFromDepth: 7,
  /** Sealed areas sit in the crowded middle row. */
  sealed: 100,
  /** Dead ends are otherwise blind. */
  deadEndBonus: 30,
} as const;

/** Faint, Bright, Blazing: the strength ladder of a sigil kind (D 6.3). */
export const SIGIL_STRENGTH_NAMES = { 1: 'Faint', 2: 'Bright', 3: 'Blazing' } as const;
/** Uses (activations in a covered area) a freshly slotted sigil has; Lamp Oil (tree, `sigilUses`) adds to it. */
export const SIGIL_USES = { 1: 12, 2: 12, 3: 10 } as const;
/** No slot ever holds more uses than this, whatever the tree says (defensive bound for normalisation). */
export const SIGIL_MAX_USES = 40;
export const SIGIL_STACK = 20;
/** Stacking (D 6.3): of several sigils of one kind on one run, the strongest works at 100% and every other at this share. */
export const SIGIL_SECONDARY_SHARE = 0.5;

/** The theme a theme sigil belongs to and the signature currency it favours (the theme seals' own currencies). */
export const THEME_SIGILS = {
  ashen: { baseId: 'ashenForge', currencyId: 'essenceEmber', label: 'Ashen' },
  chapel: { baseId: 'cinderChapel', currencyId: 'seal', label: 'Chapel' },
  crypt: { baseId: 'choralCrypt', currencyId: 'solvent', label: 'Crypt' },
  ossuary: { baseId: 'rimedOssuary', currencyId: 'essenceRime', label: 'Ossuary' },
  chainworks: { baseId: 'chainworks', currencyId: 'scrap', label: 'Chainworks' },
  coliseum: { baseId: 'ironColiseum', currencyId: 'fractureCore', label: 'Coliseum' },
} as const satisfies Partial<Record<SigilKind, { baseId: MapBaseId; currencyId: CurrencyId; label: string }>>;
export type ThemeSigilKind = keyof typeof THEME_SIGILS;
export const GENERIC_SIGIL_KINDS = ['omen', 'hoard', 'fortune', 'ingredient', 'survey', 'tide'] as const satisfies readonly SigilKind[];
export type GenericSigilKind = (typeof GENERIC_SIGIL_KINDS)[number];
export const GENERIC_SIGIL_LABELS: Readonly<Record<GenericSigilKind, string>> = {
  omen: 'Omen', hoard: 'Hoard', fortune: 'Fortune', ingredient: 'Ingredient', survey: 'Survey', tide: 'Tide',
};

/**
 * The modifier menu (D 6.3), indexed by strength 1..3 (index 0 unused). Every number of a sigil lives here.
 *   omen        +pp encounter chance, added after the area odds, still capped at the event cap (not part of the tree's cap)
 *   hoard       % increased item quantity in dead-end and sealed areas
 *   fortune     % increased item rarity
 *   ingredient  % more boss ingredient chances
 *   survey      % chance for a boss kill to reveal one more neighbour (added to Master Surveyor's fraction)
 *   theme       % more weight of the theme's signature currency and +1 class weight, on that theme's maps only
 *   tide        see TIDE
 */
export const SIGIL_VALUES = {
  omen: [0, 4, 6, 9],
  hoard: [0, 9, 14, 20],
  fortune: [0, 8, 12, 18],
  ingredient: [0, 20, 35, 50],
  survey: [0, 25, 40, 60],
  theme: [0, 25, 45, 70],
} as const;
/** Tide (D 6.3, 7.6): Faint multiplies the surge bonus; Bright adds a charge on every covered area; Blazing adds the charge and a keep roll. */
export const TIDE = {
  /** Faint: the surge's quantity and rarity bonus is multiplied by this. */
  bonusMultiplier: 1.25,
  /** Bright and Blazing: extra daily surge charges on every covered area. */
  charges: 1,
  /** Blazing: chance that a spent charge is not consumed (its own independent roll, beside Afterglow's). */
  keepChance: 0.25,
} as const;
/** Theme sigils add this much to each class weight their area already favours. */
export const THEME_SIGIL_CLASS_WEIGHT = 1;

/**
 * Drops (D 6.4): a final-boss kill on a map of at least `bossMinTier` drops one sigil with `bossChance` x personal rarity (capped at 100%),
 * sealed-area bosses twice as often. Kind: `genericShare` uniform among the six generic kinds, otherwise the boss theme's sigil. Strength
 * weights (Faint, Bright, Blazing) by map tier band, first matching band wins.
 */
export const SIGIL_DROPS = {
  bossMinTier: 3,
  bossChance: 0.10,
  sealedBossMultiplier: 2,
  genericShare: 0.6,
  strength: [
    { minTier: 12, weights: [100, 30, 8] },
    { minTier: 8, weights: [100, 30, 0] },
    { minTier: 3, weights: [100, 0, 0] },
  ],
} as const;

/** Rook sells Faint sigils (D 6.4): the six generic kinds always, a theme sigil once the account has cleared an area of that theme. */
export const ROOK_SIGIL_PRICE = { generic: 14, theme: 18 } as const;

/** The sigil registry: one entry per id (12 kinds x 3 strengths). */
export interface SigilDef {
  id: SigilId;
  kind: SigilKind;
  strength: SigilStrength;
  /** "Faint Omen Sigil", "Blazing Ashen Sigil". */
  name: string;
  /** Theme sigils only: the map theme they work on and the currency they favour. */
  theme?: { baseId: MapBaseId; currencyId: CurrencyId };
}

const kindLabel = (kind: SigilKind): string => (kind in THEME_SIGILS ? THEME_SIGILS[kind as ThemeSigilKind].label : GENERIC_SIGIL_LABELS[kind as GenericSigilKind]);

export const SIGILS: readonly SigilDef[] = SIGIL_IDS.map((id): SigilDef => {
  const m = /^([a-z]+)Sigil([123])$/.exec(id)!;
  const kind = m[1] as SigilKind, strength = Number(m[2]) as SigilStrength;
  const theme = kind in THEME_SIGILS ? THEME_SIGILS[kind as ThemeSigilKind] : undefined;
  return { id, kind, strength, name: `${SIGIL_STRENGTH_NAMES[strength]} ${kindLabel(kind)} Sigil`, ...(theme ? { theme: { baseId: theme.baseId, currencyId: theme.currencyId } } : {}) };
});
const SIGIL_BY_ID = new Map<string, SigilDef>(SIGILS.map((s) => [s.id, s]));

/** The sigil of an id, or undefined for anything else (any currency id, junk). */
export function findSigil(id: unknown): SigilDef | undefined {
  return typeof id === 'string' ? SIGIL_BY_ID.get(id) : undefined;
}

export function sigilIdOf(kind: SigilKind, strength: SigilStrength): SigilId {
  return `${kind}Sigil${strength}`;
}

const THEME_NAMES: Readonly<Record<MapBaseId, string>> = {
  ashenForge: 'Ashen Forge', cinderChapel: 'Cinder Chapel', choralCrypt: 'Choral Crypt', rimedOssuary: 'Rimed Ossuary', chainworks: 'Chainworks', ironColiseum: 'Iron Coliseum',
};
const CURRENCY_NAMES: Readonly<Partial<Record<CurrencyId, string>>> = {
  essenceEmber: 'Ember Essence', seal: 'Binding Seal', solvent: 'Solvent', essenceRime: 'Rime Essence', scrap: 'Forge Scrap', fractureCore: 'Fracture Core',
};

/**
 * What one sigil does at `share` (1 = full strength, 0.5 = a second sigil of its kind), in words generated from the numbers: the item
 * description, the beacon panel and the readout all use it.
 */
export function sigilEffectText(def: Pick<SigilDef, 'kind' | 'strength' | 'theme'>, share = 1): string {
  const v = (n: number): string => String(Math.round(n * share * 100) / 100);
  const s = def.strength;
  switch (def.kind) {
    case 'omen': return `+${v(SIGIL_VALUES.omen[s])} percentage points to the encounter chance (the encounter cap still applies)`;
    case 'hoard': return `${v(SIGIL_VALUES.hoard[s])}% increased item quantity in dead-end and sealed areas`;
    case 'fortune': return `${v(SIGIL_VALUES.fortune[s])}% increased item rarity`;
    case 'ingredient': return `${v(SIGIL_VALUES.ingredient[s])}% more boss ingredient chances`;
    case 'survey': return `${v(SIGIL_VALUES.survey[s])}% chance for a boss kill to reveal one more neighbour`;
    case 'tide': {
      if (s === 1) return `The surge bonus is ${Math.round((1 + (TIDE.bonusMultiplier - 1) * share) * 1000) / 1000} times as strong`;
      const charge = share >= 1 ? `+${TIDE.charges} daily surge charge on every covered area` : 'no extra charge (a stronger Tide sigil already gives it)';
      return s === 3 ? `${charge}; ${v(TIDE.keepChance * 100)}% chance a spent charge is not consumed` : charge;
    }
    default: {
      const theme = def.theme!;
      return `On ${THEME_NAMES[theme.baseId]} maps: ${v(SIGIL_VALUES.theme[s])}% more ${CURRENCY_NAMES[theme.currencyId] ?? theme.currencyId} weight and +${v(THEME_SIGIL_CLASS_WEIGHT)} weight for the item classes the area favours`;
    }
  }
}

/** The theme sigil kind of a map theme. */
export function themeSigilKind(baseId: MapBaseId): ThemeSigilKind {
  return (Object.keys(THEME_SIGILS) as ThemeSigilKind[]).find((k) => THEME_SIGILS[k].baseId === baseId)!;
}
