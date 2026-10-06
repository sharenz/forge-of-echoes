// Slice B1 on the real server (brief D 6, 12 items 5 and 10): slotSigil / unslotSigil are hideout commands that change the backpack and the
// account's beacons in one save; activation spends the uses with the map, the run carries its frozen sigils through a restart, and an
// unrestorable run gives the uses back with the map.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import type { SigilId } from '../../src/contracts/content';
import { rules } from '../../src/game';
import { GameDatabase } from '../../src/server';
import { bindDeviceMap, createClock, createLocalCharacter, LocalPlayer, savedCharacter, startTestServer } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-territory-'));
type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server;
let count = 0;
afterEach(async () => { await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
async function boot(path = join(dir, `${++count}.db`)) {
  const clock = createClock();
  server = await startTestServer({ dbPath: path, game: { autoTick: false, now: clock.now } });
  return { path };
}

/** A character whose whole chart is cleared (every area a beacon), with `n` sigils of `id` in the backpack and a Tier 1 Cinder Crossing map in the device. */
function ready(name: string, id: SigilId = 'fortuneSigil1', n = 2): { p: LocalPlayer; uid: string } {
  const p = new LocalPlayer(server, createLocalCharacter(server, name));
  const map = p.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  expect(p.command({ c: 'moveItem', uid: map.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  const ch = p.session.record.ch;
  const added = rules.addToBackpack({ ...ch, atlas: { ...ch.atlas!, discovered: [...ATLAS_AREA_IDS], completed: [...ATLAS_AREA_IDS] } },
    { kind: 'currency', currencyId: id, count: n, uid: `sigil${count}` });
  if (!added.ok) throw new Error(added.error);
  server.game.setCharacter(p.session, added.value);
  bindDeviceMap(p, 'cinderCrossing');
  // the backpack may re-mint an incoming uid: read it back
  return { p, uid: p.session.record.ch.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === id)!.item.uid };
}
const beacon = (p: LocalPlayer, area = 'cinderCrossing') => p.session.record.ch.atlas?.beacons?.[area as 'cinderCrossing'];
const held = (p: LocalPlayer, uid: string) => p.session.record.ch.backpack.entries.find((e) => e.item.uid === uid)?.item;

it('slots a sigil from the backpack into a cleared area and saves both in one write', async () => {
  await boot();
  const { p, uid } = ready('Beacon Bea');
  const r = p.command({ c: 'slotSigil', areaId: 'cinderCrossing', slot: 0, uid });
  expect(r).toMatchObject({ ok: true, message: expect.stringContaining('Faint Fortune Sigil lights the Cinder Crossing beacon') });
  expect(beacon(p)).toEqual([{ sigilId: 'fortuneSigil1', uses: 12, max: 12 }]);
  expect(held(p, uid)).toMatchObject({ count: 1 });
  const saved = savedCharacter(server, p.characterId);
  expect(saved.atlas?.beacons?.cinderCrossing).toEqual([{ sigilId: 'fortuneSigil1', uses: 12, max: 12 }]);
  expect(saved.backpack.entries.find((e) => e.item.uid === uid)?.item).toMatchObject({ count: 1 });
});

it('refuses what the rules refuse, changing nothing', async () => {
  await boot();
  const { p, uid } = ready('Refused Rolf');
  const before = p.session.record.ch;
  expect(p.command({ c: 'slotSigil', areaId: 'cinderCrossing', slot: 1, uid })).toMatchObject({ ok: false, error: 'Cinder Crossing has 1 sigil slot.' });
  expect(p.command({ c: 'slotSigil', areaId: 'cinderCrossing', slot: 0, uid: 'nope' }).ok).toBe(false);
  const mapUid = p.session.record.ch.mapDevice!.uid;
  expect(p.command({ c: 'slotSigil', areaId: 'cinderCrossing', slot: 0, uid: mapUid })).toMatchObject({ ok: false });
  expect(p.command({ c: 'unslotSigil', areaId: 'cinderCrossing', slot: 0 })).toMatchObject({ ok: false, error: 'That beacon slot is empty.' });
  expect(p.session.record.ch).toBe(before);
});

it('takes an unused sigil back out and consumes a used one', async () => {
  await boot();
  const { p, uid } = ready('Unslot Uma');
  expect(p.command({ c: 'slotSigil', areaId: 'cinderCrossing', slot: 0, uid }).ok).toBe(true);
  expect(p.command({ c: 'unslotSigil', areaId: 'cinderCrossing', slot: 0 })).toMatchObject({ ok: true, message: expect.stringContaining('went back') });
  expect(beacon(p)).toBeUndefined();
  const total = p.session.record.ch.backpack.entries.filter((e) => e.item.kind === 'currency' && e.item.currencyId === 'fortuneSigil1').reduce((n, e) => n + (e.item as { count: number }).count, 0);
  expect(total).toBe(2);
});

it('spends a use at activation, freezes the sigil into the saved run, keeps it through a restart and refunds it with an unrestorable run', async () => {
  const { path } = await boot();
  const { p, uid } = ready('Run Ruth');
  const id = p.characterId;
  expect(p.command({ c: 'slotSigil', areaId: 'cinderCrossing', slot: 0, uid }).ok).toBe(true);
  const device = p.session.record.ch.mapDevice;
  expect(p.command({ c: 'activateMapDevice' }).ok).toBe(true);
  expect(beacon(p)).toEqual([{ sigilId: 'fortuneSigil1', uses: 11, max: 12 }]);
  const run = server.game.instances.activeMapOf(id)!;
  expect(run.setup.territory).toEqual([{ sigilId: 'fortuneSigil1', fromAreaId: 'cinderCrossing', slot: 0, share: 1 }]);
  expect(JSON.parse(server.db.loadOpenMaps()[0].setup).territory).toEqual(run.setup.territory);
  // a restart restores the run with the same sigils (even if the beacon changed meanwhile)
  await server.close();
  await boot(path);
  const back = new LocalPlayer(server, id);
  expect(server.game.instances.activeMapOf(id)!.setup.territory).toEqual(run.setup.territory);
  expect(beacon(back)).toEqual([{ sigilId: 'fortuneSigil1', uses: 11, max: 12 }]);
  // an unrestorable run gives the map and the use back
  await server.close();
  const db = await GameDatabase.open(path), row = db.loadOpenMaps()[0];
  db.saveOpenMap({ ...row, setup: JSON.stringify({ ...JSON.parse(row.setup), seed: 'invalid' }) }); db.close();
  await boot(path);
  const refunded = new LocalPlayer(server, id);
  expect(refunded.session.record.ch.mapDevice).toEqual(device);
  expect(beacon(refunded)).toEqual([{ sigilId: 'fortuneSigil1', uses: 12, max: 12 }]);
});

it('says so when a sigil burns out at activation', async () => {
  await boot();
  const { p } = ready('Burn Bo');
  const ch = p.session.record.ch;
  server.game.setCharacter(p.session, { ...ch, atlas: { ...ch.atlas!, beacons: { cinderCrossing: [{ sigilId: 'fortuneSigil2', uses: 1, max: 12 }] } } });
  const r = p.command({ c: 'activateMapDevice' });
  expect(r).toMatchObject({ ok: true, message: expect.stringContaining('Bright Fortune Sigil in the Cinder Crossing beacon burned out') });
  expect(beacon(p)).toBeUndefined();
});
