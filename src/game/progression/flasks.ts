// Flask refill on entering a hideout (first-run guide decision): every assigned belt slot is topped up to its capacity for
// free, so a player is never stuck at home with empty flasks and no idea how to get charges. Pure.
import { EQUIP_SLOTS } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import { BELT_SLOT_CAPACITY } from '../../data/items';
import { itemModifiers } from '../items';
import { passiveTotalsOf } from './passive-rules';

/** Kill charge rule (power rework 10.3): each assigned belt slot gains one charge per this many kills. */
export const FLASK_KILLS_PER_CHARGE = 40;
/** The floor of the rule however much gear shortens it. */
export const FLASK_KILLS_PER_CHARGE_MIN = 10;

/** Kills per charge for this character: 40 minus the belt affix "of Reserves" (and any other `flaskChargeOnKill` line), never below 10. */
export function killsPerCharge(ch: CharacterSave): number {
  let sooner = 0;
  for (const slot of EQUIP_SLOTS) {
    const item = ch.equipment?.[slot];
    if (!item || item.kind !== 'equipment') continue;
    for (const m of itemModifiers(item)) if (m.stat === 'flaskChargeOnKill' && m.mode === 'flat') sooner += m.value;
  }
  const base = Math.max(FLASK_KILLS_PER_CHARGE_MIN, Math.round(FLASK_KILLS_PER_CHARGE - sooner));
  // Quick Recovery (the Orrery): a charge every N kills at the latest.
  const passive = passiveTotalsOf(ch)?.min('flaskChargePerKills') ?? 0;
  return passive > 0 ? Math.max(FLASK_KILLS_PER_CHARGE_MIN, Math.min(base, Math.round(passive))) : base;
}

/**
 * The character after its `kills`-th kill of the run (1-based): on every `killsPerCharge`-th kill each assigned belt slot below capacity
 * gains one charge. Null when nothing changed. Pure: the caller counts kills.
 */
export function killCharge(ch: CharacterSave, kills: number): { character: CharacterSave; charges: number } | null {
  if (!Number.isInteger(kills) || kills < 1 || kills % killsPerCharge(ch) !== 0) return null;
  let charges = 0;
  const belt = ch.belt.map((slot) => {
    if (!slot || slot.count >= BELT_SLOT_CAPACITY) return slot;
    charges++;
    return { ...slot, count: Math.max(0, slot.count) + 1 };
  });
  return charges > 0 ? { character: { ...ch, belt }, charges } : null;
}

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
