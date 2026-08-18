import { CHARACTER_CLASSES } from "./config/classes";
import { STARTING_CURRENCY } from "./config/currencies";
import { CHARACTER_EQUIPMENT_SLOTS } from "./config/equipment-slots";
import { MAX_CHARACTER_LEVEL } from "./config/progression";
import { STASH_RULES } from "./config/stash";
import type {
  CharacterEquipmentSlot,
  CharacterClassId,
  CharacterProgress,
  CharacterStats,
  CurrencyAmounts,
  CurrencyId,
  EquipmentItem,
  InventoryItem,
  ItemContainer,
  MapItem,
  PlayerProfile,
  PlacedInventoryItem,
  RunResult,
  StashState,
} from "./domain";
import { chooseEquipmentSlot, equipmentSlotAccepts } from "./equipment";
import { addCurrencyToInventory, isCurrencyItem, isEquipmentItem, isMapItem } from "./inventory";
import { containerItems, createItemContainer, insertItems, normalizeItemContainer } from "./item-container";
import { generateStarterWeapon, normalizeEquipmentItem } from "./items";
import { createMap } from "./maps";
import { ATTRIBUTE_POINTS_PER_LEVEL, grantCharacterExperience } from "./progression";
import { activeStashTab, createStash, insertItemsIntoStash, updateStashContainer } from "./stash";
import { calculateCharacterStats } from "./stats";

const STORAGE_KEY = "crafty.profile.v8";
const V7_STORAGE_KEY = "crafty.profile.v7";
const V6_STORAGE_KEY = "crafty.profile.v6";
const V5_STORAGE_KEY = "crafty.profile.v5";
const V4_STORAGE_KEY = "crafty.profile.v4";
const V3_STORAGE_KEY = "crafty.profile.v3";
const V2_STORAGE_KEY = "crafty.profile.v2";
const LEGACY_STORAGE_KEY = "crafty.profile.v1";

type LegacyCharacterProgress = Omit<CharacterProgress, "allocatedAttributes" | "unspentAttributePoints" | "skillLevels" | "unspentSkillPoints"> & {
  unspentPassives?: number;
};

interface V7Profile {
  version: 7;
  character: LegacyCharacterProgress;
  inventory: ItemContainer;
  stash: StashState;
  equipped: Record<string, EquipmentItem | undefined>;
  mapDevice: MapItem | null;
  openedMap: MapItem | null;
}

interface V4Profile {
  version: 4;
  character: LegacyCharacterProgress;
  inventory: InventoryItem[];
  stash: InventoryItem[];
  equipped: Record<string, EquipmentItem | undefined>;
  mapDevice: MapItem | null;
  openedMap: MapItem | null;
}

interface V5Profile {
  version: 5;
  character: LegacyCharacterProgress;
  inventory: ItemContainer;
  stash: ItemContainer;
  equipped: Record<string, EquipmentItem | undefined>;
  mapDevice: MapItem | null;
  openedMap: MapItem | null;
}

interface V6Profile {
  version: 6;
  character: LegacyCharacterProgress;
  inventory: ItemContainer;
  stash: ItemContainer;
  equipped: Record<string, EquipmentItem | undefined>;
  mapDevice: MapItem | null;
  openedMap: MapItem | null;
}

interface CounterProfile {
  version: 1 | 2 | 3;
  character: LegacyCharacterProgress;
  materials: CurrencyAmounts;
  inventory: EquipmentItem[];
  stash: EquipmentItem[];
  equipped: Record<string, EquipmentItem | undefined>;
  maps: MapItem[];
  openedMap: MapItem | null;
}

function startingInventory(): InventoryItem[] {
  let items: InventoryItem[] = [];
  for (const [currencyId, amount] of Object.entries(STARTING_CURRENCY) as [CurrencyId, number][]) {
    items = addCurrencyToInventory(items, currencyId, amount);
  }
  return [...items, createMap(1), createMap(1), createMap(2)];
}

export function createInitialProfile(): PlayerProfile {
  return {
    version: 8,
    character: {
      name: "", archetype: "Unchosen", classId: null, created: false, level: 1, xp: 0,
      allocatedAttributes: { strength: 0, dexterity: 0, intelligence: 0 },
      unspentAttributePoints: 0,
      skillLevels: { nova: 1, dash: 1 },
      unspentSkillPoints: 0,
      mapsCompleted: 0, highestWave: 0,
    },
    inventory: createItemContainer("backpack", startingInventory()),
    stash: createStash(),
    equipped: {},
    mapDevice: null,
    openedMap: null,
  };
}

function normalizeCharacterProgress(character: LegacyCharacterProgress | CharacterProgress): CharacterProgress {
  const level = Math.min(MAX_CHARACTER_LEVEL, Math.max(1, Math.floor(character.level ?? 1)));
  const created = character.created ?? false;
  const current = character as Partial<CharacterProgress>;
  return {
    ...character,
    classId: character.classId ?? null,
    created,
    level,
    xp: level === MAX_CHARACTER_LEVEL ? 0 : Math.max(0, Math.floor(character.xp ?? 0)),
    allocatedAttributes: {
      strength: Math.max(0, Math.floor(current.allocatedAttributes?.strength ?? 0)),
      dexterity: Math.max(0, Math.floor(current.allocatedAttributes?.dexterity ?? 0)),
      intelligence: Math.max(0, Math.floor(current.allocatedAttributes?.intelligence ?? 0)),
    },
    unspentAttributePoints: Math.max(0, Math.floor(current.unspentAttributePoints ?? (created ? (level - 1) * ATTRIBUTE_POINTS_PER_LEVEL : 0))),
    skillLevels: {
      nova: Math.min(20, Math.max(1, Math.floor(current.skillLevels?.nova ?? 1))),
      dash: Math.min(20, Math.max(1, Math.floor(current.skillLevels?.dash ?? 1))),
    },
    unspentSkillPoints: Math.max(0, Math.floor(current.unspentSkillPoints ?? (character as LegacyCharacterProgress).unspentPassives ?? (created ? level - 1 : 0))),
    mapsCompleted: Math.max(0, Math.floor(character.mapsCompleted ?? 0)),
    highestWave: Math.max(0, Math.floor(character.highestWave ?? 0)),
  };
}

function normalizeMapItem(map: MapItem): MapItem {
  return { ...map, kind: "map" };
}

function normalizeInventory(items: readonly InventoryItem[]): InventoryItem[] {
  let result: InventoryItem[] = [];
  for (const item of items) {
    if (isCurrencyItem(item)) {
      result = addCurrencyToInventory(result, item.baseId, item.stackSize);
    } else if (isMapItem(item)) {
      result.push(normalizeMapItem(item));
    } else {
      result.push(normalizeEquipmentItem(item));
    }
  }
  return result;
}

function normalizeEquipped(equipped: Record<string, EquipmentItem | undefined>): PlayerProfile["equipped"] {
  const result: PlayerProfile["equipped"] = {};
  const validSlots = new Set<CharacterEquipmentSlot>(CHARACTER_EQUIPMENT_SLOTS.map((slot) => slot.id));
  for (const [legacySlot, rawItem] of Object.entries(equipped ?? {})) {
    if (!rawItem) continue;
    const item = normalizeEquipmentItem(rawItem);
    const migratedSlot = legacySlot === "weapon" ? "mainHand" : legacySlot === "ring" ? "ringLeft" : legacySlot;
    const requestedSlot = validSlots.has(migratedSlot as CharacterEquipmentSlot) ? migratedSlot as CharacterEquipmentSlot : null;
    const target = requestedSlot && equipmentSlotAccepts(requestedSlot, item) && !result[requestedSlot]
      ? requestedSlot
      : chooseEquipmentSlot(item, result);
    result[target] = item;
  }
  return result;
}

function migrateCounterProfile(profile: CounterProfile): PlayerProfile {
  let inventory: InventoryItem[] = profile.inventory.map(normalizeEquipmentItem);
  inventory.push(...(profile.maps ?? []).map(normalizeMapItem));
  for (const [currencyId, amount] of Object.entries(profile.materials ?? {}) as [CurrencyId, number][]) {
    inventory = addCurrencyToInventory(inventory, currencyId, amount);
  }
  const backpack = insertItems(createItemContainer("backpack"), normalizeInventory(inventory));
  const stash = insertItemsIntoStash(createStash(), [...profile.stash.map(normalizeEquipmentItem), ...backpack.unplaced]);
  return {
    version: 8,
    character: normalizeCharacterProgress(profile.character),
    inventory: backpack.container,
    stash: stash.stash,
    equipped: normalizeEquipped(profile.equipped),
    mapDevice: null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  } as PlayerProfile;
}

function migrateV4Profile(profile: V4Profile): PlayerProfile {
  const backpack = insertItems(createItemContainer("backpack"), normalizeInventory(profile.inventory ?? []));
  const stash = insertItemsIntoStash(createStash(), [...normalizeInventory(profile.stash ?? []), ...backpack.unplaced]);
  return {
    ...profile,
    version: 8,
    character: normalizeCharacterProgress(profile.character),
    inventory: backpack.container,
    stash: stash.stash,
    equipped: normalizeEquipped(profile.equipped ?? {}),
    mapDevice: profile.mapDevice ? normalizeMapItem(profile.mapDevice) : null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  } as PlayerProfile;
}

function normalizePlacedEntries(entries: readonly PlacedInventoryItem[]): PlacedInventoryItem[] {
  return entries.map((entry) => ({
    ...entry,
    item: isEquipmentItem(entry.item) ? normalizeEquipmentItem(entry.item) : isMapItem(entry.item) ? normalizeMapItem(entry.item) : entry.item,
  }));
}

function stashFromLegacyContainer(container: ItemContainer): StashState {
  const stash = createStash();
  return updateStashContainer(stash, activeStashTab(stash).id, normalizeItemContainer("stash", normalizePlacedEntries(container?.entries ?? [])));
}

function normalizeStashState(stash: StashState): StashState {
  const fallback = createStash();
  if (!stash?.tabs?.length) return fallback;
  const usedIds = new Set<string>();
  const tabs = stash.tabs.slice(0, STASH_RULES.maximumTabs).map((tab, index) => {
    const requestedId = typeof tab.id === "string" && tab.id ? tab.id : `stash-tab-${index + 1}`;
    let id = requestedId;
    let suffix = 1;
    while (usedIds.has(id)) {
      id = `stash-tab-${index + 1}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      name: typeof tab.name === "string" && tab.name.trim() ? tab.name.trim().slice(0, STASH_RULES.maximumNameLength) : `Tab ${index + 1}`,
      container: normalizeItemContainer("stash", normalizePlacedEntries(tab.container?.entries ?? [])),
    };
  });
  const activeTabId = tabs.some((tab) => tab.id === stash.activeTabId) ? stash.activeTabId : tabs[0].id;
  return { activeTabId, tabs };
}

function normalizeProfile(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    version: 8,
    character: normalizeCharacterProgress(profile.character),
    inventory: normalizeItemContainer("backpack", normalizePlacedEntries(profile.inventory?.entries ?? [])),
    stash: normalizeStashState(profile.stash),
    equipped: normalizeEquipped(profile.equipped),
    mapDevice: profile.mapDevice ? normalizeMapItem(profile.mapDevice) : null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  } as PlayerProfile;
}

function migrateV5Profile(profile: V5Profile): PlayerProfile {
  return {
    ...profile,
    version: 8,
    character: normalizeCharacterProgress(profile.character),
    inventory: normalizeItemContainer("backpack", normalizePlacedEntries(profile.inventory?.entries ?? [])),
    stash: stashFromLegacyContainer(profile.stash),
    equipped: normalizeEquipped(profile.equipped),
    mapDevice: profile.mapDevice ? normalizeMapItem(profile.mapDevice) : null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  };
}

function migrateV6Profile(profile: V6Profile): PlayerProfile {
  return {
    ...profile,
    version: 8,
    character: normalizeCharacterProgress(profile.character),
    inventory: normalizeItemContainer("backpack", normalizePlacedEntries(profile.inventory?.entries ?? [])),
    stash: stashFromLegacyContainer(profile.stash),
    equipped: normalizeEquipped(profile.equipped),
    mapDevice: profile.mapDevice ? normalizeMapItem(profile.mapDevice) : null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  };
}

function migrateV7Profile(profile: V7Profile): PlayerProfile {
  return normalizeProfile({
    ...profile,
    version: 8,
    character: normalizeCharacterProgress(profile.character),
  });
}

export function createCharacter(profile: PlayerProfile, name: string, classId: CharacterClassId): PlayerProfile {
  const classDefinition = CHARACTER_CLASSES[classId];
  const equippedItems = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const backpackEquipment = containerItems(profile.inventory).filter(isEquipmentItem);
  const inventory = { ...profile.inventory, entries: profile.inventory.entries.filter((entry) => !isEquipmentItem(entry.item)) };
  const stash = insertItemsIntoStash(profile.stash, [...equippedItems, ...backpackEquipment]).stash;
  return {
    ...profile,
    character: {
      name: name.trim() || classDefinition.name,
      archetype: classDefinition.title,
      classId,
      created: true,
      level: 1,
      xp: 0,
      allocatedAttributes: { strength: 0, dexterity: 0, intelligence: 0 },
      unspentAttributePoints: 0,
      skillLevels: { nova: 1, dash: 1 },
      unspentSkillPoints: 0,
      mapsCompleted: 0,
      highestWave: 0,
    },
    inventory,
    stash,
    equipped: { mainHand: generateStarterWeapon(classId) },
    openedMap: null,
  };
}

export function loadProfile(): PlayerProfile {
  if (typeof window === "undefined") return createInitialProfile();
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as PlayerProfile;
      if (parsed.version === 8) return normalizeProfile(parsed);
    }
    const v7 = window.localStorage.getItem(V7_STORAGE_KEY);
    if (v7) return migrateV7Profile(JSON.parse(v7) as V7Profile);
    const v6 = window.localStorage.getItem(V6_STORAGE_KEY);
    if (v6) return migrateV6Profile(JSON.parse(v6) as V6Profile);
    const v5 = window.localStorage.getItem(V5_STORAGE_KEY);
    if (v5) return migrateV5Profile(JSON.parse(v5) as V5Profile);
    const v4 = window.localStorage.getItem(V4_STORAGE_KEY);
    if (v4) return migrateV4Profile(JSON.parse(v4) as V4Profile);
    for (const key of [V3_STORAGE_KEY, V2_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      const legacy = window.localStorage.getItem(key);
      if (legacy) return migrateCounterProfile(JSON.parse(legacy) as CounterProfile);
    }
    return createInitialProfile();
  } catch {
    return createInitialProfile();
  }
}

export function saveProfile(profile: PlayerProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function applyRunResult(profile: PlayerProfile, result: RunResult): PlayerProfile {
  const progressed = grantCharacterExperience(profile, result.loot.xp).profile;
  const level = progressed.character.level;
  const rewards: InventoryItem[] = [...result.loot.items];
  if (result.completed) rewards.push(createMap(Math.min(16, Math.max(1, Math.ceil(level / 6)))));
  const recoveredProfile = addRecoveredItems(progressed, rewards);

  return {
    ...recoveredProfile,
    character: {
      ...recoveredProfile.character,
      mapsCompleted: recoveredProfile.character.mapsCompleted + (result.completed ? 1 : 0),
      highestWave: Math.max(recoveredProfile.character.highestWave, result.wave),
    },
    openedMap: null,
  };
}

export function addRecoveredItems(profile: PlayerProfile, items: readonly InventoryItem[]): PlayerProfile {
  const backpackResult = insertItems(profile.inventory, items);
  const stashResult = insertItemsIntoStash(profile.stash, backpackResult.unplaced);
  return {
    ...profile,
    inventory: backpackResult.container,
    stash: stashResult.stash,
  };
}

export function deriveStats(profile: PlayerProfile): CharacterStats {
  return calculateCharacterStats(profile).stats;
}
