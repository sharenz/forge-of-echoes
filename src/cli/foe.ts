// `foe` (alias `foe-cli`): admin tool of Forge of Echoes. See README.md "Admin CLI".
//   foe                       interactive menu (needs a terminal)
//   foe accounts|chars|online|show|merchant|kick|reset|delete-char ...   scriptable, `--json` for machines
// Reads the game database directly (DB_PATH / --db) and talks to the RUNNING server through its local admin
// channel (src/server/admin.ts) for online status, kicks and the live part of destructive commands.
import { dirname, join, resolve } from 'node:path';
import { createAdminClient } from './admin-client';
import type { AdminClient } from './admin-client';
import { actor, audit } from './audit';
import type { AuditEntry } from './audit';
import { backupDatabase, characterDetails, atlasSummary, executeReset, findAccount, findCharacter, listAccounts, listCharacters, openDb, planReset, RESET_TABLES, timestamp } from './data';
import type { AccountSummary, CharacterSummary, ResetPlan, ResetScope } from './data';
import { debugMerch } from '../server/debug-merch-cli';
import type { AdminOnlinePlayer } from '../server/admin';
import { pick } from './prompt';
import type { Choice, PickIO } from './prompt';

export interface Ctx {
  env: NodeJS.ProcessEnv;
  out(text: string): void;
  err(text: string): void;
  /** stdin and stdout are a terminal (interactive mode and typed confirmations are possible). */
  isTTY: boolean;
  color: boolean;
  ask(question: string): Promise<string>;
  picker?: <T>(title: string, choices: readonly Choice<T>[]) => Promise<T | null>;
  now(): Date;
  actor?: string;
  admin?: (dir: string) => AdminClient;
}

class UsageError extends Error {}
class Refused extends Error {}

const HELP = `foe - Forge of Echoes admin tool (alias: foe-cli)

Usage: foe [command] [options]        (no command: interactive menu, needs a terminal)

Read-only
  accounts [--search q]                 all accounts: characters, created, last seen, online
  chars [account]                       characters (of one account, or all)
  online                                players in the running server: account, character, level, place, party
  show <account> [character]            details of an account or one character

Changes
  merchant <account> <character> enable|disable|status   the testing merchant (live, no restart)
  kick <account> [character]            disconnect players from the running server
  delete-char <account> <character>     delete one character (shared stash/atlas stay)
  reset <account>                       delete ALL characters and progress of one account (login stays)
  reset --all                           same for EVERY account (logins stay)

Options
  --json            machine-readable output
  --db <path>       database (default: $DB_PATH, else data/dev.db)
  --dry-run         destructive commands: only print what would be deleted
  --yes --i-know    skip the typed confirmation (both are required)
  --confirm <text>  pass the confirmation phrase non-interactively
  --force           destructive commands: kick players who are online
  --offline         the server is stopped: do not use the admin channel
  -h, --help

Destructive commands always print a summary, back up the database to <data dir>/backups/pre-reset-<time>.db,
run in one transaction and are written to <data dir>/admin-audit.log.
`;

// --- argument parsing -----------------------------------------------------------------------------

interface Args { positional: string[]; flags: Set<string>; values: Map<string, string> }
const VALUE_FLAGS = new Set(['search', 'db', 'confirm']);
const BOOL_FLAGS = new Set(['json', 'all', 'yes', 'i-know', 'force', 'dry-run', 'offline', 'help']);

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { positional: [], flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '-h') { a.flags.add('help'); continue; }
    if (t === '-s') { const v = argv[++i]; if (v === undefined) throw new UsageError('-s needs a value'); a.values.set('search', v); continue; }
    if (!t.startsWith('--')) { a.positional.push(t); continue; }
    const [name, inline] = t.slice(2).split(/=(.*)/s, 2);
    if (VALUE_FLAGS.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`--${name} needs a value`);
      a.values.set(name, v);
    } else if (BOOL_FLAGS.has(name)) a.flags.add(name);
    else throw new UsageError(`unknown option --${name}`);
  }
  return a;
}

// --- formatting -----------------------------------------------------------------------------------

export function ago(ms: number, now: number): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
const day = (ms: number): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');
const iso = (ms: number): string | null => (ms ? new Date(ms).toISOString() : null);

export function table(head: string[], rows: string[][], color = false): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]): string => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
  return [color ? `\x1b[1m${line(head)}\x1b[0m` : line(head), ...rows.map(line)].join('\n');
}

// --- environment ----------------------------------------------------------------------------------

interface Env { dbPath: string; dataDir: string; adminDir: string; auditFile: string; backupDir: string }
function environment(args: Args, ctx: Ctx): Env {
  const dbPath = resolve(args.values.get('db') ?? ctx.env.DB_PATH ?? 'data/dev.db');
  const dataDir = dirname(dbPath);
  return { dbPath, dataDir, adminDir: ctx.env.ADMIN_DIR ?? dataDir, auditFile: join(dataDir, 'admin-audit.log'), backupDir: join(dataDir, 'backups') };
}

interface Runtime { ctx: Ctx; args: Args; env: Env; admin: AdminClient; json: boolean; log(entry: AuditEntry): void }

function runtime(ctx: Ctx, args: Args): Runtime {
  const env = environment(args, ctx);
  const who = ctx.actor ?? actor(ctx.env);
  return {
    ctx, args, env, json: args.flags.has('json'),
    admin: (ctx.admin ?? createAdminClient)(env.adminDir),
    log: (entry) => audit(env.auditFile, entry, ctx.now(), who),
  };
}

/** Online players, or null when the server cannot be asked. */
async function onlineOrNull(rt: Runtime): Promise<AdminOnlinePlayer[] | null> {
  if (rt.args.flags.has('offline')) return null;
  const state = await rt.admin.probe();
  if (state.state !== 'ok') return null;
  try { return await rt.admin.online(); } catch { return null; }
}

// --- read-only commands ---------------------------------------------------------------------------

async function cmdAccounts(rt: Runtime): Promise<void> {
  const db = await openDb(rt.env.dbPath, { readOnly: true });
  try {
    const accounts = listAccounts(db, rt.args.values.get('search'));
    const online = await onlineOrNull(rt);
    const onlineCount = (id: string): number | null => (online ? online.filter((p) => p.accountId === id).length : null);
    const now = rt.ctx.now().getTime();
    if (rt.json) {
      rt.ctx.out(JSON.stringify(accounts.map((a) => ({ account: a.username, id: a.id, characters: a.characters, created: iso(a.created), lastSeen: iso(a.lastSeen), online: onlineCount(a.id) })), null, 2));
      return;
    }
    rt.ctx.out(table(['ACCOUNT', 'CHARS', 'CREATED', 'LAST SEEN', 'ONLINE'], accounts.map((a) => [a.username, String(a.characters), day(a.created), ago(a.lastSeen, now), onlineCount(a.id) === null ? '?' : String(onlineCount(a.id))]), rt.ctx.color));
    rt.ctx.out(`${accounts.length} account(s)`);
  } finally { db.close(); }
}

async function cmdChars(rt: Runtime): Promise<void> {
  const db = await openDb(rt.env.dbPath, { readOnly: true });
  try {
    const name = rt.args.positional[1];
    let accountId: string | undefined;
    if (name) { const acc = findAccount(db, name); if (!acc) throw new Error(`Account not found: ${name}`); accountId = acc.id; }
    const chars = listCharacters(db, accountId);
    const online = await onlineOrNull(rt);
    const isOn = (c: CharacterSummary): boolean | null => (online ? online.some((p) => p.characterId === c.id) : null);
    const now = rt.ctx.now().getTime();
    if (rt.json) {
      rt.ctx.out(JSON.stringify(chars.map((c) => ({ account: c.account, character: c.name, class: c.classId, level: c.level, tier: c.tier, created: iso(c.created), lastPlayed: iso(c.updated), online: isOn(c), testingMerchant: c.merchant })), null, 2));
      return;
    }
    rt.ctx.out(table(['ACCOUNT', 'CHARACTER', 'CLASS', 'LVL', 'TIER', 'LAST PLAYED', 'ONLINE', 'MERCHANT'],
      chars.map((c) => [c.account, c.name, c.classId, String(c.level), String(c.tier), ago(c.updated, now), isOn(c) === null ? '?' : isOn(c) ? 'yes' : 'no', c.merchant ? 'on' : '-']), rt.ctx.color));
    rt.ctx.out(`${chars.length} character(s)`);
  } finally { db.close(); }
}

async function cmdOnline(rt: Runtime): Promise<void> {
  const state = await rt.admin.probe();
  if (state.state === 'absent') throw new Error(`The server is not running (no admin channel in ${rt.env.adminDir}).`);
  if (state.state === 'error') throw new Error(`Admin channel unavailable: ${state.error}`);
  const players = await rt.admin.online();
  if (rt.json) { rt.ctx.out(JSON.stringify(players.map((p) => ({ account: p.account, character: p.character, level: p.level, place: p.place, party: p.party, connected: p.connected })), null, 2)); return; }
  rt.ctx.out(table(['ACCOUNT', 'CHARACTER', 'LVL', 'PLACE', 'PARTY', 'LINK'], players.map((p) => [p.account, p.character, String(p.level), p.place, p.party.length > 1 ? p.party.join(', ') : '-', p.connected ? 'ok' : 'dropped']), rt.ctx.color));
  rt.ctx.out(`${players.length} player(s) online`);
}

export function accountLines(a: AccountSummary, chars: CharacterSummary[], atlas: ReturnType<typeof atlasSummary>, now: number, online: number | null): string[] {
  return [
    `account     ${a.username}`,
    `created     ${day(a.created)}   last seen ${ago(a.lastSeen, now)}   online ${online === null ? '?' : online}`,
    `characters  ${chars.length ? chars.map((c) => `${c.name} (L${c.level} ${c.classId})`).join(', ') : 'none'}`,
    `progress    highest map tier ${atlas.tier}, ${atlas.clears} atlas clears, ${atlas.completed} areas completed, ${atlas.stashTabs} stash tabs`,
  ];
}

export function characterLines(d: ReturnType<typeof characterDetails>, now: number, online: AdminOnlinePlayer | null | undefined): string[] {
  return [
    `character   ${d.name}  (${d.account})`,
    `class/level ${d.classId}, level ${d.level}   highest map tier ${d.tier}`,
    `created     ${day(d.created)}   last played ${ago(d.updated, now)}   online ${online === undefined ? '?' : online ? `yes (${online.place})` : 'no'}`,
    `location    ${d.location ?? '-'}   open map ${d.openMap ? `${d.openMap.name} (${d.openMap.portalsRemaining} portals${d.openMap.cleared ? ', cleared' : ''})` : '-'}`,
    `party       ${d.party ? d.party.join(', ') : '-'}   testing merchant ${d.merchant ? 'on' : 'off'}   save ${(d.saveBytes / 1024).toFixed(1)} KiB`,
  ];
}

async function cmdShow(rt: Runtime): Promise<void> {
  const [, accName, charName] = rt.args.positional;
  if (!accName) throw new UsageError('Usage: foe show <account> [character]');
  const db = await openDb(rt.env.dbPath, { readOnly: true });
  try {
    const acc = findAccount(db, accName);
    if (!acc) throw new Error(`Account not found: ${accName}`);
    const online = await onlineOrNull(rt);
    const now = rt.ctx.now().getTime();
    if (charName) {
      const c = findCharacter(db, charName, acc.id);
      if (!c) throw new Error(`Character ${charName} does not belong to ${acc.username}.`);
      const d = characterDetails(db, c);
      const on = online ? online.find((p) => p.characterId === c.id) ?? null : undefined;
      if (rt.json) rt.ctx.out(JSON.stringify({ ...d, created: iso(d.created), updated: iso(d.updated), online: on === undefined ? null : !!on, place: on?.place ?? null }, null, 2));
      else rt.ctx.out(characterLines(d, now, on).join('\n'));
      return;
    }
    const chars = listCharacters(db, acc.id);
    const atlas = atlasSummary(db, acc.id);
    const on = online ? online.filter((p) => p.accountId === acc.id).length : null;
    if (rt.json) rt.ctx.out(JSON.stringify({ account: acc.username, id: acc.id, created: iso(acc.created), lastSeen: iso(acc.lastSeen), online: on, atlas, characters: chars.map((c) => ({ name: c.name, class: c.classId, level: c.level, lastPlayed: iso(c.updated), testingMerchant: c.merchant })) }, null, 2));
    else rt.ctx.out(accountLines(acc, chars, atlas, now, on).join('\n'));
  } finally { db.close(); }
}

// --- changes: merchant, kick ----------------------------------------------------------------------

async function cmdMerchant(rt: Runtime): Promise<void> {
  const [, account, character, action] = rt.args.positional;
  if (!account || !character || !action) throw new UsageError('Usage: foe merchant <account> <character> enable|disable|status');
  const message = await debugMerch([account, character, action], rt.env.dbPath);
  if (action !== 'status') rt.log({ action: `merchant.${action}`, account, character });
  rt.ctx.out(rt.json ? JSON.stringify({ account, character, action, message }) : message);
}

async function cmdKick(rt: Runtime): Promise<void> {
  const [, accName, charName] = rt.args.positional;
  if (!accName) throw new UsageError('Usage: foe kick <account> [character]');
  const db = await openDb(rt.env.dbPath, { readOnly: true });
  let req: Record<string, unknown>;
  try {
    const acc = findAccount(db, accName);
    if (!acc) throw new Error(`Account not found: ${accName}`);
    const c = charName ? findCharacter(db, charName, acc.id) : null;
    if (charName && !c) throw new Error(`Character ${charName} does not belong to ${acc.username}.`);
    req = c ? { characters: [c.id] } : { accounts: [acc.id] };
  } finally { db.close(); }
  const state = await rt.admin.probe();
  if (state.state !== 'ok') throw new Error('The server is not running or its admin channel is unavailable.');
  rt.log({ action: 'kick', account: accName, character: charName ?? null });
  const res = await rt.admin.call('kick', req);
  const kicked = (res.kicked as string[] | undefined) ?? [];
  rt.ctx.out(rt.json ? JSON.stringify({ kicked }) : kicked.length ? `Kicked: ${kicked.join(', ')}` : 'Nobody of that scope was online.');
}

// --- destructive commands -------------------------------------------------------------------------

export function planLines(plan: ResetPlan, title: string): string[] {
  const lines = [title, `  accounts kept (logins, sessions): ${plan.accountsKept}`, `  characters to delete: ${plan.characters.length}`];
  for (const c of plan.characters.slice(0, 15)) lines.push(`    - ${c.account} / ${c.name} (level ${c.level})`);
  if (plan.characters.length > 15) lines.push(`    ... and ${plan.characters.length - 15} more`);
  lines.push('  rows to delete per table:');
  for (const t of RESET_TABLES) lines.push(`    ${t.padEnd(20)} ${plan.counts[t]}`);
  if (plan.counts.partiesRepaired) lines.push(`    (${plan.counts.partiesRepaired} surviving parties get a new leader)`);
  return lines;
}

function confirmationPhrase(plan: ResetPlan, kind: 'all' | 'account' | 'char'): string {
  if (kind === 'all') return `RESET-ALL-ACCOUNTS ${plan.characters.length}`;
  return kind === 'account' ? plan.accounts[0] : plan.characters[0].name;
}

interface DestructiveRequest { kind: 'all' | 'account' | 'char'; scope: ResetScope; label: string; action: string }

/** Everything shared by reset and delete-char: plan, dry run, safety checks, confirmation, lock, backup, transaction, audit. */
async function runDestructive(rt: Runtime, req: DestructiveRequest): Promise<void> {
  const { args, ctx } = rt;
  const readDb = await openDb(rt.env.dbPath, { readOnly: true });
  let plan: ResetPlan;
  try { plan = planReset(readDb, req.scope); } finally { readDb.close(); }
  const dry = args.flags.has('dry-run');
  if (rt.json && dry) { ctx.out(JSON.stringify({ dryRun: true, action: req.action, accounts: plan.accounts, characters: plan.characters, counts: plan.counts }, null, 2)); rt.log({ action: `${req.action}.dry-run`, label: req.label, characters: plan.characters.length }); return; }
  ctx.out(planLines(plan, `${req.label}: this would delete`).join('\n'));
  if (dry) { rt.log({ action: `${req.action}.dry-run`, label: req.label, characters: plan.characters.length }); ctx.out('\nDry run: nothing was changed.'); return; }
  if (plan.characters.length === 0 && req.kind !== 'all') throw new Refused('Nothing to delete.');

  const refuse = (why: string): never => { rt.log({ action: `${req.action}.refused`, label: req.label, reason: why }); throw new Refused(why); };

  // 1. The running server: must be known, and nobody affected may be playing (unless --force).
  const state = await rt.admin.probe();
  const offline = args.flags.has('offline');
  if (offline && state.state === 'ok') refuse('--offline was given but a server is running (admin channel answered). Stop it or drop --offline.');
  if (!offline && state.state === 'absent') refuse(`No running server found (no admin channel in ${rt.env.adminDir}). If the server is stopped, pass --offline.`);
  if (state.state === 'error') refuse(`The admin channel of the server is unavailable: ${state.error}`);
  let present: AdminOnlinePlayer[] = [];
  if (state.state === 'ok') {
    const ids = new Set(plan.characters.map((c) => c.id));
    present = (await rt.admin.online()).filter((p) => req.scope.all || ids.has(p.characterId));
    if (present.length > 0 && !args.flags.has('force')) {
      refuse(`${present.length} affected player(s) are online: ${present.map((p) => `${p.account}/${p.character}`).join(', ')}. Kick them first (foe kick ...) or pass --force to kick them now.`);
    }
  }

  // 2. Typed confirmation.
  const phrase = confirmationPhrase(plan, req.kind);
  const bypass = args.flags.has('yes') && args.flags.has('i-know');
  if (args.flags.has('yes') !== args.flags.has('i-know')) refuse('--yes and --i-know must be given together.');
  if (!bypass) {
    const given = args.values.get('confirm');
    if (given !== undefined) { if (given !== phrase) refuse('The --confirm text does not match.'); }
    else if (ctx.isTTY) {
      const typed = (await ctx.ask(`\nType "${phrase}" to confirm (anything else cancels): `)).trim();
      if (typed !== phrase) refuse('Confirmation did not match. Nothing was changed.');
    } else refuse(`Not a terminal: pass --confirm "${phrase}" (or --yes --i-know).`);
  }

  // 3. Go. The audit record comes first: no trace, no action.
  const backup = join(rt.env.backupDir, `pre-reset-${timestamp(ctx.now())}.db`);
  rt.log({ action: `${req.action}.begin`, label: req.label, characters: plan.characters.map((c) => `${c.account}/${c.name}`), counts: plan.counts, backup, forced: present.length > 0, bypassedPrompt: bypass });
  const scopeArgs = req.scope.all ? { accounts: 'all' } : { accounts: req.scope.accountIds, characters: req.scope.characterIds };
  let locked = false;
  try {
    if (state.state === 'ok') {
      const res = await rt.admin.call('lock', { ...scopeArgs, kick: true, purge: true });
      if (res.ok !== true) throw new Error(`Could not lock the server: ${String(res.error)}`);
      locked = true;
    }
    await backupDatabase(rt.env.dbPath, backup);
    ctx.out(`\nBackup written: ${backup}`);
    const db = await openDb(rt.env.dbPath);
    let done: ResetPlan['counts'];
    try {
      // Re-plan inside the lock: the rows may have changed since the dry summary.
      const fresh = planReset(db, req.scope);
      done = executeReset(db, fresh);
    } finally { db.close(); }
    rt.log({ action: `${req.action}.done`, label: req.label, deleted: done, backup });
    ctx.out(rt.json ? JSON.stringify({ ok: true, backup, deleted: done }) : ['Done. Deleted rows per table:', ...RESET_TABLES.map((t) => `  ${t.padEnd(20)} ${done[t]}`), locked ? 'The running server dropped its in-memory state for these characters; players can log in again now.' : 'No server was running; nothing to refresh.'].join('\n'));
  } catch (err) {
    rt.log({ action: `${req.action}.failed`, label: req.label, error: err instanceof Error ? err.message : String(err), backup });
    throw err;
  } finally {
    if (locked) { try { await rt.admin.call('unlock'); } catch (e) { ctx.err(`WARNING: could not lift the login lock (${(e as Error).message}); it expires on its own after 10 minutes.`); } }
  }
}

async function cmdReset(rt: Runtime): Promise<void> {
  const name = rt.args.positional[1];
  if (rt.args.flags.has('all')) {
    if (name) throw new UsageError('Use either `foe reset --all` or `foe reset <account>`.');
    return runDestructive(rt, { kind: 'all', scope: { all: true, accountIds: [], characterIds: [] }, label: 'GLOBAL RESET of every account', action: 'reset-all' });
  }
  if (!name) throw new UsageError('Usage: foe reset <account> | foe reset --all');
  const db = await openDb(rt.env.dbPath, { readOnly: true });
  let acc: AccountSummary | null;
  try { acc = findAccount(db, name); } finally { db.close(); }
  if (!acc) throw new Error(`Account not found: ${name}`);
  return runDestructive(rt, { kind: 'account', scope: { all: false, accountIds: [acc.id], characterIds: [] }, label: `Reset of account ${acc.username}`, action: 'reset-account' });
}

async function cmdDeleteChar(rt: Runtime): Promise<void> {
  const [, accName, charName] = rt.args.positional;
  if (!accName || !charName) throw new UsageError('Usage: foe delete-char <account> <character>');
  const db = await openDb(rt.env.dbPath, { readOnly: true });
  let c: CharacterSummary | null;
  try {
    const acc = findAccount(db, accName);
    if (!acc) throw new Error(`Account not found: ${accName}`);
    c = findCharacter(db, charName, acc.id);
    if (!c) throw new Error(`Character ${charName} does not belong to ${acc.username}.`);
  } finally { db.close(); }
  return runDestructive(rt, { kind: 'char', scope: { all: false, accountIds: [], characterIds: [c.id] }, label: `Deletion of character ${c.name} (${c.account})`, action: 'delete-char' });
}

// --- interactive mode -----------------------------------------------------------------------------

async function interactive(rt: Runtime, io: PickIO | null): Promise<void> {
  const { ctx } = rt;
  const choose: NonNullable<Ctx['picker']> = ctx.picker ?? (<T>(title: string, choices: readonly Choice<T>[]) => pick(io!, title, choices));
  const say = (s: string): void => ctx.out(s);
  const pause = async (): Promise<void> => { await ctx.ask('\n(enter to continue) '); };
  const withArgs = (positional: string[], flags: string[] = []): Runtime => ({ ...rt, args: { positional, flags: new Set([...rt.args.flags, ...flags]), values: new Map(rt.args.values) } });
  const attempt = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch (err) { say(`\n${(err as Error).message}`); }
    await pause();
  };

  const snapshot = async () => {
    const db = await openDb(rt.env.dbPath, { readOnly: true });
    try { return { accounts: listAccounts(db), chars: listCharacters(db), atlas: new Map(listAccounts(db).map((a) => [a.id, atlasSummary(db, a.id)])) }; } finally { db.close(); }
  };

  for (;;) {
    const top = await choose('Forge of Echoes admin', [
      { value: 'chars', label: 'Find a character', hint: 'search by account, name, class, level' },
      { value: 'accounts', label: 'Find an account' },
      { value: 'online', label: 'Who is online' },
      { value: 'resetall', label: 'Reset ALL accounts...', hint: 'destructive', search: 'delete wipe global' },
      { value: 'quit', label: 'Quit' },
    ] as Choice<string>[]);
    if (top === null || top === 'quit') return;
    if (top === 'online') { await attempt(() => cmdOnline(withArgs(['online']))); continue; }
    if (top === 'resetall') { await attempt(() => cmdReset(withArgs(['reset'], ['all']))); continue; }

    const snap = await snapshot();
    const online = await onlineOrNull(rt);
    const now = ctx.now().getTime();
    if (top === 'accounts') {
      const acc = await choose('Accounts', snap.accounts.map((a): Choice<AccountSummary> => {
        const chars = snap.chars.filter((c) => c.accountId === a.id);
        return {
          value: a, label: a.username, hint: `${a.characters} char(s), seen ${ago(a.lastSeen, now)}`,
          search: chars.map((c) => `${c.name} ${c.classId} ${c.level}`).join(' '),
          preview: accountLines(a, chars, snap.atlas.get(a.id)!, now, online ? online.filter((p) => p.accountId === a.id).length : null),
        };
      }));
      if (!acc) continue;
      const act = await choose(`Account ${acc.username}`, [
        { value: 'show', label: 'Show details' },
        { value: 'kick', label: 'Kick from the server' },
        { value: 'reset', label: 'Reset this account...', hint: 'destructive' },
        { value: 'back', label: 'Back' },
      ] as Choice<string>[]);
      if (act === 'show') await attempt(() => cmdShow(withArgs(['show', acc.username])));
      else if (act === 'kick') await attempt(() => cmdKick(withArgs(['kick', acc.username])));
      else if (act === 'reset') await attempt(() => cmdReset(withArgs(['reset', acc.username])));
      continue;
    }
    const c = await choose('Characters', snap.chars.map((ch): Choice<CharacterSummary> => {
      const on = online ? online.find((p) => p.characterId === ch.id) : undefined;
      return {
        value: ch, label: `${ch.name}`, hint: `${ch.account}  L${ch.level} ${ch.classId}  ${on ? 'ONLINE' : ''}`.trimEnd(),
        search: `${ch.account} ${ch.classId} level ${ch.level} L${ch.level}`,
        preview: [
          `${ch.name} - level ${ch.level} ${ch.classId}, account ${ch.account}`,
          `highest map tier ${ch.tier}   last played ${ago(ch.updated, now)}`,
          `online ${online ? (on ? `yes (${on.place})` : 'no') : '?'}   testing merchant ${ch.merchant ? 'on' : 'off'}`,
        ],
      };
    }));
    if (!c) continue;
    const act = await choose(`${c.name} (${c.account})`, [
      { value: 'show', label: 'Show details' },
      { value: 'merchant', label: c.merchant ? 'Disable testing merchant' : 'Enable testing merchant' },
      { value: 'kick', label: 'Kick from the server' },
      { value: 'delete', label: 'Delete this character...', hint: 'destructive' },
      { value: 'back', label: 'Back' },
    ] as Choice<string>[]);
    if (act === 'show') await attempt(() => cmdShow(withArgs(['show', c.account, c.name])));
    else if (act === 'merchant') await attempt(() => cmdMerchant(withArgs(['merchant', c.account, c.name, c.merchant ? 'disable' : 'enable'])));
    else if (act === 'kick') await attempt(() => cmdKick(withArgs(['kick', c.account, c.name])));
    else if (act === 'delete') await attempt(() => cmdDeleteChar(withArgs(['delete-char', c.account, c.name])));
  }
}

// --- entry ----------------------------------------------------------------------------------------

/** Run the CLI; returns the exit code (0 ok, 1 failed or refused, 2 usage). */
export async function runCli(argv: readonly string[], ctx: Ctx, io: PickIO | null = null): Promise<number> {
  try {
    const args = parseArgs(argv);
    const cmd = args.positional[0];
    if (args.flags.has('help') || cmd === 'help') { ctx.out(HELP); return 0; }
    const rt = runtime(ctx, args);
    switch (cmd) {
      case undefined:
        if (!ctx.isTTY && !ctx.picker) throw new UsageError('Interactive mode needs a terminal (use `ssh -t`). Try `foe --help`.');
        await interactive(rt, io);
        return 0;
      case 'accounts': await cmdAccounts(rt); return 0;
      case 'chars': await cmdChars(rt); return 0;
      case 'online': await cmdOnline(rt); return 0;
      case 'show': await cmdShow(rt); return 0;
      case 'merchant': await cmdMerchant(rt); return 0;
      case 'kick': await cmdKick(rt); return 0;
      case 'reset': await cmdReset(rt); return 0;
      case 'delete-char': await cmdDeleteChar(rt); return 0;
      default: throw new UsageError(`Unknown command: ${cmd}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof UsageError) { ctx.err(`${msg}\n\n${HELP}`); return 2; }
    ctx.err(err instanceof Refused ? `Refused: ${msg}` : `Error: ${msg}`);
    return 1;
  }
}
