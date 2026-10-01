// Chains: the art's single 'fx/chain' link period (CHAIN_PERIOD px, pointing east, ink baked in — no outline) laid
// end to end along a line, rotated to it. Used for a flying chain hook (thrower → hook) and for the taut chain of a
// pull (Tethers: hook-thrower → the yanked player, snapping taut for the drag and slackening as it lets go).
import { CHAIN_PERIOD } from '../art';
import type { Layer } from '../contracts/render';
import { C } from './colors';
import { clamp01 } from './math';
import type { Pen } from './pen';

/** Most links drawn for one chain (a chainmaster's hook flies up to ~470 units: 60 links). */
const MAX_LINKS = 72;

/**
 * Draw a chain from (x0, y0) to (x1, y1) (sprite space: the caller has already lifted it to chest height).
 * `sag` bows the middle down by that many units (a slack chain). Returns the number of links drawn.
 */
export function drawChain(
  pen: Pen, x0: number, y0: number, x1: number, y1: number, alpha: number, sortY: number, sag = 0, layer: Layer = 'fx', emissive = 0.3,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 2 || !(alpha > 0.01)) return 0;
  const n = Math.min(MAX_LINKS, Math.max(1, Math.round(len / CHAIN_PERIOD)));
  const r = pen.r;
  let px = x0;
  let py = y0;
  let drawn = 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    // A slack chain hangs in a shallow parabola (screen-down), a taut one is straight.
    const bow = sag * 4 * t * (1 - t);
    const qx = x0 + dx * t;
    const qy = y0 + dy * t + bow;
    const o = pen.sprite(layer);
    o.rotation = Math.atan2(qy - py, qx - px);
    o.alpha = alpha;
    o.emissive = emissive;
    o.sortY = sortY;
    r.sprite('fx/chain', 0, (px + qx) / 2, (py + qy) / 2, o);
    drawn++;
    px = qx;
    py = qy;
  }
  return drawn;
}

const TETHER_CAP = 8;
/** Seconds the chain stays taut (the sim's PULL_TIME), then it slackens and fades over TETHER_FADE. */
const TETHER_TAUT = 0.25;
const TETHER_FADE = 0.3;
/** A tether this young belongs to a hook that ended in the last few frames (it is taut for TETHER_TAUT). */
const TETHER_FRESH = 0.3;

/** Pull tethers: from the hook's thrower to the player being dragged. */
export class Tethers {
  private readonly player = new Int32Array(TETHER_CAP);
  private readonly ax = new Float32Array(TETHER_CAP);
  private readonly ay = new Float32Array(TETHER_CAP);
  /** Player end at the event (used if the player is no longer drawn). */
  private readonly px = new Float32Array(TETHER_CAP);
  private readonly py = new Float32Array(TETHER_CAP);
  private readonly age = new Float32Array(TETHER_CAP);
  private readonly live = new Uint8Array(TETHER_CAP);
  private next = 0;

  /** Player `playerId` is yanked toward the thrower at (ax, ay); (px, py) = where she stood. */
  spawn(playerId: number, ax: number, ay: number, px: number, py: number): void {
    // One tether per player: a new pull replaces the old one.
    let i = -1;
    for (let k = 0; k < TETHER_CAP; k++) if (this.live[k] && this.player[k] === playerId) i = k;
    if (i < 0) {
      i = this.next;
      this.next = (this.next + 1) % TETHER_CAP;
    }
    this.player[i] = playerId;
    this.ax[i] = ax;
    this.ay[i] = ay;
    this.px[i] = px;
    this.py[i] = py;
    this.age[i] = 0;
    this.live[i] = 1;
  }

  /** Did a pull start near (x, y) just now (a hook that ended there caught someone)? */
  pulledNear(x: number, y: number, radius: number): boolean {
    for (let i = 0; i < TETHER_CAP; i++) {
      if (!this.live[i] || this.age[i] > TETHER_FRESH) continue;
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
    return false;
  }

  update(dt: number): void {
    for (let i = 0; i < TETHER_CAP; i++) {
      if (!this.live[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= TETHER_TAUT + TETHER_FADE) this.live[i] = 0;
    }
  }

  /** `where(id)` = the player's rendered feet this frame, or null. */
  draw(pen: Pen, where: (id: number) => { x: number; y: number } | null): void {
    for (let i = 0; i < TETHER_CAP; i++) {
      if (!this.live[i]) continue;
      const a = this.age[i];
      const pos = where(this.player[i]);
      const x = pos ? pos.x : this.px[i];
      const y = pos ? pos.y : this.py[i];
      const fade = a < TETHER_TAUT ? 1 : 1 - clamp01((a - TETHER_TAUT) / TETHER_FADE);
      const sag = a < TETHER_TAUT ? 0 : 10 * clamp01((a - TETHER_TAUT) / TETHER_FADE);
      const lift = 10;
      drawChain(pen, this.ax[i], this.ay[i] - lift, x, y - lift, fade, Math.max(y, this.ay[i]) + 1, sag);
      // The snap: a hot glint where the chain bites her while it is taut.
      if (a < TETHER_TAUT) pen.light(x, y - lift, 30, C.flame, 0.3 * (1 - a / TETHER_TAUT), 0);
    }
  }

  clear(): void {
    this.live.fill(0);
  }
}
