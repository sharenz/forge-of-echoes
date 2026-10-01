// Process entry of `foe` / `foe-cli` (and, via `foe merchant`, `debug_merch`): node --import tsx src/cli/main.ts <args>
import { createInterface } from 'node:readline';
import { runCli } from './foe';
import type { Ctx } from './foe';

const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
const color = tty && !process.env.NO_COLOR;
let rl: ReturnType<typeof createInterface> | null = null;
let stdinClosed = false;

const ctx: Ctx = {
  env: process.env,
  out: (t) => console.log(t),
  err: (t) => console.error(t),
  isTTY: tty,
  color,
  ask: (q) => new Promise((resolve) => {
    if (stdinClosed) return resolve('');
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    rl.once('close', () => { stdinClosed = true; resolve(''); });
    rl.question(q, (a) => resolve(a));
  }),
  now: () => new Date(),
};

const args = process.argv.slice(2);

runCli(args, ctx, tty ? { stdin: process.stdin, stdout: process.stdout, color } : null)
  .then((code) => { rl?.close(); process.exitCode = code; })
  .catch((err) => { console.error(err); process.exitCode = 1; });
