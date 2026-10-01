// Sealed Reliquary (sealed, T7, R 810), handle "Twin Crypt" (D-territory.md 10.7 no. 13).
// Reads as: symmetry. A mirror-symmetric hall (N-S and E-W): crown A's stage north (r 0.74), crown B's south (`second`),
// ossuary niches E and W, the landing in the middle between two rows of four ice columns. Fairness by symmetry for Rival
// Crowns; a solo player fights both crowns from the same crossing. Weak spot (accepted): predictable; the Stalker's cover
// is symmetric too (every outer column carries a perch on its line to the landing).
import { defineLayout, type AreaLayout } from '../schema';
import { frame, FROST, FROST_DEEP, perch } from '../ossuaryCryptKit';

const R = 810;
const f = frame(R);
const COLS = [-250, -85, 85, 250];
const ROW_Y = 240;

// Niche: three wall runs round a 260 u opening that faces the centre (mirrored E/W).
const niche = (side: 1 | -1) => [
  { id: `niche-${side > 0 ? 'e' : 'w'}`, path: [f.p(side * 400, -130), f.p(side * 640, -130), f.p(side * 640, 130), f.p(side * 400, 130)] },
];

export const SEALED_RELIQUARY: AreaLayout = defineLayout({
  areaId: 'sealedReliquary',
  version: 1,
  landmarks: [
    { id: 'hub', kind: 'dais', at: f.p(0, 0), r: 60 },
    { id: 'niche-glow-w', kind: 'plinth', at: f.p(-540, 0), r: 34 },
    { id: 'niche-glow-e', kind: 'plinth', at: f.p(540, 0), r: 34 },
  ],
  clusters: [
    { id: 'cols-n', pattern: 'line', at: f.p(COLS[0], -ROW_Y), params: { length: COLS[3] - COLS[0], bearing: 90, count: 4 }, prop: 'iceColumn', variant: 0 },
    { id: 'cols-s', pattern: 'line', at: f.p(COLS[0], ROW_Y), params: { length: COLS[3] - COLS[0], bearing: 90, count: 4 }, prop: 'iceColumn', variant: 0 },
    // Ossuary niche contents: bone drifts and crystal (walk-through bones, a few solid crystals at the back).
    { id: 'niche-bones-e', pattern: 'scatter', at: f.p(540, 0), params: { r: 70, count: 6 }, prop: 'bones' },
    { id: 'niche-bones-w', pattern: 'scatter', at: f.p(-540, 0), params: { r: 70, count: 6 }, prop: 'bones' },
    { id: 'niche-crystal-e', pattern: 'arc', at: f.p(540, 0), params: { r: 78, count: 4, a0: 20, a1: 160 }, prop: 'crystal' },
    { id: 'niche-crystal-w', pattern: 'arc', at: f.p(-540, 0), params: { r: 78, count: 4, a0: 200, a1: 340 }, prop: 'crystal' },
    // Stage braziers of bone: ribs flanking each crown's stage (outside the free disc).
    { id: 'ribs-a-w', pattern: 'arc', at: f.p(0, -600), params: { r: 235, count: 3, a0: 245, a1: 295 }, prop: 'ribArch', variant: 1 },
    { id: 'ribs-a-e', pattern: 'arc', at: f.p(0, -600), params: { r: 235, count: 3, a0: 65, a1: 115 }, prop: 'ribArch', variant: 0 },
    { id: 'ribs-b-w', pattern: 'arc', at: f.p(0, 600), params: { r: 235, count: 3, a0: 245, a1: 295 }, prop: 'ribArch', variant: 1 },
    { id: 'ribs-b-e', pattern: 'arc', at: f.p(0, 600), params: { r: 235, count: 3, a0: 65, a1: 115 }, prop: 'ribArch', variant: 0 },
  ],
  walls: [...niche(1), ...niche(-1)],
  decals: [
    { id: 'axis', kind: 'road', path: [f.p(0, -480), f.p(0, 480)], width: 120 },
    { id: 'cross', kind: 'road', path: [f.p(-340, 0), f.p(340, 0)], width: 110 },
    { id: 'hub-glyph', kind: 'glyph', at: f.p(0, 0), r: 120 },
    { id: 'seal-a', kind: 'glyph', at: f.p(0, -600), r: 150 },
    { id: 'seal-b', kind: 'glyph', at: f.p(0, 600), r: 150 },
    { id: 'frost-w', kind: 'pool', at: f.p(-300, 0), r: 60 },
    { id: 'frost-e', kind: 'pool', at: f.p(300, 0), r: 60 },
  ],
  lanes: [
    { id: 'axis', path: [f.p(0, -470), f.p(0, 0), f.p(0, 470)], width: 160, weight: 2 },
    { id: 'cross', path: [f.p(-330, 0), f.p(330, 0)], width: 140, weight: 1.2, favours: ['fast'] },
    { id: 'row-n', path: [f.p(-340, -340), f.p(340, -340)], width: 120, weight: 1, favours: ['ranged'] },
    { id: 'row-s', path: [f.p(-340, 340), f.p(340, 340)], width: 120, weight: 1, favours: ['ranged'] },
  ],
  zones: [
    { id: 'niche-w', shape: 'disc', at: f.p(-520, 0), r: 100, weight: 0.8 },
    { id: 'niche-e', shape: 'disc', at: f.p(520, 0), r: 100, weight: 0.8 },
    { id: 'crown-a', shape: 'disc', at: f.p(0, -460), r: 150, weight: 1, wave: [2, 9] },
    { id: 'crown-b', shape: 'disc', at: f.p(0, 460), r: 150, weight: 1, wave: [2, 9] },
    { id: 'quarter-ne', shape: 'disc', at: f.p(400, -380), r: 150, weight: 1 },
    { id: 'quarter-nw', shape: 'disc', at: f.p(-400, -380), r: 150, weight: 1 },
    { id: 'quarter-se', shape: 'disc', at: f.p(400, 380), r: 150, weight: 1 },
    { id: 'quarter-sw', shape: 'disc', at: f.p(-400, 380), r: 150, weight: 1 },
  ],
  bossStage: { at: f.p(0, -600), r: 150, arrive: 'shimmer', facing: 180, second: f.p(0, 600) },
  anchors: [
    // Each perch lies on the line from the landing through an outer column (1.7 x), the symmetric cover.
    perch(f, 'perch-ne', { x: 250 * 1.7, y: -ROW_Y * 1.7 }),
    perch(f, 'perch-nw', { x: -250 * 1.7, y: -ROW_Y * 1.7 }),
    perch(f, 'perch-se', { x: 250 * 1.7, y: ROW_Y * 1.7 }),
    perch(f, 'perch-sw', { x: -250 * 1.7, y: ROW_Y * 1.7 }),
    { id: 'echo-w', fits: 'echo', at: f.p(-330, 0) },
    { id: 'echo-e', fits: 'echo', at: f.p(330, 0) },
    { id: 'host-nw', fits: 'host', at: f.p(-300, -380), r: 90 },
    { id: 'host-se', fits: 'host', at: f.p(300, 380), r: 90 },
    { id: 'bell-ne', fits: 'bell', at: f.p(300, -380) },
    { id: 'bell-sw', fits: 'bell', at: f.p(-300, 380) },
    { id: 'road-axis', fits: 'road', at: f.p(0, 0), path: [f.p(0, -600), f.p(0, -300), f.p(0, 0), f.p(0, 300), f.p(0, 600)] },
    { id: 'fault-w', fits: 'fault', at: f.p(-510, -320), path: [f.p(-510, -460), f.p(-510, -180)] },
    { id: 'fault-e', fits: 'fault', at: f.p(510, 320), path: [f.p(510, 460), f.p(510, 180)] },
    { id: 'relay-1', fits: 'relay', at: f.p(0, -420) },
    { id: 'relay-2', fits: 'relay', at: f.p(360, 300) },
    { id: 'relay-3', fits: 'relay', at: f.p(-360, 300) },
    { id: 'altar-1', fits: 'altar', at: f.p(0, 190) },
    { id: 'orchard-1', fits: 'orchard', at: f.p(-190, 70) },
    { id: 'ring-1', fits: 'ring', at: f.p(190, -70) },
    { id: 'anvil-1', fits: 'anvil', at: f.p(-190, -80) },
  ],
  rareSpots: [
    { at: f.p(-520, 0), r: 80, weight: 1 },
    { at: f.p(520, 0), r: 80, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(0, 0), r: 190, colour: FROST, flicker: 0.05 },
      { at: f.p(0, -600), r: 200, colour: FROST_DEEP, flicker: 0.1 },
      { at: f.p(0, 600), r: 200, colour: FROST_DEEP, flicker: 0.1 },
      { at: f.p(-540, 0), r: 130, colour: FROST, flicker: 0.1 },
      { at: f.p(540, 0), r: 130, colour: FROST, flicker: 0.1 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'bones', 'rubble'], solid: false },
});
