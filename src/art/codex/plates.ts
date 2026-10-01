// Codex node plates (brief A, 8.2), drawn per class and state from one parametric function:
//   small    brass rivet-head with a relief glyph          notable  scalloped wax-seal medallion
//   lens     violet rift-glass lens (event notables)       tier     octagonal stamped brass plate
//   seal     theme seal in the theme's light + emblem      keystone forged iron sigil-ring around an ember core
// States: locked (cold iron), ready (a neighbour is allocated: brass, half lit), on (allocated: lit, emissive) and
// gated (specified but its engine is not live: blueprint-cold with hatching). Exclusion is drawn on top by the renderer.
// Odd frame sizes so the glyph and the plate centre share a pixel; lit from the top-left like all game art.
import { Frame } from '../frame';
import { C, RAMPS, hexToColor, type Color, type Ramp } from '../palette';
import { ca, mix, rgba } from '../raster';
import { emblem } from '../atlas/emblems';
import type { MapBaseId } from '../../contracts/content';
import { glyphMask, type GlyphId } from './glyphs';
import { PLATE_R, PLATE_SIZE, TONES, type PlateClass, type Tone } from './tones';

export type PlateState = 'locked' | 'ready' | 'on' | 'gated';
export interface PlateSpec { cls: PlateClass; tone: Tone; /** Second branch of a bridge: tints the rim. */ tone2?: Tone; glyph: GlyphId; state: PlateState }

const BAYER = [0, 2, 3, 1];
const dith = (x: number, y: number): number => (BAYER[(y & 1) * 2 + (x & 1)] / 4 - 0.375) * 0.9;
const pick = (ramp: Ramp, v: number, x: number, y: number): Color => {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1) + dith(x, y))));
  return ramp[i];
};
const tint = (ramp: Ramp, c: Color, k: number): Ramp => ramp.map((r) => mix(r, c, k));
const dim = (ramp: Ramp, k: number): Ramp => ramp.map((r) => mix(r, C.coal, k));
const lerpRamp = (a: Ramp, b: Ramp, k: number): Ramp => a.map((c, i) => mix(c, b[Math.min(i, b.length - 1)], k));

const IRON: Ramp = [C.metalDeep, C.metalDark, C.metal, C.metalMid, C.metalLight, C.metalHi];
const COLD: Ramp = RAMPS.oss;
const BRASS: Ramp = [C.goldDark, C.ochre, C.gold, C.goldHi, C.hot];

interface Look { rim: Ramp; face: Ramp; faceLo: number; faceHi: number; glyph: { body: Color; hi: Color; lo: Color }; lit: boolean }

function look(spec: PlateSpec): Look {
  const t = TONES[spec.tone], t2 = TONES[spec.tone2 ?? spec.tone];
  switch (spec.state) {
    case 'on': return { rim: tint(BRASS, t2.face[4], 0.16), face: t.face, faceLo: 0.26, faceHi: 0.86, glyph: t.glyph, lit: true };
    case 'ready': return { rim: tint(IRON, t2.face[4], 0.22), face: lerpRamp(dim(t.face, 0.5), t.face, 0.4), faceLo: 0.16, faceHi: 0.62, glyph: { body: mix(t.glyph.body, C.stone, 0.42), hi: mix(t.glyph.hi, C.stoneLight, 0.35), lo: C.ink }, lit: false };
    case 'gated': return { rim: dim(COLD, 0.05), face: COLD, faceLo: 0.08, faceHi: 0.5, glyph: { body: C.ossPale, hi: C.ossFrost, lo: C.ossDeep }, lit: false };
    default: return { rim: dim(IRON, 0.05), face: tint(dim(t.face, 0.78), C.iron, 0.3), faceLo: 0.06, faceHi: 0.5, glyph: { body: C.stoneLight, hi: C.ashGrey, lo: C.coal }, lit: false };
  }
}

function edgeRadius(cls: PlateClass, R: number, a: number): number {
  switch (cls) {
    case 'notable': return R * (1 + 0.05 * Math.cos(12 * a));
    case 'seal': return R * (1 + 0.05 * Math.cos(6 * a + Math.PI / 6));
    case 'keystone': return R * (0.86 + 0.14 * Math.max(0, Math.min(1, Math.cos(8 * a + Math.PI / 8) * 2.4 + 0.5)));
    default: return R;
  }
}

const RIM_W: Record<PlateClass, number> = { small: 2.3, notable: 2.7, lens: 2.5, tier: 2.7, seal: 2.7, keystone: 4 };
const GLYPH_N: Record<PlateClass, number> = { small: 9, notable: 11, lens: 11, tier: 11, seal: 11, keystone: 13 };

/** Paint a glyph mask as a relief: drop shadow, body, lit top-left edge, dark bottom-right edge. */
export function paintGlyph(f: Frame, id: GlyphId, n: number, cx: number, cy: number, g: { body: Color; hi: Color; lo: Color }, glow = 0): void {
  const m = glyphMask(id, n);
  const ox = cx - (n - 1) / 2, oy = cy - (n - 1) / 2;
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && m[y * n + x] === 1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (on(x, y) && !on(x + 1, y + 1)) f.c.plot(ox + x + 1, oy + y + 1, rgba(0, 0, 0, 150));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!on(x, y)) continue;
    const litEdge = !on(x - 1, y) || !on(x, y - 1);
    const darkEdge = !on(x + 1, y) || !on(x, y + 1);
    const col = litEdge && !darkEdge ? g.hi : darkEdge && !litEdge ? g.lo : litEdge ? mix(g.hi, g.body, 0.5) : g.body;
    f.c.set(ox + x, oy + y, col);
    f.e.set(ox + x, oy + y, glow > 0 ? (col & 0xffffff00) | Math.round(glow * (litEdge ? 1 : 0.7)) : 0);
  }
}

function chains(f: Frame, cx: number, cy: number, broken: boolean): void {
  const strand = (x0: number, y0: number, x1: number, y1: number, gapAt: number): void => {
    const n = 8;
    for (let i = 0; i <= n; i++) {
      if (broken && i >= gapAt && i <= gapAt + 1) continue;
      const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
      const horiz = i % 2 === 0;
      const w = horiz ? 5 : 3, h = horiz ? 3 : 5;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const border = xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1;
        f.c.set(x - (w >> 1) + xx, y - (h >> 1) + yy, border ? (xx + yy < 3 ? C.metalHi : C.metalMid) : C.ink);
      }
    }
  };
  strand(cx - 16, cy - 16, cx + 16, cy + 16, 5);
  strand(cx + 16, cy - 16, cx - 16, cy + 16, 2);
}

/** A plate frame (colour + emissive). Deterministic. */
export function plateFrame(spec: PlateSpec): Frame {
  const size = PLATE_SIZE[spec.cls], R = PLATE_R[spec.cls], c = (size - 1) / 2;
  const f = new Frame(size, size);
  const lk = look(spec);
  const rimW = RIM_W[spec.cls];
  const t = TONES[spec.tone];
  const { cls, state } = spec;
  const coreR = 8.6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - c, dy = y - c;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const oct = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) * 0.7071);
    const d = cls === 'tier' ? oct : r;
    const edge = cls === 'tier' ? R : edgeRadius(cls, R, a);
    if (d > edge + 0.3) continue;
    const e = edge - d; // depth below the rim
    const nx = r > 0 ? dx / r : 0, ny = r > 0 ? dy / r : 0;
    const lit = -(nx * 0.6 + ny * 0.8);
    const u = Math.min(1, r / R);
    if (e < rimW) {
      const outer = e < rimW * 0.5;
      const v = outer ? 0.55 + 0.42 * lit : 0.4 - 0.3 * lit;
      f.c.set(x, y, pick(lk.rim, Math.max(0, Math.min(1, v)), x, y));
      if (state === 'on' && outer && lit > 0.55) f.e.set(x, y, (C.hot & 0xffffff00) | 110);
      continue;
    }
    if (cls === 'keystone') {
      if (r <= coreR) continue; // the core is painted below
      // ring body between the outer edge and the core: raised band, groove at the core
      const groove = r < coreR + 1.3;
      const v = groove ? 0.12 : 0.42 + 0.3 * lit;
      f.c.set(x, y, pick(state === 'on' ? tint(IRON, C.gold, 0.14) : lk.rim, v, x, y));
      continue;
    }
    // face
    let v = lk.faceLo + (lk.faceHi - lk.faceLo) * Math.max(0, Math.min(1, 0.72 - 0.34 * u + 0.36 * lit * u));
    if (cls === 'lens') {
      // rift glass: radial glow and eight facets
      const seg = (a + Math.PI) / (Math.PI / 4);
      const fr = Math.abs(seg - Math.round(seg)) * r * (Math.PI / 4);
      v = lk.faceLo + (lk.faceHi - lk.faceLo) * (1 - u * 0.9) + (fr < 0.55 && r > 3.5 ? 0.14 : 0) + (Math.floor(seg) % 2 ? 0.05 : -0.03);
    }
    if (cls === 'notable' && e < rimW + 1) v *= 0.55; // recessed ring line inside the raised rim
    if (cls === 'tier' && e < rimW + 1) v *= 0.6;
    if (cls === 'seal') v *= 0.8;
    let col = pick(lk.face, Math.max(0, Math.min(1, v)), x, y);
    if (state === 'gated' && (x + y) % 4 === 0) col = mix(col, C.ossDeep, 0.5);
    f.c.set(x, y, col);
    if (state === 'on' && cls === 'lens' && u < 0.75) f.e.set(x, y, (mix(t.face[4], C.white, 0.3) & 0xffffff00) | Math.round(60 * (1 - u)));
  }
  // tier plates: four corner rivets
  if (cls === 'tier') for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    f.c.set(c + sx * 8, c + sy * 8, state === 'on' ? C.hot : C.metalLight);
    f.c.set(c + sx * 8 + 1, c + sy * 8 + 1, C.ink);
  }
  // keystone core: an ember in an iron socket
  if (cls === 'keystone') {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c, r = Math.hypot(dx, dy);
      if (r > coreR) continue;
      const u = r / coreR;
      const lit = -(dx * 0.6 + dy * 0.8) / (r || 1);
      if (state === 'on') {
        const col = pick(RAMPS.ember, 0.98 - u * 0.6 + lit * 0.06 * u, x, y);
        f.c.set(x, y, col);
        f.e.set(x, y, (col & 0xffffff00) | Math.round(235 - u * 60));
      } else if (state === 'ready') {
        f.c.set(x, y, pick([C.ink, C.coal, C.rustDeep, C.blood], 0.35 + (1 - u) * 0.4, x, y));
        if (u < 0.5 && (x + y) % 2 === 0) f.e.set(x, y, (C.ember & 0xffffff00) | 70);
      } else if (state === 'gated') f.c.set(x, y, pick([C.ossDeep, C.ossDark, C.ossMid], 0.5 - u * 0.3, x, y));
      else f.c.set(x, y, pick([C.ink, C.coal, C.char], 0.7 - u * 0.5 - lit * 0.15 * u, x, y));
    }
    // studs on the ring at the eight tooth centres
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 - Math.PI / 8 + Math.PI / 8;
      const sx = Math.round(c + Math.cos(a) * (R - 3)), sy = Math.round(c + Math.sin(a) * (R - 3));
      f.c.set(sx, sy, state === 'on' ? C.hot : C.metalLight);
    }
  }
  f.outline({ selective: false, color: state === 'gated' ? C.ossDeep : C.ink });

  // face decoration
  if (cls === 'seal') {
    const emb = emblem(spec.tone as MapBaseId);
    const em = emb.clone();
    if (state !== 'on') {
      em.c.map((col) => { const l = (0.3 * (col >>> 24) + 0.5 * ((col >>> 16) & 255) + 0.2 * ((col >>> 8) & 255)) * (state === 'ready' ? 0.9 : 0.5); return (mix(rgba(l, l * 0.96, l * 0.92, 255), col, state === 'ready' ? 0.35 : 0.08) & 0xffffff00) | ca(col); });
      for (let yy = 0; yy < em.h; yy++) for (let xx = 0; xx < em.w; xx++) if (em.e.opaque(xx, yy)) em.e.set(xx, yy, 0);
    }
    // backing so the emblem reads
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      if (r <= R - rimW - 0.6 && ca(f.c.get(x, y)) > 0) f.c.set(x, y, mix(f.c.get(x, y), C.ink, state === 'on' ? 0.5 : 0.7));
    }
    f.draw(em, c - 12, c - 12);
  } else {
    const g = cls === 'keystone' && state === 'on' ? { body: C.coal, hi: C.iron, lo: C.ink } : lk.glyph;
    paintGlyph(f, spec.glyph, GLYPH_N[cls], c, c, g, state === 'on' && cls !== 'keystone' ? 200 : 0);
  }
  if (cls === 'keystone') {
    if (state === 'locked') chains(f, c, c, false);
    else if (state === 'ready') chains(f, c, c, true);
  }
  return f.clampEmissive();
}

const cache = new Map<string, Frame>();
export function cachedPlate(spec: PlateSpec): Frame {
  const key = `${spec.cls}|${spec.tone}|${spec.tone2 ?? ''}|${spec.glyph}|${spec.state}`;
  let f = cache.get(key);
  if (!f) { f = plateFrame(spec); cache.set(key, f); }
  return f;
}

/** A 9x11 padlock badge for gated nodes, in the cold blueprint blue. */
export function padlockBadge(): Frame {
  const f = new Frame(11, 13);
  const cx = 5;
  for (let y = 0; y < 13; y++) for (let x = 0; x < 11; x++) {
    const dx = x - cx, dy = y - 4;
    if (y >= 6 && y <= 11 && Math.abs(dx) <= 4) f.c.set(x, y, y === 6 || dx === -4 ? C.ossFrost : dx === 4 || y === 11 ? C.ossMid : C.ossPale);
    else if (y <= 6 && Math.abs(Math.hypot(dx, dy) - 3.2) < 1.1 && y <= 6) f.c.set(x, y, dx <= 0 ? C.ossFrost : C.ossPale);
  }
  f.c.set(cx, 8, C.ossDeep); f.c.set(cx, 9, C.ossDeep);
  f.outline({ selective: false, color: C.ossDeep });
  return f;
}

/** A tiny exclusion padlock (rust-red iron) for mutually exclusive keystones. */
export function excludeBadge(): Frame {
  const f = new Frame(11, 13);
  const cx = 5;
  for (let y = 0; y < 13; y++) for (let x = 0; x < 11; x++) {
    const dx = x - cx, dy = y - 4;
    if (y >= 6 && y <= 11 && Math.abs(dx) <= 4) f.c.set(x, y, y === 6 || dx === -4 ? hexToColor('#e0644a') : dx === 4 || y === 11 ? C.blood : hexToColor('#b0222c'));
    else if (y <= 6 && Math.abs(Math.hypot(dx, dy) - 3.2) < 1.1) f.c.set(x, y, dx <= 0 ? C.metalHi : C.metalMid);
  }
  f.c.set(cx, 8, C.ink); f.c.set(cx, 9, C.ink);
  f.outline({ selective: false, color: C.ink });
  return f;
}
