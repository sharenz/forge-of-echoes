// UI-local state that never leaves the browser: tooltips, drag & drop, confirmation dialogs, cursor hints, the
// stash search query and the expanded Map Stash tier.
// One instance per mountUi() call, shared through LocalContext.
import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { SkillId } from '../contracts/content';
import type { MerchantBoard } from '../contracts/game';
import type { Item, ItemLocation } from '../contracts/items';
import { signal, type Signal } from './store';
import type { Cell, Size } from './lib/grid';
import { createGuideLive, type GuideLive } from './guide/live';

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
  | { kind: 'preview'; item: Item; note?: string; compare?: boolean; label?: string; price?: { text: string; poor: boolean }; appraisal?: string[] }
  /** `compareTo`: holding Alt shows this skill's numbers against that one (the Skills panel's Alt comparison). */
  | { kind: 'skill'; skillId: SkillId; compareTo?: SkillId | null }
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
  sale?: boolean;
  /** A sale-window item dragged back out: dropping anywhere but the window takes it out of the sale. */
  unsale?: boolean;
  /** Short label on the drag ghost when the drop is valid ("Buy for 6 Forge Scrap"). */
  tag?: string;
  /** Pointer is over a panel-owned slot (data-drop="slot" data-slot="<id>", see Local.slots): the item stays where it is, the slot's handler decides. */
  slot?: string;
}

/**
 * A drop target a panel owns that is not an item location: the Atlas dock's passage slot and the bench's recycle slots. The item is
 * only SELECTED into the slot (it stays in the inventory until the server action, e.g. the key is spent with the map); `accepts`
 * answers with the refusal text (null = it fits) using the SAME rules the server enforces, `onDrop` records the choice.
 */
export interface SlotHandler {
  accepts(drag: { uid: string; item: Item; from: ItemLocation }): string | null;
  onDrop(drag: { uid: string; item: Item; from: ItemLocation }): void;
  /** Ghost label on a valid drop ("Use as passage"). */
  tag?: string;
  /** The item was released over the slot but refused (`reason`): the panel may explain more than the cursor hint can (the area modal's "Go to ..." button). */
  onRefused?(drag: { uid: string; item: Item; from: ItemLocation }, reason: string | null): void;
}

/** A merchant stock row being dragged onto the backpack (nothing is removed from anywhere; dropping buys). */
export interface StockDrag {
  /** Why it cannot be bought right now ("Can't afford: ..."), or null. */
  blocked: string | null;
  /** Units the purchase delivers (bulk quantity at the testing merchant). */
  total: number;
  /** Ghost label for a valid drop. */
  tag: string;
  /** Buys it; `at` is the backpack cell it was dropped on. */
  buy(at: { x: number; y: number }): void;
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
  /** Set for a merchant stock row: `uid`/`item` are a preview, the drop buys. */
  stock?: StockDrag;
  /** Set for an item dragged out of the sale window. */
  fromSale?: boolean;
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

export interface MerchantSale { uids: string[]; busy: boolean }

/** Rook's wares board as the server last sent it, with the monotonic time (performance.now) it arrived, for the countdown. */
export interface BoardView { board: MerchantBoard; receivedAt: number; characterId: string }

export interface Local {
  /** Selection only; items stay in the backpack until a confirmed sale. null = Buy tab. */
  merchantSale: Signal<MerchantSale | null>;
  /** Rook's wares board (kept while the panel is closed, so reopening shows it at once and refreshes it). */
  merchantBoard: Signal<BoardView | null>;
  playerMenu: Signal<{ name: string; characterId?: string; x: number; y: number } | null>;
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
  /** Panel-owned drop slots by id (data-slot): registered while their panel is mounted. */
  slots: Map<string, SlotHandler>;
  /** Backpack uids an open panel suggests dragging (the Atlas area modal's subtle highlight); null = no suggestion. */
  fits: Signal<ReadonlySet<string> | null>;
  /** The first-run guide's browser-local state (see ui/guide/live.ts). */
  guide: Signal<GuideLive>;
  /** performance.now() when Esc last closed something: the Esc that follows (a double press) must not open the menu. */
  escClosedAt: number;
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
    merchantSale: signal<MerchantSale | null>(null),
    merchantBoard: signal<BoardView | null>(null),
    playerMenu: signal<{ name: string; characterId?: string; x: number; y: number } | null>(null),
    tooltip,
    drag: signal<DragState | null>(null),
    pointer: { x: 0, y: 0 },
    dialog: signal<DialogSpec | null>(null),
    hint,
    search: signal(''),
    mapTier: signal<number | null>(null),
    slots: new Map<string, SlotHandler>(),
    fits: signal<ReadonlySet<string> | null>(null),
    guide: createGuideLive(),
    escClosedAt: -Infinity,
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
