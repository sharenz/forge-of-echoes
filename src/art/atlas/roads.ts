// Road painting for the chart (brief A, 5.4): a 3 px cobbled band (two-tone iron and stone, mortar every third
// pixel so it reads as a path), a dotted char trail for known-but-unwalked links, a bone-lit band for walked roads,
// dashed leaders for dead ends. Pure Raster code, so the renderer repaints when discovery or selection changes.
import { C, type Color } from '../palette';
import { Raster } from '../raster';
import type { RoadKind } from './geometry';

export interface RoadStyle { a: Color; b: Color; mortar: Color; edge: Color }
const STYLES: Record<'open' | 'walked' | 'lit', RoadStyle> = {
  open: { a: C.stone, b: C.iron, mortar: C.char, edge: C.ink },
  walked: { a: C.bone, b: C.ashGrey, mortar: C.stone, edge: C.ink },
  lit: { a: C.flame, b: C.ochre, mortar: C.rustDark, edge: C.ink },
};

export interface Pt { x: number; y: number }

/** Paints `pts` up to arc length `upto` (default all). `lit` brightens the road (route to the selected node). */
export function paintRoad(r: Raster, pts: readonly Pt[], kind: RoadKind, lit = false, upto = Infinity): void {
  if (kind === 'hidden' || pts.length < 2) return;
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const seg = Math.hypot(q.x - p.x, q.y - p.y);
    if (seg <= 0) continue;
    const tx = (q.x - p.x) / seg, ty = (q.y - p.y) / seg;
    const nx = -ty, ny = tx;
    const along = s;
    s += seg;
    if (along > upto) break;
    const cell = Math.floor(along / 3);
    switch (kind) {
      case 'open':
      case 'walked': {
        const st = kind === 'walked' ? STYLES.walked : STYLES.open;
        const st2 = lit ? STYLES.lit : st;
        const colBase = (cell & 1) === 0 ? st2.a : st2.b;
        const mortar = along % 3 < 0.9;
        for (let o = -2; o <= 2; o++) {
          const X = Math.round(q.x + nx * o), Y = Math.round(q.y + ny * o);
          if (Math.abs(o) === 2) r.plot(X, Y, st.edge, 0.7);
          else r.set(X, Y, mortar ? st2.mortar : o === -1 ? colBase : colBase);
        }
        break;
      }
      case 'dotted':
      case 'stub': {
        if (Math.floor(along / 3) % 2 === 0) {
          const X = Math.round(q.x), Y = Math.round(q.y);
          r.set(X, Y, lit ? C.ochre : C.stone);
          r.plot(X + 1, Y, C.ink, 0.5);
        }
        break;
      }
      case 'spur': {
        if (Math.floor(along / 4) % 2 === 0) {
          const X = Math.round(q.x), Y = Math.round(q.y);
          r.set(X, Y, lit ? C.flame : C.bone);
          r.plot(X + 1, Y + 1, C.ink, 0.5);
        }
        break;
      }
    }
  }
}

/** Pixel outline of the plate octagon at half-width `h` (art px, centre 0,0): used for rings and brackets. */
export function octagonPixels(h: number): [number, number][] {
  const c = h / 0.72 - h; // chamfer offset along the face
  const v: [number, number][] = [[h, -c], [h, c], [c, h], [-c, h], [-h, c], [-h, -c], [-c, -h], [c, -h]];
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const [x0, y0] = v[i], [x1, y1] = v[(i + 1) % 8];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
      const key = `${x},${y}`;
      if (!seen.has(key)) { seen.add(key); out.push([x, y]); }
    }
  }
  return out;
}
