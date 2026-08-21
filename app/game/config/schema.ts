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
  icon: string;
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

export interface MonsterAudioSampleDefinition {
  url: string;
  /** Optional slice of a longer source recording, in seconds. */
  offset?: number;
  duration?: number;
}

export interface MonsterAudioCueDefinition {
  samples: readonly MonsterAudioSampleDefinition[];
  volume: number;
  radius: number;
  maxVoices: number;
  /** Minimum spacing between this cue across the whole archetype. */
  groupCooldownMilliseconds?: number;
  /** Minimum spacing between repeat cues from the same monster. */
  emitterCooldownMilliseconds?: number;
  /** Random playback-rate deviation, e.g. 0.05 produces 0.95–1.05. */
  pitchVariation?: number;
}

export interface MonsterMovementAudioCueDefinition extends MonsterAudioCueDefinition {
  /** Sprite-sheet frames that make contact with the ground. */
  frameEvents: readonly number[];
}

export interface MonsterAudioDefinition {
  movement?: MonsterMovementAudioCueDefinition;
  aggro?: MonsterAudioCueDefinition;
  melee?: MonsterAudioCueDefinition;
  ranged?: MonsterAudioCueDefinition;
  jump?: MonsterAudioCueDefinition;
  hit?: MonsterAudioCueDefinition;
  death?: MonsterAudioCueDefinition;
  projectileImpact?: MonsterAudioCueDefinition;
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
  experience: { base: number; perWave: number; perTier: number };
  visual: {
    /** Public asset URLs are data so an archetype can be reskinned without touching the runtime. */
    sprite: string;
    corpse: string;
    scale: number;
    originY: number;
    body: number;
    accent: number;
    /** Optional animated sprite sheet (one row of frames); replaces `sprite` in the arena when present. */
    sheet?: {
      url: string;
      frameWidth: number;
      frameHeight: number;
      frameCount: number;
      frameRate: number;
      /** Faster playback while chasing the player (defaults to frameRate). */
      aggroFrameRate?: number;
      /** Sheet cells are cropped differently than the static sprite, so they carry their own transform. */
      scale: number;
      originY: number;
    };
  };
  /** Optional cues are deliberately silent when no authored sample exists. */
  sfx: MonsterAudioDefinition;
  ranged?: {
    preferredRange: number;
    projectileSpeed: number;
    projectileRange: number;
    projectileRadius: number;
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
  /** Base time in seconds required by cast animations. Cast speed resolves it at runtime. */
  castTime?: number;
  cooldown?: number;
  maxCharges?: number;
  recharge?: number;
  duration?: number;
  damageReduction?: number;
  damage?: {
    type: DamageType;
    /** Multiplier applied directly to the character sheet's average attack damage. */
    effectiveness: number;
    /** Multipliers around the average; their midpoint should remain 1. */
    range: { minMultiplier: number; maxMultiplier: number };
  };
  projectileScale?: number;
  projectileCount?: number;
  piercing?: number;
  tree: {
    branch: "core" | "destruction" | "survival" | "mobility";
    role: string;
    description: string;
    accent: string;
  };
  progression?: {
    maxLevel: number;
    damageEffectivenessPerLevel?: number;
    projectilesPerLevel?: number;
    projectilesEveryLevels?: number;
    piercingEveryLevels?: number;
    cooldownPerLevel?: number;
    rechargePerLevel?: number;
    chargeEveryLevels?: number;
    durationPerLevel?: number;
    damageReductionPerLevel?: number;
  };
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
  icon: string;
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
