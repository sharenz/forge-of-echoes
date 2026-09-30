// BELLWATCH on the ground: a bell on a scaffold that swings before each toll, the faint reach of the rings, Dirge rings stacking round
// the bell, and the Cantors: a chain of light to the bell while one is shielded. Ossuary: a bone-white bell; ashen: a dark iron forge
// bell with ember light; coliseum: a rusted gong. Decal layer and thin additive lines: never over a monster, a drop or a telegraph.
import type { MapEventBeat, MapEventView } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import { BELL_INNER_RADIUS, BELL_OUTER_RADIUS } from '../../data/progression/events/bellwatch';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

const BONE: RGB = [0.88, 0.86, 0.74];
const IRON: RGB = [0.55, 0.52, 0.5];
const EMBER: RGB = [1, 0.6, 0.3];
const RUST: RGB = [0.75, 0.42, 0.3];
const SHIELD: RGB = [0.6, 0.85, 1];

type Skin = 'ashen' | 'ossuary' | 'coliseum';
const skinOf = (theme: string): Skin => (theme === 'rimedOssuary' || theme === 'choralCrypt' ? 'ossuary' : theme === 'ironColiseum' || theme === 'chainworks' ? 'coliseum' : 'ashen');

function dashedRing(pen: Pen, x: number, y: number, r: number, col: RGB, alpha: number, rot: number): void {
  const o = pen.shape(col, alpha, 'decal');
  o.thickness = 1;
  o.additive = true;
  const n = 28;
  for (let s = 0; s < n; s++) {
    const a0 = rot + s * TAU / n, a1 = a0 + TAU / n * 0.5;
    pen.r.line(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, o);
  }
}

function bell(pen: Pen, f: FrameCtx, x: number, y: number, dirge: number, swing: number, skin: Skin, col: RGB): void {
  const metal = skin === 'ossuary' ? BONE : skin === 'coliseum' ? RUST : IRON;
  const wood = pen.shape([0.62, 0.48, 0.33], 0.95, 'decal');
  wood.thickness = 4;
  const top = y - 62;
  pen.r.line(x - 28, y, x - 24, top, wood);
  pen.r.line(x + 28, y, x + 24, top, wood);
  pen.r.line(x - 26, top, x + 26, top, wood);
  pen.r.line(x - 28, y, x + 28, y, wood);
  // The bell hangs from the crossbeam and swings (amplitude grows in the last fifth before a toll).
  const amp = swing > 0.8 ? (swing - 0.8) / 0.2 * 0.55 : 0;
  const ang = amp * Math.sin(f.time * 13);
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (px: number, py: number): [number, number] => [x + px * c - py * s, top + px * s + py * c];
  const body = pen.shape(metal, 1, 'decal');
  body.thickness = 3.5;
  body.emissive = 0.35;
  const pts: [number, number][] = [[-5, 4], [-9, 12], [-13, 26], [-17, 38], [17, 38], [13, 26], [9, 12], [5, 4]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = P(pts[k][0], pts[k][1]), b = P(pts[k + 1][0], pts[k + 1][1]);
    pen.r.line(a[0], a[1], b[0], b[1], body);
  }
  const rim = P(-17, 38), rim2 = P(17, 38);
  pen.r.line(rim[0], rim[1], rim2[0], rim2[1], body);
  const rope = P(0, 0), cap = P(0, 4);
  pen.r.line(rope[0], rope[1], cap[0], cap[1], body);
  const clap = P(0, 41);
  pen.r.circle(clap[0], clap[1], 2.5, body);
  if (skin === 'ashen') pen.light(x, y - 24, 90, EMBER, 0.25 + 0.15 * clamp01(dirge / 5), 0.4);
  const halo = pen.shape(col, 0.12 + 0.14 * clamp01(amp * 2), 'decal');
  halo.additive = true;
  pen.r.circle(x, y - 24, 26, halo);
  // The Dirge: one ring per stack, widening (the world moves faster the louder it gets).
  for (let k = 0; k < dirge; k++) {
    const r = 46 + k * 9 + 2 * Math.sin(f.time * 3 + k);
    const o = pen.shape(col, 0.35 - k * 0.04, 'decal');
    o.thickness = 1;
    o.additive = true;
    pen.r.ring(x, y, r, o);
  }
}

export const bellwatchArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    const skin = skinOf(f.theme);
    const tint: RGB = skin === 'ossuary' ? BONE : skin === 'coliseum' ? RUST : EMBER;
    const b = e.markers.find(m => m.icon === 'bell');
    if (!b) return;
    // The reach of the rings: the inner heart and the outer edge, slowly turning.
    dashedRing(pen, b.x, b.y, BELL_INNER_RADIUS, tint, 0.18, f.time * 0.1);
    dashedRing(pen, b.x, b.y, BELL_OUTER_RADIUS, tint, 0.14, -f.time * 0.07);
    bell(pen, f, b.x, b.y, b.v, (b.w ?? 0) / 100, skin, col);
    pen.r.text('Bell', b.x, b.y + 16, pen.text(tint, 0.8, 1));
    for (const m of e.markers) {
      if (m.icon !== 'cantor') continue;
      const shielded = m.v === 1;
      if (shielded) {
        // The chain of light that keeps it safe: to the bell while an outer cantor lives.
        const link = pen.shape(SHIELD, 0.22 + 0.08 * Math.sin(f.time * 5), 'decal');
        link.thickness = 1;
        link.additive = true;
        pen.r.line(m.x, m.y - 10, b.x, b.y - 24, link);
      }
      const ring = pen.shape(shielded ? SHIELD : col, 0.7, 'fx');
      ring.thickness = 1.5;
      ring.additive = true;
      pen.r.ring(m.x, m.y - 6, 13 + Math.sin(f.time * 4 + m.x) * 1, ring);
      pen.r.text(shielded ? 'Cantor (shielded)' : 'Cantor', m.x, m.y - 70, pen.text(shielded ? SHIELD : tint, 0.9, 1));
    }
  },
  residue(beat: MapEventBeat) {
    return beat === 'complete' ? { r: 34 } : null;
  },
};
