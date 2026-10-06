// Ashen Forge no. 2: Ember Road, "Processional" (D-territory.md 10.7). R 855 (T3 ceiling).
// Reads as: the long colonnade. A 160 u street runs south to north between two pillar rows (braziers behind them); side bays
// W and E hold a stone circle each; the Vault's sealed stair sits at the NW rim; the boss waits behind a double-pillar gate at
// the north end. The caravan road runs the whole street (1.4 R).
// Deviations: the double-pillar gate stands 235 u either side of the stage (check 3 wants a free 400 u disc beside it);
// braziers sit at x +-128 u (r 0.15) behind the pillar rows.
// Weak spot (accepted): linear, so packs stack up the street (late waves lean on it; early waves use the bays and the yard).
import { defineLayout, type AreaLayout, type LayoutCluster } from '../schema';
import { atU, perches, pool } from '../packs/ashenChapelKit';

const R = 855;
const u = atU(R);

const p = perches(R, [
  { id: 'perch-nw', at: [-0.5, -0.3], prop: 'standingStone' },
  { id: 'perch-ne', at: [0.5, -0.3], prop: 'standingStone' },
  { id: 'perch-sw', at: [-0.3, 0.34], prop: 'standingStone' },
  { id: 'perch-se', at: [0.3, 0.34], prop: 'standingStone' },
], [0, 0.74]);

const row = (id: string, x: number, y0: number, len: number, count: number, prop: LayoutCluster['prop']): LayoutCluster => ({
  id, pattern: 'line', at: u(x, y0), params: { length: len, bearing: 180, count }, prop,
});

export const EMBER_ROAD: AreaLayout = defineLayout({
  areaId: 'emberRoad',
  version: 1,
  start: { at: [0, 0.74] },
  landmarks: [
    { id: 'bay-w-fire', kind: 'brazier', at: [-0.5, 0] },
    { id: 'bay-e-fire', kind: 'brazier', at: [0.5, 0] },
    { id: 'gate-w-outer', kind: 'pillar', at: u(-235, -650), r: 14, variant: 2 },
    { id: 'gate-w-inner', kind: 'pillar', at: u(-235, -564), r: 14, variant: 3 },
    { id: 'gate-e-outer', kind: 'pillar', at: u(235, -650), r: 14, variant: 3 },
    { id: 'gate-e-inner', kind: 'pillar', at: u(235, -564), r: 14, variant: 2 },
    { id: 'vault-stair', kind: 'stair', at: { r: 0.84, a: 322 }, r: 52 },
    { id: 'north-stair', kind: 'stair', at: [0, -0.84], r: 54 },
    { id: 'banner-w', kind: 'banner', at: u(-128, 40), variant: 0 },
    { id: 'banner-e', kind: 'banner', at: u(128, 40), variant: 1 },
    ...p.covers,
  ],
  clusters: [
    // The colonnade: pillars every ~65 u (a 45 u gap: you can slip through, a pack can not stream), a bay opening at y 0.
    row('col-w-n', -85, -0.48 * R, 0.38 * R, 6, 'pillar'),
    row('col-e-n', 85, -0.48 * R, 0.38 * R, 6, 'pillar'),
    row('col-w-s', -85, 0.1 * R, 0.3 * R, 5, 'pillar'),
    row('col-e-s', 85, 0.1 * R, 0.3 * R, 5, 'pillar'),
    row('fire-w-n', -128, -0.44 * R, 0.3 * R, 5, 'brazier'),
    row('fire-e-n', 128, -0.44 * R, 0.3 * R, 5, 'brazier'),
    row('fire-w-s', -128, 0.13 * R, 0.22 * R, 4, 'brazier'),
    row('fire-e-s', 128, 0.13 * R, 0.22 * R, 4, 'brazier'),
    // The two bay circles.
    { id: 'bay-w-ring', pattern: 'ring', at: [-0.5, 0], params: { r: 56, count: 6, rot: 15 }, prop: 'standingStone' },
    { id: 'bay-e-ring', pattern: 'ring', at: [0.5, 0], params: { r: 56, count: 6, rot: 45 }, prop: 'standingStone' },
    // Decor: rubble along the street edges and bones in the bays (walk-through).
    { id: 'rubble-w', pattern: 'scatter', at: u(-210, -100), params: { r: 150, count: 6, radius: 0 }, prop: 'rubble' },
    { id: 'rubble-e', pattern: 'scatter', at: u(210, 120), params: { r: 150, count: 6, radius: 0 }, prop: 'rubble' },
    { id: 'bay-bones', pattern: 'scatter', at: [0.62, 0.1], params: { r: 90, count: 4, radius: 0 }, prop: 'bones' },
  ],
  walls: [],
  decals: [
    { id: 'avenue', kind: 'road', path: [[0, 0.64], [0, -0.7]], width: 160 },
    { id: 'bay-w-road', kind: 'road', path: [[-0.1, 0], [-0.5, 0]], width: 90 },
    { id: 'bay-e-road', kind: 'road', path: [[0.1, 0], [0.5, 0]], width: 90 },
    { id: 'bay-w-glyph', kind: 'glyph', at: [-0.5, 0], r: 76 },
    { id: 'bay-e-glyph', kind: 'glyph', at: [0.5, 0], r: 76 },
    { id: 'vault-glow', kind: 'light', at: { r: 0.84, a: 322 }, r: 110 },
    { id: 'crack-w', kind: 'crack', path: [[-0.72, 0.1], [-0.66, -0.02], [-0.72, -0.12]], hazard: { kind: 'burn' } },
    { id: 'crack-e', kind: 'crack', path: [[0.7, -0.3], [0.64, -0.2], [0.7, -0.1]], hazard: { kind: 'burn' } },
    { id: 'slag-s', kind: 'pool', at: [0.52, 0.62], r: 46, hazard: { kind: 'burn' } },
  ],
  lanes: [
    // The street: quiet early (the bays and yard take the first packs), the main stage of waves 3 to 6.
    { id: 'street-early', path: [[0, 0.42], [0, -0.46]], width: 160, weight: 0.7, wave: [1, 2] },
    { id: 'street', path: [[0, 0.42], [0, -0.46]], width: 160, weight: 2.2, wave: [3, 6], favours: ['melee'] },
    { id: 'yard-arc', path: [[-0.4, -0.5], [0, -0.55], [0.4, -0.5]], width: 150, weight: 1, wave: [2, 6], favours: ['ranged'] },
  ],
  zones: [
    { id: 'bay-w', shape: 'disc', at: [-0.5, 0], r: 210, weight: 1.3 },
    { id: 'bay-e', shape: 'disc', at: [0.5, 0], r: 210, weight: 1.3 },
    { id: 'yard-n', shape: 'disc', at: [0, -0.52], r: 250, weight: 1.1, wave: [2, 6] },
    { id: 'corner-nw', shape: 'disc', at: [-0.55, -0.5], r: 200, weight: 0.8, wave: [1, 4] },
    { id: 'corner-ne', shape: 'disc', at: [0.55, -0.5], r: 200, weight: 0.8, wave: [1, 4] },
  ],
  bossStage: { at: [0, -0.7], r: 150, arrive: 'gate', facing: 180 },
  anchors: [
    ...p.anchors,
    { id: 'echo-w', fits: 'echo', at: [-0.52, -0.45] },
    { id: 'echo-e', fits: 'echo', at: [0.52, -0.45] },
    { id: 'relay-w', fits: 'relay', at: [-0.58, 0.3] },
    { id: 'relay-e', fits: 'relay', at: [0.58, 0.3] },
    { id: 'relay-n', fits: 'relay', at: [0, -0.35] },
    { id: 'fault-w', fits: 'fault', at: [-0.64, -0.11], path: [[-0.64, -0.3], [-0.64, 0.08]] },
    { id: 'fault-e', fits: 'fault', at: [0.64, -0.11], path: [[0.64, -0.3], [0.64, 0.08]] },
    { id: 'anvil-w', fits: 'anvil', at: [-0.3, -0.16] },
    { id: 'anvil-e', fits: 'anvil', at: [0.3, -0.16] },
    { id: 'road-street', fits: 'road', at: [0, 0], path: [[0, 0.7], [0, -0.7]] },
    { id: 'altar-1', fits: 'altar', at: [0, -0.2] },
    { id: 'orchard-1', fits: 'orchard', at: [-0.28, -0.55] },
    { id: 'ring-1', fits: 'ring', at: [0.28, -0.55] },
    { id: 'host-1', fits: 'host', at: [-0.62, 0.52] },
    { id: 'bell-1', fits: 'bell', at: [0.51, 0.43] }, // pulled in so the Bellwatch's rings fit inside the arena (E1 check 10)
  ],
  rareSpots: [
    { at: [-0.5, 0], r: 100, weight: 2 },
    { at: [0.5, 0], r: 100, weight: 2 },
    { at: [0, -0.55], r: 110, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      pool([0, 0.74], 170, '#ff8a3c', 0.35),
      pool([0, -0.7], 190, '#ff6a2a', 0.3),
      pool({ r: 0.84, a: 322 }, 100, '#c4602c', 0.2),
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
