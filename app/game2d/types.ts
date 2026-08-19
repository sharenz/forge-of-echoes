import type { ArenaBalance, ArenaSummary, MapDrop } from "../game/combat";
import type { CharacterClassId, FlaskBelt, SkillLevels } from "../game/domain";
import type { FlaskDefinition } from "../game/config/flasks";

export type WorldMode = "class-select" | "hideout" | "arena";
export type WorldStation = "stash" | "bench" | "map-device" | "merchant" | "portal";

export interface WorldHudState {
  fps: number;
  mode: WorldMode;
  wave: number;
  enemies: number;
  nextWaveIn: number | null;
  life: number;
  maxLife: number;
  focus: number;
  maxFocus: number;
  groundDrops: number;
  lootCollected: number;
  novaCooldown: number;
  riftCharges: number;
  riftMaxCharges: number;
  riftRecharge: number;
  wardCooldown: number;
  wardRemaining: number;
  flameWaveCooldown: number;
  arenaComplete: boolean;
}

export interface WorldRuntimeOptions {
  parent: HTMLElement;
  mode: WorldMode;
  classId: CharacterClassId;
  portalActive: boolean;
  paused: boolean;
  skillLevels: SkillLevels;
  flaskBelt: FlaskBelt;
  arenaBalance?: ArenaBalance;
  onStation: (station: WorldStation) => void;
  onHud: (state: WorldHudState) => void;
  /** Return false when storage rejected the drop, leaving it in the world. */
  onLootPickup: (drop: MapDrop) => boolean;
  onExperienceGain: (amount: number) => void;
  onArenaComplete: (summary: ArenaSummary) => void;
  onPlayerDeath: () => void;
  onFlaskUse: (slotIndex: number) => FlaskDefinition | null;
}
