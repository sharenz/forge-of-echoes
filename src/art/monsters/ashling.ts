// Ashling — the swarmer, the bulk of every wave. A knuckle-walking imp of packed ash: an oversized pale head with
// two swept bone horns and a wide pair of ember eyes, a hunched torso with a smouldering seam down its back, long
// arms that reach the ground and short thin legs.
//
// At ~14 px tall, shaded primitives smear into a blob, so the head and torso are hand-authored pixel maps and the
// limbs are posed pixel strokes. Every frame stamps the same parts, so identity never drifts. The value hierarchy
// (pale head → mid torso → dark limbs) keeps the silhouette readable at 1x in a crowd of hundreds.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color } from '../palette';
import { anim, ashify, finish, monsterSprites, squash, stamp, strokeLine, type Ink } from './common';

const W = 18;
const H = 17;
const FEET = 15;

type Pt = [number, number];

const g = (c: Color, glow: number): Ink => ({ c, glow });

// Head, 7x5, light from the top-left. Near eye two pixels (E F), far eye on the silhouette edge (F).
const HEAD = ['.sSAAs.', 'sSAAAAs', 'iSAEFsF', 'isssmmm', '.iiiiB.'];
const HEAD_OPEN = ['.sSAAs.', 'sSAAAAs', 'iSAEFsF', 'issRFFR', '.iiLRB.'];
// Hunched torso, 8x6: the hump peaks under the shoulders; a smouldering seam runs down the back.
const TORSO = ['....sSs.', '..sLiiSs', '.sRicIis', 'siLcccic', 'icccckci', '.ckkkkc.'];

function legend(glow: number): Record<string, Ink> {
  const k = 150 + 105 * glow;
  return {
    A: C.ashGrey,
    S: C.stoneLight,
    s: C.stone,
    I: C.stone,
    i: C.iron,
    c: C.char,
    k: C.coal,
    m: C.coal,
    B: C.bone,
    E: g(glow > 0.9 ? C.white : C.hot, 255),
    F: g(C.flame, k),
    R: g(C.ember, k * 0.9),
    L: g(C.lavaDark, k * 0.75),
  };
}

interface P {
  head: Pt; // head map origin
  torso: Pt; // torso map origin
  handN: Pt;
  handF: Pt;
  footN: Pt;
  footF: Pt;
  jaw: boolean;
  tail: number; // tail tip lift
  glow: number;
}

const BASE: P = {
  head: [9, 3],
  torso: [3, 7],
  handN: [13, FEET],
  handF: [11, FEET - 1],
  footN: [6, FEET],
  footF: [3, FEET - 1],
  jaw: false,
  tail: 0,
  glow: 0.8,
};
const pose = (p: Partial<P>): P => ({ ...BASE, ...p });

/** Two-segment limb as pixel strokes; the joint is pushed `bend` px perpendicular to root→end. */
function limb(f: Frame, root: Pt, end: Pt, bend: number, upper: Color, lower: Color): void {
  const len = Math.hypot(end[0] - root[0], end[1] - root[1]) || 1;
  const joint: Pt = [
    (root[0] + end[0]) / 2 + (-(end[1] - root[1]) / len) * bend,
    (root[1] + end[1]) / 2 + ((end[0] - root[0]) / len) * bend,
  ];
  strokeLine(f, root, joint, () => upper);
  strokeLine(f, joint, end, () => lower);
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const L = legend(p.glow);
  const [tx, ty] = p.torso;
  const [hx, hy] = p.head;
  const hip: Pt = [tx + 1.5, ty + 4];
  const shN: Pt = [tx + 6.5, ty + 2];
  const shF: Pt = [tx + 5.5, ty + 1.5];

  // far limbs and the tail, behind the torso
  limb(f, shF, p.handF, -1.2, C.char, C.char);
  limb(f, [hip[0] - 0.5, hip[1]], p.footF, 1, C.char, C.coal);
  strokeLine(f, [tx + 0.5, ty + 3], [tx - 1.5, ty + 1.5 - p.tail], () => C.iron);
  f.glow(Math.round(tx - 2), Math.round(ty + 1 - p.tail), p.glow > 0.9 ? C.flame : C.ember, 150 + 105 * p.glow);
  // torso, near leg, head with horns, near arm on top
  stamp(f, TORSO, L, tx, ty);
  limb(f, [hip[0] + 0.5, hip[1] + 0.5], p.footN, 1.2, C.iron, C.iron);
  f.c.set(Math.round(p.footN[0]) + 1, Math.round(p.footN[1]), C.char);
  // horns: the far one rises behind, the near one sweeps back over the skull
  strokeLine(f, [hx + 4, hy - 1], [hx + 4, hy - 2], (t) => (t < 0.5 ? C.stoneLight : C.ashGrey));
  f.c.set(hx + 3, hy - 3, C.bone);
  strokeLine(f, [hx + 1, hy - 1], [hx, hy - 2], () => C.bone);
  f.c.set(hx - 1, hy - 2, C.parchment);
  f.c.set(hx - 2, hy - 1, C.bone);
  stamp(f, p.jaw ? HEAD_OPEN : HEAD, L, hx, hy);
  limb(f, shN, p.handN, -1.4, C.stone, C.iron);
  // knuckle claws
  f.c.set(Math.round(p.handN[0]) + 1, Math.round(p.handN[1]), C.bone);
  f.c.set(Math.round(p.handF[0]) + 1, Math.round(p.handF[1]), C.ashGrey);
  return finish(f);
}

// --- gait ----------------------------------------------------------------------------------------------------

/**
 * Knuckle-walk, 6 frames: diagonal pairs (near arm + far leg, far arm + near leg) alternate. A planted limb slides
 * back at the travel speed; a swinging limb lifts and passes forward. Frames 0 and 3 are the contact poses, 1/4 the
 * down poses and 2/5 the passing poses.
 */
function gait(i: number): P {
  const A = 2; // half stride
  const along = (ph: number): number => (ph < 0.5 ? A - (ph / 0.5) * 2 * A : -A + ((ph - 0.5) / 0.5) * 2 * A);
  const lift = (ph: number, h: number): number => (ph < 0.5 ? 0 : Math.round(Math.sin(((ph - 0.5) / 0.5) * Math.PI) * h));
  const a = i / 6;
  const b = (a + 0.5) % 1;
  const bob = [0, 1, 0, 0, 1, 0][i];
  return pose({
    torso: [3, 7 + bob],
    head: [9, 3 + bob + [0, 0, 1, 0, 0, 1][i]],
    handN: [Math.round(13 + along(a)), FEET - lift(a, 2)],
    footF: [Math.round(3 + along(a)), FEET - 1 - lift(a, 1)],
    handF: [Math.round(11 + along(b)), FEET - 1 - lift(b, 2)],
    footN: [Math.round(6 + along(b)), FEET - lift(b, 1)],
    tail: [0, 1, 1, 0, 1, 1][i],
    glow: 0.85,
  });
}

export function ashlingSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) =>
    draw(pose({ torso: [3, 7 + (i === 2 ? 1 : 0)], head: [9, 3 + (i >= 2 ? 1 : 0)], tail: [0, 1, 1, 0][i], glow: [0.7, 0.85, 1, 0.85][i] })),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) => draw(gait(i)));
  // rear back: head and hump lift, claws raised to pounce, the maw starts to glow
  const windup = [
    draw(pose({ torso: [2, 6], head: [8, 2], handN: [13, 9], handF: [12, 8], footN: [6, FEET], footF: [3, FEET - 1], tail: 1, glow: 0.9 })),
    draw(pose({ torso: [2, 5], head: [8, 1], handN: [14, 5], handF: [13, 4], footN: [6, FEET], footF: [3, FEET - 1], tail: 2, glow: 1, jaw: true })),
    draw(pose({ torso: [2, 5], head: [8, 1], handN: [14, 4], handF: [13, 3], footN: [6, FEET], footF: [3, FEET - 1], tail: 2, glow: 1, jaw: true })),
  ];
  // lunge-bite: thrown forward and low, claws slamming down ahead
  const attack = [
    draw(pose({ torso: [5, 8], head: [11, 5], handN: [17, 12], handF: [16, 11], footN: [7, FEET], footF: [3, FEET - 1], jaw: true, glow: 1 })),
    draw(pose({ torso: [5, 9], head: [11, 6], handN: [17, FEET], handF: [16, FEET - 1], footN: [7, FEET], footF: [4, FEET - 1], jaw: true, glow: 1 })),
    draw(pose({ torso: [4, 8], head: [10, 4], handN: [15, FEET], handF: [13, FEET - 1], footN: [6, FEET], footF: [3, FEET - 1], glow: 0.9 })),
  ];
  const down = draw(pose({ torso: [3, 10], head: [10, 8], handN: [16, FEET], handF: [14, FEET], footN: [6, FEET], footF: [2, FEET], glow: 0.5 }));
  const corpse = [
    ashify(squash(down, 0.85, FEET), 0.3, 0.8),
    ashify(squash(down, 0.6, FEET), 0.65, 0.45),
    ashify(squash(down, 0.42, FEET), 1, 0.25),
  ];
  return monsterSprites({
    id: 'ashling',
    anchorX: 9,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 6, true),
      move: anim(move, 12, true),
      windup: anim(windup, 8, false),
      attack: anim(attack, 14, false),
      corpse: anim(corpse, 8, false),
    },
  });
}
