// ClientWorld: the browser's replica of one instance, shaped exactly like the server's WorldView.
//
// Timelines (why each piece of the view comes from where it does):
//  • Render timeline (≈ newest − 2.2 snapshot intervals, 50–150 ms): monsters, projectiles, motes, remote players
//    and the appearance of drops. prev* = snapshot A, current = snapshot B (the two bracketing the render tick), the
//    returned alpha interpolates them. Anim times, projectile ages, drop arcs, hit flashes and remote cast bars are
//    evaluated at the render tick, so they advance smoothly at any display rate. When the stream starves, positions
//    extrapolate for at most 100 ms (prev = B, current = B + velocity·100 ms, alpha = elapsed / 100 ms), then the
//    render clock itself holds there and catches up with a gentle time warp once data flows again.
//  • Live timeline (newest snapshot, ages advanced by the arrival clock): telegraph areas — a slam circle fills up
//    as close to the server's real timing as the client can know, which is what the player dodges against — plus
//    the run state, dynamic props (chests, portal counts), the disappearance of drops (picked up = gone at once, by
//    anyone: public drops too) and the local player's HUD data (life, focus, cooldowns, flasks, cast bar).
//  • Predicted (present): the local player's position (incl. the cast slow), locomotion anim, facing, velocity and
//    aim. Written into both prevX and x so it ignores alpha. Her own bolts are drawn on the render timeline (so they
//    hit the monsters where those are drawn) but shifted by her prediction offset at launch, fading out over their
//    first 0.25 s of flight, so they leave her hand instead of the spot she stood on RTT + delay ago.
//
// Identity: `view`, its stores (and their typed arrays), `players`/`areas`/`drops`/`props` arrays and `run` are
// created once and never replaced (setZone only clears them). Monster/projectile/mote view indices are the
// server's store slots, so a slot keeps its index while the entity lives (ids change when a slot is reused, exactly
// like the sim's own view). PlayerView/DropView/AreaView/PropView objects are pooled per entity id.
import type { InputMessage, ZoneInfo } from '../contracts/net';
import { SIM_DT } from '../contracts/sim';
import type {
  AreaView, Dir4, DropView, MonsterStoreView, MoteStoreView, PlayerAnim, PlayerView, ProjectileStoreView, PropView,
  RunView, WorldView,
} from '../contracts/sim';
import type { ClientWorld } from '../contracts/net';
import { ByteReader, StringInterner } from './bytes';
import { SnapshotClock } from './clock';
import { LocalPredictor } from './prediction';
import type { PredictionEnv, PredictionHints } from './prediction';
import { DYNAMIC_PROP_KINDS } from './protocol';
import {
  Snapshot, createDropView, createPlayerView, createPropView, createRunView,
} from './snapshot';
import type { PlayerRecord } from './snapshot';

/** Rate at which a player's hit flash fades (per second) — the sim's HIT_FLASH_DECAY (1 / 0.25 s). */
const PLAYER_HIT_FLASH_DECAY = 4;
/** A non-hostile projectile first seen this close to the local player's server position is one of her own. */
const OWN_SPAWN_RADIUS = 28;
/** Her own bolts blend from the predicted hand position onto their true path over this much flight time (s). */
const OWN_OFFSET_FADE = 0.25;
/** Larger launch offsets are a blink/correction in progress, not latency: no shift then. */
const OWN_OFFSET_MAX = 64;

/** Client store capacities (≥ the sim's 2048/2048/1024; entities in higher slots are not shown). */
export const CLIENT_MONSTER_CAPACITY = 4096;
export const CLIENT_PROJECTILE_CAPACITY = 4096;
export const CLIENT_MOTE_CAPACITY = 2048;
/** Snapshots kept for interpolation (~1 s at 30 Hz). */
const RING_SIZE = 32;
/** At most this much extrapolation past the newest snapshot (ticks; 100 ms). */
export const MAX_EXTRAPOLATION_TICKS = 6;
/** A snapshot this far behind the newest means the server restarted the tick counter: start over. */
const RESET_BACKWARDS_TICKS = 600;
/** Interpolating an entity farther than this between two snapshots is a teleport: show it at the new spot. */
const MONSTER_TELEPORT_DIST = 160;
const MOTE_TELEPORT_BASE = 40;
const MOTE_MAX_SPEED = 900; // generous bound on magnetised mote speed (u/s)
const PLAYER_TELEPORT_DIST = 64;

export interface ClientWorldStats {
  snapshots: number;
  decodeErrors: number;
  duplicates: number;
  late: number;
  resets: number;
  extrapolating: boolean;
  corrections: number;
  snaps: number;
  lastCorrection: number;
  /** Estimated base move speed of the local player (units/s). */
  moveSpeed: number;
  pendingInputs: number;
  bufferedSnapshots: number;
  interpDelayMs: number;
  /** Robust jitter estimate (95th percentile of per-delivery lateness, ms). */
  jitterMs: number;
  /** Lateness of the latest snapshot above the arrival floor (ms). */
  lateMs: number;
  /** Estimated server tick-rate drift against the client clock (fraction; + = server slower). */
  drift: number;
  /** Arrival-floor rebases (persistent latency steps). */
  rebases: number;
  /** Frames on which the render clock waited for a starved stream. */
  holds: number;
  lastSnapshotBytes: number;
}

export interface NetClientWorld extends ClientWorld {
  /** Current render position on the server timeline (fractional ticks). Use it to delay cosmetic events. */
  readonly renderTick: number;
  /** Current interpolation delay (ms). */
  readonly interpDelayMs: number;
  /** Last value passed to setRtt (ms). */
  readonly rtt: number;
  /** Newest server tick expected to have arrived by client time `now`. */
  liveTick(now: number): number;
  /** Live diagnostics (the same object every call). */
  stats(): ClientWorldStats;
  /**
   * The local player's raw predicted position after the latest input tick (before sub-tick smoothing and the
   * correction offset), or null before the first snapshot. The returned object is reused.
   */
  predictedPosition(): { x: number; y: number } | null;
  /**
   * Exact numbers from the shared rules for the local character (e.g. from rules.playerRuntime(character, setup)):
   * base move speed and per-skill cast times. Optional — both are also learned from snapshots — but with them the
   * very first step and the very first cast of each skill are predicted exactly. Survives setZone.
   */
  setPredictionHints(hints: PredictionHints): void;
}

function createMonsterStore(capacity: number): MonsterStoreView {
  const f = () => new Float32Array(capacity);
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity), id: new Uint32Array(capacity), kind: new Uint8Array(capacity),
    rarity: new Uint8Array(capacity), x: f(), y: f(), prevX: f(), prevY: f(), radius: f(),
    facing: new Int8Array(capacity), anim: new Uint8Array(capacity), animTime: f(), life: f(), maxLife: f(),
    hitFlash: f(), ailments: new Uint8Array(capacity), mods: new Uint8Array(capacity),
  };
}

function createProjectileStore(capacity: number): ProjectileStoreView {
  const f = () => new Float32Array(capacity);
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity), id: new Uint32Array(capacity), kind: new Uint8Array(capacity),
    hostile: new Uint8Array(capacity), x: f(), y: f(), prevX: f(), prevY: f(), vx: f(), vy: f(), radius: f(),
    age: f(), life: f(),
  };
}

function createMoteStore(capacity: number): MoteStoreView {
  const f = () => new Float32Array(capacity);
  return { capacity, count: 0, alive: new Uint8Array(capacity), x: f(), y: f(), prevX: f(), prevY: f(), size: new Uint8Array(capacity) };
}

/** Tracks which view indices were written this frame so the rest can be marked dead without a full sweep. */
class AliveTracker {
  private readonly stamp: Uint32Array;
  private list: Int32Array;
  private next: Int32Array;
  private n = 0;
  private m = 0;
  private frame = 1;

  constructor(capacity: number) {
    this.stamp = new Uint32Array(capacity);
    this.list = new Int32Array(capacity);
    this.next = new Int32Array(capacity);
  }

  begin(): void {
    this.frame = (this.frame + 1) >>> 0 || 1;
    this.m = 0;
  }

  /** Returns false if the index was already written this frame. */
  mark(i: number): boolean {
    if (this.stamp[i] === this.frame) return false;
    this.stamp[i] = this.frame;
    this.next[this.m++] = i;
    return true;
  }

  /** Clear `alive` for indices live last frame but not written this frame; returns the live count. */
  end(alive: Uint8Array): number {
    for (let k = 0; k < this.n; k++) {
      const i = this.list[k];
      if (this.stamp[i] !== this.frame) alive[i] = 0;
    }
    const t = this.list;
    this.list = this.next;
    this.next = t;
    this.n = this.m;
    return this.m;
  }
}

/** Slot → record index of one snapshot's entity list, valid while `serial` matches (entries are id-verified). */
class SlotIndex {
  readonly index = new Int32Array(65536);
  serial = -1;
}

function dirFromVector(dx: number, dy: number, current: Dir4): Dir4 {
  // Same hysteresis as the sim, so the predicted facing matches what the server will send.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6 && ay < 1e-6) return current;
  const bias = 1.2;
  const currentHorizontal = current === 'east' || current === 'west';
  const horizontal = currentHorizontal ? ax * bias >= ay : ax > ay * bias;
  if (horizontal) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function copyRun(src: RunView, dst: RunView, boss: NonNullable<RunView['boss']>, lieutenant: NonNullable<RunView['lieutenant']>): void {
  dst.phase = src.phase;
  dst.wave = src.wave;
  dst.waveCount = src.waveCount;
  dst.waveTime = src.waveTime;
  dst.waveDuration = src.waveDuration;
  dst.elapsed = src.elapsed;
  dst.kills = src.kills;
  dst.monstersAlive = src.monstersAlive;
  dst.portalOpen = src.portalOpen;
  dst.playersAlive = src.playersAlive;
  if (src.boss) {
    boss.name = src.boss.name;
    boss.life = src.boss.life;
    boss.maxLife = src.boss.maxLife;
    boss.phase = src.boss.phase;
    dst.boss = boss;
  } else dst.boss = null;
  if (src.lieutenant) {
    lieutenant.name = src.lieutenant.name;
    lieutenant.life = src.lieutenant.life;
    lieutenant.maxLife = src.lieutenant.maxLife;
    dst.lieutenant = lieutenant;
  } else dst.lieutenant = null;
}

function copyPropFields(src: PropView, dst: PropView): void {
  dst.id = src.id;
  dst.kind = src.kind;
  dst.x = src.x;
  dst.y = src.y;
  dst.radius = src.radius;
  dst.state = src.state;
  dst.variant = src.variant;
  dst.interactive = src.interactive;
}

export function createClientWorld(): NetClientWorld {
  const monsters = createMonsterStore(CLIENT_MONSTER_CAPACITY);
  const projectiles = createProjectileStore(CLIENT_PROJECTILE_CAPACITY);
  const motes = createMoteStore(CLIENT_MOTE_CAPACITY);
  const players: PlayerView[] = [];
  const areas: AreaView[] = [];
  const drops: DropView[] = [];
  const props: PropView[] = [];
  const run = createRunView();
  const runBoss = { name: '', life: 0, maxLife: 0, phase: 1 };
  const runLieutenant = { name: '', life: 0, maxLife: 0 };
  const view: WorldView = {
    tick: 0, time: 0, arenaRadius: 0, theme: 'hideout',
    players, monsters, projectiles, motes, areas, drops, props, run,
  };

  const monsterAlive = new AliveTracker(CLIENT_MONSTER_CAPACITY);
  const projectileAlive = new AliveTracker(CLIENT_PROJECTILE_CAPACITY);
  const moteAlive = new AliveTracker(CLIENT_MOTE_CAPACITY);
  const monsterIndexA = new SlotIndex();
  const projectileIndexA = new SlotIndex();
  const moteIndexA = new SlotIndex();
  // Own-bolt launch offsets per projectile view slot, keyed by the projectile id they were measured for.
  const projClassified = new Uint8Array(CLIENT_PROJECTILE_CAPACITY); // 0 = not yet seen, 1 = own, 2 = other
  const projClassId = new Uint32Array(CLIENT_PROJECTILE_CAPACITY);
  const projOffX = new Float32Array(CLIENT_PROJECTILE_CAPACITY);
  const projOffY = new Float32Array(CLIENT_PROJECTILE_CAPACITY);

  const reader = new ByteReader();
  const interner = new StringInterner();
  const clock = new SnapshotClock();
  const predictor = new LocalPredictor();
  const env: PredictionEnv = { arenaRadius: 0, props };

  /** Received snapshots, ascending by tick. */
  const ordered: Snapshot[] = [];
  const free: Snapshot[] = [];
  let spare = new Snapshot();
  let serialCounter = 0;

  let localPlayerId = 0;
  let zoneProps: PropView[] = [];
  let propsSerial = -1;
  let rtt = 0;
  let renderTick = 0;
  let lastNow = Number.NaN;

  const playerObjs = new Map<number, PlayerView>();
  const dropObjs = new Map<number, DropView>();
  const areaObjs = new Map<number, AreaView>();
  const propObjs = new Map<number, PropView>();
  const seenIds = new Set<number>();
  // The newest snapshot's drops by id (the live timeline decides when a drop is gone).
  const liveDrops = new Map<number, DropView>();
  let liveDropsSerial = -1;

  // Local player's presentation state (predicted anim/facing).
  let localAnim: PlayerAnim = 'idle';
  let localAnimTime = 0;
  let localFacing: Dir4 = 'south';
  const renderPos = { x: 0, y: 0 };
  const predictedOut = { x: 0, y: 0 };

  const stats: ClientWorldStats = {
    snapshots: 0, decodeErrors: 0, duplicates: 0, late: 0, resets: 0, extrapolating: false, corrections: 0, snaps: 0,
    lastCorrection: 0, moveSpeed: 0, pendingInputs: 0, bufferedSnapshots: 0, interpDelayMs: 0, jitterMs: 0, lateMs: 0,
    drift: 0, rebases: 0, holds: 0, lastSnapshotBytes: 0,
  };

  function newest(): Snapshot | null {
    return ordered.length ? ordered[ordered.length - 1] : null;
  }

  function clearView(): void {
    monsterAlive.begin();
    monsters.count = monsterAlive.end(monsters.alive);
    projectileAlive.begin();
    projectiles.count = projectileAlive.end(projectiles.alive);
    moteAlive.begin();
    motes.count = moteAlive.end(motes.alive);
    players.length = 0;
    areas.length = 0;
    drops.length = 0;
    playerObjs.clear();
    dropObjs.clear();
    areaObjs.clear();
    const fresh = createRunView();
    copyRun(fresh, run, runBoss, runLieutenant);
    view.tick = 0;
    view.time = 0;
  }

  function clearBuffers(): void {
    while (ordered.length) free.push(ordered.pop()!);
    clock.reset();
    predictor.reset();
    monsterIndexA.serial = projectileIndexA.serial = moteIndexA.serial = -1;
    projClassified.fill(0);
    propsSerial = -1;
    liveDrops.clear();
    liveDropsSerial = -1;
    renderTick = 0;
    lastNow = Number.NaN;
    localAnim = 'idle';
    localAnimTime = 0;
    clearView();
    rebuildProps(null);
  }

  // --- props: static zone props merged with the replicated dynamic ones ---------------------------------
  function propObj(id: number): PropView {
    let o = propObjs.get(id);
    if (!o) {
      o = createPropView();
      propObjs.set(id, o);
    }
    return o;
  }

  function findProp(s: Snapshot | null, id: number): PropView | null {
    if (!s) return null;
    const list = s.props;
    for (let k = 0; k < s.propCount; k++) if (list[k].id === id) return list[k];
    return null;
  }

  function rebuildProps(s: Snapshot | null): void {
    props.length = 0;
    seenIds.clear();
    for (const zp of zoneProps) {
      const dyn = findProp(s, zp.id);
      if (DYNAMIC_PROP_KINDS.has(zp.kind) && s && !dyn) continue; // gone (opened portal closed, …)
      const o = propObj(zp.id);
      copyPropFields(dyn ?? zp, o);
      // A static prop missing from the snapshot has state 0 (the encoder sends every non-zero state).
      if (!dyn && s) o.state = 0;
      props.push(o);
      seenIds.add(zp.id);
    }
    if (s) {
      const list = s.props;
      for (let k = 0; k < s.propCount; k++) {
        const p = list[k];
        if (seenIds.has(p.id)) continue;
        const o = propObj(p.id);
        copyPropFields(p, o);
        props.push(o);
        seenIds.add(p.id);
      }
    }
    for (const id of propObjs.keys()) if (!seenIds.has(id)) propObjs.delete(id);
  }

  // --- snapshots ---------------------------------------------------------------------------------------
  function pushSnapshot(data: ArrayBuffer, receivedAt: number): void {
    try {
      spare.decode(data, reader, interner);
    } catch {
      stats.decodeErrors++;
      return;
    }
    const s = spare;
    s.receivedAt = receivedAt;
    stats.lastSnapshotBytes = data.byteLength;
    const top = newest();
    if (top && s.tick + RESET_BACKWARDS_TICKS < top.tick) {
      // The instance's tick counter restarted without a zone message: start from scratch.
      stats.resets++;
      clearBuffers();
    }
    // Duplicate, or older than everything we still keep: useless.
    let pos = ordered.length;
    while (pos > 0 && ordered[pos - 1].tick > s.tick) pos--;
    if (pos > 0 && ordered[pos - 1].tick === s.tick) {
      stats.duplicates++;
      return;
    }
    if (ordered.length >= RING_SIZE && pos === 0) {
      stats.late++;
      return;
    }
    s.serial = ++serialCounter;
    ordered.splice(pos, 0, s);
    spare = free.pop() ?? new Snapshot();
    if (ordered.length > RING_SIZE) free.push(ordered.shift()!);
    stats.snapshots++;
    clock.onSnapshot(s.tick, receivedAt);

    if (s !== newest()) {
      stats.late++;
      return;
    }
    // Newest snapshot: zone basics and the local player's reconciliation.
    if (localPlayerId === 0) localPlayerId = s.viewerId;
    view.theme = s.theme;
    if (s.arenaRadius > 0) view.arenaRadius = s.arenaRadius;
    env.arenaRadius = view.arenaRadius;
    const me = s.player(localPlayerId);
    if (me) predictor.reconcile(me, s.ackSeq, s.tick, env);
  }

  // --- per-frame view writing ----------------------------------------------------------------------------
  function buildIndex(idx: SlotIndex, snap: Snapshot, ids: Uint32Array | Uint16Array, n: number): void {
    const serial = snap.serial;
    if (idx.serial === serial) return;
    const t = idx.index;
    for (let i = 0; i < n; i++) t[ids[i] & 0xffff] = i;
    idx.serial = serial;
  }

  /**
   * A flash value at the render time: fades linearly between A and B; a fresh hit (B brighter than A) shows at full
   * strength from the start of the interval — the same moment the batch's 'hit' events are released.
   */
  function flashAt(a: number, b: number, t: number): number {
    return b > a ? b : a + (b - a) * t;
  }

  function writeMonsters(A: Snapshot, B: Snapshot, extrap: boolean, t: number, renderSec: number): void {
    const a = A.monsters;
    const b = B.monsters;
    buildIndex(monsterIndexA, A, a.id, a.n);
    const ai0 = monsterIndexA.index;
    const tA = A.tick * SIM_DT;
    const tB = B.tick * SIM_DT;
    const span = B.tick - A.tick;
    const m = monsters;
    monsterAlive.begin();
    for (let j = 0; j < b.n; j++) {
      const id = b.id[j];
      const vi = id & 0xffff;
      if (vi >= m.capacity || !monsterAlive.mark(vi)) continue;
      let ai = A !== B ? ai0[vi] : -1;
      if (ai >= a.n || (ai >= 0 && a.id[ai] !== id)) ai = -1;
      const bx = b.x[j];
      const by = b.y[j];
      let axp = bx;
      let ayp = by;
      if (ai >= 0) {
        axp = a.x[ai];
        ayp = a.y[ai];
        const dx = bx - axp;
        const dy = by - ayp;
        if (dx * dx + dy * dy > MONSTER_TELEPORT_DIST * MONSTER_TELEPORT_DIST) {
          axp = bx;
          ayp = by;
        }
      }
      if (extrap) {
        const k = span > 0 ? MAX_EXTRAPOLATION_TICKS / span : 0;
        m.prevX[vi] = bx;
        m.prevY[vi] = by;
        m.x[vi] = bx + (bx - axp) * k;
        m.y[vi] = by + (by - ayp) * k;
      } else {
        m.prevX[vi] = axp;
        m.prevY[vi] = ayp;
        m.x[vi] = bx;
        m.y[vi] = by;
      }
      m.alive[vi] = 1;
      m.id[vi] = id;
      m.kind[vi] = b.kind[j];
      m.rarity[vi] = b.rarity[j];
      m.radius[vi] = b.radius[j];
      m.facing[vi] = b.facing[j];
      m.life[vi] = b.life[j];
      m.maxLife[vi] = b.maxLife[j];
      m.hitFlash[vi] = ai >= 0 ? flashAt(a.hitFlash[ai], b.hitFlash[j], t) : b.hitFlash[j];
      m.ailments[vi] = b.ailments[j];
      m.mods[vi] = b.mods[j];
      // The anim playing at the render time: A's until B's anim had started.
      const startB = tB - b.animTime[j];
      if (ai >= 0 && renderSec < startB) {
        m.anim[vi] = a.anim[ai];
        m.animTime[vi] = a.animTime[ai] + Math.max(0, renderSec - tA);
      } else {
        m.anim[vi] = b.anim[j];
        m.animTime[vi] = Math.max(0, renderSec - startB);
      }
    }
    m.count = monsterAlive.end(m.alive);
  }

  /**
   * Decide once per projectile id whether it is one of the local player's own bolts and, if so, remember how far
   * her on-screen (predicted) position is ahead of her server position at the render time — the launch offset.
   */
  function classifyProjectile(vi: number, id: number, j: number, A: Snapshot, B: Snapshot, t: number): void {
    projClassId[vi] = id;
    projClassified[vi] = 2;
    projOffX[vi] = 0;
    projOffY[vi] = 0;
    const b = B.projectiles;
    const age = b.age[j];
    if (b.hostile[j] || !predictor.hasBase || age > (B.tick - A.tick + 3) * SIM_DT) return;
    const bMe = B.player(localPlayerId);
    if (!bMe || bMe.dead) return;
    // Spawn point vs where she stood at that moment (both walked back along their velocities).
    const sx = b.x[j] - b.vx[j] * age;
    const sy = b.y[j] - b.vy[j] * age;
    const mx = bMe.x - bMe.vx * age;
    const my = bMe.y - bMe.vy * age;
    if ((sx - mx) * (sx - mx) + (sy - my) * (sy - my) > OWN_SPAWN_RADIUS * OWN_SPAWN_RADIUS) return;
    projClassified[vi] = 1;
    const aMe = A !== B ? A.player(localPlayerId) : null;
    const serverX = aMe ? aMe.x + (bMe.x - aMe.x) * t : bMe.x;
    const serverY = aMe ? aMe.y + (bMe.y - aMe.y) * t : bMe.y;
    const ox = renderPos.x - serverX;
    const oy = renderPos.y - serverY;
    if (ox * ox + oy * oy <= OWN_OFFSET_MAX * OWN_OFFSET_MAX) {
      projOffX[vi] = ox;
      projOffY[vi] = oy;
    }
  }

  function ownFade(age: number): number {
    const f = 1 - age / OWN_OFFSET_FADE;
    return f > 0 ? (f < 1 ? f : 1) : 0;
  }

  function writeProjectiles(A: Snapshot, B: Snapshot, extrap: boolean, t: number, renderSec: number, localSeen: boolean): void {
    const a = A.projectiles;
    const b = B.projectiles;
    buildIndex(projectileIndexA, A, a.id, a.n);
    const ai0 = projectileIndexA.index;
    const tB = B.tick * SIM_DT;
    const spanSec = (B.tick - A.tick) * SIM_DT;
    const extrapSec = MAX_EXTRAPOLATION_TICKS * SIM_DT;
    const p = projectiles;
    projectileAlive.begin();
    for (let j = 0; j < b.n; j++) {
      const id = b.id[j];
      const vi = id & 0xffff;
      if (vi >= p.capacity || !projectileAlive.mark(vi)) continue;
      let ai = A !== B ? ai0[vi] : -1;
      if (ai >= a.n || (ai >= 0 && a.id[ai] !== id)) ai = -1;
      const bx = b.x[j];
      const by = b.y[j];
      const vx = b.vx[j];
      const vy = b.vy[j];
      const ageB = b.age[j];
      if (projClassified[vi] === 0 || projClassId[vi] !== id) {
        if (localSeen) classifyProjectile(vi, id, j, A, B, t);
        else {
          projClassId[vi] = id;
          projClassified[vi] = 2;
          projOffX[vi] = projOffY[vi] = 0;
        }
      }
      const ox = projOffX[vi];
      const oy = projOffY[vi];
      const shifted = projClassified[vi] === 1 && (ox !== 0 || oy !== 0);
      if (extrap) {
        const f0 = shifted ? ownFade(ageB) : 0;
        const f1 = shifted ? ownFade(ageB + extrapSec) : 0;
        p.prevX[vi] = bx + ox * f0;
        p.prevY[vi] = by + oy * f0;
        p.x[vi] = bx + vx * extrapSec + ox * f1;
        p.y[vi] = by + vy * extrapSec + oy * f1;
      } else {
        let px: number;
        let py: number;
        if (ai >= 0) {
          px = a.x[ai];
          py = a.y[ai];
        } else {
          // New since A: start from where it was at A's tick (or its spawn point), not ahead of the caster.
          const back = Math.min(ageB, spanSec);
          px = bx - vx * back;
          py = by - vy * back;
        }
        const f0 = shifted ? ownFade(Math.max(0, ageB - spanSec)) : 0;
        const f1 = shifted ? ownFade(ageB) : 0;
        p.prevX[vi] = px + ox * f0;
        p.prevY[vi] = py + oy * f0;
        p.x[vi] = bx + ox * f1;
        p.y[vi] = by + oy * f1;
      }
      p.alive[vi] = 1;
      p.id[vi] = id;
      p.kind[vi] = b.kind[j];
      p.hostile[vi] = b.hostile[j];
      p.vx[vi] = vx;
      p.vy[vi] = vy;
      p.radius[vi] = b.radius[j];
      p.life[vi] = b.life[j];
      const age = b.age[j] + (renderSec - tB);
      p.age[vi] = age > 0 ? age : 0;
    }
    p.count = projectileAlive.end(p.alive);
  }

  function writeMotes(A: Snapshot, B: Snapshot, extrap: boolean): void {
    const a = A.motes;
    const b = B.motes;
    buildIndex(moteIndexA, A, a.slot, a.n);
    const ai0 = moteIndexA.index;
    const span = B.tick - A.tick;
    const maxMove = MOTE_TELEPORT_BASE + MOTE_MAX_SPEED * span * SIM_DT;
    const mo = motes;
    moteAlive.begin();
    for (let j = 0; j < b.n; j++) {
      const vi = b.slot[j];
      if (vi >= mo.capacity || !moteAlive.mark(vi)) continue;
      let ai = A !== B ? ai0[vi] : -1;
      if (ai >= a.n || (ai >= 0 && a.slot[ai] !== vi)) ai = -1;
      const bx = b.x[j];
      const by = b.y[j];
      let axp = bx;
      let ayp = by;
      // Motes have no generation id: a reused slot shows up as a jump, which starts a new mote.
      if (ai >= 0 && a.size[ai] === b.size[j]) {
        const dx = bx - a.x[ai];
        const dy = by - a.y[ai];
        if (dx * dx + dy * dy <= maxMove * maxMove) {
          axp = a.x[ai];
          ayp = a.y[ai];
        }
      }
      if (extrap) {
        const k = span > 0 ? MAX_EXTRAPOLATION_TICKS / span : 0;
        mo.prevX[vi] = bx;
        mo.prevY[vi] = by;
        mo.x[vi] = bx + (bx - axp) * k;
        mo.y[vi] = by + (by - ayp) * k;
      } else {
        mo.prevX[vi] = axp;
        mo.prevY[vi] = ayp;
        mo.x[vi] = bx;
        mo.y[vi] = by;
      }
      mo.alive[vi] = 1;
      mo.size[vi] = b.size[j];
    }
    mo.count = moteAlive.end(mo.alive);
  }

  function playerObj(id: number): PlayerView {
    let o = playerObjs.get(id);
    if (!o) {
      o = createPlayerView(id);
      playerObjs.set(id, o);
    }
    return o;
  }

  function writeRemotePlayer(o: PlayerView, a: PlayerRecord | null, b: PlayerRecord, A: Snapshot, B: Snapshot, extrap: boolean, t: number, renderSec: number): void {
    let axp = b.x;
    let ayp = b.y;
    if (a && Math.hypot(b.x - a.x, b.y - a.y) <= PLAYER_TELEPORT_DIST) {
      axp = a.x;
      ayp = a.y;
    }
    if (extrap) {
      const e = MAX_EXTRAPOLATION_TICKS * SIM_DT;
      o.prevX = b.x;
      o.prevY = b.y;
      o.x = b.dead ? b.x : b.x + b.vx * e;
      o.y = b.dead ? b.y : b.y + b.vy * e;
    } else {
      o.prevX = axp;
      o.prevY = ayp;
      o.x = b.x;
      o.y = b.y;
    }
    o.id = b.id;
    o.name = b.name;
    o.level = b.level;
    o.vx = b.vx;
    o.vy = b.vy;
    o.facing = b.facing;
    o.aimX = b.aimX;
    o.aimY = b.aimY;
    const tA = A.tick * SIM_DT;
    const startB = B.tick * SIM_DT - b.animTime;
    if (a && renderSec < startB) {
      // B's anim had not started yet at the render time: A's anim (and cast) continue.
      o.anim = a.anim;
      o.animTime = a.animTime + Math.max(0, renderSec - tA);
      o.facing = a.facing;
      o.castSkill = a.castSkill;
      o.castProgress = a.castProgress;
    } else {
      o.anim = b.anim;
      o.animTime = Math.max(0, renderSec - startB);
      o.castSkill = b.castSkill;
      // The same cast in both snapshots: the bar fills smoothly between them.
      const sameCast = a !== null && b.castSkill !== null && a.castSkill === b.castSkill && b.castProgress >= a.castProgress;
      o.castProgress = sameCast ? a.castProgress + (b.castProgress - a.castProgress) * t : b.castProgress;
    }
    o.life = b.life;
    o.maxLife = b.maxLife;
    o.focus = 0;
    o.maxFocus = 0;
    o.wardTime = b.wardTime;
    o.wardDuration = b.wardDuration;
    o.invulnTime = b.invulnTime;
    o.hitFlash = a ? flashAt(a.hitFlash, b.hitFlash, t) : b.hitFlash;
    o.dead = b.dead;
  }

  function writeLocalPlayer(o: PlayerView, n: PlayerRecord, now: number, dtSec: number, liveElapsed: number): void {
    o.id = n.id;
    o.name = n.name;
    o.level = n.level;
    o.life = n.life;
    o.maxLife = n.maxLife;
    o.focus = n.focus;
    o.maxFocus = n.maxFocus;
    o.dead = n.dead;
    o.castSkill = n.castSkill;
    // Cast bar on the live clock: progress keeps filling between snapshots once the cast time is known.
    const castTotal = n.castSkill !== null ? predictor.castTimeOf(n.castSkill) : 0;
    o.castProgress = castTotal > 0 ? Math.min(0.999, n.castProgress + liveElapsed / castTotal) : n.castProgress;
    o.wardDuration = n.wardDuration;
    o.wardTime = Math.max(0, n.wardTime - liveElapsed);
    o.invulnTime = Math.max(0, n.invulnTime - liveElapsed);
    o.hitFlash = Math.max(0, n.hitFlash - liveElapsed * PLAYER_HIT_FLASH_DECAY);
    for (let s = 0; s < o.slots.length; s++) {
      const src = n.slots[s];
      const dst = o.slots[s];
      dst.skillId = src.skillId;
      dst.cooldown = Math.max(0, src.cooldown - liveElapsed);
      dst.cooldownTotal = src.cooldownTotal;
      dst.charges = src.charges;
      dst.maxCharges = src.maxCharges;
      dst.focusCost = src.focusCost;
      dst.usable = src.usable;
    }
    for (let f = 0; f < o.flasks.length; f++) {
      const src = n.flasks[f];
      if (!src) {
        o.flasks[f] = null;
        continue;
      }
      let dst = o.flasks[f];
      if (!dst) {
        dst = { flaskId: src.flaskId, count: 0, resource: src.resource, active: 0, duration: 0 };
        o.flasks[f] = dst;
      }
      dst.flaskId = src.flaskId;
      dst.count = src.count;
      dst.resource = src.resource;
      dst.active = Math.max(0, src.active - liveElapsed);
      dst.duration = src.duration;
    }

    // Position: predicted (present time), identical in prev and current so alpha does not move it.
    const predicted = predictor.hasBase && !n.dead;
    if (predictor.hasBase) predictor.frame(now, renderPos);
    else {
      renderPos.x = n.x;
      renderPos.y = n.y;
    }
    o.x = o.prevX = renderPos.x;
    o.y = o.prevY = renderPos.y;

    const moving = predicted && predictor.moving;
    if (predicted && predictor.hasInput) {
      const dir = predictor.inputDirection();
      const speed = predictor.moveSpeed * (1 - predictor.slow);
      o.vx = dir.x * speed;
      o.vy = dir.y * speed;
      o.aimX = predictor.inputAimX;
      o.aimY = predictor.inputAimY;
    } else {
      o.vx = n.vx;
      o.vy = n.vy;
      o.aimX = n.aimX;
      o.aimY = n.aimY;
    }

    // Locomotion is predicted; actions (cast, dash, hit, death) are the server's.
    const serverAnim = n.anim;
    let anim: PlayerAnim;
    let animTime: number;
    if (!n.dead && (serverAnim === 'idle' || serverAnim === 'run')) {
      anim = moving ? 'run' : 'idle';
      animTime = anim === localAnim ? localAnimTime + dtSec : 0;
    } else {
      anim = serverAnim;
      animTime = n.animTime + liveElapsed;
    }
    localAnim = anim;
    localAnimTime = animTime;
    o.anim = anim;
    o.animTime = animTime;

    let facing = localFacing;
    if (n.dead) facing = n.facing;
    else if (n.castSkill !== null || anim === 'dash') facing = dirFromVector(o.aimX - o.x, o.aimY - o.y, facing);
    else if (moving) facing = dirFromVector(o.vx, o.vy, facing);
    else if (!predictor.hasInput) facing = n.facing;
    localFacing = facing;
    o.facing = facing;
  }

  /** Writes every player; returns true when the local player was written (her render position is valid). */
  function writePlayers(A: Snapshot, B: Snapshot, N: Snapshot, extrap: boolean, t: number, renderSec: number, now: number, dtSec: number, liveElapsed: number): boolean {
    players.length = 0;
    seenIds.clear();
    const me = N.player(localPlayerId);
    const list = B.players;
    for (let k = 0; k < B.playerCount; k++) {
      const b = list[k];
      if (b.id === localPlayerId) {
        if (!me || seenIds.has(b.id)) continue;
        const o = playerObj(b.id);
        writeLocalPlayer(o, me, now, dtSec, liveElapsed);
        players.push(o);
        seenIds.add(b.id);
        continue;
      }
      if (seenIds.has(b.id)) continue;
      const o = playerObj(b.id);
      writeRemotePlayer(o, A !== B ? A.player(b.id) : null, b, A, B, extrap, t, renderSec);
      players.push(o);
      seenIds.add(b.id);
    }
    if (me && !seenIds.has(me.id)) {
      // Joined after the render bracket: the local player is shown as soon as the newest snapshot has her.
      const o = playerObj(me.id);
      writeLocalPlayer(o, me, now, dtSec, liveElapsed);
      players.push(o);
      seenIds.add(me.id);
    }
    for (const id of playerObjs.keys()) if (!seenIds.has(id)) playerObjs.delete(id);
    return me !== null;
  }

  /**
   * Drops appear on the render timeline (the arc leaves the corpse as it dies) but disappear on the live timeline:
   * once the newest snapshot no longer has a drop (picked up, removed) it is gone at once. `blocked` is live too.
   */
  function writeDrops(A: Snapshot, B: Snapshot, N: Snapshot, extrap: boolean, alpha: number, renderSec: number): void {
    drops.length = 0;
    seenIds.clear();
    if (liveDropsSerial !== N.serial) {
      liveDrops.clear();
      for (let k = 0; k < N.dropCount; k++) liveDrops.set(N.drops[k].id, N.drops[k]);
      liveDropsSerial = N.serial;
    }
    const tB = B.tick * SIM_DT;
    const aList = A.drops;
    const list = B.drops;
    for (let k = 0; k < B.dropCount; k++) {
      const b = list[k];
      if (seenIds.has(b.id)) continue;
      const live = liveDrops.get(b.id);
      if (!live) continue;
      let a: DropView | null = null;
      if (A !== B) {
        for (let q = 0; q < A.dropCount; q++) {
          if (aList[q].id === b.id) {
            a = aList[q];
            break;
          }
        }
      }
      let o = dropObjs.get(b.id);
      if (!o) {
        o = createDropView();
        dropObjs.set(b.id, o);
      }
      o.id = b.id;
      const spec = o.spec;
      spec.token = b.spec.token;
      spec.owner = b.spec.owner;
      spec.autoPickup = b.spec.autoPickup;
      spec.label = b.spec.label;
      spec.tone = b.spec.tone;
      spec.sprite = b.spec.sprite;
      spec.iconId = b.spec.iconId;
      o.blocked = live.blocked;
      if (extrap || !a) {
        o.prevX = o.x = b.x;
        o.prevY = o.y = b.y;
        o.z = b.z;
      } else {
        o.prevX = a.x;
        o.prevY = a.y;
        o.x = b.x;
        o.y = b.y;
        o.z = a.z + (b.z - a.z) * alpha;
      }
      const age = b.age + (renderSec - tB);
      o.age = age > 0 ? age : 0;
      drops.push(o);
      seenIds.add(b.id);
    }
    for (const id of dropObjs.keys()) if (!seenIds.has(id)) dropObjs.delete(id);
  }

  function writeAreas(N: Snapshot, liveElapsed: number): void {
    areas.length = 0;
    seenIds.clear();
    const list = N.areas;
    for (let k = 0; k < N.areaCount; k++) {
      const src = list[k];
      if (seenIds.has(src.id)) continue;
      let o = areaObjs.get(src.id);
      if (!o) {
        o = { id: src.id, kind: src.kind, x: 0, y: 0, radius: 0, age: 0, duration: 0 };
        areaObjs.set(src.id, o);
      }
      o.id = src.id;
      o.kind = src.kind;
      o.x = src.x;
      o.y = src.y;
      o.radius = src.radius;
      o.duration = src.duration;
      const age = src.age + liveElapsed;
      o.age = src.duration > 0 && age > src.duration ? src.duration : age;
      areas.push(o);
      seenIds.add(src.id);
    }
    for (const id of areaObjs.keys()) if (!seenIds.has(id)) areaObjs.delete(id);
  }

  function update(now: number): number {
    const dtMs = Number.isNaN(lastNow) ? 0 : Math.min(Math.max(now - lastNow, 0), 250);
    lastNow = now;
    const N = newest();
    stats.pendingInputs = predictor.pendingCount;
    stats.bufferedSnapshots = ordered.length;
    stats.moveSpeed = predictor.moveSpeed;
    if (!N) return 0;

    renderTick = clock.advance(now);
    if (renderTick > N.tick + MAX_EXTRAPOLATION_TICKS) {
      // Starved past the extrapolation budget: the render clock waits here instead of running ahead of the data,
      // so the late burst is caught up with a time warp rather than a one-frame teleport of everything.
      clock.holdAt(N.tick + MAX_EXTRAPOLATION_TICKS);
      renderTick = clock.renderTick;
      stats.holds++;
    }
    stats.interpDelayMs = clock.delayMs();
    stats.jitterMs = clock.jitterMs;
    stats.lateMs = clock.lastLateMs;
    stats.drift = clock.drift;
    stats.rebases = clock.rebases;
    stats.corrections = predictor.corrections;
    stats.snaps = predictor.snaps;
    stats.lastCorrection = predictor.lastError;

    // Bracket the render tick.
    let A: Snapshot;
    let B: Snapshot;
    let alpha: number;
    let extrap = false;
    let renderT: number;
    const len = ordered.length;
    if (renderTick >= N.tick) {
      B = N;
      A = len > 1 ? ordered[len - 2] : N;
      const e = Math.min(renderTick - N.tick, MAX_EXTRAPOLATION_TICKS);
      extrap = A !== B && e > 0;
      alpha = extrap ? e / MAX_EXTRAPOLATION_TICKS : 1;
      renderT = N.tick + e;
    } else if (renderTick <= ordered[0].tick) {
      A = B = ordered[0];
      alpha = 1;
      renderT = ordered[0].tick;
    } else {
      let k = len - 2;
      while (k > 0 && ordered[k].tick > renderTick) k--;
      A = ordered[k];
      B = ordered[k + 1];
      alpha = (renderTick - A.tick) / (B.tick - A.tick);
      renderT = renderTick;
    }
    stats.extrapolating = extrap;
    const renderSec = renderT * SIM_DT;
    const liveElapsed = Math.min(Math.max((clock.liveTick(now) - N.tick) * SIM_DT, 0), 0.25);

    view.tick = Math.floor(renderT);
    view.time = renderSec;
    if (propsSerial !== N.serial) {
      rebuildProps(N);
      propsSerial = N.serial;
    }
    // Interpolation fraction between A and B for scalar fields (B's values while extrapolating).
    const t = extrap ? 1 : alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    // Players first: the local player's on-screen position anchors her own bolts' launch offset.
    const localSeen = writePlayers(A, B, N, extrap, t, renderSec, now, dtMs / 1000, liveElapsed);
    writeMonsters(A, B, extrap, t, renderSec);
    writeProjectiles(A, B, extrap, t, renderSec, localSeen);
    writeMotes(A, B, extrap);
    writeDrops(A, B, N, extrap, alpha, renderSec);
    writeAreas(N, liveElapsed);
    copyRun(N.run, run, runBoss, runLieutenant);
    return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  }

  function setZone(zone: ZoneInfo): void {
    localPlayerId = zone.localPlayerId;
    view.theme = zone.theme;
    view.arenaRadius = zone.arenaRadius;
    env.arenaRadius = zone.arenaRadius;
    zoneProps = zone.props.map((p) => ({ ...p }));
    propObjs.clear();
    clearBuffers();
  }

  function predict(input: InputMessage): void {
    predictor.addInput(input, env);
  }

  return {
    view,
    get localPlayerId() {
      return localPlayerId;
    },
    get latestTick() {
      const N = newest();
      return N ? N.tick : 0;
    },
    get renderTick() {
      return renderTick;
    },
    get interpDelayMs() {
      return clock.delayMs();
    },
    get rtt() {
      return rtt;
    },
    liveTick(now: number): number {
      return clock.hasSamples ? clock.liveTick(now) : 0;
    },
    setZone,
    pushSnapshot,
    predict,
    update,
    setRtt(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) rtt = ms;
    },
    stats() {
      return stats;
    },
    predictedPosition() {
      if (!predictor.hasBase) return null;
      predictedOut.x = predictor.x;
      predictedOut.y = predictor.y;
      return predictedOut;
    },
    setPredictionHints(hints: PredictionHints) {
      predictor.setHints(hints);
    },
  };
}
