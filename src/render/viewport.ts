// Virtual-resolution and camera math (pure).
//
// The world is rendered into a low-resolution "virtual" target (~360 px tall) that is upscaled to the canvas by an
// integer `pixelScale` with nearest sampling. The camera is split into an integer virtual-pixel origin (used to
// place every sprite on the world pixel grid, so nothing shimmers) and a sub-pixel remainder that is applied in
// device pixels during the final upscale (so the camera still glides smoothly).
import type { Camera } from '../contracts/render';

export const TARGET_VIEW_HEIGHT = 360;

export interface Viewport {
  cssWidth: number;
  cssHeight: number;
  /** Canvas backing-store size in device pixels. */
  deviceWidth: number;
  deviceHeight: number;
  /** deviceWidth / cssWidth (actual ratio after rounding). */
  dpr: number;
  pixelScale: number;
  /** Virtual view size: ceil(device / pixelScale). */
  viewWidth: number;
  viewHeight: number;
  /** Device-pixel offset of the virtual view's top-left (<= 0: the view overhangs by < one virtual pixel). */
  offsetX: number;
  offsetY: number;
  /** Size of the offscreen targets: one extra virtual pixel on each axis for the sub-pixel camera shift. */
  targetWidth: number;
  targetHeight: number;
}

/**
 * Integer upscale factor whose virtual height is closest (in ratio) to `target`.
 * 720 → 2 (360), 1080 → 3 (360), 1440 → 4 (360), 900 → 3 (300).
 */
export function choosePixelScale(deviceHeight: number, target = TARGET_VIEW_HEIGHT): number {
  const h = Math.max(1, deviceHeight);
  const lo = Math.max(1, Math.floor(h / target));
  const hi = lo + 1;
  const err = (s: number) => Math.abs(Math.log(h / s / target));
  return err(hi) < err(lo) ? hi : lo;
}

/**
 * Viewport for a CSS box. `exactDevice` is the canvas's real device-pixel box when the browser reports it
 * (ResizeObserver `devicePixelContentBoxSize`); without it the backing store is round(css × dpr), which can be
 * one pixel off the true box at fractional ratios (125 %, 150 %) and makes the compositor resample the canvas.
 */
export function computeViewport(
  cssWidth: number, cssHeight: number, devicePixelRatio: number, target = TARGET_VIEW_HEIGHT,
  exactDevice?: { width: number; height: number } | null,
): Viewport {
  const cw = Math.max(1, cssWidth);
  const ch = Math.max(1, cssHeight);
  const ratio = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const deviceWidth = Math.max(1, Math.round(exactDevice ? exactDevice.width : cw * ratio));
  const deviceHeight = Math.max(1, Math.round(exactDevice ? exactDevice.height : ch * ratio));
  const pixelScale = choosePixelScale(deviceHeight, target);
  const viewWidth = Math.ceil(deviceWidth / pixelScale);
  const viewHeight = Math.ceil(deviceHeight / pixelScale);
  return {
    cssWidth: cw,
    cssHeight: ch,
    deviceWidth,
    deviceHeight,
    dpr: deviceWidth / cw,
    pixelScale,
    viewWidth,
    viewHeight,
    offsetX: Math.floor((deviceWidth - viewWidth * pixelScale) / 2),
    offsetY: Math.floor((deviceHeight - viewHeight * pixelScale) / 2),
    targetWidth: viewWidth + 1,
    targetHeight: viewHeight + 1,
  };
}

/** Per-frame camera placement in target space. */
export interface CameraFrame {
  zoom: number;
  /** Integer zoomed-world pixel at target column/row 0. target = world * zoom - origin. */
  originX: number;
  originY: number;
  /** Sub-pixel camera remainder, quantised to device pixels: a multiple of 1/pixelScale in [0, 1). */
  fracX: number;
  fracY: number;
}

export function createCameraFrame(): CameraFrame {
  return { zoom: 1, originX: 0, originY: 0, fracX: 0, fracY: 0 };
}

function splitAxis(o: number, scale: number): [number, number] {
  let i = Math.floor(o);
  let d = Math.round((o - i) * scale);
  if (d >= scale) {
    i += 1;
    d -= scale;
  }
  return [i, d / scale];
}

/** Resolve a camera into integer origin + quantised fraction (writes into `out`, no allocation of note). */
export function resolveCamera(camera: Camera, vp: Viewport, out: CameraFrame = createCameraFrame()): CameraFrame {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const cx = (camera.x + (camera.shakeX ?? 0)) * zoom;
  const cy = (camera.y + (camera.shakeY ?? 0)) * zoom;
  const [ix, fx] = splitAxis(cx - vp.viewWidth / 2, vp.pixelScale);
  const [iy, fy] = splitAxis(cy - vp.viewHeight / 2, vp.pixelScale);
  out.zoom = zoom;
  out.originX = ix;
  out.originY = iy;
  out.fracX = fx;
  out.fracY = fy;
  return out;
}

/**
 * The world position at which the renderer actually draws a sprite pivot at `v`: sprites snap to whole virtual
 * pixels (world units × zoom). Derive a follow camera from this rather than from the raw position, or the
 * followed sprite vibrates by up to one virtual pixel against the smoothly moving camera.
 * `anchor` (the sprite's anchor × scale, after flipping) only matters when it is fractional.
 */
export function snapToPixel(v: number, zoom = 1, anchor = 0): number {
  const z = zoom > 0 ? zoom : 1;
  const a = anchor * z;
  return (Math.round(v * z - a) + a) / z;
}

const TAU = Math.PI * 2;

/**
 * Quantise a rotation to the sprite's angular pixel resolution: steps of about 1/radius radians, so each step
 * moves the sprite's farthest pixel by roughly one pixel. Slowly turning sprites then change shape only when a
 * pixel would actually move (less rotsprite shimmer). The step count is a multiple of 4, so the cardinal angles
 * (exact, lossless pixel copies) are always reachable; angles that round to a full turn return exactly 0.
 */
export function snapRotation(rotation: number, radius: number): number {
  if (!Number.isFinite(rotation)) return 0;
  if (!(radius > 0.5)) return rotation;
  const steps = 4 * Math.max(1, Math.ceil((TAU * radius) / 4));
  let k = Math.round((rotation / TAU) * steps) % steps;
  if (k < 0) k += steps;
  if (k === 0) return 0;
  // Cardinal angles exactly (π/2 multiples), so cos/sin in the shader are as clean as possible.
  if (k % (steps / 4) === 0) return (k / (steps / 4)) * (Math.PI / 2);
  return (k / steps) * TAU;
}

/**
 * Pivot position for a rotated quad such that its top-left corner (local 0,0) lands on the pixel grid.
 * Texel (i, j) is drawn at corner + R·(i, j), so at multiples of π/2 every pixel centre maps onto a texel centre
 * (no dropped or doubled rows), and near-zero angles match the unrotated placement. `(ax, ay)` is the pivot
 * inside the quad in target pixels. Writes into `out`.
 */
export function snapRotatedPivot(
  px: number, py: number, ax: number, ay: number, rotation: number, out: { x: number; y: number },
): { x: number; y: number } {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const ox = -(c * ax - s * ay);
  const oy = -(s * ax + c * ay);
  out.x = Math.round(px + ox) - ox;
  out.y = Math.round(py + oy) - oy;
  return out;
}

/** CSS pixel → world coordinate for the given camera (inverse of the final upscale). */
export function screenToWorld(vp: Viewport, camera: Camera, cssX: number, cssY: number): { x: number; y: number } {
  const cam = resolveCamera(camera, vp);
  const vx = (cssX * vp.dpr - vp.offsetX) / vp.pixelScale + cam.fracX;
  const vy = (cssY * vp.dpr - vp.offsetY) / vp.pixelScale + cam.fracY;
  return { x: (vx + cam.originX) / cam.zoom, y: (vy + cam.originY) / cam.zoom };
}

/** World coordinate → CSS pixel for the given camera. */
export function worldToScreen(vp: Viewport, camera: Camera, x: number, y: number): { x: number; y: number } {
  const cam = resolveCamera(camera, vp);
  const vx = x * cam.zoom - cam.originX - cam.fracX;
  const vy = y * cam.zoom - cam.originY - cam.fracY;
  return { x: (vx * vp.pixelScale + vp.offsetX) / vp.dpr, y: (vy * vp.pixelScale + vp.offsetY) / vp.dpr };
}
