// Network-facing hardening: client addresses behind proxies (a forged X-Forwarded-For must not buy fresh
// rate-limit buckets), the development loopback exemption, concurrent socket caps per address and per
// account, and the cap on concurrent password hashes.
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthResponse } from '../../src/contracts/net';
import { MAX_CONCURRENT_HASHES, hashLoad, hashPassword } from '../../src/server/auth';
import { clientIp, isPrivateAddress } from '../../src/server/net-address';
import { api, newPlayer, startTestServer } from './helpers';
import { TestClient } from './ws-client';

type Server = Awaited<ReturnType<typeof startTestServer>>;

function fakeRequest(peer: string, xff?: string | string[]): IncomingMessage {
  return { socket: { remoteAddress: peer }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } } as unknown as IncomingMessage;
}

describe('client addresses', () => {
  it('trusts only the entries our own proxies appended, and only from private peers', () => {
    // No proxy configured: the header is ignored.
    expect(clientIp(fakeRequest('203.0.113.9', '1.2.3.4'), 0)).toBe('203.0.113.9');
    // One proxy: the rightmost entry is the one it appended; a forged leftmost entry is ignored.
    expect(clientIp(fakeRequest('10.0.0.2', '6.6.6.6, 198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(clientIp(fakeRequest('::ffff:127.0.0.1', '198.51.100.7'), 1)).toBe('198.51.100.7');
    // Two proxies: the second entry from the right.
    expect(clientIp(fakeRequest('10.0.0.3', '6.6.6.6, 198.51.100.7, 10.0.0.2'), 2)).toBe('198.51.100.7');
    // Repeated headers are joined in order.
    expect(clientIp(fakeRequest('10.0.0.2', ['6.6.6.6', '198.51.100.8']), 1)).toBe('198.51.100.8');
    // A public peer is not one of our proxies: its header means nothing.
    expect(clientIp(fakeRequest('203.0.113.9', '198.51.100.7'), 1)).toBe('203.0.113.9');
    // Garbage falls back to the peer.
    expect(clientIp(fakeRequest('10.0.0.2', 'not-an-ip'), 1)).toBe('10.0.0.2');
    expect(clientIp(fakeRequest('10.0.0.2'), 1)).toBe('10.0.0.2');
    expect(clientIp(fakeRequest('::ffff:10.1.2.3'), 0)).toBe('10.1.2.3');
  });

  it('knows private address ranges', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.1.1', '100.64.0.1', 'fd12::1', 'fe80::1', '::ffff:192.168.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1', 'garbage']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('rate limits and caps on a real server', () => {
  let server: Server | null = null;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await server?.close();
    server = null;
  });

  const register = (base: string, username: string, xff?: string) =>
    fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(xff ? { 'X-Forwarded-For': xff } : {}) },
      body: JSON.stringify({ username, password: 'long enough pass' }),
    });

  it('behind a proxy, a forged X-Forwarded-For does not escape the per-address limits', async () => {
    server = await startTestServer({ trustProxy: 1, limits: { registrationsPerIp: 1 } });
    expect((await register(server.base, 'first_forger', '1.1.1.1, 198.51.100.20')).status).toBe(201);
    // A different forged prefix, same real client (appended by "our proxy"): still limited.
    const second = await register(server.base, 'second_forger', '2.2.2.2, 198.51.100.20');
    expect(second.status).toBe(429);
    // Another real client behind the same proxy has its own allowance.
    expect((await register(server.base, 'honest_user', '198.51.100.21')).status).toBe(201);
  });

  it('in dev mode loopback clients share no per-address limits, but failed logins still lock a username', async () => {
    server = await startTestServer({ exemptLoopback: true, limits: { registrationsPerIp: 1, loginFailures: 2, loginAttemptsPerIp: 1 } });
    for (const name of ['dev_one', 'dev_two', 'dev_three']) expect((await register(server.base, name)).status).toBe(201);
    for (let k = 0; k < 2; k++) {
      expect((await api(server.base, 'POST', '/api/login', { username: 'dev_one', password: 'wrong password' })).status).toBe(401);
    }
    expect((await api(server.base, 'POST', '/api/login', { username: 'dev_one', password: 'long enough pass' })).status).toBe(429);
    expect((await api<AuthResponse>(server.base, 'POST', '/api/login', { username: 'dev_two', password: 'long enough pass' })).status).toBe(200);
  });

  it('caps the characters of one account in play at once (1008), without blocking a reconnect', async () => {
    server = await startTestServer({ maxCharactersPerAccount: 1 });
    const p = await newPlayer(server.base);
    const alt = await api<{ character: { id: string } }>(server.base, 'POST', '/api/characters', { name: 'Second Alt' }, p.token);
    expect(alt.status).toBe(201);
    const main = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
    clients.push(main);
    await main.waitFor('zone');
    const second = await TestClient.connect(server.base, { token: p.token, character: alt.body.character.id });
    clients.push(second);
    const closed = await second.waitClose();
    expect(closed.code).toBe(1008);
    expect(closed.reason).toMatch(/At most 1 character/);
    // The same character again simply replaces the old socket.
    const again = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
    clients.push(again);
    await again.waitFor('zone');
    expect((await main.waitClose()).code).toBe(4003);
  });

  it('caps open sockets per address (1008)', async () => {
    server = await startTestServer({ maxConnectionsPerIp: 2 });
    const players = [await newPlayer(server.base), await newPlayer(server.base), await newPlayer(server.base)];
    const a = await TestClient.connect(server.base, { token: players[0].token, character: players[0].characterId });
    const b = await TestClient.connect(server.base, { token: players[1].token, character: players[1].characterId });
    clients.push(a, b);
    await a.waitFor('zone');
    await b.waitFor('zone');
    const c = await TestClient.connect(server.base, { token: players[2].token, character: players[2].characterId });
    clients.push(c);
    expect((await c.waitClose()).code).toBe(1008);
    // Once one closes, there is room again.
    a.close();
    await a.waitClose();
    await new Promise((r) => setTimeout(r, 50));
    const d = await TestClient.connect(server.base, { token: players[2].token, character: players[2].characterId });
    clients.push(d);
    await d.waitFor('zone');
  });
});

describe('password hashing', () => {
  it(`runs at most ${MAX_CONCURRENT_HASHES} scrypt hashes at once; the rest queue`, async () => {
    const jobs = Array.from({ length: 6 }, () => hashPassword('correct horse battery'));
    expect(hashLoad()).toEqual({ active: MAX_CONCURRENT_HASHES, queued: 6 - MAX_CONCURRENT_HASHES });
    const results = await Promise.all(jobs);
    expect(new Set(results.map((r) => r.hash)).size).toBe(6);
    expect(hashLoad()).toEqual({ active: 0, queued: 0 });
  });
});
