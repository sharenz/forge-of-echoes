// Run on the database host: read-only source → fresh audit copy → migration/conservation/reload audit.
// No character contents, account names, credentials or session tokens are printed.
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CharacterSave, Item } from '../src/contracts/items';
import { rules } from '../src/game';
import { CharacterStore } from '../src/server/characters';
import { GameDatabase } from '../src/server/db';
import { silentLogger } from '../src/server/log';
import { parseAccountStorage } from '../src/server/account-storage';

const [sourcePath, auditPath] = process.argv.slice(2);
if (!sourcePath || !auditPath || resolve(sourcePath) === resolve(auditPath) || existsSync(auditPath)) {
  throw new Error('Usage: audit-account-storage.ts <read-only source> <new, separate audit database>');
}
const live = new DatabaseSync(sourcePath, { readOnly: true });
await backup(live, auditPath);
live.close();
// Read the baseline from the same snapshot that will be migrated, even if players keep playing live.
const source = new DatabaseSync(auditPath, { readOnly: true });
const rows = source.prepare('SELECT id, account_id, data, save_version FROM characters ORDER BY created, id').all();
const before = new Map<string, CharacterSave[]>();
const canonical = new Map<string, ReturnType<typeof parseAccountStorage>>();
if (source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_storage'").get()) {
  for (const row of source.prepare('SELECT account_id, data FROM account_storage').all()) {
    canonical.set(String(row.account_id), parseAccountStorage(String(row.data)));
  }
}
for (const row of rows) {
  const ch = rules.parseSave(JSON.stringify({ version: row.save_version, characters: [JSON.parse(String(row.data))] })).characters[0];
  if (!ch) throw new Error('Unreadable source character');
  const account = String(row.account_id);
  before.set(account, [...(before.get(account) ?? []), { ...ch, ...canonical.get(account) }]);
}
source.close();

function privateItems(ch: CharacterSave): Item[] {
  return [...Object.values(ch.equipment).filter((i): i is NonNullable<typeof i> => !!i), ...ch.backpack.entries.map((e) => e.item), ...(ch.mapScarabs ?? []).filter((s): s is NonNullable<typeof s> => !!s), ...(ch.mapDevice ? [ch.mapDevice] : [])];
}
function sharedItems(ch: CharacterSave): Item[] {
  return [...ch.stash.flatMap((t) => t.grid.entries.map((e) => e.item)), ...ch.mapStash, ...(ch.craftSlot ? [ch.craftSlot] : [])];
}
function fingerprint(chars: CharacterSave[], shared: boolean): string {
  const tally = new Map<string, number>();
  const add = (key: string, n = 1) => tally.set(key, (tally.get(key) ?? 0) + n);
  for (const ch of chars) {
    for (const i of privateItems(ch)) {
      if (i.kind === 'currency') add(`currency:${i.currencyId}`, i.count);
      else if (i.kind === 'flask') add(`flask:${i.flaskId}`, i.count);
      else { const { uid: _uid, ...content } = i; add(JSON.stringify(content)); }
    }
    for (const b of ch.belt) if (b && b.count) add(`flask:${b.flaskId}`, b.count);
  }
  for (const ch of shared ? chars.slice(0, 1) : chars) {
    for (const i of sharedItems(ch)) {
      if (i.kind === 'currency') add(`currency:${i.currencyId}`, i.count);
      else if (i.kind === 'flask') add(`flask:${i.flaskId}`, i.count);
      else { const { uid: _uid, ...content } = i; add(JSON.stringify(content)); }
    }
    for (const [id, n] of Object.entries(ch.currencyStash)) if (n) add(`currency:${id}`, n);
  }
  return JSON.stringify([...tally].sort(([a], [b]) => a.localeCompare(b)));
}

let db = await GameDatabase.open(auditPath);
let store = new CharacterStore(db, silentLogger, { saveDebounceMs: 60_000, now: Date.now });
const migrated = new Map<string, string>();
let physicalItems = 0;
let normalTabs = 0;
let encodedBytes = 0;
for (const [accountId, original] of before) {
  const records = original.map((ch) => store.acquire(ch.id)!);
  if (records.some((r) => !r)) throw new Error('Migration did not load every character');
  const chars = records.map((r) => r.ch);
  if (fingerprint(original, canonical.has(accountId)) !== fingerprint(chars, true)) throw new Error('Account inventory conservation failed');
  const all = [...chars.flatMap(privateItems), ...sharedItems(chars[0])];
  if (new Set(all.map((i) => i.uid)).size !== all.length || all.some((i) => !/^[A-Za-z0-9_:.-]{1,64}$/.test(i.uid))) throw new Error('Account item ID audit failed');
  physicalItems += all.length;
  normalTabs += chars[0].stash.length;
  encodedBytes = Math.max(encodedBytes, ...chars.map((ch) => Buffer.byteLength(JSON.stringify({ t: 'character', character: ch }))));
  migrated.set(accountId, db.accountStorage(accountId)!.data);
  for (const r of records) store.release(r);
  for (const ch of original) {
    const stored = JSON.parse(db.characterById(ch.id)!.data);
    if (stored.stash.length || stored.mapStash.length || Object.keys(stored.currencyStash).length) throw new Error('Shared holdings still duplicated on a character row');
  }
}
db.close();
db = await GameDatabase.open(auditPath);
store = new CharacterStore(db, silentLogger, { saveDebounceMs: 60_000, now: Date.now });
for (const [accountId, original] of before) {
  const records = original.map((ch) => store.acquire(ch.id)!);
  if (fingerprint(original, canonical.has(accountId)) !== fingerprint(records.map((r) => r.ch), true)) throw new Error('Reload inventory conservation failed');
  for (const r of records) store.release(r);
  if (db.accountStorage(accountId)!.data !== migrated.get(accountId)) throw new Error('Account migration repeated on reload');
}
db.close();
const check = new DatabaseSync(auditPath, { readOnly: true });
const integrity = check.prepare('PRAGMA quick_check').get()?.quick_check;
check.close();
if (integrity !== 'ok') throw new Error('Audit database integrity check failed');
console.log(JSON.stringify({ ok: true, accounts: before.size, characters: rows.length, physicalItems, normalTabs, largestCharacterBytes: encodedBytes, inventoryConserved: true, uniqueItemIds: true, noDuplicateStorage: true, reloadIdempotent: true, integrity }));
