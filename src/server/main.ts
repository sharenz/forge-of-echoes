// Game server entry: `npx tsx src/server/main.ts`
//   PORT        listen port (default 8787)
//   DB_PATH     SQLite database file (default data/dev.db; ':memory:' for a throwaway server)
//   NODE_ENV    'production' also serves the built client (dist/, or STATIC_DIR) with an SPA fallback
//   TRUST_PROXY number of reverse proxies of yours in front of the server (e.g. '1' behind one nginx):
//               the client IP is taken that many entries from the right of X-Forwarded-For, and only
//               from loopback/private peers. Unset/0 = the socket peer is the client.
//   RATE_LIMITS 'dev' exempts loopback clients from the per-IP limits (everyone behind the Vite proxy is
//               127.0.0.1), 'strict' does not. Default: 'strict' in production, 'dev' otherwise.
//   DRAIN_SECONDS  on SIGTERM the server announces the update, keeps running this long, then saves and
//               closes every socket with 4004 (clients reconnect on their own). Default 20 in production,
//               0 otherwise (so `tsx watch` restarts stay instant). SIGINT, or a second signal, skips it.
//               The systemd unit's TimeoutStopSec must exceed it (scripts/deploy/forge.service: 60 s).
//   ADMIN_DIR   where the local admin socket/token for the `foe` CLI live (default: the database directory)
//   UV_THREADPOOL_SIZE  defaults to 8 here (see threadpool.ts)
import './threadpool';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_PORT } from '../contracts/net';
import { createConsoleLogger } from './log';
import { startServer } from './server';

const log = createConsoleLogger();

// Every async path in the server is wrapped; these are the last line of defence and must not kill the
// process (one bad handler would otherwise disconnect every player).
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { err: reason }));
process.on('uncaughtException', (err) => log.error('uncaught exception', { err }));

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? SERVER_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid PORT ${process.env.PORT}`);
  const dbPath = process.env.DB_PATH ?? 'data/dev.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const production = process.env.NODE_ENV === 'production';
  const staticDir = production
    ? resolve(process.env.STATIC_DIR ?? fileURLToPath(new URL('../../dist', import.meta.url)))
    : null;

  const trustRaw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  const trustProxy = trustRaw === 'true' ? 1 : /^\d+$/.test(trustRaw) ? Number(trustRaw) : 0;
  const rateLimits = process.env.RATE_LIMITS ?? (production ? 'strict' : 'dev');
  if (rateLimits !== 'strict' && rateLimits !== 'dev') throw new Error(`invalid RATE_LIMITS ${rateLimits} (use 'strict' or 'dev')`);
  const drainRaw = (process.env.DRAIN_SECONDS ?? '').trim();
  const drainSeconds = drainRaw === '' ? (production ? 20 : 0) : Number(drainRaw);
  if (!Number.isFinite(drainSeconds) || drainSeconds < 0 || drainSeconds > 600) throw new Error(`invalid DRAIN_SECONDS ${drainRaw} (0–600)`);

  const server = await startServer({ port, dbPath, logger: log, staticDir, trustProxy, exemptLoopback: rateLimits === 'dev', drainSeconds, adminDir: dbPath === ':memory:' ? null : process.env.ADMIN_DIR ?? dirname(resolve(dbPath)) });
  log.info('restart drain', { seconds: drainSeconds });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      // A second signal: stop draining and shut down now.
      log.info('skipping the drain', { signal });
      server.skipDrain();
      return;
    }
    stopping = true;
    const drain = signal === 'SIGTERM' ? drainSeconds : 0;
    log.info('shutting down', { signal, drainSeconds: drain });
    const force = setTimeout(() => {
      log.error('shutdown timed out; exiting');
      process.exit(1);
    }, drain * 1000 + 8000);
    force.unref();
    server
      .close({ drainSeconds: drain })
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        log.error('shutdown failed', { err });
        process.exit(1);
      });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((err: unknown) => {
  log.error('server failed to start', { err });
  process.exit(1);
});
