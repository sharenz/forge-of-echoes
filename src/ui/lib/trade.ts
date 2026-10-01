// Trade window rules the UI applies before asking the server (which stays authoritative). Pure; covered by
// tests/ui/social.test.ts.
import type { CharacterSave, Item, ItemLocation } from '../../contracts/items';
import { TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS, type TradeInfo } from '../../contracts/net';

/** Server time estimate from the client clock (UiState.serverClockOffset). */
export function serverNow(clientNow: number, serverClockOffset: number): number {
  return clientNow + serverClockOffset;
}

/** Milliseconds until accepting is allowed again (0 = now). */
export function acceptLockLeft(trade: TradeInfo, clientNow: number, serverClockOffset: number): number {
  const left = trade.acceptLockedUntil - serverNow(clientNow, serverClockOffset);
  return left > 0 ? Math.min(left, TRADE_ACCEPT_LOCK_MS) : 0;
}

/** Uids of the items you offer (a fresh array; the order is the offer order). */
export function offeredUids(trade: TradeInfo): string[] {
  return trade.yourItems.map((i) => i.uid);
}

/** Why `uid` (found at `from`) cannot join your offer, or null when it can. Already offered is not an error. */
export function offerAddError(trade: TradeInfo, uid: string, from: ItemLocation | null): string | null {
  if (!from || from.kind !== 'backpack') return 'Only items in your backpack can be traded.';
  if (trade.yourItems.some((i) => i.uid === uid)) return null;
  if (trade.yourItems.length >= TRADE_MAX_ITEMS) return `Your offer is full (${TRADE_MAX_ITEMS} items).`;
  return null;
}

/** The offer with `uid` added (no-op when already there). */
export function offerWith(trade: TradeInfo, uid: string): string[] {
  const uids = offeredUids(trade);
  return uids.includes(uid) ? uids : [...uids, uid];
}

/** The offer without `uid`. */
export function offerWithout(trade: TradeInfo, uid: string): string[] {
  return offeredUids(trade).filter((u) => u !== uid);
}

/** Uids that appeared in `next` but were not in `prev` (the partner changed their offer: flash them). */
export function addedUids(prev: readonly string[], next: readonly string[]): string[] {
  const seen = new Set(prev);
  return next.filter((u) => !seen.has(u));
}

/**
 * Whether going from `before` to `after` would move or change any item of your offer: a swap that displaces it,
 * a stack merged into it, a split taken from it. Offered items stay exactly as offered until the trade closes.
 */
export function disturbsOffer(offered: readonly Item[], before: CharacterSave, after: CharacterSave): boolean {
  for (const it of offered) {
    const a = before.backpack.entries.find((e) => e.item.uid === it.uid);
    const b = after.backpack.entries.find((e) => e.item.uid === it.uid);
    if (!a && !b) continue;
    if (!a || !b || a.x !== b.x || a.y !== b.y) return true;
    if (a.item !== b.item && JSON.stringify(a.item) !== JSON.stringify(b.item)) return true;
  }
  return false;
}
