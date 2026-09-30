// The Atlas chart's designed geography (brief A, section 4): art-pixel positions on a 640x360 chart, region
// membership, authored road control points, the node material ladder and the per-theme identity. Pure data and
// maths, shared by the art bakers (ground/roads/plates) and the UI. Topology (neighbours) still comes from
// data/progression/atlas.ts; nothing here changes a rule.
import type { AtlasAreaId } from '../../contracts/atlas';
import type { MapBaseId } from '../../contracts/content';
import { ATLAS_AREAS, ATLAS_KEYS, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';

export const CHART_W = 640;
export const CHART_H = 360;
/** Half the plate frame; used for overlap tests and for keeping props out of the way. */
export const PLATE_R = 21;

export const ATLAS_POS: Readonly<Record<AtlasAreaId, { x: number; y: number }>> = {
  cinderCrossing: { x: 50, y: 180 },
  emberRoad: { x: 120, y: 88 },
  boneApproach: { x: 118, y: 262 },
  emberVault: { x: 72, y: 40 },
  furnaceYard: { x: 190, y: 74 },
  glassSepulchre: { x: 190, y: 190 },
  ironMarch: { x: 190, y: 296 },
  shatteredForge: { x: 262, y: 60 },
  championsApproach: { x: 268, y: 306 },
  crownFoundry: { x: 334, y: 52 },
  winterThrone: { x: 334, y: 262 },
  sealedReliquary: { x: 330, y: 168 },
  emberCitadel: { x: 402, y: 48 },
  frozenPassage: { x: 402, y: 255 },
  lastKiln: { x: 470, y: 60 },
  echoBastion: { x: 470, y: 248 },
  heartOfForge: { x: 545, y: 68 },
  eternalArena: { x: 548, y: 286 },
  hollowOssuary: { x: 250, y: 228 },
  pitOfEchoes: { x: 108, y: 326 },
  shrineField: { x: 604, y: 36 },
  gildedVault: { x: 400, y: 168 },
  blackPit: { x: 470, y: 168 },
  huntingGround: { x: 545, y: 176 },
  riftNexus: { x: 604, y: 168 },
};

export type RegionId = 'reach' | 'deep' | 'marches' | 'verge' | 'tears';
export interface RegionDef { id: RegionId; name: string; banner: { x: number; y: number }; unknownMark: { x: number; y: number } }
export const REGIONS: readonly RegionDef[] = [
  { id: 'reach', name: 'The Cinder Reach', banner: { x: 300, y: 118 }, unknownMark: { x: 300, y: 118 } },
  { id: 'deep', name: 'The Rimed Deep', banner: { x: 348, y: 212 }, unknownMark: { x: 348, y: 212 } },
  { id: 'marches', name: 'The Iron Marches', banner: { x: 420, y: 330 }, unknownMark: { x: 420, y: 330 } },
  { id: 'verge', name: 'The Verge', banner: { x: 52, y: 218 }, unknownMark: { x: 52, y: 218 } },
  { id: 'tears', name: 'The Tears', banner: { x: 500, y: 132 }, unknownMark: { x: 500, y: 132 } },
];

export function regionOf(area: AtlasAreaDef): RegionId {
  if (area.sealed) return 'tears';
  switch (area.type) {
    case 'forge': return 'reach';
    case 'crypt': return 'deep';
    case 'arena': return 'marches';
    case 'frontier': return 'verge';
    case 'vault': return 'reach';
    default: return 'tears';
  }
}

export interface Edge { a: AtlasAreaId; b: AtlasAreaId; key: string }
export const edgeKey = (a: AtlasAreaId, b: AtlasAreaId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const ATLAS_EDGES: readonly Edge[] = ATLAS_AREAS.flatMap((a) => a.neighbours.filter((id) => a.id < id).map((id) => ({ a: a.id, b: id, key: edgeKey(a.id, id) })));

type Ctrl = readonly (readonly [number, number])[];
/** Authored bends, written from `from` to `to`, so cross-lane roads run through the gaps between the Tears instead of through a sealed door. */
const AUTHORED: readonly [AtlasAreaId, AtlasAreaId, Ctrl][] = [
  ['furnaceYard', 'glassSepulchre', [[204, 112], [176, 152]]],
  ['shatteredForge', 'winterThrone', [[276, 110], [292, 150], [300, 200], [316, 236]]],
  ['championsApproach', 'crownFoundry', [[292, 262], [290, 214], [300, 150], [316, 96]]],
  ['emberCitadel', 'frozenPassage', [[386, 100], [366, 140], [366, 190], [384, 226]]],
  ['lastKiln', 'echoBastion', [[452, 104], [436, 150], [436, 200], [452, 226]]],
  ['heartOfForge', 'eternalArena', [[526, 116], [508, 150], [508, 210], [526, 250]]],
  ['cinderCrossing', 'emberRoad', [[62, 130]]],
  ['cinderCrossing', 'boneApproach', [[66, 224]]],
  ['boneApproach', 'glassSepulchre', [[150, 232]]],
  ['boneApproach', 'ironMarch', [[138, 286]]],
  ['glassSepulchre', 'hollowOssuary', [[222, 214]]],
  ['ironMarch', 'championsApproach', [[228, 312]]],
  ['ironMarch', 'pitOfEchoes', [[150, 318]]],
  ['winterThrone', 'frozenPassage', [[368, 250]]],
  ['frozenPassage', 'echoBastion', [[436, 262]]],
  ['echoBastion', 'eternalArena', [[508, 274]]],
  ['emberRoad', 'furnaceYard', [[156, 76]]],
  ['emberRoad', 'emberVault', [[98, 66]]],
  ['furnaceYard', 'shatteredForge', [[226, 62]]],
  ['shatteredForge', 'crownFoundry', [[298, 52]]],
  ['crownFoundry', 'emberCitadel', [[368, 44]]],
  ['emberCitadel', 'lastKiln', [[436, 52]]],
  ['lastKiln', 'heartOfForge', [[508, 66]]],
  ['heartOfForge', 'shrineField', [[576, 48]]],
];
const ROAD_CONTROLS: ReadonlyMap<string, { from: AtlasAreaId; ctrl: Ctrl }> = new Map(AUTHORED.map(([f, t, c]) => [edgeKey(f, t), { from: f, ctrl: c }]));

/** Catmull-Rom through the endpoints and the authored controls, sampled about every `step` art px. */
const ROAD_CACHE = new Map<string, { x: number; y: number }[]>();
export function roadPoints(a: AtlasAreaId, b: AtlasAreaId, step = 1.5): { x: number; y: number }[] {
  const key = `${a}|${b}|${step}`;
  const hit = ROAD_CACHE.get(key);
  if (hit) return hit;
  const built = buildRoad(a, b, step);
  ROAD_CACHE.set(key, built);
  return built;
}

function buildRoad(a: AtlasAreaId, b: AtlasAreaId, step: number): { x: number; y: number }[] {
  // The road is built in the order it was authored, then reversed if it was asked for the other way round.
  const authored = ROAD_CONTROLS.get(edgeKey(a, b));
  const first = authored ? authored.from : a < b ? a : b;
  const second = first === a ? b : a;
  const flip = first !== a;
  const from = ATLAS_POS[first];
  const to = ATLAS_POS[second];
  const ctrl = authored?.ctrl ?? [];
  const pts: [number, number][] = [[from.x, from.y], ...ctrl.map((p) => [p[0], p[1]] as [number, number]), [to.x, to.y]];
  const ext: [number, number][] = [[2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]], ...pts, [2 * pts[pts.length - 1][0] - pts[pts.length - 2][0], 2 * pts[pts.length - 1][1] - pts[pts.length - 2][1]]];
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (i0: number): number => 0.5 * (2 * p1[i0] + (-p0[i0] + p2[i0]) * t + (2 * p0[i0] - 5 * p1[i0] + 4 * p2[i0] - p3[i0]) * t2 + (-p0[i0] + 3 * p1[i0] - 3 * p2[i0] + p3[i0]) * t3);
      out.push({ x: f(0), y: f(1) });
    }
  }
  out.push({ x: to.x, y: to.y });
  return flip ? out.reverse() : out;
}

/** Cumulative arc length of a sampled road, for the ember run. */
export function pathLength(pts: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}
/** Point at distance `d` along the sampled road. */
export function pointAt(pts: readonly { x: number; y: number }[], d: number): { x: number; y: number } {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (s + seg >= d) {
      const t = seg > 0 ? (d - s) / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    s += seg;
  }
  return pts[pts.length - 1];
}

// ---- roads -----------------------------------------------------------------------------------------------
export type RoadKind = 'hidden' | 'dotted' | 'open' | 'walked' | 'spur' | 'stub';
/** How an edge draws for an account: both ends known and walked, one end walked, only known, or a stub into fog. */
export function roadKind(a: AtlasAreaDef, b: AtlasAreaId | AtlasAreaDef, discovered: ReadonlySet<string>, completed: ReadonlySet<string>): RoadKind {
  const other = typeof b === 'string' ? findAtlasArea(b)! : b;
  const da = discovered.has(a.id), db = discovered.has(other.id);
  const ca = completed.has(a.id), cb = completed.has(other.id);
  if (da && db) {
    if (a.deadEnd || other.deadEnd) return 'spur';
    if (ca && cb) return 'walked';
    if (ca || cb) return 'open';
    return 'dotted';
  }
  if ((da && ca && !db && !other.sealed) || (db && cb && !da && !a.sealed)) return 'stub';
  return 'hidden';
}

// ---- node identity ---------------------------------------------------------------------------------------
export const MATERIALS = ['iron', 'bronze', 'gilt', 'ember', 'void'] as const;
export type Material = (typeof MATERIALS)[number];
export const MATERIAL_LABEL: Record<Material, string> = { iron: 'Forged iron', bronze: 'Bronze', gilt: 'Gilt', ember: 'Ember-cracked', void: 'Void-etched' };
/** Ceiling bands: T1-3 iron, T4-6 bronze, T7-9 gilt, T10-12 ember-cracked, T13-15 void-etched. */
export const tierBand = (ceiling: number): number => Math.max(0, Math.min(4, Math.floor((ceiling - 1) / 3)));
/** One extra bright rivet per tier inside the band, so T5 and T6 read apart without text. */
export const tierRivets = (ceiling: number): number => ((Math.max(1, ceiling) - 1) % 3) + 1;
export const materialOf = (ceiling: number): Material => MATERIALS[tierBand(ceiling)];

export interface ThemeDef { id: MapBaseId; label: string; glow: string; emblem: string; }
export const THEMES: Readonly<Record<MapBaseId, ThemeDef>> = {
  ashenForge: { id: 'ashenForge', label: 'Ashen Forge', glow: '#e8662a', emblem: 'anvil over a coal' },
  cinderChapel: { id: 'cinderChapel', label: 'Cinder Chapel', glow: '#e0b04a', emblem: 'broken rose window' },
  rimedOssuary: { id: 'rimedOssuary', label: 'Rimed Ossuary', glow: '#7fc6e8', emblem: 'skull in ice' },
  choralCrypt: { id: 'choralCrypt', label: 'Choral Crypt', glow: '#c07bff', emblem: 'cantor in a niche' },
  ironColiseum: { id: 'ironColiseum', label: 'Iron Coliseum', glow: '#c2683a', emblem: 'arch and crossed blades' },
  chainworks: { id: 'chainworks', label: 'Chainworks', glow: '#9a919c', emblem: 'cog and hook' },
} as unknown as Record<MapBaseId, ThemeDef>;

/** Sealed door colour per key (brief 5.2). */
export const KEY_COLOUR: Readonly<Record<string, string>> = {
  reliquaryKey: '#7fc6e8', gildedKey: '#e0b04a', blackKey: '#e8662a', huntingKey: '#b8523a', riftKey: '#c07bff',
};
export const keyOfArea = (id: AtlasAreaId): string | undefined => ATLAS_KEYS.find((k) => k.areaId === id)?.currencyId;

/** Crown pips over the plate: 0 for no boss, 2 for keystone-unique bosses, else 1. */
export function crownPips(a: AtlasAreaDef): number {
  return a.noBoss ? 0 : a.uniquePool ? 2 : 1;
}

/** Areas whose ceiling is `tier` (the sweet spot flag). */
export const ceilingOf = atlasTierCeiling;

/** Which undiscovered areas show a smoke plume: an unrevealed neighbour of a completed area. */
export function plumeAreas(discovered: ReadonlySet<string>, completed: ReadonlySet<string>): AtlasAreaId[] {
  const out = new Set<AtlasAreaId>();
  for (const a of ATLAS_AREAS) {
    if (!completed.has(a.id)) continue;
    for (const n of a.neighbours) {
      const b = findAtlasArea(n);
      if (b && !discovered.has(b.id) && !b.sealed) out.add(b.id);
    }
  }
  return [...out];
}
