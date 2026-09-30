// WAYSIDE ANVIL on the ground. A cold iron anvil that heats with every kill around it; the faint ring shows how far the anvil hears
// a kill (260 u) and fills as it charges; when charged it glows white-hot and three or four boon stones stand round it. Forge
// anvil (ashen: ember glow and sparks), frost-rimed (ossuary: cold rime motes), iron and rust-stained (coliseum). Decal layer and
// thin additive lines only: never over a monster, a drop or a telegraph.
import { ITEM_CLASSES } from '../../contracts/content';
import type { MapEventBeat, MapEventView, MapEventZone } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import { ANVIL_BOONS, ANVIL_BOON_NAMES } from '../../data/progression/events/anvil';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

const IRON: RGB = [0.62, 0.6, 0.58];
const EMBER: RGB = [1, 0.55, 0.2];
const HOT: RGB = [1, 0.85, 0.55];
const RIME: RGB = [0.6, 0.82, 1];
const RUST: RGB = [0.72, 0.38, 0.28];

type Skin = 'ashen' | 'ossuary' | 'coliseum';
const skinOf = (theme: string): Skin => (theme === 'rimedOssuary' || theme === 'choralCrypt' ? 'ossuary' : theme === 'ironColiseum' || theme === 'chainworks' ? 'coliseum' : 'ashen');
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function poly(pen: Pen, pts: readonly (readonly [number, number])[], x: number, y: number, o: ReturnType<Pen['shape']>): void {
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    pen.r.line(x + a[0], y + a[1], x + b[0], y + b[1], o);
  }
}

/** The anvil's silhouette (feet at y, horn to the west). */
const BODY = [[-11, 0], [11, 0], [8, -6], [6, -10], [20, -12], [22, -16], [-16, -16], [-26, -14], [-16, -11], [-6, -10], [-8, -6]] as const;

function anvil(pen: Pen, f: FrameCtx, x: number, y: number, charge: number, ready: boolean, skin: Skin): void {
  const heat = clamp01(charge / 100);
  const base = skin === 'ossuary' ? RIME : skin === 'coliseum' ? RUST : IRON;
  const glow = ready ? HOT : mix(base, skin === 'ossuary' ? RIME : EMBER, heat);
  const pulse = ready ? 0.75 + 0.25 * Math.sin(f.time * 6) : 1;
  const shadow = pen.shape([0, 0, 0], 0.35, 'decal');
  shadow.thickness = 5;
  pen.r.line(x - 14, y + 1, x + 14, y + 1, shadow);
  const body = pen.shape(mix(IRON, glow, 0.35 + 0.65 * heat), 0.95, 'decal');
  body.thickness = 2;
  poly(pen, BODY, x, y, body);
  const top = pen.shape(glow, (0.3 + 0.6 * heat) * pulse, 'decal');
  top.thickness = 2;
  top.additive = true;
  top.emissive = 0.4 + 0.6 * heat;
  pen.r.line(x - 16, y - 16, x + 22, y - 16, top);
  pen.light(x, y - 12, 50 + 70 * heat, glow, (0.15 + 0.65 * heat) * pulse, 0.35);
  if (heat > 0.05 && Math.random() < f.fxDt * (2 + 14 * heat)) {
    const b = pen.burst(x + (Math.random() - 0.5) * 20, y - 16, 1, skin === 'ossuary' ? C_ICE : HOT, glow);
    b.sprite = skin === 'ossuary' ? 'fx/frost' : 'fx/ember';
    pen.speed(10, 40);
    pen.life(0.3, 0.7);
    pen.size(0.4, 0.7);
    b.angle = -Math.PI / 2;
    b.spread = 0.9;
    b.gravity = skin === 'ossuary' ? 20 : -30;
    pen.emit();
  }
}
const C_ICE: RGB = [0.75, 0.9, 1];

function stone(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
  const zn = z.n ?? 0;
  const boon = zn >> 4;
  const chosen = z.v === 255, spent = z.v === 254;
  const alpha = spent ? 0.2 : 1;
  const t = spent ? 0 : chosen ? 1 : clamp01((z.v ?? 0) / 100);
  const ring = pen.shape(col, 0.55 * alpha + 0.25 * Math.sin(f.time * 3 + z.x) * (spent ? 0 : 1), 'decal');
  ring.thickness = 1.5;
  ring.additive = true;
  pen.r.ring(z.x, z.y, z.r, ring);
  const prog = pen.shape(chosen ? HOT : col, 0.95 * alpha, 'decal');
  prog.thickness = 3;
  prog.additive = true;
  prog.emissive = 0.9;
  prog.arc = Math.max(0.001, t);
  if (t > 0) pen.r.ring(z.x, z.y, z.r - 3, prog);
  const g = pen.shape(chosen ? HOT : col, 0.9 * alpha, 'decal');
  g.thickness = 1.5;
  g.additive = true;
  const x = z.x, y = z.y;
  switch (boon) {
    case 0: // Tempered: a diamond with a plus (one more Stability)
      pen.r.line(x, y - 9, x + 7, y, g); pen.r.line(x + 7, y, x, y + 9, g); pen.r.line(x, y + 9, x - 7, y, g); pen.r.line(x - 7, y, x, y - 9, g);
      pen.r.line(x - 3, y, x + 3, y, g); pen.r.line(x, y - 3, x, y + 3, g);
      break;
    case 1: // Keen: a blade
      pen.r.line(x - 8, y + 8, x + 8, y - 8, g); pen.r.line(x + 8, y - 8, x + 4, y - 9, g); pen.r.line(x + 8, y - 8, x + 9, y - 4, g);
      pen.r.line(x - 6, y + 2, x - 2, y + 6, g);
      break;
    case 2: // Attuned: concentric rings
      pen.r.ring(x, y, 4, g); pen.r.ring(x, y, 8, g);
      break;
    default: // Recast: two chasing arcs
      g.arc = 0.4;
      pen.r.ring(x, y, 7, g);
      pen.r.ring(x, y, 4, g);
      break;
  }
  const name = ANVIL_BOONS[boon] ? ANVIL_BOON_NAMES[ANVIL_BOONS[boon]] : '';
  const label = boon === 2 ? `${name}: ${(ITEM_CLASSES[zn & 15] ?? '').replace(/^./, (c) => c.toUpperCase())}` : name;
  pen.r.text(label, x, y + z.r + 12, pen.text(col, 0.9 * alpha, 1));
}

export const anvilArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    const skin = skinOf(f.theme);
    const tint = skin === 'ossuary' ? RIME : skin === 'coliseum' ? RUST : col;
    for (const z of e.zones) {
      if (z.kind === 'altar') {
        const heat = clamp01(z.v / 100);
        const faint = pen.shape(tint, 0.06 + 0.1 * heat, 'decal');
        faint.thickness = 1;
        faint.additive = true;
        pen.r.ring(z.x, z.y, z.r, faint);
        if (z.n) {
          const arc = pen.shape(tint, 0.3 + 0.3 * heat, 'decal');
          arc.thickness = 2;
          arc.additive = true;
          arc.arc = Math.max(0.002, heat);
          pen.r.ring(z.x, z.y, z.r, arc);
        }
        const inner = pen.shape(tint, 0.1 + 0.1 * heat, 'decal');
        inner.thickness = 1;
        pen.r.ring(z.x, z.y, 34, inner);
      } else if (z.kind === 'stone') stone(pen, f, z, tint);
    }
    for (const m of e.markers) {
      if (m.icon !== 'anvil') continue;
      anvil(pen, f, m.x, m.y, m.v, (m.w ?? 0) === 1, skin);
      pen.r.text(m.v >= 100 ? 'Charged' : `Anvil ${m.v}%`, m.x, m.y - 30, pen.text(tint, 0.85, 1));
    }
  },
  residue(beat: MapEventBeat) {
    return beat === 'forge' || beat === 'complete' ? { r: 26 } : null;
  },
};
void TAU;
