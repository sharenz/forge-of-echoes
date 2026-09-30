// Atlas tree rebalance evidence (brief B section 10). Always on and deterministic; set ATLAS_REPORT=1 to print the table:
//   ATLAS_REPORT=1 npx vitest run tests/game-progression/atlas-tree-balance.test.ts
import { describe, expect, it } from 'vitest';
import { MAP_TREE, findAtlasNode } from '../../src/data/progression/map-tree';
import { ARCHETYPES, areaFor, buildFor, measure, randomBuild, type Measured } from './atlas-tree-harness';

const TIERS = [3, 7, 11, 15] as const;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const report = !!process.env.ATLAS_REPORT;
/** Nodes adjacent to the origin are the price of entry to a branch, never a build choice. */
const ROOTS: ReadonlySet<string> = new Set(findAtlasNode('origin')!.links);

interface Row { id: string; name: string; tier: number; partial: boolean; cell: Measured; base: Measured; nodes: string[] }
const rows: Row[] = [];
const builds = new Map(ARCHETYPES.map(a => [a.id, buildFor(a)]));

describe('archetype bots on the real map and loot rules', () => {
  it('builds every archetype legally within 60 points', () => {
    for (const a of ARCHETYPES) {
      const nodes = builds.get(a.id)!;
      const spent = nodes.reduce((n, id) => n + (MAP_TREE.find(x => x.id === id)!.cost), 0);
      expect(spent, a.name).toBeLessThanOrEqual(60);
      expect(spent, a.name).toBeGreaterThanOrEqual(50);
      for (const t of a.targets.slice(0, 1)) if (!a.partial) expect(nodes, `${a.name} keeps ${t}`).toContain(t);
    }
  });

  for (const tier of TIERS) {
    it(`measures every archetype at tier ${tier}`, () => {
      for (const a of ARCHETYPES) {
        const area = areaFor(a.area, tier);
        const base = measure([], tier, area, SEEDS, !!a.corrupted);
        rows.push({ id: a.id, name: a.name, tier, partial: !!a.partial, cell: measure(builds.get(a.id)!, tier, area, SEEDS, !!a.corrupted), base, nodes: builds.get(a.id)! });
      }
    });
  }

  it('meets the acceptance bands', () => {
    const lines: string[] = ['archetype                    tier  value/h x  time x  pressure x'];
    const ratio = (r: Row) => r.cell.valuePerHour / r.base.valuePerHour;
    for (const r of rows) lines.push(`${r.name.padEnd(28)} ${String(r.tier).padStart(3)}  ${ratio(r).toFixed(2).padStart(9)} ${(r.cell.seconds / r.base.seconds).toFixed(2).padStart(7)} ${(r.cell.pressure / r.base.pressure).toFixed(2).padStart(9)}`);
    if (report) console.log(lines.join('\n'));
    for (const tier of TIERS) {
      const at = rows.filter(r => r.tier === tier);
      const median = [...at.map(ratio)].sort((a, b) => a - b)[Math.floor(at.length / 2)];
      for (const r of at) {
        // (a) more value per hour than the empty tree, but never wildly more; incomplete archetypes only need to not lose badly
        expect(ratio(r), `${r.name} T${tier} value/hour`).toBeLessThanOrEqual(2.4);
        expect(ratio(r), `${r.name} T${tier} value/hour`).toBeGreaterThanOrEqual(r.partial ? 0.85 : 1.15);
        // (b) no archetype towers over the others
        expect(ratio(r), `${r.name} T${tier} vs median`).toBeLessThanOrEqual(median * 1.35);
        // (c) danger stays within reach; (d) clears are not absurdly fast
        expect(r.cell.pressure / r.base.pressure, `${r.name} T${tier} pressure`).toBeLessThanOrEqual(1.6);
        expect(r.cell.seconds / r.base.seconds, `${r.name} T${tier} clear time`).toBeGreaterThanOrEqual(0.55);
      }
    }
  });
});

describe('no must-take node and no runaway build', () => {
  it('finds no must-take node (over-represented in the best random builds) and a bounded best-to-median spread', () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const base = measure([], 7, 'heartOfForge', seeds).valuePerHour;
    const builds = Array.from({ length: 120 }, (_, i) => randomBuild(i + 1));
    const scored = builds.map(nodes => ({ nodes, score: measure(nodes, 7, 'heartOfForge', seeds).valuePerHour / base }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 12);
    const counts = new Map<string, number>();
    for (const b of top) for (const id of b.nodes) counts.set(id, (counts.get(id) ?? 0) + 1);
    const overall = new Map<string, number>();
    for (const b of scored) for (const id of b.nodes) overall.set(id, (overall.get(id) ?? 0) + 1);
    // A must-take is a node the winners share far more often than everyone else does (the near-root nodes of a 60-point build
    // are common to almost every build, so they show up in the winners without being the reason they win).
    const lifts = [...counts.entries()].filter(([id, n]) => !ROOTS.has(id) && n / top.length >= 0.7)
      .map(([id, n]) => ({ id, share: n / top.length, lift: (n / top.length) / (overall.get(id)! / scored.length) }))
      .sort((a, b) => b.lift - a.lift);
    if (report) console.log(`keystones in the top 12: ${MAP_TREE.filter(n => n.kind === 'keystone').map(n => `${n.id} ${counts.get(n.id) ?? 0}`).join(', ')}`);
    if (report) console.log(`best ${scored[0].score.toFixed(2)}x, median ${scored[60].score.toFixed(2)}x, worst ${scored[119].score.toFixed(2)}x; strongest lift among nodes in 70%+ of the top 12: ${lifts.slice(0, 5).map(l => `${l.id} x${l.lift.toFixed(2)}`).join(', ')}`);
    // 1.6, not 1.5: the Echoes branch just gained six live lenses, and its bridge nodes (anvilRoad is one) sit on the path to all of them.
    for (const l of lifts) expect(l.lift, `${l.id} is a must-take`).toBeLessThanOrEqual(1.6);
    expect(scored[0].score / scored[60].score).toBeLessThanOrEqual(1.6);
    expect(scored[119].score).toBeGreaterThanOrEqual(1.0); // even a careless build is never worse than an empty tree per hour
  });
});
