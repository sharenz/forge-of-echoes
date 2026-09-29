// Item uid minting and character-rng helpers.
//
// Uid namespaces:
//   "i<base36>"      minted from CharacterSave.nextUid (hideout operations, merchant, starting kit)
//   "d<base36x2>"    random uid from a run's loot rng (items created without a CharacterSave)
//   "belt:<index>"   synthetic uid of a belt slot's flask charges (see beltItem / findItem)
//
// UIDS ARE UNIQUE PER CHARACTER, NOT PER SERVER. Every character mints "i0", "i1", … from its own
// counter, so an item that arrives from another character (a trade, a public drop someone else threw
// on the floor) can carry a uid this character minted or will mint next. Two rules keep a character's
// uids unique, and every inventory operation relies on that:
//   • mintUid never hands out a uid the character already holds (it skips taken ones), and
//   • addToBackpack keeps a foreign uid only when it is free, and then moves nextUid past it
//     (adoptUid), so later mints do not even have to skip it; a taken uid is re-minted.
import type { CharacterSave } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import { createRng } from '../../core/rng';

export const BELT_UID_PREFIX = 'belt:';

/** "i<base36>" — the shape of a minted uid. At most 10 digits, so the counter stays an exact integer. */
const MINTED_UID = /^i([0-9a-z]{1,10})$/;

/** Every uid the character holds: backpack, stash tabs, equipment and the map device (belt uids are synthetic). */
export function heldUids(ch: CharacterSave): Set<string> {
  const out = new Set<string>();
  for (const e of ch.backpack.entries) out.add(e.item.uid);
  for (const tab of ch.stash) for (const e of tab.grid.entries) out.add(e.item.uid);
  for (const item of Object.values(ch.equipment)) if (item) out.add(item.uid);
  if (ch.mapDevice) out.add(ch.mapDevice.uid);
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
    const uid = `i${n.toString(36)}`;
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
  const m = MINTED_UID.exec(uid);
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

/**
 * Run `fn` with an rng resumed from `ch.rngState`; returns its value and the advanced state.
 * Callers store `rngState` back on the new CharacterSave so the next operation continues the stream.
 */
export function withCharacterRng<T>(ch: CharacterSave, fn: (rng: Rng) => T): { value: T; rngState: number } {
  const rng = createRng(ch.rngState >>> 0);
  const value = fn(rng);
  return { value, rngState: rng.state() };
}
