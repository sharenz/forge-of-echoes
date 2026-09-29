// WebSocket sessions over real sockets: handshake failures, the welcome → character → zone sequence,
// authoritative movement from inputs, the one-socket-per-character rule, logout, ping and message validation.
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, newPlayer, startTestServer } from './helpers';
import { TestClient } from './ws-client';

type Server = Awaited<ReturnType<typeof startTestServer>>;

describe('websocket sessions', () => {
  let server: Server;
  const clients: TestClient[] = [];
  const connect = async (...args: Parameters<typeof TestClient.connect>) => {
    const c = await TestClient.connect(...args);
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('closes bad handshakes with the contract codes', async () => {
    const p = await newPlayer(server.base);
    const other = await newPlayer(server.base);
    const badToken = await connect(server.base, { token: 'x'.repeat(43), character: p.characterId });
    expect((await badToken.waitClose()).code).toBe(4001);
    const noToken = await connect(server.base, { character: p.characterId });
    expect((await noToken.waitClose()).code).toBe(4001);
    const version = await connect(server.base, { token: p.token, character: p.characterId, version: 999 });
    expect((await version.waitClose()).code).toBe(4002);
    // Pre-balance tabs can decode snapshots, but their local tooltips/rules are stale: force a reload.
    for (const version of [1, 2, 3]) {
      const oldBalance = await connect(server.base, { token: p.token, character: p.characterId, version });
      expect((await oldBalance.waitClose()).code).toBe(4002);
    }
    const foreign = await connect(server.base, { token: p.token, character: other.characterId });
    expect((await foreign.waitClose()).code).toBe(4001);
    const unknown = await connect(server.base, { token: p.token, character: 'ch-nope' });
    expect((await unknown.waitClose()).code).toBe(4001);
  });

  it('greets with welcome → character → zone, then streams snapshots; inputs move the player', async () => {
    const p = await newPlayer(server.base);
    const c = await connect(server.base, { token: p.token, character: p.characterId });
    await c.waitFor('zone');
    const kinds = c.log.map((m) => m.t);
    expect(kinds.slice(0, 3)).toEqual(['welcome', 'character', 'zone']);
    const welcome = c.log[0];
    expect(welcome).toMatchObject({ t: 'welcome', protocol: PROTOCOL_VERSION, characterId: p.characterId, tickRate: 60 });
    const ch = c.log[1];
    if (ch.t !== 'character') throw new Error('expected character');
    expect(ch.character.id).toBe(p.characterId);
    expect(ch.character.rngState).toBe(0); // redacted
    const zone = c.zone!;
    expect(zone).toMatchObject({ kind: 'hideout', ownerCharacterId: p.characterId, ownerName: p.name, theme: 'hideout', setup: null, portal: null });
    expect(zone.localPlayerId).toBeGreaterThan(0);
    expect(zone.props.some((pr) => pr.kind === 'mapDevice' && pr.interactive)).toBe(true);
    // Props carry exactly the contract fields (the client validator rejects extra keys).
    expect(Object.keys(zone.props[0]).sort()).toEqual(['id', 'interactive', 'kind', 'radius', 'state', 'variant', 'x', 'y']);

    const start = await c.until(() => c.me(), 3000, 'first snapshot');
    const x0 = start.x;
    const y0 = start.y;
    expect(c.snapshot!.viewerId).toBe(zone.localPlayerId);

    // Hold "right" for ~0.5 s: the authoritative position moves east, and the ack follows the inputs.
    c.startInputs(() => ({ moveX: 1, moveY: 0, aimX: x0 + 100, aimY: y0 }));
    await new Promise((r) => setTimeout(r, 500));
    c.stopInputs();
    // After the last input the server repeats it for up to 250 ms (src/net input starvation), so wait for
    // the authoritative player to come to rest rather than sampling after a fixed delay.
    let rest: { x: number; y: number; snaps: number } | null = null;
    const after = await c.until(() => {
      const me = c.me();
      if (!me) return null;
      if (!rest || rest.x !== me.x || rest.y !== me.y) rest = { x: me.x, y: me.y, snaps: c.snapshots };
      return c.snapshots - rest.snaps >= 6 ? me : null;
    }, 3000, 'the player at rest');
    expect(after.x - x0).toBeGreaterThan(25);
    expect(Math.abs(after.y - y0)).toBeLessThan(10);
    expect(c.snapshot!.ackSeq).toBeGreaterThan(10);
    // The real client-side replica (src/net ClientWorld) accepts the stream and converges on the server.
    expect(c.worldErrors).toEqual([]);
    expect(c.world.localPlayerId).toBe(zone.localPlayerId);
    await c.until(() => {
      c.world.update(performance.now());
      const replica = c.world.view.players.find((pl) => pl.id === zone.localPlayerId);
      return replica && Math.hypot(replica.x - after.x, replica.y - after.y) < 8;
    }, 2000, 'the replica to agree with the server');
    expect(c.world.latestTick).toBe(c.snapshot!.tick);
  });

  it('answers pings with the server tick', async () => {
    const p = await newPlayer(server.base);
    const c = await connect(server.base, { token: p.token, character: p.characterId });
    await c.waitFor('zone');
    await c.until(() => c.me(), 3000);
    c.sendRaw(JSON.stringify({ t: 'ping', time: 1234.5 }));
    const pong = await c.waitFor('pong');
    expect(pong.time).toBe(1234.5);
    expect(pong.serverTick).toBeGreaterThan(0);
    expect(Math.abs(pong.serverTime - Date.now())).toBeLessThan(5000);
  });

  it('a newer socket kicks the older one (4003) and takes over the character in place', async () => {
    const p = await newPlayer(server.base);
    const first = await connect(server.base, { token: p.token, character: p.characterId });
    await first.waitFor('zone');
    const firstZone = first.zone!;
    const second = await connect(server.base, { token: p.token, character: p.characterId });
    const closed = await first.waitClose();
    expect(closed.code).toBe(4003);
    await second.waitFor('zone');
    // Same instance and player: the character never left.
    expect(second.zone!.instanceId).toBe(firstZone.instanceId);
    expect(second.zone!.localPlayerId).toBe(firstZone.localPlayerId);
    expect(server.game.sessions.get(p.characterId)?.conn).not.toBeNull();
  });

  it('logout closes the sockets of that session (4001)', async () => {
    const p = await newPlayer(server.base);
    const c = await connect(server.base, { token: p.token, character: p.characterId });
    await c.waitFor('zone');
    await api(server.base, 'POST', '/api/logout', undefined, p.token);
    expect((await c.waitClose()).code).toBe(4001);
  });

  it('rejects malformed messages: commands get an error result, other frames a toast', async () => {
    const p = await newPlayer(server.base);
    const c = await connect(server.base, { token: p.token, character: p.characterId });
    await c.waitFor('zone');
    let from = c.mark();
    c.sendRaw(JSON.stringify({ t: 'cmd', id: 77, cmd: { c: 'moveItem', uid: 'i1' } }));
    const bad = await c.waitFor('result', (m) => m.id === 77, from);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Invalid command/);
    from = c.mark();
    c.sendRaw(JSON.stringify({ t: 'cmd', id: 78, cmd: { c: 'hackTheServer' } }));
    expect((await c.waitFor('result', (m) => m.id === 78, from)).ok).toBe(false);
    from = c.mark();
    c.sendRaw(JSON.stringify({ t: 'input', seq: 1, moveX: 5, moveY: 0, aimX: 0, aimY: 0, held: 0, flask: -1 }));
    const toast = await c.waitFor('toast', () => true, from);
    expect(toast.tone).toBe('bad');
    from = c.mark();
    c.sendRaw(Buffer.from([1, 2, 3]));
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    await c.waitFor('toast', () => true, from);
    c.sendRaw('not json at all');
    // Still connected and working.
    const ok = await c.command({ c: 'clearNewFlags' });
    expect(ok.ok).toBe(true);
    expect(c.closed).toBeNull();
  });
});
