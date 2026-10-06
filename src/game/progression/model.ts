// The player model: every StatModifier that applies to a character, resolved through the one numeric
// formula of the game (src/core/modifiers). Attributes resolve first (base + class growth + allocated
// points + gear); per-level and per-attribute rules then become ordinary labelled modifiers, so every
// number on the character sheet and every skill number can be broken down by source.
import type { Attribute, DamageType, EquipSlot, PlayerFlag } from '../../contracts/content';
import { ATTRIBUTES, EQUIP_SLOTS } from '../../contracts/content';
import type { CharacterSave, StatBreakdown, StatId, StatModifier } from '../../contracts/items';
import { resolveStatBreakdown } from '../../core/modifiers';
import { PEN_CAP, SORCERESS, STAT_CAPS } from '../../data/progression';
import type { ClassDef } from '../../data/progression';
import { STAT_LABEL } from '../../data/items';
import { itemFlags, itemModifiers } from '../items';
import { passiveModifiers } from './passives';

/** Stats whose value is a percentage resolved against a base of 100 (value − 100 = total % increase). */
export const PERCENT_STATS: ReadonlySet<StatId> = new Set<StatId>([
  'spellDamage', 'fireDamage', 'coldDamage', 'lightningDamage', 'voidDamage', 'physicalDamage', 'elementalDamage',
  'projectileDamage', 'areaDamage', 'damageOverTime', 'castSpeed', 'projectileSpeed', 'area', 'duration', 'cooldownRecovery', 'flaskEffect', 'itemQuantity', 'itemRarity',
]);

export interface PlayerModel {
  cls: ClassDef;
  level: number;
  /** Level of the monsters the character faces (defences scale against it); null = the hideout sheet. */
  monsterLevel: number | null;
  attributes: Record<Attribute, number>;
  attributeBreakdowns: Record<Attribute, StatBreakdown>;
  /** Every non-attribute modifier: level rules, attribute rules, gear, and any extra (map) modifiers. */
  mods: StatModifier[];
  flags: PlayerFlag[];
  /** Resolve a stat against a base (defaults: class base, 100 for percent stats, 1 for damage taken). */
  breakdown(stat: StatId, base?: number): StatBreakdown;
  /** Σ of one mode for a stat (e.g. total % increased). */
  sum(stat: StatId, mode: StatModifier['mode']): number;
  /** Modifiers of the given stats (in source order). */
  of(...stats: StatId[]): StatModifier[];
}

/** Neutral base of a stat for this class. */
export function baseStat(cls: ClassDef, stat: StatId): number {
  const b = cls.baseStats[stat];
  if (b !== undefined) return b;
  if (PERCENT_STATS.has(stat)) return 100;
  if (stat === 'damageTaken') return 1;
  if (stat === 'focusRegen') return cls.focusRegen.flat;
  return 0;
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
}

function equippedItems(ch: CharacterSave) {
  const out = [];
  for (const slot of EQUIP_SLOTS as readonly EquipSlot[]) {
    const item = ch.equipment?.[slot];
    if (item && item.kind === 'equipment') out.push(item);
  }
  return out;
}

/** "+1 Maximum Life per Strength", "1% increased Spell Damage per 5 Intelligence". */
export function attributeRuleText(rule: ClassDef['perAttribute'][number]): string {
  const stat = STAT_LABEL[rule.stat];
  const per = rule.per === 1 ? STAT_LABEL[rule.attribute] : `${rule.per} ${STAT_LABEL[rule.attribute]}`;
  if (rule.mode === 'flat') return `+${rule.value} ${stat} per ${per}`;
  if (rule.mode === 'increased') return `${rule.value}% increased ${stat} per ${per}`;
  return `${rule.value}% more ${stat} per ${per}`;
}

/**
 * Build the model for a character. `extra` modifiers (map penalties, previews) join the gear
 * modifiers. Attributes are whole numbers (floored after resolution).
 */
export function buildPlayerModel(
  ch: CharacterSave, extra: readonly StatModifier[] = [], cls: ClassDef = SORCERESS, monsterLevel: number | null = null,
): PlayerModel {
  const level = clampLevel(ch.level);
  const steps = level - 1;
  const items = equippedItems(ch);
  const gear = items.flatMap((item) => itemModifiers(item));
  const all = [...gear, ...passiveModifiers(ch), ...extra];
  const isAttr = (m: StatModifier) => (ATTRIBUTES as readonly string[]).includes(m.stat);

  const attributes = {} as Record<Attribute, number>;
  const attributeBreakdowns = {} as Record<Attribute, StatBreakdown>;
  for (const a of ATTRIBUTES) {
    const def = cls.attributes[a];
    const growth = Math.floor(def.perLevel * steps + 1e-9);
    const allocated = Math.max(0, Math.floor(ch.allocated?.[a] ?? 0));
    const mods: StatModifier[] = [];
    if (growth > 0) mods.push({ stat: a, mode: 'flat', value: growth, source: `Level ${level} growth` });
    if (allocated > 0) mods.push({ stat: a, mode: 'flat', value: allocated, source: 'Allocated points' });
    mods.push(...all.filter((m) => m.stat === a));
    const bd = resolveStatBreakdown(a, def.base, mods);
    attributeBreakdowns[a] = bd;
    attributes[a] = Math.max(0, Math.floor(bd.value + 1e-9));
  }

  const mods: StatModifier[] = [];
  if (steps > 0) {
    for (const rule of cls.perLevel) {
      mods.push({ stat: rule.stat, mode: rule.mode, value: rule.value * steps, source: `Level ${level}` });
    }
  }
  for (const rule of cls.perAttribute) {
    const value = Math.floor(attributes[rule.attribute] / rule.per) * rule.value;
    if (value !== 0) {
      mods.push({ stat: rule.stat, mode: rule.mode, value, source: STAT_LABEL[rule.attribute], label: attributeRuleText(rule) });
    }
  }
  mods.push(...all.filter((m) => !isAttr(m)));

  const flags: PlayerFlag[] = [];
  for (const item of items) for (const f of itemFlags(item)) if (!flags.includes(f)) flags.push(f);

  const cache = new Map<string, StatBreakdown>();
  const model: PlayerModel = {
    cls,
    level,
    monsterLevel,
    attributes,
    attributeBreakdowns,
    mods,
    flags,
    breakdown(stat, base) {
      const b = base ?? baseStat(cls, stat);
      const key = `${stat}:${b}`;
      let bd = cache.get(key);
      if (!bd) {
        bd = resolveStatBreakdown(stat, b, mods);
        cache.set(key, bd);
      }
      return bd;
    },
    sum(stat, mode) {
      let s = 0;
      for (const m of mods) if (m.stat === stat && m.mode === mode) s += m.value;
      return s;
    },
    of(...stats) {
      return mods.filter((m) => stats.includes(m.stat));
    },
  };
  return model;
}

/** The penetration stat of each damage type; fire, cold and lightning also take Elemental Penetration. */
const PEN_STAT: Record<DamageType, StatId> = {
  physical: 'physicalPen', fire: 'firePen', cold: 'coldPen', lightning: 'lightningPen', void: 'voidPen',
};

export interface Penetration {
  /** Percentage points of monster resistance ignored, capped at PEN_CAP. */
  value: number;
  /** The sum of every source before the cap. */
  uncapped: number;
  /** The sources (own-type and, for the elements, Elemental Penetration). */
  sources: StatModifier[];
}

/** Penetration of one damage type: Σ flat sources, capped at PEN_CAP (power-curve.md 4.1). */
export function penetrationOf(model: PlayerModel, type: DamageType): Penetration {
  const stats: StatId[] = [PEN_STAT[type]];
  if (type === 'fire' || type === 'cold' || type === 'lightning') stats.push('elementalPen');
  const sources = model.of(...stats);
  let uncapped = 0;
  for (const m of sources) if (m.mode === 'flat') uncapped += m.value;
  return { value: Math.min(PEN_CAP, Math.max(0, uncapped)), uncapped, sources };
}

/** The player's resistance cap in percentage points: the class cap plus Maximum Resistances, at most the hard ceiling. */
export function maxResistOf(model: PlayerModel): number {
  return Math.min(STAT_CAPS.maxResistHard, model.cls.resistCap + Math.max(0, model.breakdown('maxResistance', 0).value));
}

/** Maximum Focus (a whole number). */
export function maxFocusOf(model: PlayerModel): number {
  return Math.max(0, Math.floor(model.breakdown('maxFocus').value));
}

/**
 * Focus regeneration per second: the class's flat rate plus a percentage of maximum Focus (as a
 * labelled flat source), then every Focus Regeneration modifier (gear, map penalties).
 */
export function focusRegenBreakdown(model: PlayerModel): StatBreakdown {
  const pct = model.cls.focusRegen.percentOfMaxFocus;
  const fromMax: StatModifier = {
    stat: 'focusRegen', mode: 'flat', value: (maxFocusOf(model) * pct) / 100, source: `${pct}% of maximum Focus`,
  };
  return resolveStatBreakdown('focusRegen', model.cls.focusRegen.flat, [fromMax, ...model.of('focusRegen')]);
}

/** Spell power at a level: base + perLevel × (level − 1). */
export function spellPowerAt(cls: ClassDef, level: number): number {
  return cls.spellPower.base + cls.spellPower.perLevel * (clampLevel(level) - 1);
}
