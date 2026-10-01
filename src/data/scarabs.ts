import { SCARAB_IDS, type ScarabId } from '../contracts/content';

/**
 * Wave scarabs change the waves of one expedition; area-bias scarabs (brief D 5.6) change only which Atlas area the
 * expedition's dropped maps are bound to (the frozen routing table), never how many maps drop.
 */
export type ScarabFamily = 'haste' | 'invasion' | 'homing' | 'wayfarer' | 'deepward' | 'quarry' | 'hearthbound';
export type ScarabKind = 'wave' | 'area';

/** What an area-bias scarab does to the routing table (numbers are per tier, read by map-routing.ts). */
export type AreaScarabEffect =
  | { kind: 'own'; multiplier: number }
  | { kind: 'neighbours'; multiplier: number }
  | { kind: 'upward'; weight: number; chestUpgradePoints: number }
  | { kind: 'deadEnds'; multiplier: number }
  | { kind: 'theme'; multiplier: number };

export interface ScarabDef {
  id: ScarabId;
  name: string;
  family: ScarabFamily;
  /** "Haste", "Homing": the family label tooltips and socket errors use. */
  familyName: string;
  kind: ScarabKind;
  tier: number;
  minMonsterLevel: number;
  weight: number;
  durationLess: number;
  startWave: number;
  /** Area-bias scarabs only. */
  area?: AreaScarabEffect;
  description: string;
}

/** Separate rare drop roll; quantity and monster rarity's quantity multiplier apply. */
export const SCARAB_DROP_CHANCE = 0.0005;
/** The five area-bias families together take this share of scarab rolls (equal split); the wave families the rest (D 5.6). */
export const AREA_SCARAB_SHARE = 0.4;
/** Homing may never give the own area more than this share of the routing table (D 5.6 anti-degenerate check, tested at 70%). A pin lifts it. */
export const AREA_SCARAB_OWN_CAP = 0.7;

const TIER_NAMES = ['Weathered', 'Etched', 'Gilded', 'Exalted'] as const;
const MIN_LEVEL = [4, 22, 46, 70] as const;
const DROP_WEIGHT = [100, 30, 8, 2] as const;

interface FamilySpec {
  family: ScarabFamily;
  label: string;
  kind: ScarabKind;
  /** The tier-by-tier numbers shown in the spec table, in tier order. */
  values: readonly number[];
  /** Second per-tier column (Deepward's chest upgrade points). */
  extra?: readonly number[];
  area?: (tier: number) => AreaScarabEffect;
  text: (tier: number) => string;
}

const x = (v: number): string => `x${v}`;

/** The seven families, in the order a socket picker lists them. */
export const SCARAB_FAMILIES: readonly FamilySpec[] = [
  {
    family: 'haste', label: 'Haste', kind: 'wave', values: [15, 25, 35, 50],
    text: t => `Reduces wave duration by ${[15, 25, 35, 50][t - 1]}%. Only one Haste Scarab per map, regardless of tier.`,
  },
  {
    family: 'invasion', label: 'Invasion', kind: 'wave', values: [2, 3, 4, 5],
    text: t => `Starts at wave ${t + 1}. Every monster from waves 1–${t + 1} spawns at the opening, including the streaming monsters. Only one Invasion Scarab per map.`,
  },
  {
    family: 'homing', label: 'Homing', kind: 'area', values: [2, 3, 4, 6],
    area: t => ({ kind: 'own', multiplier: [2, 3, 4, 6][t - 1] }),
    text: t => `Makes the maps dropped in this expedition ${x([2, 3, 4, 6][t - 1])} as likely to be maps of the area you run. Only one Homing Scarab per map.`,
  },
  {
    family: 'wayfarer', label: 'Wayfarer', kind: 'area', values: [1.5, 2, 2.5, 3],
    area: t => ({ kind: 'neighbours', multiplier: [1.5, 2, 2.5, 3][t - 1] }),
    text: t => `Makes the maps dropped in this expedition ${x([1.5, 2, 2.5, 3][t - 1])} as likely to be maps of a charted neighbouring area (dead ends excepted). Only one Wayfarer Scarab per map.`,
  },
  {
    family: 'deepward', label: 'Deepward', kind: 'area', values: [20, 28, 36, 45], extra: [5, 8, 11, 15],
    area: t => ({ kind: 'upward', weight: [20, 28, 36, 45][t - 1], chestUpgradePoints: [5, 8, 11, 15][t - 1] }),
    text: t => `Raises the share of dropped maps that are one tier higher to ${[20, 28, 36, 45][t - 1]}% (15% normally) and makes the completion chest upgrade its map ${[5, 8, 11, 15][t - 1]} percentage points more often. Deeper areas take the extra tiers. Only one Deepward Scarab per map.`,
  },
  {
    family: 'quarry', label: 'Quarry', kind: 'area', values: [2, 3, 4, 6],
    area: t => ({ kind: 'deadEnds', multiplier: [2, 3, 4, 6][t - 1] }),
    text: t => `Makes the maps dropped in this expedition ${x([2, 3, 4, 6][t - 1])} as likely to be maps of a dead-end area within two hops. Only one Quarry Scarab per map.`,
  },
  {
    family: 'hearthbound', label: 'Hearthbound', kind: 'area', values: [1.5, 2, 3, 4],
    area: t => ({ kind: 'theme', multiplier: [1.5, 2, 3, 4][t - 1] }),
    text: t => `Makes the maps dropped in this expedition ${x([1.5, 2, 3, 4][t - 1])} as likely to be maps of any charted area with this map's theme, however far away. Only one Hearthbound Scarab per map.`,
  },
];

const FAMILY_BY_PREFIX = new Map(SCARAB_FAMILIES.map(f => [f.family as string, f]));
const familyOfId = (id: string): FamilySpec => FAMILY_BY_PREFIX.get(id.replace(/Scarab\d$/, ''))!;

export const SCARABS: readonly ScarabDef[] = SCARAB_IDS.map((id, index) => {
  const tier = index % 4 + 1;
  const spec = familyOfId(id);
  const haste = spec.family === 'haste';
  const def: ScarabDef = {
    id, tier, family: spec.family, familyName: spec.label, kind: spec.kind,
    name: `${TIER_NAMES[tier - 1]} ${spec.label} Scarab`,
    minMonsterLevel: MIN_LEVEL[tier - 1], weight: DROP_WEIGHT[tier - 1],
    durationLess: haste ? spec.values[tier - 1] : 0,
    startWave: spec.family === 'invasion' ? tier + 1 : 1,
    description: spec.text(tier),
  };
  if (spec.area) def.area = spec.area(tier);
  return def;
});
export function findScarab(id: unknown): ScarabDef | undefined { return SCARABS.find(s => s.id === id); }
export function isScarabId(id: unknown): id is ScarabId { return !!findScarab(id); }
/** Whether a scarab changes the waves (the others only bias which areas dropped maps are bound to). */
export function isWaveScarab(id: ScarabId): boolean { return findScarab(id)?.kind === 'wave'; }
export function scarabEffects(ids: readonly ScarabId[] = []) {
  return ids.reduce((effects, id) => {
    const s = findScarab(id)!;
    return { durationMultiplier: effects.durationMultiplier * (1 - s.durationLess / 100), startWave: Math.max(effects.startWave, s.startWave) };
  }, { durationMultiplier: 1, startWave: 1 });
}
/** Invalid persisted expedition data is refused rather than silently losing paid modifiers. */
export function validScarabs(raw: unknown): raw is ScarabId[] {
  return Array.isArray(raw) && raw.length <= 4 && raw.every(isScarabId)
    && new Set(raw.map(id => findScarab(id)!.family)).size === raw.length;
}
