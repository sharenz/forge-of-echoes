// Append-only audit trail of admin actions: one JSON object per line.
import { appendFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { dirname } from 'node:path';

export interface AuditEntry { action: string; [key: string]: unknown }

export function actor(env: NodeJS.ProcessEnv = process.env): string {
  let user = 'unknown';
  try { user = userInfo().username; } catch { /* no passwd entry */ }
  const ssh = env.SSH_CONNECTION?.split(' ')[0];
  return `${env.SUDO_USER ?? user}@${hostname()}${ssh ? ` (ssh from ${ssh})` : ''}`;
}

export function audit(file: string, entry: AuditEntry, now = new Date(), who = actor()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const fresh = !existsSync(file);
    appendFileSync(file, JSON.stringify({ time: now.toISOString(), actor: who, ...entry }) + '\n', { mode: 0o640 });
    if (fresh) chmodSync(file, 0o640);
  } catch (err) {
    // An unwritable audit log must not be silent: callers of destructive actions check `auditOk` first.
    throw new Error(`cannot write the audit log ${file}: ${(err as Error).message}`);
  }
}
