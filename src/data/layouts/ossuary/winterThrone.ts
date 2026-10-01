// Winter Throne (T9, R 990), handle "Throne" (D-territory.md 10.7 no. 12).
// Reads as: the white disc. A raised ice dais (a low wall ring at r 218 with eight ice columns flanking four 100 u stair
// openings N/E/S/W) sits in a frozen lake (r 400, cosmetic); bone arcs mark r 0.7. The boss stands at the dais's north
// opening and arrives in a shimmer. The Host plaza is native on the lake. Weak spot (accepted): eight columns make cover
// plentiful at the centre and there is none at the rim; four lone frost sentinels give the Stalker cover near the landing.
// Deviation: the stage sits just outside the north opening (350 u out) so the 400 u phase-attack disc is free of the columns.
import { defineLayout, type AreaLayout } from '../schema';
import { cover, frame, FROST, FROST_DEEP, perch, polar } from '../ossuaryCryptKit';

const R = 990;
const f = frame(R);
const DAIS_R = 218;
const START = polar(500, 180); // the south stair, outside the dais
// Each opening is 100 u clear between the two flanking columns (+-16 degrees at r 218 = 120 u apart centre to centre).
const FLANK = 16;
const PERCHES = [
  { id: 'ne', at: polar(640, 52), d: 240 },
  { id: 'nw', at: polar(640, 308), d: 240 },
  { id: 'e', at: polar(700, 110), d: 270 },
  { id: 'w', at: polar(700, 250), d: 270 },
];
const covers = PERCHES.map((p) => cover(f, `sentinel-${p.id}`, START, p.at, p.d, { kind: 'iceColumn', radius: 10, ring: 0 }));

export const WINTER_THRONE: AreaLayout = defineLayout({
  areaId: 'winterThrone',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    { id: 'lake', kind: 'lake', at: f.p(0, 0), r: 400 },
  ],
  clusters: [
    // Eight columns: a pair flanking each stair opening (clusters, not landmarks, so the lake may lie under them).
    ...[0, 90, 180, 270].map((a) => ({
      id: `cols-${a}`, pattern: 'arc' as const, at: f.p(0, 0), params: { r: DAIS_R, count: 2, a0: a - FLANK, a1: a + FLANK }, prop: 'iceColumn' as const, variant: a / 90,
    })),
    ...covers.map((c) => ({ id: `${c.landmark.id}`, pattern: 'ring' as const, at: c.landmark.at, params: { r: 0, count: 1 }, prop: 'iceColumn' as const, variant: 1 })),
    // Bone arcs at r 0.7 (walk-through litter, tallest ribs at the arc ends).
    { id: 'bone-arc-w', pattern: 'arc', at: f.p(0, 0), params: { r: 693, count: 14, a0: 215, a1: 325 }, prop: 'bones' },
    { id: 'bone-arc-e', pattern: 'arc', at: f.p(0, 0), params: { r: 693, count: 14, a0: 35, a1: 145 }, prop: 'bones' },
    { id: 'rib-w', pattern: 'arc', at: f.p(0, 0), params: { r: 693, count: 3, a0: 245, a1: 295 }, prop: 'ribArch', variant: 1 },
    { id: 'rib-e', pattern: 'arc', at: f.p(0, 0), params: { r: 693, count: 3, a0: 65, a1: 115 }, prop: 'ribArch', variant: 0 },
    { id: 'rim-frost-n', pattern: 'scatter', at: f.pol(790, 0), params: { r: 100, count: 5 }, prop: 'crystal' },
  ],
  walls: [
    // The low dais wall: four arcs between the stair openings.
    ...[0, 90, 180, 270].map((a) => ({
      id: `dais-${a}`, path: f.arc(DAIS_R, a + FLANK + 3, a + 90 - FLANK - 3, 10), thickness: 18,
    })),
  ],
  decals: [
    { id: 'dais-glyph', kind: 'glyph', at: f.p(0, 0), r: 190 },
    { id: 'throne-pool', kind: 'pool', at: f.p(0, 0), r: 110 },
    { id: 'stair-n', kind: 'road', path: [f.pol(DAIS_R + 10, 0), f.pol(330, 0)], width: 100 },
    { id: 'stair-e', kind: 'road', path: [f.pol(DAIS_R + 10, 90), f.pol(330, 90)], width: 100 },
    { id: 'stair-s', kind: 'road', path: [f.pol(DAIS_R + 10, 180), f.pol(330, 180)], width: 100 },
    { id: 'stair-w', kind: 'road', path: [f.pol(DAIS_R + 10, 270), f.pol(330, 270)], width: 100 },
    { id: 'frost-ne', kind: 'pool', at: f.pol(800, 40), r: 80 },
    { id: 'frost-sw', kind: 'pool', at: f.pol(780, 235), r: 90 },
  ],
  lanes: [
    { id: 'ring', path: [...f.arc(520, 0, 360, 24)], width: 160, weight: 2.5, favours: ['fast'] },
    { id: 'north-stair', path: [f.pol(300, 0), f.pol(560, 0)], width: 130, weight: 1, wave: [3, 9], favours: ['melee'] },
    { id: 'east-road', path: [f.pol(300, 90), f.pol(640, 90)], width: 130, weight: 1, favours: ['ranged'] },
    { id: 'west-road', path: [f.pol(300, 270), f.pol(640, 270)], width: 130, weight: 1, favours: ['ranged'] },
  ],
  zones: [
    { id: 'lake-w', shape: 'disc', at: f.pol(300, 270), r: 150, weight: 1 },
    { id: 'lake-e', shape: 'disc', at: f.pol(300, 90), r: 150, weight: 1 },
    { id: 'rim-nw', shape: 'disc', at: f.pol(650, 315), r: 190, weight: 1.2 },
    { id: 'rim-ne', shape: 'disc', at: f.pol(650, 45), r: 190, weight: 1.2 },
    { id: 'rim-e', shape: 'disc', at: f.pol(700, 105), r: 170, weight: 0.8, wave: [2, 9] },
    { id: 'rim-w', shape: 'disc', at: f.pol(700, 255), r: 170, weight: 0.8, wave: [2, 9] },
    { id: 'dais-inner', shape: 'disc', at: f.p(0, 0), r: 150, weight: 0.8, wave: [4, 9] },
  ],
  bossStage: { at: f.pol(350, 0), r: 150, arrive: 'shimmer', facing: 180 },
  anchors: [
    ...PERCHES.map((p) => perch(f, `perch-${p.id}`, p.at)),
    { id: 'echo-e', fits: 'echo', at: f.pol(420, 70) },
    { id: 'echo-w', fits: 'echo', at: f.pol(420, 290) },
    { id: 'host-lake-e', fits: 'host', at: f.pol(330, 120), r: 90 },
    { id: 'host-lake-w', fits: 'host', at: f.pol(330, 240), r: 90 },
    { id: 'host-dais', fits: 'host', at: f.p(0, 0), r: 90 },
    { id: 'bell-1', fits: 'bell', at: f.pol(300, 150) },
    { id: 'bell-2', fits: 'bell', at: f.pol(300, 210) },
    { id: 'road-ring', fits: 'road', at: f.pol(560, 270), path: [150, 170, 190, 210, 230, 250, 270, 290, 310].map((a) => f.pol(560, a)) },
    { id: 'fault-ne', fits: 'fault', at: f.pol(640, 80), path: [f.pol(600, 70), f.pol(720, 95)] },
    { id: 'relay-1', fits: 'relay', at: f.pol(600, 30) },
    { id: 'relay-2', fits: 'relay', at: f.pol(600, 150) },
    { id: 'relay-3', fits: 'relay', at: f.pol(600, 270) },
    { id: 'altar-1', fits: 'altar', at: f.p(0, 0) },
    { id: 'orchard-1', fits: 'orchard', at: f.pol(780, 330) },
    { id: 'ring-1', fits: 'ring', at: f.pol(350, 320) },
    { id: 'anvil-1', fits: 'anvil', at: f.pol(330, 40) },
  ],
  rareSpots: [
    { at: f.pol(700, 315), r: 100, weight: 2 },
    { at: f.pol(700, 45), r: 100, weight: 1 },
  ],
  light: {
    ambient: 0.12,
    pools: [
      { at: f.p(0, 0), r: 260, colour: FROST, flicker: 0.05 },
      { at: f.pol(350, 0), r: 180, colour: FROST_DEEP, flicker: 0.1 },
      { at: f.pol(800, 40), r: 120, colour: FROST, flicker: 0.1 },
      { at: f.pol(780, 235), r: 130, colour: FROST_DEEP, flicker: 0.1 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'rubble', 'bones'], solid: false },
});
