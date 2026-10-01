// Ironhide Brute — the bruiser. A gorilla-hunched ogre with a bare, scarred ash-brown hide and iron bolted on where
// it hits things: a plated forearm and gauntlet, a huge rusted pauldron, a riveted chest plate and a small horned
// helmet with a single ember visor slit. It carries a rusted maul on its shoulder; the slam telegraph hauls the maul
// high above the helmet (a big iron block with clear sky beneath it) before it crashes down in front.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS, type Ramp } from '../palette';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, onBody, px, squash } from './common';

const W = 46;
const H = 46;
const FEET = 43;

const HIDE: Ramp = [C.ink, C.coal, C.woodDeep, C.woodDark, C.sandDark, C.sandMid];
const hide: PrimStyle = { ramp: HIDE, bias: 0.1, dither: 0.08 };
const hideFar: PrimStyle = { ramp: HIDE, bias: -1.2, dither: 0 };
const iron: PrimStyle = { ramp: RAMPS.metal, bias: 0.2, dither: 0.08 };
const ironFar: PrimStyle = { ramp: RAMPS.metal, bias: -1, dither: 0 };
const rust: PrimStyle = { ramp: RAMPS.rust, bias: 0, dither: 0.1, tex: (x, y) => (hash2(x, y, 7) > 0.86 ? -1 : 0) };
const horn: PrimStyle = { ramp: [C.char, C.stone, C.ashGrey, C.bone], bias: 0.4, dither: 0 };
const haft: PrimStyle = { ramp: RAMPS.wood, bias: 0.2, dither: 0 };
const maulHead: PrimStyle = { ramp: [C.metalDeep, C.metalDark, C.rustDark, C.metalMid, C.metalLight, C.metalHi], bias: 0.3, dither: 0.1, tex: (x, y) => (hash2(x, y, 19) > 0.8 ? -1 : 0) };

type Pt = [number, number];
interface P {
  bob: number;
  dx: number;
  lean: number; // + = forward
  grip: Pt; // near hand (holding the maul haft)
  maul: number; // haft direction from the grip to the maul head (radians, 0 = east, y down)
  fistF: Pt; // far fist
  footN: [number, number]; // x, lift
  footF: [number, number];
  glow: number;
  impact: boolean;
}

const BX = 20;
const BY = 27.5;

const base: P = {
  bob: 0,
  dx: 0,
  lean: 0,
  grip: [BX + 6.5, BY - 1],
  maul: -2.25,
  fistF: [BX + 9, BY + 9.5],
  footN: [BX + 3, 0],
  footF: [BX - 4, 0],
  glow: 0.8,
  impact: false,
};
const pose = (p: Partial<P>): P => ({ ...base, ...p });

const HAFT = 13;

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const bx = BX + p.dx + p.lean * 1.4;
  const by = BY + p.bob + Math.abs(p.lean) * 0.4;
  const shN: Pt = [bx - 0.5 + p.lean, by - 3.2];
  const shF: Pt = [bx + 2.5 + p.lean, by - 4.5];
  const hx = bx + 7.4 + p.lean * 1.4;
  const hy = by - 6.8 + p.lean * 0.9;
  const cos = Math.cos(p.maul);
  const sin = Math.sin(p.maul);
  const head: Pt = [p.grip[0] + cos * HAFT, p.grip[1] + sin * HAFT];
  const butt: Pt = [p.grip[0] - cos * 3, p.grip[1] - sin * 3];
  // the maul is behind the body while carried on the shoulder, in front of it once raised or swung
  const maulBehind = p.maul < -1.95;
  const drawMaul = (): void => {
    s.cap(butt[0], butt[1], head[0] - cos * 2, head[1] - sin * 2, 1.1, 1.1, haft);
    // iron block across the haft end
    const ax = -sin;
    const ay = cos;
    const hw = 4; // half width across the haft
    const hd = 2.6; // half depth along the haft
    s.poly(
      [
        [head[0] - ax * hw - cos * hd, head[1] - ay * hw - sin * hd],
        [head[0] + ax * hw - cos * hd, head[1] + ay * hw - sin * hd],
        [head[0] + ax * hw + cos * hd, head[1] + ay * hw + sin * hd],
        [head[0] - ax * hw + cos * hd, head[1] - ay * hw + sin * hd],
      ],
      maulHead,
      1.3,
      -0.3,
      -0.3,
    );
  };
  if (maulBehind) drawMaul();
  // far arm and gauntlet (behind the body)
  const eF: Pt = [(shF[0] + p.fistF[0]) / 2 + 1.8, (shF[1] + p.fistF[1]) / 2];
  s.cap(shF[0], shF[1], eF[0], eF[1], 2.8, 2.4, hideFar);
  s.cap(eF[0], eF[1], p.fistF[0], p.fistF[1] - 1.5, 2.4, 2.4, ironFar);
  s.ell(p.fistF[0], p.fistF[1], 2.8, 2.6, ironFar);
  // legs: short, thick, iron-shod
  const hipY = by + 6.5;
  s.cap(bx - 3, hipY, p.footF[0] + p.dx, FEET - 2.5 - p.footF[1], 3.2, 2.7, hideFar);
  s.cap(bx + 1, hipY, p.footN[0] + p.dx, FEET - 2.5 - p.footN[1], 3.4, 2.9, { ...hide, bias: -0.3 });
  // barrel torso: bare hide, a lighter belly, a leather belt
  s.ell(bx, by, 8.4, 8, hide, 0.2 + p.lean * 0.1);
  s.ell(bx + 2.6, by + 3, 5.2, 4.2, { ...hide, bias: 0.7 });
  s.poly([[bx - 8, hipY - 3], [bx + 7.5, hipY - 3.4], [bx + 7, hipY - 1.2], [bx - 7.6, hipY - 0.8]], { ramp: RAMPS.rust, bias: -0.8, dither: 0 }, 1);
  // rusted plate riveted over the chest
  s.poly([[bx + 2, by - 5.5], [bx + 7.8, by - 3], [bx + 8.2, by + 2.5], [bx + 4.5, by + 4]], rust, 1.4, 0.3, -0.2);
  // small horned helmet thrust forward of the hump
  s.poly([[hx - 2.6, hy - 1.6], [hx - 1, hy - 2.6], [hx - 4.2, hy - 7], [hx - 4.6, hy - 5]], horn, 1);
  s.ell(hx, hy, 3.2, 3.1, { ...iron, bias: 0.5 });
  s.poly([[hx + 0.4, hy - 2.4], [hx + 1.8, hy - 2], [hx + 1.6, hy - 6.2]], { ...horn, bias: 0 }, 1);
  // huge pauldron on the near shoulder
  s.ell(shN[0] - 1, shN[1], 5.6, 4.2, rust, -0.2);
  s.ell(shN[0] - 1.6, shN[1] - 1.4, 3.8, 2.2, { ...rust, bias: 0.8 }, -0.2);
  // near arm: dark hide upper arm, iron-plated forearm, gauntlet
  const eN: Pt = [(shN[0] + p.grip[0]) / 2 - 0.5, Math.max(shN[1], p.grip[1]) + 3];
  s.cap(shN[0] + 0.5, shN[1] + 2.5, eN[0], eN[1], 3, 2.5, { ...hide, bias: -0.4 });
  s.cap(eN[0], eN[1], p.grip[0], p.grip[1], 2.5, 2.4, { ...iron, bias: -0.2 });
  if (!maulBehind) drawMaul();
  s.ell(p.grip[0], p.grip[1], 2.7, 2.5, { ...iron, bias: 0.9 });
  s.render(f.c, f.e);

  // iron-shod feet
  for (const [x, lift] of [p.footF, p.footN]) {
    const fx = Math.round(x + p.dx);
    const fy = FEET - lift;
    for (let i = -3; i <= 3; i++) px(f, fx + i, fy, i < 0 ? C.metal : C.metalDark);
    for (let i = -2; i <= 3; i++) onBody(f, fx + i, fy - 1, C.metalMid);
  }
  // rivets on the chest plate, pauldron and forearm plating
  const rivets: Pt[] = [
    [bx + 3.5, by - 3.4], [bx + 6.8, by - 1.8], [bx + 7, by + 1.6], [bx + 4.8, by + 2.4],
    [shN[0] - 5, shN[1] + 1], [shN[0] - 1, shN[1] + 3], [shN[0] + 3, shN[1] + 1.4],
    [(eN[0] + p.grip[0]) / 2, (eN[1] + p.grip[1]) / 2 - 1],
  ];
  for (const [x, y] of rivets) onBody(f, x, y, C.metalHi);
  // old scars across the hide
  for (const [x0, y0] of [[bx - 5, by - 1], [bx - 3, by + 3]]) {
    onBody(f, x0, y0, C.woodDeep);
    onBody(f, x0 + 1, y0 + 1, C.woodDeep);
    onBody(f, x0 + 2, y0 + 1, C.sandMid);
  }
  // visor slit — the brute's hot point; it flares during the windup
  const g = 150 + 105 * p.glow;
  const vy = Math.round(hy);
  for (let x = Math.round(hx - 0.5); x <= Math.round(hx + 2.5); x++) {
    if (!f.c.opaque(x, vy)) continue;
    f.glow(x, vy, x === Math.round(hx + 1.5) ? (p.glow > 0.9 ? C.hot : C.flame) : C.ember, g);
  }
  if (p.impact) {
    // cracks of heat and dust bursting from under the maul head
    const ix = Math.round(head[0]);
    for (const [dx, dy, c] of [[-4, 0, C.ember], [-3, 0, C.flame], [3, 0, C.flame], [4, 0, C.ember], [-2, -1, C.hot], [2, -1, C.hot], [-5, 0, C.lavaDark], [5, 0, C.lavaDark]] as const) {
      f.glow(ix + dx, FEET + dy, c, 230);
    }
  }
  return finish(f);
}

export function ironhideBruteSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 1].map((i) => {
    const b = [0, 0.5, 1, 0.5][i];
    return draw(pose({ bob: b, grip: [BX + 6.5, BY - 1 + b], fistF: [BX + 9, BY + 9.5 + b * 0.5], glow: [0.7, 0.8, 0.95, 0.8][i] }));
  });
  // heavy stomp: sway onto each leg; sampled at half-steps so all six frames differ
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = ((i + 0.5) / 6) * Math.PI * 2;
    const step = Math.sin(ph);
    return draw(
      pose({
        bob: Math.abs(Math.cos(ph)) * 1.4,
        dx: step * 0.4,
        lean: 0.3,
        footN: [BX + 3 + step * 3, Math.max(0, step) * 2.2],
        footF: [BX - 4 - step * 3, Math.max(0, -step) * 2.2],
        grip: [BX + 6.5 + step * 0.5, BY - 1 + Math.abs(Math.cos(ph)) * 1.4],
        maul: -2.25 + step * 0.06,
        fistF: [BX + 9 + step * 2, BY + 9.5],
        glow: 0.8,
      }),
    );
  });
  // the telegraph: the maul is hauled up and back until it hangs high above the helmet
  const windup = [
    draw(pose({ lean: -0.4, bob: -0.5, grip: [BX + 7, BY - 5], maul: -2.0, fistF: [BX + 8, BY + 7], glow: 0.9 })),
    draw(pose({ lean: -0.9, bob: -1, grip: [BX + 3, BY - 11], maul: -1.8, fistF: [BX + 7, BY + 5], glow: 1 })),
    draw(pose({ lean: -1.2, bob: -1, grip: [BX + 1, BY - 12.5], maul: -1.95, fistF: [BX + 6, BY + 4], glow: 1 })),
    draw(pose({ lean: -1.2, bob: -0.5, grip: [BX + 1, BY - 12], maul: -1.95, fistF: [BX + 6, BY + 4.5], glow: 1 })),
  ];
  const attack = [
    draw(pose({ lean: 1, grip: [BX + 11, BY - 4], maul: -0.4, fistF: [BX + 10, BY + 6], glow: 1, footN: [BX + 5, 0] })),
    draw(pose({ lean: 1.8, bob: 2, grip: [BX + 12, BY + 3], maul: 0.95, fistF: [BX + 11, BY + 8], glow: 1, footN: [BX + 5, 0], impact: true })),
    draw(pose({ lean: 1.4, bob: 1.5, grip: [BX + 11.5, BY + 3], maul: 1, fistF: [BX + 11, BY + 8], glow: 0.9, footN: [BX + 5, 0] })),
  ];
  const fallen = draw(pose({ lean: 1.5, bob: 7, grip: [BX + 12, BY + 8], maul: 0.2, fistF: [BX + 14, BY + 12], footN: [BX + 5, 0], footF: [BX - 6, 0], glow: 0.3 }));
  const corpse = [
    draw(pose({ lean: 1.2, bob: 4, grip: [BX + 11, BY + 6], maul: 0.5, fistF: [BX + 12, BY + 11], footN: [BX + 4, 0], glow: 0.6 })),
    ashify(squash(fallen, 0.8, FEET), 0.5, 0.4),
    ashify(squash(fallen, 0.65, FEET), 0.9, 0.2),
  ];
  return monsterSprites({
    id: 'ironhideBrute',
    anchorX: BX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 4, true),
      move: anim(move, 7, true),
      windup: anim(windup, 5, false),
      attack: anim(attack, 10, false),
      corpse: anim(corpse, 6, false),
    },
  });
}
