// SQLite persistence (node:sqlite, synchronous): accounts, sessions, characters, and the restart-safety
// state (GAME_SPEC §11): parties, open maps and which map a character stood in.
//
// Schema versions live in PRAGMA user_version; MIGRATIONS[i] upgrades version i → i + 1 inside a transaction.
// File databases run in WAL mode. Everything here is synchronous and fast (single-row statements on indexed
// columns), so the game loop may call it directly; character saves are debounced by the CharacterStore.
// Parties, open maps and map locations are written on every change (rare events, one small row each).
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

type SqliteModule = typeof import('node:sqlite');

let sqlite: SqliteModule | null = null;

/**
 * Load node:sqlite without its one-time ExperimentalWarning (stable enough for us; the warning would only
 * confuse server operators). The warning is emitted synchronously while the builtin loads, so a dynamic
 * import behind a temporary filter catches exactly it and nothing else.
 */
async function loadSqlite(): Promise<SqliteModule> {
  if (sqlite) return sqlite;
  const original = process.emitWarning;
  const filtered = function (this: NodeJS.Process, warning: string | Error, ...rest: unknown[]): void {
    const text = typeof warning === 'string' ? warning : warning.message;
    const opt = rest[0];
    const type = typeof opt === 'string' ? opt : typeof opt === 'object' && opt ? (opt as { type?: string }).type : undefined;
    const name = type ?? (warning instanceof Error ? warning.name : undefined);
    if (name === 'ExperimentalWarning' && /sqlite/i.test(text)) return;
    (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  };
  process.emitWarning = filtered as typeof process.emitWarning;
  try {
    sqlite = await import('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
  return sqlite;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  username: string;
  passHash: string;
  salt: string;
  created: number;
}

export interface CharacterListRow {
  id: string;
  name: string;
  level: number;
  classId: string;
}

export interface CharacterRow extends CharacterListRow {
  accountId: string;
  data: string;
  saveVersion: number;
  created: number;
  updated: number;
}

export type InsertCharacterResult = 'ok' | 'nameTaken' | 'idTaken';

export interface AccountStorageRow {
  accountId: string;
  data: string;
  saveVersion: number;
  updated: number;
}

export interface PartyRow {
  id: string;
  leaderId: string;
  /** Character ids in join order. */
  members: string[];
  created: number;
  /**
   * Wall ms of the last moment a member was in play, as of the party's last change (informational: it is
   * not refreshed while members keep playing, so a restart starts every party's idle window afresh).
   */
  active: number;
}

/** A stored party with its surviving members' last saved name and level. */
export interface LoadedPartyRow extends Omit<PartyRow, 'members'> {
  members: { id: string; name: string; level: number }[];
}

export interface OpenMapRow {
  /** Persistent map id (survives restarts; not the instance id). */
  mapId: string;
  ownerId: string;
  ownerName: string;
  /** JSON of the full RunSetup (map item + seed; never a client-redacted one). */
  setup: string;
  portalsRemaining: number;
  portalsTotal: number;
  cleared: boolean;
  /** JSON array of { id, name } — everyone who has entered the map. */
  participants: string;
  created: number;
  updated: number;
}

/** Where a character stood when its session was last recorded inside a map. */
export interface CharacterMapRow {
  characterId: string;
  mapId: string;
  ownerId: string;
  mapName: string;
  updated: number;
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

const MIGRATIONS: readonly string[] = [
  // 0 → 1: initial schema.
  `
  CREATE TABLE accounts (
    id        TEXT PRIMARY KEY,
    username  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt      TEXT NOT NULL,
    created   INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires    INTEGER NOT NULL
  );
  CREATE INDEX sessions_account ON sessions(account_id);
  CREATE INDEX sessions_expires ON sessions(expires);
  CREATE TABLE characters (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    level        INTEGER NOT NULL,
    class_id     TEXT NOT NULL DEFAULT 'sorceress',
    data         TEXT NOT NULL,
    save_version INTEGER NOT NULL,
    created      INTEGER NOT NULL,
    updated      INTEGER NOT NULL
  );
  CREATE INDEX characters_account ON characters(account_id);
  `,
  // 1 → 2: restart safety (GAME_SPEC §11) — parties, open maps and who stood inside which map survive a
  // deploy. Rows of a deleted character go with it (ON DELETE CASCADE).
  `
  CREATE TABLE parties (
    id        TEXT PRIMARY KEY,
    leader_id TEXT NOT NULL,
    created   INTEGER NOT NULL,
    -- Wall ms of the last moment a member was in play (a party nobody returns to is cleaned up later).
    active    INTEGER NOT NULL
  );
  CREATE TABLE party_members (
    character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    party_id     TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL
  );
  CREATE INDEX party_members_party ON party_members(party_id);
  CREATE TABLE open_maps (
    map_id            TEXT PRIMARY KEY,
    owner_id          TEXT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
    owner_name        TEXT NOT NULL,
    setup             TEXT NOT NULL,
    portals_remaining INTEGER NOT NULL,
    portals_total     INTEGER NOT NULL,
    cleared           INTEGER NOT NULL DEFAULT 0,
    participants      TEXT NOT NULL DEFAULT '[]',
    created           INTEGER NOT NULL,
    updated           INTEGER NOT NULL
  );
  CREATE TABLE character_maps (
    character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    map_id       TEXT NOT NULL,
    owner_id     TEXT NOT NULL,
    map_name     TEXT NOT NULL,
    updated      INTEGER NOT NULL
  );
  `,
  // 2 → 3: shared account stash. Legacy character stashes are merged atomically on first access.
  `
  CREATE TABLE account_storage (
    account_id   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    data         TEXT NOT NULL,
    save_version INTEGER NOT NULL,
    updated      INTEGER NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function isUniqueViolation(err: unknown, column?: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(msg)) return false;
  return column === undefined || msg.includes(column);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? 0));

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export class GameDatabase {
  private readonly stmts = new Map<string, StatementSync>();
  private closed = false;
  private txDepth = 0;

  private constructor(
    private readonly db: DatabaseSync,
    readonly path: string,
  ) {}

  /** Open (creating if needed) and migrate. `:memory:` gives a private in-memory database. */
  static async open(path: string): Promise<GameDatabase> {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    const g = new GameDatabase(db, path);
    g.configure();
    g.migrate();
    return g;
  }

  private configure(): void {
    if (this.path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
    }
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  get schemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get();
    return num(row?.user_version);
  }

  private migrate(): void {
    let v = this.schemaVersion;
    if (v > MIGRATIONS.length) throw new Error(`database schema v${v} is newer than this server (v${MIGRATIONS.length})`);
    while (v < MIGRATIONS.length) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
      v++;
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private get(sql: string, ...params: SQLInputValue[]): Record<string, unknown> | undefined {
    return this.stmt(sql).get(...params) as Record<string, unknown> | undefined;
  }

  private all(sql: string, ...params: SQLInputValue[]): Record<string, unknown>[] {
    return this.stmt(sql).all(...params) as Record<string, unknown>[];
  }

  private run(sql: string, ...params: SQLInputValue[]): number {
    return num(this.stmt(sql).run(...params).changes);
  }

  /** Run `fn` in one transaction (re-entrant: a nested call joins the outer transaction). */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.txDepth = 0;
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.txDepth = 0;
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stmts.clear();
    this.db.close();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  // --- accounts ---------------------------------------------------------------------------

  /** False when the username is taken (case-insensitive). */
  createAccount(a: AccountRow): boolean {
    try {
      this.run(
        'INSERT INTO accounts (id, username, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?)',
        a.id, a.username, a.passHash, a.salt, a.created,
      );
      return true;
    } catch (err) {
      if (isUniqueViolation(err, 'username')) return false;
      throw err;
    }
  }

  private toAccount(row: Record<string, unknown> | undefined): AccountRow | null {
    if (!row) return null;
    return { id: str(row.id), username: str(row.username), passHash: str(row.pass_hash), salt: str(row.salt), created: num(row.created) };
  }

  accountByUsername(username: string): AccountRow | null {
    return this.toAccount(this.get('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE', username));
  }

  accountById(id: string): AccountRow | null {
    return this.toAccount(this.get('SELECT * FROM accounts WHERE id = ?', id));
  }

  // --- sessions ---------------------------------------------------------------------------

  createSession(tokenHash: string, accountId: string, expires: number): void {
    this.run('INSERT INTO sessions (token_hash, account_id, expires) VALUES (?, ?, ?)', tokenHash, accountId, expires);
  }

  /** The account behind a (hashed) session token, or null when unknown or expired. */
  sessionAccount(tokenHash: string, now: number): AccountRow | null {
    return this.toAccount(
      this.get(
        'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires > ?',
        tokenHash, now,
      ),
    );
  }

  deleteSession(tokenHash: string): boolean {
    return this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash) > 0;
  }

  purgeExpiredSessions(now: number): number {
    return this.run('DELETE FROM sessions WHERE expires <= ?', now);
  }

  // --- characters -------------------------------------------------------------------------

  accountStorage(accountId: string): AccountStorageRow | null {
    const r = this.get('SELECT * FROM account_storage WHERE account_id = ?', accountId);
    return r ? { accountId, data: str(r.data), saveVersion: num(r.save_version), updated: num(r.updated) } : null;
  }

  saveAccountStorage(row: AccountStorageRow): void {
    this.run(
      `INSERT INTO account_storage (account_id, data, save_version, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, save_version=excluded.save_version, updated=excluded.updated`,
      row.accountId, row.data, row.saveVersion, row.updated,
    );
  }

  listCharacters(accountId: string): CharacterListRow[] {
    return this.all('SELECT id, name, level, class_id FROM characters WHERE account_id = ? ORDER BY created, id', accountId).map(
      (r) => ({ id: str(r.id), name: str(r.name), level: num(r.level), classId: str(r.class_id) }),
    );
  }

  countCharacters(accountId: string): number {
    return num(this.get('SELECT COUNT(*) AS n FROM characters WHERE account_id = ?', accountId)?.n);
  }

  characterById(id: string): CharacterRow | null {
    const r = this.get('SELECT * FROM characters WHERE id = ?', id);
    if (!r) return null;
    return {
      id: str(r.id),
      accountId: str(r.account_id),
      name: str(r.name),
      level: num(r.level),
      classId: str(r.class_id),
      data: str(r.data),
      saveVersion: num(r.save_version),
      created: num(r.created),
      updated: num(r.updated),
    };
  }

  /** Case-insensitive lookup by character name. */
  characterByName(name: string): CharacterListRow & { accountId: string } | null {
    const r = this.get('SELECT id, account_id, name, level, class_id FROM characters WHERE name = ? COLLATE NOCASE', name);
    if (!r) return null;
    return { id: str(r.id), accountId: str(r.account_id), name: str(r.name), level: num(r.level), classId: str(r.class_id) };
  }

  insertCharacter(row: CharacterRow): InsertCharacterResult {
    try {
      this.run(
        `INSERT INTO characters (id, account_id, name, level, class_id, data, save_version, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id, row.accountId, row.name, row.level, row.classId, row.data, row.saveVersion, row.created, row.updated,
      );
      return 'ok';
    } catch (err) {
      if (isUniqueViolation(err, 'characters.name')) return 'nameTaken';
      if (isUniqueViolation(err, 'characters.id')) return 'idTaken';
      throw err;
    }
  }

  /** Persist a character's state. Returns false when the row no longer exists (deleted meanwhile). */
  saveCharacter(id: string, level: number, data: string, saveVersion: number, updated: number): boolean {
    return this.run('UPDATE characters SET level = ?, data = ?, save_version = ?, updated = ? WHERE id = ?', level, data, saveVersion, updated, id) > 0;
  }

  deleteCharacter(id: string, accountId: string): boolean {
    return this.run('DELETE FROM characters WHERE id = ? AND account_id = ?', id, accountId) > 0;
  }

  // --- parties ----------------------------------------------------------------------------

  /** Insert or replace a party with its members (a member listed in another party row moves here). */
  saveParty(p: PartyRow): void {
    this.transaction(() => {
      this.run('INSERT OR REPLACE INTO parties (id, leader_id, created, active) VALUES (?, ?, ?, ?)', p.id, p.leaderId, p.created, p.active);
      this.run('DELETE FROM party_members WHERE party_id = ?', p.id);
      p.members.forEach((m, position) => {
        this.run('INSERT OR REPLACE INTO party_members (character_id, party_id, position) VALUES (?, ?, ?)', m, p.id, position);
      });
    });
  }

  deleteParty(id: string): void {
    this.run('DELETE FROM parties WHERE id = ?', id);
  }

  /** Every stored party with its members (join order), their names and last saved levels. */
  loadParties(): LoadedPartyRow[] {
    const parties = this.all('SELECT id, leader_id, created, active FROM parties ORDER BY created, id');
    const members = this.all(
      `SELECT m.party_id, m.character_id, c.name, c.level FROM party_members m
       JOIN characters c ON c.id = m.character_id ORDER BY m.party_id, m.position`,
    );
    const byParty = new Map<string, { id: string; name: string; level: number }[]>();
    for (const r of members) {
      const list = byParty.get(str(r.party_id)) ?? [];
      list.push({ id: str(r.character_id), name: str(r.name), level: num(r.level) });
      byParty.set(str(r.party_id), list);
    }
    return parties.map((r) => ({
      id: str(r.id),
      leaderId: str(r.leader_id),
      created: num(r.created),
      active: num(r.active),
      members: byParty.get(str(r.id)) ?? [],
    }));
  }

  // --- open maps ----------------------------------------------------------------------------

  /** Insert or update an open map (one per owner: an older row of the same owner is replaced). */
  saveOpenMap(m: OpenMapRow): void {
    this.run(
      `INSERT OR REPLACE INTO open_maps
         (map_id, owner_id, owner_name, setup, portals_remaining, portals_total, cleared, participants, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.mapId, m.ownerId, m.ownerName, m.setup, m.portalsRemaining, m.portalsTotal, m.cleared ? 1 : 0, m.participants, m.created, m.updated,
    );
  }

  /** True when a row was deleted. */
  deleteOpenMap(mapId: string): boolean {
    return this.run('DELETE FROM open_maps WHERE map_id = ?', mapId) > 0;
  }

  loadOpenMaps(): OpenMapRow[] {
    return this.all('SELECT * FROM open_maps ORDER BY created, map_id').map((r) => ({
      mapId: str(r.map_id),
      ownerId: str(r.owner_id),
      ownerName: str(r.owner_name),
      setup: str(r.setup),
      portalsRemaining: num(r.portals_remaining),
      portalsTotal: num(r.portals_total),
      cleared: num(r.cleared) !== 0,
      participants: str(r.participants),
      created: num(r.created),
      updated: num(r.updated),
    }));
  }

  // --- where characters stand (inside a map) ----------------------------------------------

  setCharacterMap(row: CharacterMapRow): void {
    this.run(
      'INSERT OR REPLACE INTO character_maps (character_id, map_id, owner_id, map_name, updated) VALUES (?, ?, ?, ?, ?)',
      row.characterId, row.mapId, row.ownerId, row.mapName, row.updated,
    );
  }

  clearCharacterMap(characterId: string): void {
    this.run('DELETE FROM character_maps WHERE character_id = ?', characterId);
  }

  characterMap(characterId: string): CharacterMapRow | null {
    const r = this.get('SELECT * FROM character_maps WHERE character_id = ?', characterId);
    if (!r) return null;
    return { characterId: str(r.character_id), mapId: str(r.map_id), ownerId: str(r.owner_id), mapName: str(r.map_name), updated: num(r.updated) };
  }
}
