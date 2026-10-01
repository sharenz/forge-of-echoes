// Champion's Approach (T7, R 585), handle "Gatehouse": D-territory.md 10.7 no. 22.
//
// A south-north avenue between two banked pillar rows (the stands), cut by a portcullis (two gates leaving a 110 u gap) in the
// middle; behind it the north wall with its own gate and the boss waiting in the yard beyond (arrive: 'gate'). Flank
// galleries W/E run outside the stands and are closed at the north by the wall; one sally port in the west stand gives a
// way past the portcullis. The champion's ring sand circles are in the south half.
//
// Reads as: the gate. Weak spot: the choke is obvious; ranged classes shoot over it, melee fight in it (solid props block
// projectiles here, which is designed).
import { defineLayout, type AreaLayout, type P } from '../schema';

const R = 585;
const u = (x: number, y: number): P => [x / R, y / R];
const Y0 = 234; // south end of the stands
const Y1 = -250; // the north wall

export const CHAMPIONS_APPROACH: AreaLayout = defineLayout({
  areaId: 'championsApproach',
  version: 1,
  start: { at: u(0, 410) },
  landmarks: [
    // The portcullis: two gates 134 u apart (110 u between their faces); the stands seal the rest of the avenue.
    { id: 'portcullis-w', kind: 'gate', at: u(-67, -30), variant: 0 },
    { id: 'portcullis-e', kind: 'gate', at: u(67, -30), variant: 0 },
    // The north gate in the wall, bars raised.
    { id: 'gate-w', kind: 'gate', at: u(-70, Y1), variant: 1 },
    { id: 'gate-e', kind: 'gate', at: u(70, Y1), variant: 1 },
    // Champion statues cap the stands at the south mouth.
    { id: 'statue-w', kind: 'statue', at: u(-100, 252), variant: 0 },
    { id: 'statue-e', kind: 'statue', at: u(100, 252), variant: 1 },
    { id: 'rack-w', kind: 'weaponRack', at: u(-410, 70), variant: 0 },
    { id: 'rack-e', kind: 'weaponRack', at: u(410, 70), variant: 1 },
    { id: 'rack-nw', kind: 'weaponRack', at: u(-330, -170), variant: 1 },
    { id: 'rack-ne', kind: 'weaponRack', at: u(330, -170), variant: 0 },
  ],
  clusters: [
    // Torches and banners along the outer face of the stands.
    { id: 'stand-torches-w', pattern: 'line', at: u(-128, 190), params: { length: 380, bearing: 0, count: 5 }, prop: 'brazier' },
    { id: 'stand-torches-e', pattern: 'line', at: u(128, 190), params: { length: 380, bearing: 0, count: 5 }, prop: 'brazier' },
    { id: 'banners-w', pattern: 'line', at: u(-128, 160), params: { length: 380, bearing: 0, count: 6 }, prop: 'banner' },
    { id: 'banners-e', pattern: 'line', at: u(128, 160), params: { length: 380, bearing: 0, count: 6 }, prop: 'banner' },
    // Gallery cover: standing pillar groups for the flanks.
    { id: 'pillars-sw', pattern: 'arc', at: u(-250, 190), params: { r: 40, count: 3, a0: 200, a1: 340 }, prop: 'pillar' },
    { id: 'pillars-se', pattern: 'arc', at: u(250, 190), params: { r: 40, count: 3, a0: 20, a1: 160 }, prop: 'pillar' },
    { id: 'pillars-nw', pattern: 'arc', at: u(-250, -90), params: { r: 40, count: 3, a0: 20, a1: 160 }, prop: 'pillar' },
    { id: 'pillars-ne', pattern: 'arc', at: u(250, -90), params: { r: 40, count: 3, a0: 200, a1: 340 }, prop: 'pillar' },
    { id: 'north-torches-w', pattern: 'line', at: u(-420, -230), params: { length: 240, bearing: 90, count: 3 }, prop: 'brazier' },
    { id: 'north-torches-e', pattern: 'line', at: u(180, -230), params: { length: 240, bearing: 90, count: 3 }, prop: 'brazier' },
  ],
  walls: [
    // The stands: sealed pillar rows 200 u apart; the west stand has a sally port (100 u) into the north half of the avenue.
    { id: 'stand-w', path: [u(-100, Y0), u(-100, Y1)], thickness: 20, prop: 'pillar', gaps: [{ at: 0.79, width: 100 }] },
    { id: 'stand-e', path: [u(100, Y0), u(100, Y1)], thickness: 20, prop: 'pillar' },
    // The north wall closes the arena behind the avenue; its only opening is the gate (116 u).
    { id: 'north-wall', path: [u(-476, Y1), u(476, Y1)], thickness: 24, prop: 'ruinWall', gaps: [{ at: 0.5, width: 116 }] },
  ],
  decals: [
    { id: 'avenue', kind: 'road', path: [u(0, 330), u(0, -240)], width: 170 },
    { id: 'boss-way', kind: 'road', path: [u(0, -262), u(0, -430)], width: 120 },
    { id: 'sand-ring-w', kind: 'glyph', at: u(-230, 260), r: 75 },
    { id: 'sand-ring-e', kind: 'glyph', at: u(230, 260), r: 75 },
    { id: 'sand-ring-c', kind: 'glyph', at: u(0, -420), r: 130 },
    { id: 'torch-gate', kind: 'light', at: u(0, -250), r: 190 },
    { id: 'torch-portcullis', kind: 'light', at: u(0, -30), r: 150 },
  ],
  lanes: [
    { id: 'avenue-n', path: [u(0, -60), u(0, -225)], width: 120, weight: 3.6, favours: ['melee', 'fast'], wave: [2, 9] },
    { id: 'avenue-s', path: [u(0, 200), u(0, 20)], width: 120, weight: 1.2, favours: ['melee'], wave: [1, 3] },
  ],
  zones: [
    { id: 'gallery-w', shape: 'disc', at: u(-310, 60), r: 170, weight: 1.6 },
    { id: 'gallery-e', shape: 'disc', at: u(310, 60), r: 170, weight: 1.6 },
    { id: 'gallery-nw', shape: 'disc', at: u(-300, -150), r: 120, weight: 1, wave: [2, 9] },
    { id: 'gallery-ne', shape: 'disc', at: u(300, -150), r: 120, weight: 1, wave: [2, 9] },
    { id: 'boss-yard', shape: 'disc', at: u(0, -380), r: 100, weight: 0.8, wave: [4, 9] },
  ],
  bossStage: { at: u(0, -400), r: 130, arrive: 'gate', facing: 180 },
  anchors: [
    { id: 'perch-nw', fits: 'perch', at: u(-300, -140) },
    { id: 'perch-ne', fits: 'perch', at: u(300, -140) },
    { id: 'perch-w', fits: 'perch', at: u(-435, 80) },
    { id: 'perch-e', fits: 'perch', at: u(435, 80) },
    { id: 'ring-1', fits: 'ring', at: u(-230, 260) },
    { id: 'ring-2', fits: 'ring', at: u(230, 260) },
    { id: 'echo-1', fits: 'echo', at: u(-250, -100) },
    { id: 'echo-2', fits: 'echo', at: u(250, -100) },
    { id: 'road-avenue', fits: 'road', at: u(0, 0), path: [u(0, 440), u(0, -440)] },
    { id: 'fault-w', fits: 'fault', at: u(-330, 60), path: [u(-330, -80), u(-330, 200)] },
    { id: 'relay-1', fits: 'relay', at: u(-320, -120) },
    { id: 'relay-2', fits: 'relay', at: u(320, -120) },
    { id: 'relay-3', fits: 'relay', at: u(0, -140) },
    { id: 'altar-1', fits: 'altar', at: u(-380, 200) },
    { id: 'orchard-1', fits: 'orchard', at: u(380, 200) },
    { id: 'host-1', fits: 'host', at: u(-200, -330) },
    { id: 'anvil-1', fits: 'anvil', at: u(200, -330) },
    { id: 'bell-1', fits: 'bell', at: u(0, -330) },
  ],
  rareSpots: [
    { at: u(-300, 60), r: 80, weight: 2 },
    { at: u(300, 60), r: 80, weight: 2 },
  ],
  light: {
    ambient: 0.14,
    pools: [
      { at: u(0, -250), r: 200, colour: '#ffb060', flicker: 0.3 },
      { at: u(0, -30), r: 150, colour: '#ffb060', flicker: 0.25 },
      { at: u(0, 410), r: 180, colour: '#ffc070', flicker: 0.2 },
    ],
  },
  scatter: { density: 5, kinds: ['rubble', 'bones'], solid: false },
});
