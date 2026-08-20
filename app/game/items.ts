import { AFFIX_DEFINITIONS } from "./config/affixes";
import { ITEM_BASES, ITEM_BASES_BY_ID, STARTER_BASES } from "./config/item-bases";
import type { EquipmentMerchantOffer } from "./config/merchants";
import type { AffixDefinition, AffixTierDefinition, ItemBaseDefinition, ScaledModifierDefinition } from "./config/schema";
import type { Affix, AffixTag, CharacterClassId, EquipmentItem, EquipmentSlot, Rarity, StatModifier } from "./domain";
import { createId } from "./random";

export type RandomSource = () => number;

function randomInteger(min: number, max: number, random: RandomSource): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function weightedChoice<T>(values: readonly T[], weight: (value: T) => number, random: RandomSource): T {
  if (values.length === 0) throw new Error("Cannot choose from an empty weighted collection");
  const total = values.reduce((sum, value) => sum + Math.max(0, weight(value)), 0);
  if (total <= 0) return values[0];
  let cursor = random() * total;
  for (const value of values) {
    cursor -= Math.max(0, weight(value));
    if (cursor < 0) return value;
  }
  return values[values.length - 1];
}

export function eligibleAffixTiers(definition: AffixDefinition, itemLevel: number): readonly AffixTierDefinition[] {
  return definition.tiers.filter((candidate) => candidate.requiredItemLevel <= itemLevel);
}

export function scaleBaseModifier(definition: ScaledModifierDefinition, itemLevel: number, source: string): StatModifier {
  return {
    stat: definition.stat,
    mode: definition.mode,
    value: Math.round((definition.base + (definition.perItemLevel ?? 0) * Math.max(0, itemLevel - 1)) * 100) / 100,
    source,
  };
}

function rollAffix(definition: AffixDefinition, itemLevel: number, random: RandomSource = Math.random): Affix {
  const eligible = eligibleAffixTiers(definition, itemLevel);
  if (eligible.length === 0) throw new Error(`No eligible tier for ${definition.id} at item level ${itemLevel}`);
  const selectedTier = weightedChoice(eligible, (candidate) => candidate.weight, random);
  const rolls = selectedTier.rolls.map((roll) => ({
    ...roll,
    value: randomInteger(roll.min, roll.max, random),
    source: `affix:${definition.id}:t${selectedTier.tier}`,
  }));
  return {
    id: createId("affix"),
    definitionId: definition.id,
    name: definition.name,
    tag: definition.tag,
    tier: selectedTier.tier,
    requiredItemLevel: selectedTier.requiredItemLevel,
    group: definition.group,
    rolls,
  };
}

function affixPool(slot: EquipmentSlot, excludedGroups: ReadonlySet<string>, tag?: AffixTag): readonly AffixDefinition[] {
  return AFFIX_DEFINITIONS.filter((definition) => (definition.slots as readonly EquipmentSlot[]).includes(slot) && !excludedGroups.has(definition.group) && (!tag || definition.tag === tag));
}

function eligibleAffixPoolForItem(item: Pick<EquipmentItem, "slot" | "itemLevel" | "affixes">, tag?: AffixTag): readonly AffixDefinition[] {
  return affixPool(item.slot, new Set(item.affixes.map((affix) => affix.group)), tag)
    .filter((definition) => eligibleAffixTiers(definition, item.itemLevel).length > 0);
}

export function canCreateAffixForItem(item: Pick<EquipmentItem, "slot" | "itemLevel" | "affixes">, tag?: AffixTag): boolean {
  return eligibleAffixPoolForItem(item, tag).length > 0;
}

export function createAffixForItem(item: Pick<EquipmentItem, "slot" | "itemLevel" | "affixes">, tag?: AffixTag, random: RandomSource = Math.random): Affix | null {
  const pool = eligibleAffixPoolForItem(item, tag);
  if (pool.length === 0) return null;
  return rollAffix(pool[Math.floor(random() * pool.length)], item.itemLevel, random);
}

function createEquipmentFromBase(base: ItemBaseDefinition, itemLevel: number, forcedRarity?: Rarity, random: RandomSource = Math.random): EquipmentItem {
  const rarityRoll = random();
  const rarity: Rarity = forcedRarity ?? (rarityRoll > 0.97 ? "rare" : rarityRoll > 0.55 ? "magic" : "normal");
  const affixCount = rarity === "rare" ? randomInteger(3, 4, random) : rarity === "magic" ? randomInteger(1, 2, random) : 0;
  const draft: EquipmentItem = {
    kind: "equipment", id: createId("item"), baseId: base.id, baseName: base.name, slot: base.slot, rarity, itemLevel,
    stability: 8, maxStability: 8, implicit: base.implicit,
    baseStats: base.baseStats.map((modifier) => scaleBaseModifier(modifier, itemLevel, `base:${base.id}`)),
    implicitModifiers: base.implicitModifiers.map((modifier) => scaleBaseModifier(modifier, itemLevel, `implicit:${base.id}`)),
    affixes: [],
  };
  for (let index = 0; index < affixCount; index += 1) {
    const affix = createAffixForItem(draft, undefined, random);
    if (!affix) break;
    draft.affixes.push(affix);
  }
  return draft;
}

export function generateEquipmentWithRandom(itemLevel: number, forcedRarity: Rarity | undefined, random: RandomSource): EquipmentItem {
  const base = ITEM_BASES[Math.floor(random() * ITEM_BASES.length)];
  return createEquipmentFromBase(base, itemLevel, forcedRarity, random);
}

export function generateStarterWeapon(classId: CharacterClassId): EquipmentItem {
  return createEquipmentFromBase(ITEM_BASES_BY_ID[STARTER_BASES[classId]], 1, "magic");
}

export function createFixedMerchantEquipment(offer: EquipmentMerchantOffer, itemId = createId("item")): EquipmentItem {
  const base = ITEM_BASES_BY_ID[offer.baseId];
  return {
    kind: "equipment",
    id: itemId,
    baseId: base.id,
    baseName: base.name,
    displayName: offer.displayName,
    slot: base.slot,
    rarity: offer.rarity,
    itemLevel: offer.itemLevel,
    stability: 0,
    maxStability: 0,
    implicit: base.implicit,
    baseStats: base.baseStats.map((modifier) => scaleBaseModifier(modifier, offer.itemLevel, `base:${base.id}`)),
    implicitModifiers: base.implicitModifiers.map((modifier) => scaleBaseModifier(modifier, offer.itemLevel, `implicit:${base.id}`)),
    affixes: offer.affixes.map((definition) => ({
      id: `${itemId}:${definition.id}`,
      definitionId: definition.id,
      name: definition.name,
      tag: definition.tag,
      tier: definition.tier,
      requiredItemLevel: 1,
      group: definition.group,
      rolls: definition.rolls.map((roll) => ({
        ...roll,
        min: roll.value,
        max: roll.value,
        source: `merchant:${definition.id}`,
      })),
    })),
  };
}

export function addFireAffix(item: EquipmentItem): EquipmentItem {
  if (item.stability < 2 || item.affixes.length >= 4) return item;
  const affix = createAffixForItem(item, "fire");
  if (!affix) return item;
  return { ...item, rarity: item.affixes.length >= 2 ? "rare" : "magic", stability: item.stability - 2, affixes: [...item.affixes, affix] };
}

export function rerollAffixValues(item: EquipmentItem, random: RandomSource = Math.random): EquipmentItem {
  if (item.stability <= 0 || item.affixes.length === 0) return item;
  return {
    ...item,
    stability: item.stability - 1,
    affixes: item.affixes.map((affix) => {
      const rolls = affix.rolls.map((roll) => ({ ...roll, value: randomInteger(roll.min, roll.max, random) }));
      return { ...affix, rolls };
    }),
  };
}

export function restoreStability(item: EquipmentItem): EquipmentItem {
  if (item.stability >= item.maxStability) return item;
  return { ...item, stability: item.stability + 1 };
}

export function removeRandomAffix(item: EquipmentItem, random: RandomSource = Math.random): EquipmentItem {
  if (item.rarity === "unique" || item.affixes.length === 0) return item;
  const removedIndex = Math.floor(random() * item.affixes.length);
  const affixes = item.affixes.filter((_, index) => index !== removedIndex);
  const rarity: Rarity = affixes.length === 0 ? "normal" : affixes.length <= 2 ? "magic" : "rare";
  return { ...item, rarity, affixes };
}

export function itemDisplayName(item: EquipmentItem): string {
  if (item.displayName) return item.displayName;
  if (item.rarity === "normal" || item.affixes.length === 0) return item.baseName;
  if (item.rarity === "magic") return `${item.affixes[0]?.name ?? "Tempered"} ${item.baseName}`;
  const rareNames = ["Ash Mark", "Dread Song", "Cinder Bite", "Iron Oath"];
  const hash = [...item.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `${rareNames[hash % rareNames.length]} ${item.baseName}`;
}
