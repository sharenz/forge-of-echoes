// Click-to-pick-up (GAME_SPEC §12): a click on a ground item that is out of reach walks the character there first.
// While walking, this steering replaces the keyboard's movement on every 60 Hz input tick; any movement key, the
// item disappearing (picked up by someone, expired, left the AOI), death, a zone change, the menu or a new click
// elsewhere cancels it. Once the PREDICTED feet are within PICKUP_APPROACH the walk ends and the app sends
// `pickup`: the server measures PICKUP_REACH on its own position, which trails the prediction by the inputs still
// queued, so stopping at the reach itself would come back "Too far away." (the server also retries for 0.5 s).
// Pure: no DOM, no clock — one step per input tick.
import { PICKUP_REACH } from '../contracts/sim';
import type { DropView } from '../contracts/sim';

/** Walk the predicted feet this close before sending `pickup` (mirrors src/sim PICKUP_APPROACH). */
export const PICKUP_APPROACH = PICKUP_REACH - 16;
/** Input ticks without getting closer (blocked by a prop, rooted) before the walk gives up (0.75 s). */
export const WALK_STALL_TICKS = 45;
/** The longest walk (ticks, 12 s): the item is somewhere the character cannot get to. */
export const WALK_MAX_TICKS = 60 * 12;
/** Getting closer by less than this per tick counts as no progress (world units). */
const PROGRESS_EPSILON = 0.25;

export interface Point {
  x: number;
  y: number;
}

export type WalkResult =
  /** Not walking. */
  | 'idle'
  /** Steering written into `out`. */
  | 'walking'
  /** In reach: send `pickup` for `dropId` now (the walk has ended). */
  | 'arrived'
  /** The walk ended without reaching the item (see WalkState.lastCancel). */
  | 'cancelled';

export type WalkCancel = 'input' | 'gone' | 'dead' | 'stuck' | 'timeout' | 'manual';

export function findDrop(drops: readonly DropView[], id: number): DropView | null {
  for (let i = 0; i < drops.length; i++) if (drops[i].id === id) return drops[i];
  return null;
}

/** True when the feet at `me` are close enough to click-pick the drop at once. */
export function inPickupReach(me: Point, drop: Point, reach = PICKUP_APPROACH): boolean {
  const dx = drop.x - me.x;
  const dy = drop.y - me.y;
  return dx * dx + dy * dy <= reach * reach;
}

export class AutoWalk {
  private target = -1;
  private ticks = 0;
  private best = Infinity;
  private stall = 0;
  /** Why the last walk ended without arriving (tests, debugging). */
  lastCancel: WalkCancel | null = null;

  get active(): boolean {
    return this.target >= 0;
  }

  /** The drop being walked to (−1 = none). */
  get dropId(): number {
    return this.target;
  }

  start(dropId: number): void {
    this.target = dropId;
    this.ticks = 0;
    this.best = Infinity;
    this.stall = 0;
    this.lastCancel = null;
  }

  cancel(reason: WalkCancel = 'manual'): void {
    if (this.target < 0) return;
    this.target = -1;
    this.lastCancel = reason;
  }

  /**
   * One input tick. `me`: the local player's predicted feet, null when she is dead or not replicated. `manualMove`:
   * the keyboard asks for movement this tick (cancels the walk). Writes the unit steering vector into `out` while
   * walking.
   */
  step(me: Point | null, drops: readonly DropView[], manualMove: boolean, out: { moveX: number; moveY: number }): WalkResult {
    if (this.target < 0) return 'idle';
    if (manualMove) return this.end('input');
    if (!me) return this.end('dead');
    const drop = findDrop(drops, this.target);
    if (!drop) return this.end('gone');
    const dx = drop.x - me.x;
    const dy = drop.y - me.y;
    const d = Math.hypot(dx, dy);
    if (d <= PICKUP_APPROACH) {
      this.target = -1;
      return 'arrived';
    }
    if (++this.ticks > WALK_MAX_TICKS) return this.end('timeout');
    if (d < this.best - PROGRESS_EPSILON) {
      this.best = d;
      this.stall = 0;
    } else if (++this.stall > WALK_STALL_TICKS) {
      return this.end('stuck');
    }
    out.moveX = dx / d;
    out.moveY = dy / d;
    return 'walking';
  }

  private end(reason: WalkCancel): WalkResult {
    this.target = -1;
    this.lastCancel = reason;
    return 'cancelled';
  }
}
