import assert from "node:assert/strict";
import test from "node:test";
import { AFFIX_DEFINITIONS_BY_ID } from "../app/game/config/affixes";
import type { EquipmentItem, PlayerProfile, StatModifier } from "../app/game/domain";
import {
  createAffixForItem,
  eligibleAffixTiers,
  normalizeEquipmentItem,
  rerollAffixValues,
  scaleBaseModifier,
} from "../app/game/items";
import { calculateCharacterStats, resolveStat } from "../app/game/stats";

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
    id: "item", baseId: "riveted-coat", baseName: "Riveted Coat", slot: "chest", rarity: "magic", itemLevel: 99,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [], affixes: [rolled],
  } satisfies EquipmentItem;
  const rerolled = rerollAffixValues(item, () => 0);
  assert.equal(rerolled.affixes[0].tier, 1);
  assert.equal(rerolled.affixes[0].rolls[0].value, 70);
  assert.equal(rerolled.stability, 7);
});

test("character calculations combine item base, implicit, and explicit modifiers once", () => {
  const weapon = {
    id: "weapon", baseId: "test", baseName: "Test Weapon", slot: "weapon", rarity: "rare", itemLevel: 50,
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
    version: 3,
    character: { name: "Test", archetype: "Test", classId: "amazon", created: true, level: 10, xp: 0, unspentPassives: 0, mapsCompleted: 0, highestWave: 0 },
    materials: { scrap: 0, essence: 0, seal: 0, solvent: 0, mapDust: 0, threatGlyph: 0, rewardInk: 0 },
    inventory: [], stash: [], equipped: { weapon }, maps: [], openedMap: null,
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
