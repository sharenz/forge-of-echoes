// Cosmetic event channel with a per-tick budget. Low-priority events (plain hits, projectile ends,
// motes, ailment pops) are dropped first so that important cues (deaths, casts, telegraphs, loot)
// always make it through even in the densest fights. Outcomes live elsewhere and are never dropped.
import type { SimEvent } from '../contracts/sim';
import {
  EVENT_BUFFER_HARD_MAX, EVENT_BUFFER_SOFT_MAX, EVENT_CAP_PER_TICK, LOW_EVENT_CAP_PER_TICK,
} from './constants';

export class EventBuffer {
  private list: SimEvent[] = [];
  private tickTotal = 0;
  private tickLow = 0;
  /** Events dropped since creation (diagnostics). */
  dropped = 0;

  beginTick(): void {
    this.tickTotal = 0;
    this.tickLow = 0;
  }

  /** Important cosmetic event: only dropped if the hard per-tick cap is exhausted. */
  push(e: SimEvent): void {
    if (this.tickTotal >= EVENT_CAP_PER_TICK || this.list.length >= EVENT_BUFFER_HARD_MAX) {
      this.dropped++;
      return;
    }
    this.tickTotal++;
    this.list.push(e);
  }

  /** Low-priority event: dropped first under load. */
  low(e: SimEvent): void {
    if (
      this.tickLow >= LOW_EVENT_CAP_PER_TICK ||
      this.tickTotal >= EVENT_CAP_PER_TICK ||
      this.list.length >= EVENT_BUFFER_SOFT_MAX
    ) {
      this.dropped++;
      return;
    }
    this.tickLow++;
    this.tickTotal++;
    this.list.push(e);
  }

  /** True if a low-priority event would currently be accepted (lets callers skip building it). */
  get lowOpen(): boolean {
    return this.tickLow < LOW_EVENT_CAP_PER_TICK && this.tickTotal < EVENT_CAP_PER_TICK && this.list.length < EVENT_BUFFER_SOFT_MAX;
  }

  drain(): SimEvent[] {
    const out = this.list;
    this.list = [];
    return out;
  }
}
