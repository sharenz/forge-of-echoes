// The daily surge as the Atlas UI sees it (brief D 7.6): the Hold toggle, the server-clock hooks, and the pips the chart draws
// on every node. All numbers come from game/progression/surge.ts (the same functions the server spends with); nothing here decides a rule.
import { useEffect, useState } from 'preact/hooks';
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import { surgeStatus, type SurgeStatus } from '../../game/progression/surge';
import { useUi } from '../store';

// ---- the Hold toggle (default on: the dock sends `useSurge: true`; off keeps the charge) -------------------------------------------

let hold = true;
const subscribers = new Set<() => void>();

/** Whether the next activation spends a surge charge (not reactive; for event handlers). */
export const surgeHold = (): boolean => hold;

export function setSurgeHold(next: boolean): void {
  if (hold === next) return;
  hold = next;
  subscribers.forEach((fn) => fn());
}

export function useSurgeHold(): boolean {
  const [value, setValue] = useState(hold);
  useEffect(() => {
    const fn = (): void => setValue(hold);
    subscribers.add(fn);
    fn();
    return () => { subscribers.delete(fn); };
  }, []);
  return value;
}

// ---- the server clock --------------------------------------------------------------------------------------------------------------

/** Server time estimate (ms), refreshed every half minute and right at the daily reset, so countdowns and pips stay true. */
export function useServerNow(): number {
  const offset = useUi((s) => s.serverClockOffset);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(h);
  }, []);
  void tick;
  return Date.now() + offset;
}

/** The charges of one area now (the atlas is the account's; a character without one has full charges). */
export function useSurgeStatus(areaId: AtlasAreaId): SurgeStatus {
  const atlas = useUi((s) => s.character?.atlas);
  const now = useServerNow();
  return surgeStatus(atlas, areaId, now);
}

// ---- the chart's pips ---------------------------------------------------------------------------------------------------------------

/** Per-area charges the renderer draws under every node. Fed by the dock (always mounted with the chart), read each frame. */
let feed: ReadonlyMap<string, { remaining: number; max: number }> | null = null;

export function publishSurgeFeed(atlas: AtlasProgress | undefined, areaIds: readonly AtlasAreaId[], now: number): void {
  feed = new Map(areaIds.map((id) => { const s = surgeStatus(atlas, id, now); return [id, { remaining: s.remaining, max: s.max }]; }));
}

export function clearSurgeFeed(): void { feed = null; }

/** Brass pips as canvas pixels: filled = a charge left, hollow and dim = spent. `y` is the pips' vertical offset below the node centre. */
export function drawSurgePips(ctx: CanvasRenderingContext2D, areaId: string, cx: number, cy: number, y: number, dim = 1): void {
  const s = feed?.get(areaId);
  if (!s || s.max <= 0) return;
  const gap = 6;
  const x0 = cx - Math.round(((s.max - 1) * gap) / 2) - 1;
  const SHAPE: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [2, 1], [1, 2]];
  for (let i = 0; i < s.max; i++) {
    const on = i < s.remaining;
    const px = x0 + i * gap, py = cy + y;
    ctx.globalAlpha = (on ? 1 : s.remaining === 0 ? 0.45 : 0.7) * dim;
    ctx.fillStyle = on ? '#d9a441' : '#6b5a3a';
    for (const [dx, dy] of SHAPE) ctx.fillRect(px + dx, py + dy, 1, 1);
    if (on) { ctx.fillStyle = '#fff0b8'; ctx.fillRect(px + 1, py + 1, 1, 1); } else { ctx.fillStyle = '#2a1f12'; ctx.fillRect(px + 1, py + 1, 1, 1); }
  }
  ctx.globalAlpha = 1;
}
