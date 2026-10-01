// Crafting click rules. Pure; covered by tests/ui/helpers.test.ts.

/**
 * PoE-style arming: one click applies the armed currency once, holding Shift keeps it armed for the next click.
 * Seal / Catalyst / Fracture Core stay armed until the affix is chosen (the store keeps `armed` for the choice).
 */
export function keepArmedAfterApply(shiftKey: boolean, needsAffixChoice: boolean): boolean {
  return shiftKey || needsAffixChoice;
}

/** A craft sent to the server whose result has not arrived yet. */
export interface PendingCraft {
  target: string;
  /** The character object the craft was computed on; a new object means the server answered. */
  character: unknown;
  /** performance.now() when it was sent. */
  at: number;
}

/** How long a craft may stay unanswered before the target accepts clicks again (a rejected command). */
export const CRAFT_PENDING_MS = 600;

/**
 * Whether another click on `target` must wait: the previous craft on it is still in flight. Without this a
 * double-click (or Shift spam) would send a second, irreversible craft computed on stale state.
 */
export function craftPending(p: PendingCraft | null, target: string, character: unknown, now: number): boolean {
  return !!p && p.target === target && p.character === character && now - p.at < CRAFT_PENDING_MS;
}
