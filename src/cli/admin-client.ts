// Client of the server's local admin channel (src/server/admin.ts).
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import type { AdminOnlinePlayer } from '../server/admin';

export type AdminState = { state: 'ok'; pid: number } | { state: 'absent' } | { state: 'error'; error: string };

export interface AdminClient {
  probe(): Promise<AdminState>;
  call(cmd: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  online(): Promise<AdminOnlinePlayer[]>;
}

export function createAdminClient(dir: string, timeoutMs = 15_000): AdminClient {
  const socketPath = join(dir, 'admin.sock');
  const tokenPath = join(dir, 'admin.token');

  function call(cmd: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let token: string;
      try { token = readFileSync(tokenPath, 'utf8').trim(); }
      catch (err) { return reject(Object.assign(new Error(`cannot read ${tokenPath}: ${(err as Error).message}`), { code: (err as NodeJS.ErrnoException).code })); }
      const socket = connect(socketPath);
      let buf = '';
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('admin channel timed out')); }, timeoutMs);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(JSON.stringify({ token, cmd, ...args }) + '\n'));
      socket.on('data', (c: string) => { buf += c; });
      socket.on('error', (err) => { clearTimeout(timer); reject(err); });
      socket.on('close', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(buf) as Record<string, unknown>); } catch { reject(new Error('bad reply from the admin channel')); }
      });
    });
  }

  return {
    call,
    async probe() {
      if (!existsSync(socketPath)) return { state: 'absent' };
      try {
        const r = await call('ping');
        return r.ok === true ? { state: 'ok', pid: Number(r.pid) } : { state: 'error', error: String(r.error ?? 'rejected') };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // A socket file nobody listens on belongs to a server that is not running.
        if (code === 'ECONNREFUSED' || code === 'ENOENT') return { state: 'absent' };
        return { state: 'error', error: (err as Error).message };
      }
    },
    async online() {
      const r = await call('online');
      if (r.ok !== true) throw new Error(String(r.error ?? 'online query failed'));
      return r.players as AdminOnlinePlayer[];
    },
  };
}
