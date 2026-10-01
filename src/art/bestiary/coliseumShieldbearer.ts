// Shieldbearer — bruiser. A broad arena legionary hunched behind a tower shield: a bucket great-helm with one
// ember visor slit peering over the rim, a huge iron pauldron, banded iron cuirass, leather pteruges and iron
// greaves. The shield faces east (turned a little towards the camera so its face reads): a curved crimson scutum with
// a bronze rim, corner rivets, arena scars and a spiked iron boss. From the front there is only shield; you have to
// get round it.
//
// windup: rocks back onto the planted rear foot, the shield hauled back with its top edge tipped away and the visor
// flaring (the bash telegraph). attack: the shield is driven forward with the whole weight behind it, dust at its
// foot. block: the turtle — crouched low, the shield's foot bitten into the sand, the helm ducked behind the rim with
// only its crown and the ember slit showing; a deflection spark on the face, then held.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash } from '../monsters/common';
import { IRON, LEATHER, RUST_IRON, dust, limb, sole, on, pitted, put, sparks, type Pt } from './coliseumKit';

const W = 38;
const H = 34;
const FEET = 31;
const AX = 16;

const iron: PrimStyle = { ramp: IRON, bias: 0.3, dither: 0.06, tex: pitted(11, 0.9) };
const ironFar: PrimStyle = { ramp: IRON, bias: -0.9, dither: 0 };
const rustIron: PrimStyle = { ramp: RUST_IRON, bias: 0.2, dither: 0.06, tex: pitted(17) };
const leather: PrimStyle = { ramp: LEATHER, bias: 0, dither: 0.04 };
const leatherFar: PrimStyle = { ramp: LEATHER, bias: -1.2, dither: 0 };
const face: PrimStyle = { ramp: RAMPS.wine.slice(0, 5), bias: -0.1, dither: 0.1, cyl: 0.85, round: 0.8 };
const boss: PrimStyle = { ramp: IRON, bias: 0.8, dither: 0, ao: false };

interface P {
  bob: number;
  lean: number; // + = forward
  footN: Pt;
  footF: Pt;
  shield: Pt; // shield centre
  tilt: number; // shield lean (+ = top forward)
  glow: number;
  spark: boolean;
  dust: number | null; // x of a dust puff at ground level
  planted: boolean; // shield foot on the ground
  duck: number; // extra drop of the head (ducking behind the rim)
}

const SW = 4.4; // shield half width (as seen)
const SH = 9.6; // shield half height

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const lean = p.lean;
  const hip: Pt = [14.6 + lean * 0.5, 22 + p.bob];
  const chest: Pt = [14.8 + lean * 1.4, 16.2 + p.bob + Math.abs(lean) * 0.3];
  const head: Pt = [16.4 + lean * 2, 7 + p.bob + lean * 0.8 + p.duck];
  const shN: Pt = [chest[0] + 1.2, chest[1] - 3.6];
  const shF: Pt = [chest[0] - 2.6, chest[1] - 3.8];

  // far arm (bracing behind), far leg
  limb(s, shF, [chest[0] - 1, chest[1] + 4], 1.4, 2, 1.6, 1.5, leatherFar);
  limb(s, [hip[0] - 1.6, hip[1] + 1], sole(p.footF, 1.7), 1.5, 2.3, 1.9, 1.7, ironFar);
  // near leg: iron greave
  limb(s, [hip[0] + 1.2, hip[1] + 1], sole(p.footN, 1.8), 1.6, 2.5, 2, 1.8, { ...iron, bias: 0 });
  // pteruges skirt
  s.poly([[hip[0] - 4.6, hip[1] - 2], [hip[0] + 4.2, hip[1] - 2.2], [hip[0] + 4.8, hip[1] + 3.4], [hip[0] - 4.8, hip[1] + 3]], leather, 1.2);
  // banded cuirass: a broad barrel chest
  s.ell(chest[0], chest[1], 5.6, 5.8, rustIron, lean * 0.1);
  // bucket helm
  s.ell(head[0], head[1], 3.3, 3.8, { ...iron, bias: 0.6 }, 0);
  s.poly([[head[0] - 3.3, head[1] - 0.5], [head[0] + 3.3, head[1] - 0.5], [head[0] + 3.2, head[1] + 3.6], [head[0] - 3.1, head[1] + 3.8]], { ...iron, bias: 0.3, cyl: 0.8 }, 1);
  // the great pauldron on the near shoulder
  s.ell(shN[0] - 1, shN[1] + 0.4, 4, 3, { ...rustIron, bias: 0.6 }, -0.35);
  // the tower shield, turned a little towards the camera: a curved slab with rounded corners
  const [sx, sy] = p.shield;
  const t = p.tilt;
  const sp = (u: number, v: number): Pt => [sx + u * SW + v * SH * t, sy + v * SH];
  const shieldIdx = s.size;
  s.poly([sp(-1, -0.94), sp(-0.86, -1), sp(0.86, -1), sp(1, -0.94), sp(1, 0.94), sp(0.86, 1), sp(-0.86, 1), sp(-1, 0.94)], face, 2.2);
  // spiked iron boss
  const bc = sp(0.1, -0.05);
  s.ell(bc[0], bc[1], 2.2, 2.6, boss);
  const owner = s.render(f.c, f.e);

  // bronze rim round the shield, rivets at the corners
  const isShield = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && owner[y * W + x] === shieldIdx;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (owner[y * W + x] !== shieldIdx) continue;
      if (isShield(x - 1, y) && isShield(x + 1, y) && isShield(x, y - 1) && isShield(x, y + 1)) continue;
      const top = !isShield(x, y - 1);
      const left = !isShield(x - 1, y);
      const bottom = !isShield(x, y + 1);
      put(f, x, y, top ? (x < sx ? C.gold : C.ochre) : left ? (y < sy ? C.ochre : C.rustLight) : bottom ? C.rustDark : C.goldDark);
    }
  }
  for (const [u, v] of [[-0.7, -0.84], [0.62, -0.84], [-0.7, 0.84], [0.62, 0.84]] as const) {
    const [rx, ry] = sp(u, v);
    put(f, rx, ry, u < 0 && v < 0 ? C.goldHi : C.ochre);
  }
  // the spine (a raised ridge) running through the boss
  for (let v = -0.86; v <= 0.86; v += 0.1) {
    const [x, y] = sp(0.1, v);
    if (Math.abs(y - bc[1]) > 2.6) on(f, x - 1, y, v < 0 ? C.wineLight : C.wineMid);
  }
  // a bronze band across the face through the boss
  for (let u = -0.8; u <= 0.8; u += 0.2) {
    const [x, y] = sp(u, -0.05);
    if (Math.abs(x - bc[0]) > 2.2) on(f, x, y - 3, u < -0.3 ? C.ochre : C.goldDark);
    if (Math.abs(x - bc[0]) > 2.2) on(f, x, y + 3, u < -0.3 ? C.rustLight : C.rustDark);
  }
  // arena scars across the paint
  for (const [u, v, c] of [[-0.5, -0.6, C.wineLight], [-0.3, -0.52, C.wineHi], [0.4, 0.5, C.wineLight], [-0.4, 0.4, C.wineMid]] as const) on(f, ...sp(u, v), c);
  // the spike
  put(f, bc[0] + 0.2, bc[1] - 0.6, C.white);
  put(f, bc[0] + 1.4, bc[1] - 0.2, C.metalHi);
  put(f, bc[0] + 2.4, bc[1] + 0.1, C.metalLight);
  // cuirass bands and rivets
  for (let i = -1; i <= 2; i++) {
    const y = Math.round(chest[1] + i * 2.2);
    for (let x = Math.round(chest[0] - 4.6); x <= Math.round(chest[0] + 1); x++) if (!isShield(x, y)) on(f, x, y, C.metalDark);
  }
  on(f, shN[0] - 3.4, shN[1] + 0.8, C.metalHi);
  on(f, shN[0] - 1, shN[1] + 2.2, C.metalHi);
  // pteruges strips
  for (let x = Math.round(hip[0] - 4); x <= Math.round(hip[0] + 4); x += 2) for (let y = Math.round(hip[1]); y <= Math.round(hip[1] + 2.6); y++) on(f, x, y, C.woodDeep);
  // boots
  for (const [x, y] of [p.footF, p.footN]) {
    for (let i = -2; i <= 2; i++) put(f, x + i, y, i < 0 ? C.woodDark : C.woodDeep);
    on(f, x - 1, y - 1, C.wood);
  }
  // helm: breathing holes, a crossbar and the ember visor slit peering over the rim
  const vx = Math.round(head[0] + 0.4);
  const vy = Math.round(head[1] + 0.2);
  for (let x = vx - 3; x <= vx + 3; x++) if (!isShield(x, vy + 2)) on(f, x, vy + 2, C.metalDark);
  const g = 150 + 105 * Math.min(1, p.glow);
  for (let x = vx; x <= vx + 3; x++) {
    if (!f.c.opaque(x, vy) || isShield(x, vy)) continue;
    f.glow(x, vy, x === vx + 1 ? (p.glow > 0.95 ? C.hot : C.flame) : C.ember, x === vx + 1 ? g : g * 0.8);
  }
  on(f, head[0] - 1.6, head[1] - 2.6, C.metalHi);
  on(f, head[0] - 0.6, head[1] - 3.2, C.metalHi);

  const out = finish(f);
  if (p.dust !== null) dust(out, p.dust, FEET, 4);
  if (p.spark) sparks(out, bc[0] + 2, bc[1] - 3, 2, 245);
  if (p.planted) {
    // the shield's foot bites the sand
    for (let i = -3; i <= 3; i++) out.c.plot(Math.round(sx + i), FEET, C.sandDark, 0.8);
  }
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

const REST: P = {
  bob: 0,
  lean: 0,
  footN: [17.5, FEET],
  footF: [12.5, FEET],
  shield: [22.5, 18],
  tilt: 0.02,
  glow: 0.7,
  spark: false,
  dust: null,
  planted: false,
  duck: 0,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

// the turtle: crouched, the shield's bottom rim on the sand, the helm ducked behind its top edge
const BRACE: Partial<P> = { bob: 2.6, lean: 0.6, duck: 0.9, footN: [18.5, FEET], footF: [11.5, FEET], shield: [21.6, FEET - SH + 0.2], tilt: 0.02, planted: true };

export function shieldbearerSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 1].map((i) => {
    const b = [0, 0.4, 0.8, 0.4][i];
    return draw(pose({ bob: b, shield: [22.5, 18 + b * 0.6], glow: [0.6, 0.7, 0.85, 0.7][i] }));
  });
  // a heavy plod behind the shield
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = ((i + 0.5) / 6) * Math.PI * 2;
    const st = Math.sin(ph);
    const b = Math.abs(Math.cos(ph)) * 1.1;
    return draw(
      pose({
        bob: b,
        lean: 0.3,
        footN: [17.5 + st * 3, FEET - Math.max(0, st) * 1.8],
        footF: [14.5 - st * 3, FEET - Math.max(0, -st) * 1.8],
        shield: [23 + st * 0.3, 17.6 + b * 0.8],
        tilt: 0.02 + st * 0.015,
        glow: 0.75,
      }),
    );
  });
  // bash telegraph: rocks back onto the planted rear foot, the shield hauled back with its top tipped away
  const windup = [
    draw(pose({ bob: 0.6, lean: -0.6, shield: [21, 18.2], tilt: -0.07, footN: [15.5, FEET], footF: [15, FEET], glow: 0.9 })),
    draw(pose({ bob: 1, lean: -1.1, shield: [19.8, 18.6], tilt: -0.13, footN: [13.5, FEET], footF: [17, FEET], glow: 1 })),
    draw(pose({ bob: 1.2, lean: -1.2, shield: [19.5, 18.8], tilt: -0.15, footN: [13, FEET], footF: [17, FEET], glow: 1, dust: 11 })),
  ];
  // bash: driven 5 px forward with the whole weight, then recover
  const attack = [
    draw(pose({ bob: 0.6, lean: 1.5, shield: [27.5, 17.8], tilt: 0.1, footN: [21, FEET], footF: [13, FEET], glow: 1, dust: 28 })),
    draw(pose({ bob: 0.8, lean: 1.6, shield: [28, 18.2], tilt: 0.08, footN: [21, FEET], footF: [14, FEET], glow: 1, spark: true })),
    draw(pose({ bob: 0.4, lean: 0.8, shield: [25, 18.2], tilt: 0.04, footN: [19.5, FEET], footF: [13, FEET], glow: 0.85 })),
  ];
  // block: drops into the turtle — a deflection spark rocks the shield back a pixel — then settles and holds
  const block = [
    draw(pose({ ...BRACE, bob: 2.2, duck: 1, glow: 0.9 })),
    draw(pose({ ...BRACE, bob: 2.8, duck: 0.7, shield: [21, FEET - SH + 0.2], tilt: 0, glow: 1, spark: true, dust: 25 })),
    draw(pose({ ...BRACE, glow: 0.85 })),
  ];
  // corpse: topples back behind the shield, which falls flat over him
  const fallen = pose({ bob: 8, lean: -1.2, footN: [20, FEET], footF: [16, FEET], shield: [22, 26.5], tilt: 0.5, glow: 0.2 });
  const down = draw(fallen);
  const corpse = [
    draw(pose({ bob: 4, lean: -0.8, footN: [19, FEET], footF: [13, FEET], shield: [23.5, 22.5], tilt: 0.25, glow: 0.45 })),
    ashify(squash(down, 0.75, FEET), 0.45, 0.4),
    ashify(squash(down, 0.55, FEET), 0.95, 0.15),
  ];
  return monsterSprites({
    id: 'shieldbearer',
    anchorX: AX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 4, true),
      move: anim(move, 7, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 12, false),
      block: anim(block, 10, false),
      corpse: anim(corpse, 7, false),
    },
  });
}
