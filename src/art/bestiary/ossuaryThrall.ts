// Bone Thrall — the Ossuary swarmer. A clattering, hunched skeleton: an oversized pale skull thrust ahead of a
// see-through ribcage, frost-blue glints in its sockets, rime crusted on the crown, and long bony arms reaching
// forward.
//
// Like the Ashling it is only ~13 px tall, so the skull is a hand-authored pixel map and the spine, ribs and limbs
// are posed pixel strokes; every frame draws the same parts, so identity never drifts. What makes it read as a
// skeleton at 1x is negative space: rib bars stacked on a visible spine with dark gaps between, thin limbs held
// clear of the torso and a big bright skull on top. Its corpse is not ash: the bones collapse into a pile that
// stays (the Chorister raises thralls from them).
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color } from '../palette';
import { anim, finish, monsterSprites, stamp, strokeLine, type Ink } from '../monsters/common';
import { COLD_WHITE, rimeify } from './ossuaryKit';

const W = 18;
const H = 17;
const FEET = 15;

type Pt = [number, number];

const g = (c: Color, glow: number): Ink => ({ c, glow });

// Skull, 6x5, facing east: dome back-left, face right. Near socket = dark + glint, far socket = glint on the edge.
const SKULL = ['.rPPB.', 'rPPBBa', 'PBkEaE', '.aBsBa', '..BdBd'];
// jaw dropped a pixel (clack / bite)
const SKULL_OPEN = ['.rPPB.', 'rPPBBa', 'PBkEaE', '.aBsBa', '..d.d.', '..BaB.'];

function legend(glow: number): Record<string, Ink> {
  return {
    P: C.parchment,
    B: C.bone,
    a: C.ashGrey,
    s: C.hairShadow,
    m: C.hairMid,
    d: C.ossDeep,
    k: C.ink,
    r: C.ossFrost,
    E: g(glow > 0.9 ? COLD_WHITE : C.ice, 255),
  };
}

interface P {
  skull: Pt; // skull map origin
  chest: Pt; // top of the spine (between the shoulders)
  lean: number; // spine lean: px the pelvis sits behind the chest
  handN: Pt;
  handF: Pt;
  footN: Pt;
  footF: Pt;
  jaw: boolean;
  glow: number;
}

const BASE: P = {
  skull: [9, 1],
  chest: [8, 7],
  lean: 1,
  handN: [14, 11],
  handF: [15, 10],
  footN: [10, FEET],
  footF: [6, FEET],
  jaw: false,
  glow: 0.8,
};
const pose = (p: Partial<P>): P => ({ ...BASE, ...p });

/** Two-segment limb as pixel strokes; the joint is pushed `bend` px perpendicular to root→end. */
function limb(f: Frame, root: Pt, end: Pt, bend: number, upper: Color, lower: Color): Pt {
  const len = Math.hypot(end[0] - root[0], end[1] - root[1]) || 1;
  const joint: Pt = [
    Math.round((root[0] + end[0]) / 2 + (-(end[1] - root[1]) / len) * bend),
    Math.round((root[1] + end[1]) / 2 + ((end[0] - root[0]) / len) * bend),
  ];
  strokeLine(f, root, joint, () => upper);
  strokeLine(f, joint, end, () => lower);
  return joint;
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const L = legend(p.glow);
  const [cx, cy] = p.chest;
  const [sx, sy] = p.skull;
  // spine: chest → pelvis, bowed back
  const pelvis: Pt = [cx - p.lean, cy + 5.5];
  const shN: Pt = [cx + 1, cy + 1];
  const shF: Pt = [cx + 2, cy];

  // far limbs behind the body
  limb(f, shF, p.handF, -1.3, C.hairShadow, C.hairShadow);
  limb(f, [pelvis[0], pelvis[1] + 1], p.footF, 1.3, C.hairShadow, C.hairShadow);
  f.c.set(Math.round(p.footF[0]) + 1, Math.round(p.footF[1]), C.hairShadow);
  // spine (the back line) and neck into the skull
  strokeLine(f, [cx - 1, cy], [pelvis[0] - 1, pelvis[1] - 1], () => C.hairMid);
  strokeLine(f, [cx, cy - 1], [sx + 1, sy + 4], () => C.ashGrey);
  // rib bars from the spine to the sternum, dark gaps between (the outline fills them with ink); below them only the
  // bare lumbar spine runs down to the pelvis, so the waist is open
  const ribs: [number, number, Color, Color][] = [
    [0, 4, C.parchment, C.bone],
    [2, 4, C.bone, C.ashGrey],
    [3.4, 2, C.ashGrey, C.hairMid],
  ];
  for (const [dy, len, lit, dim] of ribs) {
    const x0 = Math.round(cx - 1 - (p.lean * dy) / 5);
    const y = Math.round(cy + dy);
    if (dy > 3) {
      // a short floating rib, kept off the row just above the pelvis
      if (y >= Math.round(pelvis[1]) - 1) continue;
    }
    for (let i = 0; i < len; i++) f.c.set(x0 + i, y, i < 2 ? lit : dim);
  }
  // pelvis: a short bar with hip sockets
  const [px0, py0] = [Math.round(pelvis[0]), Math.round(pelvis[1])];
  f.c.set(px0 - 1, py0, C.ashGrey);
  f.c.set(px0, py0, C.bone);
  f.c.set(px0 + 1, py0, C.ashGrey);
  // near leg, pale knee and foot bone
  const kneeN = limb(f, [px0 + 1, py0 + 1], p.footN, 1.3, C.ashGrey, C.bone);
  f.c.set(kneeN[0], kneeN[1], C.parchment);
  f.c.set(Math.round(p.footN[0]) + 1, Math.round(p.footN[1]), C.ashGrey);
  // near arm, claw fingers
  const elbow = limb(f, shN, p.handN, -1.4, C.bone, C.ashGrey);
  f.c.set(elbow[0], elbow[1], C.parchment);
  f.c.set(Math.round(p.handN[0]) + 1, Math.round(p.handN[1]) + 1, C.bone);
  f.c.set(Math.round(p.handF[0]) + 1, Math.round(p.handF[1]) + 1, C.hairMid);
  // the skull last: sockets and glints always read, even with the claws raised beside it
  stamp(f, p.jaw ? SKULL_OPEN : SKULL, L, sx, sy);
  return finish(f);
}

// --- gait ------------------------------------------------------------------------------------------------------

/**
 * Clattering shamble, 6 frames: legs alternate with a stiff, jerky stride, arms swing opposite and the skull
 * nods and jitters a pixel sideways on each footfall; the jaw clacks open on the down poses.
 */
function gait(i: number): P {
  const A = 2;
  const along = (ph: number): number => (ph < 0.5 ? A - (ph / 0.5) * 2 * A : -A + ((ph - 0.5) / 0.5) * 2 * A);
  const lift = (ph: number): number => (ph < 0.5 ? 0 : Math.round(Math.sin(((ph - 0.5) / 0.5) * Math.PI) * 1.5));
  const a = i / 6;
  const b = (a + 0.5) % 1;
  const bob = [0, 1, 0, 0, 1, 0][i];
  const jit = [0, 1, 0, 0, 0, -1][i];
  return pose({
    chest: [8, 7 + bob],
    skull: [9 + jit, 1 + bob + [0, 0, 1, 0, 0, 1][i]],
    footN: [Math.round(9 + along(a)), FEET - lift(a)],
    footF: [Math.round(7 + along(b)), FEET - lift(b)],
    handN: [Math.round(14 - along(a) * 0.6), 11 + bob],
    handF: [Math.round(15 - along(b) * 0.6), 10 + bob],
    jaw: bob === 1,
    glow: 0.85,
  });
}

export function boneThrallSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) =>
    draw(
      pose({
        chest: [8, 7 + (i === 2 ? 1 : 0)],
        skull: [9, 1 + (i >= 2 ? 1 : 0)],
        handN: [14, 11 + (i >= 1 && i <= 2 ? 1 : 0)], // the claws sag a beat ahead of the skull
        handF: [15, 10 + (i === 2 ? 1 : 0)],
        jaw: i === 2,
        glow: [0.7, 0.85, 1, 0.85][i],
      }),
    ),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) => draw(gait(i)));
  // rear back: skull thrown up, both claws raised high, jaw open, the glints flare white
  const windup = [
    draw(pose({ chest: [7, 7], lean: 0, skull: [8, 1], handN: [15, 4], handF: [16, 3], footN: [10, FEET], footF: [5, FEET], glow: 0.9 })),
    draw(pose({ chest: [7, 6], lean: -1, skull: [7, 0], handN: [14, 1], handF: [16, 0], footN: [10, FEET], footF: [5, FEET], jaw: true, glow: 1 })),
    draw(pose({ chest: [7, 6], lean: -1, skull: [7, 0], handN: [14, 0], handF: [16, 1], footN: [10, FEET], footF: [5, FEET], jaw: true, glow: 1 })),
  ];
  // short lunge: thrown forward and low, claws raking down ahead
  const attack = [
    draw(pose({ chest: [10, 8], lean: 3, skull: [12, 3], handN: [17, 8], handF: [17, 6], footN: [12, FEET], footF: [5, FEET], jaw: true, glow: 1 })),
    draw(pose({ chest: [10, 9], lean: 3, skull: [12, 4], handN: [17, 14], handF: [16, 13], footN: [12, FEET], footF: [6, FEET], jaw: true, glow: 1 })),
    draw(pose({ chest: [9, 8], lean: 2, skull: [10, 2], handN: [15, 13], handF: [16, 12], footN: [11, FEET], footF: [6, FEET], glow: 0.9 })),
  ];
  // the bones give way and fall into a pile that stays
  const buckle = draw(pose({ chest: [8, 10], lean: 2, skull: [10, 5], handN: [14, 14], handF: [13, 14], footN: [12, FEET], footF: [4, FEET], jaw: true, glow: 0.6 }));
  const corpse = [buckle, pile(0.35, false), rimeify(pile(0, true), 0.4, 0)];
  return monsterSprites({
    id: 'boneThrall',
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

// A heap of bones: long bones crossed, ribs on their side and the skull resting on top.
const PILE = [
  '.......rPPB.......',
  '......rPBBaE......',
  '..aB..PBkEaa..a...',
  '.a.dBaaBsBa.aB.a..',
  'aB..aBBaBdBBa..PBa',
];
const PILE_SCATTER = [
  '........rPPB......',
  '.......rPBBaE.....',
  '..a....PBkEaa.....',
  '.aBa.B..aBsBa..a..',
  'aB.aB.a..BdBd.aB.a',
];

function pile(glow: number, settled: boolean): Frame {
  const f = new Frame(W, H);
  const L: Record<string, Ink> = { ...legend(0), E: glow > 0 ? g(C.frost, 255 * glow) : C.ossDeep };
  stamp(f, settled ? PILE : PILE_SCATTER, L, 0, FEET - 4);
  return finish(f);
}
