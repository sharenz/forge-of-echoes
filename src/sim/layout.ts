// Hand-crafted area layouts at runtime (docs/atlas-rework/D-territory.md 10.5). `applyLayout` replaces the
// procedural `layoutMap` for an area that has a layout: it adds the fixed props in a fixed order (same area, any seed
// = identical landmarks, clusters and walls, so prop ids and digests match), a little seeded cosmetic debris, and
// records the zones, lanes, boss stage, start and event anchors the director and the wave code read.
//
// Everything stays deterministic: the fixed geometry uses no RNG at all; the cosmetic debris uses a stream forked from
// the run seed (not worldRng), so a layout never perturbs the pack/event streams. An area WITHOUT a layout never
// reaches this file: run.ts keeps calling layoutMap and every old behaviour (and golden digest) is unchanged.
import type { AtlasAreaId } from '../contracts/atlas';
import { createRng, hashU32 } from '../core/rng';
import type { Rng } from '../contracts/rng';
import {
  compileLayout, distToPath, pointAlong, type CompiledAnchor, type CompiledBossStage, type CompiledLane, type CompiledLayout,
  type CompiledZone, type XY,
} from '../data/layouts/compile';
import { layoutFor } from '../data/layouts';
import type { AreaLayout, EventAnchorKind, LaneFavour } from '../data/layouts/schema';
import { PACK_MIN_DISTANCE } from './constants';
import { resolveProps } from './grid';
import { TAU } from './math';
import { addProp, clearOf, edgeRing } from './props';
import type { PlayerState, World } from './world';

const SCATTER_SALT = 0x1a7007;
/** Packs of one wave keep at least this far from each other when the layout can afford it. */
const PACK_SEPARATION = 110;
/** A pack centre keeps this clear of solid props (members spiral out to ~32 u). */
const PACK_PROP_CLEAR = 24;

/** Compiled layout state kept on the World (null = the old procedural generator built this arena). */
export interface LayoutRuntime {
  readonly layout: AreaLayout;
  readonly compiled: CompiledLayout;
}

/** The layout an area would use (undefined = old generator): the one lookup run.ts makes. */
export function layoutForConfig(areaId: AtlasAreaId | undefined, mode: 'hideout' | 'map'): AreaLayout | undefined {
  return mode === 'map' ? layoutFor(areaId) : undefined;
}

/** Build the arena from `layout`: props in a fixed order, cosmetic debris, the rim; stores the runtime on the world. */
export function applyLayout(w: World, layout: AreaLayout): LayoutRuntime {
  const compiled = compileLayout(layout, w.arenaRadius);
  for (const p of compiled.props) addProp(w, p.kind, p.x, p.y, p.radius, { variant: p.variant });
  scatterDebris(w, compiled, createRng(hashU32((w.config.seed ^ SCATTER_SALT) >>> 0)));
  edgeRing(w, 46);
  const rt: LayoutRuntime = { layout, compiled };
  w.layout = rt;
  return rt;
}

/** Cosmetic, walk-through debris (the layout's `scatter`): varies per seed, never blocks anything. */
function scatterDebris(w: World, c: CompiledLayout, rng: Rng): void {
  const s = c.scatter;
  if (s.kinds.length === 0 || !(s.density > 0)) return;
  const R = w.arenaRadius;
  const count = Math.round((Math.PI * R * R * s.density) / 100000);
  const maxR = R - 30;
  for (let k = 0; k < count; k++) {
    const kind = rng.pick(s.kinds);
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = Math.sqrt(rng.range(0, maxR * maxR));
      const a = rng.range(0, TAU);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (!clearOf(w, x, y, 8)) continue;
      addProp(w, kind, x, y, 0, { variant: rng.int(0, 3) });
      break;
    }
  }
}

/** Where players arrive: the layout's start, else the arena centre. */
export function layoutStart(w: World): { x: number; y: number } | null {
  const l = w.layout;
  return l ? { x: l.compiled.start.x, y: l.compiled.start.y } : null;
}

// --- boss stage ----------------------------------------------------------------------------------------------------

const STAGE_RING_A = 8;

/**
 * The boss's arrival point on its stage: the stage centre unless a living player stands too close (campers cannot be
 * landed on): then the point of the stage disc (centre, then two rings) furthest from every living player that is clear
 * of solid props. Pure function of the world state; no randomness.
 */
export function bossStagePoint(w: World, which: 'first' | 'second' = 'first'): XY | null {
  const l = w.layout;
  if (!l) return null;
  const st = l.compiled.bossStage;
  const centre: XY = which === 'second' && st.second ? st.second : { x: st.x, y: st.y };
  const want = 168; // the old pointAway(210) kept every player at least 0.8 x 210 away
  const lim = w.arenaRadius - 60;
  let best: XY = centre;
  let bestScore = -Infinity;
  const consider = (p: XY): boolean => {
    if (p.x * p.x + p.y * p.y > lim * lim) return false;
    const solid = resolveProps(w.propGrid, p.x, p.y, 30).hit;
    let d = Infinity;
    for (const q of w.living) d = Math.min(d, Math.hypot(q.x - p.x, q.y - p.y));
    const score = Math.min(d, want) - (solid ? 1e6 : 0);
    if (score > bestScore + 1e-9) {
      best = p;
      bestScore = score;
    }
    return !solid && d >= want;
  };
  if (consider(centre)) return centre;
  for (const f of [0.5, 0.9]) {
    for (let k = 0; k < STAGE_RING_A; k++) {
      const a = (k / STAGE_RING_A) * TAU + (f > 0.6 ? TAU / (STAGE_RING_A * 2) : 0);
      if (consider({ x: centre.x + Math.cos(a) * st.r * f, y: centre.y + Math.sin(a) * st.r * f })) return { x: centre.x + Math.cos(a) * st.r * f, y: centre.y + Math.sin(a) * st.r * f };
    }
  }
  return best;
}

export function layoutBossStage(w: World): CompiledBossStage | null {
  return w.layout?.compiled.bossStage ?? null;
}

// --- packs: zones and lanes ----------------------------------------------------------------------------------------

type Spot = CompiledLayout['rareSpots'][number];
type Region =
  | { zone: CompiledZone; lane?: undefined; spot?: undefined }
  | { lane: CompiledLane; zone?: undefined; spot?: undefined }
  | { spot: Spot; zone?: undefined; lane?: undefined };

const FAVOUR_ROLES: Record<LaneFavour, readonly string[]> = {
  melee: ['swarmer', 'bruiser'],
  ranged: ['artillery', 'support'],
  fast: ['fast', 'hunter'],
};

/** What a pack is made of, for a lane's `favours` (roles of its members). */
export interface PackProfile { roles: ReadonlySet<string>; rare: boolean }

function regionWeight(r: Region, wave: number, profile: PackProfile | null): number {
  // Rare spots (D 10.2 `rareSpots`) only ever receive rare packs, which favour them 3 to 1 over the ordinary regions.
  if (r.spot) return profile?.rare ? r.spot.weight * 3 : 0;
  const win = (r.zone ?? r.lane)!.wave;
  if (win && (wave < win[0] || wave > win[1])) return 0;
  const base = (r.zone ?? r.lane)!.weight;
  if (r.lane && profile && r.lane.favours.length > 0) {
    for (const f of r.lane.favours) if (FAVOUR_ROLES[f].some((role) => profile.roles.has(role))) return base * 1.75;
  }
  return base;
}

function sampleRegion(r: Region, rng: Rng): XY {
  if (r.spot) {
    const d = Math.sqrt(rng.next()) * r.spot.r;
    const a = rng.range(0, TAU);
    return { x: r.spot.x + Math.cos(a) * d, y: r.spot.y + Math.sin(a) * d };
  }
  if (r.lane) {
    const s = rng.next() * r.lane.length;
    const p = pointAlong(r.lane.path, s);
    const q = pointAlong(r.lane.path, Math.min(r.lane.length, s + 4));
    const h = Math.atan2(q.y - p.y, q.x - p.x);
    const off = (rng.next() * 2 - 1) * Math.max(0, r.lane.width / 2 - 20);
    return { x: p.x - Math.sin(h) * off, y: p.y + Math.cos(h) * off };
  }
  const z = r.zone!;
  const d = Math.sqrt(rng.next()) * z.r;
  let a: number;
  if (z.shape === 'sector') {
    const span = ((((z.a1 - z.a0) % 360) + 360) % 360 || 360) * (Math.PI / 180);
    const t = (z.a0 * Math.PI) / 180 + rng.next() * span;
    return { x: z.x + Math.sin(t) * d, y: z.y - Math.cos(t) * d };
  }
  a = rng.range(0, TAU);
  return { x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d };
}

function nearestLivingD2(living: readonly PlayerState[], x: number, y: number): number {
  let best = Infinity;
  for (const p of living) {
    const dx = p.x - x;
    const dy = p.y - y;
    best = Math.min(best, dx * dx + dy * dy);
  }
  return best;
}

/**
 * Pack centres for `profiles.length` packs of `wave` (D 10.5): each pack picks a zone or lane by weight (wave-windowed;
 * a lane's `favours` weigh more for packs of those roles), then a point inside it; every point is inside the arena,
 * clear of solids, at least PACK_MIN_DISTANCE from every living player and PACK_SEPARATION from the other packs.
 * Returns null when the layout declares no zone or lane usable in this wave (the caller keeps the old spiral); a
 * null entry for a pack it could not place (the caller fills those with the old fallback).
 */
export function layoutPackPoints(w: World, wave: number, profiles: readonly (PackProfile | null)[]): (XY | null)[] | null {
  const l = w.layout;
  if (!l) return null;
  const c = l.compiled;
  const regions: Region[] = [];
  for (const zone of c.zones) regions.push({ zone });
  for (const lane of c.lanes) if (lane.path.length > 0 && lane.length > 0) regions.push({ lane });
  for (const spot of c.rareSpots) regions.push({ spot });
  if (!regions.some((r) => !r.spot && regionWeight(r, wave, null) > 0)) return null;
  const rng = w.worldRng;
  const R = w.arenaRadius;
  const lim = R - 70;
  const minD2 = PACK_MIN_DISTANCE * PACK_MIN_DISTANCE;
  const out: (XY | null)[] = [];
  for (let k = 0; k < profiles.length; k++) {
    const profile = profiles[k];
    let placed: XY | null = null;
    let relaxed: XY | null = null;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const region = rng.weighted(regions, (r) => regionWeight(r, wave, profile));
      if (!region) break;
      const p = sampleRegion(region, rng);
      if (p.x * p.x + p.y * p.y > lim * lim) continue;
      if (resolveProps(w.propGrid, p.x, p.y, PACK_PROP_CLEAR).hit) continue;
      if (nearestLivingD2(w.living, p.x, p.y) < minD2) continue;
      if (out.every((q) => !q || Math.hypot(q.x - p.x, q.y - p.y) >= PACK_SEPARATION)) placed = p;
      else relaxed ??= p;
    }
    // Crowded regions: accept a point that only breaks the mutual spacing rather than losing the pack to the fallback.
    out.push(placed ?? relaxed);
  }
  return out;
}

/** Roles of a planned pack's members (see FAVOUR_ROLES). */
export function packProfile(roles: Iterable<string>, rare = false): PackProfile {
  return { roles: new Set(roles), rare };
}

// --- event anchors -------------------------------------------------------------------------------------------------

export interface WorldAnchor {
  id: string;
  kind: EventAnchorKind;
  x: number;
  y: number;
  /** Footprint in u (0 = a point). */
  r: number;
  /** road / fault: the route or line, in world units. */
  path: XY[];
  /** True when the layout declared no anchor of this kind and this one was synthesised (deterministically, per area). */
  fallback: boolean;
}

export interface AnchorQuery {
  /** Offer only anchors whose tier window contains this tier (default: the map's own tier). */
  tier?: number;
  /** Synthesise deterministic candidates for point-like kinds when the layout declares none (default false). */
  fallback?: boolean;
}

function toWorldAnchor(a: CompiledAnchor): WorldAnchor {
  return { id: a.id, kind: a.fits, x: a.x, y: a.y, r: a.r, path: a.path, fallback: false };
}

/** Kinds `layoutAnchors` can synthesise when asked to (single points; roads, faults and relay triads need a design). */
const FALLBACK_KINDS: readonly EventAnchorKind[] = ['perch', 'echo', 'altar', 'orchard', 'ring', 'host', 'anvil', 'bell'];

/**
 * The layout's candidate anchors for an event kind (E1: the Event Director asks, then picks one with the run seed).
 *   - no layout (old generator): [] -> the director keeps its radial rules;
 *   - the layout declares anchors of the kind: those, filtered by tier window, in authoring order;
 *   - declared none and `fallback` is set: up to 6 deterministic candidates that obey the Event Charter spacing
 *     (perch >= 320 u and echo >= 250 u from the start, echo >= 200 u from the rim, others >= 250 u / 150 u), clear of solids,
 *     >= 120 u apart; the same area always yields the same sites. Not for road/fault/relay (returns []).
 * Never mutates the world and never uses its RNG.
 */
export function layoutAnchors(w: World, kind: EventAnchorKind, q: AnchorQuery = {}): WorldAnchor[] {
  const l = w.layout;
  if (!l) return [];
  const c = l.compiled;
  const tier = q.tier ?? w.config.tier;
  const declared = c.anchors.filter((a) => a.fits === kind);
  if (declared.length > 0) {
    return declared.filter((a) => !a.tier || (tier >= a.tier[0] && tier <= a.tier[1])).map(toWorldAnchor);
  }
  if (!q.fallback || !FALLBACK_KINDS.includes(kind)) return [];
  const rng = createRng(hashU32((c.signature ^ (FALLBACK_KINDS.indexOf(kind) + 1) * 0x9e3779b1) >>> 0));
  const R = c.R;
  const minStart = kind === 'perch' ? 320 : kind === 'echo' ? 250 : 250;
  const rimMargin = kind === 'echo' ? 200 : 150;
  const out: WorldAnchor[] = [];
  for (let attempt = 0; attempt < 120 && out.length < 6; attempt++) {
    const r = Math.sqrt(rng.next()) * (R - rimMargin);
    const a = rng.range(0, TAU);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (Math.hypot(x - c.start.x, y - c.start.y) < minStart) continue;
    // Only the layout's fixed solids count (never the seed's debris), so the same area always yields the same sites.
    if (c.props.some((p) => p.radius > 0 && Math.hypot(p.x - x, p.y - y) < p.radius + 60)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 120)) continue;
    out.push({ id: `fallback:${kind}:${out.length}`, kind, x, y, r: 0, path: [], fallback: true });
  }
  return out;
}

/** Pick one candidate with the caller's seeded rng among `layoutAnchors` that pass `ok` (null = none: use the radial rules). */
export function pickLayoutAnchor(w: World, kind: EventAnchorKind, rng: Rng, ok?: (a: WorldAnchor) => boolean, q: AnchorQuery = {}): WorldAnchor | null {
  const list = layoutAnchors(w, kind, q).filter((a) => !ok || ok(a));
  return list.length > 0 ? rng.pick(list) : null;
}

/** Shortest distance (u) from a point to a lane or road path (helper for event code and tests). */
export function distanceToPath(path: readonly XY[], x: number, y: number): number {
  return distToPath(x, y, path);
}
