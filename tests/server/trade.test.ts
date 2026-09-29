// Trading (in-process: fake connections on a fake clock): requests by name, the offer window with its
// accept lock, the atomic swap (saved at once, in one transaction), refusals that move nothing, locked items,
// cancels and disconnects — and that no sequence of commands can create or destroy an item.
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS } from '../../src/contracts/net';
import type { ServerMessage, TradeInfo } from '../../src/contracts/net';
import { rules } from '../../src/game';
import { ITEM_IN_TRADE, TRADE_COMPLETED, TRADE_DECLINE_COOLDOWN_MS, TRADE_REQUEST_TTL_MS } from '../../src/server/trade';
import {
  LocalPlayer, captureLogger, createClock, createLocalCharacter, fillBackpack, holdings, openMap, savedCharacter, startTestServer,
  tick, uidsOf, walkIntoProp,
} from './helpers';
import type { Clock } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;
type TradeMsg = Extract<ServerMessage, { t: 'trade' }>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function setup(names: string[]) {
  const clock = createClock();
  const logger = captureLogger();
  server = await startTestServer({ logger, game: { autoTick: false, now: clock.now } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players, logger };
}

function lastTrade(p: LocalPlayer, from = 0): TradeMsg | null {
  return p.all('trade', from).at(-1) ?? null;
}

function info(p: LocalPlayer): TradeInfo {
  const t = lastTrade(p)?.trade;
  if (!t) throw new Error(`${p.session.name} has no open trade`);
  return t;
}

/** `a` asks `b` (by name), `b` accepts; returns the trade id. */
function openTrade(a: LocalPlayer, b: LocalPlayer): string {
  const from = b.mark();
  expect(a.command({ c: 'tradeRequest', name: b.session.name }).ok).toBe(true);
  const req = b.all('tradeRequest', from).at(-1);
  if (!req) throw new Error('no trade request arrived');
  expect(b.command({ c: 'tradeRespond', requestId: req.request.requestId, accept: true }).ok).toBe(true);
  return info(a).tradeId;
}

function uidOf(ch: CharacterSave, pred: (kind: string, id: string) => boolean): string {
  for (const e of ch.backpack.entries) {
    const it = e.item;
    const id = it.kind === 'currency' ? it.currencyId : it.kind === 'flask' ? it.flaskId : it.baseId;
    if (pred(it.kind, id)) return it.uid;
  }
  throw new Error('item not found');
}

/** Both sides accept, after waiting out the accept lock. Returns the second accept's result. */
function bothAccept(a: LocalPlayer, b: LocalPlayer, clock: Clock, tradeId: string) {
  clock.advance(TRADE_ACCEPT_LOCK_MS);
  expect(a.command({ c: 'tradeAccept', tradeId, accept: true }).ok).toBe(true);
  return b.command({ c: 'tradeAccept', tradeId, accept: true });
}

describe('trading', () => {
  it('request → accept → offers (with the accept lock) → both accept → one atomic swap, saved at once', async () => {
    const { server, clock, players } = await setup(['Ann Trader', 'Ben Trader']);
    const [ann, ben] = players;
    const before = holdings(ann.session.record.ch, ben.session.record.ch);

    // A request by name (any case) pops up for Ben; Ann is told it went out. Asking again only renews it.
    let from = ben.mark();
    const annFrom = ann.mark();
    expect(ann.command({ c: 'tradeRequest', name: 'ben TRADER' })).toMatchObject({ ok: true });
    expect(ann.command({ c: 'tradeRequest', name: 'Ben Trader' })).toMatchObject({ ok: true });
    const requests = ben.all('tradeRequest', from);
    expect(requests).toHaveLength(1);
    expect(requests[0].request).toMatchObject({ fromCharacterId: ann.characterId, fromName: 'Ann Trader' });
    const toasts = ann.all('toast', annFrom).map((t) => t.text);
    expect(toasts).toEqual(['Trade request sent to Ben Trader.', 'Your trade request to Ben Trader is still pending.']);

    // Ben accepts: both see the (empty) trade window.
    from = ann.mark();
    expect(ben.command({ c: 'tradeRespond', requestId: requests[0].request.requestId, accept: true }).ok).toBe(true);
    const tradeId = info(ann).tradeId;
    expect(info(ann)).toMatchObject({ partnerCharacterId: ben.characterId, partnerName: 'Ben Trader', yourItems: [], theirItems: [], youAccepted: false, theyAccepted: false });
    expect(info(ben)).toMatchObject({ tradeId, partnerName: 'Ann Trader' });

    // Nothing to trade yet: accepting is refused.
    expect(ann.command({ c: 'tradeAccept', tradeId, accept: true }).error).toMatch(/Put an item/);

    // Ann offers a map and her Scrap: Ben sees full copies; the accept lock starts.
    const annMap = uidOf(ann.session.record.ch, (k) => k === 'map');
    const annScrap = uidOf(ann.session.record.ch, (k, id) => k === 'currency' && id === 'scrap');
    expect(ann.command({ c: 'tradeOffer', tradeId, uids: [annMap, annScrap] }).ok).toBe(true);
    expect(info(ben).theirItems.map((i) => i.uid)).toEqual([annMap, annScrap]);
    expect(info(ben).theirItems[1]).toMatchObject({ kind: 'currency', currencyId: 'scrap', count: 10 });
    expect(info(ann).yourItems).toHaveLength(2);
    expect(info(ben).acceptLockedUntil).toBe(clock.now() + TRADE_ACCEPT_LOCK_MS);
    expect(ann.command({ c: 'tradeAccept', tradeId, accept: true }).error).toMatch(/offer just changed/);
    clock.advance(TRADE_ACCEPT_LOCK_MS);
    expect(ann.command({ c: 'tradeAccept', tradeId, accept: true }).ok).toBe(true);
    expect(info(ben)).toMatchObject({ theyAccepted: true, youAccepted: false });

    // Ben's offer changes: Ann's accept is cleared and the lock restarts.
    const benMap = uidOf(ben.session.record.ch, (k, id) => k === 'map' && id === 'rimedOssuary');
    expect(ben.command({ c: 'tradeOffer', tradeId, uids: [benMap] }).ok).toBe(true);
    expect(info(ann)).toMatchObject({ youAccepted: false, theyAccepted: false });
    expect(ben.command({ c: 'tradeAccept', tradeId, accept: true }).error).toMatch(/offer just changed/);

    // Both accept: everything moves in one step, both are saved right away, the window closes with a result.
    const annPush = ann.mark();
    const r = bothAccept(ann, ben, clock, tradeId);
    expect(r).toMatchObject({ ok: true });
    for (const p of players) {
      expect(lastTrade(p)).toMatchObject({ trade: null, result: TRADE_COMPLETED });
      expect(p.all('toast').some((t) => /^Trade with .* completed\.$/.test(t.text))).toBe(true);
    }
    expect(ann.all('character', annPush).length).toBeGreaterThan(0);
    const annCh = ann.session.record.ch;
    const benCh = ben.session.record.ch;
    expect(annCh.backpack.entries.filter((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap')).toHaveLength(0);
    expect(benCh.backpack.entries.filter((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap').reduce((n, e) => n + (e.item.kind === 'currency' ? e.item.count : 0), 0)).toBe(20);
    expect(annCh.backpack.entries.filter((e) => e.item.kind === 'map' && e.item.baseId === 'rimedOssuary')).toHaveLength(2);
    // Received items are new; the uids stay unique on each side (both characters minted the same ones).
    expect(annCh.backpack.entries.some((e) => e.item.isNew)).toBe(true);
    for (const ch of [annCh, benCh]) expect(new Set(uidsOf(ch)).size).toBe(uidsOf(ch).length);
    // Written to the database immediately — no debounce window in which a crash could undo one side.
    expect(holdings(savedCharacter(server, ann.characterId), savedCharacter(server, ben.characterId))).toEqual(before);
    expect(holdings(annCh, benCh)).toEqual(before);
    expect(server.game.trades.tradeIdOf(ann.characterId)).toBeNull();
    // Nothing is locked any more.
    expect(ann.command({ c: 'moveItem', uid: annCh.backpack.entries[0].item.uid, to: { kind: 'backpack', x: 11, y: 4 } }).ok).toBe(true);
  });

  it('items in an offer are locked: moves, discards, drops, crafting and the bench refuse them; payment skips them', async () => {
    const { players } = await setup(['Lock Lena', 'Lock Leo']);
    const [lena, leo] = players;
    // The robe comes off to the backpack first: only backpack items can be offered.
    const robe = lena.session.record.ch.equipment.chest!.uid;
    const tradeId = openTrade(lena, leo);
    expect(lena.command({ c: 'tradeOffer', tradeId, uids: [robe] }).error).toMatch(/backpack/);
    expect(lena.command({ c: 'quickMove', uid: robe, stashTab: null }).ok).toBe(true);
    const scrap = uidOf(lena.session.record.ch, (k, id) => k === 'currency' && id === 'scrap');
    const kindling = uidOf(lena.session.record.ch, (k, id) => k === 'currency' && id === 'kindling');
    expect(lena.command({ c: 'tradeOffer', tradeId, uids: [robe, scrap] }).ok).toBe(true);
    expect(lena.command({ c: 'tradeOffer', tradeId, uids: [robe, robe] }).ok).toBe(false);
    expect(lena.command({ c: 'tradeOffer', tradeId, uids: Array.from({ length: TRADE_MAX_ITEMS + 1 }, (_, k) => `x${k}`) }).ok).toBe(false);

    const locked = lena.session.record.ch;
    for (const cmd of [
      { c: 'moveItem', uid: robe, to: { kind: 'backpack', x: 10, y: 3 } },
      { c: 'moveItem', uid: robe, to: { kind: 'equipment', slot: 'chest' } },
      { c: 'quickMove', uid: robe, stashTab: 0 },
      { c: 'discardItem', uid: scrap },
      { c: 'dropItem', uid: robe },
      { c: 'applyCurrency', currencyUid: kindling, targetUid: robe },
      { c: 'applyCurrency', currencyUid: scrap, targetUid: lena.session.record.ch.equipment.mainHand!.uid },
      { c: 'benchCraft', targetUid: robe, recipeId: 'bench:focus' },
      { c: 'benchClear', targetUid: robe },
    ] as const) {
      const r = lena.command(cmd);
      expect(r.ok, cmd.c).toBe(false);
      expect(r.error, cmd.c).toBe(ITEM_IN_TRADE);
    }
    // Rook never takes payment from a locked stack: the only Scrap is in the offer, so a Scrap price fails.
    const offers = lena.command({ c: 'merchantOffers' }).offers!;
    const scrapPriced = offers.find((o) => o.price.some((p) => p.currencyId === 'scrap' && p.count > 0))!;
    expect(scrapPriced.affordable).toBe(false);
    expect(lena.command({ c: 'buyOffer', offerId: scrapPriced.id }).ok).toBe(false);
    expect(lena.session.record.ch).toBe(locked);
    // Items outside the offer still move freely.
    expect(lena.command({ c: 'moveItem', uid: kindling, to: { kind: 'backpack', x: 11, y: 4 } }).ok).toBe(true);
    // Cancelling unlocks.
    expect(lena.command({ c: 'tradeCancel', tradeId }).ok).toBe(true);
    expect(lena.command({ c: 'discardItem', uid: scrap }).ok).toBe(true);
  });

  it('a backpack without room refuses the swap: nothing moves, both are told, the trade stays open with accepts cleared', async () => {
    const { clock, players } = await setup(['Roomy Rae', 'Stuffed Sid']);
    const [rae, sid] = players;
    fillBackpack(sid);
    const before = holdings(rae.session.record.ch, sid.session.record.ch);
    const tradeId = openTrade(rae, sid);
    const map = uidOf(rae.session.record.ch, (k) => k === 'map');
    expect(rae.command({ c: 'tradeOffer', tradeId, uids: [map] }).ok).toBe(true);
    const raeFrom = rae.mark();
    const r = bothAccept(rae, sid, clock, tradeId);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Stuffed Sid's backpack has no room/);
    expect(rae.all('toast', raeFrom).some((t) => t.tone === 'bad' && /did not go through/.test(t.text))).toBe(true);
    expect(info(rae)).toMatchObject({ tradeId, youAccepted: false, theyAccepted: false });
    expect(holdings(rae.session.record.ch, sid.session.record.ch)).toEqual(before);

    // Sid gives something back in the same trade: his own offer frees the room it needs.
    const filler = sid.session.record.ch.backpack.entries.find((e) => e.item.uid.startsWith('fill'))!.item.uid;
    expect(sid.command({ c: 'tradeOffer', tradeId, uids: [filler] }).ok).toBe(true);
    expect(bothAccept(rae, sid, clock, tradeId)).toMatchObject({ ok: true });
    expect(holdings(rae.session.record.ch, sid.session.record.ch)).toEqual(before);
  });

  it('cancel, disconnect, decline and expiry close requests and trades cleanly; the refusals explain themselves', async () => {
    const { server, clock, players } = await setup(['Cora Cancel', 'Dean Decline', 'Eve Elsewhere']);
    const [cora, dean, eve] = players;
    const offline = createLocalCharacter(server, 'Otto Offline');
    void offline;
    expect(cora.command({ c: 'tradeRequest', name: 'Cora Cancel' }).error).toMatch(/yourself/);
    expect(cora.command({ c: 'tradeRequest', name: 'Nobody Known' }).error).toMatch(/no character named/);
    expect(cora.command({ c: 'tradeRequest', name: 'otto offline' }).error).toBe('Otto Offline is not online.');

    // Decline: Cora is told, and must wait before asking Dean again.
    let from = cora.mark();
    expect(cora.command({ c: 'tradeRequest', name: 'Dean Decline' }).ok).toBe(true);
    const req = dean.last('tradeRequest')!.request;
    expect(dean.command({ c: 'tradeRespond', requestId: req.requestId, accept: false }).ok).toBe(true);
    expect(cora.all('toast', from).some((t) => /declined your trade request/.test(t.text))).toBe(true);
    expect(dean.command({ c: 'tradeRespond', requestId: req.requestId, accept: true }).error).toMatch(/expired/);
    expect(cora.command({ c: 'tradeRequest', name: 'Dean Decline' }).error).toMatch(/Give them a moment/);
    clock.advance(TRADE_DECLINE_COOLDOWN_MS + 1);

    // Unanswered requests expire.
    expect(cora.command({ c: 'tradeRequest', name: 'Dean Decline' }).ok).toBe(true);
    const stale = dean.last('tradeRequest')!.request;
    clock.advance(TRADE_REQUEST_TTL_MS + 1);
    server.game.maintenance();
    expect(dean.command({ c: 'tradeRespond', requestId: stale.requestId, accept: true }).error).toMatch(/expired/);

    // Cancel: both windows close; the partner reads who cancelled.
    let tradeId = openTrade(cora, dean);
    expect(eve.command({ c: 'tradeRequest', name: 'Cora Cancel' }).error).toMatch(/already trading/);
    expect(cora.command({ c: 'tradeRequest', name: 'Eve Elsewhere' }).error).toMatch(/Finish your current trade/);
    expect(eve.command({ c: 'tradeCancel', tradeId }).error).toMatch(/no longer open/);
    expect(cora.command({ c: 'tradeCancel', tradeId }).ok).toBe(true);
    expect(lastTrade(cora)).toMatchObject({ trade: null, result: 'You cancelled the trade.' });
    expect(lastTrade(dean)).toMatchObject({ trade: null, result: 'Cora Cancel cancelled the trade.' });
    expect(dean.command({ c: 'tradeAccept', tradeId, accept: true }).error).toMatch(/no longer open/);

    // Asking each other at the same time simply opens the trade. "/trade <name>" in chat works too.
    from = dean.mark();
    expect(cora.command({ c: 'chat', text: '/trade dean decline' }).ok).toBe(true);
    expect(dean.all('tradeRequest', from)).toHaveLength(1);
    expect(dean.command({ c: 'tradeRequest', name: 'Cora Cancel' }).ok).toBe(true);
    tradeId = info(cora).tradeId;
    expect(info(dean).tradeId).toBe(tradeId);

    // A disconnect cancels at once (the character itself stays in play for its reconnect grace).
    const scrap = uidOf(dean.session.record.ch, (k, id) => k === 'currency' && id === 'scrap');
    expect(dean.command({ c: 'tradeOffer', tradeId, uids: [scrap] }).ok).toBe(true);
    server.game.detach(dean.conn);
    expect(lastTrade(cora)).toMatchObject({ trade: null, result: 'Dean Decline disconnected. The trade was cancelled.' });
    expect(server.game.trades.lockedUids(dean.characterId)).toBeNull();
    expect(server.game.sessions.has(dean.characterId)).toBe(true);
  });

  it('works across instances: one player in a map, the other in a hideout', async () => {
    const { clock, players } = await setup(['Map Mia', 'Home Hugo']);
    const [mia, hugo] = players;
    openMap(mia);
    walkIntoProp(mia, 'portal', clock);
    expect(mia.session.instance!.kind).toBe('map');
    const tradeId = openTrade(hugo, mia);
    const kindling = uidOf(hugo.session.record.ch, (k, id) => k === 'currency' && id === 'kindling');
    expect(hugo.command({ c: 'tradeOffer', tradeId, uids: [kindling] }).ok).toBe(true);
    expect(bothAccept(hugo, mia, clock, tradeId)).toMatchObject({ ok: true });
    const got = mia.session.record.ch.backpack.entries.filter((e) => e.item.kind === 'currency' && e.item.currencyId === 'kindling');
    expect(got.reduce((n, e) => n + (e.item.kind === 'currency' ? e.item.count : 0), 0)).toBe(8);
    tick(mia.server, clock, 2);
    expect(mia.session.instance!.kind).toBe('map');
  });

  it('an offer changed behind the rules\' back is caught on accept: refused, the offer is re-read, nothing duplicates', async () => {
    const { server, clock, players } = await setup(['Sly Sam', 'Honest Hal']);
    const [sam, hal] = players;
    const tradeId = openTrade(sam, hal);
    const map = uidOf(sam.session.record.ch, (k) => k === 'map');
    expect(sam.command({ c: 'tradeOffer', tradeId, uids: [map] }).ok).toBe(true);
    clock.advance(TRADE_ACCEPT_LOCK_MS);
    expect(sam.command({ c: 'tradeAccept', tradeId, accept: true }).ok).toBe(true);
    // A path outside the rules (and outside the Game's change hooks) removes the offered map.
    const gone = rules.discardItem(sam.session.record.ch, map);
    if (!gone.ok) throw new Error(gone.error);
    server.game.store.set(sam.session.record, gone.value);
    const before = holdings(sam.session.record.ch, hal.session.record.ch);
    const r = hal.command({ c: 'tradeAccept', tradeId, accept: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Sly Sam's offer changed/);
    expect(info(hal)).toMatchObject({ theirItems: [], youAccepted: false, theyAccepted: false });
    expect(holdings(sam.session.record.ch, hal.session.record.ch)).toEqual(before);
  });

  it('no sequence of trade, move, drop and pickup commands creates or destroys an item', async () => {
    const { server, clock, players, logger } = await setup(['Fuzz Fay', 'Fuzz Gus']);
    const [fay, gus] = players;
    expect(gus.command({ c: 'partyInvite', name: 'Fuzz Fay' }).ok).toBe(true);
    expect(fay.command({ c: 'partyRespond', inviteId: fay.last('invite')!.invite.inviteId, accept: true }).ok).toBe(true);
    expect(fay.command({ c: 'visitHideout', characterId: gus.characterId }).ok).toBe(true);
    const hideout = gus.session.instance!;
    const total = () => {
      const ground = [...hideout.groundItems.values()].map((g) => g.item);
      const carrier = { ...fay.session.record.ch, backpack: { ...fay.session.record.ch.backpack, entries: [] }, stash: [], equipment: {}, mapDevice: null, belt: [] };
      const withGround = { ...carrier, stash: [{ name: 'ground', grid: { w: 99, h: 99, entries: ground.map((item, k) => ({ item, x: k, y: 0 })) } }] };
      return holdings(fay.session.record.ch, gus.session.record.ch, withGround);
    };
    const before = total();
    // A small deterministic PRNG (mulberry32) so a failure replays.
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
    for (let step = 0; step < 1200; step++) {
      const [me, other] = rand() < 0.5 ? [fay, gus] : [gus, fay];
      const ch = me.session.record.ch;
      const bag = ch.backpack.entries.map((e) => e.item.uid);
      const tradeId = server.game.trades.tradeIdOf(me.characterId);
      const roll = rand();
      if (!tradeId && roll < 0.15) {
        const req = me.last('tradeRequest');
        if (req && rand() < 0.5) me.command({ c: 'tradeRespond', requestId: req.request.requestId, accept: rand() < 0.8 });
        else me.command({ c: 'tradeRequest', name: other.session.name });
      } else if (tradeId && roll < 0.35) {
        const n = Math.floor(rand() * 4);
        me.command({ c: 'tradeOffer', tradeId, uids: [...new Set(Array.from({ length: n }, () => pick(bag)!).filter(Boolean))] });
      } else if (tradeId && roll < 0.7) {
        if (rand() < 0.7) clock.advance(TRADE_ACCEPT_LOCK_MS);
        me.command({ c: 'tradeAccept', tradeId, accept: rand() < 0.95 });
      } else if (tradeId && roll < 0.72) {
        me.command({ c: 'tradeCancel', tradeId });
      } else if (roll < 0.83) {
        const uid = pick(bag);
        if (uid) me.command({ c: 'dropItem', uid });
      } else if (roll < 0.93) {
        // Sent raw: a click out of reach is answered later (or superseded), not at once.
        const drop = pick(hideout.run.view.drops.filter((d) => d.spec.owner === 0));
        if (drop) me.send({ t: 'cmd', id: 10_000 + step, cmd: { c: 'pickup', dropId: drop.id } });
      } else {
        const uid = pick(bag);
        if (uid) me.command({ c: 'moveItem', uid, to: { kind: 'backpack', x: Math.floor(rand() * 12), y: Math.floor(rand() * 5) } });
      }
      fay.input();
      gus.input();
      tick(server, clock);
      clock.advance(100); // stay under the per-socket command rate limit
      expect(total(), `step ${step}`).toEqual(before);
    }
    for (const p of players) expect(new Set(uidsOf(p.session.record.ch)).size).toBe(uidsOf(p.session.record.ch).length);
    // The run really exercised every path (not a vacuous pass).
    const count = (msg: string) => logger.lines.filter((l) => l.msg === msg).length;
    expect(count('trade completed')).toBeGreaterThan(5);
    expect(count('item dropped')).toBeGreaterThan(20);
    expect(count('ground item picked up')).toBeGreaterThan(10);
  }, 60_000);
});
