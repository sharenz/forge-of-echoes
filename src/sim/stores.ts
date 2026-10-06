// Struct-of-arrays entity stores with free-lists and generation ids.
// Ids are `(generation << 16) | slot` (u32), so a handle to a freed slot never matches its successor.
// Every store keeps a high-water mark `hwm`: all slots at or past it are dead, so the sim's loops run
// `i < store.hwm` (re-read each iteration, so entities spawned mid-loop are still visited) instead
// of scanning the whole capacity. Views may do the same (it is a superset of the contract).
import type { MonsterStoreView, MoteStoreView, ProjectileStoreView } from '../contracts/sim';
import { PROJECTILE_HIT_SLOTS } from './constants';

/** Slot-allocation core shared by every store. Slot 0 is handed out first (deterministic). */
class SlotPool {
  readonly gen: Uint16Array;
  private readonly freeList: Int32Array;
  private freeTop: number;

  constructor(capacity: number) {
    if (capacity > 0xffff) throw new Error('store capacity must fit in 16 bits');
    this.gen = new Uint16Array(capacity);
    this.freeList = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.freeList[i] = capacity - 1 - i;
    this.freeTop = capacity;
  }

  alloc(): number {
    return this.freeTop > 0 ? this.freeList[--this.freeTop] : -1;
  }

  release(slot: number): void {
    this.gen[slot] = (this.gen[slot] + 1) & 0xffff;
    this.freeList[this.freeTop++] = slot;
  }

  makeId(slot: number): number {
    return ((this.gen[slot] << 16) | slot) >>> 0;
  }
}

/** ProjectileStore.src of a projectile no monster fired. */
export const NO_SOURCE = 0xffffffff;

export const MSTATE = {
  chase: 0,
  windup: 1,
  attack: 2,
  leap: 3,
  cast: 4,
  charge: 5,
  roar: 6,
} as const;

/** Monster flag bits (internal). */
export const MFLAG = {
  lieutenant: 1,
  boss: 2,
  unpushable: 4,
  immune: 8,
  shielded: 16,
  /** Pressed against a player last tick (anchored in separation so the rings behind yield). */
  touching: 32,
  /** Big bodies (boss, lieutenant, brutes): players can't shove them — they block them instead. */
  heavy: 64,
  /** Summoned by the Herald/Matriarch: no loot, reduced XP (stalling a boss is not a farm). */
  summoned: 128,
  /** Ghost (MonsterDef.ghost): no crowding — drifts through other monsters and props, never slows a player. */
  ghost: 256,
  /**
   * Guarding (MonsterDef.block): player projectiles arriving within the block arc around `aim` are
   * blocked ('blocked' event, projectile consumed). Set at spawn for blockers; brains clear it while the
   * shield is down (e.g. mid-bash) and set it again.
   */
  guard: 512,
  /**
   * Map events (wave 2): a statue of the Stasis Host. Invulnerable (not hittable) and inert (no brain, no movement) until thawed;
   * a solid, unpushable body. Shown through AILMENT_BIT.frozen.
   */
  frozen: 1024,
  /**
   * Map events (wave 2): a destructible fixture (a bloom, the Time Prism, a wheel): an inert, hittable, unpushable body with no
   * attacks. The presenter hides its body (AILMENT_BIT.fixture) and draws the prop from the event view.
   */
  fixture: 2048,
} as const;

/** Lower a store's high-water mark past the dead slots at its top (after releasing slot `slot`). */
function shrinkHwm(alive: Uint8Array, hwm: number, slot: number): number {
  if (slot !== hwm - 1) return hwm;
  let h = slot;
  while (h > 0 && !alive[h - 1]) h--;
  return h;
}

export class MonsterStore implements MonsterStoreView {
  readonly capacity: number;
  count = 0;
  /** One past the highest slot that may be alive (see the header). */
  hwm = 0;
  // --- view ---
  readonly alive: Uint8Array;
  readonly id: Uint32Array;
  readonly kind: Uint8Array;
  readonly rarity: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly radius: Float32Array;
  readonly facing: Int8Array;
  readonly anim: Uint8Array;
  readonly animTime: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly hitFlash: Float32Array;
  readonly ailments: Uint16Array;
  /** ELITE_BIT mask (magic packs share one mod; rare leaders carry two). */
  readonly mods: Uint16Array;
  // --- internal ---
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Player id this monster is chasing (0 = none). */
  readonly target: Uint8Array;
  /** Player id credited with the current burn (0 = none). */
  readonly igniteSrc: Uint8Array;
  /** Remaining knockback displacement. */
  readonly kbX: Float32Array;
  readonly kbY: Float32Array;
  /** Separation push accumulated this tick. */
  readonly sepX: Float32Array;
  readonly sepY: Float32Array;
  readonly speed: Float32Array;
  readonly damage: Float32Array;
  readonly attackCd: Float32Array;
  readonly state: Uint8Array;
  readonly stateTime: Float32Array;
  /** Attack target point (leap landing, slam centre, charge end). */
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  /** Leap / charge start point. */
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  /** Personal surround angle (spreads a horde around the player instead of stacking). */
  readonly offsetAngle: Float32Array;
  /** Per-monster phase for erratic movement. */
  readonly phase: Float32Array;
  readonly spawnTime: Float32Array;
  readonly xp: Float32Array;
  readonly igniteDps: Float32Array;
  readonly igniteTime: Float32Array;
  readonly igniteAccum: Float32Array;
  readonly igniteEventTimer: Float32Array;
  readonly chillTime: Float32Array;
  readonly shockTime: Float32Array;
  /** Herald aura remaining (empowered while > 0). */
  readonly empowerTime: Float32Array;
  /** Haste aura remaining (HASTE_BONUS faster while > 0; speed only). */
  readonly hasteTime: Float32Array;
  /**
   * Prop wedging (ai.ts integrate): > 0 seconds a heavy body has been walking into props without
   * progress; < 0 seconds it has been clear of props since its last slide.
   */
  readonly stuckTime: Float32Array;
  /** Prop slide: seconds left, signed by the side it slides to (0 = not sliding). */
  readonly slide: Float32Array;
  /** The side (±1) this body slides around props to until it has been clear of them a while (0 = none yet). */
  readonly slideSide: Int8Array;
  /** Immunity to player ground effects (fire trail) — at most one trail tick per interval. */
  readonly groundCd: Float32Array;
  /** Generic ability timers (meaning depends on kind). */
  readonly timerA: Float32Array;
  readonly timerB: Float32Array;
  readonly timerC: Float32Array;
  readonly timerD: Float32Array;
  /** 0..1: how much knockback affects this monster. */
  readonly knockback: Float32Array;
  readonly pack: Int32Array;
  /** MFLAG bits. */
  readonly flags: Uint16Array;
  readonly wave: Uint8Array;
  /** DAMAGE_TYPES index of the monster's own attacks (from its MonsterDef). */
  readonly dtype: Uint8Array;
  /** Share of hit damage an armoured monster ignores (MonsterDef.hitReduction; burning ignores it). */
  readonly hitReduction: Float64Array;
  /** Facing angle in radians (blockers: the centre of the shield arc; kept by the core, see ai.ts). */
  readonly aim: Float32Array;
  /** Resistances, 5 per monster in DAMAGE_TYPES order (resistBonus already included). */
  readonly res: Float32Array;
  /**
   * Exposure (power rework): resistance points lost per damage type, as a fraction, 5 per monster in DAMAGE_TYPES
   * order. Meaningful only while `exposeTime` > 0; the whole row is cleared when that timer runs out.
   */
  readonly expose: Float32Array;
  /** Seconds of exposure left (one shared timer; every application refreshes it). */
  readonly exposeTime: Float32Array;

  private readonly pool: SlotPool;
  private readonly zeroed: (Float32Array | Float64Array | Uint8Array | Uint16Array | Int8Array | Int32Array)[];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pool = new SlotPool(capacity);
    const f = () => new Float32Array(capacity);
    const u8 = () => new Uint8Array(capacity);
    this.alive = u8();
    this.id = new Uint32Array(capacity);
    this.kind = u8();
    this.rarity = u8();
    this.x = f(); this.y = f(); this.prevX = f(); this.prevY = f();
    this.radius = f();
    this.facing = new Int8Array(capacity);
    this.anim = u8();
    this.animTime = f();
    this.life = f(); this.maxLife = f();
    this.hitFlash = f();
    this.ailments = new Uint16Array(capacity);
    this.vx = f(); this.vy = f(); this.kbX = f(); this.kbY = f(); this.sepX = f(); this.sepY = f();
    this.target = u8(); this.igniteSrc = u8();
    this.speed = f(); this.damage = f(); this.attackCd = f();
    this.state = u8(); this.stateTime = f();
    this.tx = f(); this.ty = f(); this.sx = f(); this.sy = f();
    this.offsetAngle = f(); this.phase = f(); this.spawnTime = f(); this.xp = f();
    this.igniteDps = f(); this.igniteTime = f(); this.igniteAccum = f(); this.igniteEventTimer = f();
    this.chillTime = f(); this.shockTime = f(); this.empowerTime = f(); this.groundCd = f();
    this.hasteTime = f(); this.stuckTime = f(); this.slide = f(); this.slideSide = new Int8Array(capacity);
    this.timerA = f(); this.timerB = f(); this.timerC = f(); this.timerD = f();
    this.knockback = f();
    this.pack = new Int32Array(capacity);
    this.mods = new Uint16Array(capacity); this.flags = new Uint16Array(capacity); this.wave = u8();
    this.dtype = u8(); this.hitReduction = new Float64Array(capacity); this.aim = f();
    this.res = new Float32Array(capacity * 5);
    this.expose = new Float32Array(capacity * 5);
    this.exposeTime = f();
    this.zeroed = [
      this.kind, this.rarity, this.x, this.y, this.prevX, this.prevY, this.radius, this.facing, this.anim, this.animTime,
      this.life, this.maxLife, this.hitFlash, this.ailments, this.vx, this.vy, this.target, this.igniteSrc,
      this.kbX, this.kbY, this.sepX, this.sepY,
      this.speed, this.damage, this.attackCd, this.state, this.stateTime, this.tx, this.ty, this.sx, this.sy,
      this.offsetAngle, this.phase, this.spawnTime, this.xp, this.igniteDps, this.igniteTime, this.igniteAccum,
      this.igniteEventTimer, this.chillTime, this.shockTime, this.empowerTime, this.groundCd, this.hasteTime, this.stuckTime,
      this.slide, this.slideSide,
      this.timerA, this.timerB, this.timerC, this.timerD, this.knockback, this.mods, this.flags, this.wave,
      this.dtype, this.hitReduction, this.aim, this.exposeTime,
    ];
  }

  /** Allocate a zeroed slot, or -1 when full. */
  alloc(): number {
    const slot = this.pool.alloc();
    if (slot < 0) return -1;
    for (const arr of this.zeroed) arr[slot] = 0;
    for (let k = 0; k < 5; k++) { this.res[slot * 5 + k] = 0; this.expose[slot * 5 + k] = 0; }
    this.pack[slot] = -1;
    this.alive[slot] = 1;
    this.id[slot] = this.pool.makeId(slot);
    this.count++;
    if (slot >= this.hwm) this.hwm = slot + 1;
    return slot;
  }

  release(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.pool.release(slot);
    this.count--;
    this.hwm = shrinkHwm(this.alive, this.hwm, slot);
  }

  /** Slot for an id, or -1 if that entity no longer exists. */
  slotOf(id: number): number {
    if (id < 0) return -1;
    const slot = id & 0xffff;
    return slot < this.capacity && this.alive[slot] && this.id[slot] === id >>> 0 ? slot : -1;
  }
}

export class ProjectileStore implements ProjectileStoreView {
  readonly capacity: number;
  count = 0;
  /** One past the highest slot that may be alive (see the header). */
  hwm = 0;
  readonly alive: Uint8Array;
  readonly id: Uint32Array;
  readonly kind: Uint8Array;
  readonly hostile: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly radius: Float32Array;
  readonly age: Float32Array;
  /**
   * Lobbed projectiles (cinder spit): total flight time in seconds, 0 for flat shots. A lob
   * ignores everything in flight and bursts where it lands at age == life.
   */
  readonly life: Float32Array;
  // --- internal ---
  /** Player id that fired a player projectile (kill credit), 0 for monster projectiles. */
  readonly owner: Uint8Array;
  readonly damage: Float32Array;
  readonly critChance: Float32Array;
  readonly critMult: Float32Array;
  readonly ailmentChance: Float32Array;
  readonly dtype: Uint8Array;
  /** Conversion (power rework): DAMAGE_TYPES index the `convShare` of the hit is converted to; meaningful only when convShare > 0. */
  readonly convTo: Uint8Array;
  /** Share (0..1) of the hit converted to `convTo`; 0 = no conversion. */
  readonly convShare: Float32Array;
  /** Remaining pierces; -1 = pierces everything. */
  readonly pierce: Int32Array;
  /** Remaining travel distance. */
  readonly range: Float32Array;
  readonly hitIds: Uint32Array;
  /** Valid entries in the hit ring (≤ PROJECTILE_HIT_SLOTS). */
  readonly hitCount: Uint8Array;
  readonly hitCursor: Uint8Array;
  /** Monster id that fired a hostile projectile (NO_SOURCE for player projectiles or unknown). */
  readonly src: Uint32Array;
  /** Hostile rider: 0 = none, else 1 + PLAYER_DEBUFFS index (applied to a player it connects with). */
  readonly debuff: Uint8Array;
  /** ROOT_SOURCES index for a 'rooted' rider. */
  readonly rootSrc: Uint8Array;
  /** 0 = none, else 1 + index into the projectile effect registry (effects.ts). */
  readonly effect: Uint8Array;
  /** Lobs: landing splash radius (0 = SPIT_SPLASH_RADIUS). */
  readonly splash: Float32Array;
  /** Chain hooks: pull distance (0 = CHAIN_PULL_DISTANCE). */
  readonly pull: Float32Array;
  private readonly pool: SlotPool;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pool = new SlotPool(capacity);
    const f = () => new Float32Array(capacity);
    this.src = new Uint32Array(capacity);
    this.debuff = new Uint8Array(capacity);
    this.rootSrc = new Uint8Array(capacity);
    this.effect = new Uint8Array(capacity);
    this.splash = f();
    this.pull = f();
    this.alive = new Uint8Array(capacity);
    this.id = new Uint32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.hostile = new Uint8Array(capacity);
    this.x = f(); this.y = f(); this.prevX = f(); this.prevY = f();
    this.vx = f(); this.vy = f(); this.radius = f(); this.age = f(); this.life = f();
    this.owner = new Uint8Array(capacity);
    this.damage = f(); this.critChance = f(); this.critMult = f(); this.ailmentChance = f();
    this.dtype = new Uint8Array(capacity);
    this.convTo = new Uint8Array(capacity);
    this.convShare = f();
    this.pierce = new Int32Array(capacity);
    this.range = f();
    this.hitIds = new Uint32Array(capacity * PROJECTILE_HIT_SLOTS);
    this.hitCount = new Uint8Array(capacity);
    this.hitCursor = new Uint8Array(capacity);
  }

  alloc(): number {
    const slot = this.pool.alloc();
    if (slot < 0) return -1;
    this.alive[slot] = 1;
    this.id[slot] = this.pool.makeId(slot);
    this.age[slot] = 0;
    this.hitCount[slot] = 0;
    this.hitCursor[slot] = 0;
    this.count++;
    if (slot >= this.hwm) this.hwm = slot + 1;
    return slot;
  }

  release(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.pool.release(slot);
    this.count--;
    this.hwm = shrinkHwm(this.alive, this.hwm, slot);
  }

  hasHit(slot: number, monsterId: number): boolean {
    const n = this.hitCount[slot];
    const base = slot * PROJECTILE_HIT_SLOTS;
    for (let k = 0; k < n; k++) if (this.hitIds[base + k] === monsterId) return true;
    return false;
  }

  /** Remember a hit; once the ring is full the oldest entry is overwritten (only matters for pierce-all). */
  recordHit(slot: number, monsterId: number): void {
    const cur = this.hitCursor[slot];
    this.hitIds[slot * PROJECTILE_HIT_SLOTS + cur] = monsterId;
    this.hitCursor[slot] = (cur + 1) % PROJECTILE_HIT_SLOTS;
    if (this.hitCount[slot] < PROJECTILE_HIT_SLOTS) this.hitCount[slot]++;
  }
}

export class MoteStore implements MoteStoreView {
  readonly capacity: number;
  count = 0;
  /** One past the highest slot that may be alive (see the header). */
  hwm = 0;
  readonly alive: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly size: Uint8Array;
  // --- internal ---
  readonly xp: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly magnet: Uint8Array;
  /** Player id a magnetised mote is flying to. */
  readonly target: Uint8Array;
  readonly speed: Float32Array;
  private readonly pool: SlotPool;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pool = new SlotPool(capacity);
    const f = () => new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.x = f(); this.y = f(); this.prevX = f(); this.prevY = f();
    this.size = new Uint8Array(capacity);
    this.xp = f(); this.vx = f(); this.vy = f(); this.speed = f();
    this.magnet = new Uint8Array(capacity);
    this.target = new Uint8Array(capacity);
  }

  alloc(): number {
    const slot = this.pool.alloc();
    if (slot < 0) return -1;
    this.alive[slot] = 1;
    this.magnet[slot] = 0;
    this.target[slot] = 0;
    this.speed[slot] = 0;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.count++;
    if (slot >= this.hwm) this.hwm = slot + 1;
    return slot;
  }

  release(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.pool.release(slot);
    this.count--;
    this.hwm = shrinkHwm(this.alive, this.hwm, slot);
  }
}
