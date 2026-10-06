// Ashen Forge no. 6: Heart of the Forge, "Heart" (D-territory.md 10.7). R 900 (T15).
// Reads as: the wheel. The landing is on the south rim; the great furnace (walk-through glow r 110) in the middle is the boss
// stage, ringed by six bellows stacks and an inner ring wall with two gates; six spoke walls divide the outer hall into six
// sectors whose gaps alternate between the inner (r 0.55) and outer (r 0.78) radius, so the route inward zigzags around the
// wheel sector by sector. Lanes follow that route; an altar caps every spoke.
// Deviations: the bellows ring stands at r 0.27 (not 0.22): check 3 needs a free 400 u disc at the boss stage; an inner ring
// wall (r 0.38, gates at bearings 120 and 300) gives the spiral its inward leg; the spoke gaps are 100 u (>= 96) at r 0.55
// and 0.78 on alternating spokes; the boss arrives by `shimmer` (the template names none).
// Weak spot (accepted): the hardest route to read in a crowd (the intended top-tier test); a single safe kite loop exists
// round the furnace, inside the bellows.
import { defineLayout, type AreaLayout, type LayoutLane } from '../schema';
import { arcAt, arcPath, bearings, perches, pool } from '../packs/ashenChapelKit';

const R = 900;
const START = { r: 0.86, a: 180 } as const;
const SPOKES = bearings(30, 6); // 30, 90, 150, 210, 270, 330
// Gap radius per spoke (R units): alternating inner / outer so the route zigzags.
const GAP_R: Record<number, number> = { 150: 0.55, 210: 0.78, 270: 0.55, 330: 0.78, 30: 0.55, 90: 0.78 };
const S0 = 0.4; // spoke inner end
const S1 = 0.91; // spoke outer end
/** A sector's spawn lane: an arc down its middle (r in R units, default 0.66), used only in its own wave window. */
const sector = (c: number, wave: [number, number], weight: number, id: string, r = 0.66): LayoutLane => ({
  id, path: arcPath(r, c - 17, c + 17), width: 150, weight, wave,
});

const p = perches(R, [
  { id: 'perch-s2', at: { r: 0.72, a: 285 } },
  { id: 'perch-s3', at: { r: 0.72, a: 15 } },
  { id: 'perch-s4', at: { r: 0.72, a: 75 } },
  { id: 'perch-s5', at: { r: 0.72, a: 135 } },
], START);

export const HEART_OF_FORGE: AreaLayout = defineLayout({
  areaId: 'heartOfForge',
  version: 1,
  start: { at: START },
  landmarks: [
    { id: 'furnace', kind: 'furnace', at: [0, 0], r: 110 },
    // An altar caps every spoke at the rim.
    ...SPOKES.map((a, k) => ({ id: `altar-cap-${a}`, kind: 'altar' as const, at: { r: 0.91, a }, r: 28, variant: k % 2 })),
    ...p.covers,
  ],
  clusters: [
    { id: 'bellows-ring', pattern: 'ring', at: [0, 0], params: { r: 243, count: 6, rot: 0 }, prop: 'bellows' },
    { id: 'rubble-s0', pattern: 'scatter', at: { r: 0.62, a: 168 }, params: { r: 110, count: 6, radius: 0 }, prop: 'rubble' },
    { id: 'rubble-s3', pattern: 'scatter', at: { r: 0.7, a: 8 }, params: { r: 110, count: 6, radius: 0 }, prop: 'rubble' },
    { id: 'bones-s1', pattern: 'scatter', at: { r: 0.6, a: 242 }, params: { r: 90, count: 4, radius: 0 }, prop: 'bones' },
  ],
  walls: [
    { id: 'core-wall', path: arcPath(0.38, 0, 360), gaps: [120, 300].map((b) => ({ at: arcAt(0, 360, b), width: 110 })) },
    ...SPOKES.map((a) => ({
      id: `spoke-${a}`,
      path: [{ r: S0, a }, { r: S1, a }],
      gaps: [{ at: (GAP_R[a] - S0) / (S1 - S0), width: 100 }],
    })),
  ],
  decals: [
    { id: 'crack-a', kind: 'crack', path: [{ r: 0.16, a: 20 }, { r: 0.24, a: 12 }, { r: 0.32, a: 18 }] },
    { id: 'crack-b', kind: 'crack', path: [{ r: 0.16, a: 150 }, { r: 0.24, a: 160 }, { r: 0.32, a: 152 }] },
    { id: 'crack-c', kind: 'crack', path: [{ r: 0.16, a: 255 }, { r: 0.24, a: 248 }, { r: 0.32, a: 258 }] },
    { id: 'slag-s1', kind: 'pool', at: { r: 0.74, a: 240 }, r: 56 },
    { id: 'slag-s4', kind: 'pool', at: { r: 0.66, a: 62 }, r: 48 },
    { id: 'furnace-glyph', kind: 'glyph', at: [0, 0], r: 300 },
    { id: 'landing-road', kind: 'road', path: [{ r: 0.86, a: 180 }, { r: 0.7, a: 192 }], width: 100 },
  ],
  lanes: [
    // The route inward, sector by sector: each sector is fought in its own window (the order the player will traverse).
    sector(180, [1, 2], 0.8, 'sector-0', 0.54),
    sector(240, [1, 3], 1.4, 'sector-1'),
    sector(300, [2, 4], 1.4, 'sector-2'),
    sector(0, [3, 5], 1.4, 'sector-3'),
    sector(60, [4, 6], 1.4, 'sector-4'),
    sector(120, [4, 6], 1.4, 'sector-5'),
    { id: 'core-loop', path: arcPath(0.2, 0, 360), width: 100, weight: 1, wave: [5, 6], favours: ['melee'] },
  ],
  zones: [
    { id: 'core', shape: 'disc', at: [0, 0], r: 250, weight: 1.2, wave: [5, 6] },
    { id: 'outer-w', shape: 'disc', at: { r: 0.7, a: 270 }, r: 250, weight: 0.8, wave: [2, 6] },
    { id: 'outer-e', shape: 'disc', at: { r: 0.7, a: 90 }, r: 250, weight: 0.8, wave: [2, 6] },
  ],
  bossStage: { at: [0, 0], r: 170, arrive: 'shimmer', facing: 180 },
  anchors: [
    ...p.anchors,
    ...SPOKES.map((a) => ({ id: `altar-${a}`, fits: 'altar' as const, at: { r: 0.84, a: a + 10 } })),
    // Echo anchors inside the bellows ring (E1): the echoes walk home through the open core, not across the spoke walls (on the
    // outer sectors the interception chase led through uncleared sectors: 10 of 12 bot runs died there against 4 of 12).
    { id: 'echo-s1', fits: 'echo', at: { r: 0.15, a: 270 } },
    { id: 'echo-s4', fits: 'echo', at: { r: 0.15, a: 90 } },
    { id: 'relay-1', fits: 'relay', at: { r: 0.62, a: 240 } },
    { id: 'relay-2', fits: 'relay', at: { r: 0.62, a: 0 } },
    { id: 'relay-3', fits: 'relay', at: { r: 0.62, a: 120 } },
    { id: 'fault-s2', fits: 'fault', at: { r: 0.63, a: 300 }, path: [{ r: 0.46, a: 300 }, { r: 0.8, a: 300 }] },
    { id: 'fault-s4', fits: 'fault', at: { r: 0.63, a: 60 }, path: [{ r: 0.46, a: 60 }, { r: 0.8, a: 60 }] },
    { id: 'anvil-1', fits: 'anvil', at: { r: 0.325, a: 30 } },
    { id: 'anvil-2', fits: 'anvil', at: { r: 0.325, a: 210 } },
    {
      id: 'road-spiral', fits: 'road', at: { r: 0.55, a: 270 },
      path: [{ r: 0.86, a: 180 }, { r: 0.8, a: 190 }, { r: 0.78, a: 210 }, { r: 0.68, a: 240 }, { r: 0.55, a: 270 }, { r: 0.6, a: 300 }],
    },
    { id: 'orchard-1', fits: 'orchard', at: { r: 0.55, a: 350 } },
    { id: 'ring-1', fits: 'ring', at: { r: 0.5, a: 170 } },
    { id: 'host-1', fits: 'host', at: { r: 0.5, a: 245 } },
    { id: 'bell-1', fits: 'bell', at: { r: 0.5, a: 115 } },
  ],
  rareSpots: [
    { at: { r: 0.66, a: 300 }, r: 100, weight: 2 },
    { at: { r: 0.66, a: 60 }, r: 100, weight: 2 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      pool([0, 0], 250, '#ff7a30', 0.5),
      pool({ r: 0.86, a: 180 }, 150, '#ff8a3c', 0.3),
      pool({ r: 0.74, a: 240 }, 100, '#ff6a2a', 0.3),
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones', 'rubble'], solid: false },
});
