// Structured, concise console logging for the game server.
//   [12:04:31] info  listening port=8787 db=data/dev.db
// Fields are appended as key=value (strings with spaces are quoted). Errors print their stack once.

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function formatValue(v: unknown): string {
  if (v instanceof Error) return JSON.stringify(v.message);
  if (typeof v === 'string') return /[\s"=]/.test(v) || v === '' ? JSON.stringify(v) : v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatLine(level: string, msg: string, fields?: LogFields): string {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  let line = `[${time}] ${level.padEnd(5)} ${msg}`;
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'err' || v === undefined) continue;
      line += ` ${k}=${formatValue(v)}`;
    }
  }
  return line;
}

function stackOf(fields?: LogFields): string | null {
  const err = fields?.err;
  if (err instanceof Error && err.stack) return err.stack;
  if (err !== undefined) return String(err);
  return null;
}

/** The default logger: one line per entry on stdout/stderr, plus the stack for `err` fields. */
export function createConsoleLogger(): Logger {
  return {
    info(msg, fields) {
      console.log(formatLine('info', msg, fields));
    },
    warn(msg, fields) {
      console.warn(formatLine('warn', msg, fields));
      const stack = stackOf(fields);
      if (stack) console.warn(stack);
    },
    error(msg, fields) {
      console.error(formatLine('error', msg, fields));
      const stack = stackOf(fields);
      if (stack) console.error(stack);
    },
  };
}

/** A logger that discards everything (tests). */
export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
