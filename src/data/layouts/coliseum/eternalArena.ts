// Eternal Arena (T15, R 715), handle "Sands": D-territory.md 10.7 no. 23. Varkus's stage.
//
// The classic ring: an open sand disc (nothing solid inside r 0.55 but the small chain circle of the Champion's Ring at the
// centre) ringed by pillars and braziers in alternation at r 0.7, with four cardinal gates (a pair of gate posts each).
// Champion statue pairs stand outside the north and south gates. The landing is on the sand south of the centre; Varkus
// enters through the north gate (arrive: 'gate'). Stalker perches sit outside the ring or beyond the chain circle, so a
// hiding pillar always exists on the line, but the sand itself has no cover: the pounce must be dodged.
//
// Reads as: the circle. Weak spot: no cover in the sand (the hardest open test at T15).
//
// Deviation from the spec: 12 pillars + 8 braziers + 8 gate posts at r 0.7 instead of "16 pillar/brazier pairs" (the four
// 130 u gate openings take the cardinal positions).
import { defineLayout, type AreaLayout, type LayoutLandmark, type Polar, type P } from '../schema';

const R = 715;
const RING = 500;
const START: P = [0, 286 / R];
const pol = (r: number, a: number): Polar => ({ r: r / R, a });
const rad = (a: number): number => (a * Math.PI) / 180;
const xyOf = (r: number, a: number): { x: number; y: number } => ({ x: Math.sin(rad(a)) * r, y: -Math.cos(rad(a)) * r });
/** The point at radius `to` (u from the centre) on the ray from the start through (x, y): where a perch sees the start across a cover prop. */
const behind = (x: number, y: number, to: number): P => {
  const sx = 0;
  const sy = 286;
  const dx = x - sx;
  const dy = y - sy;
  // |S + t d| = to  ->  (dx² + dy²) t² + 2 (sx dx + sy dy) t + (sx² + sy² - to²) = 0
  const a = dx * dx + dy * dy;
  const b = 2 * (sx * dx + sy * dy);
  const c = sx * sx + sy * sy - to * to;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return [(sx + t * dx) / R, (sy + t * dy) / R];
};
const post = (a: number): { x: number; y: number } => xyOf(70, a);

const ringProps: LayoutLandmark[] = [];
for (let k = 0; k < 16; k++) {
  const a = k * 22.5;
  if (k % 4 === 0) continue; // the cardinal gates
  ringProps.push({ id: `pillar-${a}`, kind: 'pillar', at: pol(RING, a) });
}
for (const q of [0, 90, 180, 270]) {
  for (const o of [33.75, 56.25]) ringProps.push({ id: `torch-${q + o}`, kind: 'brazier', at: pol(RING, q + o) });
}
const gates: LayoutLandmark[] = [];
for (const q of [0, 90, 180, 270]) {
  for (const s of [-1, 1]) gates.push({ id: `gate-${q}${s < 0 ? 'l' : 'r'}`, kind: 'gate', at: pol(RING, (q + s * 9 + 360) % 360), variant: q === 0 ? 1 : 0 });
}

export const ETERNAL_ARENA: AreaLayout = defineLayout({
  areaId: 'eternalArena',
  version: 1,
  start: { at: START },
  landmarks: [
    ...ringProps,
    ...gates,
    // Champion statue pairs outside the north and south gates.
    { id: 'statue-n-l', kind: 'statue', at: pol(600, 352), variant: 1 },
    { id: 'statue-n-r', kind: 'statue', at: pol(600, 8), variant: 1 },
    { id: 'statue-s-l', kind: 'statue', at: pol(600, 188), variant: 0 },
    { id: 'statue-s-r', kind: 'statue', at: pol(600, 172), variant: 0 },
    // Trophy obelisks and weapon racks on the outer ground.
    ...[60, 120, 240, 300].map((a) => ({ id: `obelisk-${a}`, kind: 'obelisk' as const, at: pol(590, a), variant: (a / 60) % 2 })),
    ...[78, 102, 258, 282].map((a) => ({ id: `rack-${a}`, kind: 'weaponRack' as const, at: pol(610, a), variant: a > 180 ? 1 : 0 })),
  ],
  clusters: [
    // The Champion's Ring chain circle at the centre: eight chain posts, the cover of the middle.
    { id: 'chain-circle', pattern: 'ring', at: [0, 0], params: { r: 70, count: 8, rot: 0 }, prop: 'chainPost' },
  ],
  walls: [],
  decals: [
    { id: 'sand-ring', kind: 'glyph', at: [0, 0], r: 392 },
    { id: 'sand-ring-mid', kind: 'glyph', at: [0, 0], r: 255 },
    { id: 'sand-ring-core', kind: 'glyph', at: [0, 0], r: 112 },
    { id: 'gate-n', kind: 'road', path: [pol(470, 0), pol(650, 0)], width: 130 },
    { id: 'gate-e', kind: 'road', path: [pol(470, 90), pol(650, 90)], width: 130 },
    { id: 'gate-s', kind: 'road', path: [pol(470, 180), pol(650, 180)], width: 130 },
    { id: 'gate-w', kind: 'road', path: [pol(470, 270), pol(650, 270)], width: 130 },
    { id: 'torch-n', kind: 'light', at: pol(520, 0), r: 190 },
    { id: 'torch-s', kind: 'light', at: pol(520, 180), r: 160 },
  ],
  lanes: [
    { id: 'gate-n', path: [pol(600, 0), pol(330, 0)], width: 150, weight: 1.2, wave: [1, 3], favours: ['melee'] },
    { id: 'gate-e', path: [pol(600, 90), pol(250, 90)], width: 150, weight: 1.6, favours: ['fast'] },
    { id: 'gate-w', path: [pol(600, 270), pol(250, 270)], width: 150, weight: 1.6, favours: ['fast'] },
    { id: 'gate-s', path: [pol(600, 180), pol(420, 180)], width: 150, weight: 1, wave: [2, 9], favours: ['ranged'] },
  ],
  zones: [
    { id: 'sand', shape: 'disc', at: [0, 0], r: 400, weight: 3 },
    ...[45, 135, 225, 315].map((a) => ({ id: `rim-${a}`, shape: 'disc' as const, at: pol(580, a), r: 90, weight: 1, wave: [2, 9] as [number, number] })),
  ],
  bossStage: { at: pol(393, 0), r: 140, arrive: 'gate', facing: 180 },
  anchors: [
    // Perches: outside the ring or past the chain circle, each on a straight line to the landing that crosses a cover prop.
    { id: 'perch-ne', fits: 'perch', at: behind(post(45).x, post(45).y, 600) },
    { id: 'perch-nw', fits: 'perch', at: behind(post(315).x, post(315).y, 600) },
    { id: 'perch-e', fits: 'perch', at: behind(post(90).x, post(90).y, 560) },
    { id: 'perch-w', fits: 'perch', at: behind(post(270).x, post(270).y, 560) },
    { id: 'perch-se', fits: 'perch', at: behind(xyOf(RING, 135).x, xyOf(RING, 135).y, 590) },
    { id: 'perch-sw', fits: 'perch', at: behind(xyOf(RING, 225).x, xyOf(RING, 225).y, 590) },
    { id: 'ring-1', fits: 'ring', at: [0, 0] },
    { id: 'ring-2', fits: 'ring', at: [0, -200 / R] },
    { id: 'echo-1', fits: 'echo', at: [-250 / R, -100 / R] },
    { id: 'echo-2', fits: 'echo', at: [250 / R, -100 / R] },
    { id: 'road-ns', fits: 'road', at: [25 / R, 0], path: [[25 / R, 540 / R], [25 / R, -540 / R]] },
    { id: 'fault-e', fits: 'fault', at: [300 / R, -25 / R], path: [[300 / R, -160 / R], [300 / R, 110 / R]] },
    { id: 'relay-1', fits: 'relay', at: pol(330, 40) },
    { id: 'relay-2', fits: 'relay', at: pol(330, 160) },
    { id: 'relay-3', fits: 'relay', at: pol(330, 280) },
    { id: 'altar-1', fits: 'altar', at: [-250 / R, 200 / R] },
    { id: 'orchard-1', fits: 'orchard', at: [250 / R, 200 / R] },
    { id: 'host-1', fits: 'host', at: [-200 / R, -250 / R] },
    { id: 'anvil-1', fits: 'anvil', at: [200 / R, -250 / R] },
    { id: 'bell-1', fits: 'bell', at: [330 / R, 100 / R] },
  ],
  light: {
    ambient: 0.16,
    pools: [
      { at: pol(520, 0), r: 210, colour: '#ffb060', flicker: 0.3 },
      { at: pol(520, 180), r: 180, colour: '#ffb060', flicker: 0.3 },
      { at: pol(520, 90), r: 150, colour: '#ffa850', flicker: 0.3 },
      { at: pol(520, 270), r: 150, colour: '#ffa850', flicker: 0.3 },
      { at: [0, 0], r: 150, colour: '#ffd890', flicker: 0.1 },
    ],
  },
  rareSpots: [
    { at: pol(580, 45), r: 80, weight: 1 },
    { at: pol(580, 315), r: 80, weight: 1 },
  ],
  scatter: { density: 4, kinds: ['rubble', 'bones'], solid: false },
});
