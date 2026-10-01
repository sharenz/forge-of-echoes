// Item uid minting and character-rng helpers.
//
// Uid namespaces:
//   "i<base36>"      minted from CharacterSave.nextUid (hideout operations, merchant, starting kit)
//   "<namespace>:i<base36>"  server characters' minted IDs; distinct across alts sharing an account stash
//   "d<base36x2>"    random uid from a run's loot rng (items created without a CharacterSave)
//   "belt:<index>"   synthetic uid of a belt slot's flask charges (see beltItem / findItem)
//   "cstash:<id>"    synthetic uid of a Crafting Stash slot (currencyStashUid / parseCurrencyStashUid;
//                    see src/game/items/special-stash.ts)
//
// Pure fixtures and old saves may still mint "i0", "i1", … from their own counters. Server characters
// have a persistent namespace; raw loot/legacy IDs are adopted into it on pickup. Incoming legacy IDs
// can overlap, so two rules keep every inventory valid:
//   • mintUid never hands out a uid the character already holds (it skips taken ones), and
//   • addToBackpack keeps a foreign uid only when it is free, and then moves nextUid past it
//     (adoptUid), so later mints do not even have to skip it; a taken uid is re-minted.
import type { CurrencyId } from '../../contracts/content';
import { CURRENCY_IDS } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import { currencyStashUid } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import { createRng } from '../../core/rng';

export const BELT_UID_PREFIX = 'belt:';
/** Prefix of the synthetic Crafting Stash slot uids ("cstash:scrap"); see currencyStashUid (contracts). */
export const CURRENCY_STASH_UID_PREFIX = 'cstash:';
/** Prefix of merchant preview uids ("offer:map-t1-ashenForge"): never a held item's uid. */
export const OFFER_UID_PREFIX = 'offer:';

export { currencyStashUid };

/** "i<base36>" — the shape of a minted uid. At most 10 digits, so the counter stays an exact integer. */
const MINTED_UID = /^i([0-9a-z]{1,10})$/;

/**
 * Every uid the character holds: backpack, stash tabs, equipment, the map device, the Map Stash and the Crafting Stash work slot
 * (belt and Crafting Stash uids are synthetic).
 */
export function heldUids(ch: CharacterSave): Set<string> {
  const out = new Set<string>();
  for (const e of ch.backpack.entries) out.add(e.item.uid);
  for (const tab of ch.stash) for (const e of tab.grid.entries) out.add(e.item.uid);
  for (const item of Object.values(ch.equipment)) if (item) out.add(item.uid);
  if (ch.mapDevice) out.add(ch.mapDevice.uid);
  for (const s of ch.mapScarabs ?? []) if (s) out.add(s.uid);
  if (Array.isArray(ch.mapStash)) for (const m of ch.mapStash) out.add(m.uid);
  if (ch.craftSlot) out.add(ch.craftSlot.uid);
  return out;
}

/**
 * Mint the next free sequential uid for a character: "i<nextUid>", skipping any uid the character
 * already holds (one adopted from another character, see the header). Returns the advanced character
 * (nextUid moves past the minted uid).
 */
export function mintUid(ch: CharacterSave): { uid: string; character: CharacterSave } {
  let n = Math.max(0, Math.floor(ch.nextUid || 0));
  let taken: Set<string> | null = null;
  for (;;) {
    const uid = `${ch.uidNamespace ?? ''}i${n.toString(36)}`;
    taken ??= heldUids(ch);
    if (!taken.has(uid)) return { uid, character: { ...ch, nextUid: n + 1 } };
    n++;
  }
}

/**
 * The character after adopting an item with `uid` from elsewhere: a minted-looking uid at or beyond
 * the character's counter moves nextUid past it, so the counter never mints it again (the same rule
 * parseSave applies to a loaded save). Any other uid leaves the character unchanged.
 */
export function adoptUid(ch: CharacterSave, uid: string): CharacterSave {
  const prefix = ch.uidNamespace ?? '';
  const m = MINTED_UID.exec(prefix && uid.startsWith(prefix) ? uid.slice(prefix.length) : uid);
  if (!m) return ch;
  const n = parseInt(m[1], 36);
  const next = Math.max(0, Math.floor(ch.nextUid || 0));
  return n >= next ? { ...ch, nextUid: n + 1 } : ch;
}

/** Random 64-bit uid from an rng (for loot rolled inside a run, where no CharacterSave is at hand). */
export function randomUid(rng: Rng): string {
  const a = Math.floor(rng.next() * 0x100000000);
  const b = Math.floor(rng.next() * 0x100000000);
  return `d${a.toString(36)}${b.toString(36).padStart(7, '0')}`;
}

export function beltUid(index: number): string {
  return `${BELT_UID_PREFIX}${index}`;
}

const BELT_UID = /^belt:(\d{1,3})$/;

/**
 * Belt slot index for a synthetic belt uid ("belt:0" … ), or null — also for anything that is not a
 * string or not exactly "belt:" + digits ("belt:", "belt:1e3", "belt: 1" are not belt uids).
 */
export function parseBeltUid(uid: string): number | null {
  if (typeof uid !== 'string') return null;
  const m = BELT_UID.exec(uid);
  return m ? Number(m[1]) : null;
}

const CURRENCY_ID_SET: ReadonlySet<string> = new Set<string>(CURRENCY_IDS);

/**
 * Currency id of a synthetic Crafting Stash slot uid ("cstash:scrap" → 'scrap'), or null — also for
 * anything that is not a string, and for an unknown id ("cstash:constructor" is not a slot).
 */
export function parseCurrencyStashUid(uid: unknown): CurrencyId | null {
  if (typeof uid !== 'string' || !uid.startsWith(CURRENCY_STASH_UID_PREFIX)) return null;
  const id = uid.slice(CURRENCY_STASH_UID_PREFIX.length);
  return CURRENCY_ID_SET.has(id) ? (id as CurrencyId) : null;
}

/**
 * True for uids that can never be a real item's own uid: belt slots, Crafting Stash slots and merchant
 * previews (and anything malformed). Items arriving with one are re-minted.
 */
export function isReservedUid(uid: unknown): boolean {
  return typeof uid !== 'string' || uid.length === 0 || uid.length > 64 || uid.startsWith(BELT_UID_PREFIX)
    || uid.startsWith(CURRENCY_STASH_UID_PREFIX) || uid.startsWith(OFFER_UID_PREFIX);
}

/**
 * Run `fn` with an rng resumed from `ch.rngState`; returns its value and the advanced state.
 * Callers store `rngState` back on the new CharacterSave so the next operation continues the stream.
 */
export function withCharacterRng<T>(ch: CharacterSave, fn: (rng: Rng) => T): { value: T; rngState: number } {
  const rng = createRng(ch.rngState >>> 0);
  const value = fn(rng);
  return { value, rngState: rng.state() };
}
