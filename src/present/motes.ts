// Echo motes (XP orbs): bobbing glowing orbs; once magnetised they streak towards the player.
//
// The streak comes from the mote's measured on-screen velocity (rendered position frame to frame over real time),
// never from prev → current: on the network path those two snapshots are several ticks apart, which would stretch
// every streak into a laser. Streaks are clamped, and a slot that jumped (reused for a new mote) gets none.
// A pile of motes on one spot (a boss's XP nobody walked over yet) is thinned per 32-unit cell — one light, the
// first few orbs at full glow, the rest progressively dimmer — so it reads as a heap of orbs, not a white sun.
import type { RGB } from '../contracts/render';
import { C } from './colors';
import { LIGHT_CAPS, type FrameCtx } from './context';
import { ImpactHeat } from './heat';
import type { Pen } from './pen';

const SCALE = [0.6, 0.8, 1.1];
const STREAK: RGB = [0.5, 0.78, 1];
/** Streak length = speed × this (seconds), clamped. */
const STREAK_TIME = 0.03;
const STREAK_MAX = 16;
/** Faster than this (units/s) counts as magnetised. */
const MOVING_SPEED = 45;
/** A rendered jump larger than this between frames is a new mote in a reused slot. */
const JUMP = 48;

export class MotePainter {
  private cap = 0;
  private lastX = new Float32Array(0);
  private lastY = new Float32Array(0);
  /** Frame number the slot was last drawn on (0 = never). */
  private lastFrame = new Uint32Array(0);
  private frameNo = 0;
  /** Motes drawn per 32-unit cell this frame (the frame number is the cache's clock). */
  private readonly cells = new ImpactHeat(0);

  reset(): void {
    this.lastFrame.fill(0);
  }

  draw(pen: Pen, f: FrameCtx): void {
    const m = f.world.motes;
    const r = pen.r;
    const v = f.view;
    const a = f.alpha;
    const time = f.time;
    const lights = f.lights;
    const cap = m.capacity;
    if (cap > this.cap) {
      this.cap = cap;
      this.lastX = new Float32Array(cap);
      this.lastY = new Float32Array(cap);
      this.lastFrame = new Uint32Array(cap);
    }
    const frame = ++this.frameNo;
    const invDt = f.dt > 1e-4 ? 1 / f.dt : 0;
    // Hundreds of motes converging (the post-clear vacuum) must not fuse into one white blob: dim with count.
    const crowd = Math.min(1, 70 / Math.max(1, m.count));
    for (let i = 0; i < cap; i++) {
      if (!m.alive[i]) continue;
      const x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
      const y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
      if (x < v.x0 - 10 || x > v.x1 + 10 || y < v.y0 - 10 || y > v.y1 + 10) {
        this.lastFrame[i] = 0;
        continue;
      }
      let vx = 0;
      let vy = 0;
      if (this.lastFrame[i] === frame - 1) {
        const dx = x - this.lastX[i];
        const dy = y - this.lastY[i];
        if (dx * dx + dy * dy < JUMP * JUMP) {
          vx = dx * invDt;
          vy = dy * invDt;
        }
      }
      this.lastX[i] = x;
      this.lastY[i] = y;
      this.lastFrame[i] = frame;
      const size = m.size[i] < 3 ? m.size[i] : 2;
      const speed = Math.hypot(vx, vy);
      const moving = speed > MOVING_SPEED;
      const bob = moving ? 0 : Math.sin(time * 3.2 + i * 1.3) * 1.5;
      const hy = y - 5 - bob;
      if (moving) {
        const len = Math.min(STREAK_MAX, speed * STREAK_TIME);
        const so = pen.shape(STREAK, 0.55 * crowd, 'fx');
        so.additive = true;
        so.thickness = size === 2 ? 2 : 1;
        r.line(x - (vx / speed) * len, hy - (vy / speed) * len, x, hy, so);
      }
      const pile = this.cells.touch(x, hy, frame);
      const thin = pile < 3 ? 1 : 3 / (pile + 1);
      const o = pen.sprite('fx');
      o.additive = true;
      o.tint = C.echo;
      o.alpha = (0.35 + 0.55 * crowd) * thin;
      o.emissive = 0.25 + 0.35 * crowd;
      o.scale = SCALE[size];
      o.sortY = y;
      r.sprite('fx/mote', Math.floor(time * 8 + i) & 3, x, hy, o);
      if (pile === 0 && lights.mote < LIGHT_CAPS.mote) {
        lights.mote++;
        pen.light(x, hy, 18 + size * 6, C.echo, 0.25 + size * 0.08, 0.1);
      }
    }
  }
}
