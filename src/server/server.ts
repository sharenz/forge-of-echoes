// startServer(): SQLite + HTTP API (+ static client in production) + the WebSocket endpoint /ws + the Game.
// On start the Game restores the parties and open maps of the previous run; close() first drains (announces
// the restart and keeps the world running for `drainSeconds`), then kicks everyone with 4004 and saves.
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { MAX_PARTY_SIZE, PROTOCOL_VERSION } from '../contracts/net';
import { MAX_CLIENT_MESSAGE_LENGTH } from '../net';
import { hashToken, isWellFormedToken } from './auth';
import { CharacterStore } from './characters';
import { WsConnection } from './connection';
import { GameDatabase } from './db';
import { CLOSE_BAD_AUTH, CLOSE_POLICY, CLOSE_PROTOCOL, CLOSE_SERVER_ERROR, CLOSE_SHUTDOWN, Game } from './game';
import type { GameOptions } from './game';
import { DEFAULT_HTTP_LIMITS, createApiHandler, sendJson } from './http-api';
import type { HttpLimits } from './http-api';
import { createConsoleLogger } from './log';
import type { Logger } from './log';
import { clientIp, isLoopback } from './net-address';
import { WindowLimiter } from './rate-limit';
import { createStaticHandler } from './static';

export interface ServerOptions {
  /** TCP port (0 = any free port). Default 8787. */
  port?: number;
  host?: string;
  /** SQLite file, or ':memory:'. Default 'data/dev.db'. */
  dbPath?: string;
  logger?: Logger;
  /** Serve the built client from this directory (production); null/undefined = API + WebSocket only. */
  staticDir?: string | null;
  /**
   * Reverse proxies of ours in front of the server: the client address is taken from X-Forwarded-For,
   * that many entries from the right, and only when the socket peer is a loopback/private address.
   * true = 1. Default 0 (the socket peer is the client).
   */
  trustProxy?: boolean | number;
  /**
   * Loopback clients skip the per-IP limits (HTTP requests, login attempts, registrations, WebSocket
   * connection attempts and concurrent sockets). For development, where the Vite proxy makes every player
   * 127.0.0.1. Default false.
   */
  exemptLoopback?: boolean;
  limits?: Partial<HttpLimits>;
  /** WebSocket connection attempts per IP per minute. */
  wsConnectionsPerMinute?: number;
  /** Open WebSockets per IP at once (default 16). */
  maxConnectionsPerIp?: number;
  /** Characters of one account in play at once (default MAX_PARTY_SIZE). */
  maxCharactersPerAccount?: number;
  /** Game tuning (tests shorten the timers or tick manually). */
  game?: Partial<Pick<GameOptions, 'autoTick' | 'reconnectGraceMs' | 'hideoutIdleMs' | 'mapIdleMs' | 'now' | 'entropy' | 'privateLootRng'>>;
  /** Debounce for character saves (default 1000 ms). */
  saveDebounceMs?: number;
  /**
   * close() announces the restart and keeps simulating this long before it disconnects everyone (4004).
   * Default 0 (tests); main.ts passes DRAIN_SECONDS.
   */
  drainSeconds?: number;
}

export interface ServerHandle {
  /** The port actually listened on. */
  readonly port: number;
  /**
   * Graceful shutdown: drain (announce, keep running for `drainSeconds` — `opts.drainSeconds` overrides
   * ServerOptions.drainSeconds; skipped when nobody is online), then kick everyone (4004), keep parties and
   * open maps for the next start, flush saves, close the database. Calling it again returns the same promise.
   */
  close(opts?: { drainSeconds?: number }): Promise<void>;
  /** Cut a running drain short (a second signal): the shutdown continues at once. */
  skipDrain(): void;
  /** The live game (diagnostics and tests). */
  readonly game: Game;
  readonly db: GameDatabase;
}

const HEARTBEAT_MS = 15_000;
/** Heartbeat round trips above this are logged (once per connection) to explain "my friend lags". */
const HIGH_RTT_MS = 300;
/** ws frame limit: the largest valid client message is MAX_CLIENT_MESSAGE_LENGTH chars (≤ 4 bytes each). */
const WS_MAX_PAYLOAD = MAX_CLIENT_MESSAGE_LENGTH * 4;

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  const log = opts.logger ?? createConsoleLogger();
  const now = opts.game?.now ?? Date.now;
  const dbPath = opts.dbPath ?? 'data/dev.db';
  const db = await GameDatabase.open(dbPath);
  const purged = db.purgeExpiredSessions(now());
  const store = new CharacterStore(db, log, { saveDebounceMs: opts.saveDebounceMs ?? 1000, now });
  const game = new Game({ db, store, logger: log, ...opts.game });
  // Parties and open maps of the previous run (restart safety): before anyone can connect.
  game.restore();
  const limits: HttpLimits = { ...DEFAULT_HTTP_LIMITS, ...opts.limits };
  const trustProxy = opts.trustProxy === true ? 1 : opts.trustProxy === false || opts.trustProxy === undefined ? 0 : Math.max(0, Math.floor(opts.trustProxy));
  const exemptLoopback = opts.exemptLoopback ?? false;
  const wsPerMinute = opts.wsConnectionsPerMinute ?? 60;
  const maxConnectionsPerIp = opts.maxConnectionsPerIp ?? 16;
  const maxCharactersPerAccount = opts.maxCharactersPerAccount ?? MAX_PARTY_SIZE;
  const api = createApiHandler({ db, store, game, log, limits, now, trustProxy, exemptLoopback });
  const serveStatic = opts.staticDir ? createStaticHandler(opts.staticDir) : null;

  const httpServer: Server = createServer((req, res) => {
    api(req, res)
      .then(async (handled) => {
        if (handled) return;
        if (serveStatic) await serveStatic(req, res);
        else sendJson(res, 404, { error: 'Not found.' });
      })
      .catch((err: unknown) => {
        log.error('request failed', { url: req.url, err });
        if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server. Please try again.' });
        else res.destroy();
      });
  });
  httpServer.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  // --- WebSocket ------------------------------------------------------------------------------
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD,
    // CharacterSave / zone JSON compresses ~10×; binary snapshots are sent uncompressed (see WsConnection).
    perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 3 }, concurrencyLimit: 8 },
  });
  const wsAttempts = new WindowLimiter(wsPerMinute, 60_000);
  const alive = new WeakMap<WebSocket, boolean>();
  /** Open sockets per client address. */
  const openPerIp = new Map<string, number>();
  const pingSentAt = new WeakMap<WebSocket, number>();

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let path = '';
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // fall through: rejected below
    }
    if (path !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientIp(req, trustProxy);
    const limited = !(exemptLoopback && isLoopback(ip));
    const conn = new WsConnection(ws, ip);
    alive.set(ws, true);
    openPerIp.set(ip, (openPerIp.get(ip) ?? 0) + 1);
    let highRttLogged = false;
    ws.on('pong', () => {
      alive.set(ws, true);
      const sent = pingSentAt.get(ws);
      if (sent === undefined) return;
      const rtt = Date.now() - sent;
      if (rtt > HIGH_RTT_MS && !highRttLogged) {
        highRttLogged = true;
        log.warn('high latency', { ip, rttMs: rtt, character: game.characterOf(conn)?.name });
      }
    });
    ws.on('error', (err) => log.warn('socket error', { ip, err: err.message }));
    ws.on('message', (data, isBinary) => game.guard('message', () => game.onMessage(conn, data, isBinary)));
    ws.on('close', () => {
      const n = (openPerIp.get(ip) ?? 1) - 1;
      if (n > 0) openPerIp.set(ip, n);
      else openPerIp.delete(ip);
      game.guard('detach', () => game.detach(conn));
    });

    game.guard('connect', () => {
      if (game.isClosed) return conn.close(CLOSE_SHUTDOWN, 'The server is shutting down.');
      const t = now();
      if (limited) {
        if (wsAttempts.retryAfter(ip, t) > 0) return conn.close(CLOSE_POLICY, 'Too many connection attempts.');
        wsAttempts.hit(ip, t);
        if ((openPerIp.get(ip) ?? 0) > maxConnectionsPerIp) return conn.close(CLOSE_POLICY, 'Too many connections from your network.');
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const version = url.searchParams.get('v');
      if (version !== String(PROTOCOL_VERSION)) {
        return conn.close(CLOSE_PROTOCOL, 'The game was updated. Please reload.');
      }
      const token = url.searchParams.get('token');
      const account = isWellFormedToken(token) ? db.sessionAccount(hashToken(token), t) : null;
      if (!account || !isWellFormedToken(token)) return conn.close(CLOSE_BAD_AUTH, 'Your session has expired. Please log in again.');
      const characterId = url.searchParams.get('character') ?? '';
      if (!/^[A-Za-z0-9_:.\-]{1,64}$/.test(characterId) || store.ownerOf(characterId) !== account.id) {
        return conn.close(CLOSE_BAD_AUTH, 'That character does not belong to this account.');
      }
      if (game.charactersInPlay(account.id, characterId) >= maxCharactersPerAccount) {
        return conn.close(CLOSE_POLICY, `At most ${maxCharactersPerAccount} characters of one account can play at once.`);
      }
      if (!game.attach(conn, characterId, hashToken(token))) {
        conn.close(CLOSE_SERVER_ERROR, 'That character could not be loaded.');
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      pingSentAt.set(ws, Date.now());
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const sessionSweep = setInterval(() => {
    try {
      db.purgeExpiredSessions(now());
    } catch (err) {
      log.warn('session purge failed', { err });
    }
  }, 60 * 60_000);
  sessionSweep.unref?.();

  // --- listen -----------------------------------------------------------------------------------
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(opts.port ?? 8787, opts.host, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });
  httpServer.on('error', (err) => log.error('http server error', { err }));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 8787);
  game.start();
  log.info('listening', { port, db: dbPath, static: opts.staticDir ?? 'off', purgedSessions: purged, threadPool: Number(process.env.UV_THREADPOOL_SIZE ?? 4) });
  log.info('limits', {
    registrationsPerHour: Math.round((limits.registrationsPerIp * 3_600_000) / limits.registrationWindowMs),
    loginAttempts: `${limits.loginAttemptsPerIp}/${Math.round(limits.loginWindowMs / 60_000)}min`,
    failedLoginsPerUser: limits.loginFailures,
    wsPerMinute,
    socketsPerIp: maxConnectionsPerIp,
    charactersPerAccount: maxCharactersPerAccount,
    trustedProxies: trustProxy,
    loopbackExempt: exemptLoopback,
  });

  let closing: Promise<void> | null = null;
  let endDrain: (() => void) | null = null;
  function skipDrain(): void {
    endDrain?.();
  }
  async function close(closeOpts: { drainSeconds?: number } = {}): Promise<void> {
    if (closing) return closing;
    const drainSeconds = Math.max(0, closeOpts.drainSeconds ?? opts.drainSeconds ?? 0);
    closing = (async () => {
      // Nobody online: nobody to warn, so no reason to wait.
      if (drainSeconds > 0 && !game.isClosed && game.sessions.size > 0) {
        game.beginDrain(drainSeconds);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, drainSeconds * 1000);
          endDrain = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        endDrain = null;
      }
      clearInterval(heartbeat);
      clearInterval(sessionSweep);
      game.shutdown();
      // Let the 4004 close frames go out, then drop whatever is left.
      const deadline = Date.now() + 1000;
      while (wss.clients.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
      store.flushAll();
      db.close();
      log.info('stopped');
    })();
    return closing;
  }

  return { port, close, skipDrain, game, db };
}
