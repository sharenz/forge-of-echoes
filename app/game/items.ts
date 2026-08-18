import type { Affix, AffixTag, EquipmentItem, EquipmentSlot, Rarity } from "./domain";
import { choose, createId, randomInt } from "./random";

interface BaseDefinition {
  id: string;
  name: string;
  slot: EquipmentSlot;
  implicit: string;
}

const BASES: BaseDefinition[] = [
  { id: "ashwood-wand", name: "Ashwood Wand", slot: "weapon", implicit: "+8% fire effect" },
  { id: "iron-cleaver", name: "Iron Cleaver", slot: "weapon", implicit: "+4 physical damage" },
  { id: "riveted-coat", name: "Riveted Coat", slot: "chest", implicit: "+12 armor" },
  { id: "ember-ring", name: "Ember Ring", slot: "ring", implicit: "+5% fire resistance" },
  { id: "pathfinder-boots", name: "Pathfinder Boots", slot: "boots", implicit: "+3% move speed" },
];

const AFFIX_NAMES: Record<AffixTag, string[]> = {
  fire: ["Scorching", "Ember-fed", "of Immolation"],
  life: ["Stalwart", "Vigorous", "of the Ox"],
  speed: ["Fleet", "Quickened", "of Haste"],
  damage: ["Merciless", "Honed", "of Force"],
  defense: ["Plated", "Steadfast", "of Warding"],
};

const SLOT_TAGS: Record<EquipmentSlot, AffixTag[]> = {
  weapon: ["fire", "damage", "speed"],
  chest: ["life", "defense"],
  ring: ["fire", "life", "damage"],
  boots: ["speed", "life", "defense"],
};

function createAffix(tag: AffixTag, itemLevel: number): Affix {
  const maxTier = Math.max(1, 6 - Math.floor(itemLevel / 15));
  const tier = randomInt(maxTier, Math.min(6, maxTier + 2));
  const baseValue: Record<AffixTag, number> = {
    fire: 5,
    life: 9,
    speed: 3,
    damage: 4,
    defense: 8,
  };
  const value = baseValue[tag] + (7 - tier) * randomInt(2, 4);
  return {
    id: createId("affix"),
    name: choose(AFFIX_NAMES[tag]),
    tag,
    tier,
    value,
    unit: tag === "life" || tag === "damage" || tag === "defense" ? "flat" : "percent",
  };
}

export function generateEquipment(itemLevel: number, forcedRarity?: Rarity): EquipmentItem {
  const base = choose(BASES);
  const rarityRoll = Math.random();
  const rarity: Rarity = forcedRarity ?? (rarityRoll > 0.94 ? "rare" : rarityRoll > 0.48 ? "magic" : "normal");
  const affixCount = rarity === "rare" ? randomInt(3, 4) : rarity === "magic" ? randomInt(1, 2) : 0;
  const affixes = Array.from({ length: affixCount }, () => createAffix(choose(SLOT_TAGS[base.slot]), itemLevel));

  return {
    id: createId("item"),
    baseId: base.id,
    baseName: base.name,
    slot: base.slot,
    rarity,
    itemLevel,
    stability: 8,
    maxStability: 8,
    implicit: base.implicit,
    affixes,
  };
}

export function addFireAffix(item: EquipmentItem): EquipmentItem {
  if (item.stability <= 0 || item.affixes.length >= 4) return item;
  return {
    ...item,
    rarity: item.affixes.length >= 2 ? "rare" : "magic",
    stability: item.stability - 2,
    affixes: [...item.affixes, createAffix("fire", item.itemLevel)],
  };
}

export function rerollAffixValues(item: EquipmentItem): EquipmentItem {
  if (item.stability <= 0 || item.affixes.length === 0) return item;
  return {
    ...item,
    stability: item.stability - 1,
    affixes: item.affixes.map((affix) => ({
      ...affix,
      value: Math.max(1, Math.round(affix.value * (0.85 + Math.random() * 0.35))),
    })),
  };
}

export function itemDisplayName(item: EquipmentItem): string {
  if (item.rarity === "normal" || item.affixes.length === 0) return item.baseName;
  if (item.rarity === "magic") {
    return `${item.affixes[0]?.name ?? "Tempered"} ${item.baseName}`;
  }
  const rareNames = ["Ash Mark", "Dread Song", "Cinder Bite", "Iron Oath"];
  const hash = [...item.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `${rareNames[hash % rareNames.length]} ${item.baseName}`;
}
