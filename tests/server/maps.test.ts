// Map device → portals → map instance, parties and hideout visits, over real sockets and real time.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { MAX_PARTY_SIZE, PORTALS_PER_MAP } from '../../src/contracts/net';
import { newPlayer, startTestServer } from './helpers';
import { TestClient } from './ws-client';

type Server = Awaited<ReturnType<typeof startTestServer>>;

function firstMapUid(ch: CharacterSave): string {
  const e = ch.backpack.entries.find((en) => en.item.kind === 'map');
  if (!e) throw new Error('no map in the starting kit');
  return e.item.uid;
}

describe('maps, portals and parties (real sockets)', () => {
  let server: Server;
  const clients: TestClient[] = [];

  async function join(name?: string) {
    const p = await newPlayer(server.base, name);
    const c = await TestClient.connect(server.base, { token: p.token, character: p.characterId });
    clients.push(c);
    await c.waitFor('zone');
    await c.until(() => c.me(), 3000, 'first snapshot');
    const ch = c.last('character')!.character;
    return { ...p, c, ch };
  }

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('opens a map from the device (8 portals), walks in (7 left), and a party member follows (6 left)', async () => {
    const a = await join('Aurelia');
    const b = await join('Brannoc');

    // Load a starting-kit map into the device and activate it.
    const mapUid = firstMapUid(a.ch);
    const moved = await a.c.command({ c: 'moveItem', uid: mapUid, to: { kind: 'mapDevice' } });
    expect(moved).toMatchObject({ ok: true });
    await a.c.until(() => a.c.last('character')?.character.mapDevice?.uid === mapUid, 3000, 'map in device');
    let from = a.c.mark();
    const activated = await a.c.command({ c: 'activateMapDevice' });
    expect(activated.ok).toBe(true);
    const portal = await a.c.waitFor('portal', (m) => m.portal !== null, from);
    expect(portal.portal).toMatchObject({ ownerCharacterId: a.characterId, remaining: PORTALS_PER_MAP, total: PORTALS_PER_MAP, cleared: false, tier: 1 });
    await a.c.until(() => a.c.last('character')?.character.mapDevice === null, 3000, 'map consumed');
    // The portal prop shows up in the hideout snapshots with its remaining count.
    await a.c.until(() => a.c.props().find((p) => p.kind === 'portal' && p.state === PORTALS_PER_MAP), 3000, 'portal prop');

    // Walk into it: map zone, one portal spent.
    const mapZone = await a.c.walkInto('portal');
    expect(mapZone.kind).toBe('map');
    expect(mapZone.ownerCharacterId).toBe(a.characterId);
    expect(mapZone.setup).not.toBeNull();
    expect(mapZone.setup!.seed).toBe(0); // redacted
    expect(mapZone.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 1 });
    expect(mapZone.theme).not.toBe('hideout');
    await a.c.until(() => a.c.me(), 3000, 'map snapshot');

    // Party up: invite by name (case-insensitive), accept.
    from = b.c.mark();
    expect((await a.c.command({ c: 'partyInvite', name: 'brannoc' })).ok).toBe(true);
    const invite = await b.c.waitFor('invite', () => true, from);
    expect(invite.invite).toMatchObject({ fromCharacterId: a.characterId, fromName: 'Aurelia' });
    expect((await b.c.command({ c: 'partyRespond', inviteId: invite.invite.inviteId, accept: true })).ok).toBe(true);
    const party = await b.c.waitFor('party', (m) => (m.party?.members.length ?? 0) === 2, from);
    const infoA = party.party!.members.find((m) => m.characterId === a.characterId)!;
    expect(infoA).toMatchObject({ isLeader: true, online: true, zone: { kind: 'map', ownerName: 'Aurelia', tier: 1 } });
    expect(infoA.activeMap).toMatchObject({ remaining: PORTALS_PER_MAP - 1 });

    // B visits A's hideout, sees the portal (7 left) and walks in: 6 left, same instance as A.
    from = b.c.mark();
    expect((await b.c.command({ c: 'visitHideout', characterId: a.characterId })).ok).toBe(true);
    const hz = (await b.c.waitFor('zone', () => true, from)).zone;
    expect(hz).toMatchObject({ kind: 'hideout', ownerCharacterId: a.characterId, ownerName: 'Aurelia' });
    expect(hz.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 1 });
    await b.c.until(() => b.c.props().find((p) => p.kind === 'portal' && p.state === PORTALS_PER_MAP - 1), 3000, 'portal prop in visited hideout');
    const fromA = a.c.mark();
    const bMap = await b.c.walkInto('portal');
    expect(bMap.instanceId).toBe(mapZone.instanceId);
    expect(bMap.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 2 });
    const aPortal = await a.c.waitFor('portal', (m) => m.portal?.remaining === PORTALS_PER_MAP - 2, fromA);
    expect(aPortal.portal!.ownerCharacterId).toBe(a.characterId);
    // Both players are in A's snapshots.
    await a.c.until(() => (a.c.snapshot?.playerCount ?? 0) === 2, 3000, 'two players in the map');

    // Leaving: B returns to A's hideout — next to the portals — with a run summary; the map stays open for A.
    from = b.c.mark();
    expect((await b.c.command({ c: 'leaveMap' })).ok).toBe(true);
    const home = (await b.c.waitFor('zone', () => true, from)).zone;
    expect(home).toMatchObject({ kind: 'hideout', ownerCharacterId: a.characterId });
    expect(home.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 2 });
    const summary = await b.c.waitFor('runSummary', () => true, from);
    expect(summary.summary).toMatchObject({ result: 'abandoned', tier: 1 });
    expect((await b.c.command({ c: 'leaveMap' })).error).toMatch(/not in a map/);
    // Zone changes and a busy map never tripped the real ClientWorld.
    expect(a.c.worldErrors).toEqual([]);
    expect(b.c.worldErrors).toEqual([]);
  }, 30_000);

  it(`caps parties at ${MAX_PARTY_SIZE}: a fifth invite is refused`, async () => {
    const lead = await join('Leader Five');
    const members = [await join('Member One'), await join('Member Two'), await join('Member Three')];
    for (const m of members) {
      const from = m.c.mark();
      expect((await lead.c.command({ c: 'partyInvite', name: m.name })).ok).toBe(true);
      const inv = await m.c.waitFor('invite', () => true, from);
      expect((await m.c.command({ c: 'partyRespond', inviteId: inv.invite.inviteId, accept: true })).ok).toBe(true);
    }
    await lead.c.until(() => lead.c.last('party')?.party?.members.length === MAX_PARTY_SIZE, 3000, 'full party');
    const fifth = await join('Member Four');
    const r = await lead.c.command({ c: 'partyInvite', name: fifth.name });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/party is full/);
    // Non-leaders cannot invite either.
    expect((await members[0].c.command({ c: 'partyInvite', name: fifth.name })).error).toMatch(/Only the party leader/);
    // A kicked member is told and gets no more party updates; the rest see three members.
    const from = members[2].c.mark();
    expect((await lead.c.command({ c: 'partyKick', characterId: members[2].characterId })).ok).toBe(true);
    await members[2].c.waitFor('party', (m) => m.party === null, from);
    await lead.c.until(() => lead.c.last('party')?.party?.members.length === 3, 3000, 'three members');
    // Promotion hands leadership over.
    expect((await lead.c.command({ c: 'partyPromote', characterId: members[0].characterId })).ok).toBe(true);
    await lead.c.until(() => lead.c.last('party')?.party?.leaderId === members[0].characterId, 3000, 'new leader');
    expect((await lead.c.command({ c: 'partyKick', characterId: members[1].characterId })).error).toMatch(/Only the party leader/);
  }, 30_000);
});
