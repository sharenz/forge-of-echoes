// TEST FIXTURE (not registered for any real area): an Ashen Forge sample layout used by the validator tests, the
// runtime tests and dev/layouts.html. It borrows `furnaceYard` as its areaId only because the schema needs an AtlasAreaId
// (radius 990, a forge-type area); the shipped Furnace Yard design (D-territory.md 10.7 no. 3) is a layout-pack job.
//
// Read: four slag vats at the corners of a 594 u square joined by pipe walls with a 120 u gate in the middle of every
// side (the cross-shaped passage), the crucible at the landing in the yard, ritual stone circles in the outer quadrants,
// the boss on the south rim. Perches sit where the line to the landing crosses a pipe wall (the Stalker cover rule).
import { defineLayout, type AreaLayout } from '../schema';

const SQ = 0.3; // half side of the vat square, in R
const PIPE = SQ - 0.047; // the pipe walls stop short of the vats (vat r 30 + wall piece r 12)

export const SLAG_YARD: AreaLayout = defineLayout({
  areaId: 'furnaceYard',
  version: 1,
  fixture: true,
  landmarks: [
    { id: 'crucible', kind: 'crucible', at: [0, 0], r: 90 },
    { id: 'vat-nw', kind: 'vat', at: [-SQ, -SQ], variant: 0 },
    { id: 'vat-ne', kind: 'vat', at: [SQ, -SQ], variant: 0 },
    { id: 'vat-sw', kind: 'vat', at: [-SQ, SQ], variant: 1 },
    { id: 'vat-se', kind: 'vat', at: [SQ, SQ], variant: 0 },
    { id: 'bellows-w', kind: 'bellows', at: { r: 0.46, a: 300 }, variant: 0 },
    { id: 'bellows-e', kind: 'bellows', at: { r: 0.46, a: 60 }, variant: 1 },
    { id: 'altar-n', kind: 'altar', at: { r: 0.8, a: 20 }, variant: 1 },
    { id: 'altar-s', kind: 'altar', at: { r: 0.72, a: 215 }, variant: 1 },
  ],
  clusters: [
    // Ritual circles in the outer quadrants.
    ...[45, 135, 225, 315].map((a) => ({
      id: `circle-${a}`, pattern: 'ring' as const, at: { r: 0.6, a }, params: { r: 56, count: 6, rot: 10 }, prop: 'standingStone' as const,
    })),
    // Braziers framing the landing, outside the 140 u clearing.
    { id: 'landing-braziers', pattern: 'ring', at: [0, 0], params: { r: 175, count: 4, rot: 45 }, prop: 'brazier' },
    // Crates and rubble lines along the arms.
    { id: 'crates-n', pattern: 'line', at: { r: 0.55, a: 340 }, params: { length: 120, bearing: 0, count: 3 }, prop: 'crate' },
    { id: 'crates-s', pattern: 'line', at: { r: 0.55, a: 160 }, params: { length: 120, bearing: 180, count: 3 }, prop: 'crate', variant: 1 },
  ],
  walls: [
    // The four pipe walls of the vat square, each with a 120 u gate at its middle.
    { id: 'pipe-n', path: [[-PIPE, -SQ], [PIPE, -SQ]], cover: 'low', gaps: [{ at: 0.5, width: 120 }] },
    { id: 'pipe-s', path: [[-PIPE, SQ], [PIPE, SQ]], cover: 'low', gaps: [{ at: 0.5, width: 120 }] },
    { id: 'pipe-w', path: [[-SQ, -PIPE], [-SQ, PIPE]], cover: 'low', gaps: [{ at: 0.5, width: 120 }] },
    { id: 'pipe-e', path: [[SQ, -PIPE], [SQ, PIPE]], cover: 'low', gaps: [{ at: 0.5, width: 120 }] },
  ],
  decals: [
    { id: 'road-n', kind: 'road', path: [[0, -SQ], [0, -0.82]], width: 110 },
    { id: 'road-s', kind: 'road', path: [[0, SQ], [0, 0.82]], width: 110 },
    { id: 'road-w', kind: 'road', path: [[-SQ, 0], [-0.82, 0]], width: 110 },
    { id: 'road-e', kind: 'road', path: [[SQ, 0], [0.82, 0]], width: 110 },
    { id: 'crack-a', kind: 'crack', path: [{ r: 0.5, a: 60 }, { r: 0.64, a: 75 }, { r: 0.8, a: 70 }] },
    { id: 'crack-b', kind: 'crack', path: [{ r: 0.5, a: 250 }, { r: 0.66, a: 262 }, { r: 0.82, a: 255 }] },
    { id: 'pool-slag', kind: 'pool', at: { r: 0.7, a: 300 }, r: 70 },
    { id: 'glyph-ne', kind: 'glyph', at: { r: 0.6, a: 45 }, r: 70 },
    { id: 'glyph-se', kind: 'glyph', at: { r: 0.6, a: 135 }, r: 70 },
    { id: 'glyph-sw', kind: 'glyph', at: { r: 0.6, a: 225 }, r: 70 },
    { id: 'glyph-nw', kind: 'glyph', at: { r: 0.6, a: 315 }, r: 70 },
  ],
  lanes: [
    { id: 'arm-n', path: [[0, -SQ], [0, -0.78]], width: 120, weight: 2, favours: ['melee'] },
    { id: 'arm-e', path: [[SQ, 0], [0.78, 0]], width: 120, weight: 2, favours: ['fast'] },
    { id: 'arm-s', path: [[0, SQ], [0, 0.78]], width: 120, weight: 2, favours: ['ranged'] },
    { id: 'arm-w', path: [[-SQ, 0], [-0.78, 0]], width: 120, weight: 2 },
  ],
  zones: [
    { id: 'q-ne', shape: 'sector', at: [0, 0], r: 900, a0: 0, a1: 90, weight: 1 },
    { id: 'q-se', shape: 'sector', at: [0, 0], r: 900, a0: 90, a1: 180, weight: 1 },
    { id: 'q-sw', shape: 'sector', at: [0, 0], r: 900, a0: 180, a1: 270, weight: 1 },
    { id: 'q-nw', shape: 'sector', at: [0, 0], r: 900, a0: 270, a1: 360, weight: 1 },
  ],
  bossStage: { at: { r: 0.8, a: 180 }, r: 130, arrive: 'rim', facing: 0 },
  anchors: [
    { id: 'perch-1', fits: 'perch', at: { r: 0.62, a: 28 } },
    { id: 'perch-2', fits: 'perch', at: { r: 0.62, a: 152 } },
    { id: 'perch-3', fits: 'perch', at: { r: 0.62, a: 208 } },
    { id: 'perch-4', fits: 'perch', at: { r: 0.62, a: 332 } },
    { id: 'echo-e', fits: 'echo', at: { r: 0.55, a: 90 } },
    { id: 'echo-w', fits: 'echo', at: { r: 0.55, a: 270 } },
    { id: 'road-south', fits: 'road', at: [0, 0.5], path: [[-0.7, 0.5], [0.7, 0.5]] },
    { id: 'fault-e', fits: 'fault', at: [0.5, 0.55], path: [[0.5, 0.4], [0.5, 0.7]] },
    { id: 'fault-w', fits: 'fault', at: [-0.5, -0.55], path: [[-0.5, -0.7], [-0.5, -0.4]] },
    { id: 'relay-1', fits: 'relay', at: { r: 0.5, a: 0 } },
    { id: 'relay-2', fits: 'relay', at: { r: 0.5, a: 120 } },
    { id: 'relay-3', fits: 'relay', at: { r: 0.5, a: 240 } },
    { id: 'altar-1', fits: 'altar', at: { r: 0.36, a: 45 } },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.22, a: 270 } },
    { id: 'ring-1', fits: 'ring', at: { r: 0.22, a: 90 } },
    { id: 'host-1', fits: 'host', at: { r: 0.22, a: 180 } },
    { id: 'anvil-n', fits: 'anvil', at: [0, -0.12] },
    { id: 'anvil-s', fits: 'anvil', at: [0, 0.12] },
    { id: 'bell-1', fits: 'bell', at: { r: 0.66, a: 90 } },
  ],
  rareSpots: [
    { at: { r: 0.62, a: 100 }, r: 90, weight: 2 },
    { at: { r: 0.62, a: 300 }, r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: [0, 0], r: 150, colour: '#ff8a3c', flicker: 0.4 },
      { at: { r: 0.7, a: 300 }, r: 110, colour: '#ff6a2a', flicker: 0.3 },
    ],
  },
  scatter: { density: 6, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
