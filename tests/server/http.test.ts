// HTTP API: accounts, sessions, rate limits, character CRUD and ownership.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthResponse, CharacterSummary, MeResponse } from '../../src/contracts/net';
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { MAX_CHARACTERS_PER_ACCOUNT } from '../../src/server';
import { api, startTestServer } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

describe('auth', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('reports health and the protocol version', async () => {
    const r = await api(server.base, 'GET', '/api/health');
    expect(r).toEqual({ status: 200, body: { ok: true, protocol: PROTOCOL_VERSION } });
  });

  it('registers, logs in, answers /me and logs out', async () => {
    const reg = await api<AuthResponse>(server.base, 'POST', '/api/register', { username: 'Mira_01', password: 'emberlance' });
    expect(reg.status).toBe(201);
    expect(reg.body.account.username).toBe('Mira_01');
    expect(reg.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await api<MeResponse>(server.base, 'GET', '/api/me', undefined, reg.body.token);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ account: reg.body.account, characters: [] });

    // Case-insensitive usernames: the same name in other case is taken, and logs in.
    const dup = await api(server.base, 'POST', '/api/register', { username: 'mira_01', password: 'something else' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/taken/);
    const login = await api<AuthResponse>(server.base, 'POST', '/api/login', { username: 'MIRA_01', password: 'emberlance' });
    expect(login.status).toBe(200);
    expect(login.body.account.id).toBe(reg.body.account.id);
    expect(login.body.token).not.toBe(reg.body.token);

    const out = await api(server.base, 'POST', '/api/logout', undefined, login.body.token);
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect((await api(server.base, 'GET', '/api/me', undefined, login.body.token)).status).toBe(401);
    // The other session is unaffected.
    expect((await api(server.base, 'GET', '/api/me', undefined, reg.body.token)).status).toBe(200);
  });

  it('validates usernames and passwords with player-facing errors', async () => {
    const cases: [unknown, unknown, RegExp][] = [
      ['ab', 'longenough', /at least 3/],
      ['a'.repeat(21), 'longenough', /at most 20/],
      ['bad name', 'longenough', /letters, digits and underscores/],
      [42, 'longenough', /Choose a username/],
      ['goodname', 'short', /at least 8/],
      ['goodname', 12345678, /Choose a password/],
    ];
    for (const [username, password, re] of cases) {
      const r = await api(server.base, 'POST', '/api/register', { username, password });
      expect(r.status, JSON.stringify({ username, password })).toBe(400);
      expect(String(r.body.error)).toMatch(re);
    }
  });

  it('rejects wrong passwords, unknown users, bad tokens, bad JSON and oversized bodies', async () => {
    await api(server.base, 'POST', '/api/register', { username: 'Brann', password: 'ironhide!' });
    const wrong = await api(server.base, 'POST', '/api/login', { username: 'Brann', password: 'ironhide?' });
    expect(wrong).toEqual({ status: 401, body: { error: 'Wrong username or password.' } });
    const unknown = await api(server.base, 'POST', '/api/login', { username: 'Nobody', password: 'ironhide!' });
    expect(unknown).toEqual({ status: 401, body: { error: 'Wrong username or password.' } });
    expect((await api(server.base, 'GET', '/api/me', undefined, 'not-a-token')).status).toBe(401);
    expect((await api(server.base, 'GET', '/api/me')).status).toBe(401);
    const badJson = await api(server.base, 'POST', '/api/login', '{nope');
    expect(badJson.status).toBe(400);
    const big = await api(server.base, 'POST', '/api/register', { username: 'Big', password: 'x'.repeat(40_000) });
    expect(big.status).toBe(413);
    expect((await api(server.base, 'GET', '/api/login')).status).toBe(405);
    expect((await api(server.base, 'GET', '/api/nothing')).status).toBe(404);
  });
});

describe('rate limits', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startTestServer({ limits: { loginFailures: 3, registrationsPerIp: 2 } });
  });
  afterAll(async () => {
    await server.close();
  });

  it('locks a username after repeated failed logins (per IP), and a correct password does not bypass it', async () => {
    await api(server.base, 'POST', '/api/register', { username: 'Target', password: 'rightpass' });
    for (let k = 0; k < 3; k++) {
      expect((await api(server.base, 'POST', '/api/login', { username: 'Target', password: 'wrongpass' })).status).toBe(401);
    }
    const locked = await api(server.base, 'POST', '/api/login', { username: 'target', password: 'rightpass' });
    expect(locked.status).toBe(429);
    expect(String(locked.body.error)).toMatch(/Too many failed logins\. Try again in \d+ minutes?\./);
    // Another username from the same IP is unaffected.
    expect((await api(server.base, 'POST', '/api/login', { username: 'Other', password: 'whatever1' })).status).toBe(401);
  });

  it('limits registrations per IP', async () => {
    // One registration already happened in the previous test; one more is allowed.
    expect((await api(server.base, 'POST', '/api/register', { username: 'Second', password: 'password2' })).status).toBe(201);
    const third = await api(server.base, 'POST', '/api/register', { username: 'Third', password: 'password3' });
    expect(third.status).toBe(429);
    expect(String(third.body.error)).toMatch(/Too many new accounts/);
  });
});

describe('characters', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  async function account(username: string): Promise<string> {
    const r = await api<AuthResponse>(server.base, 'POST', '/api/register', { username, password: 'password123' });
    return r.body.token;
  }

  it('creates, lists and deletes characters with ownership checks', async () => {
    const a = await account('owner_a');
    const b = await account('owner_b');
    const c1 = await api<{ character: CharacterSummary }>(server.base, 'POST', '/api/characters', { name: '  Ember   Witch ' }, a);
    expect(c1.status).toBe(201);
    expect(c1.body.character).toMatchObject({ name: 'Ember Witch', level: 1, classId: 'sorceress' });
    const c2 = await api<{ character: CharacterSummary }>(server.base, 'POST', '/api/characters', { name: 'Rime' }, a);
    expect(c2.status).toBe(201);

    const me = await api<MeResponse>(server.base, 'GET', '/api/me', undefined, a);
    expect(me.body.characters.map((c) => c.name)).toEqual(['Ember Witch', 'Rime']);
    expect((await api<MeResponse>(server.base, 'GET', '/api/me', undefined, b)).body.characters).toEqual([]);

    // Names are unique server-wide, case-insensitively.
    const taken = await api(server.base, 'POST', '/api/characters', { name: 'ember witch' }, b);
    expect(taken.status).toBe(409);
    expect(String(taken.body.error)).toMatch(/already taken/);

    // Someone else's character cannot be deleted (and does not leak its existence).
    const foreign = await api(server.base, 'DELETE', `/api/characters/${c1.body.character.id}`, undefined, b);
    expect(foreign.status).toBe(404);
    const del = await api(server.base, 'DELETE', `/api/characters/${c1.body.character.id}`, undefined, a);
    expect(del).toEqual({ status: 200, body: { ok: true } });
    expect((await api<MeResponse>(server.base, 'GET', '/api/me', undefined, a)).body.characters.map((c) => c.name)).toEqual(['Rime']);
    // The name is free again.
    expect((await api(server.base, 'POST', '/api/characters', { name: 'Ember Witch' }, b)).status).toBe(201);
    expect((await api(server.base, 'DELETE', '/api/characters/does-not-exist', undefined, a)).status).toBe(404);
    expect((await api(server.base, 'POST', '/api/characters', { name: 'Nope' })).status).toBe(401);
  });

  it('validates character names', async () => {
    const t = await account('namer');
    for (const name of ['ab', '1Wizard', 'x'.repeat(17), 'Émile', 'Bad<Name>', '', 42]) {
      const r = await api(server.base, 'POST', '/api/characters', { name }, t);
      expect(r.status, String(name)).toBe(400);
      expect(typeof r.body.error).toBe('string');
    }
    expect((await api(server.base, 'POST', '/api/characters', { name: "O'Hara-Ash_2" }, t)).status).toBe(201);
  });

  it(`allows at most ${MAX_CHARACTERS_PER_ACCOUNT} characters per account`, async () => {
    const t = await account('collector');
    for (let k = 0; k < MAX_CHARACTERS_PER_ACCOUNT; k++) {
      expect((await api(server.base, 'POST', '/api/characters', { name: `Alt Number ${String.fromCharCode(65 + k)}` }, t)).status).toBe(201);
    }
    const r = await api(server.base, 'POST', '/api/characters', { name: 'One Too Many' }, t);
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/at most 12/);
  });
});
