#!/usr/bin/env node
// Layout lint (docs/atlas-rework/D-territory.md 10.3/10.4): runs the validator checks (1 to 10, see src/sim/layout-validate.ts) over every registered
// layout (src/data/layouts AREA_LAYOUTS) and prints one line per issue for PR review. Exit code 1 when any check fails.
//
//   npm run layout:lint                  registered layouts (none until a pack lands)
//   npm run layout:lint -- --fixtures    also the two test fixtures (slag-yard, sand-ring)
//   npm run layout:lint -- --area emberRoad    only this area
import { register } from 'tsx/esm/api';

register();
const args = process.argv.slice(2);
const withFixtures = args.includes('--fixtures');
const ai = args.indexOf('--area');
const only = ai >= 0 ? args[ai + 1] : null;

const { registeredLayouts } = await import('../src/data/layouts/index.ts');
const { validateLayout, checkDeterminism, formatIssues } = await import('../src/sim/layout-validate.ts');
const { makeConfig, makeJoin } = await import('../tests/sim/fixtures.ts');
const { areaTheme } = await import('../src/data/layouts/area.ts');
const { FIXTURE_LAYOUTS } = await import('../src/data/layouts/fixtures/index.ts');

const layouts = [...registeredLayouts(), ...(withFixtures ? FIXTURE_LAYOUTS : [])].filter((l) => !only || l.areaId === only);
if (layouts.length === 0) {
  console.log('layout-lint: no registered layouts (areas without a layout keep the old generator). Use --fixtures to lint the samples.');
  process.exit(0);
}

const det = {
  makeConfig: (areaId, seed, R) => makeConfig({ seed, arenaRadius: R, areaId, theme: areaTheme(areaId) }),
  addPlayer: (run) => run.addPlayer(makeJoin(1)),
};

let failed = 0;
for (const layout of layouts) {
  const report = validateLayout(layout);
  const issues = [...report.issues, ...checkDeterminism(layout, det)];
  const s = report.stats;
  const tag = layout.fixture ? ' (fixture)' : '';
  const head = `${layout.areaId}${tag}  R ${Math.round(report.R)}  props ${s.props} (${s.solids} solid)  solids ${(s.solidDensity * 100).toFixed(1)}%  anchors ${s.anchors}`;
  if (issues.length === 0) console.log(`ok    ${head}`);
  else {
    failed++;
    console.log(`FAIL  ${head}`);
    for (const line of formatIssues({ ...report, issues })) console.log(line);
  }
}
console.log(failed === 0 ? `layout-lint: ${layouts.length} layout(s) pass all checks` : `layout-lint: ${failed} of ${layouts.length} layout(s) failed`);
process.exit(failed === 0 ? 0 : 1);
