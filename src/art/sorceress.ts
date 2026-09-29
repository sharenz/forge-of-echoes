// The Sorceress: burgundy hood and capelet, charcoal robe, bone-white hair, pale face, ember-tipped wand.
//
// Every frame is drawn by `drawSorceress(dir, pose)`: the large forms come from shaded Sculpt shapes, the
// small readable features (face, hair strands, trims, wand) are placed per pixel relative to the same pose
// points. Animations are tables of poses, so identity never drifts between frames.
import type { SpriteDef } from '../contracts/art';
import { Frame, rotFrame, toSprite } from './frame';
import { C, type Color, type Ramp } from './palette';
import { Sculpt, type PrimStyle } from './shade';

export const SORC_W = 32;
export const SORC_H = 32;
export const SORC_AX = 16;
export const SORC_AY = 30;
/** Index of the cast animation frame on which the spell is released. */
export const CAST_RELEASE_FRAME = 3;

const CX = 16;
const FEET = 29;

type Dir = 'south' | 'north' | 'east';

interface Pose {
  /** Upper body vertical offset (+ = down). */
  bob: number;
  /** Extra head offset relative to the body. */
  headX: number;
  headY: number;
  /** Hem sway (+ = right) and skirt flare (extra half-width at the hem). */
  sway: number;
  flare: number;
  /** Lower the upper body into the skirt (kneeling). */
  crouch: number;
  /** Feet: [x offset from centre, lift]; lift < 0 hides the foot under the hem. */
  footA: [number, number];
  footB: [number, number];
  /** Wand hand relative to its shoulder, and wand direction (radians, 0 = east, y down). */
  hand: [number, number];
  wandAngle: number;
  wandLen: number;
  /** Draw the wand arm in front of the capelet (raised arm). */
  armFront: boolean;
  /** Off hand relative to its shoulder. */
  off: [number, number];
  /** Tip glow 0..1 and cast flare size in px (0 = none). */
  tip: number;
  flareR: number;
  /** Hood tip / hair / capelet trailing (px, + = backwards). */
  trail: number;
  /** Horizontal shear of the whole figure at head height (px, + = right). */
  lean: number;
  /** Wand dropped (death). */
  dropped: boolean;
}

const BASE: Pose = {
  bob: 0,
  headX: 0,
  headY: 0,
  sway: 0,
  flare: 0,
  crouch: 0,
  footA: [-3, 0],
  footB: [2, 0],
  hand: [-1, 6],
  wandAngle: 2.1,
  wandLen: 6,
  armFront: false,
  off: [1, 6],
  tip: 0.8,
  flareR: 0,
  trail: 0,
  lean: 0,
  dropped: false,
};

const pose = (p: Partial<Pose>): Pose => ({ ...BASE, ...p });

// materials
const HOOD: Ramp = [C.wineDeep, C.wineDark, C.burgundy, C.wineMid, C.wineLight];
const ROBE: Ramp = [C.ink, C.coal, C.char, C.iron, C.stone];
const hoodStyle: PrimStyle = { ramp: HOOD, bias: -0.2, dither: 0.06 };
const capeStyle: PrimStyle = { ramp: HOOD, bias: -0.3, dither: 0.06 };
const sleeveStyle: PrimStyle = { ramp: HOOD, bias: -0.7, dither: 0 };
const robeStyle: PrimStyle = { ramp: ROBE, bias: -0.2, dither: 0.06 };

// ---------------------------------------------------------------------------
// Shared details
// ---------------------------------------------------------------------------

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const ifInk = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};

function drawWand(f: Frame, hx: number, hy: number, angle: number, len: number, tip: number, flareR: number): void {
  const tx = Math.round(hx + Math.cos(angle) * len);
  const ty = Math.round(hy + Math.sin(angle) * len);
  const steps = Math.max(Math.abs(tx - hx), Math.abs(ty - hy));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(hx + (tx - hx) * t);
    const y = Math.round(hy + (ty - hy) * t);
    px(f, x, y, t < 0.3 ? C.woodDark : t > 0.8 ? C.goldDark : C.woodLight);
  }
  drawTip(f, tx, ty, tip, flareR);
}

/** Ember wand tip; `flareR` > 0 draws the cast release burst. */
function drawTip(f: Frame, x: number, y: number, tip: number, flareR: number): void {
  if (tip <= 0) return;
  if (flareR > 0) {
    for (let r = 1; r <= flareR; r++) {
      const k = 1 - (r - 1) / flareR;
      const col = r <= 1 ? C.hot : r <= flareR * 0.6 ? C.flame : C.ember;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) f.glow(x + dx * r, y + dy * r, col, 255 * (0.55 + 0.45 * k));
      if (r <= Math.ceil(flareR * 0.5)) for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]] as const) f.glow(x + dx * r, y + dy * r, r === 1 ? C.flame : C.ember, 230 * k);
    }
    f.glow(x, y, C.white, 255);
    return;
  }
  const s = 150 + 105 * tip;
  f.glow(x, y, tip > 0.6 ? C.hot : C.flame, s);
  if (tip > 0.3) {
    f.glow(x - 1, y, C.ember, s * 0.8);
    f.glow(x + 1, y, C.ember, s * 0.8);
    f.glow(x, y - 1, C.flame, s * 0.85);
    f.glow(x, y + 1, C.lavaDark, s * 0.6);
  }
  if (tip > 0.9) f.glow(x, y - 2, C.ember, 160);
}

function hand(f: Frame, x: number, y: number, light = true): void {
  px(f, x, y, light ? C.skin : C.skinShadow);
  px(f, x, y + 1, C.skinShadow);
}

/** Horizontal shear: rows are shifted by lean·(height above the feet)/26. */
function shear(src: Frame, lean: number): Frame {
  if (lean === 0) return src;
  const out = new Frame(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    const dx = Math.round((lean * Math.max(0, FEET - y)) / 26);
    for (let x = 0; x < src.w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= src.w) continue;
      out.c.set(x, y, src.c.get(sx, y));
      out.e.set(x, y, src.e.get(sx, y));
    }
  }
  return out;
}

/** A-line skirt: waist → hem with a slight bell curve. */
function skirtShape(cx: number, b: number, p: Pose): [number, number][] {
  const top = 18.2 + b + p.crouch * 0.3;
  const hem = 28.7;
  const hw = 7.4 + p.flare;
  const s = p.sway;
  const liftL = p.footA[1] > 0 ? 0.7 : 0;
  const liftR = p.footB[1] > 0 ? 0.7 : 0;
  return [
    [cx - 3.1, top],
    [cx + 3.1, top],
    [cx + 4.0 + s * 0.3, top + 3.5],
    [cx + hw * 0.84 + s * 0.8, hem - 2.4],
    [cx + hw + s, hem - 0.7 - liftR],
    [cx + 4 + s, hem + 0.1 - liftR],
    [cx + 1.5 + s, hem + 0.45 - liftR * 0.5],
    [cx - 1.5 + s, hem + 0.45 - liftL * 0.5],
    [cx - 4 + s, hem + 0.1 - liftL],
    [cx - hw + s, hem - 0.7 - liftL],
    [cx - hw * 0.84 + s * 0.8, hem - 2.4],
    [cx - 4.0 + s * 0.3, top + 3.5],
  ];
}

/** Burgundy trim on the lowest row of the skirt primitive (found through the Sculpt owner buffer). */
function hemTrim(f: Frame, owner: Int16Array, idx: number): void {
  for (let x = 0; x < f.w; x++) {
    for (let y = f.h - 1; y > 0; y--) {
      if (owner[y * f.w + x] !== idx) continue;
      f.c.set(x, y, x < CX - 2 ? C.wineMid : C.burgundy);
      if (owner[(y - 1) * f.w + x] === idx && (x + y) % 4 === 0) f.c.set(x, y - 1, C.wineDark);
      break;
    }
  }
}

function drawFeet(f: Frame, p: Pose): void {
  for (const [fx, lift] of [p.footA, p.footB]) {
    if (lift < 0) continue;
    const x = CX + fx;
    const y = FEET - lift;
    px(f, x, y, C.char);
    px(f, x + 1, y, C.stone);
    px(f, x, y - 1, C.coal);
    px(f, x + 1, y - 1, C.iron);
  }
}

/** Robe folds (dark crease with a lit crest on its left) from the waist to the hem. */
function folds(f: Frame, xs: number[], y0: number, p: Pose, spread: number): void {
  for (let y = y0; y <= 27; y++) {
    const t = (y - y0) / Math.max(1, 27 - y0);
    for (const x0 of xs) {
      const x = x0 + Math.sign(x0 - CX) * t * spread + p.sway * t * 0.7;
      ifInk(f, x, y, C.coal);
      if (t > 0.25) ifInk(f, x - 1, y, C.iron);
    }
  }
}

// ---------------------------------------------------------------------------
// South (front)
// ---------------------------------------------------------------------------

function drawSouth(p: Pose): Frame {
  const f = new Frame(SORC_W, SORC_H);
  const b = p.bob + p.crouch;
  const s = new Sculpt();

  const shR: [number, number] = [CX - 4.1, 14.8 + b];
  const shL: [number, number] = [CX + 4.1, 14.8 + b];
  const hR: [number, number] = [shR[0] + p.hand[0], shR[1] + p.hand[1]];
  const hL: [number, number] = [shL[0] + p.off[0], shL[1] + p.off[1]];

  const skirtIdx = s.size;
  s.poly(skirtShape(CX, b, p), { ...robeStyle, cyl: 0.85 }, 2);
  s.ell(CX, 16.8 + b, 3.6, 3.0, robeStyle);
  s.cap(shL[0], shL[1], hL[0], hL[1] - 0.8, 1.2, 2.0, sleeveStyle);
  if (!p.armFront) s.cap(shR[0], shR[1], hR[0], hR[1] - 0.8, 1.2, 2.0, sleeveStyle);
  s.poly(capeletFront(b), { ...capeStyle, cyl: 0.55 }, 2, 0, -0.25);
  if (p.armFront) s.cap(shR[0], shR[1], hR[0], hR[1] - 0.8, 1.2, 2.0, { ...sleeveStyle, bias: -0.2 });
  // hood (tip leans to her left)
  const hx = CX - 0.5 + p.headX;
  const hy = 9.6 + b + p.headY;
  s.poly([[hx - 2.6, hy - 2.8], [hx + 2.8, hy - 3.2], [hx + 2.4 + p.trail * 0.3, hy - 7.3]], { ...hoodStyle, bias: 0.3 }, 1.5);
  s.ell(hx, hy, 5.3, 5.0, hoodStyle);
  const owner = s.render(f.c, f.e);
  hemTrim(f, owner, skirtIdx);
  drawFeet(f, p);
  capeletFolds(f, b);

  // collar shadow where the hood rests on the capelet
  const fx = Math.round(hx - 0.5);
  const fy = Math.round(hy + 1.4);
  for (let x = fx - 5; x <= fx + 5; x++) {
    const y = Math.round(hy + 4.6 + Math.abs(x - fx) * 0.25);
    if (Math.abs(x - fx) > 3) ifInk(f, x, y, C.wineDark);
  }
  // hood opening, face and hair
  face(f, fx, fy, p);
  // capelet clasp, sash
  const cy = Math.round(18.4 + b);
  px(f, CX - 1, cy, C.gold);
  px(f, CX, cy, C.goldDark);
  const sy = Math.round(19.6 + b);
  for (let x = CX - 3; x <= CX + 2; x++) ifInk(f, x, sy, x < CX - 1 ? C.wineMid : C.burgundy);
  ifInk(f, CX - 2, sy + 1, C.burgundy);
  ifInk(f, CX - 2, sy + 2, C.wineDark);
  if (p.crouch < 3) folds(f, [CX - 1, CX + 2], sy + 1, p, 2.5);
  // hands and wand
  hand(f, Math.round(hL[0]), Math.round(hL[1]) - 1, false);
  if (!p.dropped) {
    drawWand(f, Math.round(hR[0]), Math.round(hR[1]), p.wandAngle, p.wandLen, p.tip, p.flareR);
    hand(f, Math.round(hR[0]), Math.round(hR[1]) - 1);
  }
  return f;
}

/** Front capelet: wide at the shoulders, dipping to a clasped point at the chest. */
function capeletFront(b: number): [number, number][] {
  return [
    [CX - 5.8, 16.0 + b],
    [CX - 4.4, 13.2 + b],
    [CX + 4.4, 13.2 + b],
    [CX + 5.8, 16.0 + b],
    [CX + 5.1, 17.6 + b],
    [CX + 2.6, 18.1 + b],
    [CX, 19.8 + b],
    [CX - 2.6, 18.1 + b],
    [CX - 5.1, 17.6 + b],
  ];
}

/** Two soft creases falling from the shoulders. */
function capeletFolds(f: Frame, b: number): void {
  for (const x of [CX - 4, CX + 3]) {
    for (let y = Math.round(15.6 + b); y <= Math.round(17.4 + b); y++) {
      const c = f.c.get(x, y);
      if (c === C.burgundy || c === C.wineMid) f.c.set(x, y, C.wineDark);
    }
  }
}

/** Front face in the hood opening. (fx, fy) = centre column, eye row. */
function face(f: Frame, fx: number, fy: number, p: Pose): void {
  // deep shadow at the top of the opening
  for (let x = -1; x <= 1; x++) px(f, fx + x, fy - 3, C.ink);
  for (let x = -2; x <= 2; x++) px(f, fx + x, fy - 2, C.ink);
  px(f, fx - 3, fy - 2, C.wineDeep);
  px(f, fx + 3, fy - 2, C.wineDeep);
  // brow in hood shadow
  px(f, fx - 2, fy - 1, C.skinDeep);
  px(f, fx - 1, fy - 1, C.skinShadow);
  px(f, fx, fy - 1, C.skinShadow);
  px(f, fx + 1, fy - 1, C.skinShadow);
  px(f, fx + 2, fy - 1, C.skinDeep);
  // eyes
  px(f, fx - 2, fy, C.skinShadow);
  px(f, fx - 1, fy, C.coal);
  px(f, fx, fy, C.skin);
  px(f, fx + 1, fy, C.coal);
  px(f, fx + 2, fy, C.skinShadow);
  // cheeks / nose
  px(f, fx - 2, fy + 1, C.skin);
  px(f, fx - 1, fy + 1, C.skinLight);
  px(f, fx, fy + 1, C.skin);
  px(f, fx + 1, fy + 1, C.skin);
  px(f, fx + 2, fy + 1, C.skinShadow);
  // chin
  px(f, fx - 2, fy + 2, C.wineDeep);
  px(f, fx - 1, fy + 2, C.skinShadow);
  px(f, fx, fy + 2, C.skin);
  px(f, fx + 1, fy + 2, C.skinShadow);
  px(f, fx + 2, fy + 2, C.wineDeep);
  for (let x = -1; x <= 1; x++) px(f, fx + x, fy + 3, C.wineDeep);
  // bone-white hair framing the face, spilling onto the capelet
  const t = Math.round(p.trail * 0.35);
  const left: Color[] = [C.bone, C.parchment, C.parchment, C.bone, C.bone, C.hairMid];
  const right: Color[] = [C.hairMid, C.hairMid, C.bone, C.hairMid, C.hairShadow, C.hairShadow];
  for (let i = 0; i < 6; i++) {
    const o = i >= 4 ? t : 0;
    px(f, fx - 3 - o, fy - 1 + i, left[i]);
    px(f, fx + 3 + o, fy - 1 + i, right[i]);
  }
  px(f, fx - 4 - t, fy + 3, C.bone);
  px(f, fx - 4 - t, fy + 4, C.hairMid);
  px(f, fx + 4 + t, fy + 3, C.hairShadow);
  // lit rim of the hood opening
  px(f, fx - 2, fy - 3, C.wineLight);
  px(f, fx - 3, fy - 2 - 0, C.wineMid);
  px(f, fx - 4, fy - 1, C.wineMid);
}

// ---------------------------------------------------------------------------
// North (back)
// ---------------------------------------------------------------------------

function drawNorth(p: Pose): Frame {
  const f = new Frame(SORC_W, SORC_H);
  const b = p.bob + p.crouch;
  // from behind, the wand arm is on the viewer's right
  const shR: [number, number] = [CX + 4.1, 14.8 + b];
  const shL: [number, number] = [CX - 4.1, 14.8 + b];
  const hR: [number, number] = [shR[0] - p.hand[0], shR[1] + p.hand[1]];
  const hL: [number, number] = [shL[0] - p.off[0], shL[1] + p.off[1]];

  // the wand is behind nothing from this side except when raised in front of her (then hidden by the body)
  const back = new Frame(SORC_W, SORC_H);
  if (!p.dropped) drawWand(back, Math.round(hR[0]), Math.round(hR[1]), Math.PI - p.wandAngle, p.wandLen, p.tip, p.flareR);

  const s = new Sculpt();
  const skirtIdx = s.size;
  s.poly(skirtShape(CX, b, p), { ...robeStyle, cyl: 0.85 }, 2);
  s.ell(CX, 16.8 + b, 3.7, 3.2, robeStyle);
  s.cap(shR[0], shR[1], hR[0], hR[1] - 0.8, 1.2, 2.0, sleeveStyle);
  s.cap(shL[0], shL[1], hL[0], hL[1] - 0.8, 1.2, 2.0, sleeveStyle);
  s.poly(
    [
      [CX - 5.8, 16.2 + b],
      [CX - 4.4, 13.0 + b],
      [CX + 4.4, 13.0 + b],
      [CX + 5.8, 16.2 + b],
      [CX + 5.0, 18.4 + b],
      [CX + 2.4 + p.trail * 0.2, 19.2 + b],
      [CX + p.trail * 0.25, 21.0 + b],
      [CX - 2.4 + p.trail * 0.2, 19.2 + b],
      [CX - 5.0, 18.4 + b],
    ],
    { ...capeStyle, cyl: 0.6 },
    2,
    0,
    -0.2,
  );
  const hx = CX + 0.5 + p.headX;
  const hy = 9.6 + b + p.headY;
  s.poly([[hx - 2.8, hy - 3.2], [hx + 2.6, hy - 2.8], [hx - 2.4 - p.trail * 0.3, hy - 7.3]], { ...hoodStyle, bias: 0.3 }, 1.5);
  s.ell(hx, hy, 5.3, 5.1, hoodStyle);

  const body = new Frame(SORC_W, SORC_H);
  const owner = s.render(body.c, body.e);
  hemTrim(body, owner, skirtIdx);
  capeletFolds(body, b);
  // raised arms and the wand show in front when the wand is above the shoulders
  if (p.hand[1] < 0) {
    f.draw(body, 0, 0);
    f.draw(back, 0, 0);
  } else {
    f.draw(back, 0, 0);
    f.draw(body, 0, 0);
  }

  // hood seam and a few escaping strands of hair
  const ox = Math.round(hx - 0.5);
  for (let y = Math.round(hy - 4); y <= Math.round(hy + 3); y++) ifInk(f, ox, y, C.wineDark);
  ifInk(f, ox - 1, Math.round(hy - 3), C.wineLight);
  ifInk(f, ox - 1, Math.round(hy - 2), C.wineMid);
  const hb = Math.round(hy + 4.6);
  ifInk(f, ox - 2, hb, C.bone);
  ifInk(f, ox - 1, hb, C.parchment);
  ifInk(f, ox, hb, C.bone);
  ifInk(f, ox + 1, hb, C.hairMid);
  ifInk(f, ox - 1, hb + 1, C.bone);
  ifInk(f, ox, hb + 1, C.hairMid);
  // collar shadow + capelet centre seam
  for (let x = ox - 5; x <= ox + 5; x++) if (Math.abs(x - ox) > 2) ifInk(f, x, Math.round(hy + 4.6 + Math.abs(x - ox) * 0.25), C.wineDark);
  const sy = Math.round(19.6 + b);
  if (p.crouch < 3) folds(f, [CX - 2, CX + 2], sy + 2, p, 2.5);
  drawFeet(f, p);
  hand(f, Math.round(hL[0]), Math.round(hL[1]) - 1);
  if (!p.dropped && p.hand[1] >= 0) hand(f, Math.round(hR[0]), Math.round(hR[1]) - 1, false);
  return f;
}

// ---------------------------------------------------------------------------
// East (profile, facing right)
// ---------------------------------------------------------------------------

function drawEast(p: Pose): Frame {
  const f = new Frame(SORC_W, SORC_H);
  const b = p.bob + p.crouch;
  // the body stands on the anchor column so west (mirrored about the anchor) doesn't jump
  const cx = CX;
  const s = new Sculpt();
  // far arm, behind the body
  const shF: [number, number] = [cx - 0.5, 14.8 + b];
  const hF: [number, number] = [shF[0] + p.off[0], shF[1] + p.off[1]];
  s.cap(shF[0], shF[1], hF[0], hF[1] - 0.8, 1.2, 1.5, { ...sleeveStyle, bias: -1 });
  // skirt: the leading foot pushes the front hem forward, the trailing one pulls the back
  const top = 18.6 + b + p.crouch * 0.3;
  const hem = 28.7;
  const fwd = Math.max(0, p.footA[0] - 1) * 0.6;
  const bk = Math.min(0, p.footB[0] + 2) * 0.6;
  const skirtIdx = s.size;
  s.poly(
    [
      [cx - 3.0, top],
      [cx + 2.8, top],
      [cx + 3.9 + fwd * 0.3, top + 4],
      [cx + 4.9 + fwd + p.sway, hem - 0.4],
      [cx + 1 + p.sway, hem + 0.35],
      [cx - 3 + p.sway, hem + 0.35],
      [cx - 5 + bk - p.trail * 0.2 + p.sway, hem - 0.5],
      [cx - 4.8 + bk * 0.5 - p.trail * 0.2, top + 4.5],
    ],
    { ...robeStyle, cyl: 0.8 },
    2,
  );
  s.ell(cx, 16.8 + b, 3.1, 3.0, robeStyle);
  // capelet: drapes over the shoulder and trails behind
  s.poly(
    [
      [cx - 4.6 - p.trail * 0.5, 16.8 + b],
      [cx - 3.6, 13.0 + b],
      [cx + 3.0, 13.0 + b],
      [cx + 4.0, 15.6 + b],
      [cx + 3.2, 17.8 + b],
      [cx + 1.6, 19.4 + b],
      [cx - 1.5, 18.4 + b],
      [cx - 5.6 - p.trail, 19.4 + b + p.trail * 0.15],
    ],
    { ...capeStyle, cyl: 0.5 },
    2,
    0,
    -0.2,
  );
  const shN: [number, number] = [cx + 0.2, 14.6 + b];
  const hN: [number, number] = [shN[0] + p.hand[0], shN[1] + p.hand[1]];
  s.cap(shN[0], shN[1], hN[0], hN[1] - 0.8, 1.2, 2.0, { ...sleeveStyle, bias: -0.3 });
  // hood with the peak trailing back
  const hx = cx - 0.3 + p.headX;
  const hy = 9.6 + b + p.headY;
  s.poly([[hx - 4, hy - 1.2], [hx + 0.6, hy - 3.8], [hx - 3.4 - p.trail * 0.6, hy - 6.8 + p.trail * 0.25]], { ...hoodStyle, bias: 0.3 }, 1.5);
  s.ell(hx, hy, 4.9, 5.0, hoodStyle);
  const owner = s.render(f.c, f.e);
  hemTrim(f, owner, skirtIdx);
  drawFeetSide(f, cx, p);

  faceSide(f, Math.round(hx + 2), Math.round(hy + 1.4), p);
  // sash
  const sy = Math.round(19.6 + b);
  for (let x = cx - 3; x <= cx + 3; x++) ifInk(f, x, sy, x > cx ? C.wineMid : C.burgundy);
  ifInk(f, cx + 2, sy, C.ochre);
  ifInk(f, cx - 3, sy + 1, C.burgundy);
  if (p.crouch < 3) {
    for (let y = sy + 2; y <= 27; y++) {
      const t = (y - sy) / (27 - sy);
      ifInk(f, cx + 1 + t * 1.5 + fwd * t * 0.5 + p.sway * t, y, C.coal);
      ifInk(f, cx + t * 1.5 + fwd * t * 0.5 + p.sway * t, y, C.iron);
      ifInk(f, cx - 3 - t * 2 + bk * t * 0.5, y, C.coal);
    }
  }
  if (!p.dropped) {
    drawWand(f, Math.round(hN[0]), Math.round(hN[1]), p.wandAngle, p.wandLen, p.tip, p.flareR);
    hand(f, Math.round(hN[0]), Math.round(hN[1]) - 1);
  }
  return f;
}

/** Profile face looking right. (fx, fy) = eye column/row. */
function faceSide(f: Frame, fx: number, fy: number, p: Pose): void {
  // hood rim overhangs the brow; the opening is in deep shadow
  for (let x = -1; x <= 2; x++) px(f, fx + x, fy - 2, C.ink);
  for (let x = -2; x <= 0; x++) px(f, fx + x, fy - 3, C.ink);
  px(f, fx + 2, fy - 3, C.wineMid);
  px(f, fx + 3, fy - 2, C.wineLight);
  px(f, fx + 3, fy - 1, C.wineDark);
  // forehead, eye, nose, mouth, chin
  px(f, fx - 1, fy - 1, C.skinDeep);
  px(f, fx, fy - 1, C.skinShadow);
  px(f, fx + 1, fy - 1, C.skinShadow);
  px(f, fx + 2, fy - 1, C.skin);
  px(f, fx - 1, fy, C.skinShadow);
  px(f, fx, fy, C.coal);
  px(f, fx + 1, fy, C.skin);
  px(f, fx + 2, fy, C.skinLight);
  px(f, fx + 3, fy, 0);
  px(f, fx - 1, fy + 1, C.skinShadow);
  px(f, fx, fy + 1, C.skin);
  px(f, fx + 1, fy + 1, C.skin);
  px(f, fx + 2, fy + 1, C.skinLight);
  px(f, fx + 3, fy + 1, C.skin);
  px(f, fx - 1, fy + 2, C.skinDeep);
  px(f, fx, fy + 2, C.skinShadow);
  px(f, fx + 1, fy + 2, C.skin);
  px(f, fx + 2, fy + 2, C.skinDeep);
  px(f, fx, fy + 3, C.wineDeep);
  px(f, fx + 1, fy + 3, C.skinShadow);
  // hair falls behind the cheek and down over the shoulder
  const t = Math.round(p.trail * 0.4);
  const hair: Color[] = [C.bone, C.parchment, C.bone, C.bone, C.hairMid, C.hairMid, C.hairShadow];
  for (let i = 0; i < hair.length; i++) px(f, fx - 2 - (i >= 3 ? t : 0), fy - 1 + i, hair[i]);
  px(f, fx - 1, fy + 3, C.bone);
  px(f, fx - 1, fy + 4, C.hairMid);
  px(f, fx - 3 - t, fy + 4, C.hairMid);
}

function drawFeetSide(f: Frame, cx: number, p: Pose): void {
  for (const [fx, lift] of [p.footB, p.footA]) {
    if (lift < 0) continue;
    const x = cx + fx;
    const y = FEET - lift;
    px(f, x, y, C.coal);
    px(f, x + 1, y, C.char);
    px(f, x + 2, y, C.stone);
    px(f, x, y - 1, C.coal);
    px(f, x + 1, y - 1, C.iron);
  }
}

// ---------------------------------------------------------------------------
// Poses per animation
// ---------------------------------------------------------------------------

const DRAW: Record<Dir, (p: Pose) => Frame> = { south: drawSouth, north: drawNorth, east: drawEast };

function finish(f: Frame, lean = 0): Frame {
  const g = shear(f, lean);
  g.outline({ selective: true });
  return g;
}

function render(dir: Dir, p: Pose): Frame {
  return finish(DRAW[dir](p), p.lean);
}

function idlePoses(dir: Dir): Pose[] {
  const east = dir === 'east';
  return [0, 1, 2, 3].map((i) =>
    pose({
      bob: i === 1 || i === 2 ? 1 : 0,
      sway: [0, 0.3, 0.6, 0.3][i] * (east ? -1 : 1),
      hand: east ? [2.5, 5.5] : [-1, 6],
      off: east ? [-1.5, 5] : [1, 6],
      wandAngle: east ? 0.55 : 2.1,
      tip: [0.75, 0.9, 1, 0.9][i],
      trail: [0, 0.5, 1, 0.5][i],
      footA: east ? [1, 0] : [-3, 0],
      footB: east ? [-3, 0] : [2, 0],
    }),
  );
}

function runPoses(dir: Dir): Pose[] {
  if (dir === 'east') {
    // contact, down, pass ×2 (the two legs swap roles)
    const feet: [[number, number], [number, number]][] = [
      [[5, 0], [-5, 1]],
      [[3, 0], [-3, 0]],
      [[1, 1], [-1, 0]],
      [[5, 0], [-5, 1]],
      [[3, 0], [-3, 0]],
      [[1, 1], [-1, 0]],
    ];
    const handA: [number, number][] = [[3.5, 4.5], [3, 5], [2, 5.5], [0.5, 5.5], [1, 5.5], [2, 5.5]];
    const offA: [number, number][] = [[-2.5, 4.5], [-2, 5], [-1, 5], [1.5, 4.5], [1, 5], [0, 5]];
    return feet.map(([a, bb], i) =>
      pose({
        bob: [0, 1, 0, 0, 1, 0][i],
        footA: a,
        footB: bb,
        hand: handA[i],
        off: offA[i],
        wandAngle: i < 3 ? 0.3 : 0.9,
        tip: 0.9,
        trail: [2, 2.5, 3, 2, 2.5, 3][i],
        sway: [-0.6, -0.3, 0, -0.6, -0.3, 0][i],
        lean: 1,
      }),
    );
  }
  // front/back: contact → down → pass for each leg; the stepping foot shows below the hem, the other is hidden
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const side = i < 3 ? 1 : -1; // 1 = left foot (A) leads
    const phase = i % 3;
    const lead: [number, number] = [side > 0 ? -3 : 2, phase === 2 ? 1 : 0];
    const trail: [number, number] = [side > 0 ? 2 : -3, phase === 2 ? 1 : -1];
    return pose({
      bob: [0, 1, -1][phase],
      footA: side > 0 ? lead : trail,
      footB: side > 0 ? trail : lead,
      sway: -side * [0.9, 0.5, 0][phase],
      hand: [-1 + side * 0.5, 5.5 - side * 1],
      off: [1 + side * 0.5, 5.5 + side * 1],
      wandAngle: 2.2 - side * 0.2,
      tip: 0.9,
      trail: [1.2, 1.6, 2][phase],
    });
  });
}

function castPoses(dir: Dir): Pose[] {
  if (dir === 'east') {
    return [
      pose({ hand: [-1.5, 3], wandAngle: -2.3, tip: 0.9, off: [-2, 5], lean: -1 }),
      pose({ hand: [0, -4], wandAngle: -1.9, tip: 1, off: [-2, 4], bob: -1, lean: -1, trail: 1, armFront: true }),
      pose({ hand: [3, -2], wandAngle: -0.6, tip: 1, off: [-2, 4], trail: 1, armFront: true }),
      pose({ hand: [6, 1], wandAngle: 0, tip: 1, flareR: 4, off: [-3, 3], lean: 1, trail: 2, footA: [3, 0], footB: [-4, 0], armFront: true }),
      pose({ hand: [4.5, 3], wandAngle: 0.3, tip: 0.8, off: [-2, 4], trail: 1, footA: [2, 0], footB: [-3, 0] }),
    ];
  }
  // south / north: the wand arm sweeps up over the head and the flare releases high
  return [
    pose({ hand: [0, 3], wandAngle: -2.4, tip: 0.9, armFront: true }),
    pose({ hand: [1.5, -4], wandAngle: -1.9, tip: 1, bob: -1, off: [0, 5], armFront: true }),
    pose({ hand: [2, -5], wandAngle: -1.6, tip: 1, bob: -1, off: [0.5, 4.5], armFront: true }),
    pose({ hand: [2.5, -3], wandAngle: -1.3, tip: 1, flareR: 4, off: [1, 5], trail: 1, armFront: true }),
    pose({ hand: [0, 2], wandAngle: -2.6, tip: 0.8, armFront: true }),
  ];
}

function dashPoses(dir: Dir): Pose[] {
  if (dir === 'east') {
    return [
      pose({ bob: 1, lean: 2, hand: [-3, 4], wandAngle: 2.8, off: [-3, 4], trail: 3, footA: [2, 0], footB: [-4, 1], tip: 1 }),
      pose({ bob: 1, lean: 5, hand: [-4, 3], wandAngle: 3, off: [-4, 3], trail: 6, sway: -1.5, footA: [3, 1], footB: [-6, 2], tip: 1 }),
      pose({ bob: 0, lean: 2, hand: [-1, 5], wandAngle: 2.2, off: [-2, 5], trail: 3, footA: [2, 0], footB: [-3, 0], tip: 0.9 }),
    ];
  }
  return [
    pose({ bob: 1, flare: 0.5, hand: [-2, 4], off: [2, 4], wandAngle: 2.4, trail: 2 }),
    pose({ bob: 2, flare: 1.5, hand: [-3, 3], off: [3, 3], wandAngle: 2.6, trail: 4, footA: [-3, -1], footB: [2, -1] }),
    pose({ bob: 1, flare: 0.5, hand: [-1.5, 5], off: [1.5, 5], wandAngle: 2.3, trail: 2 }),
  ];
}

function hitPoses(dir: Dir): Pose[] {
  if (dir === 'east') {
    return [
      pose({ lean: -2, bob: 1, headX: -1, hand: [-2, 3], wandAngle: 2.6, off: [-3, 3], tip: 0.5 }),
      pose({ lean: -1, hand: [0, 5], wandAngle: 1.2, off: [-2, 5], tip: 0.6 }),
    ];
  }
  return [
    pose({ bob: 1, headY: -1, hand: [-2.5, 3.5], off: [2.5, 3.5], wandAngle: 2.8, tip: 0.5, flare: 0.5 }),
    pose({ hand: [-1.5, 5], off: [1.5, 5], wandAngle: 2.3, tip: 0.6 }),
  ];
}

function deathFrames(): Frame[] {
  const out: Frame[] = [];
  out.push(render('south', pose({ bob: 1, headY: -1, hand: [-3, 3], off: [3, 3], wandAngle: 2.9, tip: 0.6, flare: 0.5 })));
  out.push(render('south', pose({ bob: 2, crouch: 1, headY: 1, hand: [-2, 5], off: [2, 5], wandAngle: 2.4, tip: 0.45, flare: 1 })));
  const kneel = pose({ bob: 2, crouch: 4, headY: 1, hand: [-3, 5], off: [3, 5], wandAngle: 2.7, tip: 0.3, flare: 2, footA: [-3, -1], footB: [2, -1] });
  out.push(render('south', kneel));
  // slumping sideways (RotSprite keeps the pixel clusters intact), then collapsed on the ground
  out.push(settle(rotFrame(finish(DRAW.south({ ...kneel, tip: 0.2, headY: 2 })), -0.4, 16, 28), 0));
  out.push(finish(drawFallen(0)));
  out.push(finish(drawFallen(1)));
  return out;
}

/** Collapsed on her side, seen from the elevated camera: pooled robe, hood to the left, wand dropped. */
function drawFallen(t: number): Frame {
  const f = new Frame(SORC_W, SORC_H);
  const s = new Sculpt();
  const lift = t < 1 ? 1.5 : 0;
  s.ell(17.5, 27.2, 8.5 - lift, 2.4, { ...robeStyle, cyl: 0 }); // pooled skirt
  s.ell(12.8, 25.6 - lift, 4.2, 2.6, capeStyle); // shoulders / capelet
  s.cap(14, 26.5 - lift, 20, 28.2, 1.1, 1.5, sleeveStyle); // arm flung out
  s.ell(8.2, 25.2 - lift * 1.4, 3.3, 2.9, hoodStyle); // hood
  s.poly([[6.2, 23.6 - lift * 1.4], [8.6, 22.8 - lift * 1.4], [4.2, 21.2 - lift * 1.6]], { ...hoodStyle, bias: 0.2 }, 1.2);
  s.render(f.c, f.e);
  // face turned down into the hood, hair spilling across the ground
  const hy = Math.round(26 - lift * 1.4);
  px(f, 9, hy - 1, C.ink);
  px(f, 10, hy - 1, C.wineDeep);
  px(f, 9, hy, C.skinShadow);
  px(f, 10, hy, C.skinDeep);
  const hair: [number, number, Color][] = [
    [11, hy + 1, C.bone], [12, hy + 1, C.parchment], [13, hy + 2, C.bone], [10, hy + 1, C.hairMid],
    [11, hy + 2, C.hairMid], [14, hy + 2, C.hairMid], [9, hy + 1, C.bone], [12, hy + 2, C.hairShadow],
  ];
  for (const [x, y, c] of hair) px(f, x, y, c);
  // sash and hem trim across the pooled robe
  for (let x = 12; x <= 25; x++) {
    const y = x < 17 ? 28 : 29;
    if (f.c.opaque(x, y)) px(f, x, y, x % 5 === 0 ? C.wineMid : C.burgundy);
  }
  hand(f, 20, 28, true);
  // wand rolled a little away, tip fading out
  for (let i = 0; i < 6; i++) px(f, 22 + i, 26 - (i >> 2), i < 2 ? C.woodDark : C.woodLight);
  if (t < 1) f.glow(28, 25, C.ember, 170);
  else f.glow(28, 25, C.lavaDark, 110);
  return f;
}

/** Move a frame so its lowest opaque row sits on the ground line. */
function settle(f: Frame, dy: number): Frame {
  const bb = f.c.bounds();
  if (!bb) return f;
  const shift = Math.min(FEET + dy - bb.y1, SORC_H - 1 - bb.y1);
  const out = new Frame(f.w, f.h);
  out.c.blit(f.c, 0, shift, { replace: true });
  out.e.blit(f.e, 0, shift, { replace: true });
  return out;
}

export function sorceressSprites(): SpriteDef[] {
  const spec = (fps: number, loop: boolean) => ({ anchorX: SORC_AX, anchorY: SORC_AY, fps, loop });
  const out: SpriteDef[] = [];
  const dirs: Dir[] = ['south', 'north', 'east'];
  const anims: [string, (d: Dir) => Pose[], number, boolean][] = [
    ['idle', idlePoses, 5, true],
    ['run', runPoses, 12, true],
    ['cast', castPoses, 12, false],
    ['dash', dashPoses, 14, false],
    ['hit', hitPoses, 10, false],
  ];
  for (const [name, poses, fps, loop] of anims) {
    for (const d of dirs) out.push(toSprite(`sorceress/${name}/${d}`, poses(d).map((p) => render(d, p)), spec(fps, loop)));
  }
  out.push(toSprite('sorceress/death/south', deathFrames(), spec(8, false)));
  return out;
}
