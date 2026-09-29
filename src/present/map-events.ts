import { MAP_EVENT_COLORS, MAP_EVENT_NAMES } from '../data/progression/map-events';
import type { FrameCtx } from './context';
import type { Pen } from './pen';


/** Small ground sigils distinguish the optional rift and the approaching hunter from attack telegraphs. */
export function drawMapEvent(pen: Pen, f: FrameCtx): void {
  const e = f.world.run.event;
  if (!e || e.phase === 'complete' || e.phase === 'failed') return;
  const hunted = e.kind === 'hunted';
  const color = MAP_EVENT_COLORS[e.kind];
  const radius = hunted ? (e.phase === 'warning' ? 25 : 16) : 35;
  const rim = pen.shape(color, 0.6, 'decal');
  rim.thickness = 1.5;
  pen.r.ring(e.x, e.y, radius, rim);
  const arc = pen.shape(color, 0.5 + Math.sin(f.time * 3) * 0.15, 'decal');
  arc.thickness = 2;
  arc.arc = 0.55 + 0.1 * Math.sin(f.time);
  pen.r.ring(e.x, e.y, radius - 7, arc);
  pen.light(e.x, e.y, e.kind === 'blackout' ? 150 : 65, color, e.kind === 'blackout' ? 0.65 : 0.3);
  if (e.kind === 'blackout') for (const p of f.world.players) if (!p.dead) pen.light(p.x, p.y, 130, color, 0.3);
  if (!hunted || e.phase === 'warning') {
    pen.r.text(e.kind === 'blackout' ? 'Restore this beacon' : MAP_EVENT_NAMES[e.kind], e.x, e.y - radius - 10, pen.text(color));
  }
}
