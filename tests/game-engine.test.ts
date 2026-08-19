import assert from "node:assert/strict";
import test from "node:test";
import { AFFIX_DEFINITIONS_BY_ID } from "../app/game/config/affixes";
import { ARENA_RULES } from "../app/game/config/arena";
import { SKILL_AUDIO } from "../app/game/config/audio";
import { CHARACTER_ANIMATIONS, characterDirectionVector, resolveCharacterDirection, resolveLocomotionDirection } from "../app/game/config/character-animations";
import { CURRENCY_DEFINITIONS } from "../app/game/config/currencies";
import { FLASK_BELT_SLOT_COUNT, FLASK_DEFINITIONS } from "../app/game/config/flasks";
import { MAP_MERCHANT } from "../app/game/config/merchants";
import { MAP_BASES, MAP_MODIFIERS } from "../app/game/config/maps";
import { CHARACTER_EQUIPMENT_SLOTS } from "../app/game/config/equipment-slots";
import { ITEM_BASES } from "../app/game/config/item-bases";
import { MONSTER_ARCHETYPES } from "../app/game/config/monsters";
import type { EquipmentItem, ItemContainer, PlayerProfile, StatModifier } from "../app/game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts } from "../app/game/equipment";
import { addCurrencyToInventory, consumeCurrency, countCurrency, createCurrencyStack, isCurrencyItem, isFlaskItem, isMapItem } from "../app/game/inventory";
import { advanceFlaskRecovery, consumeFlaskFromBelt, createFlaskStack, loadFlaskIntoBelt, storePickedUpFlask, unloadFlaskFromBelt } from "../app/game/flasks";
import { canPlaceItem, containerItems, createItemContainer, insertItem, moveItem, transferItem } from "../app/game/item-container";
import { compareEquipmentToCurrent } from "../app/game/item-comparison";
import { takeProfileItem } from "../app/game/item-drop";
import {
  createAffixForItem,
  eligibleAffixTiers,
  generateStarterWeapon,
  normalizeEquipmentItem,
  rerollAffixValues,
  scaleBaseModifier,
} from "../app/game/items";
import { calculateCharacterStats, formatModifier, formatModifierWithRollRange, resolveStat } from "../app/game/stats";
import { createInitialProfile, loadProfile } from "../app/game/profile";
import { purchaseFlask, purchaseMap } from "../app/game/merchant";
import { ACTIVE_SKILLS, BASIC_ATTACK, buildArenaBalance, calculateHitDamage, isArenaCleared, rollHitDamage, shouldSpawnNextWave } from "../app/game/combat";
import { createMap, mapModifierDescription, mapModifierRewardDescription } from "../app/game/maps";
import { packRarityChances, resolveMonsterStats, rollMonsterPack } from "../app/game/encounters";
import { dropChances, equipmentDropPresentation, rollEquipmentRarity, rollFlaskDrop } from "../app/game/loot";
import { activeStashTab, addStashTab, createStash, insertItemsIntoStash, renameStashTab, selectStashTab, stashItems } from "../app/game/stash";
import { allocateAttributePoint, allocateSkillPoint, grantCharacterExperience, monsterExperienceReward } from "../app/game/progression";
import { resolveSkillDefinition } from "../app/game/skills";

const source = "test";
const modifier = (mode: StatModifier["mode"], value: number): StatModifier => ({ stat: "maxLife", mode, value, source });
const characterProgress = (level = 1): PlayerProfile["character"] => ({
  name: "Test", archetype: "Test", classId: "amazon", created: true, level, xp: 0,
  allocatedAttributes: { strength: 0, dexterity: 0, intelligence: 0 },
  unspentAttributePoints: 0, skillLevels: { nova: 1, dash: 1, ward: 1, flameWave: 1 }, unspentSkillPoints: 0,
  mapsCompleted: 0, highestWave: 0,
});

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
    version: 9,
    character: characterProgress(10),
    inventory: createItemContainer("backpack"), stash: createStash(), equipped: { mainHand: weapon }, flaskBelt: [null, null, null, null, null], mapDevice: null, openedMap: null,
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
    version: 9,
    character: characterProgress(),
    inventory: createItemContainer("backpack"), stash: createStash(), equipped: {}, flaskBelt: [null, null, null, null, null], mapDevice: null, openedMap: null,
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

test("equipment comparison resolves replacement deltas through the character stat engine", () => {
  const equippedWeapon = {
    kind: "equipment", id: "equipped-spear", baseId: "hunter-spear", baseName: "Hunter Spear", slot: "mainHand", rarity: "normal", itemLevel: 1,
    stability: 8, maxStability: 8, implicit: "", baseStats: [{ stat: "attackDamage", mode: "flat", value: 7, source: "base:old" }],
    implicitModifiers: [{ stat: "attackSpeed", mode: "increased", value: 8, source: "implicit:old" }], affixes: [],
  } satisfies EquipmentItem;
  const candidateWeapon = {
    kind: "equipment", id: "candidate-cleaver", baseId: "iron-cleaver", baseName: "Iron Cleaver", slot: "mainHand", rarity: "rare", itemLevel: 20,
    stability: 8, maxStability: 8, implicit: "", baseStats: [{ stat: "attackDamage", mode: "flat", value: 24, source: "base:new" }],
    implicitModifiers: [{ stat: "attackDamage", mode: "flat", value: 4, source: "implicit:new" }], affixes: [],
  } satisfies EquipmentItem;
  const profile = {
    version: 9,
    character: characterProgress(10),
    inventory: createItemContainer("backpack"), stash: createStash(), equipped: { mainHand: equippedWeapon }, flaskBelt: [null, null, null, null, null], mapDevice: null, openedMap: null,
  } satisfies PlayerProfile;

  const comparisons = compareEquipmentToCurrent(profile, candidateWeapon);
  assert.equal(comparisons.length, 1);
  const comparison = comparisons[0];
  assert.equal(comparison.slot, "mainHand");
  assert.equal(comparison.slotLabel, "Main Hand");
  assert.equal(comparison.equippedItem?.id, equippedWeapon.id);
  assert.ok(comparison.statDeltas.some((delta) => delta.stat === "attackDamage" && delta.delta > 0));
  assert.ok(comparison.statDeltas.some((delta) => delta.stat === "attackSpeed" && delta.delta < 0));

  const expected = calculateCharacterStats({ ...profile, equipped: { mainHand: candidateWeapon } }).stats;
  const attackDamage = comparison.statDeltas.find((delta) => delta.stat === "attackDamage");
  assert.equal(attackDamage?.candidate, expected.attackDamage);
});

test("equipped items do not compare against themselves", () => {
  const equipped = generateStarterWeapon("amazon");
  const profile = { ...createInitialProfile(), equipped: { mainHand: equipped } };
  assert.deepEqual(compareEquipmentToCurrent(profile, equipped), []);
});

test("multi-slot equipment compares independently against every supported slot", () => {
  const ring = (id: string, focus: number): EquipmentItem => ({
    kind: "equipment", id, baseId: "ember-ring", baseName: "Ember Ring", slot: "ring", rarity: "magic", itemLevel: 10,
    stability: 8, maxStability: 8, implicit: `+${focus} maximum Focus`, baseStats: [],
    implicitModifiers: [{ stat: "maxFocus", mode: "flat", value: focus, source: `implicit:${id}` }], affixes: [],
  });
  const left = ring("left-ring", 8);
  const right = ring("right-ring", 12);
  const candidate = ring("candidate-ring", 20);
  const profile = {
    ...createInitialProfile(),
    character: characterProgress(10),
    equipped: { ringLeft: left, ringRight: right },
  } satisfies PlayerProfile;

  const comparisons = compareEquipmentToCurrent(profile, candidate);
  assert.deepEqual(comparisons.map((comparison) => comparison.slot), ["ringLeft", "ringRight"]);
  assert.deepEqual(comparisons.map((comparison) => comparison.equippedItem?.id), [left.id, right.id]);
  assert.ok(comparisons[0].statDeltas.find((delta) => delta.stat === "maxFocus")!.delta > comparisons[1].statDeltas.find((delta) => delta.stat === "maxFocus")!.delta);
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
  assert.equal(profile.version, 9);
  assert.deepEqual(profile.stash.tabs.map((tab) => tab.name), ["General", "Gear", "Maps", "Materials"]);
  assert.equal(profile.mapDevice, null);
  assert.equal(backpackItems.filter(isMapItem).length, 3);
  assert.equal(countCurrency(backpackItems, "scrap"), 12);
  assert.equal("materials" in profile, false);
  assert.equal("maps" in profile, false);
});

test("v3 counter saves migrate maps and currency into positioned v9 inventory items", () => {
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
    assert.equal(migrated.version, 9);
    assert.equal(migrated.character.unspentAttributePoints, 55);
    assert.equal(migrated.character.unspentSkillPoints, 0);
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
  const v5 = { ...current, version: 5, stash: createItemContainer("stash"), equipped: { weapon: legacyWeapon } };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v5" ? JSON.stringify(v5) : null } },
  });
  try {
    const migrated = loadProfile();
    assert.equal(migrated.version, 9);
    assert.equal(migrated.equipped.mainHand?.id, "legacy-equipped");
    assert.equal(migrated.equipped.mainHand?.slot, "mainHand");
    assert.equal("weapon" in migrated.equipped, false);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("v6 saves migrate their positioned stash into the first named tab", () => {
  const current = createInitialProfile();
  const stack = createCurrencyStack("essence", 3);
  const legacyStash = insertItem(createItemContainer("stash"), stack, { x: 3, y: 2 }).container;
  const v6 = { ...current, version: 6, stash: legacyStash };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v6" ? JSON.stringify(v6) : null } },
  });
  try {
    const migrated = loadProfile();
    const firstTab = activeStashTab(migrated.stash);
    assert.equal(migrated.version, 9);
    assert.equal(firstTab.name, "General");
    assert.deepEqual(firstTab.container.entries[0], { item: stack, x: 3, y: 2 });
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("v7 saves gain explicit unspent progression points without losing character progress", () => {
  const current = createInitialProfile();
  const legacy = {
    ...current,
    version: 7,
    character: {
      name: "Legacy", archetype: "Spear", classId: "amazon", created: true,
      level: 6, xp: 17, unspentPassives: 2, mapsCompleted: 3, highestWave: 4,
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v7" ? JSON.stringify(legacy) : null } },
  });
  try {
    const migrated = loadProfile();
    assert.equal(migrated.version, 9);
    assert.equal(migrated.character.level, 6);
    assert.equal(migrated.character.xp, 17);
    assert.equal(migrated.character.unspentAttributePoints, 25);
    assert.equal(migrated.character.unspentSkillPoints, 2);
    assert.deepEqual(migrated.character.skillLevels, { nova: 1, dash: 1, ward: 1, flameWave: 1 });
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("legacy saves migrate to an empty five-slot flask belt", () => {
  const current = createInitialProfile();
  const legacy = { ...current, version: 8, flaskBelt: undefined };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v8" ? JSON.stringify(legacy) : null } },
  });
  try {
    const migrated = loadProfile();
    assert.equal(migrated.version, 9);
    assert.deepEqual(migrated.flaskBelt, [null, null, null, null, null]);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("existing v9 four-slot belts gain the fifth slot without losing flasks", () => {
  const current = createInitialProfile();
  const fourSlotSave = {
    ...current,
    character: { ...current.character, skillLevels: { nova: 4, dash: 2 } },
    flaskBelt: [createFlaskStack("weak-health-flask", 4), null, null, null],
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: (key: string) => key === "crafty.profile.v9" ? JSON.stringify(fourSlotSave) : null } },
  });
  try {
    const migrated = loadProfile();
    assert.equal(migrated.flaskBelt.length, 5);
    assert.equal(migrated.flaskBelt[0]?.stackSize, 4);
    assert.deepEqual(migrated.flaskBelt.slice(1), [null, null, null, null]);
    assert.deepEqual(migrated.character.skillLevels, { nova: 4, dash: 2, ward: 1, flameWave: 1 });
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("monster kills grant XP, levels award points, and allocated attributes affect real stats", () => {
  const created = { ...createInitialProfile(), character: characterProgress() };
  const reward = grantCharacterExperience(created, 80);
  assert.equal(reward.levelsGained, 1);
  assert.equal(reward.profile.character.level, 2);
  assert.equal(reward.profile.character.xp, 0);
  assert.equal(reward.profile.character.unspentAttributePoints, 5);
  assert.equal(reward.profile.character.unspentSkillPoints, 1);

  const before = calculateCharacterStats(reward.profile).stats.strength;
  const allocated = allocateAttributePoint(reward.profile, "strength");
  assert.equal(allocated.character.unspentAttributePoints, 4);
  assert.equal(calculateCharacterStats(allocated).stats.strength, before + 1);
  assert.ok(calculateCharacterStats(allocated).breakdown.strength.contributions.some((entry) => entry.source === "character:allocated-strength"));
});

test("active skills resolve their level, damage, cooldown, and hotkey configuration", () => {
  const nova1 = resolveSkillDefinition(ACTIVE_SKILLS.nova, 1);
  const nova5 = resolveSkillDefinition(ACTIVE_SKILLS.nova, 5);
  const nova20 = resolveSkillDefinition(ACTIVE_SKILLS.nova, 20);
  assert.equal(nova1.projectileCount, 18);
  assert.equal(nova1.piercing, 0);
  assert.equal(nova5.projectileCount, 22);
  assert.equal(nova5.piercing, 1);
  assert.equal(nova20.projectileCount, 37);
  assert.equal(nova20.piercing, 4);
  assert.equal(nova20.damage?.effectiveness, 2.49);
  assert.equal(nova20.recharge, 0);

  const dash1 = resolveSkillDefinition(ACTIVE_SKILLS.dash, 1);
  const dash20 = resolveSkillDefinition(ACTIVE_SKILLS.dash, 20);
  assert.equal(dash1.maxCharges, 3);
  assert.equal(dash20.maxCharges, 7);
  assert.equal(dash20.recharge, 1.48);

  const ward = resolveSkillDefinition(ACTIVE_SKILLS.ward, 1);
  const ward20 = resolveSkillDefinition(ACTIVE_SKILLS.ward, 20);
  assert.equal(ward.key, "R");
  assert.equal(ward.duration, 4);
  assert.equal(ward.damageReduction, 45);
  assert.equal(ward20.cooldown, 6.15);
  assert.equal(ward20.duration, 5.52);
  assert.ok(Math.abs(ward20.damageReduction - 56.4) < 0.0001);

  const flameWave = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, 1);
  const flameWave20 = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, 20);
  assert.equal(flameWave.key, "F");
  assert.equal(flameWave.projectileCount, 7);
  assert.equal(flameWave.piercing, 1);
  assert.equal(flameWave.cooldown, 5.5);
  assert.equal(flameWave.damage?.effectiveness, 1.65);
  assert.equal(flameWave20.projectileCount, 11);
  assert.equal(flameWave20.piercing, 5);
  assert.equal(flameWave20.damage?.effectiveness, 2.6);

  assert.deepEqual(Object.keys(characterProgress().skillLevels).sort(), Object.keys(ACTIVE_SKILLS).sort());

  let profile = { ...createInitialProfile(), character: { ...characterProgress(), unspentSkillPoints: 30 } };
  for (let index = 0; index < 30; index += 1) profile = allocateSkillPoint(profile, "nova");
  assert.equal(profile.character.skillLevels.nova, 20);
  assert.equal(profile.character.unspentSkillPoints, 11);

  profile = { ...profile, character: { ...profile.character, unspentSkillPoints: 1 } };
  profile = allocateSkillPoint(profile, "ward");
  assert.equal(profile.character.skillLevels.ward, 2);
});

test("monster XP scales with archetype, wave, map tier, and rarity", () => {
  const early = monsterExperienceReward("ashling", 1, 1, "normal");
  const late = monsterExperienceReward("ashling", 6, 4, "normal");
  const magic = monsterExperienceReward("ashling", 6, 4, "magic");
  const rare = monsterExperienceReward("ashling", 6, 4, "rare");
  assert.ok(late > early);
  assert.ok(magic > late);
  assert.ok(rare > magic);
  assert.ok(monsterExperienceReward("ironhide-brute", 1, 1, "normal") > early);
});

test("stash tabs are selectable, renamable, expandable, and insert into the active tab first", () => {
  let stash = createStash();
  stash = renameStashTab(stash, stash.activeTabId, "  Expedition Gear  ");
  assert.equal(activeStashTab(stash).name, "Expedition Gear");
  stash = selectStashTab(stash, stash.tabs[1].id);
  const stack = createCurrencyStack("scrap", 4);
  const inserted = insertItemsIntoStash(stash, [stack]);
  assert.equal(inserted.unplaced.length, 0);
  assert.equal(activeStashTab(inserted.stash).container.entries[0].item.id, stack.id);
  assert.equal(stashItems(inserted.stash).length, 1);
  const expanded = addStashTab(inserted.stash);
  assert.equal(expanded.tabs.length, 5);
  assert.equal(activeStashTab(expanded).name, "Tab 5");
});

test("dropping removes the exact item from backpack, stash, or equipment without mutating it", () => {
  const initial = createInitialProfile();
  const backpackItem = initial.inventory.entries[0].item;
  const fromBackpack = takeProfileItem(initial, backpackItem.id);
  assert.ok(fromBackpack);
  assert.equal(fromBackpack.source, "backpack");
  assert.equal(fromBackpack.item, backpackItem);
  assert.equal(fromBackpack.profile.inventory.entries.some((entry) => entry.item.id === backpackItem.id), false);

  const weapon = generateStarterWeapon("amazon");
  const equippedProfile = { ...initial, equipped: { mainHand: weapon } } satisfies PlayerProfile;
  const fromEquipment = takeProfileItem(equippedProfile, weapon.id);
  assert.ok(fromEquipment);
  assert.equal(fromEquipment.source, "equipment");
  assert.equal(fromEquipment.item, weapon);
  assert.equal(fromEquipment.profile.equipped.mainHand, undefined);

  const stashStack = createCurrencyStack("scrap", 7);
  const stashed = insertItemsIntoStash(initial.stash, [stashStack]);
  const stashProfile = { ...initial, stash: stashed.stash };
  const fromStash = takeProfileItem(stashProfile, stashStack.id);
  assert.ok(fromStash);
  assert.equal(fromStash.source, "stash");
  assert.deepEqual(fromStash.item, stashStack);
  assert.equal(stashItems(fromStash.profile.stash).some((item) => item.id === stashStack.id), false);
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

test("flasks stack to twenty in inventory and five in each belt slot", () => {
  const profile = createInitialProfile();
  assert.equal(FLASK_BELT_SLOT_COUNT, 5);
  assert.equal(profile.flaskBelt.length, 5);
  const flask = createFlaskStack("weak-health-flask", 20);
  const inserted = insertItem(profile.inventory, flask);
  assert.equal(inserted.unplaced.length, 0);
  const withFlasks = { ...profile, inventory: inserted.container };
  const loaded = loadFlaskIntoBelt(withFlasks, flask.id, 0);
  assert.ok(loaded);
  assert.equal(loaded.flaskBelt[0]?.stackSize, 5);
  assert.equal(containerItems(loaded.inventory).filter(isFlaskItem)[0].stackSize, 15);
  assert.equal(FLASK_DEFINITIONS["weak-health-flask"].maxInventoryStack, 20);
  assert.equal(FLASK_DEFINITIONS["weak-health-flask"].maxBeltStack, 5);

  const consumed = consumeFlaskFromBelt(loaded, 0);
  assert.ok(consumed);
  assert.equal(consumed.definition.recovery, 20);
  assert.equal(consumed.profile.flaskBelt[0]?.stackSize, 4);
  const unloaded = unloadFlaskFromBelt(consumed.profile, 0);
  assert.ok(unloaded);
  assert.equal(unloaded.flaskBelt[0], null);
  assert.deepEqual(containerItems(unloaded.inventory).filter(isFlaskItem).map((item) => item.stackSize), [19]);
});

test("picked-up flasks refill matching belt stacks before entering the backpack", () => {
  const profile = createInitialProfile();
  const equipped = {
    ...profile,
    flaskBelt: [
      createFlaskStack("weak-health-flask", 4),
      createFlaskStack("weak-mana-flask", 3),
      null,
      null,
      null,
    ],
  } satisfies PlayerProfile;

  const refilled = storePickedUpFlask(equipped, createFlaskStack("weak-health-flask", 1));
  assert.ok(refilled);
  assert.equal(refilled.beltAdded, 1);
  assert.equal(refilled.inventoryAdded, 0);
  assert.equal(refilled.profile.flaskBelt[0]?.stackSize, 5);
  assert.equal(containerItems(refilled.profile.inventory).filter(isFlaskItem).length, 0);

  const overflow = storePickedUpFlask(refilled.profile, createFlaskStack("weak-health-flask", 2));
  assert.ok(overflow);
  assert.equal(overflow.beltAdded, 0);
  assert.equal(overflow.inventoryAdded, 2);
  assert.deepEqual(containerItems(overflow.profile.inventory).filter(isFlaskItem).map((item) => item.stackSize), [2]);
});

test("picked-up flasks never auto-fill an empty belt slot", () => {
  const profile = createInitialProfile();
  const stored = storePickedUpFlask(profile, createFlaskStack("weak-health-flask", 1));
  assert.ok(stored);
  assert.equal(stored.beltAdded, 0);
  assert.equal(stored.inventoryAdded, 1);
  assert.deepEqual(stored.profile.flaskBelt, [null, null, null, null, null]);
  assert.deepEqual(containerItems(stored.profile.inventory).filter(isFlaskItem).map((item) => item.stackSize), [1]);
});

test("weak flasks recover over time and stop exactly at the resource maximum", () => {
  assert.deepEqual(advanceFlaskRecovery(40, 100, 20, 10, 1), { value: 50, remaining: 10 });
  assert.deepEqual(advanceFlaskRecovery(95, 100, 20, 10, 1), { value: 100, remaining: 0 });
  assert.deepEqual(advanceFlaskRecovery(100, 100, 20, 10, 1), { value: 100, remaining: 0 });
});

test("merchant sells both weak flask types and monsters roll configured flask drops", () => {
  const profile = createInitialProfile();
  const health = purchaseFlask(profile, "weak-health-supply");
  assert.ok(health);
  assert.equal(countCurrency(containerItems(health.profile.inventory), "scrap"), 11);
  assert.equal(containerItems(health.profile.inventory).filter(isFlaskItem)[0].baseId, "weak-health-flask");
  assert.equal(rollFlaskDrop(() => 0), "weak-health-flask");
  assert.equal(rollFlaskDrop(() => 0.999), "weak-mana-flask");
  assert.ok(dropChances(100).flask > 0);
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

test("a six-cell item fits directly below a four-cell item in the backpack", () => {
  const helmet = {
    kind: "equipment", id: "grid-helmet", baseId: "test", baseName: "Grid Helmet", slot: "helmet", rarity: "normal", itemLevel: 1,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [], affixes: [],
  } satisfies EquipmentItem;
  const chest = { ...helmet, id: "grid-chest", baseName: "Grid Chest", slot: "chest" } satisfies EquipmentItem;
  const backpack = {
    id: "backpack",
    entries: [{ item: helmet, x: 4, y: 0 }, { item: chest, x: 0, y: 0 }],
  } satisfies ItemContainer;

  assert.equal(canPlaceItem(backpack, chest, 4, 2, chest.id), true);
  const moved = moveItem(backpack, chest.id, 4, 2);
  assert.ok(moved);
  assert.deepEqual(moved.entries.find((entry) => entry.item.id === chest.id), { item: chest, x: 4, y: 2 });
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
  assert.equal(isArenaCleared(5, 6, 0), false);
  assert.equal(isArenaCleared(6, 6, 1), false);
  assert.equal(isArenaCleared(6, 6, 0), true);
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
  for (const monster of Object.values(MONSTER_ARCHETYPES)) {
    assert.match(monster.visual.sprite, new RegExp(`^/monsters/${monster.id}\\.png$`));
    assert.match(monster.visual.corpse, new RegExp(`^/monsters/${monster.id}-corpse\\.png$`));
    assert.ok(monster.visual.scale > 0);
    assert.ok(monster.visual.originY > 0 && monster.visual.originY <= 1);
  }

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
  const standard = dropChances(100);
  assert.equal(standard.equipment, 0.0055);
  assert.equal(standard.material, 0.016);
  assert.equal(standard.flask, 0.011);
  assert.equal(dropChances(200).equipment, dropChances(100).equipment * 2);
  assert.equal(dropChances(200).material, dropChances(100).material * 2);
  assert.equal(rollEquipmentRarity(100, () => 0.02), "magic");
  assert.equal(rollEquipmentRarity(400, () => 0.02), "rare");
});

test("ground equipment labels show the concrete base type and use canonical rarity colors", () => {
  assert.deepEqual(equipmentDropPresentation({ baseName: "Ashwood Wand", rarity: "normal" }), { label: "ASHWOOD WAND", color: "#f2eee6" });
  assert.deepEqual(equipmentDropPresentation({ baseName: "Hunter Spear", rarity: "magic" }), { label: "HUNTER SPEAR", color: "#749cff" });
  assert.deepEqual(equipmentDropPresentation({ baseName: "Riveted Coat", rarity: "rare" }), { label: "RIVETED COAT", color: "#ffe06a" });
});

test("runtime hit damage scales linearly with resolved attack damage", () => {
  assert.equal(calculateHitDamage(15, 1), 15);
  assert.equal(calculateHitDamage(30, 1), 30);
  assert.equal(calculateHitDamage(30, 1.35), 40.5);
  const base = resolveStat(20, []);
  const fiftyMore = resolveStat(20, [modifier("more", 50)]);
  assert.equal(calculateHitDamage(fiftyMore.value, 1) / calculateHitDamage(base.value, 1), 1.5);
  assert.deepEqual(rollHitDamage(30, BASIC_ATTACK.damage, () => 0), { amount: 24, type: "fire" });
  assert.deepEqual(rollHitDamage(30, BASIC_ATTACK.damage, () => 0.5), { amount: 30, type: "fire" });
  assert.deepEqual(rollHitDamage(30, BASIC_ATTACK.damage, () => 1), { amount: 36, type: "fire" });
  assert.throws(
    () => rollHitDamage(30, { ...BASIC_ATTACK.damage, range: { minMultiplier: 0.8, maxMultiplier: 1.1 } }),
    /midpoint must be 1/,
  );
  assert.equal(
    rollHitDamage(fiftyMore.value, BASIC_ATTACK.damage, () => 0.17).amount
      / rollHitDamage(base.value, BASIC_ATTACK.damage, () => 0.17).amount,
    1.5,
  );
});

test("every skill declares reusable animation, VFX, and audio presentation", () => {
  const skills = [BASIC_ATTACK, ACTIVE_SKILLS.nova, ACTIVE_SKILLS.dash, ACTIVE_SKILLS.ward, ACTIVE_SKILLS.flameWave];
  for (const skill of skills) {
    assert.ok(skill.presentation.animation);
    assert.ok(skill.presentation.vfx);
    assert.ok(SKILL_AUDIO[skill.presentation.audio].tones.length >= 2);
  }
});

test("character animation directions and release frames are config-driven", () => {
  assert.equal(resolveCharacterDirection(1, 0), "east");
  assert.equal(resolveCharacterDirection(-1, 0), "west");
  assert.equal(resolveCharacterDirection(0.2, -1), "north");
  assert.equal(resolveCharacterDirection(0.2, 1), "south");
  assert.equal(resolveLocomotionDirection(1, 1, "east"), "east");
  assert.equal(resolveLocomotionDirection(1, 1, "south"), "south");
  assert.equal(resolveLocomotionDirection(1, 0.4, "south"), "east");
  assert.equal(resolveLocomotionDirection(0.4, -1, "east"), "north");
  assert.deepEqual(characterDirectionVector("north"), { x: 0, y: -1 });
  assert.equal(CHARACTER_ANIMATIONS.amazon.clips.south.attack.releaseFrame, 2);
  assert.equal(CHARACTER_ANIMATIONS.amazon.clips.south.run.frameCount, 4);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.east.run.frameCount, 8);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.west.run.frameCount, 8);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.south.idle.frameCount, 1);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.north.idle.frameCount, 1);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.east.idle.frameCount, 1);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.south.run.frameCount, 8);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.south.attack.releaseFrame, 4);
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.south.run.sheet, "locomotion");
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.south.cast.sheet, "actions");
  assert.equal(CHARACTER_ANIMATIONS.sorceress.clips.west.cast.row, CHARACTER_ANIMATIONS.sorceress.clips.east.cast.row);
});

test("advanced item descriptions expose the rolled affix range on demand", () => {
  const attackSpeedRoll = {
    stat: "attackSpeed",
    mode: "increased",
    value: 13,
    min: 9,
    max: 14,
  } as const;
  assert.equal(formatModifierWithRollRange(attackSpeedRoll, false), "13% increased attack speed");
  assert.equal(formatModifierWithRollRange(attackSpeedRoll, true), "13% increased attack speed (9 - 14)");
});

test("every inventory base declares one stable icon asset", () => {
  const definitions = [...ITEM_BASES, ...MAP_BASES, ...Object.values(CURRENCY_DEFINITIONS)];
  const icons = definitions.map((definition) => definition.icon);
  assert.equal(icons.length, 20);
  assert.equal(new Set(icons).size, icons.length);
  assert.ok(icons.every((icon) => icon.startsWith("/item-icons/") && icon.endsWith(".png")));
});

test("character equipment exposes ten positions and fills both ring slots independently", () => {
  assert.equal(CHARACTER_EQUIPMENT_SLOTS.length, 10);
  assert.deepEqual(CHARACTER_EQUIPMENT_SLOTS.map((slot) => slot.id), [
    "helmet", "amulet", "mainHand", "chest", "offHand", "gloves", "ringLeft", "belt", "ringRight", "boots",
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
