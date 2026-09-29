// Lighting, dithering, noise and outlining helpers shared by every generator.
//
// The key tool is `Sculpt`: a tiny 2.5D renderer. Shapes (ellipsoids, tapered capsules, bevelled polygons)
// are layered back-to-front; each pixel takes the normal of its front-most shape, is lit by one light from the
// top-left-front, and is quantised onto that shape's hue-shifted ramp (with sparse ordered dithering on the
// band edges). Because a creature's pose is just a set of shape transforms, every animation frame is drawn by
// the same function — identity never drifts between frames.
import { hashU32 } from '../core/rng';
import { C, type Color, type Ramp } from './palette';
import { Raster, forPolygon, mix } from './raster';

// ---------------------------------------------------------------------------
// Noise & dithering
// ---------------------------------------------------------------------------

/** Deterministic hash noise in [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  return hashU32((Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ hashU32(seed)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). `scale` is the cell size in pixels. Optionally tiles with period `wrap` (in cells). */
export function valueNoise(x: number, y: number, scale: number, seed = 0, wrap = 0): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (v: number): number => (wrap > 0 ? ((v % wrap) + wrap) % wrap : v);
  const a = hash2(w(ix), w(iy), seed);
  const b = hash2(w(ix + 1), w(iy), seed);
  const c = hash2(w(ix), w(iy + 1), seed);
  const d = hash2(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Quantise a continuous ramp position to an index. Only values close to a band edge are dithered (2x2 checker),
 * which keeps dithering sparse and pixel-art-like rather than noisy.
 */
export function quantize(v: number, x: number, y: number, n: number, band = 0.14): number {
  const lo = Math.floor(v);
  const f = v - lo;
  let idx: number;
  if (f > 0.5 - band && f < 0.5 + band) idx = ((x + y) & 1) === 0 ? lo + 1 : lo;
  else idx = f >= 0.5 ? lo + 1 : lo;
  return idx < 0 ? 0 : idx >= n ? n - 1 : idx;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

/** Main light: top-left, slightly in front of the subject. */
const LIGHT = normalize3(-0.55, -0.72, 0.6);

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Brightness 0..1 for a surface normal (already normalised). */
export function lambert(nx: number, ny: number, nz: number, ambient = 0.2, bounce = 0.1): number {
  const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  // weak bounce light from the ground keeps lower-right edges from dying into pure black
  const b = Math.max(0, ny * 0.7 + nx * 0.3) * bounce;
  return Math.min(1, ambient + (1 - ambient) * Math.max(0, d) + b);
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

export interface OutlineOpts {
  /** Outline colour on the shadow side (default ink). */
  color?: Color;
  /** Lit-side (top/left) outline uses a dark version of the neighbouring colour instead of ink ("sel-out"). */
  selective?: boolean;
  /** Also fill diagonal corners (thicker, rounder outline). */
  corners?: boolean;
}

/** Adds a 1px outline around every opaque region of `r` (in place). */
export function outline(r: Raster, opts: OutlineOpts = {}): void {
  const ink = opts.color ?? C.ink;
  const a = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) a[y * r.w + x] = r.alpha(x, y) > 40 ? 1 : 0;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= r.w || y >= r.h ? 0 : a[y * r.w + x]);
  const out: [number, number, Color][] = [];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (at(x, y)) continue;
      const right = at(x + 1, y);
      const down = at(x, y + 1);
      const left = at(x - 1, y);
      const up = at(x, y - 1);
      let hit = right || down || left || up;
      if (!hit && opts.corners) hit = at(x + 1, y + 1) || at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1);
      if (!hit) continue;
      let col = ink;
      if (opts.selective && (right || down) && !left && !up) {
        const n = right ? r.get(x + 1, y) : r.get(x, y + 1);
        col = mix(n, ink, 0.72);
      }
      out.push([x, y, col]);
    }
  }
  for (const [x, y, c] of out) r.set(x, y, c);
}

// ---------------------------------------------------------------------------
// Sculpt: layered shaded primitives
// ---------------------------------------------------------------------------

export interface PrimStyle {
  ramp: Ramp;
  /** Added to the ramp position (in ramp steps). Positive = lighter. */
  bias?: number;
  /** Multiplies the lit range (1 = full ramp). */
  contrast?: number;
  /** Ambient floor (0..1). */
  ambient?: number;
  /** Per-pixel ramp offset (texture): return e.g. ±1 for grain. */
  tex?: (x: number, y: number) => number;
  /** Pixels of this primitive are also written to the emissive layer with this strength (0..255). */
  glow?: number;
  /** Receives contact shadow from primitives drawn after it (default true). */
  ao?: boolean;
  /** Tilt of flattened surfaces: how much the xy normal counts (default 1). Lower = flatter, more frontal. */
  round?: number;
  /** Polygons only: 0..1 blend towards a vertical-cylinder normal computed from each row's span (skirts, pillars). */
  cyl?: number;
  /** Width of the dithered zone around band edges (0 = hard bands, default 0.12). */
  dither?: number;
}

type PrimShape =
  | { k: 'ell'; cx: number; cy: number; rx: number; ry: number; rot: number }
  | { k: 'cap'; x0: number; y0: number; x1: number; y1: number; r0: number; r1: number }
  | { k: 'poly'; pts: readonly (readonly [number, number])[]; bevel: number; nx: number; ny: number };

type Prim = PrimShape & PrimStyle;

export class Sculpt {
  private prims: Prim[] = [];

  /** Number of primitives added so far (the index the next one will get in the owner buffer). */
  get size(): number {
    return this.prims.length;
  }

  /** Ellipsoid (optionally rotated, radians). */
  ell(cx: number, cy: number, rx: number, ry: number, style: PrimStyle, rot = 0): this {
    this.prims.push({ k: 'ell', cx, cy, rx, ry, rot, ...style });
    return this;
  }

  /** Tapered capsule (limb/tube) from (x0,y0,r0) to (x1,y1,r1). */
  cap(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, style: PrimStyle): this {
    this.prims.push({ k: 'cap', x0, y0, x1, y1, r0, r1, ...style });
    return this;
  }

  /** Polygon with rounded bevelled edges; (nx, ny) tilts the flat face (e.g. ny=-0.4 faces up towards the light). */
  poly(pts: readonly (readonly [number, number])[], style: PrimStyle, bevel = 2, nx = 0, ny = 0): this {
    this.prims.push({ k: 'poly', pts, bevel, nx, ny, ...style });
    return this;
  }

  /** Render into `c` (colour) and optionally `e` (emissive). Returns the owner buffer for detail passes. */
  render(c: Raster, e?: Raster): Int16Array {
    const W = c.w;
    const H = c.h;
    const owner = new Int16Array(W * H).fill(-1);
    const nrm = new Float32Array(W * H * 3);
    const setN = (x: number, y: number, i: number, nx: number, ny: number, nz: number): void => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const p = y * W + x;
      owner[p] = i;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[p * 3] = nx / l;
      nrm[p * 3 + 1] = ny / l;
      nrm[p * 3 + 2] = nz / l;
    };

    this.prims.forEach((p, i) => {
      const round = p.round ?? 1;
      if (p.k === 'ell') {
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);
        const R = Math.max(p.rx, p.ry) + 1;
        for (let y = Math.floor(p.cy - R); y <= Math.ceil(p.cy + R); y++) {
          for (let x = Math.floor(p.cx - R); x <= Math.ceil(p.cx + R); x++) {
            const px = x + 0.5 - p.cx;
            const py = y + 0.5 - p.cy;
            const u = (px * cos + py * sin) / p.rx;
            const v = (-px * sin + py * cos) / p.ry;
            const d = u * u + v * v;
            if (d > 1) continue;
            // rotate the local normal back into screen space
            const nx = (u * cos - v * sin) * round;
            const ny = (u * sin + v * cos) * round;
            setN(x, y, i, nx, ny, Math.sqrt(Math.max(0, 1 - d)));
          }
        }
      } else if (p.k === 'cap') {
        const R = Math.max(p.r0, p.r1) + 1;
        const minX = Math.floor(Math.min(p.x0, p.x1) - R);
        const maxX = Math.ceil(Math.max(p.x0, p.x1) + R);
        const minY = Math.floor(Math.min(p.y0, p.y1) - R);
        const maxY = Math.ceil(Math.max(p.y0, p.y1) + R);
        const dx = p.x1 - p.x0;
        const dy = p.y1 - p.y0;
        const len2 = dx * dx + dy * dy || 1e-6;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const t = Math.max(0, Math.min(1, ((px - p.x0) * dx + (py - p.y0) * dy) / len2));
            const qx = px - (p.x0 + dx * t);
            const qy = py - (p.y0 + dy * t);
            const r = p.r0 + (p.r1 - p.r0) * t;
            const d = Math.hypot(qx, qy);
            if (d > r) continue;
            const s = d / Math.max(r, 0.01);
            setN(x, y, i, (qx / Math.max(r, 0.01)) * round, (qy / Math.max(r, 0.01)) * round, Math.sqrt(Math.max(0, 1 - s * s)));
          }
        }
      } else {
        // rasterise into a local mask, then derive a rounded bevel from the distance to the edge
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of p.pts) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        const ox = Math.floor(minX) - 1;
        const oy = Math.floor(minY) - 1;
        const mw = Math.ceil(maxX) - ox + 2;
        const mh = Math.ceil(maxY) - oy + 2;
        const mask = new Uint8Array(mw * mh);
        forPolygon(p.pts, (x, y) => {
          const lx = x - ox;
          const ly = y - oy;
          if (lx >= 0 && ly >= 0 && lx < mw && ly < mh) mask[ly * mw + lx] = 1;
        });
        const dist = chamfer(mask, mw, mh);
        const b = Math.max(0.5, p.bevel);
        const hAt = (lx: number, ly: number): number => {
          if (lx < 0 || ly < 0 || lx >= mw || ly >= mh) return 0;
          const d = dist[ly * mw + lx];
          if (d <= 0) return 0;
          const t = Math.min(d, b) / b;
          return Math.sqrt(1 - (1 - t) * (1 - t));
        };
        const cyl = p.cyl ?? 0;
        for (let ly = 0; ly < mh; ly++) {
          let xa = -1;
          let xb = -1;
          if (cyl > 0) {
            for (let lx = 0; lx < mw; lx++) {
              if (!mask[ly * mw + lx]) continue;
              if (xa < 0) xa = lx;
              xb = lx;
            }
          }
          for (let lx = 0; lx < mw; lx++) {
            if (!mask[ly * mw + lx]) continue;
            const gx = (hAt(lx + 1, ly) - hAt(lx - 1, ly)) * 0.5;
            const gy = (hAt(lx, ly + 1) - hAt(lx, ly - 1)) * 0.5;
            let nx = -gx * 1.6 + p.nx;
            let ny = -gy * 1.6 + p.ny;
            let nz = 1;
            if (cyl > 0 && xb > xa) {
              const u = Math.max(-1, Math.min(1, ((lx + 0.5 - (xa + xb + 1) / 2) / ((xb - xa + 1) / 2))));
              nx = nx * (1 - cyl) + u * cyl;
              ny = ny * (1 - cyl) + p.ny * cyl;
              nz = (1 - cyl) + Math.sqrt(Math.max(0, 1 - u * u)) * cyl;
            }
            setN(lx + ox, ly + oy, i, nx * round, ny * round, nz);
          }
        }
      }
    });

    // shade
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        const i = owner[p];
        if (i < 0) continue;
        const pr = this.prims[i];
        const n = pr.ramp.length;
        const b = lambert(nrm[p * 3], nrm[p * 3 + 1], nrm[p * 3 + 2], pr.ambient ?? 0.2);
        let v = b * (n - 1) * (pr.contrast ?? 1) + (pr.bias ?? 0);
        if (pr.tex) v += pr.tex(x, y);
        // contact shadow cast by later (front) primitives onto this one: light comes from the top-left
        if (pr.ao !== false) {
          const up = y > 0 ? owner[p - W] : -1;
          const lf = x > 0 ? owner[p - 1] : -1;
          if (up > i || lf > i) v -= 1;
        }
        const idx = quantize(v, x, y, n, pr.dither ?? 0.12);
        c.set(x, y, pr.ramp[idx]);
        if (e && pr.glow) e.set(x, y, (pr.ramp[idx] & 0xffffff00) | Math.min(255, Math.round(pr.glow * (0.55 + (0.45 * idx) / Math.max(1, n - 1)))));
      }
    }
    return owner;
  }
}

/** Two-pass chamfer distance (in pixels) from each inside pixel to the nearest outside pixel. */
export function chamfer(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const D1 = 1;
  const D2 = 1.414;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + D1, at(x, y - 1) + D1, at(x - 1, y - 1) + D2, at(x + 1, y - 1) + D2);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + D1, at(x, y + 1) + D1, at(x + 1, y + 1) + D2, at(x - 1, y + 1) + D2);
    }
  }
  return d;
}
