// WebSocket connection manager: /ws?token&character&v, JSON text frames + binary snapshots, 1 Hz ping for the
// round-trip time, a liveness watchdog, and reconnection with exponential backoff on unexpected closes.
// Close codes (contracts/net.ts): 4001 bad auth → back to login, 4002 protocol mismatch → reload,
// 4003 logged in elsewhere → stop (never fight the other tab), 4004 shutdown → reconnect (the server restarts).
// 4004 switches the reconnect streak into "updating" mode (GAME_SPEC §11 deploys): a steady 1–3 s retry instead of
// the exponential backoff, and far more patience (a deploy may take minutes), until the next 'welcome'.
// Snapshots this client cannot read (a server build with a newer snapshot format under the same protocol
// version) end the connection the same way as 4002 once they keep failing, instead of freezing the world.
// The socket and timers are injected, so the logic is testable without a browser (tests/client).
import type { ClientMessage, ServerMessage } from '../contracts/net';
import { PROTOCOL_VERSION } from '../contracts/net';
import type { ConnectionStatus } from '../contracts/ui';
import { encodeMessage, parseServerMessage } from '../net';

export const CLOSE_NORMAL = 1000;
export const CLOSE_POLICY = 1008;
export const CLOSE_SERVER_ERROR = 1011;
export const CLOSE_BAD_AUTH = 4001;
export const CLOSE_PROTOCOL = 4002;
export const CLOSE_REPLACED = 4003;
export const CLOSE_SHUTDOWN = 4004;
/** Our own close when the link went silent (the browser may take minutes to notice a dead TCP connection). */
export const CLOSE_TIMEOUT = 4000;

export const PING_INTERVAL_MS = 1000;
/** No frame at all for this long (snapshots flow at 30 Hz, pongs at 1 Hz) → the link is dead. */
export const SILENCE_TIMEOUT_MS = 8000;
/** Give up after this many consecutive failed attempts (≈ 1.5 minutes with the backoff cap). */
export const MAX_RECONNECT_ATTEMPTS = 14;
/** While the server updates (a 4004 close in this streak): attempts before giving up (≈ 10 minutes at 3 s). */
export const MAX_UPDATE_RECONNECT_ATTEMPTS = 200;
/** Consecutive snapshots that failed to apply (≈ 1 s at 30 Hz) before the stream counts as unreadable. */
export const MAX_SNAPSHOT_FAILURES = 30;

export type CloseAction =
  | 'none'       // we closed it on purpose
  | 'reconnect'  // try again with backoff
  | 'auth'       // session invalid → login screen
  | 'reload'     // protocol mismatch → hard reload
  | 'replaced'   // the character was opened elsewhere → stop
  | 'fatal';     // the server refused us for good (policy, broken character) → manual retry only

/** What to do after the socket closed with `code`. */
export function closeAction(code: number, intentional: boolean): CloseAction {
  if (intentional) return 'none';
  switch (code) {
    case CLOSE_BAD_AUTH:
      return 'auth';
    case CLOSE_PROTOCOL:
      return 'reload';
    case CLOSE_REPLACED:
      return 'replaced';
    case CLOSE_POLICY:
    case CLOSE_SERVER_ERROR:
      return 'fatal';
    default:
      return 'reconnect';
  }
}

/** Exponential backoff with ±25% jitter: 0.5 s, 1 s, 2 s, 4 s, then 8 s. `rand` in [0, 1). */
export function backoffDelay(attempt: number, rand: number): number {
  const base = Math.min(8000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + 0.5 * rand));
}

/**
 * Retry delay while the server updates (4004): it is restarting, not overloaded, so ask again every 1–3 s (±25%
 * jitter) and be back within moments of it listening again: 1 s, 1.5 s, 2 s, 2.5 s, then 3 s.
 */
export function updateRetryDelay(attempt: number, rand: number): number {
  const base = Math.min(3000, 1000 + 500 * Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + 0.5 * rand));
}

/** The WebSocket URL for this page (ws: or wss: matching the page, same host — Vite proxies /ws in dev). */
export function socketUrl(loc: { protocol: string; host: string }, token: string, characterId: string): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ token, character: characterId, v: String(PROTOCOL_VERSION) });
  return `${scheme}://${loc.host}/ws?${q.toString()}`;
}

/** The subset of the browser WebSocket used here. */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ConnectionHandlers {
  /** A parsed, shape-checked server message. */
  message(msg: ServerMessage): void;
  /** A binary world snapshot (receivedAt = client ms, stamped on arrival). */
  snapshot(data: ArrayBuffer, receivedAt: number): void;
  /** Status for the UI ('connecting' → 'online' at welcome; 'reconnecting' while backing off). */
  status(status: ConnectionStatus): void;
  /** Round-trip time of a ping (ms). */
  rtt(ms: number): void;
  /** The connection ended for good (no automatic reconnect). `reason` is the server's text, if any. */
  ended(action: Exclude<CloseAction, 'none' | 'reconnect'>, reason: string, code: number): void;
  /**
   * A socket closed and a reconnect is scheduled (status 'reconnecting'). `updating`: the server is restarting for
   * an update (a 4004 in this reconnect streak) — say so calmly instead of reporting a broken link.
   */
  dropped?(code: number, reason: string, updating: boolean): void;
  /** A socket (re)opened; per-connection state (input seqs) must restart. */
  opened(): void;
  /** The server sent something we could not parse or apply (logged, ignored). */
  malformed?(error: string): void;
}

export interface ConnectionDeps {
  createSocket(url: string): SocketLike;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  random(): number;
}

const OPEN = 1;

export class GameConnection {
  private socket: SocketLike | null = null;
  private url = '';
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private pingTimer: unknown = null;
  private lastFrameAt = 0;
  private current: ConnectionStatus = 'offline';
  /** Bumped per socket so late callbacks of an abandoned socket are ignored. */
  private generation = 0;
  /** Snapshots in a row that threw while being applied. */
  private snapshotFailures = 0;
  /** The server closed with 4004 during this reconnect streak (cleared at the next 'welcome'). */
  private serverUpdating = false;
  bytesIn = 0;
  bytesOut = 0;

  constructor(
    private readonly handlers: ConnectionHandlers,
    private readonly deps: ConnectionDeps,
  ) {}

  get status(): ConnectionStatus {
    return this.current;
  }

  get isOpen(): boolean {
    return !!this.socket && this.socket.readyState === OPEN;
  }

  /** The server is restarting for an update (a 4004 close since the last 'welcome'). */
  get updating(): boolean {
    return this.serverUpdating;
  }

  /** Connect to `url` (replacing any current socket). Resets the backoff (a known server update stays known). */
  connect(url: string): void {
    this.shutdown(CLOSE_NORMAL, 'reconnecting');
    this.url = url;
    this.attempt = 0;
    this.setStatus('connecting');
    this.openSocket();
  }

  /**
   * Debug / e2e: act as if the network dropped (no close handshake on our side reaches the handlers): the normal
   * reconnect path runs and the server resumes the character in place.
   */
  simulateDrop(): void {
    if (this.socket) this.abandonSocket(this.generation, CLOSE_TIMEOUT, 'simulated drop');
  }

  /** Close on purpose: no reconnect. */
  close(reason = 'bye'): void {
    this.shutdown(CLOSE_NORMAL, reason);
    this.url = '';
    this.serverUpdating = false;
    this.setStatus('offline');
  }

  send(msg: ClientMessage): boolean {
    return this.sendText(encodeMessage(msg));
  }

  sendText(text: string): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    try {
      this.socket.send(text);
      this.bytesOut += text.length;
      return true;
    } catch {
      return false;
    }
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.current) return;
    this.current = s;
    this.handlers.status(s);
  }

  private openSocket(): void {
    const gen = ++this.generation;
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(this.url);
    } catch {
      this.scheduleReconnect(gen);
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.snapshotFailures = 0;
    socket.onopen = () => {
      if (gen !== this.generation) return;
      this.lastFrameAt = this.deps.now();
      this.startPing(gen);
      this.handlers.opened();
    };
    socket.onmessage = (ev) => {
      if (gen !== this.generation) return;
      const at = this.deps.now();
      this.lastFrameAt = at;
      const data = ev.data;
      if (typeof data === 'string') {
        this.bytesIn += data.length;
        const r = parseServerMessage(data);
        if (!r.ok) {
          this.handlers.malformed?.(r.error);
          return;
        }
        const msg = r.value;
        if (msg.t === 'welcome') {
          // A healthy session: the next drop starts a fresh backoff (and the update, if any, is over).
          this.attempt = 0;
          this.serverUpdating = false;
          this.setStatus('online');
        } else if (msg.t === 'pong') {
          this.handlers.rtt(Math.max(0, at - msg.time));
        }
        this.handlers.message(msg);
      } else if (data instanceof ArrayBuffer) {
        this.bytesIn += data.byteLength;
        try {
          this.handlers.snapshot(data, at);
          this.snapshotFailures = 0;
        } catch (err) {
          this.snapshotFailed(err);
        }
      }
    };
    socket.onerror = () => {
      // Always followed by onclose, which decides what happens next.
    };
    socket.onclose = (ev) => {
      if (gen !== this.generation) return;
      this.stopPing();
      this.socket = null;
      const action = closeAction(ev.code, false);
      if (action === 'reconnect') {
        if (ev.code === CLOSE_SHUTDOWN) this.serverUpdating = true;
        this.scheduleReconnect(gen);
        if (this.reconnectTimer !== null) this.handlers.dropped?.(ev.code, ev.reason ?? '', this.serverUpdating);
        return;
      }
      this.url = action === 'auth' || action === 'reload' || action === 'replaced' ? '' : this.url;
      this.setStatus('offline');
      this.handlers.ended(action as Exclude<CloseAction, 'none' | 'reconnect'>, ev.reason ?? '', ev.code);
    };
  }

  /**
   * A snapshot could not be applied. One bad frame is logged and skipped; a second of them in a row means this client
   * cannot read the server's world format, which a reload fixes (like a 4002 protocol mismatch).
   */
  private snapshotFailed(err: unknown): void {
    this.snapshotFailures++;
    if (this.snapshotFailures === 1) {
      this.handlers.malformed?.(`a world snapshot could not be applied: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (this.snapshotFailures < MAX_SNAPSHOT_FAILURES) return;
    this.snapshotFailures = 0;
    this.shutdown(CLOSE_PROTOCOL, 'unreadable snapshots');
    this.url = '';
    this.serverUpdating = false;
    this.setStatus('offline');
    this.handlers.ended('reload', 'This game client cannot read the server\'s world data.', CLOSE_PROTOCOL);
  }

  /** Drop the current socket without its close callback and let the backoff reconnect (dead link, simulated drop). */
  private abandonSocket(gen: number, code: number, reason: string): void {
    const s = this.socket;
    this.socket = null;
    this.stopPing();
    if (s) {
      s.onopen = null;
      s.onmessage = null;
      s.onclose = null;
      s.onerror = null;
      try {
        s.close(code, reason);
      } catch {
        // already gone
      }
    }
    this.scheduleReconnect(gen);
    if (this.reconnectTimer !== null) this.handlers.dropped?.(code, reason, this.serverUpdating);
  }

  private scheduleReconnect(gen: number): void {
    if (gen !== this.generation || !this.url) return;
    this.attempt++;
    const updating = this.serverUpdating;
    if (this.attempt > (updating ? MAX_UPDATE_RECONNECT_ATTEMPTS : MAX_RECONNECT_ATTEMPTS)) {
      this.serverUpdating = false;
      this.setStatus('offline');
      this.handlers.ended(
        'fatal',
        updating ? 'The server update is taking longer than usual. Try again in a moment.' : 'The server is not responding.',
        0,
      );
      return;
    }
    this.setStatus('reconnecting');
    const delay = updating ? updateRetryDelay(this.attempt, this.deps.random()) : backoffDelay(this.attempt, this.deps.random());
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      if (gen !== this.generation || !this.url) return;
      this.openSocket();
    }, delay);
  }

  private startPing(gen: number): void {
    this.stopPing();
    const tick = (): void => {
      if (gen !== this.generation || !this.socket) return;
      const now = this.deps.now();
      if (now - this.lastFrameAt > SILENCE_TIMEOUT_MS) {
        // Dead link: drop it and reconnect.
        this.abandonSocket(gen, CLOSE_TIMEOUT, 'timeout');
        return;
      }
      this.send({ t: 'ping', time: now });
    };
    tick();
    this.pingTimer = this.deps.setInterval(tick, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) this.deps.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private shutdown(code: number, reason: string): void {
    this.generation++;
    this.stopPing();
    if (this.reconnectTimer !== null) this.deps.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = null;
      s.onmessage = null;
      s.onclose = null;
      s.onerror = null;
      try {
        s.close(code, reason);
      } catch {
        // closing a CONNECTING socket can throw in some browsers
      }
    }
  }
}
