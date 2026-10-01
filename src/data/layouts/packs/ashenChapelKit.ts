// Authoring helpers shared by the Ashen Forge and Cinder Chapel layout files (slice L1). Pure data builders: no
// runtime behaviour, nothing here is imported by the sim.
import type { PropKind } from '../../../contracts/sim';
import { resolvePt, type LayoutAnchor, type LayoutLandmark, type LayoutLight, type Polar, type Pt } from '../schema';

export const deg = (d: number): number => (d * Math.PI) / 180;

/** A polyline along an arc of radius r (R units) from bearing a0 clockwise to a1, about `centre` (default the arena centre). */
export function arcPath(r: number, a0: number, a1: number, centre: readonly [number, number] = [0, 0], steps?: number): Pt[] {
  const span = a1 - a0;
  const n = steps ?? Math.max(2, Math.ceil(Math.abs(span) / 6));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = deg(a0 + (span * k) / n);
    out.push([centre[0] + Math.sin(a) * r, centre[1] - Math.cos(a) * r]);
  }
  return out;
}

/** The `at` (0..1) of a bearing on an arc wall built with `arcPath(_, a0, a1)`. */
export const arcAt = (a0: number, a1: number, bearing: number): number => (bearing - a0) / (a1 - a0);

/** Position of a point as plain R fractions (resolves Polar; R = 1). */
export function frac(p: Pt): [number, number] {
  const q = resolvePt(p, 1);
  return [q.x, q.y];
}

export interface PerchSpec {
  id: string;
  at: Pt;
  /** Distance (u) from the start at which the Stalker cover prop stands on the line to the perch (default 230). */
  cover?: number;
  prop?: PropKind;
  variant?: number;
  tier?: [number, number];
}

/**
 * Stalker perches (D 10.3 check 5): each perch anchor with a solid cover prop exactly on its line to the start, 140 to
 * 380 u from the start. `R` is the area's real arena radius (the layout is authored for it).
 */
export function perches(R: number, specs: readonly PerchSpec[], start: Pt = [0, 0]): { anchors: LayoutAnchor[]; covers: LayoutLandmark[] } {
  const s = frac(start);
  const anchors: LayoutAnchor[] = [];
  const covers: LayoutLandmark[] = [];
  for (const sp of specs) {
    const p = frac(sp.at);
    const dx = p[0] - s[0];
    const dy = p[1] - s[1];
    const len = Math.hypot(dx, dy) * R;
    const t = (sp.cover ?? 230) / len;
    anchors.push({ id: sp.id, fits: 'perch', at: sp.at, ...(sp.tier ? { tier: sp.tier } : {}) });
    covers.push({ id: `${sp.id}-cover`, kind: sp.prop ?? 'pillar', at: [s[0] + dx * t, s[1] + dy * t], variant: sp.variant ?? 0 });
  }
  return { anchors, covers };
}

/** `count` equally spaced bearings starting at `from` (degrees). */
export const bearings = (from: number, count: number): number[] => Array.from({ length: count }, (_, k) => (from + (360 * k) / count) % 360);

/** Small warm light pool helper. */
export function pool(at: Pt, r: number, colour = '#ff8a3c', flicker = 0.35): LayoutLight['pools'][number] {
  return { at, r, colour, flicker };
}

export const P0: Polar = { r: 0, a: 0 };

/** World units (u, origin = arena centre) to an R-fraction point, for layouts authored in u against a known R. */
export const atU = (R: number) => (x: number, y: number): [number, number] => [x / R, y / R];

/** Point at (tangent t, radial s) u from a centre given by bearing/radius: the local frame of a house, a chapel or a pocket. */
export function local(R: number, centre: Pt, bearingDeg: number, t: number, s: number): [number, number] {
  const c = frac(centre);
  const a = deg(bearingDeg);
  const rx = Math.sin(a);
  const ry = -Math.cos(a);
  const tx = -ry; // tangent = radial rotated 90 degrees clockwise
  const ty = rx;
  return [c[0] + (tx * t + rx * s) / R, c[1] + (ty * t + ry * s) / R];
}
