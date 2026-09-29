// Command authority: forged or out-of-place commands are refused with a player-facing error and change
// nothing; legitimate ones go through the shared rules (in-process: fake connections on a fake clock).
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { LocalPlayer, createClock, createLocalCharacter, startTestServer, tick, walkIntoProp } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function setup(names: string[]) {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

function itemUid(ch: CharacterSave, pred: (kind: string, id: string) => boolean): string {
  for (const e of ch.backpack.entries) {
    const it = e.item;
    const id = it.kind === 'currency' ? it.currencyId : it.kind === 'map' ? it.baseId : it.kind === 'flask' ? it.flaskId : it.baseId;
    if (pred(it.kind, id)) return it.uid;
  }
  throw new Error('item not found');
}

function party(a: LocalPlayer, b: LocalPlayer): void {
  expect(a.command({ c: 'partyInvite', name: b.session.name }).ok).toBe(true);
  const inv = b.last('invite')!.invite;
  expect(b.command({ c: 'partyRespond', inviteId: inv.inviteId, accept: true }).ok).toBe(true);
}

describe('command authority', () => {
  it("cannot touch another player's items; every command acts on the sender's own character", async () => {
    const { players } = await setup(['Owner Ann', 'Thief Tom']);
    const [ann, tom] = players;
    // Ann buys a free Tier 1 map: it gets a uid Tom's character has never minted.
    const offers = ann.command({ c: 'merchantOffers' });
    expect(offers.ok).toBe(true);
    const t1 = offers.offers!.find((o) => o.id.startsWith('map-t1-'))!;
    const bought = ann.command({ c: 'buyOffer', offerId: t1.id });
    expect(bought).toMatchObject({ ok: true });
    const annCh = ann.session.record.ch;
    const newUid = annCh.backpack.entries.map((e) => e.item.uid).find((uid) => !tom.session.record.ch.backpack.entries.some((e) => e.item.uid === uid))!;
    expect(newUid).toBeTruthy();
    const tomBefore = tom.session.record.ch;
    for (const cmd of [
      { c: 'moveItem', uid: newUid, to: { kind: 'backpack', x: 11, y: 4 } },
      { c: 'discardItem', uid: newUid },
      { c: 'quickMove', uid: newUid, stashTab: null },
      { c: 'applyCurrency', currencyUid: newUid, targetUid: newUid },
    ] as const) {
      const r = tom.command(cmd);
      expect(r.ok, cmd.c).toBe(false);
      expect(r.error).toMatch(/no longer exists/);
    }
    expect(ann.session.record.ch).toBe(annCh);
    expect(tom.session.record.ch).toBe(tomBefore);
  });

  it('the map device only works in your own hideout; the merchant and crafting work in any hideout', async () => {
    const { clock, players } = await setup(['Host Hilda', 'Guest Gus']);
    const [host, guest] = players;
    party(host, guest);
    expect(guest.command({ c: 'visitHideout', characterId: host.characterId }).ok).toBe(true);
    expect(guest.session.instance!.ownerId).toBe(host.characterId);
    const guestMap = itemUid(guest.session.record.ch, (k) => k === 'map');
    expect(guest.command({ c: 'moveItem', uid: guestMap, to: { kind: 'mapDevice' } }).error).toMatch(/own hideout/);
    expect(guest.command({ c: 'activateMapDevice' }).error).toMatch(/own hideout/);
    // Rook trades with a visiting party member, who pays with their own currency.
    const offers = guest.command({ c: 'merchantOffers' });
    expect(offers.ok).toBe(true);
    expect(offers.offers!.length).toBeGreaterThan(0);
    const hostBefore = host.session.record.ch;
    const mapsBefore = guest.session.record.ch.backpack.entries.filter((e) => e.item.kind === 'map').length;
    const bought = guest.command({ c: 'buyOffer', offerId: 'map-t1-ashenForge' });
    expect(bought.ok).toBe(true);
    expect(guest.session.record.ch.backpack.entries.filter((e) => e.item.kind === 'map').length).toBe(mapsBefore + 1);
    expect(host.session.record.ch).toBe(hostBefore);
    // Crafting in a friend's hideout is fine: Kindling turns the normal robe magic.
    const kindling = itemUid(guest.session.record.ch, (k, id) => k === 'currency' && id === 'kindling');
    const robe = guest.session.record.ch.equipment.chest!;
    expect(robe.rarity).toBe('normal');
    const crafted = guest.command({ c: 'applyCurrency', currencyUid: kindling, targetUid: robe.uid });
    expect(crafted.ok).toBe(true);
    expect(crafted.message).toBeTruthy();
    expect(guest.session.record.ch.equipment.chest!.rarity).toBe('magic');
    // The guest's own push is redacted; the stored character keeps its rng.
    const pushed = guest.last('character')!.character;
    expect(pushed.rngState).toBe(0);
    expect(guest.session.record.ch.rngState).not.toBe(0);
    void clock;
  });

  it('no crafting, stash or map device inside a map; equipment and loadout changes still apply', async () => {
    const { clock, players } = await setup(['Delver Dee']);
    const [p] = players;
    const mapUid = itemUid(p.session.record.ch, (k) => k === 'map');
    expect(p.command({ c: 'moveItem', uid: mapUid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(p.command({ c: 'activateMapDevice' }).ok).toBe(true);
    walkIntoProp(p, 'portal', clock);
    expect(p.session.instance!.kind).toBe('map');
    const kindling = itemUid(p.session.record.ch, (k, id) => k === 'currency' && id === 'kindling');
    const robe = p.session.record.ch.equipment.chest!;
    expect(p.command({ c: 'applyCurrency', currencyUid: kindling, targetUid: robe.uid }).error).toMatch(/Crafting only works in a hideout/);
    expect(p.command({ c: 'moveItem', uid: kindling, to: { kind: 'stash', tab: 0, x: 0, y: 0 } }).error).toMatch(/stash/);
    expect(p.command({ c: 'quickMove', uid: kindling, stashTab: 0 }).error).toMatch(/stash/);
    expect(p.command({ c: 'addStashTab' }).error).toMatch(/stash/);
    const otherMap = itemUid(p.session.record.ch, (k) => k === 'map');
    expect(p.command({ c: 'moveItem', uid: otherMap, to: { kind: 'mapDevice' } }).error).toMatch(/own hideout/);
    expect(p.command({ c: 'activateMapDevice' }).ok).toBe(false);
    expect(p.command({ c: 'merchantOffers' }).ok).toBe(false);
    // Unequipping the robe in a map is allowed and reaches the sim (evasion drops).
    const before = p.me()!.maxLife;
    expect(p.command({ c: 'quickMove', uid: robe.uid, stashTab: null }).ok).toBe(true);
    expect(p.session.record.ch.equipment.chest).toBeUndefined();
    // The banked skill point can be spent anywhere, and the new skill can go on the bar.
    expect(p.command({ c: 'rankUpSkill', skillId: 'emberNova' }).ok).toBe(true);
    expect(p.command({ c: 'setLoadoutSlot', slot: 1, skillId: 'emberNova' }).ok).toBe(true);
    tick(p.server, clock, 2);
    expect(p.me()!.slots[1].skillId).toBe('emberNova');
    expect(p.me()!.maxLife).toBeLessThanOrEqual(before);
    expect(p.command({ c: 'rankUpSkill', skillId: 'emberNova' }).error).toBeTruthy(); // no points left
  });

  it('a new map cannot replace one with players inside; an empty one is closed and replaced', async () => {
    const { clock, players } = await setup(['Opener Ona', 'Runner Rex']);
    const [ona, rex] = players;
    party(ona, rex);
    const maps = ona.session.record.ch.backpack.entries.filter((e) => e.item.kind === 'map').map((e) => e.item.uid);
    expect(maps.length).toBeGreaterThanOrEqual(2);
    expect(ona.command({ c: 'moveItem', uid: maps[0], to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(ona.command({ c: 'activateMapDevice' }).ok).toBe(true);
    const first = ona.server.game.instances.activeMapOf(ona.characterId)!;
    expect(rex.command({ c: 'visitHideout', characterId: ona.characterId }).ok).toBe(true);
    walkIntoProp(rex, 'portal', clock, [ona]);
    expect(rex.session.instance).toBe(first);

    expect(ona.command({ c: 'moveItem', uid: maps[1], to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(ona.command({ c: 'activateMapDevice' }).error).toMatch(/still in use \(1 player inside\)/);
    expect(ona.session.record.ch.mapDevice?.uid).toBe(maps[1]); // not consumed

    expect(rex.command({ c: 'leaveMap' }).ok).toBe(true);
    const from = ona.mark();
    expect(ona.command({ c: 'activateMapDevice' }).ok).toBe(true);
    expect(first.disposed).toBe(true);
    const second = ona.server.game.instances.activeMapOf(ona.characterId)!;
    expect(second).not.toBe(first);
    expect(second.portalsRemaining).toBe(8);
    expect(ona.all('portal', from).at(-1)?.portal).toMatchObject({ remaining: 8 });
    // The replaced map was logged as abandoned for the one who entered it.
    expect(rex.session.record.ch.stats.mapsFailed).toBe(1);
  });

  it('refuses out-of-place travel, party and chat commands with clear errors', async () => {
    const { players } = await setup(['Solo Sam', 'Other Oda', 'Third Thea']);
    const [sam, oda, thea] = players;
    expect(sam.command({ c: 'visitHideout', characterId: oda.characterId }).error).toMatch(/party members/);
    expect(sam.command({ c: 'leaveMap' }).error).toMatch(/not in a map/);
    expect(sam.command({ c: 'respawn' }).ok).toBe(false);
    expect(sam.command({ c: 'visitHideout', characterId: sam.characterId })).toMatchObject({ ok: true });
    expect(sam.command({ c: 'chat', text: 'hello?' }).error).toMatch(/party/);
    expect(sam.command({ c: 'partyInvite', name: 'Solo Sam' }).error).toMatch(/yourself/);
    expect(sam.command({ c: 'partyInvite', name: 'Nobody Here' }).error).toMatch(/no character named/);
    expect(sam.command({ c: 'partyRespond', inviteId: 'inv999', accept: true }).error).toMatch(/expired/);
    expect(sam.command({ c: 'partyLeave' }).error).toMatch(/not in a party/);
    expect(sam.command({ c: 'partyKick', characterId: oda.characterId }).error).toMatch(/not in a party/);

    // Invites to someone already in another party are refused; chat reaches the whole party.
    party(sam, oda);
    expect(thea.command({ c: 'partyInvite', name: 'other oda' }).error).toMatch(/already in a party/);
    const from = oda.mark();
    expect(sam.command({ c: 'chat', text: '  ready when you are  ' }).ok).toBe(true);
    const line = oda.all('chat', from).find((m) => m.fromName === 'Solo Sam');
    expect(line?.text).toBe('ready when you are');
    expect(sam.command({ c: 'chat', text: 'x'.repeat(201) }).error).toMatch(/at most 200/);
    for (let k = 0; k < 6; k++) sam.command({ c: 'chat', text: `spam ${k}` });
    expect(sam.command({ c: 'chat', text: 'one more' }).error).toMatch(/too quickly/);

    // Leaving a party sends a visitor home from the former leader's hideout.
    expect(oda.command({ c: 'visitHideout', characterId: sam.characterId }).ok).toBe(true);
    expect(oda.session.instance!.ownerId).toBe(sam.characterId);
    expect(oda.command({ c: 'partyLeave' }).ok).toBe(true);
    expect(oda.session.instance!.ownerId).toBe(oda.characterId);
    expect(oda.last('party')!.party).toBeNull();
    expect(sam.last('party')!.party).toBeNull(); // a party of one dissolves
  });

  it('limits the command rate', async () => {
    const { players } = await setup(['Clicky']);
    const [p] = players;
    const results = Array.from({ length: 60 }, () => p.command({ c: 'clearNewFlags' }));
    const refused = results.filter((r) => !r.ok);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0].error).toMatch(/too quickly/);
  });
});

describe('abuse protection', () => {
  it('drops floods without closing, but closes a socket that keeps sending garbage (1008)', async () => {
    const { players } = await setup(['Flooder', 'Garbage']);
    const [flood, junk] = players;
    // 500 inputs in the same instant: the burst allowance is spent and the rest are dropped, not fatal.
    for (let k = 0; k < 500; k++) flood.input({ moveX: 1 });
    expect(flood.conn.closedWith).toBeNull();
    expect(flood.session.droppedMessages).toBeGreaterThan(0);
    for (let k = 0; k < 60; k++) junk.send(`{"t":"input","seq":${k},"moveX":9}`);
    expect(junk.conn.closedWith?.code).toBe(1008);
  });
});
