import { CHARACTER_CLASSES } from "./config/classes";
import { ITEM_BASES_BY_ID, type ItemBaseId } from "./config/item-bases";
import { DERIVED_STAT_RULES, MINIMUM_SKILL_COOLDOWN_MULTIPLIER, UNARMED_ATTACKS_PER_SECOND, type StatContributionRule } from "./config/stat-rules";
import type {
  AffixRoll,
  AttributeKey,
  CharacterStats,
  EquipmentItem,
  ModifierStatKey,
  PlayerProfile,
  StatKey,
  StatModifier,
} from "./domain";

export interface StatResolution<TStat extends ModifierStatKey = StatKey> {
  base: number;
  flat: number;
  increased: number;
  more: number[];
  value: number;
  contributions: readonly StatModifier<TStat>[];
}

export interface CharacterStatCalculation {
  stats: CharacterStats;
  modifiers: readonly StatModifier[];
  breakdown: Record<StatKey, StatResolution>;
}

const ATTRIBUTE_KEYS: readonly AttributeKey[] = ["strength", "dexterity", "intelligence"];
const STAT_KEYS: readonly StatKey[] = [
  ...ATTRIBUTE_KEYS, "maxLife", "maxFocus", "moveSpeed", "attackDamage",
  "attackSpeed", "focusRegen", "skillCooldown", "armor", "evadeChance",
];

export function resolveStat<TStat extends ModifierStatKey>(base: number, modifiers: readonly StatModifier<TStat>[]): StatResolution<TStat> {
  const flat = modifiers.filter((modifier) => modifier.mode === "flat").reduce((sum, modifier) => sum + modifier.value, 0);
  const increased = modifiers.filter((modifier) => modifier.mode === "increased").reduce((sum, modifier) => sum + modifier.value, 0);
  const more = modifiers.filter((modifier) => modifier.mode === "more").map((modifier) => modifier.value);
  const moreMultiplier = more.reduce((product, value) => product * (1 + value / 100), 1);
  return {
    base,
    flat,
    increased,
    more,
    value: (base + flat) * (1 + increased / 100) * moreMultiplier,
    contributions: modifiers,
  };
}

export function itemModifiers(item: EquipmentItem): StatModifier[] {
  return [
    ...item.baseStats.map((modifier) => ({ ...modifier, label: `${item.baseName} base` })),
    ...item.implicitModifiers.map((modifier) => ({ ...modifier, label: `${item.baseName} implicit` })),
    ...item.affixes.flatMap((affix) => affix.rolls.map((modifier) => ({ ...modifier, label: `${affix.name} (Tier ${affix.tier})` }))),
  ];
}

function modifiersFor(stat: StatKey, modifiers: readonly StatModifier[]): StatModifier[] {
  return modifiers.filter((modifier) => modifier.stat === stat);
}

function classAttributeModifiers(
  classId: PlayerProfile["character"]["classId"],
  level: number,
): StatModifier[] {
  const definition = CHARACTER_CLASSES[classId];
  return ATTRIBUTE_KEYS.flatMap((attribute) => [
    {
      stat: attribute,
      mode: "flat",
      value: definition.startingAttributes[attribute],
      source: `class:${classId}:starting-${attribute}`,
      label: `${definition.name} starting ${attribute}`,
    },
    {
      stat: attribute,
      mode: "flat",
      value: definition.attributesPerLevel[attribute] * Math.max(0, level - 1),
      source: `class:${classId}:${attribute}-per-level`,
      label: `+${definition.attributesPerLevel[attribute]} ${attribute} per level`,
    },
  ] satisfies StatModifier[]);
}

function allocatedAttributeModifiers(profile: PlayerProfile): StatModifier[] {
  return ATTRIBUTE_KEYS.map((attribute) => ({
    stat: attribute,
    mode: "flat",
    value: profile.character.allocatedAttributes[attribute],
    source: `character:allocated-${attribute}`,
    label: `Allocated ${attribute}`,
  }));
}

function materializeRule(
  rule: StatContributionRule,
  level: number,
  attributes: Record<AttributeKey, number>,
  classId: PlayerProfile["character"]["classId"],
): StatModifier | null {
  if (rule.classes && !rule.classes.includes(classId)) return null;
  const units = rule.kind === "constant"
    ? 1
    : rule.kind === "perLevel"
      ? Math.max(0, level - 1) / (rule.levelsPerUnit ?? 1)
      : attributes[rule.attribute] / (rule.attributePointsPerUnit ?? 1);
  const resolvedUnits = rule.kind !== "constant" && rule.wholeUnits ? Math.floor(units) : units;
  const value = rule.kind === "constant"
    ? rule.value
    : rule.valuePerUnit * resolvedUnits;
  return { stat: rule.stat, mode: rule.mode, value, source: rule.source, label: rule.label };
}

function weaponAttackSpeedModifier(mainHand: EquipmentItem | undefined): StatModifier {
  const base = mainHand ? ITEM_BASES_BY_ID[mainHand.baseId as ItemBaseId] : undefined;
  const attacksPerSecond = base?.weapon?.attacksPerSecond ?? UNARMED_ATTACKS_PER_SECOND;
  return {
    stat: "attackSpeed",
    mode: "flat",
    value: attacksPerSecond,
    source: base?.weapon ? `weapon:${base.id}:attacks-per-second` : "character:unarmed-attacks-per-second",
    label: base?.weapon ? `${base.name} base attacks per second` : "Unarmed base attacks per second",
  };
}

export function calculateCharacterStats(profile: PlayerProfile): CharacterStatCalculation {
  const classId = profile.character.classId;
  const classDefinition = CHARACTER_CLASSES[classId];
  const level = profile.character.level;
  const equipped = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const itemModifierList = equipped.flatMap(itemModifiers);
  const attributeModifiers = classAttributeModifiers(classId, level);
  const classModifiers: StatModifier[] = Object.entries(classDefinition.baseStats).map(([stat, value]) => ({
    stat: stat as StatKey,
    mode: "flat",
    value: value ?? 0,
    source: `class:${classId}:base-${stat}`,
    label: `${classDefinition.name} class bonus`,
  }));
  const initialModifiers = [
    ...attributeModifiers,
    ...allocatedAttributeModifiers(profile),
    ...classModifiers,
    ...itemModifierList,
  ];

  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((attribute) => [
    attribute,
    resolveStat(0, modifiersFor(attribute, initialModifiers)).value,
  ])) as Record<AttributeKey, number>;

  const derivedModifiers = DERIVED_STAT_RULES.flatMap((rule) => {
    const modifier = materializeRule(rule, level, attributes, classId);
    return modifier ? [modifier] : [];
  });
  const modifiers = [
    ...initialModifiers,
    ...derivedModifiers,
    weaponAttackSpeedModifier(profile.equipped.mainHand),
  ];
  const unresolvedBreakdown = Object.fromEntries(STAT_KEYS.map((stat) => [
    stat,
    resolveStat(0, modifiersFor(stat, modifiers)),
  ])) as Record<StatKey, StatResolution>;
  const breakdown: Record<StatKey, StatResolution> = {
    ...unresolvedBreakdown,
    skillCooldown: {
      ...unresolvedBreakdown.skillCooldown,
      value: Math.max(MINIMUM_SKILL_COOLDOWN_MULTIPLIER, unresolvedBreakdown.skillCooldown.value),
    },
  };
  const stats: CharacterStats = {
    strength: Math.round(breakdown.strength.value),
    dexterity: Math.round(breakdown.dexterity.value),
    intelligence: Math.round(breakdown.intelligence.value),
    maxLife: breakdown.maxLife.value,
    maxFocus: breakdown.maxFocus.value,
    moveSpeed: breakdown.moveSpeed.value,
    attackDamage: breakdown.attackDamage.value,
    attackSpeed: breakdown.attackSpeed.value,
    focusRegen: breakdown.focusRegen.value,
    skillCooldown: breakdown.skillCooldown.value,
    armor: breakdown.armor.value,
    evadeChance: Math.min(75, breakdown.evadeChance.value),
  };

  return { stats, modifiers, breakdown };
}

export function formatModifier(modifier: Pick<StatModifier<ModifierStatKey>, "stat" | "mode" | "value">): string {
  const labels: Record<ModifierStatKey, string> = {
    strength: "Strength", dexterity: "Dexterity", intelligence: "Intelligence",
    maxLife: "maximum Life", maxFocus: "maximum Focus", moveSpeed: "movement speed",
    attackDamage: "attack damage", attackSpeed: "attack speed", focusRegen: "Focus recovery rate", skillCooldown: "skill cooldown", armor: "armor", evadeChance: "evade chance",
    itemQuantity: "item quantity", itemRarity: "item rarity",
    monsterCount: "monster count", monsterRarity: "monster rarity", monsterLife: "monster maximum Life",
    monsterMoveSpeed: "monster movement speed", monsterDamage: "monster damage", monsterArmor: "monster armor",
    monsterEvadeChance: "monster evade chance",
  };
  const absoluteValue = Math.abs(modifier.value);
  if (modifier.mode === "flat") return `${modifier.value >= 0 ? "+" : "-"}${absoluteValue} ${labels[modifier.stat]}`;
  if (modifier.mode === "increased") return `${absoluteValue}% ${modifier.value >= 0 ? "increased" : "reduced"} ${labels[modifier.stat]}`;
  return `${absoluteValue}% ${modifier.value >= 0 ? "more" : "less"} ${labels[modifier.stat]}`;
}

function formatRollBoundary(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function formatModifierWithRollRange(
  modifier: Pick<AffixRoll, "stat" | "mode" | "value" | "min" | "max">,
  showRollRange: boolean,
): string {
  const description = formatModifier(modifier);
  if (!showRollRange) return description;
  return `${description} (${formatRollBoundary(modifier.min)} - ${formatRollBoundary(modifier.max)})`;
}
