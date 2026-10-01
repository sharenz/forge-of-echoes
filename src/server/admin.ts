// Local admin channel of the running server, used by the `foe` CLI (src/cli/foe.ts). Never public:
//   * a unix domain socket `<data dir>/admin.sock`, mode 0600 (only the service user and root can connect), and
//   * a shared secret `<data dir>/admin.token` (mode 0600, regenerated on every start) sent with every request.
// Caddy only proxies the TCP game port, so nothing here is reachable from the network.
// Protocol: one JSON object per line in, one JSON line out: { token, cmd, ...args } -> { ok, ... } | { ok:false, error }.
//   ping                                     liveness and pid
//   online                                   every character in play (account, level, place, party)
//   kick      { accounts?, characters? }     disconnect and end those sessions
//   lock      { accounts?|'all', characters?, kick, purge }
//                                            refuse logins for them, optionally kick the ones in play (kick=false and
//                                            someone online -> refused), and purge their parties / open maps from
//                                            memory (purge) so a database reset is not undone by stale state
//   unlock                                   lift every lock (locks also expire by themselves after lockTtlMs)
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { join } from 'node:path';
import type { GameDatabase } from './db';
import { CLOSE_POLICY } from './game';
import type { Game } from './game';
import { MapInstance } from './instance';
import type { Logger } from './log';

export const ADMIN_SOCKET_FILE = 'admin.sock';
export const ADMIN_TOKEN_FILE = 'admin.token';
const MAX_LINE = 64 * 1024;
const KICK_REASON = 'An administrator ended your session. Please log in again in a moment.';

export interface AdminOnlinePlayer {
  accountId: string;
  account: string;
  characterId: string;
  character: string;
  level: number;
  connected: boolean;
  place: string;
  party: string[];
}

export interface AdminChannel {
  readonly socketPath: string;
  readonly tokenPath: string;
  /** True while logins of this account/character are refused by a `lock`. */
  isLocked(accountId: string, characterId?: string): boolean;
  close(): Promise<void>;
}

export interface AdminOptions {
  /** Directory for the socket and token files (the database directory). */
  dir: string;
  game: Game;
  db: GameDatabase;
  log: Logger;
  now?: () => number;
  /** A lock lifts itself after this long if the CLI died (default 10 min). */
  lockTtlMs?: number;
}

type Request = Record<string, unknown> & { token?: unknown; cmd?: unknown };

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export async function startAdminChannel(opts: AdminOptions): Promise<AdminChannel> {
  const { game, db, log } = opts;
  const now = opts.now ?? Date.now;
  const ttl = opts.lockTtlMs ?? 10 * 60_000;
  const socketPath = join(opts.dir, ADMIN_SOCKET_FILE);
  const tokenPath = join(opts.dir, ADMIN_TOKEN_FILE);
  const token = randomBytes(32).toString('hex');
  const tokenDigest = digest(token);
  writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
  chmodSync(tokenPath, 0o600);

  const lock = { all: false, accounts: new Set<string>(), characters: new Set<string>(), until: 0 };
  const lockActive = (): boolean => lock.until > now();
  const clearLock = (): void => { lock.all = false; lock.accounts.clear(); lock.characters.clear(); lock.until = 0; };

  const accountName = (id: string): string => db.accountById(id)?.username ?? id;
  const scopeCharacters = (req: Request): { accountIds: Set<string> | 'all'; characterIds: Set<string> } => {
    const characterIds = new Set(strings(req.characters));
    if (req.accounts === 'all') return { accountIds: 'all', characterIds };
    const accountIds = new Set(strings(req.accounts));
    return { accountIds, characterIds };
  };
  const inScope = (s: { accountId: string; characterId: string }, sc: ReturnType<typeof scopeCharacters>): boolean =>
    sc.accountIds === 'all' || sc.accountIds.has(s.accountId) || sc.characterIds.has(s.characterId);

  const place = (s: ReturnType<Game['sessions']['values']> extends Iterator<infer S> ? S : never): string => {
    const inst = s.instance;
    if (!inst) return 'loading';
    return inst.kind === 'hideout' ? (inst.ownerId === s.characterId ? 'hideout' : `${inst.ownerName}'s hideout`) : `map: ${inst.mapName}`;
  };

  const online = (): AdminOnlinePlayer[] => [...game.sessions.values()].map((s) => ({
    accountId: s.accountId,
    account: accountName(s.accountId),
    characterId: s.characterId,
    character: s.name,
    level: s.record.ch.level,
    connected: s.online,
    place: place(s),
    party: game.parties.partyOf(s.characterId)?.members.map((id) => game.nameOf(id)) ?? [],
  }));

  function kick(sc: ReturnType<typeof scopeCharacters>): string[] {
    const names: string[] = [];
    for (const s of [...game.sessions.values()]) {
      if (!inScope(s, sc)) continue;
      names.push(`${accountName(s.accountId)}/${s.name}`);
      try { s.conn?.close(CLOSE_POLICY, KICK_REASON); } catch (err) { log.warn('admin kick: close failed', { err }); }
      game.guard('admin kick', () => game.endSession(s));
    }
    return names;
  }

  /** Drop parties and open maps of the affected characters from memory (their rows are deleted by the CLI afterwards). */
  function purge(sc: ReturnType<typeof scopeCharacters>): { parties: number; maps: number } {
    const ids = new Set(sc.characterIds);
    if (sc.accountIds === 'all') {
      for (const party of game.parties.list()) for (const m of party.members) ids.add(m);
      for (const inst of game.instances.list()) if (inst instanceof MapInstance) ids.add(inst.ownerId);
    } else {
      for (const a of sc.accountIds) for (const c of db.listCharacters(a)) ids.add(c.id);
    }
    let parties = 0, maps = 0;
    for (const inst of [...game.instances.list()]) {
      if (inst instanceof MapInstance && !inst.disposed && ids.has(inst.ownerId)) {
        game.guard('admin close map', () => game.closeMap(inst, 'shutdown'));
        maps++;
      }
    }
    for (const id of ids) if (game.parties.partyOf(id)) { game.guard('admin leave party', () => game.forgetCharacter(id)); parties++; }
    return { parties, maps };
  }

  function handle(req: Request): Record<string, unknown> {
    switch (req.cmd) {
      case 'ping': return { ok: true, pid: process.pid, players: game.sessions.size };
      case 'online': return { ok: true, players: online() };
      case 'kick': {
        const kicked = kick(scopeCharacters(req));
        return { ok: true, kicked };
      }
      case 'lock': {
        const sc = scopeCharacters(req);
        const present = online().filter((p) => inScope(p, sc));
        if (present.length > 0 && req.kick !== true) return { ok: false, error: 'players are online', players: present };
        const kicked = kick(sc);
        const purged = req.purge === true ? purge(sc) : { parties: 0, maps: 0 };
        if (sc.accountIds === 'all') lock.all = true;
        else for (const a of sc.accountIds) lock.accounts.add(a);
        for (const c of sc.characterIds) lock.characters.add(c);
        lock.until = now() + ttl;
        log.warn('admin lock', { all: lock.all, accounts: lock.accounts.size, characters: lock.characters.size, kicked: kicked.length, ...purged });
        return { ok: true, kicked, ...purged, expiresInMs: ttl };
      }
      case 'unlock': {
        clearLock();
        log.info('admin unlock');
        return { ok: true };
      }
      default: return { ok: false, error: `unknown command ${String(req.cmd)}` };
    }
  }

  function onLine(socket: Socket, line: string): void {
    let res: Record<string, unknown>;
    try {
      const req = JSON.parse(line) as Request;
      if (typeof req !== 'object' || req === null || typeof req.token !== 'string' || !timingSafeEqual(digest(req.token), tokenDigest)) {
        log.warn('admin request rejected: bad token');
        res = { ok: false, error: 'unauthorized' };
      } else {
        res = handle(req);
        if (req.cmd !== 'ping' && req.cmd !== 'online') log.info('admin command', { cmd: String(req.cmd), ok: res.ok });
      }
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : 'bad request' };
    }
    socket.end(JSON.stringify(res) + '\n');
  }

  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = '';
    socket.setEncoding('utf8');
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE) return void socket.destroy();
      const nl = buf.indexOf('\n');
      if (nl >= 0) { const line = buf.slice(0, nl); buf = ''; socket.removeAllListeners('data'); onLine(socket, line); }
    });
  });
  if (existsSync(socketPath)) unlinkSync(socketPath); // stale file of a crashed run
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(); });
  });
  chmodSync(socketPath, 0o600);
  server.on('error', (err) => log.error('admin channel error', { err }));
  log.info('admin channel listening', { socket: socketPath });

  return {
    socketPath,
    tokenPath,
    isLocked(accountId, characterId) {
      if (!lockActive()) { if (lock.until !== 0) clearLock(); return false; }
      return lock.all || lock.accounts.has(accountId) || (characterId !== undefined && lock.characters.has(characterId));
    },
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const s of sockets) s.destroy();
      for (const f of [socketPath, tokenPath]) { try { unlinkSync(f); } catch { /* already gone */ } }
    }),
  };
}
