// Map events on the ground (Event Director v2): every event has a signature glyph, colour and audio timbre, drawn from the
// view the sim sends (zones = ground decals, markers = small world icons). Everything here sits on the decal layer or as a
// thin additive line: it never covers a monster silhouette, a drop or a telegraph (telegraph rims are on 'fx', above).
//
//   Stalker    amber eye-slit at its spawn point, a claw over the hunter, a dotted leap path while it pounces
//   Echoing    three broken violet rings round the anchor (brighter with Resonance), trails from each echo to it,
//              chain links between Coliseum phantom pairs
//   Fault      blood-red star on the crack; the four wedges numbered I-IV, the next two hot wedges outlined
//   Relay      flame cups on the braziers (dim until lit), a warm pool of light; the floor dims outside them
//   Caravan    gold chevrons streaming along the road, a wagon and lock marks
//   Rival      twin crowns over the two bosses
// Residue: when an event ends, a small dim sigil stays in the ground for the rest of the map.
import { MAP_EVENT_COLORS } from '../data/progression/map-events';
import type { MapEventKind, MapEventView, MapEventZone } from '../contracts/map-events';
import type { RGB } from '../contracts/render';
import type { SimEvent } from '../contracts/sim';
import { C } from './colors';
import type { FrameCtx } from './context';
import { clamp01, TAU } from './math';
import { EVENT_ART } from './event-art';
import type { Pen } from './pen';

const RESIDUE_MAX = 24;
/** Roman numerals of the four Fault wedges. */
const NUMERALS = ['I', 'II', 'III', 'IV'] as const;
const COLD: RGB = [0.55, 0.8, 1];
const IRON: RGB = [0.72, 0.68, 0.62];
const WARM: RGB = [1, 0.86, 0.6];

interface Residue { kind: MapEventKind; x: number; y: number; r: number; grade: number }

/** Colour of an event, tinted by the map's roster for the Fault and the braziers. */
export function eventColor(kind: MapEventKind): RGB {
  return MAP_EVENT_COLORS[kind] as RGB;
}

function skin(theme: string): 'ashen' | 'ossuary' | 'coliseum' {
  return theme === 'rimedOssuary' || theme === 'choralCrypt' ? 'ossuary' : theme === 'ironColiseum' || theme === 'chainworks' ? 'coliseum' : 'ashen';
}

export class MapEventPainter {
  private residue: Residue[] = [];

  reset(): void {
    this.residue.length = 0;
  }

  /** The events that leave a mark on the ground. */
  beat(e: Extract<SimEvent, { t: 'mapEvent' }>): void {
    const art = EVENT_ART[e.kind]?.residue?.(e.beat, e.n);
    if (art) {
      if (this.residue.length >= RESIDUE_MAX) this.residue.shift();
      this.residue.push({ kind: e.kind, x: e.x, y: e.y, r: art.r, grade: e.beat === 'complete' ? e.n : 0 });
      return;
    }
    const mark = e.beat === 'complete' || e.beat === 'failed' || e.beat === 'seal' || e.beat === 'lit' || e.beat === 'whiff' || (e.beat === 'lock' && e.kind === 'vaultbreakers') || (e.beat === 'crack' && e.kind === 'vaultbreakers' && e.n === 0);
    if (!mark) return;
    if (this.residue.length >= RESIDUE_MAX) this.residue.shift();
    const r = e.beat === 'whiff' ? 16 : e.beat === 'lit' ? 22 : e.beat === 'crack' ? 12 : 30;
    this.residue.push({ kind: e.kind, x: e.x, y: e.y, r, grade: e.beat === 'complete' || e.beat === 'seal' ? e.n : 0 });
  }

  draw(pen: Pen, f: FrameCtx): void {
    this.drawResidue(pen, f);
    const events = f.world.run.events;
    for (let k = 0; k < events.length; k++) this.drawEvent(pen, f, events[k]);
  }

  private drawResidue(pen: Pen, f: FrameCtx): void {
    const v = f.view;
    for (const r of this.residue) {
      if (r.x < v.x0 - 60 || r.x > v.x1 + 60 || r.y < v.y0 - 60 || r.y > v.y1 + 60) continue;
      const col = eventColor(r.kind);
      const o = pen.shape(col, 0.16 + 0.03 * r.grade, 'decal');
      o.thickness = 1;
      pen.r.ring(r.x, r.y, r.r, o);
      const inner = pen.shape(col, 0.1, 'decal');
      inner.thickness = 1;
      pen.r.ring(r.x, r.y, r.r * 0.55, inner);
      for (let s = 0; s < 3; s++) {
        const a = s * TAU / 3 + r.x * 0.01;
        const l = pen.shape(col, 0.12, 'decal');
        pen.r.line(r.x + Math.cos(a) * r.r * 0.55, r.y + Math.sin(a) * r.r * 0.55, r.x + Math.cos(a) * r.r * 1.15, r.y + Math.sin(a) * r.r * 1.15, l);
      }
    }
  }

  private drawEvent(pen: Pen, f: FrameCtx, e: MapEventView): void {
    if (e.phase === 'complete' || e.phase === 'failed') return;
    const col = eventColor(e.kind);
    const art = EVENT_ART[e.kind];
    if (art) {
      art.draw(pen, f, e, col);
      return;
    }
    const zones = e.zones;
    for (let k = 0; k < zones.length; k++) {
      const z = zones[k];
      switch (z.kind) {
        case 'eye': this.eye(pen, f, z, col); break;
        case 'anchor': this.anchor(pen, f, z, col); break;
        case 'crack': this.crack(pen, f, z, col); break;
        case 'field': this.field(pen, f, z, col); break;
        case 'wedgePlan': this.wedgePlan(pen, f, z, col); break;
        case 'brazier': this.brazier(pen, f, z); break;
        case 'road': this.road(pen, f, z, zones[k + 1] && zones[k + 1].kind === 'road' ? zones[k + 1] : null, col); break;
        case 'gate': break;
      }
    }
    this.markers(pen, f, e, col);
  }

  // --- glyphs --------------------------------------------------------------------------------------------------

  /** A segmented ring: `segments` arcs covering `fill` of the circle, turning at `turn` radians per second. */
  private brokenRing(pen: Pen, x: number, y: number, r: number, col: RGB, alpha: number, segments: number, fill: number, rot: number, thick = 1): void {
    const o = pen.shape(col, alpha, 'decal');
    o.thickness = thick;
    o.additive = true;
    o.emissive = 0.6;
    const step = TAU / segments, span = step * fill;
    for (let s = 0; s < segments; s++) {
      const a0 = rot + s * step;
      const n = 3;
      for (let q = 0; q < n; q++) {
        const u0 = a0 + span * q / n, u1 = a0 + span * (q + 1) / n;
        pen.r.line(x + Math.cos(u0) * r, y + Math.sin(u0) * r, x + Math.cos(u1) * r, y + Math.sin(u1) * r, o);
      }
    }
  }

  private eye(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
    const blink = 0.55 + 0.45 * Math.sin(f.time * 3);
    const o = pen.shape(col, 0.7 * blink, 'decal');
    o.thickness = 1.5;
    o.additive = true;
    // A lens: two arcs meeting in points, with a slit pupil.
    const w = z.r, h = z.r * 0.42;
    let px = z.x - w, py = z.y;
    for (let s = 1; s <= 12; s++) {
      const u = -1 + s / 6, x = z.x + u * w, up = h * (1 - u * u);
      pen.r.line(px, py, x, z.y - up, o);
      px = x; py = z.y - up;
    }
    px = z.x - w; py = z.y;
    for (let s = 1; s <= 12; s++) {
      const u = -1 + s / 6, x = z.x + u * w, dn = h * (1 - u * u);
      pen.r.line(px, py, x, z.y + dn, o);
      px = x; py = z.y + dn;
    }
    const pupil = pen.shape(col, 0.9 * blink, 'decal');
    pupil.thickness = 2;
    pupil.additive = true;
    pen.r.line(z.x, z.y - h * 0.85, z.x, z.y + h * 0.85, pupil);
    pen.light(z.x, z.y, 70, col, 0.35 * blink, 0.2);
    this.brokenRing(pen, z.x, z.y, z.r + 10, col, 0.4, 5, 0.6, f.time * 0.6);
  }

  private anchor(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
    // Three concentric broken rings; Resonance (v = percent of the rift's tolerance) brightens and speeds them.
    const heat = clamp01(z.v / 100);
    const t = f.time * (0.5 + heat * 1.2);
    const a = 0.55 + 0.35 * heat;
    this.brokenRing(pen, z.x, z.y, z.r, col, a, 4, 0.7, t, 1.5);
    this.brokenRing(pen, z.x, z.y, z.r * 0.72, col, a, 3, 0.6, -t * 1.3, 1.5);
    this.brokenRing(pen, z.x, z.y, z.r * 0.44, C.storm, a, 5, 0.55, t * 1.7, 1);
    const core = pen.shape(col, 0.12 + 0.18 * heat, 'decal');
    core.additive = true;
    core.emissive = 0.8;
    pen.r.circle(z.x, z.y, z.r * 0.3, core);
    pen.light(z.x, z.y, z.r * 2.4, col, 0.35 + 0.35 * heat, 0.15);
  }

  private crack(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
    // A blood-red star of jagged fissures (six arms), pulsing.
    const pulse = 0.6 + 0.4 * Math.sin(f.time * 2.4);
    const o = pen.shape(col, 0.75 * pulse, 'decal');
    o.thickness = 2;
    o.additive = true;
    o.emissive = 1;
    for (let s = 0; s < 6; s++) {
      const a = z.a + s * TAU / 6;
      let px = z.x, py = z.y;
      for (let q = 1; q <= 4; q++) {
        const r = z.r * q / 4, j = ((s * 7 + q * 3) % 5 - 2) * 0.09;
        const x = z.x + Math.cos(a + j) * r, y = z.y + Math.sin(a + j) * r;
        pen.r.line(px, py, x, y, o);
        px = x; py = y;
      }
    }
    pen.light(z.x, z.y, z.r * 2.6, col, 0.5 * pulse, 0.3);
  }

  private wedgeEdges(pen: Pen, cx: number, cy: number, r: number, ang: number, col: RGB, alpha: number, thick: number): void {
    const o = pen.shape(col, alpha, 'decal');
    o.thickness = thick;
    o.additive = true;
    const a0 = ang - Math.PI / 4, a1 = ang + Math.PI / 4;
    pen.r.line(cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, o);
    pen.r.line(cx, cy, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, o);
    let px = cx + Math.cos(a0) * r, py = cy + Math.sin(a0) * r;
    for (let s = 1; s <= 10; s++) {
      const a = a0 + (a1 - a0) * s / 10;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      pen.r.line(px, py, x, y, o);
      px = x; py = y;
    }
  }

  private field(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
    const sk = skin(f.theme);
    const tone: RGB = sk === 'ossuary' ? COLD : sk === 'coliseum' ? IRON : col;
    const o = pen.shape(tone, 0.35, 'decal');
    o.thickness = 1.5;
    o.additive = true;
    pen.r.ring(z.x, z.y, z.r, o);
    // The four cracks between the wedges, and the numerals I-IV on the wedges.
    for (let k = 0; k < 4; k++) {
      const a = z.a + k * Math.PI / 2;
      const l = pen.shape(tone, 0.4, 'decal');
      l.thickness = 1.5;
      l.additive = true;
      pen.r.line(z.x + Math.cos(a) * 20, z.y + Math.sin(a) * 20, z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r, l);
      const ca = a + Math.PI / 4;
      pen.r.text(NUMERALS[k], z.x + Math.cos(ca) * z.r * 0.55, z.y + Math.sin(ca) * z.r * 0.55, pen.text(tone, 0.62, 1.7));
    }
    pen.light(z.x, z.y, z.r * 1.3, tone, 0.18, 0.2);
  }

  private wedgePlan(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
    // The next two hot wedges are always shown: the first bright, the second dim (planning is part of the play).
    const next = z.v <= 1;
    const pulse = next ? 0.7 + 0.3 * Math.sin(f.time * 6) : 0.5;
    this.wedgeEdges(pen, z.x, z.y, z.r, z.a, col, (next ? 0.75 : 0.35) * pulse, next ? 2.5 : 1.5);
    const label = pen.text(col, next ? 0.95 : 0.55, next ? 1.8 : 1.3);
    pen.r.text(next ? 'NEXT' : 'THEN', z.x + Math.cos(z.a) * z.r * 0.72, z.y + Math.sin(z.a) * z.r * 0.72, label);
  }

  private brazier(pen: Pen, f: FrameCtx, z: MapEventZone): void {
    const lit = z.v === 255;
    const sk = skin(f.theme);
    // A thin beacon of light above the cup: an event brazier never blends into the hall's own braziers and stays findable across the dark.
    const beam = pen.shape(lit ? [1, 0.75, 0.4] : WARM, lit ? 0.3 : 0.4 + 0.1 * Math.sin(f.time * 2.2 + z.x), 'decal');
    beam.thickness = 2;
    beam.additive = true;
    beam.emissive = 0.7;
    pen.r.line(z.x, z.y - 12, z.x, z.y - 86, beam);
    const halo = pen.shape(WARM, lit ? 0.18 : 0.3, 'decal');
    halo.thickness = 1;
    halo.additive = true;
    pen.r.ring(z.x, z.y, 28, halo);
    const flame: RGB = sk === 'ossuary' ? COLD : lit ? [1, 0.7, 0.3] : WARM;
    const cup = pen.shape(lit ? flame : WARM, lit ? 0.85 : 0.8, 'decal');
    cup.thickness = 2;
    pen.r.ring(z.x, z.y, 9, cup);
    if (!lit) {
      // A cold brazier still breathes a faint ember so it reads as a goal from across the dark.
      pen.light(z.x, z.y - 4, 60, WARM, 0.22 + 0.06 * Math.sin(f.time * 2 + z.x), 0.2);
    }
    const base = pen.shape(IRON, 0.7, 'decal');
    base.thickness = 3;
    pen.r.line(z.x - 6, z.y + 9, z.x + 6, z.y + 9, base);
    if (lit) {
      const flick = 0.8 + 0.2 * Math.sin(f.time * 11 + z.x);
      const fl = pen.shape(flame, 0.9 * flick, 'decal');
      fl.additive = true;
      fl.emissive = 1;
      pen.r.circle(z.x, z.y - 3, 6 * flick, fl);
      pen.r.circle(z.x, z.y - 8, 3.5 * flick, fl);
      pen.light(z.x, z.y - 4, z.r, flame, 0.75 * flick, 0.5);
      const pool = pen.shape(flame, 0.1, 'decal');
      pool.additive = true;
      pen.r.ring(z.x, z.y, z.r * 0.94, pool);
    } else {
      // Dwell progress: an arc closing round the cup (v = 0..100).
      const prog = pen.shape(WARM, 0.85, 'decal');
      prog.thickness = 2;
      prog.additive = true;
      prog.arc = clamp01(z.v / 100);
      pen.r.ring(z.x, z.y, 18, prog);
      const ring = pen.shape(WARM, 0.25, 'decal');
      ring.thickness = 1;
      pen.r.ring(z.x, z.y, 18, ring);
    }
  }

  private road(pen: Pen, f: FrameCtx, z: MapEventZone, next: MapEventZone | null, col: RGB): void {
    if (!next) return;
    const dx = next.x - z.x, dy = next.y - z.y, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    const step = 46, phase = (f.time * 30) % step;
    const o = pen.shape(col, 0.4, 'decal');
    o.thickness = 1.5;
    o.additive = true;
    const edge = pen.shape(col, 0.12, 'decal');
    edge.thickness = 1;
    pen.r.line(z.x - uy * 20, z.y + ux * 20, next.x - uy * 20, next.y + ux * 20, edge);
    pen.r.line(z.x + uy * 20, z.y - ux * 20, next.x + uy * 20, next.y - ux * 20, edge);
    for (let d = phase; d < len; d += step) {
      const x = z.x + ux * d, y = z.y + uy * d;
      // A chevron pointing down the road.
      pen.r.line(x - ux * 7 - uy * 11, y - uy * 7 + ux * 11, x, y, o);
      pen.r.line(x - ux * 7 + uy * 11, y - uy * 7 - ux * 11, x, y, o);
    }
  }

  // --- markers -------------------------------------------------------------------------------------------------

  private markers(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    const ms = e.markers;
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k];
      switch (m.icon) {
        case 'claw': {
          // Three claw strokes over the hunter, brighter with every Hunt stack.
          const o = pen.shape(col, 0.7 + 0.1 * m.v, 'fx');
          o.thickness = 1.5;
          o.additive = true;
          for (let s = -1; s <= 1; s++) pen.r.line(m.x + s * 5 - 3, m.y - 40, m.x + s * 5 + 3, m.y - 26, o);
          pen.r.text(`Hunt ${m.v}`, m.x, m.y + 16, pen.text(col, 0.85, 1));
          break;
        }
        case 'pounce': {
          // The leap path from the claw to the landing spot: dotted, and solid once the disc has locked.
          const claw = ms.find(q => q.icon === 'claw');
          if (!claw) break;
          const dx = m.x - claw.x, dy = m.y - claw.y, len = Math.hypot(dx, dy);
          const o = pen.shape(col, m.v ? 0.6 : 0.3, 'decal');
          o.thickness = 1;
          o.additive = true;
          const dash = m.v ? len : 8;
          for (let d = 0; d < len; d += m.v ? len : 16) {
            const u0 = d / len, u1 = Math.min(1, (d + dash) / len);
            pen.r.line(claw.x + dx * u0, claw.y + dy * u0, claw.x + dx * u1, claw.y + dy * u1, o);
          }
          break;
        }
        case 'echo':
        case 'echoRare': {
          // A trail home to the anchor; rares carry a gold fringe.
          const anchor = e.zones.find(z => z.kind === 'anchor');
          const rare = m.icon === 'echoRare';
          if (anchor) {
            const t = pen.shape(rare ? C.gold : col, rare ? 0.22 : 0.14, 'decal');
            t.thickness = 1;
            t.additive = true;
            pen.r.line(m.x, m.y, anchor.x, anchor.y, t);
          }
          if (rare) {
            const fr = pen.shape(C.gold, 0.6, 'decal');
            fr.thickness = 1;
            fr.additive = true;
            pen.r.ring(m.x, m.y, 15 + Math.sin(f.time * 6) * 1.5, fr);
          }
          // Chained pair (Coliseum): a link between the two phantoms.
          if (m.v > 0) {
            const mate = ms.find((q, i) => i > k && q.v === m.v && (q.icon === 'echo' || q.icon === 'echoRare'));
            if (mate) {
              const c = pen.shape(IRON, 0.7, 'decal');
              c.thickness = 1.5;
              const n = 7;
              for (let s = 0; s < n; s++) {
                const u = (s + 0.5) / n;
                const x = m.x + (mate.x - m.x) * u, y = m.y + (mate.y - m.y) * u;
                pen.r.ring(x, y, s % 2 === 0 ? 2.2 : 1.4, c);
              }
            }
          }
          break;
        }
        case 'wagon':
          pen.r.text('Wagon', m.x, m.y - 44, pen.text(col, 0.85, 1));
          break;
        case 'lock': {
          // Open locks pulse bright; a shielded one (w = 1) is dim and covered by its shield arc.
          const open = !m.w;
          const o = pen.shape(col, open ? 0.95 : 0.45, 'fx');
          o.thickness = 1.5;
          o.additive = true;
          pen.r.ring(m.x, m.y - 6, 9 + (open ? Math.sin(f.time * 5 + m.v) * 1.5 : 0), o);
          const names = skin(f.theme) === 'ashen' ? ['Crucible', 'Reliquary', 'Tube'] : ['Coffer', 'Reliquary', 'Tube'];
          // Staggered so the three labels never sit on top of each other.
          pen.r.text(names[m.v] ?? 'Lock', m.x + (m.v - 1) * 26, m.y - 24 - (m.v === 1 ? 11 : 0), pen.text(col, open ? 0.9 : 0.55, 1));
          break;
        }
        case 'shield': {
          // The shield line: a shimmering arc round the lock and a pip per guard still standing.
          const a0 = f.time * 0.8 + m.v * 2;
          const o = pen.shape(C.ice, 0.6 + 0.15 * Math.sin(f.time * 4 + m.v), 'fx');
          o.thickness = 2;
          o.additive = true;
          o.emissive = 0.6;
          for (let q = 0; q < 6; q++) {
            const u0 = a0 + q * TAU / 6, u1 = u0 + TAU / 9;
            pen.r.line(m.x + Math.cos(u0) * 17, m.y - 6 + Math.sin(u0) * 17, m.x + Math.cos(u1) * 17, m.y - 6 + Math.sin(u1) * 17, o);
          }
          for (let q = 0; q < Math.min(6, m.w ?? 0); q++) pen.r.circle(m.x - 6 + q * 4.5, m.y + 10, 1.4, o);
          break;
        }
        case 'wheel': {
          // A spoked wheel with a thin life arc; splinters stay behind as residue.
          const o = pen.shape(IRON, 0.85, 'fx');
          o.thickness = 1.5;
          pen.r.ring(m.x, m.y - 4, 8, o);
          for (let q = 0; q < 4; q++) {
            const u = q * Math.PI / 2 + f.time * 0.5;
            pen.r.line(m.x, m.y - 4, m.x + Math.cos(u) * 8, m.y - 4 + Math.sin(u) * 8, o);
          }
          const life = pen.shape(col, 0.9, 'fx');
          life.thickness = 1.5;
          life.additive = true;
          life.arc = clamp01((m.w ?? 0) / 100);
          pen.r.ring(m.x, m.y - 4, 12, life);
          break;
        }
        case 'ember': {
          const flick = 0.8 + 0.2 * Math.sin(f.time * 12);
          const fl = pen.shape(WARM, 0.9 * flick, 'fx');
          fl.additive = true;
          fl.emissive = 1;
          pen.r.circle(m.x, m.y - 12, 3.5 * flick, fl);
          pen.light(m.x, m.y - 10, m.v ? 130 : 90, WARM, 0.7 * flick, 0.5);
          if (!m.v) pen.r.text('Ember', m.x, m.y - 26, pen.text(WARM, 0.85, 1));
          break;
        }
        case 'crown': {
          // v: 0 first boss, 1 rival, +2 when empowered by the spoils (the crown flares: brighter, pulsing, with a halo).
          const flare = m.v >= 2;
          const o = pen.shape((m.v & 1) ? C.storm : col, flare ? 1 : 0.9, 'fx');
          o.thickness = flare ? 2.5 : 1.5;
          o.additive = true;
          if (flare) {
            o.emissive = 1;
            const halo = pen.shape(C.gold, 0.35 + 0.25 * Math.sin(f.time * 6), 'fx');
            halo.additive = true;
            pen.r.ring(m.x, m.y - 57, 13 + Math.sin(f.time * 6) * 2, halo);
            pen.light(m.x, m.y - 57, 70, C.gold, 0.45, 0.3);
          }
          const x = m.x, y = m.y - 60;
          pen.r.line(x - 8, y + 5, x - 8, y - 2, o);
          pen.r.line(x - 8, y - 2, x - 4, y + 2, o);
          pen.r.line(x - 4, y + 2, x, y - 5, o);
          pen.r.line(x, y - 5, x + 4, y + 2, o);
          pen.r.line(x + 4, y + 2, x + 8, y - 2, o);
          pen.r.line(x + 8, y - 2, x + 8, y + 5, o);
          pen.r.line(x - 8, y + 5, x + 8, y + 5, o);
          break;
        }
        case 'warden':
        case 'guardian':
          pen.r.text(m.icon === 'warden' ? 'Rift Warden' : m.v ? 'Fault-born' : 'Wickbearer', m.x, m.y - 44, pen.text(col, 0.85, 1));
          break;
      }
    }
  }
}
