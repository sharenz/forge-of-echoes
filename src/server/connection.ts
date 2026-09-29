// The transport a player session talks through. The game logic only sees this interface, so tests and
// headless bots can drive the real server logic without sockets (see tests/server).
import type { WebSocket } from 'ws';

export interface Connection {
  /** Unique per connection (logging, identity checks). */
  readonly id: number;
  /** Remote address (rate limiting, logs). */
  readonly ip: string;
  readonly open: boolean;
  /** Bytes queued for sending but not yet written (backpressure). */
  readonly bufferedAmount: number;
  /**
   * Send a JSON text frame. `compress: false` skips permessage-deflate for this frame: compression runs on
   * the libuv thread pool and ws holds every later frame (snapshots included) until it finishes, so the
   * small, frequent frames go out as they are and only the big, rare ones are compressed.
   */
  sendText(data: string, compress?: boolean): void;
  sendBinary(data: ArrayBuffer): void;
  close(code: number, reason: string): void;
}

let nextConnectionId = 1;

export function newConnectionId(): number {
  return nextConnectionId++;
}

/** A ws WebSocket as a Connection. Binary snapshots are never compressed (they are already dense). */
export class WsConnection implements Connection {
  readonly id = newConnectionId();

  constructor(
    private readonly ws: WebSocket,
    readonly ip: string,
  ) {}

  get open(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  sendText(data: string, compress = true): void {
    if (this.open) this.ws.send(data, { binary: false, compress });
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.open) this.ws.send(data, { binary: true, compress: false });
  }

  close(code: number, reason: string): void {
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) this.ws.close(code, reason);
  }
}
