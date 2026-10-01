// CHAMPION'S RING on the ground: a chain-iron altar with three vow stones (open hand, shield, spike tile; each fills as the
// party stands on it), then a wall of chain links round the arena (ember glow on Ashen maps, frost on Ossuary, iron and blood sand on
// Coliseum), and the Champion's marker. Everything on the decal layer or a thin additive line.
import type { MapEventView, MapEventZone } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import { C } from '../colors';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

const IRON: RGB = [0.72, 0.68, 0.62];
const COLD: RGB = [0.55, 0.8, 1];
const EMBER: RGB = [1, 0.5, 0.22];
const SAND: RGB = [0.62, 0.16, 0.12];
const VOWS = ['Bare Hands', 'Iron Pride', "Crowd's Favour"] as const;

function skinTone(theme: string): RGB {
  return theme === 'rimedOssuary' || theme === 'choralCrypt' ? COLD : theme === 'ironColiseum' || theme === 'chainworks' ? IRON : EMBER;
}

/** The vow's glyph inside its stone: an open hand, a heater shield, a spiked tile. */
function glyph(pen: Pen, x: number, y: number, n: number, col: RGB, a: number): void {
  const o = pen.shape(col, a, 'decal');
  o.thickness = 1.5;
  o.additive = true;
  const r = pen.r;
  if (n === 0) {
    r.ring(x, y + 2, 4, o);
    for (let f = -2; f <= 2; f++) r.line(x + f * 2.6, y - 1, x + f * 3.2, y - 9 + Math.abs(f), o);
  } else if (n === 1) {
    r.line(x - 7, y - 7, x + 7, y - 7, o);
    r.line(x + 7, y - 7, x + 6, y + 2, o);
    r.line(x + 6, y + 2, x, y + 9, o);
    r.line(x, y + 9, x - 6, y + 2, o);
    r.line(x - 6, y + 2, x - 7, y - 7, o);
    r.line(x, y - 7, x, y + 8, o);
  } else {
    r.line(x - 8, y + 6, x + 8, y + 6, o);
    for (let k = -1; k <= 1; k++) { r.line(x + k * 5 - 3, y + 6, x + k * 5, y - 6, o); r.line(x + k * 5, y - 6, x + k * 5 + 3, y + 6, o); }
  }
}

function stone(pen: Pen, f: FrameCtx, z: MapEventZone, tone: RGB): void {
  const chosen = z.v === 255, spent = z.v === 254;
  const base = pen.shape(IRON, spent ? 0.25 : 0.7, 'decal');
  base.thickness = 3;
  pen.r.ring(z.x, z.y, z.r * 0.75, base);
  const rim = pen.shape(tone, spent ? 0.15 : chosen ? 0.9 : 0.45, 'decal');
  rim.thickness = 1.5;
  rim.additive = true;
  pen.r.ring(z.x, z.y, z.r, rim);
  if (!chosen && !spent && z.v > 0) {
    const prog = pen.shape(C.gold, 0.9, 'decal');
    prog.thickness = 3;
    prog.additive = true;
    prog.arc = clamp01(z.v / 100);
    pen.r.ring(z.x, z.y, z.r + 4, prog);
  }
  const pulse = chosen ? 0.7 + 0.3 * Math.sin(f.time * 6) : 0.55;
  glyph(pen, z.x, z.y, z.n ?? 0, chosen ? C.gold : tone, spent ? 0.2 : pulse);
  if (!spent) {
    pen.r.text(VOWS[z.n ?? 0] ?? '', z.x, z.y + z.r + 14, pen.text(chosen ? C.gold : tone, chosen ? 0.95 : 0.8, 1));
    pen.light(z.x, z.y, z.r * 2, chosen ? C.gold : tone, chosen ? 0.5 : 0.2, 0.2);
  }
}

/** The wall: chain links round the arena. v 0 preview (faint dashes), 2 rising (links light one by one), 1 standing. */
function arena(pen: Pen, f: FrameCtx, z: MapEventZone, tone: RGB): void {
  const theme = f.theme;
  const standing = z.v === 1;
  const links = 56;
  const step = TAU / links;
  const alpha = z.v === 0 ? 0.16 : z.v === 2 ? 0.45 + 0.25 * Math.sin(f.time * 9) : 0.85;
  const o = pen.shape(standing ? IRON : tone, alpha, 'decal');
  o.thickness = 1.5;
  for (let k = 0; k < links; k++) {
    if (z.v === 0 && k % 2) continue;
    const a = k * step;
    const x = z.x + Math.cos(a) * z.r, y = z.y + Math.sin(a) * z.r;
    // A chain link: a small ring, alternately seen flat and on edge.
    if (k % 2 === 0) pen.r.ring(x, y, 3.2, o);
    else pen.r.line(x - Math.sin(a) * 3.4, y + Math.cos(a) * 3.4, x + Math.sin(a) * 3.4, y - Math.cos(a) * 3.4, o);
  }
  if (standing) {
    const glow = pen.shape(tone, 0.4 + 0.12 * Math.sin(f.time * 3), 'decal');
    glow.thickness = 2;
    glow.additive = true;
    glow.emissive = 0.7;
    pen.r.ring(z.x, z.y, z.r - 2, glow);
    // The floor inside: blood sand on the Coliseum, cinders on Ashen maps, rime on Ossuary ones.
    const sand = pen.shape(theme === 'ironColiseum' || theme === 'chainworks' ? SAND : tone, 0.06, 'decal');
    pen.r.circle(z.x, z.y, z.r - 4, sand);
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8 + f.time * 0.05;
      const inner = pen.shape(tone, 0.12, 'decal');
      inner.thickness = 1;
      pen.r.line(z.x + Math.cos(a) * 18, z.y + Math.sin(a) * 18, z.x + Math.cos(a) * (z.r - 10), z.y + Math.sin(a) * (z.r - 10), inner);
    }
    for (let k = 0; k < 4; k++) pen.light(z.x + Math.cos(k * TAU / 4 + 0.6) * z.r * 0.95, z.y + Math.sin(k * TAU / 4 + 0.6) * z.r * 0.95, 70, tone, 0.35, 0.3);
  }
}

function altar(pen: Pen, f: FrameCtx, z: MapEventZone, tone: RGB): void {
  const o = pen.shape(IRON, 0.75, 'decal');
  o.thickness = 3;
  pen.r.ring(z.x, z.y, z.r, o);
  const inner = pen.shape(tone, 0.4 + 0.15 * Math.sin(f.time * 2), 'decal');
  inner.additive = true;
  inner.thickness = 1.5;
  pen.r.ring(z.x, z.y, z.r * 0.6, inner);
  // Two crossed swords.
  const s = pen.shape(IRON, 0.85, 'decal');
  s.thickness = 2;
  pen.r.line(z.x - 9, z.y - 9, z.x + 9, z.y + 9, s);
  pen.r.line(z.x + 9, z.y - 9, z.x - 9, z.y + 9, s);
  pen.light(z.x, z.y, 90, tone, 0.35, 0.25);
}

export const ringArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    const tone = skinTone(f.theme);
    for (const z of e.zones) {
      if (z.kind === 'stone') stone(pen, f, z, tone);
      else if (z.kind === 'arena') arena(pen, f, z, tone);
      else if (z.kind === 'altar') altar(pen, f, z, tone);
    }
    for (const m of e.markers) {
      if (m.icon !== 'champion') continue;
      // A small iron crest and a life tick over the Champion.
      const o = pen.shape(C.gold, 0.9, 'fx');
      o.thickness = 1.5;
      o.additive = true;
      const x = m.x, y = m.y - 62;
      pen.r.line(x - 8, y + 5, x - 8, y - 2, o);
      pen.r.line(x - 8, y - 2, x - 4, y + 2, o);
      pen.r.line(x - 4, y + 2, x, y - 5, o);
      pen.r.line(x, y - 5, x + 4, y + 2, o);
      pen.r.line(x + 4, y + 2, x + 8, y - 2, o);
      pen.r.line(x + 8, y - 2, x + 8, y + 5, o);
      pen.r.line(x - 8, y + 5, x + 8, y + 5, o);
      pen.r.text('Champion', x, y - 10, pen.text(col, 0.9, 1));
    }
  },
  residue(beat, n) {
    return beat === 'crack' && n === 0 ? { r: 40 } : beat === 'complete' ? { r: 34 } : null;
  },
};
