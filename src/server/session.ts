// A player session: one online character, its (current) connection, its place in an instance, its input
// queue, rate limits and the debounced pushes of its CharacterSave. A session outlives a dropped socket for
// a short reconnect grace, so a network blip doesn't pull the character out of a map (and delete its loot).
import { LOADOUT_SLOTS } from '../contracts/items';
import type { ServerMessage } from '../contracts/net';
import type { PlayerIntent } from '../contracts/sim';
import { redactForClient } from '../game';
import { createInputQueue, encodeMessage } from '../net';
import type { InputQueue } from '../net';
import type { CharacterRecord } from './characters';
import type { Connection } from './connection';
import { EventOutbox } from './event-filter';
import type { Instance } from './instance';
import { TokenBucket } from './rate-limit';

/** Minimum gap between two 'character' pushes (≤ 5 Hz). */
export const CHARACTER_PUSH_MIN_MS = 200;
/** XP-only changes (a stream during map runs) are pushed at most this often. */
export const CHARACTER_PUSH_LAZY_MS = 1000;
/** Window for the invalid / rate-dropped message counters. */
export const ABUSE_WINDOW_MS = 60_000;
/**
 * Above this much unsent data (≈ 2–3 busy snapshots with their events, or one fresh zone + character
 * push) the viewer's snapshots are skipped until the socket drains: on a congested link, choppy but
 * current frames beat a stream that falls seconds behind. A healthy socket sits at 0 between snapshots.
 */
export const SNAPSHOT_BACKPRESSURE_BYTES = 32 * 1024;
/** Unsent data at this many consecutive snapshot times halves the viewer's snapshot rate (30 → 15 Hz). */
export const CONGESTION_STREAK = 2;
/** 'events' frames longer than this (loot fountains, boss deaths) are compressed; the rest go out as they are. */
export const EVENTS_COMPRESS_MIN_CHARS = 8 * 1024;

export type ToastTone = Extract<ServerMessage, { t: 'toast' }>['tone'];

export function idleIntent(out?: PlayerIntent): PlayerIntent {
  const intent = out ?? { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: new Array<boolean>(LOADOUT_SLOTS).fill(false), flask: -1 };
  intent.moveX = 0;
  intent.moveY = 0;
  intent.flask = -1;
  for (let k = 0; k < intent.held.length; k++) intent.held[k] = false;
  return intent;
}

/** Per-viewer link state for snapshot pacing (see Instance.sendSnapshots). */
export interface LinkState {
  /** Consecutive snapshot times at which the socket still had unsent data. */
  backlogStreak: number;
  /** Sending every second snapshot until the socket drains completely. */
  halfRate: boolean;
  /** Alternates while at half rate. */
  phase: number;
  /** Snapshots skipped because of backpressure (diagnostics). */
  skipped: number;
  /** Consecutive snapshot encode/send failures for this viewer. */
  failures: number;
}

export class PlayerSession {
  conn: Connection | null = null;
  /** Hash of the session token that authenticated the current connection (a logout kicks it). */
  tokenHash = '';
  instance: Instance | null = null;
  /** Sim player id inside `instance` (0 while in none). */
  playerId = 0;
  /** Wall ms when the socket dropped (0 while connected). */
  disconnectedAt = 0;
  input: InputQueue = createInputQueue();
  /** The one intent object the input queue writes into (repeats while starved). */
  readonly intent: PlayerIntent = idleIntent();
  readonly outbox = new EventOutbox();
  readonly link: LinkState = { backlogStreak: 0, halfRate: false, phase: 0, skipped: 0, failures: 0 };

  readonly messages: TokenBucket;
  readonly commands: TokenBucket;
  readonly chat: TokenBucket;
  /** Rejected (malformed) and rate-dropped messages in the current abuse window. */
  invalidMessages = 0;
  droppedMessages = 0;
  private abuseWindowStart = 0;
  lastBackpackFullToast = 0;
  /** The "items on the ground vanish" hint was shown this session. */
  groundHintShown = false;
  /** Wall ms of recent "instance crashed, sent home" events (loop protection). */
  crashMoves: number[] = [];

  private lastPush = 0;
  private pushDue = 0;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Encoded command results waiting for the pending 'character' push (see sendResult). */
  private heldResults: string[] = [];

  constructor(
    readonly record: CharacterRecord,
    private readonly now: () => number,
  ) {
    const t = now();
    // Inputs arrive at 60 Hz (sometimes in bursts after a stall); commands and chat are far rarer.
    this.messages = new TokenBucket(360, 180, t);
    this.commands = new TokenBucket(30, 15, t);
    this.chat = new TokenBucket(5, 1, t);
  }

  /**
   * Count one rejected ('invalid') or rate-limited ('dropped') message. Counters reset every ABUSE_WINDOW_MS,
   * so only a sustained flood — never an occasional hiccup over a long session — reaches the limits.
   */
  noteAbuse(kind: 'invalid' | 'dropped'): number {
    const t = this.now();
    if (t - this.abuseWindowStart > ABUSE_WINDOW_MS) {
      this.abuseWindowStart = t;
      this.invalidMessages = 0;
      this.droppedMessages = 0;
    }
    return kind === 'invalid' ? ++this.invalidMessages : ++this.droppedMessages;
  }

  resetAbuse(): void {
    this.invalidMessages = 0;
    this.droppedMessages = 0;
    this.abuseWindowStart = this.now();
  }

  get characterId(): string {
    return this.record.id;
  }

  get accountId(): string {
    return this.record.accountId;
  }

  get name(): string {
    return this.record.ch.name;
  }

  get online(): boolean {
    return this.conn !== null && this.conn.open;
  }

  send(msg: ServerMessage): void {
    if (this.conn) this.conn.sendText(encodeMessage(msg));
  }

  sendRaw(text: string): void {
    if (this.conn) this.conn.sendText(text);
  }

  toast(text: string, tone: ToastTone = 'info'): void {
    this.send({ t: 'toast', text, tone });
  }

  /**
   * Send a command's result. When the command changed the character (`changedState`) and its 'character'
   * push is still waiting for the ≤ 5 Hz slot, the result is held and sent right after that push — so a
   * client always has the new state by the time it learns the command succeeded (no items snapping back).
   */
  sendResult(msg: Extract<ServerMessage, { t: 'result' }>, changedState: boolean): void {
    if (changedState && this.pushTimer) this.heldResults.push(encodeMessage(msg));
    else this.send(msg);
  }

  /** A fresh input queue for a new connection or zone (seqs are per connection; old inputs are stale). */
  resetInput(newConnection: boolean): void {
    if (newConnection) {
      this.input = createInputQueue();
      // Results held for the previous socket mean nothing to the new one; its link starts fresh.
      this.heldResults = [];
      this.link.backlogStreak = 0;
      this.link.halfRate = false;
      this.link.failures = 0;
    } else this.input.clear();
    idleIntent(this.intent);
    this.outbox.clear();
  }

  /**
   * Push the (redacted) CharacterSave. 'now' sends at once; 'soon' respects the ≤ 5 Hz cap (sending at once
   * when the last push is old enough); 'lazy' is for XP ticks and waits up to a second.
   */
  pushCharacter(when: 'now' | 'soon' | 'lazy'): void {
    const t = this.now();
    if (when === 'now' || (when === 'soon' && t - this.lastPush >= CHARACTER_PUSH_MIN_MS && !this.pushTimer)) {
      this.flushCharacter();
      return;
    }
    const due = when === 'soon' ? this.lastPush + CHARACTER_PUSH_MIN_MS : Math.max(this.lastPush + CHARACTER_PUSH_MIN_MS, t + CHARACTER_PUSH_LAZY_MS);
    if (this.pushTimer && this.pushDue <= due) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushDue = due;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.flushCharacter();
    }, Math.max(0, due - t));
    this.pushTimer.unref?.();
  }

  /** A 'character' push is scheduled (and command results may be waiting for it). */
  get pushPending(): boolean {
    return this.pushTimer !== null;
  }

  flushCharacter(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.pushDue = 0;
    this.lastPush = this.now();
    this.send({ t: 'character', character: redactForClient(this.record.ch) });
    if (this.heldResults.length > 0) {
      const held = this.heldResults;
      this.heldResults = [];
      for (const text of held) this.sendRaw(text);
    }
  }

  /** Stop timers (session ended). */
  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.heldResults = [];
    this.outbox.clear();
  }
}
