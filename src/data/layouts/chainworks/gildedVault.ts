// Gilded Vault (sealed, T9 ceiling, R 700), handle "Counting House": D-territory.md 10.7 no. 21.
//
// A straight, fixed caravan road runs from the landing at the south to the vault door at the north between two rows of cash
// cages (crates). Two counting rooms (W/E, a door each, gold stacks inside) open onto the yard beside the aisle. At the
// north the vault door is a pair of gates over a stair; the wagon escapes through it and the boss waits in front of it
// (arrive: 'gate'). Always the same: the script is the point (triple currency).
//
// Reads as: the gold road. Weak spot: one script, same every run.
//
// Deviation from the spec: the counting rooms hold a gold-marked crate stack and gold obelisks, not a `chest` prop (a real
// `chest` prop is the clear reward and opens on touch, so it must not be fixed decor).
import { defineLayout, type AreaLayout, type P } from '../schema';

const R = 700;
const u = (x: number, y: number): P => [x / R, y / R];
/** A counting room: a closed crate-wall rectangle with its door (110 u) in the wall facing the aisle. */
const room = (id: string, x0: number, x1: number, door: 'east' | 'west'): AreaLayout['walls'][number] => {
  const y0 = -130;
  const y1 = 130;
  // Path starts on the aisle side so the door sits in its first segment (centre of a 260 u side of a 920 u perimeter).
  const path = door === 'east'
    ? [u(x1, y0), u(x1, y1), u(x0, y1), u(x0, y0), u(x1, y0)]
    : [u(x0, y0), u(x0, y1), u(x1, y1), u(x1, y0), u(x0, y0)];
  return { id, path, thickness: 24, prop: 'crate', cover: 'tall' as const, gaps: [{ at: 130 / 1040, width: 110 }] };
};

export const GILDED_VAULT: AreaLayout = defineLayout({
  areaId: 'gildedVault',
  version: 1,
  start: { at: u(0, 540) },
  landmarks: [
    // The vault door: a pair of gates over the stair, hoists beside it.
    { id: 'door-w', kind: 'gate', at: u(-70, -570), variant: 0 },
    { id: 'door-e', kind: 'gate', at: u(70, -570), variant: 0 },
    { id: 'stair', kind: 'stair', at: u(0, -610), r: 50 },
    { id: 'hoist-w', kind: 'hoist', at: u(-300, -430), variant: 1 },
    { id: 'hoist-e', kind: 'hoist', at: u(300, -430), variant: 1 },
    // Gold marks the south end of the cash-cage rows.
    { id: 'gold-w', kind: 'obelisk', at: u(-112, 378), variant: 1 },
    { id: 'gold-e', kind: 'obelisk', at: u(112, 378), variant: 1 },
    // Inside the counting rooms: gold trophy obelisks and stacked cash cages.
    { id: 'trophy-w1', kind: 'obelisk', at: u(-470, -100), variant: 1 },
    { id: 'trophy-w2', kind: 'obelisk', at: u(-470, 100), variant: 1 },
    { id: 'trophy-e1', kind: 'obelisk', at: u(470, -100), variant: 1 },
    { id: 'trophy-e2', kind: 'obelisk', at: u(470, 100), variant: 1 },
  ],
  clusters: [
    { id: 'cash-w', pattern: 'line', at: u(-440, -60), params: { length: 120, bearing: 180, count: 3 }, prop: 'crate', cover: 'tall', variant: 1 },
    { id: 'cash-e', pattern: 'line', at: u(440, -60), params: { length: 120, bearing: 180, count: 3 }, prop: 'crate', cover: 'tall', variant: 1 },
    { id: 'landing-braziers', pattern: 'arc', at: u(0, 540), params: { r: 190, count: 4, a0: 300, a1: 60 }, prop: 'brazier' },
    { id: 'door-braziers', pattern: 'line', at: u(-150, -612), params: { length: 300, bearing: 90, count: 4 }, prop: 'brazier' },
  ],
  walls: [
    // Two rows of cash cages (stacked crates) either side of the aisle, 200 u apart.
    { id: 'cages-w', path: [u(-112, 360), u(-112, -140)], thickness: 24, prop: 'crate', cover: 'tall' },
    { id: 'cages-e', path: [u(112, 360), u(112, -140)], thickness: 24, prop: 'crate', cover: 'tall' },
    room('room-w', -490, -290, 'east'),
    room('room-e', 290, 490, 'west'),
  ],
  decals: [
    { id: 'gold-road', kind: 'road', path: [u(0, 600), u(0, -540)], width: 120 },
    { id: 'door-apron', kind: 'road', path: [u(-90, -540), u(90, -540)], width: 80 },
    { id: 'hazard-w', kind: 'road', path: [u(-112, 345), u(-112, -125)], width: 10 },
    { id: 'hazard-e', kind: 'road', path: [u(112, 345), u(112, -125)], width: 10 },
    { id: 'lamp-door', kind: 'light', at: u(0, -540), r: 200 },
    { id: 'lamp-w', kind: 'light', at: u(-390, 0), r: 130 },
    { id: 'lamp-e', kind: 'light', at: u(390, 0), r: 130 },
  ],
  lanes: [
    { id: 'aisle', path: [u(0, 330), u(0, -150)], width: 150, weight: 3, favours: ['melee', 'fast'] },
    { id: 'vestibule', path: [u(-200, -300), u(200, -300)], width: 120, weight: 1.6, favours: ['ranged'], wave: [2, 9] },
  ],
  zones: [
    { id: 'room-w', shape: 'disc', at: u(-390, 0), r: 90, weight: 0.9 },
    { id: 'room-e', shape: 'disc', at: u(390, 0), r: 90, weight: 0.9 },
    { id: 'yard-nw', shape: 'disc', at: u(-260, -200), r: 110, weight: 1.2 },
    { id: 'yard-ne', shape: 'disc', at: u(260, -200), r: 110, weight: 1.2 },
    { id: 'yard-sw', shape: 'disc', at: u(-300, 330), r: 110, weight: 1, wave: [2, 9] },
    { id: 'yard-se', shape: 'disc', at: u(300, 330), r: 110, weight: 1, wave: [2, 9] },
  ],
  bossStage: { at: u(0, -462), r: 150, arrive: 'gate', facing: 180 },
  anchors: [
    { id: 'perch-nw', fits: 'perch', at: u(-260, -200) },
    { id: 'perch-ne', fits: 'perch', at: u(260, -200) },
    { id: 'perch-w', fits: 'perch', at: u(-250, 20) },
    { id: 'perch-e', fits: 'perch', at: u(250, 20) },
    { id: 'road-a', fits: 'road', at: u(-45, 0), path: [u(-45, 525), u(-45, -525)] },
    { id: 'road-b', fits: 'road', at: u(45, 0), path: [u(45, 525), u(45, -525)] },
    { id: 'altar-w', fits: 'altar', at: u(-390, 40) },
    { id: 'altar-e', fits: 'altar', at: u(390, 40) },
    { id: 'echo-1', fits: 'echo', at: u(-250, -330) },
    { id: 'echo-2', fits: 'echo', at: u(250, -330) },
    { id: 'fault-n', fits: 'fault', at: u(0, -250), path: [u(-150, -250), u(150, -250)] },
    { id: 'relay-1', fits: 'relay', at: u(-260, -300) },
    { id: 'relay-2', fits: 'relay', at: u(260, -300) },
    { id: 'relay-3', fits: 'relay', at: u(-330, 300) },
    { id: 'ring-1', fits: 'ring', at: u(0, -200) },
    { id: 'orchard-1', fits: 'orchard', at: u(350, 300) },
    { id: 'host-1', fits: 'host', at: u(-330, 220) },
    { id: 'anvil-1', fits: 'anvil', at: u(330, 220) },
    { id: 'bell-1', fits: 'bell', at: u(0, -330) },
  ],
  light: {
    ambient: 0.12,
    pools: [
      { at: u(0, -540), r: 210, colour: '#ffd070', flicker: 0.2 },
      { at: u(-390, 0), r: 140, colour: '#ffc860', flicker: 0.15 },
      { at: u(390, 0), r: 140, colour: '#ffc860', flicker: 0.15 },
      { at: u(0, 540), r: 190, colour: '#ffb050', flicker: 0.3 },
    ],
  },
  scatter: { density: 4, kinds: ['rubble', 'bones'], solid: false },
});
