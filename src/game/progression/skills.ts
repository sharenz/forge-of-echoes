// Skill rules (GAME_SPEC §4, docs/power-rework/skills.md): rank curves, unlocks by level, skill points, augments (tiers, slots,
// exclusions), respec, loadout and presets, and resolution into SkillRuntimeDef with every player modifier and picked augment
// applied — the sim and the skill tooltip read the same numbers, so they can never drift.
//
//   damage per hit = (spell power + added spell damage) × effectiveness × (1 + Σincreased%) × min(MORE_CAP, Πmore)
//     increased/more sources: Spell Damage, the element's damage and (fire/cold/lightning) Elemental Damage;
//     an augment's "x% more / less" joins the more pool
//   cast time = base / cast speed          cooldown = base / cooldown recovery
//   crit chance = (skill base + flat) × (1 + increased%)      crit multiplier = 150% + flat
//   ailment chance = skill base + flat Ignite / Chill / Shock chance (by damage type)
//   projectiles / pierce + gear, projectile speed × %, area × sqrt(1 + area%) on radius, duration × %
//   fan (spread) = the skill's own, or 0.12 rad per extra bolt (at most 0.6) for a single-bolt skill
//   augments change the skill's base numbers first (set, then add, then scale), then player modifiers apply
//
// Estimates (tooltips, character sheet, Alt-compare): single-target DPS (SkillSheet.dps), damage per
// cast if every projectile / strike lands, and the DPS your Focus regeneration sustains on its own.
import type { CharacterSave, LoadoutPreset, StatId } from '../../contracts/items';
import { LOADOUT_PRESETS, LOADOUT_SLOTS } from '../../contracts/items';
import type { RespecPrice, SkillInfo, SkillSheet, Result } from '../../contracts/game';
import type { DamageType, SkillId } from '../../contracts/content';
import { SKILL_IDS } from '../../contracts/content';
import type { AugmentRuntime, SkillRuntimeDef } from '../../contracts/sim';
import { resolveStat } from '../../core/modifiers';
import {
  AUGMENT_RULES, DAMAGE_ROLL, DECAY, EXTRA_PROJECTILE_FAN, MAX_SKILL_RANK, MORE_CAP, PEN_CAP, RESPEC, SKILLS, SKILL_POINTS, SKILL_TIMING,
  STAT_CAPS, augmentAvailable, findSkill, getSkill,
} from '../../data/progression';
import type { AugmentDef, AugmentEffect, AugmentStat, SkillDef, TuneKey } from '../../data/progression';
import { buildPlayerModel, focusRegenBreakdown, penetrationOf, spellPowerAt } from './model';
import type { PlayerModel } from './model';
import { spendCurrency } from './merchant';
import { clamp, fail, oneDecimal, ok, percent, rankValue, resolveModes, seconds } from './util';
import { roster2Dot, roster2HitCounts, roster2Lines, roster2Runtimes } from './skills-roster2';

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
      element: s.element,
      unlockLevel: s.unlockLevel,
      available: s.available,
      augments: s.augments.map((a) => ({ ...a, excludes: [...a.excludes] })),
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
/** The Sunken Sun's fan (a unique-granted shape) and the default echo delay. */
const UNIQUE_FAN_ARC = Math.PI * 5 / 6;

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
   * Average single-target damage per second (crits and echoes included, ailments excluded) when
   * cast back to back; null if non-damaging. This is SkillSheet.dps.
   */
  dps: number | null;
  /**
   * Distinct hits one cast can land: one per projectile (bolts, flames, waves), per strike of a chain,
   * per ember pulse of a ward (on each adjacent enemy), plus an echo's. 0 if non-damaging.
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
  /** The picked augments that took effect (available ones, in tree order). */
  augments: AugmentDef[];
  /** Echo damage as a share of the hit (0 = no echo). */
  echo: number;
  /**
   * Hits of one cast that can land on a single enemy (the DPS estimate's count): 1 for most skills, every shard of a Frost Orb, the
   * expected share of Storm Call's scattered strikes on an enemy at the cursor.
   */
  singleTargetHits: number;
}

function clampRank(def: SkillDef, rank: number): number {
  return clamp(Math.floor(Number.isFinite(rank) ? rank : 1), 1, def.maxRank);
}

/** Skills whose one cast can hit several enemies (the per-cast total is worth showing). */
export function isMultiHit(r: ResolvedSkill): boolean {
  return r.hits > 1 && r.def.shape !== 'ward';
}

/** A base number with the augments' set, add and scale effects applied (in that order). */
function augmented(effects: readonly AugmentEffect[], stat: AugmentStat, base: number): number {
  let v = base;
  for (const e of effects) if (e.k === 'set' && e.stat === stat) v = e.value;
  for (const e of effects) if (e.k === 'add' && e.stat === stat) v += e.value;
  for (const e of effects) if (e.k === 'scale' && e.stat === stat) v *= 1 + e.pct / 100;
  return v;
}

/** The skill's augment defs among `ids` (unknown and not-yet-available ones are ignored), in tree order. */
export function pickedAugments(def: SkillDef, ids: readonly string[] | undefined): AugmentDef[] {
  if (!ids?.length) return [];
  return def.augmentDefs.filter((a) => ids.includes(a.id) && augmentAvailable(a));
}

/** Resolve a skill at a rank against a player model, with the picked augments (ids of the skill's augment tree). */
export function resolveSkill(model: PlayerModel, skillId: SkillId, rankIn: number, augmentIds: readonly string[] = []): ResolvedSkill {
  const def = getSkill(skillId);
  const rank = clampRank(def, rankIn);
  const rv = (v: SkillDef['projectiles']) => rankValue(v, rank, def.maxRank);
  const augments = pickedAugments(def, augmentIds);
  const effects = augments.flatMap((a) => a.effects);

  // Behaviour flags: item-granted (unique) ones with their text, plus the ones picked augments add.
  const flags: string[] = [];
  const flagTexts: string[] = [];
  for (const f of def.flagsFrom ?? []) {
    if (model.flags.includes(f.playerFlag)) {
      flags.push(f.skillFlag);
      flagTexts.push(f.text);
    }
  }
  for (const e of effects) if (e.k === 'flag' && !flags.includes(e.flag)) flags.push(e.flag);
  const shapeEffect = effects.find((e): e is Extract<AugmentEffect, { k: 'shape' }> => e.k === 'shape');
  if (shapeEffect?.shape === 'circle' && !flags.includes('circle')) flags.push('circle');

  const type = skillId === 'cinderWard' && flags.includes('cold') ? 'cold' : def.runtimeDamageType;

  // Damage
  const effectiveness = rv(def.effectiveness);
  const damageMods = model.of(...damageStatsFor(type, def.tags));
  const increased = damageMods.filter((m) => m.mode === 'increased').reduce((s, m) => s + m.value, 0);
  let moreRaw = damageMods.filter((m) => m.mode === 'more').reduce((p, m) => p * (1 + m.value / 100), 1);
  for (const e of effects) if (e.k === 'more') moreRaw *= 1 + e.pct / 100;
  const moreMultiplier = Math.min(MORE_CAP, moreRaw);
  const penetration = penetrationOf(model, type).value;
  const added = model.breakdown('addedSpellDamage', 0).value;
  const basePower = spellPowerAt(model.cls, model.level) + added;
  const wardFocus = skillId === 'cinderWard' && flags.includes('restoreFocus');
  const damage = effectiveness > 0 && !wardFocus ? Math.max(0, basePower * effectiveness * Math.max(0, 1 + increased / 100) * moreMultiplier) : 0;

  // Speed & timing
  const castSpeed = clamp(model.breakdown('castSpeed').value / 100, 0.1, 1 + STAT_CAPS.castSpeed / 100);
  const cdr = clamp(model.breakdown('cooldownRecovery').value / 100, 0.1, 1 + STAT_CAPS.cooldownRecovery / 100);
  const baseCast = augmented(effects, 'castTime', def.castTime);
  const castTime = baseCast > 0 ? baseCast / castSpeed : 0;
  const baseCooldown = augmented(effects, 'cooldown', rv(def.cooldown));
  const cooldown = baseCooldown > 0 ? baseCooldown / cdr : 0;

  // Crit & ailments (non-damaging skills never crit)
  const critChance = damage > 0 ? clamp(resolveStat(def.critChance, model.of('critChance')) / 100, 0, 1) : 0;
  const critMultiplier = clamp(model.breakdown('critMultiplier').value / 100, 1, STAT_CAPS.critMultiplier / 100);
  const ailmentStat = AILMENT_STAT[type];
  const alwaysAilment = (skillId === 'emberLance' && flags.includes('alwaysIgnite'))
    || (skillId === 'cinderWard' && flags.includes('cold')) || effects.some((e) => e.k === 'alwaysAilment');
  const ailmentChance = damage > 0 && alwaysAilment ? 1 : damage > 0 && ailmentStat
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

  if (damage > 0 && def.shape !== 'ward' && model.flags.includes('closeQuarters'))
    flagTexts.push('Hits deal 25% more damage within 80 units of you, and 25% less beyond 200 units (Victor’s Debt); estimates assume the middle distance');

  let baseProjectiles = rv(def.projectiles);
  for (const e of effects) if (e.k === 'count') baseProjectiles = (baseProjectiles + (e.add ?? 0)) * (e.mult ?? 1);
  const projectiles = projectileSkill ? Math.max(1, baseProjectiles + extraProjectiles) : baseProjectiles;
  const augPierce = effects.reduce((s, e) => s + (e.k === 'pierce' ? e.add : 0), 0);
  const augChains = effects.reduce((s, e) => s + (e.k === 'chain' ? e.add : 0), 0);
  const baseChains = Math.max(0, Math.floor(rv(def.chains)) + augChains);
  const range = augmented(effects, 'range', def.range);
  const radius = augmented(effects, 'radius', rv(def.radius));
  const baseDuration = augmented(effects, 'duration', rv(def.duration));

  // Behaviour primitives for the executor: an augment fan, the echo (the better of item-granted and picked), invulnerability.
  const runtimeAugments: AugmentRuntime[] = [];
  const fanArc = shapeEffect?.shape === 'fan' ? (shapeEffect.arc ?? UNIQUE_FAN_ARC) : null;
  if (fanArc !== null) runtimeAugments.push({ p: 'fan', arc: fanArc });
  const echoEffect = effects.find((e): e is Extract<AugmentEffect, { k: 'echo' }> => e.k === 'echo');
  const echo = Math.max(flags.includes('echo') ? 1 : 0, echoEffect ? echoEffect.damage / 100 : 0);
  if (echoEffect) runtimeAugments.push({ p: 'echo', delay: echoEffect.delay, damage: echo });
  for (const e of effects) if (e.k === 'invulnerable') runtimeAugments.push({ p: 'invulnerable', seconds: e.seconds });
  const runtimeRadius = def.areaScales === 'radius' ? radius * areaRadiusMult : radius;
  const runtimeDuration = baseDuration * (baseDuration > 0 ? durationMult : 1);
  runtimeAugments.push(...primitiveRuntimes(def, effects, damage, effectiveness, runtimeRadius, runtimeDuration));
  // Roster batch 2 (SK3): zones, barrier, aegis, echo buff; `power` is the damage per point of effectiveness.
  runtimeAugments.push(...roster2Runtimes(def, effects, rank, Math.max(0, basePower * Math.max(0, 1 + increased / 100) * moreMultiplier)));

  const spread = fanArc !== null ? fanArc
    : flags.includes('fan') ? UNIQUE_FAN_ARC
      : flags.includes('circle') ? Math.PI * 2 * (projectiles - 1) / projectiles
        : fanSpread(def, augmented(effects, 'spread', def.spread), projectiles);

  const runtime: SkillRuntimeDef = {
    id: def.id,
    rank,
    focusCost: Math.max(0, augmented(effects, 'focusCost', def.focusCost)),
    castTime,
    cooldown,
    charges: Math.max(1, Math.floor(augmented(effects, 'charges', rv(def.charges)))),
    damage,
    damageType: type,
    critChance,
    critMultiplier,
    ailmentChance,
    projectiles,
    pierce: projectileSkill ? rv(def.pierce) + augPierce + extraPierce : rv(def.pierce) + augPierce,
    projectileSpeed: projectileSkill ? def.projectileSpeed * projSpeedMult : def.projectileSpeed,
    range: def.areaScales === 'range' ? range * areaRadiusMult : range,
    spread,
    radius: runtimeRadius,
    duration: runtimeDuration,
    chains: def.shape === 'chain' ? Math.min(STAT_CAPS.chains, baseChains + extraChains) : baseChains,
    distance: augmented(effects, 'distance', rv(def.distance)),
    damageReduction: Math.min(augmented(effects, 'damageReductionCap', def.damageReductionCap ?? 1), rv(def.damageReduction)),
    flags,
    ...(runtimeAugments.length ? { augments: runtimeAugments } : {}),
  };

  // Estimates. A ward's cycle is its cooldown (it pulses on each adjacent enemy while it lasts);
  // everything else can be cast again after its cast time, or after its cooldown per charge.
  const pulse = def.pulseInterval ?? 0.5;
  const interval = def.shape === 'ward'
    ? Math.max(runtime.cooldown, runtime.castTime)
    : Math.max(runtime.castTime, runtime.cooldown / runtime.charges);
  const focusRegen = Math.max(0, focusRegenBreakdown(model).value);
  const focusSustain = runtime.focusCost > 0 && interval > 0 ? Math.min(1, (focusRegen * interval) / runtime.focusCost) : 1;
  let dps: number | null = null;
  let perCast: number | null = null;
  let hits = 0;
  const { once: rosterOnce, single: singleTargetHits } = hitCounts(def, runtime);
  if (damage > 0) {
    const critFactor = 1 + critChance * (critMultiplier - 1);
    const hit = damage * critFactor;
    if (def.shape === 'ward') {
      hits = Math.max(1, Math.floor(runtime.duration / pulse + 1e-9));
      perCast = hit * hits;
      const uptime = interval > 0 ? Math.min(1, runtime.duration / interval) : 1;
      dps = (hit * uptime) / pulse;
    } else {
      const once = rosterOnce;
      hits = once * (echo > 0 ? 2 : 1);
      perCast = hit * once * (1 + echo);
      dps = interval > 0 ? (hit * singleTargetHits * (1 + echo)) / interval : null;
      // Damage over time a cast leaves behind: burning ground (non-stacking: one tick per interval on an enemy standing in it,
      // while the ground lasts) and Decay (one stack per hit, up to DECAY.maxStacks running at once).
      const ground = runtime.augments?.find((a) => a.p === 'ground');
      if (ground && ground.interval > 0) {
        perCast += ground.damage * Math.floor(ground.duration / ground.interval + 1e-9);
        if (dps !== null) dps += (ground.damage / ground.interval) * Math.min(1, ground.duration / interval);
      }
      const decay = runtime.augments?.find((a) => a.p === 'decay');
      if (decay) {
        perCast += damage * decay.share * once;
        if (dps !== null) dps += (Math.min(DECAY.maxStacks, DECAY.duration / interval) * damage * decay.share) / DECAY.duration;
      }
      const dot = roster2Dot(def, runtime, interval);
      if (dot) {
        perCast += dot.perCast;
        if (dps !== null) dps += dot.dps;
      }
    }
  }
  const sustainedDps = dps === null ? null : dps * focusSustain;
  return {
    def, runtime, effectiveness, basePower, added, increased, moreMultiplier, moreCapped: moreRaw > MORE_CAP, penetration, interval, dps, hits, perCast, focusRegen,
    focusSustain, sustainedDps, flagTexts, augments, echo, singleTargetHits,
  };
}

/** Sum of the picked augments' `tune` effects on one behaviour number. */
function tuned(effects: readonly AugmentEffect[], key: TuneKey): number {
  return effects.reduce((s, e) => s + (e.k === 'tune' && e.key === key ? e.add : 0), 0);
}

/**
 * The skill's own behaviour primitives (SkillDef.primitives, raised by `tune` augments) as executor primitives: burning ground,
 * Decay, bounces, a stride buff, a restore.
 */
function primitiveRuntimes(
  def: SkillDef, effects: readonly AugmentEffect[], damage: number, effectiveness: number, radius: number, duration: number,
): AugmentRuntime[] {
  const prim = def.primitives ?? {};
  const out: AugmentRuntime[] = [];
  if (prim.ground && effectiveness > 0 && damage > 0) {
    const eff = prim.ground.effectiveness + tuned(effects, 'groundEffectiveness');
    out.push({
      p: 'ground', damage: (damage * eff) / effectiveness, interval: prim.ground.interval, duration,
      radius: radius * (1 + tuned(effects, 'groundRadiusPct') / 100),
    });
  }
  if (prim.decay && damage > 0) out.push({ p: 'decay', share: prim.decay.share * (1 + tuned(effects, 'decayPct') / 100) });
  const bounces = Math.max(0, Math.floor((prim.bounces ?? 0) + tuned(effects, 'bounces')));
  if (bounces > 0) out.push({ p: 'bounce', count: bounces });
  if (prim.stride) out.push({ p: 'stride', speed: prim.stride.speed, evasion: prim.stride.evasion + tuned(effects, 'strideEvasion') });
  if (prim.restore) {
    out.push({ p: 'restore', focus: prim.restore.focus + tuned(effects, 'restoreFocus'), life: prim.restore.life + tuned(effects, 'restoreLife') });
  }
  return out;
}

/** Storm Call's estimate: how far a strike's centre may land from an enemy at the cursor and still reach it (a body's radius). */
const STRIKE_BODY = 12;

/**
 * Hits of one cast if every one lands (`once`), and how many of them one enemy takes (`single`, the DPS estimate): one per
 * projectile / strike / spike, per chain link; Frost Orb's shards all seek one lone enemy; Storm Call's strikes are scattered
 * uniformly over its circle, so an enemy at the cursor expects `strikes × ((strike radius + body) / circle)²` of them; Glacial
 * Spikes and the other area skills hit an enemy once per cast (per line).
 */
export function hitCounts(def: SkillDef, rt: SkillRuntimeDef): { once: number; single: number } {
  const batch2 = roster2HitCounts(def, rt);
  if (batch2) return batch2;
  switch (def.id) {
    case 'frostOrb': {
      const shards = Math.max(1, Math.floor(rt.duration / SKILL_TIMING.orbShardInterval + 1e-9));
      return { once: Math.max(1, rt.projectiles) * shards, single: shards };
    }
    case 'stormCall': {
      const strikes = Math.max(1, Math.floor(rt.projectiles));
      if (rt.flags.includes('tethered')) return { once: strikes, single: 1 };
      const share = rt.range > 0 ? Math.min(1, ((rt.radius + STRIKE_BODY) / rt.range) ** 2) : 1;
      return { once: strikes, single: strikes * share };
    }
    case 'glacialSpikes': {
      const lines = rt.flags.includes('twinLines') ? 2 : 1;
      return { once: Math.max(1, Math.floor(rt.projectiles)) * lines, single: 1 };
    }
    default:
      if (def.shape === 'chain') return { once: rt.chains + 1, single: 1 };
      if (def.shape === 'area' || def.shape === 'buff') return { once: 1, single: 1 };
      return { once: Math.max(1, rt.projectiles), single: 1 };
  }
}

/**
 * Fan angle of a projectile skill: its own spread (after augments), or — for a single-bolt skill that gained extra
 * projectiles — the extra-projectile fan. Rings (Nova) have no fan.
 */
function fanSpread(def: SkillDef, spread: number, projectiles: number): number {
  if (def.shape !== 'projectile') return spread;
  if (spread > 0) return spread;
  return projectiles > 1 ? Math.min(EXTRA_PROJECTILE_FAN.max, EXTRA_PROJECTILE_FAN.perProjectile * (projectiles - 1)) : 0;
}

/** Current rank of a skill (Ember Lance is always at least 1). */
export function skillRank(ch: Pick<CharacterSave, 'skillRanks'>, id: SkillId): number {
  const r = Math.max(0, Math.floor(ch.skillRanks?.[id] ?? 0));
  return id === BASIC_SKILL ? Math.max(1, r) : r;
}

/** The augment ids picked on a skill (empty when none). */
export function skillAugments(ch: Pick<CharacterSave, 'augments'>, id: SkillId): string[] {
  const list = ch.augments?.[id];
  return Array.isArray(list) ? list : [];
}

/** Runtime defs of the basic attack and every ranked skill, with their augments. */
export function playerSkills(ch: CharacterSave, model: PlayerModel): SkillRuntimeDef[] {
  const out: SkillRuntimeDef[] = [];
  for (const id of SKILL_IDS) {
    const rank = skillRank(ch, id);
    if (rank >= 1) out.push(resolveSkill(model, id, rank, skillAugments(ch, id)).runtime);
  }
  return out;
}

/** Exactly LOADOUT_SLOTS entries: any learned skill in any slot, without duplicates. Shorter (older) loadouts pad with null. */
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
// Points
// ---------------------------------------------------------------------------------------------

/** Skill points a character of `level` has earned: 1 + 2 (level − 1). */
export function skillPointsTotal(level: number): number {
  const l = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return SKILL_POINTS.atLevelOne + SKILL_POINTS.perLevel * (l - 1);
}

/** Points an augment costs (T3: 2). */
export function augmentCost(a: Pick<AugmentDef, 'tier'>): number {
  return AUGMENT_RULES.tierCost[a.tier];
}

/** Augment slots a skill has at a rank: floor(rank / 2), at most 5. */
export function augmentSlots(rank: number): number {
  return clamp(Math.floor(Math.max(0, rank) / AUGMENT_RULES.ranksPerSlot), 0, AUGMENT_RULES.maxSlots);
}

/** Points held in one skill: its ranks (Ember Lance's innate first rank is free) and its augments. */
export function pointsInSkill(ch: Pick<CharacterSave, 'skillRanks' | 'augments'>, id: SkillId): number {
  const def = findSkill(id);
  if (!def) return 0;
  const ranks = Math.max(0, skillRank(ch, id) - (id === BASIC_SKILL ? 1 : 0));
  const ids = skillAugments(ch, id);
  return ranks + def.augmentDefs.filter((a) => ids.includes(a.id)).reduce((s, a) => s + augmentCost(a), 0);
}

/** Every skill point a character has spent (ranks beyond Ember Lance's innate one, and augments). */
export function skillPointsSpent(ch: Pick<CharacterSave, 'skillRanks' | 'augments'>): number {
  return SKILL_IDS.reduce((s, id) => s + pointsInSkill(ch, id), 0);
}

// ---------------------------------------------------------------------------------------------
// Ranks & loadout
// ---------------------------------------------------------------------------------------------

export function canRankUpSkill(ch: CharacterSave, skillId: SkillId): { ok: boolean; reason?: string } {
  const def = findSkill(skillId);
  if (!def) return { ok: false, reason: 'Unknown skill.' };
  const rank = skillRank(ch, skillId);
  if (!def.available && rank < 1) return { ok: false, reason: `${def.name} arrives in a later update.` };
  if (rank >= def.maxRank) return { ok: false, reason: `${def.name} is at its maximum rank (${def.maxRank}).` };
  if (rank < 1 && (ch.level ?? 1) < def.unlockLevel) return { ok: false, reason: `${def.name} unlocks at level ${def.unlockLevel}.` };
  if ((ch.unspentSkillPoints ?? 0) < 1) return { ok: false, reason: 'No skill points left. You gain two every level.' };
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
// Augments
// ---------------------------------------------------------------------------------------------

export function canPickAugment(ch: CharacterSave, skillId: SkillId, augmentId: string): { ok: boolean; reason?: string } {
  const def = findSkill(skillId);
  if (!def) return { ok: false, reason: 'Unknown skill.' };
  const aug = def.augmentDefs.find((a) => a.id === augmentId);
  if (!aug) return { ok: false, reason: `${def.name} has no such augment.` };
  if (!augmentAvailable(aug)) return { ok: false, reason: `${aug.name} arrives in a later update.` };
  const rank = skillRank(ch, skillId);
  const picked = skillAugments(ch, skillId);
  if (picked.includes(aug.id)) return { ok: false, reason: `${aug.name} is already chosen.` };
  const need = AUGMENT_RULES.tierRank[aug.tier];
  if (rank < need) return { ok: false, reason: `${aug.name} needs ${def.name} rank ${need} (currently ${rank}).` };
  for (const id of picked) {
    const other = def.augmentDefs.find((a) => a.id === id);
    if (other && ((aug.excludes ?? []).includes(id) || (other.excludes ?? []).includes(aug.id))) {
      return { ok: false, reason: `${aug.name} cannot be combined with ${other.name}.` };
    }
  }
  const slots = augmentSlots(rank);
  if (picked.length >= slots) {
    return { ok: false, reason: `${def.name} has ${slots} augment slot${slots === 1 ? '' : 's'} at rank ${rank}: one more every 2 ranks.` };
  }
  const cost = augmentCost(aug);
  if ((ch.unspentSkillPoints ?? 0) < cost) return { ok: false, reason: `${aug.name} costs ${cost} skill point${cost === 1 ? '' : 's'}.` };
  return { ok: true };
}

export function pickAugment(ch: CharacterSave, skillId: SkillId, augmentId: string): Result<CharacterSave> {
  const check = canPickAugment(ch, skillId, augmentId);
  if (!check.ok) return fail(check.reason ?? 'That augment cannot be chosen.');
  const def = getSkill(skillId);
  const aug = def.augmentDefs.find((a) => a.id === augmentId)!;
  const ids = [...skillAugments(ch, skillId), aug.id];
  const ordered = def.augmentDefs.filter((a) => ids.includes(a.id)).map((a) => a.id);
  return ok({
    ...ch,
    augments: { ...(ch.augments ?? {}), [skillId]: ordered },
    unspentSkillPoints: ch.unspentSkillPoints - augmentCost(aug),
  });
}

// ---------------------------------------------------------------------------------------------
// Respec (skills.md 9)
// ---------------------------------------------------------------------------------------------

function priceFor(ch: CharacterSave, points: number): RespecPrice {
  if (points <= 0) return { points: 0, freePoints: 0, scrap: 0 };
  if ((ch.level ?? 1) < RESPEC.freeBelowLevel) return { points, freePoints: points, scrap: 0 };
  const freeLeft = Math.max(0, RESPEC.freePoints - Math.max(0, Math.floor(ch.respecFreeUsed ?? 0)));
  const freePoints = Math.min(points, freeLeft);
  return { points, freePoints, scrap: (points - freePoints) * RESPEC.scrapPerPoint };
}

/** What refunding one augment, one skill or everything costs right now. */
export function respecPrice(ch: CharacterSave, target: { skillId: SkillId; augmentId?: string } | { all: true }): RespecPrice {
  if ('all' in target) return priceFor(ch, skillPointsSpent(ch));
  const def = findSkill(target.skillId);
  if (!def) return priceFor(ch, 0);
  if (target.augmentId !== undefined) {
    const aug = def.augmentDefs.find((a) => a.id === target.augmentId);
    return priceFor(ch, aug && skillAugments(ch, def.id).includes(aug.id) ? augmentCost(aug) : 0);
  }
  return priceFor(ch, pointsInSkill(ch, def.id));
}

/** Charge a refund: Scrap from the backpack, stash and Crafting Stash (one character value, so it is atomic), free points counted. */
function charge(ch: CharacterSave, price: RespecPrice): Result<CharacterSave> {
  const paid = price.scrap > 0 ? spendCurrency(ch, 'scrap', price.scrap) : ch;
  if (!paid) return fail(`The refund costs ${price.scrap} Forge Scrap.`);
  const usedFree = (ch.level ?? 1) < RESPEC.freeBelowLevel ? 0 : price.freePoints;
  return ok(usedFree > 0 ? { ...paid, respecFreeUsed: Math.max(0, Math.floor(ch.respecFreeUsed ?? 0)) + usedFree } : paid);
}

/** Refund one picked augment (augments are leaves: refunding one never strands another). */
export function refundAugment(ch: CharacterSave, skillId: SkillId, augmentId: string): Result<CharacterSave> {
  const def = findSkill(skillId);
  if (!def) return fail('Unknown skill.');
  const aug = def.augmentDefs.find((a) => a.id === augmentId);
  const picked = skillAugments(ch, skillId);
  if (!aug || !picked.includes(aug.id)) return fail('That augment is not chosen.');
  const charged = charge(ch, respecPrice(ch, { skillId, augmentId }));
  if (!charged.ok) return charged;
  const rest = picked.filter((id) => id !== aug.id);
  const augments = { ...(charged.value.augments ?? {}) };
  if (rest.length) augments[skillId] = rest;
  else delete augments[skillId];
  return ok({ ...charged.value, augments, unspentSkillPoints: charged.value.unspentSkillPoints + augmentCost(aug) });
}

/** One skill (augments first, then its ranks; Ember Lance keeps its innate rank) back to unlearned. */
function resetSkill(ch: CharacterSave, id: SkillId): CharacterSave {
  const points = pointsInSkill(ch, id);
  const augments = { ...(ch.augments ?? {}) };
  delete augments[id];
  const skillRanks = { ...ch.skillRanks, [id]: id === BASIC_SKILL ? 1 : 0 };
  return { ...ch, augments, skillRanks, unspentSkillPoints: ch.unspentSkillPoints + points };
}

/**
 * Respec one skill (`skillId`, for Scrap) or everything (null). A full respec with `token` spends a free respec token and also
 * refunds every attribute point; without one it costs Scrap per point. Unlearned skills leave the loadout.
 */
export function respec(ch: CharacterSave, skillId: SkillId | null, token: boolean): Result<CharacterSave> {
  if (skillId !== null && token) return fail('A free respec resets every skill at once.');
  if (skillId !== null && !findSkill(skillId)) return fail('Unknown skill.');
  const ids: readonly SkillId[] = skillId === null ? SKILL_IDS : [skillId];
  const points = ids.reduce((s, id) => s + pointsInSkill(ch, id), 0);
  const attributes = token ? Object.values(ch.allocated ?? {}).reduce((s: number, n: number) => s + Math.max(0, n), 0) : 0;
  if (points <= 0 && attributes <= 0) return fail('There is nothing to refund.');
  let next: CharacterSave;
  if (token) {
    const tokens = Math.max(0, Math.floor(ch.respecTokens ?? 0));
    if (tokens < 1) return fail('You have no free respec left.');
    next = {
      ...ch,
      respecTokens: tokens - 1,
      allocated: { str: 0, dex: 0, int: 0 },
      unspentAttributePoints: ch.unspentAttributePoints + attributes,
    };
  } else {
    const charged = charge(ch, priceFor(ch, points));
    if (!charged.ok) return charged;
    next = charged.value;
  }
  for (const id of ids) next = resetSkill(next, id);
  return ok({ ...next, loadout: normalizeLoadout(next) });
}

// ---------------------------------------------------------------------------------------------
// Loadout presets
// ---------------------------------------------------------------------------------------------

const PRESET_NAME_MAX = 24;

/** LOADOUT_PRESETS presets, padded and cleaned (a missing one is empty, named "Preset N"). */
export function normalizePresets(raw: unknown): LoadoutPreset[] {
  const src = Array.isArray(raw) ? raw : [];
  const out: LoadoutPreset[] = [];
  for (let i = 0; i < LOADOUT_PRESETS; i++) {
    const p = src[i] as { name?: unknown; loadout?: unknown } | undefined;
    const name = typeof p?.name === 'string' ? p.name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX) : '';
    const list: unknown[] = Array.isArray(p?.loadout) ? p.loadout : [];
    const loadout: (SkillId | null)[] = [];
    for (let k = 0; k < LOADOUT_SLOTS; k++) {
      const id = list[k];
      const def = typeof id === 'string' ? findSkill(id) : undefined;
      loadout.push(def && !loadout.includes(def.id) ? def.id : null);
    }
    out.push({ name: name || `Preset ${i + 1}`, loadout });
  }
  return out;
}

export function setPreset(ch: CharacterSave, preset: number, op: 'save' | 'load' | 'rename', name?: string): Result<CharacterSave> {
  if (!Number.isInteger(preset) || preset < 0 || preset >= LOADOUT_PRESETS) return fail('That preset does not exist.');
  const presets = normalizePresets(ch.loadoutPresets);
  const p = presets[preset];
  switch (op) {
    case 'save':
      presets[preset] = { ...p, loadout: normalizeLoadout(ch) };
      return ok({ ...ch, loadoutPresets: presets });
    case 'load': {
      const loadout = normalizeLoadout({ ...ch, loadout: p.loadout });
      return ok({ ...ch, loadout });
    }
    case 'rename': {
      const clean = normalizePresets([{ name, loadout: p.loadout }])[0].name;
      presets[preset] = { ...p, name: typeof name === 'string' && name.trim() ? clean : `Preset ${preset + 1}` };
      return ok({ ...ch, loadoutPresets: presets });
    }
    default:
      return fail('Unknown preset action.');
  }
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

/** "Echoing Ring: Repeats after 0.4 seconds…" for each picked augment that took effect. */
export function augmentLines(r: ResolvedSkill): string[] {
  return r.augments.map((a) => `${a.name}: ${a.text}`);
}

/** Tooltip lines for a resolved skill. */
export function skillLines(r: ResolvedSkill): string[] {
  const { def, runtime: rt } = r;
  const lines: string[] = [];
  const type = DAMAGE_NAME[rt.damageType];
  const noun = def.projectileNoun ?? 'projectile';
  const pierceAll = !!def.pierceAll || rt.flags.includes('pierceAll');
  const fan = rt.augments?.find((a) => a.p === 'fan');
  const roster = rosterLines(r);
  if (roster) lines.push(...roster);
  else switch (def.shape) {
    case 'projectile':
      lines.push(`Deals ${damageRange(rt.damage)} ${type} damage`);
      lines.push(rt.flags.includes('circle') ? `Fires ${plural(rt.projectiles, noun)} in a full circle` : rt.projectiles > 1
        ? `Fires ${plural(rt.projectiles, noun)} in a ${degrees(rt.spread)} fan`
        : `Fires ${plural(1, noun)} toward the cursor`);
      if (def.radius !== 0) lines.push(`Each ${noun} is ${Math.round(rt.radius * 2)} units wide`);
      break;
    case 'nova':
      lines.push(`Deals ${damageRange(rt.damage)} ${type} damage`);
      lines.push(fan || rt.flags.includes('fan')
        ? `Fires ${plural(rt.projectiles, noun)} in a ${degrees(fan ? fan.arc : UNIQUE_FAN_ARC)} fan reaching ${Math.round(rt.range)} units`
        : `Bursts ${plural(rt.projectiles, noun)} outward in a ring reaching ${Math.round(rt.range)} units`);
      break;
    case 'chain':
      lines.push(`Deals ${damageRange(rt.damage)} ${type} damage`);
      lines.push(`Strikes the enemy nearest the cursor within ${Math.round(rt.range)} units, then chains ${plural(rt.chains, 'time')} (jump range ${Math.round(rt.radius)})`);
      break;
    case 'dash': {
      const invuln = rt.augments?.find((a) => a.p === 'invulnerable');
      lines.push(`Blinks up to ${Math.round(rt.distance)} units toward the cursor`);
      lines.push(`Invulnerable for ${seconds(invuln ? invuln.seconds : 0.2)}`);
      break;
    }
    case 'ward':
      lines.push(`You take ${percent(rt.damageReduction)} less damage for ${seconds(rt.duration)}${def.damageReductionCap ? ` (at most ${percent(Math.min(1, def.damageReductionCap + r.augments.flatMap((a) => a.effects).reduce((s, e) => s + (e.k === 'add' && e.stat === 'damageReductionCap' ? e.value : 0), 0)))})` : ''}`);
      if (rt.damage > 0) {
        lines.push(`Embers deal ${damageRange(rt.damage)} ${type} damage to enemies within ${Math.round(rt.radius)} units every ${seconds(def.pulseInterval ?? 0.5)}`);
      }
      break;
    case 'area':
      if (rt.damage > 0) lines.push(`Deals ${damageRange(rt.damage)} ${type} damage${rt.radius > 0 ? ` in a radius of ${Math.round(rt.radius)}` : ''}`);
      if (rt.duration > 0) lines.push(`Lasts ${seconds(rt.duration)}`);
      break;
    case 'buff':
      if (rt.duration > 0) lines.push(`Lasts ${seconds(rt.duration)}`);
      break;
  }
  const pierce = def.shape === 'projectile' || def.shape === 'nova' ? pierceText(rt.pierce, pierceAll) : null;
  if (pierce) lines.push(pierce);
  if ((def.shape === 'projectile' || def.shape === 'nova') && rt.projectileSpeed > 0 && def.shape !== 'nova' && def.id !== 'frostOrb') {
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
  lines.push(...augmentLines(r));
  return lines;
}

/**
 * Behaviour lines of the roster skills that the generic shapes cannot say (power rework SK2). Every number is the runtime def's or
 * a SKILL_TIMING / DECAY constant the sim reads too, so the text is what the sim does. null for the other skills.
 */
function rosterLines(r: ResolvedSkill): string[] | null {
  const { def, runtime: rt } = r;
  const type = DAMAGE_NAME[rt.damageType];
  const dmg = `${damageRange(rt.damage)} ${type} damage`;
  const aug = <P extends AugmentRuntime['p']>(p: P) => rt.augments?.find((a): a is Extract<AugmentRuntime, { p: P }> => a.p === p);
  const bounce = aug('bounce');
  const bounceLine = bounce ? [`Rebounds off walls up to ${plural(bounce.count, 'time')}`] : [];
  switch (def.id) {
    case 'phaseStride': {
      const s = aug('stride');
      const lines = [`For ${seconds(rt.duration)}: ${percent(s?.speed ?? 0)} more movement speed, no slow from crowding, and you pass through allies`];
      if (s && s.evasion > 0) lines.push(`+${percent(s.evasion)} chance to evade hits while it lasts`);
      if (rt.flags.includes('cleanse')) lines.push('Casting it removes chill and root');
      return lines;
    }
    case 'arcaneReprieve': {
      const s = aug('restore');
      const lines = [`Restores ${percent(s?.focus ?? 0)} of your maximum Focus over ${seconds(rt.duration)}`];
      if (s && s.life > 0) lines.push(`Restores ${percent(s.life)} of your maximum life over ${seconds(rt.duration)}`);
      lines.push('Removes chill and Withered');
      return lines;
    }
    case 'glacialNova':
      return [`Deals ${dmg} to every enemy within ${Math.round(rt.radius)} units of you`, 'An instant burst: passes cover and shields'];
    case 'spark':
      return [
        `Deals ${dmg}`,
        `Releases ${plural(rt.projectiles, 'spark')} in a ${degrees(rt.spread)} fan; each hits an enemy at most every ${seconds(SKILL_TIMING.sparkRehit)}`,
        ...bounceLine,
      ];
    case 'cinderMortar': {
      const g = aug('ground');
      const lines = [
        `Lobs a shell at the cursor (up to ${Math.round(rt.range)} units away) that lands after ${seconds(SKILL_TIMING.mortarFlight)}, flying over cover and shields`,
        `Deals ${dmg} in a radius of ${Math.round(rt.radius)}`,
      ];
      if (g) lines.push(`Leaves burning ground (radius ${Math.round(g.radius)}) for ${seconds(g.duration)}: ${damageRange(g.damage)} Fire damage every ${seconds(g.interval)}`);
      return lines;
    }
    case 'umbralBolt': {
      const d = aug('decay');
      const lines = [`Deals ${dmg}`, 'Fires a slow, heavy bolt toward the cursor'];
      if (d) lines.push(`Decay: ${percent(d.share)} of the hit as Void damage over ${seconds(DECAY.duration)}, stacking up to ${DECAY.maxStacks} times`);
      return lines;
    }
    case 'kineticLance':
      return [`Deals ${dmg}`, `Fires a fast bolt toward the cursor that knocks enemies back ${SKILL_TIMING.kineticKnockback}× as far`, ...bounceLine];
    case 'frostOrb': {
      const shards = Math.max(1, Math.floor(rt.duration / SKILL_TIMING.orbShardInterval + 1e-9));
      return [
        `${rt.projectiles > 1 ? `${plural(rt.projectiles, 'orb')} drift` : 'An orb drifts'} toward the cursor at ${Math.round(rt.projectileSpeed)} units per second for ${seconds(rt.duration)}`,
        `Every ${seconds(SKILL_TIMING.orbShardInterval)} each orb fires a shard at the nearest enemy within ${Math.round(rt.radius)} units (${shards} shards): ${dmg} each`,
      ];
    }
    case 'stormCall':
      return [
        rt.flags.includes('tethered')
          ? `${plural(rt.projectiles, 'strike')} land evenly along a line from you to the cursor after ${seconds(SKILL_TIMING.stormTelegraph)}`
          : `${plural(rt.projectiles, 'strike')} land within ${Math.round(rt.range)} units of the cursor after ${seconds(SKILL_TIMING.stormTelegraph)}`,
        `Each strike deals ${dmg} in a radius of ${Math.round(rt.radius)}: ground damage, it ignores cover and shields`,
      ];
    case 'glacialSpikes':
      return [
        `${plural(rt.projectiles, 'spike')} erupt one after another along ${Math.round(rt.range)} units toward the cursor${rt.flags.includes('twinLines') ? ', in two lines' : ''}`,
        `Each spike deals ${dmg} in a radius of ${Math.round(rt.radius)}; an enemy is struck once per line`,
      ];
    default:
      return roster2Lines(r);
  }
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
  { label: 'Strikes', get: (rt) => rt.projectiles, fmt: String, applies: (d) => d.shape === 'area' && d.projectiles !== 0 },
  { label: 'Radius', get: (rt) => rt.radius, fmt: (v) => String(Math.round(v)), applies: (d) => d.shape === 'area' && d.radius !== 0 },
  { label: 'Charges', get: (rt) => rt.charges, fmt: String, applies: (d) => d.charges !== 1 },
  { label: 'Blink distance', get: (rt) => rt.distance, fmt: (v) => String(Math.round(v)), applies: (d) => d.shape === 'dash' },
  { label: 'Duration', get: (rt) => rt.duration, fmt: seconds, applies: (d) => d.shape === 'ward' || d.shape === 'buff' || d.shape === 'area' },
  { label: 'Damage reduction', get: (rt) => rt.damageReduction, fmt: (v) => percent(v), applies: (d) => d.shape === 'ward' },
  { label: 'Cooldown', get: (rt) => rt.cooldown, fmt: seconds, applies: (d) => d.cooldown !== 0 },
];

/** What the next rank changes: "Damage 5.2–7.8 to 5.6–8.4", "Projectiles 12 to 13", plus a new augment slot or tier. */
export function nextRankLines(model: PlayerModel, skillId: SkillId, rank: number, augmentIds: readonly string[] = []): string[] {
  const def = getSkill(skillId);
  if (rank >= def.maxRank) return [];
  if (rank <= 0) return [`Spend a skill point to learn ${def.name} at rank 1.`];
  const now = resolveSkill(model, skillId, rank, augmentIds).runtime;
  const next = resolveSkill(model, skillId, rank + 1, augmentIds).runtime;
  const out: string[] = [];
  for (const m of METRICS) {
    if (!m.applies(def)) continue;
    const a = m.fmt(m.get(now));
    const b = m.fmt(m.get(next));
    if (a !== b) out.push(`${m.label} ${a} to ${b}`);
  }
  if (def.augmentDefs.length && augmentSlots(rank + 1) > augmentSlots(rank)) out.push(`Augment slots ${augmentSlots(rank)} to ${augmentSlots(rank + 1)}`);
  for (const tier of [1, 2, 3] as const) {
    if (AUGMENT_RULES.tierRank[tier] === rank + 1 && def.augmentDefs.some((a) => a.tier === tier)) out.push(`Unlocks tier ${tier} augments`);
  }
  return out.length ? out : ['Small improvements to its numbers.'];
}

/** Full skill sheet for tooltips. `rank` defaults to the current rank (unlearned skills show rank 1). */
export function skillSheetFor(ch: CharacterSave, skillId: SkillId, rank?: number, model = buildPlayerModel(ch)): SkillSheet {
  const def = getSkill(skillId);
  const current = skillRank(ch, skillId);
  const requested = rank !== undefined && Number.isFinite(rank) ? Math.floor(rank) : current;
  const shown = clamp(requested, 0, def.maxRank);
  const ids = skillAugments(ch, skillId);
  const resolved = resolveSkill(model, skillId, Math.max(1, shown), ids);
  return {
    skillId,
    rank: shown,
    runtime: resolved.runtime,
    lines: skillLines(resolved),
    nextRankLines: nextRankLines(model, skillId, shown, ids),
    augmentLines: augmentLines(resolved),
    dps: resolved.dps,
  };
}

export { MAX_SKILL_RANK };
