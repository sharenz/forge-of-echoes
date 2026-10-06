// Skill rules (GAME_SPEC §4): rank curves, the skill tree (prerequisites, points), the loadout, and
// resolution into SkillRuntimeDef with every player modifier applied — the sim and the skill tooltip
// read the same numbers, so they can never drift.
//
//   damage per hit = (spell power + added spell damage) × effectiveness × (1 + Σincreased%) × Πmore
//     increased/more sources: Spell Damage, the element's damage and (fire/cold/lightning) Elemental Damage
//   cast time = base / cast speed          cooldown = base / cooldown recovery
//   crit chance = (skill base + flat) × (1 + increased%)      crit multiplier = 150% + flat
//   ailment chance = skill base + flat Ignite / Chill / Shock chance (by damage type)
//   projectiles / pierce + gear, projectile speed × %, area × sqrt(1 + area%) on radius, duration × %
//   fan (spread) = the skill's own, or 0.12 rad per extra bolt (at most 0.6) for a single-bolt skill
//
// Estimates (tooltips, character sheet, Alt-compare): single-target DPS (SkillSheet.dps), damage per
// cast if every projectile / strike lands, and the DPS your Focus regeneration sustains on its own.
import type { CharacterSave, StatId } from '../../contracts/items';
import { LOADOUT_SLOTS } from '../../contracts/items';
import type { SkillInfo, SkillSheet, Result } from '../../contracts/game';
import type { DamageType, SkillId } from '../../contracts/content';
import { SKILL_IDS } from '../../contracts/content';
import type { SkillRuntimeDef } from '../../contracts/sim';
import { resolveStat } from '../../core/modifiers';
import { DAMAGE_ROLL, EXTRA_PROJECTILE_FAN, MAX_SKILL_RANK, MORE_CAP, PEN_CAP, SKILLS, STAT_CAPS, findSkill, getSkill } from '../../data/progression';
import type { SkillDef } from '../../data/progression';
import { buildPlayerModel, focusRegenBreakdown, penetrationOf, spellPowerAt } from './model';
import type { PlayerModel } from './model';
import { clamp, fail, oneDecimal, ok, percent, rankValue, resolveModes, seconds } from './util';

// ---------------------------------------------------------------------------------------------
// Content info
// ---------------------------------------------------------------------------------------------

export const SKILL_INFO: Record<SkillId, SkillInfo> = Object.fromEntries(
  SKILL_IDS.map((id) => {
    const s = SKILLS[id];
    const info: SkillInfo = {
      id: s.id,
      name: s.name,
      description: s.description,
      branch: s.branch,
      tier: s.tier,
      prerequisite: s.prerequisite ? { ...s.prerequisite } : null,
      maxRank: s.maxRank,
      tags: [...s.tags],
      damageType: s.damageType,
    };
    return [id, info];
  }),
) as Record<SkillId, SkillInfo>;

/** The innate basic attack: always learned, assignable to any loadout slot. */
export const BASIC_SKILL: SkillId = 'emberLance';

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

const ELEMENTAL: readonly DamageType[] = ['fire', 'cold', 'lightning'];
const AILMENT_STAT: Partial<Record<DamageType, StatId>> = { fire: 'igniteChance', cold: 'chillChance', lightning: 'shockChance' };
const AILMENT_NAME: Partial<Record<DamageType, string>> = { fire: 'Ignite', cold: 'Chill', lightning: 'Shock' };
const DAMAGE_NAME: Record<DamageType, string> = { physical: 'Physical', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', void: 'Void' };

/**
 * Stats whose increased/more modifiers apply to hits of a damage type. `tags` are the skill's tags: Projectile, Area and
 * Duration (damage over time) skills also take Projectile / Area / Damage over Time increases (power-curve.md 3.3).
 * `convertedFrom` lists the types a share of this damage was converted from; their modifiers apply too.
 */
export function damageStatsFor(type: DamageType, tags: readonly string[] = [], convertedFrom: readonly DamageType[] = []): StatId[] {
  const stats: StatId[] = ['spellDamage', `${type}Damage` as StatId];
  if (ELEMENTAL.includes(type)) stats.push('elementalDamage');
  // Converted damage keeps the modifiers of the type it came from (power-curve.md 3.2): the source types' own pools join this one.
  for (const from of convertedFrom) {
    for (const stat of damageStatsFor(from)) if (!stats.includes(stat)) stats.push(stat);
  }
  if (tags.includes('Projectile')) stats.push('projectileDamage');
  if (tags.includes('Area')) stats.push('areaDamage');
  if (tags.includes('Duration')) stats.push('damageOverTime');
  return stats;
}

export interface ResolvedSkill {
  def: SkillDef;
  runtime: SkillRuntimeDef;
  effectiveness: number;
  /** Spell power from level plus added spell damage (before effectiveness). */
  basePower: number;
  added: number;
  increased: number;
  moreMultiplier: number;
  /** Whether the multiplicative pool hit MORE_CAP. */
  moreCapped: boolean;
  /** Penetration of the skill's damage type in percentage points (already capped at PEN_CAP). */
  penetration: number;
  /** Seconds between casts when cast back to back (cast time, or cooldown per charge if longer). */
  interval: number;
  /**
   * Average single-target damage per second (crits and a Nova echo included, ailments excluded) when
   * cast back to back; null if non-damaging. This is SkillSheet.dps.
   */
  dps: number | null;
  /**
   * Distinct hits one cast can land: one per projectile (bolts, flames, waves), per strike of a chain,
   * per ember pulse of a ward (on each adjacent enemy), doubled by a Nova echo. 0 if non-damaging.
   */
  hits: number;
  /** Average damage of one cast if every hit lands (crits included); null if non-damaging. */
  perCast: number | null;
  /** Focus regeneration the estimate assumes (per second). */
  focusRegen: number;
  /** Share of back-to-back casts your Focus regeneration sustains on its own (1 = unlimited). */
  focusSustain: number;
  /** `dps` scaled by `focusSustain`: what the skill keeps up once Focus runs dry. */
  sustainedDps: number | null;
  /** Unique-granted behaviour lines. */
  flagTexts: string[];
}

function clampRank(def: SkillDef, rank: number): number {
  return clamp(Math.floor(Number.isFinite(rank) ? rank : 1), 1, def.maxRank);
}

/** Skills whose one cast can hit several enemies (the per-cast total is worth showing). */
export function isMultiHit(r: ResolvedSkill): boolean {
  return r.hits > 1 && r.def.shape !== 'ward';
}

/** Resolve a skill at a rank against a player model. */
export function resolveSkill(model: PlayerModel, skillId: SkillId, rankIn: number): ResolvedSkill {
  const def = getSkill(skillId);
  const rank = clampRank(def, rankIn);
  const rv = (v: SkillDef['projectiles']) => rankValue(v, rank, def.maxRank);
  const type = skillId === 'cinderWard' && model.flags.includes('coldWard') ? 'cold' : def.runtimeDamageType;

  // Damage
  const effectiveness = rv(def.effectiveness);
  const damageMods = model.of(...damageStatsFor(type, def.tags));
  const increased = damageMods.filter((m) => m.mode === 'increased').reduce((s, m) => s + m.value, 0);
  const moreRaw = damageMods.filter((m) => m.mode === 'more').reduce((p, m) => p * (1 + m.value / 100), 1);
  const moreMultiplier = Math.min(MORE_CAP, moreRaw);
  const penetration = penetrationOf(model, type).value;
  const added = model.breakdown('addedSpellDamage', 0).value;
  const basePower = spellPowerAt(model.cls, model.level) + added;
  const wardFocus = skillId === 'cinderWard' && model.flags.includes('wardFocus');
  const damage = effectiveness > 0 && !wardFocus ? Math.max(0, basePower * effectiveness * Math.max(0, 1 + increased / 100) * moreMultiplier) : 0;

  // Speed & timing
  const castSpeed = clamp(model.breakdown('castSpeed').value / 100, 0.1, 1 + STAT_CAPS.castSpeed / 100);
  const cdr = clamp(model.breakdown('cooldownRecovery').value / 100, 0.1, 1 + STAT_CAPS.cooldownRecovery / 100);
  const castTime = def.castTime > 0 ? def.castTime / castSpeed : 0;
  const cooldown = rv(def.cooldown) > 0 ? rv(def.cooldown) / cdr : 0;

  // Crit & ailments (non-damaging skills never crit)
  const critChance = damage > 0 ? clamp(resolveStat(def.critChance, model.of('critChance')) / 100, 0, 1) : 0;
  const critMultiplier = clamp(model.breakdown('critMultiplier').value / 100, 1, STAT_CAPS.critMultiplier / 100);
  const ailmentStat = AILMENT_STAT[type];
  const ailmentChance = damage > 0 && ((skillId === 'emberLance' && model.flags.includes('lanceIgnites'))
    || (skillId === 'cinderWard' && model.flags.includes('coldWard'))) ? 1 : damage > 0 && ailmentStat
    ? clamp(resolveModes(def.ailmentChance, model.of(ailmentStat)) / 100, 0, 1)
    : 0;

  // Shape
  const projectileSkill = def.shape === 'projectile' || def.shape === 'nova';
  const extraProjectiles = projectileSkill ? clamp(Math.round(model.breakdown('extraProjectiles', 0).value), 0, STAT_CAPS.extraProjectiles) : 0;
  const extraPierce = projectileSkill ? clamp(Math.round(model.breakdown('pierce', 0).value), 0, STAT_CAPS.pierce) : 0;
  const extraChains = def.shape === 'chain' ? Math.max(0, Math.round(model.breakdown('extraChains', 0).value)) : 0;
  const projSpeedMult = Math.max(0.1, model.breakdown('projectileSpeed').value / 100);
  const areaRadiusMult = Math.sqrt(clamp(model.breakdown('area').value / 100, 0.1, 1 + STAT_CAPS.area / 100));
  const durationMult = Math.max(0.1, model.breakdown('duration').value / 100);

  const flags: string[] = [];
  const flagTexts: string[] = [];
  for (const f of def.flagsFrom ?? []) {
    if (model.flags.includes(f.playerFlag)) {
      flags.push(f.skillFlag);
      flagTexts.push(f.text);
    }
  }
  if (damage > 0 && def.shape !== 'ward' && model.flags.includes('closeQuarters'))
    flagTexts.push('Hits deal 25% more damage within 80 units of you, and 25% less beyond 200 units (Victor’s Debt); estimates assume the middle distance');

  const baseProjectiles = rv(def.projectiles);
  const projectiles = projectileSkill ? Math.max(1, baseProjectiles + extraProjectiles) : baseProjectiles;
  const runtime: SkillRuntimeDef = {
    id: def.id,
    rank,
    focusCost: def.focusCost,
    castTime,
    cooldown,
    charges: Math.max(1, Math.floor(rv(def.charges))),
    damage,
    damageType: type,
    critChance,
    critMultiplier,
    ailmentChance,
    projectiles,
    pierce: projectileSkill ? rv(def.pierce) + extraPierce : rv(def.pierce),
    projectileSpeed: projectileSkill ? def.projectileSpeed * projSpeedMult : def.projectileSpeed,
    range: def.areaScales === 'range' ? def.range * areaRadiusMult : def.range,
    spread: flags.includes('fan') ? Math.PI * 5 / 6 : flags.includes('circle') ? Math.PI * 2 * (projectiles - 1) / projectiles : fanSpread(def, projectiles),
    radius: def.areaScales === 'radius' ? def.radius * areaRadiusMult : def.radius,
    duration: rv(def.duration) * (rv(def.duration) > 0 ? durationMult : 1),
    chains: def.shape === 'chain' ? Math.min(STAT_CAPS.chains, Math.max(0, Math.floor(rv(def.chains)) + extraChains)) : Math.max(0, Math.floor(rv(def.chains))),
    distance: rv(def.distance),
    damageReduction: Math.min(def.damageReductionCap ?? 1, rv(def.damageReduction)),
    flags,
  };

  // Estimates. A ward's cycle is its cooldown (it pulses on each adjacent enemy while it lasts);
  // everything else can be cast again after its cast time, or after its cooldown per charge.
  const pulse = def.pulseInterval ?? 0.5;
  const interval = def.shape === 'ward'
    ? Math.max(runtime.cooldown, runtime.castTime)
    : Math.max(runtime.castTime, runtime.cooldown / runtime.charges);
  const echo = flags.includes('echo') ? 2 : 1;
  const focusRegen = Math.max(0, focusRegenBreakdown(model).value);
  const focusSustain = def.focusCost > 0 && interval > 0 ? Math.min(1, (focusRegen * interval) / def.focusCost) : 1;
  let dps: number | null = null;
  let perCast: number | null = null;
  let hits = 0;
  if (damage > 0) {
    const critFactor = 1 + critChance * (critMultiplier - 1);
    const hit = damage * critFactor;
    if (def.shape === 'ward') {
      hits = Math.max(1, Math.floor(runtime.duration / pulse + 1e-9));
      perCast = hit * hits;
      const uptime = interval > 0 ? Math.min(1, runtime.duration / interval) : 1;
      dps = (hit * uptime) / pulse;
    } else {
      hits = (def.shape === 'chain' ? runtime.chains + 1 : Math.max(1, runtime.projectiles)) * echo;
      perCast = hit * hits;
      dps = interval > 0 ? (hit * echo) / interval : null;
    }
  }
  const sustainedDps = dps === null ? null : dps * focusSustain;
  return {
    def, runtime, effectiveness, basePower, added, increased, moreMultiplier, moreCapped: moreRaw > MORE_CAP, penetration, interval, dps, hits, perCast, focusRegen,
    focusSustain, sustainedDps, flagTexts,
  };
}

/**
 * Fan angle of a projectile skill: its own spread, or — for a single-bolt skill that gained extra
 * projectiles — the extra-projectile fan. Rings (Nova) have no fan.
 */
function fanSpread(def: SkillDef, projectiles: number): number {
  if (def.shape !== 'projectile') return def.spread;
  if (def.spread > 0) return def.spread;
  return projectiles > 1 ? Math.min(EXTRA_PROJECTILE_FAN.max, EXTRA_PROJECTILE_FAN.perProjectile * (projectiles - 1)) : 0;
}

/** Current rank of a skill (Ember Lance is always at least 1). */
export function skillRank(ch: Pick<CharacterSave, 'skillRanks'>, id: SkillId): number {
  const r = Math.max(0, Math.floor(ch.skillRanks?.[id] ?? 0));
  return id === BASIC_SKILL ? Math.max(1, r) : r;
}

/** Runtime defs of the basic attack and every ranked skill. */
export function playerSkills(ch: CharacterSave, model: PlayerModel): SkillRuntimeDef[] {
  const out: SkillRuntimeDef[] = [];
  for (const id of SKILL_IDS) {
    const rank = skillRank(ch, id);
    if (rank >= 1) out.push(resolveSkill(model, id, rank).runtime);
  }
  return out;
}

/** Exactly LOADOUT_SLOTS entries: any learned skill in any slot, without duplicates. */
export function normalizeLoadout(ch: Pick<CharacterSave, 'loadout' | 'skillRanks'>): (SkillId | null)[] {
  const out: (SkillId | null)[] = [];
  const used = new Set<SkillId>();
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const id = ch.loadout?.[i] ?? null;
    if (id && findSkill(id) && !used.has(id) && skillRank(ch, id) >= 1) {
      out.push(id);
      used.add(id);
    } else out.push(null);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The tree & loadout
// ---------------------------------------------------------------------------------------------

export function canRankUpSkill(ch: CharacterSave, skillId: SkillId): { ok: boolean; reason?: string } {
  const def = findSkill(skillId);
  if (!def) return { ok: false, reason: 'Unknown skill.' };
  const rank = skillRank(ch, skillId);
  if (rank >= def.maxRank) return { ok: false, reason: `${def.name} is at its maximum rank (${def.maxRank}).` };
  if (def.prerequisite) {
    const pre = getSkill(def.prerequisite.skillId);
    const have = skillRank(ch, pre.id);
    if (have < def.prerequisite.rank) {
      return { ok: false, reason: `Requires ${pre.name} rank ${def.prerequisite.rank} (currently ${have}).` };
    }
  }
  if ((ch.unspentSkillPoints ?? 0) < 1) return { ok: false, reason: 'No skill points left. You gain one every level.' };
  return { ok: true };
}

/**
 * Spend one skill point on a skill. A newly learned skill is bound to the first free loadout key
 * so it is usable right away.
 */
export function rankUpSkill(ch: CharacterSave, skillId: SkillId): Result<CharacterSave> {
  const check = canRankUpSkill(ch, skillId);
  if (!check.ok) return fail(check.reason ?? 'That skill cannot be ranked up.');
  const before = skillRank(ch, skillId);
  const skillRanks = { ...ch.skillRanks, [skillId]: before + 1 };
  let next: CharacterSave = { ...ch, skillRanks, unspentSkillPoints: ch.unspentSkillPoints - 1 };
  if (before === 0) {
    const loadout = normalizeLoadout(next);
    if (!loadout.includes(skillId)) {
      const free = loadout.findIndex((s) => s === null);
      if (free >= 0) loadout[free] = skillId;
    }
    next = { ...next, loadout };
  }
  return ok(next);
}

/**
 * Any learned skill can occupy any slot. Binding it to a new slot moves it there, swapping with
 * the displaced skill. null clears any slot, including the mouse buttons.
 */
export function setLoadoutSlot(ch: CharacterSave, slot: number, skillId: SkillId | null): Result<CharacterSave> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= LOADOUT_SLOTS) return fail('That loadout slot does not exist.');
  const loadout = normalizeLoadout(ch);
  if (skillId === null) {
    loadout[slot] = null;
    return ok({ ...ch, loadout });
  }
  const def = findSkill(skillId);
  if (!def) return fail('Unknown skill.');
  if (skillRank(ch, skillId) < 1) return fail(`Learn ${def.name} first: spend a skill point on it.`);
  const from = loadout.indexOf(skillId);
  if (from === slot) return ok({ ...ch, loadout });
  const displaced = loadout[slot];
  loadout[slot] = skillId;
  if (from >= 0) loadout[from] = displaced;
  return ok({ ...ch, loadout });
}

// ---------------------------------------------------------------------------------------------
// Skill sheet (tooltip)
// ---------------------------------------------------------------------------------------------

/** The hit roll around an average: "5.2–7.8" below 10 average, whole numbers above. */
export function damageRange(avg: number): string {
  const lo = avg * DAMAGE_ROLL.min;
  const hi = avg * DAMAGE_ROLL.max;
  if (avg < 10) return `${lo.toFixed(1)}–${hi.toFixed(1)}`;
  return `${Math.round(lo)}–${Math.round(hi)}`;
}

/** "Fire", "Cold"… */
export function damageTypeName(type: DamageType): string {
  return DAMAGE_NAME[type];
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : noun.endsWith('s') ? '' : 's'}`;
}

function degrees(rad: number): string {
  return `${Math.round((rad * 180) / Math.PI)}°`;
}

function pierceText(pierce: number, all: boolean): string | null {
  if (all) return 'Pierces every enemy in its path';
  if (pierce <= 0) return null;
  return `Pierces ${pierce} ${pierce === 1 ? 'enemy' : 'enemies'}`;
}

function critText(rt: SkillRuntimeDef): string {
  return `${percent(rt.critChance, 1)} critical strike chance (${percent(rt.critMultiplier)} multiplier)`;
}

/** Tooltip lines for a resolved skill. */
export function skillLines(r: ResolvedSkill): string[] {
  const { def, runtime: rt } = r;
  const lines: string[] = [];
  const type = DAMAGE_NAME[rt.damageType];
  const noun = def.projectileNoun ?? 'projectile';
  const pierceAll = !!def.pierceAll || rt.flags.includes('pierceAll');
  switch (def.shape) {
    case 'projectile':
      lines.push(`Deals ${damageRange(rt.damage)} ${type} damage`);
      lines.push(rt.flags.includes('circle') ? `Fires ${plural(rt.projectiles, noun)} in a full circle` : rt.projectiles > 1
        ? `Fires ${plural(rt.projectiles, noun)} in a ${degrees(rt.spread)} fan`
        : `Fires ${plural(1, noun)} toward the cursor`);
      if (def.radius > 0) lines.push(`Each ${noun} is ${Math.round(rt.radius * 2)} units wide`);
      break;
    case 'nova':
      lines.push(`Deals ${damageRange(rt.damage)} ${type} damage`);
      lines.push(rt.flags.includes('fan')
        ? `Fires ${plural(rt.projectiles, noun)} in a 150° fan reaching ${Math.round(rt.range)} units`
        : `Bursts ${plural(rt.projectiles, noun)} outward in a ring reaching ${Math.round(rt.range)} units`);
      break;
    case 'chain':
      lines.push(`Deals ${damageRange(rt.damage)} ${type} damage`);
      lines.push(`Strikes the enemy nearest the cursor within ${Math.round(rt.range)} units, then chains ${plural(rt.chains, 'time')} (jump range ${Math.round(rt.radius)})`);
      break;
    case 'dash':
      lines.push(`Blinks up to ${Math.round(rt.distance)} units toward the cursor`);
      lines.push('Invulnerable for 0.2 seconds');
      break;
    case 'ward':
      lines.push(`You take ${percent(rt.damageReduction)} less damage for ${seconds(rt.duration)}${def.damageReductionCap ? ` (at most ${percent(def.damageReductionCap)})` : ''}`);
      if (rt.damage > 0) {
        lines.push(`Embers deal ${damageRange(rt.damage)} ${type} damage to enemies within ${Math.round(rt.radius)} units every ${seconds(def.pulseInterval ?? 0.5)}`);
      }
      break;
  }
  const pierce = def.shape === 'projectile' || def.shape === 'nova' ? pierceText(rt.pierce, pierceAll) : null;
  if (pierce) lines.push(pierce);
  if ((def.shape === 'projectile' || def.shape === 'nova') && rt.projectileSpeed > 0 && def.shape !== 'nova') {
    lines.push(`Range ${Math.round(rt.range)} · projectile speed ${Math.round(rt.projectileSpeed)}`);
  }
  if (rt.damage > 0) lines.push(critText(rt));
  const ailment = AILMENT_NAME[rt.damageType];
  if (ailment && rt.ailmentChance > 0) lines.push(`${percent(rt.ailmentChance)} chance to ${ailment}`);
  lines.push(rt.castTime > 0 ? `Cast time ${seconds(rt.castTime)}` : 'Instant');
  if (rt.cooldown > 0) {
    lines.push(rt.charges > 1
      ? `${rt.charges} charges, each recovers in ${seconds(rt.cooldown)}`
      : `Cooldown ${seconds(rt.cooldown)}`);
  }
  lines.push(rt.focusCost > 0 ? `Costs ${rt.focusCost} Focus` : 'No Focus cost');
  if (rt.damage > 0 && r.penetration > 0) {
    lines.push(`Penetrates ${plainPercent(r.penetration)}% ${type} resistance (${plainPercent(r.penetration)} of ${PEN_CAP} maximum)`);
  }
  lines.push(...estimateLines(r));
  lines.push(...r.flagTexts);
  return lines;
}

function plainPercent(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** Whole numbers from 10 up, one decimal below. */
export function amount(v: number): string {
  return v >= 10 ? String(Math.round(v)) : oneDecimal(v);
}

/** What one cast adds up to, and what your Focus regeneration sustains (tooltip and sheet text). */
export function estimateLines(r: ResolvedSkill): string[] {
  const out: string[] = [];
  if (r.perCast !== null && isMultiHit(r)) {
    const noun = r.def.shape === 'chain' ? 'strike' : (r.def.projectileNoun ?? 'projectile');
    out.push(`${amount(r.perCast)} damage per cast if all ${r.hits} ${noun}${r.hits === 1 ? '' : 's'} hit`);
  } else if (r.perCast !== null && r.def.shape === 'ward') {
    out.push(`${amount(r.perCast)} damage to each adjacent enemy per cast (${plural(r.hits, 'pulse')})`);
  }
  if (r.focusSustain < 1 && r.dps !== null && r.sustainedDps !== null) {
    out.push(`Your ${oneDecimal(r.focusRegen)} Focus per second sustains ${percent(r.focusSustain)} of back-to-back casts: `
      + `${amount(r.sustainedDps)} of ${amount(r.dps)} DPS`);
  }
  return out;
}

interface Metric {
  label: string;
  get: (rt: SkillRuntimeDef) => number;
  fmt: (v: number) => string;
  applies: (def: SkillDef) => boolean;
}

const METRICS: readonly Metric[] = [
  { label: 'Damage', get: (rt) => rt.damage, fmt: (v) => damageRange(v), applies: (d) => d.effectiveness !== 0 },
  { label: 'Projectiles', get: (rt) => rt.projectiles, fmt: String, applies: (d) => d.shape === 'projectile' || d.shape === 'nova' },
  { label: 'Pierce', get: (rt) => rt.pierce, fmt: String, applies: (d) => (d.shape === 'projectile' || d.shape === 'nova') && !d.pierceAll },
  { label: 'Chains', get: (rt) => rt.chains, fmt: String, applies: (d) => d.shape === 'chain' },
  { label: 'Charges', get: (rt) => rt.charges, fmt: String, applies: (d) => d.charges !== 1 },
  { label: 'Blink distance', get: (rt) => rt.distance, fmt: (v) => String(Math.round(v)), applies: (d) => d.shape === 'dash' },
  { label: 'Duration', get: (rt) => rt.duration, fmt: seconds, applies: (d) => d.shape === 'ward' },
  { label: 'Damage reduction', get: (rt) => rt.damageReduction, fmt: (v) => percent(v), applies: (d) => d.shape === 'ward' },
  { label: 'Cooldown', get: (rt) => rt.cooldown, fmt: seconds, applies: (d) => d.cooldown !== 0 },
];

/** What the next rank changes: "Damage 5.2–7.8 to 5.6–8.4", "Projectiles 12 to 13". */
export function nextRankLines(model: PlayerModel, skillId: SkillId, rank: number): string[] {
  const def = getSkill(skillId);
  if (rank >= def.maxRank) return [];
  if (rank <= 0) return [`Spend a skill point to learn ${def.name} at rank 1.`];
  const now = resolveSkill(model, skillId, rank).runtime;
  const next = resolveSkill(model, skillId, rank + 1).runtime;
  const out: string[] = [];
  for (const m of METRICS) {
    if (!m.applies(def)) continue;
    const a = m.fmt(m.get(now));
    const b = m.fmt(m.get(next));
    if (a !== b) out.push(`${m.label} ${a} to ${b}`);
  }
  return out.length ? out : ['Small improvements to its numbers.'];
}

/** Full skill sheet for tooltips. `rank` defaults to the current rank (unlearned skills show rank 1). */
export function skillSheetFor(ch: CharacterSave, skillId: SkillId, rank?: number, model = buildPlayerModel(ch)): SkillSheet {
  const def = getSkill(skillId);
  const current = skillRank(ch, skillId);
  const requested = rank !== undefined && Number.isFinite(rank) ? Math.floor(rank) : current;
  const shown = clamp(requested, 0, def.maxRank);
  const resolved = resolveSkill(model, skillId, Math.max(1, shown));
  return {
    skillId,
    rank: shown,
    runtime: resolved.runtime,
    lines: skillLines(resolved),
    nextRankLines: nextRankLines(model, skillId, shown),
    dps: resolved.dps,
  };
}

export { MAX_SKILL_RANK };
