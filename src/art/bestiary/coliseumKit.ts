// Shared materials and helpers for the Iron Coliseum family (GAME_SPEC §14): rust, blackened iron, sand-worn
// leather, blood and bronze accents. Every ramp is built from the one palette (src/art/palette.ts), shaded by the
// same Sculpt light (top-left-front) and outlined like the Ashen Forge roster, so both rosters read as one game.
//
// Readability on the sand floor (sand/sandMid, a warm mid value): bodies sit darker than the sand and carry a light
// top-left rim; iron reads cool against the warm floor; bronze and blood are small accents; ember glows (eyes,
// visor slits, branded iron) are the only emissive focal points.
import { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { lineCells } from '../raster';
import { hash2, type PrimStyle, type Sculpt } from '../shade';

export type Pt = [number, number];

// --- ramps -------------------------------------------------------------------------------------------------------

/** Blackened iron (cool) — helmets, plates, manacles. */
export const IRON: Ramp = RAMPS.metal;
/** Iron flecked with rust: the metal of the arena. */
export const RUST_IRON: Ramp = [C.metalDeep, C.metalDark, C.rustDark, C.metalMid, C.metalLight, C.metalHi];
/** Bronze trims, bosses and buckles. */
export const BRONZE: Ramp = [C.rustDeep, C.goldDark, C.rustLight, C.ochre, C.gold, C.goldHi];
/** Worn dark leather: straps, gambesons, boots. */
export const LEATHER: Ramp = [C.ink, C.woodDeep, C.woodDark, C.wood, C.woodLight];
/** Sun-dark gladiator skin. */
export const TAN: Ramp = [C.rustDeep, C.woodDark, C.rust, C.rustLight, C.woodHi, C.sandLight];
/** Sallow prisoner skin (pale, bruised shadows). */
export const SALLOW: Ramp = [C.rustDeep, C.skinDeep, C.skinShadow, C.ashGrey, C.bone];
/** Crimson cloth (Varkus' cape and crest). */
export const CRIMSON: Ramp = [C.wineDeep, C.lifeDark, C.blood, C.life, C.lifeLight];
/** Filthy burlap / rags. */
export const RAG: Ramp = [C.rustDeep, C.sandDeep, C.sandDark, C.sandMid, C.sand];
/** Tar: black with a cold, oily sheen. */
export const TAR: Ramp = [C.ink, C.metalDeep, C.coal, C.metalDark, C.metal, C.metalLight];

export const style = (ramp: Ramp, o: Omit<PrimStyle, 'ramp'> = {}): PrimStyle => ({ ramp, dither: 0.08, ...o });

/** Rust speckle texture for iron: occasional darker pits. */
export const pitted = (seed: number, k = 0.84): ((x: number, y: number) => number) => (x, y) => (hash2(x, y, seed) > k ? -1 : 0);

// --- geometry ------------------------------------------------------------------------------------------------------

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/**
 * Joint of a two-segment limb from `root` to `end`: the midpoint pushed `bend` px perpendicular to root→end
 * (positive = to the left of the direction of travel, i.e. forward for a leg walking east).
 */
export function joint(root: Pt, end: Pt, bend: number): Pt {
  const dx = end[0] - root[0];
  const dy = end[1] - root[1];
  const len = Math.hypot(dx, dy) || 1;
  return [(root[0] + end[0]) / 2 + (dy / len) * bend, (root[1] + end[1]) / 2 + (-dx / len) * bend];
}

/** Where a leg capsule of end radius `r` must end so its rounded tip sits on the sole row of `foot`. */
export const sole = (foot: Pt, r: number): Pt => [foot[0], foot[1] - r + 0.5];

/** Two tapered capsules root → joint → end (the joint pushed by `bend`). Returns the joint. */
export function limb(s: Sculpt, root: Pt, end: Pt, bend: number, r0: number, r1: number, r2: number, st: PrimStyle, st2: PrimStyle = st): Pt {
  const j = joint(root, end, bend);
  s.cap(root[0], root[1], j[0], j[1], r0, r1, st);
  s.cap(j[0], j[1], end[0], end[1], r1, r2, st2);
  return j;
}

// --- pixel details -------------------------------------------------------------------------------------------------

/** Set a pixel (rounded) in the colour layer and clear any glow under it. */
export function put(f: Frame, x: number, y: number, c: Color): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  f.c.set(X, Y, c);
  f.e.set(X, Y, 0);
}

/** Set a pixel only where the figure already has pixels. */
export function on(f: Frame, x: number, y: number, c: Color): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  if (f.c.opaque(X, Y)) {
    f.c.set(X, Y, c);
    f.e.set(X, Y, 0);
  }
}

/** Quadratic point: a sagging chain between a and b with the mid point dropped by `sag` (can be negative). */
export function sagPt(a: Pt, b: Pt, sag: number, t: number): Pt {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t) + 4 * sag * t * (1 - t)];
}

/**
 * A 1 px iron chain: links alternate a lit link and a dark gap so the chain reads as a dotted line of iron at 1x.
 * `path` gives the point at t (0..1). `phase` slides the link pattern (so a dragged or swung chain crawls).
 */
export function chain(f: Frame, path: (t: number) => Pt, phase = 0, lit: Color = C.metalHi, mid: Color = C.metalLight, dark: Color = C.metalDark, onlyEmpty = false): void {
  // sample densely, keep unique cells in order
  const cells: Pt[] = [];
  const seen = new Set<number>();
  const N = 96;
  let prev: Pt | null = null;
  for (let i = 0; i <= N; i++) {
    const p = path(i / N);
    const q: Pt = [Math.round(p[0]), Math.round(p[1])];
    const push = (x: number, y: number): void => {
      const key = y * 4096 + x;
      if (seen.has(key)) return;
      seen.add(key);
      cells.push([x, y]);
    };
    if (prev) lineCells(prev[0], prev[1], q[0], q[1], push);
    else push(q[0], q[1]);
    prev = q;
  }
  cells.forEach(([x, y], i) => {
    if (onlyEmpty && f.c.opaque(x, y)) return;
    const k = (i + Math.round(phase)) % 3;
    put(f, x, y, k === 0 ? lit : k === 1 ? mid : dark);
  });
}

/** A short run of pixels along a line (straps, seams, scars). */
export function stroke(f: Frame, a: Pt, b: Pt, col: (t: number, x: number, y: number) => Color | null, onlyOnBody = false): void {
  const n = Math.max(Math.abs(Math.round(b[0]) - Math.round(a[0])), Math.abs(Math.round(b[1]) - Math.round(a[1])), 1);
  lineCells(a[0], a[1], b[0], b[1], (x, y) => {
    if (onlyOnBody && !f.c.opaque(x, y)) return;
    const t = Math.max(Math.abs(x - Math.round(a[0])), Math.abs(y - Math.round(a[1]))) / n;
    const c = col(t, x, y);
    if (c !== null) put(f, x, y, c);
  });
}

/** Glowing eye / slit pixel with an optional dimmer neighbour to the east. */
export function glowEye(f: Frame, x: number, y: number, glow: number, halo = true): void {
  const g = 150 + 105 * Math.min(1, glow);
  f.glow(Math.round(x), Math.round(y), glow > 0.95 ? C.hot : C.flame, g);
  if (halo) f.glow(Math.round(x) + 1, Math.round(y), C.ember, g * 0.8);
}

/**
 * Motion smear (drawn AFTER the outline pass so it isn't outlined): soft pixels along an arc around (cx, cy) with
 * radii rx/ry from angle a0 to a1 (radians, y down). Coverage fades towards a0 (the tail).
 */
export function smear(f: Frame, cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, col: Color, k = 0.8, glow = 0, width = 1): void {
  const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) * 1.6));
  const seen = new Set<number>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    for (let w = 0; w < width; w++) {
      const r = 1 - w / Math.max(rx, ry, 1); // 1 px radial steps: `width` px thick band
      const x = Math.round(cx + Math.cos(a) * rx * r);
      const y = Math.round(cy + Math.sin(a) * ry * r);
      const key = y * 4096 + x;
      if (seen.has(key)) continue;
      seen.add(key);
      const cov = k * (0.25 + 0.75 * t) * (w === 0 ? 1 : 0.7 - w * 0.1);
      if (f.c.opaque(x, y) && f.c.alpha(x, y) === 255) continue;
      f.c.plot(x, y, col, cov);
      if (glow > 0) f.e.plot(x, y, (col & 0xffffff00) | Math.min(255, Math.round(glow)), cov);
    }
  }
}

/** Dust puffs kicked up at ground level (colour only, soft). Drawn after the outline. */
export function dust(f: Frame, x: number, y: number, spread: number, k = 0.7): void {
  const pts: [number, number, number][] = [[-spread, 0, 0.9], [-spread + 1, -1, 0.7], [spread, 0, 0.9], [spread - 1, -1, 0.7], [-spread - 1, -1, 0.4], [spread + 1, -1, 0.4], [0, -1, 0.3]];
  for (const [dx, dy, a] of pts) f.c.plot(Math.round(x + dx), Math.round(y + dy), C.sandLight, a * k);
}

/** Sparks where iron meets iron (emissive). */
export function sparks(f: Frame, x: number, y: number, r: number, strength = 240): void {
  const pts: [number, number, Color][] = [
    [0, 0, C.white], [1, -1, C.hot], [-1, -1, C.hot], [r, -r, C.flame], [-r, -r + 1, C.flame], [r + 1, 0, C.ember], [0, -r - 1, C.ember], [-r - 1, 1, C.ember],
  ];
  for (const [dx, dy, c] of pts) f.glow(Math.round(x + dx), Math.round(y + dy), c, strength);
}

/** Blood drip pixels (colour only). */
export function blood(f: Frame, x: number, y: number, len: number): void {
  for (let i = 0; i < len; i++) put(f, x, y + i, i === len - 1 ? C.lifeDark : i === 0 ? C.life : C.blood);
}
