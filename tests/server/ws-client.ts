// A small protocol-speaking WebSocket client for server tests: JSON messages in a log, binary snapshots
// decoded (latest kept) and fed into a real src/net ClientWorld, commands with awaited results, a 60 Hz
// input loop with steering helpers, and close-code capture.
import WebSocket from 'ws';
import type { Command, InputMessage, ServerMessage, ZoneInfo } from '../../src/contracts/net';
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import type { PropKind, PropView } from '../../src/contracts/sim';
import { createClientWorld, decodeSnapshot } from '../../src/net';
import type { NetClientWorld, Snapshot } from '../../src/net';

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export interface ConnectOptions {
  version?: number | string;
  token?: string;
  character?: string;
}

export class TestClient {
  readonly log: ServerMessage[] = [];
  readonly world: NetClientWorld = createClientWorld();
  snapshot: Snapshot | null = null;
  snapshots = 0;
  zone: ZoneInfo | null = null;
  closed: { code: number; reason: string } | null = null;
  /** Errors the real ClientWorld raised on our snapshots (must stay empty). */
  readonly worldErrors: unknown[] = [];
  private seq = 0;
  private cmdId = 1;
  private waiters: (() => void)[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private steer: (() => Partial<InputMessage> | null) | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = data as ArrayBuffer;
        this.snapshot = decodeSnapshot(buf);
        this.snapshots++;
        try {
          this.world.pushSnapshot(buf, performance.now());
        } catch (err) {
          this.worldErrors.push(err);
        }
      } else {
        const msg = JSON.parse(String(data)) as ServerMessage;
        this.log.push(msg);
        if (msg.t === 'zone') {
          this.zone = msg.zone;
          this.snapshot = null;
          this.world.setZone(msg.zone);
        }
      }
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.stopInputs();
      this.wake();
    });
    ws.on('error', () => {});
  }

  static connect(base: string, opts: ConnectOptions): Promise<TestClient> {
    const q = new URLSearchParams();
    if (opts.token !== undefined) q.set('token', opts.token);
    if (opts.character !== undefined) q.set('character', opts.character);
    q.set('v', String(opts.version ?? PROTOCOL_VERSION));
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?${q.toString()}`);
    const client = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Resolve when `check` returns a value (checked on every incoming message), or reject after `timeout`. */
  until<T>(check: () => T | null | undefined | false, timeout = 5000, what = 'condition'): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeout);
      const test = () => {
        let v: T | null | undefined | false;
        try {
          v = check();
        } catch (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }
        if (v) {
          clearTimeout(timer);
          resolve(v);
        } else this.waiters.push(test);
      };
      test();
    });
  }

  /** Index into `log` (pass to waitFor to only see messages that arrive afterwards). */
  mark(): number {
    return this.log.length;
  }

  waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, from = 0, timeout = 5000): Promise<Msg<T>> {
    return this.until(() => {
      for (let k = from; k < this.log.length; k++) {
        const m = this.log[k];
        if (m.t === t && pred(m as Msg<T>)) return m as Msg<T>;
      }
      return null;
    }, timeout, `message '${t}'`);
  }

  all<T extends ServerMessage['t']>(t: T, from = 0): Msg<T>[] {
    return this.log.slice(from).filter((m) => m.t === t) as Msg<T>[];
  }

  last<T extends ServerMessage['t']>(t: T): Msg<T> | null {
    for (let k = this.log.length - 1; k >= 0; k--) if (this.log[k].t === t) return this.log[k] as Msg<T>;
    return null;
  }

  sendRaw(data: string | Buffer): void {
    this.ws.send(data);
  }

  async command(cmd: Command, timeout = 5000): Promise<Msg<'result'>> {
    const id = this.cmdId++;
    this.ws.send(JSON.stringify({ t: 'cmd', id, cmd }));
    return this.waitFor('result', (m) => m.id === id, 0, timeout);
  }

  input(partial: Partial<InputMessage> = {}): void {
    const msg: InputMessage = { t: 'input', seq: ++this.seq, moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: 0, flask: -1, ...partial };
    msg.seq = this.seq;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Send one input every ~16 ms from `fn` (null = idle input). */
  startInputs(fn: () => Partial<InputMessage> | null): void {
    this.steer = fn;
    if (this.loop) return;
    this.loop = setInterval(() => this.input(this.steer?.() ?? {}), 16);
  }

  stopInputs(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.steer = null;
  }

  /** The local player's authoritative record in the latest snapshot. */
  me() {
    return this.snapshot?.viewer() ?? null;
  }

  props(): PropView[] {
    const s = this.snapshot;
    if (!s) return this.zone?.props ?? [];
    return s.props.slice(0, s.propCount);
  }

  /** Steering input toward (x, y): analog, easing off near the target so it stops on the spot. */
  steerToward(x: number, y: number): Partial<InputMessage> {
    const me = this.me();
    if (!me) return {};
    const dx = x - me.x;
    const dy = y - me.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return { aimX: x, aimY: y };
    const k = Math.min(1, d / 40) / d;
    return { moveX: dx * k, moveY: dy * k, aimX: x, aimY: y };
  }

  /** Walk to (x, y) until within `within` units. */
  async walkTo(x: number, y: number, within = 4, timeout = 8000): Promise<void> {
    this.startInputs(() => this.steerToward(x, y));
    try {
      await this.until(() => {
        const me = this.me();
        return me && Math.hypot(me.x - x, me.y - y) <= within;
      }, timeout, `walking to ${Math.round(x)},${Math.round(y)}`);
    } finally {
      this.stopInputs();
    }
  }

  /** Walk into the first open prop of `kind` and stay there until a new zone arrives. */
  async walkInto(kind: PropKind, timeout = 10000): Promise<ZoneInfo> {
    const from = this.mark();
    const target = await this.until(() => this.props().find((p) => p.kind === kind && p.state > 0), 3000, `an open ${kind}`);
    const tx = target.x;
    const ty = target.y;
    this.startInputs(() => this.steerToward(tx, ty));
    try {
      const msg = await this.waitFor('zone', () => true, from, timeout);
      return msg.zone;
    } finally {
      this.stopInputs();
    }
  }

  waitClose(timeout = 5000): Promise<{ code: number; reason: string }> {
    return this.until(() => this.closed, timeout, 'close');
  }

  close(): void {
    this.stopInputs();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }
}
