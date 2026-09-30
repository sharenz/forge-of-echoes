import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { ATLAS_KEYS } from '../../src/data/progression/atlas';
import { GameDatabase } from '../../src/server';
import { MapInstance } from '../../src/server/instance';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { createClock, createLocalCharacter, enterMapOf, LocalPlayer, openMap, partyUp, startTestServer, walkIntoProp } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-atlas-'));
type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server;
let count = 0;
afterEach(async () => { vi.restoreAllMocks(); await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
async function boot(path = join(dir, `${++count}.db`)) {
  const clock = createClock();
  server = await startTestServer({ dbPath: path, game: { autoTick: false, now: clock.now } });
  return { clock, path };
}

it('credits present party accounts once, shares with alts, and does not grant a second discovery after restart', async () => {
  let { clock, path } = await boot();
  const aId = createLocalCharacter(server, 'Atlas Alice');
  const bId = createLocalCharacter(server, 'Atlas Bram');
  let a = new LocalPlayer(server, aId), b = new LocalPlayer(server, bId);
  const altResult = server.game.store.create(a.session.record.accountId, 'Atlas Alt');
  if (!altResult.ok) throw new Error(altResult.error);
  const altId = altResult.character.id;
  const alt = new LocalPlayer(server, altId);
  partyUp(a, b); partyUp(a, alt);
  openMap(a);
  walkIntoProp(a, 'portal', clock, [b, alt]);
  enterMapOf(b, a, clock, [a, alt]);
  enterMapOf(alt, a, clock, [a, b]);
  const map = a.session.instance as MapInstance;
  server.game.handleOutcomes(map, [{ t: 'bossDefeated' }]);
  for (const p of [a, b, alt]) {
    expect(p.session.record.ch.atlas!.clears).toBe(1);
    expect(p.session.record.ch.atlas!.discovered).toEqual(expect.arrayContaining(['emberRoad', 'boneApproach']));
  }
  expect(map.atlasCredits.size).toBe(2);
  const first = a.session.record.ch.atlas;
  server.game.handleOutcomes(map, [{ t: 'bossDefeated' }]);
  expect(a.session.record.ch.atlas).toEqual(first);
  await server.close();
  ({ clock } = await boot(path));
  a = new LocalPlayer(server, aId); b = new LocalPlayer(server, bId);
  const restored = a.session.instance as MapInstance;
  expect(restored.setup.atlasAreaId).toBe('cinderCrossing');
  expect(restored.atlasCredits.size).toBe(2);
  server.game.handleOutcomes(restored, [{ t: 'bossDefeated' }]);
  expect(a.session.record.ch.atlas).toEqual(first);
  expect(b.session.record.ch.atlas!.clears).toBe(1);
});

it('retries a failed discovery transaction without recording half of the account/run handover', async () => {
  const { clock } = await boot();
  const a = new LocalPlayer(server, createLocalCharacter(server, 'Atlas Retry'));
  openMap(a); walkIntoProp(a, 'portal', clock);
  const map = a.session.instance as MapInstance;
  vi.spyOn(server.db, 'saveAccountStorage').mockImplementationOnce(() => { throw new Error('disk busy'); });
  server.game.handleOutcomes(map, [{ t: 'bossDefeated' }]);
  expect(a.session.record.ch.atlas!.clears).toBe(0);
  expect(map.atlasCredits.size).toBe(0);
  expect(map.atlasPendingCredits.size).toBe(1);
  expect(JSON.parse(server.db.loadOpenMaps()[0].setup).atlasCredits).toBeUndefined();
  server.game.maintenance();
  expect(a.session.record.ch.atlas!.clears).toBe(1);
  expect(map.atlasCredits.size).toBe(1);
  expect(map.atlasPendingCredits.size).toBe(0);
});

it('enforces fog and tier ceilings on commands before consuming the map', async () => {
  await boot();
  const a = new LocalPlayer(server, createLocalCharacter(server, 'Atlas Gate'));
  const item = a.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  expect(a.command({ c: 'moveItem', uid: item.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  expect(a.command({ c: 'activateMapDevice', areaId: 'winterThrone' }).ok).toBe(false);
  server.game.setCharacter(a.session, { ...a.session.record.ch, mapDevice: { ...a.session.record.ch.mapDevice!, tier: 2 } });
  expect(a.command({ c: 'activateMapDevice' }).ok).toBe(false);
  expect(a.session.record.ch.mapDevice?.tier).toBe(2);
  expect(server.db.loadOpenMaps()).toHaveLength(0);
});

it('refunds the original Bounty map, key and paid territory fee together if the sealed run cannot survive a restart', async () => {
  const { path } = await boot();
  const aId = createLocalCharacter(server, 'Atlas Refund');
  const a = new LocalPlayer(server, aId);
  server.game.setCharacter(a.session, { ...a.session.record.ch, atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 }, currencyStash: { reliquaryKey: 1, scrap: 20 } });
  const map = a.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  expect(a.command({ c: 'moveItem', uid: map.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  server.game.setCharacter(a.session, { ...a.session.record.ch, mapDevice: { ...a.session.record.ch.mapDevice!, tier: 7, bounty: true } });
  const scrapBefore = currencyOnHand(a.session.record.ch, 'scrap');
  expect(a.command({ c: 'activateMapDevice', areaId: 'sealedReliquary' }).ok).toBe(true);
  expect(currencyOnHand(a.session.record.ch, 'scrap')).toBe(scrapBefore - 2);
  expect(JSON.parse(server.db.loadOpenMaps()[0].setup).entranceScrap).toBe(2);
  expect(currencyOnHand(a.session.record.ch, 'reliquaryKey')).toBe(0);
  await server.close();
  const db = await GameDatabase.open(path);
  const row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, setup: JSON.stringify({ ...JSON.parse(row.setup), seed: 'broken' }) });
  db.close();
  await boot(path);
  const back = new LocalPlayer(server, aId);
  expect(back.session.record.ch.mapDevice).toEqual({ ...map, tier: 7, bounty: true, isNew: undefined });
  expect(currencyOnHand(back.session.record.ch, 'reliquaryKey')).toBe(1);
  expect(currencyOnHand(back.session.record.ch, 'scrap')).toBe(scrapBefore);
  expect(server.db.loadOpenMaps()).toHaveLength(0);
});


it('restores a paid Bounty expedition without charging its owner again', async () => {
  const { path } = await boot();
  const id = createLocalCharacter(server, 'Paid Petra');
  const p = new LocalPlayer(server, id);
  const source = p.session.record.ch.backpack.entries.find(e => e.item.kind === 'map')!.item;
  expect(p.command({ c: 'moveItem', uid: source.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  server.game.setCharacter(p.session, { ...p.session.record.ch,
    atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 },
    mapDevice: { ...p.session.record.ch.mapDevice!, tier: 7, bounty: true } });
  const before = currencyOnHand(p.session.record.ch, 'scrap');
  expect(p.command({ c: 'activateMapDevice', areaId: 'shatteredForge' }).ok).toBe(true);
  expect(currencyOnHand(p.session.record.ch, 'scrap')).toBe(before - 2);
  const originalEvent = server.game.instances.activeMapOf(id)!.setup.event;
  expect(originalEvent?.kind).toBe('hunted');
  await server.close();
  await boot(path);
  const back = new LocalPlayer(server, id);
  expect(currencyOnHand(back.session.record.ch, 'scrap')).toBe(before - 2);
  const restored = server.game.instances.activeMapOf(id)!;
  expect(restored.setup.entranceScrap).toBe(2);
  expect(restored.setup.event).toEqual(originalEvent);
  expect(restored.sourceItem?.bounty).toBe(true);
});

it.each(ATLAS_KEYS)('refunds the exact $currencyId, source map and fee atomically after an unrestorable run', async key => {
  const { path } = await boot();
  const id = createLocalCharacter(server, 'Key Keeper');
  const p = new LocalPlayer(server, id);
  const source = p.session.record.ch.backpack.entries.find(e => e.item.kind === 'map')!.item;
  expect(p.command({ c: 'moveItem', uid: source.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  server.game.setCharacter(p.session, { ...p.session.record.ch,
    atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 },
    currencyStash: { scrap: 50, [key.currencyId]: 2 }, mapDevice: { ...p.session.record.ch.mapDevice!, tier: 4 } });
  const before = p.session.record.ch, feeBefore = currencyOnHand(before, 'scrap');
  expect(p.command({ c: 'activateMapDevice', areaId: key.areaId, lootClass: 'ring' }).ok).toBe(true);
  expect(currencyOnHand(p.session.record.ch, key.currencyId)).toBe(1);
  expect(currencyOnHand(p.session.record.ch, 'scrap')).toBe(feeBefore - 1);
  const setup = JSON.parse(server.db.loadOpenMaps()[0].setup);
  expect(setup.entranceKey).toBe(key.currencyId);
  await server.close();
  const db = await GameDatabase.open(path), row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, setup: JSON.stringify({ ...setup, seed: 'invalid' }) }); db.close();
  await boot(path);
  const back = new LocalPlayer(server, id);
  expect(back.session.record.ch.mapDevice).toEqual(before.mapDevice);
  expect(currencyOnHand(back.session.record.ch, key.currencyId)).toBe(2);
  expect(currencyOnHand(back.session.record.ch, 'scrap')).toBe(feeBefore);
  expect(server.db.loadOpenMaps()).toHaveLength(0);
});

it('credits a bossless Shrine Field clear once for every present party account, including after restart', async () => {
  const { path, clock } = await boot();
  const id = createLocalCharacter(server, 'Shrine Scout'), guestId = createLocalCharacter(server, 'Shrine Guest');
  const a = new LocalPlayer(server, id), b = new LocalPlayer(server, guestId);
  partyUp(a, b);
  server.game.setCharacter(a.session, { ...a.session.record.ch, atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 } });
  const source = a.session.record.ch.backpack.entries.find(e => e.item.kind === 'map')!.item;
  expect(a.command({ c: 'moveItem', uid: source.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  expect(a.command({ c: 'activateMapDevice', areaId: 'shrineField' }).ok).toBe(true);
  walkIntoProp(a, 'portal', clock, [b]); enterMapOf(b, a, clock, [a]);
  const map = a.session.instance as MapInstance;
  server.game.handleOutcomes(map, [{ t: 'cleared' }, { t: 'cleared' }]);
  for (const p of [a, b]) {
    expect(p.session.record.ch.atlas!.completed).toContain('shrineField');
    expect(p.session.record.ch.atlas!.clears).toBe(1);
  }
  expect(map.atlasCredits.size).toBe(2);
  await server.close(); await boot(path);
  expect(new LocalPlayer(server, guestId).session.record.ch.atlas!.clears).toBe(1);
});

it('keeps failed Atlas awards after a completed map is closed, then grants them once after restart', async () => {
  const { path, clock } = await boot();
  const id = createLocalCharacter(server, 'Patient Scout'), p = new LocalPlayer(server, id);
  server.game.setCharacter(p.session, { ...p.session.record.ch, atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 } });
  const source = p.session.record.ch.backpack.entries.find(e => e.item.kind === 'map')!.item;
  expect(p.command({ c: 'moveItem', uid: source.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  expect(p.command({ c: 'activateMapDevice', areaId: 'shrineField' }).ok).toBe(true);
  walkIntoProp(p, 'portal', clock);
  const map = p.session.instance as MapInstance;
  const save = server.db.saveAccountStorage.bind(server.db);
  vi.spyOn(server.db, 'saveAccountStorage').mockImplementation(row => {
    if (JSON.parse(row.data).atlas?.clears > 0) throw new Error('Atlas storage temporarily unavailable');
    save(row);
  });
  server.game.handleOutcomes(map, [{ t: 'cleared' }]);
  expect(p.session.record.ch.atlas!.clears).toBe(0);
  expect(server.db.loadAtlasCredits()).toHaveLength(1);
  server.game.closeMap(map, 'cleared');
  expect(server.db.loadOpenMaps()).toHaveLength(0);
  expect(server.db.loadAtlasCredits()).toHaveLength(1);
  await server.close(); await boot(path);
  const back = new LocalPlayer(server, id);
  expect(back.session.record.ch.atlas!.clears).toBe(1);
  expect(back.session.record.ch.atlas!.completed).toContain('shrineField');
  expect(server.db.loadAtlasCredits()).toHaveLength(0);
  server.game.maintenance(); server.game.maintenance();
  expect(back.session.record.ch.atlas!.clears).toBe(1);
});

it('waits for the sealed encounter chain before recording Atlas completion', async () => {
  const { clock } = await boot();
  const p = new LocalPlayer(server, createLocalCharacter(server, 'Rift Scout'));
  server.game.setCharacter(p.session, { ...p.session.record.ch,
    atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 }, currencyStash: { riftKey: 1 } });
  const source = p.session.record.ch.backpack.entries.find(e => e.item.kind === 'map')!.item;
  expect(p.command({ c: 'moveItem', uid: source.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  expect(p.command({ c: 'activateMapDevice', areaId: 'riftNexus' }).ok).toBe(true);
  walkIntoProp(p, 'portal', clock);
  const map = p.session.instance as MapInstance;
  server.game.handleOutcomes(map, [{ t: 'bossDefeated' }]);
  expect(p.session.record.ch.atlas!.clears).toBe(0);
  server.game.handleOutcomes(map, [{ t: 'cleared' }, { t: 'cleared' }]);
  expect(p.session.record.ch.atlas!.clears).toBe(1);
  expect(p.session.record.ch.atlas!.completed).toContain('riftNexus');
});

it('backfills legacy completed-map awards once and ignores recipients whose accounts no longer exist', async () => {
  const { path, clock } = await boot();
  const id = createLocalCharacter(server, 'Legacy Scout'), p = new LocalPlayer(server, id);
  const accountId = p.session.record.accountId;
  openMap(p); walkIntoProp(p, 'portal', clock);
  await server.close();
  const db = await GameDatabase.open(path), row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, cleared: true, setup: JSON.stringify({ ...JSON.parse(row.setup),
    atlasPendingCredits: [[accountId, id], ['deleted-account', 'deleted-character']] }) });
  db.close();
  await boot(path);
  expect(new LocalPlayer(server, id).session.record.ch.atlas!.clears).toBe(1);
  expect(server.db.loadOpenMaps()).toHaveLength(0);
  expect(server.db.loadAtlasCredits()).toHaveLength(0);
  await server.close(); await boot(path);
  expect(new LocalPlayer(server, id).session.record.ch.atlas!.clears).toBe(1);
});
