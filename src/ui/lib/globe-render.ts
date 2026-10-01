// Canvas painter for one globe. The glass is a tiny pixel canvas (about a third of the CSS size, scaled up with
// `image-rendering: pixelated`), shaded per pixel into one preallocated ImageData: a layered liquid with a depth
// ramp and dithered bands, an animated meniscus, rising bubbles with embers (Life) or arcane motes (Focus), the
// damage trail, the heal / refill flash, the low-life heartbeat and the empty-Focus flicker, under a precomputed glass
// shell (curved specular, rim, edge shade). All motion decisions come from globe-fx.ts. Nothing allocates per frame.
import {
  EMPTY_FOCUS, applyTarget, createGlobeState, debuffTint, emptyFlicker, hash01, heartbeat, isSettling, lowAmount, stepGlobe, stepTint, waveOffset,
  type GlobeKind, type GlobeState, type Tint,
} from './globe-fx';
import type { PlayerDebuff } from '../../contracts/bestiary';

const SHADES = 7;
/** Liquid ramps, surface (bright) to the deepest layer. */
const RAMP: Record<GlobeKind, readonly number[]> = {
  life: [255, 122, 84, 236, 66, 62, 206, 40, 48, 168, 24, 40, 124, 14, 34, 82, 8, 24, 48, 4, 14],
  focus: [190, 226, 255, 120, 176, 255, 78, 128, 240, 62, 92, 222, 56, 62, 186, 44, 38, 140, 28, 18, 92],
};
const AIR: Record<GlobeKind, readonly number[]> = { life: [28, 12, 14, 10, 5, 7], focus: [10, 14, 32, 5, 7, 16] };
const TRAIL: Record<GlobeKind, readonly number[]> = { life: [255, 150, 148], focus: [196, 170, 255] };
const BUBBLE: Record<GlobeKind, readonly number[]> = { life: [255, 206, 190], focus: [184, 226, 255] };
/** Bayer 4x4 thresholds (0..1) for the pixel-art dithering of the depth bands. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const MAX_P = 10;
const P_BUBBLE = 0;
const P_SPARK = 1;

export class GlobeCanvas {
  readonly state: GlobeState = createGlobeState(0);
  private readonly ctx: CanvasRenderingContext2D | null;
  private img: ImageData | null = null;
  private px: Uint32Array = new Uint32Array(0);
  private n = 0;
  // Static glass layers, rebuilt on resize.
  private mask = new Uint8Array(0);
  private rr = new Float32Array(0);
  private ovA = new Uint8Array(0);
  private ovC = new Uint32Array(0);
  private wy = new Float32Array(0);
  private ty = new Float32Array(0);
  private wb = new Float32Array(0);
  // Particles.
  private readonly pType = new Uint8Array(MAX_P);
  private readonly pX = new Float32Array(MAX_P);
  private readonly pY = new Float32Array(MAX_P);
  private readonly pVx = new Float32Array(MAX_P);
  private readonly pVy = new Float32Array(MAX_P);
  private readonly pAge = new Float32Array(MAX_P);
  private readonly pLife = new Float32Array(MAX_P);
  private readonly pSeed = new Float32Array(MAX_P);
  private rng = 0x2545f491;
  private want: Tint = { r: 0, g: 0, b: 0, amt: 0 };
  private calm = false;
  private raf = 0;
  private last = 0;
  private lastGlow = -1;
  private initialised = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly kind: GlobeKind,
    private readonly onGlow: (glow: number) => void,
  ) {
    this.ctx = canvas.getContext('2d');
    for (let i = 0; i < MAX_P; i++) {
      this.pLife[i] = 0;
      this.pAge[i] = -this.rand() * 2;
      this.pType[i] = this.kind === 'life' ? (i < 5 ? P_BUBBLE : P_SPARK) : i < 4 ? P_BUBBLE : P_SPARK;
    }
  }

  private rand(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  /** Size the pixel canvas for a CSS size (about 3 CSS px per art pixel) and rebuild the glass shell. */
  resize(cssSize: number): void {
    const n = Math.max(24, Math.min(56, Math.round(cssSize / 3)));
    if (n === this.n || !this.ctx) return;
    this.n = n;
    this.canvas.width = n;
    this.canvas.height = n;
    this.img = this.ctx.createImageData(n, n);
    this.px = new Uint32Array(this.img.data.buffer);
    this.mask = new Uint8Array(n * n);
    this.rr = new Float32Array(n * n);
    this.ovA = new Uint8Array(n * n);
    this.ovC = new Uint32Array(n * n);
    this.wy = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.wb = new Float32Array(n);
    this.buildGlass();
    this.draw(true);
  }

  /** The glass shell: rim shade, curved specular arcs, a soft reflection and a hot spot, as alpha + colour per pixel. */
  private buildGlass(): void {
    const n = this.n;
    const c = (n - 1) / 2;
    const R = n / 2;
    const bleed = this.kind === 'life' ? [255, 120, 96] : [120, 170, 255];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const dx = x - c;
        const dy = y - c;
        const d = Math.sqrt(dx * dx + dy * dy);
        const r = d / R;
        this.rr[i] = r * r;
        this.mask[i] = r <= 1.0 ? 1 : 0;
        let a = 0;
        let cr = 255;
        let cg = 255;
        let cb = 255;
        // Edge shade: the glass thickens toward the rim.
        if (r > 0.78) {
          const e = Math.min(1, (r - 0.78) / 0.22);
          a = e * e * 0.78;
          cr = 6;
          cg = 3;
          cb = 5;
        }
        const ang = Math.atan2(dy, dx);
        // Main specular: a curved crescent hugging the upper-left rim.
        const a0 = -2.95;
        const a1 = -1.75;
        if (ang > a0 && ang < a1) {
          const prof = Math.sin(((ang - a0) / (a1 - a0)) * Math.PI);
          const band = Math.abs(d - R * 0.8);
          const thick = 0.7 + prof * (R / 28);
          if (band < thick) {
            const s = Math.min(1, prof * (1 - band / thick) * 1.35);
            if (s > a * 0.9 || a < 0.2) {
              a = Math.max(a * (1 - s), s);
              cr = 255;
              cg = 255;
              cb = 255;
            }
          }
        }
        // Secondary arc low on the opposite side, tinted by the liquid's colour (light bleeding through the glass).
        const b0 = 0.25;
        const b1 = 1.2;
        if (ang > b0 && ang < b1) {
          const prof = Math.sin(((ang - b0) / (b1 - b0)) * Math.PI);
          const band = Math.abs(d - R * 0.84);
          if (band < 0.9) {
            const s = prof * (1 - band / 0.9) * 0.4;
            if (s > a) {
              a = s;
              cr = bleed[0];
              cg = bleed[1];
              cb = bleed[2];
            }
          }
        }
        // Hot spot: a small tilted ellipse upper-left of centre, with a dimmer halo.
        const ex = (dx + R * 0.3) / (R * 0.15);
        const ey = (dy + R * 0.46) / (R * 0.075);
        const ed = ex * 0.88 - ey * 0.47;
        const ee = ex * 0.47 + ey * 0.88;
        const e2 = ed * ed + ee * ee;
        if (e2 < 1) {
          a = 1;
          cr = cg = cb = 255;
        } else if (e2 < 2.4) {
          const s = 0.2;
          if (s > a) {
            a = s;
            cr = cg = cb = 255;
          }
        }
        // A thin bright pixel ring on the outermost edge of the glass keeps the circle crisp against the frame.
        if (r > 0.96 && r <= 1) {
          a = Math.max(a, 0.5);
          cr = 12;
          cg = 8;
          cb = 10;
        }
        this.ovA[i] = Math.round(a * 255);
        this.ovC[i] = (cr | (cg << 8) | (cb << 16)) >>> 0;
      }
    }
  }

  /** The HUD's newest values. `calm` = reduced motion. */
  setInput(fill: number, debuffs: readonly { id: PlayerDebuff }[] | undefined, calm: boolean): void {
    if (!this.initialised) {
      this.initialised = true;
      const f = Math.max(0, Math.min(1, fill));
      this.state.shown = this.state.target = this.state.trail = f;
    } else applyTarget(this.state, fill);
    this.want = debuffTint(this.kind, debuffs);
    if (calm !== this.calm) {
      this.calm = calm;
      this.wake();
    }
    this.wake();
  }

  /** Make sure a frame will be drawn (the loop sleeps when reduced motion has nothing left to animate). */
  wake(): void {
    if (this.raf || typeof document === 'undefined' || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    stepGlobe(this.state, dt);
    stepTint(this.state, this.want, dt);
    this.draw(false, dt);
    // Full motion animates continuously; calm only while the value is still moving.
    if (!this.calm || isSettling(this.state) || this.state.tintAmt !== this.want.amt) this.raf = requestAnimationFrame(this.tick);
  };

  private stepParticles(dt: number): void {
    const n = this.n;
    const c = (n - 1) / 2;
    const R = n / 2;
    const unit = n / 36;
    const s = this.state;
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) {
        this.pAge[i] += dt;
        if (this.pAge[i] < 0) continue;
        // Respawn inside the liquid (only when there is enough of it).
        const surf = n * (1 - s.shown);
        const xs = c + (this.rand() * 2 - 1) * R * 0.66;
        const half = Math.sqrt(Math.max(0, R * R - (xs - c) * (xs - c))) * 0.86;
        const yMax = c + half;
        if (yMax - surf < 5) {
          this.pAge[i] = -0.3;
          continue;
        }
        const type = this.pType[i];
        this.pX[i] = xs;
        this.pSeed[i] = this.rand() * 6.28;
        if (type === P_BUBBLE) {
          this.pY[i] = yMax - this.rand() * 2;
          this.pVy[i] = -(7 + this.rand() * 9) * unit;
          this.pVx[i] = 0;
          this.pLife[i] = 5;
        } else if (this.kind === 'life') {
          // Embers: hotter, faster, short-lived, loosely drifting.
          this.pY[i] = surf + 3 + this.rand() * (yMax - surf - 3);
          this.pVy[i] = -(5 + this.rand() * 7) * unit;
          this.pVx[i] = (this.rand() - 0.5) * 3 * unit;
          this.pLife[i] = 1.6 + this.rand() * 1.8;
        } else {
          // Arcane motes: nearly still, twinkling.
          this.pY[i] = surf + 3 + this.rand() * (yMax - surf - 3);
          this.pVy[i] = -(0.8 + this.rand() * 1.6) * unit;
          this.pVx[i] = (this.rand() - 0.5) * 1.6 * unit;
          this.pLife[i] = 2.2 + this.rand() * 2.4;
        }
        this.pAge[i] = 0;
        continue;
      }
      this.pAge[i] += dt;
      this.pY[i] += this.pVy[i] * dt;
      this.pX[i] += (this.pVx[i] + (this.pType[i] === P_BUBBLE ? Math.sin(this.pAge[i] * 4 + this.pSeed[i]) * 2.2 * unit : 0)) * dt;
      const surf = n * (1 - s.shown);
      if (this.pAge[i] >= this.pLife[i] || this.pY[i] < surf + 1.5) {
        this.pLife[i] = 0;
        this.pAge[i] = -this.rand() * 1.4;
      }
    }
  }

  private draw(force: boolean, dt = 0): void {
    const img = this.img;
    const ctx = this.ctx;
    if (!img || !ctx) return;
    const n = this.n;
    const px = this.px;
    const s = this.state;
    const calm = this.calm;
    const kind = this.kind;
    const t = s.time;
    const life = kind === 'life';
    const ramp = RAMP[kind];
    const air = AIR[kind];
    const tr = TRAIL[kind];
    const unit = n / 36;
    const c = (n - 1) / 2;
    const beat = life ? heartbeat(t, s.shown) : 0;
    const low = life ? lowAmount(s.shown) : 0;
    const empty = !life && s.target <= EMPTY_FOCUS && s.shown <= EMPTY_FOCUS * 2;
    const flick = empty && !calm ? emptyFlicker(t) : empty ? 0.22 : 0;
    const flash = s.flash;
    const sweepY = n - s.sweep * (n + 4);
    const tintAmt = s.tintAmt;
    const trailAmt = Math.min(1, (s.trail - s.shown) * 7);
    const slosh = s.slosh.x;
    const level = n * (1 - s.shown);
    const trailLevel = n * (1 - s.trail);
    const body = Math.max(n * s.shown, 1);
    const shimmerPhase = t * 1.35;

    if (!calm && !force) this.stepParticles(dt);

    for (let x = 0; x < n; x++) {
      const xn = (x - c) / (n / 2);
      const off = waveOffset(xn, t, slosh, n, calm);
      this.wy[x] = level + off;
      this.ty[x] = trailLevel + off * 0.6;
      // A second, slower swell behind the front surface: the liquid reads as a body with layers.
      this.wb[x] = level - 1.7 * unit + waveOffset(xn, t * 0.8 + 2.1, slosh * 0.7, n, calm) * 0.85;
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (this.mask[i] === 0) {
          px[i] = 0;
          continue;
        }
        const rr = this.rr[i];
        const dy = y + 0.5 - this.wy[x];
        let r: number;
        let g: number;
        let b: number;
        if (dy >= 0 && s.shown > 0.003) {
          // ---- liquid ----
          let tt = 0.12 + (dy / body) * 0.52 + rr * 0.3 + ((x + y - 2 * c) / n) * 0.3;
          // Slow caustic sheets drifting through the body, plus a finer shimmer.
          if (!calm) tt += 0.07 * Math.sin((x + y * 0.55) * 0.34 + t * 0.7) + 0.035 * Math.sin(x * 0.55 + y * 0.42 + shimmerPhase);
          // A soft vertical sheen down the lit (left) side gives the liquid a rounded, volumetric body.
          const sx = (x - c) / (n / 2) + 0.58;
          tt -= 0.2 * Math.exp(-(sx * sx) / 0.025);
          if (flash > 0) {
            const band = calm ? 0.4 : Math.max(0, 1 - Math.abs(y - sweepY) * 0.22);
            tt -= flash * (0.1 + band * 0.55);
          }
          if (beat > 0) tt -= beat * 0.24 * (1 - rr);
          if (dy < 1.15) tt = -1;
          else if (dy < 2.3 && tt > 0.14) tt = 0.14;
          let fi = tt * (SHADES - 1) + (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.6;
          if (fi < 0) fi = 0;
          else if (fi > SHADES - 1) fi = SHADES - 1;
          const k = (fi | 0) * 3;
          r = ramp[k];
          g = ramp[k + 1];
          b = ramp[k + 2];
          if (tintAmt > 0) {
            const a = tintAmt * (0.55 + 0.45 * (dy < 2.3 ? 1 : rr));
            r += (s.tintR - r) * a;
            g += (s.tintG - g) * a;
            b += (s.tintB - b) * a;
          }
          if (low > 0) {
            const gray = r * 0.3 + g * 0.59 + b * 0.11;
            const ds = low * (0.12 + rr * 0.85);
            r += (gray - r) * ds;
            g += (gray - g) * ds;
            b += (gray - b) * ds;
            const dark = 1 - low * rr * 0.4;
            r *= dark;
            g *= dark;
            b *= dark;
          }
        } else {
          // ---- empty glass above the liquid ----
          const f = y / n;
          r = air[0] + (air[3] - air[0]) * f;
          g = air[1] + (air[4] - air[1]) * f;
          b = air[2] + (air[5] - air[2]) * f;
          r += rr * 6;
          // The back swell: a darker body of liquid peeking over the front surface, with a bright crest line.
          if (s.shown > 0.02 && y + 0.5 >= this.wb[x]) {
            const crest = y + 0.5 - this.wb[x] < 1.1;
            const k2 = (crest ? 1 : 3) * 3;
            const a2 = crest ? 0.75 : 0.62;
            r += (ramp[k2] - r) * a2;
            g += (ramp[k2 + 1] - g) * a2;
            b += (ramp[k2 + 2] - b) * a2;
          }
          // Light bleeding up from the surface.
          const up = this.wy[x] - (y + 0.5);
          if (up < 6 && s.shown > 0.02) {
            const bl = (1 - up / 6) * 0.34 * Math.min(1, s.shown * 4);
            r += (ramp[3] - r) * bl;
            g += (ramp[4] - g) * bl;
            b += (ramp[5] - b) * bl;
          }
          if (empty) {
            // Empty Focus: the last sparks sputter at the bottom of the glass.
            const bottom = Math.max(0, (y - n * 0.62) / (n * 0.38));
            const spark = hash01(x * 31 + y * 17 + Math.floor(t * 14)) > 0.9 ? 1 : 0;
            const glow = (0.25 + flick * 1.2) * (30 + bottom * 90 + spark * bottom * 260);
            r += glow * 0.45;
            g += glow * 0.6;
            b += glow;
          }
          if (low > 0) {
            const gray = (r + g + b) / 3;
            const ds = low * rr * 0.8;
            r += (gray - r) * ds;
            g += (gray - g) * ds;
            b += (gray - b) * ds;
          }
          // The damage trail: the pale chunk between the old level and the new one.
          if (trailAmt > 0 && y + 0.5 >= this.ty[x]) {
            const edge = y + 0.5 - this.ty[x] < 1.4 ? 1 : 0;
            const a = (0.36 + edge * 0.34) * trailAmt * (calm ? 1 : 0.85 + 0.15 * Math.sin(t * 22 + x * 0.9));
            r += (tr[0] - r) * a;
            g += (tr[1] - g) * a;
            b += (tr[2] - b) * a;
          }
        }
        // Heartbeat glow at the rim (Life, low): the edge flushes red on each beat.
        if (low > 0) {
          const e = (beat * 1.15 + 0.18) * low * rr * rr;
          r += (230 - r) * e;
          g += (30 - g) * e;
          b += (30 - b) * e;
        }
        // Glass shell on top.
        const oa = this.ovA[i];
        if (oa > 0) {
          const oc = this.ovC[i];
          const a = oa / 255;
          r += ((oc & 255) - r) * a;
          g += (((oc >> 8) & 255) - g) * a;
          b += (((oc >> 16) & 255) - b) * a;
        }
        px[i] = (255 << 24) | ((b > 255 ? 255 : b < 0 ? 0 : b | 0) << 16) | ((g > 255 ? 255 : g < 0 ? 0 : g | 0) << 8) | (r > 255 ? 255 : r < 0 ? 0 : r | 0);
      }
    }

    if (!calm) this.drawParticles(t, unit);
    ctx.putImageData(img, 0, 0);

    // The glow that bleeds onto the frame follows the fill, flares with heals and beats with the heart.
    const glow = Math.round((0.12 + s.shown * 0.48 + flash * 0.4 + beat * 0.5 + (empty ? flick * 0.25 : 0)) * 25) / 25;
    if (glow !== this.lastGlow) {
      this.lastGlow = glow;
      this.onGlow(glow);
    }
  }

  private drawParticles(t: number, unit: number): void {
    const n = this.n;
    const px = this.px;
    const life = this.kind === 'life';
    const b = BUBBLE[this.kind];
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i] <= 0) continue;
      const x = Math.round(this.pX[i]);
      const y = Math.round(this.pY[i]);
      if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1 || this.mask[y * n + x] === 0 || this.rr[y * n + x] > 0.72) continue;
      if (y + 0.5 < this.wy[x] + 1.5) continue;
      const f = this.pAge[i] / this.pLife[i];
      if (this.pType[i] === P_BUBBLE) {
        // A bright pixel with a darker shadow pixel: reads as a tiny glass bubble.
        this.blend(x, y, b[0], b[1], b[2], 0.85);
        if (this.pSeed[i] > 3.3) {
          this.blend(x + 1, y, b[0], b[1], b[2], 0.7);
          this.blend(x, y - 1, b[0], b[1], b[2], 0.55);
        }
        this.blend(x, y + 1, 0, 0, 0, 0.25);
      } else if (life) {
        const a = Math.sin(f * Math.PI);
        // Ember: yellow-white core cooling to orange.
        this.blend(x, y, 255, 214 - f * 90, 120 - f * 80, 0.95 * a);
        this.blend(x, y - 1, 255, 130, 40, 0.35 * a);
      } else {
        const tw = 0.5 + 0.5 * Math.sin(t * 5 + this.pSeed[i] * 3);
        const a = Math.sin(f * Math.PI) * (0.35 + tw * 0.65);
        this.blend(x, y, 214, 200, 255, a);
        if (tw > 0.82) {
          this.blend(x - 1, y, 160, 190, 255, a * 0.55);
          this.blend(x + 1, y, 160, 190, 255, a * 0.55);
          this.blend(x, y - 1, 160, 190, 255, a * 0.55);
          this.blend(x, y + 1, 160, 190, 255, a * 0.55);
        }
      }
    }
  }

  private blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const i = y * this.n + x;
    const p = this.px[i];
    if (p === 0 || a <= 0) return;
    const pr = p & 255;
    const pg = (p >> 8) & 255;
    const pb = (p >> 16) & 255;
    const nr = pr + (r - pr) * a;
    const ng = pg + (g - pg) * a;
    const nb = pb + (b - pb) * a;
    this.px[i] = (255 << 24) | ((nb > 255 ? 255 : nb | 0) << 16) | ((ng > 255 ? 255 : ng | 0) << 8) | (nr > 255 ? 255 : nr | 0);
  }
}

