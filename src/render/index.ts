// WebGL2 renderer entry point (see contracts/render.ts).
//
// Conventions beyond the frozen contract (what callers can rely on):
//  • Call resize(cssW, cssH, devicePixelRatio) once after creation and on every window resize; it sizes the
//    canvas backing store and its CSS size. Virtual view ≈ 360 px tall, integer pixelScale (720p→2, 1080p→3).
//    Where the browser supports it, the renderer also watches the canvas's exact device-pixel box
//    (ResizeObserver 'device-pixel-content-box') and matches the backing store to it, so fractional OS scaling
//    (125 %, 150 %) never makes the compositor resample the canvas.
//  • Layer defaults: sprite → 'world', shapes → 'decal', text → 'top', particles → 'fx'. 'fx' draws after
//    'world' (both y-sorted, ties keep submission order); 'top' keeps submission order.
//  • `emissive` defaults to 1 on the 'fx' layer and 0 elsewhere. Pixels with an emissive mask ignore lighting.
//  • Hit `flash` and sprite `outline`s are unlit flat colour: visible in darkness, crisp, never bloomed.
//  • Readability: opaque (non-additive) 'world' sprites — characters, monsters, props, drops — get an actor lift:
//    extra ambient fill (2.5× the frame ambient in total) and a faint sky rim on their top edge. Silhouettes stay
//    legible outside light pools and scale with the scene's ambient. Put anything that should not stand out on
//    'decal' (corpses) or 'ground'.
//
//  • Pixel snapping and the follow camera. Every sprite snaps to whole virtual pixels (world units × zoom). The
//    camera may sit between pixels: its sub-pixel remainder is applied in device pixels during the upscale, so
//    pans glide. Consequence: a camera that tracks the raw (unsnapped) player position makes the player sprite —
//    the most-watched thing on screen — vibrate by up to 1 virtual px (2–3 device px) every frame, because the
//    sprite moves in whole pixels while the camera moves smoothly. A lerped camera does NOT hide this: at steady
//    speed camera and player share a velocity and the sprite's on-screen offset is round(p) − p + const.
//    Derive the camera from the snapped position instead:
//        camera.x = snapToPixel(player.x, zoom) + lagX      (same for y)
//    where lagX is the smoothed follow offset (camera spring minus player position; fractional is fine). The
//    player is then rock-steady, the world scrolls in whole pixels (the correct pixel-art look), and catch-up,
//    cinematic pans and shake (shakeX/shakeY) still move sub-pixel smoothly.
//
//  • Rotation: rotated sprites snap their rotated top-left corner to the pixel grid, so quarter turns are exact
//    pixel copies (no dropped or doubled rows), and angles step at the sprite's angular pixel resolution
//    (~1/radius rad) to limit rotsprite shimmer on slowly turning projectiles.
//  • Shapes are pixel-stepped (hard edges, Bresenham-style 1px lines and rings), matching the pixel art.
//  • Telegraphs: draw the fill on 'decal' (grounded, under the horde) but the danger rim and the progress ring on
//    'fx' (additive, emissive 0.8–1), so a lethal outline is never hidden by monster sprites.
//  • Frame index: looping sprites wrap, non-looping sprites clamp to the last frame.
//  • text(): y is the vertical middle of capitals; glyph size ignores camera zoom (labels stay readable);
//    `outline: null` disables the default near-black outline. Plates (`box`) have one uniform height,
//    plateHeight(scale, padding), whatever the letters; width is measureText(str, scale) + 2 × padding, top edge
//    at y − GLYPH_ASCENT × scale / 2 − padding. Use these to stack drop labels without overlap.
//  • Particles: bursts with `upward` or `z > 0` fly in height (gravity pulls z, they bounce and settle);
//    otherwise gravity acts along screen y. `drag` is the fraction of speed lost per second. Alpha fades over
//    the last third of life; multi-frame sprites animate over the particle's life. Pool of 8192, recycled.
//  • Lights: overlapping lights roll off smoothly above 1.2× so crowds brighten without bleaching to white.
//    Flicker phase follows position continuously, so moving flickering lights never pop.
//  • registerSprites() may be called again with the same ids (theme/scene swaps): same-size sprites are rewritten
//    in place and resized ones recycle their atlas slots, so the atlas does not grow without bound.
//  • clearColor is the unlit backdrop shown where nothing is drawn.
//  • stats().sprites counts every non-particle quad (sprites, shapes, glyphs, plates).
import type { Renderer } from '../contracts/render';
import { WebGLRenderer } from './renderer';

/** Throws if WebGL2 is unavailable. */
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  return new WebGLRenderer(canvas);
}

export { GLYPH_ASCENT, measureText, PLATE_PADDING, plateHeight } from './font';
export { hexToRgb } from './color';
export { snapToPixel } from './viewport';
