// The first-run guide on the server: account-level GuideState (decided once, shared by every character, persisted across restarts), the
// `guide` command (validated, idempotent), the veteran auto-skip, the first map's warm-up and the free flask refill at home.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { GUIDE_HINT_IDS } from '../../src/contracts/guide';
import { GUIDE_WARMUP_SECONDS } from '../../src/contracts/guide';
import { SIM_HZ } from '../../src/contracts/sim';
import { parseClientMessage } from '../../src/net/messages';
import { FLASKS_REFILLED_TOAST } from '../../src/server/game';
import { captureLogger, createClock, createLocalCharacter, enterMapOf, LocalPlayer, openMap, savedCharacter, startTestServer, tick } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-guide-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function setup(names: string[], dbPath?: string, start = Date.UTC(2026, 9, 1, 12, 0, 0)) {
  const clock = createClock(start);
  server = await startTestServer({ logger: captureLogger(), ...(dbPath ? { dbPath } : {}), game: { autoTick: false, now: clock.now } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}
const chOf = (p: LocalPlayer): CharacterSave => p.session.record.ch;

describe('GuideState persistence', () => {
  it('a brand-new account gets an active guide at its first load, shared by the projection and saved with the account', async () => {
    const { players: [p] } = await setup(['Gwen Guide']);
    expect(chOf(p).guide).toMatchObject({ v: 1, mode: 'active', done: [], hints: [] });
    p.server.game.store.flushAll();
    expect(savedCharacter(p.server, p.characterId).guide).toMatchObject({ mode: 'active' });
  });

  it('the guide command records steps, hints and props, validated and idempotent', async () => {
    const { players: [p] } = await setup(['Gwen Guide']);
    expect(p.command({ c: 'guide', op: 'done', id: 'device' }).ok).toBe(true);
    expect(p.command({ c: 'guide', op: 'done', id: 'device' }).ok).toBe(true);
    expect(p.command({ c: 'guide', op: 'hint', id: 'lowLife' }).ok).toBe(true);
    expect(p.command({ c: 'guide', op: 'used', id: 'anvil' }).ok).toBe(true);
    expect(chOf(p).guide).toMatchObject({ done: ['device'], hints: ['lowLife'], used: ['anvil'] });
    // the server sends the new state to the client
    expect(p.last('character')?.character.guide?.done).toEqual(['device']);
  });

  it('refuses unknown ids and shapes at the wire', () => {
    for (const cmd of [
      { c: 'guide', op: 'done', id: 'teleport' }, { c: 'guide', op: 'hint', id: 'x' }, { c: 'guide', op: 'used', id: 'door' },
      { c: 'guide', op: 'skip', id: 'device' }, { c: 'guide', op: 'explode' }, { c: 'guide', op: 'done' }, { c: 'guide', op: 'done', id: 'device', extra: 1 },
    ]) expect(parseClientMessage(JSON.stringify({ t: 'cmd', id: 1, cmd })).ok, JSON.stringify(cmd)).toBe(false);
    for (const cmd of [{ c: 'guide', op: 'skip' }, { c: 'guide', op: 'replay' }, { c: 'guide', op: 'finish' }, { c: 'guide', op: 'done', id: 'equip' }]) {
      expect(parseClientMessage(JSON.stringify({ t: 'cmd', id: 1, cmd })).ok, JSON.stringify(cmd)).toBe(true);
    }
  });

  it('skip, replay and finish switch the mode', async () => {
    const { players: [p] } = await setup(['Gwen Guide']);
    p.command({ c: 'guide', op: 'done', id: 'device' });
    p.command({ c: 'guide', op: 'skip' });
    expect(chOf(p).guide).toMatchObject({ mode: 'skipped', skippedBy: 'player' });
    p.command({ c: 'guide', op: 'replay' });
    expect(chOf(p).guide).toMatchObject({ mode: 'active', done: [], hints: [], replays: 1 });
    p.command({ c: 'guide', op: 'finish' });
    expect(chOf(p).guide?.mode).toBe('done');
  });

  it('is shared by every character of the account and survives a restart', async () => {
    const dbPath = join(dir, 'guide.db');
    const first = await setup(['Ada Account'], dbPath);
    const a = first.players[0];
    a.command({ c: 'guide', op: 'done', id: 'device' });
    a.command({ c: 'guide', op: 'hint', id: 'levelUp' });
    const accountId = server!.game.store.ownerOf(a.characterId)!;
    const second = server!.game.store.create(accountId, 'Ada Second');
    expect(second.ok).toBe(true);
    const b = new LocalPlayer(server!, second.ok ? second.character.id : '');
    expect(chOf(b).guide).toMatchObject({ mode: 'active', done: ['device'], hints: ['levelUp'] });
    b.command({ c: 'guide', op: 'done', id: 'area' });
    expect(chOf(a).guide?.done).toEqual(['device', 'area']);
    const ids = [a.characterId, b.characterId];
    await server!.close();
    server = null;
    server = await startTestServer({ logger: captureLogger(), dbPath, game: { autoTick: false, now: createClock().now } });
    for (const id of ids) {
      const back = new LocalPlayer(server, id);
      expect(chOf(back).guide).toMatchObject({ mode: 'active', done: ['device', 'area'], hints: ['levelUp'] });
    }
  });
});

describe('the veteran auto-skip', () => {
  /** A returning account: its stored storage has no guide yet (as before this release), and `edit` makes it a veteran. */
  async function oldAccount(edit: (ch: CharacterSave) => CharacterSave, names = ['Vera Veteran']) {
    const dbPath = join(dir, `old-${Math.random().toString(36).slice(2)}.db`);
    const first = await setup(names, dbPath);
    const ids = first.players.map((p) => p.characterId);
    const rec = server!.game.store.peek(ids[0])!;
    server!.game.store.set(rec, edit(rec.ch));
    // as it was stored before the guide existed: no guide in the shared storage
    server!.game.store.flushAll();
    const row = server!.db.characterById(ids[0])!;
    const stored = JSON.parse(server!.db.accountStorage(row.accountId)!.data);
    delete stored.guide;
    server!.db.saveAccountStorage({ accountId: row.accountId, data: JSON.stringify(stored), saveVersion: server!.game.store.saveVersion, updated: 1 });
    await server!.close();
    server = null;
    server = await startTestServer({ logger: captureLogger(), dbPath, game: { autoTick: false, now: createClock().now } });
    return { ids };
  }

  it('an old account with a completed map is skipped as a veteran, every hint marked seen', async () => {
    const { ids } = await oldAccount((ch) => ({ ...ch, stats: { ...ch.stats, mapsCompleted: 1 } }));
    const p = new LocalPlayer(server!, ids[0]);
    expect(chOf(p).guide).toMatchObject({ mode: 'skipped', skippedBy: 'veteran', hints: [...GUIDE_HINT_IDS] });
  });

  it('an old account with Atlas clears is a veteran', async () => {
    const { ids } = await oldAccount((ch) => ({ ...ch, atlas: { ...(ch.atlas ?? { discovered: [], completed: [], clears: 0 }), clears: 3 } }));
    const p = new LocalPlayer(server!, ids[0]);
    expect(chOf(p).guide?.skippedBy).toBe('veteran');
  });

  it('an old account with a character above level 5 is a veteran, also seen from its other characters', async () => {
    const { ids } = await oldAccount((ch) => ({ ...ch, level: 7 }), ['Vera Veteran']);
    const accountId = server!.game.store.ownerOf(ids[0])!;
    const alt = server!.game.store.create(accountId, 'Vera Newer');
    expect(alt.ok).toBe(true);
    const a = new LocalPlayer(server!, alt.ok ? alt.character.id : '');
    expect(chOf(a).guide).toMatchObject({ mode: 'skipped', skippedBy: 'veteran' });
  });

  it('an old account that never got anywhere starts the guide', async () => {
    const { ids } = await oldAccount((ch) => ch);
    expect(chOf(new LocalPlayer(server!, ids[0])).guide).toMatchObject({ mode: 'active' });
  });

  it('creating a new character on an active account that already holds a veteran flips it to skipped', async () => {
    const { players: [p] } = await setup(['Early Ed']);
    expect(chOf(p).guide?.mode).toBe('active');
    server!.game.store.set(p.session.record, { ...chOf(p), level: 9 });
    const accountId = server!.game.store.ownerOf(p.characterId)!;
    const alt = server!.game.store.create(accountId, 'Early Alt');
    expect(alt.ok).toBe(true);
    expect(chOf(p).guide).toMatchObject({ mode: 'skipped', skippedBy: 'veteran' });
    const b = new LocalPlayer(server!, alt.ok ? alt.character.id : '');
    expect(chOf(b).guide?.mode).toBe('skipped');
  });
});

describe('the first map is gentle', () => {
  const seconds = (n: number) => Math.round(n * SIM_HZ);
  it('holds the first wave until the player moves or casts, once per account', async () => {
    const { server: s, clock, players: [p] } = await setup(['Wanda Warm']);
    openMap(p);
    expect(chOf(p).guide?.warmed).toBe(true);
    enterMapOf(p, p, clock);
    expect(p.session.instance?.setup?.warmup).toBe(true);
    // standing still for 10 s: nothing has started
    tick(s, clock, seconds(10));
    expect(p.view.run.wave).toBe(0);
    expect(p.view.run.monstersAlive).toBe(0);
    // the first move releases it
    p.input({ moveX: 1 });
    tick(s, clock, seconds(1));
    p.input();
    tick(s, clock, seconds(6));
    expect(p.view.run.wave).toBeGreaterThanOrEqual(1);
  });

  it('ends by itself after the warm-up seconds', async () => {
    const { server: s, clock, players: [p] } = await setup(['Wanda Warm']);
    openMap(p);
    enterMapOf(p, p, clock);
    tick(s, clock, seconds(GUIDE_WARMUP_SECONDS - 1));
    expect(p.view.run.wave).toBe(0);
    tick(s, clock, seconds(8));
    expect(p.view.run.wave).toBeGreaterThanOrEqual(1);
  });

  it('is not repeated for the second map, nor given to a skipped guide', async () => {
    const { server: s, clock, players: [p] } = await setup(['Wanda Warm']);
    openMap(p);
    enterMapOf(p, p, clock);
    p.command({ c: 'leaveMap' });
    tick(s, clock, 2);
    p.command({ c: 'guide', op: 'skip' });
    openMap(p);
    expect(p.session.instance).not.toBeNull();
    const map = server!.game.instances.activeMapOf(p.characterId)!;
    expect(map.setup.warmup).toBeUndefined();
  });

  it('is not given to a skipped (veteran or player-skipped) guide at all', async () => {
    const { players: [p] } = await setup(['Sam Skip']);
    p.command({ c: 'guide', op: 'skip' });
    openMap(p);
    const map = server!.game.instances.activeMapOf(p.characterId)!;
    expect(map.setup.warmup).toBeUndefined();
    expect(chOf(p).guide?.warmed).toBeUndefined();
  });
});

describe('flasks refill when you come home', () => {
  it('tops the belt up on entering the hideout, with a toast, and says nothing when it was full', async () => {
    const { server: s, clock, players: [p] } = await setup(['Flo Flask']);
    openMap(p);
    enterMapOf(p, p, clock);
    const emptied = chOf(p).belt.map((slot) => (slot ? { ...slot, count: 0 } : slot));
    s.game.setCharacter(p.session, { ...chOf(p), belt: emptied });
    const from = p.mark();
    p.command({ c: 'leaveMap' });
    for (const slot of chOf(p).belt) if (slot) expect(slot.count).toBe(5);
    expect(p.all('toast', from).some((t) => t.text === FLASKS_REFILLED_TOAST)).toBe(true);
    // a second arrival with full flasks stays quiet
    const again = p.mark();
    p.command({ c: 'visitHideout', characterId: p.characterId });
    expect(p.all('toast', again).some((t) => t.text === FLASKS_REFILLED_TOAST)).toBe(false);
  });
});

describe('parties and the backpack sort', () => {
  it('every player has their own guide: a step one records never shows up for the other, and a joined map needs nothing from it', async () => {
    const { players: [a, b] } = await setup(['Pia Party', 'Pax Party']);
    const accounts = new Set([a, b].map((p) => server!.game.store.ownerOf(p.characterId)));
    expect(accounts.size).toBe(2);
    a.command({ c: 'guide', op: 'done', id: 'device' });
    b.command({ c: 'guide', op: 'skip' });
    expect(chOf(a).guide).toMatchObject({ mode: 'active', done: ['device'] });
    expect(chOf(b).guide).toMatchObject({ mode: 'skipped', skippedBy: 'player', done: [] });
    expect(b.last('character')?.character.guide?.mode).toBe('skipped');
  });

  it('sortBackpack re-lays the backpack and keeps every item', async () => {
    const { players: [p] } = await setup(['Sorta Sorter']);
    const before = chOf(p).backpack.entries.map((e) => e.item.uid).sort();
    const r = p.command({ c: 'sortBackpack' });
    expect(r.ok).toBe(true);
    expect(chOf(p).backpack.entries.map((e) => e.item.uid).sort()).toEqual(before);
    // currency comes first now
    const first = chOf(p).backpack.entries.slice().sort((x, y) => x.y - y.y || x.x - y.x)[0];
    expect(first.item.kind).toBe('currency');
  });
});
