import { CHARACTER_CLASSES } from "./config/classes";
import type {
  AttributeKey,
  CharacterStats,
  EquipmentItem,
  ModifierMode,
  PlayerProfile,
  StatKey,
  StatModifier,
} from "./domain";

export interface StatResolution {
  base: number;
  flat: number;
  increased: number;
  more: number[];
  value: number;
}

export interface CharacterStatCalculation {
  stats: CharacterStats;
  modifiers: readonly StatModifier[];
  breakdown: Record<StatKey, StatResolution>;
}

const STAT_KEYS: readonly StatKey[] = [
  "strength", "dexterity", "intelligence", "maxLife", "maxFocus",
  "moveSpeed", "attackDamage", "attackSpeed", "armor", "evadeChance",
];

export function resolveStat(base: number, modifiers: readonly StatModifier[]): StatResolution {
  const flat = modifiers.filter((modifier) => modifier.mode === "flat").reduce((sum, modifier) => sum + modifier.value, 0);
  const increased = modifiers.filter((modifier) => modifier.mode === "increased").reduce((sum, modifier) => sum + modifier.value, 0);
  const more = modifiers.filter((modifier) => modifier.mode === "more").map((modifier) => modifier.value);
  const moreMultiplier = more.reduce((product, value) => product * (1 + value / 100), 1);
  return { base, flat, increased, more, value: (base + flat) * (1 + increased / 100) * moreMultiplier };
}

export function itemModifiers(item: EquipmentItem): StatModifier[] {
  return [
    ...item.baseStats,
    ...item.implicitModifiers,
    ...item.affixes.flatMap((affix) => affix.rolls),
  ];
}

function modifiersFor(stat: StatKey, modifiers: readonly StatModifier[]): StatModifier[] {
  return modifiers.filter((modifier) => modifier.stat === stat);
}

function baseAttribute(classId: NonNullable<PlayerProfile["character"]["classId"]>, attribute: AttributeKey, level: number): number {
  const definition = CHARACTER_CLASSES[classId];
  return definition.startingAttributes[attribute] + definition.attributesPerLevel[attribute] * Math.max(0, level - 1);
}

export function calculateCharacterStats(profile: PlayerProfile): CharacterStatCalculation {
  const classId = profile.character.classId ?? "amazon";
  const classDefinition = CHARACTER_CLASSES[classId];
  const level = profile.character.level;
  const equipped = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const itemModifierList = equipped.flatMap(itemModifiers);
  const classModifiers: StatModifier[] = Object.entries(classDefinition.baseStats).map(([stat, value]) => ({
    stat: stat as StatKey,
    mode: "flat" as ModifierMode,
    value: value ?? 0,
    source: `class:${classId}`,
  }));
  const modifiers = [...classModifiers, ...itemModifierList];

  const strength = resolveStat(baseAttribute(classId, "strength", level), modifiersFor("strength", modifiers)).value;
  const dexterity = resolveStat(baseAttribute(classId, "dexterity", level), modifiersFor("dexterity", modifiers)).value;
  const intelligence = resolveStat(baseAttribute(classId, "intelligence", level), modifiersFor("intelligence", modifiers)).value;

  // Attribute conversions are intentionally centralized here. They create base
  // values; all flat/increased/more modifiers still use the universal formula.
  const bases: Record<StatKey, number> = {
    strength: baseAttribute(classId, "strength", level),
    dexterity: baseAttribute(classId, "dexterity", level),
    intelligence: baseAttribute(classId, "intelligence", level),
    maxLife: 82 + level * 7 + strength * 2,
    maxFocus: 52 + level * 1.5 + intelligence * 1.65,
    moveSpeed: 250 + dexterity * 0.22,
    attackDamage: 9 + level * 1.15 + strength * 0.12 + dexterity * 0.1 + intelligence * 0.08,
    attackSpeed: 1 + dexterity * 0.0025,
    armor: 6 + level * 1.25 + strength * 0.52,
    evadeChance: 2 + level * 0.1 + dexterity * 0.16,
  };

  const breakdown = Object.fromEntries(STAT_KEYS.map((stat) => [stat, resolveStat(bases[stat], modifiersFor(stat, modifiers))])) as Record<StatKey, StatResolution>;
  const stats: CharacterStats = {
    strength: Math.round(strength),
    dexterity: Math.round(dexterity),
    intelligence: Math.round(intelligence),
    maxLife: breakdown.maxLife.value,
    maxFocus: breakdown.maxFocus.value,
    moveSpeed: breakdown.moveSpeed.value,
    attackDamage: breakdown.attackDamage.value,
    attackSpeed: breakdown.attackSpeed.value,
    armor: breakdown.armor.value,
    evadeChance: Math.min(75, breakdown.evadeChance.value),
  };

  return { stats, modifiers, breakdown };
}

export function formatModifier(modifier: Pick<StatModifier, "stat" | "mode" | "value">): string {
  const labels: Record<StatKey, string> = {
    strength: "Strength", dexterity: "Dexterity", intelligence: "Intelligence",
    maxLife: "maximum Life", maxFocus: "maximum Focus", moveSpeed: "movement speed",
    attackDamage: "attack damage", attackSpeed: "attack speed", armor: "armor", evadeChance: "evade chance",
  };
  if (modifier.mode === "flat") return `+${modifier.value} ${labels[modifier.stat]}`;
  return `${modifier.value}% ${modifier.mode} ${labels[modifier.stat]}`;
}
