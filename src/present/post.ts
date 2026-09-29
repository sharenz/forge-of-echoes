// Post-processing state: timed screen flashes (optionally delayed to land on a sound's impact), chromatic
// kicks, cosmetic slow-motion (particles and effects slow down; the authoritative world does not), the local
// player's death desaturation and a low-life pulse. Produces the renderer's PostFx each frame.
import type { PostFx, RGB } from '../contracts/render';
import { approach, clamp01 } from './math';
import type { ThemeLook } from './themes';

const FLASH_CAP = 8;

export class PostState {
  private readonly delay = new Float32Array(FLASH_CAP);
  private readonly age = new Float32Array(FLASH_CAP);
  private readonly life = new Float32Array(FLASH_CAP);
  private readonly peak = new Float32Array(FLASH_CAP);
  private readonly col = new Float32Array(FLASH_CAP * 3);
  private next = 0;
  private chroma = 0;
  private slowLeft = 0;
  private slowScale = 1;
  private deathK = 0;
  private readonly flashColor: [number, number, number] = [0, 0, 0];
  private readonly flashOut = { color: this.flashColor as RGB, alpha: 0 };
  private readonly out: PostFx = { bloom: 1, vignette: 0.5, flash: undefined, saturation: 1, chromatic: 0, exposure: 1 };
  /** Callbacks fired when a delayed flash lands (hit-stop / shake timed to a sound). */
  private readonly pending: { at: number; fn: () => void }[] = [];
  private clock = 0;

  /**
   * Zone change: clear slow-mo, chromatic kicks, the death grade and pending callbacks. Running flashes are kept on
   * purpose (they fade out within a second): the portal flash of the step through carries over into the new zone.
   */
  reset(): void {
    this.chroma = 0;
    this.slowLeft = 0;
    this.slowScale = 1;
    this.deathK = 0;
    this.pending.length = 0;
  }

  /** Full-screen flash: `alpha` peak fading over `life` seconds, starting after `delay`. */
  flash(color: RGB, alpha: number, life: number, delay = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % FLASH_CAP;
    this.delay[i] = delay;
    this.age[i] = 0;
    this.life[i] = life;
    this.peak[i] = alpha;
    this.col[i * 3] = color[0];
    this.col[i * 3 + 1] = color[1];
    this.col[i * 3 + 2] = color[2];
  }

  chromatic(amount: number): void {
    this.chroma = Math.max(this.chroma, amount);
  }

  /** Slow cosmetic time to `scale` for `seconds` (real time). */
  slowMo(scale: number, seconds: number): void {
    this.slowScale = Math.min(this.slowScale, scale);
    this.slowLeft = Math.max(this.slowLeft, seconds);
  }

  /** Run `fn` after `delay` seconds of real time (used to land big moments on a sound's impact). */
  after(delay: number, fn: () => void): void {
    if (delay <= 0) fn();
    else this.pending.push({ at: this.clock + delay, fn });
  }

  /** Cosmetic time scale for this frame. */
  get timeScale(): number {
    return this.slowLeft > 0 ? this.slowScale : 1;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.pending.length) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        if (this.clock >= p.at) {
          this.pending.splice(i, 1);
          p.fn();
        }
      }
    }
    for (let i = 0; i < FLASH_CAP; i++) {
      if (!(this.life[i] > 0)) continue;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.life[i] = 0;
    }
    this.chroma = Math.max(0, this.chroma - dt * 2.2);
    if (this.slowLeft > 0) {
      this.slowLeft -= dt;
      if (this.slowLeft <= 0) this.slowScale = 1;
    }
  }

  /**
   * Build the frame's PostFx. `dead` desaturates towards grey over ~1.2 s; `lowLife` (0..1, 1 = critical)
   * adds a slow red heartbeat.
   */
  build(look: ThemeLook, dt: number, dead: boolean, lowLife: number, time: number): PostFx {
    this.deathK += ((dead ? 1 : 0) - this.deathK) * approach(dead ? 1.6 : 4, dt);
    let fa = 0;
    const fc = this.flashColor;
    fc[0] = 0;
    fc[1] = 0;
    fc[2] = 0;
    for (let i = 0; i < FLASH_CAP; i++) {
      if (!(this.life[i] > 0) || this.delay[i] > 0) continue;
      const t = this.age[i] / this.life[i];
      const a = this.peak[i] * (1 - t) * (1 - t);
      if (a <= 0) continue;
      // Accumulate as a weighted average colour with summed alpha.
      const w = a / (fa + a);
      fc[0] += (this.col[i * 3] - fc[0]) * w;
      fc[1] += (this.col[i * 3 + 1] - fc[1]) * w;
      fc[2] += (this.col[i * 3 + 2] - fc[2]) * w;
      fa += a;
    }
    if (lowLife > 0 && !dead) {
      const beat = Math.pow(Math.max(0, Math.sin(time * 5.2)), 6) * 0.1 * lowLife;
      if (beat > 0.002) {
        const w = beat / (fa + beat);
        fc[0] += (0.6 - fc[0]) * w;
        fc[1] += (0.02 - fc[1]) * w;
        fc[2] += (0.02 - fc[2]) * w;
        fa += beat;
      }
    }
    const o = this.out;
    const d = this.deathK;
    o.bloom = look.bloom * (1 - 0.3 * d);
    o.vignette = look.vignette + 0.25 * d + 0.12 * clamp01(lowLife);
    o.saturation = look.saturation * (1 - 0.85 * d);
    o.exposure = look.exposure * (1 - 0.18 * d);
    o.chromatic = Math.min(1, this.chroma);
    if (fa > 0.002) {
      this.flashOut.alpha = Math.min(0.6, fa);
      o.flash = this.flashOut;
    } else o.flash = undefined;
    return o;
  }
}
