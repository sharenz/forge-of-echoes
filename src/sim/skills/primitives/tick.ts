// The per-player upkeep of the flagship augments (called from the executor's tick, after casting): scheduled bursts and skips,
// lodges whose fuse ran out or whose host died, and pruning. Nothing happens (and nothing is allocated) for a player without
// augment state, so the plain game's ticks are unchanged.
import type { PlayerState, World } from '../../world';
import { tickLodges } from './lodge';
import { pruneMarks } from './mark';
import { pruneRiders } from './riders';
import { peekPlayer, peekWorld } from './state';

export function tickAugments(w: World, p: PlayerState): void {
  const ps = peekPlayer(p);
  if (ps && ps.queue.length > 0) {
    const q = ps.queue;
    // Due entries run in the order they were scheduled; anything they schedule waits for the next tick.
    const due = [];
    let write = 0;
    for (let k = 0; k < q.length; k++) {
      const e = q[k];
      if (p.dead) continue;
      if (e.at <= w.time + 1e-9) due.push(e);
      else q[write++] = e;
    }
    q.length = write;
    for (const e of due) e.run(w, p);
  }
  if (!peekWorld(w)) return;
  tickLodges(w, p);
  pruneRiders(w);
  pruneMarks(w);
}
