// Canvas layer of the chart lenses: the brass pin and soft halo of pinned nodes (every lens) and the Sources arrows.
// Called from ChartRenderer.frame in chart pixels (the zoom transform is already set). Draws no text: shares are DOM
// labels (Atlas.tsx), so they stay on the shared type scale and readable by screen readers.
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_POS, PLATE_R } from '../../art/atlas/geometry';
import type { Surface } from '../../art/atlas/canvas';
import type { SourceEdge } from './lens';
import type { NodeModel } from './model';

export interface LensInput {
  lens: 'stock' | 'sources' | 'territory';
  /** Sources lens: the slotted map's home (arrow origin) and its arrows. */
  from: AtlasAreaId | null;
  edges: readonly SourceEdge[];
}

export interface LensDeps { halo(hex: string): Surface }

const BRASS = '#e0b04a';
const BRASS_HI = '#ffe7a8';
const BRASS_DARK = '#7a5a22';
const VIOLET = '#c07bff';

/** A brass map pin, 7 x 11 pixels, its needle tip at (0, 0): the head sits above it. */
const PIN: readonly string[] = [
  '..###..',
  '.#@@@#.',
  '#@@+@@#',
  '#@+++@#',
  '#@@+@@#',
  '.#@@@#.',
  '..#@#..',
  '...#...',
];

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, bob: number): void {
  const colour: Record<string, string> = { '#': BRASS_DARK, '@': BRASS, '+': BRASS_HI };
  const top = y - PIN.length + bob;
  PIN.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const c = colour[row[rx]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x - 3 + rx, top + ry, 1, 1);
    }
  });
}

export function drawLensLayer(ctx: CanvasRenderingContext2D, input: LensInput | undefined, models: readonly NodeModel[], t: number, motion: boolean, deps: LensDeps): void {
  // Sources arrows run under the pins so a pin on the target stays readable.
  if (input?.lens === 'sources' && input.from && input.edges.length) drawSources(ctx, input, t, motion);
  for (const m of models) {
    if (!m.pinned) continue;
    const cx = Math.round(m.x), cy = Math.round(m.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34 + (motion ? 0.1 * Math.sin(t * 2 + cx) : 0);
    ctx.drawImage(deps.halo(BRASS) as CanvasImageSource, cx - 32, cy - 32);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawPin(ctx, cx + 20, cy - 8, 0);
  }
}

function drawSources(ctx: CanvasRenderingContext2D, input: LensInput, t: number, motion: boolean): void {
  const from = ATLAS_POS[input.from!];
  ctx.save();
  ctx.lineCap = 'butt';
  for (const e of input.edges) {
    const to = ATLAS_POS[e.to];
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const x0 = from.x + ux * (PLATE_R + 3), y0 = from.y + uy * (PLATE_R + 3);
    const x1 = to.x - ux * (PLATE_R + 5), y1 = to.y - uy * (PLATE_R + 5);
    const colour = e.pending ? VIOLET : e.pinned ? BRASS_HI : BRASS;
    ctx.strokeStyle = colour;
    ctx.globalAlpha = e.pending ? 0.6 : 0.45 + Math.min(0.45, e.share * 1.6);
    ctx.lineWidth = e.pending ? 1 : 1 + Math.min(3, Math.round(e.share * 8));
    ctx.setLineDash(e.pending ? [2, 3] : [5, 3]);
    ctx.lineDashOffset = motion ? -t * 10 : 0;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // arrow head
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(x1 + ux * 2, y1 + uy * 2);
    ctx.lineTo(x1 - ux * 6 - uy * 4, y1 - uy * 6 + ux * 4);
    ctx.lineTo(x1 - ux * 6 + uy * 4, y1 - uy * 6 - ux * 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
