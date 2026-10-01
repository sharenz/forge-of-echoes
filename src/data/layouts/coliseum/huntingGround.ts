// Hunting Ground (sealed, T11 ceiling, R 650), handle "Trophy Field": D-territory.md 10.7 no. 25.
//
// Open ground with six gold trophy obelisks on an irregular ring (r ~0.45) and the hunters' perches fixed at bearings
// 0 / 120 / 240 (the three sequential Stalkers of waves 2, 3 and 4). Each perch has its own cover obelisk on the line to the
// landing at r 0.35, so every hunt has a learnable cover lane. The fourth perch (bearing 180) is the spare the anchor
// minimum asks for. The boss waits at the north perch after the third hunter (arrive: 'rim').
//
// Reads as: the compass of hunters. Weak spot: not much else; the event is the layout.
import { defineLayout, type AreaLayout, type Polar } from '../schema';

const R = 650;
const pol = (r: number, a: number): Polar => ({ r: r / R, a });
const TROPHIES: [number, number][] = [[285, 22], [310, 78], [292, 140], [275, 205], [305, 262], [290, 318]];
const PERCHES = [0, 120, 240];

export const HUNTING_GROUND: AreaLayout = defineLayout({
  areaId: 'huntingGround',
  version: 1,
  landmarks: [
    ...TROPHIES.map(([r, a], k) => ({ id: `trophy-${k + 1}`, kind: 'obelisk' as const, at: pol(r, a), variant: 1 })),
    // The hunters' cover obelisks, one on the line from every perch to the landing (r 0.35).
    ...[0, 120, 240, 180].map((a) => ({ id: `cover-${a}`, kind: 'obelisk' as const, at: pol(228, a), variant: 0 })),
    ...[120, 240, 180].map((a) => ({ id: `perch-rack-${a}`, kind: 'weaponRack' as const, at: pol(420, a + 12), variant: a % 240 === 0 ? 1 : 0 })),
    { id: 'statue-nw', kind: 'statue', at: pol(520, 320), variant: 1 },
    { id: 'statue-ne', kind: 'statue', at: pol(520, 40), variant: 1 },
    { id: 'statue-s', kind: 'statue', at: pol(540, 180), variant: 0 },
  ],
  clusters: [
    // A torch on either side of every perch (the north perch is the boss stage and stays clear).
    ...[120, 240, 180].map((a) => ({ id: `perch-torches-${a}`, pattern: 'arc' as const, at: pol(405, a), params: { r: 40, count: 2, a0: 270 + a, a1: 90 + a }, prop: 'brazier' as const })),
  ],
  walls: [],
  decals: [
    { id: 'sand-ring', kind: 'glyph', at: [0, 0], r: 292 },
    { id: 'sand-core', kind: 'glyph', at: [0, 0], r: 100 },
    ...[...PERCHES, 180].map((a) => ({ id: `perch-ring-${a}`, kind: 'glyph' as const, at: pol(403, a), r: 52 })),
    ...[...PERCHES, 180].map((a) => ({ id: `trail-${a}`, kind: 'road' as const, path: [pol(150, a), pol(380, a)], width: 60 })),
    { id: 'torch-n', kind: 'light', at: pol(405, 0), r: 170 },
  ],
  lanes: [
    // The hunters' trails (cover obelisk on each) carry the packs between the perches.
    ...[0, 120, 240].map((a, k) => ({ id: `trail-${a}`, path: [pol(262, a), pol(380, a)], width: 120, weight: 1.4, favours: [k === 0 ? 'melee' : k === 1 ? 'fast' : 'ranged'] as ('melee' | 'fast' | 'ranged')[] })),
  ],
  zones: [
    { id: 'field-ne', shape: 'sector', at: [0, 0], r: 520, a0: 30, a1: 100, weight: 1.2 },
    { id: 'field-se', shape: 'sector', at: [0, 0], r: 520, a0: 140, a1: 215, weight: 1.2 },
    { id: 'field-sw', shape: 'sector', at: [0, 0], r: 520, a0: 220, a1: 290, weight: 1.2 },
    { id: 'field-nw', shape: 'sector', at: [0, 0], r: 520, a0: 295, a1: 355, weight: 1.2 },
    { id: 'trophy-ring', shape: 'disc', at: [0, 0], r: 330, weight: 1.6 },
  ],
  bossStage: { at: pol(403, 0), r: 140, arrive: 'rim', facing: 180 },
  anchors: [
    { id: 'perch-0', fits: 'perch', at: pol(403, 0) },
    { id: 'perch-120', fits: 'perch', at: pol(403, 120) },
    { id: 'perch-240', fits: 'perch', at: pol(403, 240) },
    { id: 'perch-180', fits: 'perch', at: pol(403, 180) },
    { id: 'ring-1', fits: 'ring', at: pol(330, 60) },
    { id: 'ring-2', fits: 'ring', at: pol(330, 300) },
    { id: 'echo-1', fits: 'echo', at: pol(380, 90) },
    { id: 'echo-2', fits: 'echo', at: pol(380, 270) },
    { id: 'road-arc', fits: 'road', at: pol(470, 90), path: [pol(470, 30), pol(470, 60), pol(470, 90), pol(470, 120), pol(470, 150)] },
    { id: 'fault-ne', fits: 'fault', at: pol(430, 50), path: [pol(430, 38), pol(430, 74)] },
    { id: 'relay-1', fits: 'relay', at: pol(350, 60) },
    { id: 'relay-2', fits: 'relay', at: pol(350, 180) },
    { id: 'relay-3', fits: 'relay', at: pol(350, 300) },
    { id: 'altar-1', fits: 'altar', at: pol(320, 150) },
    { id: 'orchard-1', fits: 'orchard', at: pol(320, 210) },
    { id: 'host-1', fits: 'host', at: pol(320, 30) },
    { id: 'anvil-1', fits: 'anvil', at: pol(320, 330) },
    { id: 'bell-1', fits: 'bell', at: pol(380, 150) },
  ],
  rareSpots: [
    { at: pol(470, 60), r: 80, weight: 2 },
    { at: pol(470, 300), r: 80, weight: 2 },
  ],
  light: {
    ambient: 0.18,
    pools: [
      { at: pol(405, 0), r: 170, colour: '#ffb060', flicker: 0.3 },
      { at: pol(405, 120), r: 150, colour: '#ffb060', flicker: 0.3 },
      { at: pol(405, 240), r: 150, colour: '#ffb060', flicker: 0.3 },
      { at: [0, 0], r: 170, colour: '#ffd890', flicker: 0.1 },
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'bones'], solid: false },
});
