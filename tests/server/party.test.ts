// Party semantics beyond the happy path (in-process: fake connections on a fake clock): who is sent where
// when the party changes, stale invites, leadership that always stays with someone in play, and invite
// popups that cannot be spammed.
import { afterEach, describe, expect, it } from 'vitest';
import { PORTALS_PER_MAP } from '../../src/contracts/net';
import { DECLINE_COOLDOWN_MS } from '../../src/server/party';
import { MapInstance } from '../../src/server/instance';
import { LocalPlayer, createClock, createLocalCharacter, enterMapOf, openMap, partyUp, startTestServer, walkIntoProp } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function setup(names: string[], opts: { reconnectGraceMs?: number } = {}) {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now, ...opts } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

describe('leaving and kicking', () => {
  it("the map owner leaving the party does not pull friends out of the map; only hideout visitors go home", async () => {
    const { server, clock, players } = await setup(['Owner Ada', 'Fighter Ben', 'Visitor Cid']);
    const [ada, ben, cid] = players;
    partyUp(ada, ben);
    partyUp(ada, cid);
    openMap(ada);
    enterMapOf(ben, ada, clock, [ada, cid]);
    const map = ben.session.instance;
    if (!(map instanceof MapInstance)) throw new Error('Ben is not in a map');
    expect(cid.command({ c: 'visitHideout', characterId: ada.characterId }).ok).toBe(true);
    expect(cid.session.instance!.ownerId).toBe(ada.characterId);

    const benFrom = ben.mark();
    const cidFrom = cid.mark();
    expect(ada.command({ c: 'partyLeave' }).ok).toBe(true);
    // Ben keeps fighting in Ada's map: no zone change, no summary.
    expect(ben.session.instance).toBe(map);
    expect(ben.all('zone', benFrom)).toHaveLength(0);
    expect(ben.all('runSummary', benFrom)).toHaveLength(0);
    // Cid was only visiting Ada's hideout: he is sent to his own.
    expect(cid.session.instance!.ownerId).toBe(cid.characterId);
    expect(cid.all('toast', cidFrom).some((t) => /no longer in Owner Ada's party/.test(t.text))).toBe(true);
    // Ben and Cid are still a party, now led by Ben.
    const party = server.game.parties.partyOf(ben.characterId)!;
    expect(party.members.sort()).toEqual([ben.characterId, cid.characterId].sort());
    expect(party.leaderId).toBe(ben.characterId);
    // Cid can no longer reach Ada's hideout (and so her portal).
    expect(cid.command({ c: 'visitHideout', characterId: ada.characterId }).error).toMatch(/party members/);

    // Ada opens a new map: former members left behind in the old one don't block her; Ben is sent home.
    const second = ada.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect(ada.command({ c: 'moveItem', uid: second, to: { kind: 'mapDevice' } }).ok).toBe(true);
    const from = ben.mark();
    expect(ada.command({ c: 'activateMapDevice' }).ok).toBe(true);
    expect(map.disposed).toBe(true);
    expect(ben.session.instance!.ownerId).toBe(ben.characterId);
    expect(ben.all('toast', from).some((t) => /Owner Ada closed/.test(t.text))).toBe(true);
    expect(ben.all('runSummary', from)[0]?.summary.result).toBe('abandoned');
  }, 30_000);

  it('a party member who leaves while in the leader\'s map goes home; the rest stay', async () => {
    const { clock, players } = await setup(['Lead Lia', 'Quitter Quinn', 'Stayer Sol']);
    const [lia, quinn, sol] = players;
    partyUp(lia, quinn);
    partyUp(lia, sol);
    openMap(lia);
    walkIntoProp(lia, 'portal', clock, [quinn, sol]);
    enterMapOf(quinn, lia, clock, [lia, sol]);
    enterMapOf(sol, lia, clock, [lia, quinn]);
    const map = lia.session.instance!;
    const from = quinn.mark();
    expect(quinn.command({ c: 'partyLeave' }).ok).toBe(true);
    expect(quinn.session.instance!.ownerId).toBe(quinn.characterId);
    expect(quinn.all('runSummary', from)).toHaveLength(1);
    expect(sol.session.instance).toBe(map);
    expect(lia.session.instance).toBe(map);
  }, 30_000);

  it("a kick is a clean cut: the kicked player leaves the leader's map", async () => {
    const { clock, players } = await setup(['Kicker Kay', 'Kicked Mo']);
    const [kay, mo] = players;
    partyUp(kay, mo);
    openMap(kay);
    walkIntoProp(kay, 'portal', clock, [mo]);
    enterMapOf(mo, kay, clock, [kay]);
    const map = kay.session.instance!;
    expect(mo.session.instance).toBe(map);
    const from = mo.mark();
    expect(kay.command({ c: 'partyKick', characterId: mo.characterId }).ok).toBe(true);
    expect(mo.session.instance!.ownerId).toBe(mo.characterId);
    expect(mo.all('runSummary', from)[0]?.summary.result).toBe('abandoned');
    expect(mo.all('toast', from).some((t) => /removed from the party/.test(t.text))).toBe(true);
    expect(kay.session.instance).toBe(map);
    // Kay's map is still hers alone, with the portals Mo spent gone.
    expect((map as MapInstance).portalsRemaining).toBe(PORTALS_PER_MAP - 2);
  }, 30_000);

  it('leaving a party where nobody else is in play dissolves it', async () => {
    const { server, clock, players } = await setup(['Last One', 'Gone Guy'], { reconnectGraceMs: 1000 });
    const [last, gone] = players;
    partyUp(last, gone);
    server.game.detach(gone.conn);
    clock.advance(2000);
    server.game.maintenance();
    expect(server.game.sessions.has(gone.characterId)).toBe(false);
    expect(server.game.parties.partyOf(last.characterId)?.members).toHaveLength(2);
    expect(last.command({ c: 'partyLeave' }).ok).toBe(true);
    expect(server.game.parties.partyCount).toBe(0);
    // Gone Guy comes back to no party.
    const again = new LocalPlayer(server, gone.characterId);
    expect(again.all('party')).toHaveLength(0);
  });
});

describe('invites and leadership', () => {
  it('an invite dies when its sender joins another party or stops leading', async () => {
    const { server, players } = await setup(['Ann Solo', 'Bea Lead', 'Cal Late', 'Dee Late']);
    const [ann, bea, cal, dee] = players;
    // Ann (solo) invites Cal; then Ann joins Bea's party as a plain member.
    expect(ann.command({ c: 'partyInvite', name: cal.session.name }).ok).toBe(true);
    const stale = cal.last('invite')!.invite;
    partyUp(bea, ann);
    const r = cal.command({ c: 'partyRespond', inviteId: stale.inviteId, accept: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired or was withdrawn/);
    expect(server.game.parties.partyOf(cal.characterId)).toBeNull();
    expect(server.game.parties.partyOf(bea.characterId)!.members).toHaveLength(2);

    // Bea invites Dee, then hands leadership to Ann: Bea's invite no longer speaks for the party.
    expect(bea.command({ c: 'partyInvite', name: dee.session.name }).ok).toBe(true);
    const beaInvite = dee.last('invite')!.invite;
    expect(bea.command({ c: 'partyPromote', characterId: ann.characterId }).ok).toBe(true);
    expect(dee.command({ c: 'partyRespond', inviteId: beaInvite.inviteId, accept: true }).ok).toBe(false);
    expect(server.game.parties.partyOf(dee.characterId)).toBeNull();
    // Ann, the new leader, can invite Dee.
    partyUp(ann, dee);
    expect(server.game.parties.partyOf(dee.characterId)!.leaderId).toBe(ann.characterId);
  });

  it('leadership cannot go to an offline member, and a party is never left led by someone offline', async () => {
    const { server, clock, players } = await setup(['Boss Bo', 'Away Al', 'Here Hal'], { reconnectGraceMs: 1000 });
    const [bo, al, hal] = players;
    partyUp(bo, al);
    partyUp(bo, hal);
    server.game.detach(al.conn);
    clock.advance(2000);
    server.game.maintenance();
    expect(server.game.sessions.has(al.characterId)).toBe(false);
    const refused = bo.command({ c: 'partyPromote', characterId: al.characterId });
    expect(refused.error).toBe('Away Al is offline.');
    expect(server.game.parties.partyOf(bo.characterId)!.leaderId).toBe(bo.characterId);

    // Should a party ever end up led by someone not in play, the next broadcast repairs it.
    const party = server.game.parties.partyOf(bo.characterId)!;
    party.leaderId = al.characterId;
    const from = hal.mark();
    server.game.markParty(bo.characterId);
    server.game.flushParties();
    expect(party.leaderId).toBe(bo.characterId);
    expect(hal.all('party', from).at(-1)?.party?.leaderId).toBe(bo.characterId);
    expect(hal.all('chat', from).some((m) => m.fromName === '' && /Boss Bo now leads/.test(m.text))).toBe(true);
  });

  it('a repeated invite does not pop up again, and a declined inviter must wait before asking again', async () => {
    const { clock, players } = await setup(['Asker Ash', 'Target Tia']);
    const [ash, tia] = players;
    expect(ash.command({ c: 'partyInvite', name: 'Target Tia' }).ok).toBe(true);
    expect(tia.all('invite')).toHaveLength(1);
    const again = ash.command({ c: 'partyInvite', name: 'target tia' });
    expect(again).toMatchObject({ ok: true, message: expect.stringMatching(/still pending/) });
    expect(tia.all('invite')).toHaveLength(1);

    const inviteId = tia.last('invite')!.invite.inviteId;
    const from = ash.mark();
    expect(tia.command({ c: 'partyRespond', inviteId, accept: false }).ok).toBe(true);
    expect(ash.all('toast', from).some((t) => /declined/.test(t.text))).toBe(true);
    expect(ash.command({ c: 'partyInvite', name: 'Target Tia' }).error).toMatch(/declined your invite/);
    expect(tia.all('invite')).toHaveLength(1);
    clock.advance(DECLINE_COOLDOWN_MS + 1);
    expect(ash.command({ c: 'partyInvite', name: 'Target Tia' }).ok).toBe(true);
    expect(tia.all('invite')).toHaveLength(2);
  });
});
