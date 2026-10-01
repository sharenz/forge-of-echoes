// Command request/response: every Command goes out with a client-chosen id and the server answers exactly once
// with { t: 'result', id, ok, error?, message?, offers? }. Pending requests resolve on that answer, on a timeout,
// or when the connection drops (then with `lost: true`: the answer may never come, and the server re-sends the
// whole state on reconnect, so callers stay quiet instead of toasting one error per pending command).
import type { MerchantBoard, MerchantOffer } from '../contracts/game';
import type { Command } from '../contracts/net';

export interface CommandResult {
  ok: boolean;
  error?: string;
  message?: string;
  offers?: MerchantOffer[];
  board?: MerchantBoard;
  /** Failed only because the connection dropped (or the session ended) before the server answered. */
  lost?: boolean;
}

/** A command the server never answered within this time is treated as failed. */
export const COMMAND_TIMEOUT_MS = 10_000;

interface Pending {
  cmd: Command;
  sentAt: number;
  resolve: (r: CommandResult) => void;
}

export class CommandTracker {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  get size(): number {
    return this.pending.size;
  }

  /** Register a command; returns its id and a promise for the result. */
  issue(cmd: Command, now: number): { id: number; result: Promise<CommandResult> } {
    const id = this.nextId++;
    let resolve!: (r: CommandResult) => void;
    const result = new Promise<CommandResult>((r) => (resolve = r));
    this.pending.set(id, { cmd, sentAt: now, resolve });
    return { id, result };
  }

  /** Settle a pending command with the server's answer. Returns the command, or null for unknown ids. */
  settle(id: number, r: CommandResult): Command | null {
    const p = this.pending.get(id);
    if (!p) return null;
    this.pending.delete(id);
    p.resolve(r);
    return p.cmd;
  }

  /** Fail everything older than the timeout; returns the commands that timed out. */
  expire(now: number): Command[] {
    const out: Command[] = [];
    for (const [id, p] of this.pending) {
      if (now - p.sentAt < COMMAND_TIMEOUT_MS) continue;
      this.pending.delete(id);
      p.resolve({ ok: false, error: 'The server did not answer in time.' });
      out.push(p.cmd);
    }
    return out;
  }

  /** Fail every pending command (connection lost / session over): they resolve with `lost: true`. */
  failAll(error: string): Command[] {
    const out: Command[] = [];
    for (const p of this.pending.values()) {
      p.resolve({ ok: false, error, lost: true });
      out.push(p.cmd);
    }
    this.pending.clear();
    return out;
  }
}
