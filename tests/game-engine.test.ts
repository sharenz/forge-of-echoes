import assert from "node:assert/strict";
import test from "node:test";
import { MINIMUM_ACTION_TIME_SECONDS, resolveAnimationPlaybackRate, resolveAttackTimeSeconds } from "../app/game/action-timing";
import { AFFIX_DEFINITIONS_BY_ID } from "../app/game/config/affixes";
import { ARENA_RULES } from "../app/game/config/arena";
import { SKILL_AUDIO } from "../app/game/config/audio";
import { effectiveMusicVolume, effectiveWorldVolume, normalizeAudioSettings } from "../app/game/audio-settings";
import { CHARACTER_ANIMATIONS, characterDirectionVector, resolveCharacterDirection, resolveLocomotionDirection } from "../app/game/config/character-animations";
import { CURRENCY_DEFINITIONS } from "../app/game/config/currencies";
import { FLASK_BELT_SLOT_COUNT, FLASK_DEFINITIONS } from "../app/game/config/flasks";
import { DEBUG_MERCHANT_ID, MAP_MERCHANT, availableMerchantIds } from "../app/game/config/merchants";
import { MAP_BASES, MAP_MODIFIERS, MAP_TIER_RULES } from "../app/game/config/maps";
import { CHARACTER_EQUIPMENT_SLOTS } from "../app/game/config/equipment-slots";
import { ITEM_BASES } from "../app/game/config/item-bases";
import { MONSTER_ARCHETYPES } from "../app/game/config/monsters";
import type { CurrencyId, EquipmentItem, InventoryItem, ItemContainer, MapItem, PlayerProfile, StatModifier } from "../app/game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts } from "../app/game/equipment";
import { createCurrencyStack, isCurrencyItem, isFlaskItem, isMapItem } from "../app/game/inventory";
import { consumeFlaskFromBelt, createFlaskStack, loadFlaskIntoBelt, storePickedUpFlask, unloadFlaskFromBelt } from "../app/game/flasks";
import { canPlaceItem, consumeContainerCurrency, containerItems, createItemContainer, insertItem, moveItem, transferItem } from "../app/game/item-container";
import { compareEquipmentToCurrent } from "../app/game/item-comparison";
import { storePickedUpItem, takeProfileItem } from "../app/game/item-drop";
import {
  canCreateAffixForItem,
  createAffixForItem,
  eligibleAffixTiers,
  generateStarterWeapon,
  rerollAffixValues,
  scaleBaseModifier,
} from "../app/game/items";
import { calculateCharacterStats, formatModifier, formatModifierWithRollRange, resolveStat } from "../app/game/stats";
import { createInitialProfile } from "../app/game/profile";
import { purchaseMerchantOffer } from "../app/game/merchant";
import { ACTIVE_SKILLS, BASIC_ATTACK, buildArenaBalance, calculateHitDamage, isArenaCleared, monsterLevelForMapTier, rollHitDamage, shouldActivateFinalWaveRage, shouldSpawnNextWave } from "../app/game/combat";
import { createMap, mapModifierDescription, mapModifierRewardDescription } from "../app/game/maps";
import { packRarityChances, resolveMonsterStats, rollMonsterPack } from "../app/game/encounters";

test("audio settings normalize stored preferences and resolve independent channel gains", () => {
  const settings = normalizeAudioSettings({ overall: 0.5, music: 0.8, world: 2 });
  assert.deepEqual(settings, { overall: 0.5, music: 0.8, world: 1 });
  assert.equal(effectiveMusicVolume(settings), 0.4);
  assert.equal(effectiveWorldVolume(settings), 0.5);
  assert.deepEqual(normalizeAudioSettings(null), { overall: 1, music: 1, world: 1 });
});
import { dropChances, equipmentDropPresentation, rollEquipmentRarity, rollFlaskDrop, rollMapDropTier, rollMonsterDrop } from "../app/game/loot";
import { activeStashTab, addStashTab, createStash, insertItemsIntoStash, renameStashTab, selectStashTab, stashItems } from "../app/game/stash";
import { allocateAttributePoint, allocateSkillPoint, grantCharacterExperience, grantCharacterProgressExperience, monsterExperienceReward } from "../app/game/progression";
import { resolveSkillDefinition } from "../app/game/skills";
import { MAP_COMPLETION_REWARDS } from "../app/game/config/rewards";
import { MULTIPLAYER_LIMITS } from "../multiplayer/protocol";
import { MULTIPLAYER_COMBAT } from "../multiplayer/combat";
import { createMapCompletionRewards } from "../app/game/rewards";
import { applyBackpackCurrency, canApplyCraftingCurrency, craftingTargetError } from "../app/game/crafting";
import { isWorldPointerOrigin, resolveAimVector } from "../app/game2d/input-boundary";
import { isSkillEquipped, normalizeSkillLoadout, setSkillLoadoutSlot } from "../app/game/skill-loadout";

const source = "test";
const modifier = (mode: StatModifier["mode"], value: number): StatModifier => ({ stat: "maxLife", mode, value, source });
const countCurrency = (items: readonly InventoryItem[], currencyId: CurrencyId): number => items.reduce((total, item) => (
  isCurrencyItem(item) && item.baseId === currencyId ? total + item.stackSize : total
), 0);
const characterProgress = (level = 1): PlayerProfile["character"] => ({
  name: "Test", classId: "amazon", level, xp: 0,
  allocatedAttributes: { strength: 0, dexterity: 0, intelligence: 0 },
  unspentAttributePoints: 0, skillLevels: { nova: 1, dash: 1, ward: 1, flameWave: 1 }, unspentSkillPoints: 0,
  skillLoadout: ["basic", "nova", "dash", "ward", "flameWave"],
  mapsCompleted: 0, highestWave: 0,
});
const profileWithEmptyFlaskBelt = (): PlayerProfile => ({
  ...createInitialProfile(),
  flaskBelt: [null, null, null, null, null],
});

test("world attacks accept only empty-canvas pointer origins", () => {
  const canvas = new EventTarget();
  const interfaceButton = new EventTarget();
  assert.equal(isWorldPointerOrigin(canvas, canvas, 0), true);
  assert.equal(isWorldPointerOrigin(interfaceButton, canvas, 0), false);
  assert.equal(isWorldPointerOrigin(canvas, canvas, 1), false);
  assert.equal(isWorldPointerOrigin(null, canvas, 0), false);
});

test("live mouse aim resolves the release pointer to a finite unit vector", () => {
  const fallback = { x: 0, y: 1 };
  assert.deepEqual(resolveAimVector(10, 20, 13, 24, fallback), { x: 0.6, y: 0.8 });
  assert.deepEqual(resolveAimVector(10, 20, 10, 20, fallback), fallback);
  assert.deepEqual(resolveAimVector(10, 20, Number.NaN, 20, fallback), fallback);
});

test("skill loadouts normalize persisted data and can clear or assign any slot", () => {
  const profile = createInitialProfile();
  const cleared = setSkillLoadoutSlot(profile, 4, null);
  assert.equal(cleared.character.skillLoadout[4], null);
  const reassigned = setSkillLoadoutSlot(cleared, 4, "nova");
  assert.equal(reassigned.character.skillLoadout[4], "nova");
  assert.equal(isSkillEquipped(reassigned.character.skillLoadout, "flameWave"), false);
  assert.equal(isSkillEquipped(reassigned.character.skillLoadout, "basic"), true);
  assert.deepEqual(normalizeSkillLoadout(["basic", "nova", "invalid", null, "ward"]), ["basic", "nova", null, null, "ward"]);
  assert.deepEqual(normalizeSkillLoadout(null), ["basic", "nova", "dash", "ward", "flameWave"]);
});

test("map completion rewards guarantee two equipment items, one magic-or-better, and crafting materials", () => {
  const rewards = createMapCompletionRewards(20, 100, 4, () => 0.999999);
  const equipment = rewards.filter((reward) => reward.kind === "equipment");
  const currencies = rewards.filter((reward) => reward.kind === "currency");
  const maps = rewards.filter((reward) => reward.kind === "inventory" && isMapItem(reward.item));
  assert.equal(equipment.length, 2);
  assert.equal(maps.length, 1);
  assert.equal(maps[0].kind === "inventory" && isMapItem(maps[0].item) ? maps[0].item.tier : 0, 5);
  assert.ok(equipment.some((reward) => reward.kind === "equipment" && reward.item.rarity !== "normal"));
  for (const configured of MAP_COMPLETION_REWARDS.materials) {
    const reward = currencies.find((candidate) => candidate.kind === "currency" && candidate.currency === configured.currency);
    assert.ok(reward && reward.kind === "currency");
    assert.ok(reward.amount >= configured.minimum && reward.amount <= configured.maximum);
  }
});

test("map tier resolves one canonical monster level for UI, monsters, and item drops", () => {
  assert.equal(monsterLevelForMapTier(1), ARENA_RULES.monsterLevel.minimum);
  assert.equal(monsterLevelForMapTier(3), 15);
  assert.equal(monsterLevelForMapTier(999), ARENA_RULES.monsterLevel.maximum);
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
      requiredItemLevel: 1, group: "test",
      rolls: [{ stat: "attackDamage", mode: "more", value: 50, min: 50, max: 50, source: "affix:test" }],
    }],
  } satisfies EquipmentItem;
  const profile = {
    version: 10,
    character: characterProgress(10),
    inventory: createItemContainer("backpack"), stash: createStash(), equipped: { mainHand: weapon }, flaskBelt: [null, null, null, null, null], mapDevice: null,
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
    version: 10,
    character: characterProgress(),
    inventory: createItemContainer("backpack"), stash: createStash(), equipped: {}, flaskBelt: [null, null, null, null, null], mapDevice: null,
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

test("cast speed resolves from Intelligence and item modifiers into cast time and animation rate", () => {
  const initial = createInitialProfile("Sorceress", "sorceress");
  const profile = { ...initial, equipped: {} };
  const base = calculateCharacterStats(profile);
  assert.equal(base.breakdown.castSpeed.flat, 1);
  assert.equal(base.breakdown.castSpeed.increased, 9);
  assert.equal(base.stats.castSpeed, 1.09);
  assert.ok(base.breakdown.castSpeed.contributions.some((entry) => entry.source === "attribute:intelligence:cast-speed"));

  const amulet = {
    kind: "equipment", id: "cast-amulet", baseId: "cinder-pendant", baseName: "Cinder Pendant", slot: "amulet", rarity: "magic", itemLevel: 1,
    stability: 8, maxStability: 8, implicit: "", baseStats: [], implicitModifiers: [],
    affixes: [{
      id: "cast-affix", definitionId: "of-incantation", name: "of Incantation", tag: "speed", tier: 1,
      requiredItemLevel: 1, group: "cast-speed",
      rolls: [{ stat: "castSpeed", mode: "increased", value: 100, min: 100, max: 100, source: "affix:cast-speed" }],
    }],
  } satisfies EquipmentItem;
  const equipped = calculateCharacterStats({ ...profile, equipped: { ...profile.equipped, amulet } });
  assert.equal(equipped.stats.castSpeed, 2.09);

  const nova = resolveSkillDefinition(ACTIVE_SKILLS.nova, 1, 1, equipped.stats.castSpeed);
  assert.ok(Math.abs(nova.castTime - 0.75 / 2.09) < 0.0001);
  const playbackRate = resolveAnimationPlaybackRate(8, 12, { durationSeconds: nova.castTime });
  assert.ok(playbackRate > 1.8, "the cast animation accelerates to finish in the resolved cast time");
  assert.equal(buildArenaBalance({ ...profile, equipped: { ...profile.equipped, amulet } }).castSpeed, 2.09);
  assert.equal(AFFIX_DEFINITIONS_BY_ID["of-incantation"].group, "cast-speed");
});

test("attack animation timing uses the same duration as attacks per second", () => {
  const attackTime = resolveAttackTimeSeconds(2.5);
  assert.equal(attackTime, 0.4);
  assert.equal(resolveAnimationPlaybackRate(8, 14, { durationSeconds: attackTime }), (8 / 14) / 0.4);
  assert.equal(resolveAttackTimeSeconds(10_000), MINIMUM_ACTION_TIME_SECONDS, "client attacks cannot outpace an authoritative simulation tick");
});

test("transport rate limit accommodates simultaneous movement and held actions", () => {
  const movementMessagesPerSecond = 1 / 0.08;
  const heldActionsPerSecond = 2 / MINIMUM_ACTION_TIME_SECONDS;
  const expectedPeakInputRate = movementMessagesPerSecond + heldActionsPerSecond;

  assert.ok(expectedPeakInputRate > 30, "the old transport ceiling rejected valid gameplay");
  assert.ok(
    MULTIPLAYER_LIMITS.maximumClientMessagesPerSecond >= expectedPeakInputRate * 2,
    "transport ceiling retains headroom for command bursts without becoming unbounded",
  );
  assert.ok(MULTIPLAYER_LIMITS.maximumClientMessagesPerSecond <= 200);
});

test("authoritative projectile budget covers maximum configured skill cadence", () => {
  const nova = resolveSkillDefinition(ACTIVE_SKILLS.nova, 20, 0, 10_000);
  const flameWave = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, 20, 0, 10_000);
  const activeBurstProjectiles = (range: number, cooldown: number, projectileCount: number) => (
    Math.ceil((range / MULTIPLAYER_COMBAT.projectile.speed) / cooldown) * projectileCount
  );
  const activeBasicProjectiles = Math.ceil(
    (MULTIPLAYER_COMBAT.projectile.basicRange / MULTIPLAYER_COMBAT.projectile.speed)
      / MINIMUM_ACTION_TIME_SECONDS,
  );
  const maximumConfiguredActiveProjectiles = activeBasicProjectiles
    + activeBurstProjectiles(MULTIPLAYER_COMBAT.projectile.novaRange, nova.cooldown, nova.projectileCount)
    + activeBurstProjectiles(MULTIPLAYER_COMBAT.projectile.flameWaveRange, flameWave.cooldown, flameWave.projectileCount);

  assert.ok(maximumConfiguredActiveProjectiles > 64, "the previous limit rejected valid Nova casts");
  assert.ok(MULTIPLAYER_COMBAT.projectile.maximumActivePerPlayer >= maximumConfiguredActiveProjectiles);
  assert.ok(
    MULTIPLAYER_COMBAT.projectile.maximumRenderedPerClient < MULTIPLAYER_COMBAT.projectile.maximumActivePerPlayer,
    "visual sampling stays bounded independently from authoritative simulation",
  );
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
    version: 10,
    character: characterProgress(10),
    inventory: createItemContainer("backpack"), stash: createStash(), equipped: { mainHand: equippedWeapon }, flaskBelt: [null, null, null, null, null], mapDevice: null,
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

test("currency stacks obey their configured maximum and overflow into a new stack", () => {
  const first = createItemContainer("backpack", [createCurrencyStack("scrap", 39)]);
  const stacked = insertItem(first, createCurrencyStack("scrap", 3));
  assert.equal(stacked.unplaced.length, 0);
  const scrapStacks = containerItems(stacked.container).filter(isCurrencyItem);
  assert.equal(CURRENCY_DEFINITIONS.scrap.maxStackSize, 40);
  assert.deepEqual(scrapStacks.map((item) => item.stackSize), [40, 2]);
  assert.equal(countCurrency(containerItems(stacked.container), "scrap"), 42);
});

test("crafting applies the selected currency stack directly to a compatible backpack item", () => {
  const equipment = generateStarterWeapon("sorceress");
  const scrap = createCurrencyStack("scrap", 2);
  const inventory = createItemContainer("backpack", [scrap, equipment]);
  const crafted = applyBackpackCurrency(inventory, scrap.id, equipment.id);
  assert.ok(crafted);

  const remainingScrap = crafted.entries.find((entry) => entry.item.id === scrap.id)?.item;
  const craftedEquipment = crafted.entries.find((entry) => entry.item.id === equipment.id)?.item;
  assert.equal(remainingScrap?.kind === "currency" ? remainingScrap.stackSize : 0, 1);
  assert.ok(craftedEquipment?.kind === "equipment");
  assert.equal(craftedEquipment.stability, equipment.stability - 1);
  assert.equal(canApplyCraftingCurrency("mapDust", equipment), false);
  assert.equal(applyBackpackCurrency(inventory, scrap.id, scrap.id), null);
});

test("ember essence rejects an item when its only eligible fire affix group is already present", () => {
  const fireAffix = createAffixForItem({ slot: "ring", itemLevel: 10, affixes: [] }, "fire", () => 0);
  assert.ok(fireAffix);
  const ring = {
    kind: "equipment", id: "scorching-ring", baseId: "ember-ring", baseName: "Ember Ring", slot: "ring", rarity: "magic", itemLevel: 10,
    stability: 3, maxStability: 8, implicit: "+8 maximum Focus", baseStats: [], implicitModifiers: [], affixes: [fireAffix],
  } satisfies EquipmentItem;

  assert.equal(canCreateAffixForItem(ring, "fire"), false);
  assert.equal(canApplyCraftingCurrency("essence", ring), false);
  assert.equal(craftingTargetError("essence", ring), "No eligible Fire affix remains for this item.");
});

test("currency consumption removes quantities across actual inventory stacks", () => {
  const container = createItemContainer("backpack", [createCurrencyStack("essence", 40), createCurrencyStack("essence", 6)]);
  const consumed = consumeContainerCurrency(container, "essence", 43);
  assert.ok(consumed);
  assert.equal(countCurrency(containerItems(consumed), "essence"), 3);
  assert.deepEqual(containerItems(consumed).filter(isCurrencyItem).map((item) => item.stackSize), [3]);
});

test("new profiles contain map and currency items in the backpack", () => {
  const profile = createInitialProfile();
  const backpackItems = containerItems(profile.inventory);
  assert.equal(profile.version, 10);
  assert.deepEqual(profile.stash.tabs.map((tab) => tab.name), ["General", "Gear", "Maps", "Materials"]);
  assert.equal(profile.mapDevice, null);
  assert.equal(backpackItems.filter(isMapItem).length, 3);
  assert.equal(countCurrency(backpackItems, "scrap"), 12);
  assert.equal("materials" in profile, false);
  assert.equal("maps" in profile, false);
});

test("monster kills grant XP, levels award points, and allocated attributes affect real stats", () => {
  const created = { ...createInitialProfile(), character: characterProgress() };
  const preview = grantCharacterProgressExperience(created.character, 80);
  assert.equal(preview.character.level, 2, "replicated map XP can preview level progress without a full profile save");
  assert.equal(preview.character.xp, 0);
  assert.equal(created.character.level, 1, "the authoritative input remains immutable");
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
  assert.equal(nova1.castTime, 0.75);
  assert.equal(resolveSkillDefinition(ACTIVE_SKILLS.nova, 1, 1, 2).castTime, 0.375);

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
  const [entry, ...harderMaps] = MAP_MERCHANT.offers.filter((offer) => offer.kind === "map");
  assert.ok(entry?.kind === "map");
  assert.equal(entry.tier, 1);
  assert.equal(entry.price.amount, 0);
  for (const offer of harderMaps) {
    assert.equal(offer.price.currency, "scrap");
    assert.ok(offer.price.amount > 0);
  }
});

test("merchant map purchases create inventory items and consume real Scrap stacks", () => {
  const profile = createInitialProfile();
  const initialMaps = containerItems(profile.inventory).filter(isMapItem).length;
  const freePurchase = purchaseMerchantOffer(profile, "cartographer-rook", "free-ashen-t1");
  assert.ok(freePurchase);
  assert.ok(freePurchase.item.kind === "map");
  assert.equal(freePurchase.item.tier, 1);
  assert.equal(containerItems(freePurchase.profile.inventory).filter(isMapItem).length, initialMaps + 1);
  assert.equal(countCurrency(containerItems(freePurchase.profile.inventory), "scrap"), 12);

  const paidPurchase = purchaseMerchantOffer(freePurchase.profile, "cartographer-rook", "iron-trial-t2");
  assert.ok(paidPurchase);
  assert.ok(paidPurchase.item.kind === "map");
  assert.equal(paidPurchase.item.tier, 2);
  assert.equal(countCurrency(containerItems(paidPurchase.profile.inventory), "scrap"), 6);
  assert.equal(purchaseMerchantOffer(paidPurchase.profile, "cartographer-rook", "ashen-descent-t4"), null);
});

test("flasks stack to twenty in inventory and five in each belt slot", () => {
  const profile = profileWithEmptyFlaskBelt();
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

test("using the last flask preserves its belt assignment and the next pickup refills it", () => {
  const profile = {
    ...createInitialProfile(),
    flaskBelt: [createFlaskStack("weak-health-flask", 1), null, null, null, null],
  } satisfies PlayerProfile;
  const consumed = consumeFlaskFromBelt(profile, 0);
  assert.ok(consumed);
  assert.equal(consumed.profile.flaskBelt[0]?.baseId, "weak-health-flask");
  assert.equal(consumed.profile.flaskBelt[0]?.stackSize, 0);

  const refilled = storePickedUpFlask(consumed.profile, createFlaskStack("weak-health-flask", 1));
  assert.ok(refilled);
  assert.equal(refilled.profile.flaskBelt[0]?.stackSize, 1);
  assert.equal(refilled.beltAdded, 1);
  assert.equal(refilled.inventoryAdded, 0);
});

test("the shared world-pickup path refills a depleted configured flask slot", () => {
  const depleted = {
    ...createInitialProfile(),
    flaskBelt: [{ ...createFlaskStack("weak-health-flask", 1), stackSize: 0 }, null, null, null, null],
  } satisfies PlayerProfile;

  const stored = storePickedUpItem(depleted, createFlaskStack("weak-health-flask", 1));
  assert.ok(stored);
  assert.equal(stored.flaskBelt[0]?.baseId, "weak-health-flask");
  assert.equal(stored.flaskBelt[0]?.stackSize, 1);
  assert.equal(containerItems(stored.inventory).filter(isFlaskItem).length, 0);
});

test("the shared world-pickup path leaves unconfigured belt slots empty", () => {
  const stored = storePickedUpItem(profileWithEmptyFlaskBelt(), createFlaskStack("weak-health-flask", 1));
  assert.ok(stored);
  assert.deepEqual(stored.flaskBelt, [null, null, null, null, null]);
  assert.deepEqual(containerItems(stored.inventory).filter(isFlaskItem).map((item) => item.stackSize), [1]);
});

test("picked-up flasks never auto-fill an empty belt slot", () => {
  const profile = profileWithEmptyFlaskBelt();
  const stored = storePickedUpFlask(profile, createFlaskStack("weak-health-flask", 1));
  assert.ok(stored);
  assert.equal(stored.beltAdded, 0);
  assert.equal(stored.inventoryAdded, 1);
  assert.deepEqual(stored.profile.flaskBelt, [null, null, null, null, null]);
  assert.deepEqual(containerItems(stored.profile.inventory).filter(isFlaskItem).map((item) => item.stackSize), [1]);
});

test("merchant sells both weak flask types and monsters roll configured flask drops", () => {
  const profile = createInitialProfile();
  const health = purchaseMerchantOffer(profile, "cartographer-rook", "weak-health-supply");
  assert.ok(health);
  assert.equal(countCurrency(containerItems(health.profile.inventory), "scrap"), 11);
  assert.equal(containerItems(health.profile.inventory).filter(isFlaskItem)[0].baseId, "weak-health-flask");
  assert.equal(rollFlaskDrop(() => 0), "weak-health-flask");
  assert.equal(rollFlaskDrop(() => 0.999), "weak-mana-flask");
  assert.ok(dropChances(100).flask > 0);
});

test("debug merchant is entitlement-only and its catalog is fixed configuration", () => {
  assert.deepEqual(availableMerchantIds([]), ["cartographer-rook"]);
  assert.deepEqual(availableMerchantIds([DEBUG_MERCHANT_ID]), ["cartographer-rook", DEBUG_MERCHANT_ID]);
  const ring = purchaseMerchantOffer(createInitialProfile(), DEBUG_MERCHANT_ID, "impossible-haste-ring");
  assert.ok(ring?.item.kind === "equipment");
  assert.equal(ring.item.slot, "ring");
  assert.deepEqual(ring.item.affixes.flatMap((affix) => affix.rolls.map((roll) => [roll.stat, roll.mode, roll.value])), [
    ["attackSpeed", "increased", 10_000],
  ]);

  const castRing = purchaseMerchantOffer(createInitialProfile(), DEBUG_MERCHANT_ID, "impossible-incantation-ring");
  assert.ok(castRing?.item.kind === "equipment");
  assert.equal(castRing.item.slot, "ring");
  assert.equal(formatModifier(castRing.item.affixes[0].rolls[0]), "10000% increased cast speed");
  const castProfile = {
    ...castRing.profile,
    equipped: { ...castRing.profile.equipped, ring1: castRing.item },
  };
  const castSpeedMultiplier = calculateCharacterStats(castProfile).stats.castSpeed;
  assert.ok(castSpeedMultiplier > 100);
  assert.equal(resolveSkillDefinition(ACTIVE_SKILLS.nova, 1, 1, castSpeedMultiplier).castTime, 0.05);

  const amulet = purchaseMerchantOffer(createInitialProfile(), DEBUG_MERCHANT_ID, "impossible-celerity-amulet");
  assert.ok(amulet?.item.kind === "equipment");
  assert.equal(formatModifier(amulet.item.affixes[0].rolls[0]), "10000% reduced skill cooldown");
  const equippedProfile = {
    ...amulet.profile,
    equipped: { ...amulet.profile.equipped, amulet: amulet.item },
  };
  const cooldownMultiplier = calculateCharacterStats(equippedProfile).stats.skillCooldown;
  assert.equal(cooldownMultiplier, 0.01);
  assert.equal(resolveSkillDefinition(ACTIVE_SKILLS.nova, 1, cooldownMultiplier).cooldown, 0.1);
  assert.equal(resolveSkillDefinition(ACTIVE_SKILLS.dash, 1, cooldownMultiplier).recharge, 0.1);

  const belt = purchaseMerchantOffer(createInitialProfile(), DEBUG_MERCHANT_ID, "impossible-font-belt");
  assert.ok(belt?.item.kind === "equipment");
  assert.equal(formatModifier(belt.item.affixes[0].rolls[0]), "10000% increased Focus recovery rate");
  const fontProfile = {
    ...belt.profile,
    equipped: { ...belt.profile.equipped, belt: belt.item },
  };
  assert.equal(calculateCharacterStats(fontProfile).stats.focusRegen, 808);
  assert.equal(buildArenaBalance(fontProfile).focusRegen, 808);
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

test("the final wave enrages every survivor after its configured countdown", () => {
  assert.equal(ARENA_RULES.finalWaveRageDelaySeconds, 30);
  assert.equal(shouldActivateFinalWaveRage(5, 6, 60, false), false);
  assert.equal(shouldActivateFinalWaveRage(6, 6, 29.99, false), false);
  assert.equal(shouldActivateFinalWaveRage(6, 6, 30, false), true);
  assert.equal(shouldActivateFinalWaveRage(6, 6, 60, true), false);
});

test("map, tier, wave, and monster scaling all resolve through typed arena modifiers", () => {
  const profile = createInitialProfile();
  const activeMap = {
    ...createMap(4),
    modifiers: ["vampiric", "volcanic", "restless", "exhausting"],
  } satisfies MapItem;
  const balance = buildArenaBalance(profile, activeMap);
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
  const activeMap = { ...createMap(1), modifiers: ["teeming", "commanded"] } satisfies MapItem;
  const firstWave = buildArenaBalance(profile, activeMap).waveStats[0];
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
  const low = buildArenaBalance(profile, createMap(1));
  const high = buildArenaBalance(profile, { ...createMap(4), modifiers: ["commanded"] });
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
  assert.equal(standard.map, 0.0035);
  assert.equal(standard.material, 0.016);
  assert.equal(standard.flask, 0.011);
  assert.equal(dropChances(200).equipment, dropChances(100).equipment * 2);
  assert.equal(dropChances(200).material, dropChances(100).material * 2);
  assert.equal(rollEquipmentRarity(100, () => 0.02), "magic");
  assert.equal(rollEquipmentRarity(400, () => 0.02), "rare");
});

test("monster map drops can never exceed the active map tier", () => {
  for (let tier = 1; tier <= MAP_TIER_RULES.maximum; tier += 1) {
    for (let sample = 0; sample <= 100; sample += 1) {
      const rolledTier = rollMapDropTier(tier, () => sample / 100);
      assert.ok(rolledTier >= MAP_TIER_RULES.minimum);
      assert.ok(rolledTier <= tier);
    }
  }
  assert.equal(rollMapDropTier(7, () => 0), 7, "the top of the roll can sustain the current tier");
  assert.equal(rollMapDropTier(1, () => 0.999999), 1, "Tier 1 cannot roll below Tier 1");
});

test("the canonical monster drop table produces a collectible map at the active tier or lower", () => {
  const rolls = [0.006, 0, 0];
  const drop = rollMonsterDrop({ itemLevel: 25, currentMapTier: 5, itemQuantity: 100, itemRarity: 100 }, () => rolls.shift() ?? 0);
  assert.ok(drop?.kind === "inventory" && isMapItem(drop.item));
  assert.equal(drop.item.tier, 5);
});

test("completion map progression clamps at the supported maximum tier", () => {
  const rewards = createMapCompletionRewards(99, 100, MAP_TIER_RULES.maximum, () => 0.5);
  const mapReward = rewards.find((reward) => reward.kind === "inventory" && isMapItem(reward.item));
  assert.ok(mapReward && mapReward.kind === "inventory" && isMapItem(mapReward.item));
  assert.equal(mapReward.item.tier, MAP_TIER_RULES.maximum);
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
