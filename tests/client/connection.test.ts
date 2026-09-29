// WebSocket connection manager: close-code policy, backoff, reconnects, pings and the silence watchdog — with a
// fake socket and a manual clock.
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../../src/contracts/net';
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import type { ConnectionStatus } from '../../src/contracts/ui';
import {
  GameConnection, MAX_RECONNECT_ATTEMPTS, MAX_SNAPSHOT_FAILURES, MAX_UPDATE_RECONNECT_ATTEMPTS, PING_INTERVAL_MS, SILENCE_TIMEOUT_MS,
  backoffDelay, closeAction, socketUrl, updateRetryDelay, type SocketLike,
} from '../../src/client/connection';

class FakeSocket implements SocketLike {
  binaryType = 'blob';
  readyState = 0;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  text(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  binary(bytes: number[]) {
    this.onmessage?.({ data: new Uint8Array(bytes).buffer });
  }
  drop(code: number, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function harness(opts: { snapshot?: (data: ArrayBuffer) => void } = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; every: number; id: number }[] = [];
  let nextId = 1;
  const sockets: FakeSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const messages: ServerMessage[] = [];
  const ended: { action: string; reason: string; code: number }[] = [];
  const rtts: number[] = [];
  const malformed: string[] = [];
  const dropped: { code: number; updating: boolean }[] = [];
  let opened = 0;
  const conn = new GameConnection(
    {
      message: (m) => messages.push(m),
      snapshot: (data) => opts.snapshot?.(data),
      status: (s) => statuses.push(s),
      rtt: (ms) => rtts.push(ms),
      ended: (action, reason, code) => ended.push({ action, reason, code }),
      opened: () => opened++,
      malformed: (e) => malformed.push(e),
      dropped: (code, _reason, updating) => dropped.push({ code, updating }),
    },
    {
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      now: () => now,
      setTimeout: (fn, ms) => {
        const t = { at: now + ms, fn, every: 0, id: nextId++ };
        timers.push(t);
        return t.id;
      },
      clearTimeout: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
      setInterval: (fn, ms) => {
        const t = { at: now + ms, fn, every: ms, id: nextId++ };
        timers.push(t);
        return t.id;
      },
      clearInterval: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
      random: () => 0.5,
    },
  );
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      now = t.at;
      if (t.every > 0) t.at += t.every;
      else timers.shift();
      t.fn();
    }
    now = end;
  };
  return { conn, sockets, statuses, messages, ended, rtts, malformed, dropped, advance, get opened() { return opened; }, get now() { return now; } };
}

const welcome: ServerMessage = { t: 'welcome', protocol: PROTOCOL_VERSION, characterId: 'c1', tickRate: 60, serverTime: 0 };

describe('policy', () => {
  it('maps close codes to actions', () => {
    expect(closeAction(4001, false)).toBe('auth');
    expect(closeAction(4002, false)).toBe('reload');
    expect(closeAction(4003, false)).toBe('replaced');
    expect(closeAction(4004, false)).toBe('reconnect');
    expect(closeAction(1006, false)).toBe('reconnect');
    expect(closeAction(1001, false)).toBe('reconnect');
    expect(closeAction(1008, false)).toBe('fatal');
    expect(closeAction(1011, false)).toBe('fatal');
    expect(closeAction(1006, true)).toBe('none');
  });

  it('backs off exponentially with jitter and a cap', () => {
    expect(backoffDelay(1, 0.5)).toBe(500);
    expect(backoffDelay(2, 0.5)).toBe(1000);
    expect(backoffDelay(4, 0.5)).toBe(4000);
    expect(backoffDelay(9, 0.5)).toBe(8000);
    expect(backoffDelay(1, 0)).toBe(375);
    expect(backoffDelay(1, 0.999)).toBeLessThanOrEqual(625);
  });

  it('builds the socket URL for the page', () => {
    expect(socketUrl({ protocol: 'http:', host: 'localhost:5173' }, 'tok en', 'c1')).toBe(
      `ws://localhost:5173/ws?token=tok+en&character=c1&v=${PROTOCOL_VERSION}`,
    );
    expect(socketUrl({ protocol: 'https:', host: 'forge.example' }, 't', 'c')).toMatch(/^wss:\/\/forge\.example\/ws\?/);
  });
});

describe('GameConnection', () => {
  it('connects, goes online at welcome and forwards parsed messages', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    expect(h.statuses).toEqual(['connecting']);
    expect(h.sockets[0].binaryType).toBe('arraybuffer');
    h.sockets[0].open();
    expect(h.opened).toBe(1);
    h.sockets[0].text(welcome);
    expect(h.statuses.at(-1)).toBe('online');
    expect(h.messages[0].t).toBe('welcome');
    // Garbage is ignored, not forwarded.
    h.sockets[0].onmessage?.({ data: '{"t":"nope"}' });
    expect(h.messages).toHaveLength(1);
  });

  it('pings every second and reports the round trip from the pong', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    const first = JSON.parse(h.sockets[0].sent[0]);
    expect(first).toEqual({ t: 'ping', time: 0 });
    h.advance(PING_INTERVAL_MS);
    expect(h.sockets[0].sent).toHaveLength(2);
    h.advance(40);
    h.sockets[0].text({ t: 'pong', time: 1000, serverTime: 5, serverTick: 9 });
    expect(h.rtts).toEqual([40]);
  });

  it('reconnects with backoff after an unexpected drop, and resets the backoff at welcome', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].text(welcome);
    h.sockets[0].drop(1006);
    expect(h.statuses.at(-1)).toBe('reconnecting');
    expect(h.sockets).toHaveLength(1);
    h.advance(499);
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].drop(1006); // failed attempt: longer wait
    h.advance(999);
    expect(h.sockets).toHaveLength(2);
    h.advance(1);
    expect(h.sockets).toHaveLength(3);
    h.sockets[2].open();
    h.sockets[2].text(welcome);
    expect(h.statuses.at(-1)).toBe('online');
    h.sockets[2].drop(1006); // healthy again since the welcome: the backoff starts over
    h.advance(500);
    expect(h.sockets).toHaveLength(4);
    expect(h.dropped.map((d) => d.updating)).toEqual([false, false, false]);
  });

  it('stops for good on a replaced session, bad auth or protocol mismatch', () => {
    for (const [code, action] of [[4003, 'replaced'], [4001, 'auth'], [4002, 'reload'], [1008, 'fatal']] as const) {
      const h = harness();
      h.conn.connect('ws://x/ws');
      h.sockets[0].open();
      h.sockets[0].drop(code, 'because');
      expect(h.ended).toEqual([{ action, reason: 'because', code }]);
      expect(h.statuses.at(-1)).toBe('offline');
      h.advance(60_000);
      expect(h.sockets).toHaveLength(1);
    }
  });

  it('retries a restarting server (4004) steadily and patiently, then leaves update mode at welcome', () => {
    expect([1, 2, 3, 4, 5, 9].map((a) => updateRetryDelay(a, 0.5))).toEqual([1000, 1500, 2000, 2500, 3000, 3000]);
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].text(welcome);
    h.sockets[0].drop(4004, 'server shutting down');
    expect(h.conn.updating).toBe(true);
    expect(h.dropped).toEqual([{ code: 4004, updating: true }]);
    expect(h.statuses.at(-1)).toBe('reconnecting');
    h.advance(999);
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    expect(h.sockets).toHaveLength(2);
    // The server is down for a while: refused attempts (1006) stay in update mode, at most 3 s apart…
    for (let i = 0; i < 40; i++) {
      h.sockets.at(-1)!.drop(1006);
      h.advance(3000);
    }
    expect(h.sockets).toHaveLength(42);
    expect(h.ended).toEqual([]);
    expect(h.dropped.at(-1)).toEqual({ code: 1006, updating: true });
    // …until it is back: the welcome ends update mode, and the next blip backs off normally again.
    h.sockets.at(-1)!.open();
    h.sockets.at(-1)!.text(welcome);
    expect(h.conn.updating).toBe(false);
    expect(h.statuses.at(-1)).toBe('online');
    h.sockets.at(-1)!.drop(1006);
    expect(h.dropped.at(-1)).toEqual({ code: 1006, updating: false });
    h.advance(500);
    expect(h.sockets).toHaveLength(43);
  });

  it('a drain refuses the login itself with 4004: still update mode, not a failure', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].drop(4004);
    expect(h.conn.updating).toBe(true);
    expect(h.ended).toEqual([]);
    h.advance(1000);
    expect(h.sockets).toHaveLength(2);
  });

  it('gives up on an update only after many minutes, and says so', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].drop(4004);
    for (let i = 0; i < MAX_UPDATE_RECONNECT_ATTEMPTS; i++) {
      h.advance(3000);
      h.sockets.at(-1)!.drop(1006);
    }
    expect(h.ended).toHaveLength(1);
    expect(h.ended[0].action).toBe('fatal');
    expect(h.ended[0].reason).toMatch(/update/i);
    expect(h.now).toBeGreaterThan(8 * 60_000);
    expect(h.conn.updating).toBe(false);
  });

  it('gives up after too many failed attempts', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) {
      h.sockets.at(-1)!.drop(1006);
      h.advance(20_000);
    }
    expect(h.ended.at(-1)?.action).toBe('fatal');
  });

  it('a silent link is dropped and reconnected', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].text(welcome);
    h.advance(SILENCE_TIMEOUT_MS + PING_INTERVAL_MS);
    expect(h.sockets[0].closedWith?.code).toBe(4000);
    expect(h.statuses.at(-1)).toBe('reconnecting');
    h.advance(1000);
    expect(h.sockets).toHaveLength(2);
  });

  it('an intentional close never reconnects and ignores late events of the old socket', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    const s = h.sockets[0];
    s.open();
    h.conn.close();
    expect(h.statuses.at(-1)).toBe('offline');
    expect(s.closedWith?.code).toBe(1000);
    s.onclose?.({ code: 1006, reason: '' });
    h.advance(30_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.conn.send({ t: 'ping', time: 1 })).toBe(false);
  });

  it('a snapshot that cannot be applied is logged once and skipped; a good one resets the count', () => {
    let good = false;
    const h = harness({
      snapshot: () => {
        if (!good) throw new RangeError('snapshot version 9 is not supported');
      },
    });
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].text(welcome);
    for (let i = 0; i < MAX_SNAPSHOT_FAILURES - 1; i++) h.sockets[0].binary([9, 9, 9]);
    expect(h.malformed).toHaveLength(1);
    expect(h.malformed[0]).toContain('snapshot version 9');
    good = true;
    h.sockets[0].binary([1]);
    good = false;
    for (let i = 0; i < MAX_SNAPSHOT_FAILURES - 1; i++) h.sockets[0].binary([9]);
    expect(h.ended).toEqual([]);
    expect(h.statuses.at(-1)).toBe('online');
  });

  it('snapshots that keep failing end the connection like a protocol mismatch (reload)', () => {
    const h = harness({
      snapshot: () => {
        throw new RangeError('corrupt');
      },
    });
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].text(welcome);
    for (let i = 0; i < MAX_SNAPSHOT_FAILURES; i++) h.sockets[0].binary([0xff]);
    expect(h.ended).toHaveLength(1);
    expect(h.ended[0]).toMatchObject({ action: 'reload', code: 4002 });
    expect(h.sockets[0].closedWith?.code).toBe(4002);
    expect(h.statuses.at(-1)).toBe('offline');
    h.advance(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('a simulated drop reconnects through the normal backoff path', () => {
    const h = harness();
    h.conn.connect('ws://x/ws');
    h.sockets[0].open();
    h.sockets[0].text(welcome);
    h.conn.simulateDrop();
    expect(h.statuses.at(-1)).toBe('reconnecting');
    expect(h.conn.isOpen).toBe(false);
    h.advance(500);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1].open();
    h.sockets[1].text(welcome);
    expect(h.statuses.at(-1)).toBe('online');
    expect(h.opened).toBe(2);
  });
});
