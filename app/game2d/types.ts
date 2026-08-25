import type { ArenaBalance } from "../game/combat";
import type { ActiveSkillId, CharacterClassId, FlaskBelt, InventoryItem, SkillBarSkillId, SkillLevels, SkillLoadout } from "../game/domain";
import type { MerchantId } from "../game/config/merchants";
import type { CombatEvent, PickupResultMessage } from "../../multiplayer/protocol";

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
  serverTick?: number;
  life?: number;
  maxLife?: number;
  focus?: number;
  maxFocus?: number;
  attackSpeed?: number;
  castSpeed?: number;
  /** Latest movement input sequence integrated by the authoritative server. */
  lastProcessedMovement?: number;
  /** Latest combat input sequence integrated by the authoritative server. */
  lastProcessedAttack?: number;
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
  getPing: () => number | null;
  /** Sends a held movement state and returns its reconciliation sequence. */
  sendMovement: (x: number, y: number) => number | undefined;
  getMap?: () => NetworkMapView | null;
  getMonsterSampler?: () => NetworkMonsterSampler;
  drainCombatEvents?: () => CombatEvent[];
  drainPickupResults?: () => PickupResultMessage[];
  getProfileRevision?: () => number;
  /** Returns the client sequence used to reconcile immediate local presentation. */
  sendAttack?: (skill: SkillBarSkillId, direction?: { x: number; y: number }) => number | undefined;
  sendPickup?: (dropId: string) => void;
  sendUseFlask?: (slotIndex: number) => void;
  sendDropItem?: (itemId: string) => void;
}

export interface WorldHudState {
  fps: number;
  ping: number | null;
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
  skillCooldowns: Record<ActiveSkillId, number>;
  wardRemaining: number;
  charges: Partial<Record<ActiveSkillId, number>>;
  maxCharges: Partial<Record<ActiveSkillId, number>>;
  rechargeTimers: Partial<Record<ActiveSkillId, number>>;
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
  skillLoadout: SkillLoadout;
  flaskBelt: FlaskBelt;
  arenaBalance?: ArenaBalance;
  onStation: (station: WorldStation, portalIndex?: number) => void;
  onHud: (state: WorldHudState) => void;
  /** Navigation callback only; map rewards and death remain server-authoritative. */
  onReturnToHideout: () => void;
  multiplayer?: MultiplayerWorldAdapter;
}
