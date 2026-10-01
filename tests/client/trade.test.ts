// Trading: the UiState reducers (window opens on a NEW trade only, closes on null, request cards) and the
// session (server messages, optimistic offer / accept with rollback, cancel, result toasts, connection drops).
import { describe, expect, it } from 'vitest';
import type { Item } from '../../src/contracts/items';
import { TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS, type TradeInfo, type TradeRequestInfo } from '../../src/contracts/net';
import type { UiState } from '../../src/contracts/ui';
import { withItemLocks, rules } from '../../src/game';
import { TRADE_REQUEST_CARD_TTL_MS } from '../../src/client/session';
import { DEFAULT_SETTINGS } from '../../src/client/settings';
import {
  MAX_TRADE_REQUESTS, addTradeRequest, closePanel, initialUiState, leaveGameState, openPanel, removeTradeRequest, withTrade,
} from '../../src/client/state';
import { answer, commands, enter, feed, flush, lastCmd, rig } from './rig';

const base = (): UiState => initialUiState({ ...DEFAULT_SETTINGS });
const req = (id: string, from = 'c2', name = 'Mira'): TradeRequestInfo => ({ requestId: id, fromCharacterId: from, fromName: name });
const trade = (p: Partial<TradeInfo> = {}): TradeInfo => ({
  tradeId: 't1', partnerCharacterId: 'c2', partnerName: 'Mira', yourItems: [], theirItems: [], youAccepted: false,
  theyAccepted: false, acceptLockedUntil: 0, ...p,
});

describe('trade reducers', () => {
  it('request cards: a repeat from the same player replaces the card; capped; removable', () => {
    let s = addTradeRequest(base(), req('r1'));
    s = addTradeRequest(s, req('r2')); // Mira again
    expect(s.tradeRequests.map((r) => r.requestId)).toEqual(['r2']);
    for (let i = 0; i < 6; i++) s = addTradeRequest(s, req(`x${i}`, `p${i}`, `P${i}`));
    expect(s.tradeRequests).toHaveLength(MAX_TRADE_REQUESTS);
    const last = s.tradeRequests.at(-1)!.requestId;
    expect(removeTradeRequest(s, last).tradeRequests.some((r) => r.requestId === last)).toBe(false);
    expect(removeTradeRequest(s, 'nope')).toBe(s);
  });

  it('a new trade opens its window and retires the partner\'s request; updates leave the panels alone', () => {
    let s = addTradeRequest(base(), req('r1'));
    s = withTrade(s, trade());
    expect(s.openPanels).toContain('trade');
    expect(s.tradeRequests).toEqual([]);
    // The player tucks the window away behind another panel: an update of the same trade must not pop it back.
    s = closePanel(s, 'trade');
    s = openPanel(s, 'party');
    s = withTrade(s, trade({ theyAccepted: true }));
    expect(s.openPanels).toEqual(['party']);
    expect(s.trade?.theyAccepted).toBe(true);
    // A different trade is new again.
    s = withTrade(s, trade({ tradeId: 't2' }));
    expect(s.openPanels).toContain('trade');
    // Closing it closes the window.
    s = withTrade(s, null);
    expect(s.trade).toBeNull();
    expect(s.openPanels).not.toContain('trade');
  });

  it('leaving the game forgets trades and requests', () => {
    const s = leaveGameState(withTrade(addTradeRequest(base(), req('r9', 'c9', 'Zed')), trade()));
    expect(s.trade).toBeNull();
    expect(s.tradeRequests).toEqual([]);
  });
});

function backpackItems(ch: ReturnType<typeof rig>['ch'], n: number): Item[] {
  return ch.backpack.entries.slice(0, n).map((e) => e.item);
}

describe('trading through the session', () => {
  it('a request pops a card with a sound, answering sends tradeRespond, stale cards expire', () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'tradeRequest', request: req('r1') });
    expect(r.box.get().tradeRequests).toHaveLength(1);
    expect(r.sounds).toContain('partyInvite');
    r.session.tradeRespond('r1', true);
    expect(lastCmd(r).cmd).toEqual({ c: 'tradeRespond', requestId: 'r1', accept: true });
    expect(r.box.get().tradeRequests).toEqual([]);

    feed(r, { t: 'tradeRequest', request: req('r2', 'c3', 'Oren') });
    r.clock.t += TRADE_REQUEST_CARD_TTL_MS + 1;
    r.session.tick(r.clock.t);
    expect(r.box.get().tradeRequests).toEqual([]);
  });

  it('tradeRequest trims the name and lets the server toast', async () => {
    const r = rig();
    enter(r);
    r.session.tradeRequest('  Mira  ');
    expect(lastCmd(r).cmd).toEqual({ c: 'tradeRequest', name: 'Mira' });
    answer(r, true);
    await flush();
    expect(r.box.get().toasts).toEqual([]);
    r.session.tradeRequest('   ');
    expect(commands(r)).toHaveLength(1);
  });

  it("a 'trade' message opens the window; an offer shows at once (accepts cleared, locked) and rolls back if refused", async () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'trade', trade: trade({ theyAccepted: true }) });
    expect(r.box.get().openPanels).toContain('trade');
    const [a, b] = backpackItems(r.ch, 2);
    r.session.tradeOffer([a.uid, b.uid, a.uid]);
    expect(lastCmd(r).cmd).toEqual({ c: 'tradeOffer', tradeId: 't1', uids: [a.uid, b.uid] });
    const shown = r.box.get().trade!;
    expect(shown.yourItems.map((i) => i.uid)).toEqual([a.uid, b.uid]);
    expect(shown.theyAccepted).toBe(false);
    expect(shown.acceptLockedUntil).toBeGreaterThanOrEqual(r.session.serverNow() + TRADE_ACCEPT_LOCK_MS - 1);
    answer(r, false, { error: 'That item is gone.' });
    await flush();
    expect(r.box.get().trade?.yourItems).toEqual([]);
    expect(r.box.get().trade?.theyAccepted).toBe(true);
  });

  it('offers are checked locally first: backpack items only, at most TRADE_MAX_ITEMS', () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'trade', trade: trade() });
    r.session.tradeOffer([r.ch.equipment.mainHand!.uid]);
    expect(commands(r).some((c) => c.c === 'tradeOffer')).toBe(false);
    expect(r.box.get().toasts.at(-1)?.text).toMatch(/backpack/);
    r.session.tradeOffer(Array.from({ length: TRADE_MAX_ITEMS + 1 }, (_, i) => `u${i}`));
    expect(commands(r).some((c) => c.c === 'tradeOffer')).toBe(false);
  });

  it('accepting is optimistic; the server confirms with the next trade state', async () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'trade', trade: trade({ yourItems: backpackItems(r.ch, 1) }) });
    r.session.tradeAccept(true);
    expect(lastCmd(r).cmd).toEqual({ c: 'tradeAccept', tradeId: 't1', accept: true });
    expect(r.box.get().trade?.youAccepted).toBe(true);
    answer(r, false, { error: 'The offer just changed. Look again before accepting.' });
    await flush();
    expect(r.box.get().trade?.youAccepted).toBe(false);
    expect(r.box.get().toasts.at(-1)?.tone).toBe('bad');
  });

  it('cancelling closes the window at once; late updates do not reopen it; the result is toasted', () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'trade', trade: trade() });
    r.session.tradeCancel();
    expect(lastCmd(r).cmd).toEqual({ c: 'tradeCancel', tradeId: 't1' });
    expect(r.box.get().trade).toBeNull();
    expect(r.box.get().openPanels).not.toContain('trade');
    feed(r, { t: 'trade', trade: trade({ theyAccepted: true }) }); // was already in flight
    expect(r.box.get().trade).toBeNull();
    feed(r, { t: 'trade', trade: null, result: 'You cancelled the trade.' });
    expect(r.box.get().toasts.at(-1)?.text).toBe('You cancelled the trade.');
  });

  it("the partner cancelling toasts the reason; a completed trade does not double the server's own toast", () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'trade', trade: trade() }, { t: 'trade', trade: null, result: 'Mira cancelled the trade.' });
    expect(r.box.get().toasts.map((t) => t.text)).toEqual(['Mira cancelled the trade.']);
    feed(r, { t: 'trade', trade: trade({ tradeId: 't2' }) });
    feed(r, { t: 'trade', trade: null, result: 'Trade completed' }, { t: 'toast', text: 'Trade with Mira completed.', tone: 'good' });
    expect(r.box.get().toasts.map((t) => t.text)).toEqual(['Mira cancelled the trade.', 'Trade with Mira completed.']);
    expect(r.sounds).toContain('buy');
  });

  it('a dropped connection cancels the trade and forgets requests (the server did the same)', () => {
    const r = rig();
    enter(r);
    feed(r, { t: 'tradeRequest', request: req('r5', 'c7', 'Oren') }, { t: 'trade', trade: trade() });
    r.session.connectionLost();
    expect(r.box.get().trade).toBeNull();
    expect(r.box.get().tradeRequests).toEqual([]);
    expect(r.box.get().toasts.at(-1)?.text).toMatch(/trade was cancelled/);
  });

  it('display rules lock offered items like the server does (withItemLocks)', () => {
    const r = rig();
    const [a] = backpackItems(r.ch, 1);
    const locked = withItemLocks(rules, () => new Set([a.uid]));
    expect(locked.discardItem(r.ch, a.uid).ok).toBe(false);
    expect(rules.discardItem(r.ch, a.uid).ok).toBe(true);
  });
});
