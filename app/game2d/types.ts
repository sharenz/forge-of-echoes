import type { ArenaBalance } from "../game/combat";
import type { CharacterClassId, FlaskBelt, InventoryItem, SkillLevels } from "../game/domain";
import type { MerchantId } from "../game/config/merchants";
import type { CombatEvent } from "../../multiplayer/protocol";

export type WorldMode = "login" | "character-create" | "loading" | "hideout" | "arena";
export type WorldStation = "stash" | "bench" | "map-device" | "portal" | `merchant:${MerchantId}`;

export interface NetworkPlayerView {
  characterId: string;
  name: string;
  classId: CharacterClassId;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  connected: boolean;
  life?: number;
  maxLife?: number;
  focus?: number;
  maxFocus?: number;
  attackSpeed?: number;
  castSpeed?: number;
  /** Total XP earned in this map instance. */
  experience?: number;
  /** Portion of map XP already included in the authoritative profile. */
  persistedExperience?: number;
}

export type NetworkMonsterSampleConsumer = (
  id: number,
  archetype: number,
  rarity: number,
  maxLife: number,
  x: number,
  y: number,
  lifePercent: number,
  flags: number,
) => void;

export interface NetworkMonsterSampler {
  forEachSample(now: number, consumer: NetworkMonsterSampleConsumer): void;
}

export interface NetworkMapView {
  wave: number;
  totalWaves: number;
  monstersAlive: number;
  completed: boolean;
  completionX: number;
  completionY: number;
  waveElapsedMilliseconds: number;
  finalRageActive: boolean;
  drops: readonly NetworkGroundDropView[];
}

export interface NetworkGroundDropView {
  id: string;
  x: number;
  y: number;
  item: InventoryItem;
  source: "monster" | "completion" | "player";
}

export interface MultiplayerWorldAdapter {
  localCharacterId: string;
  getPlayers: () => readonly NetworkPlayerView[];
  sendMovement: (x: number, y: number) => void;
  getMap?: () => NetworkMapView | null;
  getMonsterSampler?: () => NetworkMonsterSampler;
  drainCombatEvents?: () => CombatEvent[];
  sendAttack?: (skill: "basic" | "nova" | "dash" | "ward" | "flameWave", direction?: { x: number; y: number }) => void;
  sendPickup?: (dropId: string) => void;
  sendUseFlask?: (slotIndex: number) => void;
  sendDropItem?: (itemId: string) => void;
}

export interface WorldHudState {
  fps: number;
  mode: WorldMode;
  wave: number;
  enemies: number;
  nextWaveIn: number | null;
  finalRageIn: number | null;
  finalRageActive: boolean;
  life: number;
  maxLife: number;
  focus: number;
  maxFocus: number;
  pendingExperience: number;
  groundDrops: number;
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
  portalIndexes: number[];
  merchantIds: MerchantId[];
  paused: boolean;
  controlsBlocked?: boolean;
  skillLevels: SkillLevels;
  flaskBelt: FlaskBelt;
  arenaBalance?: ArenaBalance;
  onStation: (station: WorldStation, portalIndex?: number) => void;
  onHud: (state: WorldHudState) => void;
  /** Navigation callback only; map rewards and death remain server-authoritative. */
  onReturnToHideout: () => void;
  multiplayer?: MultiplayerWorldAdapter;
}
