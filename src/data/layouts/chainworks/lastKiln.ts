// The Last Kiln (T13, R 805), handle "Kiln": D-territory.md 10.7 no. 20.
//
// A huge kiln block at the centre (a sealed ring of crates, door to the south, the furnace glowing inside and a hoist over
// it), a 152 u conveyor annulus around it closed by an outer rail ring, four radial gantries (rail pairs) crossing the
// outer ring on the diagonals into the rim yard, and a wide boss gate at the south: the Chainmaster stands in the yard
// below the kiln door (arrive: 'shimmer'). Every event anchor sits on the annulus.
//
// Reads as: the kiln. Weak spot: circular kiting dominates (the annulus is a perfect loop); events only on the annulus.
//
// Deviation from the spec: the landing is not ON the annulus (a 152 u belt cannot hold the 300 u free landing disc of
// check 3) but in the west apron just outside the outer ring, which the diagonal gantries lead into.
import { defineLayout, type AreaLayout, type Polar, type Pt } from '../schema';

const R = 805;
const pol = (r: number, a: number): Polar => ({ r: r / R, a });
/** A closed polygon (one vertex per `step` degrees, first = last) of radius r: the wall/decal path of a circle. */
const circle = (r: number, step = 10): Pt[] => Array.from({ length: 360 / step + 1 }, (_, k) => pol(r, k * step));
const xy = (r: number, a: number): { x: number; y: number } => ({ x: Math.sin((a * Math.PI) / 180) * r, y: -Math.cos((a * Math.PI) / 180) * r });
/** Point at distance `s` along the bearing `a` from the centre, shifted `off` u to the right of that bearing. */
const lane = (a: number, s: number, off: number): Pt => {
  const p = xy(s, a);
  const q = xy(off, a + 90);
  return [(p.x + q.x) / R, (p.y + q.y) / R];
};
const ANNULUS = 268; // mid radius of the conveyor belt (192 .. 344)
const GANTRIES = [45, 135, 225, 315];

export const LAST_KILN: AreaLayout = defineLayout({
  areaId: 'lastKiln',
  version: 1,
  start: { at: pol(563, 270) },
  landmarks: [
    { id: 'furnace', kind: 'furnace', at: [0, 0], r: 100 },
    { id: 'kiln-hoist', kind: 'hoist', at: pol(125, 0), variant: 1 },
    { id: 'hoist-n', kind: 'hoist', at: pol(590, 0), variant: 0 },
    { id: 'hoist-e', kind: 'hoist', at: pol(590, 90), variant: 1 },
    { id: 'gate-sw', kind: 'gate', at: pol(445, 160), variant: 0 },
    { id: 'gate-se', kind: 'gate', at: pol(445, 200), variant: 0 },
    ...GANTRIES.flatMap((a) => [
      { id: `post-${a}-l`, kind: 'chainPost' as const, at: lane(a, 662, -60), variant: 0 },
      { id: `post-${a}-r`, kind: 'chainPost' as const, at: lane(a, 662, 60), variant: 1 },
    ]),
  ],
  clusters: [
    // The kiln block: a ring of crates with the door to the south (bearings 155 .. 205 left open).
    { id: 'kiln-ring', pattern: 'arc', at: [0, 0], params: { r: 180, count: 32, a0: 205, a1: 155 }, prop: 'crate' },
    { id: 'apron-braziers', pattern: 'ring', at: pol(563, 270), params: { r: 175, count: 4, rot: 45 }, prop: 'brazier' },
    { id: 'stock-ne', pattern: 'scatter', at: pol(560, 60), params: { r: 80, count: 5 }, prop: 'crate' },
    { id: 'stock-nw', pattern: 'scatter', at: pol(560, 315), params: { r: 70, count: 4 }, prop: 'crate' },
  ],
  walls: [
    // The outer rail ring: a gate at every gantry (120 u) and the wide boss gate at the south (190 u). Starts at the north, clockwise.
    {
      id: 'outer-ring', path: circle(356), thickness: 24, prop: 'crate',
      gaps: [...GANTRIES.map((a) => ({ at: a / 360, width: 120 })), { at: 0.5, width: 190 }],
    },
    // The gantries: pairs of rails 120 u apart (a 96 u walkway) from the outer ring out to the rim yard.
    ...GANTRIES.flatMap((a) => [-60, 60].map((off) => ({
      id: `gantry-${a}-${off < 0 ? 'l' : 'r'}`, path: [lane(a, 372, off), lane(a, 650, off)], thickness: 24, prop: 'crate' as const,
    }))),
  ],
  decals: [
    { id: 'belt', kind: 'road', path: circle(ANNULUS), width: 120 },
    { id: 'hazard-in', kind: 'road', path: circle(200), width: 14 },
    { id: 'hazard-out', kind: 'road', path: circle(336), width: 14 },
    ...GANTRIES.map((a) => ({ id: `walkway-${a}`, kind: 'road' as const, path: [lane(a, 380, 0), lane(a, 660, 0)], width: 70 })),
    { id: 'door-apron', kind: 'road', path: [pol(190, 180), pol(560, 180)], width: 110 },
    { id: 'chimney', kind: 'light', at: [0, 0], r: 230 },
    { id: 'lamp-boss', kind: 'light', at: pol(520, 180), r: 190 },
  ],
  lanes: [
    { id: 'annulus', path: circle(ANNULUS, 15), width: 130, weight: 2.4, favours: ['fast', 'melee'] },
    ...GANTRIES.map((a) => ({ id: `gantry-${a}`, path: [lane(a, 390, 0), lane(a, 640, 0)] as Pt[], width: 100, weight: 1.3, favours: ['ranged' as const], wave: [2, 9] as [number, number] })),
  ],
  zones: [
    { id: 'yard-n', shape: 'disc', at: pol(560, 0), r: 130, weight: 1.5 },
    { id: 'yard-e', shape: 'disc', at: pol(560, 90), r: 130, weight: 1.5 },
    { id: 'yard-s', shape: 'disc', at: pol(600, 180), r: 160, weight: 0.8, wave: [3, 9] },
  ],
  bossStage: { at: pol(467, 180), r: 150, arrive: 'shimmer', facing: 0 },
  anchors: [
    { id: 'perch-1', fits: 'perch', at: pol(ANNULUS, 20) },
    { id: 'perch-2', fits: 'perch', at: pol(ANNULUS, 85) },
    { id: 'perch-3', fits: 'perch', at: pol(ANNULUS, 150) },
    { id: 'perch-4', fits: 'perch', at: pol(ANNULUS, 250) },
    { id: 'perch-5', fits: 'perch', at: pol(ANNULUS, 330) },
    { id: 'echo-1', fits: 'echo', at: pol(ANNULUS, 60) },
    { id: 'echo-2', fits: 'echo', at: pol(ANNULUS, 300) },
    { id: 'road-belt', fits: 'road', at: pol(ANNULUS, 0), path: Array.from({ length: 13 }, (_, k) => pol(ANNULUS, (250 + k * 20) % 360)) },
    { id: 'fault-ne', fits: 'fault', at: pol(ANNULUS, 52), path: [pol(ANNULUS, 20), pol(ANNULUS, 84)] },
    { id: 'fault-se', fits: 'fault', at: pol(ANNULUS, 142), path: [pol(ANNULUS, 110), pol(ANNULUS, 174)] },
    { id: 'relay-1', fits: 'relay', at: pol(ANNULUS, 0) },
    { id: 'relay-2', fits: 'relay', at: pol(ANNULUS, 120) },
    { id: 'relay-3', fits: 'relay', at: pol(ANNULUS, 240) },
    { id: 'ring-1', fits: 'ring', at: pol(ANNULUS, 100) },
    { id: 'ring-2', fits: 'ring', at: pol(ANNULUS, 330) },
    { id: 'altar-1', fits: 'altar', at: pol(ANNULUS, 210) },
    { id: 'orchard-1', fits: 'orchard', at: pol(ANNULUS, 290) },
    { id: 'host-1', fits: 'host', at: pol(ANNULUS, 180) },
    { id: 'anvil-1', fits: 'anvil', at: pol(ANNULUS, 45) },
    { id: 'anvil-2', fits: 'anvil', at: pol(ANNULUS, 225) },
    { id: 'bell-1', fits: 'bell', at: pol(ANNULUS, 135) },
  ],
  rareSpots: [{ at: pol(560, 60), r: 100, weight: 2 }],
  light: {
    ambient: 0.1,
    pools: [
      { at: [0, 0], r: 260, colour: '#ff7a2a', flicker: 0.45 },
      { at: pol(563, 270), r: 190, colour: '#ffb050', flicker: 0.3 },
      { at: pol(520, 180), r: 200, colour: '#ffa040', flicker: 0.3 },
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'rubble', 'bones'], solid: false },
});
