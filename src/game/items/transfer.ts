// Items that change hands or come back to their owner: the atomic trade swap (GAME_SPEC §12 Trading),
// the validation of a trade offer, and stowing an item that must not be lost (a map refunded after a
// server restart, anything handed back by the server) — backpack, then stash, never dropped.
//
// Pure like the rest of the rules. Every received item goes through addToBackpack, which keeps the
// receiver's uids unique (another character's "i…" uids overlap this one's; see src/game/items/ids.ts).
import type { Result } from '../../contracts/game';
import type { CharacterSave, Item } from '../../contracts/items';
import { MAP_STASH_CAPACITY, MAX_STASH_TABS } from '../../contracts/items';
import { TRADE_MAX_ITEMS } from '../../contracts/net';
import {
  addToBackpack, autoPlace, claimIncomingUid, createStashTab, findItem, itemSize, removeItemAt, withGrid,
} from './inventory';
import { itemLabel } from './describe';
import { currencyStashCount, currencyStashRoom, mapStashOf, withCurrencyStashCount, withMapStash } from './special-stash';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

// ---------------------------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------------------------

/**
 * Why `uids` cannot be this character's trade offer; null when it can. An offer is a list of distinct
 * uids of items in the BACKPACK (not equipped, stashed or on the belt), at most TRADE_MAX_ITEMS long.
 * Uids arrive from the network, so anything malformed is rejected with a reason instead of throwing.
 */
export function tradeOfferError(ch: CharacterSave, uids: unknown): string | null {
  if (!Array.isArray(uids)) return 'That trade offer is not valid.';
  if (uids.length > TRADE_MAX_ITEMS) return `You can offer at most ${TRADE_MAX_ITEMS} items.`;
  const seen = new Set<string>();
  for (const uid of uids) {
    if (typeof uid !== 'string') return 'That trade offer is not valid.';
    if (seen.has(uid)) return 'Each item can only be offered once.';
    seen.add(uid);
    const found = findItem(ch, uid);
    if (!found) return 'That item no longer exists.';
    if (found.location.kind !== 'backpack') return 'Only items in your backpack can be traded.';
  }
  return null;
}

/** Take the offered items out of `ch` (validated first); returns them in offer order. */
function takeOffer(ch: CharacterSave, uids: readonly string[]): { ch: CharacterSave; items: Item[] } {
  let next = ch;
  const items: Item[] = [];
  for (const uid of uids) {
    const found = findItem(next, uid);
    if (!found) continue;
    items.push(found.item);
    next = removeItemAt(next, found.location, uid);
  }
  return { ch: next, items };
}

/**
 * Give `items` to `ch`'s backpack (marked new; flasks go to the backpack, not the belt). Largest items
 * first, so a full-ish backpack is not refused over the order the items were offered in.
 */
function receive(ch: CharacterSave, items: readonly Item[]): Result<CharacterSave> {
  const area = (item: Item) => {
    const s = itemSize(item);
    return s.w * s.h;
  };
  const ordered = items.map((item, i) => ({ item, i })).sort((x, y) => area(y.item) - area(x.item) || x.i - y.i);
  let next = ch;
  for (const { item } of ordered) {
    const r = addToBackpack(next, { ...item, isNew: true }, { refillBelt: false });
    if (!r.ok) return fail(`${ch.name}'s backpack has no room for ${itemLabel(item)}. Nothing was traded.`);
    next = r.value;
  }
  return ok(next);
}

/**
 * The atomic trade swap: `a` gives the items `aUids` (from its backpack) to `b`, and `b` gives `bUids`
 * to `a`. Both offers are validated against the CURRENT characters, both sides give first (so the space
 * an offered item frees counts), then each receives the other's items into its backpack. All or nothing:
 * any invalid offer or a backpack without room fails with a player-facing reason, and neither character
 * changes. Received items keep their uid when it is free on the receiver (re-minted otherwise), keep
 * every roll, seal, fracture and crafted mark, and are flagged new.
 */
export function tradeItems(
  a: CharacterSave, aUids: readonly string[], b: CharacterSave, bUids: readonly string[],
): Result<{ a: CharacterSave; b: CharacterSave }> {
  if (a.id === b.id) return fail('You cannot trade with yourself.');
  const aError = tradeOfferError(a, aUids);
  if (aError) return fail(`${a.name}'s offer changed: ${aError}`);
  const bError = tradeOfferError(b, bUids);
  if (bError) return fail(`${b.name}'s offer changed: ${bError}`);
  const fromA = takeOffer(a, aUids);
  const fromB = takeOffer(b, bUids);
  const nextA = receive(fromA.ch, fromB.items);
  if (!nextA.ok) return fail(nextA.error);
  const nextB = receive(fromB.ch, fromA.items);
  if (!nextB.ok) return fail(nextB.error);
  return ok({ a: nextA.value, b: nextB.value });
}

// ---------------------------------------------------------------------------------------------
// Stowing
// ---------------------------------------------------------------------------------------------

export interface Stowed {
  character: CharacterSave;
  /** Where the item went. */
  where: 'mapDevice' | 'backpack' | 'stash' | 'mapStash' | 'currencyStash';
  /** Stash tab index when `where` is 'stash'. */
  tab: number | null;
  /** Player-facing place for a toast: "your Map Device", "your backpack", 'your stash (tab "Maps")'. */
  text: string;
}

/**
 * Give an item back to its owner without ever losing it: a map goes into an empty Map Device first,
 * then anything goes to the backpack (stacking), then a map to the Map Stash and currency to its
 * Crafting Stash slot (when the whole stack fits), then the first stash tab with room, then a new
 * "Recovered" tab while the stash has fewer than MAX_STASH_TABS. Fails only when all of that is full.
 * The uid is kept when free on the character (re-minted otherwise). For server-side refunds, e.g. the
 * map of a run that could not be restored after a restart.
 */
export function stowItem(ch: CharacterSave, item: Item): Result<Stowed> {
  if (item.kind === 'map' && !ch.mapDevice) {
    const claimed = claimIncomingUid(ch, item);
    if (claimed.item.kind === 'map') {
      return ok({ character: { ...claimed.ch, mapDevice: claimed.item }, where: 'mapDevice', tab: null, text: 'your Map Device' });
    }
  }
  const bag = addToBackpack(ch, item, { refillBelt: false });
  if (bag.ok) return ok({ character: bag.value, where: 'backpack', tab: null, text: 'your backpack' });

  if (item.kind === 'currency' && item.count > 0 && currencyStashRoom(ch, item.currencyId) >= item.count) {
    const character = withCurrencyStashCount(ch, item.currencyId, currencyStashCount(ch, item.currencyId) + item.count);
    return ok({ character, where: 'currencyStash', tab: null, text: 'your Crafting Stash' });
  }
  const claimed = claimIncomingUid(ch, item);
  if (claimed.item.kind === 'map' && mapStashOf(claimed.ch).length < MAP_STASH_CAPACITY) {
    const character = withMapStash(claimed.ch, [...mapStashOf(claimed.ch), claimed.item]);
    return ok({ character, where: 'mapStash', tab: null, text: 'your Map Stash' });
  }
  for (let t = 0; t < claimed.ch.stash.length; t++) {
    const grid = autoPlace(claimed.ch.stash[t].grid, claimed.item);
    if (grid) {
      const character = withGrid(claimed.ch, { kind: 'stash', tab: t }, grid);
      return ok({ character, where: 'stash', tab: t, text: `your stash (tab "${claimed.ch.stash[t].name}")` });
    }
  }
  if (claimed.ch.stash.length < (claimed.ch.stashCapacity ?? MAX_STASH_TABS)) {
    const tab = createStashTab('Recovered');
    const grid = autoPlace(tab.grid, claimed.item);
    if (grid) {
      const character: CharacterSave = { ...claimed.ch, stash: [...claimed.ch.stash, { ...tab, grid }] };
      return ok({ character, where: 'stash', tab: character.stash.length - 1, text: 'your stash (tab "Recovered")' });
    }
  }
  return fail(`There is no room for ${itemLabel(item)}: your backpack and stash are full.`);
}
