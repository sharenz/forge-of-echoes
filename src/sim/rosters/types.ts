// Roster extension API — the types. See src/sim/rosters/index.ts for the guide.
import type { DamageType, MonsterKind } from '../../contracts/content';
import type { PlayerState, World } from '../world';

/** Resistances in DAMAGE_TYPES order (physical, fire, cold, lightning, void), as fractions. */
export type ResistRow = readonly [physical: number, fire: number, cold: number, lightning: number, voidRes: number];

/** What a monster is for (drives nothing by itself; documents intent and lets tests group kinds). */
export type MonsterRole =
  | 'swarmer' | 'fast' | 'artillery' | 'hunter' | 'bruiser' | 'support' | 'lieutenant' | 'boss' | 'dummy';

/**
 * A monster's per-tick brain. Called once per tick for every awake, fully spawned monster of its kind
 * (after the core has ticked its timers, ailments and animation clock; before the core integrates its
 * movement). Allocation-free by convention: it is the hottest callback in the sim.
 *
 *  - `w`, `i`: the world and the monster's slot in `w.monsters` (SoA — `w.monsters.x[i]` etc.).
 *  - `t`: the player it targets (the nearest living one, with hysteresis), or null when nobody is left.
 *    When the whole party is down `t` may still be the last target's corpse (finish the attack, deal
 *    nothing: damage to a dead player is ignored).
 *  - `dx`, `dy`, `d`: vector from the monster to `t` and its length (d = 1e9 without a target).
 *  - `hunting`: false while its pack is idle (not aggroed yet) — call `wander(w, i)` then.
 *
 * Output: set `m.vx[i]`/`m.vy[i]` (desired velocity — use steer / moveAlong / stop), state and anim,
 * and act through the helpers in ./api.ts. The core then applies chill, empower, separation,
 * knockback, props, the arena edge and player bodies.
 */
export type Brain = (w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean) => void;

/**
 * A boss encounter. The core drives the phases: when the boss's life fraction drops to or below
 * `phases[k]` it enters phase k + 2 (one phase per roar, even after a huge hit): it becomes immune,
 * stops, plays its windup pose for `roar` seconds, its unresolved telegraphs are cancelled, and
 * 'bossPhase' is emitted. The brain is not called while it roars. `RunView.boss.phase` shows the
 * phase; read it in the brain as `phaseOf(w, i)`.
 *
 * `S` is the script's own encounter state (cooldowns, patterns…), created by `init` when the boss
 * spawns and read in the brain with `bossState<S>(w, i)` (api.ts). Each boss owns independent state.
 */
export interface BossScript<S = unknown> {
  /** Life fractions (descending) at which phases 2, 3, … begin, e.g. [0.66, 0.33]. */
  phases: readonly number[];
  /** Seconds of the immune phase-change roar. */
  roar: number;
  /** Fresh encounter state (called when the boss spawns, or lazily on its first tick). */
  init(w: World, i: number): S;
  /** The boss just entered `phase` (its roar starts now). */
  onPhase?(w: World, i: number, state: S, phase: number): void;
  /** The roar into `phase` just ended (the brain runs again from this tick on). */
  onRoarEnd?(w: World, i: number, state: S, phase: number): void;
}

/** Frontal shield (MonsterDef.block): see MFLAG.guard and the projectile resolution in projectiles.ts. */
export interface BlockSpec {
  /** Full angle of the blocking arc in radians, centred on `m.aim[i]` (Shieldbearer: 2π/3 = 120°). */
  arc: number;
  /**
   * How fast the shield turns toward its target (rad/s) while guarding. Slow enough that a player
   * can walk around it: the counterplay is flanking.
   */
  turnRate: number;
}

/**
 * Everything the sim knows about one monster kind: its stats (multiplied by MonsterScaling, wave
 * growth, elite mods and party size at spawn), how it fits into waves, the flags the core honours,
 * and its behaviour.
 */
export interface MonsterDef {
  kind: MonsterKind;
  /** Display name (lieutenant / boss health bar: RunView.lieutenant / RunView.boss). */
  name: string;
  role: MonsterRole;
  /** Collision radius in world units (rares are 15% larger). */
  radius: number;
  life: number;
  /** Units per second. */
  speed: number;
  /** Damage of its basic attack; everything else is a multiple of it. */
  damage: number;
  xp: number;
  /** Damage type of its basic attack (meleeHit uses it). */
  damageType: DamageType;
  resist: ResistRow;
  /** 0..1 knockback susceptibility (0 = immovable by hits). */
  knockback: number;

  // --- waves ---------------------------------------------------------------------------------------
  /** First wave in which the kind appears in regular packs and the stream (0 = never: summons, bosses). */
  fromWave: number;
  /** Composition weight when unlocked… */
  weight: number;
  /** …and its growth per wave after that: weight × (1 + growth × (wave − fromWave)), at least 0.5. */
  weightGrowth: number;
  /** Multiplier on its weight in the off-screen stream (default 1; heavy hitters 0.5). */
  streamWeight?: number;
  /** At most this many per pack; extra rolls become the roster's first family member. */
  maxPerPack?: number;

  // --- flags the core honours ----------------------------------------------------------------------
  /** Players can't shove it: it blocks them instead (bosses and lieutenants always are). */
  heavy?: boolean;
  /** 0..1: this much less damage from hits (not from burning: ignite, fire trail, ward embers). */
  hitReduction?: number;
  /** Drifts through other monsters and props, ignores crowding and never slows a player. */
  ghost?: boolean;
  /** Blocks player projectiles from the front (see BlockSpec). */
  block?: BlockSpec;

  // --- behaviour -----------------------------------------------------------------------------------
  brain: Brain;
  /** Bosses: the phase script (the core runs it for any monster of this kind). */
  boss?: BossScript;
  /**
   * Called once when the wave director spawns it as the map's lieutenant or boss (escorts, auras,
   * opening timers). `pack` is the pack it leads; (x, y) the exact spawn point (the store keeps
   * Float32 positions).
   */
  onSpawn?(w: World, i: number, pack: number, x: number, y: number): void;
  /** Called when it dies (credited or not), after the core removed it: its slot `i` is already free. */
  onDeath?(w: World, x: number, y: number, credited: boolean): void;
}

/** One map theme's monsters (GAME_SPEC §14; contracts/bestiary.ts THEME_ROSTER). */
export interface Roster {
  /** The regular wave family, in a fixed order (deterministic weighted picks). */
  family: readonly MonsterKind[];
  lieutenant: MonsterKind;
  boss: MonsterKind;
}
