// Bone Chorister — the Ossuary lieutenant. A tall choir-master of the dead: a frost-navy cassock to the floor under a
// wide bell-shaped surplice of pale grave-linen, torn at the hem; a rounded cowl framing a bone skull face; and behind
// the head a halo of little skulls strung on a ring — the choir it leads, whose eyes light up when it sings. A frost-blue
// stole stitched with runes hangs down its front. It plants a bone-bell staff at its side (a bell of fused bone, clapper
// hanging below — no light: the lantern belongs to the Warden) and conducts with its free hand.
//
// Silhouette: a round halo over a bell-shaped body, staff behind at the back side, the gesturing hand in front — it
// never reads as the Ashbound Herald's banner layout, and it outweighs the Ossuary Golem as a lieutenant should.
//
//   sing (loop)  head thrown back, the free hand raised high with an open palm, the mouth a glowing slot, the stole
//                runes and the halo skulls pulse, frost runes rise from the mouth.
//   windup       Choir Wave: staff and hand lifted high, the bell swings, runes gather at the bell.
//   attack       the staff is driven down and the bell tolls: the mouth is thrown wide, a ring of frost flares out.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Ramp } from '../palette';
import { lineCells } from '../raster';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { anim, finish, monsterSprites, onBody, px, squash } from '../monsters/common';
import { BONE, COLD_WHITE, ROBE, rimeify, rune, seam } from './ossuaryKit';

const W = 46;
const H = 56;
const FEET = 53;
const BX = 20;

const cassock: PrimStyle = { ramp: ROBE, bias: -0.35, dither: 0.04 };
const LINEN: Ramp = [C.ossDark, C.ossMid, C.ossLight, C.ossPale, C.ossFrost];
const surplice: PrimStyle = { ramp: LINEN, bias: -0.1, dither: 0.04 };
const cowlStyle: PrimStyle = { ramp: ROBE, bias: 0.2, dither: 0.04 };
const faceStyle: PrimStyle = { ramp: BONE, bias: 0.7, dither: 0 };
const sleeveStyle: PrimStyle = { ramp: LINEN, bias: -0.2, dither: 0 };
const sleeveFar: PrimStyle = { ramp: LINEN, bias: -1, dither: 0 };
const handStyle: PrimStyle = { ramp: BONE, bias: 0.2, dither: 0 };
const bellStyle: PrimStyle = { ramp: BONE, bias: 0.2, dither: 0 };
const STOLE: Ramp = [C.frostDeep, C.frostDark, C.frostMid, C.mana];

type Pt = [number, number];
interface P {
  bob: number;
  lean: number; // + = forward, - = head thrown back
  staffTop: Pt; // top of the shaft (the bell sits on it)
  staffBase: Pt;
  bell: number; // bell tilt (+ = swung forward)
  gripY: number; // near hand's height on the staff, relative to the neck
  hand: Pt; // free (far) hand
  palm: number; // 0..1 open palm, fingers spread
  sway: number; // hem sway
  jaw: number; // 0..1 mouth open
  song: number; // 0..1 mouth/stole/halo glow
  notes: number; // rising rune phase 0..1 (-1 = none)
  gather: number; // 0..1 runes gathered at the bell (windup)
  ring: number; // 0..1 frost ring flaring out (attack)
  slump: number; // corpse: 0..1 folded down
}
const base: P = {
  bob: 0,
  lean: 0,
  staffTop: [BX - 11, 8],
  staffBase: [BX - 12, FEET],
  bell: 0,
  gripY: 1,
  hand: [BX + 8, 33],
  palm: 0.3,
  sway: 0,
  jaw: 0,
  song: 0.15,
  notes: -1,
  gather: 0,
  ring: 0,
  slump: 0,
};
const pose = (p: Partial<P>): P => ({ ...base, ...p });

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const sl = p.slump;
  const bx = BX + p.lean * 0.6 + sl * 3;
  const by = p.bob + sl * 16;
  const hx = bx + 1.2 + p.lean * 1.3 + sl * 3;
  const hy = 16 + by + Math.max(0, -p.lean) * 0.5;
  const neck = 21 + by;
  const hemS = 40 + by * 0.55; // surplice hem (the flare moves less than the shoulders)
  const [sx0, sy0] = p.staffBase;
  const [tx, ty] = p.staffTop;
  const hand0 = p.hand;

  // --- the halo of skulls: a ring of bone behind the head --------------------------------------------------------------
  const HR = 8.2;
  const hcx = hx - 1.2;
  const hcy = hy - 1.5;
  const ring = new Frame(W, H);
  if (sl < 0.5) {
    for (let a = 0; a < Math.PI * 2; a += 0.04) {
      const x = Math.round(hcx + Math.cos(a) * HR);
      const y = Math.round(hcy + Math.sin(a) * HR);
      px(ring, x, y, Math.cos(a + 0.8) < 0 ? C.bone : C.hairShadow);
    }
  }

  // far arm (behind the body): the free, conducting hand
  const shF: Pt = [bx + 4, neck + 1.5];
  const raised = hand0[1] < neck + 4;
  const eF: Pt = raised ? [(shF[0] + hand0[0]) / 2 + 2, (shF[1] + hand0[1]) / 2 + 2] : [shF[0] + 2.5, (shF[1] + hand0[1]) / 2 + 2];
  const farIx = s.size;
  s.cap(shF[0], shF[1], eF[0], eF[1], 2.4, 2.6, raised ? sleeveStyle : sleeveFar);
  s.cap(eF[0], eF[1], hand0[0] - 0.8, hand0[1] + 0.6, 2.6, 2.9, raised ? sleeveStyle : sleeveFar);
  s.ell(hand0[0], hand0[1], 1.6, 1.4, handStyle);
  const farEnd = s.size;
  // cassock: long, dark, flaring to the floor with a ragged hem that sways
  const hem = FEET - 0.5;
  const cpts: Pt[] = [[bx - 4, neck], [bx + 4, neck], [bx + 8.5 + p.sway * 0.5, hem - 6], [bx + 10 + p.sway, hem]];
  for (let i = 0; i <= 8; i++) cpts.push([bx + 10 + p.sway - i * (20 / 8), hem - (i % 2 === 0 ? 0 : 1.2 + hash2(i, 3, 5) * 1.2)]);
  cpts.push([bx - 9 + p.sway * 0.6, hem - 6]);
  const cassockIx = s.size;
  s.poly(cpts, { ...cassock, cyl: 0.8 }, 2);
  // surplice: pale grave-linen from the shoulders, flaring into a bell and torn at the hem
  const spts: Pt[] = [[bx - 4.5, neck - 1.5], [bx + 4.5, neck - 1.5], [bx + 7.5, neck + 3], [bx + 11.5 + p.sway * 0.4, hemS - 2]];
  const N = 11;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = bx + 11.5 + p.sway * 0.4 - u * 23.5;
    const tear = i % 2 === 0 ? 1 + hash2(i, 0, 7) * 3.5 : -0.4 - hash2(i, 1, 7) * 0.8;
    spts.push([x, hemS + tear * (0.6 + 0.4 * Math.abs(p.sway + 0.5) * 0.4)]);
  }
  spts.push([bx - 12, hemS - 2]);
  spts.push([bx - 7.5, neck + 3]);
  const surpliceIx = s.size;
  s.poly(spts, { ...surplice, cyl: 0.65 }, 2, 0, -0.1);
  // the stole: two narrow frost-blue bands hanging down either side of the chest, past the surplice hem, fringed
  const stoleIx = s.size;
  const STY: PrimStyle = { ramp: STOLE, bias: 0, dither: 0 };
  s.poly([[bx - 1.2, neck - 1], [bx + 0.6, neck - 1], [bx + 0.3, hemS + 3.5], [bx - 0.6, hemS + 4.5], [bx - 1.5, hemS + 3.5]], { ...STY, bias: -0.4 }, 0.8, 0.3, 0);
  s.poly([[bx + 2.6, neck - 1], [bx + 4.4, neck - 1], [bx + 4.8, hemS + 3.5], [bx + 3.9, hemS + 4.5], [bx + 3, hemS + 3.5]], STY, 0.8, 0.3, 0);
  const stoleEnd = s.size;
  // near arm: holding the staff crozier-fashion at shoulder height, a wide bell sleeve hanging from the forearm
  const gy = neck + p.gripY;
  const tt = Math.max(0, Math.min(1, (sy0 - gy) / Math.max(1, sy0 - ty)));
  const grip: Pt = [sx0 + (tx - sx0) * tt + 0.6, gy];
  const shN: Pt = [bx - 2.5, neck + 1.5];
  const eN: Pt = [(shN[0] + grip[0]) / 2 + 1, Math.max(shN[1], grip[1]) + 5.5];
  const nearIx = s.size;
  s.cap(shN[0], shN[1], eN[0], eN[1], 2.5, 2.4, sleeveStyle);
  s.cap(eN[0], eN[1], grip[0] + 0.5, grip[1] + 1, 2.1, 1.7, sleeveStyle);
  const fm: Pt = [(eN[0] + grip[0]) / 2, (eN[1] + grip[1]) / 2];
  s.poly([[eN[0] + 1.5, eN[1] - 0.5], [fm[0] - 0.5, fm[1] - 1], [fm[0] - 3, fm[1] + 4.5 + p.sway * 0.3], [eN[0] - 1, eN[1] + 5 + p.sway * 0.4], [eN[0] - 1.5, eN[1] + 2]], { ...sleeveStyle, bias: -0.5 }, 1.2);
  const nearEnd = s.size;
  // cowl and the skull face within
  const cowlIx = s.size;
  s.ell(hx - 0.4, hy - 0.2, 4.9, 5.3, cowlStyle);
  s.ell(hx - 2.5, hy + 4, 3.6, 2.4, cowlStyle); // the cowl's drape at the back of the neck
  const faceIx = s.size;
  s.ell(hx + 1.6, hy + 0.6, 3.1, 3.5, faceStyle);
  s.ell(hx + 2.1, hy + 3.5 + p.jaw * 1.3, 2, 1.1, { ...faceStyle, bias: 0.2 }); // jaw
  const body = new Frame(W, H);
  const owner = s.render(body.c, body.e);
  // inner contours: sleeves over linen, the stole's edges, the face in the cowl
  seam(body, owner, (i) => i >= nearIx && i < nearEnd, (i) => i >= cassockIx && i < nearIx, 0.55);
  seam(body, owner, (i) => i >= stoleIx && i < stoleEnd, (i) => i === surpliceIx || i === cassockIx, 0.45);
  seam(body, owner, (i) => i >= faceIx, (i) => i >= cowlIx && i < faceIx, 0.5);
  if (raised) seam(body, owner, (i) => i >= farIx && i < farEnd, (i) => i >= cassockIx, 0.5);
  // fold shadows running down the bell of the surplice, and the rimed seam of its torn hem
  for (const [x0, x1] of [[bx - 5, bx - 8], [bx - 0.5, bx - 1.5], [bx + 6, bx + 8]] as const) {
    lineCells(x0, neck + 6, x1, hemS + 1, (x, y) => {
      if (owner[y * W + x] !== surpliceIx) return;
      body.c.set(x, y, LINEN[Math.max(0, LINEN.indexOf(body.c.get(x, y)) - 1)] ?? LINEN[0]);
    });
  }
  for (let x = 0; x < W; x++) {
    for (let y = Math.floor(hemS - 3); y <= Math.ceil(hemS + 5); y++) {
      if (owner[y * W + x] !== surpliceIx || owner[(y + 1) * W + x] === surpliceIx) continue;
      body.c.set(x, y, hash2(x, y, 3) > 0.5 ? C.ossFrost : C.ossPale);
    }
  }

  // --- compose: halo ring, staff (behind the near hand), body --------------------------------------------------------
  f.draw(ring, 0, 0);
  // the halo's skulls: seven little skulls strung along the upper arc; their eyes light with the song
  if (sl < 0.5) {
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * (1.05 + (k / 6) * 0.95);
      const x = Math.round(hcx + Math.cos(a) * HR);
      const y = Math.round(hcy + Math.sin(a) * HR);
      px(f, x - 1, y - 1, C.bone);
      px(f, x, y - 1, C.parchment);
      px(f, x + 1, y - 1, C.bone);
      px(f, x - 1, y, C.ashGrey);
      px(f, x + 1, y, C.hairMid);
      px(f, x, y + 1, C.hairShadow);
      const lit = p.song > 0.5 ? (k + Math.round(p.notes * 7)) % 3 !== 0 : k % 3 === 1;
      if (lit) f.glow(x, y, k % 2 ? C.ice : C.frost, p.song > 0.5 ? 150 + 100 * p.song : 120);
      else px(f, x, y, C.ossDeep);
    }
  }
  // staff: pale bone-wood shaft planted at the side
  lineCells(sx0, sy0, tx, ty + 2, (x, y) => {
    px(f, x, y, (x + y) % 7 === 0 ? C.bone : y < ty + 10 ? C.ashGrey : C.hairShadow);
  });
  bell(f, tx, ty, p.bell);
  f.draw(body, 0, 0);
  // bony hand over the shaft
  const hs = new Frame(W, H);
  new Sculpt().ell(grip[0], grip[1], 1.6, 1.5, handStyle).render(hs.c, hs.e);
  f.draw(hs, 0, 0);

  // --- the face: brow, 2 px ink sockets with ice pinpoints, nasal slit, the singing mouth ------------------------------
  const mx = Math.round(hx + 2);
  const my = Math.round(hy);
  for (const [dx, dy] of [[-1, 0], [-1, -1], [0, -1], [2, 0], [2, -1], [1, 1]] as const) onBody(f, mx + dx, my + dy, C.ink);
  f.glow(mx, my, p.song > 0.8 ? COLD_WHITE : C.ice, 255);
  f.glow(mx + 2, my, C.frost, 230);
  onBody(f, mx - 1, my - 2, C.parchment);
  onBody(f, mx, my - 2, C.parchment);
  onBody(f, mx + 1, my - 2, C.bone);
  // the mouth: teeth when closed; a glowing slot (2 wide, up to 3 tall) with a frost halo when singing
  const mouthY = Math.round(hy + 2.6);
  const mh = Math.round(p.jaw * 2.4);
  if (p.song > 0.2 && mh > 0) {
    for (let y = mouthY - 1; y <= mouthY + mh + 1; y++) {
      for (let x = mx - 1; x <= mx + 2; x++) {
        if (!f.c.opaque(x, y)) continue;
        const inside = x >= mx && x <= mx + 1 && y >= mouthY && y <= mouthY + mh;
        if (inside) f.glow(x, y, y === mouthY + Math.floor(mh / 2) ? COLD_WHITE : C.ice, 200 + 55 * p.song);
        else f.emit(x, y, C.frost, 90 * p.song);
      }
    }
  } else {
    for (let x = mx - 1; x <= mx + 2; x++) onBody(f, x, mouthY, x % 2 ? C.ossDeep : C.bone);
  }
  // cowl shadow over the back of the skull
  for (let y = my - 3; y <= my + 3; y++) onBody(f, mx - 3, y, C.frostDeep);
  // runes stitched down the stole, pulsing with the song
  for (let i = 0; i < 4; i++) {
    const x = Math.round(bx + 3.6 + i * 0.12);
    const y = Math.round(neck + 3 + i * 4);
    const pulse = 0.5 + 0.5 * Math.sin((p.notes + i * 0.25) * Math.PI * 2);
    const g = p.notes >= 0 ? 110 + 145 * pulse * p.song : 80 + 120 * p.song;
    if (f.c.opaque(x, y)) f.glow(x, y, g > 200 ? C.ice : C.frost, g);
    if (f.c.opaque(x, y + 1) && g > 170) f.glow(x, y + 1, C.mana, g * 0.6);
  }
  // open palm: long bone fingers spread
  if (p.palm > 0) {
    const [fx, fy] = hand0;
    for (const [dx, dy] of [[1.2, -2.6], [2.4, -2], [3, -0.8], [2.6, 0.6], [-0.6, -2.4]] as const) {
      lineCells(fx + 0.5, fy, fx + 0.5 + dx * p.palm, fy + dy * p.palm, (x, y) => px(f, x, y, dy < -2.3 && dx < 0 ? C.ashGrey : C.bone));
    }
    if (p.song > 0.7) f.glow(Math.round(fx + 1), Math.round(fy - 1), C.frost, 120 * p.song);
  }

  // --- song, gather, ring -----------------------------------------------------------------------------------------------
  if (p.notes >= 0) {
    for (let k = 0; k < 3; k++) {
      const t = (p.notes + k / 3) % 1;
      const x = mx + 4 + t * 5 + Math.sin((t + k) * Math.PI * 2) * 1;
      const y = mouthY - 3 - t * 18;
      rune(f, k, x, y, t < 0.35 ? COLD_WHITE : t < 0.7 ? C.ice : C.frost, 255 * (1 - t * 0.65));
    }
  }
  if (p.gather > 0) {
    const bcx = tx + p.bell * 2;
    const bcy = ty - 2;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3 + p.gather * 0.35) * Math.PI * 2;
      const r = 11 * (1 - p.gather) + 5;
      rune(f, k + 2, bcx + Math.cos(a) * r, bcy + Math.sin(a) * r * 0.8, p.gather > 0.8 ? C.ice : C.frost, 200 + 55 * p.gather);
    }
  }
  finish(f);
  if (p.ring > 0) {
    // the toll: a flattened ring of frost spreading out from the chorister's feet, with a gap (the Choir Wave's)
    const R = 5 + p.ring * 14;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      if (Math.abs(((a / (Math.PI * 2) + 0.12) % 1) - 0.5) < 0.05) continue;
      const x = Math.round(bx + Math.cos(a) * R);
      const y = Math.round(FEET - 1 + Math.sin(a) * R * 0.3);
      if (y > FEET || x < 0 || x >= W) continue;
      f.glow(x, y, Math.sin(a) > 0 ? C.ice : C.frost, 235 * (1.15 - p.ring * 0.45));
    }
    // sound lines off the bell
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI * 0.8 + k * 0.5;
      for (let i = 4; i < 4 + 2 + p.ring * 2; i++) f.glow(Math.round(tx + Math.cos(a) * i), Math.round(ty - 1 + Math.sin(a) * i), C.ice, 200);
    }
  }
  return f;
}

/** The bell of fused bone on top of the staff (mouth down), its clapper hanging below. (x, y) = the bell's crown. */
function bell(f: Frame, x: number, y: number, tilt: number): void {
  const b = new Frame(W, H);
  const cx = x + tilt * 1.2;
  new Sculpt()
    .poly([[cx - 1.4, y - 4], [cx + 1.4, y - 4], [cx + 2.6, y + 0.5], [cx + 3.8 + tilt * 0.4, y + 3], [cx - 3.8 + tilt * 0.4, y + 3], [cx - 2.6, y + 0.5]], bellStyle, 1.4, -0.2, -0.2)
    .render(b.c, b.e);
  f.draw(b, 0, 0);
  // crown loop, dark mouth and clapper
  px(f, Math.round(cx), Math.round(y - 5), C.bone);
  for (let dx = -2; dx <= 2; dx++) px(f, Math.round(cx + tilt * 0.4) + dx, Math.round(y + 3), C.ossDeep);
  px(f, Math.round(cx + tilt * 0.9), Math.round(y + 4), C.hairShadow);
  px(f, Math.round(cx + tilt * 1.2), Math.round(y + 5), C.bone);
  // rime ring around the lip
  px(f, Math.round(cx - 3 + tilt * 0.4), Math.round(y + 2), C.ossFrost);
  px(f, Math.round(cx - 1 + tilt * 0.4), Math.round(y + 2), C.ossFrost);
}

export function boneChoristerSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) =>
    draw(
      pose({
        bob: [0, 0, 1, 0][i],
        sway: [0, 0.5, 0, -0.5][i],
        bell: [0, 0.5, 0, -0.5][i],
        hand: [BX + 8, 33 + [0, 0, 1, 0][i]],
        staffTop: [BX - 11, 8 + [0, 0, 1, 0][i]],
      }),
    ),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = (i / 6) * Math.PI * 2;
    return draw(
      pose({
        bob: [0, 1, 1, 0, 1, 1][i],
        lean: 0.8,
        sway: -1.5 + Math.sin(ph) * 1.2,
        bell: -1 + Math.sin(ph) * 0.8,
        staffTop: [BX - 10 + Math.sin(ph) * 1.5, 8 + (i % 3 === 0 ? 0 : 1)],
        staffBase: [BX - 12 + Math.sin(ph) * 3, FEET - (Math.cos(ph) > 0.3 ? 1 : 0)],
        hand: [BX + 9 - Math.sin(ph) * 1.5, 33],
      }),
    );
  });
  // Choir Wave telegraph: the staff lifted high, the free hand raised, the bell swinging, runes gathering at the bell
  const windup = [
    draw(pose({ lean: -0.4, staffTop: [BX - 10, 7], staffBase: [BX - 11, FEET - 2], gripY: -1, bell: 1, hand: [BX + 10, 26], palm: 0.6, jaw: 0.3, song: 0.5, gather: 0.2 })),
    draw(pose({ lean: -0.9, bob: -1, staffTop: [BX - 9, 6], staffBase: [BX - 10, FEET - 5], gripY: -4, bell: 1.5, hand: [BX + 11, 17], palm: 1, jaw: 0.6, song: 0.8, gather: 0.55 })),
    draw(pose({ lean: -1.1, bob: -1, staffTop: [BX - 9, 6], staffBase: [BX - 10, FEET - 6], gripY: -5, bell: -1, hand: [BX + 11, 14], palm: 1, jaw: 0.8, song: 1, gather: 0.85 })),
    draw(pose({ lean: -1.1, bob: -1, staffTop: [BX - 9, 6], staffBase: [BX - 10, FEET - 6], gripY: -5, bell: 1.5, hand: [BX + 11, 14], palm: 1, jaw: 0.8, song: 1, gather: 1 })),
  ];
  // the staff crashes down and the bell tolls: mouth thrown wide, a ring of frost spreading from its feet
  const attack = [
    draw(pose({ lean: 0.8, staffTop: [BX - 12, 9], staffBase: [BX - 13, FEET], bell: -2, hand: [BX + 12, 28], palm: 1, jaw: 1, song: 1, ring: 0.25 })),
    draw(pose({ lean: 1, bob: 1, staffTop: [BX - 12, 10], staffBase: [BX - 13, FEET], bell: 2, hand: [BX + 12, 30], palm: 1, jaw: 1, song: 1, ring: 0.6 })),
    draw(pose({ lean: 0.5, staffTop: [BX - 11, 9], staffBase: [BX - 12, FEET], bell: -1, hand: [BX + 10, 32], palm: 0.6, jaw: 0.5, song: 0.6, ring: 1 })),
  ];
  // sustained chant: head thrown back, the free hand raised high with an open palm, runes rising from the mouth
  const sing = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(
      pose({
        lean: -0.6 - [0, 0.1, 0.2, 0.2, 0.1, 0][i],
        bob: [0, 0, -1, -1, -1, 0][i],
        jaw: [0.7, 0.9, 1, 1, 0.9, 0.7][i],
        song: [0.8, 0.9, 1, 1, 0.9, 0.8][i],
        notes: i / 6,
        palm: 1,
        hand: [BX + 11 + [0, 0, 1, 1, 0, 0][i], 21 + [0, -1, -2, -2, -1, 0][i]],
        bell: [0, 0.6, 1, 0.6, 0, -0.6][i],
        sway: [0, 0.4, 0.6, 0.4, 0, -0.3][i],
      }),
    ),
  );
  // death: it folds down into its linen, the staff falls flat along the floor beside the heap
  const heap = (k: number, lean: number): Frame =>
    draw(pose({ slump: k, lean, staffTop: [BX + 16 - (1 - k) * 12, FEET - 4 - (1 - k) * 28], staffBase: [BX - 14, FEET], bell: 2, hand: [BX + 9, 42 + k * 6], palm: 0, jaw: 1, song: 0 }));
  const corpse = [heap(0.35, 1.2), rimeify(squash(heap(0.8, 1.5), 0.8, FEET), 0.45, 0.4), rimeify(squash(heap(0.8, 1.5), 0.55, FEET), 0.9, 0.15)];
  return monsterSprites({
    id: 'boneChorister',
    anchorX: BX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 8, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 10, false),
      sing: anim(sing, 8, true),
      corpse: anim(corpse, 6, false),
    },
  });
}

