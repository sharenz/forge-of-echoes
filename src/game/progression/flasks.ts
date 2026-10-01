// Flask refill on entering a hideout (first-run guide decision): every assigned belt slot is topped up to its capacity for
// free, so a player is never stuck at home with empty flasks and no idea how to get charges. Pure.
import type { CharacterSave } from '../../contracts/items';
import { BELT_SLOT_CAPACITY } from '../../data/items';

/** The character with its belt topped up, or null when nothing was missing (no assigned slot, or every one already full). */
export function refillBelt(ch: CharacterSave): { character: CharacterSave; charges: number } | null {
  let charges = 0;
  const belt = ch.belt.map((slot) => {
    if (!slot || slot.count >= BELT_SLOT_CAPACITY) return slot;
    charges += BELT_SLOT_CAPACITY - Math.max(0, slot.count);
    return { ...slot, count: BELT_SLOT_CAPACITY };
  });
  return charges > 0 ? { character: { ...ch, belt }, charges } : null;
}
