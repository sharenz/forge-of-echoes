// Echo Bastion (T13, R 1035, the largest arena), handle "Rampart" (D-territory.md 10.7 no. 14).
// Reads as: the ring wall. A rampart (wall run at r 0.78, six 110 u gates) rings an inner bailey; four corner towers
// (pillar clusters) stand at 45/135/225/315 on r 0.6 and carry the Echo anchors; a track about 150 u wide runs behind the
// wall. The boss holds the north gatehouse keep (`gate`). Weak spot (accepted): the track makes kiting easy, and camping
// in the bailey is dangerous because the gates funnel packs.
import { defineLayout, type AreaLayout } from '../schema';
import { cover, frame, FROST, FROST_DEEP, perch, polar, type XY } from '../ossuaryCryptKit';

const R = 1035;
const f = frame(R);
const WALL_R = 0.78 * R;
const START: XY = { x: 0, y: 500 };
const TOWERS = [45, 135, 225, 315];
const PERCHES = [
  { id: 'e', at: { x: 430, y: -140 }, d: 290 },
  { id: 'w', at: { x: -430, y: -140 }, d: 290 },
  { id: 'ne', at: { x: 300, y: -440 }, d: 330 },
  { id: 'nw', at: { x: -300, y: -440 }, d: 330 },
];
const covers = PERCHES.map((p) => cover(f, `ruin-${p.id}`, START, p.at, p.d, { kind: 'iceColumn', radius: 10, ring: 3, ringR: 28, ringKind: 'iceColumn' }));

export const ECHO_BASTION: AreaLayout = defineLayout({
  areaId: 'echoBastion',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    // The gatehouse keep: two great pillars just inside the north gate.
    { id: 'keep-w', kind: 'pillar', at: f.p(-105, -765), r: 18 },
    { id: 'keep-e', kind: 'pillar', at: f.p(105, -765), r: 18 },
    { id: 'gate-glyph', kind: 'plinth', at: f.p(0, -560), r: 36 },
    ...covers.map((c) => c.landmark),
  ],
  clusters: [
    ...TOWERS.map((a) => ({
      id: `tower-${a}`, pattern: 'ring' as const, at: f.pol(0.6 * R, a), params: { r: 36, count: 5, rot: a }, prop: 'pillar' as const,
    })),
    ...covers.flatMap((c) => (c.cluster ? [c.cluster] : [])),
    { id: 'track-bones', pattern: 'scatter', at: f.pol(850, 200), params: { r: 90, count: 6 }, prop: 'bones' },
    { id: 'track-crystal-e', pattern: 'arc', at: f.p(0, 0), params: { r: 930, count: 7, a0: 60, a1: 120 }, prop: 'crystal' },
    { id: 'track-crystal-w', pattern: 'arc', at: f.p(0, 0), params: { r: 930, count: 7, a0: 240, a1: 300 }, prop: 'crystal' },
  ],
  walls: [
    {
      id: 'rampart',
      path: Array.from({ length: 37 }, (_, k) => f.pol(WALL_R, k * 10)),
      thickness: 22,
      gaps: [0, 1, 2, 3, 4, 5, 6].map((k) => ({ at: k / 6, width: 110 })),
    },
  ],
  decals: [
    { id: 'track', kind: 'road', path: Array.from({ length: 37 }, (_, k) => f.pol(885, k * 10)), width: 120 },
    ...[0, 60, 120, 180, 240, 300].map((a) => ({ id: `gate-road-${a}`, kind: 'road' as const, path: [f.pol(WALL_R - 150, a), f.pol(WALL_R + 90, a)], width: 100 })),
    { id: 'bailey-glyph', kind: 'glyph', at: f.p(0, 0), r: 170 },
    { id: 'keep-pool', kind: 'pool', at: f.p(0, -560), r: 90 },
    ...TOWERS.map((a) => ({ id: `tower-glyph-${a}`, kind: 'glyph' as const, at: f.pol(0.6 * R, a), r: 55 })),
  ],
  lanes: [
    { id: 'track', path: Array.from({ length: 25 }, (_, k) => f.pol(885, k * 15)), width: 120, weight: 2.5, favours: ['fast'] },
    { id: 'gate-ne', path: [f.pol(300, 60), f.pol(900, 60)], width: 120, weight: 1, favours: ['melee'] },
    { id: 'gate-nw', path: [f.pol(300, 300), f.pol(900, 300)], width: 120, weight: 1, favours: ['melee'] },
    { id: 'gate-se', path: [f.pol(450, 120), f.pol(900, 120)], width: 120, weight: 0.8, wave: [2, 9] },
    { id: 'gate-sw', path: [f.pol(450, 240), f.pol(900, 240)], width: 120, weight: 0.8, wave: [2, 9] },
    { id: 'keep', path: [f.pol(300, 0), f.pol(700, 0)], width: 120, weight: 1, wave: [3, 9], favours: ['ranged'] },
  ],
  zones: [
    { id: 'bailey-n', shape: 'disc', at: f.p(0, -220), r: 190, weight: 1.2 },
    { id: 'bailey-e', shape: 'disc', at: f.p(300, 0), r: 170, weight: 1 },
    { id: 'bailey-w', shape: 'disc', at: f.p(-300, 0), r: 170, weight: 1 },
    { id: 'tower-ne', shape: 'disc', at: f.pol(0.6 * R, 45), r: 120, weight: 0.8 },
    { id: 'tower-nw', shape: 'disc', at: f.pol(0.6 * R, 315), r: 120, weight: 0.8 },
    { id: 'tower-se', shape: 'disc', at: f.pol(0.6 * R, 135), r: 120, weight: 0.8 },
    { id: 'tower-sw', shape: 'disc', at: f.pol(0.6 * R, 225), r: 120, weight: 0.8 },
    { id: 'track-e', shape: 'disc', at: f.pol(885, 90), r: 120, weight: 0.7, wave: [2, 9] },
    { id: 'track-w', shape: 'disc', at: f.pol(885, 270), r: 120, weight: 0.7, wave: [2, 9] },
  ],
  bossStage: { at: f.p(0, -560), r: 160, arrive: 'gate', facing: 180 },
  anchors: [
    ...PERCHES.map((p) => perch(f, `perch-${p.id}`, p.at)),
    ...TOWERS.map((a) => ({ id: `echo-${a}`, fits: 'echo' as const, at: f.pol(0.6 * R, a) })),
    { id: 'host-1', fits: 'host', at: f.p(-250, -120), r: 90 },
    { id: 'host-2', fits: 'host', at: f.p(250, -120), r: 90 },
    { id: 'bell-1', fits: 'bell', at: f.p(0, -120) },
    { id: 'bell-2', fits: 'bell', at: f.p(0, 120) },
    { id: 'road-track', fits: 'road', at: f.pol(885, 270), path: [210, 225, 240, 255, 270, 285, 300, 315].map((a) => f.pol(885, a)) },
    { id: 'fault-1', fits: 'fault', at: f.p(250, -120), path: [f.p(250, -250), f.p(250, 10)] },
    { id: 'relay-1', fits: 'relay', at: f.p(-300, -300) },
    { id: 'relay-2', fits: 'relay', at: f.p(300, -300) },
    { id: 'relay-3', fits: 'relay', at: f.p(0, 80) },
    { id: 'altar-1', fits: 'altar', at: f.p(-150, 170) },
    { id: 'orchard-1', fits: 'orchard', at: f.pol(885, 90) },
    { id: 'ring-1', fits: 'ring', at: f.p(150, -40) },
    { id: 'anvil-1', fits: 'anvil', at: f.p(-150, -40) },
  ],
  rareSpots: [
    { at: f.pol(885, 160), r: 90, weight: 2 },
    { at: f.pol(885, 200), r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(0, -560), r: 210, colour: FROST_DEEP, flicker: 0.1 },
      ...TOWERS.map((a) => ({ at: f.pol(0.6 * R, a), r: 120, colour: FROST, flicker: 0.12 })),
      { at: f.p(0, 0), r: 220, colour: FROST, flicker: 0.05 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'rubble', 'bones'], solid: false },
});
