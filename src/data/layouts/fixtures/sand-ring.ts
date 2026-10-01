// TEST FIXTURE (not registered for any real area): an Iron Coliseum sample layout. It borrows `eternalArena` only for its
// areaId (radius 715, an arena-type area); the shipped Eternal Arena design (D-territory.md 10.7 no. 23) is a layout-pack job.
//
// Read: an open sand disc with a ring of pillars and torches, an inner ring of obelisks (the Stalker's cover, one on the
// line from every diagonal perch), the boss behind two gates on the north rim, statues on the south.
import { defineLayout, type AreaLayout } from '../schema';

export const SAND_RING: AreaLayout = defineLayout({
  areaId: 'eternalArena',
  version: 1,
  fixture: true,
  landmarks: [
    { id: 'gate-nw', kind: 'gate', at: { r: 0.88, a: 340 }, variant: 0 },
    { id: 'gate-ne', kind: 'gate', at: { r: 0.88, a: 20 }, variant: 0 },
    { id: 'statue-sw', kind: 'statue', at: { r: 0.8, a: 205 }, variant: 0 },
    { id: 'statue-se', kind: 'statue', at: { r: 0.8, a: 155 }, variant: 1 },
    { id: 'rack-w', kind: 'weaponRack', at: { r: 0.5, a: 250 } },
    { id: 'rack-e', kind: 'weaponRack', at: { r: 0.5, a: 110 }, variant: 1 },
    { id: 'sand-lake', kind: 'dais', at: [0, 0], r: 120 },
  ],
  clusters: [
    { id: 'pillars', pattern: 'ring', at: [0, 0], params: { r: 500, count: 8, rot: 22.5 }, prop: 'pillar' },
    { id: 'torches', pattern: 'ring', at: [0, 0], params: { r: 500, count: 4, rot: 45 }, prop: 'brazier' },
    { id: 'obelisks', pattern: 'ring', at: [0, 0], params: { r: 286, count: 4, rot: 45 }, prop: 'obelisk' },
  ],
  walls: [],
  decals: [
    { id: 'sand-ring', kind: 'glyph', at: [0, 0], r: 330 },
    { id: 'centre-ring', kind: 'glyph', at: [0, 0], r: 110 },
    { id: 'avenue', kind: 'road', path: [[0, -0.55], [0, -0.82]], width: 120 },
    { id: 'torch-pool', kind: 'light', at: { r: 0.7, a: 0 }, r: 160 },
  ],
  lanes: [
    { id: 'north-gate', path: [[0, -0.2], [0, -0.7]], width: 160, weight: 1, wave: [1, 3], favours: ['melee'] },
    { id: 'east', path: [[0.2, 0], [0.7, 0]], width: 160, weight: 1 },
    { id: 'west', path: [[-0.2, 0], [-0.7, 0]], width: 160, weight: 1, favours: ['fast'] },
    { id: 'south', path: [[0, 0.2], [0, 0.7]], width: 160, weight: 1, favours: ['ranged'] },
  ],
  zones: [
    { id: 'sand', shape: 'disc', at: [0, 0], r: 420, weight: 2 },
    { id: 'rim-ring', shape: 'disc', at: { r: 0.7, a: 90 }, r: 160, weight: 1, wave: [2, 9] },
    { id: 'rim-ring-w', shape: 'disc', at: { r: 0.7, a: 270 }, r: 160, weight: 1, wave: [2, 9] },
  ],
  bossStage: { at: { r: 0.8, a: 0 }, r: 130, arrive: 'gate', facing: 180 },
  anchors: [
    { id: 'perch-ne', fits: 'perch', at: { r: 0.78, a: 45 } },
    { id: 'perch-se', fits: 'perch', at: { r: 0.78, a: 135 } },
    { id: 'perch-sw', fits: 'perch', at: { r: 0.78, a: 225 } },
    { id: 'perch-nw', fits: 'perch', at: { r: 0.78, a: 315 } },
    { id: 'ring-1', fits: 'ring', at: [0, -0.12] },
    { id: 'ring-2', fits: 'ring', at: { r: 0.28, a: 200 } },
    { id: 'echo-e', fits: 'echo', at: { r: 0.55, a: 90 } },
    { id: 'road-s', fits: 'road', at: [0, 0.45], path: [[-0.7, 0.45], [0.7, 0.45]] },
    { id: 'fault-w', fits: 'fault', at: [-0.7, 0.2], path: [[-0.7, 0], [-0.7, 0.4]] },
    { id: 'relay-1', fits: 'relay', at: { r: 0.55, a: 0 } },
    { id: 'relay-2', fits: 'relay', at: { r: 0.55, a: 120 } },
    { id: 'relay-3', fits: 'relay', at: { r: 0.55, a: 240 } },
    { id: 'altar-1', fits: 'altar', at: { r: 0.4, a: 300 } },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.62, a: 160 } },
    { id: 'host-1', fits: 'host', at: { r: 0.4, a: 60 } },
    { id: 'anvil-1', fits: 'anvil', at: { r: 0.15, a: 180 } },
    { id: 'bell-1', fits: 'bell', at: { r: 0.4, a: 150 } },
  ],
  light: { ambient: 0.14, pools: [{ at: { r: 0.7, a: 0 }, r: 150, colour: '#ffb060', flicker: 0.3 }] },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'banner'], solid: false },
});
