// Ember Skitter — tiny, fast, fragile. A cinder spider: six long legs splayed in a fan, every one rising to a knee
// high above the body and dropping to a pointed foot, a dark cinder thorax and a small crusted abdomen with a molten
// core. The silhouette is much wider than tall so it can never be mistaken for the upright Ashling. It runs with an
// alternating tripod gait (near-front, far-middle and near-back legs move together).
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color } from '../palette';
import { anim, ashify, finish, monsterSprites, squash, stamp, strokeLine, type Ink } from './common';

const W = 20;
const H = 13;
const FEET = 11;

type Pt = [number, number];

// Abdomen: dark crust over a molten core (E hot, F flame, R ember, L lava).
const ABDOMEN = ['.kcck.', 'kcRLck', 'cRFERc', '.kLRk.'];
const THORAX = ['.si.', 'sicc', '.ck.'];
const HEAD = ['ic.', 'iEF', 'kc.'];

function legend(glow: number): Record<string, Ink> {
  const k = 150 + 105 * glow;
  return {
    s: C.stone,
    i: C.iron,
    c: C.char,
    k: C.coal,
    E: { c: glow > 0.9 ? C.white : C.hot, glow: 255 },
    F: { c: C.flame, glow: k },
    R: { c: C.ember, glow: k * 0.85 },
    L: { c: C.lavaDark, glow: k * 0.7 },
  };
}

interface Leg {
  attach: Pt; // on the thorax, relative to the body origin
  knee: Pt; // relative to the body origin
  foot: Pt; // absolute rest position
  near: boolean;
  tripodA: boolean;
}

// Rest layout. Knees arch above and outward; far feet sit higher on screen (further from the camera).
const LEGS: Leg[] = [
  { attach: [1, 1], knee: [-3, -3], foot: [4, FEET - 2], near: false, tripodA: false },
  { attach: [2, 1], knee: [1, -4], foot: [9, FEET - 2], near: false, tripodA: true },
  { attach: [3, 1], knee: [5, -3], foot: [16, FEET - 2], near: false, tripodA: false },
  { attach: [1, 2], knee: [-4, -2], foot: [2, FEET], near: true, tripodA: true },
  { attach: [2, 2], knee: [0, -3], foot: [8, FEET], near: true, tripodA: false },
  { attach: [3, 2], knee: [6, -2], foot: [16, FEET], near: true, tripodA: true },
];

interface P {
  body: Pt; // thorax map origin
  step: number; // gait phase 0..1
  stride: number; // half stride in px
  rear: number; // lifts the front legs and head (windup)
  lunge: number; // front feet thrust forward (attack)
  curl: number; // corpse: legs fold in
  glow: number;
}

const BASE: P = { body: [8, 5], step: 0, stride: 1.5, rear: 0, lunge: 0, curl: 0, glow: 0.8 };
const pose = (p: Partial<P>): P => ({ ...BASE, ...p });

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const L = legend(p.glow);
  const [bx, by] = p.body;
  const legPts = (leg: Leg): { a: Pt; k: Pt; ft: Pt } => {
    const ph = leg.tripodA ? p.step : (p.step + 0.5) % 1;
    const along = ph < 0.5 ? p.stride - ph * 4 * p.stride : -p.stride + (ph - 0.5) * 4 * p.stride;
    const lift = ph < 0.5 ? 0 : Math.sin((ph - 0.5) * 2 * Math.PI) * 2;
    const front = leg.attach[0] === 3;
    const a: Pt = [bx + leg.attach[0], by + leg.attach[1] - (front ? p.rear : 0)];
    let ft: Pt = [leg.foot[0] + along + (front ? p.lunge * 2 : 0), leg.foot[1] - lift - (front ? p.rear * 3 : 0)];
    let k: Pt = [bx + leg.knee[0] + along * 0.4, by + leg.knee[1] - lift * 0.5 - (front ? p.rear * 1.5 : 0)];
    if (p.curl > 0) {
      // dead: legs fold up over the body
      ft = [a[0] + (ft[0] - a[0]) * (1 - p.curl * 0.75), a[1] - p.curl * 2];
      k = [a[0] + (k[0] - a[0]) * 0.6, a[1] - 2.5 * p.curl];
    }
    return { a, k, ft };
  };
  const drawLeg = (leg: Leg): void => {
    const { a, k, ft } = legPts(leg);
    const femur: Color = leg.near ? C.stone : C.char;
    const tibia: Color = leg.near ? C.iron : C.coal;
    strokeLine(f, a, k, () => femur);
    strokeLine(f, k, ft, (t) => (t > 0.85 && leg.near ? C.ashGrey : tibia));
    if (leg.near) f.c.set(Math.round(k[0]), Math.round(k[1]), C.stoneLight);
  };
  for (const leg of LEGS) if (!leg.near) drawLeg(leg);
  stamp(f, ABDOMEN, L, bx - 5, by - 1 + Math.round(p.rear * 0.5));
  stamp(f, THORAX, L, bx, by);
  stamp(f, HEAD, L, bx + 3, by - Math.round(p.rear));
  // mandibles
  const mx = bx + 6 + (p.lunge > 0 ? 1 : 0);
  const my = by + 1 - Math.round(p.rear);
  f.c.set(mx, my, C.bone);
  f.c.set(mx, my + 1, C.ashGrey);
  for (const leg of LEGS) if (leg.near) drawLeg(leg);
  return finish(f);
}

export function emberSkitterSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) => draw(pose({ step: [0, 0.06, 0, 0.94][i], stride: 1, body: [8, 5 + (i === 2 ? 1 : 0)], glow: [0.7, 0.9, 1, 0.9][i] })));
  const move = [0, 1, 2, 3].map((i) => draw(pose({ step: i / 4, body: [8, 5 + (i % 2)], glow: 0.9 })));
  const windup = [draw(pose({ rear: 1, body: [7, 5], glow: 0.9 })), draw(pose({ rear: 1.6, body: [7, 5], glow: 1 }))];
  const attack = [
    draw(pose({ lunge: 1, body: [10, 5], step: 0.25, glow: 1 })),
    draw(pose({ lunge: 0.6, body: [10, 6], step: 0.5, glow: 1 })),
    draw(pose({ body: [9, 5], step: 0.75, glow: 0.9 })),
  ];
  const dead = draw(pose({ curl: 1, body: [8, 8], glow: 0.4 }));
  const corpse = [
    draw(pose({ curl: 0.5, body: [8, 7], glow: 0.6 })),
    ashify(squash(dead, 0.85, FEET), 0.6, 0.4),
    ashify(squash(dead, 0.7, FEET), 1, 0.2),
  ];
  return monsterSprites({
    id: 'emberSkitter',
    anchorX: 10,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 8, true),
      move: anim(move, 16, true),
      windup: anim(windup, 10, false),
      attack: anim(attack, 14, false),
      corpse: anim(corpse, 10, false),
    },
  });
}
