// Off-screen indicators: a pulsing chevron at the screen edge pointing at things worth walking to — rare packs,
// the lieutenant, the boss, the reward chest, the return portal and allies — with a short plate for the
// important ones. Drawn on 'top' (unlit, crisp). A target counts as visible (no marker) while any of its body or
// its name plate is on screen, so a marker never sits on top of the thing it points at.
//
// Online note: the presenter only knows what the WorldView holds. The snapshot encoder must keep sending rare,
// lieutenant and boss monsters outside the area of interest for their markers to work at range.
import type { RGB } from '../contracts/render';
import { RARITY_CODE } from '../contracts/sim';
import { C } from './colors';
import type { FrameCtx } from './context';
import type { Pen } from './pen';
import { NOTABLE_STRIDE } from './monsters';
import type { PlayerPainter } from './players';

const INSET = 12;
const RARE: RGB = [0.98, 0.82, 0.32];
const LT: RGB = [1, 0.55, 0.2];
const BOSS: RGB = [1, 0.25, 0.16];
const CHEST: RGB = [1, 0.84, 0.45];
const RETURN: RGB = [0.5, 0.8, 1];
const PORTAL: RGB = [1, 0.6, 0.25];
/** Rare leaders further than this from the camera get no marker (they are for the hunt, not a radar). */
const RARE_RANGE = 1100;

export class Indicators {
  private readonly edge: [number, number, number] = [1, 1, 1];
  private readonly near = new Int32Array(3);
  /** Label plates placed this frame (x, y, width) for overlap avoidance. */
  private readonly placed = new Float32Array(16 * 3);
  private placedCount = 0;
  private readonly nearD = new Float64Array(3);

  /**
   * Draw a marker for the world point (tx, ty) — a target standing there whose body and plates reach `height`
   * units above it — unless some of it is on screen.
   */
  mark(pen: Pen, f: FrameCtx, tx: number, ty: number, col: RGB, label: string | null, size: number, height = 14): void {
    const v = f.view;
    const dx = tx - v.cx;
    if (Math.abs(dx) <= v.halfW + 6 && ty + 4 >= v.cy - v.halfH && ty - height - 4 <= v.cy + v.halfH) return;
    // Point at the middle of the body rather than the feet.
    const dy = ty - height * 0.4 - v.cy;
    const hw = v.halfW - INSET;
    const hh = v.halfH - INSET;
    // Clamp the direction onto the inset view rectangle.
    const sx = Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity;
    const sy = Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    const ex = v.cx + dx * s;
    const ey = v.cy + dy * s;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const pulse = 0.72 + 0.28 * Math.sin(f.time * 5 + tx * 0.01);
    this.arrow(pen, ex + ux * 3, ey + uy * 3, ux, uy, size + 1, C.plate, 0.85);
    this.arrow(pen, ex + ux * 2, ey + uy * 2, ux, uy, size, col, pulse);
    if (label) {
      let lx = ex - ux * (size + 16);
      let ly = ey - uy * (size + 10);
      const w = pen.r.measureText(label, 1) + 4;
      // Keep plates of markers that share an edge from overlapping: slide along the edge.
      for (let guard = 0; guard < 8 && this.overlaps(lx, ly, w); guard++) {
        if (Math.abs(ux) > Math.abs(uy)) ly += 14;
        else lx += w + 4;
      }
      this.place(lx, ly, w);
      const e = this.edge;
      e[0] = col[0] * 0.45;
      e[1] = col[1] * 0.45;
      e[2] = col[2] * 0.45;
      const to = pen.text(col, 0.92, 1);
      pen.plate(to, C.plate, 0.8, e, 2);
      pen.r.text(label, lx, ly, to);
    }
  }

  /** Filled arrowhead pointing along (ux, uy) with its tip at (x, y), drawn as stacked 1 px scanlines. */
  private arrow(pen: Pen, x: number, y: number, ux: number, uy: number, size: number, col: RGB, alpha: number): void {
    const r = pen.r;
    const px = -uy;
    const py = ux;
    const o = pen.shape(col, alpha, 'top');
    o.thickness = 1;
    for (let k = 0; k <= size; k++) {
      const cx = x - ux * k;
      const cy = y - uy * k;
      const half = k * 0.75;
      r.line(cx - px * half, cy - py * half, cx + px * half, cy + py * half, o);
    }
  }

  private overlaps(x: number, y: number, w: number): boolean {
    const p = this.placed;
    for (let i = 0; i < this.placedCount; i++) {
      if (Math.abs(p[i * 3] - x) < (p[i * 3 + 2] + w) / 2 + 2 && Math.abs(p[i * 3 + 1] - y) < 13) return true;
    }
    return false;
  }

  private place(x: number, y: number, w: number): void {
    if (this.placedCount >= 16) return;
    const o = this.placedCount++ * 3;
    this.placed[o] = x;
    this.placed[o + 1] = y;
    this.placed[o + 2] = w;
  }

  draw(pen: Pen, f: FrameCtx, monsters: { readonly notable: Float32Array; readonly notableCount: number }, players: PlayerPainter): void {
    // Notable monsters (the painter collected their rendered positions): every boss/lieutenant, and the three
    // nearest rare leaders within hunting range.
    const v = f.view;
    this.placedCount = 0;
    const near = this.near;
    near[0] = near[1] = near[2] = -1;
    const nd = this.nearD;
    nd[0] = nd[1] = nd[2] = Infinity;
    const nb = monsters.notable;
    for (let k = 0; k < monsters.notableCount; k++) {
      const o = k * NOTABLE_STRIDE;
      const x = nb[o];
      const y = nb[o + 1];
      const rarity = nb[o + 2];
      if (rarity === RARITY_CODE.boss) this.mark(pen, f, x, y, BOSS, 'Matriarch', 7, nb[o + 3]);
      else if (rarity === RARITY_CODE.lieutenant) this.mark(pen, f, x, y, LT, 'Herald', 6, nb[o + 3]);
      else {
        const d = Math.hypot(x - v.cx, y - v.cy);
        if (d > RARE_RANGE) continue;
        for (let s = 0; s < 3; s++) {
          if (d >= nd[s]) continue;
          for (let q = 2; q > s; q--) {
            nd[q] = nd[q - 1];
            near[q] = near[q - 1];
          }
          nd[s] = d;
          near[s] = k;
          break;
        }
      }
    }
    for (let s = 0; s < 3; s++) {
      const k = near[s];
      if (k < 0) continue;
      const o = k * NOTABLE_STRIDE;
      this.mark(pen, f, nb[o], nb[o + 1], RARE, null, 5, nb[o + 3]);
    }
    const props = f.world.props;
    for (let k = 0; k < props.length; k++) {
      const p = props[k];
      if (p.kind === 'chest' && p.state === 0) this.mark(pen, f, p.x, p.y, CHEST, 'Chest', 6, 24);
      else if (p.kind === 'returnPortal' && p.state > 0) this.mark(pen, f, p.x, p.y, RETURN, 'Return', 6, 50);
      else if (p.kind === 'portal' && p.state > 0 && f.world.run.phase === 'hideout') this.mark(pen, f, p.x, p.y, PORTAL, 'Portal', 5, 50);
    }
    const ps = f.world.players;
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      if (p.id === f.localId) continue;
      const pos = players.pos.get(p.id);
      // Her body and name plate reach ~40 units above her feet.
      if (pos) this.mark(pen, f, pos.x, pos.y, players.partyColor(p.id), p.name, 5, 40);
    }
  }
}
