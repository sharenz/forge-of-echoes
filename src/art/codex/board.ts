// The Codex board (brief A, 8.1): dark slate with etched concentric bearing rings, degree ticks on the bezels, six
// faintly tinted branch sectors with dashed divides and a compass rosette under the origin; plus the brass wire
// (thread) painter. Pure Raster code, deterministic, no DOM: the UI turns the rasters into canvases.
import { C, hexToColor, type Color } from '../palette';
import { Raster, lineCells, mix, rgba } from '../raster';
import { valueNoise } from '../shade';
import { TONES, type BranchTone } from './tones';

/** Codex world: art px. The data's 512 px layout is scaled by CODEX_K around the world centre. */
export const CODEX_K = 1.5;
export const CODEX_W = 800;
export const CODEX_H = 800;
export const CODEX_C = 400;
export const toWorld = (p: { x: number; y: number }): { x: number; y: number } => ({ x: CODEX_C + (p.x - 256) * CODEX_K, y: CODEX_C + (p.y - 256) * CODEX_K });

/** Branch axes in degrees (matches data/progression/map-tree BRANCH_ANGLE). */
export const BRANCH_AXIS: Record<BranchTone, number> = { cartography: -90, fortune: -30, echoes: 30, peril: 90, bounty: 150, foundry: 210 };
/** Node-ring radius in world px for a data ring number (data: 28 + 19 ring, times CODEX_K). */
export const ringRadius = (ring: number): number => (28 + 19 * ring) * CODEX_K;

/** Seamless dark slate, 64 x 64. */
export function slateTile(): Raster {
  const r = new Raster(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const n = valueNoise(x, y, 16, 71, 4) * 0.55 + valueNoise(x, y, 8, 72, 8) * 0.3 + valueNoise(x, y, 4, 73, 16) * 0.15;
    const v = 0.35 + n * 0.55;
    r.set(x, y, mix(hexToColor('#0e0b10'), hexToColor('#231c22'), v));
  }
  // a few hairline scratches
  for (const [x0, y0, x1, y1] of [[6, 12, 22, 9], [40, 50, 58, 44], [28, 30, 33, 38], [10, 54, 20, 60], [48, 8, 56, 14]] as const) lineCells(x0, y0, x1, y1, (x, y) => r.plot(x, y, rgba(60, 50, 56, 90)));
  return r;
}

const RING_RADII = [ringRadius(2), ringRadius(4), ringRadius(6), ringRadius(8), ringRadius(10)];
const FAINT_RADII = [ringRadius(3), ringRadius(5), ringRadius(7), ringRadius(9)];
const HUB_R = 34 * CODEX_K;
const BEZEL_IN = ringRadius(11.7), BEZEL_OUT = ringRadius(11.7) + 9;

const norm360 = (a: number): number => ((a % 360) + 360) % 360;

/** Branch tones in sector order starting at the sector that spans -60..0 degrees (its axis is -30). */
const SECTOR_TONES: readonly BranchTone[] = ['fortune', 'echoes', 'peril', 'bounty', 'foundry', 'cartography'];

/** The etched board, transparent where the slate tile shows through. */
export function boardRaster(): Raster {
  const r = new Raster(CODEX_W, CODEX_H);
  const brass = hexToColor('#8a6a3e'), brassLo = hexToColor('#4a3621'), hi = hexToColor('#c9a064');
  const brassA = (a: number): Color => (brass & 0xffffff00) | a;
  const tints = SECTOR_TONES.map((t) => TONES[t].light & 0xffffff00);
  const all = [...RING_RADII.map((R) => ({ R, faint: false })), ...FAINT_RADII.map((R) => ({ R, faint: true })), { R: HUB_R, faint: false, hub: true }];
  const outer = BEZEL_OUT + 2;
  for (let y = 0; y < CODEX_H; y++) for (let x = 0; x < CODEX_W; x++) {
    const dx = x + 0.5 - CODEX_C, dy = y + 0.5 - CODEX_C;
    const rad = Math.hypot(dx, dy);
    if (rad > outer) continue;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const deg = norm360(ang);
    // sector wash, brighter on the axis, fading to nothing at the divides and toward the rim
    if (rad > 22 && rad < BEZEL_IN) {
      const k = Math.floor(norm360(ang + 60) / 60);
      const axis = -30 + 60 * k;
      const off = Math.abs(((deg - norm360(axis) + 540) % 360) - 180);
      const a = Math.max(0, 1 - off / 30) * (0.1 + 0.16 * Math.max(0, 1 - Math.abs(rad - 210) / 200));
      if (a > 0.01) r.plot(x, y, tints[k] | Math.round(a * 255 * 0.55));
    }
    // etched rings and the hub ring
    for (const ring of all) {
      const d = rad - ring.R;
      if (d < -1.7 || d > 1.7) continue;
      if ('hub' in ring) { if (d >= -0.6 && d < 0.6) r.set(x, y, brassA(190)); else if (d >= 0.6 && d < 1.6) r.plot(x, y, rgba(0, 0, 0, 120)); continue; }
      if (ring.faint) { if (d >= -0.5 && d < 0.5 && ((x + y) & 3) < 2) r.plot(x, y, (brassLo & 0xffffff00) | 150); continue; }
      if (d >= -0.55 && d < 0.55) r.set(x, y, rgba(12, 9, 12, 230));
      else if (d >= 0.55) r.plot(x, y, brassA(96));
      else if (d >= -1.55) r.plot(x, y, rgba(0, 0, 0, 70));
    }
    // bezel: two brass rings with degree ticks between them
    if (rad > BEZEL_IN - 1 && rad < BEZEL_OUT + 1) {
      const d1 = rad - BEZEL_IN, d2 = rad - BEZEL_OUT;
      if (Math.abs(d1) < 0.6 || Math.abs(d2) < 0.6) r.set(x, y, (hi & 0xffffff00) | 170);
      else if (d1 > 0.6 && d2 < -0.6) {
        const step = deg / 3;
        const near = Math.abs(step - Math.round(step)) * 3 * (Math.PI / 180) * rad; // px to the nearest 3 degree tick
        const major = Math.round(step) % 5 === 0;
        if (near < 0.55 && (major || rad - BEZEL_IN < 3.2)) r.set(x, y, brassA(major ? 230 : 150));
        else r.plot(x, y, rgba(6, 5, 7, 90));
      }
    }
    // sector divides: dashed hairlines between the branches
    if (rad > 60 && rad < BEZEL_IN - 2 && Math.floor(rad / 5) % 2 === 0) {
      const rel = ((deg % 60) + 60) % 60; // divides sit at multiples of 60 degrees
      const perp = Math.min(rel, 60 - rel) * (Math.PI / 180) * rad;
      if (perp < 0.55) r.plot(x, y, brassA(110));
    }
  }
  // the compass rosette under the origin: eight pointers around a dark hollow
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, long = k % 2 === 0;
    const L = long ? 46 : 32;
    const bx = CODEX_C + Math.cos(a) * 12, by = CODEX_C + Math.sin(a) * 12;
    const tx = CODEX_C + Math.cos(a) * L, ty = CODEX_C + Math.sin(a) * L;
    const px = Math.cos(a + Math.PI / 2) * 4, py = Math.sin(a + Math.PI / 2) * 4;
    r.polygon([[bx + px, by + py], [tx, ty], [bx - px, by - py]], (brassLo & 0xffffff00) | 170);
    lineCells(Math.round(bx), Math.round(by), Math.round(tx), Math.round(ty), (x, y) => r.plot(x, y, (brass & 0xffffff00) | 140));
  }
  return r;
}

export type ThreadKind = 'dim' | 'reach' | 'lit';
/** Paint one thread between two world points. `lit` is 3 px with a coloured core and a white-hot centre line. */
export function paintThread(r: Raster, x0: number, y0: number, x1: number, y1: number, kind: ThreadKind, light: Color = C.flame, glow?: Raster): void {
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  const put = (x: number, y: number, c: Color): void => r.set(x, y, c);
  let i = 0;
  lineCells(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), (x, y) => {
    i++;
    const ox = steep ? 1 : 0, oy = steep ? 0 : 1;
    if (kind === 'dim') {
      put(x, y, hexToColor('#56422c'));
      put(x + ox, y + oy, hexToColor('#231a11'));
      if (i % 9 === 0) put(x, y, hexToColor('#7a6042'));
    } else if (kind === 'reach') {
      if (i % 4 < 3) { put(x, y, hexToColor('#8a6a3e')); put(x + ox, y + oy, hexToColor('#3a2c1d')); }
      else put(x, y, hexToColor('#4a3621'));
    } else {
      put(x - ox, y - oy, rgba(10, 8, 9, 220));
      put(x + ox * 2, y + oy * 2, rgba(10, 8, 9, 220));
      put(x, y, mix(light, C.white, 0.15));
      put(x + ox, y + oy, mix(light, C.coal, 0.25));
      if (glow) {
        for (let k = -3; k <= 4; k++) glow.plot(x + ox * k, y + oy * k, (light & 0xffffff00) | (Math.abs(k - 0.5) < 1.6 ? 150 : Math.abs(k - 0.5) < 2.6 ? 70 : 30));
      }
    }
  });
}

/**
 * The table a tree is drawn on: the world size in art px, the centre the camera homes to and exclusion chains bow away
 * from, the etched board raster and the tile that fills the view around it. The Atlas Codex is CODEX_BOARD; another tree
 * (the Orrery, a test graph) passes its own.
 */
export interface TreeBoard {
  w: number;
  h: number;
  cx: number;
  cy: number;
  raster(): Raster;
  tile(): Raster;
}
export const CODEX_BOARD: TreeBoard = { w: CODEX_W, h: CODEX_H, cx: CODEX_C, cy: CODEX_C, raster: boardRaster, tile: slateTile };

/**
 * A plain etched table for any tree: brass rings around the centre, no branch sectors. Test graphs use it; the Orrery
 * can start from it until it has its own board.
 */
export function ringBoard(w: number, h: number, radii: readonly number[], cx = w / 2, cy = h / 2): TreeBoard {
  return {
    w, h, cx, cy, tile: slateTile,
    raster(): Raster {
      const r = new Raster(w, h);
      const brass = hexToColor('#8a6a3e');
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const rad = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        for (const R of radii) {
          const d = rad - R;
          if (d >= -0.55 && d < 0.55) r.set(x, y, rgba(12, 9, 12, 230));
          else if (d >= 0.55 && d < 1.7) r.plot(x, y, (brass & 0xffffff00) | 96);
          else if (d >= -1.55 && d < -0.55) r.plot(x, y, rgba(0, 0, 0, 70));
        }
      }
      return r;
    },
  };
}
