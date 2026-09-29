// UI-local state that never leaves the browser: tooltips, drag & drop, confirmation dialogs, cursor hints, the
// stash search query and the expanded Map Stash tier.
// One instance per mountUi() call, shared through LocalContext.
import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { SkillId } from '../contracts/content';
import type { Item, ItemLocation } from '../contracts/items';
import { signal, type Signal } from './store';
import type { Cell, Size } from './lib/grid';

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type TooltipSpec =
  /** An item the character owns (looked up live, so Alt / crafting / changes update it). */
  | { kind: 'item'; uid: string }
  /**
   * A detached item (merchant preview, a trade partner's offer). `compare` adds the Alt comparison with your
   * equipped gear; `label` is a small caption above the card.
   */
  | { kind: 'preview'; item: Item; note?: string; compare?: boolean; label?: string }
  | { kind: 'skill'; skillId: SkillId }
  | { kind: 'text'; title?: string; lines: string[]; tone?: 'info' | 'bad' | 'good' }
  /** Anything else; `owner` lets the element that opened it close it again (e.g. when it unmounts). */
  | { kind: 'custom'; render: () => ComponentChildren; owner?: string };

export interface TooltipState {
  spec: TooltipSpec;
  anchor: AnchorRect;
  /** 'side' = left/right of the anchor (items), 'above' = over the anchor (buttons, HUD). */
  placement: 'side' | 'above';
}

export interface DropTarget {
  /** Stable key of the hovered target (grid cell / slot), to avoid re-validating on every pointer move. */
  key: string;
  loc: ItemLocation | null;
  valid: boolean;
  reason: string | null;
  /** Dropping would do nothing (same place). */
  noop: boolean;
  /** Grid previews: which grid and the clamped top-left of the footprint. */
  grid?: { kind: 'backpack' } | { kind: 'stash'; tab: number };
  origin?: Cell;
  /** Pointer is over the game world (dropping puts the item on the floor: actions.dropItem). */
  world?: boolean;
  /** Pointer is over the crafting bench slot (dropping places the item on the bench; it stays where it is). */
  bench?: boolean;
  /** Pointer is over your side of the trade window (dropping adds the item to your offer). */
  offer?: boolean;
}

export interface DragState {
  uid: string;
  item: Item;
  from: ItemLocation;
  size: Size;
  grab: Cell;
  /** Pixel size of one cell where the drag started (ghost size). */
  cellPx: number;
  target: DropTarget | null;
}

export interface DialogSpec {
  title: string;
  body: ComponentChildren;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until the input equals this text (case-insensitive). */
  requireText?: string;
  onConfirm: () => void;
}

export interface CursorHint {
  id: number;
  text: string;
  x: number;
  y: number;
}

export interface Local {
  tooltip: Signal<TooltipState | null>;
  drag: Signal<DragState | null>;
  /** Last pointer position (viewport px); updated by the drag controller and the armed cursor. */
  pointer: { x: number; y: number };
  dialog: Signal<DialogSpec | null>;
  hint: Signal<CursorHint | null>;
  /** Stash search box text (kept while the stash is closed; applied only while it is open). */
  search: Signal<string>;
  /** The Map Stash tier the player expanded (shared by the stash tab and the map device's picker); null = auto. */
  mapTier: Signal<number | null>;
  /** performance.now() when the UI last opened the chat (keys typed before the field has focus go to it). */
  chatOpenedAt: number;
  showTooltip(spec: TooltipSpec, el: Element, placement?: 'side' | 'above'): void;
  hideTooltip(): void;
  flashHint(text: string, x?: number, y?: number): void;
}

export function createLocal(): Local {
  const tooltip = signal<TooltipState | null>(null);
  const hint = signal<CursorHint | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let hintId = 0;
  const local: Local = {
    tooltip,
    drag: signal<DragState | null>(null),
    pointer: { x: 0, y: 0 },
    dialog: signal<DialogSpec | null>(null),
    hint,
    search: signal(''),
    mapTier: signal<number | null>(null),
    chatOpenedAt: -Infinity,
    showTooltip(spec, el, placement = 'side') {
      const r = el.getBoundingClientRect();
      tooltip.set({ spec, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, placement });
    },
    hideTooltip() {
      tooltip.set(null);
    },
    flashHint(text, x = local.pointer.x, y = local.pointer.y) {
      hintId += 1;
      hint.set({ id: hintId, text, x, y });
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.set(null), 2200);
    },
  };
  return local;
}

export const LocalContext = createContext<Local | null>(null);

export function useLocal(): Local {
  const l = useContext(LocalContext);
  if (!l) throw new Error('LocalContext missing');
  return l;
}
