// HTTP JSON API (contracts/net.ts): accounts, sessions and the character list.
//   POST /api/register · POST /api/login · POST /api/logout · GET /api/me
//   POST /api/characters · DELETE /api/characters/:id · GET /api/health
// Errors are { error: string } with a player-facing text and a fitting status code.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROTOCOL_VERSION } from '../contracts/net';
import type { AccountInfo, AuthResponse, MeResponse } from '../contracts/net';
import {
  SESSION_TTL_MS, burnPasswordCheck, hashPassword, hashToken, isWellFormedToken, newSessionToken, validatePassword, validateUsername,
  verifyPassword,
} from './auth';
import type { CharacterStore } from './characters';
import type { AccountRow, GameDatabase } from './db';
import type { Game } from './game';
import type { Logger } from './log';
import { clientIp, isLoopback } from './net-address';
import { WindowLimiter, describeWait } from './rate-limit';

/** Largest accepted request body. */
export const MAX_BODY_BYTES = 16 * 1024;

export interface HttpLimits {
  /** Failed logins per (IP, username) per window. */
  loginFailures: number;
  /** Login attempts per IP per window (any username). */
  loginAttemptsPerIp: number;
  loginWindowMs: number;
  /** New accounts per IP per window. */
  registrationsPerIp: number;
  registrationWindowMs: number;
  /** API requests per IP per minute (all endpoints). */
  requestsPerMinute: number;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = {
  loginFailures: 5,
  loginAttemptsPerIp: 40,
  loginWindowMs: 15 * 60_000,
  registrationsPerIp: 5,
  registrationWindowMs: 60 * 60_000,
  requestsPerMinute: 600,
};

export interface ApiContext {
  db: GameDatabase;
  store: CharacterStore;
  game: Game;
  log: Logger;
  limits: HttpLimits;
  now: () => number;
  /** Reverse proxies of ours in front of the server (0 = none; see net-address.ts). */
  trustProxy: number;
  /**
   * Development: loopback clients skip the per-IP limits (requests, login attempts, registrations). Behind
   * the Vite dev proxy every player arrives from 127.0.0.1, so per-IP limits would be shared by all of them.
   * The per-(IP, username) failed-login lock still applies.
   */
  exemptLoopback: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const CHARACTER_ID_RE = /^[A-Za-z0-9_:.\-]{1,64}$/;

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'That request is too large.'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, 'That request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object.');
  return value as Record<string, unknown>;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function accountInfo(a: AccountRow): AccountInfo {
  return { id: a.id, username: a.username };
}

/** The HTTP API. Returns a request handler that answers every /api/* request (and ignores the rest). */
export function createApiHandler(ctx: ApiContext): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { db, store, game, log, limits, now } = ctx;
  const requestLimiter = new WindowLimiter(limits.requestsPerMinute, 60_000);
  const loginFailures = new WindowLimiter(limits.loginFailures, limits.loginWindowMs);
  const loginAttempts = new WindowLimiter(limits.loginAttemptsPerIp, limits.loginWindowMs);
  const registrations = new WindowLimiter(limits.registrationsPerIp, limits.registrationWindowMs);

  function tooMany(retryMs: number, what: string): HttpError {
    return new HttpError(429, `${what} Try again in ${describeWait(retryMs)}.`, { 'Retry-After': String(Math.ceil(retryMs / 1000)) });
  }

  function authenticate(req: IncomingMessage): AccountRow {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Please log in.');
    const account = isWellFormedToken(token) ? db.sessionAccount(hashToken(token), now()) : null;
    if (!account) throw new HttpError(401, 'Your session has expired. Please log in again.');
    return account;
  }

  function issueSession(account: AccountRow): AuthResponse {
    const token = newSessionToken();
    db.createSession(hashToken(token), account.id, now() + SESSION_TTL_MS);
    return { token, account: accountInfo(account) };
  }

  const limited = (ip: string) => !(ctx.exemptLoopback && isLoopback(ip));

  async function register(req: IncomingMessage, ip: string): Promise<[number, AuthResponse]> {
    const body = await readJsonObject(req);
    const usernameError = validateUsername(body.username);
    if (usernameError) throw new HttpError(400, usernameError);
    const passwordError = validatePassword(body.password);
    if (passwordError) throw new HttpError(400, passwordError);
    const username = body.username as string;
    const password = body.password as string;
    const wait = limited(ip) ? registrations.retryAfter(ip, now()) : 0;
    if (wait > 0) throw tooMany(wait, 'Too many new accounts from your network.');
    if (db.accountByUsername(username)) throw new HttpError(409, 'That username is already taken.');
    const { hash, salt } = await hashPassword(password);
    const account: AccountRow = { id: randomUUID(), username, passHash: hash, salt, created: now() };
    if (!db.createAccount(account)) throw new HttpError(409, 'That username is already taken.');
    if (limited(ip)) registrations.hit(ip, now());
    log.info('account registered', { username, ip });
    return [201, issueSession(account)];
  }

  async function login(req: IncomingMessage, ip: string): Promise<AuthResponse> {
    const body = await readJsonObject(req);
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new HttpError(400, 'Enter your username and password.');
    }
    if (username.length > 64 || password.length > 1024) throw new HttpError(401, 'Wrong username or password.');
    const userKey = `${ip}|${username.toLowerCase()}`;
    const t = now();
    const waitUser = loginFailures.retryAfter(userKey, t);
    if (waitUser > 0) throw tooMany(waitUser, 'Too many failed logins.');
    if (limited(ip)) {
      const waitIp = loginAttempts.retryAfter(ip, t);
      if (waitIp > 0) throw tooMany(waitIp, 'Too many login attempts.');
      loginAttempts.hit(ip, t);
    }
    const account = db.accountByUsername(username);
    let valid = false;
    if (account) valid = await verifyPassword(password, account.passHash, account.salt);
    else await burnPasswordCheck(password);
    if (!account || !valid) {
      loginFailures.hit(userKey, now());
      throw new HttpError(401, 'Wrong username or password.');
    }
    loginFailures.reset(userKey);
    return issueSession(account);
  }

  function logout(req: IncomingMessage): { ok: true } {
    const token = bearer(req);
    if (token && isWellFormedToken(token)) {
      const hash = hashToken(token);
      db.deleteSession(hash);
      game.kickToken(hash);
    }
    return { ok: true };
  }

  function me(req: IncomingMessage): MeResponse {
    const account = authenticate(req);
    return { account: accountInfo(account), characters: store.list(account.id) };
  }

  async function createCharacter(req: IncomingMessage): Promise<[number, unknown]> {
    const account = authenticate(req);
    const body = await readJsonObject(req);
    const result = store.create(account.id, body.name);
    if (!result.ok) throw new HttpError(result.status, result.error);
    log.info('character created', { username: account.username, character: result.character.name });
    return [201, { character: result.character }];
  }

  function deleteCharacter(req: IncomingMessage, id: string): { ok: true } {
    const account = authenticate(req);
    if (!CHARACTER_ID_RE.test(id) || store.ownerOf(id) !== account.id) throw new HttpError(404, 'That character does not exist.');
    if (game.isInPlay(id)) throw new HttpError(409, 'That character is still in the game. Leave the game with it first.');
    if (!store.delete(account.id, id)) throw new HttpError(404, 'That character does not exist.');
    game.forgetCharacter(id);
    log.info('character deleted', { username: account.username, character: id });
    return { ok: true };
  }

  function methodNotAllowed(allow: string): HttpError {
    return new HttpError(405, 'That method is not allowed here.', { Allow: allow });
  }

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return false;
    const ip = clientIp(req, ctx.trustProxy);
    const method = req.method ?? 'GET';
    try {
      if (limited(ip)) {
        const wait = requestLimiter.retryAfter(ip, now());
        if (wait > 0) throw tooMany(wait, 'Too many requests.');
        requestLimiter.hit(ip, now());
      }

      const charMatch = /^\/api\/characters\/([^/]+)$/.exec(path);
      if (path === '/api/health') {
        if (method !== 'GET' && method !== 'HEAD') throw methodNotAllowed('GET');
        sendJson(res, 200, { ok: true, protocol: PROTOCOL_VERSION });
      } else if (path === '/api/register') {
        if (method !== 'POST') throw methodNotAllowed('POST');
        const [status, body] = await register(req, ip);
        sendJson(res, status, body);
      } else if (path === '/api/login') {
        if (method !== 'POST') throw methodNotAllowed('POST');
        sendJson(res, 200, await login(req, ip));
      } else if (path === '/api/logout') {
        if (method !== 'POST') throw methodNotAllowed('POST');
        sendJson(res, 200, logout(req));
      } else if (path === '/api/me') {
        if (method !== 'GET') throw methodNotAllowed('GET');
        sendJson(res, 200, me(req));
      } else if (path === '/api/characters') {
        if (method !== 'POST') throw methodNotAllowed('POST');
        const [status, body] = await createCharacter(req);
        sendJson(res, status, body);
      } else if (charMatch) {
        if (method !== 'DELETE') throw methodNotAllowed('DELETE');
        let id: string;
        try {
          id = decodeURIComponent(charMatch[1]);
        } catch {
          throw new HttpError(404, 'That character does not exist.');
        }
        sendJson(res, 200, deleteCharacter(req, id));
      } else {
        throw new HttpError(404, 'Not found.');
      }
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendJson(res, err.status, { error: err.message }, err.headers);
        if (err.status === 413) req.socket.destroySoon?.();
      } else {
        log.error('http handler failed', { method, path, err });
        if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server. Please try again.' });
        else res.destroy();
      }
    }
    return true;
  };
}
