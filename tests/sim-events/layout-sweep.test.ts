// The layout bot sweep (gated: BALANCE=1): the fair bot plays every one of the 25 Atlas areas with its hand-crafted layout LIVE
// (RunConfig.areaId, the area's own theme and arena radius), optionally with each forced event. It reports, per area: clears, deaths,
// timeouts and "stuck" runs (the scripted bot pinned for a minute with nothing to fight), hook errors, monsters that ever stood
// inside a solid prop, and whether the forced event found its anchor and finished. Output: JSON lines on stderr (or
// LAYOUT_SWEEP_OUT=/path). LAYOUT_SWEEP_EVENTS=hunted,wound limits the events ('none' = the plain map only), LAYOUT_SWEEP_SEEDS=3.
//   BALANCE=1 LAYOUT_SWEEP_SEEDS=3 LAYOUT_SWEEP_OUT=/tmp/layouts.jsonl npx vitest run tests/sim-events/layout-sweep.test.ts
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { MAP_EVENT_KINDS, type MapEventKind } from '../../src/contracts/map-events';
import { setCoverEnabled } from '../../src/data/propCover';
import { overrideLayout, registeredLayouts } from '../../src/data/layouts';
import { SIM_DT } from '../../src/contracts/sim';
import { areaRadius, areaTheme } from '../../src/data/layouts/area';
import { createRunInternal } from '../../src/sim/run';
import { pinnedMonsters } from './pinned';
import { navStats, setNavEnabled } from '../../src/sim/nav';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeJoin } from '../sim/fixtures';
import { sweepRun } from './sweep';

const ON = !!process.env.BALANCE;
const seeds = Number(process.env.LAYOUT_SWEEP_SEEDS ?? 3);
const out = process.env.LAYOUT_SWEEP_OUT;
const kinds = (process.env.LAYOUT_SWEEP_EVENTS?.split(',').filter(Boolean) ?? ['none', ...MAP_EVENT_KINDS]) as (MapEventKind | 'none')[];
/** LAYOUT_SWEEP_BASELINE=1 plays the same areas (theme, radius) on the old procedural generator, for before/after comparisons. */
const baseline = process.env.LAYOUT_SWEEP_BASELINE === '1';
/** LAYOUT_SWEEP_NAV=0 plays with monster wall navigation off (before/after comparison of pinned monsters and clear times). */
if (process.env.LAYOUT_SWEEP_NAV === '0') setNavEnabled(false);
/** LAYOUT_SWEEP_COVER=0 plays with cover off (every prop flown over: the pre-cover game), for before/after comparisons. */
if (process.env.LAYOUT_SWEEP_COVER === '0') setCoverEnabled(false);
/** LAYOUT_SWEEP_FLOW=0 plays with every flow zone (conveyor belt) stripped from the layouts, for before/after comparisons. */
if (process.env.LAYOUT_SWEEP_FLOW === '0') for (const l of registeredLayouts()) if (l.flows) overrideLayout({ ...l, flows: undefined });
const areas = (process.env.LAYOUT_SWEEP_AREAS?.split(',').filter(Boolean) ?? registeredLayouts().map((l) => l.areaId)) as AtlasAreaId[];

describe.skipIf(!ON)('layout bot sweep (BALANCE=1)', () => {
  for (const areaId of areas) for (const kind of kinds) {
    it(`${areaId} / ${kind}`, () => {
      const restore = baseline ? overrideLayout(null, areaId) : () => {};
      try {
      const runs = Array.from({ length: seeds }, (_, s) => sweepRun(kind, 'ashenForge', s + 1, { areaId }));
      const row = {
        areaId, kind, seeds, baseline,
        results: runs.map((r) => r.result[0]).join(''),
        minutes: runs.map((r) => Math.round(r.minutes * 10) / 10),
        events: runs.map((r) => (r.event ? r.event.grade : '-')).join(''),
        errors: runs.reduce((a, r) => a + r.errors, 0),
        ...(runs.some((r) => r.stuckAt) ? { stuck: runs.map((r, i) => (r.stuckAt ? `seed ${i + 1}: ${r.stuckAt}` : '')).filter(Boolean) } : {}),
      };
      const line = JSON.stringify(row);
      if (out) appendFileSync(out, `${line}\n`); else process.stderr.write(`${line}\n`);
      expect(row.errors).toBe(0);
      } finally { restore(); }
    }, 3_600_000);
  }
});

/** Packs (and every other monster) must never appear inside a solid prop: checked on every new monster of a plain run. */
describe.skipIf(!ON || process.env.LAYOUT_SWEEP_AUDIT === '0')('layout solids audit (BALANCE=1)', () => {
  for (const areaId of areas) {
    it(`${areaId}: no monster spawns inside a solid prop`, () => {
      const restore = baseline ? overrideLayout(null, areaId) : () => {};
      try {
      const bad: string[] = [];
      let spawned = 0, minutes = 0, pinned = 0, relocated = 0, nudged = 0;
      const pinExamples: string[] = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const { run, world } = createRunInternal(makeConfig({ theme: areaTheme(areaId), seed, arenaRadius: areaRadius(areaId), scaling: { ...TIER5 }, areaId }));
        run.addPlayer(makeJoin(1, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
        const bot = createBot();
        const seen = new Set<number>();
        const pin = pinnedMonsters();
        const solids = world.props.filter((p) => p.solid);
        for (let t = 0; t < Math.round((20 * 60) / SIM_DT); t++) {
          run.setIntent(1, bot.intent(run.view, 1));
          run.step();
          run.drainEvents();
          const m = world.monsters;
          for (let i = 0; i < m.hwm; i++) {
            if (!m.alive[i] || seen.has(m.id[i])) continue;
            seen.add(m.id[i]);
            spawned++;
            for (const p of solids) if (Math.hypot(m.x[i] - p.x, m.y[i] - p.y) < p.radius - 2) { bad.push(`seed ${seed} t=${world.time.toFixed(0)}s wave ${world.director.wave} monsterKind#${m.kind[i]} rarity#${m.rarity[i]} at ${m.x[i].toFixed(0)},${m.y[i].toFixed(0)} inside ${p.kind}@${p.x.toFixed(0)},${p.y.toFixed(0)} r${p.radius}`); break; }
          }
          if (t % 30 === 0) pin.sample(world);
          const o = run.drainOutcomes();
          if (o.some((x) => x.t === 'playerDied' || x.t === 'cleared')) break;
        }
        pinned += pin.ids.size;
        pinExamples.push(...pin.examples.slice(0, 2).map((e) => `seed ${seed} ${e}`));
        { const st = navStats(world); if (st) { relocated += st.relocated; nudged += st.nudged; } }
        minutes += world.tick * SIM_DT / 60;
      }
      const line = JSON.stringify({ areaId, baseline, audit: 'solids', spawned, minutes: Math.round(minutes), pinned5s: pinned, navNudged: nudged, navRelocated: relocated, pinExamples: pinExamples.slice(0, 3), inSolid: bad.length, examples: bad.slice(0, 3) });
      if (out) appendFileSync(out, `${line}\n`); else process.stderr.write(`${line}\n`);
      expect(bad, `${areaId}: monsters spawned inside solids`).toEqual([]);
      } finally { restore(); }
    }, 3_600_000);
  }
});
