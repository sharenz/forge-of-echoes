// Cinder Chapel no. 10: Black Pit, "Bowl" (D-territory.md 10.7). R 800 (sealed, T9 ceiling).
// Reads as: the bowl and its three fires. A central pit (dark walk-through disc r 150) ringed by a rubble lip; three relay
// braziers fixed at bearings 0/120/240 on r 0.62 (the Blackout triad, 810 u apart); the Wound crack runs through the pit
// (field r 240); the landing is on the south rim; the boss rises at the pit lip, north. The fixed positions *are* the event
// order, so exactly three relay anchors and two fault anchors (the Wound and a rim fault) are declared.
// Deviations: none (the template's numbers satisfy all seven checks; the relay anchors stand 22 u inside their brazier).
// Packs: waves 1-3 gather at the fires (Blackout is wave 2), 3-6 add the rim track and outer ground, the Wound (wave 4) the pit lip.
// Weak spot (accepted): nothing random to learn: experts rush, by design.
import { defineLayout, type AreaLayout } from '../schema';
import { arcPath, bearings, perches, pool } from '../packs/ashenChapelKit';

const R = 800;
const START = { r: 0.84, a: 180 } as const;
const FIRES = bearings(0, 3);
const INNER = (496 - 22) / R; // the relay anchor stands 22 u inside its brazier (within the ring of stones)

const p = perches(R, [
  { id: 'perch-ne', at: { r: 0.56, a: 45 }, prop: 'standingStone' },
  { id: 'perch-nw', at: { r: 0.56, a: 315 }, prop: 'standingStone' },
  { id: 'perch-e', at: { r: 0.66, a: 95 }, prop: 'standingStone' },
  { id: 'perch-w', at: { r: 0.66, a: 265 }, prop: 'standingStone' },
], START);

export const BLACK_PIT: AreaLayout = defineLayout({
  areaId: 'blackPit',
  version: 1,
  start: { at: START },
  landmarks: [
    { id: 'pit', kind: 'pit', at: [0, 0], r: 150 },
    ...FIRES.map((a, k) => ({ id: `relay-fire-${a}`, kind: 'brazier' as const, at: { r: 0.62, a }, variant: k })),
    { id: 'banner-w', kind: 'banner', at: [-0.12, 0.62], variant: 1 },
    { id: 'banner-e', kind: 'banner', at: [0.12, 0.62], variant: 3 },
    ...p.covers,
  ],
  clusters: [
    // The rubble lip round the pit (walk-through) and a dusting of ember glyph stones.
    { id: 'lip', pattern: 'ring', at: [0, 0], params: { r: 160, count: 26, rot: 3, radius: 0 }, prop: 'rubble', variant: 1 },
    ...FIRES.map((a) => ({
      id: `fire-stones-${a}`, pattern: 'ring' as const, at: { r: 0.62, a }, params: { r: 46, count: 5, rot: a + 20 }, prop: 'standingStone' as const,
    })),
    { id: 'bones-s', pattern: 'scatter', at: { r: 0.5, a: 190 }, params: { r: 110, count: 5, radius: 0 }, prop: 'bones' },
    { id: 'rubble-n', pattern: 'scatter', at: { r: 0.72, a: 20 }, params: { r: 110, count: 6, radius: 0 }, prop: 'rubble' },
  ],
  walls: [],
  decals: [
    ...FIRES.map((a) => ({ id: `glyph-${a}`, kind: 'glyph' as const, at: { r: 0.62, a }, r: 78 })),
    { id: 'wound-glyph', kind: 'glyph', at: [0, 0], r: 240 },
    // The Wound: glowing cracks reaching out of the pit.
    { id: 'wound-n', kind: 'crack', path: [{ r: 0.2, a: 10 }, { r: 0.32, a: 4 }, { r: 0.44, a: 14 }] },
    { id: 'wound-e', kind: 'crack', path: [{ r: 0.2, a: 100 }, { r: 0.34, a: 108 }, { r: 0.5, a: 98 }] },
    { id: 'wound-sw', kind: 'crack', path: [{ r: 0.2, a: 215 }, { r: 0.34, a: 224 }, { r: 0.48, a: 214 }] },
    { id: 'wound-nw', kind: 'crack', path: [{ r: 0.2, a: 300 }, { r: 0.36, a: 292 }, { r: 0.5, a: 302 }] },
    { id: 'landing-road', kind: 'road', path: [{ r: 0.84, a: 180 }, { r: 0.5, a: 180 }], width: 100 },
  ],
  lanes: [
    // The bowl's rim track (waves 3-4) and the lip (the Wound, waves 4-6); wave 1-2 packs wait at the fires.
    { id: 'rim-track', path: arcPath(0.52, 0, 360), width: 140, weight: 1.2, wave: [3, 6], favours: ['fast'] },
    { id: 'lip-track', path: arcPath(0.3, 0, 360), width: 110, weight: 1, wave: [4, 6], favours: ['melee'] },
  ],
  zones: [
    ...FIRES.map((a) => ({ id: `fire-${a}`, shape: 'disc' as const, at: { r: 0.62, a }, r: 190, weight: 2.2, wave: [1, 3] as [number, number] })),
    { id: 'outer-ne', shape: 'disc', at: { r: 0.72, a: 60 }, r: 200, weight: 0.9, wave: [3, 6] },
    { id: 'outer-nw', shape: 'disc', at: { r: 0.72, a: 300 }, r: 200, weight: 0.9, wave: [3, 6] },
    { id: 'pit-lip', shape: 'disc', at: [0, -0.22], r: 220, weight: 1.5, wave: [4, 6] },
  ],
  bossStage: { at: [0, -0.26], r: 140, arrive: 'rim', facing: 180 },
  anchors: [
    ...p.anchors,
    ...FIRES.map((a) => ({ id: `relay-${a}`, fits: 'relay' as const, at: { r: INNER, a } })),
    { id: 'wound', fits: 'fault', at: [0, 0], r: 240, path: [[-0.19, 0], [0.19, 0]] },
    { id: 'fault-rim', fits: 'fault', at: [-0.72, -0.02], path: [[-0.72, -0.2], [-0.72, 0.16]] },
    { id: 'anvil-e', fits: 'anvil', at: { r: 0.32, a: 90 } },
    { id: 'anvil-w', fits: 'anvil', at: { r: 0.32, a: 270 } },
    { id: 'echo-e', fits: 'echo', at: { r: 0.7, a: 65 } },
    { id: 'echo-w', fits: 'echo', at: { r: 0.7, a: 295 } },
    { id: 'road-south', fits: 'road', at: [0, 0.45], path: [[-0.7, 0.45], [0.7, 0.45]] },
    { id: 'altar-1', fits: 'altar', at: { r: 0.4, a: 180 } },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.42, a: 40 } },
    { id: 'ring-1', fits: 'ring', at: { r: 0.42, a: 320 } },
    { id: 'host-1', fits: 'host', at: { r: 0.42, a: 200 } },
    { id: 'bell-1', fits: 'bell', at: { r: 0.42, a: 160 } },
  ],
  rareSpots: [
    { at: { r: 0.62, a: 0 }, r: 120, weight: 2 },
    { at: { r: 0.3, a: 180 }, r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.07,
    pools: [
      pool([0, 0], 210, '#a03018', 0.55),
      ...FIRES.map((a) => pool({ r: 0.62, a }, 120, '#ff7a30', 0.45)),
      pool(START, 140, '#ffb060', 0.3),
    ],
  },
  scatter: { density: 6, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
