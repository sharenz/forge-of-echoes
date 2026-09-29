// Character persistence on top of the database: creation, loading (migrated + normalised by the shared
// rules), an in-memory cache of the characters in play, and debounced saves (at most one write per
// character per second while it changes; flushed when it leaves play and on shutdown). Item hand-overs
// between characters (public drops, trades) flush at once — a trade both sides in one transaction.
import { randomInt } from 'node:crypto';
import type { CharacterSummary } from '../contracts/net';
import type { CharacterSave } from '../contracts/items';
import { rules, validateCharacterName } from '../game';
import type { GameDatabase, CharacterRow } from './db';
import type { Logger } from './log';

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
    const ch = this.parseRow(row);
    if (!ch) {
      this.log.error('character data unreadable', { character: id });
      return null;
    }
    const rec: CharacterRecord = { id, accountId: row.accountId, ch, dirty: false, refs: 1, saveTimer: null, deleted: false };
    this.cache.set(id, rec);
    return rec;
  }

  /** Drop a reference; the last one flushes and evicts the record. */
  release(rec: CharacterRecord): void {
    rec.refs = Math.max(0, rec.refs - 1);
    if (rec.refs > 0) return;
    this.flush(rec);
    if (this.cache.get(rec.id) === rec) this.cache.delete(rec.id);
  }

  /** Replace the character state and schedule a save. */
  set(rec: CharacterRecord, ch: CharacterSave): void {
    if (rec.ch === ch) return;
    rec.ch = ch;
    if (rec.deleted) return;
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
    if (!rec.dirty || rec.deleted || !this.db.isOpen) return;
    try {
      const now = this.opts.now();
      const ch = { ...rec.ch, updatedAt: now };
      rec.ch = ch;
      const exists = this.db.saveCharacter(rec.id, ch.level, JSON.stringify(ch), this.saveVersion, now);
      rec.dirty = false;
      if (!exists) rec.deleted = true;
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
    const pending: CharacterRecord[] = [];
    for (const rec of recs) {
      if (rec.saveTimer) {
        clearTimeout(rec.saveTimer);
        rec.saveTimer = null;
      }
      if (rec.dirty && !rec.deleted && !pending.includes(rec)) pending.push(rec);
    }
    if (pending.length === 0 && !alsoWrite) return;
    if (!this.db.isOpen) throw new Error('the database is closed');
    const now = this.opts.now();
    const states = pending.map((rec) => ({ ...rec.ch, updatedAt: now }));
    const exists = this.db.transaction(() => {
      alsoWrite?.();
      return pending.map((rec, k) => this.db.saveCharacter(rec.id, states[k].level, JSON.stringify(states[k]), this.saveVersion, now));
    });
    pending.forEach((rec, k) => {
      rec.ch = states[k];
      rec.dirty = false;
      if (!exists[k]) rec.deleted = true;
    });
  }

  /**
   * Save `next` as the record's state together with `alsoWrite` (another table's half of the same hand-over,
   * e.g. deleting the open-map row of a refunded map) in ONE transaction, and only then adopt it in memory.
   * Returns false — logged, with the record left exactly as it was — when the write failed or the character
   * no longer exists.
   */
  commit(rec: CharacterRecord, next: CharacterSave, alsoWrite?: () => void): boolean {
    if (rec.deleted || !this.db.isOpen) return false;
    const now = this.opts.now();
    const ch: CharacterSave = { ...next, updatedAt: now };
    let exists: boolean;
    try {
      exists = this.db.transaction(() => {
        alsoWrite?.();
        return this.db.saveCharacter(rec.id, ch.level, JSON.stringify(ch), this.saveVersion, now);
      });
    } catch (err) {
      this.log.error('character save failed', { character: rec.id, err });
      return false;
    }
    if (rec.saveTimer) {
      clearTimeout(rec.saveTimer);
      rec.saveTimer = null;
    }
    rec.ch = ch;
    rec.dirty = false;
    if (!exists) rec.deleted = true;
    return exists;
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
    for (let attempt = 0; attempt < 5; attempt++) {
      // A server-random seed: it seeds the character id and the character's crafting rng.
      const now = this.opts.now();
      const ch: CharacterSave = { ...rules.createCharacter(rawName, randomInt(0, 2 ** 32)), createdAt: now, updatedAt: now };
      const result = this.db.insertCharacter({
        id: ch.id,
        accountId,
        name: ch.name,
        level: ch.level,
        classId: ch.classId,
        data: JSON.stringify(ch),
        saveVersion: this.saveVersion,
        created: now,
        updated: now,
      });
      if (result === 'ok') return { ok: true, character: { id: ch.id, name: ch.name, level: ch.level, classId: ch.classId } };
      if (result === 'nameTaken') return { ok: false, status: 409, error: `The name "${ch.name}" is already taken.` };
      // 'idTaken': astronomically unlikely id collision — roll a new seed.
    }
    return { ok: false, status: 500, error: 'Could not create the character. Please try again.' };
  }

  /** Delete an account's character (the caller makes sure it is not in play). */
  delete(accountId: string, id: string): boolean {
    const ok = this.db.deleteCharacter(id, accountId);
    const rec = this.cache.get(id);
    if (ok && rec) {
      rec.deleted = true;
      if (rec.saveTimer) clearTimeout(rec.saveTimer);
      rec.saveTimer = null;
      this.cache.delete(id);
    }
    return ok;
  }

  ownerOf(id: string): string | null {
    return this.cache.get(id)?.accountId ?? this.db.characterById(id)?.accountId ?? null;
  }
}
