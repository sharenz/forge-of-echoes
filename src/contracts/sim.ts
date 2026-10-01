// FROZEN CONTRACT — the deterministic simulation boundary (runs on the authoritative SERVER).
//
//   server → setIntent(playerId, PlayerIntent) → SimRun.step() (fixed 60 Hz) → WorldView (read-only)
//          + SimEvent[] (cosmetic, fanned out to clients by AOI) + SimOutcome[] (authoritative, per player)
//
// MULTIPLAYER: an instance (a hideout or a map) holds 0..4 players that join/leave at runtime.
// Monsters target the nearest living player. Loot is INSTANCED: every drop has an owner player id and only
// that player can see/pick it. Kill XP is SHARED: each monster death immediately grants its XP to every
// player in the instance. Party scaling (done inside the sim from the current player count n):
// monster life ×(1 + 0.5·(n−1)) at spawn, wave budget ×(1 + 0.25·(n−1)).
//
// The sim knows nothing about items or the DOM. All numbers that the UI also shows (skill damage, cooldowns…)
// are computed by the rules and handed in pre-resolved (SkillRuntimeDef / PlayerCombatStats), so UI and combat
// can never drift. The sim owns *behaviour*: movement, AI, collisions, projectiles, waves, packs, bosses, drops.
import type { DamageType, FlaskId, MonsterKind, PlayerFlag, SkillId, Theme } from './content';
import type { AtlasAreaId } from './atlas';
import type { Rng } from './rng';
import type { PlayerDebuff } from './bestiary';
import { NEW_AREA_KINDS, NEW_PROJECTILE_KINDS } from './bestiary';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** World units == art pixels at zoom 1. The sorceress is ~24 units tall. */
export type Dir4 = 'south' | 'north' | 'east' | 'west';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PlayerCombatStats {
  maxLife: number;
  lifeRegen: number;          // per second
  maxFocus: number;
  focusRegen: number;         // per second
  armor: number;              // physical hit reduction: dmg * armor/(armor + 10*dmg)
  evasion: number;            // chance 0..0.75 to evade a monster hit
  resist: Record<DamageType, number>; // fraction, capped at 0.75, may be negative
  damageTaken: number;        // multiplier, 1 = normal
  moveSpeed: number;          // world units / second
  pickupRadius: number;       // world units (auto-pickup drops are magnetised inside this)
  lifeOnKill: number;
  focusOnKill: number;
  flaskEffect: number;        // multiplier
  flags: PlayerFlag[];
}

/** Fully resolved skill numbers (player modifiers already applied by the rules). */
export interface SkillRuntimeDef {
  id: SkillId;
  rank: number;
  focusCost: number;
  castTime: number;           // seconds after cast speed; 0 = instant
  cooldown: number;           // seconds after cooldown recovery; 0 = none (per charge when charges > 1)
  charges: number;            // >= 1
  damage: number;             // average damage per hit; 0 for non-damaging skills
  damageType: DamageType;
  critChance: number;         // 0..1
  critMultiplier: number;     // e.g. 1.5
  ailmentChance: number;      // 0..1 chance to ignite (fire) / chill (cold) / shock (lightning)
  projectiles: number;
  pierce: number;
  projectileSpeed: number;    // units / second
  range: number;              // max projectile travel distance
  spread: number;             // total fan angle in radians
  radius: number;             // area radius (nova ring / explosion / chain jump range / ward)
  duration: number;           // seconds (buffs, burning ground)
  chains: number;             // extra chain targets (arc chain)
  distance: number;           // dash distance
  damageReduction: number;    // 0..1 (cinder ward)
  flags: string[];            // skill-specific behaviour flags, e.g. 'pierceAll', 'echo'
}

export interface FlaskRuntime {
  flaskId: FlaskId;
  count: number;
  resource: 'life' | 'focus';
  amount: number;             // total recovered (flaskEffect already applied)
  duration: number;           // seconds
}

export interface MonsterScaling {
  level: number;
  lifeMultiplier: number;
  damageMultiplier: number;
  speedMultiplier: number;
  countMultiplier: number;    // wave size multiplier
  magicPackChance: number;    // 0..1 per pack
  rarePackChance: number;     // 0..1 per pack
  resistBonus: number;        // added to every monster resistance (fraction)
  xpMultiplier: number;
  extraProjectiles: number;   // monster ranged attacks fire this many extra projectiles
  hazards: boolean;           // volcanic eruptions: telegraphed fire bursts appear around the player
}

export interface WaveConfig {
  /** On entry spawn every monster from waves 1 through this wave (default 1). */
  startWave?: number;
  count: number;              // number of waves (6)
  baseMonsters: number;       // monsters in wave 1 (before countMultiplier)
  monstersPerWave: number;    // added per wave
  waveDuration: number;       // seconds before the next wave arrives even if monsters remain
  tellDuration: number;       // seconds of "Tell" preview before a wave's monsters appear
  lieutenantWave: number;     // wave index (1-based) with the Ashbound Herald, 0 = none
  bossWave: number;           // wave index (1-based) with the Cinder Matriarch, 0 = none
}

export type MonsterRarity = 'normal' | 'magic' | 'rare';

/** Everything the rules resolve for one player (stats, resolved skills, loadout, belt). */
export interface PlayerRuntime {
  stats: PlayerCombatStats;
  /** One entry per skill the character can use (basic attack + every ranked skill). */
  skills: SkillRuntimeDef[];
  /** LOADOUT_SLOTS freely assignable entries: LMB, RMB, Q, E, R, F. */
  loadout: (SkillId | null)[];
  /** BELT_SLOTS entries. */
  flasks: (FlaskRuntime | null)[];
}

export interface PlayerJoin {
  /** Server-assigned id, unique within the instance, 1..255. */
  id: number;
  name: string;
  level: number;
  runtime: PlayerRuntime;
  /** Spawn position; default = the instance entry point (hideout centre / map start). */
  x?: number;
  y?: number;
}

export interface KillLootContext {
  /** Final credited kill of a map event; adds its one-time reward. */
  eventReward?: import('./map-events').MapEventKind;
  kind: MonsterKind;
  /** Summoned minions (Herald/Matriarch) — the sim never rolls loot for them; flag kept for completeness. */
  summoned: boolean;
  rarity: MonsterRarity;
  isLieutenant: boolean;
  isBoss: boolean;
  wave: number;
  x: number;
  y: number;
  /**
   * Percent more item quantity / rarity on top of the map's own (a Pact Altar wave, a Stasis Host statue). Absent = none.
   * The rules add it to the looter's personal luck for this one kill.
   */
  quantityMore?: number;
  rarityMore?: number;
  /** The rival boss of Rival Crowns: the rules roll its own theme's exclusive unique; the number multiplies that chance (1 = base). */
  rival?: number;
}

/** Max distance (world units) between a player and a drop for a click pickup. */
export const PICKUP_REACH = 72;

export type PickupResult = 'ok' | 'tooFar' | 'notYours' | 'full' | 'missing';

export type DropTone = 'normal' | 'magic' | 'rare' | 'unique' | 'currency' | 'map' | 'flask';
export type DropSprite = 'equipment' | 'currency' | 'map' | 'flask';

/** What the sim needs to know about a dropped item. `token` is an opaque handle owned by the server. */
export interface DropSpec {
  token: number;
  /**
   * Player id that owns (and alone can see/pick up) this drop — monster loot is instanced per player.
   * 0 = public: anyone in the instance sees it and may pick it up (items a player dropped on the floor).
   */
  owner: number;
  /**
   * true: collected by walking over it (currency, flasks, maps).
   * false: must be clicked (equipment, and anything a player dropped on the floor).
   */
  autoPickup: boolean;
  /** Optional independent toss seed for bonus drops; does not advance world generation RNG. Server-only. */
  scatterSeed?: number;
  label: string;
  tone: DropTone;
  sprite: DropSprite;
  iconId: string;
}

export interface RunHooks {
  /**
   * Called synchronously when a monster dies. The server rolls loot separately for every player currently in the
   * instance (instanced loot) and returns all drops, each tagged with its owner. Must use the provided rng.
   */
  rollKillLoot(ctx: KillLootContext, playerIds: readonly number[], rng: Rng): DropSpec[];
  /**
   * Called once when a map event pays out (grade decided by the sim; Bronze is the classic payout). Optional: without it
   * events pay nothing. Same instancing rules as rollKillLoot.
   */
  rollEventReward?(ctx: import('./map-events').EventRewardContext, playerIds: readonly number[], rng: Rng): DropSpec[];
  /**
   * Called once when the completion chest is opened (by the first player to touch it): drops for every player present.
   * `boons` are the Wayside Anvil's boons for the chest's equipment (absent = none).
   */
  rollChestLoot(playerIds: readonly number[], rng: Rng, boons?: import('./map-events').ChestBoons): DropSpec[];
  /** `playerId` touched their own drop. Return false if it cannot be picked up (inventory full) — the drop stays. */
  tryPickup(playerId: number, token: number): boolean;
}

export interface RunConfig {
  event?: import('./map-events').MapEventPlan | null;
  /** Tree / mod / scarab lenses on the events of this map (all optional; see MapEventModifiers). */
  eventModifiers?: import('./map-events').MapEventModifiers;
  bossLifeMultiplier?: number;
  bossDamageMultiplier?: number;
  mode: 'hideout' | 'map';
  /**
   * The Atlas area this map is bound to (RunSetup.atlasAreaId). When the area has a registered hand-crafted layout
   * (src/data/layouts), the arena is built from it (props, spawn zones and lanes, boss stage, start, event anchors);
   * absent, or an area without a layout, keeps the procedural generator.
   */
  areaId?: AtlasAreaId;
  seed: number;
  /**
   * Seed of the layout's flow zones (conveyor directions and reversal schedule, src/data/layouts/flow.ts). The server draws it per map
   * instance independently of `seed` and ships it in ZoneInfo.flowSeed (the client never learns `seed`); absent = derived from `seed`.
   */
  flowSeed?: number;
  theme: Theme;
  mapName: string;
  tier: number;
  arenaRadius: number;        // playable circle radius in world units
  monsters: MonsterScaling;
  waves: WaveConfig;
  hooks: RunHooks;
}

/** Held-state input for one tick. */
export interface PlayerIntent {
  moveX: number;              // -1..1
  moveY: number;              // -1..1 (positive = south/down)
  aimX: number;               // world coordinates of the cursor
  aimY: number;
  /** LOADOUT_SLOTS entries: true while the slot key/button is held. Held skills fire as soon as usable. */
  held: boolean[];
  /** Belt slot pressed this tick, or -1. */
  flask: number;
}

// ---------------------------------------------------------------------------
// Read-only world view (updated in place every step; the presenter interpolates prev → current)
// ---------------------------------------------------------------------------

export const MONSTER_ANIM = { idle: 0, move: 1, windup: 2, attack: 3, leap: 4, spawn: 5 } as const;
export type MonsterAnimCode = (typeof MONSTER_ANIM)[keyof typeof MONSTER_ANIM];

/** Monster rarity code in WorldView.monsters.rarity. */
export const RARITY_CODE = { normal: 0, magic: 1, rare: 2, lieutenant: 3, boss: 4 } as const;

/** Elite modifier bits in WorldView.monsters.mods (magic packs share one; rare leaders have two). */
export const ELITE_BIT = { swift: 1, stout: 2, fierce: 4, juggernaut: 8, frenzied: 16, emberTouched: 32, warded: 64,
  // Rare-only: near-immunity to one element (fireProof…) and telegraphed behavioural strikes (stormcalled, rending).
  fireProof: 128, coldProof: 256, lightningProof: 512, stormcalled: 1024, rending: 2048 } as const;

/** Ailment bits in WorldView.monsters.ailments. */
export const AILMENT_BIT = { burning: 1, chilled: 2, shocked: 4, shielded: 8, empowered: 16,
  /** Map events: takes +40% damage (a whiffed Stalker) / a translucent event monster (Stalker, echoes). */
  exposed: 32, spectral: 64,
  /** Map events, wave 2: a frozen statue (Stasis Host: invulnerable and inert) / a fixture (a destructible prop the presenter draws itself). */
  frozen: 128, fixture: 256 } as const;

export const PROJECTILE_KINDS = [
  'emberLance', 'novaFlame', 'flameWave', 'rimeShard', // player
  'cinderSpit', 'heraldOrb', 'matriarchOrb',            // monster
  ...NEW_PROJECTILE_KINDS,                              // Ossuary / Coliseum rosters (appended: stable indices)
] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

export const AREA_KINDS = [
  'slamWarning',      // telegraph circle (brute/boss slam) — damage when it expires
  'leapWarning',      // telegraph where a rift stalker will land
  'eruptionWarning',  // volcanic hazard telegraph
  'meteorWarning',    // boss meteor telegraph
  'firePool',         // burning ground hurting the player (boss/eruption aftermath)
  'fireTrail',        // player's burning ground (Cinderwalkers) hurting monsters
  'heraldAura',       // lieutenant's empowering aura
  ...NEW_AREA_KINDS,  // Ossuary / Coliseum rosters (see contracts/bestiary.ts for each kind's meaning)
  'stormStrike',      // stormcalled rare: lightning bolt telegraph on a player (shocks)
  'rendStrike',       // rending rare: raking strike telegraph on a player (bleeds)
  'echoMark',         // map events: a harmless shimmer where an echo, guardian or escort is about to appear
  'faultWedge',       // map events: a 90-degree wedge of the Fault field (heading = wedge centre); hurts everything inside
  'voidTide',         // map events: the Void Breach's tide, a ring band (radius = outer radius, heading field = inner radius); hurts everything inside
] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export type PlayerAnim = 'idle' | 'run' | 'cast' | 'dash' | 'hit' | 'death';

/** Where a root came from (picks the art variant). */
export type RootSource = 'bone' | 'web' | 'chain' | 'tar';

/** An active debuff on a player (GAME_SPEC §13). */
export interface PlayerDebuffView {
  id: PlayerDebuff;
  remaining: number;          // seconds
  duration: number;           // seconds (full duration of the current application)
  stacks: number;             // 1 for non-stacking debuffs
  /** Rooted only: what is holding the player. */
  source: RootSource | null;
}

export interface SlotView {
  skillId: SkillId | null;
  cooldown: number;           // remaining seconds until the next charge
  cooldownTotal: number;
  charges: number;
  maxCharges: number;
  focusCost: number;
  usable: boolean;            // enough focus and at least one charge / off cooldown
}

export interface FlaskSlotView {
  flaskId: FlaskId;
  count: number;
  resource: 'life' | 'focus';
  /** Remaining recovery seconds of the active use (0 = inactive). */
  active: number;
  duration: number;
}

export interface PlayerView {
  id: number;
  name: string;
  level: number;
  x: number; y: number;
  prevX: number; prevY: number;
  vx: number; vy: number;
  facing: Dir4;
  aimX: number; aimY: number;
  anim: PlayerAnim;
  animTime: number;           // seconds since anim started
  castSkill: SkillId | null;
  castProgress: number;       // 0..1 while casting
  life: number; maxLife: number;
  focus: number; maxFocus: number;
  wardTime: number;           // remaining cinder ward seconds
  wardDuration: number;
  invulnTime: number;
  hitFlash: number;           // 0..1 decays after taking damage
  dead: boolean;
  /**
   * Movement slow of a carried map-event object (Ember Relay: 0.12), a fraction like `slow` in movePlayer. It is on the wire and
   * combined into the prediction so the carrier never rubber-bands. 0 = none.
   */
  eventSlow?: number;
  /** Active debuffs (empty when none). Chilled/frozen/rooted change movement & casting in the sim. */
  debuffs: PlayerDebuffView[];
  slots: SlotView[];          // LOADOUT_SLOTS
  flasks: (FlaskSlotView | null)[]; // BELT_SLOTS
}

/** Struct-of-arrays monster store. Iterate 0..capacity-1 and skip !alive[i]. */
export interface MonsterStoreView {
  capacity: number;
  count: number;              // number alive
  alive: Uint8Array;
  id: Uint32Array;            // (generation << 16) | slot — changes when a slot is reused
  kind: Uint8Array;           // index into MONSTER_KINDS
  rarity: Uint8Array;         // RARITY_CODE
  x: Float32Array; y: Float32Array;
  prevX: Float32Array; prevY: Float32Array;
  radius: Float32Array;
  facing: Int8Array;          // -1 west, 1 east
  anim: Uint8Array;           // MONSTER_ANIM
  animTime: Float32Array;     // seconds since anim started
  life: Float32Array; maxLife: Float32Array;
  hitFlash: Float32Array;     // 0..1
  ailments: Uint16Array;      // AILMENT_BIT mask
  mods: Uint16Array;          // ELITE_BIT mask
}

export interface ProjectileStoreView {
  capacity: number;
  count: number;
  alive: Uint8Array;
  id: Uint32Array;
  kind: Uint8Array;           // index into PROJECTILE_KINDS
  hostile: Uint8Array;        // 1 = monster projectile
  x: Float32Array; y: Float32Array;
  prevX: Float32Array; prevY: Float32Array;
  vx: Float32Array; vy: Float32Array;
  radius: Float32Array;
  age: Float32Array;
  /** Total flight time in seconds for lobbed projectiles (cinderSpit), 0 = flat projectile. */
  life: Float32Array;
}

/** Reserved snapshot field for older renderers; gameplay no longer spawns XP motes. */
export interface MoteStoreView {
  capacity: number;
  count: number;
  alive: Uint8Array;
  x: Float32Array; y: Float32Array;
  prevX: Float32Array; prevY: Float32Array;
  size: Uint8Array;           // 0 small, 1 medium, 2 large
}

export interface AreaView {
  id: number;
  kind: AreaKind;
  x: number; y: number;
  radius: number;
  age: number;                // seconds since created
  duration: number;           // total lifetime (telegraphs resolve at age == duration)
}

export interface DropView {
  id: number;
  /** spec.owner is the only player who sees / can pick up this drop. */
  spec: DropSpec;
  x: number; y: number;
  prevX: number; prevY: number;
  /** Height above ground while bouncing out of a corpse/chest (world units). */
  z: number;
  age: number;
  /** True when the owner touched it but tryPickup returned false. */
  blocked: boolean;
}

export type PropKind =
  | 'mapDevice' | 'stash' | 'merchant' | 'debugMerchant' | 'portal' | 'returnPortal' | 'chest'
  | 'pillar' | 'brazier' | 'standingStone' | 'rubble' | 'bones' | 'crystal' | 'banner' | 'anvil' | 'ruinWall'
  // Hand-crafted layout art kit (docs/atlas-rework/D-territory.md 10.5), appended in this order: stable wire codes.
  | 'vat' | 'bellows' | 'altar' | 'sarcophagus' | 'choirStall' | 'ribArch' | 'iceColumn'
  | 'crate' | 'chainPost' | 'hoist' | 'gate' | 'weaponRack' | 'obelisk' | 'statue';

/**
 * How a solid prop treats straight-flying shots (src/data/propCover.ts): tall = stops them, low = they fly over it,
 * none = nothing. Lobs and nova rings always fly over. Walking is blocked by any prop with radius > 0.
 */
export type PropCover = 'tall' | 'low' | 'none';

export interface PropView {
  id: number;
  kind: PropKind;
  x: number; y: number;
  radius: number;             // collision radius (0 = walk-through)
  /** Chest: 0 closed / 1 opened. Portal: remaining portal count (0 = closed/hidden). Others: 0. */
  state: number;
  variant: number;            // visual variant index
  interactive: boolean;       // clickable in the hideout (mapDevice, stash, merchant)
  /** Only when it differs from the kind's default (src/data/propCover.ts): a layout's per-landmark / wall override. */
  cover?: PropCover;
}

export type RunPhase = 'hideout' | 'tell' | 'fight' | 'boss' | 'cleared' | 'failed';

export interface RunView {
  /** Revealed map events (at most three run at once); empty until one reveals itself. */
  events: import('./map-events').MapEventView[];
  phase: RunPhase;
  wave: number;               // 1-based, 0 before the first wave
  waveCount: number;
  waveTime: number;           // seconds elapsed in the current wave
  waveDuration: number;
  elapsed: number;            // seconds since run start
  kills: number;
  monstersAlive: number;
  boss: { name: string; life: number; maxLife: number; phase: number } | null;
  /** The second boss (Rival Crowns' rival) while both live: its own bar under the first. */
  boss2?: { name: string; life: number; maxLife: number; phase: number } | null;
  lieutenant: { name: string; life: number; maxLife: number } | null;
  portalOpen: boolean;        // hideout portal or post-clear return portal
  /** Number of living players in the instance. */
  playersAlive: number;
}

export interface WorldView {
  tick: number;
  time: number;               // tick * SIM_DT
  arenaRadius: number;
  theme: Theme;
  /** The Atlas area of a map (the presenter draws that area's layout decals and lights from it); absent in hideouts. */
  areaId?: AtlasAreaId;
  /** Flow-zone seed of the area's layout (the sim's own view, or ZoneInfo.flowSeed on a client): presenter and prediction derive belts from it. */
  flowSeed?: number;
  /** Every player in the instance (dead players stay until removed). Order is stable by join. */
  players: PlayerView[];
  monsters: MonsterStoreView;
  projectiles: ProjectileStoreView;
  motes: MoteStoreView;
  areas: AreaView[];
  drops: DropView[];
  props: PropView[];
  run: RunView;
}

// ---------------------------------------------------------------------------
// Events (cosmetic; drained by the presenter each frame — may be capped/dropped under load)
// ---------------------------------------------------------------------------

export type SimEvent =
  // `playerId` = the acting player (caster) or, for target 'player', the player who was hit.
  | { t: 'cast'; playerId: number; skill: SkillId; x: number; y: number; dirX: number; dirY: number }
  | { t: 'nova'; playerId: number; skill: SkillId; x: number; y: number; radius: number }
  | { t: 'dash'; playerId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { t: 'ward'; playerId: number; x: number; y: number; duration: number }
  | { t: 'chain'; playerId: number; points: number[] /* x0,y0,x1,y1,… */; damageType: DamageType }
  | { t: 'hit'; playerId: number; x: number; y: number; amount: number; damageType: DamageType; crit: boolean; target: 'monster' | 'player'; killed: boolean; kind?: MonsterKind }
  | { t: 'evade'; playerId: number; x: number; y: number; target: 'monster' | 'player' }
  | { t: 'projectileEnd'; kind: ProjectileKind; x: number; y: number }
  | { t: 'death'; kind: MonsterKind; rarity: number /* RARITY_CODE */; x: number; y: number; facing: number; damageType: DamageType }
  | { t: 'monsterAttack'; kind: MonsterKind; x: number; y: number; attack: 'melee' | 'spit' | 'leap' | 'slam' | 'summon' | 'orb' | 'meteor' | 'charge'
      | 'web' | 'hook' | 'aim' | 'bolt' | 'tar' | 'nova' | 'spikes' | 'prison' | 'blizzard' | 'whirl' | 'mark' | 'sing' | 'pulse' | 'burst' | 'bash' }
  /** A debuff was applied to / refreshed on a player. */
  | { t: 'debuff'; playerId: number; debuff: PlayerDebuff; stacks: number; x: number; y: number }
  /** Debuffs removed by a flask / death. */
  | { t: 'cleanse'; playerId: number; debuffs: PlayerDebuff[]; x: number; y: number }
  /** A shieldbearer blocked a player projectile from the front, or (`cover`) a tall prop stopped a straight shot. */
  | { t: 'blocked'; x: number; y: number; cover?: boolean }
  /** A chain hook pulled a player toward (toX, toY). */
  | { t: 'pull'; playerId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { t: 'monsterSpawn'; kind: MonsterKind; rarity: number; x: number; y: number }
  | { t: 'ailment'; ailment: 'burning' | 'chilled' | 'shocked'; x: number; y: number }
  | { t: 'areaResolve'; kind: AreaKind; x: number; y: number; radius: number }
  // Drop events go only to the drop's owner (`owner`), or to everyone nearby when owner is 0 (public drop).
  // `playerId` on 'pickup' = who picked it up.
  | { t: 'dropSpawn'; owner: number; tone: DropTone; x: number; y: number; label: string }
  | { t: 'pickup'; owner: number; playerId: number; tone: DropTone; x: number; y: number; label: string }
  | { t: 'mote'; playerId: number; x: number; y: number }
  | { t: 'flask'; playerId: number; resource: 'life' | 'focus' }
  | { t: 'waveTell'; wave: number; families: MonsterKind[]; lieutenant: boolean; boss: boolean }
  | { t: 'waveStart'; wave: number }
  | { t: 'bossSpawn'; x: number; y: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'cleared'; x: number; y: number }
  | { t: 'chestOpen'; x: number; y: number }
  | { t: 'portal'; playerId: number; x: number; y: number; kind: 'open' | 'enter' }
  | { t: 'playerDeath'; playerId: number; x: number; y: number }
  | { t: 'playerJoin'; playerId: number; x: number; y: number }
  | { t: 'notEnoughFocus'; playerId: number }
  /** A map event beat: `n` is a per-beat number (step index, resonance, grade). */
  | { t: 'mapEvent'; kind: import('./map-events').MapEventKind; beat: import('./map-events').MapEventBeat; x: number; y: number; n: number };

// ---------------------------------------------------------------------------
// Outcomes (authoritative; never dropped; consumed by the app)
// ---------------------------------------------------------------------------

export type SimOutcome =
  /** Shared XP: grant `amount` to EVERY player in the instance. */
  | { t: 'xp'; amount: number }
  /** `playerId` = the player credited with the killing blow (0 if none, e.g. burning ground after leaving). */
  | { t: 'kill'; playerId: number; kind: MonsterKind; rarity: MonsterRarity; isLieutenant: boolean; isBoss: boolean }
  | { t: 'pickup'; playerId: number; token: number }
  | { t: 'flaskUsed'; playerId: number; slot: number }
  | { t: 'waveStart'; wave: number }
  | { t: 'bossDefeated' }
  | { t: 'cleared' }            // final wave done (boss dead); chest + return portal spawn
  /** A map event finished with a payout (Bronze or better): the hook for the account's first-completion Atlas point. */
  | { t: 'eventComplete'; kind: import('./map-events').MapEventKind; grade: number }
  | { t: 'chestOpened'; playerId: number }
  | { t: 'playerDied'; playerId: number }
  | { t: 'enterPortal'; playerId: number }   // hideout portal entered → server moves the player into the map
  | { t: 'returnPortal'; playerId: number }; // map return portal entered → server moves the player home

export interface PlayerUpdate {
  stats?: PlayerCombatStats;
  skills?: SkillRuntimeDef[];
  loadout?: (SkillId | null)[];
  flasks?: (FlaskRuntime | null)[];
  /** Restore life and focus to full (level up). */
  restore?: boolean;
}

export interface SimRun {
  readonly config: RunConfig;
  readonly view: WorldView;
  /** Show or remove the CLI-enabled testing merchant in a hideout. */
  setDebugMerchant(enabled: boolean): void;
  /** Add a player to the instance (spawn anim + 'playerJoin' event). Throws if the id is taken or 4 are present. */
  addPlayer(join: PlayerJoin): void;
  /** Remove a player (left the instance / disconnected). Their un-picked OWN drops are removed (public drops stay). */
  removePlayer(id: number): void;
  /**
   * Put an item on the floor near (x, y) with a small bounce — used for items players drop (spec.owner 0,
   * spec.autoPickup false). Returns the drop id. Emits 'dropSpawn'.
   */
  spawnDrop(spec: DropSpec, x: number, y: number): number;
  /**
   * A player clicked a drop: if it is theirs or public, and within PICKUP_REACH, call hooks.tryPickup and on
   * success remove it, emit 'pickup' + the 'pickup' outcome. Works for autoPickup drops too.
   */
  requestPickup(playerId: number, dropId: number): PickupResult;
  /** Remove a drop without anyone picking it up (expiry). */
  removeDrop(dropId: number): void;
  /** Latest held-state intent for a player; applied on every following step until replaced. */
  setIntent(id: number, intent: PlayerIntent): void;
  /** Advance exactly one fixed tick (SIM_DT). */
  step(): void;
  drainEvents(): SimEvent[];
  drainOutcomes(): SimOutcome[];
  updatePlayer(id: number, update: PlayerUpdate): void;
  /** Hideout only: show the map portal next to the map device with `remaining` uses (0 hides it). */
  setPortal(remaining: number): void;
  /** Deterministic digest of the world state (FNV-1a) for regression/determinism tests. */
  digest(): number;
}

/**
 * Pure local-player movement step shared by the server sim and client-side prediction:
 * src/sim/index.ts must also export `movePlayer` implementing this signature (same collision/arena/slow rules
 * as the sim uses for players, excluding knockback and monster crowd pushes).
 */
export type MovePlayer = (
  state: { x: number; y: number },
  input: { moveX: number; moveY: number },
  params: { speed: number; arenaRadius: number; props: readonly PropView[]; slow: number },
  dt: number,
) => { x: number; y: number };

/** src/sim/index.ts must export: `export function createRun(config: RunConfig): SimRun` */
export type CreateRun = (config: RunConfig) => SimRun;
