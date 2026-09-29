// Simulation tuning constants. Numbers that the UI also shows come from the rules (RunConfig);
// everything here is sim-owned behaviour (GAME_SPEC §8 and the combat rules of §0/§3).
import { MAX_PARTY_SIZE } from '../contracts/net';
import { SIM_DT } from '../contracts/sim';

export const DT = SIM_DT;

// --- players & party -----------------------------------------------------------
/** At most this many players share an instance (a full party). */
export const MAX_PLAYERS = MAX_PARTY_SIZE;
/** Server-assigned player ids are 1..255 (0 means "no player" in kill credit and targets). */
export const MAX_PLAYER_ID = 255;
/** Party scaling from the living player count n (GAME_SPEC §11): life ×(1 + 0.5·(n−1)) at spawn… */
export const PARTY_LIFE_PER_PLAYER = 0.5;
/** …wave budget ×(1 + 0.25·(n−1)) at wave start… */
export const PARTY_BUDGET_PER_PLAYER = 0.25;
/** …and magic/rare pack chance ×(1 + 0.1·(n−1)) (10% increased per extra player). */
export const PARTY_ELITE_PER_PLAYER = 0.1;
/**
 * Monster target hysteresis: a monster keeps chasing its current player until another living
 * player is this many times closer, so a horde between two players doesn't flicker between them.
 */
export const RETARGET_RATIO = 1.25;
/** Joining players appear on a small ring around the entry point (no stacking at the portal). */
export const JOIN_RING_RADIUS = 16;
/** Allies overlapping each other are eased apart by this share of the overlap per tick… */
export const ALLY_PUSH_RATE = 0.25;
/** …but never more than this many units per tick (a gentle nudge, never a shove). */
export const ALLY_PUSH_MAX = 1;

// --- capacities ------------------------------------------------------------
/** Map instances: room for the densest waves (800+ monsters, 600+ projectiles). */
export const MONSTER_CAPACITY = 2048;
export const PROJECTILE_CAPACITY = 2048;
export const MOTE_CAPACITY = 1024;
/**
 * Hideouts hold only the training dummy, so they get small stores: there is one hideout per online
 * character and an idle one should cost next to nothing (memory and per-tick scans).
 */
export const HIDEOUT_MONSTER_CAPACITY = 16;
export const HIDEOUT_PROJECTILE_CAPACITY = 512;
export const HIDEOUT_MOTE_CAPACITY = 64;
/** Per-projectile ring of recently hit monster ids (pierce bookkeeping). */
export const PROJECTILE_HIT_SLOTS = 24;
/** Soft cap on live monsters; spawns beyond it are deferred (summons are skipped). */
export const MAX_LIVE_MONSTERS = 1400;

// --- events ------------------------------------------------------------------
export const EVENT_CAP_PER_TICK = 2048;
/** Low-priority (purely cosmetic) events may use at most this share of a tick's budget. */
export const LOW_EVENT_CAP_PER_TICK = 1536;
/** Safety bound when nobody drains the buffer (headless runs): low events stop first. */
export const EVENT_BUFFER_SOFT_MAX = 16384;
export const EVENT_BUFFER_HARD_MAX = 32768;

// --- spatial -----------------------------------------------------------------
/**
 * Uniform grid cell size. 32 units measured ~2× faster than 64 for dense hordes: separation pairs
 * are found in a half-neighbourhood, which is exact while two bodies' radii sum to ≤ one cell;
 * the few bigger bodies (the boss) get their own pass.
 */
export const GRID_CELL = 32;
/** Monsters above this radius are separated in the large-body pass. */
export const LARGE_BODY_RADIUS = GRID_CELL / 2;
/** Largest monster collision radius we ever expect (boss 24); padding for static prop cells. */
export const MAX_MONSTER_RADIUS = 30;

// --- player ------------------------------------------------------------------
export const PLAYER_RADIUS = 7;
/**
 * Movement speed multiplier while a timed active skill is being cast. The basic attack (slot 0)
 * is exempt: it is held most of the time, and the move speed the character sheet shows must be
 * the speed you actually walk at while fighting.
 */
export const CAST_MOVE_FACTOR = 0.7;
/**
 * While an instant skill's key stays held (Rift Step), it re-fires at most this often. A fresh
 * press always fires immediately, so a quick double-tap still blinks twice.
 */
export const INSTANT_RETRIGGER = 0.4;
/** Projectiles leave the wand this far in front of the player. */
export const MUZZLE_OFFSET = 8;
export const DASH_INVULN = 0.2;
export const DASH_ANIM = 0.2;
export const HIT_ANIM = 0.2;
export const HIT_FLASH_DECAY = 1 / 0.25;
/** Short grace period when a run starts. */
export const START_INVULN = 1.0;
export const NOT_ENOUGH_FOCUS_REPEAT = 1.5;
/**
 * Crowd slow: each regular monster pressed against the player *in the direction of travel*
 * (within CROWD_CONE of the move direction) slows her by this much, down to the floor. A horde
 * in front boxes you in; monsters trailing behind never hold you back. Heavy bodies block instead.
 */
export const CROWD_SLOW_PER_MONSTER = 0.12;
export const CROWD_SLOW_FLOOR = 0.4;
/** cos(60°): half-angle of the forward cone in which touching monsters slow the player. */
export const CROWD_CONE_COS = 0.5;
/** Contact tolerance for "pressed against the player" (bodies are resolved to exact contact). */
export const CROWD_CONTACT_PAD = 1.5;

// --- damage rules ------------------------------------------------------------
/** Every hit rolls ×[ROLL_MIN, ROLL_MAX]; the midpoint must stay 1 so tooltips are truthful. */
export const ROLL_MIN = 0.8;
export const ROLL_MAX = 1.2;
if (Math.abs((ROLL_MIN + ROLL_MAX) / 2 - 1) > 1e-9) throw new Error('damage roll range must be symmetric around 1');
export const RESIST_CAP = 0.75;
export const WARD_REDUCTION_CAP = 0.6;
export const EVASION_CAP = 0.75;
/** A single attacker can hit a given player at most once per this many seconds. */
export const ATTACKER_IMMUNITY = 0.25;
/** Total melee damage per rolling window is capped at this fraction of max life (per player). */
export const MELEE_CAP_FRACTION = 0.35;
export const MELEE_CAP_WINDOW_TICKS = 30; // 0.5 s

// --- ailments ----------------------------------------------------------------
export const IGNITE_DURATION = 3;
/** Ignite deals this fraction of the igniting hit as fire damage over its duration. */
export const IGNITE_FRACTION = 0.8;
export const IGNITE_EVENT_INTERVAL = 0.5;
export const CHILL_DURATION = 2;
export const CHILL_SLOW = 0.3;
export const SHOCK_DURATION = 3;
export const SHOCK_BONUS = 0.2;

// --- player debuffs (GAME_SPEC §13) -----------------------------------------------
// Elemental durations (chilled / frozen: cold, burning: fire, shocked: lightning) are scaled by
// (1 − res/2) with the player's matching resistance; while Cinder Ward is up every debuff runs out
// WARD_DEBUFF_RATE times as fast (its durations are halved). Death clears them all.
/** Chilled: −30% move and cast speed. Refreshes, doesn't stack. */
export const PLAYER_CHILL_DURATION = 2;
export const PLAYER_CHILL_SLOW = 0.3;
/** Frozen: can't move or act (flasks still work). Only telegraphed sources freeze. */
export const FREEZE_DURATION = 0.8;
/** After a freeze ends the player can't be frozen again for this long (a freeze then becomes a chill). */
export const FREEZE_IMMUNITY = 3;
/** Rooted: can't move, can still cast; Rift Step breaks it. */
export const ROOT_DURATION = 1.4;
/**
 * Roots don't chain: while rooted and for this long after a root ends (or is broken), new roots are
 * ignored (a chain hook still drags). Many hooks and tar pools at once must not lock a player down:
 * with 3 s a player standing in every hook and tar pool of an Iron Coliseum is held at most ~4 s of
 * any 10 s (1.5 s let it reach 5.5 s — over half the time), and a typical careless player about 3 s.
 */
export const ROOT_GRACE = 3;
/** Burning: this share of the triggering hit as fire damage over BURN_DURATION; the strongest burn is kept. */
export const BURN_DURATION = 3;
export const BURN_FRACTION = 0.4;
/** Bleeding: this share of the hit over BLEED_DURATION, doubled while moving; up to BLEED_MAX_STACKS. */
export const BLEED_DURATION = 4;
export const BLEED_FRACTION = 0.2;
export const BLEED_MOVING_MULT = 2;
export const BLEED_MAX_STACKS = 3;
/** Shocked: +20% damage taken. */
export const PLAYER_SHOCK_DURATION = 2;
export const PLAYER_SHOCK_BONUS = 0.2;
/** Withered: −12% to every resistance (not physical) per stack; the stacks share one refreshing timer. */
export const WITHER_DURATION = 4;
export const WITHER_RES_PER_STACK = 0.12;
export const WITHER_MAX_STACKS = 3;
/** Debuff timers run this many times as fast while Cinder Ward is active (= durations halved). */
export const WARD_DEBUFF_RATE = 2;
/** A refresh of an unchanged debuff re-emits its 'debuff' event at most this often (per player, per debuff). */
export const DEBUFF_EVENT_REPEAT = 1;
/** Player damage-over-time (burning, bleeding) is reported as one 'hit' event per type this often. */
export const PLAYER_DOT_EVENT_INTERVAL = 0.5;
/** A chain hook drags its victim over this long (then the root holds them). */
export const PULL_TIME = 0.25;
/**
 * Longest single drag (units): a pull asking for more stops here. Over PULL_TIME that is at most
 * ~9.3 units a tick — below PLAYER_RADIUS + the smallest solid prop (6), so a drag never tunnels
 * through a prop — and a yank a player can read. The duration stays PULL_TIME: client prediction
 * replays the drag from the 'pull' event with exactly that timing.
 */
export const PULL_MAX_DISTANCE = 140;
/** Default pull distance of a chain hook (GAME_SPEC §14: 40 units toward the thrower). */
export const CHAIN_PULL_DISTANCE = 40;
/** Knockback displacement applied to a player per tick (geometric, like monsters). */
export const PLAYER_KNOCKBACK_RATE = 0.3;
/** Largest knockback a player can have pending (units). */
export const PLAYER_KNOCKBACK_MAX = 60;

// --- skills ------------------------------------------------------------------
export const NOVA_ECHO_DELAY = 0.4;
export const ARC_TARGET_RANGE = 240;
export const ARC_JUMP_RANGE = 90;
export const WARD_PULSE_INTERVAL = 0.5;
export const WARD_RADIUS = 40;
export const FIRE_TRAIL_INTERVAL = 0.2;
export const FIRE_TRAIL_DURATION = 2.0;
export const FIRE_TRAIL_RADIUS = 14;
export const FIRE_TRAIL_TICK = 0.5;
/** Fire trail damage per tick as a fraction of the basic attack's average hit. */
export const FIRE_TRAIL_DAMAGE = 0.35;

// --- monsters ----------------------------------------------------------------
export const SPAWN_ANIM_TIME = 0.5;
export const MONSTER_HIT_FLASH_DECAY = 1 / 0.14;
export const KNOCKBACK_MIN = 2;
export const KNOCKBACK_MAX = 4;
/** Fraction of the remaining knockback displacement applied per tick (geometric: Σ = 100%). */
export const KNOCKBACK_RATE = 0.35;
export const PACK_THINK_INTERVAL = 12;
export const AGGRO_RADIUS = 280;
export const MEMBER_AGGRO_RADIUS = 200;
/** Idle packs further than this from every player sleep (no movement work). */
export const SLEEP_RADIUS = 760;
export const SEPARATION_RELAX = 0.5;
export const SEPARATION_MAX_STEP = 2.5;
export const WAVE_LIFE_GROWTH = 0.08;
export const WAVE_DAMAGE_GROWTH = 0.04;
export const EMPOWER_BONUS = 0.3;
/** Haste auras (the Bone Chorister, GAME_SPEC §14): allies inside move this much faster (speed only). */
export const HASTE_BONUS = 0.25;
/**
 * Heavy bodies wedged by props: after PROP_STUCK_TIME of walking into props without getting anywhere
 * (less than PROP_STUCK_PROGRESS of the step made good), they slide sideways around the obstacle for
 * PROP_SLIDE_TIME, always to the same side until they have been clear of props for PROP_SIDE_MEMORY
 * (so they follow a wall of stones to its end instead of pacing back and forth; see ai.ts integrate).
 */
export const PROP_STUCK_TIME = 0.25;
export const PROP_STUCK_PROGRESS = 0.2;
export const PROP_SLIDE_TIME = 0.8;
export const PROP_SIDE_MEMORY = 1;
export const HERALD_AURA_RADIUS = 110;
export const WARDED_REDUCTION = 0.4;
export const WARDED_ALLY_RADIUS = 90;
/** Ironhide Brutes (MonsterDef.hitReduction) take this much less damage from hits (burning — ignite, trails, ward embers — ignores it). */
export const ARMOURED_HIT_REDUCTION = 0.4;
/** Minions summoned by the Herald/Matriarch roll no loot and carry this share of their XP. */
export const SUMMONED_XP_FACTOR = 0.5;
/**
 * A saturated field (GAME_SPEC §8, §14): while this many monsters are alive, no lieutenant or boss summons —
 * no cast starts, and minions due from a cast in progress don't appear (bosses.ts fieldFull). A summoner the
 * party can't reach (the Herald kiting behind its ashlings, the Chorister behind its thralls) used to snowball
 * the horde until the boss wave; the local caps on top (the Chainmaster's thralls, Varkus's hounds near him)
 * keep a summoner's own crowd readable on a thinner field.
 */
export const SUMMON_FIELD_CAP = 160;
/** Cinder Spitter spit: a lob with a fixed flight time that bursts where it lands. */
export const SPIT_FLIGHT = 1.1;
/** Landing splash radius of a lob (ProjectileStore.splash overrides it per projectile). */
export const SPIT_SPLASH_RADIUS = 12;
/** A landed tar glob leaves a tar pool of this radius and duration. */
export const TAR_POOL_RADIUS = 26;
export const TAR_POOL_DURATION = 6;
/** Deaths remembered for corpse-raising (Bone Chorister): a ring of the most recent ones. */
export const CORPSE_MEMORY = 64;
/** A remembered corpse can be raised for this long after the death. */
export const CORPSE_LIFETIME = 30;

// --- waves -------------------------------------------------------------------
export const PACK_SHARE = 0.6;
export const PACK_MIN_DISTANCE = 250;
/**
 * Half extents of the world a player's camera shows: the ~640×360 virtual view at zoom 1, plus a
 * little for wider screens. Stream groups spawn just outside this box.
 */
export const VIEW_HALF_W = 340;
export const VIEW_HALF_H = 200;
/** Stream members appear this far beyond the view edge along their bearing… */
export const STREAM_MARGIN = 24;
/** …plus up to this much more (a ragged line rather than a painted arc). */
export const STREAM_DEPTH = 24;
/** The stream is spread over this fraction of the wave duration (its regular cadence). */
export const STREAM_WINDOW = 0.8;
/** Average stream group size (groups are 4–8 monsters). */
export const STREAM_GROUP_AVG = 6;
/** Half-angle of the arc a stream group arrives on, around one bearing. */
export const STREAM_ARC = (40 * Math.PI) / 180;
/**
 * Pressure floor: while fewer than PRESSURE_BASE + PRESSURE_PER_WAVE·wave hunting monsters are
 * within PRESSURE_RADIUS of some living player, the next stream group is pulled forward and sent to
 * the least-pressed player (at most one per STREAM_MIN_GAP). A player who out-kills the stream meets
 * it sooner; one who can't is left alone.
 */
export const PRESSURE_BASE = 8;
export const PRESSURE_PER_WAVE = 4;
export const PRESSURE_RADIUS = 450;
export const PRESSURE_CHECK_TICKS = 30;
export const STREAM_MIN_GAP = 2.0;
/** No stream group arrives in the first seconds of a wave (the packs appear first). */
export const STREAM_FIRST_DELAY = 2.0;
/** Seconds before the first tell (the player gets their bearings). */
export const INTRO_DELAY = 1.0;
export const HAZARD_MIN_INTERVAL = 3.5;
export const HAZARD_MAX_INTERVAL = 5.5;

// --- loot --------------------------------------------------------------------
export const DROP_GRAVITY = 520;
export const DROP_PICKUP_DELAY = 0.35;
export const DROP_TOUCH_RADIUS = PLAYER_RADIUS + 6;
/**
 * Items put on the floor with SimRun.spawnDrop (a player dropping something) are tossed a short hop
 * in a deterministic pseudo-random direction: horizontal speed and upward speed ranges (units/s).
 * With DROP_GRAVITY that lands them ~14–28 units from the given point after one small bounce.
 */
export const FLOOR_TOSS_SPEED_MIN = 32;
export const FLOOR_TOSS_SPEED_MAX = 50;
export const FLOOR_TOSS_LIFT_MIN = 100;
export const FLOOR_TOSS_LIFT_MAX = 125;
/**
 * The toss direction (radians, 0 = +x, π/2 = +y = down the screen, toward the camera) is picked
 * between these: always in front of the dropper's feet, never behind them, where the item and its
 * stacked label would hide under (and cover) the character's sprite.
 */
export const FLOOR_TOSS_ANGLE_MIN = 0.25 * Math.PI;
export const FLOOR_TOSS_ANGLE_MAX = 0.75 * Math.PI;
/** Ground items keep this far inside the arena edge and this far (radius) out of solid props. */
export const DROP_EDGE_MARGIN = 10;
export const DROP_PROP_RADIUS = 5;
export const MOTE_TOUCH_RADIUS = PLAYER_RADIUS + 4;
export const CHEST_TOUCH_PAD = 4;
export const PORTAL_ENTER_RADIUS = 16;
/**
 * Seconds a player must stay inside an open portal before it takes them. Walking straight through
 * one (≤ 0.42 s even while slowed by a cast) never triggers it; stopping in it does.
 */
export const PORTAL_DWELL = 0.5;
/** A portal that opens (or a player who arrives) this close needs a deliberate step out and back in. */
export const PORTAL_LATCH_RADIUS = PORTAL_ENTER_RADIUS + 10;
/** The map's return portal keeps this far from the boss's fall and the chest (their loot fountains)… */
export const RETURN_PORTAL_CLEARANCE = 140;
/** …and at least this far from any drop lying around (picking one up must not brush the portal). */
export const RETURN_PORTAL_DROP_CLEARANCE = 60;
