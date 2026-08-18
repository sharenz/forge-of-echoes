import type {
  AffixTag,
  CharacterClassId,
  EquipmentSlot,
  MapModifier,
  MapModifierId,
  ModifierMode,
  StatKey,
} from "../domain";

export interface ScaledModifierDefinition {
  stat: StatKey;
  mode: ModifierMode;
  base: number;
  perItemLevel?: number;
}

export interface ItemBaseDefinition {
  id: string;
  name: string;
  slot: EquipmentSlot;
  requiredLevel: number;
  implicit: string;
  baseStats: readonly ScaledModifierDefinition[];
  implicitModifiers: readonly ScaledModifierDefinition[];
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
  baseLife: number;
  lifePerWave: number;
  speed: { min: number; max: number; perWave: number };
  contactDamage: number;
  contactDamagePerWave: number;
  aggroRange: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  key: string;
  focusCost: number;
  cooldown?: number;
  maxCharges?: number;
  recharge?: number;
  modifiers?: readonly ScaledModifierDefinition[];
}

export interface MapBaseDefinition {
  id: string;
  name: string;
  implicit: string;
}

export type MapModifierConfig = Record<MapModifierId, MapModifier>;
