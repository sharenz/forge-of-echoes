import type { ArenaBalance, ArenaSummary, MapDrop } from "../game/combat";
import type { CharacterClassId } from "../game/domain";

export type WorldMode = "class-select" | "hideout" | "arena";
export type WorldStation = "stash" | "bench" | "map-device" | "portal";

export interface WorldHudState {
  fps: number;
  mode: WorldMode;
  wave: number;
  enemies: number;
  life: number;
  maxLife: number;
  focus: number;
  maxFocus: number;
  groundDrops: number;
  lootCollected: number;
}

export interface WorldRuntimeOptions {
  parent: HTMLElement;
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive: boolean;
  paused: boolean;
  arenaBalance?: ArenaBalance;
  onStation: (station: WorldStation) => void;
  onHud: (state: WorldHudState) => void;
  onLootPickup: (drop: MapDrop) => void;
  onArenaComplete: (summary: ArenaSummary) => void;
}
