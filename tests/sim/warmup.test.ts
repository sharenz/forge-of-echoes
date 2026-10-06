// The first map's gentle opening (RunConfig.warmup): the director holds the first wave until a living player moves or casts,
// or GUIDE_WARMUP_SECONDS pass, whichever comes first. A normal run is untouched, and two identical runs stay identical.
import { describe, expect, it } from 'vitest';
import { GUIDE_WARMUP_SECONDS } from '../../src/contracts/guide';
import { SIM_DT } from '../../src/contracts/sim';
import { createRunInternal } from '../../src/sim/run';
import { idleIntent, makeConfig, makeJoin } from './fixtures';
import { stepWith } from './helpers';

const secs = (n: number) => Math.round(n / SIM_DT);

function solo(warmup: boolean) {
  const { run } = createRunInternal({ ...makeConfig({ seed: 77 }), ...(warmup ? { warmup: true } : {}) });
  run.addPlayer(makeJoin(1, {}));
  return run;
}

describe('first-run warm-up', () => {
  it('a normal run starts its first wave after the intro and the tell (a few seconds)', () => {
    const run = solo(false);
    for (let t = 0; t < secs(6); t++) stepWith(run, idleIntent());
    expect(run.view.run.wave).toBeGreaterThanOrEqual(1);
  });

  it('holds still while the player does nothing, then starts after the warm-up seconds', () => {
    const run = solo(true);
    for (let t = 0; t < secs(GUIDE_WARMUP_SECONDS - 0.5); t++) stepWith(run, idleIntent());
    expect(run.view.run.wave).toBe(0);
    expect(run.view.run.monstersAlive).toBe(0);
    for (let t = 0; t < secs(7); t++) stepWith(run, idleIntent());
    expect(run.view.run.wave).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['moves', { moveX: 1 }],
    ['casts', { held: [true, false, false, false, false, false] }],
  ])('starts at once when the player %s', (_label, change) => {
    const run = solo(true);
    for (let t = 0; t < secs(3); t++) stepWith(run, idleIntent());
    expect(run.view.run.wave).toBe(0);
    stepWith(run, { ...idleIntent(), ...change });
    for (let t = 0; t < secs(6); t++) stepWith(run, idleIntent());
    expect(run.view.run.wave).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic: the same inputs give the same wave timing', () => {
    const a = solo(true);
    const b = solo(true);
    for (let t = 0; t < secs(10); t++) {
      const intent = t === secs(2) ? { ...idleIntent(), moveX: 1 } : idleIntent();
      stepWith(a, intent);
      stepWith(b, intent);
    }
    expect(a.view.run.wave).toBe(b.view.run.wave);
    expect(a.view.run.monstersAlive).toBe(b.view.run.monstersAlive);
  });
});
