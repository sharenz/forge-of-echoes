// Follow camera: smooth spring towards the local player plus a slight look-ahead towards the aim, anchored to the
// player's *snapped* position (see src/render/index.ts) so the most-watched sprite never vibrates; trauma-based
// screen shake with smooth noise (scaled by the setting, damped while a menu is open); directional kicks; and a
// short "hold" (hit-stop feel) that freezes the follow for big moments.
import type { Camera } from '../contracts/render';
import { approach, clamp, snapToPixel } from './math';

/** Look-ahead: fraction of the aim offset, capped in world units. */
const LOOK_AHEAD = 0.16;
const LOOK_AHEAD_MAX = 34;
/** Spring rate (1/s) of the follow target. */
const FOLLOW_RATE = 6.5;
/** Faster catch-up when far behind (teleports, blinks). */
const SNAP_DISTANCE = 260;
/** Max shake offset in world units at full trauma. */
const SHAKE_MAX = 7;
const TRAUMA_DECAY = 1.7;
const KICK_DECAY = 18;

export class CameraRig {
  readonly camera: Camera = { x: 0, y: 0, zoom: 1, shakeX: 0, shakeY: 0 };
  /** Smoothed follow point (world). */
  private fx = 0;
  private fy = 0;
  private trauma = 0;
  private kickX = 0;
  private kickY = 0;
  private hold = 0;
  private t = 0;
  private readonly seeds = [Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100];

  /** Jump to (x, y) with no easing (zone change). */
  reset(x: number, y: number): void {
    this.fx = x;
    this.fy = y;
    this.trauma = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.hold = 0;
    this.camera.x = x;
    this.camera.y = y;
    this.camera.shakeX = 0;
    this.camera.shakeY = 0;
  }

  /** Current shake trauma (0..1). */
  get traumaLevel(): number {
    return this.trauma;
  }

  /** Add shake trauma (0..1; stacks, capped at 1). */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A directional jolt (world units) that springs back quickly — player hits, heavy impacts. */
  kick(dx: number, dy: number): void {
    this.kickX += dx;
    this.kickY += dy;
  }

  /** Freeze the follow for `seconds` (hit-stop feel on big moments). */
  holdFor(seconds: number): void {
    this.hold = Math.max(this.hold, seconds);
  }

  /**
   * Advance the rig. (px, py) is the followed player's rendered position, (ax, ay) the aim point. `shakeScale` is
   * the user's screen-shake setting (0..1).
   */
  update(dt: number, px: number, py: number, ax: number, ay: number, shakeScale: number, paused: boolean): Camera {
    this.t += dt;
    // Look-ahead towards the aim, capped.
    let lx = (ax - px) * LOOK_AHEAD;
    let ly = (ay - py) * LOOK_AHEAD;
    const ll = Math.hypot(lx, ly);
    if (ll > LOOK_AHEAD_MAX) {
      lx *= LOOK_AHEAD_MAX / ll;
      ly *= LOOK_AHEAD_MAX / ll;
    }
    const tx = px + lx;
    const ty = py + ly - 6; // frame the body, not the feet
    if (this.hold > 0) this.hold = Math.max(0, this.hold - dt);
    else {
      const far = Math.hypot(tx - this.fx, ty - this.fy);
      const rate = far > SNAP_DISTANCE ? FOLLOW_RATE * 4 : FOLLOW_RATE;
      const k = approach(rate, dt);
      this.fx += (tx - this.fx) * k;
      this.fy += (ty - this.fy) * k;
    }
    const cam = this.camera;
    const z = cam.zoom;
    // Camera = snapped player + smoothed lag (fractional), so the player sprite is rock-steady on screen.
    cam.x = snapToPixel(px, z) + (this.fx - px);
    cam.y = snapToPixel(py, z) + (this.fy - py);

    // Shake: trauma² with smooth multi-sine noise (no per-frame white noise judder).
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    const k = approach(KICK_DECAY, dt);
    this.kickX -= this.kickX * k;
    this.kickY -= this.kickY * k;
    const scale = clamp(shakeScale, 0, 1) * (paused ? 0.25 : 1);
    const s = this.trauma * this.trauma * SHAKE_MAX * scale;
    const t = this.t;
    const sd = this.seeds;
    cam.shakeX = s * (Math.sin(t * 43 + sd[0]) * 0.6 + Math.sin(t * 71 + sd[1]) * 0.4) + this.kickX * scale;
    cam.shakeY = s * (Math.sin(t * 47 + sd[2]) * 0.6 + Math.sin(t * 67 + sd[3]) * 0.4) + this.kickY * scale;
    return cam;
  }
}
