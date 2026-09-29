// Stale bundles after a deploy (GAME_SPEC §11): world snapshots this client cannot decode — a real ClientWorld fed
// real encoder bytes with a newer format byte — reach the connection as failures through GameSession, end the
// session with 'reload' (4002) after MAX_SNAPSHOT_FAILURES, and the ReloadGuard allows exactly one automatic reload
// until the page has read the world again: no reload loop, and the next deploy may reload again.
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../../src/contracts/net';
import { rules } from '../../src/game';
import { createClientWorld, createSnapshotEncoder, SNAPSHOT_VERSION } from '../../src/net';
import { GameConnection, MAX_SNAPSHOT_FAILURES, type SocketLike } from '../../src/client/connection';
import { RELOAD_GUARD_TTL_MS, ReloadGuard } from '../../src/client/reload-guard';
import { GameSession, WORLD_READABLE_SNAPSHOTS } from '../../src/client/session';
import { DEFAULT_SETTINGS, PROTOCOL_RELOAD_KEY, type KeyValueStore } from '../../src/client/settings';
import { initialUiState } from '../../src/client/state';
import { createStateBox } from '../../src/client/store';
import { player, worldView, zoneInfo } from './helpers';

class FakeSocket implements SocketLike {
  binaryType = 'blob';
  readyState = 0;
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send() {}
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  text(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  binary(data: ArrayBuffer) {
    this.onmessage?.({ data });
  }
}

/** sessionStorage stand-in: survives "reloads" (a new page on the same store). */
function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** The server's world, encoded for viewer 1 by the real encoder (a fresh tick every call). */
function server() {
  const encoder = createSnapshotEncoder();
  const view = worldView({ players: [player(1, 'Ysolde', 0, 0)] });
  let tick = 100;
  return {
    good(): ArrayBuffer {
      tick += 2;
      view.tick = tick;
      view.time = tick / 60;
      return encoder.encode(view, 1, 0).slice(0);
    },
    /** The same bytes from a newer server build (a format this client does not know). */
    newer(): ArrayBuffer {
      const buf = this.good();
      new Uint8Array(buf)[0] = SNAPSHOT_VERSION + 1;
      return buf;
    },
  };
}

type Outcome = 'reloaded' | 'explained';

/**
 * One page load: GameSession on a real ClientWorld behind a GameConnection, and the app's decisions — 'reload' →
 * ReloadGuard.request() (reload or explain), and every frame: a readable world confirms the guard.
 */
function page(store: KeyValueStore, wall: { t: number }) {
  const box = createStateBox(initialUiState({ ...DEFAULT_SETTINGS }));
  const guard = new ReloadGuard(store, () => wall.t);
  const session = new GameSession({
    box,
    rules,
    send: () => true,
    now: () => wall.t,
    wallNow: () => wall.t,
    sound: () => undefined,
    world: createClientWorld(),
  });
  const outcomes: Outcome[] = [];
  const ended: { action: string; code: number }[] = [];
  const warnings: string[] = [];
  const sockets: FakeSocket[] = [];
  const conn = new GameConnection(
    {
      message: (m) => session.handle(m),
      snapshot: (data, at) => session.snapshot(data, at),
      status: () => undefined,
      rtt: () => undefined,
      opened: () => session.connectionOpened(),
      ended: (action, _reason, code) => {
        ended.push({ action, code });
        if (action === 'reload') outcomes.push(guard.request() ? 'reloaded' : 'explained');
      },
      malformed: (e) => warnings.push(e),
    },
    {
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      now: () => wall.t,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
      setInterval: () => 0,
      clearInterval: () => undefined,
      random: () => 0.5,
    },
  );
  const ch = { ...rules.createCharacter('Ysolde', 42), id: 'me' };
  return {
    guard,
    session,
    outcomes,
    ended,
    warnings,
    /** Connect and get into the hideout (welcome → character → zone). */
    join(): FakeSocket {
      conn.connect('ws://x/ws');
      const s = sockets[sockets.length - 1];
      s.open();
      s.text({ t: 'welcome', protocol: PROTOCOL_VERSION, characterId: 'me', tickRate: 60, serverTime: wall.t });
      s.text({ t: 'character', character: ch });
      s.text({ t: 'zone', zone: zoneInfo({ ownerCharacterId: 'me' }) });
      return s;
    },
    /** Deliver snapshots, running the app's per-frame guard check after each (one frame per snapshot). */
    feed(s: FakeSocket, make: () => ArrayBuffer, n: number): void {
      for (let i = 0; i < n && s.readyState === 1; i++) {
        wall.t += 33;
        s.binary(make());
        if (guard.armed && session.worldReadable) guard.confirm();
      }
    },
  };
}

describe('unreadable snapshots (a newer world format under the same protocol)', () => {
  it('a real ClientWorld swallows the decode error, but the session reports it and the connection ends with reload', () => {
    const srv = server();
    const p = page(memoryStore(), { t: 1_700_000_000_000 });
    const s = p.join();
    p.feed(s, () => srv.newer(), MAX_SNAPSHOT_FAILURES - 1);
    expect(p.ended).toEqual([]);
    expect(p.session.world.stats().decodeErrors).toBe(MAX_SNAPSHOT_FAILURES - 1);
    // Logged once, with the format numbers.
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toContain(`format ${SNAPSHOT_VERSION + 1}`);
    p.feed(s, () => srv.newer(), 1);
    expect(p.ended).toEqual([{ action: 'reload', code: 4002 }]);
    expect(s.closedWith?.code).toBe(4002);
    expect(p.outcomes).toEqual(['reloaded']);
  });

  it('readable snapshots in between keep the session (one bad frame is not a stale bundle)', () => {
    const srv = server();
    const p = page(memoryStore(), { t: 1_700_000_000_000 });
    const s = p.join();
    p.feed(s, () => srv.good(), 5);
    expect(p.session.world.stats().snapshots).toBe(5);
    p.feed(s, () => srv.newer(), MAX_SNAPSHOT_FAILURES - 1);
    p.feed(s, () => srv.good(), 1);
    p.feed(s, () => srv.newer(), MAX_SNAPSHOT_FAILURES - 1);
    expect(p.ended).toEqual([]);
    expect(p.session.world.stats().snapshots).toBe(6);
  });

  it('reloads once; if the reloaded page still cannot read the world it explains instead of looping', () => {
    const srv = server();
    const tab = memoryStore();
    const wall = { t: 1_700_000_000_000 };
    // Page 1: the old bundle meets the new server → one automatic reload.
    const p1 = page(tab, wall);
    p1.feed(p1.join(), () => srv.newer(), MAX_SNAPSHOT_FAILURES);
    expect(p1.outcomes).toEqual(['reloaded']);
    // Page 2: a cache served the old bundle again. The welcome arrives (the protocol is accepted), the snapshots
    // still fail → the explanation, not a second reload.
    wall.t += 3000;
    const p2 = page(tab, wall);
    expect(p2.guard.armed).toBe(true);
    const s2 = p2.join();
    p2.feed(s2, () => srv.newer(), MAX_SNAPSHOT_FAILURES);
    expect(p2.ended).toEqual([{ action: 'reload', code: 4002 }]);
    expect(p2.outcomes).toEqual(['explained']);
    // Page 3: the player hard-reloads into the new bundle; once it has read the world for a while the guard is
    // released…
    wall.t += 20_000;
    const p3 = page(tab, wall);
    const s3 = p3.join();
    p3.feed(s3, () => srv.good(), WORLD_READABLE_SNAPSHOTS - 1);
    expect(p3.guard.armed).toBe(true);
    p3.feed(s3, () => srv.good(), 1);
    expect(p3.guard.armed).toBe(false);
    expect(tab.data.has(PROTOCOL_RELOAD_KEY)).toBe(false);
    // …so the next deploy reloads automatically again.
    p3.feed(s3, () => srv.newer(), MAX_SNAPSHOT_FAILURES);
    expect(p3.outcomes).toEqual(['reloaded']);
  });

  it('a page that reads a little and then fails again (a server bug in one zone) still reloads at most once', () => {
    const srv = server();
    const tab = memoryStore();
    const wall = { t: 1_700_000_000_000 };
    const p1 = page(tab, wall);
    p1.feed(p1.join(), () => srv.newer(), MAX_SNAPSHOT_FAILURES);
    const p2 = page(tab, wall);
    const s2 = p2.join();
    p2.feed(s2, () => srv.good(), 20); // not long enough to count as readable
    p2.feed(s2, () => srv.newer(), MAX_SNAPSHOT_FAILURES);
    expect([...p1.outcomes, ...p2.outcomes]).toEqual(['reloaded', 'explained']);
  });
});

describe('ReloadGuard', () => {
  const T = 1_700_000_000_000;

  it('a protocol mismatch (4002) before any welcome: the first reloads, the next explains', () => {
    const tab = memoryStore();
    expect(new ReloadGuard(tab, () => T).request()).toBe(true);
    expect(tab.data.get(PROTOCOL_RELOAD_KEY)).toBe(String(T));
    expect(new ReloadGuard(tab, () => T + 2000).request()).toBe(false);
  });

  it('an old mark (the reloaded page never got back into a game) stops counting after RELOAD_GUARD_TTL_MS', () => {
    const tab = memoryStore();
    new ReloadGuard(tab, () => T).request();
    expect(new ReloadGuard(tab, () => T + RELOAD_GUARD_TTL_MS - 1).armed).toBe(true);
    const later = new ReloadGuard(tab, () => T + RELOAD_GUARD_TTL_MS);
    expect(later.armed).toBe(false);
    expect(later.request()).toBe(true);
  });

  it("an older bundle's '1' mark counts as a reload that just happened", () => {
    const tab = memoryStore();
    tab.setItem(PROTOCOL_RELOAD_KEY, '1');
    const g = new ReloadGuard(tab, () => T);
    expect(g.armed).toBe(true);
    expect(g.request()).toBe(false);
  });

  it('a clock that jumped backwards keeps the mark (never risk a loop)', () => {
    const tab = memoryStore();
    new ReloadGuard(tab, () => T).request();
    expect(new ReloadGuard(tab, () => T - 3_600_000).request()).toBe(false);
  });

  it('storage that cannot keep the mark never reloads automatically (nothing could stop a loop)', () => {
    expect(new ReloadGuard(null, () => T).request()).toBe(false);
    const broken: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(new ReloadGuard(broken, () => T).request()).toBe(false);
  });

  it('confirm() releases the mark once; it is a no-op when nothing is marked', () => {
    const tab = memoryStore();
    const g = new ReloadGuard(tab, () => T);
    g.confirm();
    expect(tab.data.size).toBe(0);
    g.request();
    g.confirm();
    expect(g.armed).toBe(false);
    expect(tab.data.has(PROTOCOL_RELOAD_KEY)).toBe(false);
    expect(g.request()).toBe(true);
  });
});
