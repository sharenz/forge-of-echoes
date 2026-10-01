// Bone Approach (T3, R 900), handle "Barrow" (D-territory.md 10.7 no. 11).
// Reads as: the ribs. A long barrow W to E: two rows of rib arches frame a 160 u avenue from the landing at the west mouth
// to the east mound, where the boss rises beside a great skull. Crystal clusters in the alcoves outside the ribs are the
// cover. Weak spot (accepted): a one-direction funnel; it is safe to run straight down the avenue (T3).
import { defineLayout, type AreaLayout } from '../schema';
import { cover, frame, FROST, FROST_DEEP, perch } from '../ossuaryCryptKit';

const R = 900;
const f = frame(R);
const START = { x: -640, y: 0 };
const RIB_Y = 92; // rib rows at y = +-92: 160 u between their facing edges

// Perch targets; the cover sits on the straight line from the landing, 140 to 380 u out.
const PERCHES = [
  { id: 'nw', at: { x: -150, y: -420 }, d: 285 },
  { id: 'sw', at: { x: -150, y: 420 }, d: 285 },
  { id: 'ne', at: { x: 330, y: -400 }, d: 330 },
  { id: 'se', at: { x: 330, y: 400 }, d: 330 },
];
const covers = PERCHES.map((p) => cover(f, `cover-${p.id}`, START, p.at, p.d, { kind: 'crystal', ring: 4, ringR: 30 }));

export const BONE_APPROACH: AreaLayout = defineLayout({
  areaId: 'boneApproach',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    // The mouth: a taller pair of ribs either side of the avenue.
    { id: 'mouth-n', kind: 'ribArch', at: f.p(-470, -118), r: 14, variant: 0 },
    { id: 'mouth-s', kind: 'ribArch', at: f.p(-470, 118), r: 14, variant: 1 },
    { id: 'skull', kind: 'skull', at: f.p(700, 0), r: 46 },
    { id: 'spire-n', kind: 'iceColumn', at: f.p(660, -230), variant: 0 },
    { id: 'spire-s', kind: 'iceColumn', at: f.p(660, 230), variant: 1 },
    ...covers.map((c) => c.landmark),
  ],
  clusters: [
    { id: 'ribs-n', pattern: 'line', at: f.p(-380, -RIB_Y), params: { length: 800, bearing: 90, count: 15 }, prop: 'ribArch', variant: 0 },
    { id: 'ribs-s', pattern: 'line', at: f.p(-380, RIB_Y), params: { length: 800, bearing: 90, count: 15 }, prop: 'ribArch', variant: 1 },
    // Crystal alcoves outside the ribs, between the arches.
    ...[-250, -40, 170, 360].flatMap((x, k) => [
      { id: `alcove-n${k}`, pattern: 'ring' as const, at: f.p(x, -205 - (k % 2) * 40), params: { r: 32, count: 5, rot: 15 * k }, prop: 'crystal' as const },
      { id: `alcove-s${k}`, pattern: 'ring' as const, at: f.p(x + 40, 205 + ((k + 1) % 2) * 40), params: { r: 32, count: 5, rot: 15 * k + 30 }, prop: 'crystal' as const },
    ]),
    ...covers.flatMap((c) => (c.cluster ? [c.cluster] : [])),
    // Bone litter round the skull on the mound (walk-through).
    { id: 'mound-bones', pattern: 'ring', at: f.p(700, 0), params: { r: 96, count: 10, rot: 8 }, prop: 'bones' },
    { id: 'mouth-bones', pattern: 'scatter', at: f.p(-600, 0), params: { r: 90, count: 7 }, prop: 'bones' },
  ],
  walls: [],
  decals: [
    { id: 'avenue', kind: 'road', path: [f.p(-560, 0), f.p(-200, 0), f.p(200, 0), f.p(560, 0)], width: 150 },
    { id: 'frost-n', kind: 'pool', at: f.p(-60, -330), r: 90 },
    { id: 'frost-s', kind: 'pool', at: f.p(260, 330), r: 80 },
    { id: 'frost-rim', kind: 'pool', at: f.p(540, -250), r: 60 },
    { id: 'mound-glyph', kind: 'glyph', at: f.p(700, 0), r: 130 },
    { id: 'mouth-light', kind: 'light', at: f.p(-470, 0), r: 170 },
  ],
  lanes: [
    { id: 'avenue', path: [f.p(-330, 0), f.p(0, 0), f.p(330, 0)], width: 150, weight: 3, favours: ['melee'] },
    { id: 'band-n', path: [f.p(-330, -340), f.p(40, -345), f.p(420, -330)], width: 150, weight: 1.5, favours: ['ranged'] },
    { id: 'band-s', path: [f.p(-330, 340), f.p(40, 345), f.p(420, 330)], width: 150, weight: 1.5, favours: ['fast'] },
    { id: 'mound', path: [f.p(480, -90), f.p(640, -90), f.p(640, 90), f.p(480, 90)], width: 150, weight: 1.2, wave: [3, 9] },
  ],
  zones: [
    { id: 'avenue-mid', shape: 'disc', at: f.p(80, 0), r: 220, weight: 1.5 },
    { id: 'north-field', shape: 'disc', at: f.p(-40, -335), r: 190, weight: 1 },
    { id: 'south-field', shape: 'disc', at: f.p(-40, 335), r: 190, weight: 1 },
    { id: 'east-field-n', shape: 'disc', at: f.p(430, -320), r: 150, weight: 0.8, wave: [2, 9] },
    { id: 'east-field-s', shape: 'disc', at: f.p(430, 320), r: 150, weight: 0.8, wave: [2, 9] },
  ],
  bossStage: { at: f.p(700, 0), r: 140, arrive: 'rim', facing: 270 },
  anchors: [
    ...PERCHES.map((p) => perch(f, `perch-${p.id}`, p.at)),
    { id: 'echo-n', fits: 'echo', at: f.p(-180, -520) },
    { id: 'echo-s', fits: 'echo', at: f.p(300, 440) },
    { id: 'echo-e', fits: 'echo', at: f.p(110, -440) },
    { id: 'host-n', fits: 'host', at: f.p(70, -340) },
    { id: 'host-s', fits: 'host', at: f.p(-90, 340) },
    { id: 'bell-1', fits: 'bell', at: f.p(0, 0) },
    { id: 'bell-2', fits: 'bell', at: f.p(400, 0) },
    { id: 'road-avenue', fits: 'road', at: f.p(0, 0), path: [f.p(-690, 0), f.p(-300, 0), f.p(100, 0), f.p(430, 0), f.p(660, 0)] },
    { id: 'fault-n', fits: 'fault', at: f.p(120, -380), path: [f.p(-20, -380), f.p(260, -380)] },
    { id: 'fault-s', fits: 'fault', at: f.p(-120, 400), path: [f.p(-260, 400), f.p(20, 400)] },
    { id: 'relay-1', fits: 'relay', at: f.p(-200, -400) },
    { id: 'relay-2', fits: 'relay', at: f.p(240, -480) },
    { id: 'relay-3', fits: 'relay', at: f.p(200, 400) },
    { id: 'altar-1', fits: 'altar', at: f.p(-340, 300) },
    { id: 'orchard-1', fits: 'orchard', at: f.p(-340, -300) },
    { id: 'ring-1', fits: 'ring', at: f.p(500, 250) },
    { id: 'anvil-1', fits: 'anvil', at: f.p(-230, 190) },
  ],
  rareSpots: [
    { at: f.p(420, -300), r: 90, weight: 2 },
    { at: f.p(-120, 380), r: 90, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(-470, 0), r: 200, colour: FROST, flicker: 0.1 },
      { at: f.p(700, 0), r: 230, colour: FROST_DEEP, flicker: 0.15 },
      { at: f.p(-60, -330), r: 130, colour: FROST, flicker: 0.1 },
      { at: f.p(260, 330), r: 120, colour: FROST_DEEP, flicker: 0.1 },
    ],
  },
  scatter: { density: 5, kinds: ['bones', 'bones', 'rubble'], solid: false },
});
