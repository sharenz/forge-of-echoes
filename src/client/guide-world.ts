// Where the first-run guide's world markers go (docs/onboarding-ux.md 6.3): the screen position of the props a marker or a name plate
// can point at (the hideout objects, the portals, the reward chest), from the replicated props and the renderer's projection. Pure; the
// app hands in `project` and the UI reads the result once per animation frame (UiWorld.anchors).
import type { WorldAnchor } from '../contracts/guide';
import type { PropKind, PropView } from '../contracts/sim';

/** The camera's extra lean in a hideout (world units, north) so the Map Device is always fully on screen at 1280x720 and 1024x600. */
export const HIDEOUT_CAMERA_BIAS_Y = -52;
/** Short windows (1024x600 shows only 300 world units of height) lean a little further so the table keeps its top. */
export const HIDEOUT_CAMERA_BIAS_SHORT_Y = -68;

/** The hideout camera's northward lean for a window `cssHeight` px tall. */
export function hideoutCameraBias(cssHeight: number): number {
  return cssHeight < 680 ? HIDEOUT_CAMERA_BIAS_SHORT_Y : HIDEOUT_CAMERA_BIAS_Y;
}

/** Footprint radius and sprite height (world units) of the props the guide can mark. */
export const ANCHOR_SIZES: Partial<Record<PropKind, { radius: number; height: number }>> = {
  mapDevice: { radius: 22, height: 44 },
  stash: { radius: 14, height: 28 },
  merchant: { radius: 14, height: 48 },
  anvil: { radius: 16, height: 30 },
  portal: { radius: 18, height: 52 },
  returnPortal: { radius: 18, height: 52 },
  chest: { radius: 14, height: 26 },
};

/**
 * The anchors of `props` in CSS px. `project` is renderer.worldToScreen under the last frame's camera. Only props the guide knows;
 * a closed portal (state 0) is skipped. Reuses `out` (the UI reads it every frame).
 */
export function buildAnchors(
  props: readonly PropView[], project: (x: number, y: number) => { x: number; y: number }, out: WorldAnchor[] = [],
): WorldAnchor[] {
  out.length = 0;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    const size = ANCHOR_SIZES[p.kind];
    if (!size) continue;
    if ((p.kind === 'portal' || p.kind === 'returnPortal') && p.state <= 0) continue;
    const a = project(p.x, p.y);
    const b = project(p.x, p.y + 10);
    const scale = Math.max(0.1, Math.abs(b.y - a.y) / 10);
    out.push({ id: p.id, kind: p.kind, x: a.x, y: a.y, state: p.state, radius: size.radius * scale, height: size.height * scale });
  }
  return out;
}
