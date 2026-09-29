import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
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

it('refunds the original map and its key together if the sealed run cannot survive a restart', async () => {
  const { path } = await boot();
  const aId = createLocalCharacter(server, 'Atlas Refund');
  const a = new LocalPlayer(server, aId);
  server.game.setCharacter(a.session, { ...a.session.record.ch, atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 }, currencyStash: { reliquaryKey: 1 } });
  const map = a.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  expect(a.command({ c: 'moveItem', uid: map.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  expect(a.command({ c: 'activateMapDevice', areaId: 'sealedReliquary' }).ok).toBe(true);
  expect(currencyOnHand(a.session.record.ch, 'reliquaryKey')).toBe(0);
  await server.close();
  const db = await GameDatabase.open(path);
  const row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, setup: JSON.stringify({ ...JSON.parse(row.setup), seed: 'broken' }) });
  db.close();
  await boot(path);
  const back = new LocalPlayer(server, aId);
  expect(back.session.record.ch.mapDevice).toEqual({ ...map, isNew: undefined });
  expect(currencyOnHand(back.session.record.ch, 'reliquaryKey')).toBe(1);
  expect(server.db.loadOpenMaps()).toHaveLength(0);
});
