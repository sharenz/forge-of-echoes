// Skill data helpers and the rules constants of the skill rework (docs/power-rework/skills.md 0, 4.1, 9). The element files
// (fire, cold, lightning, void, utility) declare the skills with `skill()`; index.ts assembles SKILLS.
import type { SkillId } from '../../../contracts/content';
import type { AugmentInfo } from '../../../contracts/game';
import type { AugmentDef, SkillDef } from '../types';
import { AUGMENTS } from '../augments';

/** Ranks run 1 to 10 (was 20); effectiveness endpoints are unchanged, so a rank-10 skill equals an old rank-20 one. */
export const MAX_SKILL_RANK = 10;

/** Skill points: 1 at level 1 and 2 per level after (`1 + 2 (L − 1)`). Learning (rank 1), each rank and T1/T2 augments cost 1; T3 costs 2. */
export const SKILL_POINTS = { atLevelOne: 1, perLevel: 2 } as const;

/** Augment rules (skills.md 4.1): tier gates by rank, point costs, slots = floor(rank / 2) up to 5. */
export const AUGMENT_RULES = {
  tierRank: { 1: 2, 2: 5, 3: 8 },
  tierCost: { 1: 1, 2: 1, 3: 2 },
  ranksPerSlot: 2,
  maxSlots: 5,
} as const;

/**
 * Respec (skills.md 9): 4 Scrap per refunded point (a T3 augment, 2 points, costs 8); free below level 20; the first 15
 * refunded points of a character are free. Ember Lance never drops below rank 1.
 */
export const RESPEC = { scrapPerPoint: 4, freeBelowLevel: 20, freePoints: 15 } as const;

/** Every hit rolls × [min, max] around the average the tooltips show (the sim rolls the same range); the midpoint must stay 1. */
export const DAMAGE_ROLL = { min: 0.8, max: 1.2 } as const;
if (Math.abs((DAMAGE_ROLL.min + DAMAGE_ROLL.max) / 2 - 1) > 1e-9) throw new Error('DAMAGE_ROLL must be symmetric around 1');

/**
 * A single-bolt skill that gains extra projectiles (Ruinheart Band) fans them out: 0.12 rad per extra bolt, at most 0.6 rad.
 * Resolved into SkillRuntimeDef.spread, so the sim and the tooltip agree.
 */
export const EXTRA_PROJECTILE_FAN = { perProjectile: 0.12, max: 0.6 } as const;

/** Whether every effect of an augment has an executor (planned primitives ship in SK5/SK6). */
export function augmentAvailable(a: AugmentDef): boolean {
  return a.effects.every((e) => e.k !== 'planned');
}

export function augmentInfo(a: AugmentDef): AugmentInfo {
  return {
    id: a.id,
    name: a.name,
    tier: a.tier,
    cost: AUGMENT_RULES.tierCost[a.tier],
    rankRequired: AUGMENT_RULES.tierRank[a.tier],
    text: a.text,
    excludes: [...(a.excludes ?? [])],
    available: augmentAvailable(a),
  };
}

type Defaulted = 'id' | 'maxRank' | 'pierce' | 'projectiles' | 'charges' | 'duration' | 'chains' | 'distance' | 'damageReduction'
  | 'cooldown' | 'projectileSpeed' | 'range' | 'spread' | 'radius' | 'prerequisite' | 'augments' | 'augmentDefs' | 'available';
export type SkillSpec = Omit<SkillDef, Defaulted> & Partial<Pick<SkillDef, Defaulted>>;

export function skill(id: SkillId, spec: SkillSpec): SkillDef {
  const augmentDefs = AUGMENTS[id] ?? [];
  return {
    id,
    maxRank: MAX_SKILL_RANK,
    prerequisite: null,
    available: true,
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
    augmentDefs,
    augments: augmentDefs.map(augmentInfo),
  };
}

/**
 * A roster skill whose behaviour ships in a later slice (SK2 to SK4): its numbers are the first pass of skills.md 3 so the
 * tooltip and the planning tools can read them, but it cannot be learned until `available` flips.
 */
export function plannedSkill(id: SkillId, spec: SkillSpec): SkillDef {
  return { ...skill(id, spec), available: false };
}
