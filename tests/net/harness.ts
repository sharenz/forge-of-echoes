// Deterministic client/server network harness for ClientWorld tests.
// A tiny authoritative "server" moves one viewer with the shared sim movePlayer (inputs through the game server's
// createInputQueue: one per tick, bursts coalesced, repeats when starved and paid back later), casts timed skills with the sim's rules (held slots start as soon as
// free, back-to-back with the overshoot carried), steps scripted monsters, and sends encoded snapshots (plus the
// tick's cosmetic events) every SNAPSHOT_EVERY ticks through a fake network with latency, jitter, loss, reordering
// and TCP-style stalls. Player debuffs follow the sim's rules (src/sim/debuffs.ts, movement.ts): the ward ticks first,
// casting progresses at 0 (frozen) / 0.7 (chilled) × SIM_DT, the move uses playerSlow(cast, debuff, ground) with
// Rooted/Frozen holding her, Chilled at `chillSlow` (the sim's 0.3) and a 'tarPool' at her feet at `tarSlow` (0.5),
// and only then do the debuff timers run down (twice as fast under Cinder Ward). A chain hook's drag (pull()) replaces
// her movement exactly like the sim's pullPlayer / updatePlayer (lerp over PULL_TIME, resolvePlayerAt, vx = vy = 0)
// and emits her 'pull' event; the client gets every batch through noteEvents (after the snapshot of its tick, like the
// game server sends them) unless `noteEvents` is off.
import type { SkillId } from '../../src/contracts/content';
import type { InputMessage } from '../../src/contracts/net';
import { SNAPSHOT_EVERY } from '../../src/contracts/net';
import { SIM_DT } from '../../src/contracts/sim';
import type { PlayerAnim, PlayerDebuffView, PropView, RootSource, SimEvent, WorldView } from '../../src/contracts/sim';
import type { PlayerDebuff } from '../../src/contracts/bestiary';
import { createClientWorld, createEventTimeline, createInputQueue, createSnapshotEncoder, heldToMask, moveVector } from '../../src/net';
import type { EventTimeline, InputQueue, NetClientWorld } from '../../src/net';
import { CAST_SLOW, PLAYER_CHILL_SLOW, movePlayer, playerSlow, resolvePlayerAt } from '../../src/sim/movement';
import { PLAYER_RADIUS, PULL_TIME } from '../../src/sim/constants';
import { makePlayer, makeView, makeZone, setTick } from './fixtures';

export const TICK = 1000 / 60;

export interface HarnessOptions {
  latencyMs?: number;
  jitterMs?: number;
  /** Probability that a snapshot is delivered after the next one. */
  reorder?: number;
  /** Probability that a snapshot is lost. */
  loss?: number;
  moveSpeed?: number;
  props?: PropView[];
  arenaRadius?: number;
  seed?: number;
  frameMs?: number;
  /** Phase of the client's input ticks relative to server ticks (ms). */
  inputPhaseMs?: number;
  startX?: number;
  startY?: number;
  /** Server tick rate (Hz) — 60 unless testing clock drift. */
  serverHz?: number;
  /** Downlink stalls: snapshots due inside [at, at + ms) arrive together at at + ms (TCP head-of-line blocking). */
  stalls?: { at: number; ms: number }[];
  /** Timed skills in loadout slots (slot ≥ 1): the server casts them like the sim while their slot is held. */
  skills?: { slot: number; skill: SkillId; castTime: number }[];
  /** Server-side Chilled move slow (the sim's PLAYER_CHILL_SLOW unless testing a sim that deviates). */
  chillSlow?: number;
  /** Server-side tar pool slow (the sim's 0.5 unless testing a deviating sim). */
  tarSlow?: number;
  /** Feed each events batch to ClientWorld.noteEvents (default true). */
  noteEvents?: boolean;
  /** Deliver each events batch before its snapshot instead of right after it (robustness). */
  eventsFirst?: boolean;
}

export interface HarnessInput {
  moveX: number;
  moveY: number;
  held?: number;
}

export interface ServerHooks {
  /** Called before the player moves (state that affects this tick's movement, e.g. casting). */
  beforeMove?(h: NetHarness, tick: number): void;
  /** Called after the player moved, before her anim/view are finalised (monsters, shoves, blinks, death…). */
  tick?(h: NetHarness, tick: number): void;
}

export class NetHarness {
  readonly view: WorldView;
  readonly client: NetClientWorld;
  readonly player;
  readonly opts: Required<Omit<HarnessOptions, 'props' | 'stalls' | 'skills'>> & {
    props: PropView[];
    stalls: { at: number; ms: number }[];
    skills: { slot: number; skill: SkillId; castTime: number }[];
  };
  readonly timeline: EventTimeline = createEventTimeline();
  /** Events drained on the latest frame. */
  lastEvents: SimEvent[] = [];
  /** Events queued by hooks for the next snapshot. */
  pendingEvents: SimEvent[] = [];
  /** Server cast in progress (the sim's p.cast). */
  cast: { slot: number; time: number; total: number } | null = null;
  now = 0;
  serverTick = 0;
  seq = 0;
  ackSeq = 0;
  castSlow = false;
  /** The sim's drag state (player.ts pullTime / pullTotal / from / to). */
  pullState: { fromX: number; fromY: number; toX: number; toY: number; total: number; time: number } | null = null;
  playerAnim: PlayerAnim = 'idle';
  playerAnimTime = 0;
  /** Server position right after applying input `seq`. */
  readonly serverAt = new Map<number, { x: number; y: number }>();
  /** Client's raw prediction right after predicting input `seq`. */
  readonly predictedAt = new Map<number, { x: number; y: number }>();
  /** Server ticks on which the queue was empty and the last intent repeated while moving. */
  repeats = 0;
  lastAlpha = 0;
  private readonly encoder = createSnapshotEncoder();
  readonly inputQueue: InputQueue = createInputQueue();
  private readonly intent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [] as boolean[], flask: -1 };
  private readonly toServer: { at: number; input: InputMessage }[] = [];
  private readonly toClient: { at: number; order: number; buf: ArrayBuffer; tick: number; events: SimEvent[] }[] = [];
  private currentMove = { moveX: 0, moveY: 0 };
  private currentHeld = 0;
  private readonly tickMs: number;
  private rngState: number;
  private nextServerTickAt = TICK;
  private nextInputAt: number;
  private nextFrameAt = 0;
  private order = 0;
  private hooks: ServerHooks;

  constructor(opts: HarnessOptions = {}, hooks: ServerHooks = {}) {
    this.opts = {
      latencyMs: opts.latencyMs ?? 40,
      jitterMs: opts.jitterMs ?? 0,
      reorder: opts.reorder ?? 0,
      loss: opts.loss ?? 0,
      moveSpeed: opts.moveSpeed ?? 137,
      props: opts.props ?? [],
      arenaRadius: opts.arenaRadius ?? 900,
      seed: opts.seed ?? 1,
      frameMs: opts.frameMs ?? 1000 / 144,
      // Off the server tick grid for the default latencies, so arrivals never straddle a tick boundary.
      inputPhaseMs: opts.inputPhaseMs ?? 3,
      startX: opts.startX ?? 0,
      startY: opts.startY ?? 0,
      serverHz: opts.serverHz ?? 60,
      stalls: opts.stalls ?? [],
      skills: opts.skills ?? [],
      chillSlow: opts.chillSlow ?? PLAYER_CHILL_SLOW,
      tarSlow: opts.tarSlow ?? 0.5,
      noteEvents: opts.noteEvents ?? true,
      eventsFirst: opts.eventsFirst ?? false,
    };
    this.tickMs = 1000 / this.opts.serverHz;
    this.nextServerTickAt = this.tickMs;
    this.hooks = hooks;
    this.rngState = this.opts.seed >>> 0 || 1;
    this.nextInputAt = this.opts.inputPhaseMs;
    this.view = makeView({ arenaRadius: this.opts.arenaRadius, props: this.opts.props });
    this.player = makePlayer(1, { x: this.opts.startX, y: this.opts.startY });
    this.player.slots[0].skillId = 'emberLance';
    for (const sk of this.opts.skills) {
      Object.assign(this.player.slots[sk.slot], { skillId: sk.skill, charges: 1, maxCharges: 1, cooldown: 0, cooldownTotal: 0, focusCost: 0, usable: true });
    }
    this.view.players.push(this.player);
    this.client = createClientWorld();
    this.client.setZone(makeZone({ localPlayerId: 1, arenaRadius: this.opts.arenaRadius, props: this.opts.props }));
    this.timeline.setLocalPlayer(1);
  }

  /** Apply (or refresh, keeping the longer remaining time) a debuff on the player, like the sim would. */
  applyDebuff(id: PlayerDebuff, seconds: number, opts: { stacks?: number; source?: RootSource | null } = {}): void {
    const list = this.player.debuffs;
    let d = list.find((x) => x.id === id);
    if (!d) {
      d = { id, remaining: 0, duration: 0, stacks: 1, source: null };
      list.push(d);
    }
    d.remaining = Math.max(d.remaining, seconds);
    d.duration = Math.max(d.remaining, seconds);
    d.stacks = opts.stacks ?? d.stacks;
    d.source = id === 'rooted' ? opts.source ?? 'bone' : null;
  }

  /**
   * The sim's pullPlayer: drag her up to `distance` toward (towardX, towardY) over PULL_TIME (stopping 2 body radii
   * short), rooted by 'chain' unless `rooted` is false (the sim's root grace), and emit her 'pull'. Call it from a
   * `tick` hook (after her move, like a projectile hit).
   */
  pull(towardX: number, towardY: number, distance: number, rooted = true): void {
    const p = this.player;
    const dx = towardX - p.x;
    const dy = towardY - p.y;
    const d = Math.hypot(dx, dy);
    const dist = Math.min(Math.max(0, distance), Math.max(0, d - 2 * PLAYER_RADIUS));
    const fromX = p.x;
    const fromY = p.y;
    const toX = d > 1e-6 ? fromX + (dx / d) * dist : fromX;
    const toY = d > 1e-6 ? fromY + (dy / d) * dist : fromY;
    if (rooted) this.applyDebuff('rooted', 1.4, { source: 'chain' });
    if (dist <= 0) return;
    const total = Math.max(SIM_DT, PULL_TIME);
    this.pullState = { fromX, fromY, toX, toY, total, time: total };
    this.pendingEvents.push({ t: 'pull', playerId: p.id, fromX, fromY, toX, toY });
  }

  has(id: PlayerDebuff): boolean {
    return this.player.debuffs.some((d) => d.id === id);
  }

  /** After the move: debuff timers run down (twice as fast under the ward); spent ones are removed. */
  private tickDebuffs(): void {
    const list: PlayerDebuffView[] = this.player.debuffs;
    const step = SIM_DT * (this.player.wardTime > 0 ? 2 : 1);
    for (const d of list) d.remaining -= step;
    for (let k = list.length - 1; k >= 0; k--) if (!(list[k].remaining > 0)) list.splice(k, 1);
  }

  /** The ward's own timer runs first in a tick (the sim's tickWard). */
  private tickWard(): void {
    const p = this.player;
    if (p.wardTime <= 0) return;
    p.wardTime -= SIM_DT;
    if (p.wardTime <= 0) p.wardTime = 0;
  }

  /** Debuff part of the movement slow. */
  private debuffSlow(): number {
    if (this.has('rooted') || this.has('frozen')) return 1;
    return this.has('chilled') ? this.opts.chillSlow : 0;
  }

  /** Ground slow at the player's feet before the step. */
  private groundSlow(): number {
    const p = this.player;
    for (const a of this.view.areas) {
      if (a.kind === 'tarPool' && (p.x - a.x) ** 2 + (p.y - a.y) ** 2 <= a.radius * a.radius) return this.opts.tarSlow;
    }
    return 0;
  }

  /** The sim's updateCasting for timed actives: advance/release the running cast, then start a held one. */
  private updateCasting(): void {
    if (this.has('frozen')) return; // frozen: no casting at all (a running cast holds)
    let carry = 0;
    if (this.cast) {
      this.cast.time += SIM_DT * (this.has('chilled') ? 1 - PLAYER_CHILL_SLOW : 1);
      if (this.cast.time >= this.cast.total) {
        carry = Math.min(SIM_DT, this.cast.time - this.cast.total);
        this.cast = null;
      }
    }
    if (!this.cast) {
      for (const sk of [...this.opts.skills].sort((a, b) => a.slot - b.slot)) {
        if (this.currentHeld & (1 << sk.slot)) {
          this.cast = { slot: sk.slot, time: carry, total: sk.castTime };
          break;
        }
      }
    }
    const p = this.player;
    const sk = this.cast ? this.opts.skills.find((k) => k.slot === this.cast!.slot)! : null;
    p.castSkill = sk ? sk.skill : null;
    p.castProgress = this.cast ? Math.min(1, Math.max(0, this.cast.time / this.cast.total)) : 0;
    if (this.opts.skills.length > 0) this.castSlow = this.cast !== null;
  }

  random(): number {
    // xorshift32: deterministic network conditions.
    let x = this.rngState;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.rngState = x;
    return x / 4294967296;
  }

  private serverStep(): void {
    this.serverTick++;
    while (this.toServer.length > 0 && this.toServer[0].at <= this.now) this.inputQueue.push(this.toServer.shift()!.input);
    const intent = this.inputQueue.next(this.intent);
    this.currentMove = { moveX: intent.moveX, moveY: intent.moveY };
    this.currentHeld = heldToMask(intent.held);
    let consumed = -1;
    if (this.inputQueue.starved === 0) {
      this.ackSeq = this.inputQueue.ackSeq;
      consumed = this.ackSeq;
    } else if (moveVector(this.currentMove).len > 0.05) this.repeats++;
    const p = this.player;
    if (p.dead) p.debuffs.length = 0;
    if (!p.dead) {
      this.tickWard();
      this.updateCasting();
    }
    this.hooks.beforeMove?.(this, this.serverTick);
    let moving = false;
    if (p.dead) {
      p.vx = 0;
      p.vy = 0;
      this.pullState = null;
    } else if (this.pullState && this.pullState.time > 0) {
      // The sim's drag (player.ts updatePlayer): it replaces her own movement while it lasts.
      const pull = this.pullState;
      pull.time = Math.max(0, pull.time - SIM_DT);
      const u = pull.total > 0 ? 1 - pull.time / pull.total : 1;
      const o = resolvePlayerAt(pull.fromX + (pull.toX - pull.fromX) * u, pull.fromY + (pull.toY - pull.fromY) * u, this.opts.arenaRadius, this.opts.props);
      p.x = o.x;
      p.y = o.y;
      p.vx = 0;
      p.vy = 0;
      this.tickDebuffs();
    } else {
      const castSlow = this.castSlow ? CAST_SLOW : 0;
      const slow = playerSlow(castSlow, this.debuffSlow(), this.groundSlow());
      const next = movePlayer({ x: p.x, y: p.y }, this.currentMove, {
        speed: this.opts.moveSpeed, arenaRadius: this.opts.arenaRadius, props: this.opts.props, slow,
      }, SIM_DT);
      p.x = next.x;
      p.y = next.y;
      const dir = moveVector(this.currentMove);
      const speed = this.opts.moveSpeed * (1 - slow);
      p.vx = dir.x * speed;
      p.vy = dir.y * speed;
      moving = dir.len > 0.05 && speed > 0;
      this.tickDebuffs();
    }
    this.hooks.tick?.(this, this.serverTick);
    const anim: PlayerAnim = p.dead ? 'death' : this.playerAnim === 'dash' || this.playerAnim === 'hit' ? this.playerAnim : this.cast ? 'cast' : moving ? 'run' : 'idle';
    // Frozen: the sim holds her pose, facing and animation clock.
    const held = !p.dead && this.has('frozen');
    if (!held) {
      if (anim !== p.anim) {
        p.anim = anim;
        p.animTime = 0;
      } else p.animTime += SIM_DT;
      if (moving) p.facing = Math.abs(p.vx) >= Math.abs(p.vy) ? (p.vx >= 0 ? 'east' : 'west') : p.vy >= 0 ? 'south' : 'north';
    }
    if (consumed >= 0) this.serverAt.set(consumed, { x: p.x, y: p.y });
    setTick(this.view, this.serverTick);
    if (this.serverTick % SNAPSHOT_EVERY === 0) {
      const buf = this.encoder.encode(this.view, 1, this.ackSeq);
      const events = this.pendingEvents;
      this.pendingEvents = [];
      if (this.opts.loss > 0 && this.random() < this.opts.loss) return;
      let at = this.now + this.opts.latencyMs + this.random() * this.opts.jitterMs;
      if (this.opts.reorder > 0 && this.random() < this.opts.reorder) at += 40;
      for (const st of this.opts.stalls) if (at >= st.at && at < st.at + st.ms) at = st.at + st.ms;
      this.toClient.push({ at, order: this.order++, buf, tick: this.serverTick, events });
    }
  }

  private inputStep(move: (seq: number) => HarnessInput): void {
    const seq = ++this.seq;
    const m = move(seq);
    const input: InputMessage = { t: 'input', seq, moveX: m.moveX, moveY: m.moveY, aimX: this.player.x + 50, aimY: this.player.y, held: m.held ?? 0, flask: -1 };
    // Inputs travel over an ordered stream (TCP): jitter never reorders them.
    const last = this.toServer.length ? this.toServer[this.toServer.length - 1].at : 0;
    const at = Math.max(last, this.now + this.opts.latencyMs + this.random() * this.opts.jitterMs);
    this.toServer.push({ at, input });
    this.client.predict(input);
    const pp = this.client.predictedPosition();
    if (pp) this.predictedAt.set(seq, { x: pp.x, y: pp.y });
  }

  private frame(onFrame?: (h: NetHarness) => void): void {
    // Deliver arrived snapshots (in arrival order).
    this.toClient.sort((a, b) => a.at - b.at || a.order - b.order);
    while (this.toClient.length && this.toClient[0].at <= this.now) {
      const msg = this.toClient.shift()!;
      const note = this.opts.noteEvents && msg.events.length > 0;
      if (note && this.opts.eventsFirst) this.client.noteEvents(msg.tick, msg.events);
      this.client.pushSnapshot(msg.buf, this.now);
      if (note && !this.opts.eventsFirst) this.client.noteEvents(msg.tick, msg.events);
      this.timeline.push(msg.tick, msg.events);
    }
    this.lastAlpha = this.client.update(this.now);
    this.lastEvents = this.timeline.drain(this.client.renderTick);
    onFrame?.(this);
  }

  /** Run for `ms` of simulated time. */
  run(ms: number, move: (seq: number) => HarnessInput = () => ({ moveX: 0, moveY: 0 }), onFrame?: (h: NetHarness) => void, opts: { sendInputs?: boolean } = {}): void {
    const end = this.now + ms;
    const sendInputs = opts.sendInputs ?? true;
    while (this.now < end) {
      const next = Math.min(this.nextServerTickAt, this.nextInputAt, this.nextFrameAt, end);
      this.now = next;
      if (this.now >= this.nextServerTickAt) {
        this.serverStep();
        this.nextServerTickAt += this.tickMs;
      }
      if (this.now >= this.nextInputAt) {
        if (sendInputs) this.inputStep(move);
        this.nextInputAt += TICK;
      }
      if (this.now >= this.nextFrameAt) {
        this.frame(onFrame);
        this.nextFrameAt += this.opts.frameMs;
      }
      if (next === end) break;
    }
  }

  /** The local player's on-screen position (alpha applied like the presenter does). */
  localRender(): { x: number; y: number } | null {
    const p = this.client.view.players.find((q) => q.id === 1);
    if (!p) return null;
    return { x: p.prevX + (p.x - p.prevX) * this.lastAlpha, y: p.prevY + (p.y - p.prevY) * this.lastAlpha };
  }
}
