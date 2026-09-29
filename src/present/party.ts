// Party colours: an ally must wear the same colour on every friend's screen and in every zone (name plate, ground
// ring, off-screen marker, the UI's party panel), whatever order people joined in. Each character name hashes to a
// preferred slot; collisions are resolved by linear probing with the names taken in sorted order, so the result
// depends only on the set of names present — identical on every client — and a name keeps its preferred colour
// unless someone else in the group already claimed it.
import type { RGB } from '../contracts/render';
import { hashString } from '../core/rng';

export const PARTY_COLORS: readonly RGB[] = [
  [0.62, 0.9, 0.58],
  [0.5, 0.8, 1],
  [0.8, 0.66, 1],
  [1, 0.82, 0.45],
];

/**
 * Colour slot (index into PARTY_COLORS) for each of `names`, in the same order. Deterministic and independent of
 * the order of `names`; distinct for up to PARTY_COLORS.length distinct names.
 */
export function partyColorSlots(names: readonly string[]): number[] {
  const n = PARTY_COLORS.length;
  const order = names.map((_, i) => i).sort((a, b) => (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b));
  const taken = new Array<boolean>(n).fill(false);
  const out = new Array<number>(names.length).fill(0);
  let used = 0;
  for (const i of order) {
    let slot = hashString(names[i]) % n;
    // Once every colour is in use (more names than colours), colours repeat from the preferred slot.
    if (used < n) {
      while (taken[slot]) slot = (slot + 1) % n;
      taken[slot] = true;
      used++;
    }
    out[i] = slot;
  }
  return out;
}
