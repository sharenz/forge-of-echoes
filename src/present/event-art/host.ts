// STASIS HOST on the ground: a ring of rime runes round the Time Prism that fills as the host thaws, and the prism itself (a
// turning cyan crystal with a life bar; its body is a hidden fixture monster). Ashen maps warm the ice with embers, Coliseum maps
// grey it to marble. Decal layer or thin additive lines only: the statues are monsters and stay on top.
import type { MapEventView, MapEventZone } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import { C } from '../colors';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

const COLD: RGB = [0.5, 0.85, 0.95];
const WARM: RGB = [1, 0.62, 0.35];
const MARBLE: RGB = [0.82, 0.8, 0.76];

const tone = (theme: string): RGB => theme === 'rimedOssuary' || theme === 'choralCrypt' ? COLD : theme === 'ironColiseum' || theme === 'chainworks' ? MARBLE : WARM;

function field(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
  const bar = clamp01(z.v / 100);
  const o = pen.shape(col, 0.3, 'decal');
  o.thickness = 1.5;
  o.additive = true;
  pen.r.ring(z.x, z.y, z.r, o);
  pen.r.ring(z.x, z.y, z.r * 0.62, o);
  // The thaw bar: an arc closing round the field.
  const prog = pen.shape(col, 0.85, 'decal');
  prog.thickness = 3;
  prog.additive = true;
  prog.arc = bar;
  prog.emissive = 0.7;
  pen.r.ring(z.x, z.y, z.r + 5, prog);
  // Rime runes: short ticks on the inner ring, lit as the bar passes them.
  const n = 24;
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU - Math.PI / 2;
    const lit = k / n <= bar;
    const t = pen.shape(lit ? WARM : col, lit ? 0.5 : 0.22, 'decal');
    t.thickness = 1;
    t.additive = true;
    const r0 = z.r * 0.62, r1 = r0 + (k % 2 ? 6 : 10);
    pen.r.line(z.x + Math.cos(a) * r0, z.y + Math.sin(a) * r0, z.x + Math.cos(a) * r1, z.y + Math.sin(a) * r1, t);
  }
  if ((z.n ?? 0) === 1) {
    // The prism is gone: the shockwave has passed, cracks in the floor.
    for (let k = 0; k < 6; k++) {
      const a = k * TAU / 6 + 0.3;
      const c = pen.shape(col, 0.4, 'decal');
      c.thickness = 1.5;
      pen.r.line(z.x + Math.cos(a) * 12, z.y + Math.sin(a) * 12, z.x + Math.cos(a + 0.08) * z.r * 0.55, z.y + Math.sin(a + 0.08) * z.r * 0.55, c);
    }
  }
  pen.light(z.x, z.y, z.r * 1.2, col, 0.14 + 0.1 * bar, 0.15);
}

function prism(pen: Pen, f: FrameCtx, x: number, y: number, bar: number, life: number, col: RGB): void {
  const t = f.time;
  const hover = Math.sin(t * 1.6) * 2;
  const cy = y - 20 + hover;
  // A turning octahedron: the width of its waist breathes with the turn.
  const w = 15 * (0.45 + 0.55 * Math.abs(Math.cos(t * 0.9)));
  const top = cy - 26, bot = cy + 26;
  const edge = pen.shape(col, 0.95, 'fx');
  edge.thickness = 2;
  edge.additive = true;
  edge.emissive = 1;
  const pts: [number, number][] = [[x - w, cy], [x, cy - 4], [x + w, cy], [x, cy + 4]];
  for (let k = 0; k < 4; k++) {
    const a = pts[k], b = pts[(k + 1) % 4];
    pen.r.line(a[0], a[1], b[0], b[1], edge);
    pen.r.line(a[0], a[1], x, top, edge);
    pen.r.line(a[0], a[1], x, bot, edge);
  }
  const core = pen.shape(col, 0.25 + 0.25 * bar, 'decal');
  core.additive = true;
  core.emissive = 0.8;
  pen.r.circle(x, cy, 7, core);
  const base = pen.shape(C.stoneLight, 0.8, 'decal');
  base.thickness = 3;
  pen.r.ring(x, y + 2, 13, base);
  pen.light(x, cy, 110, col, 0.32, 0.25);
  // Life bar under the prism.
  const bg = pen.shape(C.ink, 0.7, 'fx');
  bg.thickness = 4;
  pen.r.line(x - 18, y + 14, x + 18, y + 14, bg);
  const fg = pen.shape(col, 0.95, 'fx');
  fg.thickness = 2;
  fg.additive = true;
  pen.r.line(x - 17, y + 14, x - 17 + 34 * clamp01(life / 100), y + 14, fg);
  pen.r.text('Time Prism', x, y + 28, pen.text(col, 0.85, 1));
}

export const hostArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    const c = tone(f.theme);
    for (const z of e.zones) if (z.kind === 'altar') field(pen, f, z, c);
    for (const m of e.markers) if (m.icon === 'prism') prism(pen, f, m.x, m.y, clamp01(m.v / 100), m.w ?? 100, c);
    void col;
  },
  residue(beat, n) {
    return beat === 'crack' && n === 1 ? { r: 46 } : beat === 'shatter' ? { r: 30 } : beat === 'complete' ? { r: 34 } : null;
  },
};
