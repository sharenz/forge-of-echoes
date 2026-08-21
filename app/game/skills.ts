import type { SkillDefinition } from "./config/schema";
import { resolveCastTimeSeconds } from "./action-timing";

export interface ResolvedSkillDefinition extends SkillDefinition {
  level: number;
  maxLevel: number;
  projectileCount: number;
  piercing: number;
  maxCharges: number;
  recharge: number;
  castTime: number;
  cooldown: number;
  duration: number;
  damageReduction: number;
}

export function resolveSkillDefinition(
  definition: SkillDefinition,
  requestedLevel: number,
  cooldownMultiplier = 1,
  castSpeedMultiplier = 1,
): ResolvedSkillDefinition {
  const maxLevel = definition.progression?.maxLevel ?? 1;
  const level = Math.min(maxLevel, Math.max(1, Math.floor(requestedLevel)));
  const levelsAfterFirst = level - 1;
  const damage = definition.damage
    ? {
        ...definition.damage,
        effectiveness: definition.damage.effectiveness
          + (definition.progression?.damageEffectivenessPerLevel ?? 0) * levelsAfterFirst,
      }
    : undefined;
  return {
    ...definition,
    damage,
    level,
    maxLevel,
    projectileCount: Math.max(0, Math.round(
      (definition.projectileCount ?? 0)
      + (definition.progression?.projectilesPerLevel ?? 0) * levelsAfterFirst
      + Math.floor(level / (definition.progression?.projectilesEveryLevels ?? Number.POSITIVE_INFINITY)),
    )),
    piercing: Math.max(0, (definition.piercing ?? 0) + Math.floor(level / (definition.progression?.piercingEveryLevels ?? Number.POSITIVE_INFINITY))),
    maxCharges: Math.max(0, (definition.maxCharges ?? 0) + Math.floor(level / (definition.progression?.chargeEveryLevels ?? Number.POSITIVE_INFINITY))),
    recharge: definition.recharge === undefined
      ? 0
      : Math.max(0.1, (definition.recharge + (definition.progression?.rechargePerLevel ?? 0) * levelsAfterFirst) * cooldownMultiplier),
    castTime: definition.castTime === undefined
      ? 0
      : resolveCastTimeSeconds(definition.castTime, castSpeedMultiplier),
    cooldown: definition.cooldown === undefined
      ? 0
      : Math.max(0.1, (definition.cooldown + (definition.progression?.cooldownPerLevel ?? 0) * levelsAfterFirst) * cooldownMultiplier),
    duration: Math.max(0, (definition.duration ?? 0) + (definition.progression?.durationPerLevel ?? 0) * levelsAfterFirst),
    damageReduction: Math.min(80, Math.max(0, (definition.damageReduction ?? 0) + (definition.progression?.damageReductionPerLevel ?? 0) * levelsAfterFirst)),
  };
}
