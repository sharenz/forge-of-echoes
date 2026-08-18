import type { CharacterClassId } from "../game/domain";
import type { ArenaBalance, ArenaSummary } from "../game/combat";

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
}

export interface WorldRuntimeOptions {
  canvas: HTMLCanvasElement;
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive: boolean;
  arenaBalance?: ArenaBalance;
  onStation: (station: WorldStation) => void;
  onHud: (state: WorldHudState) => void;
  onArenaComplete: (summary: ArenaSummary) => void;
}
