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
