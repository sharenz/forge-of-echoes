// The floor: a cached 16 px tile grid per zone (theme + arena radius). Every cell gets a floor variant from a
// deterministic hash, a low-frequency brightness mottle (so the floor never reads as a repeating grid), sparse
// detail decals and, in the Ashen Forge, continuous lava veins: the forge's vein decals leave their tile at fixed
// ports (see src/art/tiles.ts), so a walk that chains matching ports draws glowing fissures meandering across
// many tiles. The arena rim is crumbling edge tiles, then a few loose chunks tumbling into the abyss.
//
// Also owned here: static light pools (dim coloured light scattered over the floor), the vein glow lights, the
// abyss underglow and a faint haze rising from it. Everything is built once per zone in build(); the per-frame
// methods only read typed arrays.
import type { Theme } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { createRng, hashString } from '../core/rng';
import type { FrameCtx } from './context';
import { clamp01, hash01, hash2, smoothstep, TAU, valueNoise } from './math';
import type { Pen } from './pen';
import { THEME_LOOKS } from './themes';

export const TILE = 16;
const FLOOR = 1;
const EDGE = 2;
const DEBRIS = 3;
const NO_DETAIL = 255;
/** Share of plain floor cells that get a (non-vein) detail decal. */
const DETAIL_CHANCE = 0.065;
const VEIN_LIGHT: RGB = [0.95, 0.24, 0.06];

// Forge vein ports (tile-local): variant → which borders it connects. Walks run towards the lower left:
//   entry T5  → v0 (T5–B11) → next cell below, entry T11
//   entry T11 → v2 (T11–L7) → next cell left,  entry R7
//   entry R7  → v1 (L7–R7)  → next cell left,  entry R7   or   v3 (B5–R7) → next cell below, entry T5
const ENTRY_T5 = 0;
const ENTRY_T11 = 1;
const ENTRY_R7 = 2;

export class Ground {
  private theme: Theme = 'hideout';
  private radius = 0;
  /** Half extent in cells; the grid spans cells [-n, n) on both axes. */
  private n = 0;
  private size = 0;
  private cellKind = new Uint8Array(0);
  private floorVar = new Uint8Array(0);
  private detailVar = new Uint8Array(0);
  /** 1 = the detail decal is mirrored (forge veins walking down-right). */
  private detailFlip = new Uint8Array(0);
  private shade = new Uint8Array(0);
  private floorId = 'tile/hideout/floor';
  private detailId = 'tile/hideout/detail';
  private edgeId = 'tile/hideout/edge';
  /** Vein glow lights: x, y, phase per light. */
  private veinLights = new Float32Array(0);
  private veinLightCount = 0;
  /** Light pools: x, y, radius, colour index, intensity. */
  private pools = new Float32Array(0);
  private poolCount = 0;
  /** Abyss glow lights: x, y. */
  private abyss = new Float32Array(0);
  private abyssCount = 0;
  private readonly tint: [number, number, number] = [1, 1, 1];
  /** Tint of the non-glowing detail decals (the theme's `detail` brightness). */
  private readonly detailTint: [number, number, number] = [1, 1, 1];

  get builtFor(): string {
    return `${this.theme}:${this.radius}`;
  }

  build(theme: Theme, radius: number): void {
    this.theme = theme;
    this.radius = radius;
    this.floorId = `tile/${theme}/floor`;
    this.detailId = `tile/${theme}/detail`;
    this.edgeId = `tile/${theme}/edge`;
    const R = Math.max(64, radius);
    const n = Math.ceil((R + 80) / TILE) + 1;
    const size = n * 2;
    this.n = n;
    this.size = size;
    const cells = size * size;
    this.cellKind = new Uint8Array(cells);
    this.floorVar = new Uint8Array(cells);
    this.detailVar = new Uint8Array(cells).fill(NO_DETAIL);
    this.detailFlip = new Uint8Array(cells);
    this.shade = new Uint8Array(cells);
    const look = THEME_LOOKS[theme];
    this.detailTint[0] = look.detail;
    this.detailTint[1] = look.detail;
    this.detailTint[2] = look.detail;
    const seed = hashString(`ground:${theme}`) ^ Math.round(R);
    const [mLo, mHi] = look.mottle;

    for (let cy = -n; cy < n; cy++) {
      for (let cx = -n; cx < n; cx++) {
        const i = (cy + n) * size + (cx + n);
        const mx = cx * TILE + TILE / 2;
        const my = cy * TILE + TILE / 2;
        const d = Math.hypot(mx, my);
        const h = hash2(cx, cy, seed);
        this.floorVar[i] = h & 7;
        let kind = 0;
        if (d < R - 6) kind = FLOOR;
        else if (d < R + 18) kind = EDGE;
        else if (d < R + 64) {
          // Loose chunks, thinning out with depth into the abyss.
          const t = (d - (R + 18)) / 46;
          if (hash01(cx, cy, seed + 17) < 0.42 * (1 - t)) kind = DEBRIS;
        }
        this.cellKind[i] = kind;
        // Brightness: low-frequency mottle, darker towards the rim, deep chunks darker still.
        let b = mLo + (mHi - mLo) * (valueNoise(cx, cy, 7, seed + 3) * 0.75 + valueNoise(cx, cy, 2, seed + 5) * 0.25);
        b *= 1 - 0.22 * smoothstep(clamp01((d - (R - 90)) / 90));
        b *= look.floor;
        if (kind === DEBRIS) b *= 0.62 - 0.35 * clamp01((d - (R + 18)) / 46);
        this.shade[i] = Math.round(clamp01(b) * 255);
        if (kind === FLOOR && theme !== 'ashenForge' && hash01(cx, cy, seed + 29) < DETAIL_CHANCE) {
          this.detailVar[i] = (h >>> 8) & 7;
        }
      }
    }

    // Forge: lava vein walks, plus the non-vein details (ash, slag, obsidian, bones) sprinkled sparsely.
    const veinLights: number[] = [];
    if (theme === 'ashenForge') {
      const rng = createRng(seed + 101);
      const walks = Math.round((Math.PI * R * R) / 50000);
      for (let w = 0; w < walks; w++) {
        const a = rng.range(0, TAU);
        const r = Math.sqrt(rng.next()) * (R - 40);
        let cx = Math.floor((Math.cos(a) * r) / TILE);
        let cy = Math.floor((Math.sin(a) * r) / TILE);
        let entry = rng.int(0, 2);
        const len = rng.int(3, 11);
        // Mirrored walks run down-right: every tile of the walk is drawn flipped, so its ports still chain.
        const flip = rng.chance(0.5);
        const side = flip ? 1 : -1;
        for (let k = 0; k < len; k++) {
          const i = this.index(cx, cy);
          if (i < 0 || this.cellKind[i] !== FLOOR || this.detailVar[i] !== NO_DETAIL) break;
          let variant: number;
          let nx = cx;
          let ny = cy;
          let next: number;
          if (entry === ENTRY_T5) {
            variant = 0;
            ny++;
            next = ENTRY_T11;
          } else if (entry === ENTRY_T11) {
            variant = 2;
            nx += side;
            next = ENTRY_R7;
          } else if (rng.chance(0.55)) {
            variant = 1;
            nx += side;
            next = ENTRY_R7;
          } else {
            variant = 3;
            ny++;
            next = ENTRY_T5;
          }
          this.detailVar[i] = variant;
          this.detailFlip[i] = flip ? 1 : 0;
          if (k % 2 === 0) veinLights.push(cx * TILE + 8, cy * TILE + 8, rng.range(0, 10));
          cx = nx;
          cy = ny;
          entry = next;
        }
      }
      for (let cy = -n; cy < n; cy++) {
        for (let cx = -n; cx < n; cx++) {
          const i = (cy + n) * size + (cx + n);
          if (this.cellKind[i] !== FLOOR || this.detailVar[i] !== NO_DETAIL) continue;
          if (hash01(cx, cy, seed + 31) < 0.04) this.detailVar[i] = 4 + (hash2(cx, cy, seed + 37) & 3);
        }
      }
    }
    this.veinLights = Float32Array.from(veinLights);
    this.veinLightCount = veinLights.length / 3;

    // Light pools on a jittered grid (deterministic per zone).
    const pools: number[] = [];
    const spacing = 230;
    const g = Math.ceil(R / spacing);
    for (let gy = -g; gy <= g; gy++) {
      for (let gx = -g; gx <= g; gx++) {
        const h1 = hash01(gx, gy, seed + 51);
        const h2 = hash01(gx, gy, seed + 53);
        const px = (gx + (h1 - 0.5) * 0.8) * spacing;
        const py = (gy + (h2 - 0.5) * 0.8) * spacing;
        if (Math.hypot(px, py) > R - 50) continue;
        if (hash01(gx, gy, seed + 55) < 0.25) continue;
        const [r0, r1] = look.poolRadius;
        pools.push(px, py, r0 + (r1 - r0) * hash01(gx, gy, seed + 57), hash2(gx, gy, seed + 59) % look.pools.length,
          look.poolIntensity * (0.7 + 0.6 * hash01(gx, gy, seed + 61)));
      }
    }
    this.pools = Float32Array.from(pools);
    this.poolCount = pools.length / 5;

    // Abyss underglow ring.
    const ring = R + 70;
    const count = Math.max(8, Math.round((TAU * ring) / 150));
    const abyss: number[] = [];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU;
      abyss.push(Math.cos(a) * ring, Math.sin(a) * ring);
    }
    this.abyss = Float32Array.from(abyss);
    this.abyssCount = count;
  }

  private index(cx: number, cy: number): number {
    const n = this.n;
    if (cx < -n || cy < -n || cx >= n || cy >= n) return -1;
    return (cy + n) * this.size + (cx + n);
  }

  /** Is the world point on walkable-looking floor (not rim/abyss)? */
  isFloor(x: number, y: number): boolean {
    const i = this.index(Math.floor(x / TILE), Math.floor(y / TILE));
    return i >= 0 && this.cellKind[i] === FLOOR;
  }

  draw(pen: Pen, f: FrameCtx): void {
    const r = pen.r;
    const v = f.view;
    const tx0 = Math.floor(v.x0 / TILE) - 1;
    const tx1 = Math.floor(v.x1 / TILE) + 1;
    const ty0 = Math.floor(v.y0 / TILE) - 1;
    const ty1 = Math.floor(v.y1 / TILE) + 1;
    const n = this.n;
    const size = this.size;
    const tint = this.tint;
    const blackout = f.world.run.events.some(e => e.kind === 'blackout' && e.phase !== 'complete' && e.phase !== 'failed' && e.phase !== 'available');
    const kinds = this.cellKind;
    const shade = this.shade;
    const floorVar = this.floorVar;
    const detail = this.detailVar;
    const dflip = this.detailFlip;
    // Forge lava veins (variants 0–3) glow: the tint would dim their emissive mask too, so only the rest recede.
    const veins = this.theme === 'ashenForge' ? 4 : 0;
    const detailTint = this.detailTint;
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < -n || ty >= n) continue;
      const row = (ty + n) * size;
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx < -n || tx >= n) continue;
        const i = row + tx + n;
        const kind = kinds[i];
        if (kind === 0) continue;
        const b = shade[i] / 255 * (blackout ? 0.8 : 1);
        tint[0] = b;
        tint[1] = b;
        tint[2] = b;
        const o = pen.sprite('ground');
        o.tint = tint;
        const x = tx * TILE;
        const y = ty * TILE;
        if (kind === FLOOR) {
          r.sprite(this.floorId, floorVar[i], x, y, o);
          const dv = detail[i];
          if (dv !== NO_DETAIL) {
            const od = pen.sprite('decal');
            if (dflip[i]) od.flipX = true;
            if (dv >= veins) od.tint = detailTint;
            // Tiles anchor at their top-left: a mirrored tile pivots on its right edge, one tile further right.
            r.sprite(this.detailId, dv, dflip[i] ? x + TILE : x, y, od);
          }
        } else {
          r.sprite(this.edgeId, floorVar[i], x, y, o);
        }
      }
    }
  }

  /** Static lights for the visible area (pools, vein glows, the abyss underglow) and the abyss haze. */
  lightsAndHaze(pen: Pen, f: FrameCtx): void {
    const v = f.view;
    const look = f.look;
    const p = this.pools;
    for (let k = 0; k < this.poolCount; k++) {
      const o = k * 5;
      const rad = p[o + 2];
      const x = p[o];
      const y = p[o + 1];
      if (x + rad < v.x0 || x - rad > v.x1 || y + rad < v.y0 || y - rad > v.y1) continue;
      pen.light(x, y, rad, look.pools[p[o + 3]], p[o + 4], 0.08);
    }
    const vl = this.veinLights;
    for (let k = 0; k < this.veinLightCount; k++) {
      const o = k * 3;
      const x = vl[o];
      const y = vl[o + 1];
      if (x + 40 < v.x0 || x - 40 > v.x1 || y + 40 < v.y0 || y - 40 > v.y1) continue;
      const pulse = 0.8 + 0.2 * Math.sin(f.time * 1.3 + vl[o + 2]);
      pen.light(x, y, 38, VEIN_LIGHT, 0.42 * pulse, 0.45);
    }
    const ab = this.abyss;
    const r = pen.r;
    for (let k = 0; k < this.abyssCount; k++) {
      const x = ab[k * 2];
      const y = ab[k * 2 + 1];
      if (x + 150 < v.x0 || x - 150 > v.x1 || y + 150 < v.y0 || y - 150 > v.y1) continue;
      const breathe = 0.85 + 0.15 * Math.sin(f.time * 0.7 + k);
      pen.light(x, y, 130, look.abyssGlow, look.abyssGlowIntensity * breathe, 0.25);
      // Haze rising out of the depths: a very faint additive glow, so the abyss has depth instead of flat black.
      const o = pen.sprite('fx');
      o.additive = true;
      o.tint = look.abyssGlow;
      o.alpha = 0.07 * breathe;
      o.scale = 6;
      o.emissive = 0.6;
      o.sortY = y - 400;
      r.sprite('fx/glow', 0, x * 1.06, y * 1.06, o);
    }
  }
}
