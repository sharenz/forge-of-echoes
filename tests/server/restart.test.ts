// Restart safety (GAME_SPEC §11 — "after deployment we lost our party and our map"): the server is stopped
// and started again on the same SQLite file. Parties come back, open uncleared maps come back as fresh runs
// with the same portals, players who were inside are put straight back in without paying a portal, cleared
// maps stay gone, unrestorable ones are refunded, and a drain announces the update before anyone is cut off.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PORTALS_PER_MAP } from '../../src/contracts/net';
import { GameDatabase } from '../../src/server';
import { RESTORED_LEADER_WAIT_MS, RESTORED_MAP_TOAST } from '../../src/server/game';
import { MapInstance } from '../../src/server/instance';
import { PARTY_IDLE_TTL_MS } from '../../src/server/party';
import {
  LocalPlayer, captureLogger, createClock, createLocalCharacter, enterMapOf, newPlayer, openMap, partyUp, savedCharacter,
  startTestServer, tick, uidsOf, walkIntoProp,
} from './helpers';
import { TestClient } from './ws-client';

type Server = Awaited<ReturnType<typeof startTestServer>>;

const dir = mkdtempSync(join(tmpdir(), 'forge-restart-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const running: Server[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.close();
});

let dbCounter = 0;

async function boot(dbPath: string, opts: { drainSeconds?: number; start?: number } = {}) {
  const { start, ...rest } = opts;
  const clock = createClock(start);
  const logger = captureLogger();
  const server = await startTestServer({ dbPath, logger, ...rest, game: { autoTick: false, now: clock.now } });
  running.push(server);
  return { server, clock, logger };
}

async function stop(server: Server): Promise<void> {
  const k = running.indexOf(server);
  if (k >= 0) running.splice(k, 1);
  await server.close();
}

function freshDb(): string {
  return join(dir, `restart-${++dbCounter}.db`);
}

describe('restart safety', () => {
  it('keeps the party and the open map; players who were inside go straight back in without paying a portal', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const adaId = createLocalCharacter(server, 'Ada Keeper');
    const benId = createLocalCharacter(server, 'Ben Keeper');
    let ada = new LocalPlayer(server, adaId);
    let ben = new LocalPlayer(server, benId);
    partyUp(ada, ben);
    openMap(ada);
    walkIntoProp(ada, 'portal', clock, [ben]);
    enterMapOf(ben, ada, clock, [ada]);
    const map = ada.session.instance as MapInstance;
    expect(map.portalsRemaining).toBe(PORTALS_PER_MAP - 2);
    const key = map.mapKey;
    const mapName = map.mapName;
    for (let k = 0; k < 240; k++) {
      ada.input();
      ben.input();
      tick(server, clock);
    }
    await stop(server);

    // The run so far counted, neutrally; the map item was NOT refunded (the map lives on).
    ({ server, clock } = await boot(dbPath));
    const savedAda = savedCharacter(server, adaId);
    expect(savedAda.mapDevice).toBeNull();
    expect(savedAda.stats.mapsFailed).toBe(0);
    expect(savedAda.stats.playSeconds).toBeGreaterThan(0);

    // Restored before anyone is back: the party (both offline) and the map with the same portals.
    const party = server.game.parties.partyOf(adaId)!;
    expect(party.members.sort()).toEqual([adaId, benId].sort());
    const restored = server.game.instances.activeMapOf(adaId)!;
    expect(restored).toBeTruthy();
    expect(restored).toMatchObject({ mapKey: key, mapName, portalsRemaining: PORTALS_PER_MAP - 2, restored: true, cleared: false });
    expect(restored.playerCount).toBe(0);
    server.game.maintenance();
    expect(restored.disposed).toBe(false);

    // Ada returns: straight into the map, no portal spent, told why the fight restarted.
    ada = new LocalPlayer(server, adaId);
    expect(ada.zone).toMatchObject({ kind: 'map', instanceId: restored.id, ownerCharacterId: adaId });
    expect(ada.zone!.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 2 });
    expect(ada.all('toast').some((t) => t.text === RESTORED_MAP_TOAST)).toBe(true);
    expect(restored.run.view.run.wave).toBeLessThanOrEqual(1);
    // Her party is there, Ben still offline.
    const info = ada.last('party')!.party!;
    expect(info.members.map((m) => [m.name, m.online])).toEqual(expect.arrayContaining([['Ada Keeper', true], ['Ben Keeper', false]]));
    expect(info.members.find((m) => m.characterId === adaId)!.activeMap).toMatchObject({ remaining: PORTALS_PER_MAP - 2 });

    // Ben returns into the same map; Ada sees him come online.
    const adaFrom = ada.mark();
    ben = new LocalPlayer(server, benId);
    expect(ben.zone).toMatchObject({ kind: 'map', instanceId: restored.id });
    expect(restored.portalsRemaining).toBe(PORTALS_PER_MAP - 2);
    expect(restored.playerCount).toBe(2);
    expect(ada.all('party', adaFrom).at(-1)!.party!.members.every((m) => m.online)).toBe(true);

    // Leaving works as usual (into Ada's hideout, next to her portals); the next start puts Ben back there.
    expect(ben.command({ c: 'leaveMap' }).ok).toBe(true);
    expect(ben.session.instance!.ownerId).toBe(adaId);
    expect(server.db.characterMap(benId)).toBeNull();
    expect(server.db.characterMap(adaId)).toMatchObject({ mapId: key, ownerId: adaId });
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    ben = new LocalPlayer(server, benId);
    expect(ben.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: adaId });
    expect(ben.command({ c: 'visitHideout', characterId: benId }).ok).toBe(true);
    expect(ben.session.instance!.ownerId).toBe(benId);
    ada = new LocalPlayer(server, adaId);
    expect(ada.zone).toMatchObject({ kind: 'map' });
    expect((ada.session.instance as MapInstance).mapKey).toBe(key);
  }, 60_000);

  it("a party member visiting a friend's hideout comes back to that hideout, not their own", async () => {
    const dbPath = freshDb();
    let { server } = await boot(dbPath);
    const hostId = createLocalCharacter(server, 'Host Hilde');
    const guestId = createLocalCharacter(server, 'Guest Gus');
    const loneId = createLocalCharacter(server, 'Lone Lotte');
    let host = new LocalPlayer(server, hostId);
    let guest = new LocalPlayer(server, guestId);
    let lone = new LocalPlayer(server, loneId);
    partyUp(host, guest);
    expect(guest.command({ c: 'visitHideout', characterId: hostId }).ok).toBe(true);
    expect(guest.session.instance!.ownerId).toBe(hostId);
    await stop(server);
    expect(host.conn.closedWith?.code).toBe(4004);

    ({ server } = await boot(dbPath));
    // The guest returns first (the host still offline): straight into the host's hideout, without a toast.
    guest = new LocalPlayer(server, guestId);
    expect(guest.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: hostId });
    expect(guest.all('toast')).toHaveLength(0);
    expect(server.db.characterMap(guestId)).toBeNull();
    host = new LocalPlayer(server, hostId);
    expect(host.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: hostId });
    expect(host.session.instance).toBe(guest.session.instance);
    lone = new LocalPlayer(server, loneId);
    expect(lone.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: loneId });

    // Out of the party by the next start: the row is not a pass into a stranger's hideout.
    await stop(server);
    ({ server } = await boot(dbPath));
    server.game.parties.remove(guestId, () => false);
    guest = new LocalPlayer(server, guestId);
    expect(guest.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: guestId });
    expect(server.db.characterMap(guestId)).toBeNull();
  }, 60_000);

  it('an item on the floor goes back to whoever dropped it when the server stops (a hand-over is never lost)', async () => {
    const dbPath = freshDb();
    let { server } = await boot(dbPath);
    const id = createLocalCharacter(server, 'Dropper Dora');
    const dora = new LocalPlayer(server, id);
    const robe = dora.session.record.ch.equipment.chest!;
    expect(dora.command({ c: 'dropItem', uid: robe.uid }).ok).toBe(true);
    expect(dora.session.record.ch.equipment.chest).toBeUndefined();
    expect(dora.session.instance!.groundItems.size).toBe(1);
    await stop(server);

    ({ server } = await boot(dbPath));
    const saved = savedCharacter(server, id);
    const back = saved.backpack.entries.find((e) => e.item.kind === 'equipment' && e.item.baseId === robe.baseId);
    expect(back?.item).toMatchObject({ baseId: robe.baseId, isNew: true });
    expect(uidsOf(saved).filter((u) => u === back!.item.uid)).toHaveLength(1);
  }, 60_000);

  it('a restored map waits for the players who were inside even with no portals left', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const soloId = createLocalCharacter(server, 'Last Portal');
    let solo = new LocalPlayer(server, soloId);
    openMap(solo);
    walkIntoProp(solo, 'portal', clock);
    const map = solo.session.instance as MapInstance;
    for (let used = 1; used < PORTALS_PER_MAP; used++) {
      expect(solo.command({ c: 'leaveMap' }).ok).toBe(true);
      walkIntoProp(solo, 'portal', clock);
    }
    expect(map.portalsRemaining).toBe(0);
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    const restored = server.game.instances.activeMapOf(soloId)!;
    expect(restored.portalsRemaining).toBe(0);
    clock.advance(5_000);
    server.game.maintenance();
    expect(restored.disposed).toBe(false);
    solo = new LocalPlayer(server, soloId);
    expect(solo.session.instance).toBe(restored);
    expect(solo.zone!.portal).toMatchObject({ remaining: 0 });
  }, 60_000);

  it('cleared maps are not restored: whoever was inside lands in the map owner\'s hideout', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const ownerId = createLocalCharacter(server, 'Clear Owner');
    const friendId = createLocalCharacter(server, 'Clear Friend');
    let owner = new LocalPlayer(server, ownerId);
    let friend = new LocalPlayer(server, friendId);
    partyUp(owner, friend);
    openMap(owner);
    walkIntoProp(owner, 'portal', clock, [friend]);
    enterMapOf(friend, owner, clock, [owner]);
    const map = owner.session.instance as MapInstance;
    server.game.handleOutcomes(map, [{ t: 'cleared' }]);
    expect(map.cleared).toBe(true);
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    expect(server.game.instances.activeMapOf(ownerId)).toBeNull();
    expect(server.db.loadOpenMaps()).toHaveLength(0);
    friend = new LocalPlayer(server, friendId);
    expect(friend.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: ownerId });
    expect(friend.all('toast').some((t) => /has ended/.test(t.text))).toBe(true);
    expect(server.db.characterMap(friendId)).toBeNull();
    owner = new LocalPlayer(server, ownerId);
    expect(owner.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: ownerId });
    // Clearing counted for both before the restart.
    expect(owner.session.record.ch.stats.mapsCompleted).toBe(1);
  }, 60_000);

  it('a map that cannot be rebuilt is refunded to its owner instead of lost', async () => {
    const dbPath = freshDb();
    let { server } = await boot(dbPath);
    const id = createLocalCharacter(server, 'Refund Ruth');
    const ruth = new LocalPlayer(server, id);
    openMap(ruth);
    const row = server.db.loadOpenMaps()[0];
    const mapUid = JSON.parse(row.setup).map.uid as string;
    await stop(server);

    // Corrupt the stored run (the seed), keeping the map item readable.
    const db = await GameDatabase.open(dbPath);
    const setup = JSON.parse(db.loadOpenMaps()[0].setup) as Record<string, unknown>;
    db.saveOpenMap({ ...db.loadOpenMaps()[0], setup: JSON.stringify({ ...setup, seed: 'broken' }) });
    db.close();

    const second = await boot(dbPath);
    server = second.server;
    expect(server.game.instances.activeMapOf(id)).toBeNull();
    expect(server.db.loadOpenMaps()).toHaveLength(0);
    expect(savedCharacter(server, id).mapDevice?.uid).toBe(mapUid);
    expect(second.logger.lines.some((l) => l.msg === 'map refunded')).toBe(true);
  });

  it('a party whose members are all offline waits for them, and is cleaned up after a day nobody came back', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const aId = createLocalCharacter(server, 'Idle Ida');
    const bId = createLocalCharacter(server, 'Idle Ivo');
    const a = new LocalPlayer(server, aId);
    const b = new LocalPlayer(server, bId);
    partyUp(a, b);
    for (const p of [a, b]) server.game.detach(p.conn);
    clock.advance(60_000);
    server.game.maintenance();
    expect(server.game.sessions.size).toBe(0);
    expect(server.game.parties.partyOf(aId)?.members).toHaveLength(2);
    // Back within the day: still partied, frames show the offline friend by name.
    const again = new LocalPlayer(server, aId);
    expect(again.last('party')!.party!.members.find((m) => m.characterId === bId)).toMatchObject({ name: 'Idle Ivo', online: false });
    server.game.detach(again.conn);
    clock.advance(60_000);
    server.game.maintenance();
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    expect(server.game.parties.partyOf(bId)?.members).toHaveLength(2);
    clock.advance(PARTY_IDLE_TTL_MS + 10 * 60_000);
    server.game.maintenance();
    expect(server.game.parties.partyOf(bId)).toBeNull();
    expect(server.db.loadParties()).toHaveLength(0);
  });

  it('a restart keeps the party leader: shutting down moves nothing, and whoever reconnects first does not take over', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const leadId = createLocalCharacter(server, 'Lead Lina');
    const memberId = createLocalCharacter(server, 'Member Mo');
    // The leader's session is the first to end when the server stops.
    new LocalPlayer(server, leadId);
    let member = new LocalPlayer(server, memberId);
    partyUp(new LocalPlayer(server, leadId), member);
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    expect(server.db.loadParties()).toMatchObject([{ leaderId: leadId }]);
    expect(server.game.parties.partyOf(memberId)!.leaderId).toBe(leadId);
    // The member is back first: the (still offline) leader keeps the party.
    member = new LocalPlayer(server, memberId);
    for (let k = 0; k < 4; k++) {
      member.input();
      tick(server, clock);
    }
    server.game.maintenance();
    const info = member.last('party')!.party!;
    expect(info.leaderId).toBe(leadId);
    expect(info.members.find((m) => m.characterId === leadId)).toMatchObject({ online: false, isLeader: true });
    expect(member.all('chat').some((m) => /now leads the party/.test(m.text))).toBe(false);
    expect(server.db.loadParties()[0].leaderId).toBe(leadId);

    // The leader returns within the wait: nothing changed hands, then or later.
    clock.advance(RESTORED_LEADER_WAIT_MS / 2);
    server.game.maintenance();
    const lead = new LocalPlayer(server, leadId);
    expect(lead.last('party')!.party!).toMatchObject({ leaderId: leadId });
    clock.advance(RESTORED_LEADER_WAIT_MS);
    server.game.maintenance();
    expect(server.game.parties.partyOf(memberId)!.leaderId).toBe(leadId);
    expect(server.db.loadParties()[0].leaderId).toBe(leadId);
    expect(member.all('chat').some((m) => /now leads the party/.test(m.text))).toBe(false);
  });

  it('a restored leader who stays away hands the party over once the wait is over', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const leadId = createLocalCharacter(server, 'Away Ari');
    const memberId = createLocalCharacter(server, 'Here Hal');
    partyUp(new LocalPlayer(server, leadId), new LocalPlayer(server, memberId));
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    const member = new LocalPlayer(server, memberId);
    clock.advance(RESTORED_LEADER_WAIT_MS - 1000);
    server.game.maintenance();
    expect(server.game.parties.partyOf(memberId)!.leaderId).toBe(leadId);
    const from = member.mark();
    clock.advance(2000);
    server.game.maintenance();
    expect(server.game.parties.partyOf(memberId)!.leaderId).toBe(memberId);
    expect(member.all('party', from).at(-1)!.party!.leaderId).toBe(memberId);
    expect(member.all('chat', from).some((m) => m.fromName === '' && m.text === 'Here Hal now leads the party.')).toBe(true);
    expect(server.db.loadParties()[0].leaderId).toBe(memberId);
  });

  it('after a crash (no shutdown), a party that has played for over a day survives, and the player lands back in the map', async () => {
    const dbPath = freshDb();
    const first = await boot(dbPath);
    const adaId = createLocalCharacter(first.server, 'Crash Ada');
    const benId = createLocalCharacter(first.server, 'Crash Ben');
    const ada = new LocalPlayer(first.server, adaId);
    const ben = new LocalPlayer(first.server, benId);
    partyUp(ada, ben);
    openMap(ada);
    walkIntoProp(ada, 'portal', first.clock, [ben]);
    const key = (ada.session.instance as MapInstance).mapKey;
    // The party row was last written when the party was founded. They play on for 25 hours; then the
    // process dies (no shutdown, nothing written) and a new one starts on the same database.
    const { server, clock } = await boot(dbPath, { start: first.clock.now() + 25 * 60 * 60_000 });
    expect(server.game.parties.partyOf(adaId)?.members).toHaveLength(2);
    server.game.maintenance();
    clock.advance(5 * 60_000);
    server.game.maintenance();
    expect(server.game.parties.partyOf(adaId)?.members.sort()).toEqual([adaId, benId].sort());
    expect(server.db.loadParties()).toHaveLength(1);

    const back = new LocalPlayer(server, adaId);
    expect(back.zone).toMatchObject({ kind: 'map', ownerCharacterId: adaId, portal: { remaining: PORTALS_PER_MAP - 1 } });
    expect((back.session.instance as MapInstance).mapKey).toBe(key);
    expect(back.all('toast').some((t) => t.text === RESTORED_MAP_TOAST)).toBe(true);
    expect(back.last('party')!.party!).toMatchObject({ leaderId: adaId });
    expect(back.last('party')!.party!.members.map((m) => m.characterId).sort()).toEqual([adaId, benId].sort());
  }, 60_000);

  it('a socket that drops during the drain keeps its place: after the restart the player is back in the map', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath, { drainSeconds: 20 });
    const id = createLocalCharacter(server, 'Reload Rhea');
    const rhea = new LocalPlayer(server, id);
    openMap(rhea);
    walkIntoProp(rhea, 'portal', clock);
    const key = (rhea.session.instance as MapInstance).mapKey;
    const closing = server.close();
    // She reloads the page during the announcement: the socket drops, and reconnects are refused until the
    // restart. Her reconnect grace running out meanwhile must not take her out of the map.
    server.game.detach(rhea.conn);
    clock.advance(60_000);
    server.game.maintenance();
    expect(server.game.sessions.has(id)).toBe(true);
    expect(server.db.characterMap(id)).toMatchObject({ mapId: key });
    server.skipDrain();
    await closing;
    running.splice(running.indexOf(server), 1);

    ({ server, clock } = await boot(dbPath));
    const back = new LocalPlayer(server, id);
    expect(back.zone).toMatchObject({ kind: 'map', portal: { remaining: PORTALS_PER_MAP - 1 } });
    expect((back.session.instance as MapInstance).mapKey).toBe(key);
  }, 60_000);

  it('opening a map saves the consumed map and the open run together: a failed write keeps neither', async () => {
    const dbPath = freshDb();
    const { server, clock } = await boot(dbPath);
    const id = createLocalCharacter(server, 'Atomic Abe');
    const abe = new LocalPlayer(server, id);
    const mapUid = abe.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect(abe.command({ c: 'moveItem', uid: mapUid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    server.game.store.flush(abe.session.record);
    expect(savedCharacter(server, id).mapDevice?.uid).toBe(mapUid);

    // The character write fails as the map opens: the run's row is rolled back with it. A crash now would
    // find the map item still in the device and no run — the map exists exactly once.
    const db = server.db;
    const saveCharacter = db.saveCharacter;
    db.saveCharacter = () => {
      throw new Error('disk I/O error');
    };
    try {
      expect(abe.command({ c: 'activateMapDevice' }).ok).toBe(true);
    } finally {
      db.saveCharacter = saveCharacter;
    }
    expect(db.loadOpenMaps()).toHaveLength(0);
    expect(savedCharacter(server, id).mapDevice?.uid).toBe(mapUid);

    // The run's next write takes the consumed map along.
    walkIntoProp(abe, 'portal', clock);
    expect(db.loadOpenMaps()).toHaveLength(1);
    expect(JSON.parse(db.loadOpenMaps()[0].setup).map.uid).toBe(mapUid);
    expect(savedCharacter(server, id).mapDevice).toBeNull();
  });

  it('a map whose run cannot be written at shutdown is refunded, its row deleted in the same write', async () => {
    const dbPath = freshDb();
    let { server } = await boot(dbPath);
    const id = createLocalCharacter(server, 'Refund Rolf');
    const rolf = new LocalPlayer(server, id);
    openMap(rolf);
    const mapUid = (server.game.instances.activeMapOf(id)!.setup.map).uid;
    expect(server.db.loadOpenMaps()).toHaveLength(1);
    server.db.saveOpenMap = () => {
      throw new Error('disk I/O error');
    };
    await stop(server);

    const second = await boot(dbPath);
    server = second.server;
    expect(server.db.loadOpenMaps()).toHaveLength(0);
    expect(server.game.instances.activeMapOf(id)).toBeNull();
    expect(savedCharacter(server, id).mapDevice?.uid).toBe(mapUid);
  });

  it('when neither the run nor the refund can be saved at shutdown, the map comes back from its last row — never twice', async () => {
    const dbPath = freshDb();
    let { server, clock } = await boot(dbPath);
    const id = createLocalCharacter(server, 'Twice Tove');
    const tove = new LocalPlayer(server, id);
    openMap(tove);
    walkIntoProp(tove, 'portal', clock);
    const mapUid = (server.game.instances.activeMapOf(id)!.setup.map).uid;
    // The database fails while stopping: the run can't be kept, and giving the map back can't be saved.
    server.db.saveOpenMap = () => {
      throw new Error('disk I/O error');
    };
    server.db.saveCharacter = () => {
      throw new Error('disk I/O error');
    };
    await stop(server);

    ({ server, clock } = await boot(dbPath));
    const restored = server.game.instances.activeMapOf(id)!;
    expect(restored).toBeTruthy();
    expect(restored.setup.map.uid).toBe(mapUid);
    expect(restored.portalsRemaining).toBe(PORTALS_PER_MAP - 1);
    expect(uidsOf(savedCharacter(server, id))).not.toContain(mapUid);
    const back = new LocalPlayer(server, id);
    expect(back.session.instance).toBe(restored);
  });

  it('over real sockets: 4004 on shutdown, then the reconnect lands straight in the restored map', async () => {
    const dbPath = freshDb();
    let server = await startTestServer({ dbPath });
    running.push(server);
    const p = await newPlayer(server.base, 'Socket Sia');
    let c = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
    await c.waitFor('zone');
    const mapUid = c.last('character')!.character.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect((await c.command({ c: 'moveItem', uid: mapUid, to: { kind: 'mapDevice' } })).ok).toBe(true);
    expect((await c.command({ c: 'activateMapDevice' })).ok).toBe(true);
    const inside = await c.walkInto('portal');
    expect(inside.kind).toBe('map');
    const closed = c.waitClose();
    await stop(server);
    expect((await closed).code).toBe(4004);

    server = await startTestServer({ dbPath });
    running.push(server);
    c = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
    const zone = (await c.waitFor('zone')).zone;
    expect(zone).toMatchObject({ kind: 'map', ownerCharacterId: p.characterId, portal: { remaining: PORTALS_PER_MAP - 1 } });
    await c.waitFor('toast', (m) => m.text === RESTORED_MAP_TOAST);
    await c.until(() => c.me(), 3000, 'a snapshot of the restored map');
    expect(c.worldErrors).toEqual([]);
    c.close();
  }, 30_000);

  it('a drain announces the update, keeps the world running, refuses new logins, then closes every socket with 4004', async () => {
    const dbPath = freshDb();
    const { server, clock } = await boot(dbPath, { drainSeconds: 20 });
    const p = new LocalPlayer(server, createLocalCharacter(server, 'Drain Dora'));
    const lateId = createLocalCharacter(server, 'Late Leo');
    const from = p.mark();
    const closing = server.close();
    const line = p.all('chat', from).find((m) => m.fromName === '');
    expect(line?.text).toBe('Server update in 20 seconds — your party and open maps are kept.');
    expect(p.all('toast', from).some((t) => t.text === line!.text)).toBe(true);
    // Still running: ticks, snapshots and commands go on.
    const snaps = p.conn.snapshotCount;
    for (let k = 0; k < 4; k++) {
      p.input();
      tick(server, clock);
    }
    expect(p.conn.snapshotCount).toBeGreaterThan(snaps);
    expect(p.command({ c: 'clearNewFlags' }).ok).toBe(true);
    expect(p.conn.closedWith).toBeNull();
    // A new login during the drain is told to come back (4004 → the client reconnects after the restart).
    expect(() => new LocalPlayer(server, lateId)).toThrow(/attach failed/);
    server.skipDrain();
    await closing;
    running.splice(running.indexOf(server), 1);
    expect(p.conn.closedWith?.code).toBe(4004);
  });
});
