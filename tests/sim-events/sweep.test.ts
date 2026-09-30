// The gated forced-event sweep (EVENT_SWEEP=1): many seeds per event and roster family, printed as JSON lines for calibration.
//   EVENT_SWEEP=1 EVENT_SWEEP_KINDS=hunted,wound EVENT_SWEEP_THEMES=ashenForge EVENT_SWEEP_SEEDS=12 EVENT_SWEEP_OUT=/path/out.jsonl \
//     npx vitest run tests/sim-events/sweep.test.ts
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_EVENT_KINDS, type MapEventKind } from '../../src/contracts/map-events';
import type { Theme } from '../../src/contracts/content';
import { SWEEP_THEMES, summarize, sweepRun } from './sweep';

const ON = process.env.EVENT_SWEEP === '1';
const kinds = (process.env.EVENT_SWEEP_KINDS?.split(',').filter(Boolean) ?? MAP_EVENT_KINDS) as (MapEventKind | 'none')[];
const themes = (process.env.EVENT_SWEEP_THEMES?.split(',').filter(Boolean) ?? SWEEP_THEMES) as Theme[];
const seeds = Number(process.env.EVENT_SWEEP_SEEDS ?? 10);
const party = Number(process.env.EVENT_SWEEP_PARTY ?? 1);
const out = process.env.EVENT_SWEEP_OUT;
const noPolicy = process.env.EVENT_SWEEP_NOPOLICY === '1';

describe.skipIf(!ON)('forced event sweep', () => {
  for (const kind of kinds) for (const theme of themes) {
    it(`${kind} on ${theme}`, () => {
      const runs = Array.from({ length: seeds }, (_, s) => sweepRun(kind, theme, s + 1, { party, noPolicy }));
      const summary = { kind, theme, party, noPolicy, ...summarize(runs), grades: runs.map(r => r.event?.grade ?? '-').join(''), results: runs.map(r => r.result[0]).join(''),
        tallies: runs.map(r => r.event?.tally ?? null), seconds: runs.map(r => Math.round(r.eventSeconds)) };
      const line = JSON.stringify(summary);
      if (out) appendFileSync(out, line + '\n'); else process.stderr.write(line + '\n');
      expect(summary.errors).toBe(0);
      expect(summary.timeout).toBe(0);
      expect(summary.stuck, 'bot stuck runs').toBeLessThanOrEqual(Math.ceil(seeds * 0.2));
    }, 3_600_000);
  }
});
