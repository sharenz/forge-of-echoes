// PlayerCombatStats.passives (PT4): the Orrery's live rules as the numbers the sim reads (src/sim/passives.ts), resolved from the
// player model so the sheet, the tooltips and the sim agree. Built only for a character whose allocation carries rules (null
// otherwise: the field stays absent and the sim skips every passive hook).
//
// Caps (passive-tree.md 1.3, power-curve.md 11):
//   - the conditional `more` lines (Pyroclasm, Absolute Zero) and the ailment / echo `more` lines together never lift a hit past the
//     tree's ×2.0 or the global MORE_CAP: `moreRoom` is what the unconditional pools leave (the worst case over every damage type);
//   - the typed damage-taken lines and the flask guard never take damage taken below the tree's ×0.75 floor (with the tree's own
//     damage-taken lines) nor the global ×0.60 floor (with the character's whole damage-taken stat): `takenFloor`;
//   - penetration stays at PEN_CAP (+15 with Razor Doctrine); resistances, evasion, crit and area keep their existing caps.
import type { DamageType } from '../../contracts/content';
import { DAMAGE_TYPES } from '../../contracts/content';
import type { StatModifier } from '../../contracts/items';
import { ORRERY_SOURCE } from '../../contracts/passives';
import type { PassiveRuntime, PlayerCombatStats } from '../../contracts/sim';
import { AILMENT_BASE, MORE_CAP, PEN_CAP, STAT_CAPS } from '../../data/progression';
import { ORRERY_CAPS, ORRERY_DAMAGE_STATS } from '../../data/progression/passives';
import type { PlayerModel } from './model';
import { spellPowerAt } from './model';
import { damageStatsFor, resolveSkill } from './skills';

/** Cinder Attunement (c)'s burst and Shatterpoint's nova: effectiveness and radius (passive-tree.md 3.1, 3.3). */
export const FIRE_BURST = { effectiveness: 1.2, radius: 50 } as const;
export const SHATTER_NOVA = { effectiveness: 2, radius: 70 } as const;
/** Last Ember's cooldown, Bloodied Resolve's guard, Pulse of Life's heal, Soul Tithe's ceiling, Echo Cascade's delay. */
export const PASSIVE_TIMING = { lowLifeWardCooldown: 30, flaskGuardSeconds: 2, pulseLife: 0.06, focusLeechMax: 6, echoDelay: 0.4 } as const;

const ALL_TAGS = ['Projectile', 'Area', 'Duration'];
const isOrrery = (m: StatModifier) => m.source === ORRERY_SOURCE || m.source.startsWith(`${ORRERY_SOURCE}:`);

/** Σ increased and Π more of the modifiers of hits of a type (with `tags`). */
function pools(model: PlayerModel, type: DamageType, tags: readonly string[] = []): { inc: number; more: number } {
  const mods = model.of(...damageStatsFor(type, tags));
  let inc = 0;
  let more = 1;
  for (const m of mods) {
    if (m.mode === 'increased') inc += m.value;
    else if (m.mode === 'more') more *= 1 + m.value / 100;
  }
  return { inc, more };
}

/** A hit of `effectiveness` of `type` with the player's own modifiers (an Area hit): Cinder Attunement's burst, Shatterpoint's nova. */
export function passiveEffDamage(model: PlayerModel, type: DamageType, effectiveness: number): number {
  const { inc, more } = pools(model, type, ['Area']);
  const power = spellPowerAt(model.cls, model.level) + model.breakdown('addedSpellDamage', 0).value;
  return Math.max(0, power * effectiveness * Math.max(0, 1 + inc / 100) * Math.min(MORE_CAP, more));
}

/** The room the conditional `more` lines have: the tree's ×2.0 and MORE_CAP over what the unconditional pools already use. */
export function passiveMoreRoom(model: PlayerModel): number {
  let tree = 1;
  for (const m of model.mods) if (isOrrery(m) && m.mode === 'more' && m.value > 0 && ORRERY_DAMAGE_STATS.includes(m.stat)) tree *= 1 + m.value / 100;
  let worst = 1;
  for (const t of DAMAGE_TYPES) worst = Math.max(worst, pools(model, t, ALL_TAGS).more);
  return Math.max(1, Math.min(ORRERY_CAPS.moreDamage / tree, MORE_CAP / worst));
}

/** An `increased` line against a condition, as a factor of the hit: (1 + inc + v) / (1 + inc) − 1 with the type's own pool. */
function increasedFactor(model: PlayerModel, type: DamageType, v: number): number {
  if (!(v > 0)) return 0;
  const { inc } = pools(model, type);
  const base = Math.max(1, 100 + inc);
  return v / base;
}

/** The sim's passive numbers for a model (null when the character has no live passive rule). */
export function passiveRuntimeOf(model: PlayerModel, combat: Pick<PlayerCombatStats, 'damageTaken'>): PassiveRuntime | null {
  const t = model.passives;
  if (!t) return null;
  const room = passiveMoreRoom(model);
  const capMore = (f: number) => (f > room ? Math.max(1, room) : f);
  const per = (fn: (type: DamageType) => number) => DAMAGE_TYPES.map(fn);

  // Conversion: Pyre Doctrine wins; else Frostfire Gate / Rift Spark per source type.
  const allTo = t.has('convertAll') ? t.of('convertAll')[0].to ?? 'fire' : null;
  const convertTo = per(() => -1);
  const convertShare = per(() => 0);
  if (!allTo) {
    for (const r of t.of('convert')) {
      if (!r.type || !r.to) continue;
      const k = DAMAGE_TYPES.indexOf(r.type);
      if (convertTo[k] >= 0 && convertTo[k] !== DAMAGE_TYPES.indexOf(r.to)) continue;
      convertTo[k] = DAMAGE_TYPES.indexOf(r.to);
      convertShare[k] = Math.min(1, convertShare[k] + r.value / 100);
    }
  }

  // The tree's own damage-taken lines (already floored by resolvePassives) and the character's whole damage-taken stat.
  let treeTaken = 1;
  for (const m of model.mods) if (isOrrery(m) && m.stat === 'damageTaken' && m.mode === 'more') treeTaken *= 1 + m.value / 100;
  const whole = Number.isFinite(combat.damageTaken) && combat.damageTaken > 0 ? combat.damageTaken : 1;
  const takenFloor = Math.min(1, Math.max(ORRERY_CAPS.damageTakenFloor / Math.max(1e-6, treeTaken), STAT_CAPS.damageTakenFloor / whole));

  const chillSet = t.max('chillEffectSet');
  const shockEffect = (AILMENT_BASE.shockEffect * 100 + t.sum('shockEffect')) * t.product('shockEffectPct') / 100;
  const chillSlow = Math.min(0.9, ((chillSet > 0 ? chillSet : AILMENT_BASE.chillSlow * 100) + t.sum('chillEffect')) / 100);
  const wardDef = t.has('lowLifeWard') ? resolveSkill(model, 'cinderWard', model.wardSkill.rank, model.wardSkill.augments).runtime : null;

  return {
    igniteDuration: t.sum('igniteDuration') / 100,
    igniteMore: capMore(t.product('igniteEffect')),
    shockEffect,
    shockDuration: t.sum('shockDuration'),
    chillSlow,
    chilledWeaken: Math.min(0.9, t.sum('chilledDealLess') / 100),
    exposurePoints: per((ty) => t.sum('exposureEffect', ty)),
    exposureDuration: t.sum('exposureDuration'),
    decayDuration: t.sum('decayDuration'),
    decayMore: capMore(t.product('decayEffect')),
    decayStacks: Math.round(t.sum('decayStacks')),
    witherStacks: Math.round(t.sum('witherStacks')),
    moreNearBurning: per((ty) => t.of('moreNearBurning').some((r) => !r.type || r.type === ty) ? t.product('moreNearBurning', ty) - 1 : 0),
    vsBurning: per((ty) => increasedFactor(model, ty, t.sum('damageVsBurning', ty))),
    vsChilled: per((ty) => increasedFactor(model, ty, t.sum('damageVsChilled', ty))),
    moreVsChilled: t.product('moreVsChilled') - 1,
    lessVsUnchilled: 1 - t.less('lessVsUnchilled'),
    nonCritLess: 1 - t.less('nonCritLess'),
    moreRoom: room,
    knockback: 1 + t.sum('knockback') / 100,
    penCap: PEN_CAP + Math.max(0, t.sum('penCap')),
    pullMore: 1 + t.sum('pullEffect') / 100,
    convertTo,
    convertShare,
    convertAll: allTo ? DAMAGE_TYPES.indexOf(allTo) : -1,
    igniteSpread: Math.round(t.max('igniteSpreadOnDeath')),
    fireBurstChance: Math.min(1, t.sum('fireKillBurst') / 100),
    fireBurstDamage: t.has('fireKillBurst') ? passiveEffDamage(model, 'fire', FIRE_BURST.effectiveness) : 0,
    fireBurstRadius: FIRE_BURST.radius,
    shatterChance: Math.min(1, t.sum('shatterNova') / 100),
    shatterDamage: t.has('shatterNova') ? passiveEffDamage(model, 'cold', SHATTER_NOVA.effectiveness) : 0,
    shatterRadius: SHATTER_NOVA.radius,
    decayedExplode: t.sum('decayedExplode') / 100,
    lowLifeWard: wardDef ? t.max('lowLifeWard') / 100 : 0,
    lowLifeWardCooldown: PASSIVE_TIMING.lowLifeWardCooldown,
    lowLifeWardDef: wardDef,
    pulseKills: Math.max(0, Math.round(t.min('pulseEveryKills'))),
    pulseLife: PASSIVE_TIMING.pulseLife,
    focusOnFireKill: t.of('focusOnKillTyped').filter((r) => r.type === 'fire').reduce((s, r) => s + r.value, 0),
    focusOnShockedKill: t.sum('focusOnKillShocked'),
    focusLeech: t.of('focusLeech').filter((r) => !r.type || r.type === 'void').reduce((s, r) => s + r.value, 0) / 100,
    focusLeechMax: PASSIVE_TIMING.focusLeechMax,
    echoAll: t.max('echoAll') / 100,
    echoDelay: PASSIVE_TIMING.echoDelay,
    echoMore: capMore(t.product('echoDamage')),
    takenHit: per((ty) => t.product('damageTakenTyped', ty) * t.product('damageTakenHits', ty)),
    takenDot: per((ty) => t.product('damageTakenTyped', ty)),
    takenFloor,
    burnOnYou: Math.max(0, 1 + t.sum('burnOnYouDuration') / 100),
    regenLowLife: t.sum('regenLowLife') / 100,
    flaskGuard: Math.min(0.9, t.max('flaskGuard') / 100),
    flaskGuardTime: PASSIVE_TIMING.flaskGuardSeconds,
    focusFlaskLife: t.sum('focusFlaskLife') / 100,
    noLifeFlasks: t.has('noLifeFlasks'),
    armourBigHits: t.sum('armourBigHits') / 100,
    armourPerDamage: t.has('armourFormula') ? Math.max(1, t.min('armourFormula')) : 10,
    armourVsElements: Math.min(1, t.max('armourVsElements') / 100),
    evadeCap: Math.min(0.95, model.cls.evasionCap + t.sum('evadeCap') / 100),
    // Barrier Study: "25% stronger (Cinder Ward cap 60% → 66%)": the cap rises by 40% of the effect.
    wardCap: 1 + (t.sum('wardEffect') / 100) * 0.4,
    damageFromFocus: Math.min(1, t.sum('damageFromFocus') / 100),
  };
}
