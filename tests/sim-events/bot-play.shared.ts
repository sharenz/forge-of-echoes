// The fair bot plays a tier-5 map with each forced event on one roster family: no softlock, no exception, no stalled wave tell,
// and the map still clears for most seeds. One file per family (bot-play-*.test.ts) so the runs spread over workers.
import { describe, expect, it } from 'vitest';
import type { Theme } from '../../src/contracts/content';
import { MAP_EVENT_KINDS, type MapEventKind } from '../../src/contracts/map-events';
import { sweepRun } from './sweep';

/** Events a bot resolves without help (it fights whatever is near): the forced event must actually finish. */
const SELF_RESOLVING: readonly MapEventKind[] = ['hunted', 'vaultbreakers', 'secondCrown'];
/** Five seeds, two of them must clear: a death is the fight's luck, so two of three flipped on any change of path or spawn point. */
const SEEDS = [1, 2, 3, 4, 5];
/** Two bosses at once is the hardest encounter of the game: a quarter of matched-bot runs die (docs/atlas-rework/C-map-events.md 12). */
/** Bellwatch on Rimed Ossuary clears 7 of 16 seeds since monsters no longer spawn buried inside props (it was 11 of 16). */
const MIN_OK: Partial<Record<MapEventKind, number>> = { secondCrown: 1, bellwatch: 1 };

export function botPlay(theme: Theme): void {
  describe(`bot play with events on ${theme}`, () => {
    it.each([...MAP_EVENT_KINDS])('%s never softlocks and the map still clears for most seeds', (kind) => {
      const runs = SEEDS.map(seed => sweepRun(kind, theme, seed));
      const cleared = runs.filter(r => r.result === 'cleared').length;
      const stuck = runs.filter(r => r.result === 'stuck').length;
      expect(runs.filter(r => r.result === 'timeout').length, `${theme} ${kind} timeouts`).toBe(0);
      expect(runs.reduce((a, r) => a + r.errors, 0), `${theme} ${kind} hook errors`).toBe(0);
      expect(runs.every(r => r.maxHold <= 8.5), `${theme} ${kind} held the wave tell`).toBe(true);
      // A scripted bot that pins itself on scenery is not the event's fault: those runs are set aside.
      expect(cleared + stuck, `${theme} ${kind} cleared ${runs.map(r => r.result).join(',')}`).toBeGreaterThanOrEqual(MIN_OK[kind] ?? 2);
      if (SELF_RESOLVING.includes(kind)) expect(runs.some(r => r.event), `${theme} ${kind} resolved`).toBe(true);
    }, 600_000);
  });
}
