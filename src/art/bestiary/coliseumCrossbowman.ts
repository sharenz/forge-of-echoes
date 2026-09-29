// Iron Crossbowman — artillery. An arena arbalest: a wide-brimmed iron kettle helm that shadows the face down to one
// ember eye, a crimson brigandine studded with bronze rivets over a quilted gambeson, dark breeches and boots, a
// bolt quiver at the hip, and a heavy crossbow — dark wood stock, iron prod, pale string.
//
// idle / move: the crossbow rides low across the body. windup: the stock comes up to the shoulder and levels east,
// the head drops to the sights and an ember glint wakes at the bolt head (the origin of the aim-line telegraph).
// attack: the string snaps forward, the bolt is gone with a spark at the nose, the arbalest recoils and lowers.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash, stamp, type Ink } from '../monsters/common';
import { LEATHER, RUST_IRON, limb, sole, on, put, sparks, stroke, type Pt } from './coliseumKit';

const W = 30;
const H = 24;
const FEET = 22;
const AX = 12;

const brig: PrimStyle = { ramp: RAMPS.wine.slice(0, 5), bias: -0.2, dither: 0.06 };
const gamb: PrimStyle = { ramp: [C.ink, C.woodDeep, C.sandDeep, C.sandDark, C.sandMid], bias: 0, dither: 0.06 };
const gambFar: PrimStyle = { ramp: [C.ink, C.woodDeep, C.sandDeep, C.sandDark], bias: -1.2, dither: 0 };
const breeches: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron, C.stone], bias: -0.4, dither: 0.04 };
const breechesFar: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron], bias: -1.3, dither: 0 };
const plate: PrimStyle = { ramp: RUST_IRON, bias: 0.2, dither: 0.06 };

// Kettle helm, 9 wide: domed crown, a wide brim that juts forward (east), the face in its shadow with one ember eye.
const HELM = ['...hHh...', '..hHHHm..', '.mHHHhmm.', 'dMMMMMMMm', '...kkEk..', '...skk...'];
function helmInk(glow: number): Record<string, Ink> {
  return {
    H: C.metalHi,
    h: C.metalLight,
    m: C.metalMid,
    M: C.metalLight,
    d: C.metalDark,
    k: C.coal,
    s: C.skinDeep,
    E: { c: glow > 0.95 ? C.hot : C.flame, glow: 150 + 105 * Math.min(1, glow) },
  };
}

interface P {
  bob: number;
  lean: number; // + = forward
  footN: Pt;
  footF: Pt;
  butt: Pt; // crossbow butt
  angle: number; // crossbow direction (radians, 0 = east, y down)
  loaded: boolean; // bolt on the stock
  released: number; // 0 = spanned; 1 = string snapped forward
  glint: number; // 0..1 aim glint at the bolt head
  headDip: number; // head lowered to the sights
  glow: number;
  flash: boolean;
}

const STOCK = 11;

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const lean = p.lean;
  const hip: Pt = [11.6 + lean * 0.4, 15 + p.bob];
  const chest: Pt = [12 + lean * 1.2, 10.8 + p.bob];
  const head: Pt = [12.8 + lean * 1.6 + p.headDip * 0.8, 6.4 + p.bob + p.headDip];
  const shN: Pt = [chest[0] + 1, chest[1] - 1.6];
  const shF: Pt = [chest[0] - 0.8, chest[1] - 1.8];
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const at = (d: number, off = 0): Pt => [p.butt[0] + cos * d - sin * off, p.butt[1] + sin * d + cos * off];
  const grip = at(3.6, 1.2);
  const fore = at(7.2, 0.8);

  // far arm to the fore-end, far leg
  limb(s, shF, fore, 1.2, 1.1, 0.9, 0.9, gambFar);
  limb(s, [hip[0] - 0.8, hip[1] + 1], sole(p.footF, 1.1), 1.3, 1.5, 1.2, 1.1, breechesFar);
  // near leg
  limb(s, [hip[0] + 0.6, hip[1] + 1], sole(p.footN, 1.2), 1.3, 1.6, 1.3, 1.2, breeches);
  // gambeson skirt and quiver on the hip (behind the torso)
  s.poly([[hip[0] - 3, hip[1] - 1.5], [hip[0] + 3, hip[1] - 1.5], [hip[0] + 3.4, hip[1] + 2.6], [hip[0] - 3.2, hip[1] + 2.4]], gamb, 1.2);
  s.cap(hip[0] - 3.2, hip[1] - 2.4, hip[0] - 2.6, hip[1] + 2.4, 1.2, 1, { ramp: LEATHER, bias: 0.2, dither: 0 });
  // brigandine torso
  s.ell(chest[0], chest[1], 3.3, 4, brig, lean * 0.12);
  // steel spaulder on the near shoulder
  s.ell(shN[0] - 0.4, shN[1] + 0.2, 2.1, 1.6, plate, -0.3);
  // near arm to the grip
  limb(s, [shN[0] - 0.2, shN[1] + 0.8], grip, -1.4, 1.2, 1, 1, gamb);
  s.render(f.c, f.e);

  // bronze rivets down the brigandine
  on(f, chest[0] + 1.6, chest[1] - 1, C.gold);
  on(f, chest[0] + 1.6, chest[1] + 1.6, C.ochre);
  on(f, chest[0] - 1.2, chest[1] + 0.4, C.goldDark);
  // belt
  for (let x = -3; x <= 3; x++) on(f, hip[0] + x, hip[1] - 1.6, x === 1 ? C.gold : C.woodDeep);
  // bolt fletchings sticking out of the quiver
  put(f, hip[0] - 3.4, hip[1] - 3.6, C.bone);
  put(f, hip[0] - 2.4, hip[1] - 3.8, C.parchment);
  put(f, hip[0] - 2.9, hip[1] - 3, C.woodLight);
  // boots
  for (const [x, y] of [p.footF, p.footN]) {
    put(f, x - 1, y, C.woodDeep);
    put(f, x, y, C.woodDark);
    put(f, x + 1, y, C.woodDark);
    on(f, x, y - 1, C.wood);
  }

  // the crossbow: stock (dark wood), iron prod at the nose, string back to the nut
  const nose = at(STOCK);
  stroke(f, p.butt, nose, (t) => (t < 0.2 ? C.woodDark : t > 0.85 ? C.metalMid : C.wood));
  stroke(f, at(0.5, 0.9), at(STOCK - 1, 0.9), (t) => (t < 0.25 ? C.woodDeep : C.woodDark));
  put(f, ...at(1, -0.4), C.woodLight);
  // the prod: ONE shape in every frame — a 5 px recurved iron bar standing across the nose (the prod runs away
  // from the camera, so from the side it reads as a short upright bar), its tips curled forward. Spanned, a thin
  // dark string runs back from the tips to the latch; released, the string lies flat against the prod.
  const spanned = p.released < 0.5;
  const pc: Pt = [Math.round(nose[0] - cos * 0.8), Math.round(nose[1] - 0.4)];
  const tipU: Pt = [pc[0] + 1, pc[1] - 2];
  const tipD: Pt = [pc[0] + 1, pc[1] + 2];
  const nut = at(STOCK - 4.5, -0.4);
  if (spanned) {
    stroke(f, tipU, nut, (t) => (t < 0.2 || t > 0.85 ? null : C.iron));
    stroke(f, tipD, nut, (t) => (t < 0.2 || t > 0.85 ? null : C.char));
  }
  put(f, ...tipU, C.metalHi);
  put(f, pc[0], pc[1] - 1, C.metalHi);
  put(f, pc[0], pc[1], C.metalMid);
  put(f, pc[0], pc[1] + 1, C.metalMid);
  put(f, ...tipD, C.metalDark);
  if (!spanned) put(f, pc[0] + 1, pc[1], C.stone);
  if (p.loaded) {
    // the bolt: pale shaft from the latch to an iron head just past the prod
    stroke(f, nut, at(STOCK + 1.2, -0.6), (t) => (t > 0.85 ? C.metalHi : t > 0.7 ? C.woodLight : C.bone));
  }
  // near hand on the grip (over the stock), far hand under the fore-end
  put(f, ...grip, C.skinShadow);
  put(f, grip[0] + 1, grip[1], C.skinDeep);

  // helm and face
  const hx = Math.round(head[0] - 4);
  const hy = Math.round(head[1] - 4);
  stamp(f, HELM, helmInk(p.glow), hx, hy);
  // gorget between helm and brigandine
  put(f, hx + 4, hy + 6, C.metalMid);
  put(f, hx + 5, hy + 6, C.metalDark);

  const out = finish(f);
  if (p.glint > 0) {
    const [gx, gy] = at(STOCK + 1, -0.6);
    out.glow(Math.round(gx), Math.round(gy), p.glint > 0.7 ? C.hot : C.flame, 160 + 95 * p.glint);
    if (p.glint > 0.5) {
      out.glowSoft(Math.round(gx) + 1, Math.round(gy), C.ember, 0.8, 200);
      out.glowSoft(Math.round(gx), Math.round(gy) - 1, C.ember, 0.5 * p.glint, 150);
      out.glowSoft(Math.round(gx), Math.round(gy) + 1, C.ember, 0.5 * p.glint, 150);
    }
  }
  if (p.flash) sparks(out, ...at(STOCK + 1.5, -0.6), 1.4, 230);
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

const REST: P = {
  bob: 0,
  lean: 0,
  footN: [13.5, FEET],
  footF: [10, FEET],
  butt: [9, 13.2],
  angle: 0.32,
  loaded: true,
  released: 0,
  glint: 0,
  headDip: 0,
  glow: 0.7,
  flash: false,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

const AIM: Partial<P> = { lean: 0.2, butt: [11, 9.8], angle: 0, headDip: 1, footN: [15, FEET], footF: [9, FEET] };

export function ironCrossbowmanSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 1].map((i) => {
    const b = [0, 0.4, 0.8, 0.4][i];
    return draw(pose({ bob: b, butt: [9, 13.2 + b], glow: [0.6, 0.7, 0.85, 0.7][i] }));
  });
  // a measured march, the crossbow carried at port
  // each foot slides back while planted and swings forward lifted (six distinct poses); the body dips 1 px on the
  // contact frames and the crossbow sways a pixel with the stride
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = (i / 6) * Math.PI * 2;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const b = Math.abs(c) > 0.9 ? 1 : 0;
    return draw(
      pose({
        bob: b,
        lean: 0.3,
        footN: [11.5 + c * 3, FEET - Math.max(0, -s) * 1.8],
        footF: [11.5 - c * 3, FEET - Math.max(0, s) * 1.8],
        butt: [9.4 - c * 0.6, 13 + b + (s > 0.5 ? -0.6 : 0)],
        angle: 0.3 + s * 0.06,
        glow: 0.75,
      }),
    );
  });
  // aim: raise, level, settle — the glint at the bolt head wakes and brightens
  const windup = [
    draw(pose({ lean: 0.1, butt: [10, 11.6], angle: 0.16, headDip: 0.4, footN: [14.5, FEET], footF: [9.5, FEET], glow: 0.8, glint: 0.3 })),
    draw(pose({ ...AIM, glow: 0.9, glint: 0.6 })),
    draw(pose({ ...AIM, bob: 0.3, glow: 1, glint: 0.85 })),
    draw(pose({ ...AIM, bob: 0.3, glow: 1, glint: 1 })),
  ];
  // release: string snaps forward with a spark at the nose, recoil, lower
  const attack = [
    draw(pose({ ...AIM, butt: [10, 9.8], released: 1, loaded: false, flash: true, glow: 1 })),
    draw(pose({ ...AIM, lean: 0, butt: [9.5, 9.4], angle: -0.1, released: 1, loaded: false, glow: 0.9 })),
    draw(pose({ lean: 0, butt: [9.5, 11.6], angle: 0.18, released: 1, loaded: false, headDip: 0.3, footN: [14.5, FEET], footF: [9.5, FEET], glow: 0.8 })),
  ];
  // corpse: knees buckle, falls back, the crossbow clatters down
  const fallen = pose({ bob: 6.5, lean: -1, footN: [16, FEET], footF: [13, FEET], butt: [13, FEET - 1], angle: 0.05, glow: 0.2 });
  const down = draw(fallen);
  const corpse = [
    draw(pose({ bob: 3.5, lean: -0.6, footN: [15, FEET], footF: [11, FEET], butt: [11, FEET - 3], angle: 0.15, glow: 0.45 })),
    ashify(squash(down, 0.7, FEET), 0.45, 0.4),
    ashify(squash(down, 0.5, FEET), 0.95, 0.15),
  ];
  return monsterSprites({
    id: 'ironCrossbowman',
    anchorX: AX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 9, true),
      windup: anim(windup, 7, false),
      attack: anim(attack, 12, false),
      corpse: anim(corpse, 8, false),
    },
  });
}
