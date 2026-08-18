import assert from "node:assert/strict";
import test from "node:test";
import { AFFIX_DEFINITIONS_BY_ID } from "../app/game/config/affixes";
import { CURRENCY_DEFINITIONS } from "../app/game/config/currencies";
import type { EquipmentItem, PlayerProfile, StatModifier } from "../app/game/domain";
import { addCurrencyToInventory, consumeCurrency, countCurrency, isCurrencyItem, isMapItem } from "../app/game/inventory";
import {
  createAffixForItem,
  eligibleAffixTiers,
  normalizeEquipmentItem,
  rerollAffixValues,
  scaleBaseModifier,
} from "../app/game/items";
import { calculateCharacterStats, resolveStat } from "../app/game/stats";
import { createInitialProfile, loadProfile } from "../app/game/profile";

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
    kind: "equipment", id: "weapon", baseId: "test", baseName: "Test Weapon", slot: "weapon", rarity: "rare", itemLevel: 50,
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
    version: 4,
    character: { name: "Test", archetype: "Test", classId: "amazon", created: true, level: 10, xp: 0, unspentPassives: 0, mapsCompleted: 0, highestWave: 0 },
    inventory: [], stash: [], equipped: { weapon }, mapDevice: null, openedMap: null,
  } satisfies PlayerProfile;
  const calculation = calculateCharacterStats(profile);
  const attack = calculation.breakdown.attackDamage;
  assert.equal(attack.flat, 10);
  assert.equal(attack.increased, 20);
  assert.deepEqual(attack.more, [50]);
  assert.equal(attack.value, (attack.base + 10) * 1.2 * 1.5);
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
  assert.equal(profile.version, 4);
  assert.equal(profile.mapDevice, null);
  assert.equal(profile.inventory.filter(isMapItem).length, 3);
  assert.equal(countCurrency(profile.inventory, "scrap"), 12);
  assert.equal("materials" in profile, false);
  assert.equal("maps" in profile, false);
});

test("v3 counter saves migrate maps and currency into v4 inventory items", () => {
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
    assert.equal(migrated.version, 4);
    assert.equal(migrated.inventory.filter(isMapItem).length, 1);
    assert.deepEqual(migrated.inventory.filter(isCurrencyItem).filter((item) => item.baseId === "scrap").map((item) => item.stackSize), [40, 5]);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
