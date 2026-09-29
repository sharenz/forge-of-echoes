// Sorceress skills (GAME_SPEC §4). The rules own the numbers (resolved into SkillRuntimeDef with every
// player modifier applied); the sim owns the behaviour. Values are rank 1 → rank 20.
import type { SkillId } from '../../contracts/content';
import type { SkillDef } from './types';

export const MAX_SKILL_RANK = 20;

/**
 * Every hit rolls × [min, max] around the average the tooltips show (the sim rolls the same range);
 * the midpoint must stay 1 so the displayed average is truthful.
 */
export const DAMAGE_ROLL = { min: 0.8, max: 1.2 } as const;
if (Math.abs((DAMAGE_ROLL.min + DAMAGE_ROLL.max) / 2 - 1) > 1e-9) throw new Error('DAMAGE_ROLL must be symmetric around 1');

/**
 * A single-bolt skill that gains extra projectiles (Ruinheart Band) fans them out: 0.12 rad per
 * extra bolt, at most 0.6 rad. Resolved into SkillRuntimeDef.spread, so the sim and the tooltip agree.
 */
export const EXTRA_PROJECTILE_FAN = { perProjectile: 0.12, max: 0.6 } as const;

type Spec = Omit<SkillDef, 'id' | 'maxRank' | 'pierce' | 'projectiles' | 'charges' | 'duration' | 'chains'
  | 'distance' | 'damageReduction' | 'cooldown' | 'projectileSpeed' | 'range' | 'spread' | 'radius'>
  & Partial<Pick<SkillDef, 'pierce' | 'projectiles' | 'charges' | 'duration' | 'chains' | 'distance'
    | 'damageReduction' | 'cooldown' | 'projectileSpeed' | 'range' | 'spread' | 'radius'>>;

function skill(id: SkillId, spec: Spec): SkillDef {
  return {
    id,
    maxRank: MAX_SKILL_RANK,
    cooldown: 0,
    charges: 1,
    projectiles: 0,
    pierce: 0,
    projectileSpeed: 0,
    range: 0,
    spread: 0,
    radius: 0,
    duration: 0,
    chains: 0,
    distance: 0,
    damageReduction: 0,
    ...spec,
  };
}

export const SKILLS: Record<SkillId, SkillDef> = {
  emberLance: skill('emberLance', {
    name: 'Ember Lance',
    description: 'Hurls a fast bolt of fire toward the cursor, leaving an ember trail. Your innate basic attack: it costs no Focus.',
    branch: 'basic',
    tier: 1,
    prerequisite: null,
    tags: ['Spell', 'Projectile', 'Fire'],
    damageType: 'fire',
    shape: 'projectile',
    runtimeDamageType: 'fire',
    focusCost: 0,
    castTime: 0.42,
    effectiveness: { lerp: [1.0, 2.3] },
    critChance: 6,
    ailmentChance: 10,
    projectiles: 1,
    pierce: { base: 0, steps: [6, 12, 18] },
    projectileSpeed: 420,
    range: 320,
    projectileNoun: 'bolt',
    flagsFrom: [{ playerFlag: 'lancePierceAll', skillFlag: 'pierceAll', text: 'Pierces every enemy in its path (The Patient Spark)' }],
  }),
  emberNova: skill('emberNova', {
    name: 'Ember Nova',
    description: 'A ring of flames bursts outward from you. Gains flames and pierce as it ranks up.',
    branch: 'destruction',
    tier: 1,
    prerequisite: null,
    tags: ['Spell', 'Projectile', 'Area', 'Fire'],
    damageType: 'fire',
    shape: 'nova',
    runtimeDamageType: 'fire',
    focusCost: 12,
    castTime: 0.55,
    cooldown: 3,
    // GAME_SPEC's target was 0.7 → 1.5. At 0.7 a rank-1 Nova needed four flames per Ashling, so the
    // banked first point bought nothing; at 1.0 each flame hits as hard as a Lance bolt.
    effectiveness: { lerp: [1.0, 1.8] },
    critChance: 5,
    ailmentChance: 15,
    projectiles: { base: 12, every: 1, after: 4, cap: 24 },
    pierce: { base: 1, every: 5, after: 0 },
    projectileSpeed: 260,
    range: 170,
    areaScales: 'range',
    projectileNoun: 'flame',
    flagsFrom: [{ playerFlag: 'novaEcho', skillFlag: 'echo', text: 'Repeats once after 0.4 seconds (Echo of the Matriarch)' }],
  }),
  flameWave: skill('flameWave', {
    name: 'Flame Wave',
    description: 'Sends a fan of slow, wide flame waves that pierce every enemy in their path.',
    branch: 'destruction',
    tier: 2,
    prerequisite: { skillId: 'emberNova', rank: 3 },
    tags: ['Spell', 'Projectile', 'Area', 'Fire'],
    damageType: 'fire',
    shape: 'projectile',
    runtimeDamageType: 'fire',
    focusCost: 16,
    castTime: 0.5,
    cooldown: 4,
    effectiveness: { lerp: [1.1, 2.4] },
    critChance: 5,
    ailmentChance: 25,
    projectiles: { lerp: [5, 9], round: 'floor' },
    pierceAll: true,
    projectileSpeed: 180,
    range: 170,
    spread: 0.9,
    radius: 14,
    areaScales: 'radius',
    projectileNoun: 'wave',
  }),
  rimeShards: skill('rimeShards', {
    name: 'Rime Shards',
    description: 'Fires a tight fan of ice shards that pierce and chill.',
    branch: 'destruction',
    tier: 2,
    prerequisite: { skillId: 'emberNova', rank: 3 },
    tags: ['Spell', 'Projectile', 'Cold'],
    damageType: 'cold',
    shape: 'projectile',
    runtimeDamageType: 'cold',
    focusCost: 8,
    castTime: 0.34,
    effectiveness: { lerp: [0.55, 1.2] },
    critChance: 8,
    ailmentChance: 30,
    projectiles: { base: 3, every: 4, after: 1 },
    pierce: 2,
    projectileSpeed: 360,
    range: 260,
    spread: 0.35,
    projectileNoun: 'shard',
  }),
  arcChain: skill('arcChain', {
    name: 'Arc Chain',
    description: 'Lightning strikes the enemy nearest the cursor, then leaps between nearby enemies.',
    branch: 'destruction',
    tier: 3,
    prerequisite: { skillId: 'rimeShards', rank: 5 },
    tags: ['Spell', 'Chaining', 'Lightning'],
    damageType: 'lightning',
    shape: 'chain',
    runtimeDamageType: 'lightning',
    focusCost: 14,
    castTime: 0.38,
    cooldown: 1,
    effectiveness: { lerp: [0.9, 2.0] },
    critChance: 10,
    ailmentChance: 25,
    chains: { lerp: [3, 8], round: 'floor' },
    range: 240,
    radius: 90,
  }),
  riftStep: skill('riftStep', {
    name: 'Rift Step',
    description: 'Blinks toward the cursor, invulnerable for 0.2 seconds and leaving afterimages. Holds charges that recover one at a time.',
    branch: 'mobility',
    tier: 1,
    prerequisite: null,
    tags: ['Movement', 'Void'],
    damageType: null,
    shape: 'dash',
    runtimeDamageType: 'void',
    focusCost: 8,
    castTime: 0,
    cooldown: 3.5,
    charges: { base: 2, steps: [10, 20] },
    effectiveness: 0,
    critChance: 0,
    ailmentChance: 0,
    distance: { lerp: [90, 120] },
  }),
  cinderWard: skill('cinderWard', {
    name: 'Cinder Ward',
    description: 'Wraps you in embers: you take less damage while they burn adjacent enemies.',
    branch: 'survival',
    tier: 1,
    prerequisite: null,
    tags: ['Spell', 'Buff', 'Duration', 'Fire'],
    damageType: 'fire',
    shape: 'ward',
    runtimeDamageType: 'fire',
    focusCost: 20,
    castTime: 0.3,
    cooldown: { lerp: [14, 9] },
    effectiveness: 0.25,
    critChance: 5,
    ailmentChance: 0,
    duration: { lerp: [4, 7] },
    damageReduction: { lerp: [0.35, 0.55] },
    damageReductionCap: 0.6,
    radius: 40,
    pulseInterval: 0.5,
    areaScales: 'radius',
  }),
};
