import { CHARACTER_CLASSES } from "./config/classes";
import { STARTING_CURRENCY } from "./config/currencies";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "./config/progression";
import type {
  CharacterClassId,
  CharacterProgress,
  CharacterStats,
  CurrencyAmounts,
  CurrencyId,
  EquipmentItem,
  InventoryItem,
  MapItem,
  PlayerProfile,
  PlacedInventoryItem,
  RunResult,
} from "./domain";
import { addCurrencyToInventory, isCurrencyItem, isEquipmentItem, isMapItem } from "./inventory";
import { containerItems, createItemContainer, insertItems, normalizeItemContainer } from "./item-container";
import { generateStarterWeapon, normalizeEquipmentItem } from "./items";
import { createMap } from "./maps";
import { calculateCharacterStats } from "./stats";

const STORAGE_KEY = "crafty.profile.v5";
const V4_STORAGE_KEY = "crafty.profile.v4";
const V3_STORAGE_KEY = "crafty.profile.v3";
const V2_STORAGE_KEY = "crafty.profile.v2";
const LEGACY_STORAGE_KEY = "crafty.profile.v1";

interface V4Profile {
  version: 4;
  character: CharacterProgress;
  inventory: InventoryItem[];
  stash: InventoryItem[];
  equipped: PlayerProfile["equipped"];
  mapDevice: MapItem | null;
  openedMap: MapItem | null;
}

interface CounterProfile {
  version: 1 | 2 | 3;
  character: CharacterProgress;
  materials: CurrencyAmounts;
  inventory: EquipmentItem[];
  stash: EquipmentItem[];
  equipped: PlayerProfile["equipped"];
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
    version: 5,
    character: {
      name: "", archetype: "Unchosen", classId: null, created: false, level: 1, xp: 0,
      unspentPassives: 0, mapsCompleted: 0, highestWave: 0,
    },
    inventory: createItemContainer("backpack", startingInventory()),
    stash: createItemContainer("stash"),
    equipped: {},
    mapDevice: null,
    openedMap: null,
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

function migrateCounterProfile(profile: CounterProfile): PlayerProfile {
  let inventory: InventoryItem[] = profile.inventory.map(normalizeEquipmentItem);
  inventory.push(...(profile.maps ?? []).map(normalizeMapItem));
  for (const [currencyId, amount] of Object.entries(profile.materials ?? {}) as [CurrencyId, number][]) {
    inventory = addCurrencyToInventory(inventory, currencyId, amount);
  }
  const backpack = insertItems(createItemContainer("backpack"), normalizeInventory(inventory));
  const stash = insertItems(createItemContainer("stash"), [...profile.stash.map(normalizeEquipmentItem), ...backpack.unplaced]);
  return {
    version: 5,
    character: {
      ...profile.character,
      classId: profile.character.classId ?? null,
      created: profile.character.created ?? false,
    },
    inventory: backpack.container,
    stash: stash.container,
    equipped: Object.fromEntries(Object.entries(profile.equipped).map(([slot, item]) => [slot, item ? normalizeEquipmentItem(item) : item])),
    mapDevice: null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  } as PlayerProfile;
}

function migrateV4Profile(profile: V4Profile): PlayerProfile {
  const backpack = insertItems(createItemContainer("backpack"), normalizeInventory(profile.inventory ?? []));
  const stash = insertItems(createItemContainer("stash"), [...normalizeInventory(profile.stash ?? []), ...backpack.unplaced]);
  return {
    ...profile,
    version: 5,
    inventory: backpack.container,
    stash: stash.container,
    equipped: Object.fromEntries(Object.entries(profile.equipped ?? {}).map(([slot, item]) => [slot, item ? normalizeEquipmentItem(item) : item])),
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

function normalizeProfile(profile: PlayerProfile): PlayerProfile {
  return {
    ...profile,
    version: 5,
    inventory: normalizeItemContainer("backpack", normalizePlacedEntries(profile.inventory?.entries ?? [])),
    stash: normalizeItemContainer("stash", normalizePlacedEntries(profile.stash?.entries ?? [])),
    equipped: Object.fromEntries(Object.entries(profile.equipped).map(([slot, item]) => [slot, item ? normalizeEquipmentItem(item) : item])),
    mapDevice: profile.mapDevice ? normalizeMapItem(profile.mapDevice) : null,
    openedMap: profile.openedMap ? normalizeMapItem(profile.openedMap) : null,
  } as PlayerProfile;
}

export function createCharacter(profile: PlayerProfile, name: string, classId: CharacterClassId): PlayerProfile {
  const classDefinition = CHARACTER_CLASSES[classId];
  const equippedItems = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const backpackEquipment = containerItems(profile.inventory).filter(isEquipmentItem);
  const inventory = { ...profile.inventory, entries: profile.inventory.entries.filter((entry) => !isEquipmentItem(entry.item)) };
  const stash = insertItems(profile.stash, [...equippedItems, ...backpackEquipment]).container;
  return {
    ...profile,
    character: {
      name: name.trim() || classDefinition.name,
      archetype: classDefinition.title,
      classId,
      created: true,
      level: 1,
      xp: 0,
      unspentPassives: 0,
      mapsCompleted: 0,
      highestWave: 0,
    },
    inventory,
    stash,
    equipped: { weapon: generateStarterWeapon(classId) },
    openedMap: null,
  };
}

export function loadProfile(): PlayerProfile {
  if (typeof window === "undefined") return createInitialProfile();
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as PlayerProfile;
      if (parsed.version === 5) return normalizeProfile(parsed);
    }
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
  let level = profile.character.level;
  let xp = profile.character.xp + result.loot.xp;
  let gainedLevels = 0;
  while (level < MAX_CHARACTER_LEVEL && xp >= XP_BY_LEVEL(level)) {
    xp -= XP_BY_LEVEL(level);
    level += 1;
    gainedLevels += 1;
  }
  if (level === MAX_CHARACTER_LEVEL) xp = 0;

  const rewards: InventoryItem[] = [...result.loot.items];
  if (result.completed) rewards.push(createMap(Math.min(16, Math.max(1, Math.ceil(level / 6)))));
  const recoveredProfile = addRecoveredItems(profile, rewards);

  return {
    ...recoveredProfile,
    character: {
      ...profile.character,
      level,
      xp,
      unspentPassives: profile.character.unspentPassives + gainedLevels,
      mapsCompleted: profile.character.mapsCompleted + (result.completed ? 1 : 0),
      highestWave: Math.max(profile.character.highestWave, result.wave),
    },
    openedMap: null,
  };
}

export function addRecoveredItems(profile: PlayerProfile, items: readonly InventoryItem[]): PlayerProfile {
  const backpackResult = insertItems(profile.inventory, items);
  const stashResult = insertItems(profile.stash, backpackResult.unplaced);
  return {
    ...profile,
    inventory: backpackResult.container,
    stash: stashResult.container,
  };
}

export function deriveStats(profile: PlayerProfile): CharacterStats {
  return calculateCharacterStats(profile).stats;
}
