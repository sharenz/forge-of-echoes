// Cinder Chapel no. 8: Ember Citadel, "Ritual City" (D-territory.md 10.7). R 880 (T11).
// Reads as: a city. Eight small L-shaped houses ring the central plaza at r 0.6; four 110 u streets (N/E/S/W) cut through them;
// the plaza (a brazier circle) is the boss stage, and the landing is the south gate. House courtyards carry the event
// anchors (echo, orchard, altar, ring, host, bell, anvil).
// Deviations: the plaza is 208 u wide in radius (template 170): the brazier circle stands at r 215 so check 3's free 400 u disc
// round the boss stage holds; houses are open L's (two walls each) so the Stalker can use them as cover but packs do not
// funnel through doors.
// Weak spot (accepted): houses are line-of-sight blockers (the Stalker is hardest to predict here) and the streets trap
// careless parties.
import { defineLayout, type AreaLayout, type LayoutAnchor, type LayoutWall } from '../schema';
import { local, perches, pool } from '../packs/ashenChapelKit';

const R = 880;
const START = { r: 0.8, a: 180 } as const;
const HOUSE_A = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5];
// What each house courtyard offers (D 10.7: anchors in house courtyards).
const COURTYARD: Record<number, LayoutAnchor['fits']> = {
  22.5: 'echo', 67.5: 'anvil', 112.5: 'orchard', 157.5: 'altar', 202.5: 'ring', 247.5: 'host', 292.5: 'bell', 337.5: 'echo',
};

const house = (a: number, k: number): { wall: LayoutWall; anchor: LayoutAnchor } => {
  const c = { r: 0.6, a };
  const m = k % 2 ? -1 : 1; // alternate houses mirror their L
  return {
    wall: { id: `house-${a}`, path: [local(R, c, a, -72 * m, -52), local(R, c, a, -72 * m, 52), local(R, c, a, 72 * m, 52)] },
    anchor: { id: `court-${a}`, fits: COURTYARD[a], at: local(R, c, a, 5 * m, 8) },
  };
};
const houses = HOUSE_A.map(house);

const p = perches(R, [
  { id: 'perch-ne', at: { r: 0.78, a: 55 }, cover: 300 },
  { id: 'perch-se', at: { r: 0.78, a: 125 }, cover: 300 },
  { id: 'perch-sw', at: { r: 0.78, a: 235 }, cover: 300 },
  { id: 'perch-nw', at: { r: 0.78, a: 305 }, cover: 300 },
], START);

export const EMBER_CITADEL: AreaLayout = defineLayout({
  areaId: 'emberCitadel',
  version: 1,
  start: { at: START },
  landmarks: [
    { id: 'plaza-dais', kind: 'dais', at: [0, 0], r: 90 },
    { id: 'south-gate', kind: 'stair', at: [0, 0.9], r: 44 },
    { id: 'gate-pillar-w', kind: 'pillar', at: [-0.182, 0.88], variant: 2 },
    { id: 'gate-pillar-e', kind: 'pillar', at: [0.182, 0.88], variant: 3 },
    { id: 'banner-n', kind: 'banner', at: [-0.1, -0.25], variant: 0 },
    { id: 'banner-s', kind: 'banner', at: [0.1, -0.25], variant: 2 },
    ...p.covers,
  ],
  clusters: [
    // The plaza's brazier circle (the eight gaps are the street mouths and the diagonals).
    { id: 'plaza-fires', pattern: 'ring', at: [0, 0], params: { r: 215, count: 8, rot: 22.5 }, prop: 'brazier' },
    { id: 'rubble-nw', pattern: 'scatter', at: { r: 0.8, a: 320 }, params: { r: 90, count: 5, radius: 0 }, prop: 'rubble' },
    { id: 'rubble-ne', pattern: 'scatter', at: { r: 0.8, a: 40 }, params: { r: 90, count: 5, radius: 0 }, prop: 'rubble' },
    { id: 'bones-e', pattern: 'scatter', at: { r: 0.78, a: 100 }, params: { r: 80, count: 4, radius: 0 }, prop: 'bones' },
  ],
  walls: houses.map((h) => h.wall),
  decals: [
    { id: 'street-n', kind: 'road', path: [[0, -0.22], [0, -0.86]], width: 110 },
    { id: 'street-e', kind: 'road', path: [[0.22, 0], [0.86, 0]], width: 110 },
    { id: 'street-s', kind: 'road', path: [[0, 0.22], [0, 0.86]], width: 110 },
    { id: 'street-w', kind: 'road', path: [[-0.22, 0], [-0.86, 0]], width: 110 },
    { id: 'plaza-glyph', kind: 'glyph', at: [0, 0], r: 170 },
    { id: 'plaza-inner', kind: 'glyph', at: [0, 0], r: 96 },
    { id: 'crack-a', kind: 'crack', path: [{ r: 0.8, a: 20 }, { r: 0.86, a: 28 }, { r: 0.78, a: 36 }], hazard: { kind: 'burn' } },
    { id: 'slag-w', kind: 'pool', at: { r: 0.84, a: 250 }, r: 40, hazard: { kind: 'burn' } },
  ],
  lanes: [
    // Streets carry the middle waves; the outer ring takes the first, the plaza the last.
    { id: 'street-n', path: [[0, -0.3], [0, -0.78]], width: 110, weight: 1.3, wave: [3, 6], favours: ['melee'] },
    { id: 'street-e', path: [[0.3, 0], [0.78, 0]], width: 110, weight: 1.3, wave: [3, 6], favours: ['fast'] },
    { id: 'street-w', path: [[-0.3, 0], [-0.78, 0]], width: 110, weight: 1.3, wave: [3, 6], favours: ['ranged'] },
    { id: 'street-s', path: [[0, 0.3], [0, 0.6]], width: 110, weight: 0.8, wave: [4, 6] },
  ],
  zones: [
    { id: 'ring-ne', shape: 'disc', at: { r: 0.8, a: 45 }, r: 210, weight: 1.2, wave: [1, 4] },
    { id: 'ring-se', shape: 'disc', at: { r: 0.8, a: 125 }, r: 210, weight: 1.2, wave: [1, 4] },
    { id: 'ring-nw', shape: 'disc', at: { r: 0.8, a: 315 }, r: 210, weight: 1.2, wave: [1, 4] },
    { id: 'ring-sw', shape: 'disc', at: { r: 0.8, a: 235 }, r: 210, weight: 1.2, wave: [1, 4] },
    { id: 'plaza', shape: 'disc', at: [0, 0], r: 230, weight: 1.4, wave: [5, 6] },
  ],
  bossStage: { at: [0, 0], r: 170, arrive: 'rim', facing: 180 },
  anchors: [
    ...p.anchors,
    ...houses.map((h) => h.anchor),
    { id: 'anvil-plaza', fits: 'anvil', at: { r: 0.3, a: 270 } },
    { id: 'relay-1', fits: 'relay', at: { r: 0.38, a: 45 } },
    { id: 'relay-2', fits: 'relay', at: { r: 0.38, a: 165 } },
    { id: 'relay-3', fits: 'relay', at: { r: 0.38, a: 285 } },
    { id: 'fault-w', fits: 'fault', at: { r: 0.8, a: 320 }, path: [{ r: 0.8, a: 300 }, { r: 0.8, a: 340 }] },
    { id: 'fault-e', fits: 'fault', at: { r: 0.8, a: 40 }, path: [{ r: 0.8, a: 20 }, { r: 0.8, a: 60 }] },
    { id: 'road-street', fits: 'road', at: [0, 0], path: [[0, 0.7], [0, -0.7]] },
  ],
  rareSpots: [
    { at: { r: 0.8, a: 90 }, r: 100, weight: 2 },
    { at: { r: 0.8, a: 270 }, r: 100, weight: 2 },
  ],
  light: {
    ambient: 0.09,
    pools: [
      pool([0, 0], 230, '#ff8a3c', 0.4),
      pool({ r: 0.8, a: 180 }, 150, '#ffb060', 0.3),
      ...[67.5, 157.5, 247.5, 337.5].map((a) => pool({ r: 0.6, a }, 90, '#ffb060', 0.35)),
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
