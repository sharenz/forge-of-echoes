// Crafting Stash work slot (GAME_SPEC §12): the pure pieces the UI needs, kept out of the component so they can be
// tested: which affix lines a craft just added or changed, the slot's "last crafts" log, which permanent currencies
// ask for a confirmation, and where "Equip" puts the item. No DOM, no store.
import type { CurrencyId, EquipSlot } from '../../contracts/content';
import type { CharacterSave, CraftSlotItem, TooltipLine } from '../../contracts/items';

/** How many of the item's own history lines the log shows. */
export const WORK_LOG_LINES = 4;

/**
 * Identity of a modifier line for diffing: what it is, at which tier, with which rolled value (and whether it is
 * fractured or bench-crafted). A seal breaking after a craft is not a change of the affix itself: not part of it.
 */
function lineKey(l: TooltipLine): string {
  return `${l.kind}|${l.affixName ?? ''}|${l.tier ?? ''}|${l.text}|${l.fractured ? 'f' : ''}${l.crafted ? 'c' : ''}`;
}

/** The lines shown for an item: implicits, affixes, then scars (what the bench shows, in the same order). */
export function modLines(desc: { implicits: TooltipLine[]; affixes: TooltipLine[]; scars: TooltipLine[] }): TooltipLine[] {
  return [...desc.implicits, ...desc.affixes, ...desc.scars];
}

/** One string that changes exactly when a modifier list does (identity of the diff below). */
export function linesSignature(lines: readonly TooltipLine[]): string {
  return lines.map(lineKey).join('\n');
}

/**
 * Indices (into `next`) of the lines a craft added or changed: a line counts as unchanged only when the same line
 * (same kind, tier and rolled value) existed before; a rerolled value, a tier step and a brand-new affix all show
 * up. Duplicates match one-to-one.
 */
export function freshLineIndices(prev: readonly TooltipLine[], next: readonly TooltipLine[]): Set<number> {
  const left = new Map<string, number>();
  for (const l of prev) left.set(lineKey(l), (left.get(lineKey(l)) ?? 0) + 1);
  const fresh = new Set<number>();
  next.forEach((l, i) => {
    const k = lineKey(l);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else fresh.add(i);
  });
  return fresh;
}

/** Affix lines the craft removed (shown struck through in the craft strip): the ones of `prev` not in `next`. */
export function removedLines(prev: readonly TooltipLine[], next: readonly TooltipLine[]): TooltipLine[] {
  const left = new Map<string, number>();
  for (const l of next) left.set(lineKey(l), (left.get(lineKey(l)) ?? 0) + 1);
  const gone: TooltipLine[] = [];
  for (const l of prev) {
    const k = lineKey(l);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else gone.push(l);
  }
  return gone;
}

/** The newest `limit` history lines, newest first. */
export function craftLog(history: readonly string[] | undefined, limit = WORK_LOG_LINES): string[] {
  if (!history?.length) return [];
  return history.slice(-limit).reverse();
}

/**
 * Currencies that cannot be taken back in one click of the work slot: they ask once before they are applied.
 * Everything else applies at once (Stability is the price of a craft; there is no undo in the rules, and the
 * rules already refuse a craft that would do nothing without spending anything).
 */
export const CONFIRM_CURRENCIES: Readonly<Partial<Record<CurrencyId, { title: string; body: string; confirm: string }>>> = {
  fractureCore: {
    title: 'Fracture an affix',
    body: 'A fractured affix is locked for good: immune to every craft, and only one per item. You choose which one next.',
    confirm: 'Choose the affix',
  },
  anneal: {
    title: 'Anneal this item',
    body: 'Anneal permanently lowers the item’s maximum Stability by 1 before it restores it to that maximum.',
    confirm: 'Anneal it',
  },
  transmute: {
    title: 'Transmute this item',
    body: 'Transmute swaps the item for a different base of the same class and rerolls its implicit values. Affixes stay. It cannot be undone.',
    confirm: 'Transmute it',
  },
  voidNeedle: {
    title: 'Corrupt this map',
    body: 'A corrupted map can no longer be crafted until a Void Splinter cleans it. The corruption outcome is random.',
    confirm: 'Corrupt it',
  },
};

/** Whether applying `id` to the work slot needs a confirmation first. */
export function needsConfirm(id: CurrencyId): boolean {
  return Object.prototype.hasOwnProperty.call(CONFIRM_CURRENCIES, id);
}

/**
 * Where the "Equip" button sends the item: a free compatible slot first, else the first compatible one (its current
 * wearer swaps into the work slot). null for a map or an item nothing can wear it in.
 */
export function equipTarget(ch: CharacterSave, item: CraftSlotItem, slotsOf: (baseId: string) => readonly EquipSlot[] | undefined): EquipSlot | null {
  if (item.kind !== 'equipment') return null;
  const slots = slotsOf(item.baseId);
  if (!slots?.length) return null;
  return slots.find((s) => !ch.equipment[s]) ?? slots[0];
}

/** Keyboard navigation between the currency tiles: the index a key moves to (null = not a navigation key). */
export function tileStep(key: string, index: number, count: number, columns: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return index - columns >= 0 ? index - columns : index;
    case 'ArrowDown':
      return index + columns < count ? index + columns : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
