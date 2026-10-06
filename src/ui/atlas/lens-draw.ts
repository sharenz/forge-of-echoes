// Canvas layer of the chart lenses: the brass pin and soft halo of pinned nodes (every lens), the Sources arrows and the Territory
// lens's beacon rings and sigil glyphs.
// Called from ChartRenderer.frame in chart pixels (the zoom transform is already set). Draws no text: shares are DOM
// labels (Atlas.tsx), so they stay on the shared type scale and readable by screen readers.
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_POS, PLATE_R } from '../../art/atlas/geometry';
import type { Surface } from '../../art/atlas/canvas';
import type { BeaconView, SourceEdge } from './lens';
import { findSigil } from '../../data/progression/territory';
import type { SigilKind } from '../../contracts/content';
import type { NodeModel } from './model';

export interface LensInput {
  lens: 'stock' | 'sources' | 'territory';
  /** Sources lens: the slotted map's home (arrow origin) and its arrows. */
  from: AtlasAreaId | null;
  edges: readonly SourceEdge[];
  /** Territory lens: every beacon (ring, slots) and the area being inspected (its ring and covered nodes light up). */
  beacons?: readonly BeaconView[];
  inspected?: AtlasAreaId | null;
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
  if (input?.lens === 'territory' && input.beacons?.length) drawTerritory(ctx, input, input.beacons, t, motion, deps);
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

/** Glyph colour of a sigil kind on the chart (the item icons use the same families of colour). */
const SIGIL_COLOUR: Record<SigilKind, string> = {
  omen: '#c07bff', hoard: '#e0b04a', fortune: '#ffe7a8', ingredient: '#8fd16a', survey: '#9fd8ff', tide: '#5fd1c4',
  ashen: '#ff8a3c', chapel: '#d36a9a', crypt: '#a98bff', ossuary: '#cfe9ff', chainworks: '#c46a3a', coliseum: '#d9c08a',
};

function drawTerritory(ctx: CanvasRenderingContext2D, input: LensInput, beacons: readonly BeaconView[], t: number, motion: boolean, deps: LensDeps): void {
  const focus = beacons.find((b) => b.areaId === input.inspected) ?? null;
  ctx.save();
  // rings: quiet for every beacon, strong for the inspected one; a beacon with a sigil burns brighter than an empty one
  for (const b of beacons) {
    const p = ATLAS_POS[b.areaId];
    const lit = b.slots.some(Boolean);
    const on = focus?.areaId === b.areaId;
    ctx.strokeStyle = lit ? BRASS : BRASS_DARK;
    ctx.globalAlpha = on ? 0.75 : lit ? 0.32 : 0.16;
    ctx.lineWidth = on ? 2 : 1;
    ctx.setLineDash(on ? [] : [4, 4]);
    ctx.lineDashOffset = motion && lit ? -t * 4 : 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, b.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // the inspected beacon lights the areas it covers
  if (focus) {
    ctx.globalCompositeOperation = 'lighter';
    for (const id of focus.coverage) {
      if (id === focus.areaId) continue;
      const q = ATLAS_POS[id];
      ctx.globalAlpha = 0.28 + (motion ? 0.08 * Math.sin(t * 2 + q.x) : 0);
      ctx.drawImage(deps.halo(BRASS) as CanvasImageSource, q.x - 32, q.y - 32);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // sigil glyphs: one 5 x 5 diamond per slot above the plate (hollow = empty slot)
  for (const b of beacons) {
    const p = ATLAS_POS[b.areaId];
    b.slots.forEach((s, i) => {
      const x = Math.round(p.x - (b.slots.length - 1) * 4 + i * 8), y = Math.round(p.y - PLATE_R - 6);
      const kind = s ? findSigil(s.sigilId)?.kind : undefined;
      ctx.globalAlpha = 1;
      ctx.fillStyle = BRASS_DARK;
      diamond(ctx, x, y, 3);
      ctx.fillStyle = kind ? SIGIL_COLOUR[kind] : '#1a1410';
      diamond(ctx, x, y, 2);
    });
  }
  ctx.restore();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}
