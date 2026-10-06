// The Orrery's structural rules as numbers (PT4, docs/power-rework/passive-tree.md 3 and 6): the resolved rules of an allocation
// (resolvePassives, under the tree's caps) summed per rule id and damage type, plus the text the character sheet shows for each.
// Pure and memoised per allocation; a character without passives has no totals (null), so nothing downstream changes for it.
import type { DamageType } from '../../contracts/content';
import { DAMAGE_TYPES } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import { PASSIVE_RULES, type PassiveRuleId } from '../../data/progression/passives';
import { resolvedPassivesOf, type ResolvedRule } from './passives';

export interface PassiveTotals {
  /** Every live rule of the allocation, in node order, with its source ("Orrery: Kindle"). */
  rules: readonly ResolvedRule[];
  /** Σ value of a rule (typed rules count for their type only; untyped ones for every type). */
  sum(id: PassiveRuleId, type?: DamageType): number;
  /** ∏ (1 + value / 100) of a rule (`more` lines; a negative value is a `less`). */
  product(id: PassiveRuleId, type?: DamageType): number;
  /** ∏ (1 − value / 100) of a rule whose positive value is a `less` ("20% less damage"). */
  less(id: PassiveRuleId, type?: DamageType): number;
  /** Largest / smallest value of a rule (0 when absent). */
  max(id: PassiveRuleId): number;
  min(id: PassiveRuleId): number;
  has(id: PassiveRuleId): boolean;
  /** The rules of one id (for their sources). */
  of(id: PassiveRuleId): ResolvedRule[];
}

const matches = (r: ResolvedRule, type?: DamageType) => type === undefined || r.type === undefined || r.type === type;

function totalsOf(rules: readonly ResolvedRule[]): PassiveTotals {
  const of = (id: PassiveRuleId) => rules.filter((r) => r.id === id);
  return {
    rules,
    sum: (id, type) => of(id).filter((r) => matches(r, type)).reduce((s, r) => s + r.value, 0),
    product: (id, type) => of(id).filter((r) => matches(r, type)).reduce((p, r) => p * (1 + r.value / 100), 1),
    less: (id, type) => of(id).filter((r) => matches(r, type)).reduce((p, r) => p * Math.max(0, 1 - r.value / 100), 1),
    max: (id) => of(id).reduce((m, r) => Math.max(m, r.value), 0),
    min: (id) => {
      const list = of(id);
      return list.length ? Math.min(...list.map((r) => r.value)) : 0;
    },
    has: (id) => rules.some((r) => r.id === id),
    of,
  };
}

const CACHE = new WeakMap<object, PassiveTotals | null>();

/** The live rule totals of a character's allocation (null when nothing is allocated or no allocated node has a rule). */
export function passiveTotalsOf(ch: Pick<CharacterSave, 'passives' | 'masteries'>): PassiveTotals | null {
  const resolved = resolvedPassivesOf(ch);
  if (!resolved) return null;
  if (CACHE.has(resolved)) return CACHE.get(resolved)!;
  const live = resolved.rules.filter((r) => PASSIVE_RULES[r.id]?.live);
  const totals = live.length ? totalsOf(live) : null;
  CACHE.set(resolved, totals);
  return totals;
}

// ---------------------------------------------------------------------------------------------
// Text (the sheet's "Orrery" section; also handy for tooltips)
// ---------------------------------------------------------------------------------------------

const TYPE_NAME: Record<DamageType, string> = { physical: 'Physical', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', void: 'Void' };
const n = (v: number) => String(Math.round(v * 100) / 100);
const typed = (r: ResolvedRule, all = '') => (r.type ? `${TYPE_NAME[r.type]} ` : all);

/** One player-facing sentence for a resolved rule (or a summed group of one id and type). */
export function passiveRuleText(r: Pick<ResolvedRule, 'id' | 'value' | 'type' | 'to'>): string {
  const v = r.value;
  const t = r as ResolvedRule;
  switch (r.id) {
    case 'igniteDuration': return `Ignites you cause last ${n(v)}% longer`;
    case 'igniteEffect': return `Ignites you cause deal ${n(v)}% more damage`;
    case 'shockEffect': return `Shocks you cause are ${n(v)} points stronger`;
    case 'shockEffectPct': return `Shocks you cause are ${n(v)}% stronger`;
    case 'shockDuration': return `Shocks you cause last ${n(v)} seconds longer`;
    case 'chillEffect': return `Chills you cause slow ${n(v)} points more`;
    case 'chillEffectSet': return `Chills you cause slow by ${n(v)}%`;
    case 'exposureEffect': return `${typed(t)}Exposures you apply are ${n(v)} points stronger (at most 25)`;
    case 'exposureDuration': return `Exposures you apply last ${n(v)} seconds longer`;
    case 'decayDuration': return `Decay lasts ${n(v)} seconds longer`;
    case 'decayEffect': return `Decay deals ${n(v)}% more damage`;
    case 'decayStacks': return `Decay stacks ${n(v)} more times`;
    case 'witherStacks': return `Withered you apply stacks ${n(v)} more time${v === 1 ? '' : 's'} (at most 25 points)`;
    case 'moreNearBurning': return `${n(v)}% more ${typed(t)}Damage while 3 or more Burning enemies are within 120`;
    case 'damageVsBurning': return `${n(v)}% increased ${typed(t)}Damage against Burning enemies`;
    case 'damageVsChilled': return `${n(v)}% increased ${typed(t)}Damage against Chilled enemies`;
    case 'moreVsChilled': return `${n(v)}% more Damage against Chilled enemies`;
    case 'lessVsUnchilled': return `${n(v)}% less Damage against enemies that are not Chilled`;
    case 'nonCritLess': return `Non-critical hits deal ${n(v)}% less damage`;
    case 'otherSkillsLess': return `Skills other than your first loadout skill deal ${n(v)}% less damage`;
    case 'critMultiplierTyped': return `+${n(v)} to Critical Strike Multiplier with ${typed(t)}skills`;
    case 'areaTyped': return `${n(v)}% increased Area of Effect for ${typed(t)}skills`;
    case 'igniteSpreadOnDeath': return `Ignited enemies that die ignite ${n(v)} enemies within 100`;
    case 'fireKillBurst': return `Fire kills have a ${n(v)}% chance to burst for 1.2× effectiveness in radius 50`;
    case 'shatterNova': return `Killing a Chilled enemy has a ${n(v)}% chance to emit a cold nova (2× effectiveness, radius 70)`;
    case 'decayedExplode': return `Enemies you kill while Decayed explode for ${n(v)}% of their Life as Void Damage`;
    case 'lowLifeWard': return `Below ${n(v)}% Life, Cinder Ward is cast for free (once every 30 seconds)`;
    case 'pulseEveryKills': return `Every ${n(v)} kills restore 6% of maximum Life`;
    case 'focusOnKillTyped': return `Killing an enemy with ${typed(t)}Damage restores ${n(v)} Focus`;
    case 'focusOnKillShocked': return `Killing a Shocked enemy restores ${n(v)} Focus`;
    case 'focusLeech': return `${n(v)}% of ${typed(t)}Damage dealt is restored as Focus (at most 6 per second)`;
    case 'lifeOnKillMore': return `Life per Kill is ${n(v)}% higher`;
    case 'convert': return `${n(v)}% of ${typed(t)}Damage is converted to ${r.to ? TYPE_NAME[r.to] : ''} (modifiers of both apply)`;
    case 'convertAll': return `All your damage is converted to ${r.to ? TYPE_NAME[r.to] : 'Fire'}`;
    case 'echoAll': return `Every damaging skill echoes once after 0.4 seconds at ${n(v)}% damage, for no Focus`;
    case 'echoDamage': return `Echoes deal ${n(v)}% more damage`;
    case 'augmentSlot': return `Your first loadout skill has ${n(v)} additional augment slot${v === 1 ? '' : 's'}`;
    case 'focusCost': return `Skills cost ${n(v)}% more Focus`;
    case 'zoneDuration': return `${typed(t)}zones and orbs last ${n(v)}% longer`;
    case 'pullEffect': return `Pull effects are ${n(v)}% stronger`;
    case 'knockback': return `${n(v)}% increased Knockback`;
    case 'blinkRecovery': return `Phase Stride and Rift Step recover ${n(v)}% faster`;
    case 'rangeLess': return `${n(v)}% less Projectile range`;
    case 'penCap': return `+${n(v)} to the Penetration cap`;
    case 'damageTakenTyped': return `Take ${n(Math.abs(v))}% ${v < 0 ? 'less' : 'more'} ${typed(t)}Damage`;
    case 'damageTakenHits': return `Take ${n(Math.abs(v))}% ${v < 0 ? 'less' : 'more'} ${typed(t)}Damage from hits`;
    case 'burnOnYouDuration': return `Burning on you lasts ${n(Math.abs(v))}% ${v < 0 ? 'shorter' : 'longer'}`;
    case 'chilledDealLess': return `Enemies Chilled by you deal ${n(v)}% less damage`;
    case 'regenPercent': return `Regenerate ${n(v)}% of maximum Life per second`;
    case 'regenLowLife': return `Regenerate a further ${n(v)}% of maximum Life per second while below 50% Life`;
    case 'lifePerStr': return `1% increased maximum Life per ${n(v)} Strength`;
    case 'flaskChargePerKills': return `Flasks gain a charge every ${n(v)} kills`;
    case 'flaskGuard': return `Life Flasks also grant ${n(v)}% less Damage Taken for 2 seconds`;
    case 'focusFlaskLife': return `Focus Flasks also restore ${n(v)}% of maximum Life`;
    case 'flaskDuration': return `Flasks last ${n(v)}% longer`;
    case 'noLifeFlasks': return 'You cannot use Life Flasks';
    case 'armourBigHits': return `Armour is ${n(v)}% more effective against hits above 20% of your Life`;
    case 'armourFormula': return `Armour counts ${n(v)} instead of 10 per point of damage`;
    case 'armourVsElements': return `Armour applies to Elemental Damage at ${n(v)}% effectiveness`;
    case 'evadeChance': return `+${n(v)} points to chance to Evade (the cap still applies)`;
    case 'evadeCap': return `+${n(v)} points to the Evade cap`;
    case 'wardEffect': return `Wards and barriers are ${n(v)}% stronger (Cinder Ward cap 60% → 66%)`;
    case 'damageFromFocus': return `${n(v)}% of Damage taken is drawn from Focus first`;
  }
}

/** Rules whose values combine by multiplying (`more` / `less` lines); the others add. */
const MULTIPLIED: ReadonlySet<PassiveRuleId> = new Set<PassiveRuleId>([
  'igniteEffect', 'shockEffectPct', 'decayEffect', 'moreNearBurning', 'moreVsChilled', 'echoDamage', 'focusCost', 'damageTakenTyped',
  'damageTakenHits',
]);
/** `less` lines written with a positive value ("20% less"): they combine as ∏ (1 − v). */
const LESS: ReadonlySet<PassiveRuleId> = new Set<PassiveRuleId>(['lessVsUnchilled', 'nonCritLess', 'otherSkillsLess', 'rangeLess']);
/** Rules where the best single value counts. */
const BEST: ReadonlySet<PassiveRuleId> = new Set<PassiveRuleId>([
  'chillEffectSet', 'igniteSpreadOnDeath', 'lowLifeWard', 'echoAll', 'armourVsElements', 'flaskGuard', 'noLifeFlasks',
]);
const LOWEST: ReadonlySet<PassiveRuleId> = new Set<PassiveRuleId>(['pulseEveryKills', 'lifePerStr', 'flaskChargePerKills', 'armourFormula']);

/** The sheet's lines: one per rule id (and damage type / target), its combined value and every source. */
export function passiveRuleLines(t: PassiveTotals): { text: string; sources: string[] }[] {
  const groups = new Map<string, ResolvedRule[]>();
  for (const r of t.rules) {
    const key = `${r.id}:${r.type ?? ''}:${r.to ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: { text: string; sources: string[] }[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const id = first.id;
    let value: number;
    if (MULTIPLIED.has(id)) value = (list.reduce((acc, r) => acc * (1 + r.value / 100), 1) - 1) * 100;
    else if (LESS.has(id)) value = (1 - list.reduce((acc, r) => acc * Math.max(0, 1 - r.value / 100), 1)) * 100;
    else if (BEST.has(id)) value = Math.max(...list.map((r) => r.value));
    else if (LOWEST.has(id)) value = Math.min(...list.map((r) => r.value));
    else value = list.reduce((s, r) => s + r.value, 0);
    out.push({
      text: passiveRuleText({ ...first, value }),
      sources: list.map((r) => (list.length > 1 ? `${passiveRuleText(r)} from ${r.source}` : `From ${r.source}`)),
    });
  }
  return out;
}

/** Index of a damage type in DAMAGE_TYPES (the sim's per-type arrays). */
export function typeIndex(t: DamageType): number {
  return DAMAGE_TYPES.indexOf(t);
}
