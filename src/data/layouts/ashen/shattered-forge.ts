// Ashen Forge no. 4: Shattered Forge, "Broken Halves" (D-territory.md 10.7). R 945 (T7).
// Reads as: the wall. A long rubble wall runs NW to SE and splits the arena into two unequal halves with three gates: the
// west half (the landing, open ground, ritual circles) is the larger, the east half holds the vat rows and the boss stage at
// bearing 100. Two lanes cross the wall. A Fault line anchor waits in each half.
// Deviations: the three gates are 100 u wide (the template's 90 u is under the 96 u choke minimum of check 2).
// Weak spot (accepted): the gates become pack chokepoints (great for AoE, poor for ranged shooting through the wall: solid
// props block projectiles by design).
import { defineLayout, type AreaLayout, type LayoutLane } from '../schema';
import { atU, perches, pool } from '../packs/ashenChapelKit';

const R = 945;
const u = atU(R);
// The wall: from (-0.45, -0.75) to (0.75, 0.45) R, i.e. the line y = x - 0.3 R, 200 u from the landing.
const W0 = [-0.45 * R, -0.75 * R] as const;
const SPAN = 1.2 * R;
const wallPt = (t: number): [number, number] => [W0[0] + SPAN * t, W0[1] + SPAN * t];
const NORM = Math.SQRT1_2; // unit east normal is (NORM, -NORM)
const off = (t: number, d: number): [number, number] => {
  const w = wallPt(t);
  return u(w[0] + NORM * d, w[1] - NORM * d);
};
/** A point beside the wall: t along it, dn u east of it, dl u further along it (towards the south-east). */
const pos = (t: number, dn: number, dl = 0): [number, number] => {
  const w = wallPt(t);
  return u(w[0] + NORM * (dn + dl), w[1] + NORM * (dl - dn));
};
const GATES = [0.22, 0.5, 0.78];

const p = perches(R, [
  { id: 'perch-w1', at: { r: 0.6, a: 230 } },
  { id: 'perch-w2', at: { r: 0.6, a: 300 } },
]);

const cross = (id: string, t: number, weight: number, favours?: LayoutLane['favours']): LayoutLane => ({
  id, path: [off(t, -300), off(t, 330)], width: 110, weight, wave: [3, 6], ...(favours ? { favours } : {}),
});

export const SHATTERED_FORGE: AreaLayout = defineLayout({
  areaId: 'shatteredForge',
  version: 1,
  landmarks: [
    // Vat rows in the east half, two rows parallel to the wall (the columns sit between the gate axes).
    { id: 'vat-a1', kind: 'vat', at: off(0.12, 300), variant: 0 },
    { id: 'vat-a2', kind: 'vat', at: off(0.36, 300), variant: 1 },
    { id: 'vat-a3', kind: 'vat', at: off(0.64, 300), variant: 0 },
    { id: 'vat-b1', kind: 'vat', at: off(0.36, 500), variant: 0 },
    { id: 'vat-b2', kind: 'vat', at: off(0.64, 500), variant: 1 },
    { id: 'bellows-e', kind: 'bellows', at: off(0.5, 440), variant: 1 },
    { id: 'altar-w', kind: 'altar', at: { r: 0.78, a: 255 }, variant: 1 },
    { id: 'gate-stair', kind: 'stair', at: { r: 0.86, a: 100 }, r: 52 },
    ...p.covers,
  ],
  clusters: [
    // West half: three ritual circles on open ground.
    { id: 'circle-w', pattern: 'ring', at: { r: 0.55, a: 270 }, params: { r: 56, count: 6, rot: 10 }, prop: 'standingStone' },
    { id: 'circle-sw', pattern: 'ring', at: { r: 0.6, a: 205 }, params: { r: 56, count: 6, rot: 40 }, prop: 'standingStone' },
    { id: 'circle-nw', pattern: 'ring', at: { r: 0.62, a: 320 }, params: { r: 56, count: 6, rot: 25 }, prop: 'standingStone' },
    { id: 'circle-w-fire', pattern: 'ring', at: { r: 0.55, a: 270 }, params: { r: 0, count: 1 }, prop: 'brazier' },
    { id: 'circle-sw-fire', pattern: 'ring', at: { r: 0.6, a: 205 }, params: { r: 0, count: 1 }, prop: 'brazier' },
    { id: 'circle-nw-fire', pattern: 'ring', at: { r: 0.62, a: 320 }, params: { r: 0, count: 1 }, prop: 'brazier' },
    // Crate lines flank the north and centre gates from the east side (the south gate stays clear for the boss).
    { id: 'crates-g1', pattern: 'line', at: pos(0.22, 150, 130), params: { length: 70, bearing: 135, count: 3 }, prop: 'crate', variant: 0 },
    { id: 'crates-g2', pattern: 'line', at: pos(0.5, 170, -190), params: { length: 70, bearing: 135, count: 3 }, prop: 'crate', variant: 1 },
    { id: 'wall-rubble-w', pattern: 'scatter', at: off(0.3, -90), params: { r: 110, count: 8, radius: 0 }, prop: 'rubble' },
    { id: 'wall-rubble-e', pattern: 'scatter', at: off(0.7, 90), params: { r: 110, count: 8, radius: 0 }, prop: 'rubble' },
  ],
  walls: [
    { id: 'divide', path: [u(...wallPt(0)), u(...wallPt(1))], gaps: GATES.map((at) => ({ at, width: 100 })) },
  ],
  decals: [
    { id: 'wall-crack-a', kind: 'crack', path: [off(0.05, 40), off(0.12, 60), off(0.18, 30)], hazard: { kind: 'burn' } },
    { id: 'wall-crack-b', kind: 'crack', path: [off(0.58, -50), off(0.64, -30), off(0.7, -55)], hazard: { kind: 'burn' } },
    { id: 'wall-crack-c', kind: 'crack', path: [off(0.88, 70), off(0.94, 50)], hazard: { kind: 'burn' } },
    { id: 'slag-e1', kind: 'pool', at: off(0.5, 640), r: 56, hazard: { kind: 'burn' } },
    { id: 'slag-e2', kind: 'pool', at: off(0.22, 440), r: 48, hazard: { kind: 'burn' } },
    { id: 'road-gate', kind: 'road', path: [[-0.331, 0.331], [0.631, -0.631]], width: 100 },
    { id: 'glyph-w', kind: 'glyph', at: { r: 0.55, a: 270 }, r: 76 },
    { id: 'glyph-sw', kind: 'glyph', at: { r: 0.6, a: 205 }, r: 76 },
    { id: 'glyph-nw', kind: 'glyph', at: { r: 0.62, a: 320 }, r: 76 },
  ],
  lanes: [
    cross('cross-north', GATES[0], 1.3, ['melee']),
    cross('cross-centre', GATES[1], 1.6, ['fast']),
    cross('cross-south', GATES[2], 1.3),
    // The west half's long run along the wall, used while the players are still in the west.
    { id: 'wall-w', path: [off(0.2, -240), off(0.5, -240), off(0.8, -240)], width: 130, weight: 1, wave: [1, 4], favours: ['ranged'] },
  ],
  zones: [
    { id: 'west-plain', shape: 'disc', at: [-0.4, 0.2], r: 320, weight: 1.4 },
    { id: 'west-north', shape: 'disc', at: [-0.35, -0.45], r: 260, weight: 1, wave: [1, 4] },
    { id: 'east-yard', shape: 'disc', at: [0.45, -0.5], r: 300, weight: 1.2, wave: [2, 6] },
    { id: 'boss-yard', shape: 'disc', at: { r: 0.7, a: 100 }, r: 220, weight: 0.9, wave: [5, 6] },
  ],
  bossStage: { at: { r: 0.78, a: 100 }, r: 150, arrive: 'gate', facing: 280 },
  anchors: [
    ...p.anchors,
    { id: 'perch-e1', fits: 'perch', at: { r: 0.7, a: 20 } },
    { id: 'perch-e2', fits: 'perch', at: { r: 0.66, a: 70 } },
    { id: 'echo-w', fits: 'echo', at: { r: 0.62, a: 245 } },
    { id: 'echo-e', fits: 'echo', at: [0.5, -0.55] },
    { id: 'relay-1', fits: 'relay', at: [-0.52, -0.42] },
    { id: 'relay-2', fits: 'relay', at: [-0.05, 0.65] },
    { id: 'relay-3', fits: 'relay', at: [0.6, -0.5] },
    { id: 'fault-w', fits: 'fault', at: [-0.62, 0.38], path: [[-0.62, 0.2], [-0.62, 0.55]] },
    { id: 'fault-e', fits: 'fault', at: [0.575, -0.575], path: [[0.45, -0.7], [0.7, -0.45]] },
    { id: 'anvil-w', fits: 'anvil', at: [-0.25, 0.28] },
    { id: 'anvil-e', fits: 'anvil', at: [0.28, -0.42] },
    { id: 'road-gate', fits: 'road', at: [0.15, -0.15], path: [[-0.331, 0.331], [0.631, -0.631]] },
    { id: 'altar-1', fits: 'altar', at: [-0.3, -0.1] },
    { id: 'orchard-1', fits: 'orchard', at: [-0.35, 0.62] },
    { id: 'ring-1', fits: 'ring', at: [0.38, -0.1] },
    { id: 'host-1', fits: 'host', at: [0.6, 0] },
    { id: 'bell-1', fits: 'bell', at: [-0.65, -0.05] },
  ],
  rareSpots: [
    { at: off(0.5, 380), r: 100, weight: 2 },
    { at: [-0.5, 0.4], r: 100, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      pool([0, 0], 160, '#ff8a3c', 0.35),
      pool(off(0.5, 640), 110, '#ff6a2a', 0.3),
      pool({ r: 0.78, a: 100 }, 170, '#ff5a20', 0.3),
    ],
  },
  scatter: { density: 6, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
