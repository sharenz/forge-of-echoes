// The complete mutable state of one run. Systems are plain functions over `World`.
import type { PlayerDebuff } from '../contracts/bestiary';
import type { MonsterKind, SkillId } from '../contracts/content';
import type { Rng } from '../contracts/rng';
import type {
  AreaView, Dir4, DropView, FlaskRuntime, MonsterRarity, PlayerAnim, PlayerCombatStats, PlayerIntent, PlayerView, PropView,
  RootSource, RunConfig, RunPhase, SimOutcome, SkillRuntimeDef, WorldView,
} from '../contracts/sim';
import type { DebuffState } from './debuffs';
import type { EventBuffer } from './events';
import type { PropGrid, SpatialGrid } from './grid';
import type { HookErrorLog } from './hooks';
import type { Roster } from './rosters/types';
import type { MonsterStore, MoteStore, ProjectileStore } from './stores';

export interface SkillChargeState {
  charges: number;
  /** Seconds until the next charge returns (0 when full). */
  timer: number;
}

export interface FlaskState {
  runtime: FlaskRuntime;
  count: number;
  /** Remaining recovery seconds. */
  active: number;
  /** Resource per second while active. */
  rate: number;
}

export interface CastState {
  slot: number;
  def: SkillRuntimeDef;
  time: number;
  total: number;
}

export interface WardState {
  time: number;
  duration: number;
  reduction: number;
  pulse: number;
  damage: number;
  critChance: number;
  critMultiplier: number;
  ailmentChance: number;
  radius: number;
}

export interface PendingNova {
  at: number;
  def: SkillRuntimeDef;
}

export interface PlayerState {
  /** Server-assigned id (1..255), unique within the instance. */
  readonly id: number;
  readonly name: string;
  level: number;
  /** Latest held-state intent (the sim's own copy; `flask` is consumed after one tick). */
  readonly intent: PlayerIntent;
  /** This player's entry in WorldView.players (stable object, updated in place). */
  readonly view: PlayerView;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  facing: Dir4;
  aimX: number;
  aimY: number;
  anim: PlayerAnim;
  animTime: number;
  life: number;
  focus: number;
  stats: PlayerCombatStats;
  flags: Set<string>;
  skills: Map<SkillId, SkillRuntimeDef>;
  charges: Map<SkillId, SkillChargeState>;
  loadout: (SkillId | null)[];
  flasks: (FlaskState | null)[];
  cast: CastState | null;
  ward: WardState;
  invulnTime: number;
  dashTime: number;
  hitTime: number;
  hitFlash: number;
  dead: boolean;
  prevHeld: boolean[];
  /** Per loadout slot: seconds before a still-held instant skill may fire again. */
  slotLock: Float32Array;
  focusWarnCd: number;
  /** Rolling window of melee damage per tick (contact cap). */
  meleeWindow: Float32Array;
  meleeSum: number;
  trailTimer: number;
  /** Push from bodies the player can't shove (heavy monsters, the dummy) accumulated this tick. */
  pushX: number;
  pushY: number;
  /** Ember Nova echoes waiting to fire (Echo of the Matriarch / 'echo'). */
  pendingNovas: PendingNova[];
  /**
   * Id of a portal that must not take the player until they step out of it (they just went
   * through, it opened under them, or they arrived on it), 0 = none.
   */
  portalLatch: number;
  /** Open portal the player is standing in (0 = none) and for how long, continuously. */
  portalDwellId: number;
  portalDwell: number;
  /** Active debuffs (debuffs.ts). */
  readonly debuffs: DebuffState;
  /** Remaining knockback displacement (shield bash, charges), applied over the next ticks. */
  kbX: number;
  kbY: number;
  /** A chain hook's drag: seconds left, total, and the segment (player movement is suspended meanwhile). */
  pullTime: number;
  pullTotal: number;
  pullFromX: number;
  pullFromY: number;
  pullToX: number;
  pullToY: number;
}

export interface Area extends AreaView {
  damage: number;
  /** DAMAGE_TYPES index. */
  dtype: number;
  hurts: 'player' | 'monsters' | 'none';
  /** 0 = resolves once at expiry (telegraph); > 0 = damage every interval while alive. */
  tickInterval: number;
  tickTimer: number;
  /** Monster id that owns a telegraph (removed with it), or -1. */
  owner: number;
  /** Player id credited with damage from a player-made area (fire trail), 0 = none. */
  source: number;
  /** Monster id this area follows (aura), or -1. */
  follow: number;
  /** On resolve, leave a fire pool of this duration (0 = none). */
  poolDuration: number;
  poolDamage: number;
  dead: boolean;
  /** Debuff applied to every player this area damages (or touches, for tar / rings), or null. */
  debuff: PlayerDebuff | null;
  rootSource: RootSource;
  /** Heading and variant packed into the id (area-geometry.ts); `angle` is the quantised heading. */
  angle: number;
  variant: number;
  /** Drift velocity (blizzard), units/s. */
  vx: number;
  vy: number;
  /** Radius at age 0 and at age = duration (the core interpolates `radius` linearly when they differ). */
  startRadius: number;
  endRadius: number;
  /** Player id this area follows until `lockAt` seconds of age (executionMark), 0 = none. */
  followPlayer: number;
  lockAt: number;
  /** Player id an ice prison closes on (leaving it breaks the prison), 0 = none. */
  target: number;
  /** Player ids already hit (choirWave: once per ring) or rooted (tarPool: first contact only). */
  touched: number[];
  /** 0 = none, else 1 + index into the area effect registry (effects.ts). */
  effect: number;
}

/** A recent death (for corpse-raising), see World.corpses. */
export interface Corpse {
  kind: MonsterKind;
  x: number;
  y: number;
  /** Sim time of the death. */
  time: number;
  /** Already raised (or consumed otherwise). */
  used: boolean;
}

export interface Drop extends DropView {
  vx: number;
  vy: number;
  vz: number;
  bounces: number;
  landed: boolean;
  /** Player currently overlapping (pickup attempts happen on first touch). */
  touching: boolean;
  magnet: boolean;
  speed: number;
}

export interface Prop extends PropView {
  solid: boolean;
}

export interface Pack {
  active: boolean;
  homeX: number;
  homeY: number;
  goalX: number;
  goalY: number;
  aggro: boolean;
  alive: number;
  wave: number;
  stream: boolean;
  rarity: MonsterRarity;
}

export interface PlannedPack {
  members: MonsterKind[];
  rarity: MonsterRarity;
  /** Shared magic mod (magic packs) or the rare leader's mods. */
  mods: number;
}

export interface WavePlan {
  wave: number;
  packs: PlannedPack[];
  streamCount: number;
  streamWeights: { kind: MonsterKind; weight: number }[];
  families: MonsterKind[];
  lieutenant: boolean;
  boss: boolean;
}

export interface StreamState {
  wave: number;
  remaining: number;
  /** Seconds until the next group on the regular cadence. */
  timer: number;
  interval: number;
  /** Seconds since the last group arrived (the pressure floor waits STREAM_MIN_GAP between pulls). */
  sinceLast: number;
  weights: { kind: MonsterKind; weight: number }[];
}

export interface Director {
  phase: RunPhase;
  wave: number;
  waveTime: number;
  intro: number;
  tellWave: number;
  tellTimer: number;
  plan: WavePlan | null;
  /** Living players the current plan was budgeted for (the stream absorbs a change by wave start). */
  planPlayers: number;
  stream: StreamState;
  hazardTimer: number;
  bossId: number;
  /** Monster id of the map's lieutenant (wave 3), -1 = none. */
  lieutenantId: number;
  bossSpawned: boolean;
  bossDefeated: boolean;
  /** Where the boss fell (the clear rewards appear by the nearest player to it). */
  bossDeathX: number;
  bossDeathY: number;
  cleared: boolean;
}

/**
 * The run's boss encounter (there is at most one boss per run). The core drives `phase` and `roar`
 * (bosses.ts); `state` belongs to the boss's BossScript (see rosters/types.ts) and is null until the
 * boss exists.
 */
export interface BossRuntime {
  phase: number;
  /** Remaining seconds of the phase-change roar (0 = not roaring). */
  roar: number;
  state: unknown;
}

export interface World {
  readonly config: RunConfig;
  readonly arenaRadius: number;
  tick: number;
  time: number;
  readonly combatRng: Rng;
  readonly lootRng: Rng;
  /** Spawns, layout, AI randomness, drop scatter. */
  readonly worldRng: Rng;
  /** Every player in the instance, in join order (dead players stay until removed). */
  readonly players: PlayerState[];
  /** Lookup by player id (index 0..255). */
  readonly playerById: (PlayerState | undefined)[];
  /** The living subset of `players` (join order), rebuilt whenever someone joins, leaves or dies. */
  living: PlayerState[];
  readonly monsters: MonsterStore;
  readonly projectiles: ProjectileStore;
  readonly motes: MoteStore;
  readonly grid: SpatialGrid;
  readonly propGrid: PropGrid;
  readonly areas: Area[];
  readonly drops: Drop[];
  readonly props: Prop[];
  readonly packs: Pack[];
  readonly director: Director;
  /** This map's monsters (THEME_ROSTER by RunConfig.theme; the hideout gets the Ashen Forge's). */
  readonly roster: Roster;
  readonly boss: BossRuntime;
  readonly events: EventBuffer;
  outcomes: SimOutcome[];
  readonly view: WorldView;
  nextDropId: number;
  nextPropId: number;
  kills: number;
  xpCarry: number;
  vacuum: boolean;
  /** Lazily created hideout map portal (setPortal), or null. */
  portal: Prop | null;
  /** The most recent deaths (a ring of CORPSE_MEMORY, oldest overwritten), for corpse-raising. */
  readonly corpses: Corpse[];
  corpseCursor: number;
  /** Area id sequence (area-geometry.ts packs heading and variant into the id). */
  areaSeq: number;
  /** Per-monster scratch memory by monster id (behaviour.ts memoryOf), dropped on death. */
  readonly memory: Map<number, Float64Array>;
  /** Hook calls that threw or returned malformed data (see hooks.ts). */
  readonly hookErrors: HookErrorLog;
  /** Scratch buffers for grid queries (sized to monster capacity). */
  readonly scratch: Int32Array;
  readonly scratch2: Int32Array;
  readonly scratchT: Float32Array;
}
