// Chat slash commands and the trade window rules (src/ui/lib/chat.ts, src/ui/lib/trade.ts).
import { describe, expect, it } from 'vitest';
import type { CharacterSave, CurrencyStack, GridEntry, Item } from '../../src/contracts/items';
import { TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS, type TradeInfo } from '../../src/contracts/net';
import { rules } from '../../src/game';
import { parseChatCommand } from '../../src/ui/lib/chat';
import {
  acceptLockLeft,
  addedUids,
  disturbsOffer,
  offerAddError,
  offerWith,
  offerWithout,
  offeredUids,
  serverNow,
} from '../../src/ui/lib/trade';

describe('chat commands', () => {
  it('reads /trade <name> case-insensitively and trims the name', () => {
    expect(parseChatCommand('/trade Mira')).toEqual({ kind: 'trade', name: 'Mira' });
    expect(parseChatCommand('  /TRADE   Old Corvin  ')).toEqual({ kind: 'trade', name: 'Old Corvin' });
  });

  it('explains a missing or invalid name instead of sending anything', () => {
    expect(parseChatCommand('/trade')).toEqual({ kind: 'error', message: 'Usage: /trade <character name>' });
    expect(parseChatCommand('/trade   ')?.kind).toBe('error');
    expect(parseChatCommand('/trade 9lives')?.kind).toBe('error');
    expect(parseChatCommand('/trade ab')?.kind).toBe('error');
  });

  it('flags unknown commands but leaves ordinary text alone', () => {
    const unknown = parseChatCommand('/dance');
    expect(unknown?.kind).toBe('error');
    expect(unknown && unknown.kind === 'error' && unknown.message).toContain('/trade');
    expect(parseChatCommand('hello there')).toBeNull();
    expect(parseChatCommand('/o/')).toBeNull();
    expect(parseChatCommand('gg /trade Mira')).toBeNull();
    expect(parseChatCommand('')).toBeNull();
  });
});

describe('trade window rules', () => {
  const stack = (uid: string): CurrencyStack => ({ kind: 'currency', uid, currencyId: 'scrap', count: 3 });
  const trade = (yours: Item[], lockedUntil = 0): TradeInfo => ({
    tradeId: 't1',
    partnerCharacterId: 'ch-mira',
    partnerName: 'Mira',
    yourItems: yours,
    theirItems: [],
    youAccepted: false,
    theyAccepted: false,
    acceptLockedUntil: lockedUntil,
  });

  it('counts the accept lock in server time and caps it at the lock length', () => {
    // Server clock 500 ms ahead of the client.
    expect(serverNow(10_000, 500)).toBe(10_500);
    const t = trade([], 11_000);
    expect(acceptLockLeft(t, 10_000, 500)).toBe(500);
    expect(acceptLockLeft(t, 10_600, 500)).toBe(0);
    expect(acceptLockLeft(t, 12_000, 0)).toBe(0);
    // A client clock far behind the server's never shows more than the lock itself.
    expect(acceptLockLeft(t, 0, 0)).toBe(TRADE_ACCEPT_LOCK_MS);
  });

  it('accepts only backpack items, up to the limit; offering twice is harmless', () => {
    const t = trade([stack('a')]);
    const pack = { kind: 'backpack' as const, x: 0, y: 0 };
    expect(offerAddError(t, 'b', pack)).toBeNull();
    expect(offerAddError(t, 'a', pack)).toBeNull();
    expect(offerAddError(t, 'b', { kind: 'stash', tab: 0, x: 0, y: 0 })).toMatch(/backpack/);
    expect(offerAddError(t, 'b', { kind: 'equipment', slot: 'ring1' })).toMatch(/backpack/);
    expect(offerAddError(t, 'b', null)).toMatch(/backpack/);
    const full = trade(Array.from({ length: TRADE_MAX_ITEMS }, (_, i) => stack(`s${i}`)));
    expect(offerAddError(full, 'b', pack)).toMatch(/full/);
    expect(offerAddError(full, 's3', pack)).toBeNull();
  });

  it('adds and removes uids, keeping the offer order', () => {
    const t = trade([stack('a'), stack('b')]);
    expect(offeredUids(t)).toEqual(['a', 'b']);
    expect(offerWith(t, 'c')).toEqual(['a', 'b', 'c']);
    expect(offerWith(t, 'a')).toEqual(['a', 'b']);
    expect(offerWithout(t, 'a')).toEqual(['b']);
    expect(offerWithout(t, 'zz')).toEqual(['a', 'b']);
  });

  it('spots what the partner added to their offer', () => {
    expect(addedUids(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']);
    expect(addedUids(['a', 'b'], ['b'])).toEqual([]);
    expect(addedUids([], ['x', 'y'])).toEqual(['x', 'y']);
  });
});

describe('trade offer locks', () => {
  const stack = (uid: string, count = 3): CurrencyStack => ({ kind: 'currency', uid, currencyId: 'scrap', count });
  const at = (item: Item, x: number, y: number): GridEntry => ({ x, y, item });
  const pack = (...entries: GridEntry[]): CharacterSave => ({ backpack: { w: 12, h: 5, entries } }) as unknown as CharacterSave;

  it('flags a move that displaces, changes or removes an offered item', () => {
    const a = stack('a');
    const before = pack(at(a, 0, 0), at(stack('b'), 1, 0));
    // Nothing offered moved (another item did).
    expect(disturbsOffer([a], before, pack(at(a, 0, 0), at(stack('b'), 4, 2)))).toBe(false);
    // Swapped out of the way.
    expect(disturbsOffer([a], before, pack(at(a, 2, 0), at(stack('b'), 0, 0)))).toBe(true);
    // A stack merged into it: same cell, new count.
    expect(disturbsOffer([a], before, pack(at(stack('a', 9), 0, 0)))).toBe(true);
    // Gone.
    expect(disturbsOffer([a], before, pack(at(stack('b'), 1, 0)))).toBe(true);
    // An equal copy (the rules rebuild objects) is not a change; nothing offered never is.
    expect(disturbsOffer([a], before, pack(at(stack('a'), 0, 0), at(stack('b'), 1, 0)))).toBe(false);
    expect(disturbsOffer([], before, pack())).toBe(false);
    // An offered uid in neither backpack (stale offer) does not block unrelated moves.
    expect(disturbsOffer([stack('zz')], before, pack(at(a, 0, 0), at(stack('b'), 3, 3)))).toBe(false);
  });

  it('catches the rules merging a dragged stack into an offered stack', () => {
    const ch = rules.createCharacter('Tester', 1);
    const target = ch.backpack.entries.find((e) => e.item.kind === 'currency');
    if (!target || target.item.kind !== 'currency') throw new Error('starting kit has no currency');
    // A second, small stack of the same currency in a free cell.
    const taken = new Set<string>();
    for (const e of ch.backpack.entries) {
      const size = rules.itemSize(e.item);
      for (let dx = 0; dx < size.w; dx++) for (let dy = 0; dy < size.h; dy++) taken.add(`${e.x + dx},${e.y + dy}`);
    }
    let free: { x: number; y: number } | null = null;
    for (let y = 0; y < ch.backpack.h && !free; y++) for (let x = 0; x < ch.backpack.w && !free; x++) if (!taken.has(`${x},${y}`)) free = { x, y };
    if (!free) throw new Error('backpack full');
    const extra: CurrencyStack = { kind: 'currency', uid: 'extra-stack', currencyId: target.item.currencyId, count: 1 };
    const before: CharacterSave = { ...ch, backpack: { ...ch.backpack, entries: [...ch.backpack.entries, { ...free, item: extra }] } };
    const merged = rules.moveItem(before, extra.uid, { kind: 'backpack', x: target.x, y: target.y });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(disturbsOffer([target.item], before, merged.value)).toBe(true);
    expect(disturbsOffer([], before, merged.value)).toBe(false);
  });
});
