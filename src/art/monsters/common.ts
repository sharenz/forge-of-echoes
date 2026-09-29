// Shared helpers for monster sprite sets: animation tables, corpse treatment and glow details.
import type { SpriteDef } from '../../contracts/art';
import { Frame, toSprite } from '../frame';
import { C, type Color } from '../palette';
import { ca, lineCells, luma, mix } from '../raster';

export interface Anim {
  frames: Frame[];
  fps: number;
  loop: boolean;
}

export const anim = (frames: Frame[], fps: number, loop: boolean): Anim => ({ frames, fps, loop });

export interface MonsterSet {
  id: string;
  anchorX: number;
  anchorY: number;
  anims: Record<string, Anim>;
}

export function monsterSprites(set: MonsterSet): SpriteDef[] {
  return Object.entries(set.anims).map(([name, a]) =>
    toSprite(`monster/${set.id}/${name}`, a.frames, { anchorX: set.anchorX, anchorY: set.anchorY, fps: a.fps, loop: a.loop }),
  );
}

/** Outline a freshly drawn frame (monsters use the selective dark outline). */
export function finish(f: Frame): Frame {
  f.outline({ selective: true });
  return f;
}

const ASH_STEPS: Color[] = [C.ink, C.coal, C.char, C.iron, C.stone, C.stoneLight, C.ashGrey];

/**
 * Burn a frame down towards ash: colours move onto the grey ash ramp by luminance (t = 0..1) and the glow
 * fades to `glowLeft` of its strength. Used for corpses so every monster "crumbles to ash" consistently.
 */
export function ashify(src: Frame, t: number, glowLeft: number): Frame {
  const f = src.clone();
  f.c.map((c) => {
    const l = luma(c);
    const g = ASH_STEPS[Math.max(0, Math.min(ASH_STEPS.length - 1, Math.round(l * (ASH_STEPS.length - 1) * 1.15)))];
    return (mix(c, g, t) & 0xffffff00) | ca(c);
  });
  f.e.map((c) => (c & 0xffffff00) | Math.round(ca(c) * glowLeft));
  return f;
}

/** Squash a frame vertically towards its bottom row by `k` (0..1): corpse collapse. */
export function squash(src: Frame, k: number, groundY: number): Frame {
  const f = new Frame(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      // destination row y samples source row groundY - (groundY - y)/k
      const sy = Math.round(groundY - (groundY - y) / Math.max(0.05, k));
      if (sy < 0 || sy >= src.h) continue;
      const c = src.c.get(x, sy);
      if (ca(c) === 0) continue;
      f.c.set(x, y, c);
      f.e.set(x, y, src.e.get(x, sy));
    }
  }
  return f;
}

/** A glowing eye: hot core, optional warm neighbour. */
export function eye(f: Frame, x: number, y: number, core: Color, halo?: Color, strength = 255): void {
  f.glow(Math.round(x), Math.round(y), core, strength);
  if (halo !== undefined) f.glow(Math.round(x) + 1, Math.round(y), halo, strength * 0.7);
}

/** Glowing cracks along a polyline, only where the frame already has pixels. */
export function cracks(f: Frame, pts: readonly (readonly [number, number])[], cols: readonly Color[], strength = 220): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(Math.abs(Math.round(x1) - Math.round(x0)), Math.abs(Math.round(y1) - Math.round(y0)), 1);
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / n);
      const y = Math.round(y0 + ((y1 - y0) * k) / n);
      if (!f.c.opaque(x, y)) continue;
      f.glow(x, y, cols[(i + k) % cols.length], strength);
    }
  }
}

/** Set a pixel only if it is already part of the figure. */
export function onBody(f: Frame, x: number, y: number, c: Color): void {
  if (f.c.opaque(Math.round(x), Math.round(y))) f.c.set(Math.round(x), Math.round(y), c);
}

export const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);

/** Legend entry for `stamp`: a plain colour, or a glowing colour with emissive strength. */
export type Ink = Color | { c: Color; glow: number };

/**
 * Stamp a hand-authored pixel map (one string per row, one character per pixel, '.' or ' ' = transparent) at
 * (x0, y0). `flip` mirrors the map horizontally. Glowing legend entries also write the emissive layer.
 */
export function stamp(f: Frame, rows: readonly string[], legend: Readonly<Record<string, Ink>>, x0: number, y0: number, flip = false): void {
  const w = Math.max(...rows.map((r) => r.length));
  rows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const ink = legend[ch];
      if (ink === undefined) throw new Error(`stamp: no legend entry for '${ch}'`);
      const x = Math.round(x0) + (flip ? w - 1 - i : i);
      const yy = Math.round(y0) + y;
      if (typeof ink === 'number') {
        f.c.set(x, yy, ink);
        f.e.set(x, yy, 0);
      } else f.glow(x, yy, ink.c, ink.glow);
    }
  });
}

/** A 1 px pixel line with a colour picked per step (t = 0 at `a`, 1 at `b`). */
export function strokeLine(f: Frame, a: readonly [number, number], b: readonly [number, number], col: (t: number) => Color): void {
  const x0 = Math.round(a[0]);
  const y0 = Math.round(a[1]);
  const x1 = Math.round(b[0]);
  const y1 = Math.round(b[1]);
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  lineCells(x0, y0, x1, y1, (x, y) => {
    const t = Math.max(Math.abs(x - x0), Math.abs(y - y0)) / n;
    f.c.set(x, y, col(t));
    f.e.set(x, y, 0);
  });
}
