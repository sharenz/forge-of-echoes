// Props, bottom-centre anchored.
//
// Frame conventions (fps tells the presenter how to pick frames):
//   fps > 0, loop  → animated by time: portal, returnPortal, brazier, merchant, banner, anvil (the Crafting
//                     Bench's ember flicker).
//   fps = 0        → frames are states or variants:
//                     mapDevice, chest: frame = PropView.state (0 inactive/closed, 1 active/open)
//                     pillar, standingStone, rubble, bones, crystal, ruinWall: frame = PropView.variant % frames
//                     stash: single frame
//
// The Crafting Bench ('prop/anvil', 42x36, anchor (21,35), 4 frames @5 fps loop). Anchor-relative landmarks for the
// presenter's glow, sparks, light and pick box: the hot workpiece lies on the anvil face at x −4…+2, y −23…−22
// (centre (−1, −23)); the face spans x −6…+10 at y −22…−21; the forge's coal bed is at (−14, −11), its mouth at
// (−14, −4); the lantern flame at (+13, −27). The silhouette spans x −21…+19 and rises 34 px above the anchor.
import type { SpriteDef } from '../contracts/art';
import { createRng } from '../core/rng';
import { Frame, toSprite } from './frame';
import { kitPropSprites } from './props-kit';
import { drawSigil } from './fx';
import { C, RAMPS, type Color, type Ramp } from './palette';
import { lineCells } from './raster';
import { Sculpt, hash2, valueNoise, type PrimStyle } from './shade';

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const onBody = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};
const stoneTex = (seed: number) => (x: number, y: number): number => (valueNoise(x, y, 3, seed) - 0.5) * 1.2 + (hash2(x, y, seed) > 0.92 ? -1 : 0);
const stone: PrimStyle = { ramp: RAMPS.stone, bias: 0.2, dither: 0.08, tex: stoneTex(5) };
const iron: PrimStyle = { ramp: RAMPS.metal, bias: 0.3, dither: 0.08 };
const wood: PrimStyle = { ramp: RAMPS.wood, bias: 0.3, dither: 0.08 };

const spec = (f: Frame, fps = 0, loop = false) => ({ anchorX: Math.floor(f.w / 2), anchorY: f.h - 1, fps, loop });

/** Horizontal cylinder band between two ellipses (a dais or drum seen from the elevated camera). */
function drum(s: Sculpt, cx: number, topY: number, h: number, rx: number, ry: number, side: PrimStyle, top: PrimStyle): void {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = Math.PI * (i / 16);
    pts.push([cx + Math.cos(t) * rx, topY + h + Math.sin(t) * ry]);
  }
  pts.push([cx - rx, topY], [cx + rx, topY]);
  s.poly(pts.reverse(), { ...side, cyl: 1 }, 1);
  s.ell(cx, topY, rx, ry, { ...top, round: 0.35 }, 0);
}

// ---------------------------------------------------------------------------
// Map device: a round ritual dais carved with the ember-spiral, flanked by rune obelisks
// ---------------------------------------------------------------------------

function mapDevice(active: boolean): Frame {
  const f = new Frame(52, 46);
  const s = new Sculpt();
  const cx = 26;
  const obelisk = (x: number, top: number, w: number): void => {
    s.poly([[x - w, 34], [x + w, 34], [x + w * 0.7, top + 3], [x, top], [x - w * 0.7, top + 3]], { ...stone, bias: 0.1, cyl: 0.7 }, 1.5);
  };
  obelisk(9, 10, 3.2);
  obelisk(43, 10, 3.2);
  obelisk(cx, 2, 3.8);
  // stepped dais
  drum(s, cx, 32, 5, 22, 8, { ...stone, bias: -0.3 }, { ...stone, bias: 0.4 });
  drum(s, cx, 29, 3, 16, 5.8, { ...stone, bias: -0.1 }, { ...stone, bias: 0.7, tex: stoneTex(9) });
  // central altar with the map slot
  s.poly([[cx - 4, 30], [cx + 4, 30], [cx + 3.4, 22], [cx - 3.4, 22]], { ...stone, bias: 0.3, cyl: 0.8 }, 1);
  s.ell(cx, 22, 4.4, 1.8, { ramp: RAMPS.metal, bias: 0.2, round: 0.4 });
  s.render(f.c, f.e);

  // iron bands on the obelisks
  for (const [x, y, w] of [[9, 26, 3], [43, 26, 3], [cx, 22, 4], [9, 17, 2], [43, 17, 2], [cx, 12, 3]] as const) {
    for (let dx = -w; dx <= w; dx++) onBody(f, x + dx, y, dx < 0 ? C.metalLight : C.metal);
    onBody(f, x - w + 1, y, C.metalHi);
  }
  // ember runes carved down each obelisk
  const runeCol = (i: number): Color => (active ? (i % 3 === 0 ? C.hot : C.flame) : C.lavaDark);
  const runeGlow = active ? 240 : 110;
  const runes: [number, number][] = [[9, 13], [9, 20], [43, 13], [43, 20], [cx, 6], [cx, 15]];
  runes.forEach(([x, y], i) => {
    f.glow(x, y, runeCol(i), runeGlow);
    f.glow(x, y + 1, runeCol(i + 1), runeGlow * 0.8);
    f.glow(x + (i % 2 ? 1 : -1), y + 2, runeCol(i + 2), runeGlow * 0.7);
    f.glow(x, y + 3, runeCol(i), runeGlow * 0.6);
  });
  // the ember-spiral carved into the dais top (flattened onto the floor plane)
  const sig = new Frame(52, 52);
  drawSigil(sig, 26, 26, 21, 0.1, active ? 1 : 0.55);
  for (let y = 0; y < 52; y++) {
    for (let x = 0; x < 52; x++) {
      if (!sig.e.opaque(x, y)) continue;
      const ty = Math.round(32 + (y - 26) * 0.34);
      if (!f.c.opaque(x, ty)) continue;
      const e = sig.e.get(x, y);
      if (active) f.glow(x, ty, e, Math.max(120, e & 255));
      else f.c.set(x, ty, (e >>> 8) % 3 === 0 ? C.lavaDark : C.basaltDeep);
    }
  }
  if (!active) for (const [x, y] of [[20, 31], [33, 33], [26, 29]]) f.glow(x, y, C.lavaDark, 140);
  // map slot: a dark socket, or a burning ember when active
  f.c.set(cx - 1, 22, C.ink);
  f.c.set(cx, 22, C.ink);
  f.c.set(cx + 1, 22, C.coal);
  if (active) {
    f.glow(cx, 21, C.white, 255);
    f.glow(cx - 1, 21, C.flame, 240);
    f.glow(cx + 1, 21, C.flame, 240);
    f.glow(cx, 20, C.hot, 240);
    f.glow(cx, 19, C.ember, 200);
    f.glow(cx - 1, 22, C.ember, 220);
    f.glow(cx, 22, C.hot, 240);
    f.glow(cx + 1, 22, C.ember, 220);
  }
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// Stash: the hideout strongbox — blackened wood under heavy iron, a rune lock glowing faintly
// ---------------------------------------------------------------------------

function stash(): Frame {
  const f = new Frame(30, 27);
  const s = new Sculpt();
  const dark: PrimStyle = { ramp: RAMPS.wood, bias: -0.7, dither: 0.06, tex: (x) => (x % 4 === 0 ? -0.8 : 0) };
  s.poly([[3, 13], [27, 13], [27, 24], [3, 24]], dark, 1.2, 0, 0.1);
  s.poly([[3, 13], [27, 13], [27, 9], [25, 6], [5, 6], [3, 9]], { ...dark, bias: 0.1 }, 1.5, 0, -0.5);
  s.render(f.c, f.e);
  // heavy iron: straps over lid and body, the lid seam band, bottom rim
  for (const x of [7, 22]) {
    for (let y = 6; y <= 24; y++) {
      onBody(f, x, y, y <= 12 ? C.metalLight : C.metalMid);
      onBody(f, x + 1, y, y <= 12 ? C.metalMid : C.metal);
    }
  }
  for (let x = 3; x <= 27; x++) {
    onBody(f, x, 13, C.metalHi);
    onBody(f, x, 14, C.metalDark);
    onBody(f, x, 23, C.metalMid);
    onBody(f, x, 24, C.metalDark);
    onBody(f, x, 6, x < 15 ? C.metalLight : C.metalMid);
  }
  // corner plates with rivets
  for (const [x0, y0] of [[3, 20], [25, 20], [3, 9], [25, 9]] as const) {
    for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) onBody(f, x, y, x === x0 || y === y0 ? C.metalLight : C.metal);
    onBody(f, x0 + 1, y0 + 1, C.metalHi);
  }
  for (const y of [17, 20]) {
    onBody(f, 7, y, C.metalHi);
    onBody(f, 22, y, C.metalHi);
  }
  // the lock plate: iron, a keyhole and a faint ember spiral that marks it as the player's
  for (let y = 12; y <= 19; y++) for (let x = 12; x <= 18; x++) px(f, x, y, x === 12 || y === 12 ? C.metalHi : x === 18 || y === 19 ? C.metalDark : C.metalMid);
  px(f, 15, 16, C.ink);
  px(f, 15, 17, C.ink);
  for (const [x, y, c] of [[15, 14, C.flame], [14, 14, C.ember], [14, 13, C.lavaDark], [16, 13, C.lavaDark], [16, 15, C.ember]] as const) f.glow(x, y, c, 170);
  // short iron feet
  for (const x of [4, 5, 24, 25]) {
    px(f, x, 25, C.metal);
    px(f, x, 26, C.metalDark);
  }
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// Rook, the hooded trader: crow-beak mask, towering pack, crooked staff with a swinging lantern
// ---------------------------------------------------------------------------

function merchant(k: number, testing = false): Frame {
  const f = new Frame(34, 40);
  const s = new Sculpt();
  const cloak: PrimStyle = { ramp: testing ? RAMPS.wine : [C.ink, C.coal, C.mossDeep, C.mossDark, C.moss, C.olive], bias: -0.1, dither: 0.08 };
  const pack: PrimStyle = { ramp: RAMPS.wood, bias: 0, dither: 0.08, tex: (x, y) => ((x + y) % 5 === 0 ? -0.7 : 0) };
  const b = k === 1 || k === 2 ? 1 : 0; // breathing
  const cx = 16;
  // the towering pack behind him: frame, rolled blanket, a scroll case, a pot
  s.poly([[cx - 8, 26], [cx + 8, 26], [cx + 7, 7 + b], [cx - 7, 7 + b]], { ...pack, cyl: 0.6 }, 1.5);
  s.cap(cx - 8, 6 + b, cx + 8, 6 + b, 2.6, 2.6, { ramp: RAMPS.wine, bias: 0.1, dither: 0.06 });
  s.poly([[cx + 4, 5 + b], [cx + 6, 5 + b], [cx + 6, 0 + b], [cx + 4, 1 + b]], { ramp: RAMPS.parchment, bias: -1, dither: 0 }, 0.6);
  s.ell(cx - 8.5, 17 + b, 2.4, 2.6, { ramp: RAMPS.rust, bias: 0.3 });
  // cloak: hooded, hunched, ragged at the hem
  s.poly(
    [
      [cx - 5, 15 + b],
      [cx + 5, 15 + b],
      [cx + 7, 26],
      [cx + 8, 36],
      [cx + 5, 37],
      [cx + 2, 36],
      [cx - 1, 37],
      [cx - 4, 36],
      [cx - 8, 37],
      [cx - 7, 26],
    ],
    { ...cloak, cyl: 0.85 },
    2,
  );
  s.ell(cx, 17 + b, 5.6, 4.4, cloak);
  // hood with a drooping point
  s.poly([[cx - 3, 9 + b], [cx + 3, 9 + b], [cx + 5, 5 + b]], { ...cloak, bias: 0.3 }, 1);
  s.ell(cx, 12 + b, 4.6, 4.6, { ...cloak, bias: 0.3 });
  // the rook's beak mask jutting from the hood
  s.poly([[cx - 1.8, 12.5 + b], [cx + 1.8, 12.5 + b], [cx + 0.4, 19 + b]], { ramp: [C.coal, C.stone, C.ashGrey, C.bone, C.parchment], bias: 0.4, dither: 0 }, 1);
  s.render(f.c, f.e);

  // deep hood shadow, gold eye glints
  for (let x = cx - 2; x <= cx + 2; x++) px(f, x, 10 + b, C.ink);
  for (let x = cx - 3; x <= cx + 2; x++) if (x !== cx && x !== cx - 1) px(f, x, 11 + b, C.coal);
  f.glow(cx - 2, 11 + b, C.gold, 170);
  f.glow(cx + 1, 11 + b, C.gold, 170);
  // burgundy scarf and a belt of charms
  for (let x = cx - 4; x <= cx + 4; x++) onBody(f, x, 19 + b, x < cx ? C.wineMid : C.burgundy);
  onBody(f, cx + 3, 20 + b, C.burgundy);
  onBody(f, cx + 3, 21 + b, C.wineDark);
  for (let x = cx - 6; x <= cx + 6; x++) onBody(f, x, 26, x % 3 === 0 ? C.goldDark : C.woodDark);
  onBody(f, cx - 3, 27, C.gold);
  onBody(f, cx + 2, 27, C.bone);
  onBody(f, cx + 5, 27, C.gold);
  // crooked staff with the lantern swinging from its hook
  const sx = cx + 10;
  lineCells(sx, 38, sx - 1, 8, (x, y) => px(f, x, y, y < 10 ? C.woodLight : y % 6 === 0 ? C.wood : C.woodDark));
  lineCells(sx - 1, 8, sx - 4, 6, (x, y) => px(f, x, y, C.woodDark));
  px(f, sx - 5, 7, C.woodDark);
  const swing = [0, 1, 0, -1][k];
  const lx = sx - 5 + swing;
  const ly = 12;
  lineCells(sx - 5, 8, lx, ly - 3, (x, y) => px(f, x, y, C.metalMid));
  const cage: [number, number, Color][] = [
    [-1, -2, C.metalLight], [0, -2, C.metalHi], [1, -2, C.metal],
    [-2, -1, C.metalLight], [2, -1, C.metal], [-2, 0, C.metalMid], [2, 0, C.metalDark], [-2, 1, C.metalMid], [2, 1, C.metalDark],
    [-1, 2, C.metal], [0, 2, C.metal], [1, 2, C.metalDark],
  ];
  for (const [dx, dy, c] of cage) px(f, lx + dx, ly + dy, c);
  f.glow(lx, ly, C.white, 255);
  f.glow(lx - 1, ly, C.hot, 250);
  f.glow(lx + 1, ly, C.gold, 230);
  f.glow(lx, ly - 1, C.hot, 240);
  f.glow(lx, ly + 1, k % 2 ? C.flame : C.gold, 230);
  f.glow(lx - 1, ly + 1, C.gold, 210);
  f.glow(lx + 1, ly - 1, C.gold, 210);
  // gloved hand on the staff
  px(f, sx - 1, 22 + b, C.woodDark);
  px(f, sx - 2, 22 + b, C.wood);
  px(f, sx - 1, 23 + b, C.woodDeep);
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// Portals: swirling energy inside a ring of weathered ritual stones
// ---------------------------------------------------------------------------

function portal(k: number, ramp: Ramp, frames: number): Frame {
  const f = new Frame(38, 50);
  const cx = 19;
  const cy = 25;
  const irx = 11;
  const iry = 17;
  const rot = (k / frames) * Math.PI * 2;
  const n = ramp.length;
  // swirling energy: a dark eye, three bright arms winding in, a hot inner rim
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const dx = (x + 0.5 - cx) / irx;
      const dy = (y + 0.5 - cy) / iry;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      const a = Math.atan2(dy, dx);
      const arm = Math.pow(Math.cos(3 * (a - rot) + r * 6.5) * 0.5 + 0.5, 2.2);
      let v = 0.08 + arm * (0.25 + 0.6 * r);
      if (r > 0.82) v = Math.max(v, 0.55 + (r - 0.82) * 2.2);
      if (r < 0.18) v = 0.02;
      const i = Math.max(0, Math.min(n - 1, Math.round(v * (n - 1))));
      f.glow(x, y, ramp[i], 70 + 185 * v);
    }
  }
  // the ritual arch: a ring of weathered stone blocks around the energy
  const stoneRamp = RAMPS.stone;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const px0 = x + 0.5 - cx;
      const py0 = y + 0.5 - cy;
      const outer = Math.hypot(px0 / (irx + 4.5), py0 / (iry + 4.5));
      const inner = Math.hypot(px0 / irx, py0 / iry);
      if (outer > 1 || inner <= 1 || y > 45) continue;
      const a = Math.atan2(py0, px0);
      // light from the top-left on the ring's outward normal
      const lit = -Math.cos(a) * 0.55 - Math.sin(a) * 0.75;
      let v = 2.4 + lit * 1.3 + (valueNoise(x, y, 3, 300) - 0.5);
      if (Math.abs(Math.sin(a * 7)) < 0.12) v = 0.8; // block joints
      if (inner < 1.12) v -= 1; // inner lip
      f.c.set(x, y, stoneRamp[Math.max(0, Math.min(stoneRamp.length - 1, Math.round(v)))]);
      f.e.set(x, y, 0);
    }
  }
  // glowing runes set into the arch, lighting in turn
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    const x = Math.round(cx + Math.cos(a) * (irx + 2.2));
    const y = Math.round(cy + Math.sin(a) * (iry + 2.2));
    const on = (i + k) % 7 < 4;
    f.glow(x, y, ramp[on ? n - 2 : n - 3], on ? 240 : 160);
  }
  // footing stones and a scorched ground ring
  for (const bx of [cx - 13, cx + 10]) {
    for (let y = 43; y <= 47; y++) for (let x = bx; x < bx + 4; x++) f.c.set(x, y, y === 43 ? stoneRamp[4] : x === bx ? stoneRamp[3] : stoneRamp[2]);
  }
  for (let x = cx - 9; x <= cx + 9; x++) {
    const t = (x - cx) / 9;
    const y = Math.round(44 + Math.sqrt(Math.max(0, 1 - t * t)) * 2.5);
    f.c.set(x, y, C.ink);
    if (Math.abs(t) < 0.8) f.glow(x, y - 1, ramp[2], 110);
  }
  // sparks drifting up out of the energy
  for (let i = 0; i < 4; i++) {
    const x = Math.round(cx - 7 + ((i * 5 + k * 3) % 14));
    const y = Math.round(40 - ((k * 4 + i * 9) % 32));
    if (f.c.opaque(x, y) && !f.e.opaque(x, y)) continue;
    f.glow(x, y, ramp[n - 2], 220);
  }
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// Reward chest: gold-trimmed, closed / open with golden light spilling out
// ---------------------------------------------------------------------------

function chest(open: boolean): Frame {
  const f = new Frame(28, 30);
  const s = new Sculpt();
  const body: PrimStyle = { ramp: RAMPS.wood, bias: 0, dither: 0.08, tex: (x) => (x % 4 === 0 ? -0.6 : 0) };
  if (open) {
    // the lid tipped back on its hinges: its darker inner face, framed in gold, the curve of the dome on top
    s.poly([[5, 17], [23, 17], [25, 5], [3, 5]], { ...body, bias: -0.9, tex: (x, y) => ((x + y) % 5 === 0 ? -0.5 : 0) }, 1.2, 0, 0.2);
    s.ell(14, 4.5, 11, 2.2, { ...body, bias: 0.6, round: 0.5 });
  }
  s.poly([[4, 17], [24, 17], [24, 28], [4, 28]], body, 1.2, 0, 0.1);
  if (!open) s.poly([[4, 17], [24, 17], [24, 13], [22, 10], [6, 10], [4, 13]], { ...body, bias: 0.9 }, 1.5, 0, -0.5);
  s.render(f.c, f.e);
  const gold = (x: number, y: number, c: Color = C.gold): void => onBody(f, x, y, c);
  for (let x = 4; x <= 24; x++) {
    gold(x, 17, x < 14 ? C.goldHi : C.gold);
    gold(x, 27, C.ochre);
  }
  for (let y = open ? 17 : 10; y <= 27; y++) {
    gold(4, y, C.gold);
    gold(24, y, C.ochre);
    gold(14, y, y < 17 ? C.goldHi : C.gold);
  }
  if (!open) for (let x = 6; x <= 22; x++) gold(x, 10, C.goldHi);
  for (let y = 18; y <= 21; y++) for (let x = 13; x <= 15; x++) gold(x, y, y === 18 ? C.goldHi : C.ochre);
  gold(14, 20, C.ink);
  if (open) {
    // gold trim around the lid, and its hinges
    for (let y = 5; y <= 16; y++) {
      const t = (y - 5) / 12;
      gold(Math.round(3 + t * 2), y, C.gold);
      gold(Math.round(25 - t * 2), y, C.ochre);
    }
    for (let x = 4; x <= 24; x++) gold(x, 6, x < 14 ? C.goldHi : C.gold);
    for (const x of [8, 20]) {
      px(f, x, 16, C.metalLight);
      px(f, x, 17, C.metal);
    }
    // treasure: a heap of coins in the mouth, lit from within
    for (let x = 5; x <= 23; x++) {
      const h = Math.round(1.5 + Math.sin((x - 5) / 18 * Math.PI) * 2 + hash2(x, 3, 7) * 0.8);
      for (let k = 0; k < h; k++) f.glow(x, 17 - k, k === h - 1 ? (x % 3 === 0 ? C.white : C.goldHi) : k === 0 ? C.gold : C.goldHi, 255 - k * 10);
    }
    // golden light spilling up across the lid
    for (let y = 2; y <= 14; y++) {
      const t = (y - 2) / 12;
      for (let x = 5; x <= 23; x++) {
        const u = Math.abs(x + 0.5 - 14) / 9;
        const a = t * t * (1 - u) * 0.45;
        if (a > 0.05) f.glowSoft(x, y, C.goldHi, a, 255 * a);
      }
    }
    for (const [x, y] of [[9, 8], [18, 6], [14, 11], [21, 12]]) f.glow(x, y, C.white, 230);
  }
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// Pillars, standing stones, rubble, bones, crystals, walls
// ---------------------------------------------------------------------------

function pillar(v: number): Frame {
  const f = new Frame(20, 44);
  const s = new Sculpt();
  const topY = [5, 14, 30][v];
  s.poly([[2, 38], [18, 38], [18, 43], [2, 43]], { ...stone, bias: 0.1 }, 1.2, 0, -0.2);
  s.poly([[3, 35], [17, 35], [17, 38], [3, 38]], { ...stone, bias: 0.4 }, 1, 0, -0.3);
  const top: [number, number][] = v === 0 ? [[5, topY], [15, topY]] : [[5, topY + 2], [8, topY - 1], [10, topY + 1], [12, topY - 2], [15, topY + 1]];
  s.poly([[5, 35], [15, 35], ...top.reverse()], { ...stone, cyl: 1, bias: 0.2, tex: (x, y) => ((x - 5) % 3 === 0 ? -0.9 : 0) + (valueNoise(x, y, 3, 17) - 0.5) }, 1);
  if (v === 0) {
    s.poly([[3, 6], [17, 6], [17, 2], [3, 2]], { ...stone, bias: 0.5 }, 1, 0, -0.3);
    s.poly([[4, 8], [16, 8], [16, 6], [4, 6]], { ...stone, bias: 0.2 }, 0.8);
  }
  s.render(f.c, f.e);
  for (let i = 0; i < 4; i++) onBody(f, 5 + ((i * 7) % 10), 34 - i, i % 2 ? C.moss : C.mossDark);
  lineCells(11, Math.max(topY + 4, 16), 9, Math.max(topY + 10, 24), (x, y) => onBody(f, x, y, C.coal));
  if (v === 2) for (const [x, y] of [[1, 42], [18, 41], [16, 42]]) px(f, x, y, C.stone);
  f.outline({ selective: true });
  return f;
}

function standingStone(v: number): Frame {
  const f = new Frame(22, 38);
  const s = new Sculpt();
  const shapes: [number, number][][] = [
    [[4, 37], [18, 37], [17, 12], [13, 3], [8, 4], [5, 12]],
    [[3, 37], [18, 37], [16, 8], [11, 5], [6, 9]],
    [[5, 37], [17, 37], [17, 16], [14, 9], [9, 10], [6, 16]],
  ];
  s.poly(shapes[v], { ...stone, bias: 0.25, tex: stoneTex(40 + v) }, 3);
  s.render(f.c, f.e);
  // the carved ember spiral (faintly warm) and lichen
  const cx = 11;
  const cy = [20, 19, 24][v];
  let last = '';
  for (let i = 0; i < 90; i++) {
    const t = i * 0.16;
    const r = 0.4 + t * 0.62;
    const x = Math.round(cx + Math.cos(t) * r);
    const y = Math.round(cy + Math.sin(t) * r * 1.25);
    const key = `${x},${y}`;
    if (key === last || !f.c.opaque(x, y)) continue;
    last = key;
    // carved groove (lit lip below-right); only the innermost turns still smoulder
    if (i < 34) f.glow(x, y, i < 16 ? C.ember : C.lavaDark, i < 16 ? 180 : 130);
    else px(f, x, y, C.coal);
    if (!f.e.opaque(x + 1, y + 1)) onBody(f, x + 1, y + 1, C.stoneLight);
  }
  f.glow(cx, cy, C.flame, 200);
  for (let i = 0; i < 6; i++) onBody(f, 5 + i * 2, 35 - (i % 3), i % 2 ? C.moss : C.olive);
  f.outline({ selective: true });
  return f;
}

function rubble(v: number): Frame {
  const f = new Frame(24, 14);
  const s = new Sculpt();
  const rng = createRng(700 + v);
  const n = 5 + v;
  for (let i = 0; i < n; i++) {
    const x = 4 + rng.next() * 16;
    const y = 8 + rng.next() * 4;
    const r = 1.6 + rng.next() * 2.4;
    s.poly(
      [[x - r, y + r * 0.6], [x - r * 0.6, y - r * 0.7], [x + r * 0.5, y - r * 0.8], [x + r, y + r * 0.2], [x + r * 0.4, y + r * 0.7]],
      { ...stone, bias: 0.2 + rng.next() * 0.6, tex: stoneTex(80 + i) },
      1.2,
      0,
      -0.3,
    );
  }
  s.render(f.c, f.e);
  for (let i = 0; i < 4; i++) px(f, 2 + rng.int(0, 19), 12 + rng.int(0, 1), C.stone);
  f.outline({ selective: true });
  return f;
}

function bones(v: number): Frame {
  const f = new Frame(22, 12);
  const bone = (x0: number, y0: number, x1: number, y1: number): void => {
    lineCells(x0, y0, x1, y1, (x, y) => px(f, x, y, C.bone));
    lineCells(x0, y0 + 1, x1, y1 + 1, (x, y) => {
      if (!f.c.opaque(x, y)) px(f, x, y, C.ashGrey);
    });
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      px(f, x - 1, y, C.parchment);
      px(f, x, y - 1, C.parchment);
    }
  };
  const skull = (x: number, y: number): void => {
    const rows = ['.###.', '#####', '#.#.#', '#####', '.#.#.'];
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch === '#' && px(f, x + dx, y + dy, dx < 2 && dy < 3 ? C.parchment : dy > 2 ? C.ashGrey : C.bone)));
    px(f, x + 1, y + 2, C.coal);
    px(f, x + 3, y + 2, C.coal);
  };
  if (v === 0) {
    bone(3, 8, 11, 6);
    bone(8, 9, 16, 9);
    skull(13, 3);
  } else if (v === 1) {
    bone(4, 5, 9, 9);
    bone(10, 8, 18, 6);
    bone(6, 10, 12, 10);
  } else {
    skull(4, 4);
    skull(11, 5);
    bone(14, 10, 19, 8);
  }
  f.outline({ selective: true });
  return f;
}

function crystal(v: number): Frame {
  const f = new Frame(22, 30);
  const s = new Sculpt();
  const ice: PrimStyle = { ramp: [C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice, C.white], bias: 0.4, dither: 0, glow: 150, round: 1.4 };
  const sets: [number, number, number, number][][] = [
    [[11, 28, 3.2, 26], [6, 28, 2.4, 16], [16, 28, 2.4, 18]],
    [[9, 28, 3, 22], [14, 28, 2.6, 24], [5, 28, 1.8, 11]],
    [[11, 28, 3.6, 20], [16, 28, 2, 12], [6, 28, 2.2, 14]],
  ];
  const shards = [...sets[v]].sort((a, b) => a[3] - b[3]);
  for (const [x, base, w, h] of shards) {
    const lean = (x - 11) * 0.25;
    s.poly([[x - w, base], [x + w, base], [x + w * 0.8 + lean, base - h * 0.75], [x + lean * 1.3, base - h], [x - w * 0.8 + lean, base - h * 0.75]], ice, 1, 0, 0);
  }
  s.render(f.c, f.e);
  for (const [x, base, , h] of shards) {
    const lean = (x - 11) * 0.25;
    lineCells(x, base - 1, x + lean * 1.3, base - h + 1, (lx, ly) => onBody(f, lx, ly, C.ice));
    f.glow(Math.round(x + lean * 1.3), base - h, C.white, 255);
  }
  for (let x = 3; x <= 19; x++) if (!f.c.opaque(x, 28)) px(f, x, 29, x % 3 ? C.ossPale : C.ossFrost);
  f.outline({ selective: true });
  return f;
}

function banner(k: number): Frame {
  const f = new Frame(18, 40);
  for (let y = 3; y <= 39; y++) px(f, 4, y, y < 5 ? C.metalLight : y % 7 === 0 ? C.woodLight : C.woodDark);
  px(f, 4, 2, C.metalHi);
  px(f, 3, 3, C.metalLight);
  px(f, 5, 3, C.metal);
  for (let x = 4; x <= 15; x++) px(f, x, 6, x === 15 ? C.metalLight : C.wood);
  // tattered cloth rippling in the heat
  const ramp = RAMPS.wine;
  const phase = (k / 4) * Math.PI * 2;
  for (let x = 5; x <= 15; x++) {
    const u = (x - 5) / 10;
    const ripple = Math.sin(u * 5 + phase) * 0.9;
    const len = 21 + Math.round(Math.sin(u * 9 + phase * 0.5) * 1.2) - (x === 8 || x === 13 ? 4 : 0) - (x > 13 ? 3 : 0);
    for (let y = 7; y <= 7 + len; y++) {
      const t = (y - 7) / len;
      const shade = 2.8 + ripple - t * 0.8 - u * 0.5;
      const c = ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(shade)))];
      px(f, x + Math.round(ripple * t * 0.8), y, c);
    }
  }
  // gold ember-spiral stitched on the cloth
  const cx = 10;
  const cy = 15;
  const sp: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [2, -1], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [-1, 2], [-2, 2]];
  const off = Math.round(Math.sin(0.5 + phase) * 0.5);
  for (const [dx, dy] of sp) if (f.c.opaque(cx + dx + off, cy + dy)) px(f, cx + dx + off, cy + dy, dx === 0 && dy === 0 ? C.goldHi : C.gold);
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// The Crafting Bench ('prop/anvil'): a heavy blackened anvil on a scarred workbench with a hot workpiece on its
// face and a bright steel hammer resting on the heel (handle run out over the front edge, a plain T), a squat
// stone coal forge at the bench's left end with tongs left in the fire, a whetstone at the back of the bench,
// bar stock on the lower shelf and a lantern hanging clear of everything from a post — a workstation, not decor.
// Each tool keeps a background gap to its neighbours so it reads on its own at game scale. BENCH_FRAMES frames
// of ember flicker (coal bed, forge mouth, workpiece, lantern flame), looped.
// ---------------------------------------------------------------------------

const BENCH_FRAMES = 4;
/** Column the bench lantern hangs on (frame pixels). */
const LANTERN_X = 34;

/** Inclusive pixel box as a polygon (forPolygon fills pixel centres, so the far edges sit one past the last pixel). */
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]];

function craftingBench(k: number): Frame {
  const f = new Frame(42, 36);
  const s = new Sculpt();
  // ember flicker: a fixed bed of coals whose pixels each drift a little frame to frame (no re-rolled sparkle)
  const flick = (x: number, y: number, salt = 0): number => hash2(x * 3 + salt, y * 5, 1500) * 0.75 + hash2(x + salt, y, 1501 + k) * 0.25;
  // blackened iron: the body sits a band and a half below plain iron so only the polished face and horn crest
  // catch the light
  const blackened: PrimStyle = { ramp: RAMPS.metal, bias: -0.5, contrast: 0.85, dither: 0.06 };
  const plank: PrimStyle = { ...wood, bias: 0.1, tex: (x, y) => (y === 23 ? -1 : 0) + (valueNoise(x, y * 4, 5, 33) - 0.5) * 0.9 };
  const hearth: PrimStyle = {
    ...stone,
    bias: 0.1,
    // coursed stone: mortar every 3 rows, joints staggered per course
    tex: (x, y) => ((y - 26) % 3 === 0 || (x + ((Math.floor((y - 26) / 3) & 1) * 2)) % 4 === 0 ? -0.9 : 0) + (valueNoise(x, y, 3, 7) - 0.5) * 0.8,
  };

  // --- back to front ---------------------------------------------------------------------------------------
  // lantern post at the bench's back-right corner, and its short arm (the lantern hangs clear of the anvil)
  s.cap(38.5, 22, 38.5, 2.5, 1, 0.9, { ...wood, bias: -0.1 });
  s.cap(38, 3.6, LANTERN_X - 0.5, 3.6, 0.7, 0.7, { ...wood, bias: 0.1 });
  // lower shelf (in the bench's shadow) and the two legs
  s.poly(box(9, 31, 37, 32), { ...wood, bias: -1.1 }, 0.6, 0, -0.6);
  s.poly(box(8, 27, 10, 35), { ...wood, bias: -0.4 }, 0.8);
  s.poly(box(36, 27, 38, 35), { ...wood, bias: -0.4 }, 0.8);
  // the thick scarred top: its surface and front edge
  s.poly(box(6, 21, 39, 25), plank, 1, 0, -1.1);
  s.poly(box(6, 26, 39, 28), { ...wood, bias: -0.1, tex: (x) => (x % 8 === 5 ? -0.8 : 0) }, 0.7, 0, 0.1);
  // the anvil: flared split feet on the bench, a narrow waist, the throat, then the horn, the heel block and the
  // polished face on top
  s.poly([[15.5, 25], [30.5, 25], [28, 21], [18, 21]], blackened, 1, 0, -0.5);
  s.poly(box(20, 18, 25, 20), { ...blackened, cyl: 0.8 }, 1);
  s.poly([[16.5, 17], [30.5, 17], [27.5, 18.2], [18.5, 18.2]], { ...blackened, bias: -0.7 }, 0.6, 0, 0.3);
  s.cap(16, 14.5, 8, 13.4, 2.1, 0.5, { ...blackened, bias: -0.3 });
  s.poly(box(15, 15, 31, 16), { ...blackened, bias: -0.4 }, 0.6, 0, 0.1);
  s.poly(box(15, 13, 31, 14), { ...blackened, bias: 0.75, contrast: 1 }, 0.5, 0, -1.3);
  // the forge at the left end: a squat stone hearth with a fire pot on top and a mouth below
  s.poly([[1, 36], [13, 36], [13, 24.5], [12, 23], [2, 23], [1, 24.5]], hearth, 1.2, 0, 0.05);
  s.ell(7, 24.2, 4.8, 1.6, { ...stone, bias: -1.2, round: 0.3 });
  s.render(f.c, f.e);

  // --- workbench details -----------------------------------------------------------------------------------
  // burns and knife scars on the top, the char darkest near the forge; iron brackets on the front edge
  for (const [x, y, c] of [
    [14, 22, C.woodDeep], [15, 22, C.woodDark], [13, 24, C.woodDark], [31, 23, C.woodDark], [33, 22, C.woodDark],
    [12, 21, C.woodDeep], [37, 24, C.woodDark],
  ] as const) onBody(f, x, y, c);
  lineCells(32, 25, 35, 24, (x, y) => onBody(f, x, y, C.woodDark));
  lineCells(10, 23, 12, 22, (x, y) => onBody(f, x, y, C.woodLight));
  for (let x = 6; x <= 39; x++) if (!f.e.opaque(x, 25)) onBody(f, x, 25, x < 22 ? C.woodHi : C.woodLight);
  for (const x0 of [6, 37]) {
    for (let y = 26; y <= 28; y++) for (let x = x0; x <= x0 + 2; x++) onBody(f, x, y, y === 26 ? C.metalLight : x === x0 ? C.metalMid : C.metal);
    onBody(f, x0 + 1, 27, C.metalHi);
  }
  onBody(f, 17, 27, C.woodDeep);
  // bar stock and iron ingots on the shelf
  for (let x = 22; x <= 32; x++) {
    px(f, x, 29, x === 22 ? C.metalHi : x < 27 ? C.metalLight : C.metalMid);
    px(f, x, 30, x < 25 ? C.metalMid : C.metal);
  }
  for (const x0 of [14, 18]) {
    for (let x = x0; x <= x0 + 2; x++) {
      px(f, x, 29, x === x0 ? C.metalLight : C.metalMid);
      px(f, x, 30, x === x0 + 2 ? C.metalDark : C.metal);
    }
  }

  // --- the anvil -------------------------------------------------------------------------------------------
  // the polished face catches the light along its front lip; the horn's crest; the pritchel hole in the heel
  for (let x = 15; x <= 31; x++) onBody(f, x, 14, x < 21 ? C.metalHi : C.metalLight);
  for (let x = 9; x <= 15; x++) onBody(f, x, 12 + (x < 12 ? 1 : 0), x < 12 ? C.metalMid : C.metalLight);
  onBody(f, 30, 13, C.metalDeep);
  // blackened iron still shows a dull sheen on the lit left flanks of the waist and the feet; the arch between
  // the feet shows the bench top beneath
  for (let y = 18; y <= 20; y++) onBody(f, 20, y, C.metal);
  for (const [x, y] of [[18, 21], [17, 22], [16, 23], [16, 24]] as const) onBody(f, x, y, C.metalMid);
  for (let x = 19; x <= 27; x++) onBody(f, x, 21, x < 23 ? C.metal : C.metalDark);
  for (const x of [21, 22, 23, 24]) {
    px(f, x, 24, x === 21 || x === 24 ? C.woodDeep : C.wood);
    if (x === 22 || x === 23) px(f, x, 23, C.woodDeep);
  }
  // the hot workpiece lying across the face, with a scale of heat glinting beneath it
  const heat = [1, 0.9, 0.96, 0.84][k];
  for (let x = 17; x <= 23; x++) {
    const core = x >= 19 && x <= 22;
    f.glow(x, 12, core ? (x === 20 && k % 2 === 0 ? C.white : C.hot) : x === 17 ? C.ember : C.flame, 255 * heat);
    f.glow(x, 13, core ? C.flame : C.ember, 225 * heat);
  }
  f.glow(24, 13, C.lavaDark, 150 * heat);
  f.glow(16, 13, C.lavaDark, 140 * heat);
  for (let x = 18; x <= 22; x++) if (flick(x, 14) > 0.55) f.glow(x, 14, C.lavaDark, 120);
  // the hammer set down on the heel beside the work, its handle run out over the front edge toward the smith:
  // a steel-bright striking face toward the workpiece, a tapered peen, and a light ash handle — a plain T
  // (bright tool steel, so it stands off the blackened anvil)
  for (let x = 25; x <= 29; x++) {
    if (x < 29) px(f, x, 10, x < 27 ? C.metalHi : C.metalLight);
    px(f, x, 11, x === 25 ? C.metalHi : x === 29 ? C.metalLight : C.metalMid);
    px(f, x, 12, x === 25 ? C.metalLight : x === 29 ? C.metalMid : C.metal);
  }
  for (let y = 13; y <= 20; y++) {
    px(f, 27, y, y === 20 ? C.wood : y <= 14 ? C.woodHi : C.woodLight);
    px(f, 28, y, y === 20 ? C.woodDark : C.wood);
  }
  onBody(f, 29, 13, C.metalMid); // the handle's shadow on the face

  // --- a whetstone at the back of the bench, casting a little shadow on the planks ------------------------------
  for (let x = 32; x <= 35; x++) {
    px(f, x, 21, x === 32 ? C.ossFrost : C.ossPale);
    px(f, x, 22, x === 35 ? C.ossMid : C.ossLight);
    px(f, x + 1, 23, C.woodDeep);
  }

  // --- the forge ----------------------------------------------------------------------------------------
  // the fire pot: a bed of coals that breathes frame to frame
  for (let y = 23; y <= 25; y++) {
    for (let x = 3; x <= 11; x++) {
      const dx = (x + 0.5 - 7) / 4.6;
      const dy = (y + 0.5 - 24.2) / 1.6;
      if (dx * dx + dy * dy > 1) continue;
      const v = flick(x, y) * 0.8 + (1 - Math.hypot(dx, dy)) * 0.6;
      if (v < 0.32) px(f, x, y, C.coal);
      else f.glow(x, y, v > 0.95 ? C.hot : v > 0.72 ? C.flame : v > 0.5 ? C.ember : C.lavaDark, 150 + v * 100);
    }
  }
  // tongs left in the fire: the jaws buried in the coals, the two reins leaning out over the back of the pot in an
  // open V, heat creeping up them from the coal bed
  const rein = (x0: number, x1: number, y1: number, lit: boolean): void =>
    lineCells(x0, 23, x1, y1, (x, y) => {
      if (y >= 23) f.glow(x, y, C.ember, 200);
      else if (y === 22) f.glow(x, y, C.lavaDark, 150);
      else px(f, x, y, y === y1 || y === 21 ? (lit ? C.metalHi : C.metalLight) : lit ? C.metalLight : C.metalMid);
    });
  rein(4, 1, 16, false);
  rein(5, 5, 15, true);
  // a rim of lit stone round the pot
  for (let x = 3; x <= 11; x++) if (!f.e.opaque(x, 26)) onBody(f, x, 26, x < 7 ? C.stoneLight : C.stone);
  // the mouth: an arched ash pit glowing from below
  for (let y = 29; y <= 34; y++) {
    for (let x = 4; x <= 9; x++) {
      if (y === 29 && (x === 4 || x === 9)) continue;
      const u = (34 - y) / 5;
      const hot = flick(x, y, 9) * 0.35 + (1 - u) * 0.9 - (x === 4 || x === 9 ? 0.25 : 0);
      if (hot < 0.3) px(f, x, y, u > 0.7 ? C.ink : C.lavaDeep);
      else f.glow(x, y, hot > 0.95 ? C.hot : hot > 0.72 ? C.flame : hot > 0.5 ? C.ember : C.lavaDark, 140 + hot * 110);
    }
  }
  for (let x = 4; x <= 9; x++) onBody(f, x, 28, x === 4 || x === 9 ? C.stone : C.stoneLight);
  onBody(f, 3, 29, C.stone);
  onBody(f, 10, 29, C.char);
  for (let x = 3; x <= 10; x++) onBody(f, x, 35, C.char);

  // --- the lantern hanging from the arm --------------------------------------------------------------------
  const lx = LANTERN_X;
  const ly = 6; // the cage's top row, one chain link below the arm
  px(f, lx, ly - 1, C.metalMid);
  const cage: [number, number, Color][] = [
    [-1, 0, C.metalLight], [0, 0, C.metalHi], [1, 0, C.metal],
    [-2, 1, C.metalLight], [2, 1, C.metal], [-2, 2, C.metalMid], [2, 2, C.metalDark], [-2, 3, C.metalMid], [2, 3, C.metalDark],
    [-1, 4, C.metal], [0, 4, C.metalMid], [1, 4, C.metalDark],
  ];
  for (const [dx, dy, c] of cage) px(f, lx + dx, ly + dy, c);
  const flame = [C.hot, C.flame, C.hot, C.gold][k];
  f.glow(lx, ly + 2, C.white, 255);
  f.glow(lx, ly + 1, flame, 245);
  f.glow(lx - 1, ly + 2, C.gold, 230);
  f.glow(lx + 1, ly + 2, C.hot, 235);
  f.glow(lx - 1, ly + 3, C.gold, 215);
  f.glow(lx, ly + 3, k % 2 ? C.flame : C.gold, 225);
  f.glow(lx + 1, ly + 3, C.gold, 210);
  f.glow(lx - 1, ly + 1, C.goldHi, 200);
  f.glow(lx + 1, ly + 1, C.goldHi, 200);

  f.outline({ selective: true });
  return f;
}

function ruinWall(v: number): Frame {
  const f = new Frame(36, 32);
  const rng = createRng(900 + v);
  const ramp = RAMPS.stone;
  const topAt = (x: number): number => {
    const base = [6, 10, 4][v];
    return Math.round(base + valueNoise(x, 0, 5, 50 + v) * 10 + (v === 2 && x > 14 && x < 22 ? 30 : 0));
  };
  for (let x = 1; x < 35; x++) {
    const top = Math.min(30, topAt(x));
    for (let y = top; y < 31; y++) {
      const course = Math.floor((y - 1) / 4);
      const offset = course % 2 ? 3 : 0;
      const bx = (x + offset) % 7;
      const by = (y - 1) % 4;
      let i = 2.5 + (valueNoise(x, y, 3, 60 + v) - 0.5) * 1.4;
      if (bx === 0 || by === 0) i = 0.6; // mortar
      else if (by === 1) i += 0.8; // lit top of each block
      else if (bx === 6) i -= 0.8;
      if (y === top) i = 4;
      if (y >= 27) i -= 0.6; // ground shadow
      f.c.set(x, y, ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(i)))]);
    }
  }
  if (v === 1) {
    // an arched window through the wall
    for (let y = 14; y < 25; y++) {
      for (let x = 14; x < 22; x++) {
        const dx = (x + 0.5 - 18) / 4;
        const dy = (y + 0.5 - 18) / 4;
        if (y >= 18 || dx * dx + dy * dy < 1) f.c.set(x, y, 0);
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = rng.int(2, 33);
    onBody(f, x, topAt(x) + 1, rng.chance(0.5) ? C.moss : C.mossDark);
  }
  for (const x of [3, 30]) px(f, x + rng.int(0, 2), 31, C.stone);
  f.outline({ selective: true });
  return f;
}

// ---------------------------------------------------------------------------
// Brazier: iron bowl on a tripod with a living fire
// ---------------------------------------------------------------------------

function brazier(k: number): Frame {
  const f = new Frame(18, 30);
  const s = new Sculpt();
  for (const [x0, x1] of [[5, 2], [13, 16], [9, 9]] as const) s.cap(x0, 18, x1, 28.5, 0.8, 0.7, { ...iron, bias: x0 === 9 ? -0.5 : 0 });
  s.poly([[2, 14], [16, 14], [14, 19], [4, 19]], { ...iron, cyl: 1, bias: 0.2 }, 1.2);
  s.render(f.c, f.e);
  for (let x = 3; x <= 15; x++) f.glow(x, 14, (x + k) % 3 === 0 ? C.hot : (x + k) % 3 === 1 ? C.ember : C.lavaDark, 230);
  for (let x = 2; x <= 16; x++) onBody(f, x, 15, C.metalHi);
  // flames: stacked tongues, each frame shifted and re-flickered
  const rng = createRng(1200 + k);
  for (let t = 0; t < 5; t++) {
    const bx = 4 + t * 2.5 + rng.next();
    const h = 6 + Math.round(rng.next() * 6) + (t === 2 ? 3 : 0);
    const sway = Math.sin(k * 1.4 + t) * 1.2;
    for (let i = 0; i < h; i++) {
      const u = i / h;
      const w = Math.max(0, Math.round((1 - u) * 1.6));
      const x = Math.round(bx + sway * u);
      const y = 13 - i;
      for (let dx = -w; dx <= w; dx++) {
        const edge = Math.abs(dx) === w && w > 0;
        const c = u > 0.8 ? C.ember : edge ? C.flame : u < 0.35 ? C.hot : C.flame;
        f.glow(x + dx, y, c, 255 - u * 70);
      }
    }
  }
  f.glow(6 + ((k * 3) % 7), 1 + (k % 3), C.flame, 200);
  f.outline({ selective: true });
  return f;
}

export function propSprites(): SpriteDef[] {
  const one = (id: string, frames: Frame[], fps = 0, loop = false): SpriteDef => toSprite(`prop/${id}`, frames, spec(frames[0], fps, loop));
  const PORTAL_FRAMES = 8;
  const emberRamp: Ramp = [C.lavaDeep, C.lavaDark, C.ember, C.flame, C.hot, C.white];
  const frostRamp: Ramp = [C.frostDeep, C.frostDark, C.mana, C.frost, C.ice, C.white];
  const range = (n: number): number[] => [...Array(n).keys()];
  return [
    one('mapDevice', [mapDevice(false), mapDevice(true)]),
    one('stash', [stash()]),
    one('merchant', range(4).map(k => merchant(k)), 4, true),
    one('debugMerchant', range(4).map(k => merchant(k, true)), 4, true),
    one('portal', range(PORTAL_FRAMES).map((k) => portal(k, emberRamp, PORTAL_FRAMES)), 10, true),
    one('returnPortal', range(PORTAL_FRAMES).map((k) => portal(k, frostRamp, PORTAL_FRAMES)), 10, true),
    one('chest', [chest(false), chest(true)]),
    one('pillar', range(3).map(pillar)),
    one('brazier', range(6).map(brazier), 10, true),
    one('standingStone', range(3).map(standingStone)),
    one('rubble', range(3).map(rubble)),
    one('bones', range(3).map(bones)),
    one('crystal', range(3).map(crystal)),
    one('banner', range(4).map(banner), 5, true),
    one('anvil', range(BENCH_FRAMES).map(craftingBench), 5, true),
    one('ruinWall', range(3).map(ruinWall)),
    ...kitPropSprites(),
  ];
}
