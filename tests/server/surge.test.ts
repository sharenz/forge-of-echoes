// Slice G1 on the real server (brief D 7.2, 7.3, 12 items 5 and 9): the server clock decides the forge day, the spend is saved with the map
// in one transaction, a restart restores the run with its frozen bonus, an unrestorable run gives the charge back (only that), the ledger is
// account-wide, a party guest never spends, and Hourglass Sand / the Grand Hourglass are commands answered by the server.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { SURGE_DAY_MS } from '../../src/data/progression/territory';
import { forgeDay, surgeStatus } from '../../src/game/progression/surge';
import { GameDatabase } from '../../src/server';
import { bindDeviceMap, createClock, createLocalCharacter, LocalPlayer, partyUp, startTestServer } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-surge-'));
type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server;
let count = 0;
afterEach(async () => { vi.restoreAllMocks(); await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
async function boot(path = join(dir, `${++count}.db`), start?: number) {
  const clock = createClock(start);
  server = await startTestServer({ dbPath: path, game: { autoTick: false, now: clock.now } });
  return { clock, path };
}

/** A character with a Tier 1 Cinder Crossing map in the device and the whole chart revealed. */
function ready(name: string): LocalPlayer {
  const p = new LocalPlayer(server, createLocalCharacter(server, name));
  const map = p.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  expect(p.command({ c: 'moveItem', uid: map.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  const ch = p.session.record.ch;
  server.game.setCharacter(p.session, { ...ch, atlas: { ...(ch.atlas ?? { discovered: [], completed: [], clears: 0 }), discovered: [...ATLAS_AREA_IDS] } });
  bindDeviceMap(p, 'cinderCrossing');
  return p;
}
const spent = (p: LocalPlayer, area = 'cinderCrossing') => p.session.record.ch.atlas?.surge?.spent[area as 'cinderCrossing'] ?? 0;

it('spends a charge by the server clock when the opener asks, and the bonus is part of the saved run', async () => {
  const { clock } = await boot();
  const p = ready('Surge Sam');
  expect(p.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  expect(spent(p)).toBe(1);
  expect(p.session.record.ch.atlas!.surge!.day).toBe(forgeDay(clock.now()));
  const run = server.game.instances.activeMapOf(p.characterId)!;
  expect(run.setup.surge).toEqual({ areaId: 'cinderCrossing', quantityMore: 30, rarityMore: 15, day: forgeDay(clock.now()) });
  // the row written with the map carries it
  expect(JSON.parse(server.db.loadOpenMaps()[0].setup).surge).toEqual(run.setup.surge);
});

it('keeps the charge when the opener holds it back or leaves the flag out', async () => {
  await boot();
  const p = ready('Hold Hanna');
  expect(p.command({ c: 'activateMapDevice', useSurge: false }).ok).toBe(true);
  expect(spent(p)).toBe(0);
  expect(server.game.instances.activeMapOf(p.characterId)!.setup.surge).toBeUndefined();
});

it('persists the ledger and restores the run with the bonus it was opened with after a restart', async () => {
  const { path } = await boot();
  const p = ready('Restart Rita');
  const id = p.characterId;
  expect(p.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  const frozen = server.game.instances.activeMapOf(id)!.setup.surge;
  await server.close();
  await boot(path);
  const back = new LocalPlayer(server, id);
  expect(spent(back)).toBe(1);
  expect(server.game.instances.activeMapOf(id)!.setup.surge).toEqual(frozen);
  // a second restart keeps both
  await server.close();
  await boot(path);
  expect(spent(new LocalPlayer(server, id))).toBe(1);
  expect(server.game.instances.activeMapOf(id)!.setup.surge).toEqual(frozen);
});

it('restores a run opened before the daily reset with its frozen surge and gives the new day full charges', async () => {
  const { path, clock } = await boot();
  const p = ready('Dawn Dara');
  const id = p.characterId;
  expect(p.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  const frozen = server.game.instances.activeMapOf(id)!.setup.surge!;
  await server.close();
  await boot(path, clock.now() + SURGE_DAY_MS);
  const back = new LocalPlayer(server, id);
  expect(server.game.instances.activeMapOf(id)!.setup.surge).toEqual(frozen);
  expect(frozen.day).toBe(forgeDay(clock.now()));
  expect(surgeStatus(back.session.record.ch.atlas, 'cinderCrossing', server.game.now()).remaining).toBe(3);
});

it('gives the charge back with the map when the run cannot be restored, and only then', async () => {
  const { path } = await boot();
  const p = ready('Refund Rex');
  const id = p.characterId;
  const before = p.session.record.ch.mapDevice;
  expect(p.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  expect(spent(p)).toBe(1);
  await server.close();
  const db = await GameDatabase.open(path), row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, setup: JSON.stringify({ ...JSON.parse(row.setup), seed: 'invalid' }) }); db.close();
  await boot(path);
  const back = new LocalPlayer(server, id);
  expect(back.session.record.ch.mapDevice).toEqual(before);
  expect(spent(back)).toBe(0);
  expect(server.db.loadOpenMaps()).toHaveLength(0);
});

it('does not refund a charge once the forge day has turned over', async () => {
  const { path, clock } = await boot();
  const p = ready('Late Lena');
  const id = p.characterId;
  expect(p.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  await server.close();
  const db = await GameDatabase.open(path), row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, setup: JSON.stringify({ ...JSON.parse(row.setup), seed: 'invalid' }) }); db.close();
  await boot(path, clock.now() + SURGE_DAY_MS);
  const back = new LocalPlayer(server, id);
  // the map came back, the ledger still says yesterday (it is not rewritten), and today everything is full
  expect(back.session.record.ch.mapDevice).toBeTruthy();
  expect(back.session.record.ch.atlas!.surge!.day).toBe(forgeDay(clock.now()));
  expect(back.session.record.ch.atlas!.surge!.spent.cinderCrossing).toBe(1);
});

it('shares the ledger between the characters of one account', async () => {
  await boot();
  const a = ready('Account Ada');
  const accountId = server.game.store.ownerOf(a.characterId)!;
  const created = server.game.store.create(accountId, 'Account Alt');
  if (!created.ok) throw new Error(created.error);
  expect(a.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  const alt = new LocalPlayer(server, created.character.id);
  expect(spent(alt)).toBe(1);
});

it('a party guest gets the bonus of the opener\'s expedition and never spends a charge of their own', async () => {
  const { clock } = await boot();
  const owner = ready('Party Pia');
  const guest = new LocalPlayer(server, createLocalCharacter(server, 'Party Gus'));
  partyUp(owner, guest);
  expect(owner.command({ c: 'activateMapDevice', useSurge: true }).ok).toBe(true);
  const run = server.game.instances.activeMapOf(owner.characterId)!;
  expect(run.setup.surge).toBeDefined();
  expect(spent(owner)).toBe(1);
  expect(guest.session.record.ch.atlas?.surge).toBeUndefined();
  void clock;
});

it('Hourglass Sand refills one area and the Grand Hourglass all of them, answered by the server', async () => {
  await boot();
  const p = ready('Sand Sol');
  const today = forgeDay(server.game.now());
  const give = (patch: Record<string, number>, spentNow: Record<string, number>) => {
    const ch = p.session.record.ch;
    server.game.setCharacter(p.session, { ...ch, currencyStash: { ...ch.currencyStash, ...patch }, atlas: { ...ch.atlas!, surge: { day: today, spent: spentNow as never } } });
  };
  give({}, { cinderCrossing: 1 });
  // refused: no Sand
  expect(p.command({ c: 'refillSurge', areaId: 'cinderCrossing' }).ok).toBe(false);
  give({ hourglassSand: 1, grandHourglass: 1 }, { cinderCrossing: 1 });
  // refused without cost for a full area
  expect(p.command({ c: 'refillSurge', areaId: 'emberRoad' }).ok).toBe(false);
  expect(p.session.record.ch.currencyStash.hourglassSand).toBe(1);
  // Sand on the spent area
  expect(p.command({ c: 'refillSurge', areaId: 'cinderCrossing' }).ok).toBe(true);
  expect(spent(p)).toBe(0);
  expect(p.session.record.ch.currencyStash.hourglassSand ?? 0).toBe(0);
  // Grand Hourglass: refused while everything is full, works once something is spent
  expect(p.command({ c: 'refillSurge', all: true }).ok).toBe(false);
  expect(p.session.record.ch.currencyStash.grandHourglass).toBe(1);
  give({}, { cinderCrossing: 2, emberRoad: 1 });
  expect(p.command({ c: 'refillSurge', all: true }).ok).toBe(true);
  expect(p.session.record.ch.atlas!.surge!.spent).toEqual({});
  expect(p.session.record.ch.currencyStash.grandHourglass ?? 0).toBe(0);
  // the use is saved with the account
  const reread = server.game.store.peek(p.characterId)!;
  expect(reread.ch.atlas!.surge!.spent).toEqual({});
});

it('says the surge banner with the opening and counts the Atlas use for the status line (slice F1)', async () => {
  await boot();
  const p = ready('Banner Bea');
  server.game.territoryCounts.drain();
  const res = p.command({ c: 'activateMapDevice', useSurge: true });
  expect(res.ok).toBe(true);
  expect(res.message).toContain('Surge: +30% item quantity, +15% item rarity. 2 of 3 charges left in Cinder Crossing today.');
  expect(p.command({ c: 'pinArea', areaId: 'emberRoad', pinned: true }).ok).toBe(true);
  expect(p.command({ c: 'pinArea', areaId: 'emberRoad', pinned: false }).ok).toBe(true);
  expect(server.game.territoryCounts.drain()).toEqual({ pinned: 1, unpinned: 1, surgeSpent: 1 });
  // drained: the next status line starts from zero
  expect(server.game.territoryCounts.drain()).toBeUndefined();
});
