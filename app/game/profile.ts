import { CHARACTER_CLASSES, XP_BY_LEVEL } from "./content";
import type {
  CharacterClassId,
  CharacterStats,
  EquipmentItem,
  Materials,
  PlayerProfile,
  RunResult,
} from "./domain";
import { generateStarterWeapon } from "./items";
import { createMap } from "./maps";

const STORAGE_KEY = "crafty.profile.v2";
const LEGACY_STORAGE_KEY = "crafty.profile.v1";

interface LegacyProfile extends Omit<PlayerProfile, "version" | "character" | "stash" | "openedMap"> {
  version: 1;
  character: Omit<PlayerProfile["character"], "classId" | "created">;
}

export function createInitialProfile(): PlayerProfile {
  return {
    version: 2,
    character: {
      name: "",
      archetype: "Unchosen",
      classId: null,
      created: false,
      level: 1,
      xp: 0,
      unspentPassives: 0,
      mapsCompleted: 0,
      highestWave: 0,
    },
    materials: {
      scrap: 12,
      essence: 4,
      seal: 1,
      solvent: 1,
      mapDust: 4,
      threatGlyph: 3,
      rewardInk: 3,
    },
    inventory: [],
    stash: [],
    equipped: {},
    maps: [createMap(1), createMap(1), createMap(2)],
    openedMap: null,
  };
}

function migrateLegacy(profile: LegacyProfile): PlayerProfile {
  const recoveredEquipment = [
    ...Object.values(profile.equipped).filter(Boolean) as EquipmentItem[],
    ...profile.inventory,
  ];
  return {
    ...profile,
    version: 2,
    character: { ...profile.character, classId: null, created: false },
    inventory: [],
    stash: recoveredEquipment,
    equipped: {},
    openedMap: null,
  };
}

export function createCharacter(profile: PlayerProfile, name: string, classId: CharacterClassId): PlayerProfile {
  const classDefinition = CHARACTER_CLASSES[classId];
  const recoveredEquipment = [
    ...Object.values(profile.equipped).filter(Boolean) as EquipmentItem[],
    ...profile.inventory,
  ];
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
    inventory: [],
    stash: [...recoveredEquipment, ...profile.stash],
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
      if (parsed.version === 2) return parsed;
    }
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return migrateLegacy(JSON.parse(legacy) as LegacyProfile);
    return createInitialProfile();
  } catch {
    return createInitialProfile();
  }
}

export function saveProfile(profile: PlayerProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function addMaterials(current: Materials, added: Partial<Materials>): Materials {
  const result = { ...current };
  (Object.keys(added) as (keyof Materials)[]).forEach((key) => {
    result[key] += added[key] ?? 0;
  });
  return result;
}

export function applyRunResult(profile: PlayerProfile, result: RunResult): PlayerProfile {
  let level = profile.character.level;
  let xp = profile.character.xp + result.loot.xp;
  let gainedLevels = 0;
  while (level < 99 && xp >= XP_BY_LEVEL(level)) {
    xp -= XP_BY_LEVEL(level);
    level += 1;
    gainedLevels += 1;
  }
  if (level === 99) xp = 0;

  const maps = [...profile.maps];
  if (result.completed) maps.push(createMap(Math.min(16, Math.max(1, Math.ceil(level / 6)))));
  const recoveredItems = [...result.loot.items, ...profile.inventory];

  return {
    ...profile,
    character: {
      ...profile.character,
      level,
      xp,
      unspentPassives: profile.character.unspentPassives + gainedLevels,
      mapsCompleted: profile.character.mapsCompleted + (result.completed ? 1 : 0),
      highestWave: Math.max(profile.character.highestWave, result.wave),
    },
    materials: addMaterials(profile.materials, result.loot.materials),
    inventory: recoveredItems.slice(0, 24),
    stash: [...recoveredItems.slice(24), ...profile.stash],
    maps,
    openedMap: null,
  };
}

export function deriveStats(profile: PlayerProfile): CharacterStats {
  const equipped = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const level = profile.character.level;
  const classDefinition = profile.character.classId ? CHARACTER_CLASSES[profile.character.classId] : null;
  const sumTag = (tag: string) =>
    equipped.flatMap((item) => item.affixes).filter((affix) => affix.tag === tag).reduce((sum, affix) => sum + affix.value, 0);

  return {
    maxLife: (110 + level * 8 + sumTag("life")) * (classDefinition?.lifeMultiplier ?? 1),
    maxFocus: profile.character.classId === "sorceress" ? 120 : 100,
    moveSpeed: 250 * (classDefinition?.speedMultiplier ?? 1) * (1 + sumTag("speed") / 100),
    attackDamage: (15 + level * 1.8 + sumTag("damage") + sumTag("fire") * 0.65) * (classDefinition?.damageMultiplier ?? 1),
    attackSpeed: 1 + sumTag("speed") / 120,
    armor: (10 + level * 2 + sumTag("defense")) * (classDefinition?.armorMultiplier ?? 1),
    evadeChance: Math.min(60, 4 + level * 0.16 + sumTag("speed") * 0.24 + (profile.character.classId === "amazon" ? 6 : profile.character.classId === "sorceress" ? 2 : 0)),
  };
}
