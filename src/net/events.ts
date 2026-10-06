// Cosmetic event timeline: holds server event batches until the ClientWorld's render clock reaches their tick, so
// death bursts, hit numbers and drop fountains line up with the interpolated monsters instead of playing ~100 ms
// before the monster visibly dies.
//
// Events that belong to something the ClientWorld shows on the live timeline (or in the predicted present) are
// released immediately instead, so they stay in sync with what they decorate:
//   • the local player's own feedback — her casts, blinks, wards, flasks, getting hit, her death, debuffs landing on
//     her, being cleansed and being yanked by a hook (her debuff list and her position are live/predicted: the root
//     sound plays as the prediction stops her, and the chain as ClientWorld.noteEvents replays the drag, which starts
//     her visible yank toward the hook in the same frame);
//   • pickups of drops she can see — her own loot and public drops, whoever picked them up (a picked-up drop
//     vanishes from the view as soon as the newest snapshot lacks it, so its sparkle plays right then);
//   • telegraph resolution — areas are drawn from the newest snapshot, so the slam/meteor/eruption explosion plays
//     the moment its circle disappears, together with the damage it deals her;
//   • dynamic props and run state — chests opening, portals opening, the clear, wave tells and wave starts
//     (props, portal counts and the run HUD all come from the newest snapshot).
import { SNAPSHOT_EVERY } from '../contracts/net';
import type { SimEvent } from '../contracts/sim';

/** Batches older than this behind the newest batch are flushed even if the render clock lags (stalled stream). */
const MAX_HOLD_TICKS = 30;

export interface EventTimeline {
  /** Queue one `{ t: 'events', tick, events }` batch as it arrives. */
  push(tick: number, events: readonly SimEvent[]): void;
  /** Append every event due at `renderTick` to `out` (and return it). */
  drain(renderTick: number, out?: SimEvent[]): SimEvent[];
  /** The local player's id (her own feedback is released at once). */
  setLocalPlayer(id: number): void;
  /** Drop everything (zone change). */
  clear(): void;
  readonly pending: number;
}

/** True for events released at once (see the header); everything else waits for the render clock. */
export function isImmediateEvent(e: SimEvent, local: number): boolean {
  switch (e.t) {
    case 'cast':
    case 'nova':
    case 'dash':
    case 'ward':
    case 'buff':
    case 'flask':
    case 'notEnoughFocus':
    case 'playerDeath':
    case 'debuff':
    case 'cleanse':
    case 'pull':
      return e.playerId === local;
    case 'hit':
    case 'evade':
      return e.target === 'player' && e.playerId === local;
    case 'pickup':
      return e.owner === local || e.owner === 0 || e.playerId === local;
    case 'portal':
      return e.kind === 'open' || e.playerId === local;
    case 'areaResolve':
    case 'mapEvent':
    case 'chestOpen':
    case 'cleared':
    case 'waveTell':
    case 'waveStart':
      return true;
    default:
      return false;
  }
}

export function createEventTimeline(): EventTimeline {
  const ticks: number[] = [];
  const batches: (readonly SimEvent[])[] = [];
  const immediate: SimEvent[] = [];
  let local = 0;
  let pendingCount = 0;

  return {
    push(tick, events) {
      if (events.length === 0) return;
      const delayed: SimEvent[] = [];
      for (const e of events) {
        if (isImmediateEvent(e, local)) immediate.push(e);
        else delayed.push(e);
      }
      if (delayed.length === 0) return;
      // Keep batches ordered by tick (the server sends them in order; this also tolerates reordering).
      let at = ticks.length;
      while (at > 0 && ticks[at - 1] > tick) at--;
      ticks.splice(at, 0, tick);
      batches.splice(at, 0, delayed);
      pendingCount += delayed.length;
    },
    drain(renderTick, out = []) {
      for (const e of immediate) out.push(e);
      immediate.length = 0;
      const newestTick = ticks.length ? ticks[ticks.length - 1] : 0;
      let n = 0;
      // A batch carries the events of the ticks since the previous snapshot. The ClientWorld stops drawing what
      // died in that span as soon as the render tick enters it (the newer snapshot no longer has it), so the
      // death bursts, hits and drops of the batch are released at exactly that moment.
      while (n < ticks.length && (ticks[n] <= renderTick + SNAPSHOT_EVERY || ticks[n] < newestTick - MAX_HOLD_TICKS)) {
        for (const e of batches[n]) out.push(e);
        pendingCount -= batches[n].length;
        n++;
      }
      if (n > 0) {
        ticks.splice(0, n);
        batches.splice(0, n);
      }
      return out;
    },
    setLocalPlayer(id) {
      local = id;
    },
    clear() {
      ticks.length = 0;
      batches.length = 0;
      immediate.length = 0;
      pendingCount = 0;
    },
    get pending() {
      return pendingCount + immediate.length;
    },
  };
}
