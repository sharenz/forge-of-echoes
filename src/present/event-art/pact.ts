// PACT ALTAR on the ground: a dim ring with a small sigil at the altar's heart and one stone per bargain. A stone is an anvil
// (Ashen), a bone plinth (Ossuary) or an iron gong (Coliseum); over it floats the pact's own sign and under it its name. The dwell
// closes as an arc round the stone; the chosen stone burns bright, the spent ones go dark. Decal layer and thin additive lines only.
import { PACT_IDS } from '../../contracts/map-events';
import type { MapEventView, MapEventZone } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import { PACT_NAMES } from '../../data/progression/events/pact-altar';
import type { FrameCtx } from '../context';
import { clamp01, TAU } from '../math';
import type { Pen } from '../pen';
import type { EventArt } from './index';

const IRON: RGB = [0.72, 0.68, 0.62];
const BONE: RGB = [0.88, 0.84, 0.72];
const EMBER: RGB = [1, 0.62, 0.25];
const EMBER_TAX: RGB = [0.78, 0.74, 0.5];
const TONES: readonly RGB[] = [
  [0.95, 0.75, 0.3], [0.9, 0.3, 0.35], [0.7, 0.75, 0.85], [0.55, 0.85, 0.55], [1, 0.45, 0.2], EMBER_TAX,
];

function skinOf(theme: string): 'ashen' | 'ossuary' | 'coliseum' {
  return theme === 'rimedOssuary' || theme === 'choralCrypt' ? 'ossuary' : theme === 'ironColiseum' || theme === 'chainworks' ? 'coliseum' : 'ashen';
}

/** The sign of pact `n` (PACT_IDS order) drawn with a few strokes round (x, y). */
function sign(pen: Pen, n: number, x: number, y: number, col: RGB, alpha: number): void {
  const o = pen.shape(col, alpha, 'fx');
  o.thickness = 1.5;
  o.additive = true;
  o.emissive = 0.7;
  const r = pen.r;
  switch (PACT_IDS[n]) {
    case 'swarm': // a cluster of five dots
      for (let k = 0; k < 5; k++) { const a = k * TAU / 5; r.circle(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 1.6, o); }
      break;
    case 'bloodMoon': // a crescent
      for (let k = 0; k < 10; k++) { const a0 = -1.2 + k * 0.24, a1 = a0 + 0.24; r.line(x + Math.cos(a0) * 7, y + Math.sin(a0) * 7, x + Math.cos(a1) * 7, y + Math.sin(a1) * 7, o); }
      for (let k = 0; k < 8; k++) { const a0 = -0.9 + k * 0.22, a1 = a0 + 0.22; r.line(x + 3 + Math.cos(a0) * 5.5, y + Math.sin(a0) * 5.5, x + 3 + Math.cos(a1) * 5.5, y + Math.sin(a1) * 5.5, o); }
      break;
    case 'ironhide': // a heater shield
      r.line(x - 6, y - 6, x + 6, y - 6, o); r.line(x + 6, y - 6, x + 6, y + 1, o); r.line(x + 6, y + 1, x, y + 8, o);
      r.line(x, y + 8, x - 6, y + 1, o); r.line(x - 6, y + 1, x - 6, y - 6, o);
      break;
    case 'ambush': // four arrows closing in
      for (let k = 0; k < 4; k++) {
        const a = k * TAU / 4 + Math.PI / 4, cx = Math.cos(a), cy = Math.sin(a);
        r.line(x + cx * 9, y + cy * 9, x + cx * 3, y + cy * 3, o);
        r.line(x + cx * 3, y + cy * 3, x + cx * 6 - cy * 2.5, y + cy * 6 + cx * 2.5, o);
        r.line(x + cx * 3, y + cy * 3, x + cx * 6 + cy * 2.5, y + cy * 6 - cx * 2.5, o);
      }
      break;
    case 'cinderCurse': // a flame with a slash
      r.line(x, y - 8, x + 4, y - 1, o); r.line(x + 4, y - 1, x + 2, y + 6, o); r.line(x + 2, y + 6, x - 3, y + 6, o);
      r.line(x - 3, y + 6, x - 5, y, o); r.line(x - 5, y, x, y - 8, o); r.line(x - 7, y + 7, x + 7, y - 7, o);
      break;
    default: // Ember Tax: a coin
      r.ring(x, y, 6, o);
      r.line(x - 3, y, x + 3, y, o);
  }
}

/** The stone's body by skin, standing on (x, y). */
function body(pen: Pen, skin: ReturnType<typeof skinOf>, x: number, y: number, col: RGB, alpha: number): void {
  const o = pen.shape(skin === 'ossuary' ? BONE : IRON, alpha, 'decal');
  o.thickness = 2;
  const r = pen.r;
  if (skin === 'ashen') { // an anvil: face, waist and foot
    r.line(x - 11, y - 4, x + 9, y - 4, o); r.line(x + 9, y - 4, x + 14, y - 1, o); r.line(x + 14, y - 1, x + 6, y - 1, o);
    r.line(x + 6, y - 1, x + 4, y + 4, o); r.line(x + 4, y + 4, x + 8, y + 4, o); r.line(x - 8, y + 4, x - 4, y + 4, o);
    r.line(x - 4, y + 4, x - 4, y - 1, o); r.line(x - 4, y - 1, x - 11, y - 4, o);
  } else if (skin === 'ossuary') { // a bone plinth: a slab on two knuckle-ends
    r.line(x - 10, y - 4, x + 10, y - 4, o); r.line(x - 8, y - 4, x - 8, y + 5, o); r.line(x + 8, y - 4, x + 8, y + 5, o);
    r.ring(x - 8, y + 6, 2.2, o); r.ring(x + 8, y + 6, 2.2, o);
  } else { // a gong in an iron frame
    r.line(x - 11, y + 7, x - 9, y - 9, o); r.line(x + 11, y + 7, x + 9, y - 9, o); r.line(x - 9, y - 9, x + 9, y - 9, o);
    r.ring(x, y - 1, 7, o);
  }
  const g = pen.shape(col, alpha * 0.5, 'decal');
  g.additive = true;
  pen.r.ring(x, y, 17, g);
}

function stone(pen: Pen, f: FrameCtx, z: MapEventZone): void {
  const skin = skinOf(f.theme);
  const n = z.n ?? 0;
  const col = TONES[n] ?? EMBER;
  const chosen = z.v === 255, spent = z.v === 254;
  const pulse = 0.75 + 0.25 * Math.sin(f.time * 3 + n);
  const alpha = spent ? 0.22 : chosen ? 1 : 0.85;
  body(pen, skin, z.x, z.y, col, alpha);
  if (!spent) {
    const ring = pen.shape(col, (chosen ? 0.95 : 0.5 * pulse), 'decal');
    ring.thickness = chosen ? 2.5 : 1.5;
    ring.additive = true;
    ring.emissive = chosen ? 1 : 0.5;
    pen.r.ring(z.x, z.y + 4, z.r, ring);
    if (!chosen && z.v > 0 && z.v <= 100) {
      const arc = pen.shape(col, 0.95, 'decal');
      arc.thickness = 3;
      arc.additive = true;
      arc.arc = clamp01(z.v / 100);
      pen.r.ring(z.x, z.y + 4, z.r - 4, arc);
    }
    pen.light(z.x, z.y - 4, chosen ? 110 : 70, col, chosen ? 0.8 : 0.3 * pulse, 0.2);
    sign(pen, n, z.x, z.y - 26 + Math.sin(f.time * 2 + n) * 1.5, col, chosen ? 1 : 0.9);
    pen.r.text(PACT_NAMES[PACT_IDS[n]] ?? '', z.x, z.y + z.r + 10, pen.text(col, chosen ? 1 : 0.85, 1));
  } else sign(pen, n, z.x, z.y - 22, IRON, 0.25);
}

function altar(pen: Pen, f: FrameCtx, z: MapEventZone, col: RGB): void {
  const o = pen.shape(col, 0.25, 'decal');
  o.thickness = 1;
  o.additive = true;
  for (let k = 0; k < 24; k++) { // a dashed ring through the stones
    const a0 = k * TAU / 24, a1 = a0 + TAU / 48;
    pen.r.line(z.x + Math.cos(a0) * z.r, z.y + Math.sin(a0) * z.r, z.x + Math.cos(a1) * z.r, z.y + Math.sin(a1) * z.r, o);
  }
  // The altar's own sigil: a pair of scales, tipping with the round.
  const s = pen.shape(col, 0.7, 'decal');
  s.thickness = 1.5;
  s.additive = true;
  const tilt = Math.sin(f.time * 1.2) * 2;
  pen.r.line(z.x, z.y - 10, z.x, z.y + 10, s);
  pen.r.line(z.x - 12, z.y - 8 + tilt, z.x + 12, z.y - 8 - tilt, s);
  pen.r.ring(z.x - 12, z.y - 3 + tilt, 4, s);
  pen.r.ring(z.x + 12, z.y - 3 - tilt, 4, s);
  pen.r.line(z.x - 6, z.y + 10, z.x + 6, z.y + 10, s);
  pen.light(z.x, z.y, z.r * 1.3, col, 0.3, 0.15);
  if (z.n) pen.r.text(`Pact: ${PACT_NAMES[PACT_IDS[z.n - 1]] ?? ''}`, z.x, z.y + 24, pen.text(TONES[z.n - 1] ?? col, 0.9, 1));
}

export const pactArt: EventArt = {
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void {
    for (const z of e.zones) {
      if (z.kind === 'altar') altar(pen, f, z, col);
      else if (z.kind === 'stone') stone(pen, f, z);
    }
  },
  residue(beat) {
    return beat === 'pick' ? { r: 22 } : beat === 'complete' ? { r: 34 } : null;
  },
};
