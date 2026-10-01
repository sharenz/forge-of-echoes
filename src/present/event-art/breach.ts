// VOID BREACH ground art: a violet tear at the eye (a vertical lens that widens once it is open), the SAFE RING (a bright dashed ring
// on the decal layer: stay inside it) with the next step's ring dim beyond it, the Void Heart (a spiked crystal with a life bar and a
// ward shimmer while the Voidcallers live) and labels on the Voidcallers. The tide band itself is an area (present/areas.ts voidTide).
// Everything sits on the decal layer or as a thin additive line; nothing covers a telegraph, a monster or a drop.
import type { MapEventView, MapEventZone } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

function skinColor(theme: string, col: RGB): RGB {
  return theme === 'rimedOssuary' || theme === 'choralCrypt' ? [0.45, 0.7, 1] : theme === 'ironColiseum' || theme === 'chainworks' ? [0.85, 0.3, 0.4] : col;
}

/** A dashed ring: `segments` arcs covering `fill` of the circle, turning at `rot`. */
function dashedRing(pen: Pen, x: number, y: number, r: number, col: RGB, alpha: number, segments: number, fill: number, rot: number, thick: number): void {
  const o = pen.shape(col, alpha, 'decal');
  o.thickness = thick;
  o.additive = true;
  o.emissive = 0.7;
  const step = TAU / segments, span = step * fill, n = Math.max(2, Math.round(r / 60));
  for (let s = 0; s < segments; s++) {
    const a0 = rot + s * step;
    for (let q = 0; q < n; q++) {
      const u0 = a0 + span * q / n, u1 = a0 + span * (q + 1) / n;
      pen.r.line(x + Math.cos(u0) * r, y + Math.sin(u0) * r, x + Math.cos(u1) * r, y + Math.sin(u1) * r, o);
    }
  }
}

function tear(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
  const open = z.v >= 2 && z.v < 3;
  const sealed = z.v >= 3;
  const pulse = 0.6 + 0.4 * Math.sin(f.time * (open ? 3.2 : 1.8));
  const h = sealed ? 18 : open ? 46 : 34, w = (sealed ? 3 : open ? 14 : 8) * (0.85 + 0.15 * pulse);
  const o = pen.shape(col, (sealed ? 0.3 : 0.85) * pulse, 'decal');
  o.thickness = open ? 2.5 : 1.8;
  o.additive = true;
  o.emissive = 1;
  // A vertical lens: two arcs meeting at points.
  for (const sgn of [-1, 1]) {
    let px = z.x, py = z.y - h;
    for (let s = 1; s <= 14; s++) {
      const u = -1 + s / 7, y = z.y + u * h, x = z.x + sgn * w * (1 - u * u);
      pen.r.line(px, py, x, y, o);
      px = x; py = y;
    }
  }
  const core = pen.shape([0.1, 0.02, 0.2], sealed ? 0.3 : 0.75, 'decal');
  core.thickness = Math.max(2, w * 0.9);
  pen.r.line(z.x, z.y - h * 0.8, z.x, z.y + h * 0.8, core);
  if (!sealed) {
    dashedRing(pen, z.x, z.y, open ? 58 : 44, col, 0.4 * pulse, 5, 0.55, f.time * (open ? 0.9 : 0.4), 1.4);
    pen.light(z.x, z.y, open ? 170 : 110, col, (open ? 0.6 : 0.4) * pulse, 0.2);
  }
  if (z.v < 2) dashedRing(pen, z.x, z.y, z.r, col, 0.14, 40, 0.3, 0, 1);
}

function safeRing(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
  const next = (z.n ?? 0) === 1;
  if (next) {
    dashedRing(pen, z.x, z.y, z.r, col, 0.3, 36, 0.35, -f.time * 0.05, 1.2);
    pen.r.text('NEXT', z.x + z.r * 0.707, z.y - z.r * 0.707 - 6, pen.text(col, 0.6, 1.2));
    return;
  }
  // The edge that matters: bright, slowly turning, with a faint lit floor inside it.
  dashedRing(pen, z.x, z.y, z.r, [1, 1, 1], 0.55, 48, 0.62, f.time * 0.06, 1.8);
  dashedRing(pen, z.x, z.y, z.r - 3, col, 0.65, 48, 0.62, f.time * 0.06, 1.2);
  const glow = pen.shape(col, 0.035, 'decal');
  glow.additive = true;
  pen.r.circle(z.x, z.y, z.r, glow);
}

function heart(pen: Pen, f: FrameCtx, x: number, y: number, warded: boolean, life: number, col: RGB): void {
  const pulse = 0.75 + 0.25 * Math.sin(f.time * 4);
  const o = pen.shape(col, 0.95, 'fx');
  o.thickness = 2;
  o.additive = true;
  o.emissive = 1;
  // A spiked crystal: a tall diamond with two short shards.
  const pts: [number, number][] = [[0, -26], [9, -6], [6, 10], [0, 16], [-6, 10], [-9, -6], [0, -26]];
  for (let k = 1; k < pts.length; k++) pen.r.line(x + pts[k - 1][0], y + pts[k - 1][1], x + pts[k][0], y + pts[k][1], o);
  pen.r.line(x, y - 26, x, y + 16, o);
  pen.r.line(x - 9, y - 6, x - 17, y - 14, o);
  pen.r.line(x + 9, y - 6, x + 17, y - 14, o);
  const fillc = pen.shape([0.3, 0.05, 0.5], 0.55 * pulse, 'decal');
  fillc.thickness = 14;
  pen.r.line(x, y - 20, x, y + 10, fillc);
  pen.light(x, y - 4, 90, col, 0.6 * pulse, 0.3);
  if (warded) {
    const sh = pen.shape([0.7, 0.85, 1], 0.35 + 0.15 * Math.sin(f.time * 6), 'fx');
    sh.additive = true;
    sh.emissive = 0.7;
    sh.thickness = 1.2;
    pen.r.ring(x, y - 4, 26, sh);
  }
  // Life bar under it.
  const bg = pen.shape([0, 0, 0], 0.6, 'fx');
  bg.thickness = 4;
  pen.r.line(x - 18, y + 24, x + 18, y + 24, bg);
  const fg = pen.shape(warded ? [0.6, 0.65, 0.8] : [0.9, 0.35, 0.8], 0.95, 'fx');
  fg.thickness = 2.5;
  pen.r.line(x - 17, y + 24, x - 17 + 34 * clamp01(life), y + 24, fg);
}

export const breachArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    const c = skinColor(f.theme, col);
    for (const z of e.zones) {
      if (z.kind === 'breach') tear(pen, f, z, c);
      else if (z.kind === 'tide') safeRing(pen, f, z, c);
    }
    for (const m of e.markers) {
      if (m.icon === 'heart') {
        heart(pen, f, m.x, m.y, m.v === 1, (m.w ?? 100) / 100, c);
        pen.r.text(m.v === 1 ? 'Warded Heart' : 'Void Heart', m.x, m.y - 40, pen.text(c, 0.85, 1));
      } else if (m.icon === 'guardian') {
        const ring = pen.shape(c, 0.8, 'fx');
        ring.additive = true;
        ring.thickness = 1.2;
        pen.r.ring(m.x, m.y - 8, 13 + Math.sin(f.time * 5) * 1.5, ring);
        pen.r.text('Voidcaller', m.x, m.y - 44, pen.text(c, 0.85, 1));
      }
    }
  },
  residue(beat, n) {
    if (beat === 'complete') return { r: 44 };
    if (beat === 'crack') return { r: 24 };
    void n;
    return null;
  },
};
