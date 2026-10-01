// Ashen Forge no. 1: Cinder Crossing, "Crossing" (D-territory.md 10.7). R 900 (T1 teaching ground, frontier).
// Reads as: the cross. Two paved causeways meet at the brazier-lit landing; four ritual stone circles sit in the quadrants
// (the obvious hiding places); the boss waits at the broken North gate.
// Deviations from the template: the landing braziers stand at r 0.18 (162 u), not 0.12 (they would sit inside the 140 u
// start clearing and the 300 u landing disc); the gate pillars stand 235 u either side of the stage (check 3 wants a
// 400 u free disc beside the boss stage).
// Weak spot (accepted): predictable on purpose; quadrant funnelling makes packs easy to read, good at T1.
import { defineLayout, type AreaLayout, type LayoutCluster, type LayoutLandmark } from '../schema';
import { bearings, perches, pool } from '../packs/ashenChapelKit';

const R = 900;
const QUAD = [45, 135, 225, 315];

const p = perches(R, [
  { id: 'perch-1', at: { r: 0.62, a: 20 } },
  { id: 'perch-2', at: { r: 0.62, a: 110 } },
  { id: 'perch-3', at: { r: 0.62, a: 200 } },
  { id: 'perch-4', at: { r: 0.62, a: 290 } },
]);

/** Low rubble lips along both edges of each causeway arm (walk-through decoration). */
const lips: LayoutCluster[] = bearings(0, 4).flatMap((a) =>
  [-1, 1].map((side): LayoutCluster => {
    // arm direction from bearing a; the lip runs 70 u beside the arm axis (road half width 60).
    const rad = (a * Math.PI) / 180;
    const ox = Math.sin(rad);
    const oy = -Math.cos(rad);
    const nx = -oy * side * 74;
    const ny = ox * side * 74;
    return {
      id: `lip-${a}-${side}`, pattern: 'line', at: [(ox * 190 + nx) / R, (oy * 190 + ny) / R],
      params: { length: 520, bearing: a, count: 14, radius: 0 }, prop: 'rubble', variant: side > 0 ? 1 : 2,
    };
  }),
);

const circles: LayoutLandmark[] = QUAD.map((a) => ({ id: `circle-fire-${a}`, kind: 'brazier', at: { r: 0.55, a } }));

export const CINDER_CROSSING: AreaLayout = defineLayout({
  areaId: 'cinderCrossing',
  version: 1,
  landmarks: [
    ...circles,
    { id: 'gate-pillar-w', kind: 'pillar', at: [-0.26, -0.76], variant: 2 },
    { id: 'gate-pillar-e', kind: 'pillar', at: [0.26, -0.76], variant: 3 },
    { id: 'gate-stair', kind: 'stair', at: [0, -0.87], r: 54 },
    ...p.covers,
  ],
  clusters: [
    // Four ritual circles: six stones on a 56 u ring round a brazier.
    ...QUAD.map((a): LayoutCluster => ({ id: `circle-${a}`, pattern: 'ring', at: { r: 0.55, a }, params: { r: 56, count: 6, rot: a % 90 + 8 }, prop: 'standingStone' })),
    // The landing braziers (on the diagonals so both causeways stay open).
    { id: 'landing-braziers', pattern: 'ring', at: [0, 0], params: { r: 162, count: 4, rot: 45 }, prop: 'brazier' },
    ...lips,
  ],
  walls: [],
  decals: [
    { id: 'causeway-ns', kind: 'road', path: [[0, -0.8], [0, 0.8]], width: 120 },
    { id: 'causeway-ew', kind: 'road', path: [[-0.8, 0], [0.8, 0]], width: 120 },
    ...QUAD.map((a) => ({ id: `glyph-${a}`, kind: 'glyph' as const, at: { r: 0.55, a }, r: 76 })),
    { id: 'crack-ne', kind: 'crack', path: [{ r: 0.3, a: 20 }, { r: 0.4, a: 27 }, { r: 0.5, a: 19 }] },
    { id: 'crack-sw', kind: 'crack', path: [{ r: 0.32, a: 200 }, { r: 0.44, a: 192 }, { r: 0.54, a: 203 }] },
    { id: 'crack-nw', kind: 'crack', path: [{ r: 0.36, a: 296 }, { r: 0.48, a: 303 }, { r: 0.58, a: 296 }] },
    { id: 'slag-se', kind: 'pool', at: { r: 0.8, a: 150 }, r: 54 },
  ],
  lanes: [
    // Early waves keep to the quadrant fields; the causeways open up from wave 3 (the funnel the player learns to read).
    { id: 'arm-n', path: [[0, -0.22], [0, -0.72]], width: 120, weight: 1.6, wave: [3, 6], favours: ['melee'] },
    { id: 'arm-e', path: [[0.22, 0], [0.72, 0]], width: 120, weight: 1.6, wave: [3, 6], favours: ['fast'] },
    { id: 'arm-s', path: [[0, 0.22], [0, 0.72]], width: 120, weight: 1.6, wave: [3, 6], favours: ['ranged'] },
    { id: 'arm-w', path: [[-0.22, 0], [-0.72, 0]], width: 120, weight: 1.6, wave: [3, 6] },
  ],
  zones: [
    ...QUAD.map((a, i) => ({ id: `quad-${a}`, shape: 'disc' as const, at: { r: 0.5, a }, r: 300, weight: 1.2, wave: [1, i % 2 ? 6 : 5] as [number, number] })),
    { id: 'rim', shape: 'disc', at: [0, 0], r: 780, weight: 0.35, wave: [5, 6] },
  ],
  bossStage: { at: { r: 0.8, a: 0 }, r: 150, arrive: 'gate', facing: 180 },
  anchors: [
    ...p.anchors,
    { id: 'echo-ne', fits: 'echo', at: { r: 0.72, a: 45 } },
    { id: 'echo-sw', fits: 'echo', at: { r: 0.72, a: 225 } },
    { id: 'relay-1', fits: 'relay', at: { r: 0.5, a: 0 } },
    { id: 'relay-2', fits: 'relay', at: { r: 0.5, a: 120 } },
    { id: 'relay-3', fits: 'relay', at: { r: 0.5, a: 240 } },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.36, a: 135 } },
    { id: 'orchard-2', fits: 'orchard', at: { r: 0.36, a: 315 } },
    { id: 'road-ew', fits: 'road', at: [0, 0], path: [[-0.74, 0], [0.74, 0]] },
    { id: 'fault-w', fits: 'fault', at: [-0.58, 0.34], path: [[-0.58, 0.18], [-0.58, 0.5]] },
    { id: 'altar-1', fits: 'altar', at: { r: 0.3, a: 90 } },
    { id: 'ring-1', fits: 'ring', at: { r: 0.3, a: 270 } },
    { id: 'host-1', fits: 'host', at: { r: 0.3, a: 180 } },
    { id: 'anvil-1', fits: 'anvil', at: { r: 0.3, a: 0 } },
    { id: 'bell-1', fits: 'bell', at: { r: 0.42, a: 160 } },
  ],
  rareSpots: [
    { at: { r: 0.62, a: 80 }, r: 90, weight: 2 },
    { at: { r: 0.62, a: 260 }, r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      pool([0, 0], 190, '#ff8a3c', 0.4),
      ...QUAD.map((a) => pool({ r: 0.55, a }, 90, '#ff7a30', 0.35)),
      pool([0, -0.8], 150, '#ff6a2a', 0.3),
    ],
  },
  scatter: { density: 6, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
