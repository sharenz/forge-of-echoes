import type {
  AffixTag,
  ArenaStatKey,
  CharacterClassId,
  DamageType,
  EquipmentSlot,
  MapModifierId,
  ModifierStatKey,
  SkillAnimationId,
  SkillAudioId,
  SkillVfxId,
  ModifierMode,
  StatKey,
} from "../domain";

export interface ScaledModifierDefinition<TStat extends ModifierStatKey = StatKey> {
  stat: TStat;
  mode: ModifierMode;
  base: number;
  perItemLevel?: number;
  perTier?: number;
  perWave?: number;
}

export interface ItemBaseDefinition {
  id: string;
  name: string;
  slot: EquipmentSlot;
  requiredLevel: number;
  implicit: string;
  baseStats: readonly ScaledModifierDefinition[];
  implicitModifiers: readonly ScaledModifierDefinition[];
  /** Weapon-local attacks per second. Increased attack speed scales this value. */
  weapon?: {
    attacksPerSecond: number;
  };
}

export interface AffixRollDefinition {
  stat: StatKey;
  mode: ModifierMode;
  min: number;
  max: number;
}

export interface AffixTierDefinition {
  /** T1 is the strongest tier. */
  tier: number;
  requiredItemLevel: number;
  weight: number;
  rolls: readonly AffixRollDefinition[];
}

export interface AffixDefinition {
  id: string;
  name: string;
  tag: AffixTag;
  group: string;
  slots: readonly EquipmentSlot[];
  tiers: readonly AffixTierDefinition[];
}

export interface CharacterClassDefinition {
  id: CharacterClassId;
  name: string;
  title: string;
  fantasy: string;
  weapon: string;
  startingAttributes: Record<"strength" | "dexterity" | "intelligence", number>;
  attributesPerLevel: Record<"strength" | "dexterity" | "intelligence", number>;
  baseStats: Partial<Record<StatKey, number>>;
  accent: string;
}

export interface MonsterDefinition {
  id: string;
  name: string;
  behavior: "melee" | "ranged" | "jumper";
  spawnWeight: number;
  weightPerWave?: number;
  weightPerTier?: number;
  minimumWave?: number;
  minimumTier?: number;
  baseLife: number;
  lifePerWave: number;
  speed: { min: number; max: number; perWave: number };
  contactDamage: number;
  contactDamagePerWave: number;
  aggroRange: number;
  armor: number;
  evadeChance: number;
  visual: {
    scale: number;
    body: number;
    accent: number;
  };
  ranged?: {
    preferredRange: number;
    projectileSpeed: number;
    cooldown: number;
    damageEffectiveness: number;
  };
  jump?: {
    cooldown: number;
    distance: number;
    duration: number;
    damageEffectiveness: number;
  };
}

export interface SkillDefinition {
  id: string;
  name: string;
  key: string;
  focusCost: number;
  cooldown?: number;
  maxCharges?: number;
  recharge?: number;
  damage?: {
    type: DamageType;
    /** Multiplier applied directly to the character sheet's average attack damage. */
    effectiveness: number;
    /** Multipliers around the average; their midpoint should remain 1. */
    range: { minMultiplier: number; maxMultiplier: number };
  };
  projectileScale?: number;
  presentation: {
    animation: SkillAnimationId;
    vfx: SkillVfxId;
    audio: SkillAudioId;
  };
  modifiers?: readonly ScaledModifierDefinition[];
}

export interface MapBaseDefinition {
  id: string;
  name: string;
  implicit: string;
}

export interface MapModifierDefinition {
  id: MapModifierId;
  name: string;
  danger: number;
  kind: "threat" | "reward";
  modifiers: readonly ScaledModifierDefinition<ArenaStatKey>[];
  rewardModifiers: readonly ScaledModifierDefinition<ArenaStatKey>[];
}

export type MapModifierConfig = Record<MapModifierId, MapModifierDefinition>;
