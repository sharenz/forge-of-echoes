// Character persistence on top of the database: creation, loading (migrated + normalised by the shared
// rules), one shared stash per account, and debounced saves. Stash transfers persist together with every
// dirty character on the account; shared fields on CharacterSave are projections, never duplicate rows.
// Public drops/trades flush immediately, and legacy stashes merge atomically on first account access.
import { randomInt } from 'node:crypto';
import type { CharacterSummary } from '../contracts/net';
import type { CharacterSave } from '../contracts/items';
import { rules, validateCharacterName } from '../game';
import { bindLegacyMaps } from '../game/progression';
import type { GameDatabase, CharacterRow } from './db';
import type { Logger } from './log';
import { mergeLegacyStorage, namespaceItems, parseAccountStorage, sameStorage, storageOf, withoutStorage, type AccountStorage } from './account-storage';

export const MAX_CHARACTERS_PER_ACCOUNT = 12;

export interface CharacterRecord {
  readonly id: string;
  readonly accountId: string;
  /** The authoritative state (never mutated in place: every change swaps in a new object). */
  ch: CharacterSave;
  dirty: boolean;
  /** Holders keeping this record in memory (a session, a pending map result…). */
  refs: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** Deleted through the API: never written again. */
  deleted: boolean;
}

export type CreateCharacterResult =
  | { ok: true; character: CharacterSummary }
  | { ok: false; status: number; error: string };

export interface CharacterStoreOptions {
  saveDebounceMs: number;
  now: () => number;
}

export class CharacterStore {
  private readonly cache = new Map<string, CharacterRecord>();
  private readonly accounts = new Map<string, { storage: AccountStorage; dirty: boolean }>();
  /** Notify other online characters when their shared stash projection changes. */
  onSharedChange: (rec: CharacterRecord) => void = () => {};
  /** The rules' current save-format version (stored per row so old rows can be migrated by parseSave). */
  readonly saveVersion = rules.newSave().version;

  constructor(
    private readonly db: GameDatabase,
    private readonly log: Logger,
    private readonly opts: CharacterStoreOptions,
  ) {}

  /** Normalise a stored row into a valid CharacterSave (null only for unreadable data). */
  private parseRow(row: CharacterRow): CharacterSave | null {
    // Wrap the character into a SaveGame of its stored version: parseSave migrates and normalises it.
    const json = `{"version":${Math.max(0, Math.floor(row.saveVersion))},"characters":[${row.data}],"lastCharacterId":null,"settings":null}`;
    const ch = rules.parseSave(json).characters[0];
    if (!ch) return null;
    return ch.id === row.id && ch.name === row.name ? ch : { ...ch, id: row.id, name: row.name };
  }

  private account(accountId: string): { storage: AccountStorage; dirty: boolean } {
    const cached = this.accounts.get(accountId);
    if (cached) return cached;
    const row = this.db.accountStorage(accountId);
    let storage: AccountStorage;
    if (row) {
      if (row.saveVersion > this.saveVersion) throw new Error('Account storage is from a newer server');
      storage = parseAccountStorage(row.data);
    } else {
      const characters = this.db.listCharacters(accountId).map(({ id }) => {
        const ch = this.parseRow(this.db.characterById(id)!);
        if (!ch) throw new Error(`Cannot migrate unreadable character ${id}`);
        return namespaceItems(ch);
      });
      storage = mergeLegacyStorage(characters);
      const now = this.opts.now();
      this.db.transaction(() => {
        for (const ch of characters) {
          if (!this.db.saveCharacter(ch.id, ch.level, JSON.stringify(withoutStorage(ch)), this.saveVersion, now)) {
            throw new Error('Character disappeared during account migration');
          }
        }
        this.db.saveAccountStorage({ accountId, data: JSON.stringify(storage), saveVersion: this.saveVersion, updated: now });
      });
      this.log.info('account stash migrated', { account: accountId, characters: characters.length, tabs: storage.stash.length });
    }
    const account = { storage, dirty: false };
    this.accounts.set(accountId, account);
    return account;
  }

  private publishStorage(accountId: string, storage: AccountStorage, except?: CharacterRecord): void {
    for (const other of this.cache.values()) {
      if (other.accountId !== accountId || other === except || other.deleted) continue;
      other.ch = { ...other.ch, ...storage };
      try { this.onSharedChange(other); }
      catch (err) { this.log.error('shared stash notification failed', { character: other.id, err }); }
    }
  }

  private evictAccount(accountId: string): void {
    if (!this.accounts.get(accountId)?.dirty && ![...this.cache.values()].some((r) => r.accountId === accountId)) this.accounts.delete(accountId);
  }

  /** A cached record (characters in play), without loading. */
  peek(id: string): CharacterRecord | null {
    return this.cache.get(id) ?? null;
  }

  /** Load (or reuse) a character and hold a reference to it. Null when it does not exist or is unreadable. */
  acquire(id: string): CharacterRecord | null {
    const cached = this.cache.get(id);
    if (cached) {
      cached.refs++;
      return cached;
    }
    const row = this.db.characterById(id);
    if (!row) return null;
    const account = this.account(row.accountId);
    // The first access may have migrated every character row; read the committed private state again.
    const parsed = this.parseRow(this.db.characterById(id)!);
    const ch = parsed ? { ...parsed, ...account.storage } : null;
    if (!ch) {
      this.log.error('character data unreadable', { character: id });
      return null;
    }
    const rec: CharacterRecord = { id, accountId: row.accountId, ch, dirty: false, refs: 1, saveTimer: null, deleted: false };
    this.cache.set(id, rec);
    // Maps saved before they were area-bound meet the account's Atlas here (the character row has no atlas of its own): bind
    // them once; set() persists the result (and the shared storage, if a last-resort binding charted an area).
    const bound = bindLegacyMaps(ch);
    if (bound !== ch) this.set(rec, bound);
    return rec;
  }

  /** Drop a reference; the last one flushes and evicts the record. */
  release(rec: CharacterRecord): void {
    rec.refs = Math.max(0, rec.refs - 1);
    if (rec.refs > 0) return;
    this.flush(rec);
    if (rec.dirty && !rec.deleted) return; // failed writes stay retryable in memory
    if (this.cache.get(rec.id) === rec) this.cache.delete(rec.id);
    this.evictAccount(rec.accountId);
  }

  /** Replace the character state and schedule a save. */
  set(rec: CharacterRecord, ch: CharacterSave): void {
    if (rec.ch === ch || rec.deleted) return;
    const account = this.account(rec.accountId);
    const storage = storageOf(ch);
    const sharedChanged = !sameStorage(account.storage, storage);
    rec.ch = ch;
    if (sharedChanged) {
      account.storage = storage;
      account.dirty = true;
      this.publishStorage(rec.accountId, storage, rec);
    }
    rec.dirty = true;
    if (!rec.saveTimer) {
      rec.saveTimer = setTimeout(() => {
        rec.saveTimer = null;
        this.flush(rec);
      }, this.opts.saveDebounceMs);
      rec.saveTimer.unref?.();
    }
  }

  /** Write pending changes now. Errors are logged and the record stays dirty (retried on the next change). */
  flush(rec: CharacterRecord): void {
    if (rec.saveTimer) {
      clearTimeout(rec.saveTimer);
      rec.saveTimer = null;
    }
    if (rec.deleted || !this.db.isOpen) return;
    try {
      this.writeTogether([rec]);
    } catch (err) {
      this.log.error('character save failed', { character: rec.id, err });
    }
  }

  /**
   * Write several records now, in ONE transaction: either every pending change lands or none does (an
   * atomic trade must never persist one side without the other). Returns true when committed; errors are
   * logged and the records stay dirty (retried on their next change, release or shutdown).
   */
  flushTogether(recs: readonly CharacterRecord[]): boolean {
    try {
      this.writeTogether(recs);
      return true;
    } catch (err) {
      this.log.error('character save failed', { characters: recs.map((r) => r.id).join(','), err });
      return false;
    }
  }

  /**
   * flushTogether() that THROWS on failure, with `alsoWrite` — another row that must land together with
   * these characters (an open map with its owner's consumed map item) — run inside the same transaction.
   * Records are marked clean only after the commit; on failure they stay dirty and nothing was written.
   */
  writeTogether(recs: readonly CharacterRecord[], alsoWrite?: () => void): void {
    this.persist(recs, alsoWrite);
  }

  /** A shared transfer saves every dirty character of those accounts, so neither half can outlive the other. */
  private persist(recs: readonly CharacterRecord[], alsoWrite?: () => void, override?: { rec: CharacterRecord; ch: CharacterSave }): void {
    const ids = new Set(recs.filter((r) => !r.deleted).map((r) => r.accountId));
    const accounts = [...ids].map((id) => ({ id, record: this.account(id) }));
    const pending = [...this.cache.values()].filter((r) => ids.has(r.accountId) && !r.deleted && (r.dirty || r === override?.rec));
    for (const rec of pending) {
      if (rec.saveTimer) {
        clearTimeout(rec.saveTimer);
        rec.saveTimer = null;
      }
    }
    if (pending.length === 0 && !alsoWrite && !accounts.some((a) => a.record.dirty)) return;
    if (!this.db.isOpen) throw new Error('the database is closed');
    const now = this.opts.now();
    const states = pending.map((rec) => ({ ...(rec === override?.rec ? override.ch : rec.ch), updatedAt: now }));
    const shared = accounts.map(({ id, record }) => ({ id, record, storage: id === override?.rec.accountId ? storageOf(override.ch) : record.storage }));
    this.db.transaction(() => {
      alsoWrite?.();
      for (let k = 0; k < pending.length; k++) {
        if (!this.db.saveCharacter(pending[k].id, states[k].level, JSON.stringify(withoutStorage(states[k])), this.saveVersion, now)) {
          throw new Error('Character disappeared during save');
        }
      }
      for (const { id, record, storage } of shared) if (record.dirty || id === override?.rec.accountId) {
        this.db.saveAccountStorage({ accountId: id, data: JSON.stringify(storage), saveVersion: this.saveVersion, updated: now });
      }
    });
    pending.forEach((rec, k) => {
      rec.ch = states[k];
      rec.dirty = false;
    });
    for (const { id, record, storage } of shared) {
      const changed = !sameStorage(record.storage, storage);
      record.storage = storage;
      record.dirty = false;
      if (changed) this.publishStorage(id, storage, override?.rec);
    }
  }

  /**
   * Save `next` as the record's state together with `alsoWrite` (another table's half of the same hand-over,
   * e.g. deleting the open-map row of a refunded map) in ONE transaction, and only then adopt it in memory.
   * Returns false — logged, with the record left exactly as it was — when the write failed or the character
   * no longer exists. `alsoRecords` includes another account's pending state when the same world-row write
   * depends on it (a guest's Atlas receipt must include the map owner's consumed item).
   */
  commit(rec: CharacterRecord, next: CharacterSave, alsoWrite?: () => void, alsoRecords: readonly CharacterRecord[] = []): boolean {
    if (rec.deleted || !this.db.isOpen) return false;
    try {
      this.persist([rec, ...alsoRecords], alsoWrite, { rec, ch: next });
      return true;
    } catch (err) {
      this.log.error('character save failed', { character: rec.id, err });
      return false;
    }
  }

  flushAll(): void {
    for (const rec of this.cache.values()) this.flush(rec);
  }

  get cachedCount(): number {
    return this.cache.size;
  }

  // --- account-level operations (HTTP API) ----------------------------------------------

  list(accountId: string): CharacterSummary[] {
    return this.db.listCharacters(accountId).map((r) => {
      // Characters in play may be ahead of their last save.
      const live = this.cache.get(r.id);
      return { id: r.id, name: r.name, level: live ? live.ch.level : r.level, classId: r.classId };
    });
  }

  create(accountId: string, rawName: unknown): CreateCharacterResult {
    const invalid = validateCharacterName(rawName);
    if (invalid || typeof rawName !== 'string') return { ok: false, status: 400, error: invalid ?? 'Choose a name for your character.' };
    if (this.db.countCharacters(accountId) >= MAX_CHARACTERS_PER_ACCOUNT) {
      return { ok: false, status: 409, error: `You can have at most ${MAX_CHARACTERS_PER_ACCOUNT} characters. Delete one to make room.` };
    }
    this.account(accountId);
    for (let attempt = 0; attempt < 5; attempt++) {
      // A server-random seed: it seeds the character id and the character's crafting rng.
      const now = this.opts.now();
      const ch = namespaceItems({ ...rules.createCharacter(rawName, randomInt(0, 2 ** 32)), createdAt: now, updatedAt: now });
      const result = this.db.insertCharacter({
        id: ch.id,
        accountId,
        name: ch.name,
        level: ch.level,
        classId: ch.classId,
        data: JSON.stringify(withoutStorage(ch)),
        saveVersion: this.saveVersion,
        created: now,
        updated: now,
      });
      if (result === 'ok') {
        this.evictAccount(accountId);
        return { ok: true, character: { id: ch.id, name: ch.name, level: ch.level, classId: ch.classId } };
      }
      if (result === 'nameTaken') {
        this.evictAccount(accountId);
        return { ok: false, status: 409, error: `The name "${ch.name}" is already taken.` };
      }
      // 'idTaken': astronomically unlikely id collision — roll a new seed.
    }
    this.evictAccount(accountId);
    return { ok: false, status: 500, error: 'Could not create the character. Please try again.' };
  }

  /** Delete an account's character (the caller makes sure it is not in play). */
  delete(accountId: string, id: string): boolean {
    if (this.ownerOf(id) !== accountId) return false;
    this.account(accountId); // migrate the legacy stash before its character can be deleted
    this.writeTogether([...this.cache.values()].filter((r) => r.accountId === accountId));
    const ok = this.db.deleteCharacter(id, accountId);
    const rec = this.cache.get(id);
    if (ok && rec) {
      rec.deleted = true;
      if (rec.saveTimer) clearTimeout(rec.saveTimer);
      rec.saveTimer = null;
      this.cache.delete(id);
    }
    this.evictAccount(accountId);
    return ok;
  }

  ownerOf(id: string): string | null {
    return this.cache.get(id)?.accountId ?? this.db.characterById(id)?.accountId ?? null;
  }
}
