// Ashen Forge no. 3: Furnace Yard, "Vats" (D-territory.md 10.7). R 990 (T5).
// Reads as: the vats. Four big slag vats (r 40) at (+-0.3, +-0.3) are joined by pipe walls that leave a cross-shaped passage 120 u
// wide; the crucible (a glowing, walk-through pool r 90) lies at the landing in the middle. Each outer quadrant holds a lane of
// crates and stones. The Wayside Anvil anchors sit on the crucible rim. The boss comes up on the south-east rim.
// Weak spot (accepted): a pillar-dense centre; ranged builds kite well, melee packs snag on the pipes.
import { defineLayout, type AreaLayout, type LayoutCluster } from '../schema';
import { perches, pool } from '../packs/ashenChapelKit';

const R = 990;
const SQ = 0.3; // half side of the vat square (R)
const PIPE = SQ - 0.056; // pipe walls stop at the vats (vat r 40 + wall piece r 12)

const p = perches(R, [
  { id: 'perch-ne', at: { r: 0.62, a: 25 } },
  { id: 'perch-nw', at: { r: 0.62, a: 335 } },
  { id: 'perch-sw', at: { r: 0.62, a: 205 } },
  { id: 'perch-s', at: { r: 0.66, a: 160 } },
]);

/** A radial lane of crates flanked by standing stones in an outer quadrant. */
const crateLane = (a: number): LayoutCluster[] => [
  { id: `crates-${a}`, pattern: 'line', at: { r: 0.46, a }, params: { length: 150, bearing: a, count: 4 }, prop: 'crate', variant: a % 2 },
  { id: `stones-${a}`, pattern: 'arc', at: { r: 0.54, a }, params: { r: 40, count: 4, a0: a - 60, a1: a + 60 }, prop: 'standingStone' },
];

export const FURNACE_YARD: AreaLayout = defineLayout({
  areaId: 'furnaceYard',
  version: 1,
  landmarks: [
    { id: 'crucible', kind: 'crucible', at: [0, 0], r: 90 },
    { id: 'vat-nw', kind: 'vat', at: [-SQ, -SQ], r: 40, variant: 0 },
    { id: 'vat-ne', kind: 'vat', at: [SQ, -SQ], r: 40, variant: 1 },
    { id: 'vat-sw', kind: 'vat', at: [-SQ, SQ], r: 40, variant: 1 },
    { id: 'vat-se', kind: 'vat', at: [SQ, SQ], r: 40, variant: 0 },
    { id: 'bellows-nw', kind: 'bellows', at: { r: 0.5, a: 322 }, variant: 0 },
    { id: 'bellows-ne', kind: 'bellows', at: { r: 0.5, a: 38 }, variant: 1 },
    { id: 'bellows-sw', kind: 'bellows', at: { r: 0.5, a: 218 }, variant: 1 },
    { id: 'bellows-se', kind: 'bellows', at: { r: 0.5, a: 142 }, variant: 0 },
    { id: 'altar-w', kind: 'altar', at: { r: 0.78, a: 285 }, variant: 1 },
    ...p.covers,
  ],
  clusters: [
    // Ritual circle in the north-east, the one hiding place the yard offers outside the pipes.
    { id: 'circle-ne', pattern: 'ring', at: { r: 0.72, a: 55 }, params: { r: 56, count: 6, rot: 20 }, prop: 'standingStone' },
    ...[45, 225, 315].flatMap(crateLane),
    { id: 'crates-se', pattern: 'line', at: { r: 0.46, a: 135 }, params: { length: 120, bearing: 135, count: 3 }, prop: 'crate' },
    { id: 'rubble-yard', pattern: 'scatter', at: [0.12, 0.68], params: { r: 130, count: 8, radius: 0 }, prop: 'rubble' },
    { id: 'rubble-w', pattern: 'scatter', at: [-0.75, 0.2], params: { r: 120, count: 6, radius: 0 }, prop: 'rubble' },
  ],
  walls: [
    // The four pipe walls of the vat square, each with a 120 u gate at its middle (the cross-shaped passage).
    { id: 'pipe-n', path: [[-PIPE, -SQ], [PIPE, -SQ]], gaps: [{ at: 0.5, width: 120 }] },
    { id: 'pipe-s', path: [[-PIPE, SQ], [PIPE, SQ]], gaps: [{ at: 0.5, width: 120 }] },
    { id: 'pipe-w', path: [[-SQ, -PIPE], [-SQ, PIPE]], gaps: [{ at: 0.5, width: 120 }] },
    { id: 'pipe-e', path: [[SQ, -PIPE], [SQ, PIPE]], gaps: [{ at: 0.5, width: 120 }] },
  ],
  decals: [
    { id: 'arm-n', kind: 'road', path: [[0, -SQ], [0, -0.82]], width: 120 },
    { id: 'arm-s', kind: 'road', path: [[0, SQ], [0, 0.82]], width: 120 },
    { id: 'arm-w', kind: 'road', path: [[-SQ, 0], [-0.82, 0]], width: 120 },
    { id: 'arm-e', kind: 'road', path: [[SQ, 0], [0.82, 0]], width: 120 },
    { id: 'crack-a', kind: 'crack', path: [{ r: 0.5, a: 62 }, { r: 0.6, a: 72 }, { r: 0.7, a: 66 }] },
    { id: 'crack-b', kind: 'crack', path: [{ r: 0.5, a: 252 }, { r: 0.62, a: 262 }, { r: 0.72, a: 256 }] },
    { id: 'crack-c', kind: 'crack', path: [{ r: 0.54, a: 160 }, { r: 0.66, a: 152 }, { r: 0.76, a: 164 }] },
    { id: 'slag-w', kind: 'pool', at: { r: 0.74, a: 300 }, r: 66 },
    { id: 'slag-s', kind: 'pool', at: { r: 0.66, a: 190 }, r: 48 },
    { id: 'circle-glyph', kind: 'glyph', at: { r: 0.72, a: 55 }, r: 76 },
  ],
  lanes: [
    // Waves 1-2 stay in the outer yard; the arms (the 120 u passage) are the stage of waves 3-4; wave 5-6 adds the vat square.
    { id: 'arm-n', path: [[0, -0.36], [0, -0.78]], width: 120, weight: 1.5, wave: [3, 6], favours: ['melee'] },
    { id: 'arm-e', path: [[0.36, 0], [0.78, 0]], width: 120, weight: 1.5, wave: [3, 6], favours: ['fast'] },
    { id: 'arm-s', path: [[0, 0.36], [0, 0.78]], width: 120, weight: 1.5, wave: [3, 6], favours: ['ranged'] },
    { id: 'arm-w', path: [[-0.36, 0], [-0.78, 0]], width: 120, weight: 1.5, wave: [3, 6] },
  ],
  zones: [
    { id: 'q-ne', shape: 'disc', at: { r: 0.62, a: 45 }, r: 280, weight: 1.2 },
    { id: 'q-se', shape: 'disc', at: { r: 0.62, a: 135 }, r: 260, weight: 1, wave: [1, 5] },
    { id: 'q-sw', shape: 'disc', at: { r: 0.62, a: 225 }, r: 280, weight: 1.2 },
    { id: 'q-nw', shape: 'disc', at: { r: 0.62, a: 315 }, r: 280, weight: 1.2 },
    { id: 'square', shape: 'disc', at: [0, 0], r: 300, weight: 0.8, wave: [5, 6] },
  ],
  bossStage: { at: { r: 0.8, a: 135 }, r: 140, arrive: 'rim', facing: 315 },
  anchors: [
    ...p.anchors,
    { id: 'echo-e', fits: 'echo', at: { r: 0.58, a: 90 } },
    { id: 'echo-w', fits: 'echo', at: { r: 0.58, a: 270 } },
    { id: 'relay-1', fits: 'relay', at: { r: 0.62, a: 0 } },
    { id: 'relay-2', fits: 'relay', at: { r: 0.62, a: 120 } },
    { id: 'relay-3', fits: 'relay', at: { r: 0.62, a: 240 } },
    { id: 'fault-w', fits: 'fault', at: [-0.7, -0.1], path: [[-0.7, -0.3], [-0.7, 0.1]] },
    { id: 'fault-e', fits: 'fault', at: [0.64, -0.1], path: [[0.64, -0.3], [0.64, 0.1]] },
    { id: 'anvil-w', fits: 'anvil', at: [-0.11, 0.0] },
    { id: 'anvil-e', fits: 'anvil', at: [0.11, 0.0] },
    { id: 'road-s', fits: 'road', at: [0, 0.5], path: [[-0.7, 0.52], [0.7, 0.52]] },
    { id: 'altar-1', fits: 'altar', at: { r: 0.4, a: 285 } },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.4, a: 75 } },
    { id: 'ring-1', fits: 'ring', at: { r: 0.4, a: 200 } },
    { id: 'host-1', fits: 'host', at: { r: 0.42, a: 345 } },
    { id: 'bell-1', fits: 'bell', at: { r: 0.4, a: 105 } },
  ],
  rareSpots: [
    { at: { r: 0.62, a: 310 }, r: 100, weight: 2 },
    { at: { r: 0.62, a: 230 }, r: 100, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      pool([0, 0], 210, '#ff7a30', 0.5),
      pool({ r: 0.74, a: 300 }, 100, '#ff6a2a', 0.3),
      pool({ r: 0.8, a: 135 }, 160, '#ff5a20', 0.3),
    ],
  },
  scatter: { density: 6, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
