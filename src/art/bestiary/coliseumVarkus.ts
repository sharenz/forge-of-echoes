// Varkus, the Iron Champion — boss. The undefeated gladiator of the Iron Coliseum: an iron galea helm with a bronze
// brow and cheek guards under a towering crimson horsehair crest, a T-slit visor with burning ember eyes, a great
// bronze-trimmed pauldron, an iron muscle cuirass, leather pteruges over a crimson kilt, iron greaves on sun-dark legs
// and a long crimson cape. On his far arm a round iron shield, rimmed in bronze, its boss a forge-hot bronze sun;
// in his near hand a broad, blood-streaked greatsword whose edge never quite cools.
//
// idle / move: the champion's low guard — shield up across the chest, the greatsword held low and forward, its point
// hovering over the sand ahead (the long steel diagonal is the second read after the crest). windup: the greatsword
// climbs high behind the crest, the edge heats to white and the eyes flare. attack: the overhead cleave into the sand
// ahead (a burning arc, sparks, dust). charge (loops): a leaning sprint tucked behind the raised shield — only the
// burning visor over its rim — the sword trailing and scraping sparks from the sand, the cape and crest streaming.
// whirl (loops): one full turn, the body turning with it (two frames show his back, the cape wrapped round him), the
// blade leaving a burning ring. corpse: to one knee on the planted sword, then down.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash } from '../monsters/common';
import { BRONZE, CRIMSON, IRON, LEATHER, TAN, dust, limb, sole, on, put, smear, sparks, type Pt } from './coliseumKit';

const W = 96;
const H = 82;
const FEET = 78;
const AX = 40;
const BLADE = 30;

const skin: PrimStyle = { ramp: TAN, bias: -0.9, dither: 0.06 };
const thigh: PrimStyle = { ramp: TAN, bias: -0.55, dither: 0.04 };
const skinFar: PrimStyle = { ramp: TAN, bias: -1.7, dither: 0 };
const greave: PrimStyle = { ramp: IRON, bias: 0.2, dither: 0.05 };
const greaveFar: PrimStyle = { ramp: IRON, bias: -1, dither: 0 };
const helm: PrimStyle = { ramp: IRON, bias: 0.4, dither: 0.06 };
const ironFar: PrimStyle = { ramp: IRON, bias: -0.8, dither: 0 };
// a smooth, burnished muscle cuirass (no pitting: it must read as polished iron, not stone)
const cuirass: PrimStyle = { ramp: IRON, bias: -0.1, dither: 0.03, round: 0.8 };
const pauldron: PrimStyle = { ramp: IRON, bias: 0.45, dither: 0.04 };
const bronze: PrimStyle = { ramp: BRONZE, bias: 0, dither: 0.06 };
const leather: PrimStyle = { ramp: LEATHER, bias: 0.1, dither: 0.04 };
const cape: PrimStyle = { ramp: CRIMSON, bias: -0.3, dither: 0.08, cyl: 0.5 };
const crest: PrimStyle = { ramp: CRIMSON, bias: -0.35, dither: 0.1, ao: false };
const shieldFace: PrimStyle = { ramp: IRON, bias: 0.35, dither: 0.06, round: 0.7 };

type SwordLayer = 'front' | 'behind' | 'underHead';

interface P {
  bob: number;
  lean: number; // + = forward
  footN: Pt;
  footF: Pt;
  grip: Pt; // sword hand
  swordA: number; // blade direction (radians, 0 = east, y down)
  swordLen: number; // blade length as seen (foreshortened when pointing at / away from the camera)
  sword: SwordLayer; // 'behind' = only where nothing else is; 'underHead' = in front of the body, behind helm/crest/arm
  shield: Pt; // shield centre
  shieldR: [number, number]; // shield radii as seen
  cape: Pt; // cape hem centre, offset from the upper back
  capeW: number; // hem half width
  crestSway: number; // + = the crest's tail streams back
  glow: number;
  sparksAt: Pt | null;
  dustAt: Pt | null;
  arc: [number, number] | null; // cleave smear: start angle about the shoulder, vertical squash of the arc
  whirl: number | null; // blade angle round the ring while whirling
  heat: number; // 0..1 ember heat along the blade's edge
  back: boolean; // seen from behind (whirl)
}

/** Grip → tip of a blade of length `len` at angle `a`. */
const tipOf = (grip: Pt, a: number, len: number): Pt => [grip[0] + Math.cos(a) * len, grip[1] + Math.sin(a) * len];

/**
 * The greatsword: a bronze pommel and a wrapped grip, a wide bronze crossguard, then a broad 3 px blade (lit edge,
 * steel body, dark back edge) tapering only over its last 4 px, streaked with blood. `heat` lights the edge from the
 * point back towards the guard (ember → flame → hot). `skip` masks pixels the blade passes behind.
 */
function drawSword(f: Frame, grip: Pt, a: number, len: number, heat: number, skip: (x: number, y: number) => boolean): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nx = -s; // blade-space perpendicular; -n is the lit (top-left) edge when the blade points east
  const ny = c;
  const plot = (x: number, y: number, col: Color): void => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (X < 0 || Y < 0 || X >= W || Y >= H || skip(X, Y)) return;
    put(f, X, Y, col);
  };
  // pommel and wrapped grip
  plot(grip[0] - c * 3.6, grip[1] - s * 3.6, C.gold);
  plot(grip[0] - c * 3.6 + nx * 0.9, grip[1] - s * 3.6 + ny * 0.9, C.goldDark);
  plot(grip[0] - c * 4.4, grip[1] - s * 4.4, C.ochre);
  for (let t = -2.8; t <= 1; t += 0.5) plot(grip[0] + c * t, grip[1] + s * t, Math.round(t * 2) % 2 === 0 ? C.woodDark : C.woodDeep);
  // blade: rasterised in blade space so it stays a solid 3 px band at any angle
  const L = Math.max(5, len);
  const from = 2.2;
  const minX = Math.floor(Math.min(grip[0] + c * from, grip[0] + c * L) - 3);
  const maxX = Math.ceil(Math.max(grip[0] + c * from, grip[0] + c * L) + 3);
  const minY = Math.floor(Math.min(grip[1] + s * from, grip[1] + s * L) - 3);
  const maxY = Math.ceil(Math.max(grip[1] + s * from, grip[1] + s * L) + 3);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || skip(x, y)) continue;
      const dx = x + 0.5 - grip[0];
      const dy = y + 0.5 - grip[1];
      const u = dx * c + dy * s; // along the blade
      const v = dx * nx + dy * ny; // across (negative = lit edge)
      if (u < from || u > L + 0.6) continue;
      const half = u > L - 4 ? 0.45 + 1.05 * Math.max(0, (L + 0.6 - u) / 4.6) : 1.5;
      if (Math.abs(v) > half) continue;
      const q = u / L;
      const bloody = q > 0.5 && q < 0.82 && v > -0.5;
      if (v < -0.5 || (half < 0.9 && u > L - 1.2)) {
        // the lit edge (and the point)
        const hot = heat > 0 && q > 1 - (0.42 + 0.58 * heat);
        if (hot) {
          const k = (q + heat) / 2;
          f.glow(x, y, k > 0.82 ? C.hot : k > 0.58 ? C.flame : C.ember, 115 + 140 * Math.min(1, heat + q * 0.45));
        } else put(f, x, y, u > L - 1.2 ? C.white : C.metalHi);
      } else if (v <= 0.5) put(f, x, y, bloody && (Math.round(u) % 4 !== 0) ? C.blood : q < 0.4 ? C.metalLight : C.metalMid);
      else put(f, x, y, bloody ? C.lifeDark : C.metal);
    }
  }
  // wide bronze crossguard (over the blade's root)
  const g: Pt = [grip[0] + c * 1.6, grip[1] + s * 1.6];
  for (let w = -4.5; w <= 4.5; w += 0.5) plot(g[0] + nx * w, g[1] + ny * w, w < -2 ? C.goldHi : w < 1.5 ? C.gold : C.ochre);
  for (let w = -1.5; w <= 1.5; w += 0.5) plot(g[0] + nx * w + c * 0.9, g[1] + ny * w + s * 0.9, C.goldDark);
}

/** The whirl's blur: a 3 px band trailing the blade round the ring — a burning core at its head fading to steel. */
function whirlBlur(f: Frame, cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): void {
  const steps = Math.ceil(Math.abs(a1 - a0) * rx * 2);
  const seen = new Set<number>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    for (let w = 0; w < 3; w++) {
      const k = 1 - w / rx;
      const x = Math.round(cx + Math.cos(a) * rx * k);
      const y = Math.round(cy + Math.sin(a) * ry * k);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const key = y * W + x;
      if (seen.has(key)) continue;
      seen.add(key);
      // the body occludes the far half of the ring
      if (f.c.alpha(x, y) === 255 && Math.sin(a) < 0.15) continue;
      const cov = (0.3 + 0.7 * t) * (w === 1 ? 1 : 0.75);
      if (t > 0.78) f.glowSoft(x, y, w === 1 ? C.hot : C.flame, cov, 200);
      else if (t > 0.45) f.glowSoft(x, y, w === 1 ? C.flame : C.ember, cov, 160);
      else if (f.c.alpha(x, y) < 255) f.c.plot(x, y, t > 0.22 ? C.metalHi : C.ashGrey, cov * 0.85);
    }
  }
}

function body(p: P): { hip: Pt; chest: Pt; head: Pt; shN: Pt; shF: Pt; back: Pt } {
  const lean = p.lean;
  const hip: Pt = [39 + lean, FEET - 22 + p.bob + Math.abs(lean) * 0.6];
  const chest: Pt = [40 + lean * 2.6, FEET - 34 + p.bob + Math.abs(lean) * 0.9];
  const head: Pt = [42.4 + lean * 3.8, FEET - 47.6 + p.bob + lean * 1.8];
  return { hip, chest, head, shN: [chest[0] + 2.6, chest[1] - 6.6], shF: [chest[0] - 4.2, chest[1] - 7], back: [chest[0] - 5, chest[1] - 7.4] };
}

function capeShape(s: Sculpt, back: Pt, p: P, style: PrimStyle, extra: Pt[] = []): { hem: Pt; px: number; py: number; len: number; dx: number; dy: number } {
  const hem: Pt = [back[0] + p.cape[0], back[1] + p.cape[1]];
  const dx = hem[0] - back[0];
  const dy = hem[1] - back[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const pts: Pt[] = [
    [back[0] + 3.6, back[1] - 1.6],
    [back[0] - 2.4, back[1] - 0.2],
    [back[0] - 5.6 + p.cape[0] * 0.25, back[1] + 4 + p.cape[1] * 0.1],
    [back[0] - 6.4 + p.cape[0] * 0.5, back[1] + 4 + p.cape[1] * 0.4],
  ];
  for (let i = 0; i <= 6; i++) {
    const u = 1 - (i / 6) * 2; // trailing edge → body edge along the hem
    const ragged = i % 2 === 0 ? 0 : -1;
    pts.push([hem[0] + px * p.capeW * u + (dx / len) * ragged, hem[1] + py * p.capeW * u + (dy / len) * ragged]);
  }
  pts.push([back[0] + 5, back[1] + 8], ...extra);
  s.poly(pts, style, 2.4);
  return { hem, px, py, len, dx, dy };
}

/** Visor: a dark T slit with two burning eyes. */
function visor(f: Frame, head: Pt, glow: number): void {
  const vx = Math.round(head[0] + 2.4);
  const vy = Math.round(head[1] + 0.8);
  const g = 165 + 90 * Math.min(1, glow);
  for (let x = vx - 1; x <= vx + 3; x++) on(f, x, vy - 1, C.metalDeep);
  for (let y = vy; y <= vy + 3; y++) on(f, vx + 1, y, C.metalDeep);
  f.glow(vx + 2, vy - 1, glow > 0.95 ? C.white : C.hot, g);
  f.glow(vx + 3, vy - 1, C.flame, g * 0.9);
  f.glow(vx - 1, vy - 1, C.ember, g * 0.7);
  f.glow(vx, vy - 1, C.flame, g * 0.8);
}

function draw(p: P): Frame {
  if (p.back) return drawBack(p);
  const f = new Frame(W, H);
  const s = new Sculpt();
  const { hip, chest, head, shN, shF, back } = body(p);
  const whirling = p.whirl !== null;

  const cp = capeShape(s, back, p, cape);

  // far arm to the shield grip (behind the shield), far leg
  const handF: Pt = [p.shield[0] - 1, p.shield[1] + 0.5];
  limb(s, shF, handF, whirling ? 2 : 2.2, 3.2, 2.7, 2.5, skinFar);
  limb(s, [hip[0] - 3, hip[1] + 1.6], sole(p.footF, 2.9), 2.8, 4.2, 3.4, 2.9, skinFar, greaveFar);
  // near leg: sun-dark thigh, iron greave
  limb(s, [hip[0] + 2.2, hip[1] + 1.6], sole(p.footN, 3.1), 2.8, 4.4, 3.6, 3.1, thigh, greave);
  // crimson kilt and leather pteruges
  s.poly([[hip[0] - 7, hip[1] - 3], [hip[0] + 7, hip[1] - 3.6], [hip[0] + 7.6, hip[1] + 4.2], [hip[0] - 7.4, hip[1] + 3.8]], { ...cape, bias: -0.1, cyl: 0.7 }, 1.4);
  s.poly([[hip[0] - 6.6, hip[1] - 4], [hip[0] + 6.8, hip[1] - 4.6], [hip[0] + 7.2, hip[1] + 1.8], [hip[0] - 7, hip[1] + 1.4]], { ...leather, cyl: 0.7 }, 1.4);
  // muscle cuirass: broad chest over a plated abdomen
  const cuirassIdx = s.size;
  s.ell(chest[0], chest[1], 9.2, 9, cuirass, p.lean * 0.1);
  s.ell(chest[0] + 1, chest[1] + 6.4, 7.2, 4.4, { ...cuirass, bias: -0.1 });
  // far pauldron
  s.ell(shF[0] + 0.4, shF[1] + 0.6, 3.6, 3, { ...ironFar, bias: -0.2 }, -0.3);
  // helm: neck guard flaring back, the bowl, a bronze cheek guard
  const headIdx = s.size;
  s.poly([[head[0] - 5.4, head[1] + 1], [head[0] - 2, head[1] + 1], [head[0] - 3, head[1] + 6.6], [head[0] - 6.8, head[1] + 6]], { ...helm, bias: 0 }, 1.2);
  s.ell(head[0], head[1], 5.6, 6.2, helm);
  s.poly([[head[0] + 0.8, head[1] + 0.6], [head[0] + 5.4, head[1] - 0.2], [head[0] + 5.2, head[1] + 5.6], [head[0] + 2.2, head[1] + 7.2]], { ...bronze, bias: 0.4 }, 1.2, 0.2, 0);
  // the crest: a tall crimson horsehair crescent standing on the helm ridge, cascading down behind the nape
  const cs = p.crestSway;
  const crestAt = (t: number, out: number): Pt => {
    const a = -1.2 - t * 2.35;
    const r = 5.4 + out * (3 + t * 2 + Math.sin(t * Math.PI) * 2.4);
    const sway = cs * t * t * out;
    return [head[0] - 0.2 + Math.cos(a) * r * 1.05 - sway, head[1] - 0.6 + Math.sin(a) * r + Math.abs(cs) * t * out * 0.25];
  };
  const fan: Pt[] = [];
  for (let i = 0; i <= 10; i++) fan.push(crestAt(i / 10, 1));
  for (let i = 10; i >= 0; i--) fan.push(crestAt(i / 10, 0));
  s.poly(fan, crest, 1.8, -0.2, -0.5);
  const headEnd = s.size;
  // round shield on the far arm
  const shieldIdx = s.size;
  s.ell(p.shield[0], p.shield[1], p.shieldR[0], p.shieldR[1], shieldFace, 0.1);
  // the great pauldron on the near shoulder, layered iron
  const armIdx = s.size;
  s.ell(shN[0] - 1.4, shN[1] + 0.2, 6.8, 4.8, pauldron, -0.35);
  s.ell(shN[0] - 0.4, shN[1] + 3.6, 5.6, 3.2, { ...pauldron, bias: 0.05 }, -0.3);
  // near arm: sun-dark upper arm, leather bracer, fist on the grip
  const eN = limb(s, [shN[0] + 0.4, shN[1] + 3.4], p.grip, whirling ? -1 : -2.4, 3, 2.6, 2.5, skin, leather);
  s.ell(p.grip[0], p.grip[1], 2.6, 2.4, { ...skin, bias: -0.1 });
  const armEnd = s.size;

  const behind = p.sword === 'behind';
  if (behind) drawSword(f, p.grip, p.swordA, p.swordLen, p.heat, () => false);
  const owner = s.render(f.c, f.e);
  const own = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1 : owner[y * W + x]);
  if (behind) drawSword(f, p.grip, p.swordA, p.swordLen, p.heat, (x, y) => own(x, y) >= 0);
  const isShield = (x: number, y: number): boolean => own(x, y) === shieldIdx;

  // cape folds: dark creases from the shoulders towards the hem
  for (const u of [-0.55, 0.05]) {
    const a0: Pt = [back[0] - 2.4, back[1] + 5];
    const a1: Pt = [cp.hem[0] + cp.px * p.capeW * u, cp.hem[1] + cp.py * p.capeW * u];
    for (let k = 0; k <= 24; k++) {
      const t = 0.25 + (k / 24) * 0.7;
      const x = Math.round(a0[0] + (a1[0] - a0[0]) * t);
      const y = Math.round(a0[1] + (a1[1] - a0[1]) * t);
      if (own(x, y) === 0) put(f, x, y, u < 0 ? C.wineDeep : C.lifeDark);
    }
  }
  // cuirass: sculpted pectoral and abdominal lines, a bronze collar
  const onCuirass = (x: number, y: number, c: Color): void => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (own(X, Y) === cuirassIdx || own(X, Y) === cuirassIdx + 1) put(f, X, Y, c);
  };
  for (let i = -3; i <= 4; i++) onCuirass(chest[0] + i, chest[1] + 1.2 + Math.abs(i - 0.5) * -0.35 + 1.4, C.metal);
  for (let i = -2; i <= 3; i++) onCuirass(chest[0] + i, chest[1] + 0.6 + Math.abs(i - 0.5) * -0.35 + 1.4, C.metalHi);
  onCuirass(chest[0] + 1, chest[1] + 5.6, C.metal);
  onCuirass(chest[0] + 1, chest[1] + 7.6, C.metal);
  onCuirass(chest[0] - 3.5, chest[1] - 3.5, C.metalHi);
  for (let x = Math.round(chest[0] - 4); x <= Math.round(chest[0] + 6); x++) onCuirass(x, chest[1] - 7.6 + Math.abs(x - chest[0]) * 0.12, x < chest[0] ? C.gold : C.ochre);
  // shield: bronze rim, a crimson chevron, the forge-hot bronze sun boss with ember rivets
  const [sx, sy] = p.shield;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isShield(x, y)) continue;
      const edge = !isShield(x - 1, y) || !isShield(x + 1, y) || !isShield(x, y - 1) || !isShield(x, y + 1);
      if (edge) put(f, x, y, y < sy - 2 && x < sx + 1 ? C.gold : y < sy + 3 ? C.ochre : C.goldDark);
      else {
        // a painted crimson ring inside the rim
        const u = (x + 0.5 - sx) / p.shieldR[0];
        const v = (y + 0.5 - sy) / p.shieldR[1];
        const d = Math.hypot(u, v);
        if (d > 0.6 && d < 0.8) put(f, x, y, u + v < -0.3 ? C.life : u + v < 0.5 ? C.blood : C.lifeDark);
      }
    }
  }
  const boss = (x: number, y: number, col: Color, g: number): void => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (isShield(X, Y)) f.glow(X, Y, col, g);
  };
  const bx = sx + 0.4;
  const by = sy - 0.2;
  const hot = 150 + 60 * Math.min(1, p.glow);
  boss(bx, by, C.hot, hot + 30);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) boss(bx + dx, by + dy, C.flame, hot);
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) boss(bx + dx, by + dy, C.ember, hot - 20);
  if (p.shieldR[0] > 3) for (const [dx, dy] of [[0, -0.62], [0, 0.62], [-0.6, 0], [0.62, 0]]) boss(sx + dx * p.shieldR[0], sy + dy * p.shieldR[1], C.ember, hot - 30);
  // belt and pteruges strips with bronze studs
  for (let x = Math.round(hip[0] - 7); x <= Math.round(hip[0] + 7); x++) on(f, x, Math.round(hip[1] - 4.2 - (x - hip[0]) * 0.04), x % 3 === 0 ? C.goldHi : x < hip[0] ? C.gold : C.ochre);
  for (let x = Math.round(hip[0] - 6); x <= Math.round(hip[0] + 6); x += 2) {
    for (let y = Math.round(hip[1] - 3); y <= Math.round(hip[1] + 1.4); y++) if (!isShield(x, y)) on(f, x, y, C.woodDeep);
    if (!isShield(x + 1, Math.round(hip[1]))) on(f, x + 1, Math.round(hip[1]), C.ochre);
  }
  // pauldron: a dark lower lip separating it from the arm, bronze trim and rivets
  for (let k = -5; k <= 3; k++) {
    const x = Math.round(shN[0] - 0.4 + k);
    const y = Math.round(shN[1] + 6.6 - Math.abs(k + 1) * 0.3);
    const o = own(x, y);
    if (o >= armIdx && o < armIdx + 2) put(f, x, y, C.metalDeep);
    if (own(x, y - 1) >= armIdx && own(x, y - 1) < armIdx + 2) put(f, x, y - 1, k < -1 ? C.gold : C.ochre);
  }
  on(f, shN[0] - 4.6, shN[1] + 0.6, C.metalHi);
  on(f, shN[0] - 1.6, shN[1] - 2.8, C.metalHi);
  on(f, shN[0] + 2.2, shN[1] + 1.8, C.goldDark);
  // sandal soles under the greaves, a bronze knee cop
  for (const [x, y] of [p.footF, p.footN]) {
    for (let i = -3; i <= 3; i++) put(f, x + i, y, i < 0 ? C.woodDark : C.woodDeep);
    on(f, x + 3, y - 1, C.woodDark);
  }
  // helm: visor, bronze brow band, rivets
  visor(f, head, p.glow);
  for (let x = Math.round(head[0] - 4); x <= Math.round(head[0] + 5); x++) on(f, x, Math.round(head[1] - 2.6 - (x - head[0]) * 0.1), x < head[0] ? C.gold : C.ochre);
  on(f, head[0] - 2, head[1] - 4.6, C.metalHi);
  on(f, head[0] - 1, head[1] - 5.2, C.metalHi);
  // crest: horsehair strands through the fan, a bronze holder along its root
  for (let i = 1; i < 10; i += 2) {
    const a0 = crestAt(i / 10, 0.35);
    const a1 = crestAt(i / 10, 0.85);
    for (let k = 0; k <= 3; k++) on(f, a0[0] + ((a1[0] - a0[0]) * k) / 3, a0[1] + ((a1[1] - a0[1]) * k) / 3, k < 2 ? C.lifeDark : C.blood);
  }
  for (let i = 0; i <= 10; i++) {
    const [x, y] = crestAt(i / 10, 0);
    on(f, x, y, i < 5 ? C.gold : C.goldDark);
  }
  // bracer stud
  on(f, (eN[0] + p.grip[0]) / 2, (eN[1] + p.grip[1]) / 2, C.gold);
  // the sword in front (under the helm and the fist when it rides high)
  if (p.sword === 'front') drawSword(f, p.grip, p.swordA, p.swordLen, p.heat, () => false);
  else if (p.sword === 'underHead') drawSword(f, p.grip, p.swordA, p.swordLen, p.heat, (x, y) => (own(x, y) >= headIdx && own(x, y) < headEnd) || (own(x, y) >= armIdx && own(x, y) < armEnd));
  // fingers over the grip
  put(f, p.grip[0] + 0.8, p.grip[1] - 0.8, C.rustLight);
  put(f, p.grip[0] + 1.2, p.grip[1] + 0.4, C.rust);

  const out = finish(f);
  return fx(out, p, shN);
}

/** From behind (whirl): the cape wrapped round him, the crest a ridge over the helm, no eyes, the shield edge-on. */
function drawBack(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const { hip, chest, head } = body(p);
  // shield edge-on on his left (west) arm, legs, the torso block
  const shieldIdx = s.size;
  s.ell(p.shield[0], p.shield[1], p.shieldR[0], p.shieldR[1], { ...shieldFace, bias: -0.2 }, 0.1);
  limb(s, [chest[0] - 7, chest[1] - 6], [p.shield[0] + 1, p.shield[1]], 1.6, 3, 2.6, 2.4, skinFar);
  limb(s, [hip[0] - 3.4, hip[1] + 1.6], sole(p.footF, 3), -1.2, 4.3, 3.5, 3, thigh, greave);
  limb(s, [hip[0] + 3.4, hip[1] + 1.6], sole(p.footN, 3), 1.2, 4.3, 3.5, 3, thigh, greave);
  const kiltIdx = s.size;
  s.poly([[hip[0] - 7.6, hip[1] - 3], [hip[0] + 7.6, hip[1] - 3], [hip[0] + 8.2, hip[1] + 4.2], [hip[0] - 8.2, hip[1] + 4.2]], { ...cape, bias: -0.1, cyl: 0.8 }, 1.4);
  s.ell(chest[0], chest[1], 9.6, 9.4, cuirass);
  // the sword arm reaching out east
  const shR: Pt = [chest[0] + 7, chest[1] - 6];
  limb(s, shR, p.grip, -1.5, 3.3, 2.9, 2.7, skin, leather);
  s.ell(p.grip[0], p.grip[1], 2.6, 2.4, { ...skin, bias: -0.1 });
  // cape wrapped over the back, flaring with the spin
  const top: Pt = [chest[0], chest[1] - 8];
  const fl = p.cape[0];
  s.poly(
    [
      [top[0] - 9, top[1] + 1],
      [top[0] + 9, top[1] + 1],
      [top[0] + 11 + Math.max(0, fl) * 0.6, top[1] + 12],
      [top[0] + 12 + Math.max(0, fl), top[1] + p.cape[1] - 2],
      [top[0] + 7 + fl * 0.5, top[1] + p.cape[1]],
      [top[0] + 2 + fl * 0.4, top[1] + p.cape[1] - 1.5],
      [top[0] - 3 + fl * 0.3, top[1] + p.cape[1]],
      [top[0] - 8 + fl * 0.2, top[1] + p.cape[1] - 1.5],
      [top[0] - 12 + Math.min(0, fl), top[1] + p.cape[1] - 2],
      [top[0] - 11 + Math.min(0, fl) * 0.6, top[1] + 12],
    ],
    { ...cape, bias: -0.15, cyl: 0.8 },
    2.4,
  );
  // pauldron on the right shoulder, the helm from behind, neck guard, the crest ridge running over the crown
  s.ell(shR[0] - 0.6, shR[1] + 0.6, 6, 4.4, pauldron, 0.3);
  s.poly([[head[0] - 6, head[1] + 2], [head[0] + 6, head[1] + 2], [head[0] + 6.6, head[1] + 7], [head[0] - 6.6, head[1] + 7]], { ...helm, bias: 0 }, 1.4);
  s.ell(head[0], head[1], 6, 6.2, helm);
  const ridge = s.size;
  s.cap(head[0] + p.crestSway * 0.3, head[1] - 12.5, head[0], head[1] + 4.5, 2.2, 1.6, crest);
  s.ell(head[0] + p.crestSway * 0.2, head[1] - 9, 2.8, 5, crest);
  const owner = s.render(f.c, f.e);
  const own = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1 : owner[y * W + x]);
  // cape folds, crest strands, helm band and the shield's bronze edge
  for (const dx of [-4, 1, 6]) for (let y = Math.round(chest[1] - 2); y < Math.round(chest[1] + p.cape[1] - 11); y++) on(f, chest[0] + dx + (y - chest[1]) * dx * 0.03, y, dx === 1 ? C.lifeDark : C.wineDeep);
  for (let y = Math.round(head[1] - 13); y <= Math.round(head[1] + 3); y++) if (own(Math.round(head[0]), y) >= ridge) put(f, head[0] + (y % 3 === 0 ? -1 : 0), y, y % 2 ? C.lifeDark : C.blood);
  for (let x = Math.round(head[0] - 5); x <= Math.round(head[0] + 5); x++) if (own(x, Math.round(head[1] - 1)) < ridge) on(f, x, head[1] - 1, x < head[0] ? C.gold : C.ochre);
  const sxr = Math.round(p.shield[0] - p.shieldR[0] + 0.6);
  for (let y = Math.round(p.shield[1] - p.shieldR[1]); y <= Math.round(p.shield[1] + p.shieldR[1]); y++) if (own(sxr, y) === shieldIdx) put(f, sxr, y, y < p.shield[1] ? C.gold : C.goldDark);
  for (let x = Math.round(hip[0] - 7); x <= Math.round(hip[0] + 7); x++) if (own(x, Math.round(hip[1] - 2.4)) === kiltIdx) put(f, x, hip[1] - 2.4, x % 3 === 0 ? C.goldHi : C.ochre);
  for (const [x, y] of [p.footF, p.footN]) for (let i = -3; i <= 3; i++) put(f, x + i, y, i < 0 ? C.woodDark : C.woodDeep);
  drawSword(f, p.grip, p.swordA, p.swordLen, p.heat, p.sword === 'behind' ? (x, y) => own(x, y) >= 0 : () => false);
  put(f, p.grip[0] + 0.8, p.grip[1] - 0.8, C.rustLight);
  const out = finish(f);
  return fx(out, p, [chest[0] + 7, chest[1] - 6]);
}

/** Effects drawn after the outline: the whirl ring, the cleave arc, dust, sparks. */
function fx(out: Frame, p: P, shN: Pt): Frame {
  if (p.whirl !== null) {
    const cx = 40;
    const cy = FEET - 26 + p.bob;
    const a = p.whirl;
    whirlBlur(out, cx, cy, 36, 11.5, a - 2.9, a - 0.14);
    smear(out, cx, cy, 28, 8.8, a - 2.2, a - 0.3, C.ashGrey, 0.5, 0, 1);
  }
  if (p.arc !== null) {
    const [a0, squash] = p.arc;
    const tip = tipOf(p.grip, p.swordA, p.swordLen);
    const tx = tip[0] - shN[0];
    const ty = tip[1] - shN[1];
    const R = Math.hypot(tx, ty / squash);
    const end = Math.atan2(ty / squash, tx) - 0.06;
    smear(out, shN[0], shN[1], R, R * squash, a0, end, C.hot, 0.9, 150, 3);
    smear(out, shN[0], shN[1], R - 5, (R - 5) * squash, a0 + 0.45, end, C.flame, 0.45, 90);
  }
  if (p.dustAt) dust(out, p.dustAt[0], p.dustAt[1], 5);
  if (p.sparksAt) sparks(out, p.sparksAt[0], p.sparksAt[1], 2.4, 250);
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

/** The low guard: grip ahead of the hip, the blade's point hovering `lift` px over the sand ahead. */
function guard(grip: Pt, lift: number): { grip: Pt; swordA: number; swordLen: number } {
  const dy = FEET - 1 - lift - grip[1];
  const dx = Math.sqrt(Math.max(1, BLADE * BLADE - dy * dy));
  return { grip, swordA: Math.atan2(dy, dx), swordLen: BLADE };
}

const REST: P = {
  bob: 0,
  lean: 0,
  footN: [45, FEET],
  footF: [34, FEET],
  ...guard([53, 56], 1),
  sword: 'front',
  shield: [54, 40.5],
  shieldR: [6.2, 9.2],
  cape: [-9, 36],
  capeW: 6,
  crestSway: 0,
  glow: 0.75,
  sparksAt: null,
  dustAt: null,
  arc: null,
  whirl: null,
  heat: 0.35,
  back: false,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

export function varkusSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) => {
    const b = [0, 0.5, 1, 0.5][i];
    return draw(
      pose({
        bob: b,
        ...guard([53, 56 + b], 1.5 - b),
        shield: [54, 40.5 + b],
        cape: [-9 - [0, 0.6, 1, 0.6][i], 36 - b],
        crestSway: [0, 0.5, 1, 0.5][i],
        glow: [0.7, 0.8, 0.95, 0.8][i],
      }),
    );
  });
  // heavy advance in the guard: the point swaying over the sand, the cape rolling behind
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = (i / 6) * Math.PI * 2;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const b = Math.abs(c) * 1.4;
    return draw(
      pose({
        bob: b,
        lean: 0.6,
        footN: [40 + c * 6.5, FEET - Math.max(0, -s) * 2.8],
        footF: [40 - c * 6.5, FEET - Math.max(0, s) * 2.8],
        ...guard([53.5 - c * 1, 56 + b], 2.5 - b + s * 0.8),
        shield: [54.5 + c * 0.5, 41 + b],
        cape: [-12 - s * 1.5, 34 - b],
        crestSway: 1 + c * 0.6,
        glow: 0.8,
      }),
    );
  });
  // windup: the greatsword climbs high behind the crest, the edge heats to white, the eyes flare
  const windup = [
    draw(pose({ heat: 0.45, lean: -0.3, grip: [52, 40], swordA: -1.2, sword: 'underHead', shield: [49, 46], cape: [-7, 37], crestSway: 0.5, glow: 0.9, footN: [47, FEET] })),
    draw(pose({ heat: 0.7, lean: -0.7, bob: -0.5, grip: [46, 28], swordA: -2.35, sword: 'behind', shield: [50, 47], cape: [-8, 36], crestSway: 1, glow: 1, footN: [48, FEET], footF: [33, FEET] })),
    draw(pose({ heat: 0.9, lean: -0.9, bob: -0.8, grip: [44.5, 26], swordA: -2.55, sword: 'behind', shield: [50.5, 47], cape: [-8.5, 35.5], crestSway: 1.4, glow: 1, footN: [48, FEET], footF: [33, FEET] })),
    draw(pose({ heat: 1, lean: -0.9, bob: -0.6, grip: [44.5, 26.5], swordA: -2.6, sword: 'behind', shield: [50.5, 47.2], cape: [-8.5, 35.5], crestSway: 1.2, glow: 1, footN: [48, FEET], footF: [33, FEET] })),
  ];
  // the cleave: over the top and down into the sand ahead
  const bite = (grip: Pt): { grip: Pt; swordA: number; swordLen: number } => {
    const a = 0.98;
    return { grip, swordA: a, swordLen: Math.min(BLADE, (FEET - 1.5 - grip[1]) / Math.sin(a)) };
  };
  const hit = bite([57, 54]);
  const hitTip = tipOf(hit.grip, hit.swordA, hit.swordLen);
  const attack = [
    draw(pose({ heat: 1, lean: 1, grip: [55, 33], swordA: -0.5, swordLen: BLADE - 2, shield: [47, 48], cape: [-10, 34], crestSway: -0.5, glow: 1, footN: [50, FEET], arc: [-2.3, 0.72] })),
    draw(pose({ heat: 0.85, lean: 1.8, bob: 2, ...hit, shield: [47.5, 50], cape: [-11, 32], crestSway: -1, glow: 1, footN: [51, FEET], sparksAt: [hitTip[0] + 1, FEET - 3], dustAt: [hitTip[0], FEET - 1], arc: [-0.62, 1] })),
    draw(pose({ heat: 0.4, lean: 1.5, bob: 1.6, ...bite([56.5, 54.5]), shield: [47.5, 49.5], cape: [-9, 34], crestSway: -0.6, glow: 0.9, footN: [51, FEET] })),
  ];
  // charge: tucked behind the raised shield, only the burning visor over its rim; the sword trails and scrapes
  const charge = [0, 1, 2, 3].map((i) => {
    const ph = (i / 4) * Math.PI * 2;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const b = [0, 1.2, 0, 1.2][i];
    const lean = 3.8;
    const { head } = body({ ...REST, lean, bob: b + 1 });
    const grip: Pt = [41 - s * 1.5, FEET - 21 + b];
    const tipY = FEET - 1;
    const a = Math.PI - Math.asin(Math.min(1, (tipY - grip[1]) / BLADE));
    return draw(
      pose({
        bob: b + 1,
        lean,
        footN: [46 + c * 9, FEET - Math.max(0, -s) * 3.6],
        footF: [46 - c * 9, FEET - Math.max(0, s) * 3.6],
        grip,
        swordA: a,
        sword: 'behind',
        shield: [head[0] + 4.5, head[1] + 9],
        shieldR: [5.6, 9.4],
        cape: [-25 - [0, 2, 1, 3][i], 12 - [0, 2, 1, 2][i]],
        capeW: 6.5,
        crestSway: 4.5,
        glow: 1,
        heat: 0.35,
        sparksAt: i % 2 === 1 ? tipOf(grip, a, BLADE - 0.5) : null,
        dustAt: s < 0 ? [46 + c * 9 - 5, FEET] : [46 - c * 9 - 5, FEET],
      }),
    );
  });
  // whirl: one full turn — the body turns with the blade (two frames show his back), a burning ring behind the steel
  const whirl = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const back = i === 0 || i === 5;
    const grip: Pt = [40 + c * (c < 0 ? 10 : 12), FEET - 31 + s * 3.4];
    const fore = Math.hypot(c, s * 0.33);
    return draw(
      pose({
        bob: 1,
        lean: back ? 0 : -0.2,
        footN: back ? [44.5, FEET] : [46, FEET],
        footF: back ? [35.5, FEET] : [33, FEET],
        grip,
        swordA: Math.atan2(s * 0.33, c),
        swordLen: 7 + ((c < 0 ? BLADE - 4 : BLADE) - 7) * fore,
        sword: s < -0.1 ? 'behind' : 'front',
        // the shield swings across the body opposite the blade (edge-on from behind)
        shield: back ? [27, FEET - 31] : [42 - c * 5, FEET - 33 - s * 1.5],
        shieldR: back ? [2, 9.4] : [5.8 + Math.abs(s) * 0.8, 9.4],
        cape: back ? [c > 0 ? -6 : 6, 34] : [-c * 16 - 4, 26 + s * 4],
        capeW: 8,
        crestSway: back ? -c * 2 : c * 2,
        glow: 1,
        whirl: a,
        heat: 0.6,
        back,
      }),
    );
  });
  // corpse: down on one knee, leaning on the planted sword; then he falls
  const kneel = pose({ bob: 9, lean: 0.8, footN: [49, FEET], footF: [36, FEET - 1], grip: [55, 56], swordA: 1.5, swordLen: FEET - 57, shield: [45, 60], cape: [-8, 28], glow: 0.4, heat: 0.15 });
  const fallen = pose({ bob: 14, lean: 2.2, footN: [48, FEET], footF: [38, FEET], grip: [62, FEET - 5.5], swordA: 0.08, shield: [51, FEET - 5], shieldR: [7.2, 3.6], cape: [-18, 10], capeW: 7, glow: 0.15, heat: 0 });
  const down = draw(fallen);
  const corpse = [draw(kneel), ashify(down, 0.4, 0.4), ashify(squash(down, 0.8, FEET), 0.85, 0.15)];
  return monsterSprites({
    id: 'varkus',
    anchorX: AX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 4, true),
      move: anim(move, 7, true),
      windup: anim(windup, 5, false),
      attack: anim(attack, 10, false),
      charge: anim(charge, 10, true),
      whirl: anim(whirl, 14, true),
      corpse: anim(corpse, 4, false),
    },
  });
}
