// World tiles: 16x16, several variant frames per sprite. The presenter picks a variant per cell (e.g. by hashing
// the cell coordinates), so every floor variant must fit next to every other variant of its theme without a
// visible seam. Two rules make that true (Wang-style edge constraints):
//
//   • Ports. Stone joints and basalt fissures cross the tile border only at fixed port columns (top and bottom
//     edges) and rows (left and right edges) per theme, and run straight for at least two pixels on either side.
//     Inside the tile each variant wires the ports to its own junctions, so stones span tile borders and the 16 px
//     grid disappears. The forge's lava-vein decals leave the tile at the forge ports (PORT_X / PORT_Y), where they
//     cool into the neighbouring fissures.
//   • Shared-border noise. `wangNoise` is value noise whose lattice points on the tile border are identical in
//     every variant (only interior lattice points vary), so tone and texture are continuous across any pairing.
//
// Floors stay calm (low-contrast network, cloud and grain, no specks, no glow) so actors read on top of them; larger
// features (sand drifts, rime, iron plates and grates, veins, bones) are sparse detail decals.
//
//   tile/<theme>/floor   opaque ground, 8 variants
//   tile/<theme>/detail  transparent decals scattered sparsely over the floor (< ~10% of cells), 8 variants
//   tile/<theme>/edge    the crumbling rim of the arena: floor fragments with transparent gaps, 8 variants
import type { SpriteDef } from '../contracts/art';
import type { Rng } from '../contracts/rng';
import { createRng, hashString } from '../core/rng';
import { Frame, toSprite } from './frame';
import { C, RAMPS, type Color, type Ramp } from './palette';
import { forPolygon, lineCells } from './raster';
import { hash2, quantize, valueNoise } from './shade';

export const TILE = 16;
const VARIANTS = 8;

/** Columns where joints cross the top and bottom edges, and rows where they cross the left and right edges. */
export const PORT_X: readonly number[] = [5, 11];
export const PORT_Y: readonly number[] = [7];

type Pt = [number, number];

// ---------------------------------------------------------------------------
// Seamless-between-variants noise
// ---------------------------------------------------------------------------

/**
 * Smooth value noise in [0, 1) with a 16 px period whose border lattice points are shared by all variants. The
 * shared values are pulled towards the mean (`edgeAmp`), so thresholded features (moss, frost, sand) grow from the
 * per-variant interior points and never repeat at the same border spot in every tile. `cell` must divide 16.
 */
export function wangNoise(x: number, y: number, cell: number, seed: number, variant: number, edgeAmp = 0.3): number {
  const n = TILE / cell;
  const lat = (i: number, j: number): number => {
    const ii = ((i % n) + n) % n;
    const jj = ((j % n) + n) % n;
    if (ii === 0 || jj === 0) return 0.5 + (hash2(ii, jj, seed) - 0.5) * edgeAmp;
    return hash2(ii, jj, seed * 131 + (variant + 1) * 7919);
  };
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = lat(ix, iy);
  const b = lat(ix + 1, iy);
  const c = lat(ix, iy + 1);
  const d = lat(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---------------------------------------------------------------------------
// Joint networks
// ---------------------------------------------------------------------------

/** Where joints may cross the border: columns on the top/bottom edges, rows on the left/right edges. */
interface PortSet {
  x: readonly number[];
  y: readonly number[];
}

/** Ember-forge fissures and lava veins share these ports. */
export const FORGE_PORTS: PortSet = { x: PORT_X, y: PORT_Y };

/** Joint mask that is also defined one pixel outside the tile, where only the port stubs are joints. */
class Joints {
  readonly m = new Uint8Array(TILE * TILE);

  constructor(readonly ports: PortSet) {}

  at(x: number, y: number): boolean {
    const inX = x >= 0 && x < TILE;
    const inY = y >= 0 && y < TILE;
    if (inX && inY) return this.m[y * TILE + x] === 1;
    if (inX) return this.ports.x.includes(x);
    if (inY) return this.ports.y.includes(y);
    return false;
  }

  set(x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < TILE && y < TILE) this.m[y * TILE + x] = 1;
  }

  line(a: Pt, b: Pt): void {
    lineCells(a[0], a[1], b[0], b[1], (x, y) => this.set(x, y));
  }
}

interface NetOpts {
  ports: PortSet;
  /** Number of interior junctions [min, max]. */
  junctions: [number, number];
  /** Perpendicular wobble of joint segments (px). */
  jitter: number;
  /** Minimum Manhattan distance between junctions. */
  gap: number;
  /** Length of the straight stub each port joint runs before it may turn [min, max] (≥ 2). */
  stub: [number, number];
  /** Chance that a port joint is worn away after its stub instead of reaching a junction (bigger, merged stones). */
  worn: number;
}

interface Port {
  edge: Pt; // pixel on the border
  inward: Pt; // unit step into the tile
  dir: 'v' | 'h';
}

function portList(set: PortSet): Port[] {
  const out: Port[] = [];
  for (const x of set.x) {
    out.push({ edge: [x, 0], inward: [0, 1], dir: 'v' });
    out.push({ edge: [x, TILE - 1], inward: [0, -1], dir: 'v' });
  }
  for (const y of set.y) {
    out.push({ edge: [0, y], inward: [1, 0], dir: 'h' });
    out.push({ edge: [TILE - 1, y], inward: [-1, 0], dir: 'h' });
  }
  return out;
}

const stubEnd = (p: Port, len: number): Pt => [p.edge[0] + p.inward[0] * len, p.edge[1] + p.inward[1] * len];

const clampIn = (v: number): number => Math.max(3, Math.min(TILE - 4, Math.round(v)));

/** A wobbly segment: split once or twice with a perpendicular offset, clamped away from the tile border. */
function wobble(J: Joints, a: Pt, b: Pt, jitter: number, rng: Rng): void {
  if (jitter <= 0) return J.line(a, b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = len > 7 ? 2 : 1;
  const nx = -(b[1] - a[1]) / (len || 1);
  const ny = (b[0] - a[0]) / (len || 1);
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const o = rng.range(-jitter, jitter);
    const p: Pt = [clampIn(a[0] + (b[0] - a[0]) * t + nx * o), clampIn(a[1] + (b[1] - a[1]) * t + ny * o)];
    J.line(prev, p);
    prev = p;
  }
  J.line(prev, b);
}

/**
 * Build one variant's joint network: a few interior junctions, every port wired to a nearby junction (or worn away
 * after its stub), and the junctions chained together by a spanning tree.
 */
function network(rng: Rng, o: NetOpts): Joints {
  const J = new Joints(o.ports);
  const want = rng.int(o.junctions[0], o.junctions[1]);
  const js: Pt[] = [];
  for (let guard = 0; js.length < want && guard < 400; guard++) {
    const p: Pt = [rng.int(4, TILE - 5), rng.int(4, TILE - 5)];
    if (js.every((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) >= o.gap)) js.push(p);
  }
  if (js.length === 0) js.push([8, 8]);
  const all = portList(o.ports);
  // never wear away every port: a tile needs some joints reaching its junctions
  const keep = rng.int(0, all.length - 1);
  all.forEach((port, i) => {
    const s = stubEnd(port, rng.int(o.stub[0], o.stub[1]));
    J.line(port.edge, s);
    if (i !== keep && rng.chance(o.worn)) return;
    const j = js
      .map((q) => ({ q, d: Math.hypot(q[0] - s[0], q[1] - s[1]) + rng.range(0, 3) }))
      .sort((a, b) => a.d - b.d)[0].q;
    wobble(J, s, j, o.jitter, rng);
  });
  // spanning tree over the junctions (Prim), shortest links first
  const inTree = [js[0]];
  const rest = js.slice(1);
  while (rest.length) {
    let best = { a: inTree[0], bi: 0, d: Infinity };
    for (const a of inTree) {
      rest.forEach((b, bi) => {
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d < best.d) best = { a, bi, d };
      });
    }
    const b = rest.splice(best.bi, 1)[0];
    wobble(J, best.a, b, o.jitter, rng);
    inTree.push(b);
  }
  return J;
}

/** 4-connected regions of non-joint pixels. Returns the label map and which labels touch the tile border. */
function regions(J: Joints): { label: Int16Array; border: Set<number>; count: number } {
  const label = new Int16Array(TILE * TILE).fill(-1);
  const border = new Set<number>();
  let count = 0;
  for (let i = 0; i < TILE * TILE; i++) {
    if (J.m[i] || label[i] >= 0) continue;
    const stack = [i];
    label[i] = count;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % TILE;
      const y = (p / TILE) | 0;
      if (x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1) border.add(count);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= TILE || ny >= TILE) continue;
        const q = ny * TILE + nx;
        if (J.m[q] || label[q] >= 0) continue;
        label[q] = count;
        stack.push(q);
      }
    }
    count++;
  }
  return { label, border, count };
}

// ---------------------------------------------------------------------------
// Floor shading
// ---------------------------------------------------------------------------

interface FloorStyle {
  ramp: Ramp;
  /** Ramp position of a stone face. */
  base: number;
  /** Lift on the lit (top/left) lip of a stone and drop on its shadowed (bottom/right) lip, in ramp steps. */
  lit: number;
  shade: number;
  /** Smooth cloud amplitude and per-pixel grain amplitude (ramp steps, peak-to-peak). */
  cloud: number;
  grain: number;
  /** Tone spread of stones that lie wholly inside the tile (stones crossing the border keep tone 0). */
  toneSpread: number;
  /** Joint network; omitted for jointless ground (sand). */
  net?: NetOpts;
  /** Joint colour at (x, y). */
  joint: (x: number, y: number, v: number) => Color;
  /** Optional per-pixel override after shading (moss, rime, rust...). */
  over?: (f: Frame, x: number, y: number, v: number, isJoint: boolean, pos: number) => void;
  /** Optional pass over the finished tile with access to the joint network (rivets...). */
  post?: (f: Frame, J: Joints, v: number) => void;
  seed: number;
}

function floorTile(st: FloorStyle, v: number): Frame {
  const rng = createRng(hashString(`floor/${st.seed}`) + v * 977);
  const J = st.net ? network(rng, st.net) : new Joints({ x: [], y: [] });
  const { label, border, count } = regions(J);
  const tone = Array.from({ length: count }, (_, i) => (border.has(i) ? 0 : rng.range(-st.toneSpread, st.toneSpread)));
  const f = new Frame(TILE, TILE);
  const n = st.ramp.length;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      if (J.m[i]) {
        f.c.set(x, y, st.joint(x, y, v));
        st.over?.(f, x, y, v, true, 0);
        continue;
      }
      let p = st.base + tone[label[i]];
      p += (wangNoise(x, y, 8, st.seed, v) * 0.65 + wangNoise(x, y, 4, st.seed + 1, v) * 0.35 - 0.5) * st.cloud * 2;
      p += (hash2(x, y, st.seed * 7 + v) - 0.5) * st.grain;
      if (J.at(x, y - 1) || J.at(x - 1, y)) p += st.lit;
      if (J.at(x, y + 1) || J.at(x + 1, y)) p -= st.shade;
      const idx = Math.max(1, quantize(p, x, y, n, 0.1));
      f.c.set(x, y, st.ramp[idx]);
      st.over?.(f, x, y, v, false, p);
    }
  }
  st.post?.(f, J, v);
  return f;
}

// --- hideout: warm, worn flagstones with moss creeping through the joints ------------------------------------

const HIDEOUT: FloorStyle = {
  ramp: RAMPS.flag,
  base: 2.15,
  lit: 0.55,
  shade: 0.55,
  cloud: 0.45,
  grain: 0.35,
  toneSpread: 0.4,
  net: { ports: { x: [4, 11], y: [6] }, junctions: [2, 3], jitter: 1.3, gap: 6, stub: [2, 4], worn: 0.25 },
  joint: (x, y) => (hash2(x, y, 31) > 0.55 ? C.flagDark : C.flagDeep),
  seed: 11,
};

// --- ashen forge: dark basalt column tops split by thin cooled fissures --------------------------------------

const FORGE: FloorStyle = {
  ramp: RAMPS.basalt,
  base: 1.9,
  lit: 0.45,
  shade: 0.35,
  cloud: 0.5,
  grain: 0.35,
  toneSpread: 0.3,
  net: { ports: FORGE_PORTS, junctions: [2, 3], jitter: 0.6, gap: 5, stub: [2, 3], worn: 0.3 },
  joint: () => C.basaltDeep,
  seed: 23,
};

// --- rimed ossuary: large cold crypt slabs, rime settling into the joints -----------------------------

const OSSUARY: FloorStyle = {
  ramp: RAMPS.oss,
  base: 1.85,
  lit: 0.5,
  shade: 0.5,
  cloud: 0.35,
  grain: 0.3,
  toneSpread: 0.35,
  net: { ports: { x: [7], y: [9] }, junctions: [1, 3], jitter: 0.7, gap: 7, stub: [2, 4], worn: 0.1 },
  joint: (x, y) => (hash2(x, y, 41) > 0.7 ? C.ossDark : C.ossDeep),
  over: (f, x, y, v, isJoint) => {
    // rime settles into a few interior joints; bigger frost patches are detail decals
    if (!isJoint || Math.min(x, y, TILE - 1 - x, TILE - 1 - y) < 3) return;
    if (wangNoise(x, y, 4, 909, v, 0.1) > 0.66) f.c.set(x, y, C.ossMid);
  },
  seed: 37,
};

// --- iron coliseum: packed arena sand; the iron (plates, grates, chains) lies in it as detail decals ----------

const COLISEUM: FloorStyle = {
  ramp: [C.sandDeep, C.sandDark, C.sandDim, C.sandMid, C.sand],
  base: 1.7,
  lit: 0,
  shade: 0,
  cloud: 0.6,
  grain: 0.18,
  toneSpread: 0,
  joint: () => C.sandDeep,
  over: (f, x, y, v) => {
    // the odd pebble, lit from the top-left
    if (hash2(x, y, 1011 + v) > 0.988 && x > 0 && y > 0) {
      f.c.set(x, y, C.sandDeep);
      f.c.set(x - 1, y - 1, C.sandMid);
    }
  },
  seed: 53,
};

// Sister maps have their own masonry and inlays; all keep the shared tile ports.
const CHAPEL: FloorStyle = { ...HIDEOUT, base: 1.7, seed: 71,
  net: { ports: { x: [4, 12], y: [8] }, junctions: [1, 2], jitter: 0.3, gap: 7, stub: [3, 4], worn: 0.1 } };
const CRYPT: FloorStyle = { ...OSSUARY, seed: 83, grain: 0.15, over: undefined,
  ramp: [C.ossDeep, C.ossDark, C.ossMid, C.voidMid, C.ossPale, C.ossFrost],
  net: { ports: { x: [8], y: [4, 12] }, junctions: [1, 2], jitter: 0.3, gap: 7, stub: [3, 4], worn: 0.15 } };
const WORKS: FloorStyle = { ...FORGE, ramp: RAMPS.metal, base: 2, seed: 97,
  net: { ports: { x: [4, 12], y: [4, 12] }, junctions: [1, 2], jitter: 0, gap: 6, stub: [3, 3], worn: 0 },
  joint: () => C.metalDeep,
  over: (f, x, y, v) => {
    if ((x === 3 || x === 13) && (y === 3 || y === 13)) f.c.set(x, y, C.metalLight);
    if (x > 3 && x < 13 && y > 3 && y < 13 && wangNoise(x, y, 4, 733, v) > 0.66) f.c.set(x, y, C.rustDark);
  },
};

const floors = {
  cinderChapel: (v: number) => floorTile(CHAPEL, v),
  choralCrypt: (v: number) => floorTile(CRYPT, v),
  chainworks: (v: number) => floorTile(WORKS, v),
  hideout: (v: number) => floorTile(HIDEOUT, v),
  ashenForge: (v: number) => floorTile(FORGE, v),
  rimedOssuary: (v: number) => floorTile(OSSUARY, v),
  ironColiseum: (v: number) => floorTile(COLISEUM, v),
};

// ---------------------------------------------------------------------------
// Detail decals
// ---------------------------------------------------------------------------

/** Carved groove: dark cut with a lit lower-right lip (the light comes from the top-left). */
function groove(f: Frame, x: number, y: number, cut: Color, lip: Color): void {
  f.c.set(x, y, cut);
  if (!f.c.opaque(x + 1, y + 1)) f.c.set(x + 1, y + 1, lip);
}

/** An Archimedean spiral traced densely; `fn` gets each pixel once, from the centre outwards. */
function spiral(cx: number, cy: number, turns: number, r1: number, squash: number, fn: (x: number, y: number, t: number) => void): void {
  const seen = new Set<number>();
  const steps = Math.ceil(turns * 90);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = 0.6 + t * r1;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r * squash);
    const k = y * 64 + x;
    if (seen.has(k)) continue;
    seen.add(k);
    fn(x, y, t);
  }
}

function hideoutDetail(v: number): Frame {
  const rng = createRng(hashString('hideout/detail') + v);
  const f = new Frame(TILE, TILE);
  switch (v) {
    case 0: // candle stub in a puddle of wax, tiny flame
      f.c.set(6, 12, C.bone);
      f.c.set(7, 12, C.ashGrey);
      f.c.set(8, 12, C.bone);
      f.c.set(9, 12, C.stoneLight);
      f.c.set(7, 10, C.parchment);
      f.c.set(8, 10, C.bone);
      f.c.set(7, 11, C.bone);
      f.c.set(8, 11, C.ashGrey);
      f.glow(7, 9, C.hot, 255);
      f.glow(7, 8, C.flame, 220);
      f.c.plot(10, 12, C.flagDeep, 0.6);
      break;
    case 1: // carved ember-spiral, the groove still faintly warm at its heart
      spiral(8, 8, 1.75, 5.4, 0.8, (x, y, t) => {
        if (t < 0.18) f.glow(x, y, C.lavaDark, 120);
        else groove(f, x, y, C.flagDeep, C.flagHi);
      });
      break;
    case 2: // moss tuft
      for (let i = 0; i < 16; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.next()) * 3.4;
        const x = Math.round(8 + Math.cos(a) * r);
        const y = Math.round(9 + Math.sin(a) * r * 0.7);
        f.c.set(x, y, r < 1.5 ? C.olive : rng.pick([C.mossDark, C.moss, C.moss]));
      }
      f.c.set(7, 7, C.oliveLight);
      break;
    case 3: // scattered bone bits
      f.c.set(4, 6, C.bone);
      f.c.set(5, 6, C.ashGrey);
      f.c.set(6, 7, C.bone);
      f.c.set(10, 10, C.bone);
      f.c.set(11, 10, C.parchment);
      f.c.set(12, 10, C.bone);
      f.c.set(11, 11, C.stoneLight);
      break;
    case 4: // spilled ash
      for (let i = 0; i < 18; i++) {
        const x = 4 + Math.round(rng.next() * 8);
        const y = 6 + Math.round(rng.next() * 5);
        f.c.plot(x, y, rng.pick([C.stone, C.stoneLight, C.iron]), 0.8);
      }
      break;
    case 5: // strewn straw
      for (let i = 0; i < 6; i++) {
        const x = rng.int(3, 11);
        const y = rng.int(5, 11);
        const len = rng.int(2, 3);
        for (let k = 0; k < len; k++) f.c.set(x + k, y + (k === len - 1 && i % 2 ? 1 : 0), k === 0 ? C.strawLight : C.straw);
      }
      break;
    case 6: // pebbles
      for (const [x, y] of [[4, 5], [9, 7], [12, 11], [6, 12]]) {
        f.c.set(x, y, C.stoneLight);
        f.c.set(x + 1, y, C.stone);
        f.c.set(x, y + 1, C.iron);
      }
      break;
    default: // a long hairline crack across the stone
      lineCells(3, 4, 12, 11, (x, y) => {
        if (hash2(x, y, 7) > 0.15) f.c.set(x + (y % 3 === 0 ? 1 : 0), y, C.flagDeep);
      });
  }
  return f;
}

/**
 * A glowing lava vein between two ports: hottest in the middle, cooling to a dark fissure where it leaves the tile
 * (so it reads as continuing into the neighbouring floor's fissures). Deliberately dim and red: ember orange is
 * reserved for monsters, projectiles and loot.
 */
function lavaVein(f: Frame, rng: Rng, a: Port, b: Port, branch: boolean): void {
  const pts: Pt[] = [];
  const sa = stubEnd(a, 2);
  const sb = stubEnd(b, 2);
  const mid: Pt = [clampIn((sa[0] + sb[0]) / 2 + rng.range(-3, 3)), clampIn((sa[1] + sb[1]) / 2 + rng.range(-3, 3))];
  const route: Pt[] = [a.edge, sa, mid, sb, b.edge];
  for (let i = 0; i + 1 < route.length; i++) {
    lineCells(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1], (x, y) => {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
    });
  }
  const heat = (t: number): number => Math.pow(Math.sin(Math.PI * t), 0.6);
  const paint = (x: number, y: number, h: number): void => {
    if (h < 0.22) f.c.set(x, y, C.basaltDeep);
    else if (h < 0.45) f.glow(x, y, C.lavaDeep, 100);
    else if (h < 0.93) f.glow(x, y, h > 0.7 ? C.lavaDark : C.blood, 120 + 50 * h);
    else f.glow(x, y, C.ember, 165);
  };
  pts.forEach(([x, y], i) => {
    const h = heat(i / (pts.length - 1));
    paint(x, y, h);
    // the hot stretch is two pixels wide: a darker crust on the shadow side
    if (h > 0.6 && !f.e.opaque(x + 1, y + 1) && !f.e.opaque(x + 1, y)) f.glow(x + 1, y, C.lavaDeep, 95);
  });
  if (branch) {
    const i0 = Math.floor(pts.length * rng.range(0.35, 0.6));
    let [x, y] = pts[i0];
    const dx = rng.chance(0.5) ? 1 : -1;
    const len = rng.int(3, 5);
    for (let k = 1; k <= len; k++) {
      x += dx;
      if (rng.chance(0.5)) y += rng.chance(0.5) ? 1 : -1;
      if (x < 1 || y < 1 || x > TILE - 2 || y > TILE - 2 || f.c.opaque(x, y)) break;
      paint(x, y, 0.75 * (1 - k / (len + 1)));
    }
  }
}

function forgeDetail(v: number): Frame {
  const rng = createRng(hashString('ashenForge/detail') + v);
  const f = new Frame(TILE, TILE);
  const P = portList(FORGE_PORTS);
  const top = P.filter((p) => p.dir === 'v' && p.edge[1] === 0);
  const bottom = P.filter((p) => p.dir === 'v' && p.edge[1] === TILE - 1);
  const left = P.find((p) => p.dir === 'h' && p.edge[0] === 0)!;
  const right = P.find((p) => p.dir === 'h' && p.edge[0] === TILE - 1)!;
  switch (v) {
    case 0:
      lavaVein(f, rng, top[0], bottom[1], true);
      break;
    case 1:
      lavaVein(f, rng, left, right, true);
      break;
    case 2:
      lavaVein(f, rng, top[1], left, false);
      break;
    case 3:
      lavaVein(f, rng, bottom[0], right, true);
      break;
    case 4: // ash drift
      for (let i = 0; i < 26; i++) {
        const x = 3 + Math.round(rng.next() * 10);
        const y = 7 + Math.round(rng.next() * 4 - Math.abs(x - 8) * 0.2);
        f.c.plot(x, y, rng.pick([C.stone, C.iron, C.stoneLight]), 0.85);
      }
      break;
    case 5: // cooled slag chunk
      f.c.set(6, 8, C.basaltHi);
      f.c.set(7, 8, C.stone);
      f.c.set(8, 8, C.basaltLight);
      f.c.set(9, 8, C.basalt);
      f.c.set(6, 9, C.basaltLight);
      f.c.set(7, 9, C.basaltLight);
      f.c.set(8, 9, C.basalt);
      f.c.set(9, 9, C.basaltDark);
      f.c.set(7, 10, C.basaltDark);
      f.c.set(8, 10, C.basaltDeep);
      f.c.plot(10, 10, C.ink, 0.6);
      break;
    case 6: // a scatter of cooled obsidian shards
      for (const [x, y] of [[5, 6], [9, 9], [11, 5]]) {
        f.c.set(x, y, C.basaltHi);
        f.c.set(x + 1, y, C.voidDark);
        f.c.set(x, y + 1, C.voidDeep);
        f.c.set(x + 1, y + 1, C.ink);
      }
      break;
    default: // charred bones
      f.c.set(5, 8, C.stone);
      f.c.set(6, 8, C.stoneLight);
      f.c.set(7, 9, C.stone);
      f.c.set(8, 10, C.iron);
      f.c.set(10, 7, C.stoneLight);
      f.c.set(11, 7, C.stone);
      f.c.set(11, 8, C.iron);
  }
  return f;
}

/** One ice shard: `h` px tall, leaning -1/0/1, lit facet on the left, glowing tip. */
function iceShard(f: Frame, x: number, base: number, h: number, lean: number): void {
  for (let i = 0; i < h; i++) {
    const t = i / Math.max(1, h - 1);
    const sx = x + Math.round(lean * t * (h / 3));
    const top = i === h - 1;
    f.glow(sx, base - i, top ? C.white : t > 0.5 ? C.ice : C.frost, 110 + 80 * t);
    if (!top) f.glow(sx + 1, base - i, t > 0.5 ? C.frost : C.frostMid, 90);
  }
}

function ossuaryDetail(v: number): Frame {
  const rng = createRng(hashString('rimedOssuary/detail') + v);
  const f = new Frame(TILE, TILE);
  switch (v) {
    case 0:
    case 1: {
      // a small cluster of ice shards growing out of a crack
      const shards: [number, number, number][] = v === 0 ? [[5, 3, -1], [8, 6, 0], [11, 4, 1]] : [[6, 5, -1], [9, 3, 1]];
      for (const [x, h, lean] of shards) iceShard(f, x, 12, h, lean);
      for (let x = 4; x <= 12; x++) if (!f.c.opaque(x, 13)) f.c.plot(x, 13, C.ossDeep, 0.7);
      break;
    }
    case 2: // scattered bones
      lineCells(4, 9, 9, 7, (x, y) => f.c.set(x, y, C.bone));
      f.c.set(3, 9, C.parchment);
      f.c.set(3, 10, C.bone);
      f.c.set(10, 7, C.parchment);
      f.c.set(10, 6, C.bone);
      f.c.set(11, 11, C.ashGrey);
      f.c.set(12, 11, C.bone);
      break;
    case 3: // a drift of settled rime with a few glittering crystals
      drift(f, [C.ossMid, C.ossLight, C.ossPale, C.ossFrost], 8, 8.5, 6.5, 4.5, 1300);
      for (let i = 0; i < 3; i++) {
        const x = rng.int(5, 11);
        const y = rng.int(6, 10);
        if (f.c.opaque(x, y)) f.glow(x, y, C.ice, 90);
      }
      break;
    case 4: { // skull
      const sk = ['.###.', '#####', '#.#.#', '#####', '.#.#.'];
      sk.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && f.c.set(6 + x, 5 + y, x < 2 ? C.parchment : y > 2 ? C.ashGrey : C.bone)));
      f.c.set(7, 7, C.ossDeep);
      f.c.set(9, 7, C.ossDeep);
      f.c.plot(6, 10, C.ossDeep, 0.7);
      f.c.plot(10, 10, C.ossDeep, 0.7);
      break;
    }
    case 5: // a grave marker cut into the slab: a carved ring around a cross, rimed at the centre
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        groove(f, Math.round(8 + Math.cos(a) * 4.5), Math.round(8 + Math.sin(a) * 3.6), C.ossDeep, C.ossLight);
      }
      for (let k = -2; k <= 2; k++) {
        groove(f, 8 + k, 8, C.ossDeep, C.ossLight);
        groove(f, 8, 8 + k, C.ossDeep, C.ossLight);
      }
      f.glow(8, 8, C.frost, 80);
      break;
    case 6: // shattered ice chunks
      for (const [x, y] of [[5, 8], [10, 6], [9, 11]]) {
        f.c.set(x, y, C.ice);
        f.c.set(x + 1, y, C.frost);
        f.c.set(x, y + 1, C.frostMid);
        f.c.set(x + 1, y + 1, C.frostDark);
      }
      break;
    default: {
      // a frozen puddle: dark ice with a lit sheen along its upper-left and a single crack
      for (let y = 4; y <= 13; y++) {
        for (let x = 2; x <= 14; x++) {
          const d = Math.hypot((x + 0.5 - 8) / 5.8, (y + 0.5 - 9) / 3.4) + (valueNoise(x, y, 3, 1310) - 0.5) * 0.3;
          if (d > 1) continue;
          const sheen = (x - 8) * 0.12 + (y - 9) * 0.25;
          f.c.set(x, y, d > 0.85 ? C.ossDark : sheen < -0.9 ? C.frostMid : sheen < 0.1 ? C.frostDark : C.frostDeep);
        }
      }
      for (const [x, y] of [[5, 7], [6, 7], [7, 6]]) f.c.set(x, y, C.ossFrost);
      lineCells(6, 11, 10, 8, (x, y) => f.c.opaque(x, y) && f.c.set(x, y, C.ossPale));
      lineCells(10, 8, 12, 9, (x, y) => f.c.opaque(x, y) && f.c.set(x, y, C.ossLight));
    }
  }
  return f;
}

/**
 * A soft mound (drifted sand, settled rime): shaded from a lit upper-left slope to a darker foot, with a feathered,
 * dithered fringe so it melts into whatever floor variant lies beneath. Stays one pixel inside the tile.
 */
function drift(f: Frame, ramp: readonly Color[], cx: number, cy: number, rx: number, ry: number, seed: number): void {
  for (let y = 1; y < TILE - 1; y++) {
    for (let x = 1; x < TILE - 1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = Math.hypot(dx, dy) + (valueNoise(x, y, 3, seed) - 0.5) * 0.55;
      if (d > 1) continue;
      if (d > 0.78 && (x + y) % 2 === 0) continue;
      if (d > 0.9 && hash2(x, y, seed) > 0.35) continue;
      const slope = -(dx * 0.55 + dy * 0.85);
      const k = 0.6 + (1 - d) * 2.2 + slope * 0.9 + (hash2(x, y, seed + 1) - 0.5) * 0.5;
      f.c.set(x, y, ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(k)))]);
    }
  }
}

function coliseumDetail(v: number): Frame {
  const rng = createRng(hashString('ironColiseum/detail') + v);
  const f = new Frame(TILE, TILE);
  const sand = [C.sandDeep, C.sandDark, C.sandMid, C.sand, C.sandLight];
  const metal = RAMPS.metal;
  switch (v) {
    case 0: {
      // a riveted deck plate sunk into the sand, rust eating its lower edge
      const quad: Pt[] = [[2, 4], [13, 2], [14, 12], [3, 14]];
      forPolygon(quad, (x, y) => {
        const u = (x - 2) / 12;
        const w = (y - 2) / 12;
        let k = 3.2 - u * 0.8 - w * 1.2 + (hash2(x, y, 1270) - 0.5) * 0.6;
        const rust = valueNoise(x, y, 3, 1271) + w * 0.5;
        f.c.set(x, y, rust > 1.05 ? (rust > 1.2 ? C.rustDark : C.rust) : metal[Math.max(1, Math.min(4, Math.round(k)))]);
      });
      // lit top edge, dark lip on the bottom/right, seam and rivets
      lineCells(2, 4, 13, 2, (x, y) => f.c.set(x, y, C.metalHi));
      lineCells(13, 2, 14, 12, (x, y) => f.c.set(x, y, C.metalDark));
      lineCells(14, 12, 3, 14, (x, y) => f.c.set(x, y, C.metalDeep));
      lineCells(8, 3, 9, 13, (x, y) => f.c.set(x, y, C.metalDeep));
      for (const [x, y] of [[4, 5], [11, 4], [5, 12], [12, 11], [7, 8], [10, 8]]) {
        f.c.set(x, y, C.metalHi);
        f.c.set(x + 1, y + 1, C.metalDark);
      }
      drift(f, sand.slice(0, 4), 5, 14.5, 5, 2.2, 1272);
      break;
    }
    case 1: {
      // an iron drain grate: frame lit on the top-left, bars over darkness
      for (let y = 4; y <= 12; y++) {
        for (let x = 3; x <= 13; x++) {
          const frame = x === 3 || x === 13 || y === 4 || y === 12;
          if (frame) f.c.set(x, y, x === 3 || y === 4 ? C.metalLight : C.metalDark);
          else f.c.set(x, y, x % 2 === 1 ? (y === 5 ? C.metalHi : C.metalMid) : y === 5 ? C.coal : C.ink);
        }
      }
      f.c.set(3, 4, C.metalHi);
      f.c.set(13, 12, C.metalDeep);
      for (const [x, y] of [[4, 5], [12, 5], [4, 11], [12, 11]]) f.c.set(x, y, C.rust);
      for (let x = 3; x <= 13; x++) if (hash2(x, 13, 1280) > 0.4) f.c.set(x, 13, C.sandDeep);
      break;
    }
    case 2:
    case 3: {
      // drifts of arena sand, a wind ripple across the crest
      const [cx, cy, rx, ry] = v === 2 ? [8, 8, 7, 4.5] : [7.5, 9, 6, 4];
      drift(f, sand, cx, cy, rx, ry, 1200 + v);
      for (let x = Math.round(cx - rx * 0.5); x <= Math.round(cx + rx * 0.4); x++) {
        const y = Math.round(cy - 0.5 + Math.sin(x * 0.9 + v) * 0.6);
        if (f.c.get(x, y) === C.sand || f.c.get(x, y) === C.sandLight) f.c.set(x, y, C.sandMid);
      }
      if (v === 3) {
        // a bone poking out of the drift
        f.c.set(10, 7, C.bone);
        f.c.set(11, 6, C.parchment);
        f.c.set(11, 7, C.ashGrey);
      }
      break;
    }
    case 4: // dried blood
      for (let i = 0; i < 18; i++) {
        const t = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.next()) * 4;
        f.c.plot(Math.round(8 + Math.cos(t) * r), Math.round(8 + Math.sin(t) * r * 0.6), rng.chance(0.3) ? C.blood : C.rustDeep, 0.85);
      }
      break;
    case 5: // a broken blade
      lineCells(3, 11, 11, 5, (x, y) => f.c.set(x, y, C.metalLight));
      lineCells(4, 11, 12, 5, (x, y) => f.c.set(x, y, C.metalMid));
      f.c.set(11, 4, C.metalHi);
      f.c.set(2, 12, C.woodDark);
      f.c.set(3, 12, C.wood);
      f.c.set(2, 11, C.goldDark);
      f.c.set(4, 12, C.goldDark);
      break;
    case 6: // a dented helm half-sunk in the sand
      drift(f, sand.slice(0, 4), 8, 11, 5, 2.4, 1260);
      for (const [x, y, c] of [
        [6, 8, C.metalLight], [7, 8, C.metalHi], [8, 8, C.metalLight], [9, 8, C.metalMid],
        [5, 9, C.metalMid], [6, 9, C.metalLight], [7, 9, C.metalMid], [8, 9, C.metal], [9, 9, C.metal], [10, 9, C.metalDark],
        [5, 10, C.metal], [6, 10, C.ink], [7, 10, C.ink], [8, 10, C.metalDark], [9, 10, C.metalDark], [10, 10, C.metalDeep],
        [7, 7, C.rust],
      ] as [number, number, Color][]) f.c.set(x, y, c);
      break;
    default: {
      // a chain run out from an iron anchor ring set in the ground
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = Math.round(5 + Math.cos(a) * 2.5);
        const y = Math.round(9 + Math.sin(a) * 2);
        f.c.set(x, y, a > Math.PI ? C.metalLight : C.metalDark);
      }
      f.c.set(5, 9, C.ink);
      for (let i = 0; i < 4; i++) {
        const x = 8 + i * 2;
        const y = 8 - (i % 2);
        f.c.set(x, y, C.metalLight);
        f.c.set(x + 1, y, C.metal);
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------------------
// Edges: crumbling fragments of each theme's floor with transparent gaps
// ---------------------------------------------------------------------------

/**
 * Broken ground for the arena rim: irregular chunks of the floor with abyss between them. The fracture face (the
 * dark lip below every chunk, seen from the elevated camera) makes the chunks read as slabs, whatever side of the
 * arena the tile sits on.
 */
function edgeTile(floor: (v: number) => Frame, theme: string, v: number, dark: Color, face: Color): Frame {
  const rng = createRng(hashString(`${theme}/edge`) + v);
  const src = floor(v);
  const f = new Frame(TILE, TILE);
  const bias = 0.5 + (v % 4) * 0.035;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = valueNoise(x, y, 5, 300 + v) * 0.75 + hash2(x, y, 320 + v) * 0.25;
      if (n < bias) continue;
      f.c.set(x, y, src.c.get(x, y));
      f.e.set(x, y, src.e.get(x, y));
    }
  }
  // fracture faces: two rows below every chunk edge, darkest at the bottom
  for (let y = TILE - 1; y >= 0; y--) {
    for (let x = 0; x < TILE; x++) {
      if (!f.c.opaque(x, y) || f.c.opaque(x, y + 1)) continue;
      if (y + 1 < TILE && src.c.opaque(x, y + 1)) {
        f.c.set(x, y + 1, face);
        if (y + 2 < TILE && !f.c.opaque(x, y + 2)) f.c.set(x, y + 2, dark);
      }
    }
  }
  // a few loose pebbles tumbling into the gaps
  for (let i = 0; i < 3; i++) {
    const x = rng.int(1, 14);
    const y = rng.int(2, 14);
    if (!f.c.opaque(x, y)) f.c.set(x, y, face);
  }
  return f;
}

/** Small ritual inlays, choir staves and hauling chains, separate from the original floor decals. */
function sisterDetail(theme: 'chapel' | 'crypt' | 'works', v: number): Frame {
  const f = new Frame(TILE, TILE);
  const shift = v % 3 - 1;
  if (theme === 'chapel') {
    // Broken diamond altar mosaics and spilled candle wax.
    const points: Pt[] = [[8, 2 + shift], [13, 8], [8, 13 - shift], [3, 8], [8, 2 + shift]];
    for (let i = 1; i < points.length; i++) lineCells(...points[i - 1], ...points[i], (x, y) => {
      if (hash2(x, y, v + 51) > 0.2) groove(f, x, y, C.flagDeep, C.ochre);
    });
    f.c.set(7 + shift, 7, C.bone); f.c.set(7 + shift, 8, C.parchment);
  } else if (theme === 'crypt') {
    for (let y = 4; y <= 12; y += 2) lineCells(3, y, 12, y + shift, (x, yy) => groove(f, x, yy, C.ossDeep, C.ossLight));
    // A bone note hanging from each carved stave.
    for (let k = 0; k < 3; k++) { const x = 4 + k * 3; const y = 5 + (v + k) % 5;
      f.c.set(x, y, C.bone); f.c.set(x + 1, y, C.ashGrey); f.c.set(x + 1, y - 1, C.bone);
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const x = 3 + k * 4, y = 4 + k * 3 + shift;
      lineCells(x, y, x + 3, y, (xx, yy) => f.c.set(xx, yy, C.metalLight));
      lineCells(x, y + 2, x + 3, y + 2, (xx, yy) => f.c.set(xx, yy, C.rust));
      f.c.set(x, y + 1, C.metalMid); f.c.set(x + 3, y + 1, C.metalDark);
    }
  }
  return f;
}

export function tileSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const spec = { anchorX: 0, anchorY: 0, fps: 0, loop: false };
  const themes: [string, (v: number) => Frame, (v: number) => Frame, Color, Color][] = [
    ['hideout', floors.hideout, hideoutDetail, C.flagDeep, C.flagDark],
    ['ashenForge', floors.ashenForge, forgeDetail, C.ink, C.basaltDeep],
    ['rimedOssuary', floors.rimedOssuary, ossuaryDetail, C.ossDeep, C.ossDark],
    ['ironColiseum', floors.ironColiseum, coliseumDetail, C.metalDeep, C.sandDeep],
    ['cinderChapel', floors.cinderChapel, v => sisterDetail('chapel', v), C.flagDeep, C.flagDark],
    ['choralCrypt', floors.choralCrypt, v => sisterDetail('crypt', v), C.ossDeep, C.ossDark],
    ['chainworks', floors.chainworks, v => sisterDetail('works', v), C.metalDeep, C.rustDeep],
  ];
  const range = [...Array(VARIANTS).keys()];
  for (const [theme, floor, detail, dark, face] of themes) {
    out.push(toSprite(`tile/${theme}/floor`, range.map(floor), spec));
    out.push(toSprite(`tile/${theme}/detail`, range.map(detail), spec));
    out.push(toSprite(`tile/${theme}/edge`, range.map((v) => edgeTile(floor, theme, v, dark, face)), spec));
  }
  return out;
}
