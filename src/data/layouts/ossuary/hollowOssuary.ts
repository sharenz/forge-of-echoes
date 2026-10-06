// Hollow Ossuary (dead end, T5 ceiling, R 765), handle "Spiral" (D-territory.md 10.7 no. 15).
// Reads as: the snail. One bone wall spirals from the outer ring (r 540) in to the ossuary heart (r 232) over two turns, so
// the corridor between its turns is 130 u wide; packs stream along it (a single lane, weight 3) and the boss waits at the
// core (`rim`, through the spiral mouth). Crystals sit in the wall's niches. Weak spot (accepted): narrow, so ranged/AoE
// is rewarded and a lone melee build clears it fast; few event anchors (the quantity bonus compensates).
// Deviation: the 300 u landing disc cannot fit a 130 u corridor, so the landing is the open outer ring south of the mouth.
import { defineLayout, type AreaLayout } from '../schema';
import { frame, FROST, FROST_DEEP, perch, polar } from '../ossuaryCryptKit';

const R = 765;
const f = frame(R);
const START = polar(650, 180);
const OUT = 540; // wall radius at its outer end
const PITCH = 154; // radial distance between turns: 154 - 24 (wall) = 130 u of corridor
const A0 = 200; // bearing of the outer end (just clockwise of the landing)
const TURNS = 2;
const wallR = (theta: number): number => OUT - (PITCH * theta) / 360;
const spiral = (theta0: number, theta1: number, step: number, dr = 0) => {
  const out = [];
  for (let t = theta0; t <= theta1 + 1e-6; t += step) out.push(f.pol(wallR(t) + dr, A0 + t));
  return out;
};
// Corridor centre-line: half a pitch inside the wall turn that bounds it on the outside.
const corridor = (theta: number) => f.pol(wallR(theta) - PITCH / 2, A0 + theta);
const cpt = (theta: number) => polar(wallR(theta) - PITCH / 2, A0 + theta);

export const HOLLOW_OSSUARY: AreaLayout = defineLayout({
  areaId: 'hollowOssuary',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    { id: 'heart', kind: 'dais', at: f.p(0, 0), r: 90 },
    { id: 'mouth-n', kind: 'ribArch', at: f.pol(OUT, A0), r: 14, variant: 0 },
    { id: 'mouth-s', kind: 'ribArch', at: f.pol(wallR(360), A0), r: 14, variant: 1 },
  ],
  clusters: [
    // Crystals set into the wall (the niches), riding its line.
    { id: 'wall-crystals', pattern: 'spiral', at: f.p(0, 0), params: { r0: OUT - 12, r1: 244, turns: TURNS, a0: A0 + 8, count: 22 }, prop: 'crystal' },
    { id: 'heart-bones', pattern: 'ring', at: f.p(0, 0), params: { r: 120, count: 9, rot: 10 }, prop: 'bones' },
    { id: 'ring-bones', pattern: 'scatter', at: f.pol(610, 300), params: { r: 70, count: 7 }, prop: 'bones' },
    { id: 'ring-bones-e', pattern: 'scatter', at: f.pol(640, 70), params: { r: 100, count: 7 }, prop: 'bones' },
    { id: 'ring-ribs', pattern: 'arc', at: f.p(0, 0), params: { r: 655, count: 5, a0: 20, a1: 140 }, prop: 'ribArch' },
  ],
  walls: [
    { id: 'spiral', path: spiral(0, 360 * TURNS, 15), thickness: 24 },
  ],
  decals: [
    { id: 'core-glyph', kind: 'glyph', at: f.p(0, 0), r: 180 },
    { id: 'core-pool', kind: 'pool', at: f.p(0, 0), r: 70 },
    { id: 'spiral-road', kind: 'road', path: Array.from({ length: 29 }, (_, k) => corridor(k * 15)), width: 90 },
    { id: 'mouth-road', kind: 'road', path: [f.pp(START), f.pol(480, A0 - 10)], width: 110 },
    { id: 'frost-ring', kind: 'pool', at: f.pol(650, 80), r: 70 },
  ],
  lanes: [
    { id: 'spiral', path: Array.from({ length: 19 }, (_, k) => corridor(k * 20)), width: 126, weight: 3 },
    { id: 'outer-ring', path: f.arc(630, 215, 500, 15), width: 110, weight: 0.6, wave: [2, 9] },
  ],
  zones: [
    { id: 'core', shape: 'disc', at: f.p(0, 0), r: 140, weight: 1.2, wave: [3, 9] },
    { id: 'ring-w', shape: 'disc', at: f.pol(630, 285), r: 90, weight: 0.5 },
    { id: 'ring-n', shape: 'disc', at: f.pol(630, 15), r: 90, weight: 0.5 },
    { id: 'ring-e', shape: 'disc', at: f.pol(630, 90), r: 90, weight: 0.5 },
  ],
  bossStage: { at: f.p(0, 0), r: 150, arrive: 'rim', facing: A0 - 180 },
  anchors: [
    // Perches in the corridor: every ray back to the landing crosses the wall.
    ...[170, 210, 250, 290].map((t) => perch(f, `perch-${t}`, cpt(t))),
    { id: 'echo-1', fits: 'echo', at: f.pp(cpt(120)) },
    { id: 'echo-2', fits: 'echo', at: f.pp(cpt(330)) },
    { id: 'host-1', fits: 'host', at: f.p(-80, 0), r: 80 },
    { id: 'host-2', fits: 'host', at: f.pp(cpt(300)), r: 60 },
    { id: 'bell-1', fits: 'bell', at: f.p(80, 0) },
    // Bell and fault fields are wide (E1 check 10) and the 130 u corridor cannot hold them (bot runs in the spiral turn lost the
    // Fault's grade and died more at the bell): both sit in the open heart, like the radial rules put them.
    { id: 'bell-2', fits: 'bell', at: f.p(-60, 60) },
    { id: 'road-spiral', fits: 'road', at: f.pp(cpt(80)), path: Array.from({ length: 11 }, (_, k) => corridor(k * 15)) },
    { id: 'fault-n', fits: 'fault', at: f.p(0, 0), path: [f.p(-130, 0), f.p(130, 0)] },
    { id: 'relay-1', fits: 'relay', at: f.pol(630, 300) },
    { id: 'relay-2', fits: 'relay', at: f.pol(630, 60) },
    { id: 'relay-3', fits: 'relay', at: f.pol(630, 0) },
    // In the heart (E1): out on the ring past the rib arches the pact stones took too long to reach (bot pacts kept fell to 0).
    { id: 'altar-1', fits: 'altar', at: f.p(0, 0) },
    { id: 'orchard-1', fits: 'orchard', at: f.pol(630, 250) },
    { id: 'ring-1', fits: 'ring', at: f.p(0, 70) },
    { id: 'anvil-1', fits: 'anvil', at: f.p(0, -70) },
  ],
  rareSpots: [
    { at: corridorPt(100), r: 60, weight: 2 },
    { at: corridorPt(260), r: 60, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(0, 0), r: 230, colour: FROST, flicker: 0.1 },
      { at: f.pol(650, 80), r: 110, colour: FROST_DEEP, flicker: 0.1 },
      { at: f.pp(START), r: 170, colour: FROST_DEEP, flicker: 0.08 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'bones', 'rubble'], solid: false },
});

function corridorPt(theta: number) {
  return f.pp(cpt(theta));
}
