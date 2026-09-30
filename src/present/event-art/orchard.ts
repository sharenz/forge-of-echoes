// ASHSEED ORCHARD on the ground: a bloom per marker (v = stage 0..3 + 4 * kind, 255 withered; w = life percent). Stage 0 a seed
// mound, 1 a sprout, 2 a bud, 3 a bloom in full glow. Cinder-blooms (Ashen), bone-lilies (Ossuary), tar-sprouts (Coliseum). A life
// bar sits under a bloom that has been bitten, and the harvest dwell closes as an arc round it (a 'stone' zone).
import type { MapEventView, MapEventMarker, MapEventZone } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import { BLOOM_KIND_NAMES } from '../../data/progression/events/orchard';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

const STEM: RGB = [0.45, 0.6, 0.3];
const SOIL: RGB = [0.42, 0.32, 0.24];
const SKINS = {
  ashen: { leaf: [0.5, 0.62, 0.3], petal: [1, 0.55, 0.2], core: [1, 0.85, 0.45] },
  ossuary: { leaf: [0.6, 0.78, 0.8], petal: [0.8, 0.92, 1], core: [1, 1, 1] },
  coliseum: { leaf: [0.35, 0.3, 0.25], petal: [0.9, 0.42, 0.18], core: [1, 0.7, 0.3] },
} as const;

function skinOf(theme: string): keyof typeof SKINS {
  return theme === 'rimedOssuary' || theme === 'choralCrypt' ? 'ossuary' : theme === 'ironColiseum' || theme === 'chainworks' ? 'coliseum' : 'ashen';
}

function bloom(pen: Pen, f: FrameCtx, m: MapEventMarker): void {
  const sk = SKINS[skinOf(f.theme)];
  const wither = m.v === 255;
  const stage = wither ? 0 : m.v & 3;
  const kind = wither ? 0 : m.v >> 2;
  const x = m.x, y = m.y, r = pen.r;
  const sway = Math.sin(f.time * 1.6 + x * 0.05) * (stage >= 2 ? 1.5 : 0.6);
  // The mound under every stage.
  const soil = pen.shape(wither ? [0.3, 0.26, 0.24] : SOIL, 0.8, 'decal');
  soil.thickness = 2;
  r.ring(x, y + 2, 9, soil);
  const inner = pen.shape(wither ? [0.3, 0.26, 0.24] : SOIL, 0.5, 'decal');
  r.ring(x, y + 2, 5, inner);
  if (wither) {
    const w = pen.shape([0.5, 0.42, 0.3], 0.6, 'fx');
    w.thickness = 1.5;
    r.line(x, y, x + 4, y - 7, w); r.line(x + 4, y - 7, x + 9, y - 6, w);
    return;
  }
  const leaf = pen.shape(sk.leaf, 0.95, 'fx');
  leaf.thickness = 1.6;
  if (stage >= 1) {
    const h = stage === 1 ? 9 : stage === 2 ? 14 : 17;
    const stem = pen.shape(STEM, 0.95, 'fx');
    stem.thickness = 1.4;
    r.line(x, y, x + sway, y - h, stem);
    const lf = pen.shape(sk.leaf, 0.95, 'fx');
    lf.thickness = 1.6;
    r.line(x + sway * 0.4, y - h * 0.4, x - 7, y - h * 0.4 - 5, lf);
    r.line(x + sway * 0.4, y - h * 0.55, x + 7, y - h * 0.55 - 5, lf);
    if (stage >= 2) {
      const petal = pen.shape(sk.petal, stage === 3 ? 1 : 0.9, 'fx');
      petal.thickness = 1.8;
      petal.additive = stage === 3;
      petal.emissive = stage === 3 ? 0.9 : 0.3;
      const cx = x + sway, cy = y - h;
      const open = stage === 3 ? 7 : 3.5;
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.5;
        r.line(cx, cy, cx + Math.cos(a) * open * (k % 2 ? 1.3 : 1), cy + Math.sin(a) * open * (k % 2 ? 1.3 : 1) - (stage === 3 ? 1 : 0), petal);
      }
      if (stage === 3) {
        const core = pen.shape(sk.core, 0.95, 'fx');
        core.additive = true;
        core.emissive = 1;
        r.circle(cx, cy - 1, 2.6, core);
        const pulse = 0.8 + 0.2 * Math.sin(f.time * 3 + x);
        pen.light(cx, cy, 70, sk.petal, 0.55 * pulse, 0.3);
        r.text(BLOOM_KIND_NAMES[kind] ?? 'Bloom', x, y + 20, pen.text(sk.petal, 0.9, 1));
      }
    }
  } else {
    // A seed mound: a small ring of soil flecks and a pale seed.
    const seed = pen.shape(sk.core, 0.7, 'fx');
    r.circle(x, y - 2, 1.8, seed);
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.6; r.circle(x + Math.cos(a) * 6, y + 2 + Math.sin(a) * 3, 0.9, soil); }
  }
  // A life bar once it has been bitten.
  if (m.w !== undefined && m.w < 100) {
    const bar = pen.shape([0.15, 0.1, 0.1], 0.85, 'fx');
    bar.thickness = 3;
    r.line(x - 12, y + 10, x + 12, y + 10, bar);
    const fill = pen.shape(m.w < 35 ? [0.95, 0.35, 0.25] : [0.6, 0.85, 0.35], 0.95, 'fx');
    fill.thickness = 3;
    r.line(x - 12, y + 10, x - 12 + 24 * clamp01(m.w / 100), y + 10, fill);
  }
}

function dwell(pen: Pen, f: FrameCtx, z: MapEventZone): void {
  const col = SKINS[skinOf(f.theme)].petal;
  const ring = pen.shape(col, 0.35, 'decal');
  ring.thickness = 1;
  pen.r.ring(z.x, z.y, z.r, ring);
  const arc = pen.shape(col, 0.95, 'decal');
  arc.thickness = 3;
  arc.additive = true;
  arc.arc = clamp01(z.v / 100);
  pen.r.ring(z.x, z.y, z.r, arc);
}

export const orchardArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView): void {
    for (const z of e.zones) if (z.kind === 'stone') dwell(pen, f, z);
    for (const m of e.markers) if (m.icon === 'bloom') bloom(pen, f, m);
  },
  residue(beat) {
    return beat === 'harvest' || beat === 'lost' ? { r: 14 } : beat === 'complete' ? { r: 30 } : null;
  },
};
