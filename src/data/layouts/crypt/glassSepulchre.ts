// Glass Sepulchre (T5, R 723), handle "Nave" (D-territory.md 10.7 no. 16).
// Reads as: the church plan. A nave runs W to E from a walled west apse (the landing) to the east choir (the boss, `rim`);
// five sarcophagi flank each side of it (cover), a cross-transept runs N and S from the central crossing (the lanes meet
// here, the Bell hub stands on it) and window light pools lie along the aisles. Weak spot (accepted): the crossing is
// where everything meets, so packs, perches and the bell all converge on it.
import { defineLayout, type AreaLayout } from '../schema';
import { frame, VIOLET, WINDOW, perch } from '../ossuaryCryptKit';

const R = 722.5;
const f = frame(R);
const START = { x: -410, y: 0 };
const NAVE_Y = 200; // nave side walls
const ROW_Y = 120; // sarcophagus rows
const ARM_X = 135; // transept half width (wall centre line)
const ARM_END = 430;

// Perches stand in the transept arms; each line back to the landing passes a sarcophagus of the west block.
const P = [
  { id: 'sw-arm', at: { x: 92, y: 300 } },
  { id: 'nw-arm', at: { x: 92, y: -300 } },
  { id: 'crossing-s', at: { x: 84, y: 216 } },
  { id: 'crossing-n', at: { x: 84, y: -216 } },
];

export const GLASS_SEPULCHRE: AreaLayout = defineLayout({
  areaId: 'glassSepulchre',
  version: 1,
  start: { at: f.pp(START), clear: 140 },
  landmarks: [
    { id: 'bell-plinth', kind: 'plinth', at: f.p(0, 0), r: 40 },
  ],
  clusters: [
    // Five sarcophagi either side of the nave: three west of the crossing, two east.
    { id: 'tombs-nw', pattern: 'line', at: f.p(-280, -ROW_Y), params: { length: 150, bearing: 90, count: 3 }, prop: 'sarcophagus', variant: 0 },
    { id: 'tombs-sw', pattern: 'line', at: f.p(-280, ROW_Y), params: { length: 150, bearing: 90, count: 3 }, prop: 'sarcophagus', variant: 1 },
    { id: 'tombs-ne', pattern: 'line', at: f.p(160, -ROW_Y), params: { length: 75, bearing: 90, count: 2 }, prop: 'sarcophagus', variant: 1 },
    { id: 'tombs-se', pattern: 'line', at: f.p(160, ROW_Y), params: { length: 75, bearing: 90, count: 2 }, prop: 'sarcophagus', variant: 0 },
    // Transept stalls, three along each wall of each arm.
    { id: 'stalls-n-w', pattern: 'line', at: f.p(-100, -340), params: { length: 80, bearing: 0, count: 3 }, prop: 'choirStall', variant: 0 },
    { id: 'stalls-n-e', pattern: 'line', at: f.p(100, -340), params: { length: 80, bearing: 0, count: 3 }, prop: 'choirStall', variant: 1 },
    { id: 'stalls-s-w', pattern: 'line', at: f.p(-100, 340), params: { length: 80, bearing: 180, count: 3 }, prop: 'choirStall', variant: 1 },
    { id: 'stalls-s-e', pattern: 'line', at: f.p(100, 340), params: { length: 80, bearing: 180, count: 3 }, prop: 'choirStall', variant: 0 },
    // The east choir: two stall rows facing the boss's stage.
    { id: 'choir-n', pattern: 'line', at: f.p(420, -240), params: { length: 170, bearing: 90, count: 4 }, prop: 'choirStall', variant: 0 },
    { id: 'choir-s', pattern: 'line', at: f.p(420, 240), params: { length: 170, bearing: 90, count: 4 }, prop: 'choirStall', variant: 1 },
    { id: 'apse-bones', pattern: 'scatter', at: f.p(-500, 0), params: { r: 60, count: 5 }, prop: 'bones' },
  ],
  walls: [
    // The west apse: a half-round wall closing the nave.
    { id: 'apse', path: f.arc(200, 360, 180, 12, { x: -380, y: 0 }), thickness: 24 },
    // Nave side walls, open at the crossing and at the east choir.
    { id: 'nave-n-w', path: [f.p(-380, -NAVE_Y), f.p(-ARM_X, -NAVE_Y)] },
    { id: 'nave-s-w', path: [f.p(-380, NAVE_Y), f.p(-ARM_X, NAVE_Y)] },
    { id: 'nave-n-e', path: [f.p(ARM_X, -NAVE_Y), f.p(330, -NAVE_Y)] },
    { id: 'nave-s-e', path: [f.p(ARM_X, NAVE_Y), f.p(330, NAVE_Y)] },
    // Transept arms: side walls and a closed end each.
    { id: 'arm-n-w', path: [f.p(-ARM_X, -NAVE_Y), f.p(-ARM_X, -ARM_END)] },
    { id: 'arm-n-e', path: [f.p(ARM_X, -NAVE_Y), f.p(ARM_X, -ARM_END)] },
    { id: 'arm-n-end', path: [f.p(-ARM_X, -ARM_END), f.p(ARM_X, -ARM_END)] },
    { id: 'arm-s-w', path: [f.p(-ARM_X, NAVE_Y), f.p(-ARM_X, ARM_END)] },
    { id: 'arm-s-e', path: [f.p(ARM_X, NAVE_Y), f.p(ARM_X, ARM_END)] },
    { id: 'arm-s-end', path: [f.p(-ARM_X, ARM_END), f.p(ARM_X, ARM_END)] },
  ],
  decals: [
    { id: 'nave-road', kind: 'road', path: [f.p(-540, 0), f.p(0, 0), f.p(540, 0)], width: 100 },
    { id: 'transept-road', kind: 'road', path: [f.p(0, -400), f.p(0, 400)], width: 100 },
    { id: 'crossing-glyph', kind: 'glyph', at: f.p(0, 0), r: 100 },
    { id: 'choir-glyph', kind: 'glyph', at: f.p(560, 0), r: 140 },
    { id: 'apse-glyph', kind: 'glyph', at: f.p(-420, 0), r: 120 },
    // Window light falling across the aisles.
    { id: 'window-w-n', kind: 'light', at: f.p(-250, -165), r: 90 },
    { id: 'window-w-s', kind: 'light', at: f.p(-250, 165), r: 90 },
    { id: 'window-e-n', kind: 'light', at: f.p(230, -165), r: 90 },
    { id: 'window-e-s', kind: 'light', at: f.p(230, 165), r: 90 },
    { id: 'window-arm-n', kind: 'light', at: f.p(0, -300), r: 100 },
    { id: 'window-arm-s', kind: 'light', at: f.p(0, 300), r: 100 },
  ],
  lanes: [
    { id: 'nave', path: [f.p(-330, 0), f.p(0, 0), f.p(330, 0)], width: 150, weight: 3, favours: ['melee'] },
    { id: 'transept-n', path: [f.p(0, -60), f.p(0, -380)], width: 130, weight: 1.8, favours: ['ranged'] },
    { id: 'transept-s', path: [f.p(0, 60), f.p(0, 380)], width: 130, weight: 1.8, favours: ['ranged'] },
    { id: 'choir', path: [f.p(380, -140), f.p(520, -140), f.p(520, 140), f.p(380, 140)], width: 120, weight: 1, wave: [2, 9] },
    { id: 'aisle-n', path: [f.p(-250, -164), f.p(-60, -164)], width: 50, weight: 0.4, favours: ['fast'] },
    { id: 'aisle-s', path: [f.p(-250, 164), f.p(-60, 164)], width: 50, weight: 0.4, favours: ['fast'] },
  ],
  zones: [
    { id: 'crossing', shape: 'disc', at: f.p(0, 0), r: 120, weight: 1, wave: [3, 9] },
    { id: 'arm-n', shape: 'disc', at: f.p(0, -330), r: 90, weight: 0.8 },
    { id: 'arm-s', shape: 'disc', at: f.p(0, 330), r: 90, weight: 0.8 },
    { id: 'nave-east', shape: 'disc', at: f.p(250, 0), r: 110, weight: 1 },
    { id: 'choir-n', shape: 'disc', at: f.p(520, -150), r: 90, weight: 0.8, wave: [2, 9] },
    { id: 'choir-s', shape: 'disc', at: f.p(520, 150), r: 90, weight: 0.8, wave: [2, 9] },
  ],
  bossStage: { at: f.p(560, 0), r: 150, arrive: 'rim', facing: 270 },
  anchors: [
    ...P.map((p) => perch(f, `perch-${p.id}`, p.at)),
    { id: 'echo-n', fits: 'echo', at: f.p(0, -385) },
    { id: 'echo-s', fits: 'echo', at: f.p(0, 385) },
    { id: 'host-n', fits: 'host', at: f.p(-5, -250), r: 80 },
    { id: 'host-s', fits: 'host', at: f.p(-5, 250), r: 80 },
    { id: 'bell-crossing', fits: 'bell', at: f.p(0, 0) },
    { id: 'bell-choir', fits: 'bell', at: f.p(400, 0) },
    { id: 'road-nave', fits: 'road', at: f.p(0, 0), path: [f.p(-540, 0), f.p(-270, 0), f.p(0, 0), f.p(270, 0), f.p(540, 0)] },
    { id: 'fault-choir', fits: 'fault', at: f.p(400, -260), path: [f.p(400, -400), f.p(400, -120)] },
    { id: 'relay-n', fits: 'relay', at: f.p(0, -335) },
    { id: 'relay-s', fits: 'relay', at: f.p(0, 335) },
    { id: 'relay-e', fits: 'relay', at: f.p(230, 0) },
    { id: 'altar-1', fits: 'altar', at: f.p(150, 55) },
    { id: 'orchard-1', fits: 'orchard', at: f.p(-80, -55) },
    { id: 'ring-1', fits: 'ring', at: f.p(-210, 50) },
    { id: 'anvil-1', fits: 'anvil', at: f.p(-210, -50) },
  ],
  rareSpots: [
    { at: f.p(0, -330), r: 70, weight: 2 },
    { at: f.p(0, 330), r: 70, weight: 1 },
  ],
  light: {
    ambient: 0.1,
    pools: [
      { at: f.p(-250, -165), r: 100, colour: WINDOW, flicker: 0.05 },
      { at: f.p(-250, 165), r: 100, colour: WINDOW, flicker: 0.05 },
      { at: f.p(230, -165), r: 100, colour: WINDOW, flicker: 0.05 },
      { at: f.p(230, 165), r: 100, colour: WINDOW, flicker: 0.05 },
      { at: f.p(0, 0), r: 170, colour: VIOLET, flicker: 0.1 },
      { at: f.p(560, 0), r: 220, colour: VIOLET, flicker: 0.12 },
      { at: f.p(-420, 0), r: 170, colour: VIOLET, flicker: 0.08 },
    ],
  },
  scatter: { density: 4, kinds: ['bones', 'rubble', 'bones'], solid: false },
});
