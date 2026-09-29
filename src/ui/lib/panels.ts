// Panel anchoring rules (PoE-like): the inventory docks right, the other panels dock left (one at a time),
// the menu and help are centred modals. Pure; covered by tests/ui/helpers.test.ts.
// The trade window is a left panel too: hiding it (another left panel, closing the inventory under it) keeps the
// trade open; only an explicit close (its X, Cancel, Esc while it is visible) cancels it (see screens/Game.tsx).
import type { Panel } from '../../contracts/ui';

export const LEFT_PANELS: readonly Panel[] = [
  'stash',
  'character',
  'skills',
  'party',
  'mapDevice',
  'merchant',
  'craftingBench',
  'trade',
];
export const MODAL_PANELS: readonly Panel[] = ['menu', 'help'];

/** Left panels that only make sense next to the inventory (drag items between them). */
export const NEEDS_INVENTORY: readonly Panel[] = ['stash', 'merchant', 'mapDevice', 'craftingBench', 'trade'];

export type PanelSide = 'left' | 'right' | 'modal';

export function panelSide(p: Panel): PanelSide {
  if (p === 'inventory') return 'right';
  if (MODAL_PANELS.includes(p)) return 'modal';
  return 'left';
}

export interface VisiblePanels {
  left: Panel | null;
  right: Panel | null;
  modal: Panel | null;
}

/** The panel shown on each side: the most recently opened one wins. */
export function visiblePanels(open: readonly Panel[]): VisiblePanels {
  const out: VisiblePanels = { left: null, right: null, modal: null };
  for (const p of open) out[panelSide(p)] = p;
  return out;
}

/** The panel Esc should close first: the modal, else the most recently opened visible panel. */
export function topPanel(open: readonly Panel[]): Panel | null {
  const vis = visiblePanels(open);
  if (vis.modal) return vis.modal;
  for (let i = open.length - 1; i >= 0; i--) {
    const p = open[i];
    if (p === vis.left || p === vis.right) return p;
  }
  return null;
}

/**
 * The panel one press of Esc closes: the modal first; then the trade window whenever it is the visible left panel,
 * whichever of trade / inventory opened last (closing it on purpose cancels the trade, see App.tsx); else the top
 * panel.
 */
export function escapePanel(open: readonly Panel[]): Panel | null {
  const vis = visiblePanels(open);
  if (vis.modal) return vis.modal;
  if (vis.left === 'trade') return 'trade';
  return topPanel(open);
}

export interface PanelFix {
  open: Panel[];
  close: Panel[];
}

/**
 * Keep openPanels consistent after a change from `prev` to `next`:
 *   • only the newest left panel stays open (older left panels are closed);
 *   • stash / merchant / map device / crafting bench / trade pull the inventory in when they open, and close
 *     when the player closes the inventory under them.
 */
export function panelFixups(prev: readonly Panel[], next: readonly Panel[]): PanelFix {
  const fix: PanelFix = { open: [], close: [] };
  const lefts = next.filter((p) => panelSide(p) === 'left');
  const keepLeft = lefts.length ? lefts[lefts.length - 1] : null;
  for (const p of lefts) if (p !== keepLeft) fix.close.push(p);

  if (keepLeft && NEEDS_INVENTORY.includes(keepLeft) && !next.includes('inventory')) {
    const inventoryJustClosed = prev.includes('inventory');
    const leftJustOpened = !prev.includes(keepLeft);
    if (inventoryJustClosed && !leftJustOpened) fix.close.push(keepLeft);
    else fix.open.push('inventory');
  }
  return fix;
}
