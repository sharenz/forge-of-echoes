// Rift Nexus (sealed, T9 ceiling, R 850), handle "Nexus" (D-territory.md 10.7 no. 18).
// Reads as: the triangle. Three rift plinths stand at bearings 0/120/240 on r 0.55, each inside a ring of six standing
// stones (the cover), round a hub dais at the centre where the boss comes after the third rift. The Echo Rift sequence runs
// the plinths clockwise (waves 2, 3, 4): the wave windows of the three plinth zones follow that order, so the plan is learnable.
// Weak spot (accepted): little randomness; the rift order is the lesson.
import { defineLayout, type AreaLayout } from '../schema';
import { cover, frame, VIOLET, WINDOW, perch, polar } from '../ossuaryCryptKit';

const R = 850;
const f = frame(R);
const PL_R = 0.55 * R; // 467.5
const PLINTHS = [0, 120, 240];
const START = polar(650, 180);
const PERCHES = [
  { id: 'ne', at: polar(600, 45), d: 260 },
  { id: 'nw', at: polar(600, 315), d: 260 },
  { id: 'e', at: polar(640, 100), d: 300 },
  { id: 'w', at: polar(640, 260), d: 300 },
];
const covers = PERCHES.map((p) => cover(f, `cairn-${p.id}`, START, p.at, p.d, { kind: 'standingStone', ring: 4, ringR: 30 }));

export const RIFT_NEXUS: AreaLayout = defineLayout({
  areaId: 'riftNexus',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    { id: 'hub', kind: 'dais', at: f.p(0, 0), r: 90 },
    ...PLINTHS.map((a) => ({ id: `plinth-${a}`, kind: 'plinth' as const, at: f.pol(PL_R, a), r: 34 })),
    ...covers.map((c) => c.landmark),
  ],
  clusters: [
    ...PLINTHS.map((a) => ({
      id: `stones-${a}`, pattern: 'ring' as const, at: f.pol(PL_R, a), params: { r: 64, count: 6, rot: a + 30 }, prop: 'standingStone' as const, variant: 0,
    })),
    ...covers.flatMap((c) => (c.cluster ? [c.cluster] : [])),
    { id: 'hub-bones', pattern: 'ring', at: f.p(0, 0), params: { r: 150, count: 12, rot: 5 }, prop: 'bones' },
    { id: 'rim-ribs-ne', pattern: 'arc', at: f.p(0, 0), params: { r: 740, count: 4, a0: 20, a1: 80 }, prop: 'ribArch' },
    { id: 'rim-ribs-nw', pattern: 'arc', at: f.p(0, 0), params: { r: 740, count: 4, a0: 280, a1: 340 }, prop: 'ribArch' },
  ],
  walls: [],
  decals: [
    // The triangle, drawn on the floor between the plinths.
    { id: 'tri-a', kind: 'road', path: [f.pol(PL_R, 0), f.pol(PL_R, 120)], width: 36 },
    { id: 'tri-b', kind: 'road', path: [f.pol(PL_R, 120), f.pol(PL_R, 240)], width: 36 },
    { id: 'tri-c', kind: 'road', path: [f.pol(PL_R, 240), f.pol(PL_R, 360)], width: 36 },
    { id: 'hub-glyph', kind: 'glyph', at: f.p(0, 0), r: 180 },
    ...PLINTHS.map((a) => ({ id: `rift-glyph-${a}`, kind: 'glyph' as const, at: f.pol(PL_R, a), r: 90 })),
    { id: 'spoke-0', kind: 'crack', path: [f.pol(100, 0), f.pol(PL_R - 90, 0)] },
    { id: 'spoke-120', kind: 'crack', path: [f.pol(100, 120), f.pol(PL_R - 90, 120)] },
    { id: 'spoke-240', kind: 'crack', path: [f.pol(100, 240), f.pol(PL_R - 90, 240)] },
    { id: 'window-s', kind: 'light', at: f.pp(START), r: 160 },
  ],
  lanes: [
    { id: 'spoke-0', path: [f.pol(130, 0), f.pol(PL_R - 70, 0)], width: 120, weight: 1.6, wave: [2, 2] },
    { id: 'spoke-120', path: [f.pol(130, 120), f.pol(PL_R - 70, 120)], width: 120, weight: 1.6, wave: [3, 3] },
    { id: 'spoke-240', path: [f.pol(130, 240), f.pol(PL_R - 70, 240)], width: 120, weight: 1.6, wave: [4, 4] },
    { id: 'orbit', path: f.arc(330, 20, 340, 20), width: 130, weight: 1.2, favours: ['fast'] },
    { id: 'outer-e', path: f.arc(620, 20, 160, 20), width: 130, weight: 0.9, favours: ['ranged'] },
    { id: 'outer-w', path: f.arc(620, 200, 340, 20), width: 130, weight: 0.9, favours: ['ranged'] },
  ],
  zones: [
    // The plinth zones follow the rift order: wave 2 north, wave 3 south-east, wave 4 south-west.
    { id: 'rift-0', shape: 'disc', at: f.pol(PL_R, 0), r: 130, weight: 2.2, wave: [2, 2] },
    { id: 'rift-120', shape: 'disc', at: f.pol(PL_R, 120), r: 130, weight: 2.2, wave: [3, 3] },
    { id: 'rift-240', shape: 'disc', at: f.pol(PL_R, 240), r: 130, weight: 2.2, wave: [4, 4] },
    { id: 'hub', shape: 'disc', at: f.p(0, 0), r: 130, weight: 1.2, wave: [5, 9] },
    { id: 'gap-60', shape: 'disc', at: f.pol(520, 60), r: 130, weight: 0.8 },
    { id: 'gap-300', shape: 'disc', at: f.pol(520, 300), r: 130, weight: 0.8 },
  ],
  bossStage: { at: f.p(0, 0), r: 150, arrive: 'rim', facing: 180 },
  anchors: [
    ...PERCHES.map((p) => perch(f, `perch-${p.id}`, p.at)),
    ...PLINTHS.map((a) => ({ id: `echo-${a}`, fits: 'echo' as const, at: f.pol(PL_R, a) })),
    { id: 'host-1', fits: 'host', at: f.pol(300, 60), r: 80 },
    { id: 'host-2', fits: 'host', at: f.pol(300, 300), r: 80 },
    { id: 'bell-1', fits: 'bell', at: f.pol(320, 180) },
    { id: 'bell-2', fits: 'bell', at: f.pol(150, 90) },
    { id: 'road-orbit', fits: 'road', at: f.pol(340, 250), path: [150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350].map((a) => f.pol(340, a)) },
    { id: 'fault-w', fits: 'fault', at: f.p(-640, 20), path: [f.p(-640, -120), f.p(-640, 160)] },
    { id: 'relay-1', fits: 'relay', at: f.pol(250, 60) },
    { id: 'relay-2', fits: 'relay', at: f.pol(250, 180) },
    { id: 'relay-3', fits: 'relay', at: f.pol(250, 300) },
    { id: 'altar-1', fits: 'altar', at: f.pol(560, 148) },
    { id: 'orchard-1', fits: 'orchard', at: f.pol(560, 212) },
    { id: 'ring-1', fits: 'ring', at: f.pol(330, 90) },
    { id: 'anvil-1', fits: 'anvil', at: f.pol(330, 270) },
  ],
  rareSpots: [
    { at: f.pol(620, 70), r: 90, weight: 2 },
    { at: f.pol(620, 290), r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(0, 0), r: 230, colour: VIOLET, flicker: 0.1 },
      ...PLINTHS.map((a) => ({ at: f.pol(PL_R, a), r: 150, colour: WINDOW, flicker: 0.15 })),
      { at: f.pp(START), r: 170, colour: VIOLET, flicker: 0.06 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'rubble', 'bones'], solid: false },
});
