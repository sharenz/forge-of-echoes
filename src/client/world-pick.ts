// What a click on the world means. Priority: a ground item under the cursor (its label plate or sprite, found by
// Presenter.dropAt) is picked up; else an open portal is used; else a hideout object opens its panel; else the
// click is the basic attack. Pure: the app hands in what is under the cursor (resolveWorldClick) and acts on it.
//
// What the last drawn frame highlighted is what the player sees under the cursor, and the camera's cursor lean can
// slide an object away between that frame and the click — so a click close to where the highlight was computed
// uses the highlighted object. A click far from it (a flick from a portal to a monster within one frame) is picked
// where it lands instead: it must never use a stale highlight (a portal costs a portal).
//
// The sim marks clickable props `interactive`: the hideout's map device, stash, merchant and anvil (the Crafting
// Bench), the hideout's map portal while it is open, and a map's return portal. present's pickInteractiveProp finds
// them (the app injects it). An open portal that is not flagged (an older server) is still found by pickPortal.
import type { PropKind, PropView } from '../contracts/sim';
import type { Panel } from '../contracts/ui';

/** Portal pick box (world units): half width and height above the base (38×50 sprite, bottom-centre anchor). */
const PORTAL_HALF_WIDTH = 16;
const PORTAL_HEIGHT = 48;

/** The portal a click may use in this zone: open, and the right kind for where the player stands. */
export function isUsablePortal(p: PropView, zone: 'hideout' | 'map'): boolean {
  return p.state > 0 && (zone === 'hideout' ? p.kind === 'portal' : p.kind === 'returnPortal');
}

/** Id of the usable portal under the world point (x, y), or −1. Nearest silhouette centre wins. */
export function pickPortal(props: readonly PropView[], x: number, y: number, zone: 'hideout' | 'map'): number {
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    if (!isUsablePortal(p, zone)) continue;
    if (x < p.x - PORTAL_HALF_WIDTH || x > p.x + PORTAL_HALF_WIDTH || y < p.y - PORTAL_HEIGHT || y > p.y + 4) continue;
    const d = Math.abs(x - p.x) + Math.abs(y - (p.y - PORTAL_HEIGHT / 2));
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

/** The panel a hideout object opens (the anvil is the Crafting Bench), or null. */
export function panelForProp(kind: PropKind): Panel | null {
  switch (kind) {
    case 'mapDevice':
      return 'mapDevice';
    case 'stash':
      return 'stash';
    case 'merchant':
      return 'merchant';
    case 'debugMerchant':
      return 'debugMerchant';
    case 'anvil':
      return 'craftingBench';
    default:
      return null;
  }
}

export type WorldClick =
  | { kind: 'pickup'; dropId: number }
  | { kind: 'portal'; propId: number }
  | { kind: 'panel'; panel: Panel; propId: number }
  | { kind: 'none' };

const NONE: WorldClick = { kind: 'none' };

/** What a click on prop `propId` does in `zone` (nothing for props that are not clickable there). */
export function propClick(props: readonly PropView[], propId: number, zone: 'hideout' | 'map'): WorldClick {
  if (propId < 0) return NONE;
  const p = props.find((q) => q.id === propId);
  if (!p) return NONE;
  if (p.kind === 'portal' || p.kind === 'returnPortal') return isUsablePortal(p, zone) ? { kind: 'portal', propId } : NONE;
  if (zone !== 'hideout') return NONE;
  const panel = panelForProp(p.kind);
  return panel ? { kind: 'panel', panel, propId } : NONE;
}

/** Finds the interactive prop under a world point (present's pickInteractiveProp), −1 = none. */
export type InteractivePicker = (props: readonly PropView[], x: number, y: number) => number;

/**
 * The clickable prop under the world point (x, y): an interactive prop that a click would use here, else an open
 * portal (for servers that do not flag portals interactive). −1 = none.
 */
export function pickClickableProp(
  props: readonly PropView[],
  x: number,
  y: number,
  zone: 'hideout' | 'map',
  pickInteractive: InteractivePicker,
): number {
  const id = pickInteractive(props, x, y);
  if (id >= 0 && propClick(props, id, zone).kind !== 'none') return id;
  return pickPortal(props, x, y, zone);
}

/** A click at most this far (CSS px, per axis) from the last frame's hover point may use its highlighted item label. */
export const HOVER_DROP_SLOP_PX = 3;
/**
 * A click at most this far (CSS px, per axis) from the last frame's hover point uses its highlighted object: the
 * camera leans toward the cursor, so a hideout object can slide a little away from the pointer before the click.
 */
export const HOVER_PROP_SLOP_PX = 24;

/** What the last drawn frame showed under the cursor (−1 = nothing), and the CSS point it was computed for. */
export interface HoverSnapshot {
  x: number;
  y: number;
  dropId: number;
  propId: number;
}

export interface WorldClickInput {
  /** CSS point of the click. */
  x: number;
  y: number;
  zone: 'hideout' | 'map';
  props: readonly PropView[];
  /** The ground item under the click point in the last drawn label layout (Presenter.dropAt), −1 = none. */
  dropAt: number;
  /** The last drawn frame's hover. */
  hover: Readonly<HoverSnapshot>;
  /** The ground item is still in the replica (a click on one that just vanished falls through to the rest). */
  hasDrop(dropId: number): boolean;
  /** The clickable prop at the click point itself (pickClickableProp at its world position), −1 = none. Lazy. */
  propAt(): number;
}

function nearHover(c: WorldClickInput, slop: number): boolean {
  return Math.abs(c.x - c.hover.x) <= slop && Math.abs(c.y - c.hover.y) <= slop;
}

/**
 * Route a left click on the world: a ground item wins (a click on a label never fires the basic attack), then an
 * open portal or a hideout object, else `none` (the basic attack). The last frame's highlight counts only for a
 * click near the point it was computed for; otherwise everything is picked where the click lands.
 */
export function resolveWorldClick(c: WorldClickInput): WorldClick {
  let dropId = c.dropAt;
  if (dropId < 0 && c.hover.dropId >= 0 && nearHover(c, HOVER_DROP_SLOP_PX)) dropId = c.hover.dropId;
  if (dropId >= 0 && c.hasDrop(dropId)) return { kind: 'pickup', dropId };
  if (c.hover.propId >= 0 && nearHover(c, HOVER_PROP_SLOP_PX)) {
    const highlighted = propClick(c.props, c.hover.propId, c.zone);
    if (highlighted.kind !== 'none') return highlighted;
  }
  return propClick(c.props, c.propAt(), c.zone);
}
