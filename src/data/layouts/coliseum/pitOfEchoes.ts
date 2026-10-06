// Pit of Echoes (dead end via passage, T5 ceiling, R 650), handle "Tiers": D-territory.md 10.7 no. 24.
//
// Three concentric stone tier walls with two staggered 100 u gaps each (outer pair east/west, middle pair north/south, inner
// pair east/west again): a ring maze with 60 u corridors between the tiers. The landing is on the south rim, hunters spawn
// in the rim yard and the corridors, the boss and the echo anchor are at the core (arrive: 'rim' through the inner gap).
//
// Reads as: the target. Weak spot: very high cover density (the Stalker favours you); the seventh Echo wave can trap you
// inside an inner ring.
//
// Deviation from the spec: tiers at r 230 / 314 / 398 (0.35 / 0.48 / 0.61 R) instead of 0.3 / 0.5 / 0.7: the core must hold
// the 400 u free boss disc (inner radius >= 212) and the outer tier must leave the 140 u start clearing on the rim.
import { defineLayout, type AreaLayout, type LayoutLandmark, type Polar, type Pt } from '../schema';

const R = 650;
const pol = (r: number, a: number): Polar => ({ r: r / R, a });
const circle = (r: number, step = 10): Pt[] => Array.from({ length: 360 / step + 1 }, (_, k) => pol(r, k * step));
const TIERS = [
  { id: 'tier-a', r: 230, gaps: [90, 270] },
  { id: 'tier-b', r: 314, gaps: [0, 180] },
  { id: 'tier-c', r: 398, gaps: [90, 270] },
];
const GAP = 100;

// Gate posts (outer tier) and braziers (inner tiers) flank every gap.
const flank: LayoutLandmark[] = [];
for (const t of TIERS) {
  for (const g of t.gaps) {
    const off = ((GAP / 2 + 20) / t.r) * (180 / Math.PI);
    for (const s of [-1, 1]) {
      const a = (g + s * off + 360) % 360;
      flank.push({ id: `${t.id}-${g}-${s < 0 ? 'l' : 'r'}`, kind: t.id === 'tier-c' ? 'gate' : 'brazier', at: pol(t.r, a), variant: t.id === 'tier-c' ? 1 : 0 });
    }
  }
}

export const PIT_OF_ECHOES: AreaLayout = defineLayout({
  areaId: 'pitOfEchoes',
  version: 1,
  start: { at: pol(585, 180) },
  landmarks: [
    ...flank,
    { id: 'rack-ne', kind: 'weaponRack', at: pol(500, 40), variant: 0 },
    { id: 'rack-nw', kind: 'weaponRack', at: pol(500, 320), variant: 1 },
    { id: 'rack-e', kind: 'weaponRack', at: pol(520, 130), variant: 1 },
    { id: 'rack-w', kind: 'weaponRack', at: pol(520, 230), variant: 0 },
    { id: 'statue-n', kind: 'statue', at: pol(535, 8), variant: 0 },
    { id: 'statue-n2', kind: 'statue', at: pol(535, 352), variant: 1 },
  ],
  clusters: [
    { id: 'landing-braziers', pattern: 'arc', at: pol(585, 180), params: { r: 175, count: 3, a0: 300, a1: 60 }, prop: 'brazier' },
  ],
  walls: TIERS.map((t) => ({
    id: t.id, path: circle(t.r), thickness: 24, prop: 'ruinWall' as const, gaps: t.gaps.map((g) => ({ at: g / 360, width: GAP })),
  })),
  decals: [
    { id: 'sand-c', kind: 'glyph', at: [0, 0], r: 356 },
    { id: 'sand-b', kind: 'glyph', at: [0, 0], r: 272 },
    { id: 'sand-core', kind: 'glyph', at: [0, 0], r: 120 },
    { id: 'rim-way', kind: 'road', path: [pol(585, 180), pol(420, 180)], width: 110 },
    { id: 'core-light', kind: 'light', at: [0, 0], r: 220 },
  ],
  lanes: [
    { id: 'corridor-bc', path: circle(356, 15), width: 56, weight: 2.2, favours: ['fast'] },
    { id: 'corridor-ab', path: circle(272, 15), width: 56, weight: 2.2, favours: ['melee'], wave: [2, 9] },
    { id: 'rim', path: circle(520, 15), width: 100, weight: 3.4, favours: ['ranged'], wave: [1, 9] },
  ],
  zones: [
    { id: 'core', shape: 'disc', at: [0, 0], r: 150, weight: 1.4, wave: [3, 9] },
  ],
  bossStage: { at: [0, 0], r: 150, arrive: 'rim', facing: 180 },
  anchors: [
    { id: 'perch-n', fits: 'perch', at: pol(356, 0) },
    { id: 'perch-nw', fits: 'perch', at: pol(356, 300) },
    { id: 'perch-se', fits: 'perch', at: pol(272, 135) },
    { id: 'perch-sw', fits: 'perch', at: pol(356, 225) },
    { id: 'perch-core', fits: 'perch', at: [130 / R, -60 / R] },
    { id: 'ring-1', fits: 'ring', at: [-110 / R, 0] },
    { id: 'ring-2', fits: 'ring', at: [110 / R, 0] },
    { id: 'echo-core', fits: 'echo', at: [0, 0] },
    { id: 'echo-ring', fits: 'echo', at: pol(356, 45) },
    { id: 'road-tier', fits: 'road', at: pol(356, 170), path: Array.from({ length: 8 }, (_, k) => pol(356, 100 + k * 20)) },
    { id: 'fault-core', fits: 'fault', at: [0, 0], path: [[-135 / R, 0], [135 / R, 0]] },
    { id: 'relay-1', fits: 'relay', at: pol(272, 45) },
    { id: 'relay-2', fits: 'relay', at: pol(272, 165) },
    { id: 'relay-3', fits: 'relay', at: pol(272, 285) },
    { id: 'altar-1', fits: 'altar', at: pol(520, 60) },
    { id: 'orchard-1', fits: 'orchard', at: pol(520, 300) },
    { id: 'host-1', fits: 'host', at: pol(520, 120) },
    { id: 'anvil-1', fits: 'anvil', at: pol(520, 240) },
    { id: 'bell-1', fits: 'bell', at: pol(356, 0) }, // on the tier ring: the Bellwatch's 230 u rings must fit inside the pit (E1 check 10)
  ],
  rareSpots: [
    { at: pol(356, 330), r: 60, weight: 2 },
    { at: pol(356, 150), r: 60, weight: 2 },
  ],
  light: {
    ambient: 0.14,
    pools: [
      { at: [0, 0], r: 230, colour: '#ffb060', flicker: 0.3 },
      { at: pol(585, 180), r: 190, colour: '#ffc070', flicker: 0.25 },
      { at: pol(398, 90), r: 110, colour: '#ffa850', flicker: 0.25 },
      { at: pol(398, 270), r: 110, colour: '#ffa850', flicker: 0.25 },
    ],
  },
  scatter: { density: 4, kinds: ['rubble', 'bones'], solid: false },
});
