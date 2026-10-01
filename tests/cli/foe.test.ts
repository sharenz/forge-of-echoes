import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdminClient } from '../../src/cli/admin-client';
import { backupDatabase, executeReset, openDb, planReset } from '../../src/cli/data';
import { applyKey, parseKeys, renderPicker, visibleChoices } from '../../src/cli/prompt';
import type { PickerState } from '../../src/cli/prompt';
import { fuzzyFilter, fuzzyScore } from '../../src/cli/fuzzy';
import { runCli } from '../../src/cli/foe';
import type { Ctx } from '../../src/cli/foe';
import { GameDatabase } from '../../src/server/db';
import { createLocalCharacter, LocalPlayer, partyUp, startTestServer } from '../server/helpers';

const root = mkdtempSync(join(tmpdir(), 'foe-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

interface Fixture { dir: string; dbPath: string }

/** A database with two accounts, three characters and every kind of progress row. */
async function seed(): Promise<Fixture> {
  const dir = join(root, `db${++n}`);
  const dbPath = join(dir, 'forge.db');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const db = await GameDatabase.open(dbPath);
  const t = 1_700_000_000_000;
  db.createAccount({ id: 'a1', username: 'Sharenz', passHash: 'x', salt: 'x', created: t });
  db.createAccount({ id: 'a2', username: 'Mira', passHash: 'x', salt: 'x', created: t + 1000 });
  db.createAccount({ id: 'a3', username: 'Empty', passHash: 'x', salt: 'x', created: t + 2000 });
  const mk = (id: string, account: string, name: string, level: number, classId: string): void => {
    db.insertCharacter({ id, accountId: account, name, level, classId, data: '{}', saveVersion: 1, created: t, updated: t + level * 1000 });
  };
  mk('c1', 'a1', 'Eldurin', 40, 'sorceress');
  mk('c2', 'a1', 'Alt', 3, 'warrior');
  mk('c3', 'a2', 'Nova', 12, 'sorceress');
  mk('c4', 'a2', 'Zed', 5, 'warrior');
  db.saveAccountStorage({ accountId: 'a1', data: JSON.stringify({ stash: [[], []], atlas: { tiersCleared: [2, 5], clears: 7, completed: ['x'] } }), saveVersion: 1, updated: t });
  db.saveAccountStorage({ accountId: 'a2', data: JSON.stringify({ stash: [[]], atlas: { tiersCleared: [1], clears: 1, completed: [] } }), saveVersion: 1, updated: t });
  db.saveAtlasCredit({ mapId: 'm1', accountId: 'a1', characterId: 'c1', areaId: 'x', seed: 1, tier: 2 });
  db.saveAtlasCredit({ mapId: 'm2', accountId: 'a2', characterId: 'c3', areaId: 'x', seed: 1, tier: 1 });
  db.saveParty({ id: 'p1', leaderId: 'c1', members: ['c1', 'c3', 'c4'], created: t, active: t });
  db.saveOpenMap({ mapId: 'm1', ownerId: 'c1', ownerName: 'Eldurin', setup: '{}', portalsRemaining: 3, portalsTotal: 3, cleared: false, participants: '[]', created: t, updated: t });
  db.setCharacterMap({ characterId: 'c1', mapId: 'm1', ownerId: 'c1', mapName: 'Ash', updated: t });
  db.setCharacterMap({ characterId: 'c3', mapId: 'm1', ownerId: 'c1', mapName: 'Ash', updated: t });
  db.setDebugMerchant('c1', true);
  db.close();
  return { dir, dbPath };
}

function rows(dbPath: string, sql: string): Record<string, unknown>[] {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const d = new DatabaseSync(dbPath, { readOnly: true });
  try { return d.prepare(sql).all() as Record<string, unknown>[]; } finally { d.close(); }
}
const count = (dbPath: string, table: string): number => Number(rows(dbPath, `SELECT COUNT(*) AS n FROM ${table}`)[0].n);

interface Run { code: number; out: string; err: string }
function makeCtx(fx: Fixture, extra: Partial<Ctx> = {}): { ctx: Ctx; out: string[]; err: string[]; asked: string[] } {
  const out: string[] = [], err: string[] = [], asked: string[] = [];
  const ctx: Ctx = {
    env: { DB_PATH: fx.dbPath }, out: (s) => out.push(s), err: (s) => err.push(s), isTTY: false, color: false,
    ask: async (q) => { asked.push(q); return ''; }, now: () => new Date(1_700_100_000_000), actor: 'tester', ...extra,
  };
  return { ctx, out, err, asked };
}
async function foe(fx: Fixture, args: string[], extra: Partial<Ctx> = {}): Promise<Run> {
  const { ctx, out, err } = makeCtx(fx, extra);
  const code = await runCli(args, ctx);
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const auditLines = (fx: Fixture): Record<string, unknown>[] =>
  existsSync(join(fx.dir, 'admin-audit.log')) ? readFileSync(join(fx.dir, 'admin-audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const backups = (fx: Fixture): string[] => (existsSync(join(fx.dir, 'backups')) ? readdirSync(join(fx.dir, 'backups')) : []);

describe('read-only commands', () => {
  let fx: Fixture;
  beforeEach(async () => { fx = await seed(); });

  it('accounts lists every account with counts, --search filters, --json is parseable', async () => {
    const all = JSON.parse((await foe(fx, ['accounts', '--json', '--offline'])).out);
    expect(all.map((a: { account: string; characters: number }) => [a.account, a.characters])).toEqual([['Empty', 0], ['Mira', 2], ['Sharenz', 2]]);
    const found = JSON.parse((await foe(fx, ['accounts', '--search', 'shar', '--json', '--offline'])).out);
    expect(found).toHaveLength(1);
    expect((await foe(fx, ['accounts', '--offline'])).out).toContain('Sharenz');
  });

  it('chars and show report level, class, tier, party, map and merchant', async () => {
    const chars = JSON.parse((await foe(fx, ['chars', 'sharenz', '--json', '--offline'])).out);
    expect(chars.map((c: { character: string }) => c.character)).toEqual(['Eldurin', 'Alt']);
    expect(chars[0]).toMatchObject({ level: 40, class: 'sorceress', tier: 5, testingMerchant: true, online: null });
    const show = JSON.parse((await foe(fx, ['show', 'Sharenz', 'eldurin', '--json', '--offline'])).out);
    expect(show).toMatchObject({ name: 'Eldurin', location: 'Ash', party: ['Eldurin', 'Nova', 'Zed'] });
    expect(show.openMap.portalsRemaining).toBe(3);
    const acc = JSON.parse((await foe(fx, ['show', 'Sharenz', '--json', '--offline'])).out);
    expect(acc.atlas).toMatchObject({ tier: 5, clears: 7, stashTabs: 2 });
    expect((await foe(fx, ['show', 'Mira', 'Eldurin', '--offline'])).err).toContain('does not belong');
  });

  it('merchant is the old debug_merch behaviour and is audited', async () => {
    const r = await foe(fx, ['merchant', 'sharenz', 'alt', 'enable']);
    expect(r.out).toContain('enabled');
    expect(rows(fx.dbPath, "SELECT 1 FROM debug_merchants WHERE character_id = 'c2'")).toHaveLength(1);
    expect((await foe(fx, ['merchant', 'Mira', 'Alt', 'status'])).code).toBe(1);
    expect(auditLines(fx).map((l) => l.action)).toEqual(['merchant.enable']);
  });

  it('usage errors exit 2, interactive mode without a terminal is refused', async () => {
    expect((await foe(fx, ['nonsense'])).code).toBe(2);
    expect((await foe(fx, [])).code).toBe(2);
    expect((await foe(fx, ['--help'])).out).toContain('reset --all');
  });
});

describe('reset safety', () => {
  let fx: Fixture;
  beforeEach(async () => { fx = await seed(); });

  it('--dry-run prints per-table counts and changes nothing (no backup)', async () => {
    const r = await foe(fx, ['reset', 'Sharenz', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/characters\s+2/);
    expect(r.out).toMatch(/account_storage\s+1/);
    expect(r.out).toMatch(/party_members\s+1/);
    expect(r.out).toContain('surviving parties get a new leader');
    expect(r.out).toContain('Dry run');
    expect(count(fx.dbPath, 'characters')).toBe(4);
    expect(backups(fx)).toEqual([]);
    const json = JSON.parse((await foe(fx, ['reset', '--all', '--dry-run', '--json'])).out);
    expect(json.characters).toHaveLength(4);
    expect(json.counts.account_storage).toBe(2);
  });

  it('refuses without a running server unless --offline, and never deletes', async () => {
    const r = await foe(fx, ['reset', 'Sharenz', '--yes', '--i-know']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--offline');
    expect(count(fx.dbPath, 'characters')).toBe(4);
    expect(auditLines(fx).at(-1)?.action).toBe('reset-account.refused');
  });

  it('refuses a wrong or missing confirmation, and --yes without --i-know', async () => {
    for (const extra of [['--confirm', 'sharenz'], [], ['--yes'], ['--i-know']]) {
      const r = await foe(fx, ['reset', 'Sharenz', '--offline', ...extra]);
      expect(r.code, extra.join(' ')).toBe(1);
    }
    expect(count(fx.dbPath, 'characters')).toBe(4);
    expect(backups(fx)).toEqual([]);
  });

  it('a typed phrase in a terminal confirms; a wrong one cancels', async () => {
    const wrong = await foe(fx, ['reset', 'Sharenz', '--offline'], { isTTY: true, ask: async () => 'nope' });
    expect(wrong.code).toBe(1);
    expect(count(fx.dbPath, 'characters')).toBe(4);
    const ok = await foe(fx, ['reset', 'Sharenz', '--offline'], { isTTY: true, ask: async () => 'Sharenz' });
    expect(ok.code).toBe(0);
    expect(count(fx.dbPath, 'characters')).toBe(2);
  });

  it('reset <account>: only that account loses characters and progress; logins and other accounts stay; backup and audit exist', async () => {
    const r = await foe(fx, ['reset', 'Sharenz', '--offline', '--confirm', 'Sharenz']);
    expect(r.code, r.err).toBe(0);
    expect(count(fx.dbPath, 'accounts')).toBe(3);
    expect(rows(fx.dbPath, 'SELECT name FROM characters ORDER BY name').map((r) => r.name)).toEqual(['Nova', 'Zed']);
    expect(rows(fx.dbPath, 'SELECT account_id FROM account_storage')).toEqual([{ account_id: 'a2' }]);
    expect(rows(fx.dbPath, 'SELECT account_id FROM atlas_credit_queue')).toEqual([{ account_id: 'a2' }]);
    expect(count(fx.dbPath, 'open_maps')).toBe(0);
    expect(count(fx.dbPath, 'debug_merchants')).toBe(0);
    // The party keeps its two other members under a new leader; the map others stood in is gone from their location.
    expect(rows(fx.dbPath, 'SELECT id, leader_id FROM parties')).toEqual([{ id: 'p1', leader_id: 'c3' }]);
    expect(count(fx.dbPath, 'party_members')).toBe(2);
    expect(count(fx.dbPath, 'character_maps')).toBe(0);
    expect(backups(fx)).toHaveLength(1);
    const [backup] = backups(fx);
    expect(backup).toMatch(/^pre-reset-\d{8}-\d{6}\.db$/);
    expect(statSync(join(fx.dir, 'backups', backup)).mode & 0o777).toBe(0o600);
    expect(count(join(fx.dir, 'backups', backup), 'characters')).toBe(4);
    const log = auditLines(fx);
    expect(log.map((l) => l.action)).toEqual(['reset-account.begin', 'reset-account.done']);
    expect(log[0]).toMatchObject({ actor: 'tester', backup: join(fx.dir, 'backups', backup) });
  });

  it('reset --all needs RESET-ALL-ACCOUNTS plus the character count; --yes --i-know bypasses', async () => {
    expect((await foe(fx, ['reset', '--all', '--offline', '--confirm', 'RESET-ALL-ACCOUNTS'])).code).toBe(1);
    expect((await foe(fx, ['reset', '--all', '--offline', '--confirm', 'RESET-ALL-ACCOUNTS 3'])).code).toBe(1);
    expect(count(fx.dbPath, 'characters')).toBe(4);
    const ok = await foe(fx, ['reset', '--all', '--offline', '--confirm', 'RESET-ALL-ACCOUNTS 4']);
    expect(ok.code, ok.err).toBe(0);
    for (const t of ['characters', 'account_storage', 'atlas_credit_queue', 'open_maps', 'character_maps', 'party_members', 'parties', 'debug_merchants']) expect(count(fx.dbPath, t), t).toBe(0);
    expect(count(fx.dbPath, 'accounts')).toBe(3);
  });

  it('--yes --i-know runs without a prompt', async () => {
    const { ctx, asked } = makeCtx(fx);
    expect(await runCli(['reset', 'Mira', '--offline', '--yes', '--i-know'], ctx)).toBe(0);
    expect(asked).toEqual([]);
    expect(rows(fx.dbPath, 'SELECT name FROM characters ORDER BY name').map((r) => r.name)).toEqual(['Alt', 'Eldurin']);
    // Mira's two characters leave the party of three; one member is not a party any more.
    expect(count(fx.dbPath, 'parties')).toBe(0);
    expect(count(fx.dbPath, 'party_members')).toBe(0);
  });

  it('delete-char removes one character and its rows but keeps account storage', async () => {
    const r = await foe(fx, ['delete-char', 'Sharenz', 'Alt', '--offline', '--confirm', 'Alt']);
    expect(r.code, r.err).toBe(0);
    expect(rows(fx.dbPath, 'SELECT name FROM characters ORDER BY name').map((x) => x.name)).toEqual(['Eldurin', 'Nova', 'Zed']);
    expect(count(fx.dbPath, 'account_storage')).toBe(2);
    expect(count(fx.dbPath, 'debug_merchants')).toBe(1);
    expect(count(fx.dbPath, 'party_members')).toBe(3);
  });

  it('rolls everything back when the transaction fails', async () => {
    const before = ['characters', 'account_storage', 'atlas_credit_queue', 'open_maps', 'character_maps', 'party_members', 'parties', 'debug_merchants'].map((t) => count(fx.dbPath, t));
    const db = await openDb(fx.dbPath);
    const plan = planReset(db, { all: true, accountIds: [], characterIds: [] });
    expect(() => executeReset(db, plan, { beforeCommit: () => { throw new Error('boom'); } })).toThrow('boom');
    // The connection is usable again and nothing changed.
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }).n)).toBe(4);
    db.close();
    expect(['characters', 'account_storage', 'atlas_credit_queue', 'open_maps', 'character_maps', 'party_members', 'parties', 'debug_merchants'].map((t) => count(fx.dbPath, t))).toEqual(before);
  });

  it('a failing backup aborts before anything is deleted', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(fx.dir, { recursive: true });
    writeFileSync(join(fx.dir, 'backups'), 'not a directory');
    const r = await foe(fx, ['reset', 'Sharenz', '--offline', '--confirm', 'Sharenz']);
    expect(r.code).toBe(1);
    expect(count(fx.dbPath, 'characters')).toBe(4);
    expect(auditLines(fx).map((l) => l.action)).toEqual(['reset-account.begin', 'reset-account.failed']);
  });

  it('backupDatabase produces a verified copy and refuses to overwrite', async () => {
    const dest = join(fx.dir, 'b', 'x.db');
    await backupDatabase(fx.dbPath, dest);
    expect(count(dest, 'accounts')).toBe(3);
    await expect(backupDatabase(fx.dbPath, dest)).rejects.toThrow('already exists');
  });

  it('refuses a database with a different schema version', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const d = new DatabaseSync(fx.dbPath);
    d.exec('PRAGMA user_version = 1');
    d.close();
    const r = await foe(fx, ['accounts', '--offline']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('schema');
  });
});

describe('admin channel and live server', () => {
  let server: Awaited<ReturnType<typeof startTestServer>> | null = null;
  afterEach(async () => { await server?.close(); server = null; });

  async function live(): Promise<Fixture> {
    const fx = await seed().then(async (f) => { rmSync(f.dir, { recursive: true, force: true }); return f; });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(fx.dir, { recursive: true });
    server = await startTestServer({ dbPath: fx.dbPath, adminDir: fx.dir, game: { autoTick: false } });
    return fx;
  }

  it('creates a 0600 socket and token; rejects a bad token; answers ping with the right one', async () => {
    const fx = await live();
    expect(statSync(join(fx.dir, 'admin.sock')).mode & 0o777).toBe(0o600);
    expect(statSync(join(fx.dir, 'admin.token')).mode & 0o777).toBe(0o600);
    const { connect } = await import('node:net');
    const reply = await new Promise<string>((resolve) => {
      const s = connect(join(fx.dir, 'admin.sock'));
      let buf = '';
      s.on('data', (d) => { buf += d; });
      s.on('close', () => resolve(buf));
      s.write(JSON.stringify({ token: 'wrong', cmd: 'online' }) + '\n');
    });
    expect(JSON.parse(reply)).toEqual({ ok: false, error: 'unauthorized' });
    const client = createAdminClient(fx.dir);
    expect(await client.probe()).toMatchObject({ state: 'ok' });
    await server!.close();
    server = null;
    expect(existsSync(join(fx.dir, 'admin.sock'))).toBe(false);
    expect(await client.probe()).toEqual({ state: 'absent' });
  });

  it('online lists players with level, place and party; foe online --json shows them', async () => {
    const fx = await live();
    const a = createLocalCharacter(server!, 'Anna'), b = createLocalCharacter(server!, 'Bobb');
    const pa = new LocalPlayer(server!, a), pb = new LocalPlayer(server!, b);
    partyUp(pa, pb);
    const r = await foe({ ...fx }, ['online', '--json']);
    const players = JSON.parse(r.out);
    expect(players.map((p: { character: string }) => p.character).sort()).toEqual(['Anna', 'Bobb']);
    expect(players[0]).toMatchObject({ level: 1, place: 'hideout' });
    expect(players[0].party.sort()).toEqual(['Anna', 'Bobb']);
  });

  it('reset refuses while affected players are online; --force kicks them, resets, drops live state and re-allows login', async () => {
    const fx = await live();
    const a = createLocalCharacter(server!, 'Anna'), b = createLocalCharacter(server!, 'Bobb');
    const pa = new LocalPlayer(server!, a), pb = new LocalPlayer(server!, b);
    partyUp(pa, pb);
    expect(server!.game.parties.partyCount).toBe(1);
    const refused = await foe(fx, ['reset', 'u_Anna', '--confirm', 'u_Anna']);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('online');
    expect(server!.db.characterById(a)).not.toBeNull();
    const done = await foe(fx, ['reset', 'u_Anna', '--confirm', 'u_Anna', '--force']);
    expect(done.code, done.err).toBe(0);
    expect(server!.db.characterById(a)).toBeNull();
    expect(server!.game.isInPlay(a)).toBe(false);
    expect(server!.game.isInPlay(b)).toBe(true);
    expect(server!.game.parties.partyOf(b)).toBeNull();
    expect(server!.db.characterById(b)).not.toBeNull();
    expect(server!.db.loadParties()).toEqual([]);
    expect(existsSync(join(fx.dir, 'backups'))).toBe(true);
    // The lock is lifted afterwards.
    expect((await createAdminClient(fx.dir).call('lock', { accounts: [], characters: [], kick: true })).ok).toBe(true);
    await createAdminClient(fx.dir).call('unlock');
  });

  it('a lock refuses logins until unlocked and kick disconnects a player', async () => {
    const fx = await live();
    const a = createLocalCharacter(server!, 'Anna');
    const accountId = 'acct-Anna';
    const client = createAdminClient(fx.dir);
    const pa = new LocalPlayer(server!, a);
    expect((await client.call('lock', { accounts: [accountId], kick: false })).ok).toBe(false);
    const kicked = await client.call('lock', { accounts: [accountId], kick: true, purge: true });
    expect(kicked.kicked).toEqual(['u_Anna/Anna']);
    expect(server!.game.isInPlay(a)).toBe(false);
    void pa;
    await client.call('unlock');
    const again = new LocalPlayer(server!, a);
    expect(server!.game.isInPlay(a)).toBe(true);
    expect((await client.call('kick', { characters: [a] })).kicked).toEqual(['u_Anna/Anna']);
    void again;
  });
});

describe('interactive picker', () => {
  const choices = [
    { value: 1, label: 'Eldurin', hint: 'Sharenz L40 sorceress' },
    { value: 2, label: 'Alt', hint: 'Sharenz L3 warrior' },
    { value: 3, label: 'Nova', hint: 'Mira L12 sorceress', search: 'level 12' },
  ];
  const start = (): PickerState<number> => ({ title: 'T', all: choices, query: '', index: 0 });

  it('fuzzy search matches substrings and subsequences across fields', () => {
    expect(fuzzyScore('eld', 'Eldurin Sharenz')).not.toBeNull();
    expect(fuzzyScore('edr', 'Eldurin')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Eldurin')).toBeNull();
    expect(fuzzyFilter(choices, 'mira', (c) => `${c.label} ${c.hint}`).map((c) => c.value)).toEqual([3]);
    expect(fuzzyFilter(choices, 'sorc', (c) => `${c.label} ${c.hint}`).map((c) => c.value)).toEqual([3, 1]);
    expect(fuzzyFilter(choices, 'warrior shar', (c) => `${c.label} ${c.hint}`).map((c) => c.value)).toEqual([2]);
  });

  it('parses arrows, enter, esc, paste and control keys', () => {
    expect(parseKeys('\x1b[A\x1b[B\r\x1b\x7f')).toEqual([{ k: 'up' }, { k: 'down' }, { k: 'enter' }, { k: 'esc' }, { k: 'backspace' }]);
    expect(parseKeys('ab')).toEqual([{ k: 'char', ch: 'a' }, { k: 'char', ch: 'b' }]);
    expect(parseKeys('\x03')).toEqual([{ k: 'interrupt' }]);
  });

  it('typing filters, arrows move within bounds, enter picks the highlighted match, esc cancels', () => {
    let s = start();
    for (const ch of 'nova') s = applyKey(s, { k: 'char', ch }).state;
    expect(visibleChoices(s).map((c) => c.value)).toEqual([3]);
    expect(applyKey(s, { k: 'enter' }).done).toEqual({ value: 3 });
    s = applyKey(start(), { k: 'down' }).state;
    expect(s.index).toBe(1);
    s = applyKey(s, { k: 'end' }).state;
    s = applyKey(s, { k: 'down' }).state;
    expect(s.index).toBe(2);
    expect(applyKey(s, { k: 'esc' }).done).toEqual({ cancelled: true });
    const none = applyKey(start(), { k: 'char', ch: 'q' }).state;
    expect(applyKey(none, { k: 'enter' }).done).toBeUndefined();
  });

  it('renders title, search, marker, preview and footer', () => {
    const withPreview = choices.map((c) => ({ ...c, preview: [`details of ${c.label}`] }));
    const frame = renderPicker({ ...start(), all: withPreview, index: 1 }, 80, false).join('\n');
    expect(frame).toContain('search');
    expect(frame).toContain('> Alt');
    expect(frame).toContain('details of Alt');
    expect(frame).toContain('2/3');
  });
});
