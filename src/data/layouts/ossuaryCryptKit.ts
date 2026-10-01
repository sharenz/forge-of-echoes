// Authoring helpers shared by the Rimed Ossuary and Choral Crypt layouts (D-territory.md 10.7, nos. 11 to 18).
// Layouts are authored in world units against the area's real R (the schema wants R fractions, so `frame(R)` converts),
// which keeps radii, wall gaps and clearances readable as the numbers the validator checks.
import type { PropKind } from '../../contracts/sim';
import type { LayoutAnchor, LayoutCluster, LayoutLandmark, LayoutLight, Pt } from './schema';

export interface XY { x: number; y: number }

const RAD = Math.PI / 180;

/** World-unit offset at compass bearing `a` and distance `r`. */
export function polar(r: number, a: number, o: XY = { x: 0, y: 0 }): XY {
  return { x: o.x + Math.sin(a * RAD) * r, y: o.y - Math.cos(a * RAD) * r };
}

export function along(from: XY, to: XY, d: number): XY {
  const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / l) * d, y: from.y + ((to.y - from.y) / l) * d };
}

export const dist = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface Frame {
  R: number;
  /** A point from world units. */
  p(x: number, y: number): Pt;
  pp(q: XY): Pt;
  /** A point from polar world units round `o` (default the centre). */
  pol(r: number, a: number, o?: XY): Pt;
  /** Polyline of an arc (compass degrees a0 -> a1, clockwise when a1 > a0) round `o`. */
  arc(r: number, a0: number, a1: number, step?: number, o?: XY): Pt[];
}

export function frame(R: number): Frame {
  const p = (x: number, y: number): Pt => [x / R, y / R];
  const pp = (q: XY): Pt => p(q.x, q.y);
  const pol = (r: number, a: number, o: XY = { x: 0, y: 0 }): Pt => pp(polar(r, a, o));
  const arc = (r: number, a0: number, a1: number, step = 12, o: XY = { x: 0, y: 0 }): Pt[] => {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
    const out: Pt[] = [];
    for (let k = 0; k <= n; k++) out.push(pol(r, a0 + ((a1 - a0) * k) / n, o));
    return out;
  };
  return { R, p, pp, pol, arc };
}

export interface CoverOpts {
  /** The solid prop at the exact point on the line (the Stalker's cover). */
  kind?: PropKind;
  radius?: number;
  /** Companion props round it (a cluster, not a lone prop); 0 = none. */
  ring?: number;
  ringR?: number;
  ringKind?: PropKind;
  variant?: number;
}

/** A cover prop exactly on the straight line `from` -> `perch`, `d` u from `from`, with a small ring of companions. */
export function cover(f: Frame, id: string, from: XY, perch: XY, d: number, o: CoverOpts = {}): { landmark: LayoutLandmark; cluster?: LayoutCluster } {
  const q = along(from, perch, d);
  const kind = o.kind ?? 'crystal';
  const landmark: LayoutLandmark = { id: `${id}-core`, kind, at: f.pp(q), variant: o.variant ?? 0, ...(o.radius ? { r: o.radius } : {}) };
  const ring = o.ring ?? 0;
  if (ring <= 0) return { landmark };
  const cluster: LayoutCluster = {
    id: `${id}-ring`, pattern: 'ring', at: f.pp(q), params: { r: o.ringR ?? 30, count: ring, rot: 20 }, prop: o.ringKind ?? kind, variant: (o.variant ?? 0) + 1,
  };
  return { landmark, cluster };
}

export function perch(f: Frame, id: string, q: XY): LayoutAnchor {
  return { id, fits: 'perch', at: f.pp(q) };
}

/** Frost-blue light pools (Rimed Ossuary) and violet window light (Choral Crypt). */
export const FROST = '#8fd0ff';
export const FROST_DEEP = '#5aa6e8';
export const VIOLET = '#a98bff';
export const WINDOW = '#c8b4ff';

export function lights(ambient: number, pools: { at: Pt; r: number; colour: string; flicker?: number }[]): LayoutLight {
  return { ambient, pools };
}
