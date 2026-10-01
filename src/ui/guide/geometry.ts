// Pure geometry and selection for the guide's world layer (docs/onboarding-ux.md 6.3): which name plates are shown, which anchor the
// marker sits on, and where an off-screen target's edge arrow goes. No DOM: the component feeds it screen positions once per frame.
import type { GuideProp, WorldAnchor } from '../../contracts/guide';
import type { PropKind } from '../../contracts/sim';
import type { GuideTargetKind } from './steps';
import type { GuideOverrideKind } from './live';

export type MarkerKind = GuideTargetKind | GuideOverrideKind;

/** The prop kind a marker target points at. */
export const MARKER_PROP: Record<MarkerKind, PropKind> = {
  mapDevice: 'mapDevice', portal: 'portal', chest: 'chest', returnPortal: 'returnPortal', anvil: 'anvil', merchant: 'merchant',
};

/** The guide prop (used-state) of a hideout object. */
export const PROP_OF_KIND: Partial<Record<PropKind, GuideProp>> = { mapDevice: 'mapDevice', stash: 'stash', anvil: 'anvil', merchant: 'merchant' };

export interface PlateInput {
  /** The tutorial is active (a veteran, a skipped or a finished guide shows no plates). */
  active: boolean;
  zone: 'hideout' | 'map' | null;
  ownHideout: boolean;
  used: readonly GuideProp[];
  /** The reward chest and return portal exist (a cleared map). */
  cleared: boolean;
  chest: 'closed' | 'open' | null;
  /** The marker's target kind (its anchor always gets its own plate). */
  marker: MarkerKind | null;
}

/** The prop kinds that carry a name plate right now. */
export function plateKinds(i: PlateInput): PropKind[] {
  const out = new Set<PropKind>();
  if (i.active && i.zone === 'hideout' && i.ownHideout) {
    for (const k of ['mapDevice', 'stash', 'anvil', 'merchant'] as const) if (!i.used.includes(PROP_OF_KIND[k]!)) out.add(k);
  }
  if (i.active && i.zone === 'map' && i.cleared) {
    if (i.chest === 'closed') out.add('chest');
    out.add('returnPortal');
  }
  // The hideout portal already carries its own "8 portals" label in the world.
  if (i.marker && MARKER_PROP[i.marker] !== 'portal') out.add(MARKER_PROP[i.marker]);
  return [...out];
}

export interface Rect { left: number; top: number; right: number; bottom: number }

/** The part of the screen a marker counts as "on screen" in: inside the margins and above the command deck. */
export function visibleRect(width: number, height: number, deckClear: number, margin = 12, top = 64): Rect {
  return { left: margin, top, right: Math.max(margin + 1, width - margin), bottom: Math.max(top + 1, height - deckClear) };
}

export function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export interface EdgePoint { x: number; y: number; angle: number }

/** Where the edge arrow sits for an off-screen target, and the angle (radians, 0 = right) it points: the line from the rect's centre to the target, clipped to the rect. */
export function edgePoint(r: Rect, x: number, y: number): EdgePoint {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const angle = Math.atan2(dy, dx);
  if (dx === 0 && dy === 0) return { x: cx, y: cy, angle };
  const halfW = (r.right - r.left) / 2;
  const halfH = (r.bottom - r.top) / 2;
  const t = Math.min(dx !== 0 ? halfW / Math.abs(dx) : Infinity, dy !== 0 ? halfH / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t, angle };
}

/** A name plate's top-left, centred above the sprite and clamped inside the screen so it is never clipped by the top edge. */
export function platePosition(a: Pick<WorldAnchor, 'x' | 'y' | 'height'>, width: number, plateW: number, plateH: number, margin = 24, gap = 8, below = false): { x: number; y: number } {
  const x = Math.min(Math.max(a.x, margin + plateW / 2), Math.max(margin + plateW / 2, width - margin - plateW / 2));
  // `below`: under the base (the marked object keeps its top free for the chevron)
  const y = below ? a.y + gap + 6 : Math.max(margin, a.y - a.height - gap - plateH);
  return { x, y };
}

/** The anchor a marker sits on: the first of its prop kind (closed chests only for the chest marker). */
export function pickAnchor(anchors: readonly WorldAnchor[], marker: MarkerKind): WorldAnchor | null {
  const kind = MARKER_PROP[marker];
  for (const a of anchors) if (a.kind === kind && (kind !== 'chest' || a.state === 0)) return a;
  return null;
}
