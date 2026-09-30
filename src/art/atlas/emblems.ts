// Six 24x24 theme emblems for the node plates (brief A, 5.1): what you will fight, at a glance.
//   Ashen Forge = anvil over a coal        Cinder Chapel = broken rose window     Rimed Ossuary = skull in ice
//   Choral Crypt = cantor in a niche       Iron Coliseum = arch and crossed blades Chainworks = cog and hook
// Drawn with Sculpt (shaded primitives) plus a few pixel passes, lit from the top-left like every icon in the game.
import type { MapBaseId } from '../../contracts/content';
import { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { lineCells, mix } from '../raster';
import { Sculpt, hash2, type PrimStyle } from '../shade';

const S = 24;
const st = (ramp: Ramp, bias = 0.2, extra: Partial<PrimStyle> = {}): PrimStyle => ({ ramp, bias, dither: 0.06, ...extra });
const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const line = (f: Frame, x0: number, y0: number, x1: number, y1: number, c: Color): void => lineCells(x0, y0, x1, y1, (x, y) => px(f, x, y, c));

function anvil(): Frame {
  const f = new Frame(S, S);
  // the coal bed: a heap of dark lumps with glowing seams
  const coal = new Sculpt();
  coal.ell(12, 20, 9, 3.6, st(RAMPS.cinder, 0.3, { round: 0.9 }));
  for (const [x, y, r] of [[6.5, 19.5, 2.2], [10, 21, 2.4], [14, 20.5, 2.5], [17.5, 19.8, 2]] as const) coal.ell(x, y, r, r * 0.8, st(RAMPS.cinder, 0.6, { round: 0.9 }));
  coal.render(f.c, f.e);
  for (const [x, y] of [[7, 20], [9, 21], [11, 20], [13, 21], [15, 20], [17, 21], [10, 19], [14, 19], [8, 22], [12, 22], [16, 22]] as const) f.glow(x, y, hash2(x, y, 4) > 0.5 ? C.flame : C.ember, 230);
  f.glow(12, 20, C.hot, 255); f.glow(11, 20, C.flame, 255);
  // the anvil
  const a = new Sculpt();
  a.poly([[8, 12], [16, 12], [15.5, 16.5], [8.5, 16.5]], st(RAMPS.metal, 0.1, { cyl: 0.5 }), 1.4); // waist
  a.poly([[6, 16], [18, 16], [19.5, 19], [4.5, 19]], st(RAMPS.metal, 0.3), 1.4, 0, -0.2); // foot
  a.poly([[4, 7.5], [20.5, 7.5], [19.5, 12.4], [7, 12.4], [4, 10.5]], st(RAMPS.metal, 0.55), 1.6, 0, -0.5); // face
  a.poly([[1.2, 8.4], [5.2, 7.5], [5.5, 11], [4, 11]], st(RAMPS.metal, 0.4), 1.2); // horn
  a.render(f.c, f.e);
  line(f, 4, 7, 20, 7, C.metalHi);
  line(f, 6, 8, 19, 8, C.metalLight);
  px(f, 2, 8, C.metalHi);
  px(f, 20, 8, C.hot);
  // ember light spilling upward onto the waist and foot
  for (const [x, y] of [[9, 18], [10, 18], [13, 18], [14, 18], [15, 18], [17, 18]] as const) if (f.c.opaque(x, y)) px(f, x, y, mix(f.c.get(x, y), C.flame, 0.55));
  // spark flying off the face
  f.glow(16, 4, C.hot, 255); f.glow(17, 3, C.flame, 220); f.glow(14, 5, C.ember, 200); f.glow(19, 5, C.flame, 200);
  f.outline({ selective: false, color: C.ink });
  return f;
}

function roseWindow(): Frame {
  const f = new Frame(S, S);
  const cx = 12, cy = 12;
  const broken = 5; // the missing pane
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    if (r > 11) continue;
    const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    const seg = ang / (Math.PI / 4);
    const k = Math.floor(seg) % 8;
    const toSpoke = Math.min(seg - Math.floor(seg), 1 - (seg - Math.floor(seg))) * (Math.PI / 4) * r; // px distance to a spoke
    const lit = -(dx + dy) / (r + 0.01) * 0.5;
    if (r > 8.6) {
      // stone ring with a lit upper-left lip
      const ring = RAMPS.stone;
      let i = 3 + Math.round(lit * 2);
      if (r > 10.3) i = lit > 0.1 ? 5 : 2;
      f.c.set(x, y, ring[Math.max(1, Math.min(5, i))]);
      if (hash2(x, y, 61) > 0.92) f.c.set(x, y, ring[Math.max(1, Math.min(5, i - 1))]);
      continue;
    }
    if (r < 2.7) {
      f.c.set(x, y, lit > 0 ? C.goldHi : C.ochre);
      continue;
    }
    if (toSpoke < 0.9) {
      f.c.set(x, y, lit > 0 ? C.ashGrey : C.stone);
      continue;
    }
    if (k === broken) {
      // shards: only ragged teeth of glass remain near the rim, the rest is open dark
      const tooth = r > 6.2 + Math.sin(ang * 9) * 1.4 + hash2(x, y, 9) * 1.2;
      if (!tooth) continue;
    }
    // glass pane: warm ember-lit colours with a per-pane tint and facet lines
    const tints: Color[] = [C.flame, C.ember, C.gold, C.flame, C.ember, C.gold, C.ember, C.flame];
    const base = tints[k];
    const shade = 0.15 + 0.55 * (1 - Math.min(1, (r - 2.7) / 6)); // brighter nearer the hub
    f.glow(x, y, mix(mix(base, C.lavaDark, 0.35 - shade * 0.3), C.hot, Math.max(0, shade - 0.45)), 150 + shade * 100);
  }
  // crack across the broken pane
  line(f, 6, 18, 9, 14, C.ink); line(f, 9, 14, 8, 12, C.ink);
  f.outline({ selective: false, color: C.ink });
  return f;
}

function iceSkull(): Frame {
  const f = new Frame(S, S);
  const ice = new Sculpt();
  ice.poly([[12, 0.8], [19.4, 6], [19.4, 17.5], [12, 23.2], [4.6, 17.5], [4.6, 6]], st(RAMPS.frost.slice(0, 6), 0.8, { round: 0.6, dither: 0.05 }), 2.2, 0, -0.2);
  ice.render(f.c, f.e);
  // facet lines: the shard's inner edges
  line(f, 12, 1, 12, 6, C.ice); line(f, 4.6, 6.5, 8, 9, C.frost); line(f, 19.4, 6.5, 16, 9, C.frostMid); line(f, 5, 17, 8, 14, C.frostMid); line(f, 19, 17, 16, 14, C.frostDark);
  // the skull, slightly frosted
  const bone = new Sculpt();
  bone.poly([[9.6, 13], [14.4, 13], [13.6, 17.2], [10.4, 17.2]], st(RAMPS.bone, 0.3, { round: 0.6 }), 1);
  bone.ell(12, 10, 4.8, 4.5, st(RAMPS.bone, 0.55, { round: 0.9 }));
  bone.render(f.c, f.e);
  for (const [x, y] of [[9, 9], [10, 9], [9, 10], [10, 10], [14, 9], [15, 9], [14, 10], [15, 10]] as const) px(f, x, y, C.ink);
  for (const [x, y] of [[9, 10], [15, 10]] as const) f.glow(x, y, C.ice, 255);
  px(f, 12, 12.5, C.char); px(f, 11, 13, C.char); px(f, 12, 13, C.ink); px(f, 13, 13, C.char);
  for (const x of [11, 13]) { px(f, x, 15, C.ink); px(f, x, 16, C.ink); }
  line(f, 10, 17, 14, 17, C.ashGrey);
  // frost over everything: glints and a cold rim
  for (const [x, y] of [[8, 5], [16, 4], [7, 13], [17, 12], [11, 21], [14, 20]] as const) px(f, x, y, C.white);
  line(f, 6, 5, 8, 3, C.white); line(f, 17, 20, 18, 18, C.ice);
  f.outline({ selective: false, color: C.ink });
  return f;
}

function cantor(): Frame {
  const f = new Frame(S, S);
  const cx = 12;
  // the gothic niche
  const inNiche = (x: number, y: number, inset: number): boolean => {
    const dx = x + 0.5 - cx;
    if (y + 0.5 < 9) return dx * dx + (y + 0.5 - 9) * (y + 0.5 - 9) <= (8.6 - inset) * (8.6 - inset);
    return Math.abs(dx) <= 8.6 - inset && y < 24;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inNiche(x, y, 0)) continue;
    const lit = -((x + 0.5 - cx) + (y - 10) * 0.6) / 12;
    if (!inNiche(x, y, 2)) f.c.set(x, y, RAMPS.oss[Math.max(1, Math.min(5, 3 + Math.round(lit * 2)))]);
    else f.c.set(x, y, mix(C.voidDark, C.voidDeep, Math.min(1, Math.max(0, (y - 4) / 18)) * 0.9));
  }
  // vaulting ribs
  line(f, 4, 9, 12, 3, C.ossPale); line(f, 20, 9, 12, 3, C.ossLight);
  // the singer: hooded head and robe
  const g = new Sculpt();
  g.poly([[6.8, 23.6], [8.6, 14.6], [15.4, 14.6], [17.2, 23.6]], st(RAMPS.wine, 0.1, { cyl: 0.8 }), 1.4);
  g.ell(12, 10.6, 4.2, 5, st(RAMPS.wine, 0.2, { round: 0.9 }));
  g.render(f.c, f.e);
  for (let y = 7; y <= 13; y++) for (let x = 9; x <= 15; x++) {
    const dx = (x + 0.5 - 12) / 2.9, dy = (y + 0.5 - 10.8) / 3.6;
    if (dx * dx + dy * dy <= 1) px(f, x, y, C.voidDeep);
  }
  // open mouth, glowing with song
  for (const [x, y] of [[11, 12], [12, 12], [11, 13], [12, 13], [11, 14], [12, 14]] as const) f.glow(x, y, y === 13 ? C.white : C.voidGlow, 255);
  f.glow(10, 13, C.void, 200); f.glow(13, 13, C.void, 200);
  for (const [x, y] of [[10, 9], [13, 9]] as const) f.glow(x, y, C.voidGlow, 180);
  // song rings to both sides
  for (const s of [-1, 1]) for (const [dx, dy, c] of [[5.5, 0, C.voidHi], [5.5, 1, C.voidGlow], [5.5, -1, C.voidGlow], [7.2, 2, C.voidGlow], [7.2, -2, C.voidGlow], [7.2, 0, C.void]] as const) f.glow(Math.round(cx + s * dx - (s > 0 ? 0 : 0.5)), Math.round(13 + dy), c, 190);
  f.outline({ selective: false, color: C.ink });
  return f;
}

function coliseum(): Frame {
  const f = new Frame(S, S);
  const sand = RAMPS.sand;
  // the arch: two piers and a half-ring, laid in courses
  const inArch = (x: number, y: number, inner: boolean): boolean => {
    const dx = x + 0.5 - 12;
    const r = inner ? 6.2 : 10.4;
    if (y + 0.5 < 11) return dx * dx + (y + 0.5 - 11) * (y + 0.5 - 11) <= r * r;
    return Math.abs(dx) <= r && y < 23.6;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inArch(x, y, false) || inArch(x, y, true)) continue;
    const dx = x + 0.5 - 12;
    const lit = -(dx + (y - 10) * 0.7) / 13;
    const course = Math.floor((Math.hypot(dx, Math.min(0, y - 10.5)) + (y > 11 ? Math.abs(dx) : 0)) / 2.4);
    const joint = (course + Math.floor(x / 4)) & 1;
    let i = 3 + Math.round(lit * 1.6) - (joint && (x + y) % 4 === 0 ? 1 : 0);
    if (y > 22) i -= 1;
    f.c.set(x, y, sand[Math.max(0, Math.min(4, i))]);
  }
  // keystone
  for (const [x, y] of [[11, 0], [12, 0], [11, 1], [12, 1]] as const) f.c.set(x, y, C.sandLight);
  // crossed blades over the opening
  const blade = (x0: number, y0: number, x1: number, y1: number, rot: number): void => {
    const s = new Sculpt();
    s.cap(x0, y0, x1, y1, 1.3, 0.9, st(RAMPS.metal, 0.9, { round: 0.9 }));
    s.render(f.c, f.e);
    // guard and grip at the low end
    const gx = x0 + (x1 - x0) * 0.16, gy = y0 + (y1 - y0) * 0.16;
    line(f, gx - rot * 2.4, gy - 2.4, gx + rot * 2.4, gy + 2.4, C.goldHi);
    line(f, x0, y0, x0 + (x1 - x0) * -0.08 + rot * 0, y0 + 2.2, C.woodDark);
    px(f, x0, y0 + 2.4, C.gold);
  };
  blade(5.5, 20.5, 19.5, 5, -1);
  blade(18.5, 20.5, 4.5, 5, 1);
  f.glow(19, 5, C.hot, 200); f.glow(5, 5, C.hot, 200);
  f.outline({ selective: false, color: C.ink });
  return f;
}

function cogHook(): Frame {
  const f = new Frame(S, S);
  const rust: Ramp = [C.metalDeep, C.rustDark, C.rust, C.metalMid, C.metalLight, C.metalHi];
  const cx = 10.5, cy = 10.5;
  // cog with eight teeth
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const tooth = Math.cos(ang * 8) > 0.15 ? 9.6 : 7.6;
    if (r > tooth || r < 2.9) continue;
    const lit = -(dx + dy) / (r * 1.41 + 0.01);
    let i = 4 + Math.round(lit * 1.7);
    if (r < 4.4) i -= 1; // hub
    if (r > 6.2 && r < 7.6 && hash2(x, y, 3) > 0.8) i -= 1; // rust pitting
    if (r > 6.6 && r < 7.6 && lit < -0.3) i = Math.min(i, 2);
    if (r > 7.6) i = Math.max(i, lit > 0 ? 5 : 3); // lit tooth tips
    f.c.set(x, y, rust[Math.max(0, Math.min(5, i))]);
    if (r >= 4.4 && r <= 5.2 && lit < 0) f.c.set(x, y, C.rust);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (r < 3.5 && r >= 2.4) f.glow(x, y, r < 2.9 ? C.flame : C.ember, 230); else if (r < 2.4) f.c.set(x, y, C.ink); }
  px(f, 8, 8, C.metalHi); px(f, 9, 7, C.metalHi);
  // chain links running down to the hook
  const link = (lx: number, ly: number, horiz: boolean): void => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - lx) / (horiz ? 3.2 : 1.9), dy = (y + 0.5 - ly) / (horiz ? 1.9 : 3.2);
      const d = dx * dx + dy * dy;
      if (d <= 1 && d > 0.32) f.c.set(x, y, x + y < lx + ly ? C.metalHi : C.metalMid);
    }
  };
  link(16.5, 14.5, true); link(18.2, 17.8, false);
  // hook: a curved iron J with a sharp barb
  const hook: [number, number][] = [[18, 19], [18, 20], [18, 21], [17, 22], [16, 22.6], [14.6, 22], [14, 20.6], [14.6, 19.6]];
  hook.forEach(([x, y]) => { px(f, x, y, C.metalHi); px(f, x + 1, y, C.metalMid); });
  px(f, 14, 19, C.metalHi); px(f, 14, 18.4, C.white);
  for (const [x, y] of [[9, 4], [15, 9], [4, 15]] as const) px(f, x, y, C.metalMid);
  // hot rim where the works are glowing
  f.glow(14, 5, C.ember, 180); f.glow(15, 5, C.flame, 200);
  f.outline({ selective: false, color: C.ink });
  return f;
}

const CACHE = new Map<MapBaseId, Frame>();
const GEN: Record<MapBaseId, () => Frame> = {
  ashenForge: anvil,
  cinderChapel: roseWindow,
  rimedOssuary: iceSkull,
  choralCrypt: cantor,
  ironColiseum: coliseum,
  chainworks: cogHook,
} as unknown as Record<MapBaseId, () => Frame>;

/** The 24x24 emblem of a map theme (cached; do not mutate). */
export function emblem(theme: MapBaseId): Frame {
  let f = CACHE.get(theme);
  if (!f) {
    f = (GEN[theme] ?? anvil)();
    CACHE.set(theme, f);
  }
  return f;
}
