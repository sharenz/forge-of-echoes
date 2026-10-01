// Cinder Chapel no. 7: Ember Vault, "Reliquary Stair" (D-territory.md 10.7). R 640 (dead end, T3 ceiling).
// Reads as: the hall and its door. A narrow nave runs N-S between two pillar aisles (x +-0.28 R); four side chapels (an altar,
// a banner, a cover pair and a back wall) open off the aisles at bearings 72/108/252/288; the sealed vault door stands at the
// north end, where the boss waits (r 0.70, `gate`). Lanes are the two side aisles; two Caravan roads (nave and west aisle)
// serve the vault's native Laden Caravan, the four chapel altars its Pact Altar.
// Deviations: the chapels stand at bearings 72/108/252/288 and r 0.60 (template 70/110/250/290 at r 0.55) so the aisle lane
// clears them; the door flankers stand 235 u either side of the stage (check 3's free 400 u disc).
// Weak spot (accepted): cramped, so events with big footprints (Fault, Ring) have few anchors; the vault's 30% extra reward
// and ingredient weights compensate.
import { defineLayout, type AreaLayout, type LayoutAnchor, type LayoutCluster, type LayoutLandmark, type LayoutWall } from '../schema';
import { local, perches, pool } from '../packs/ashenChapelKit';

const R = 640;
const CHAPELS = [72, 108, 252, 288];

const p = perches(R, [
  { id: 'perch-ne', at: { r: 0.66, a: 20 } },
  { id: 'perch-se', at: { r: 0.66, a: 160 } },
  { id: 'perch-sw', at: { r: 0.66, a: 200 } },
  { id: 'perch-nw', at: { r: 0.66, a: 340 } },
]);

const chapel = (a: number): { marks: LayoutLandmark[]; wall: LayoutWall; anchor: LayoutAnchor; flank: LayoutCluster } => {
  const c = { r: 0.6, a };
  return {
    marks: [
      { id: `altar-${a}`, kind: 'altar', at: c, variant: a % 2 },
      { id: `banner-${a}`, kind: 'banner', at: local(R, c, a, 0, 44), variant: a % 4 },
    ],
    wall: { id: `back-${a}`, path: [local(R, c, a, -62, 62), local(R, c, a, 62, 62)] },
    anchor: { id: `altar-site-${a}`, fits: 'altar', at: local(R, c, a, 0, -44) },
    // The cover pair: a pillar either side of the altar.
    flank: { id: `pair-${a}`, pattern: 'line', at: local(R, c, a, -46, -8), params: { length: 92, bearing: (a + 90) % 360, count: 2 }, prop: 'pillar', variant: 2 },
  };
};
const chapels = CHAPELS.map(chapel);

export const EMBER_VAULT: AreaLayout = defineLayout({
  areaId: 'emberVault',
  version: 1,
  landmarks: [
    { id: 'vault-door', kind: 'stair', at: [0, -0.86], r: 56 },
    { id: 'door-pillar-w', kind: 'pillar', at: [-0.367, -0.8], r: 14, variant: 2 },
    { id: 'door-pillar-e', kind: 'pillar', at: [0.367, -0.8], r: 14, variant: 3 },
    ...chapels.flatMap((c) => c.marks),
    ...p.covers,
  ],
  clusters: [
    // The nave colonnades.
    { id: 'aisle-w', pattern: 'line', at: [-0.28, -0.5], params: { length: 640, bearing: 180, count: 8 }, prop: 'pillar' },
    { id: 'aisle-e', pattern: 'line', at: [0.28, -0.5], params: { length: 640, bearing: 180, count: 8 }, prop: 'pillar' },
    ...chapels.map((c) => c.flank),
    // Banners hang between the pillars (walk-through decor).
    { id: 'banners-w', pattern: 'line', at: [-0.34, -0.42], params: { length: 560, bearing: 180, count: 4 }, prop: 'banner', variant: 1 },
    { id: 'banners-e', pattern: 'line', at: [0.34, -0.42], params: { length: 560, bearing: 180, count: 4 }, prop: 'banner', variant: 3 },
    { id: 'rubble-nave', pattern: 'scatter', at: [0, 0.5], params: { r: 80, count: 5, radius: 0 }, prop: 'rubble' },
  ],
  walls: chapels.map((c) => c.wall),
  decals: [
    { id: 'nave-carpet', kind: 'road', path: [[0, 0.7], [0, -0.7]], width: 110 },
    { id: 'door-glyph', kind: 'glyph', at: [0, -0.7], r: 120 },
    ...CHAPELS.map((a) => ({ id: `glyph-${a}`, kind: 'glyph' as const, at: { r: 0.6, a }, r: 56 })),
    { id: 'shaft-n', kind: 'light', at: [0, -0.32], r: 100 },
    { id: 'shaft-s', kind: 'light', at: [0, 0.34], r: 100 },
    { id: 'crack-s', kind: 'crack', path: [[-0.2, 0.55], [-0.1, 0.62], [0.05, 0.57], [0.18, 0.66]] },
  ],
  lanes: [
    // The two side aisles; the nave itself only fills for the last waves.
    { id: 'aisle-w', path: [[-0.38, -0.5], [-0.38, 0.6]], width: 110, weight: 1.5, favours: ['melee'] },
    { id: 'aisle-e', path: [[0.38, -0.5], [0.38, 0.6]], width: 110, weight: 1.5, favours: ['ranged'] },
    { id: 'nave-door', path: [[0, -0.12], [0, -0.52]], width: 130, weight: 1.2, wave: [4, 6] },
  ],
  zones: [
    { id: 'south-hall', shape: 'disc', at: [0, 0.52], r: 200, weight: 1, wave: [1, 4] },
    { id: 'door-hall', shape: 'disc', at: [0, -0.4], r: 190, weight: 0.9, wave: [3, 6] },
  ],
  bossStage: { at: [0, -0.7], r: 130, arrive: 'gate', facing: 180 },
  anchors: [
    ...p.anchors,
    ...chapels.map((c) => c.anchor),
    { id: 'echo-e', fits: 'echo', at: { r: 0.6, a: 90 } },
    { id: 'echo-w', fits: 'echo', at: { r: 0.6, a: 270 } },
    { id: 'relay-1', fits: 'relay', at: [-0.5, 0.52] },
    { id: 'relay-2', fits: 'relay', at: [0.5, 0.52] },
    { id: 'relay-3', fits: 'relay', at: [0, -0.47] },
    { id: 'fault-s', fits: 'fault', at: [0, 0.72], path: [[-0.3, 0.72], [0.3, 0.72]] },
    { id: 'road-nave', fits: 'road', at: [0, 0], path: [[0, 0.66], [0, -0.66]] },
    { id: 'road-aisle', fits: 'road', at: [-0.38, 0], path: [[-0.38, 0.66], [-0.38, -0.66]] },
    { id: 'anvil-1', fits: 'anvil', at: [0, 0.42] },
    { id: 'orchard-1', fits: 'orchard', at: [-0.12, -0.25] },
    { id: 'ring-1', fits: 'ring', at: [0.12, -0.25] },
    { id: 'host-1', fits: 'host', at: [-0.12, 0.3] },
    { id: 'bell-1', fits: 'bell', at: [0.12, 0.3] },
  ],
  rareSpots: [
    { at: { r: 0.6, a: 90 }, r: 80, weight: 2 },
    { at: { r: 0.6, a: 270 }, r: 80, weight: 2 },
  ],
  light: {
    ambient: 0.08,
    pools: [
      ...CHAPELS.map((a) => pool({ r: 0.6, a }, 85, '#ffb060', 0.45)),
      pool([0, -0.7], 150, '#ff7a30', 0.3),
      pool([0, 0], 150, '#ff9a50', 0.25),
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
