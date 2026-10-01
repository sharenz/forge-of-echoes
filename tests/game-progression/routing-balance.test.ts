// On demand (BALANCE=1, about a minute): the measured drop table of brief D 4.5. Per area and tier, with the late-game chart (every
// area charted) and the frontier chart (only areas no deeper than the one being run): maps per run, per hour, where they go, and
// how many can climb. Run: BALANCE=1 npx vitest run tests/game-progression/routing-balance.test.ts
import { describe, it } from 'vitest';
import { atlasTierCeiling } from '../../src/data/progression/atlas';
import { ADDRESSES, allCharted, frontierCharted, ladder, routeStats } from './routing-harness';

const enabled = !!process.env.BALANCE;
/** Spec 4.5 assumes about 5 runs an hour; the harness's wave model clears faster, so "per hour" here is maps per run x 5. */
const RUNS_PER_HOUR = 5;

describe.runIf(enabled)('map drop routing, measured (BALANCE=1)', () => {
  it('prints the drop table', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const lines: string[] = [];
    for (const a of ADDRESSES) {
      const ceil = atlasTierCeiling(a);
      for (const tier of [...new Set([Math.max(1, ceil - 2), ceil])]) {
        for (const [label, chart] of [['late', allCharted()], ['frontier', frontierCharted(a.id)]] as const) {
          const r = routeStats(a.id, tier, chart, seeds);
          const top = Object.entries(r.byArea).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
          lines.push(`${a.id.padEnd(17)} T${String(tier).padEnd(2)} ${label.padEnd(8)} maps/run ${r.mapsPerRun.toFixed(2)}  /h@${RUNS_PER_HOUR} ${(r.mapsPerRun * RUNS_PER_HOUR).toFixed(1).padStart(5)}  own ${(r.shares.own * 100).toFixed(0).padStart(3)}%  near ${(r.shares.neighbour * 100).toFixed(0).padStart(3)}%  other ${(r.shares.other * 100).toFixed(0).padStart(3)}%  up ${(r.upShare * 100).toFixed(0).padStart(3)}%  climb/run ${r.climbPerRun.toFixed(2)}  top: ${top}`);
        }
      }
    }
    const rs = (legacy: boolean) => Array.from({ length: 200 }, (_, i) => ladder(i + 1, legacy));
    for (const legacy of [true, false]) {
      const runs = rs(legacy).map((r) => r.runs).sort((x, y) => x - y);
      lines.push(`ladder ${legacy ? 'pre-routing' : 'routed'}: median ${runs[100]} mean ${(runs.reduce((x, y) => x + y, 0) / runs.length).toFixed(1)} p90 ${runs[180]} max ${runs[199]} runs to the first Tier 15 run`);
    }
    process.stdout.write(`\n${lines.join('\n')}\n`);
  }, 600_000);
});
