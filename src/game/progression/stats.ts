// Derived character stats (GAME_SPEC §3): PlayerCombatStats for the sim, and a character sheet whose
// every line expands into the sources that produced it. Also the Alt-compare stat deltas.
import type { DerivedStats, RunSetup, SheetLine, SheetSection } from '../../contracts/game';
import type {
  CharacterSave, EquipmentItem, Item, StatBreakdown, StatId, StatModifier,
} from '../../contracts/items';
import type { Attribute, DamageType, EquipSlot, PlayerFlag } from '../../contracts/content';
import { ATTRIBUTES, PLAYER_FLAGS } from '../../contracts/content';
import type { PlayerCombatStats } from '../../contracts/sim';
import { resolveStatBreakdown } from '../../core/modifiers';
import { STAT_LABEL, UNIQUES, findBase } from '../../data/items';
import { MONSTER_LEVEL_SCALING, PEN_CAP, STAT_CAPS, getSkill, monsterDamageScale } from '../../data/progression';
import type { ClassDef } from '../../data/progression';
import { formatNumber, formatSigned } from '../items';
import { lootLuckLines } from './luck';
import { mapPlayerModifiers } from './maps';
import { treeContextOf } from './atlas-rules';
import { attributeRuleText, buildPlayerModel, focusRegenBreakdown, maxFocusOf, maxResistOf, penetrationOf, PERCENT_STATS, spellPowerAt } from './model';
import type { PlayerModel } from './model';
import {
  BASIC_SKILL, amount, damageRange, damageStatsFor, damageTypeName, estimateLines, isMultiHit, normalizeLoadout, resolveSkill, skillRank,
} from './skills';
import type { ResolvedSkill } from './skills';
import { clean, oneDecimal, percent, plainNumber, signedPercent } from './util';

// ---------------------------------------------------------------------------------------------
// Breakdown text
// ---------------------------------------------------------------------------------------------

const round1 = (v: number) => Math.round(v * 10) / 10;

/** One source line: "+10 from Strength", "12% increased from Ashwood Wand (implicit)", "25% more from …". */
export function sourceLine(m: StatModifier, unit = ''): string {
  const v = round1(m.value);
  if (m.mode === 'flat') return `${formatSigned(v)}${unit} from ${m.source}`;
  if (m.mode === 'increased') return `${formatNumber(v)}% ${v < 0 ? 'reduced' : 'increased'} from ${m.source}`;
  return `${formatNumber(v)}% ${v < 0 ? 'less' : 'more'} from ${m.source}`;
}

/** Breakdown lines: base (unless it is the neutral 100% of a percent stat), then every source. */
export function breakdownLines(bd: StatBreakdown, opts: { unit?: string; baseLabel?: string; hideBase?: boolean } = {}): string[] {
  const unit = opts.unit ?? '';
  const lines: string[] = [];
  const neutralPercent = PERCENT_STATS.has(bd.stat) && bd.base === 100;
  if (!opts.hideBase && !neutralPercent && (bd.base !== 0 || bd.sources.length === 0)) {
    lines.push(`${opts.baseLabel ?? 'Base'} ${oneDecimal(bd.base)}${unit}`);
  }
  for (const m of bd.sources) lines.push(sourceLine(m, unit));
  if (!lines.length) lines.push('No modifiers');
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Combat stats
// ---------------------------------------------------------------------------------------------

const RESIST_STATS: Record<Exclude<DamageType, 'physical'>, StatId> = {
  fire: 'fireRes', cold: 'coldRes', lightning: 'lightningRes', void: 'voidRes',
};

/** The evasion constant against monsters of a level: higher-level monsters are harder to evade. */
export function evasionConstantFor(cls: ClassDef, monsterLevel: number | null): number {
  return cls.evasionPerMonsterLevel * (monsterLevel ?? MONSTER_LEVEL_SCALING.referenceLevel);
}

interface Computed {
  combat: PlayerCombatStats;
  breakdowns: Partial<Record<StatId, StatBreakdown>>;
  evasionRating: number;
  /** Uncapped resistances in percent (map penalty already included). */
  resistUncapped: Record<Exclude<DamageType, 'physical'>, number>;
}

/** Resistance breakdown: own modifiers plus "all resistances" relabelled onto the element. */
function resistBreakdown(model: PlayerModel, stat: StatId): StatBreakdown {
  const mods = [...model.of(stat), ...model.of('allRes').map((m) => ({ ...m, stat }))];
  return resolveStatBreakdown(stat, 0, mods);
}

export function computeCombat(model: PlayerModel): Computed {
  const cls = model.cls;
  const bds: Partial<Record<StatId, StatBreakdown>> = {};
  const take = (stat: StatId, base?: number) => {
    const bd = model.breakdown(stat, base);
    bds[stat] = bd;
    return bd;
  };
  for (const a of ATTRIBUTES) bds[a] = model.attributeBreakdowns[a];

  const maxLife = Math.max(1, Math.floor(take('maxLife').value));
  take('maxFocus');
  const maxFocus = maxFocusOf(model);
  const focusRegenBd = focusRegenBreakdown(model);
  bds.focusRegen = focusRegenBd;
  const lifeRegen = Math.max(0, take('lifeRegen', 0).value);
  const armor = Math.max(0, Math.floor(take('armor', 0).value));
  const evasionRating = Math.max(0, Math.floor(take('evasion').value));
  const evasionConstant = evasionConstantFor(cls, model.monsterLevel);
  const evasion = Math.min(cls.evasionCap, evasionRating / (evasionRating + evasionConstant));

  const resistUncapped = { fire: 0, cold: 0, lightning: 0, void: 0 };
  // Resistance is handed to the sim UNCAPPED (the map penalty is already subtracted): the sim caps it at maxResist after
  // Withered, so resistance above the cap is a real buffer (power-curve.md 4.1).
  const resist: Record<DamageType, number> = { physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 };
  const maxResist = maxResistOf(model);
  for (const [type, stat] of Object.entries(RESIST_STATS) as [Exclude<DamageType, 'physical'>, StatId][]) {
    const bd = resistBreakdown(model, stat);
    bds[stat] = bd;
    resistUncapped[type] = bd.value;
    resist[type] = bd.value / 100;
  }
  take('allRes', 0);

  const combat: PlayerCombatStats = {
    maxLife,
    lifeRegen,
    maxFocus,
    focusRegen: Math.max(0, focusRegenBd.value),
    armor,
    evasion,
    resist,
    damageTaken: Math.max(0, take('damageTaken').value),
    moveSpeed: Math.max(0, take('moveSpeed').value),
    pickupRadius: Math.max(0, take('pickupRadius').value),
    lifeOnKill: Math.max(0, take('lifeOnKill', 0).value),
    focusOnKill: Math.max(0, take('focusOnKill', 0).value),
    flaskEffect: Math.max(0, take('flaskEffect').value / 100),
    pen: {
      physical: penetrationOf(model, 'physical').value, fire: penetrationOf(model, 'fire').value,
      cold: penetrationOf(model, 'cold').value, lightning: penetrationOf(model, 'lightning').value,
      void: penetrationOf(model, 'void').value,
    },
    maxResist,
    flags: [...model.flags],
  };
  // Offence and luck breakdowns (read by the sheet and debugging tooltips).
  for (const stat of [
    'projectileDamage', 'areaDamage', 'damageOverTime', 'spellDamage', 'fireDamage', 'coldDamage', 'lightningDamage', 'voidDamage', 'physicalDamage', 'elementalDamage',
    'castSpeed', 'projectileSpeed', 'area', 'duration', 'cooldownRecovery', 'itemQuantity', 'itemRarity',
  ] as StatId[]) take(stat);
  for (const stat of ['addedSpellDamage', 'critChance', 'extraProjectiles', 'pierce', 'extraChains', 'igniteChance', 'chillChance', 'shockChance'] as StatId[]) {
    take(stat, 0);
  }
  take('critMultiplier');
  take('maxResistance', 0);
  return { combat, breakdowns: bds, evasionRating, resistUncapped };
}

// ---------------------------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------------------------

function line(label: string, value: string, breakdown: string[]): SheetLine {
  return { label, value, breakdown };
}

function hasSources(bd: StatBreakdown | undefined): boolean {
  return !!bd && bd.sources.length > 0;
}

function percentStatLine(label: string, bd: StatBreakdown): SheetLine {
  return line(label, signedPercent(bd.value - 100), breakdownLines(bd));
}

/** A percent stat with a hard cap on the increase (power-curve.md 11): the value is the capped one, the breakdown says so. */
function cappedPercentLine(label: string, bd: StatBreakdown, capIncrease: number): SheetLine {
  const increase = bd.value - 100;
  const lines = breakdownLines(bd);
  if (increase > capIncrease) lines.push(`Capped at +${capIncrease}% (${signedPercent(increase)} uncapped)`);
  else lines.push(`Maximum +${capIncrease}%`);
  return line(label, signedPercent(Math.min(increase, capIncrease)), lines);
}

const FLAG_TEXT: Record<PlayerFlag, { text: string; source: string }> = Object.fromEntries(
  PLAYER_FLAGS.map((flag) => {
    const unique = Object.values(UNIQUES).find((u) => u.flags.some((f) => f.flag === flag));
    return [flag, { text: unique?.flags.find((f) => f.flag === flag)?.text ?? flag, source: unique?.name ?? 'an item' }];
  }),
) as Record<PlayerFlag, { text: string; source: string }>;

function attributeSection(model: PlayerModel): SheetSection {
  const lines = ATTRIBUTES.map((a: Attribute) => {
    const bd = model.attributeBreakdowns[a];
    const grants = model.cls.perAttribute
      .filter((r) => r.attribute === a)
      .map((r) => `Grants ${attributeRuleText(r)}`);
    return line(STAT_LABEL[a], String(model.attributes[a]), [...breakdownLines(bd), ...grants]);
  });
  return { title: 'Attributes', lines };
}

function resourceSection(c: Computed): SheetSection {
  const b = c.breakdowns;
  const lines: SheetLine[] = [
    line('Maximum Life', String(c.combat.maxLife), breakdownLines(b.maxLife!)),
    line('Life Regeneration', `${oneDecimal(c.combat.lifeRegen)} per second`, breakdownLines(b.lifeRegen!, { unit: ' per second' })),
  ];
  if (c.combat.lifeOnKill > 0) lines.push(line('Life per Kill', oneDecimal(c.combat.lifeOnKill), breakdownLines(b.lifeOnKill!)));
  lines.push(line('Maximum Focus', String(c.combat.maxFocus), breakdownLines(b.maxFocus!)));
  lines.push(line('Focus Regeneration', `${oneDecimal(c.combat.focusRegen)} per second`, breakdownLines(b.focusRegen!, { unit: ' per second' })));
  if (c.combat.focusOnKill > 0) lines.push(line('Focus per Kill', oneDecimal(c.combat.focusOnKill), breakdownLines(b.focusOnKill!)));
  if (hasSources(b.flaskEffect)) lines.push(percentStatLine('Flask Effect', b.flaskEffect!));
  return { title: 'Resources', lines };
}

function defenceSection(c: Computed, model: PlayerModel): SheetSection {
  const b = c.breakdowns;
  const cls = model.cls;
  const cap = c.combat.maxResist;
  const armor = c.combat.armor;
  const monsterLevel = model.monsterLevel ?? MONSTER_LEVEL_SCALING.referenceLevel;
  // Armour already loses effectiveness against larger hits. Scale the example with monster damage,
  // rather than applying a second, hidden level penalty to the actual armour rating.
  const sample = round1(20 * monsterDamageScale(monsterLevel));
  const armourNote = armor > 0
    ? `A ${sample} damage physical hit is reduced by ${percent(armor / (armor + 10 * sample))}; a ${round1(sample * 3)} damage hit by ${percent(armor / (armor + 30 * sample))}`
    : 'Armour reduces physical hits: armour / (armour + 10 x damage)';
  const lines: SheetLine[] = [
    line('Armour', String(armor), [...breakdownLines(b.armor!), armourNote, 'Armour applies to physical damage only', `Example hit at monster level ${monsterLevel}; larger hits receive less reduction`]),
    line('Evasion Rating', String(c.evasionRating), breakdownLines(b.evasion!)),
    line('Chance to Evade', percent(c.combat.evasion, 1), [
      `Evasion Rating ${c.evasionRating}`,
      `Monster Accuracy ${evasionConstantFor(cls, model.monsterLevel)}`,
      `Chance = rating / (rating + ${evasionConstantFor(cls, model.monsterLevel)}), at most ${percent(cls.evasionCap)}`,
      model.monsterLevel === null
        ? `Against monster level ${MONSTER_LEVEL_SCALING.referenceLevel}: ${cls.evasionPerMonsterLevel} per monster level`
        : `Against monster level ${model.monsterLevel}: ${cls.evasionPerMonsterLevel} per monster level`,
      'Evasion avoids monster attacks and projectiles, not area hits',
    ]),
  ];
  const names: Record<Exclude<DamageType, 'physical'>, string> = { fire: 'Fire', cold: 'Cold', lightning: 'Lightning', void: 'Void' };
  for (const [type, stat] of Object.entries(RESIST_STATS) as [Exclude<DamageType, 'physical'>, StatId][]) {
    const uncapped = c.resistUncapped[type];
    const bl = breakdownLines(b[stat]!, { unit: '%', hideBase: true });
    if (uncapped > cap) bl.push(`Capped at ${cap}% (${formatNumber(round1(uncapped))}% uncapped)`, 'Resistance above the cap buffers the map resistance penalty and Withered');
    else bl.push(`Maximum ${cap}%`);
    lines.push(line(`${names[type]} Resistance`, `${plainNumber(round1(Math.min(cap, uncapped)))}%`, bl));
  }
  if (cap !== cls.resistCap) {
    lines.push(line('Maximum Resistances', `${plainNumber(cap)}%`, [`Base ${cls.resistCap}%`, ...breakdownLines(b.maxResistance!, { unit: '%', hideBase: true }), `At most ${STAT_CAPS.maxResistHard}%`]));
  }
  if (hasSources(b.damageTaken)) {
    lines.push(line('Damage Taken', percent(c.combat.damageTaken), breakdownLines(b.damageTaken!, { hideBase: true })));
  }
  return { title: 'Defence', lines };
}

const PEN_NAMES: [DamageType, string][] = [['physical', 'Physical'], ['fire', 'Fire'], ['cold', 'Cold'], ['lightning', 'Lightning'], ['void', 'Void']];

/** Penetration: percentage points of monster resistance ignored, per type, with every source. Shown once anything grants it. */
function penetrationSection(model: PlayerModel): SheetSection {
  const lines: SheetLine[] = [];
  for (const [type, name] of PEN_NAMES) {
    const pen = penetrationOf(model, type);
    if (!pen.sources.length) continue;
    const bl = pen.sources.map((m) => sourceLine(m, '%'));
    if (pen.uncapped > PEN_CAP) bl.push(`Capped at ${PEN_CAP}% (${formatNumber(round1(pen.uncapped))}% uncapped)`);
    else bl.push(`Maximum ${PEN_CAP}%`);
    bl.push('Ignores that many points of monster resistance; it never lowers resistance below 0');
    lines.push(line(`${name} Penetration`, `${plainNumber(round1(pen.value))}%`, bl));
  }
  return { title: 'Penetration', lines };
}

function offenceSection(c: Computed, model: PlayerModel): SheetSection {
  const b = c.breakdowns;
  const cls = model.cls;
  const level = model.level;
  const power = spellPowerAt(cls, level);
  const added = b.addedSpellDamage!.value;
  const lines: SheetLine[] = [
    line('Spell Power', oneDecimal(power + added), [
      `Level ${level}: ${cls.spellPower.base} + ${cls.spellPower.perLevel} per level above 1 = ${oneDecimal(power)}`,
      ...b.addedSpellDamage!.sources.map((m) => sourceLine(m)),
      'Every skill hit starts here, then scales with its effectiveness',
    ]),
  ];
  const elements: [DamageType, string][] = [['fire', 'Fire'], ['cold', 'Cold'], ['lightning', 'Lightning'], ['void', 'Void']];
  for (const [type, name] of elements) {
    const mods = model.of(...damageStatsFor(type)).filter((m) => m.mode !== 'flat');
    // No Sorceress skill deals void damage yet: only show the line when gear adds void damage.
    if (type === 'void' && !model.of('voidDamage').length) continue;
    const inc = mods.filter((m) => m.mode === 'increased').reduce((s, m) => s + m.value, 0);
    const more = mods.filter((m) => m.mode === 'more').reduce((p, m) => p * (1 + m.value / 100), 1);
    const total = ((1 + inc / 100) * more - 1) * 100;
    lines.push(line(`${name} Skill Damage`, signedPercent(total), mods.length ? mods.map((m) => sourceLine(m)) : ['No modifiers']));
  }
  lines.push(cappedPercentLine('Cast Speed', b.castSpeed!, STAT_CAPS.castSpeed));
  const tags: [StatId, string][] = [['projectileDamage', 'Projectile Damage'], ['areaDamage', 'Area Damage'], ['damageOverTime', 'Damage over Time']];
  for (const [stat, label] of tags) if (hasSources(b[stat])) lines.push(percentStatLine(label, b[stat]!));

  const basicDef = getSkill(BASIC_SKILL);
  const basic = resolveSkill(model, BASIC_SKILL, 1).runtime;
  const critLines = [
    `${basicDef.name} base ${basicDef.critChance}% (each skill has its own base chance)`,
    ...b.critChance!.sources.map((m) => sourceLine(m, m.mode === 'flat' ? '%' : '')),
  ];
  lines.push(line('Critical Strike Chance', percent(basic.critChance, 1), [...critLines, 'Maximum 100%']));
  const critMult = Math.min(STAT_CAPS.critMultiplier, b.critMultiplier!.value);
  lines.push(line('Critical Strike Multiplier', `${formatNumber(round1(critMult))}%`, [
    ...breakdownLines(b.critMultiplier!, { unit: '%' }),
    b.critMultiplier!.value > STAT_CAPS.critMultiplier ? `Capped at ${STAT_CAPS.critMultiplier}% (${formatNumber(round1(b.critMultiplier!.value))}% uncapped)` : `Maximum ${STAT_CAPS.critMultiplier}%`,
  ]));
  if (hasSources(b.projectileSpeed)) lines.push(percentStatLine('Projectile Speed', b.projectileSpeed!));
  if (hasSources(b.area)) lines.push(cappedPercentLine('Area of Effect', b.area!, STAT_CAPS.area));
  if (hasSources(b.duration)) lines.push(percentStatLine('Skill Duration', b.duration!));
  if (hasSources(b.cooldownRecovery)) lines.push(cappedPercentLine('Cooldown Recovery', b.cooldownRecovery!, STAT_CAPS.cooldownRecovery));
  const counts: [StatId, string, number][] = [
    ['extraProjectiles', 'Additional Projectiles', STAT_CAPS.extraProjectiles], ['pierce', 'Additional Pierce', STAT_CAPS.pierce],
    ['extraChains', 'Additional Chains', STAT_CAPS.chains],
  ];
  for (const [stat, label, cap] of counts) {
    if (!hasSources(b[stat])) continue;
    const v = b[stat]!.value;
    lines.push(line(label, formatSigned(Math.min(cap, v)), [...breakdownLines(b[stat]!, { hideBase: true }), v > cap ? `Capped at ${cap} (${formatSigned(v)} uncapped)` : `Maximum ${cap}`]));
  }
  const ailments: [StatId, string][] = [['igniteChance', 'Ignite Chance'], ['chillChance', 'Chill Chance'], ['shockChance', 'Shock Chance']];
  for (const [stat, label] of ailments) {
    if (hasSources(b[stat])) lines.push(line(label, `${formatSigned(round1(b[stat]!.value))}%`, breakdownLines(b[stat]!, { unit: '%', hideBase: true })));
  }
  return { title: 'Offence', lines };
}

/** Headline of a damaging skill: sustained DPS, plus the per-cast total for skills that hit several enemies. */
function skillHeadline(r: ResolvedSkill): string {
  const dps = `${amount(r.sustainedDps ?? 0)} DPS`;
  return isMultiHit(r) && r.perCast !== null ? `${dps} · ${amount(r.perCast)} per cast` : dps;
}

function skillSection(ch: CharacterSave, model: PlayerModel): SheetSection {
  const lines: SheetLine[] = [];
  for (const id of normalizeLoadout(ch)) {
    if (!id) continue;
    const rank = skillRank(ch, id);
    if (rank < 1) continue;
    const r = resolveSkill(model, id, rank);
    const rt = r.runtime;
    if (r.dps !== null) {
      const type = damageTypeName(rt.damageType);
      const bd = [
        `Average hit ${oneDecimal(rt.damage)} (${damageRange(rt.damage)} ${type})`,
        `Spell power ${oneDecimal(r.basePower)} x effectiveness ${r.effectiveness.toFixed(2)}`,
        `${formatNumber(round1(r.increased))}% ${r.increased < 0 ? 'reduced' : 'increased'} ${type} skill damage`,
        ...(r.moreMultiplier !== 1
          ? [`${formatNumber(round1((r.moreMultiplier - 1) * 100))}% ${r.moreMultiplier < 1 ? 'less' : 'more'} damage`]
          : []),
        `Critical strikes: ${percent(rt.critChance, 1)} for ${percent(rt.critMultiplier)}`,
        r.def.shape === 'ward'
          ? `Embers pulse every ${r.def.pulseInterval ?? 0.5} s for ${rt.duration.toFixed(1)} s of every ${r.interval.toFixed(1)} s`
          : `One cast every ${r.interval.toFixed(2)} s`,
        r.def.shape === 'ward'
          ? `Against each adjacent enemy: ${amount(r.dps)} DPS`
          : `Against a single target: ${amount(r.dps)} DPS${isMultiHit(r) ? ' (one hit per cast reaches it)' : ''}`,
        ...estimateLines(r),
        'Estimates; ailments not included',
      ];
      lines.push(line(`${r.def.name} (rank ${rank})`, skillHeadline(r), bd));
    } else if (r.def.shape === 'dash') {
      lines.push(line(`${r.def.name} (rank ${rank})`, `${rt.charges} x ${Math.round(rt.distance)}`, [
        `${rt.charges} charges, each recovers in ${rt.cooldown.toFixed(1)} s`,
        `Blinks up to ${Math.round(rt.distance)} units`,
      ]));
    }
  }
  return { title: 'Skills', lines };
}

/**
 * Luck. Inside a map it leads with the personal luck every one of your drops there rolls with (the
 * map's own luck plus your gear: lootLuck, "Item Quantity in this Map"); the gear-only lines follow,
 * labelled "from Gear" so nobody mistakes a +0% for their luck in the map.
 */
function luckSection(c: Computed, ch: CharacterSave, setup: RunSetup | null): SheetSection {
  const b = c.breakdowns;
  const lines: SheetLine[] = setup ? lootLuckLines(setup, ch).map((l) => line(l.label, l.value, l.breakdown)) : [];
  lines.push(
    line('Item Quantity from Gear', signedPercent(b.itemQuantity!.value - 100), [
      ...breakdownLines(b.itemQuantity!),
      'How many items drop. Never changes rarity.',
      'Adds to the map\'s own Item Quantity, for your drops only.',
    ]),
    line('Item Rarity from Gear', signedPercent(b.itemRarity!.value - 100), [
      ...breakdownLines(b.itemRarity!),
      'How rare dropped items are. Never adds drops.',
      'Adds to the map\'s own Item Rarity, for your drops only.',
    ]),
  );
  return { title: 'Luck', lines };
}

function utilitySection(c: Computed): SheetSection {
  const b = c.breakdowns;
  return {
    title: 'Utility',
    lines: [
      line('Movement Speed', String(Math.round(c.combat.moveSpeed)), breakdownLines(b.moveSpeed!)),
      line('Pickup Radius', String(Math.round(c.combat.pickupRadius)), breakdownLines(b.pickupRadius!)),
    ],
  };
}

function uniqueSection(model: PlayerModel): SheetSection | null {
  if (!model.flags.length) return null;
  return {
    title: 'Unique Effects',
    lines: model.flags.map((f) => line(FLAG_TEXT[f].text, FLAG_TEXT[f].source, [`Granted by ${FLAG_TEXT[f].source}`])),
  };
}

/**
 * Everything the character sheet shows, from an already-built model. `setup` (inside a map) adds the
 * personal luck lines of that map; the model must already carry its player penalties.
 */
export function deriveFromModel(ch: CharacterSave, model: PlayerModel, setup: RunSetup | null = null): DerivedStats {
  const c = computeCombat(model);
  const sections: SheetSection[] = [
    attributeSection(model),
    resourceSection(c),
    defenceSection(c, model),
    offenceSection(c, model),
    penetrationSection(model),
    skillSection(ch, model),
    luckSection(c, ch, setup),
    utilitySection(c),
  ];
  const unique = uniqueSection(model);
  if (unique) sections.push(unique);
  return {
    combat: c.combat,
    attributes: { ...model.attributes },
    itemQuantity: clean(c.breakdowns.itemQuantity!.value - 100),
    itemRarity: clean(c.breakdowns.itemRarity!.value - 100),
    sections: sections.filter((s) => s.lines.length > 0),
    breakdowns: c.breakdowns,
  };
}

/**
 * The character sheet (GameRulesApi.deriveStats). Inside a map pass its `setup`: the map's player
 * penalties (Exhausting, Hexed, Unravelling…) are folded in exactly as playerRuntime(ch, setup) hands
 * them to the sim (so `combat` is identical), and the Luck section adds your personal luck there.
 * `setup` null / omitted = the hideout sheet. DerivedStats.itemQuantity / itemRarity stay gear-only.
 */
export function deriveStats(ch: CharacterSave, setup: RunSetup | null = null): DerivedStats {
  return deriveFromModel(ch, buildPlayerModel(ch, setup ? mapPlayerModifiers(setup.map, setup.monsterLevel, setup.mapTree, treeContextOf(setup)) : [], undefined, setup?.monsterLevel ?? null), setup);
}

/** @deprecated Same as deriveStats(ch, setup) — kept for callers written before deriveStats took a RunSetup. */
export function deriveRunStats(ch: CharacterSave, setup: RunSetup | null): DerivedStats {
  return deriveStats(ch, setup);
}

// ---------------------------------------------------------------------------------------------
// Alt-compare
// ---------------------------------------------------------------------------------------------

interface Snapshot {
  derived: DerivedStats;
  model: PlayerModel;
  ch: CharacterSave;
}

interface CompareMetric {
  label: string;
  value: (s: Snapshot) => number | null;
  fmt: (v: number) => string;
  /** 1 = higher is better, −1 = lower is better (delta is signed so that positive means better). */
  better: 1 | -1;
  /** Display unit scale for the delta (percent metrics report percentage points). */
  scale?: number;
}

const pct1 = (v: number) => percent(v, 1);

const whole = (v: number) => String(Math.round(v));
/** A percent stat resolved against 100 → its total % increase. */
const increaseOf = (stat: StatId) => (s: Snapshot) => (s.derived.breakdowns[stat]?.value ?? 100) - 100;
/** A stat resolved against 0 (flat chances, extra projectiles…). */
const flatOf = (stat: StatId) => (s: Snapshot) => s.derived.breakdowns[stat]?.value ?? 0;

/** Total % more/increased damage for hits of a damage type (as on the sheet's "<Element> Skill Damage"). */
function skillDamageIncrease(model: PlayerModel, type: DamageType): number {
  const mods = model.of(...damageStatsFor(type));
  const inc = mods.filter((m) => m.mode === 'increased').reduce((sum, m) => sum + m.value, 0);
  const more = mods.filter((m) => m.mode === 'more').reduce((p, m) => p * (1 + m.value / 100), 1);
  return ((1 + inc / 100) * more - 1) * 100;
}

const RESOURCE_DEFENCE_METRICS: readonly CompareMetric[] = [
  { label: 'Maximum Life', value: (s) => s.derived.combat.maxLife, fmt: whole, better: 1 },
  { label: 'Maximum Focus', value: (s) => s.derived.combat.maxFocus, fmt: whole, better: 1 },
  { label: 'Life Regeneration', value: (s) => s.derived.combat.lifeRegen, fmt: (v) => `${oneDecimal(v)}/s`, better: 1 },
  { label: 'Focus Regeneration', value: (s) => s.derived.combat.focusRegen, fmt: (v) => `${oneDecimal(v)}/s`, better: 1 },
  { label: 'Armour', value: (s) => s.derived.combat.armor, fmt: whole, better: 1 },
  { label: 'Chance to Evade', value: (s) => s.derived.combat.evasion, fmt: pct1, better: 1, scale: 100 },
  { label: 'Fire Resistance', value: (s) => Math.min(s.derived.combat.maxResist / 100, s.derived.combat.resist.fire), fmt: pct1, better: 1, scale: 100 },
  { label: 'Cold Resistance', value: (s) => Math.min(s.derived.combat.maxResist / 100, s.derived.combat.resist.cold), fmt: pct1, better: 1, scale: 100 },
  { label: 'Lightning Resistance', value: (s) => Math.min(s.derived.combat.maxResist / 100, s.derived.combat.resist.lightning), fmt: pct1, better: 1, scale: 100 },
  { label: 'Void Resistance', value: (s) => Math.min(s.derived.combat.maxResist / 100, s.derived.combat.resist.void), fmt: pct1, better: 1, scale: 100 },
  { label: 'Damage Taken', value: (s) => s.derived.combat.damageTaken, fmt: (v) => percent(v), better: -1, scale: 100 },
];

/** Offence lines: read from the same breakdowns and resolution the sheet shows (a changed number only). */
const OFFENCE_METRICS: readonly CompareMetric[] = [
  {
    label: 'Spell Power',
    value: (s) => spellPowerAt(s.model.cls, s.model.level) + (s.derived.breakdowns.addedSpellDamage?.value ?? 0),
    fmt: oneDecimal,
    better: 1,
  },
  { label: 'Fire Skill Damage', value: (s) => skillDamageIncrease(s.model, 'fire'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Cold Skill Damage', value: (s) => skillDamageIncrease(s.model, 'cold'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Lightning Skill Damage', value: (s) => skillDamageIncrease(s.model, 'lightning'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Cast Speed', value: increaseOf('castSpeed'), fmt: (v) => signedPercent(v), better: 1 },
  {
    label: 'Critical Strike Chance',
    value: (s) => resolveSkill(s.model, BASIC_SKILL, 1).runtime.critChance,
    fmt: pct1,
    better: 1,
    scale: 100,
  },
  { label: 'Critical Strike Multiplier', value: flatOf('critMultiplier'), fmt: (v) => `${formatNumber(round1(v))}%`, better: 1 },
  { label: 'Projectile Speed', value: increaseOf('projectileSpeed'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Area of Effect', value: increaseOf('area'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Skill Duration', value: increaseOf('duration'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Cooldown Recovery', value: increaseOf('cooldownRecovery'), fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Additional Projectiles', value: flatOf('extraProjectiles'), fmt: (v) => formatSigned(Math.round(v)), better: 1 },
  { label: 'Additional Pierce', value: flatOf('pierce'), fmt: (v) => formatSigned(Math.round(v)), better: 1 },
  { label: 'Ignite Chance', value: flatOf('igniteChance'), fmt: (v) => `${formatSigned(round1(v))}%`, better: 1 },
  { label: 'Chill Chance', value: flatOf('chillChance'), fmt: (v) => `${formatSigned(round1(v))}%`, better: 1 },
  { label: 'Shock Chance', value: flatOf('shockChance'), fmt: (v) => `${formatSigned(round1(v))}%`, better: 1 },
];

const UTILITY_METRICS: readonly CompareMetric[] = [
  { label: 'Movement Speed', value: (s) => s.derived.combat.moveSpeed, fmt: whole, better: 1 },
  { label: 'Pickup Radius', value: (s) => s.derived.combat.pickupRadius, fmt: whole, better: 1 },
  { label: 'Life per Kill', value: (s) => s.derived.combat.lifeOnKill, fmt: oneDecimal, better: 1 },
  { label: 'Focus per Kill', value: (s) => s.derived.combat.focusOnKill, fmt: oneDecimal, better: 1 },
  { label: 'Flask Effect', value: (s) => s.derived.combat.flaskEffect, fmt: (v) => percent(v), better: 1, scale: 100 },
  { label: 'Item Quantity', value: (s) => s.derived.itemQuantity, fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Item Rarity', value: (s) => s.derived.itemRarity, fmt: (v) => signedPercent(v), better: 1 },
  { label: 'Strength', value: (s) => s.derived.attributes.str, fmt: (v) => String(v), better: 1 },
  { label: 'Dexterity', value: (s) => s.derived.attributes.dex, fmt: (v) => String(v), better: 1 },
  { label: 'Intelligence', value: (s) => s.derived.attributes.int, fmt: (v) => String(v), better: 1 },
];

/**
 * Per loadout skill: sustained DPS (what the sheet headlines), damage per cast for skills that hit
 * several enemies, cooldown and projectile count.
 */
function skillMetrics(ch: CharacterSave): CompareMetric[] {
  const out: CompareMetric[] = [];
  for (const id of normalizeLoadout(ch)) {
    if (!id) continue;
    const rank = skillRank(ch, id);
    if (rank < 1) continue;
    const name = getSkill(id).name;
    const cache = new WeakMap<Snapshot, ResolvedSkill>();
    const r = (s: Snapshot): ResolvedSkill => {
      let hit = cache.get(s);
      if (!hit) {
        hit = resolveSkill(s.model, id, rank);
        cache.set(s, hit);
      }
      return hit;
    };
    out.push({ label: `${name} DPS`, value: (s) => r(s).sustainedDps, fmt: amount, better: 1 });
    out.push({ label: `${name} Damage per Cast`, value: (s) => (isMultiHit(r(s)) ? r(s).perCast : null), fmt: amount, better: 1 });
    out.push({ label: `${name} Cooldown`, value: (s) => r(s).runtime.cooldown || null, fmt: (v) => `${v.toFixed(1)} s`, better: -1 });
    out.push({ label: `${name} Projectiles`, value: (s) => (r(s).runtime.projectiles > 1 ? r(s).runtime.projectiles : null), fmt: String, better: 1 });
  }
  return out;
}

function snapshot(ch: CharacterSave): Snapshot {
  const model = buildPlayerModel(ch);
  return { derived: deriveFromModel(ch, model), model, ch };
}

/** Slots the item would go into for Alt-compare: the first empty compatible slot, else every occupied one. */
function compareSlots(ch: CharacterSave, item: EquipmentItem): EquipSlot[] {
  const base = findBase(item.baseId);
  if (!base) return [];
  const slots = base.slots as readonly EquipSlot[];
  const empty = slots.find((s) => !ch.equipment[s]);
  return empty ? [empty] : [...slots];
}

/**
 * Stat deltas of equipping `item` for Alt-compare, one entry per slot it would go into. Lines list only
 * what changes; `delta` is signed so that a positive number is an improvement.
 */
export function compareWithEquipped(
  ch: CharacterSave, item: Item,
): { slot: EquipSlot; lines: { label: string; from: string; to: string; delta: number }[] }[] {
  if (item.kind !== 'equipment') return [];
  if (Object.values(ch.equipment).some((e) => e?.uid === item.uid)) return [];
  const before = snapshot(ch);
  const metrics = [...RESOURCE_DEFENCE_METRICS, ...OFFENCE_METRICS, ...skillMetrics(ch), ...UTILITY_METRICS];
  return compareSlots(ch, item).map((slot) => {
    const after = snapshot({ ...ch, equipment: { ...ch.equipment, [slot]: item } });
    const lines: { label: string; from: string; to: string; delta: number }[] = [];
    for (const m of metrics) {
      const a = m.value(before);
      const b = m.value(after);
      if (a === null && b === null) continue;
      const from = a === null ? 'None' : m.fmt(a);
      const to = b === null ? 'None' : m.fmt(b);
      if (from === to) continue;
      const delta = ((b ?? 0) - (a ?? 0)) * (m.scale ?? 1) * m.better;
      lines.push({ label: m.label, from, to, delta: Math.round(delta * 10) / 10 });
    }
    const had = new Set(before.model.flags);
    const has = new Set(after.model.flags);
    for (const f of PLAYER_FLAGS) {
      if (had.has(f) === has.has(f)) continue;
      lines.push({ label: FLAG_TEXT[f].text, from: had.has(f) ? 'Yes' : 'No', to: has.has(f) ? 'Yes' : 'No', delta: has.has(f) ? 1 : -1 });
    }
    return { slot, lines };
  });
}
