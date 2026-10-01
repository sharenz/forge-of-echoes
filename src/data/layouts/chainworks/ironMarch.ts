// Iron March (T5, R 700), handle "Lines": D-territory.md 10.7 no. 19.
//
// Five west-east conveyor lanes (90 u wide) separated by crate-stack rails with a cross-gap every ~0.35 R, an outer rail
// closing the lane field to the north and south, and open cargo yards beyond it. Landing at the west dock (braziers), the
// boss at the east loading gate (two gates flank it). The centre lane is the Caravan's road; the Pit of Echoes hatch is a
// decal at the south-west. Hounds ('fast') favour the centre lane, bruisers the middle lanes, artillery the outer lanes.
//
// Reads as: the lanes. Weak spot: lane lock-in; the Stalker hides behind crate rails (excellent cover).
import { defineLayout, type AreaLayout, type P } from '../schema';

const R = 700;
const u = (x: number, y: number): P => [x / R, y / R];
const LANES = [-228, -114, 0, 114, 228];

export const IRON_MARCH: AreaLayout = defineLayout({
  areaId: 'ironMarch',
  version: 1,
  start: { at: u(-490, 0) },
  landmarks: [
    // Chain posts cap every rail (the "belt guards"), hoists stand over the cargo yards, the Pit of Echoes hatch is decor.
    ...[-171, -57, 57, 171].flatMap((y) => [
      { id: `cap-w-${y}`, kind: 'chainPost' as const, at: u(-342, y), variant: 0 },
      { id: `cap-e-${y}`, kind: 'chainPost' as const, at: u(368, y), variant: y > 0 ? 0 : 1 },
    ]),
    { id: 'hoist-n', kind: 'hoist', at: u(70, -440), variant: 0 },
    { id: 'hoist-s', kind: 'hoist', at: u(-100, 440), variant: 1 },
    { id: 'hoist-ne', kind: 'hoist', at: u(470, -360), variant: 1 },
    { id: 'hoist-se', kind: 'hoist', at: u(470, 360), variant: 0 },
    { id: 'gate-n', kind: 'gate', at: u(560, -250), variant: 0 },
    { id: 'gate-s', kind: 'gate', at: u(560, 250), variant: 0 },
    { id: 'pit-hatch', kind: 'hatch', at: u(-380, 400), r: 44 },
  ],
  clusters: [
    { id: 'dock-braziers', pattern: 'ring', at: u(-490, 0), params: { r: 175, count: 4, rot: 45 }, prop: 'brazier' },
    { id: 'stock-nw', pattern: 'scatter', at: u(-215, -470), params: { r: 85, count: 6 }, prop: 'crate' },
    { id: 'stock-ne', pattern: 'scatter', at: u(250, -440), params: { r: 85, count: 6 }, prop: 'crate' },
    { id: 'stock-sw', pattern: 'scatter', at: u(-215, 470), params: { r: 85, count: 5 }, prop: 'crate' },
    { id: 'stock-se', pattern: 'scatter', at: u(260, 450), params: { r: 85, count: 6 }, prop: 'crate' },
    { id: 'yard-posts-n', pattern: 'line', at: u(-120, -330), params: { length: 240, bearing: 90, count: 5 }, prop: 'chainPost' },
    { id: 'yard-posts-s', pattern: 'line', at: u(-120, 330), params: { length: 240, bearing: 90, count: 5 }, prop: 'chainPost', variant: 1 },
  ],
  walls: [
    // Inner rails between the lanes: a 100 u cross-gap about every 0.35 R, staggered so no straight line crosses the field.
    { id: 'rail-n1', path: [u(-322, -171), u(350, -171)], thickness: 24, prop: 'crate', gaps: [{ at: 0.47, width: 100 }, { at: 0.82, width: 100 }] },
    { id: 'rail-n2', path: [u(-322, -57), u(350, -57)], thickness: 24, prop: 'crate', gaps: [{ at: 0.3, width: 100 }, { at: 0.65, width: 100 }] },
    { id: 'rail-s2', path: [u(-322, 57), u(350, 57)], thickness: 24, prop: 'crate', gaps: [{ at: 0.3, width: 100 }, { at: 0.65, width: 100 }] },
    { id: 'rail-s1', path: [u(-322, 171), u(350, 171)], thickness: 24, prop: 'crate', gaps: [{ at: 0.47, width: 100 }, { at: 0.82, width: 100 }] },
    // Outer rails: the lane field's north and south edge, two service gaps each.
    { id: 'edge-n', path: [u(-546, -285), u(546, -285)], thickness: 24, prop: 'crate', gaps: [{ at: 0.34, width: 110 }, { at: 0.66, width: 110 }] },
    { id: 'edge-s', path: [u(-546, 285), u(546, 285)], thickness: 24, prop: 'crate', gaps: [{ at: 0.34, width: 110 }, { at: 0.66, width: 110 }] },
  ],
  decals: [
    // Conveyor bands (wide road decals) down every lane and hazard stripes (narrow ones) along the outer rails.
    ...LANES.map((y) => ({ id: `belt-${y}`, kind: 'road' as const, path: [u(-322, y), u(350, y)], width: 90 })),
    { id: 'hazard-n', kind: 'road', path: [u(-546, -262), u(546, -262)], width: 16 },
    { id: 'hazard-s', kind: 'road', path: [u(-546, 262), u(546, 262)], width: 16 },
    { id: 'dock-apron', kind: 'road', path: [u(-600, 0), u(-340, 0)], width: 120 },
    { id: 'gate-apron', kind: 'road', path: [u(352, 0), u(600, 0)], width: 120 },
    { id: 'lamp-boss', kind: 'light', at: u(560, 0), r: 170 },
  ],
  lanes: [
    { id: 'lane-c', path: [u(-300, 0), u(340, 0)], width: 90, weight: 2.4, favours: ['fast'] },
    { id: 'lane-n1', path: [u(-300, -114), u(340, -114)], width: 90, weight: 1.6, favours: ['melee'] },
    { id: 'lane-s1', path: [u(-300, 114), u(340, 114)], width: 90, weight: 1.6, favours: ['melee'] },
    { id: 'lane-n2', path: [u(-300, -228), u(340, -228)], width: 90, weight: 1.3, favours: ['ranged'], wave: [2, 9] },
    { id: 'lane-s2', path: [u(-300, 228), u(340, 228)], width: 90, weight: 1.3, favours: ['ranged'], wave: [2, 9] },
  ],
  zones: [
    { id: 'yard-n', shape: 'disc', at: u(0, -440), r: 170, weight: 1.1 },
    { id: 'yard-s', shape: 'disc', at: u(40, 450), r: 170, weight: 1.1 },
    { id: 'yard-e', shape: 'disc', at: u(450, 0), r: 130, weight: 1.2, wave: [2, 9] },
  ],
  bossStage: { at: u(560, 0), r: 150, arrive: 'gate', facing: 270 },
  anchors: [
    { id: 'perch-n', fits: 'perch', at: u(-100, -228) },
    { id: 'perch-s', fits: 'perch', at: u(-100, 228) },
    { id: 'perch-ne', fits: 'perch', at: u(210, -114) },
    { id: 'perch-se', fits: 'perch', at: u(210, 114) },
    { id: 'ring-1', fits: 'ring', at: u(120, 0) },
    { id: 'ring-2', fits: 'ring', at: u(430, -140) },
    { id: 'echo-1', fits: 'echo', at: u(-70, 114) },
    { id: 'echo-2', fits: 'echo', at: u(250, -114) },
    { id: 'road-centre', fits: 'road', at: u(0, 0), path: [u(-525, 0), u(525, 0)] },
    { id: 'fault-n', fits: 'fault', at: u(75, -228), path: [u(-60, -228), u(210, -228)] },
    { id: 'relay-1', fits: 'relay', at: u(-180, 114) },
    { id: 'relay-2', fits: 'relay', at: u(150, -114) },
    { id: 'relay-3', fits: 'relay', at: u(120, 228) },
    { id: 'altar-1', fits: 'altar', at: u(300, 114) },
    { id: 'orchard-1', fits: 'orchard', at: u(60, -400) },
    { id: 'host-1', fits: 'host', at: u(150, 400) },
    { id: 'anvil-1', fits: 'anvil', at: u(-300, 228) },
    { id: 'bell-1', fits: 'bell', at: u(-60, -400) },
  ],
  rareSpots: [
    { at: u(40, -440), r: 90, weight: 2 },
    { at: u(70, 450), r: 90, weight: 2 },
  ],
  light: {
    ambient: 0.12,
    pools: [
      { at: u(-490, 0), r: 200, colour: '#ffb050', flicker: 0.3 },
      { at: u(-60, 0), r: 130, colour: '#ffc060', flicker: 0.1 },
      { at: u(200, -114), r: 130, colour: '#ffc060', flicker: 0.1 },
      { at: u(200, 114), r: 130, colour: '#ffc060', flicker: 0.1 },
      { at: u(560, 0), r: 190, colour: '#ffd080', flicker: 0.2 },
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'rubble', 'bones'], solid: false },
});
