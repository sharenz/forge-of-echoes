import type { SkillDefinition } from "./config/schema";

export interface ResolvedSkillDefinition extends SkillDefinition {
  level: number;
  maxLevel: number;
  projectileCount: number;
  piercing: number;
  maxCharges: number;
  recharge: number;
  cooldown: number;
}

export function resolveSkillDefinition(definition: SkillDefinition, requestedLevel: number): ResolvedSkillDefinition {
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
    projectileCount: Math.max(0, Math.round((definition.projectileCount ?? 0) + (definition.progression?.projectilesPerLevel ?? 0) * levelsAfterFirst)),
    piercing: Math.max(0, (definition.piercing ?? 0) + Math.floor(level / (definition.progression?.piercingEveryLevels ?? Number.POSITIVE_INFINITY))),
    maxCharges: Math.max(0, (definition.maxCharges ?? 0) + Math.floor(level / (definition.progression?.chargeEveryLevels ?? Number.POSITIVE_INFINITY))),
    recharge: Math.max(0.1, (definition.recharge ?? 0) + (definition.progression?.rechargePerLevel ?? 0) * levelsAfterFirst),
    cooldown: Math.max(0, definition.cooldown ?? 0),
  };
}
