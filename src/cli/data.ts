// Database access of the `foe` CLI: read-only listings and the reset/delete operations. Uses its own SQLite
// handle (node:sqlite) so it never starts the game; the schema is owned by src/server/db.ts (SCHEMA_VERSION).
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '../server/db';

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));

let sqliteModule: typeof import('node:sqlite') | null = null;
/** node:sqlite without its ExperimentalWarning (same approach as the server). */
export async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  if (sqliteModule) return sqliteModule;
  const original = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    const text = typeof w === 'string' ? w : w.message;
    if (/sqlite/i.test(text)) return;
    (original as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try { sqliteModule = await import('node:sqlite'); } finally { process.emitWarning = original; }
  return sqliteModule;
}

export async function openDb(path: string, opts: { readOnly?: boolean } = {}): Promise<DatabaseSync> {
  if (!existsSync(path)) throw new Error(`Database does not exist: ${path}. Set DB_PATH (or --db) to the game database.`);
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(path, opts.readOnly ? { readOnly: true } : {});
  db.exec('PRAGMA busy_timeout = 5000');
  if (!opts.readOnly) db.exec('PRAGMA foreign_keys = ON');
  const version = num(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`Database schema is v${version} but this tool expects v${SCHEMA_VERSION}. Deploy/start the matching server version first.`);
  }
  return db;
}

// --- listings -----------------------------------------------------------------------------------

export interface AccountSummary { id: string; username: string; created: number; characters: number; lastSeen: number }
export interface CharacterSummary {
  id: string; accountId: string; account: string; name: string; classId: string; level: number;
  created: number; updated: number; tier: number; merchant: boolean;
}

export function listAccounts(db: DatabaseSync, search = ''): AccountSummary[] {
  const rows = db.prepare(
    `SELECT a.id, a.username, a.created, COUNT(c.id) AS n, COALESCE(MAX(c.updated), 0) AS seen
     FROM accounts a LEFT JOIN characters c ON c.account_id = a.id GROUP BY a.id ORDER BY a.username COLLATE NOCASE`,
  ).all() as Row[];
  const q = search.trim().toLowerCase();
  return rows
    .map((r) => ({ id: str(r.id), username: str(r.username), created: num(r.created), characters: num(r.n), lastSeen: num(r.seen) }))
    .filter((a) => !q || a.username.toLowerCase().includes(q));
}

/** Highest map tier cleared by an account (Atlas), from the shared account storage. */
export function atlasSummary(db: DatabaseSync, accountId: string): { tier: number; clears: number; completed: number; stashTabs: number } {
  const row = db.prepare('SELECT data FROM account_storage WHERE account_id = ?').get(accountId) as Row | undefined;
  if (!row) return { tier: 0, clears: 0, completed: 0, stashTabs: 0 };
  try {
    const data = JSON.parse(str(row.data)) as { atlas?: { tiersCleared?: unknown; clears?: unknown; completed?: unknown }; stash?: unknown };
    const tiers = Array.isArray(data.atlas?.tiersCleared) ? (data.atlas.tiersCleared as unknown[]).map(num) : [];
    return {
      tier: tiers.length ? Math.max(...tiers) : 0,
      clears: num(data.atlas?.clears),
      completed: Array.isArray(data.atlas?.completed) ? data.atlas.completed.length : 0,
      stashTabs: Array.isArray(data.stash) ? data.stash.length : 0,
    };
  } catch { return { tier: 0, clears: 0, completed: 0, stashTabs: 0 }; }
}

export function listCharacters(db: DatabaseSync, accountId?: string): CharacterSummary[] {
  const rows = db.prepare(
    `SELECT c.id, c.account_id, a.username, c.name, c.class_id, c.level, c.created, c.updated,
            EXISTS(SELECT 1 FROM debug_merchants d WHERE d.character_id = c.id) AS merchant
     FROM characters c JOIN accounts a ON a.id = c.account_id
     ${accountId ? 'WHERE c.account_id = ?' : ''} ORDER BY a.username COLLATE NOCASE, c.created, c.id`,
  ).all(...(accountId ? [accountId] : [])) as Row[];
  const tiers = new Map<string, number>();
  return rows.map((r) => {
    const aid = str(r.account_id);
    if (!tiers.has(aid)) tiers.set(aid, atlasSummary(db, aid).tier);
    return {
      id: str(r.id), accountId: aid, account: str(r.username), name: str(r.name), classId: str(r.class_id), level: num(r.level),
      created: num(r.created), updated: num(r.updated), tier: tiers.get(aid) ?? 0, merchant: num(r.merchant) === 1,
    };
  });
}

export function findAccount(db: DatabaseSync, name: string): AccountSummary | null {
  const r = db.prepare('SELECT id FROM accounts WHERE username = ? COLLATE NOCASE').get(name) as Row | undefined;
  return r ? (listAccounts(db).find((a) => a.id === str(r.id)) ?? null) : null;
}

/** A character by name, which must belong to `account` when given (names are unique across the game). */
export function findCharacter(db: DatabaseSync, name: string, accountId?: string): CharacterSummary | null {
  const r = db.prepare('SELECT id, account_id FROM characters WHERE name = ? COLLATE NOCASE').get(name) as Row | undefined;
  if (!r || (accountId && str(r.account_id) !== accountId)) return null;
  return listCharacters(db, str(r.account_id)).find((c) => c.id === str(r.id)) ?? null;
}

export interface CharacterDetails extends CharacterSummary {
  saveBytes: number; location: string | null; party: string[] | null; openMap: { name: string; portalsRemaining: number; cleared: boolean } | null;
}

export function characterDetails(db: DatabaseSync, c: CharacterSummary): CharacterDetails {
  const size = db.prepare('SELECT LENGTH(data) AS n FROM characters WHERE id = ?').get(c.id) as Row;
  const loc = db.prepare('SELECT map_name FROM character_maps WHERE character_id = ?').get(c.id) as Row | undefined;
  const pm = db.prepare('SELECT party_id FROM party_members WHERE character_id = ?').get(c.id) as Row | undefined;
  const party = pm
    ? (db.prepare('SELECT c.name FROM party_members m JOIN characters c ON c.id = m.character_id WHERE m.party_id = ? ORDER BY m.position').all(str(pm.party_id)) as Row[]).map((r) => str(r.name))
    : null;
  const map = db.prepare('SELECT setup, portals_remaining, cleared FROM open_maps WHERE owner_id = ?').get(c.id) as Row | undefined;
  let mapName = 'map';
  if (map) { try { const s = JSON.parse(str(map.setup)) as { item?: { name?: string }; config?: { mapName?: string } }; mapName = s.config?.mapName ?? s.item?.name ?? 'map'; } catch { /* keep default */ } }
  return {
    ...c, saveBytes: num(size?.n), location: loc ? str(loc.map_name) : null, party,
    openMap: map ? { name: mapName, portalsRemaining: num(map.portals_remaining), cleared: num(map.cleared) === 1 } : null,
  };
}

// --- reset / delete -----------------------------------------------------------------------------

export interface ResetScope {
  /** Accounts whose shared storage, atlas and credit queue are wiped (all their characters go). */
  accountIds: string[];
  /** Individual characters to delete (for accounts not listed above). */
  characterIds: string[];
  all: boolean;
}

export const RESET_TABLES = [
  'characters', 'account_storage', 'atlas_credit_queue', 'open_maps', 'character_maps', 'party_members', 'parties', 'debug_merchants',
] as const;
export type ResetTable = (typeof RESET_TABLES)[number];
export interface ResetPlan {
  scope: ResetScope;
  accounts: string[];
  characters: { id: string; name: string; account: string; level: number }[];
  /** Rows that will be deleted per table. */
  counts: Record<ResetTable, number> & { partiesRepaired: number };
  /** Accounts that stay (with their login) and sessions that stay. */
  accountsKept: number;
}

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(',') || 'NULL';

/** The characters a scope covers. */
function scopeCharacters(db: DatabaseSync, scope: ResetScope): { id: string; name: string; account: string; accountId: string; level: number }[] {
  const all = db.prepare(
    'SELECT c.id, c.name, c.level, c.account_id, a.username FROM characters c JOIN accounts a ON a.id = c.account_id ORDER BY a.username COLLATE NOCASE, c.created',
  ).all() as Row[];
  const accs = new Set(scope.accountIds), chars = new Set(scope.characterIds);
  return all
    .filter((r) => scope.all || accs.has(str(r.account_id)) || chars.has(str(r.id)))
    .map((r) => ({ id: str(r.id), name: str(r.name), account: str(r.username), accountId: str(r.account_id), level: num(r.level) }));
}

export function planReset(db: DatabaseSync, scope: ResetScope): ResetPlan {
  const chars = scopeCharacters(db, scope);
  const ids = chars.map((c) => c.id);
  const accountIds = scope.all ? (db.prepare('SELECT id FROM accounts').all() as Row[]).map((r) => str(r.id)) : scope.accountIds;
  const count = (sql: string, ...p: (string | number)[]): number => num((db.prepare(sql).get(...p) as Row).n);
  const inIds = marks(ids.length), inAcc = marks(accountIds.length);
  const affectedParties = `SELECT DISTINCT party_id FROM party_members WHERE character_id IN (${inIds})`;
  const counts = {
    characters: ids.length,
    account_storage: count(`SELECT COUNT(*) AS n FROM account_storage WHERE account_id IN (${inAcc})`, ...accountIds),
    atlas_credit_queue: count(`SELECT COUNT(*) AS n FROM atlas_credit_queue WHERE account_id IN (${inAcc}) OR character_id IN (${inIds})`, ...accountIds, ...ids),
    open_maps: count(`SELECT COUNT(*) AS n FROM open_maps WHERE owner_id IN (${inIds})`, ...ids),
    character_maps: count(
      `SELECT COUNT(*) AS n FROM character_maps WHERE character_id IN (${inIds}) OR owner_id IN (${inIds})
         OR map_id IN (SELECT map_id FROM open_maps WHERE owner_id IN (${inIds})) OR map_id IN (${ids.map(() => "'hideout:' || ?").join(',') || 'NULL'})`,
      ...ids, ...ids, ...ids, ...ids),
    party_members: count(`SELECT COUNT(*) AS n FROM party_members WHERE character_id IN (${inIds})`, ...ids),
    parties: 0,
    debug_merchants: count(`SELECT COUNT(*) AS n FROM debug_merchants WHERE character_id IN (${inIds})`, ...ids),
    partiesRepaired: 0,
  };
  // A party dissolves when fewer than two members remain; otherwise it stays (with a new leader if needed).
  const parties = db.prepare(
    `SELECT p.id, p.leader_id, (SELECT COUNT(*) FROM party_members m WHERE m.party_id = p.id AND m.character_id NOT IN (${inIds})) AS remaining
     FROM parties p WHERE p.id IN (${affectedParties})`,
  ).all(...ids, ...ids) as Row[];
  counts.parties = parties.filter((p) => num(p.remaining) < 2).length;
  counts.partiesRepaired = parties.filter((p) => num(p.remaining) >= 2 && ids.includes(str(p.leader_id))).length;
  return {
    scope,
    accounts: accountIds.map((id) => str((db.prepare('SELECT username FROM accounts WHERE id = ?').get(id) as Row | undefined)?.username ?? id)),
    characters: chars.map(({ id, name, account, level }) => ({ id, name, account, level })),
    counts,
    accountsKept: num((db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as Row).n),
  };
}

export interface ExecuteHooks { /** Called inside the transaction after every delete; throwing rolls everything back (tests). */ beforeCommit?: () => void }

/** Delete everything the plan lists in ONE transaction; returns the rows actually deleted per table. */
export function executeReset(db: DatabaseSync, plan: ResetPlan, hooks: ExecuteHooks = {}): ResetPlan['counts'] {
  const ids = plan.characters.map((c) => c.id);
  const accountIds = plan.scope.all ? (db.prepare('SELECT id FROM accounts').all() as Row[]).map((r) => str(r.id)) : plan.scope.accountIds;
  const inIds = marks(ids.length), inAcc = marks(accountIds.length);
  const done: ResetPlan['counts'] = { characters: 0, account_storage: 0, atlas_credit_queue: 0, open_maps: 0, character_maps: 0, party_members: 0, parties: 0, debug_merchants: 0, partiesRepaired: 0 };
  const del = (sql: string, ...p: string[]): number => num(db.prepare(sql).run(...p).changes);
  db.exec('BEGIN IMMEDIATE');
  try {
    // Order matters only for the counts: foreign keys would cascade the rest.
    const affected = (db.prepare(`SELECT DISTINCT party_id FROM party_members WHERE character_id IN (${inIds})`).all(...ids) as Row[]).map((r) => str(r.party_id));
    done.debug_merchants = del(`DELETE FROM debug_merchants WHERE character_id IN (${inIds})`, ...ids);
    done.atlas_credit_queue = del(`DELETE FROM atlas_credit_queue WHERE account_id IN (${inAcc}) OR character_id IN (${inIds})`, ...accountIds, ...ids);
    done.character_maps = del(
      `DELETE FROM character_maps WHERE character_id IN (${inIds}) OR owner_id IN (${inIds})
         OR map_id IN (SELECT map_id FROM open_maps WHERE owner_id IN (${inIds})) OR map_id IN (${ids.map(() => "'hideout:' || ?").join(',') || 'NULL'})`,
      ...ids, ...ids, ...ids, ...ids);
    done.open_maps = del(`DELETE FROM open_maps WHERE owner_id IN (${inIds})`, ...ids);
    done.party_members = del(`DELETE FROM party_members WHERE character_id IN (${inIds})`, ...ids);
    for (const pid of affected) {
      const members = db.prepare('SELECT character_id FROM party_members WHERE party_id = ? ORDER BY position').all(pid) as Row[];
      if (members.length < 2) done.parties += del('DELETE FROM parties WHERE id = ?', pid);
      else if (ids.includes(str((db.prepare('SELECT leader_id FROM parties WHERE id = ?').get(pid) as Row).leader_id))) {
        db.prepare('UPDATE parties SET leader_id = ? WHERE id = ?').run(str(members[0].character_id), pid);
        done.partiesRepaired++;
      }
    }
    done.account_storage = del(`DELETE FROM account_storage WHERE account_id IN (${inAcc})`, ...accountIds);
    done.characters = del(`DELETE FROM characters WHERE id IN (${inIds})`, ...ids);
    const left = num((db.prepare(`SELECT COUNT(*) AS n FROM characters WHERE id IN (${inIds})`).get(...ids) as Row).n);
    if (left !== 0 || done.characters !== ids.length) throw new Error(`Expected to delete ${ids.length} characters but ${done.characters} were removed; rolled back.`);
    hooks.beforeCommit?.();
    db.exec('COMMIT');
    return done;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* connection already rolled back */ }
    throw err;
  }
}

// --- backup -------------------------------------------------------------------------------------

/** Consistent online copy (SQLite backup API, same mechanism as the deploy), verified and chmod 600. */
export async function backupDatabase(dbPath: string, dest: string): Promise<void> {
  const { DatabaseSync, backup } = await loadSqlite();
  if (existsSync(dest)) throw new Error(`Backup already exists: ${dest}`);
  mkdirSync(dirname(dest), { recursive: true });
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try { await backup(source, dest); } finally { source.close(); }
  chmodSync(dest, 0o600);
  // Single self-contained file: no -wal/-shm sidecars next to the backup.
  const check = new DatabaseSync(dest);
  try {
    if (str((check.prepare('PRAGMA quick_check').get() as Row).quick_check) !== 'ok') throw new Error('Backup is damaged');
    check.exec('PRAGMA journal_mode = DELETE');
  } finally { check.close(); }
}

export const timestamp = (d = new Date()): string => d.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
