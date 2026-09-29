// Persistence across a server restart on a real SQLite file: accounts, sessions and character state
// (debounced saves are flushed on shutdown), plus schema migration bookkeeping.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { MeResponse } from '../../src/contracts/net';
import { GameDatabase } from '../../src/server';
import { api, newPlayer, startTestServer } from './helpers';
import { TestClient } from './ws-client';

const dir = mkdtempSync(join(tmpdir(), 'forge-server-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('persistence', () => {
  it('keeps accounts, sessions and character progress across a restart', async () => {
    const dbPath = join(dir, 'game.db');
    let server = await startTestServer({ dbPath });
    const p = await newPlayer(server.base, 'Keeper');
    const c = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
    await c.waitFor('zone');
    const ch = c.last('character')!.character;
    const mapUid = ch.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect((await c.command({ c: 'moveItem', uid: mapUid, to: { kind: 'mapDevice' } })).ok).toBe(true);
    expect((await c.command({ c: 'rankUpSkill', skillId: 'emberNova' })).ok).toBe(true);
    expect((await c.command({ c: 'renameStashTab', tab: 0, name: 'Wands' })).ok).toBe(true);
    // Shut down right away: the pending (debounced) save must be flushed, and the socket told why.
    const closing = c.waitClose();
    await server.close();
    expect((await closing).code).toBe(4004);

    server = await startTestServer({ dbPath });
    try {
      // The old session token still works.
      const me = await api<MeResponse>(server.base, 'GET', '/api/me', undefined, p.token);
      expect(me.status).toBe(200);
      expect(me.body.characters).toEqual([{ id: p.characterId, name: 'Keeper', level: 1, classId: 'sorceress' }]);
      const c2 = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
      await c2.waitFor('zone');
      const loaded = c2.last('character')!.character;
      expect(loaded.mapDevice?.uid).toBe(mapUid);
      expect(loaded.skillRanks.emberNova).toBe(1);
      expect(loaded.unspentSkillPoints).toBe(0);
      expect(loaded.stash[0].name).toBe('Wands');
      expect(loaded.updatedAt).toBeGreaterThan(0);
      expect(loaded.rngState).toBe(0); // still redacted on the wire
      c2.close();
    } finally {
      await server.close();
    }

    // The schema is versioned (2: restart-safety tables); reopening an up-to-date database changes nothing.
    const db = await GameDatabase.open(dbPath);
    expect(db.schemaVersion).toBe(2);
    expect(db.characterById(p.characterId)?.name).toBe('Keeper');
    db.close();
  });

  it('migrates a version 1 database (before restart safety) without touching its data', async () => {
    const dbPath = join(dir, 'v1.db');
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE INDEX sessions_account ON sessions(account_id);
      CREATE INDEX sessions_expires ON sessions(expires);
      CREATE TABLE characters (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL UNIQUE COLLATE NOCASE, level INTEGER NOT NULL, class_id TEXT NOT NULL DEFAULT 'sorceress', data TEXT NOT NULL, save_version INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE INDEX characters_account ON characters(account_id);
      INSERT INTO accounts VALUES ('a1', 'old_timer', 'x', 'y', 1);
      INSERT INTO characters VALUES ('c1', 'a1', 'Old Timer', 7, 'sorceress', '{}', 1, 1, 1);
      PRAGMA user_version = 1;
    `);
    raw.close();
    const db = await GameDatabase.open(dbPath);
    try {
      expect(db.schemaVersion).toBe(2);
      expect(db.characterById('c1')).toMatchObject({ name: 'Old Timer', level: 7 });
      expect(db.loadParties()).toEqual([]);
      expect(db.loadOpenMaps()).toEqual([]);
      expect(db.characterMap('c1')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('saves debounced changes without a shutdown', async () => {
    const dbPath = join(dir, 'debounce.db');
    const server = await startTestServer({ dbPath, saveDebounceMs: 50 });
    try {
      const p = await newPlayer(server.base, 'Saver');
      const c = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
      await c.waitFor('zone');
      expect((await c.command({ c: 'rankUpSkill', skillId: 'cinderWard' })).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
      const row = server.db.characterById(p.characterId)!;
      expect(JSON.parse(row.data).skillRanks.cinderWard).toBe(1);
      c.close();
    } finally {
      await server.close();
    }
  });
});
