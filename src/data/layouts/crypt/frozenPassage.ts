// Frozen Passage (T11, R 893), handle "Gallery" (D-territory.md 10.7 no. 17).
// Reads as: the well. Two long walls (y = +-250) split the arena into a north gallery (the boss's loft) and a south gallery
// (the landing); they are joined by three bridges, W / centre / E, each a 130 u band. The west and east bridges run
// between wall runs; the centre one opens onto the well, an open disc (r 200) with the Bell hub, the only big open space.
// Weak spot (accepted): the bridges are chokepoints; between them lie sealed side pockets reachable only through the well.
import { defineLayout, type AreaLayout } from '../schema';
import { frame, VIOLET, WINDOW, perch } from '../ossuaryCryptKit';

const R = 892.5;
const f = frame(R);
const START = { x: 0, y: 560 };
const WALL_X = 780;
const BRIDGE_X = 430;
const gapAt = (x: number) => ({ at: (x + WALL_X) / (2 * WALL_X), width: 130 });

export const FROZEN_PASSAGE: AreaLayout = defineLayout({
  areaId: 'frozenPassage',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    { id: 'well', kind: 'pit', at: f.p(0, 0), r: 200 },
    { id: 'plinth-w', kind: 'plinth', at: f.p(-BRIDGE_X, 0), r: 30 },
    { id: 'plinth-e', kind: 'plinth', at: f.p(BRIDGE_X, 0), r: 30 },
  ],
  clusters: [
    // The galleries' pillar arcs, open at the poles (the loft and the landing).
    { id: 'arc-nw', pattern: 'arc', at: f.p(0, 0), params: { r: 600, count: 4, a0: 295, a1: 330 }, prop: 'pillar' },
    { id: 'arc-ne', pattern: 'arc', at: f.p(0, 0), params: { r: 600, count: 4, a0: 30, a1: 65 }, prop: 'pillar' },
    { id: 'arc-sw', pattern: 'arc', at: f.p(0, 0), params: { r: 600, count: 4, a0: 195, a1: 240 }, prop: 'pillar' },
    { id: 'arc-se', pattern: 'arc', at: f.p(0, 0), params: { r: 600, count: 4, a0: 120, a1: 165 }, prop: 'pillar' },
    { id: 'well-rim', pattern: 'ring', at: f.p(0, 0), params: { r: 208, count: 14, rot: 6 }, prop: 'bones' },
    { id: 'loft-crystals', pattern: 'arc', at: f.p(0, 0), params: { r: 740, count: 6, a0: 340, a1: 20 }, prop: 'crystal' },
    // A bone-white stall row in each gallery.
    { id: 'stalls-nw', pattern: 'line', at: f.p(-340, -330), params: { length: 130, bearing: 90, count: 3 }, prop: 'choirStall', variant: 1 },
    { id: 'stalls-ne', pattern: 'line', at: f.p(210, -330), params: { length: 130, bearing: 90, count: 3 }, prop: 'choirStall', variant: 1 },
    { id: 'stalls-sw', pattern: 'line', at: f.p(-340, 400), params: { length: 130, bearing: 90, count: 3 }, prop: 'choirStall', variant: 1 },
    { id: 'stalls-se', pattern: 'line', at: f.p(210, 400), params: { length: 130, bearing: 90, count: 3 }, prop: 'choirStall', variant: 1 },
  ],
  walls: [
    { id: 'gallery-n', path: [f.p(-WALL_X, -250), f.p(WALL_X, -250)], gaps: [-BRIDGE_X, 0, BRIDGE_X].map(gapAt) },
    { id: 'gallery-s', path: [f.p(-WALL_X, 250), f.p(WALL_X, 250)], gaps: [-BRIDGE_X, 0, BRIDGE_X].map(gapAt) },
    // The outer bridges' side walls: 130 u between their facing edges.
    { id: 'bridge-w-w', path: [f.p(-BRIDGE_X - 77, -250), f.p(-BRIDGE_X - 77, 250)], cover: 'low' },
    { id: 'bridge-w-e', path: [f.p(-BRIDGE_X + 77, -250), f.p(-BRIDGE_X + 77, 250)], cover: 'low' },
    { id: 'bridge-e-w', path: [f.p(BRIDGE_X - 77, -250), f.p(BRIDGE_X - 77, 250)], cover: 'low' },
    { id: 'bridge-e-e', path: [f.p(BRIDGE_X + 77, -250), f.p(BRIDGE_X + 77, 250)], cover: 'low' },
  ],
  decals: [
    { id: 'bridge-w', kind: 'road', path: [f.p(-BRIDGE_X, -300), f.p(-BRIDGE_X, 300)], width: 120 },
    { id: 'bridge-e', kind: 'road', path: [f.p(BRIDGE_X, -300), f.p(BRIDGE_X, 300)], width: 120 },
    { id: 'bridge-c', kind: 'road', path: [f.p(0, -300), f.p(0, -200)], width: 120 },
    { id: 'bridge-c2', kind: 'road', path: [f.p(0, 200), f.p(0, 300)], width: 120 },
    { id: 'well-glyph', kind: 'glyph', at: f.p(0, 0), r: 170 },
    { id: 'loft-glyph', kind: 'glyph', at: f.p(0, -600), r: 140 },
    { id: 'window-nw', kind: 'light', at: f.p(-340, -430), r: 110 },
    { id: 'window-ne', kind: 'light', at: f.p(340, -430), r: 110 },
    { id: 'window-sw', kind: 'light', at: f.p(-340, 430), r: 110 },
    { id: 'window-se', kind: 'light', at: f.p(340, 430), r: 110 },
  ],
  lanes: [
    { id: 'bridge-w', path: [f.p(-BRIDGE_X, -220), f.p(-BRIDGE_X, 220)], width: 120, weight: 1.6, favours: ['melee'] },
    { id: 'bridge-e', path: [f.p(BRIDGE_X, -220), f.p(BRIDGE_X, 220)], width: 120, weight: 1.6, favours: ['melee'] },
    { id: 'bridge-c', path: [f.p(0, -300), f.p(0, 300)], width: 120, weight: 1.6, favours: ['fast'] },
    { id: 'gallery-n', path: [f.p(-600, -420), f.p(0, -430), f.p(600, -420)], width: 150, weight: 1.5, favours: ['ranged'] },
    { id: 'gallery-s', path: [f.p(-600, 420), f.p(600, 420)], width: 150, weight: 1.0 },
  ],
  zones: [
    { id: 'well', shape: 'disc', at: f.p(0, 0), r: 170, weight: 1.4, wave: [2, 9] },
    { id: 'loft', shape: 'disc', at: f.p(0, -490), r: 130, weight: 1, wave: [3, 9] },
    { id: 'north-w', shape: 'disc', at: f.p(-400, -440), r: 140, weight: 1 },
    { id: 'north-e', shape: 'disc', at: f.p(400, -440), r: 140, weight: 1 },
    { id: 'south-w', shape: 'disc', at: f.p(-450, 430), r: 140, weight: 0.8 },
    { id: 'south-e', shape: 'disc', at: f.p(450, 430), r: 140, weight: 0.8 },
  ],
  bossStage: { at: f.p(0, -600), r: 150, arrive: 'shimmer', facing: 180 },
  anchors: [
    perch(f, 'perch-nw', { x: -330, y: -400 }),
    perch(f, 'perch-ne', { x: 330, y: -400 }),
    perch(f, 'perch-pocket-w', { x: -250, y: -120 }),
    perch(f, 'perch-pocket-e', { x: 250, y: -120 }),
    { id: 'echo-w', fits: 'echo', at: f.p(-BRIDGE_X, -100) },
    { id: 'echo-e', fits: 'echo', at: f.p(BRIDGE_X, -100) },
    { id: 'host-n', fits: 'host', at: f.p(-170, -420), r: 80 },
    { id: 'host-s', fits: 'host', at: f.p(170, 420), r: 80 },
    { id: 'bell-well', fits: 'bell', at: f.p(0, 0) },
    { id: 'bell-n', fits: 'bell', at: f.p(0, -330) },
    { id: 'road-centre', fits: 'road', at: f.p(0, 0), path: [f.p(0, -640), f.p(0, -300), f.p(0, 0), f.p(0, 300), f.p(0, 640)] },
    { id: 'fault-s', fits: 'fault', at: f.p(-340, 560), path: [f.p(-340, 420), f.p(-340, 680)] },
    { id: 'relay-1', fits: 'relay', at: f.p(-BRIDGE_X, 100) },
    { id: 'relay-2', fits: 'relay', at: f.p(BRIDGE_X, 100) },
    { id: 'relay-3', fits: 'relay', at: f.p(0, -340) },
    { id: 'altar-1', fits: 'altar', at: f.p(0, 420) },
    { id: 'orchard-1', fits: 'orchard', at: f.p(-600, 420) },
    { id: 'ring-1', fits: 'ring', at: f.p(0, -120) },
    { id: 'anvil-1', fits: 'anvil', at: f.p(0, 120) },
  ],
  rareSpots: [
    { at: f.p(-450, -440), r: 90, weight: 2 },
    { at: f.p(450, -440), r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(0, 0), r: 250, colour: VIOLET, flicker: 0.1 },
      { at: f.p(0, -600), r: 220, colour: VIOLET, flicker: 0.12 },
      { at: f.p(-340, -430), r: 120, colour: WINDOW, flicker: 0.04 },
      { at: f.p(340, -430), r: 120, colour: WINDOW, flicker: 0.04 },
      { at: f.p(-340, 430), r: 120, colour: WINDOW, flicker: 0.04 },
      { at: f.p(340, 430), r: 120, colour: WINDOW, flicker: 0.04 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'rubble', 'bones'], solid: false },
});
