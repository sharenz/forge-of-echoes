import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { MapInstance } from '../../src/server/instance';
import { createClock, createLocalCharacter, enterMapOf, LocalPlayer, openMap, partyUp, startTestServer, walkIntoProp } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-scarabs-'));
let server: Awaited<ReturnType<typeof startTestServer>>;
afterEach(async () => { await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it('sockets are private, persist, consume once, modify party maps and survive restart; failed restoration refunds them once', async () => {
  const options = { dbPath: join(dir, 'scarabs.db'), game: { autoTick: false, now: createClock().now } };
  const clock = createClock(); options.game.now = clock.now;
  server = await startTestServer(options);
  const aId = createLocalCharacter(server, 'Scarab Owner'), bId = createLocalCharacter(server, 'Scarab Guest');
  let a = new LocalPlayer(server, aId), b = new LocalPlayer(server, bId);
  server.game.setCharacter(a.session, { ...a.session.record.ch, currencyStash: { hasteScarab1: 1, hasteScarab4: 3, invasionScarab4: 2 } });
  for (const [index, id] of ['hasteScarab4', 'invasionScarab4'].entries())
    expect(a.command({ c: 'moveItem', uid: `cstash:${id}`, to: { kind: 'scarabSlot', index } }).ok).toBe(true);
  expect(a.command({ c: 'moveItem', uid: 'cstash:hasteScarab1', to: { kind: 'scarabSlot', index: 2 } }).ok).toBe(false);
  const loaded = a.session.record.ch.mapScarabs;
  expect(a.session.record.ch.currencyStash.hasteScarab4).toBe(2);
  expect(b.session.record.ch.mapScarabs).toBeUndefined();
  expect(a.command({ c: 'activateMapDevice' }).ok).toBe(false);
  expect(a.session.record.ch.mapScarabs).toEqual(loaded);
  await server.close(); server = await startTestServer(options);
  a = new LocalPlayer(server, aId); b = new LocalPlayer(server, bId);
  expect(a.session.record.ch.mapScarabs).toEqual(loaded);
  partyUp(a, b); openMap(a);
  expect(a.session.record.ch.mapScarabs).toEqual([null, null, null, null]);
  const map = server.game.instances.activeMapOf(aId)!;
  expect(map.setup.scarabs).toEqual(['hasteScarab4', 'invasionScarab4']);
  expect(a.command({ c: 'activateMapDevice' }).ok).toBe(false);
  walkIntoProp(a, 'portal', clock, [b]); enterMapOf(b, a, clock, [a]);
  expect(b.session.instance).toBe(a.session.instance);
  expect((a.session.instance as MapInstance).run.view.run.waveDuration).toBe(30);
  expect(a.command({ c: 'moveItem', uid: 'cstash:hasteScarab4', to: { kind: 'scarabSlot', index: 0 } }).ok).toBe(false);
  await server.close(); server = await startTestServer(options);
  a = new LocalPlayer(server, aId); b = new LocalPlayer(server, bId);
  expect((a.session.instance as MapInstance).setup.scarabs).toEqual(map.setup.scarabs);
  expect(a.session.record.ch.currencyStash).toMatchObject({ hasteScarab4: 2, invasionScarab4: 1 });
  expect(a.session.record.ch.mapScarabs?.filter(Boolean)).toHaveLength(0);
  await server.close();
  // Force an unrestorable seed in this disposable database; the persisted receipt still identifies payment.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(options.dbPath);
  const row = db.prepare('SELECT map_id, setup FROM open_maps').get()!;
  const setup = JSON.parse(String(row.setup)); setup.seed = null;
  db.prepare('UPDATE open_maps SET setup = ? WHERE map_id = ?').run(JSON.stringify(setup), row.map_id as string);
  db.close();
  server = await startTestServer(options); a = new LocalPlayer(server, aId);
  const holdings = () => {
    const ch = a.session.record.ch;
    const total = { hasteScarab4: ch.currencyStash.hasteScarab4 ?? 0, invasionScarab4: ch.currencyStash.invasionScarab4 ?? 0 };
    for (const item of [...ch.backpack.entries.map(e => e.item), ...ch.stash.flatMap(t => t.grid.entries.map(e => e.item))])
      if (item.kind === 'currency' && (item.currencyId === 'hasteScarab4' || item.currencyId === 'invasionScarab4')) total[item.currencyId] += item.count;
    return total;
  };
  expect(holdings()).toEqual({ hasteScarab4: 3, invasionScarab4: 2 });
  await server.close(); server = await startTestServer(options); a = new LocalPlayer(server, aId);
  expect(holdings()).toEqual({ hasteScarab4: 3, invasionScarab4: 2 });
}, 30_000);

// Conservation over the device's scarab sockets for EVERY scarab kind (the eight wave scarabs and the area-bias families):
// stash -> backpack -> socket -> back out, then random loads/removals/stash moves, a map opened with some loaded
// (those are spent exactly once) and a restart. Nothing is lost or duplicated.
it('every scarab kind survives socket load/unload, random sequences, opening a map and a restart (conservation)', async () => {
  const { SCARABS } = await import('../../src/data/scarabs');
  const ids = SCARABS.map(s => s.id);
  expect(ids.length).toBeGreaterThanOrEqual(28);
  const options = { dbPath: join(dir, 'scarab-conservation.db'), game: { autoTick: false, now: createClock().now } };
  const clock = createClock(); options.game.now = clock.now;
  server = await startTestServer(options);
  const id = createLocalCharacter(server, 'Scarab Fuzz');
  let p = new LocalPlayer(server, id);
  const start = p.session.record.ch;
  const stock = Object.fromEntries(ids.map(i => [i, 3]));
  server.game.setCharacter(p.session, {
    ...start, currencyStash: { ...stock },
    mapDevice: { kind: 'map', uid: 'scarab-map:i1', areaId: 'cinderCrossing', baseId: 'ashenForge', tier: 1, quality: 0, rarity: 'normal', mods: [], corrupted: false },
  });
  const count = (ch: typeof start, scarab: string): number => {
    let n = ch.currencyStash[scarab as keyof typeof ch.currencyStash] ?? 0;
    const add = (item: { kind: string; currencyId?: string; count?: number } | null | undefined) => {
      if (item?.kind === 'currency' && item.currencyId === scarab) n += item.count ?? 0;
    };
    for (const e of ch.backpack.entries) add(e.item);
    for (const t of ch.stash) for (const e of t.grid.entries) add(e.item);
    for (const s of ch.mapScarabs ?? []) add(s);
    return n;
  };
  const totals = (ch: typeof start) => Object.fromEntries(ids.map(i => [i, count(ch, i)]));
  const cmd = (c: Parameters<LocalPlayer['command']>[0]) => { clock.advance(100); return p.command(c); };
  const backpackUid = (scarab: string) => p.session.record.ch.backpack.entries.find(e => e.item.kind === 'currency' && e.item.currencyId === scarab)?.item.uid;

  // 1. the e2e path, for every kind: one out of the stash, into socket 0, and removed again
  for (const scarab of ids) {
    expect(cmd({ c: 'quickMove', uid: `cstash:${scarab}`, stashTab: null, count: 1 }).ok, scarab).toBe(true);
    const uid = backpackUid(scarab)!;
    expect(cmd({ c: 'moveItem', uid, to: { kind: 'scarabSlot', index: 0 } }).ok, scarab).toBe(true);
    expect(p.session.record.ch.mapScarabs?.[0]?.currencyId).toBe(scarab);
    const loaded = p.session.record.ch.mapScarabs![0]!;
    expect(cmd({ c: 'quickMove', uid: loaded.uid, stashTab: null }).ok, scarab).toBe(true);
    expect(p.session.record.ch.mapScarabs?.some(Boolean)).toBe(false);
    expect(totals(p.session.record.ch)).toEqual(stock);
  }
  // every kind is back in the backpack, one stack each
  const inPack = p.session.record.ch.backpack.entries.filter(e => e.item.kind === 'currency' && ids.includes(e.item.currencyId as never));
  expect(inPack).toHaveLength(ids.length);

  // 2. random sequences, then open the map with whatever is loaded
  let seed = 0x5ca7ab;
  const rnd = (n: number) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
  for (let step = 0; step < 1500; step++) {
    const ch = p.session.record.ch;
    switch (rnd(4)) {
      case 0: cmd({ c: 'moveItem', uid: backpackUid(ids[rnd(ids.length)]!) ?? 'nope', to: { kind: 'scarabSlot', index: rnd(4) } }); break;
      case 1: { const s = ch.mapScarabs?.find(Boolean); if (s) cmd({ c: 'quickMove', uid: s.uid, stashTab: rnd(2) ? null : 'currency' as never }); break; }
      case 2: cmd({ c: 'quickMove', uid: `cstash:${ids[rnd(ids.length)]}`, stashTab: null, count: 1 + rnd(3) }); break;
      case 3: cmd({ c: 'depositAllCurrency' }); break;
    }
    expect(totals(p.session.record.ch), `step ${step}`).toEqual(stock);
    const all = [...p.session.record.ch.backpack.entries.map(e => e.item.uid), ...(p.session.record.ch.mapScarabs ?? []).filter(Boolean).map(s => s!.uid)];
    expect(new Set(all).size).toBe(all.length);
  }
  const loadedNow = (p.session.record.ch.mapScarabs ?? []).filter(Boolean).map(s => s!.currencyId);
  if (loadedNow.length === 0) {
    expect(cmd({ c: 'moveItem', uid: backpackUid('hasteScarab1') ?? (cmd({ c: 'quickMove', uid: 'cstash:hasteScarab1', stashTab: null, count: 1 }), backpackUid('hasteScarab1')!), to: { kind: 'scarabSlot', index: 0 } }).ok).toBe(true);
  }
  const spent = (p.session.record.ch.mapScarabs ?? []).filter(Boolean).map(s => s!.currencyId as string);
  const expected = { ...stock };
  for (const s of spent) expected[s] -= 1;
  openMap(p);
  expect(p.session.record.ch.mapScarabs).toEqual([null, null, null, null]);
  expect(totals(p.session.record.ch)).toEqual(expected);

  // 3. restart: nothing reappears and nothing vanishes
  await server.close(); server = await startTestServer(options);
  p = new LocalPlayer(server, id);
  expect(totals(p.session.record.ch)).toEqual(expected);
}, 120_000);
