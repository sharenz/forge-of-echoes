// `foe show <account>` prints the first-run funnel: the mode, the steps done and the seconds between them.
import { describe, expect, it } from 'vitest';
import { tutorialLine } from '../../src/cli/foe';

describe('tutorialLine', () => {
  it('reads the funnel off the step times', () => {
    const line = tutorialLine({
      mode: 'active', skippedBy: null, done: ['device', 'area', 'map'], hints: 2, replays: 0,
      steps: [{ id: 'device', at: 1_000 }, { id: 'area', at: 13_000 }, { id: 'map', at: 21_000 }],
    });
    expect(line).toBe('active, 3 steps (last: map), 2 hints   area +12s, map +8s');
  });
  it('says who skipped it', () => {
    expect(tutorialLine({ mode: 'skipped', skippedBy: 'veteran', done: [], hints: 17, replays: 0, steps: [] })).toBe('skipped by veteran, 0 steps (last: none), 17 hints');
  });
  it('counts replays', () => {
    expect(tutorialLine({ mode: 'done', skippedBy: null, done: ['device'], hints: 0, replays: 2, steps: [{ id: 'device', at: 5 }] })).toBe('done, 1 steps (last: device), 0 hints, 2 replays');
  });
});
