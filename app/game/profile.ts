import { XP_BY_LEVEL } from "./content";
import type { CharacterStats, EquipmentItem, Materials, PlayerProfile, RunResult } from "./domain";
import { generateEquipment } from "./items";
import { createMap } from "./maps";

const STORAGE_KEY = "crafty.profile.v1";

export function createInitialProfile(): PlayerProfile {
  const starterWeapon = generateEquipment(1, "magic");
  return {
    version: 1,
    character: {
      name: "The Forgebound",
      archetype: "Emberwright",
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
    equipped: { weapon: starterWeapon },
    maps: [createMap(1), createMap(1), createMap(2)],
  };
}

export function loadProfile(): PlayerProfile {
  if (typeof window === "undefined") return createInitialProfile();
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return createInitialProfile();
    const parsed = JSON.parse(saved) as PlayerProfile;
    return parsed.version === 1 ? parsed : createInitialProfile();
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
    inventory: [...result.loot.items, ...profile.inventory].slice(0, 24),
    maps,
  };
}

export function deriveStats(profile: PlayerProfile): CharacterStats {
  const equipped = Object.values(profile.equipped).filter(Boolean) as EquipmentItem[];
  const level = profile.character.level;
  const sumTag = (tag: string) =>
    equipped.flatMap((item) => item.affixes).filter((affix) => affix.tag === tag).reduce((sum, affix) => sum + affix.value, 0);

  return {
    maxLife: 110 + level * 8 + sumTag("life"),
    maxFocus: 100,
    moveSpeed: 250 * (1 + sumTag("speed") / 100),
    attackDamage: 15 + level * 1.8 + sumTag("damage") + sumTag("fire") * 0.65,
    attackSpeed: 1 + sumTag("speed") / 120,
    armor: 10 + level * 2 + sumTag("defense"),
  };
}

