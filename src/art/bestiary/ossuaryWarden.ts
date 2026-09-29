// The Hollow Warden — the Rimed Ossuary boss. A towering rime-lich that floats a hand's breadth above the floor:
// tattered frost-navy robes rimed white at every ragged edge, a mantle bristling with ice spikes, a high jagged
// collar framing a long skull that wears a crown of glacier ice on a blackened iron band, burning white eyes and a
// beard of icicles hanging from its jaw. The robe hangs open at the chest over an empty ribcage lit faintly from
// inside — hollow. In its bony hand it bears a shepherd's crook of black iron, and from the crook hangs a frozen
// lantern: a cage of iron around a trapped soul-flame, the brightest cold light in the ossuary.
//
// Silhouette: a tall inverted-V (spiked shoulders and crown on top, a flaring robe below) with the crook towering
// over it — readable at 1x as "boss" and never confusable with the spidery Cinder Matriarch.
//
//   idle (loop)  hover bob, the lantern swings, the soul-flame flickers, tatters ripple.
//   move (loop)  glides forward, robes and cape stream behind, the lantern swings back.
//   windup       the nova telegraph: the Warden rises off the floor, robes lifting and rippling, hauls the crook high
//                and spreads its free hand up towards the flaring lantern while frost motes converge on it.
//   attack       it drops and drives the crook down: the lantern flashes and the nova bursts out beneath it — a wide
//                flattened ring (radius 22 px at full) centred under the anchor, with ice spikes erupting along it.
//   cast         the free hand thrusts forward, fingers spread, and a ring of frost runes forms before the palm
//                (Ice Prison, Glacial Spikes, summons); the crook stays planted ahead of the body, clear of the head.
//                Holds on the last frame.
//   corpse       the Warden sinks, the robes crumple, the crook falls and the lantern gutters; the heap rimes over.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Ramp } from '../palette';
import { lineCells } from '../raster';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { anim, finish, monsterSprites, onBody, px, squash } from '../monsters/common';
import { BONE, COLD_WHITE, ICE, ROBE, rimeify, rune } from './ossuaryKit';

const W = 68;
const H = 86;
const FEET = 82;
const OY = 10; // headroom above the crook when it is hauled overhead
const BX = 27; // body centre

const robe: PrimStyle = { ramp: ROBE, bias: -0.25, dither: 0.03 };
const robeFar: PrimStyle = { ramp: ROBE, bias: -1.1, dither: 0 };
const mantleStyle: PrimStyle = { ramp: ROBE, bias: 0.35, dither: 0 };
const collarStyle: PrimStyle = { ramp: ROBE, bias: -0.2, dither: 0.06 };
const skullStyle: PrimStyle = { ramp: BONE, bias: 0.6, dither: 0 };
const jawStyle: PrimStyle = { ramp: BONE, bias: 0.1, dither: 0 };
const boneArm: PrimStyle = { ramp: BONE, bias: -0.1, dither: 0 };
const boneArmFar: PrimStyle = { ramp: BONE, bias: -0.8, dither: 0 };
const CAVITY: Ramp = [C.ink, C.frostDeep, C.ossDeep, C.frostDark];
const cavity: PrimStyle = { ramp: CAVITY, bias: -0.3, dither: 0, ao: false };
const ribStyle: PrimStyle = { ramp: BONE, bias: 1, dither: 0, ao: false };
const iceSpike = (glow: number, bias = 0.5): PrimStyle => ({ ramp: ICE, bias, glow, ao: false, dither: 0.05 });
const bandStyle: PrimStyle = { ramp: [C.metalDeep, C.metalDark, C.metal, C.metalMid, C.metalLight, C.metalHi], bias: 0.6, dither: 0 };

type Pt = [number, number];
interface P {
  bob: number; // hover offset (+ = down)
  lean: number; // + = forward
  trail: number; // robe and cape streaming back
  wave: number; // tatter ripple phase 0..1
  staffTop: Pt; // top of the shaft (the crook curls forward from here); y authored without headroom
  staffBase: Pt; // y in frame space (usually FEET-relative)
  swing: number; // lantern pendulum (px, + = forward)
  handF: Pt; // free (far) hand; y authored without headroom
  spread: number; // 0..1 free hand fingers spread (cast)
  eyes: number; // 0..1.3
  crown: number; // 0..1.3
  light: number; // lantern 0..1.4
  flicker: number; // soul-flame variant 0..2
  sigil: number; // 0..1 cast rune ring (0 = none)
  sigilSpin: number; // rune ring rotation phase
  flash: number; // 0..1 lantern flare rays
  burst: number; // 0..1 frost burst at the crook's foot
  motes: number; // gathering frost motes (windup) 0..1, -1 = none
  sink: number; // corpse: 0..1 the lich sinks into its robes
}

const base: P = {
  bob: 0,
  lean: 0,
  trail: 0.5,
  wave: 0,
  staffTop: [43, 9],
  staffBase: [45, FEET],
  swing: 0,
  handF: [BX + 10, 47],
  spread: 0,
  eyes: 0.85,
  crown: 0.8,
  light: 0.9,
  flicker: 0,
  sigil: 0,
  sigilSpin: 0,
  flash: 0,
  burst: 0,
  motes: -1,
  sink: 0,
};
const pose = (p: Partial<P>): P => ({ ...base, ...p });

/** Step a robe/ramp colour one shade darker (fold shadows); other colours pass through. */
function darker(c: number): number {
  const i = ROBE.indexOf(c);
  return i > 0 ? ROBE[i - 1] : c;
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const sink = p.sink * 17;
  const bx = BX + p.lean * 1.2;
  const by = p.bob + sink + OY; // offsets everything above the hem
  const mid = OY + p.bob * 0.6 + sink * 0.7; // robe flanks move less than the shoulders
  const hx = bx + 3 + p.lean * 2; // skull centre
  const hy = 24 + by + p.lean * 0.6;
  const shN: Pt = [bx - 4.5 + p.lean, 33 + by];
  const shF: Pt = [bx + 5 + p.lean, 31.5 + by];
  const wv = (k: number): number => Math.sin((p.wave + k) * Math.PI * 2);
  const hem = FEET - 1 + Math.min(0, p.bob) * 0.75; // rising into the nova lifts the whole robe off the floor
  const staffTop: Pt = [p.staffTop[0], p.staffTop[1] + OY];
  const handF: Pt = [p.handF[0], p.handF[1] + OY];
  const [sx0, sy0] = p.staffBase;
  const [sx1, sy1] = staffTop;

  // --- back layer: cape tatters streaming behind -----------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const x0 = bx - 6 + i * 1.5;
    const y0 = 34 + by + i * 2;
    const tx = bx - 15 - p.trail * (1.2 - i * 0.2) - i * 1.5;
    const ty = hem - 4 - i * 5 + wv(i * 0.3) * 1.5 + p.trail * 0.8;
    s.cap(x0, y0, tx, Math.min(hem - 1, ty), 3.2 - i * 0.5, 0.6, { ...robeFar, bias: -0.8 + i * 0.25 });
  }
  // ice spikes on the far shoulder, behind the collar
  const spikeGlow = 70 + 60 * Math.min(1, p.crown);
  const shoulderSpike = (ox: number, oy: number, tx: number, ty: number, w: number, st: PrimStyle): void => {
    const a: Pt = [bx + ox + p.lean, oy + by];
    const t: Pt = [bx + tx + p.lean - p.trail * 0.2, ty + by];
    const nx = -(t[1] - a[1]);
    const ny = t[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    s.poly([[a[0] - (nx / l) * w, a[1] - (ny / l) * w], [a[0] + (nx / l) * w, a[1] + (ny / l) * w], t], st, 1.1, -0.4, -0.2);
  };
  shoulderSpike(6, 30.5, 11.5, 19, 1.7, iceSpike(spikeGlow * 0.7, 0));
  shoulderSpike(8.5, 31.5, 14.5, 24, 1.4, iceSpike(spikeGlow * 0.7, -0.2));
  // --- far arm (behind the robe unless raised forward) ------------------------------------------------------------
  const farRaised = handF[1] < 42 + by;
  const eF: Pt = farRaised ? [(shF[0] + handF[0]) / 2 + 1, Math.max(shF[1], handF[1]) + 2] : [(shF[0] + handF[0]) / 2 + 1.5, (shF[1] + handF[1]) / 2 + 1];
  const drawFarArm = (t: Sculpt): void => {
    t.cap(shF[0], shF[1], eF[0], eF[1], 3, 3.9, { ...robeFar, bias: farRaised ? -0.3 : -1 });
    t.cap(eF[0], eF[1], handF[0], handF[1], 1.3, 1.1, farRaised ? boneArm : boneArmFar);
    t.ell(handF[0], handF[1], 1.7, 1.5, farRaised ? boneArm : boneArmFar);
  };
  if (!farRaised) drawFarArm(s);
  // --- the robe: flaring, floating, ragged, trailing when it glides -----------------------------------------------
  const front = bx + 15 + p.lean * 1.5 - p.trail * 0.3;
  const rpts: Pt[] = [[bx - 7.5, 32 + by], [bx + 7, 31 + by], [bx + 11 + p.lean, 50 + mid], [front, hem - 3]];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = front - u * (31 + p.trail * 1.2) + (i % 2 ? (hash2(i, 2, 7) - 0.5) * 1.2 : 0);
    // tatters: every other point is a notch whose depth varies strip to strip; the tips hang at uneven lengths
    const depth = 1 + hash2(i, 0, 7) * 4;
    const y = hem - (i % 2 === 0 ? hash2(i, 1, 7) * 1.4 : depth + wv(u) * 0.8) - u * p.trail * 0.8 - (u > 0.88 ? 1.5 : 0);
    rpts.push([x, y]);
  }
  rpts.push([bx - 15 - p.trail * 1.1, 54 + mid]);
  const robeIx = s.size;
  s.poly(rpts, { ...robe, cyl: 0.75 }, 2.2);
  // open chest: an empty ribcage in a dark hollow, lit faintly from inside
  s.poly([[bx + 2.5, 33 + by], [bx + 9, 32.5 + by], [bx + 8, 46 + by], [bx + 4.5, 47 + by]], cavity, 1.5);
  for (let i = 0; i < 3; i++) {
    const y = 36.5 + by + i * 3.3;
    s.cap(bx + 3.2, y, bx + 8.6 - i * 0.6, y + 0.7, 0.8, 0.65, ribStyle);
  }
  s.cap(bx + 3.4, 34 + by, bx + 3.8, 45 + by, 0.7, 0.6, { ...ribStyle, bias: 0.3 }); // sternum
  // --- mantle: broad layered shoulder cape with a tattered edge ----------------------------------------------------
  const mpts: Pt[] = [[bx - 3, 28 + by], [bx + 6, 28 + by], [bx + 11.5 + p.lean, 35 + by]];
  for (let i = 0; i <= 7; i++) {
    const u = i / 7;
    mpts.push([bx + 11.5 + p.lean - u * (25 + p.trail * 0.6), 39.5 + by + (i % 2 === 0 ? 1.5 : -1) + wv(u + 0.4) * 0.6 + u * p.trail * 0.4]);
  }
  mpts.push([bx - 13 - p.trail * 0.5, 33 + by]);
  const mantleIx = s.size;
  s.poly(mpts, mantleStyle, 2, 0, -0.3);
  // ice spikes bristling from the near shoulder
  shoulderSpike(-7.5, 31.5, -14.5, 20, 1.9, iceSpike(spikeGlow, 0));
  shoulderSpike(-4.5, 29.5, -8.5, 14, 2.4, iceSpike(spikeGlow, 0.15));
  shoulderSpike(-1.5, 29, -2.5, 18.5, 1.7, iceSpike(spikeGlow, 0));
  // --- high jagged collar behind the skull ----------------------------------------------------------------------------
  s.poly([[hx - 5, hy + 8], [hx - 10, hy - 6], [hx - 6.5, hy - 3], [hx - 6, hy - 11.5], [hx - 2.5, hy - 5], [hx + 0.5, hy + 7]], collarStyle, 1.4);
  // --- skull, jaw ------------------------------------------------------------------------------------------------------
  s.ell(hx, hy, 4.6, 5.4, skullStyle, 0.1);
  s.ell(hx + 1.8, hy + 5, 3.1, 1.8, jawStyle, 0.15);
  // --- crown: iron band with five glacier spikes ------------------------------------------------------------------
  const crownG = 90 + 120 * Math.min(1, p.crown);
  const spikes: [number, number, number][] = [
    [-4.3, 5, 1.3],
    [-2.2, 8, 1.5],
    [0.4, 11.5, 1.8],
    [2.9, 8, 1.5],
    [4.8, 5, 1.2],
  ];
  const band = hy - 4;
  for (const [dx, h, w] of spikes) {
    const x = hx + dx;
    const y = band + Math.abs(dx) * 0.15;
    s.poly([[x - w, y], [x + w, y], [x + dx * 0.12, y - h]], iceSpike(crownG), 0.8, -0.3, -0.2);
  }
  s.cap(hx - 4.8, band + 0.6, hx + 5, band + 0.2, 1, 1, bandStyle);
  // --- near arm: a wide tattered sleeve hanging to the elbow, a skeletal forearm up to the crook ------------------
  const grip: Pt = [sx0 + (sx1 - sx0) * 0.45, sy0 + (sy1 - sy0) * 0.45];
  const elbow: Pt = [Math.min(grip[0] - 7, shN[0] + 7), Math.max(grip[1] + 4, shN[1] + 13)];
  s.cap(shN[0], shN[1], elbow[0], elbow[1], 3.4, 4.6, { ...robe, bias: 0.3 });
  s.poly([[elbow[0] - 4.5, elbow[1] - 1], [elbow[0] + 4, elbow[1] - 2], [elbow[0] + 2.5, elbow[1] + 5 + wv(0.2) * 0.6], [elbow[0] + 0.5, elbow[1] + 3], [elbow[0] - 1.5, elbow[1] + 7 + wv(0.5) * 0.8], [elbow[0] - 3.5, elbow[1] + 3]], { ...robe, bias: 0.1 }, 1.2);
  s.cap(elbow[0] + 1.5, elbow[1] - 1, grip[0] - 1, grip[1], 1.2, 1, boneArm);
  const owner = s.render(f.c, f.e);

  // drapery: fold shadows running down the robe
  for (const [x0, y0, x1, y1] of [
    [bx - 5, 47 + mid, bx - 8, hem - 3],
    [bx + 1, 48 + mid, bx + 1.5, hem - 2],
    [bx + 7, 49 + mid, bx + 10, hem - 3],
    [bx - 10, 55 + mid, bx - 13, hem - 4],
  ] as const) {
    lineCells(x0, y0, x1, y1, (x, y) => {
      if (owner[y * W + x] === robeIx) f.c.set(x, y, darker(darker(f.c.get(x, y))));
    });
  }
  // rime along the mantle's tattered rim
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (owner[y * W + x] !== mantleIx || owner[(y + 1) * W + x] === mantleIx) continue;
      f.glow(x, y, (x + y) % 4 === 0 ? C.ice : C.ossFrost, 60);
    }
  }

  // --- the crook: black iron shaft, rime flecks, the hook curling forward ------------------------------------------
  lineCells(sx0, sy0, sx1, sy1, (x, y) => {
    if (Math.abs(y - grip[1]) <= 1 && Math.abs(x - grip[0]) <= 2) return;
    px(f, x, y, (y * 7) % 11 === 0 ? C.ossFrost : C.metalMid);
    px(f, x + 1, y, (y * 7) % 11 === 0 ? C.ossPale : C.metalDark);
  });
  const hook: Pt[] = [];
  for (let a = Math.PI; a >= -0.55; a -= 0.18) hook.push([sx1 + 3.4 + Math.cos(a) * 3.4, sy1 - Math.sin(a) * 3.4]);
  for (let i = 0; i + 1 < hook.length; i++) {
    lineCells(hook[i][0], hook[i][1], hook[i + 1][0], hook[i + 1][1], (x, y) => px(f, x, y, i < 4 ? C.metalLight : C.metalMid));
  }
  const tip = hook[hook.length - 1];
  // bony hand over the shaft
  const hs = new Frame(W, H);
  new Sculpt().ell(grip[0] + 0.5, grip[1], 1.9, 1.7, boneArm).render(hs.c, hs.e);
  f.draw(hs, 0, 0);
  px(f, grip[0] + 2, grip[1] + 1, C.ashGrey);
  // a raised free arm reads best clear of the shaft: drawn over it
  if (farRaised) {
    const fa = new Frame(W, H);
    const t = new Sculpt();
    drawFarArm(t);
    t.render(fa.c, fa.e);
    f.draw(fa, 0, 0);
  }

  // --- details on the body ---------------------------------------------------------------------------------------
  // hollow light inside the ribcage
  for (let y = Math.round(33 + by); y <= Math.round(47 + by); y++) {
    for (let x = Math.round(bx + 2); x <= Math.round(bx + 9); x++) {
      const c = f.c.get(x, y);
      if (c === C.ink || c === C.frostDeep || c === C.ossDeep || c === C.frostDark) {
        // the hollow soul-light shows only in the gaps between the ribs (ink rows stay dark around the bars)
        const d = Math.hypot(x - (bx + 6), (y - (40 + by)) * 0.55);
        const nextToRib = BONE.includes(f.c.get(x, y - 1)) || BONE.includes(f.c.get(x, y + 1));
        if (d < 4.2 && !nextToRib) f.glow(x, y, d < 1.6 ? C.frost : d < 2.8 ? C.mana : C.frostMid, (200 - d * 28) * Math.min(1.1, p.light));
      }
    }
  }
  // skull: brow ridge, 2x2 ink sockets with 2 px burning eyes and a frost halo on the rims, sunken cheek, nasal
  // hollow and a lipless grin
  const ex = Math.round(hx + 1);
  const ey = Math.round(hy + 0.5);
  const blaze = p.eyes > 1;
  for (const [dx, dy] of [[-2, 2], [-1, 2], [-2, 3], [-1, 3], [0, 3], [-3, 1], [-3, 2]] as const) onBody(f, ex + dx, ey + dy, C.hairShadow); // cheek plane
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0], [2, -1], [3, -1], [2, 0], [3, 0], [1, 2], [2, 2], [1, 3]] as const) onBody(f, ex + dx, ey + dy, dy >= 2 ? C.ossDeep : C.ink);
  for (const [dx, dy] of [[-2, -2], [-1, -2], [0, -2], [2, -2], [3, -2]] as const) onBody(f, ex + dx, ey + dy, C.parchment);
  const eyeG = 255;
  f.glow(ex, ey - 1, blaze ? COLD_WHITE : C.ice, eyeG);
  f.glow(ex, ey, C.ice, eyeG);
  f.glow(ex + 3, ey - 1, blaze ? COLD_WHITE : C.ice, eyeG);
  f.glow(ex + 3, ey, C.ice, eyeG * 0.95);
  // frost halo in the socket rims
  for (const [dx, dy] of [[-2, -1], [-2, 0], [-1, 1], [0, 1], [1, -1], [1, 0], [4, -1], [4, 0], [3, 1], [2, 1]] as const) {
    if (f.c.opaque(ex + dx, ey + dy) && !f.e.opaque(ex + dx, ey + dy)) f.emit(ex + dx, ey + dy, C.frost, (70 + 90 * Math.min(1.3, p.eyes)) * (blaze ? 1.2 : 1));
  }
  if (blaze) {
    f.glow(ex - 1, ey - 1, C.frost, 200);
    f.glow(ex + 2, ey - 1, C.frost, 190);
  }
  for (let x = ex - 1; x <= ex + 4; x++) onBody(f, x, ey + 4, x % 2 ? C.ossDeep : C.parchment);
  // icicle beard hanging from the jaw
  for (const [dx, len] of [[0, 2], [1, 4], [2, 3], [3, 2]] as const) {
    const x = Math.round(hx + 1.2 + dx);
    const y0 = Math.round(hy + 6.5);
    for (let i = 0; i < len; i++) {
      const c = i === len - 1 ? (len > 3 ? COLD_WHITE : C.ice) : C.frost;
      f.glow(x, y0 + i, c, 100 + i * 30);
    }
  }
  // crown: glinting spike tips and a set gem of ice in the band
  for (const [dx, h] of spikes) {
    const x = Math.round(hx + dx + dx * 0.12);
    const y = Math.round(band + Math.abs(dx) * 0.15 - h + 1);
    if (f.c.opaque(x, y)) f.glow(x, y, p.crown > 0.95 ? COLD_WHITE : C.ice, 255);
  }
  onBody(f, Math.round(hx - 2), Math.round(band), C.metalHi);
  f.glow(Math.round(hx + 0.5), Math.round(band + 0.4), C.ice, 230);
  f.glow(Math.round(hx + 1.5), Math.round(band + 0.4), C.frost, 180);
  // the robe's front opening: a rimed seam from the hollow chest to the hem, stitched with runes
  lineCells(bx + 7.5, 47 + by, front - 3, hem - 4, (x, y) => {
    if (owner[y * W + x] !== robeIx) return;
    f.c.set(x, y, C.ossMid);
    if (owner[y * W + x + 1] === robeIx) f.c.set(x + 1, y, C.frostDeep);
    if ((y * 3) % 7 === 0) f.glow(x, y, C.frost, 90 + 80 * Math.min(1, p.light));
  });
  // rime along the ragged hem and a band of faint frost runes above it
  for (let x = 0; x < W; x++) {
    for (let y = FEET - 14; y <= FEET; y++) {
      if (owner[y * W + x] !== robeIx || f.c.opaque(x, y + 1)) continue;
      const h = hash2(x, 0, 11);
      if (h > 0.4) f.glow(x, y, h > 0.8 ? C.ossFrost : C.ossPale, 50 + h * 30);
      if (h > 0.93 && y + 1 < H) f.glow(x, y + 1, C.ice, 110); // a drip of ice
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = Math.round(bx - 11 + i * 3.8 + p.lean);
    const y = Math.round(FEET - 8 - (i % 2) - Math.abs(i - 3) * 0.3 - (i / 6) * p.trail * 0.6);
    if (owner[y * W + x] === robeIx) f.glow(x, y, C.frost, 100 + 70 * Math.min(1, p.light));
  }

  // --- the frozen lantern hanging from the crook ---------------------------------------------------------------------
  const lx = Math.round(tip[0] + p.swing);
  const ly = Math.min(Math.round(tip[1] + 2), FEET - 14);
  lineCells(tip[0], tip[1], lx, ly, (x, y) => px(f, x, y, C.metalLight));
  lantern(f, lx, ly + 1, p.light, p.flicker);
  // the lantern's cold light spills onto everything near it
  const lcx = lx;
  const lcy = ly + 6;
  for (let y = lcy - 14; y <= lcy + 14; y++) {
    for (let x = lcx - 14; x <= lcx + 14; x++) {
      if (!f.c.opaque(x, y) || f.e.opaque(x, y)) continue;
      const d = Math.hypot(x - lcx, y - lcy);
      if (d > 13) continue;
      f.emit(x, y, C.frost, (1 - d / 13) * 100 * Math.min(1.2, p.light));
    }
  }
  if (p.flash > 0) {
    const rays: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of rays) {
      const len = (dx && dy ? 4 : 7) * p.flash + 2;
      for (let i = 6; i <= 6 + len; i++) {
        const k = 1 - (i - 6) / (len + 1);
        f.glow(lcx + dx * i, lcy + dy * i, i < 8 ? COLD_WHITE : i < 10 ? C.ice : C.frost, 255 * k);
      }
    }
  }
  // --- cast: long fingers spread, a ring of frost runes forming before the palm ---------------------------------
  if (p.spread > 0) {
    const [fx, fy] = handF;
    for (const [dx, dy] of [[2, -3], [3, -1.5], [3.5, 0.5], [2.5, 2.5], [0.5, -3.5]] as const) {
      const k = p.spread;
      lineCells(fx + 0.5, fy, fx + 0.5 + dx * k, fy + dy * k, (x, y) => px(f, x, y, C.bone));
    }
  }
  if (p.sigil > 0) {
    const cx = handF[0] + 8;
    const cy = handF[1];
    const R = 3 + p.sigil * 6;
    const g = 150 + 105 * p.sigil;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const x = Math.round(cx + Math.cos(a) * R * 0.45);
      const y = Math.round(cy + Math.sin(a) * R);
      if (Math.floor((a / (Math.PI * 2) + p.sigilSpin) * 10) % 5 !== 4) f.glow(x, y, p.sigil > 0.8 ? C.ice : C.frost, g);
    }
    if (p.sigil > 0.45) {
      const r2 = R * 0.55;
      for (let a = 0; a < Math.PI * 2; a += 0.12) f.glow(Math.round(cx + Math.cos(a) * r2 * 0.45), Math.round(cy + Math.sin(a) * r2), C.mana, g * 0.8);
      for (let k = 0; k < 3; k++) {
        const a = p.sigilSpin * Math.PI * 2 + (k / 3) * Math.PI * 2 - Math.PI / 2;
        rune(f, k + 1, cx + Math.cos(a) * (R + 3) * 0.5, cy + Math.sin(a) * (R + 3), p.sigil > 0.8 ? C.ice : C.frost, g);
      }
      f.glow(Math.round(cx), Math.round(cy), COLD_WHITE, 255);
      f.glow(Math.round(cx), Math.round(cy) - 1, C.ice, 230);
      f.glow(Math.round(cx), Math.round(cy) + 1, C.ice, 230);
    }
  }
  // --- windup: frost motes converging on the lantern ---------------------------------------------------------------
  if (p.motes >= 0) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + p.motes * 1.4;
      const r = 15 * (1 - p.motes) + 8;
      const x = Math.round(lcx + Math.cos(a) * r);
      const y = Math.round(lcy + Math.sin(a) * r * 0.8);
      f.glow(x, y, k % 2 ? C.ice : C.frost, 220);
      if (p.motes < 0.7) f.glow(x - Math.round(Math.cos(a) * 1.5), y - Math.round(Math.sin(a) * 1.2), C.mana, 150);
    }
  }
  finish(f);
  // --- attack: the nova — a wide flattened ring of frost bursting out under the Warden, ice spikes along it (drawn
  // after the outline: clean light, no ink)
  if (p.burst > 0) {
    const R = 6 + p.burst * 16;
    const g = 240 * (1.15 - p.burst * 0.35);
    for (let a = 0; a < Math.PI * 2; a += 0.04) {
      const x = Math.round(BX + Math.cos(a) * R);
      const y = Math.round(FEET + Math.sin(a) * R * 0.3);
      if (y > FEET + 1 || x < 0 || x >= W) continue;
      f.glow(x, y, Math.sin(a) > 0 ? C.ice : C.frost, g);
      if (Math.sin(a) > 0.3) f.glow(x, y - 1, C.mana, g * 0.5); // the ring's near edge is thicker
    }
    // ice spikes erupting along the ring (taller in front, where the ring comes towards the viewer)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const x = Math.round(BX + Math.cos(a) * R);
      const y = Math.round(FEET + Math.sin(a) * R * 0.3);
      if (y > FEET + 1 || x < 1 || x >= W - 1) continue;
      const hgt = Math.round((2 + (Math.sin(a) > 0 ? 3 : 1) + (k % 2)) * Math.min(1, p.burst * 1.6) * (1.2 - p.burst * 0.3));
      for (let i = 0; i < hgt; i++) {
        f.glow(x, y - i, i === hgt - 1 ? COLD_WHITE : C.ice, 255);
        if (i < hgt - 2) f.glow(x + 1, y - i, C.frost, 220);
      }
    }
    // the crook's foot flashes where it struck
    for (const [dx, dy, c] of [[-1, -1, COLD_WHITE], [0, -3, C.ice], [1, -2, COLD_WHITE], [-3, -2, C.frost], [3, -1, C.ice]] as const) {
      f.glow(Math.round(sx0) + dx, FEET + dy, c, 255 * (1.1 - p.burst * 0.5));
    }
  }
  // cold mist under the hem: a faint, broken wash of glow (alpha <= 40, unoutlined), so the floor shows through and
  // the presenter's shadow does the grounding
  if (p.sink < 0.5) {
    for (let x = Math.round(bx - 15 - p.trail); x <= Math.round(front); x++) {
      const k = 0.5 + 0.5 * Math.sin(x * 0.7 + p.wave * Math.PI * 2);
      if (k < 0.4 || hash2(x, Math.round(p.wave * 6), 13) < 0.45) continue;
      f.glowSoft(x, FEET, C.frost, 0.16 * k, 40 * k);
    }
  }
  return f;
}

/** The frozen lantern: an iron cage around a trapped soul-flame, icicles hanging beneath. (x, y) = top centre. */
function lantern(f: Frame, x: number, y: number, light: number, flicker: number): void {
  const L = Math.min(1.4, light);
  const g = 160 + 95 * Math.min(1, L);
  // cap and ring
  px(f, x, y, C.metalHi);
  for (let dx = -2; dx <= 2; dx++) px(f, x + dx, y + 1, dx < 0 ? C.metalLight : C.metalMid);
  for (let dx = -3; dx <= 3; dx++) px(f, x + dx, y + 2, dx < 0 ? C.metalMid : C.metal);
  // cage: posts and bottom
  for (let dy = 3; dy <= 9; dy++) {
    px(f, x - 3, y + dy, C.metalLight);
    px(f, x + 3, y + dy, C.metal);
  }
  for (let dx = -3; dx <= 3; dx++) px(f, x + dx, y + 10, dx < 0 ? C.metalMid : C.metalDark);
  px(f, x - 1, y + 11, C.metal);
  px(f, x, y + 11, C.metalMid);
  px(f, x + 1, y + 11, C.metalDark);
  // the soul-flame: a tall cold flame that flickers between shapes
  const shapes: string[][] = [
    ['..i..', '.iWi.', 'fiWif', 'fiWif', 'mfifm', 'mfffm', '.mmm.'],
    ['.i...', '.iWi.', 'fiWWf', 'fiWif', 'mfifm', 'mfffm', '.mmm.'],
    ['...i.', '.iWi.', 'fWWif', 'fiWif', 'mfWfm', 'mfffm', '.mmm.'],
  ];
  const shape = shapes[Math.floor(flicker) % shapes.length];
  shape.forEach((row, dy) =>
    [...row].forEach((ch, i) => {
      const X = x - 2 + i;
      const Y = y + 3 + dy;
      if (ch === 'W') f.glow(X, Y, COLD_WHITE, 255);
      else if (ch === 'i') f.glow(X, Y, C.ice, g);
      else if (ch === 'f') f.glow(X, Y, C.frost, g * 0.9);
      else if (ch === 'm') f.glow(X, Y, C.mana, g * 0.8);
      else f.glow(X, Y, C.frostMid, g * 0.5); // cold smoke in the cage corners
    }),
  );
  // the central post in front of the flame
  px(f, x, y + 3, C.metalMid);
  // icicles under the lantern
  for (const [dx, len] of [[-2, 2], [0, 3], [2, 2]] as const) {
    for (let i = 1; i <= len; i++) f.glow(x + dx, y + 11 + i, i === len ? COLD_WHITE : C.ice, 120 + i * 30);
  }
}

export function hollowWardenSprites(): SpriteDef[] {
  const hover = [0, 0, 1, 1, 1, 0];
  const idle = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(
      pose({
        bob: hover[i],
        wave: i / 6,
        swing: [0, 1, 1, 0, -1, -1][i],
        staffTop: [43, 10 + hover[i]],
        handF: [BX + 10, 47 + hover[i]],
        eyes: [0.8, 0.85, 0.95, 1, 0.95, 0.85][i],
        crown: [0.7, 0.8, 0.9, 0.95, 0.9, 0.8][i],
        light: [0.85, 0.95, 1, 0.9, 1, 0.95][i],
        flicker: i % 3,
      }),
    ),
  );
  // glide: leaning into it, robe and cape streaming behind, the lantern swinging back
  const move = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(
      pose({
        bob: [0, -1, -1, 0, -1, -1][i],
        lean: 1.2,
        trail: 3 + (i % 2) * 0.8,
        wave: i / 6,
        swing: [-1, -2, -2, -1, -2, -2][i],
        staffTop: [46, 10 + [0, -1, -1, 0, -1, -1][i]],
        staffBase: [50, FEET - 1],
        handF: [BX + 11, 47],
        light: 0.95,
        flicker: i % 3,
      }),
    ),
  );
  // nova telegraph: the crook hauled high, the lantern flaring, frost motes converging
  const windup = [
    draw(pose({ lean: -0.4, bob: -1.5, trail: 1.5, wave: 0.15, staffTop: [43, 4], staffBase: [45, FEET - 7], swing: 1, handF: [BX + 10, 38], eyes: 1, crown: 0.95, light: 1.05, motes: 0, flicker: 0 })),
    draw(pose({ lean: -0.9, bob: -3, trail: 2.5, wave: 0.4, staffTop: [42, -2], staffBase: [44, FEET - 15], swing: 1, handF: [BX + 17, 27], spread: 0.6, eyes: 1.15, crown: 1.1, light: 1.2, motes: 0.35, flicker: 1 })),
    draw(pose({ lean: -1.1, bob: -4, trail: 3, wave: 0.65, staffTop: [42, -4], staffBase: [44, FEET - 18], swing: 0, handF: [BX + 22, 19], spread: 1, eyes: 1.3, crown: 1.3, light: 1.35, motes: 0.7, flicker: 2 })),
    draw(pose({ lean: -1.1, bob: -4, trail: 3, wave: 0.9, staffTop: [42, -4], staffBase: [44, FEET - 18], swing: 0, handF: [BX + 22, 18], spread: 1, eyes: 1.3, crown: 1.3, light: 1.4, motes: 0.95, flicker: 0 })),
  ];
  // the crook driven down: lantern flash, frost burst at its foot
  const attack = [
    draw(pose({ lean: 1.5, bob: 2, trail: 1.5, wave: 0.2, staffTop: [47, 9], staffBase: [51, FEET], swing: 2, handF: [BX + 12, 44], spread: 0.6, eyes: 1.3, crown: 1.2, light: 1.4, flash: 1, burst: 0.3, flicker: 1 })),
    draw(pose({ lean: 1.5, bob: 2, trail: 1, wave: 0.45, staffTop: [47, 10], staffBase: [51, FEET], swing: 1, handF: [BX + 12, 46], eyes: 1.1, crown: 1, light: 1.2, flash: 0.5, burst: 0.7, flicker: 2 })),
    draw(pose({ lean: 0.8, bob: 1, trail: 0.6, wave: 0.7, staffTop: [45, 10], staffBase: [48, FEET], swing: 0, handF: [BX + 10, 47], eyes: 0.9, crown: 0.9, light: 1, burst: 1, flicker: 0 })),
  ];
  // the free hand thrust forward, a ring of frost runes forming before the palm; the lantern held high
  const castPose = (k: number, sigil: number, extra: Partial<P>): P =>
    pose({
      lean: 0.4 * k,
      trail: 2 * k,
      staffTop: [44, 8 - k * 3],
      staffBase: [46, FEET - k * 3],
      swing: -1,
      handF: [BX + 14 + k * 8, 44 - k * 13],
      spread: k,
      sigil,
      eyes: 1 + 0.3 * k,
      crown: 1 + 0.3 * k,
      light: 1.1 + 0.2 * k,
      ...extra,
    });
  const cast = [
    draw(castPose(0.35, 0, { flicker: 0, wave: 0.1 })),
    draw(castPose(0.75, 0.35, { flicker: 1, wave: 0.25, sigilSpin: 0.05 })),
    draw(castPose(1, 0.75, { flicker: 2, wave: 0.4, sigilSpin: 0.12 })),
    draw(castPose(1, 1, { flicker: 0, wave: 0.55, sigilSpin: 0.2, flash: 0.6 })),
    draw(castPose(1, 0.9, { flicker: 1, wave: 0.7, sigilSpin: 0.28 })),
  ];
  // death: the lich sinks into its robes, the crook falls, the lantern gutters; the heap rimes over
  const heap = draw(pose({ sink: 1, lean: 1.5, trail: 2, staffTop: [57, FEET - 4 - OY], staffBase: [24, FEET], swing: 0, handF: [BX + 12, FEET - 2], eyes: 0.2, crown: 0.3, light: 0.25, flicker: 0 }));
  const corpse = [
    draw(pose({ sink: 0.35, lean: 1, staffTop: [52, 18], staffBase: [44, FEET], swing: 3, handF: [BX + 11, 56], eyes: 0.9, crown: 0.8, light: 0.8, flicker: 1 })),
    draw(pose({ sink: 0.75, lean: 1.4, trail: 1, staffTop: [56, 44], staffBase: [36, FEET], swing: 2, handF: [BX + 12, 64], eyes: 0.5, crown: 0.5, light: 0.5, flicker: 2 })),
    rimeify(heap, 0.35, 0.6),
    rimeify(squash(heap, 0.85, FEET), 0.75, 0.25),
  ];
  return monsterSprites({
    id: 'hollowWarden',
    anchorX: BX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 7, true),
      windup: anim(windup, 5, false),
      attack: anim(attack, 9, false),
      cast: anim(cast, 7, false),
      corpse: anim(corpse, 5, false),
    },
  });
}

