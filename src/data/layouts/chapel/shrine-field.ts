// Cinder Chapel no. 9: Shrine Field, "Shrines" (D-territory.md 10.7). R 800 (T15 ceiling, no boss, event x3).
// Reads as: a meadow of lit stones. Open ground with nine shrines (an altar with two candle flames, solid r 9) on a 3 x 3 lattice
// rotated 12 degrees; every shrine is an event anchor (relay / perch-cover / altar / orchard mix) so the tripled event odds always
// have a stage. The central shrine is the finish (the clear chest follows the last player; the stage below is declared only
// because the schema needs one, the area has no boss).
// Deviations: lattice spacing is 200 u (template ~130): three relay corners must be >= 300 u apart (check 4) and the landing
// disc must stay free; the landing is on the open south meadow (r 0.54) so the three south shrines (taller, r 14) are the
// Stalker's cover; four extra cover stones stand on the perch lines (a shrine lattice alone cannot put cover inside the
// 140-380 u window of check 5); the candles are the altar sprite's flames plus a warm light pool each (no candle prop kind).
// Weak spot (accepted): no real cover but the shrines; the Stalker gets few pillars.
import { defineLayout, type AreaLayout, type LayoutAnchor, type LayoutLandmark, type Pt } from '../schema';
import { perches, pool } from '../packs/ashenChapelKit';

const R = 800;
const START = { r: 0.54, a: 180 } as const;
const SP = 200;
const ROT = (12 * Math.PI) / 180;
const at = (gx: number, gy: number): [number, number] => [
  (gx * SP * Math.cos(ROT) - gy * SP * Math.sin(ROT)) / R,
  (gx * SP * Math.sin(ROT) + gy * SP * Math.cos(ROT)) / R,
];
/** A point `d` u beyond (gx, gy), in the direction away from the landing (anchors stand beside their shrine, not inside it). */
const beside = (gx: number, gy: number, d = 36): [number, number] => {
  const [x, y] = at(gx, gy);
  const dx = x * R - 0;
  const dy = y * R - START.r * R;
  const len = Math.hypot(dx, dy) || 1;
  return [x + (dx / len) * (d / R), y + (dy / len) * (d / R)];
};

const GRID: { id: string; gx: number; gy: number; tall?: boolean }[] = [
  { id: 'nw', gx: -1, gy: -1 }, { id: 'n', gx: 0, gy: -1 }, { id: 'ne', gx: 1, gy: -1 },
  { id: 'w', gx: -1, gy: 0 }, { id: 'c', gx: 0, gy: 0 }, { id: 'e', gx: 1, gy: 0 },
  { id: 'sw', gx: -1, gy: 1, tall: true }, { id: 's', gx: 0, gy: 1, tall: true }, { id: 'se', gx: 1, gy: 1, tall: true },
];
const shrines: LayoutLandmark[] = GRID.map((g, k) => ({ id: `shrine-${g.id}`, kind: 'altar', at: at(g.gx, g.gy), r: g.tall ? 14 : 9, variant: k % 2 }));
const sh = (id: string): { gx: number; gy: number } => GRID.find((g) => g.id === id)!;
const site = (id: string, fits: LayoutAnchor['fits'], gridId: string): LayoutAnchor => ({ id, fits, at: beside(sh(gridId).gx, sh(gridId).gy) });

const p = perches(R, [
  { id: 'perch-n', at: beside(0, -1), cover: 300, prop: 'pillar' },
  { id: 'perch-w', at: beside(-1, 0), cover: 300, prop: 'pillar' },
  { id: 'perch-e', at: beside(1, 0), cover: 300, prop: 'pillar' },
  { id: 'perch-c', at: beside(0, 0), cover: 335, prop: 'pillar' },
], START);

const ptPolar = (r: number, a: number): Pt => ({ r, a });

export const SHRINE_FIELD: AreaLayout = defineLayout({
  areaId: 'shrineField',
  version: 1,
  start: { at: START },
  landmarks: [...shrines, ...p.covers],
  clusters: [
    { id: 'rubble-w', pattern: 'scatter', at: ptPolar(0.62, 270), params: { r: 150, count: 7, radius: 0 }, prop: 'rubble' },
    { id: 'rubble-e', pattern: 'scatter', at: ptPolar(0.62, 90), params: { r: 150, count: 7, radius: 0 }, prop: 'rubble' },
    { id: 'bones-n', pattern: 'scatter', at: ptPolar(0.5, 5), params: { r: 120, count: 5, radius: 0 }, prop: 'bones' },
    { id: 'banners-w', pattern: 'line', at: [-0.5, -0.4], params: { length: 240, bearing: 160, count: 4 }, prop: 'banner', variant: 1 },
    { id: 'banners-e', pattern: 'line', at: [0.5, -0.4], params: { length: 240, bearing: 200, count: 4 }, prop: 'banner', variant: 3 },
  ],
  walls: [],
  decals: [
    { id: 'meadow-glyph', kind: 'glyph', at: [0, 0], r: 250 },
    { id: 'centre-glyph', kind: 'glyph', at: [0, 0], r: 78 },
    { id: 'path-start', kind: 'road', path: [[0, 0.54], [0, 0.2]], width: 90 },
    { id: 'shaft-w', kind: 'light', at: [-0.5, -0.1], r: 120 },
    { id: 'shaft-e', kind: 'light', at: [0.5, 0.05], r: 120 },
    { id: 'crack-n', kind: 'crack', path: [{ r: 0.42, a: 330 }, { r: 0.56, a: 340 }, { r: 0.7, a: 332 }] },
  ],
  lanes: [
    // The lattice ring, fought late; the meadow zones below take the first waves.
    { id: 'lattice-ring', path: [{ r: 0.52, a: 20 }, { r: 0.52, a: 90 }, { r: 0.52, a: 160 }], width: 140, weight: 0.9, wave: [3, 6], favours: ['fast'] },
    { id: 'lattice-ring-w', path: [{ r: 0.52, a: 200 }, { r: 0.52, a: 270 }, { r: 0.52, a: 340 }], width: 140, weight: 0.9, wave: [3, 6], favours: ['melee'] },
  ],
  zones: [
    { id: 'meadow-w', shape: 'disc', at: [-0.5, -0.1], r: 260, weight: 1.2 },
    { id: 'meadow-e', shape: 'disc', at: [0.5, -0.1], r: 260, weight: 1.2 },
    { id: 'meadow-n', shape: 'disc', at: [0, -0.58], r: 260, weight: 1.1 },
    { id: 'lattice', shape: 'disc', at: [0, 0], r: 260, weight: 1.2, wave: [4, 6] },
  ],
  // No boss: this open northern clearing is the schema's required stage and the area's last-wave gathering ground.
  bossStage: { at: [0, -0.7], r: 150, arrive: 'rim', facing: 180 },
  anchors: [
    ...p.anchors,
    site('relay-nw', 'relay', 'nw'),
    site('relay-ne', 'relay', 'ne'),
    site('relay-sw', 'relay', 'sw'),
    site('orchard-se', 'orchard', 'se'),
    site('altar-s', 'altar', 's'),
    { id: 'orchard-w', fits: 'orchard', at: ptPolar(0.6, 250) },
    { id: 'echo-nw', fits: 'echo', at: ptPolar(0.66, 315) },
    { id: 'echo-ne', fits: 'echo', at: ptPolar(0.66, 45) },
    { id: 'fault-w', fits: 'fault', at: [-0.62, -0.2], path: [[-0.62, -0.4], [-0.62, 0]] },
    { id: 'road-south', fits: 'road', at: [0, 0.4], path: [[-0.7, 0.4], [0.7, 0.4]] },
    { id: 'ring-1', fits: 'ring', at: ptPolar(0.5, 90) },
    { id: 'host-1', fits: 'host', at: ptPolar(0.5, 270) },
    { id: 'anvil-1', fits: 'anvil', at: ptPolar(0.62, 330) },
    { id: 'bell-1', fits: 'bell', at: ptPolar(0.62, 30) },
  ],
  rareSpots: [
    { at: [-0.5, -0.1], r: 100, weight: 2 },
    { at: [0.5, -0.1], r: 100, weight: 2 },
  ],
  light: {
    ambient: 0.1,
    pools: GRID.map((g) => pool(at(g.gx, g.gy), g.tall ? 80 : 65, '#ffc880', 0.55)),
  },
  scatter: { density: 6, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
