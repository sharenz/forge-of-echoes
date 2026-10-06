// Random-build bots for the Orrery (docs/power-rework/passive-tree.md 8.2; harness in passive-tree-harness.ts). Always: 400 random
// 70-point builds at ML60. On demand (BALANCE=1): 2,000 builds at ML28, 60 and 88 with the keystone floor of acceptance (d).
//
// Acceptance (8.2, build-plan A9 / A10):
//   (a) the 5th to 95th percentile spread of the power index is at most 2.2×;
//   (b) the median random build reaches at least 35% of the best build (the greedy stand-in for the best archetype);
//   (c) no non-gate node is in more than 70% of the top-5% builds, unless it is a trunk node every build passes anyway: the
//       top-5% share may exceed the all-build share by at most 15 points (rows 0 and 1 of a spine are on every path into a sector);
//   (d) every keystone is in 3% to 40% of the top-5% builds (the floor needs the 2,000-build population: BALANCE=1).
import { describe, expect, it } from 'vitest';
import { PASSIVE_NODES } from '../../src/data/progression/passives';
import { botReport, greedyBuild, powerIndex, randomPopulation, type BotReport } from './passive-tree-harness';

const enabled = !!process.env.BALANCE;

function check(r: BotReport, keystoneFloor: boolean, trunkMargin = 0.15) {
  expect(r.spread, `ML${r.ml} spread`).toBeLessThanOrEqual(2.2);
  expect(r.medianOfBest, `ML${r.ml} median / best`).toBeGreaterThanOrEqual(0.35);
  for (const n of PASSIVE_NODES) {
    if (n.kind === 'gate') continue;
    const top = r.topShare.get(n.id) ?? 0;
    const all = r.allShare.get(n.id) ?? 0;
    if (top > 0.7) expect(top - all, `ML${r.ml} ${n.id} must-take (${Math.round(top * 100)}% of the top, ${Math.round(all * 100)}% of all)`).toBeLessThanOrEqual(trunkMargin);
  }
  for (const k of PASSIVE_NODES.filter((n) => n.kind === 'keystone')) {
    const top = r.topShare.get(k.id) ?? 0;
    expect(top, `ML${r.ml} ${k.name} in the top 5%`).toBeLessThanOrEqual(0.4);
    if (keystoneFloor) expect(top, `ML${r.ml} ${k.name} in the top 5%`).toBeGreaterThanOrEqual(0.03);
    expect(r.allShare.get(k.id) ?? 0, `${k.name} is reachable by random growth`).toBeGreaterThan(0);
  }
}

describe('random-build bots (fast)', () => {
  it('400 random builds at ML60 meet acceptance (a) to (c) and the keystone ceiling of (d) (top 10%: 40 builds)', () => {
    const population = randomPopulation(400);
    for (const b of population) {
      const spent = b.ids.reduce((s, id) => s + PASSIVE_NODES.find((n) => n.id === id)!.cost, 0);
      expect(spent).toBeLessThanOrEqual(70);
      expect(spent).toBeGreaterThanOrEqual(69); // growth stops only when not even one more point fits
    }
    // 40 builds: a sampling margin of 25 points instead of 15.
    check(botReport(population, 60, undefined, 0.1), false, 0.25);
  }, 60_000);

  // The greedy best takes five or six keystones where the design expects two or three (3.9): a B1 tuning note, not pinned here.
  it('the best build more than doubles the empty tree and takes keystones', () => {
    const best = greedyBuild(60);
    expect(powerIndex(best, 60).index).toBeGreaterThan(2 * powerIndex({ ids: [], masteries: {} }, 60).index);
    const keystones = best.ids.filter((id) => PASSIVE_NODES.find((n) => n.id === id)!.kind === 'keystone');
    expect(keystones.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe.runIf(enabled)('random-build bots (BALANCE=1)', () => {
  const population = randomPopulation(2000);
  for (const ml of [28, 60, 88]) {
    it(`2,000 random builds at ML${ml} meet acceptance (a) to (d)`, () => {
      check(botReport(population, ml), true);
    }, 600_000);
  }
});
