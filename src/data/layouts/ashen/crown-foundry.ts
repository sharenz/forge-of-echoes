// Ashen Forge no. 5: Crown Foundry, "Crown Hall" (D-territory.md 10.7). R 900 (T9, Cinder Matriarch pool).
// Reads as: concentric. An inner dais ring of 8 pillars (r 0.26), an outer colonnade of 12 alternating pillars and braziers
// (r 0.62), and at the far end of the hall two great statues flanking the throne (the boss stage, bearing 0). The landing
// is the south portal; the dais gaps (164 u) and the colonnade gaps (about 290 u) leave a kite track between the rings.
// Deviations: the template says "6 gaps" in the dais ring; 8 evenly spaced pillars give 8 gaps (all >= 164 u). The great
// statues stand 235 u either side of the stage (check 3's free 400 u disc) and use r 24 and the crowned figure (statue frames 2-3, `variant` 2/3; the sprite scales with r).
// Weak spot (accepted): symmetric; the dais ring is a kite track but also a trap for 4-player parties.
import { defineLayout, type AreaLayout } from '../schema';
import { arcPath, perches, pool } from '../packs/ashenChapelKit';

const R = 900;
const START = { r: 0.84, a: 180 } as const;

const p = perches(R, [
  { id: 'perch-ne', at: { r: 0.5, a: 40 }, cover: 330, prop: 'standingStone' },
  { id: 'perch-nw', at: { r: 0.5, a: 320 }, cover: 330, prop: 'standingStone' },
  { id: 'perch-e', at: { r: 0.62, a: 80 }, cover: 330, prop: 'standingStone' },
  { id: 'perch-w', at: { r: 0.62, a: 280 }, cover: 330, prop: 'standingStone' },
], START);

export const CROWN_FOUNDRY: AreaLayout = defineLayout({
  areaId: 'crownFoundry',
  version: 1,
  start: { at: START },
  landmarks: [
    { id: 'statue-w', kind: 'statue', at: [-0.261, -0.82], r: 24, variant: 2 },
    { id: 'statue-e', kind: 'statue', at: [0.261, -0.82], r: 24, variant: 3 },
    { id: 'throne', kind: 'dais', at: [0, -0.87], r: 60 },
    { id: 'hall-dais', kind: 'dais', at: [0, 0], r: 120 },
    { id: 'portal-stair', kind: 'stair', at: [0, 0.9], r: 48 },
    { id: 'portal-pillar-w', kind: 'pillar', at: [-0.19, 0.86], variant: 2 },
    { id: 'portal-pillar-e', kind: 'pillar', at: [0.19, 0.86], variant: 3 },
    ...p.covers,
  ],
  clusters: [
    // The dais ring: 8 pillars, none on the N-S axis so the royal road passes between them.
    { id: 'dais-ring', pattern: 'ring', at: [0, 0], params: { r: 234, count: 8, rot: 22.5, radius: 13 }, prop: 'pillar' },
    // The colonnade: 12 slots every 30 degrees, pillars and braziers alternating.
    { id: 'colonnade-pillars', pattern: 'ring', at: [0, 0], params: { r: 558, count: 6, rot: 15, radius: 13 }, prop: 'pillar' },
    { id: 'colonnade-fires', pattern: 'ring', at: [0, 0], params: { r: 558, count: 6, rot: 45 }, prop: 'brazier' },
    { id: 'rubble-sw', pattern: 'scatter', at: { r: 0.72, a: 215 }, params: { r: 120, count: 6, radius: 0 }, prop: 'rubble' },
    { id: 'rubble-ne', pattern: 'scatter', at: { r: 0.72, a: 50 }, params: { r: 120, count: 6, radius: 0 }, prop: 'rubble' },
  ],
  walls: [],
  decals: [
    { id: 'royal-road', kind: 'road', path: [[0, 0.8], [0, -0.74]], width: 130 },
    { id: 'dais-glyph', kind: 'glyph', at: [0, 0], r: 190 },
    { id: 'throne-glyph', kind: 'glyph', at: [0, -0.8], r: 110 },
    { id: 'crack-w', kind: 'crack', path: [{ r: 0.4, a: 252 }, { r: 0.5, a: 262 }, { r: 0.6, a: 256 }], hazard: { kind: 'burn' } },
    { id: 'crack-e', kind: 'crack', path: [{ r: 0.4, a: 72 }, { r: 0.5, a: 80 }, { r: 0.6, a: 74 }], hazard: { kind: 'burn' } },
    { id: 'slag-sw', kind: 'pool', at: { r: 0.74, a: 240 }, r: 50, hazard: { kind: 'burn' } },
    { id: 'slag-se', kind: 'pool', at: { r: 0.74, a: 120 }, r: 50, hazard: { kind: 'burn' } },
  ],
  lanes: [
    // The outer ring road (two arcs, the statues keep the north) carries waves 1 to 4; the dais track is the late fight.
    { id: 'outer-west', path: arcPath(0.78, 200, 332), width: 150, weight: 1.4, wave: [1, 6], favours: ['fast'] },
    { id: 'outer-east', path: arcPath(0.78, 28, 160), width: 150, weight: 1.4, wave: [1, 6], favours: ['fast'] },
    { id: 'track', path: arcPath(0.42, 0, 360), width: 110, weight: 1.1, wave: [3, 6], favours: ['melee'] },
  ],
  zones: [
    { id: 'hall-w', shape: 'disc', at: { r: 0.62, a: 270 }, r: 260, weight: 1.1 },
    { id: 'hall-e', shape: 'disc', at: { r: 0.62, a: 90 }, r: 260, weight: 1.1 },
    { id: 'throne-yard', shape: 'disc', at: [0, -0.56], r: 240, weight: 1, wave: [2, 6] },
    { id: 'dais', shape: 'disc', at: [0, 0], r: 230, weight: 0.9, wave: [5, 6] },
  ],
  bossStage: { at: { r: 0.8, a: 0 }, r: 150, arrive: 'shimmer', facing: 180 },
  anchors: [
    ...p.anchors,
    { id: 'echo-se', fits: 'echo', at: { r: 0.68, a: 125 } },
    { id: 'echo-sw', fits: 'echo', at: { r: 0.68, a: 235 } },
    { id: 'relay-n', fits: 'relay', at: { r: 0.45, a: 0 } },
    { id: 'relay-se', fits: 'relay', at: { r: 0.45, a: 120 } },
    { id: 'relay-sw', fits: 'relay', at: { r: 0.45, a: 240 } },
    { id: 'fault-w', fits: 'fault', at: { r: 0.76, a: 302 }, path: [{ r: 0.76, a: 280 }, { r: 0.76, a: 325 }] },
    { id: 'fault-e', fits: 'fault', at: { r: 0.76, a: 57 }, path: [{ r: 0.76, a: 35 }, { r: 0.76, a: 80 }] },
    { id: 'anvil-w', fits: 'anvil', at: { r: 0.4, a: 270 } },
    { id: 'anvil-e', fits: 'anvil', at: { r: 0.4, a: 90 } },
    { id: 'road-royal', fits: 'road', at: [0, 0], path: [[0, 0.82], [0, -0.68]] },
    { id: 'altar-1', fits: 'altar', at: { r: 0.58, a: 0 } },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.3, a: 200 } },
    { id: 'ring-1', fits: 'ring', at: { r: 0.3, a: 315 } },
    { id: 'host-1', fits: 'host', at: { r: 0.3, a: 135 } },
    { id: 'bell-1', fits: 'bell', at: { r: 0.3, a: 45 } },
  ],
  rareSpots: [
    { at: { r: 0.62, a: 300 }, r: 100, weight: 2 },
    { at: { r: 0.62, a: 60 }, r: 100, weight: 2 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      pool([0, 0], 220, '#ff8a3c', 0.35),
      pool([0, -0.82], 210, '#ffb060', 0.25),
      pool([0, 0.88], 130, '#ff6a2a', 0.3),
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
