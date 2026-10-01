// Layout compiler: turns an authored AreaLayout (radius fractions) into world-unit geometry for one arena radius R.
// Pure and seed-free: the same layout and R always give the same result, in the same order (the order is the order of
// `addProp` calls, so prop ids are identical in every run of an area). Used by the sim (src/sim/layout.ts), the
// validator, the lint script, the presenter's decals and dev/layouts.html.
import { createRng, hashString } from '../../core/rng';
import type { PropCover, PropKind } from '../../contracts/sim';
import { compileFlowZones, type CompiledFlow } from './flow';
import {
  LANDMARK_KINDS, LAYOUT_PROP_RADIUS, bearingOf, resolvePt,
  type AreaLayout, type BossArrival, type DecalKind, type EventAnchorKind, type LandmarkKind, type LaneFavour, type LayoutCluster, type Pt,
} from './schema';

export interface XY { x: number; y: number }

/** Default start clearing (u) round the landing. */
export const DEFAULT_START_CLEAR = 140;
/** Wall pieces overlap: centre spacing = this x the piece diameter. */
export const WALL_SPACING = 0.8;

export type PropSource = 'landmark' | 'cluster' | 'wall' | 'scatter';

export interface CompiledProp {
  /** Authoring id of the landmark, cluster or wall that made it. */
  owner: string;
  source: PropSource;
  kind: PropKind;
  x: number;
  y: number;
  radius: number;
  variant: number;
  /** The layout's cover override, when it set one (the kind's default otherwise: src/data/propCover.ts). */
  cover?: PropCover;
}

export interface CompiledLandmark { id: string; kind: PropKind | LandmarkKind; x: number; y: number; r: number; prop: boolean; solid: boolean }
export interface CompiledDecal { id: string; kind: DecalKind; x: number; y: number; r: number; width: number; path: XY[] }
export interface CompiledLane { id: string; path: XY[]; width: number; weight: number; wave: [number, number] | null; favours: LaneFavour[]; length: number }
export interface CompiledZone { id: string; shape: 'disc' | 'sector'; x: number; y: number; r: number; a0: number; a1: number; weight: number; wave: [number, number] | null }
export interface CompiledAnchor { id: string; fits: EventAnchorKind; x: number; y: number; r: number; path: XY[]; tier: [number, number] | null }
export interface CompiledBossStage { x: number; y: number; r: number; arrive: BossArrival; facing: number; second: XY | null }

export interface CompiledLayout {
  areaId: AreaLayout['areaId'];
  version: number;
  R: number;
  start: { x: number; y: number; clear: number };
  /** Landmarks, then clusters, then walls (authoring order inside each): the fixed addProp order. */
  props: CompiledProp[];
  landmarks: CompiledLandmark[];
  decals: CompiledDecal[];
  lanes: CompiledLane[];
  zones: CompiledZone[];
  bossStage: CompiledBossStage;
  anchors: CompiledAnchor[];
  /** Flow zones (seed-free geometry; `buildFlowField` adds the run's directions and reversal schedule). */
  flows: CompiledFlow[];
  rareSpots: { x: number; y: number; r: number; weight: number }[];
  light: { ambient: number; pools: { x: number; y: number; r: number; colour: string; flicker: number }[] } | null;
  scatter: AreaLayout['scatter'];
  /** Stable hash of the fixed geometry (props, boss stage, start): folded into the sim digest. */
  signature: number;
}

const isLandmarkKind = (k: string): k is LandmarkKind => (LANDMARK_KINDS as readonly string[]).includes(k);
const wrap360 = (a: number): number => ((a % 360) + 360) % 360;

/** Default footprint (u) of the non-prop landmarks. */
const LANDMARK_RADIUS: Record<LandmarkKind, number> = { skull: 40, crucible: 90, furnace: 110, pit: 150, dais: 70, stair: 50, hatch: 40, lake: 220, plinth: 36 };

export function pathLength(path: readonly XY[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}

/** The point at distance s (u) along a polyline (clamped to its ends). */
export function pointAlong(path: readonly XY[], s: number): XY {
  if (path.length === 0) return { x: 0, y: 0 };
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (left <= seg || i === path.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 0;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
    }
    left -= seg;
  }
  return { ...path[0] };
}

/** Distance from point (px, py) to the segment a-b. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function distToPath(px: number, py: number, path: readonly XY[]): number {
  if (path.length === 1) return Math.hypot(px - path[0].x, py - path[0].y);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distToSegment(px, py, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y));
  return best;
}

function mapPath(path: readonly Pt[] | undefined, R: number): XY[] {
  return (path ?? []).map((p) => resolvePt(p, R));
}

function clusterPoints(c: LayoutCluster, R: number, areaId: string): XY[] {
  const o = resolvePt(c.at, R);
  const q = c.params;
  const count = Math.max(0, Math.round(c.count ?? q.count ?? 0));
  const out: XY[] = [];
  const bearing = (deg: number, r: number): XY => {
    const a = (deg * Math.PI) / 180;
    return { x: o.x + Math.sin(a) * r, y: o.y - Math.cos(a) * r };
  };
  switch (c.pattern) {
    case 'ring':
      for (let k = 0; k < count; k++) out.push(bearing((q.rot ?? 0) + (k / count) * 360, q.r ?? 50));
      break;
    case 'arc': {
      const a0 = q.a0 ?? 0;
      const span = wrap360((q.a1 ?? 360) - a0) || 360;
      for (let k = 0; k < count; k++) out.push(bearing(a0 + (count > 1 ? (k / (count - 1)) * span : span / 2), q.r ?? 50));
      break;
    }
    case 'line': {
      const len = q.length ?? 100;
      const from = q.centered ? -len / 2 : 0;
      for (let k = 0; k < count; k++) out.push(bearing(q.bearing ?? 0, from + (count > 1 ? (k / (count - 1)) * len : 0)));
      // bearing() rotates about `at`; a negative distance runs the other way, which is what `centered` wants.
      break;
    }
    case 'grid': {
      const cols = Math.max(1, Math.round(q.cols ?? 1));
      const rows = Math.max(1, Math.round(q.rows ?? 1));
      const rot = ((q.rot ?? 0) * Math.PI) / 180;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const gx = (i - (cols - 1) / 2) * (q.dx ?? 40);
          const gy = (j - (rows - 1) / 2) * (q.dy ?? q.dx ?? 40);
          out.push({ x: o.x + gx * cs - gy * sn, y: o.y + gx * sn + gy * cs });
        }
      }
      break;
    }
    case 'scatter': {
      const rng = createRng(hashString(`layout:${areaId}:${c.id}`));
      const radius = q.radius ?? LAYOUT_PROP_RADIUS[c.prop];
      const gap = q.minGap ?? radius * 2 + 10;
      const r = q.r ?? 80;
      for (let k = 0; k < count; k++) {
        for (let attempt = 0; attempt < 30; attempt++) {
          const d = Math.sqrt(rng.next()) * r;
          const a = rng.range(0, Math.PI * 2);
          const p = { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d };
          if (out.every((e) => Math.hypot(e.x - p.x, e.y - p.y) >= gap)) {
            out.push(p);
            break;
          }
        }
      }
      break;
    }
    case 'spiral': {
      const r0 = q.r0 ?? 20;
      const r1 = q.r1 ?? 120;
      const turns = q.turns ?? 1;
      for (let k = 0; k < count; k++) {
        const t = count > 1 ? k / (count - 1) : 0;
        out.push(bearing((q.a0 ?? 0) + t * turns * 360, r0 + (r1 - r0) * t));
      }
      break;
    }
  }
  return out;
}

/** Pieces of a wall: overlapping circles at WALL_SPACING x diameter along the path, with the declared gaps left open. */
function wallPieces(path: readonly XY[], radius: number, gaps: readonly { at: number; width: number }[]): XY[] {
  const total = pathLength(path);
  if (total <= 0) return path.length ? [{ ...path[0] }] : [];
  const step = Math.max(2, radius * 2 * WALL_SPACING);
  const n = Math.max(1, Math.ceil(total / step));
  const out: XY[] = [];
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total;
    // A piece whose edge reaches into a gap is dropped, so the clear opening between facing edges is exactly `width`.
    if (gaps.some((g) => Math.abs(s - g.at * total) < g.width / 2 + radius)) continue;
    out.push(pointAlong(path, s));
  }
  return out;
}

function hashGeometry(c: Pick<CompiledLayout, 'props' | 'bossStage' | 'start'>): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (Math.round(v * 16) | 0), 16777619) >>> 0;
  };
  for (const p of c.props) {
    mix(p.x);
    mix(p.y);
    mix(p.radius);
    mix(p.variant);
  }
  mix(c.bossStage.x);
  mix(c.bossStage.y);
  mix(c.start.x);
  mix(c.start.y);
  return h >>> 0;
}

/** Compile an authored layout for arena radius R. */
export function compileLayout(layout: AreaLayout, R: number): CompiledLayout {
  const props: CompiledProp[] = [];
  const landmarks: CompiledLandmark[] = [];

  for (const l of layout.landmarks) {
    const at = resolvePt(l.at, R);
    if (isLandmarkKind(l.kind)) {
      landmarks.push({ id: l.id, kind: l.kind, x: at.x, y: at.y, r: l.r ?? LANDMARK_RADIUS[l.kind], prop: false, solid: false });
      continue;
    }
    const radius = l.r ?? LAYOUT_PROP_RADIUS[l.kind];
    landmarks.push({ id: l.id, kind: l.kind, x: at.x, y: at.y, r: radius > 0 ? radius : 8, prop: true, solid: radius > 0 });
    props.push({ owner: l.id, source: 'landmark', kind: l.kind, x: at.x, y: at.y, radius, variant: l.variant ?? 0, ...(l.cover ? { cover: l.cover } : {}) });
  }

  for (const c of layout.clusters) {
    const radius = c.params.radius ?? LAYOUT_PROP_RADIUS[c.prop];
    clusterPoints(c, R, layout.areaId).forEach((p, k) => {
      props.push({ owner: c.id, source: 'cluster', kind: c.prop, x: p.x, y: p.y, radius, variant: c.variant ?? k % 4, ...(c.cover ? { cover: c.cover } : {}) });
    });
  }

  for (const w of layout.walls) {
    const kind = w.prop ?? 'ruinWall';
    const radius = w.thickness ? w.thickness / 2 : LAYOUT_PROP_RADIUS[kind];
    wallPieces(mapPath(w.path, R), radius, w.gaps ?? []).forEach((p, k) => {
      props.push({ owner: w.id, source: 'wall', kind, x: p.x, y: p.y, radius, variant: k % 4, ...(w.cover ? { cover: w.cover } : {}) });
    });
  }

  const startAt = layout.start ? resolvePt(layout.start.at, R) : { x: 0, y: 0 };
  const start = { x: startAt.x, y: startAt.y, clear: layout.start?.clear ?? DEFAULT_START_CLEAR };
  const stageAt = resolvePt(layout.bossStage.at, R);
  const bossStage: CompiledBossStage = {
    x: stageAt.x, y: stageAt.y, r: layout.bossStage.r, arrive: layout.bossStage.arrive,
    // Default facing: towards the landing.
    facing: layout.bossStage.facing ?? bearingOf(start.x - stageAt.x, start.y - stageAt.y),
    second: layout.bossStage.second ? resolvePt(layout.bossStage.second, R) : null,
  };

  const lanes: CompiledLane[] = layout.lanes.map((l) => {
    const path = mapPath(l.path, R);
    return { id: l.id, path, width: l.width, weight: l.weight, wave: l.wave ?? null, favours: l.favours ?? [], length: pathLength(path) };
  });
  const zones: CompiledZone[] = layout.zones.map((z) => {
    const at = resolvePt(z.at, R);
    return { id: z.id, shape: z.shape, x: at.x, y: at.y, r: z.r, a0: z.a0 ?? 0, a1: z.a1 ?? 360, weight: z.weight, wave: z.wave ?? null };
  });
  const decals: CompiledDecal[] = layout.decals.map((d) => {
    const at = d.at ? resolvePt(d.at, R) : { x: 0, y: 0 };
    return { id: d.id, kind: d.kind, x: at.x, y: at.y, r: d.r ?? 0, width: d.width ?? 0, path: mapPath(d.path, R) };
  });
  const anchors: CompiledAnchor[] = layout.anchors.map((a) => {
    const at = resolvePt(a.at, R);
    return { id: a.id, fits: a.fits, x: at.x, y: at.y, r: a.r ?? 0, path: mapPath(a.path, R), tier: a.tier ?? null };
  });
  const light = layout.light
    ? { ambient: layout.light.ambient, pools: layout.light.pools.map((p) => ({ ...resolvePt(p.at, R), r: p.r, colour: p.colour, flicker: p.flicker ?? 0 })) }
    : null;

  const out: CompiledLayout = {
    areaId: layout.areaId, version: layout.version, R, start, props, landmarks, decals, lanes, zones, bossStage, anchors,
    flows: compileFlowZones(layout.flows, R),
    rareSpots: (layout.rareSpots ?? []).map((s) => ({ ...resolvePt(s.at, R), r: s.r, weight: s.weight })),
    light, scatter: layout.scatter, signature: 0,
  };
  out.signature = hashGeometry(out);
  return out;
}

/** Is (x, y) inside a compiled zone? A sector is measured from the zone centre, clockwise from a0 to a1. */
export function inZone(z: CompiledZone, x: number, y: number): boolean {
  const dx = x - z.x;
  const dy = y - z.y;
  if (dx * dx + dy * dy > z.r * z.r) return false;
  if (z.shape === 'disc') return true;
  if (dx === 0 && dy === 0) return true;
  const span = wrap360(z.a1 - z.a0) || 360;
  return wrap360(bearingOf(dx, dy) - z.a0) <= span;
}
