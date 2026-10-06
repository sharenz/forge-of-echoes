// The Orrery's node table (docs/power-rework/passive-tree.md 2 and 3). This file is the TABLE the 252 nodes are generated from:
//   NAMED       the 100 named nodes (start, gates, notables, bridges, cross-hub notables, masteries, keystones) with their numbers;
//   FAMILIES    the small-node families of each region (2.3), one stat line each, on the ledger (about 1u);
//   SECTORS     each sector's shape: a spine of ten nodes (gate side to rim) and spurs in the columns beside it;
//   BRIDGES     the adjacent-sector notables and where they attach.
// index.ts turns the table into nodes (ids, links, families, costs, positions from layout.ts). Ids are derived from the table, so
// the table is append-only once released: a small's id is its position in generation order (`pas.fire.s7`).
import type { DamageType } from '../../../contracts/content';
import type { StatId } from '../../../contracts/items';
import type { PassiveKind, PassiveSector } from '../../../contracts/passives';
import type { PassiveChoice, PassiveEngine, PassiveMod, PassiveRule, PassiveRuleId } from './types';

const inc = (stat: StatId, value: number): PassiveMod => ({ stat, mode: 'increased', value });
const flat = (stat: StatId, value: number): PassiveMod => ({ stat, mode: 'flat', value });
const more = (stat: StatId, value: number): PassiveMod => ({ stat, mode: 'more', value });
const rule = (id: PassiveRuleId, value: number, extra: { type?: DamageType; to?: DamageType } = {}): PassiveRule => ({ id, value, ...extra });
const choice = (text: string, mods: PassiveMod[], rules: PassiveRule[] = [], gross = 5): PassiveChoice => ({ text, mods, rules, audit: { gross, price: 0 } });

export interface NamedDef {
  /** Unique within its region: the id is `pas.<region>.<key>` (bridges `pas.bridge.<key>`). */
  key: string;
  name: string;
  kind: Exclude<PassiveKind, 'small'>;
  text: string[];
  mods: PassiveMod[];
  rules?: PassiveRule[];
  choices?: PassiveChoice[];
  /** Keys of other named nodes (any region) this one excludes; the index makes the pairs symmetric. */
  excludes?: string[];
  gross: number;
  price?: number;
  engine: PassiveEngine;
}

// ---------------------------------------------------------------------------------------------
// Named nodes per region (3.1 to 3.8)
// ---------------------------------------------------------------------------------------------

export const NAMED: Record<'hub' | 'bridge' | PassiveSector, NamedDef[]> = {
  fire: [
    { key: 'gate', name: 'Gate of Embers', kind: 'gate', text: ['+14% increased Fire Damage', '+4% increased Area of Effect'], mods: [inc('fireDamage', 14), inc('area', 4)], gross: 4, engine: 'E0' },
    { key: 'kindle', name: 'Kindle', kind: 'notable', text: ['+14% increased Fire Damage', '+10% chance to Ignite'], mods: [inc('fireDamage', 14), flat('igniteChance', 10)], gross: 5, engine: 'E0' },
    { key: 'slowBurn', name: 'Slow Burn', kind: 'notable', text: ['Ignites you cause last 50% longer', '+20% increased Damage over Time'], mods: [inc('damageOverTime', 20)], rules: [rule('igniteDuration', 50)], gross: 5, engine: 'E1' },
    { key: 'searingEdge', name: 'Searing Edge', kind: 'notable', text: ['+6 Fire Penetration', '+6% increased Fire Damage'], mods: [flat('firePen', 6), inc('fireDamage', 6)], gross: 5, engine: 'E1' },
    { key: 'pyroclasm', name: 'Pyroclasm', kind: 'notable', text: ['6% more Fire Damage while 3 or more Burning enemies are within 120'], mods: [], rules: [rule('moreNearBurning', 6, { type: 'fire' })], gross: 6, engine: 'E2' },
    { key: 'wildfire', name: 'Wildfire', kind: 'notable', text: ['Ignited enemies that die ignite 2 enemies within 100'], mods: [], rules: [rule('igniteSpreadOnDeath', 2)], gross: 6, engine: 'E2' },
    { key: 'emberReservoir', name: 'Ember Reservoir', kind: 'notable', text: ['Killing an enemy with a Fire skill restores 3 Focus'], mods: [], rules: [rule('focusOnKillTyped', 3, { type: 'fire' })], gross: 4, engine: 'E0' },
    { key: 'scorchWard', name: 'Scorch Ward', kind: 'notable', text: ['Take 12% less Fire Damage', 'Burning on you lasts 40% shorter'], mods: [], rules: [rule('damageTakenTyped', -12, { type: 'fire' }), rule('burnOnYouDuration', -40)], gross: 4, engine: 'E1' },
    { key: 'lastEmber', name: 'Last Ember', kind: 'notable', text: ['When you fall below 30% Life, Cinder Ward is cast for free (once every 30 seconds)'], mods: [], rules: [rule('lowLifeWard', 30)], gross: 6, engine: 'E2' },
    {
      key: 'mastery', name: 'Cinder Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E2',
      choices: [
        choice('Ignites you cause deal 25% more damage', [], [rule('igniteEffect', 25)]),
        choice('+12% Fire Damage against Burning enemies', [], [rule('damageVsBurning', 12, { type: 'fire' })]),
        choice('Fire kills have a 15% chance to burst for 1.2× effectiveness in radius 50', [], [rule('fireKillBurst', 15)]),
      ],
    },
    {
      key: 'pyreDoctrine', name: 'Pyre Doctrine', kind: 'keystone', engine: 'E2', gross: 35, price: 15, excludes: ['absoluteZero', 'stormbound'],
      text: ['All your damage is converted to Fire', '30% more Fire Damage', 'Ignites you cause deal 30% more damage', 'You cannot deal other damage types: a fire-proof rare is a wall unless you carry penetration'],
      mods: [more('fireDamage', 30)], rules: [rule('convertAll', 100, { to: 'fire' }), rule('igniteEffect', 30)],
    },
  ],
  lightning: [
    { key: 'gate', name: 'Gate of Sparks', kind: 'gate', text: ['+14% increased Lightning Damage', '+10% chance to Shock'], mods: [inc('lightningDamage', 14), flat('shockChance', 10)], gross: 4, engine: 'E0' },
    { key: 'staticCharge', name: 'Static Charge', kind: 'notable', text: ['+14% increased Lightning Damage', 'Shocks you cause are 4 points stronger'], mods: [inc('lightningDamage', 14)], rules: [rule('shockEffect', 4)], gross: 5, engine: 'E1' },
    { key: 'conductiveThoughts', name: 'Conductive Thoughts', kind: 'notable', text: ['Chaining skills chain 1 additional time'], mods: [flat('extraChains', 1)], gross: 6, engine: 'E1' },
    { key: 'liveWire', name: 'Live Wire', kind: 'notable', text: ['+6 Lightning Penetration', '+6% increased Lightning Damage'], mods: [flat('lightningPen', 6), inc('lightningDamage', 6)], gross: 5, engine: 'E1' },
    { key: 'overload', name: 'Overload', kind: 'notable', text: ['Shocks you cause last 2 seconds longer'], mods: [], rules: [rule('shockDuration', 2)], gross: 4, engine: 'E0' },
    { key: 'quickenedPulse', name: 'Quickened Pulse', kind: 'notable', text: ['+8% increased Cast Speed'], mods: [inc('castSpeed', 8)], gross: 6, engine: 'E0' },
    { key: 'tempestReach', name: 'Tempest Reach', kind: 'notable', text: ['+15% increased Projectile Speed', '+10% increased Area of Effect for Lightning skills'], mods: [inc('projectileSpeed', 15)], rules: [rule('areaTyped', 10, { type: 'lightning' })], gross: 4, engine: 'E0' },
    { key: 'groundingRod', name: 'Grounding Rod', kind: 'notable', text: ['+10% to Lightning Resistance', 'Take 20% less Lightning Damage from hits'], mods: [flat('lightningRes', 10)], rules: [rule('damageTakenHits', -20, { type: 'lightning' })], gross: 6, engine: 'E0' },
    { key: 'surgeOfStatic', name: 'Surge of Static', kind: 'notable', text: ['Killing a Shocked enemy restores 4 Focus'], mods: [], rules: [rule('focusOnKillShocked', 4)], gross: 5, engine: 'E0' },
    {
      key: 'mastery', name: 'Storm Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E1',
      choices: [
        choice('Shocks you cause are 10 points stronger', [], [rule('shockEffect', 10)]),
        choice('Chaining skills chain 1 additional time', [flat('extraChains', 1)]),
        choice('+30 to Critical Strike Multiplier with Lightning skills', [], [rule('critMultiplierTyped', 30, { type: 'lightning' })]),
      ],
    },
    {
      key: 'stormbound', name: 'Stormbound', kind: 'keystone', engine: 'E1', gross: 33, price: 13, excludes: ['pyreDoctrine', 'absoluteZero'],
      text: ['30% more Lightning Damage', 'Shocks you cause are 50% stronger (Shocked enemies take 30% more damage)', '40% less Focus Regeneration', 'Skills cost 10% more Focus'],
      mods: [more('lightningDamage', 30), more('focusRegen', -40)], rules: [rule('shockEffectPct', 50), rule('focusCost', 10)],
    },
  ],
  cold: [
    { key: 'gate', name: 'Gate of Rime', kind: 'gate', text: ['+14% increased Cold Damage', '+10% chance to Chill'], mods: [inc('coldDamage', 14), flat('chillChance', 10)], gross: 4, engine: 'E0' },
    { key: 'hoarfrost', name: 'Hoarfrost', kind: 'notable', text: ['+14% increased Cold Damage', '+10% chance to Chill'], mods: [inc('coldDamage', 14), flat('chillChance', 10)], gross: 5, engine: 'E0' },
    { key: 'brittleBones', name: 'Brittle Bones', kind: 'notable', text: ['Your Cold Exposure is 4 points stronger', '+15% Damage against Chilled enemies'], mods: [], rules: [rule('exposureEffect', 4, { type: 'cold' }), rule('damageVsChilled', 15)], gross: 6, engine: 'E1' },
    { key: 'frostbound', name: 'Frostbound', kind: 'notable', text: ['Chill slows 10 points more (40%)', '+8% increased Cold Damage'], mods: [inc('coldDamage', 8)], rules: [rule('chillEffect', 10)], gross: 5, engine: 'E0' },
    { key: 'glacialEdge', name: 'Glacial Edge', kind: 'notable', text: ['+6 Cold Penetration', '+6% increased Cold Damage'], mods: [flat('coldPen', 6), inc('coldDamage', 6)], gross: 5, engine: 'E1' },
    { key: 'wintersPatience', name: "Winter's Patience", kind: 'notable', text: ['Cold zones and orbs last 20% longer', '+8% increased Area of Effect'], mods: [inc('area', 8)], rules: [rule('zoneDuration', 20, { type: 'cold' })], gross: 4, engine: 'E0' },
    { key: 'permafrost', name: 'Permafrost', kind: 'notable', text: ['Enemies Chilled by you deal 10% less damage'], mods: [], rules: [rule('chilledDealLess', 10)], gross: 5, engine: 'E2' },
    { key: 'icePlate', name: 'Ice Plate', kind: 'notable', text: ['+12% increased Armour', '+6% to Cold Resistance'], mods: [inc('armor', 12), flat('coldRes', 6)], gross: 5, engine: 'E0' },
    { key: 'shatterpoint', name: 'Shatterpoint', kind: 'notable', text: ['Killing a Chilled enemy has a 15% chance to emit a cold nova (2× effectiveness, radius 70)'], mods: [], rules: [rule('shatterNova', 15)], gross: 6, engine: 'E2' },
    {
      key: 'mastery', name: 'Rime Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E2',
      choices: [
        choice('Chill slows 15 points more', [], [rule('chillEffect', 15)]),
        choice('Exposures you apply last 2 seconds longer', [], [rule('exposureDuration', 2)]),
        choice('+20% Cold Damage against Chilled enemies', [], [rule('damageVsChilled', 20, { type: 'cold' })]),
      ],
    },
    {
      key: 'absoluteZero', name: 'Absolute Zero', kind: 'keystone', engine: 'E1', gross: 30, price: 10, excludes: ['pyreDoctrine', 'stormbound'],
      text: ['25% more Damage against Chilled enemies', 'Your Chill slows by 40%', '20% less Damage against enemies that are not Chilled'],
      mods: [], rules: [rule('moreVsChilled', 25), rule('chillEffectSet', 40), rule('lessVsUnchilled', 20)],
    },
  ],
  void: [
    { key: 'gate', name: 'Gate of Entropy', kind: 'gate', text: ['+14% increased Void Damage', '+10% increased Damage over Time'], mods: [inc('voidDamage', 14), inc('damageOverTime', 10)], gross: 4, engine: 'E1' },
    { key: 'entropy', name: 'Entropy', kind: 'notable', text: ['+14% increased Void Damage', '+12% increased Damage over Time'], mods: [inc('voidDamage', 14), inc('damageOverTime', 12)], gross: 5, engine: 'E1' },
    { key: 'rottingTouch', name: 'Rotting Touch', kind: 'notable', text: ['Decay lasts 2 seconds longer', 'Decay deals 20% more damage'], mods: [], rules: [rule('decayDuration', 2), rule('decayEffect', 20)], gross: 5, engine: 'E1' },
    { key: 'hollowLens', name: 'Hollow Lens', kind: 'notable', text: ['+6 Void Penetration', '+6 Physical Penetration'], mods: [flat('voidPen', 6), flat('physicalPen', 6)], gross: 6, engine: 'E1' },
    { key: 'sunderingMark', name: 'Sundering Mark', kind: 'notable', text: ['Exposures you apply are 4 points stronger'], mods: [], rules: [rule('exposureEffect', 4)], gross: 5, engine: 'E1' },
    { key: 'gravitysGrip', name: "Gravity's Grip", kind: 'notable', text: ['Pull effects are 40% stronger', '+10% increased Area of Effect'], mods: [inc('area', 10)], rules: [rule('pullEffect', 40)], gross: 4, engine: 'E1' },
    { key: 'soulTithe', name: 'Soul Tithe', kind: 'notable', text: ['3% of Void Damage dealt is restored as Focus (at most 6 per second)'], mods: [], rules: [rule('focusLeech', 3, { type: 'void' })], gross: 5, engine: 'E2' },
    { key: 'concussion', name: 'Concussion', kind: 'notable', text: ['+14% increased Physical Damage', '+25% increased Knockback'], mods: [inc('physicalDamage', 14)], rules: [rule('knockback', 25)], gross: 5, engine: 'E1' },
    { key: 'witheringGaze', name: 'Withering Gaze', kind: 'notable', text: ['Withered you apply gains 1 more stack (within the 25-point exposure cap)'], mods: [], rules: [rule('witherStacks', 1)], gross: 6, engine: 'E2' },
    { key: 'lastWhisper', name: 'Last Whisper', kind: 'notable', text: ['Enemies you kill while Decayed explode for 8% of their Life as Void Damage'], mods: [], rules: [rule('decayedExplode', 8)], gross: 6, engine: 'E2' },
    {
      key: 'mastery', name: 'Hollow Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E1',
      choices: [
        choice('Decay stacks 2 more times', [], [rule('decayStacks', 2)]),
        choice('+10 Physical Penetration', [flat('physicalPen', 10)]),
        choice('+4 Focus per Kill', [flat('focusOnKill', 4)], [], 4),
      ],
    },
    {
      key: 'hollowPact', name: 'Hollow Pact', kind: 'keystone', engine: 'E1', gross: 32, price: 13,
      text: ['Decay and all Damage over Time deal 30% more', 'Decay stacks 3 more times', '25% less maximum Life'],
      mods: [more('damageOverTime', 30), more('maxLife', -25)], rules: [rule('decayStacks', 3)],
    },
    {
      key: 'razorDoctrine', name: 'Razor Doctrine', kind: 'keystone', engine: 'E1', gross: 25, price: 12,
      text: ['+15 to the Penetration cap (55)', '25% less Area of Effect', 'Skills cost 15% more Focus'],
      mods: [more('area', -25)], rules: [rule('penCap', 15), rule('focusCost', 15)],
    },
  ],
  arcana: [
    { key: 'gate', name: 'Gate of Insight', kind: 'gate', text: ['+9% increased Spell Damage', '+20 to maximum Focus'], mods: [inc('spellDamage', 9), flat('maxFocus', 20)], gross: 5, engine: 'E0' },
    { key: 'arcaneSurge', name: 'Arcane Surge', kind: 'notable', text: ['+16% increased Spell Damage'], mods: [inc('spellDamage', 16)], gross: 5, engine: 'E0' },
    { key: 'honedEdge', name: 'Honed Edge', kind: 'notable', text: ['+24% increased Critical Strike Chance', '+12 to Critical Strike Multiplier'], mods: [inc('critChance', 24), flat('critMultiplier', 12)], gross: 7, engine: 'E0' },
    { key: 'expanse', name: 'Expanse', kind: 'notable', text: ['+14% increased Area of Effect', '+30% increased Area Damage'], mods: [inc('area', 14), inc('areaDamage', 30)], gross: 5, engine: 'E1' },
    { key: 'volley', name: 'Volley', kind: 'notable', text: ['Projectile skills fire 1 additional Projectile', '10% less Projectile Damage'], mods: [flat('extraProjectiles', 1), more('projectileDamage', -10)], gross: 6, engine: 'E1' },
    { key: 'splittingThought', name: 'Splitting Thought', kind: 'notable', text: ['+20% increased Projectile Damage', 'Projectiles Pierce 1 additional enemy'], mods: [inc('projectileDamage', 20), flat('pierce', 1)], gross: 5, engine: 'E1' },
    { key: 'practicedHand', name: 'Practiced Hand', kind: 'notable', text: ['+10% increased Cooldown Recovery Rate', '+12% increased Area of Effect'], mods: [inc('cooldownRecovery', 10), inc('area', 12)], gross: 5, engine: 'E0' },
    { key: 'deepPools', name: 'Deep Pools', kind: 'notable', text: ['+40 to maximum Focus', '+25% increased Focus Regeneration'], mods: [flat('maxFocus', 40), inc('focusRegen', 25)], gross: 5, engine: 'E0' },
    { key: 'reservoirOfEchoes', name: 'Reservoir of Echoes', kind: 'notable', text: ['Echoes (augments, uniques, Echo Sigil) deal 20% more damage'], mods: [], rules: [rule('echoDamage', 20)], gross: 5, engine: 'E2' },
    { key: 'primaryPractice', name: 'Primary Practice', kind: 'notable', text: ['Your first loadout skill gains 1 augment slot', 'Your other skills deal 5% less damage'], mods: [], rules: [rule('augmentSlot', 1), rule('otherSkillsLess', 5)], gross: 7, price: 1, engine: 'E2' },
    {
      key: 'mastery', name: 'Spell Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E0',
      choices: [
        choice('+8% increased Cast Speed', [inc('castSpeed', 8)]),
        choice('+14% increased Area of Effect, +20% increased Area Damage', [inc('area', 14), inc('areaDamage', 20)], [], 4),
        choice('+40% increased Projectile Damage', [inc('projectileDamage', 40)], [], 4),
      ],
    },
    {
      key: 'glassOrrery', name: 'Glass Orrery', kind: 'keystone', engine: 'E0', gross: 35, price: 20, excludes: ['wardedThrone', 'ironMind'],
      text: ['35% more Spell Damage', '40% less maximum Life'],
      mods: [more('spellDamage', 35), more('maxLife', -40)],
    },
    {
      key: 'echoCascade', name: 'Echo Cascade', kind: 'keystone', engine: 'E2', gross: 30, price: 12,
      text: ['Every skill echoes once after 0.4 seconds at 60% damage, for no Focus', 'Skills cost 30% more Focus', 'Cooldowns are 20% longer'],
      mods: [more('cooldownRecovery', -100 / 6)], rules: [rule('echoAll', 60), rule('focusCost', 30)],
    },
    {
      key: 'gamblersEdge', name: "Gambler's Edge", kind: 'keystone', engine: 'E0', gross: 30, price: 10, excludes: ['perfectTempo'],
      text: ['+100% increased Critical Strike Chance', '+50 to Critical Strike Multiplier', 'Non-critical hits deal 25% less damage'],
      mods: [inc('critChance', 100), flat('critMultiplier', 50)], rules: [rule('nonCritLess', 25)],
    },
  ],
  vitality: [
    { key: 'gate', name: 'Gate of Marrow', kind: 'gate', text: ['+8% increased maximum Life', 'Regenerate 0.6 Life per second'], mods: [inc('maxLife', 8), flat('lifeRegen', 0.6)], gross: 4, engine: 'E0' },
    { key: 'haleBody', name: 'Hale Body', kind: 'notable', text: ['+10% increased maximum Life', '+20 to maximum Life'], mods: [inc('maxLife', 10), flat('maxLife', 20)], gross: 5, engine: 'E0' },
    { key: 'quickRecovery', name: 'Quick Recovery', kind: 'notable', text: ['+25% increased Flask Effect', 'Flasks gain a charge every 30 kills'], mods: [inc('flaskEffect', 25)], rules: [rule('flaskChargePerKills', 30)], gross: 5, engine: 'E1' },
    { key: 'bloodiedResolve', name: 'Bloodied Resolve', kind: 'notable', text: ['Life Flasks also grant 15% less Damage Taken for 2 seconds'], mods: [], rules: [rule('flaskGuard', 15)], gross: 4, engine: 'E2' },
    { key: 'secondWind', name: 'Second Wind', kind: 'notable', text: ['Life per Kill is doubled', '+2 Life per Kill'], mods: [flat('lifeOnKill', 2)], rules: [rule('lifeOnKillMore', 100)], gross: 4, engine: 'E0' },
    { key: 'sprinter', name: 'Sprinter', kind: 'notable', text: ['+10% increased Movement Speed', '+20% increased Pickup Radius'], mods: [inc('moveSpeed', 10), inc('pickupRadius', 20)], gross: 5, engine: 'E0' },
    { key: 'steadyBreath', name: 'Steady Breath', kind: 'notable', text: ['Regenerate 1.2% of maximum Life per second'], mods: [], rules: [rule('regenPercent', 1.2)], gross: 4, engine: 'E0' },
    { key: 'hardy', name: 'Hardy', kind: 'notable', text: ['+1% increased maximum Life per 20 Strength'], mods: [], rules: [rule('lifePerStr', 20)], gross: 5, engine: 'E0' },
    { key: 'pulseOfLife', name: 'Pulse of Life', kind: 'notable', text: ['Every 12 kills restore 6% of maximum Life'], mods: [], rules: [rule('pulseEveryKills', 12)], gross: 5, engine: 'E2' },
    { key: 'rejuvenatingSurge', name: 'Rejuvenating Surge', kind: 'notable', text: ['Focus Flasks also restore 10% of maximum Life', 'Flasks last 20% longer'], mods: [], rules: [rule('focusFlaskLife', 10), rule('flaskDuration', 20)], gross: 4, engine: 'E1' },
    {
      key: 'mastery', name: 'Heart Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E0',
      choices: [
        choice('+20% increased Flask Effect', [inc('flaskEffect', 20)], [], 3.3),
        choice('+8 Life per Kill', [flat('lifeOnKill', 8)], [], 4),
        choice('Regenerate 1.5% of maximum Life per second', [], [rule('regenPercent', 1.5)]),
      ],
    },
    {
      key: 'unendingVigil', name: 'Unending Vigil', kind: 'keystone', engine: 'E1', gross: 28, price: 14,
      text: ['Regenerate 3% of maximum Life per second (6% while below 50% Life)', 'You cannot use Life Flasks', '15% less maximum Life'],
      mods: [more('maxLife', -15)], rules: [rule('regenPercent', 3), rule('regenLowLife', 3), rule('noLifeFlasks', 1)],
    },
    {
      key: 'wanderersStride', name: "Wanderer's Stride", kind: 'keystone', engine: 'E1', gross: 22, price: 12,
      text: ['+25% increased Movement Speed', '+30% increased Pickup Radius', 'Phase Stride and Rift Step recover 25% faster', '25% less Projectile range and Area of Effect'],
      mods: [inc('moveSpeed', 25), inc('pickupRadius', 30), more('area', -25)], rules: [rule('blinkRecovery', 25), rule('rangeLess', 25)],
    },
  ],
  bulwark: [
    { key: 'gate', name: 'Gate of Plate', kind: 'gate', text: ['+8% increased Armour and Evasion Rating', '+12 to maximum Life'], mods: [inc('armor', 8), inc('evasion', 8), flat('maxLife', 12)], gross: 4, engine: 'E0' },
    { key: 'platedSkin', name: 'Plated Skin', kind: 'notable', text: ['+20% increased Armour', '+4% increased maximum Life'], mods: [inc('armor', 20), inc('maxLife', 4)], gross: 6, engine: 'E0' },
    { key: 'fleetFooting', name: 'Fleet Footing', kind: 'notable', text: ['+20% increased Evasion Rating', '+4% increased Movement Speed'], mods: [inc('evasion', 20), inc('moveSpeed', 4)], gross: 5, engine: 'E0' },
    { key: 'prismaticSkin', name: 'Prismatic Skin', kind: 'notable', text: ['+6% to all Resistances'], mods: [flat('allRes', 6)], gross: 4, engine: 'E0' },
    { key: 'overcap', name: 'Overcap', kind: 'notable', text: ['+3% to maximum Resistances', '+8% to all Resistances'], mods: [flat('maxResistance', 3), flat('allRes', 8)], gross: 6, engine: 'E1' },
    { key: 'brace', name: 'Brace', kind: 'notable', text: ['Armour is 30% more effective against hits above 20% of your Life'], mods: [], rules: [rule('armourBigHits', 30)], gross: 6, engine: 'E2' },
    { key: 'slippery', name: 'Slippery', kind: 'notable', text: ['+6 points to chance to Evade (the cap still applies)', '+10% increased Evasion Rating'], mods: [inc('evasion', 10)], rules: [rule('evadeChance', 6)], gross: 6, engine: 'E0' },
    { key: 'barrierStudy', name: 'Barrier Study', kind: 'notable', text: ['Wards and barriers are 25% stronger (Cinder Ward cap 60% → 66%)'], mods: [], rules: [rule('wardEffect', 25)], gross: 5, engine: 'E1' },
    { key: 'heavyPlate', name: 'Heavy Plate', kind: 'notable', text: ['Armour counts 8 instead of 10 per point of damage'], mods: [], rules: [rule('armourFormula', 8)], gross: 6, engine: 'E1' },
    { key: 'elementalVeil', name: 'Elemental Veil', kind: 'notable', text: ['+5% to Void Resistance', '+3% to Fire, Cold and Lightning Resistances'], mods: [flat('voidRes', 5), flat('fireRes', 3), flat('coldRes', 3), flat('lightningRes', 3)], gross: 5, engine: 'E0' },
    {
      key: 'mastery', name: 'Plate Attunement', kind: 'mastery', text: ['Choose one rider'], mods: [], gross: 5, engine: 'E0',
      choices: [
        choice('+20% increased Armour', [inc('armor', 20)]),
        choice('+20% increased Evasion Rating', [inc('evasion', 20)]),
        choice('+10% to all Resistances', [flat('allRes', 10)]),
      ],
    },
    {
      key: 'eternalBastion', name: 'Eternal Bastion', kind: 'keystone', engine: 'E2', gross: 28, price: 12, excludes: ['phantomWeave'],
      text: ['Armour applies to Elemental Damage at 50% effectiveness', '+30% increased Armour', 'Your Evasion Rating is zero'],
      mods: [inc('armor', 30), more('evasion', -100)], rules: [rule('armourVsElements', 50)],
    },
    {
      key: 'phantomWeave', name: 'Phantom Weave', kind: 'keystone', engine: 'E1', gross: 28, price: 12, excludes: ['eternalBastion'],
      text: ['+10 points to the Evade cap (85%)', '+40% increased Evasion Rating', 'You cannot gain Armour'],
      mods: [inc('evasion', 40), more('armor', -100)], rules: [rule('evadeCap', 10)],
    },
    {
      key: 'wardedThrone', name: 'Warded Throne', kind: 'keystone', engine: 'E1', gross: 25, price: 10, excludes: ['glassOrrery'],
      // First-pass price 10u: "20% less damage" is 20u on the ledger, so the number that goes down is 10% (passive-tree.md 1.2).
      text: ['+8% to maximum Resistances (83%)', '+25% to all Resistances', '10% less Damage dealt'],
      mods: [flat('maxResistance', 8), flat('allRes', 25), more('spellDamage', -10)],
    },
  ],
  hub: [
    { key: 'spark', name: 'Spark', kind: 'start', text: ['+10 to Intelligence', '+5 to Strength', '+5 to Dexterity', 'Lights with your first allocated node'], mods: [flat('int', 10), flat('str', 5), flat('dex', 5)], gross: 4, engine: 'E0' },
    { key: 'frostfireGate', name: 'Frostfire Gate', kind: 'notable', text: ['15% of Fire Damage is converted to Cold (modifiers of both apply)', '+6% increased Fire and Cold Damage'], mods: [inc('fireDamage', 6), inc('coldDamage', 6)], rules: [rule('convert', 15, { type: 'fire', to: 'cold' })], gross: 6, engine: 'E2' },
    { key: 'riftSpark', name: 'Rift Spark', kind: 'notable', text: ['10% of Lightning Damage is converted to Void', '+10% increased Lightning Damage'], mods: [inc('lightningDamage', 10)], rules: [rule('convert', 10, { type: 'lightning', to: 'void' })], gross: 6, engine: 'E2' },
    { key: 'mindAndBlood', name: 'Mind and Blood', kind: 'notable', text: ['+20 to maximum Focus', '+4% increased maximum Life', '+1 Focus per Kill'], mods: [flat('maxFocus', 20), inc('maxLife', 4), flat('focusOnKill', 1)], gross: 5, engine: 'E0' },
    {
      key: 'ironMind', name: 'Iron Mind', kind: 'keystone', engine: 'E2', gross: 28, price: 14, excludes: ['glassOrrery'],
      text: ['30% of Damage taken is drawn from Focus first', '50% less Focus Regeneration', '10% less maximum Life'],
      mods: [more('focusRegen', -50), more('maxLife', -10)], rules: [rule('damageFromFocus', 30)],
    },
    {
      key: 'perfectTempo', name: 'Perfect Tempo', kind: 'keystone', engine: 'E0', gross: 30, price: 18, excludes: ['gamblersEdge'],
      text: ['+35% increased Cast Speed', '+25% increased Cooldown Recovery Rate', '20% less Damage dealt'],
      mods: [inc('castSpeed', 35), inc('cooldownRecovery', 25), more('spellDamage', -20)],
    },
  ],
  bridge: [
    { key: 'overcharge', name: 'Overcharge', kind: 'bridge', text: ['+10% increased Fire and Lightning Damage', '+2% increased Cast Speed'], mods: [inc('fireDamage', 10), inc('lightningDamage', 10), inc('castSpeed', 2)], gross: 5, engine: 'E0' },
    { key: 'staticIce', name: 'Static Ice', kind: 'bridge', text: ['Shocks and Chills you cause are 4 points stronger'], mods: [], rules: [rule('shockEffect', 4), rule('chillEffect', 4)], gross: 5, engine: 'E1' },
    { key: 'frostPlate', name: 'Frost Plate', kind: 'bridge', text: ['+10% increased Armour', '+5% to Cold Resistance'], mods: [inc('armor', 10), flat('coldRes', 5)], gross: 4, engine: 'E0' },
    { key: 'ironblood', name: 'Ironblood', kind: 'bridge', text: ['+8% increased maximum Life', '+10% increased Armour'], mods: [inc('maxLife', 8), inc('armor', 10)], gross: 5, engine: 'E0' },
    { key: 'bloodRite', name: 'Blood Rite', kind: 'bridge', text: ['+6% increased maximum Life', '+10% increased Damage over Time'], mods: [inc('maxLife', 6), inc('damageOverTime', 10)], gross: 5, engine: 'E1' },
    { key: 'entropyLens', name: 'Entropy Lens', kind: 'bridge', text: ['+10% increased Void Damage', 'Exposures you apply are 3 points stronger'], mods: [inc('voidDamage', 10)], rules: [rule('exposureEffect', 3)], gross: 5, engine: 'E1' },
    { key: 'kindledWill', name: 'Kindled Will', kind: 'bridge', text: ['+10% increased Spell Damage', '+10% increased Fire Damage'], mods: [inc('spellDamage', 10), inc('fireDamage', 10)], gross: 5, engine: 'E0' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Small-node families (2.3): one stat line each, about 1u on the ledger. Index 0 is the spine rhythm (the first three smalls).
// ---------------------------------------------------------------------------------------------

export interface SmallFamily {
  text: string;
  mods: PassiveMod[];
}

const fam = (text: string, ...mods: PassiveMod[]): SmallFamily => ({ text, mods });

export const FAMILIES: Record<'hub' | PassiveSector, SmallFamily[]> = {
  fire: [
    fam('+4% increased Fire Damage', inc('fireDamage', 4)),
    fam('+3% chance to Ignite, +3% increased Fire Damage', flat('igniteChance', 3), inc('fireDamage', 3)),
    fam('+10% increased Damage over Time', inc('damageOverTime', 10)),
    fam('+2.5% to Fire Resistance', flat('fireRes', 2.5)),
  ],
  lightning: [
    fam('+4% increased Lightning Damage', inc('lightningDamage', 4)),
    fam('+3% chance to Shock, +3% increased Lightning Damage', flat('shockChance', 3), inc('lightningDamage', 3)),
    fam('+1% increased Cast Speed', inc('castSpeed', 1)),
    fam('+2.5% to Lightning Resistance', flat('lightningRes', 2.5)),
  ],
  cold: [
    fam('+4% increased Cold Damage', inc('coldDamage', 4)),
    fam('+3% chance to Chill, +3% increased Cold Damage', flat('chillChance', 3), inc('coldDamage', 3)),
    fam('+6% increased Area of Effect', inc('area', 6)),
    fam('+2.5% to Cold Resistance', flat('coldRes', 2.5)),
  ],
  void: [
    fam('+4% increased Void Damage', inc('voidDamage', 4)),
    fam('+4% increased Physical Damage', inc('physicalDamage', 4)),
    fam('+10% increased Damage over Time', inc('damageOverTime', 10)),
    fam('+2 Void Penetration', flat('voidPen', 2)),
    fam('+2.5% to Void Resistance', flat('voidRes', 2.5)),
  ],
  arcana: [
    fam('+3% increased Spell Damage', inc('spellDamage', 3)),
    fam('+6% increased Critical Strike Chance', inc('critChance', 6)),
    fam('+4 to Critical Strike Multiplier', flat('critMultiplier', 4)),
    fam('+7% increased Area of Effect', inc('area', 7)),
    fam('+5 to Intelligence', flat('int', 5)),
    fam('+10 to maximum Focus', flat('maxFocus', 10)),
  ],
  vitality: [
    fam('+2% increased maximum Life', inc('maxLife', 2)),
    fam('+5 to Strength', flat('str', 5)),
    fam('Regenerate 1 Life per second', flat('lifeRegen', 1)),
    fam('+6% increased Flask Effect', inc('flaskEffect', 6)),
    fam('+1% increased Movement Speed, +4% increased Pickup Radius', inc('moveSpeed', 1), inc('pickupRadius', 4)),
  ],
  bulwark: [
    fam('+4% increased Armour', inc('armor', 4)),
    fam('+4% increased Evasion Rating', inc('evasion', 4)),
    fam('+2.5% to Fire Resistance', flat('fireRes', 2.5)),
    fam('+5 to Dexterity', flat('dex', 5)),
    fam('+2% increased Armour and Evasion Rating', inc('armor', 2), inc('evasion', 2)),
    fam('+20 to maximum Life', flat('maxLife', 20)),
    fam('+2.5% to Cold Resistance', flat('coldRes', 2.5)),
    fam('+2.5% to Lightning Resistance', flat('lightningRes', 2.5)),
  ],
  hub: [
    fam('+5 to Intelligence', flat('int', 5)),
    fam('+5 to Strength', flat('str', 5)),
    fam('+5 to Dexterity', flat('dex', 5)),
    fam('+2 to all Attributes', flat('str', 2), flat('dex', 2), flat('int', 2)),
  ],
};

// ---------------------------------------------------------------------------------------------
// Sector shapes (2.1): rows 0 (gate side) to 9 (rim), column 0 the spine, columns ±1 and ±2 the spurs (− counter-clockwise).
// 's' is a small node; anything else is the key of a named node of the sector.
// ---------------------------------------------------------------------------------------------

export interface SpurSpec {
  col: -2 | -1 | 1 | 2;
  /** First row: the spur's first node links sideways to the node at (from, the column one step nearer the spine). */
  from: number;
  items: string[];
}

export interface SectorSpec {
  /** Rows 0 to 9: the gate links to row 0, the keystone sits on the rim. */
  spine: string[];
  spurs: SpurSpec[];
}

/** Every spine: three smalls of the rhythm, a notable, two smalls, a notable, a small, the mastery, the keystone (12 points to the rim). */
const spine = (n1: string, n2: string, keystone: string): string[] => ['s', 's', 's', n1, 's', 's', n2, 's', 'mastery', keystone];

export const SECTORS: Record<PassiveSector, SectorSpec> = {
  fire: {
    spine: spine('kindle', 'slowBurn', 'pyreDoctrine'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'emberReservoir', 's', 'scorchWard'] },
      { col: 1, from: 1, items: ['s', 's', 'searingEdge', 's', 'lastEmber'] },
      { col: -2, from: 4, items: ['s', 's', 's', 'wildfire'] },
      { col: 2, from: 4, items: ['s', 's', 's', 's', 'pyroclasm'] },
    ],
  },
  lightning: {
    spine: spine('staticCharge', 'conductiveThoughts', 'stormbound'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'groundingRod', 's', 'overload'] },
      { col: 1, from: 1, items: ['s', 's', 'liveWire', 's', 'surgeOfStatic'] },
      { col: -2, from: 4, items: ['s', 's', 's', 'tempestReach'] },
      { col: 2, from: 4, items: ['s', 's', 's', 's', 'quickenedPulse'] },
    ],
  },
  cold: {
    spine: spine('hoarfrost', 'brittleBones', 'absoluteZero'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'icePlate', 's', 'permafrost'] },
      { col: 1, from: 1, items: ['s', 's', 'glacialEdge', 's', 'frostbound'] },
      { col: -2, from: 4, items: ['s', 's', 's', 'wintersPatience'] },
      { col: 2, from: 4, items: ['s', 's', 's', 's', 'shatterpoint'] },
    ],
  },
  bulwark: {
    spine: spine('platedSkin', 'prismaticSkin', 'eternalBastion'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'fleetFooting', 's', 's', 'slippery'] },
      { col: 1, from: 1, items: ['s', 's', 'heavyPlate', 's', 'brace'] },
      { col: -2, from: 4, items: ['s', 's', 'elementalVeil', 's', 's', 'phantomWeave'] },
      { col: 2, from: 4, items: ['s', 's', 'overcap', 's', 's', 'wardedThrone'] },
      { col: 1, from: 7, items: ['s', 's', 'barrierStudy'] },
    ],
  },
  vitality: {
    spine: spine('haleBody', 'hardy', 'unendingVigil'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'secondWind', 's', 's', 'pulseOfLife'] },
      { col: 1, from: 1, items: ['s', 's', 'quickRecovery', 's', 'rejuvenatingSurge'] },
      { col: -2, from: 4, items: ['s', 's', 'sprinter', 's', 's', 'wanderersStride'] },
      { col: 2, from: 4, items: ['s', 's', 'steadyBreath', 's', 's', 'bloodiedResolve'] },
    ],
  },
  void: {
    spine: spine('entropy', 'hollowLens', 'hollowPact'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'concussion', 's', 'gravitysGrip'] },
      { col: 1, from: 1, items: ['s', 's', 'rottingTouch', 's', 'sunderingMark'] },
      { col: -2, from: 4, items: ['s', 's', 'soulTithe', 's', 's', 'razorDoctrine'] },
      { col: 2, from: 4, items: ['s', 'witheringGaze', 's', 'lastWhisper'] },
    ],
  },
  arcana: {
    spine: spine('arcaneSurge', 'honedEdge', 'glassOrrery'),
    spurs: [
      { col: -1, from: 1, items: ['s', 's', 'deepPools', 's', 'practicedHand'] },
      { col: 1, from: 1, items: ['s', 's', 'expanse', 's', 'splittingThought'] },
      { col: -2, from: 4, items: ['s', 's', 'reservoirOfEchoes', 's', 's', 'echoCascade'] },
      { col: 2, from: 4, items: ['s', 's', 'volley', 's', 's', 'gamblersEdge'] },
      { col: -1, from: 7, items: ['s', 's', 'primaryPractice'] },
    ],
  },
};

/** The row of the spurs' outer columns where a bridge attaches (mid-radius). */
export const BRIDGE_ROW = 4;

/** Adjacent-sector bridges, clockwise: each links the first sector's column +2 and the second's column −2 at BRIDGE_ROW. */
export const BRIDGES: readonly { key: string; between: readonly [PassiveSector, PassiveSector] }[] = [
  { key: 'overcharge', between: ['fire', 'lightning'] },
  { key: 'staticIce', between: ['lightning', 'cold'] },
  { key: 'frostPlate', between: ['cold', 'bulwark'] },
  { key: 'ironblood', between: ['bulwark', 'vitality'] },
  { key: 'bloodRite', between: ['vitality', 'void'] },
  { key: 'entropyLens', between: ['void', 'arcana'] },
  { key: 'kindledWill', between: ['arcana', 'fire'] },
];

/**
 * The hub (2.1): Spark in the centre touches all seven gates; a ring of seven smalls joins each pair of adjacent gates (ring small k
 * sits between sector k and k + 1); three cross-hub notables hang inside the ring between two ring smalls; the two hub keystones are
 * reached from Spark through two smalls each. `at` is a ring position (sector index + 0.5 = between sector k and k + 1).
 */
export const CROSS_HUB: readonly { key: string; between: readonly [PassiveSector, PassiveSector]; ring: readonly [number, number]; at: number }[] = [
  { key: 'frostfireGate', between: ['fire', 'cold'], ring: [0, 1], at: 1.5 },
  { key: 'riftSpark', between: ['lightning', 'void'], ring: [0, 5], at: 6.5 },
  { key: 'mindAndBlood', between: ['arcana', 'vitality'], ring: [4, 5], at: 4.5 },
];
export const HUB_KEYSTONES: readonly { key: string; at: number }[] = [
  { key: 'perfectTempo', at: 0.5 },
  { key: 'ironMind', at: 3.5 },
];
