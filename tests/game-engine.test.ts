import assert from "node:assert/strict";
import test from "node:test";
import { AFFIX_DEFINITIONS_BY_ID } from "../app/game/config/affixes";
import { ARENA_RULES } from "../app/game/config/arena";
import { CURRENCY_DEFINITIONS } from "../app/game/config/currencies";
import { MAP_MERCHANT } from "../app/game/config/merchants";
import { MAP_MODIFIERS } from "../app/game/config/maps";
import { CHARACTER_EQUIPMENT_SLOTS } from "../app/game/config/equipment-slots";
import { ITEM_BASES } from "../app/game/config/item-bases";
import { MONSTER_ARCHETYPES } from "../app/game/config/monsters";
import type { EquipmentItem, ItemContainer, PlayerProfile, StatModifier } from "../app/game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts } from "../app/game/equipment";
import { addCurrencyToInventory, consumeCurrency, countCurrency, createCurrencyStack, isCurrencyItem, isMapItem } from "../app/game/inventory";
import { canPlaceItem, containerItems, createItemContainer, insertItem, moveItem, transferItem } from "../app/game/item-container";
import {
  createAffixForItem,
  eligibleAffixTiers,
  normalizeEquipmentItem,
  rerollAffixValues,
  scaleBaseModifier,
} from "../app/game/items";
import { calculateCharacterStats, formatModifier, resolveStat } from "../app/game/stats";
import { createInitialProfile, loadProfile } from "../app/game/profile";
import { purchaseMap } from "../app/game/merchant";
import { buildArenaBalance, calculateHitDamage, shouldSpawnNextWave } from "../app/game/combat";
import { createMap, mapModifierDescription, mapModifierRewardDescription } from "../app/game/maps";
import { packRarityChances, resolveMonsterStats, rollMonsterPack } from "../app/game/encounters";
import { dropChances, rollEquipmentRarity } from "../app/game/loot";

const source = "test";
const modifier = (mode: StatModifier["mode"], value: number): StatModifier => ({ stat: "maxLife", mode, value, source });

test("resolves flat, increased, and more modifiers in the canonical order", () => {
  const result = resolveStat(100, [modifier("flat", 20), modifier("flat", 10), modifier("increased", 30), modifier("increased", 20), modifier("more", 10), modifier("more", 25)]);
  assert.equal(result.flat, 30);
  assert.equal(result.increased, 50);
  assert.deepEqual(result.more, [10, 25]);
  assert.equal(result.value, 268.125);
});

test("item level gates affix tiers without forcing the highest eligible tier", () => {
  const definition = AFFIX_DEFINITIONS_BY_ID.vigorous;
  assert.deepEqual(eligibleAffixTiers(definition, 1).map((candidate) => candidate.tier), [6]);
  assert.deepEqual(eligibleAffixTiers(definition, 20).map((candidate) => candidate.tier), [6, 5, 4]);
  assert.deepEqual(eligibleAffixTiers(definition, 99).map((candidate) => candidate.tier), [6, 5, 4, 3, 2, 1]);
});

test("weighted tier and numeric rolls are deterministic with an injected random source", () => {
  const draft = { slot: "chest", itemLevel: 99, affixes: [] } as Pick<EquipmentItem, "slot" | "itemLevel" | "affixes">;
  const affix = createAffixForItem(draft, "life", () => 0.999999);
  assert.ok(affix);
  assert.equal(affix.tier, 1);
  assert.equal(affix.requiredItemLevel, 75);
  assert.equal(affix.rolls[0].value, 92);
  assert.equal(affix.rolls[0].min, 70);
  assert.equal(affix.rolls[0].max, 92);
});

test("item base values scale from immutable config and item level", () => {
  const scaled = scaleBaseModifier({ stat: "attackDamage", mode: "flat", base: 7, perItemLevel: 0.42 }, 10, "base:hunter-spear");
  assert.equal(scaled.value, 10.78);
  assert.equal(scaled.source, "base:hunter-spear");
});

test("value crafting stays inside the existing tier range", () => {
  const rolled = createAffixForItem({ slot: "chest", itemLevel: 99, affixes: [] }, "life", () => 0.999999);
  assert.ok(rolled);
  const item = {
    kind: "equipment", id: "item", baseId: "riveted-coat", baseName: "Riveted Coat", slot: "chest", rarity: "magic", itemLevel: 99,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [], affixes: [rolled],
  } satisfies EquipmentItem;
  const rerolled = rerollAffixValues(item, () => 0);
  assert.equal(rerolled.affixes[0].tier, 1);
  assert.equal(rerolled.affixes[0].rolls[0].value, 70);
  assert.equal(rerolled.stability, 7);
});

test("character calculations combine item base, implicit, and explicit modifiers once", () => {
  const weapon = {
    kind: "equipment", id: "weapon", baseId: "test", baseName: "Test Weapon", slot: "mainHand", rarity: "rare", itemLevel: 50,
    stability: 8, maxStability: 8, implicit: "test",
    baseStats: [{ stat: "attackDamage", mode: "flat", value: 10, source: "base:test" }],
    implicitModifiers: [{ stat: "attackDamage", mode: "increased", value: 20, source: "implicit:test" }],
    affixes: [{
      id: "affix", definitionId: "test-more", name: "Test", tag: "damage", tier: 1,
      requiredItemLevel: 1, group: "test", value: 50, unit: "percent",
      rolls: [{ stat: "attackDamage", mode: "more", value: 50, min: 50, max: 50, source: "affix:test" }],
    }],
  } satisfies EquipmentItem;
  const profile = {
    version: 6,
    character: { name: "Test", archetype: "Test", classId: "amazon", created: true, level: 10, xp: 0, unspentPassives: 0, mapsCompleted: 0, highestWave: 0 },
    inventory: createItemContainer("backpack"), stash: createItemContainer("stash"), equipped: { mainHand: weapon }, mapDevice: null, openedMap: null,
  } satisfies PlayerProfile;
  const calculation = calculateCharacterStats(profile);
  const attack = calculation.breakdown.attackDamage;
  assert.equal(attack.base, 0);
  assert.ok(attack.flat > 10);
  assert.equal(attack.increased, 20);
  assert.deepEqual(attack.more, [50]);
  assert.equal(attack.value, attack.flat * 1.2 * 1.5);
  assert.ok(attack.contributions.some((entry) => entry.source === "level:attack-damage"));
  assert.ok(attack.contributions.some((entry) => entry.source === "attribute:strength:attack-damage"));
  assert.ok(attack.contributions.some((entry) => entry.source === "base:test" && entry.label === "Test Weapon base"));
});

test("weapon-local APS is the base scaled by sourced increased attack speed", () => {
  const createWeapon = (baseId: "hunter-spear" | "iron-cleaver", baseName: string): EquipmentItem => ({
    kind: "equipment", id: baseId, baseId, baseName, slot: "mainHand", rarity: "normal", itemLevel: 1,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [], affixes: [],
  });
  const baseProfile = {
    version: 6,
    character: { name: "Test", archetype: "Test", classId: "amazon", created: true, level: 1, xp: 0, unspentPassives: 0, mapsCompleted: 0, highestWave: 0 },
    inventory: createItemContainer("backpack"), stash: createItemContainer("stash"), equipped: {}, mapDevice: null, openedMap: null,
  } satisfies PlayerProfile;
  const spear = calculateCharacterStats({ ...baseProfile, equipped: { mainHand: createWeapon("hunter-spear", "Hunter Spear") } });
  const cleaver = calculateCharacterStats({ ...baseProfile, equipped: { mainHand: createWeapon("iron-cleaver", "Iron Cleaver") } });

  assert.equal(spear.breakdown.attackSpeed.base, 0);
  assert.equal(spear.breakdown.attackSpeed.flat, 1.45);
  assert.equal(spear.breakdown.attackSpeed.increased, 8);
  assert.equal(spear.stats.attackSpeed, 1.45 * 1.08);
  assert.equal(cleaver.breakdown.attackSpeed.flat, 1.1);
  assert.ok(spear.stats.attackSpeed > cleaver.stats.attackSpeed);
  assert.ok(spear.breakdown.attackSpeed.contributions.some((entry) => entry.source === "weapon:hunter-spear:attacks-per-second"));
  assert.ok(spear.breakdown.attackSpeed.contributions.some((entry) => entry.source === "attribute:dexterity:attack-speed"));
});

test("legacy equipment is normalized without losing its rolled value", () => {
  const legacy = {
    id: "legacy", baseId: "hunter-spear", baseName: "Hunter Spear", slot: "weapon", rarity: "magic", itemLevel: 12,
    stability: 5, maxStability: 8, implicit: "+8% projectile speed",
    affixes: [{ id: "old-affix", name: "Honed", tag: "damage", tier: 5, value: 8, unit: "flat" }],
  } as unknown as EquipmentItem;
  const normalized = normalizeEquipmentItem(legacy);
  assert.ok(normalized.baseStats.length > 0);
  assert.equal(normalized.affixes[0].rolls[0].value, 8);
  assert.equal(normalized.affixes[0].rolls[0].mode, "flat");
  assert.equal(normalized.slot, "mainHand");
});

test("currency stacks obey their configured maximum and overflow into a new stack", () => {
  const first = addCurrencyToInventory([], "scrap", 39);
  const stacked = addCurrencyToInventory(first, "scrap", 3);
  const scrapStacks = stacked.filter(isCurrencyItem);
  assert.equal(CURRENCY_DEFINITIONS.scrap.maxStackSize, 40);
  assert.deepEqual(scrapStacks.map((item) => item.stackSize), [40, 2]);
  assert.equal(countCurrency(stacked, "scrap"), 42);
});

test("currency consumption removes quantities across actual inventory stacks", () => {
  const items = addCurrencyToInventory(addCurrencyToInventory([], "essence", 40), "essence", 6);
  const consumed = consumeCurrency(items, "essence", 43);
  assert.ok(consumed);
  assert.equal(countCurrency(consumed, "essence"), 3);
  assert.deepEqual(consumed.filter(isCurrencyItem).map((item) => item.stackSize), [3]);
});

test("new profiles contain map and currency items in the backpack", () => {
  const profile = createInitialProfile();
  const backpackItems = containerItems(profile.inventory);
  assert.equal(profile.version, 6);
  assert.equal(profile.mapDevice, null);
  assert.equal(backpackItems.filter(isMapItem).length, 3);
  assert.equal(countCurrency(backpackItems, "scrap"), 12);
  assert.equal("materials" in profile, false);
  assert.equal("maps" in profile, false);
});

test("v3 counter saves migrate maps and currency into positioned v6 inventory items", () => {
  const oldMap = {
    id: "old-map", baseId: "ashen-crucible", baseName: "Ashen Crucible", tier: 3, rarity: "normal",
    quality: 0, corrupted: false, implicit: "Test", modifiers: [],
  };
  const v3 = {
    version: 3,
    character: { name: "Legacy", archetype: "Spear", classId: "amazon", created: true, level: 12, xp: 0, unspentPassives: 0, mapsCompleted: 0, highestWave: 0 },
    materials: { scrap: 45, essence: 2, seal: 0, solvent: 0, mapDust: 0, threatGlyph: 0, rewardInk: 0 },
    inventory: [], stash: [], equipped: {}, maps: [oldMap], openedMap: null,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v3" ? JSON.stringify(v3) : null } },
  });
  try {
    const migrated = loadProfile();
    const items = containerItems(migrated.inventory);
    assert.equal(migrated.version, 6);
    assert.equal(items.filter(isMapItem).length, 1);
    assert.deepEqual(items.filter(isCurrencyItem).filter((item) => item.baseId === "scrap").map((item) => item.stackSize), [40, 5]);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("v5 saves migrate legacy weapon equipment into main hand", () => {
  const legacyWeapon = {
    kind: "equipment", id: "legacy-equipped", baseId: "hunter-spear", baseName: "Hunter Spear", slot: "weapon", rarity: "magic", itemLevel: 8,
    stability: 8, maxStability: 8, implicit: "8% increased attack speed", baseStats: [], implicitModifiers: [], affixes: [],
  };
  const current = createInitialProfile();
  const v5 = { ...current, version: 5, equipped: { weapon: legacyWeapon } };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v5" ? JSON.stringify(v5) : null } },
  });
  try {
    const migrated = loadProfile();
    assert.equal(migrated.version, 6);
    assert.equal(migrated.equipped.mainHand?.id, "legacy-equipped");
    assert.equal(migrated.equipped.mainHand?.slot, "mainHand");
    assert.equal("weapon" in migrated.equipped, false);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("the merchant always offers a free entry map and prices every harder map in Scrap", () => {
  const [entry, ...harderMaps] = MAP_MERCHANT.offers;
  assert.equal(entry.tier, 1);
  assert.equal(entry.price.amount, 0);
  for (const offer of harderMaps) {
    assert.equal(offer.price.currency, "scrap");
    assert.ok(offer.price.amount > 0);
  }
});

test("map purchases create inventory items and consume real Scrap stacks", () => {
  const profile = createInitialProfile();
  const initialMaps = containerItems(profile.inventory).filter(isMapItem).length;
  const freePurchase = purchaseMap(profile, "free-ashen-t1");
  assert.ok(freePurchase);
  assert.equal(freePurchase.map.tier, 1);
  assert.equal(containerItems(freePurchase.profile.inventory).filter(isMapItem).length, initialMaps + 1);
  assert.equal(countCurrency(containerItems(freePurchase.profile.inventory), "scrap"), 12);

  const paidPurchase = purchaseMap(freePurchase.profile, "iron-trial-t2");
  assert.ok(paidPurchase);
  assert.equal(paidPurchase.map.tier, 2);
  assert.equal(countCurrency(containerItems(paidPurchase.profile.inventory), "scrap"), 6);
  assert.equal(purchaseMap(paidPurchase.profile, "ashen-descent-t4"), null);
});

test("grid moves preserve explicit coordinates and reject collisions", () => {
  const weapon = {
    kind: "equipment", id: "grid-weapon", baseId: "test", baseName: "Grid Weapon", slot: "mainHand", rarity: "normal", itemLevel: 1,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [], affixes: [],
  } satisfies EquipmentItem;
  const ring = { ...weapon, id: "grid-ring", baseName: "Grid Ring", slot: "ring" } satisfies EquipmentItem;
  const backpack = {
    id: "backpack",
    entries: [{ item: weapon, x: 0, y: 0 }, { item: ring, x: 4, y: 0 }],
  } satisfies ItemContainer;
  assert.equal(canPlaceItem(backpack, weapon, 3, 0, weapon.id), false);
  assert.equal(moveItem(backpack, weapon.id, 3, 0), null);
  const moved = moveItem(backpack, weapon.id, 6, 1);
  assert.ok(moved);
  assert.deepEqual(moved.entries.find((entry) => entry.item.id === weapon.id), { item: weapon, x: 6, y: 1 });
  assert.deepEqual(moved.entries.find((entry) => entry.item.id === ring.id), { item: ring, x: 4, y: 0 });
});

test("cross-container transfers require the exact requested rectangle", () => {
  const map = containerItems(createInitialProfile().inventory).find(isMapItem);
  assert.ok(map);
  const backpack = insertItem(createItemContainer("backpack"), map, { x: 2, y: 2 }).container;
  const blocker = createCurrencyStack("scrap", 1);
  const stash = insertItem(createItemContainer("stash"), blocker, { x: 5, y: 5 }).container;
  assert.equal(transferItem(backpack, stash, map.id, 5, 5), null);
  const transferred = transferItem(backpack, stash, map.id, 7, 4);
  assert.ok(transferred);
  assert.equal(transferred.source.entries.length, 0);
  assert.deepEqual(transferred.target.entries.find((entry) => entry.item.id === map.id), { item: map, x: 7, y: 4 });
  assert.deepEqual(transferred.target.entries.find((entry) => entry.item.id === blocker.id), { item: blocker, x: 5, y: 5 });
});

test("waves advance when cleared or after the configured timeout", () => {
  assert.equal(ARENA_RULES.waveSpawnIntervalSeconds, 30);
  assert.equal(shouldSpawnNextWave(1, 6, 12, 29.99), false);
  assert.equal(shouldSpawnNextWave(1, 6, 0, 3), true);
  assert.equal(shouldSpawnNextWave(1, 6, 12, 30), true);
  assert.equal(shouldSpawnNextWave(6, 6, 0, 90), false);
});

test("map, tier, wave, and monster scaling all resolve through typed arena modifiers", () => {
  const profile = createInitialProfile();
  const openedMap = {
    ...createMap(4),
    modifiers: ["vampiric", "volcanic", "restless", "exhausting"],
  } satisfies PlayerProfile["openedMap"] & object;
  const balance = buildArenaBalance({ ...profile, openedMap });
  const firstWave = balance.waveStats[0];

  assert.equal(balance.focusRegen, 8 * 0.7);
  assert.equal(balance.focusRegenBreakdown.increased, -30);
  assert.equal(firstWave.monsterLife, (18 + 4) * (1 + (3 * 8 + 12) / 100));
  assert.equal(firstWave.monsterDamage, (5 + 0.8) * (1 + (3 * 7 + 12) / 100));
  assert.equal(firstWave.monsterMoveSpeed.min, (39 + 1.2) * 1.12);
  assert.ok(firstWave.breakdown.monsterMoveSpeedMin.contributions.some((entry) => entry.source === "monster:ashling:wave-speed"));
  assert.ok(firstWave.breakdown.monsterMoveSpeedMin.contributions.some((entry) => entry.source === "map:restless:0"));
  assert.ok(firstWave.breakdown.monsterLife.contributions.some((entry) => entry.source.startsWith("map-tier:4:")));
});

test("map descriptions are generated from the same executable modifier records", () => {
  assert.deepEqual(MAP_MODIFIERS.teeming.modifiers, [{ stat: "monsterCount", mode: "more", base: 30 }]);
  assert.equal(mapModifierDescription("teeming"), "30% more monster count");
  assert.equal(mapModifierDescription("exhausting"), "30% reduced Focus recovery rate");
  assert.equal(mapModifierDescription("volcanic"), "12% increased monster damage");
  assert.equal(mapModifierRewardDescription("volcanic"), "24% increased item quantity");
  assert.equal(formatModifier({ stat: "monsterLife", mode: "more", value: -15 }), "15% less monster maximum Life");

  const profile = createInitialProfile();
  const openedMap = { ...createMap(1), modifiers: ["teeming", "commanded"] } satisfies PlayerProfile["openedMap"] & object;
  const firstWave = buildArenaBalance({ ...profile, openedMap }).waveStats[0];
  assert.equal(firstWave.monsterCount, Math.round((28 + 16) * 1.3));
  assert.equal(firstWave.monsterRarity, 139);
});

test("packs randomly mix configured combat roles and enforce magic/rare pack rules", () => {
  assert.equal(Object.keys(MONSTER_ARCHETYPES).length, 5);
  assert.equal(MONSTER_ARCHETYPES["cinder-spitter"].behavior, "ranged");
  assert.equal(MONSTER_ARCHETYPES["rift-stalker"].behavior, "jumper");

  const magicPack = rollMonsterPack(8, 3, 2, 100, () => 0.05);
  assert.equal(magicPack.rarity, "magic");
  assert.equal(magicPack.rareLeaderIndex, null);
  assert.equal(magicPack.modifierIds.length, 1);

  const rarePack = rollMonsterPack(8, 5, 4, 200, () => 0);
  assert.equal(rarePack.rarity, "rare");
  assert.equal(rarePack.rareLeaderIndex, 0);
  assert.equal(rarePack.modifierIds.length, 2);

  let state = 12345;
  const random = () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
  const packs = Array.from({ length: 80 }, () => rollMonsterPack(12, 6, 4, 150, random));
  assert.ok(packs.some((pack) => new Set(pack.archetypeIds).size === 1));
  assert.ok(packs.some((pack) => new Set(pack.archetypeIds).size > 1));
  assert.ok(packs.every((pack) => new Set(pack.archetypeIds).size <= 3));
});

test("later waves and harder maps increase monster rarity while archetypes retain real stat variation", () => {
  const profile = createInitialProfile();
  const low = buildArenaBalance({ ...profile, openedMap: createMap(1) });
  const high = buildArenaBalance({ ...profile, openedMap: { ...createMap(4), modifiers: ["commanded"] } });
  const earlyChances = packRarityChances(low.waveStats[0].monsterRarity);
  const lateChances = packRarityChances(high.waveStats[5].monsterRarity);
  assert.ok(lateChances.magic > earlyChances.magic);
  assert.ok(lateChances.rare > earlyChances.rare);

  const wave = high.waveStats[2];
  const brute = resolveMonsterStats("ironhide-brute", wave, "normal", []);
  const skitter = resolveMonsterStats("ember-skitter", wave, "normal", []);
  const rareBrute = resolveMonsterStats("ironhide-brute", wave, "rare", ["juggernaut", "executioner"]);
  assert.ok(brute.maxLife > skitter.maxLife * 3);
  assert.ok(brute.moveSpeed.max < skitter.moveSpeed.min);
  assert.ok(brute.armor > skitter.armor);
  assert.ok(skitter.evadeChance > brute.evadeChance);
  assert.ok(rareBrute.maxLife > brute.maxLife * 2);
  assert.ok(rareBrute.damage > brute.damage * 1.5);
  assert.ok(rareBrute.itemQuantity > brute.itemQuantity);
  assert.ok(rareBrute.itemRarity > brute.itemRarity);
});

test("item quantity changes drop frequency while item rarity changes only rarity weights", () => {
  assert.equal(dropChances(200).equipment, dropChances(100).equipment * 2);
  assert.equal(dropChances(200).material, dropChances(100).material * 2);
  assert.equal(rollEquipmentRarity(100, () => 0.02), "magic");
  assert.equal(rollEquipmentRarity(400, () => 0.02), "rare");
});

test("runtime hit damage scales linearly with resolved attack damage", () => {
  assert.equal(calculateHitDamage(15, 1), 15);
  assert.equal(calculateHitDamage(30, 1), 30);
  assert.equal(calculateHitDamage(30, 1.35), 40.5);
  const base = resolveStat(20, []);
  const fiftyMore = resolveStat(20, [modifier("more", 50)]);
  assert.equal(calculateHitDamage(fiftyMore.value, 1) / calculateHitDamage(base.value, 1), 1.5);
});

test("character equipment exposes ten positions and fills both ring slots independently", () => {
  assert.equal(CHARACTER_EQUIPMENT_SLOTS.length, 10);
  assert.deepEqual(CHARACTER_EQUIPMENT_SLOTS.map((slot) => slot.id), [
    "helmet", "amulet", "mainHand", "offHand", "chest", "gloves", "ringLeft", "ringRight", "belt", "boots",
  ]);
  const ring = {
    kind: "equipment", id: "ring-a", baseId: "ember-ring", baseName: "Ember Ring", slot: "ring", rarity: "normal", itemLevel: 1,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [], affixes: [],
  } satisfies EquipmentItem;
  assert.equal(chooseEquipmentSlot(ring, {}), "ringLeft");
  assert.equal(chooseEquipmentSlot(ring, { ringLeft: ring }), "ringRight");
  assert.equal(equipmentSlotAccepts("ringRight", ring), true);
  assert.equal(equipmentSlotAccepts("amulet", ring), false);
  assert.deepEqual(new Set(ITEM_BASES.map((base) => base.slot)), new Set(["helmet", "mainHand", "offHand", "amulet", "ring", "chest", "gloves", "boots", "belt"]));
});
