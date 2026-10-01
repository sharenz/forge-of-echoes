// Hand-crafted area layouts (docs/atlas-rework/D-territory.md section 10): the authoring format.
//
// A layout is plain data, reviewed in PRs and drawn by dev/layouts.html. It is compiled at run start (compile.ts) to
// world units with the run's real arena radius R, and applied by src/sim/layout.ts. The arena stays a circle of
// today's radius: layouts add landmarks, walls, cover, spawn lanes/zones, a boss stage and event anchors, never a
// new collision primitive (solid props are circles).
//
// UNITS (one rule, no exceptions):
//   * POSITIONS (`at`, every point of a `path`) are fractions of R, origin = arena centre, +y south (screen), either
//     `[x, y]` (|x|,|y| <= 1) or `{ r, a }` (r in R units, a = compass bearing in degrees, N = 0, clockwise, so
//     { r: 0.5, a: 90 } is east). Every point must lie inside 0.92 R.
//   * EVERYTHING ELSE that is a length (`r`, `width`, `thickness`, `clear`, wall `gaps[].width`, cluster `params`
//     distances, light pool `r`, zone `r`) is in world units (u), because props keep absolute radii. A layout is
//     authored for its area's real R (base radius x arenaScale: see `areaRadius`); the same layout on a different R
//     scales the positions only.
//   * Angles in `params`, `a0`, `a1`, `facing` are compass degrees (N = 0, clockwise).
import type { AtlasAreaId } from '../../contracts/atlas';
import type { PropCover, PropKind } from '../../contracts/sim';

/** x, y in R units (-1..1), origin = arena centre, +y south. */
export type P = readonly [number, number];
/** r in R units, a = compass bearing in degrees (N = 0, clockwise). */
export interface Polar { r: number; a: number }
export type Pt = P | Polar;

/** Non-prop landmarks: walk-through ground features drawn as decals/lights (a `r` is their footprint in u). */
export const LANDMARK_KINDS = ['skull', 'crucible', 'furnace', 'pit', 'dais', 'stair', 'hatch', 'lake', 'plinth'] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export const CLUSTER_PATTERNS = ['ring', 'arc', 'line', 'grid', 'scatter', 'spiral'] as const;
export type ClusterPattern = (typeof CLUSTER_PATTERNS)[number];

export type WallProp = 'ruinWall' | 'pillar' | 'crate';
export type DecalKind = 'road' | 'glyph' | 'crack' | 'pool' | 'light';
export type LaneFavour = 'melee' | 'ranged' | 'fast';
export type BossArrival = 'gate' | 'rim' | 'shimmer';

/**
 * What an event wants from the place (Event Charter, docs/atlas-rework/C-map-events.md 4.3):
 * perch (Stalker), echo (Echoing anchor), road (Caravan route), fault (Fault line), relay (Ember Relay brazier),
 * altar (Pact Altar / Wayside Anvil neighbour), orchard (Ashseed plots), ring (Champion's Ring), host (Stasis plaza),
 * anvil (Wayside Anvil), bell (Bellwatch hub).
 */
export const EVENT_ANCHOR_KINDS = ['perch', 'echo', 'road', 'fault', 'relay', 'altar', 'orchard', 'ring', 'host', 'anvil', 'bell'] as const;
export type EventAnchorKind = (typeof EVENT_ANCHOR_KINDS)[number];

export interface LayoutLandmark {
  id: string;
  kind: PropKind | LandmarkKind;
  at: Pt;
  /** Solid radius (props) or footprint radius (landmarks) in u; 0 on a prop makes it walk-through decor. Default: the kind's own. */
  r?: number;
  variant?: number;
  tags?: string[];
  /** Cover override for a solid prop (default: the kind's, src/data/propCover.ts): 'tall' stops straight shots, 'low'/'none' lets them fly over. */
  cover?: PropCover;
}

export interface LayoutCluster {
  id: string;
  pattern: ClusterPattern;
  at: Pt;
  /**
   * Pattern parameters, distances in u, angles in compass degrees (all patterns also accept `count` here or on the cluster):
   *   ring    { r, count, rot? }                       props on a circle of radius r round `at`
   *   arc     { r, count, a0, a1 }                     props on the arc from bearing a0 clockwise to a1
   *   line    { length, bearing, count, centered? }    evenly spaced from `at` along `bearing` (centered: 1 = `at` is the middle)
   *   grid    { cols, rows, dx, dy, rot? }             a cols x rows lattice centred on `at`, spacing dx/dy, rotated by rot
   *   scatter { r, count, minGap? }                    seeded (by area + cluster id) points in a disc, never run-dependent
   *   spiral  { r0, r1, turns, count, a0? }            an outward spiral
   * Every pattern accepts `radius` (override of the prop's solid radius).
   */
  params: Record<string, number>;
  prop: PropKind;
  variant?: number;
  count?: number;
  tags?: string[];
  /** Cover override for every prop of the cluster (see LayoutLandmark.cover). */
  cover?: PropCover;
}

export interface LayoutGap {
  /** Position along the wall path, 0..1 of its total length. */
  at: number;
  /** Clear opening in u, measured between the facing prop edges (designed chokes need >= 96). */
  width: number;
}

export interface LayoutWall {
  id: string;
  path: Pt[];
  /** Wall thickness in u (the pieces' diameter); default = the prop's own diameter. */
  thickness?: number;
  gaps?: LayoutGap[];
  prop?: WallProp;
  /** Cover override for the whole run: a crate RAIL or rubble run is 'low' (shots fly over), a stack or full wall 'tall'. */
  cover?: PropCover;
}

export interface LayoutDecal {
  id: string;
  kind: DecalKind;
  path?: Pt[];
  at?: Pt;
  r?: number;
  width?: number;
}

export interface LayoutLane {
  id: string;
  path: Pt[];
  /** Lane width in u. */
  width: number;
  weight: number;
  /** Waves (inclusive) the lane is used in; absent = all. */
  wave?: [number, number];
  favours?: LaneFavour[];
}

export interface LayoutZone {
  id: string;
  shape: 'disc' | 'sector';
  at: Pt;
  /** Radius in u (a sector reaches r from `at`; the arena clips it). */
  r: number;
  /** Sector bounds, compass degrees clockwise from a0 to a1 (seen from `at`). */
  a0?: number;
  a1?: number;
  weight: number;
  wave?: [number, number];
}

/** Body classes a flow zone treats differently (see `LayoutFlow.strength`). */
export const FLOW_BODIES = ['player', 'monster', 'heavy', 'boss', 'air'] as const;
export type FlowBody = (typeof FLOW_BODIES)[number];
/** Share of the zone's velocity each body class receives (0 = unaffected). Absent entries take FLOW_STRENGTH_DEFAULT. */
export type FlowStrength = Partial<Record<FlowBody, number>>;
/**
 * player: a player; monster: an ordinary walker; heavy: a heavy body (bruisers, lieutenants, `heavy` roster entries);
 * boss: a boss; air: ghosts and anything that drifts over the floor. Fixtures, statues and the dummy are never carried.
 */
export const FLOW_STRENGTH_DEFAULT: Readonly<Record<FlowBody, number>> = { player: 1, monster: 1, heavy: 0.5, boss: 0.5, air: 0 };

/** How a flow zone changes direction over a run (everything is a pure function of the run's flow seed and the sim clock). */
export interface LayoutFlowReverse {
  /**
   * pingpong: every reversal flips the direction. random: each reversal draws a new direction (half the draws keep the
   * current one, which is then simply skipped: the belt just runs on).
   */
  mode: 'pingpong' | 'random';
  /** Seconds between the starts of two reversals, drawn uniformly per reversal (min >= telegraph + ramp + 4). */
  every: [number, number];
  /** Seconds the belt decelerates to a stop before it turns (default 2): the warning. */
  telegraph?: number;
  /** Seconds it takes to reach full speed in the new direction (default 1). */
  ramp?: number;
}

/**
 * A FLOW ZONE: ground that carries bodies standing on it (a conveyor belt, a frost current, a lava river). One format for
 * every flow: the zone is geometry + a velocity + who feels it + (optionally) how the direction is chosen and changes.
 *
 * Geometry (positions are R fractions like everything else, lengths are u):
 *   band     a belt along `path` (>= 2 points, flat ends), `width` wide; flows from the first point to the last
 *   annulus  a ring round `at` from radius r0 to r1; flows clockwise (compass) at sense 1
 * Velocity: `speed` u/s at full strength, times the body class's strength, times the zone's current direction scale
 * (-1..1; reversals pass through 0). The zone edge fades over `feather` u (default 8) so crossing it never jerks.
 * Direction: `sense` 1 = as authored, -1 = opposite, 'random' = drawn from the run's flow seed (the one deliberately
 * seed-dependent part of an otherwise fixed layout). Zones sharing a `group` draw together and always include both
 * directions (a group of >= 2 random zones never all runs the same way). `reverse` adds timed reversals.
 * The presenter draws the zone from this same data (chevrons scroll at the live velocity), so art, direction and mechanic
 * cannot disagree. Sim (monsters, players) and client prediction both evaluate it through src/data/layouts/flow.ts.
 */
export interface LayoutFlow {
  id: string;
  shape: 'band' | 'annulus';
  path?: Pt[];
  width?: number;
  at?: Pt;
  r0?: number;
  r1?: number;
  /** Full-strength speed, u/s. */
  speed: number;
  sense: 1 | -1 | 'random';
  group?: string;
  strength?: FlowStrength;
  reverse?: LayoutFlowReverse;
  feather?: number;
}

export interface LayoutBossStage {
  at: Pt;
  /** Footprint in u (the boss and its entourage arrive inside it). */
  r: number;
  arrive: BossArrival;
  /** Compass degrees the boss faces on arrival (cosmetic hint). */
  facing?: number;
  /** Rival Crowns' second stage. */
  second?: Pt;
}

export interface LayoutAnchor {
  id: string;
  fits: EventAnchorKind;
  at: Pt;
  r?: number;
  /** road / fault: the route or line. */
  path?: Pt[];
  /** Tier window (inclusive) in which the anchor is offered. */
  tier?: [number, number];
}

export interface LayoutRareSpot { at: Pt; r: number; weight: number }

export interface LayoutLight {
  ambient: number;
  pools: { at: Pt; r: number; colour: string; flicker?: number }[];
}

export interface LayoutScatter {
  /** Cosmetic debris per 100 000 u^2 of arena (roughly 6 matches the old generator). */
  density: number;
  kinds: PropKind[];
  solid: false;
}

export interface AreaLayout {
  areaId: AtlasAreaId;
  version: number;
  /** Test fixtures and viewer samples are marked so tooling never mistakes them for a shipped area. */
  fixture?: boolean;
  start?: { at: Pt; clear?: number };
  landmarks: LayoutLandmark[];
  clusters: LayoutCluster[];
  walls: LayoutWall[];
  decals: LayoutDecal[];
  lanes: LayoutLane[];
  zones: LayoutZone[];
  bossStage: LayoutBossStage;
  anchors: LayoutAnchor[];
  /** Flow zones (conveyor belts, currents): a real movement mechanic, see `LayoutFlow`. Optional. */
  flows?: LayoutFlow[];
  rareSpots?: LayoutRareSpot[];
  light?: LayoutLight;
  scatter: LayoutScatter;
}

/** Identity helper: type-checks an authored layout and keeps literals narrow. */
export function defineLayout(layout: AreaLayout): AreaLayout {
  return layout;
}

export function isPolar(p: Pt): p is Polar {
  return !Array.isArray(p);
}

/** Resolve an authored point to world units for arena radius R. */
export function resolvePt(p: Pt, R: number): { x: number; y: number } {
  if (isPolar(p)) {
    const a = (p.a * Math.PI) / 180;
    return { x: Math.sin(a) * p.r * R, y: -Math.cos(a) * p.r * R };
  }
  return { x: p[0] * R, y: p[1] * R };
}

/** Compass bearing (degrees, N = 0, clockwise) of the vector (dx, dy) in screen space (+y south). */
export function bearingOf(dx: number, dy: number): number {
  const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** Default solid radius of every prop kind a layout may place (0 = walk-through decor). */
export const LAYOUT_PROP_RADIUS: Record<PropKind, number> = {
  mapDevice: 20, stash: 14, merchant: 12, debugMerchant: 12, portal: 0, returnPortal: 0, chest: 10,
  pillar: 10, brazier: 7, standingStone: 9, rubble: 0, bones: 0, crystal: 8, banner: 0, anvil: 10, ruinWall: 12,
  // Art kit (D 10.5): solid circles; every one can be made walk-through with `r: 0` on a landmark.
  vat: 30, bellows: 14, altar: 12, sarcophagus: 16, choirStall: 12, ribArch: 10, iceColumn: 10,
  crate: 12, chainPost: 7, hoist: 16, gate: 12, weaponRack: 10, obelisk: 10, statue: 14,
};
