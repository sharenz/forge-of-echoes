// Generates docs/atlas-rework/tree-nodes.md from the tree data. Regenerate with:
//   UPDATE_ATLAS_DOC=1 npx vitest run tests/game-progression/atlas-tree-spec.test.ts
import { ENGINE_LABEL, MAP_TREE, nodeUnits } from '../../src/data/progression/map-tree';

const GROUPS: [string, string][] = [
  ['cartography', 'Cartography'], ['foundry', 'Foundry'], ['bounty', 'Bounty'], ['fortune', 'Fortune'], ['echoes', 'Echoes'], ['peril', 'Peril'],
  ['hub', 'Tier bonuses (inner ring)'], ['bridge', 'Bridges'], ['belt', 'Theme seals and gatehouses (outer belt)'],
];
const KIND: Record<string, string> = { small: 'S', notable: 'N', keystone: 'K', tier: 'T', theme: 'Seal', event: 'N (lens)' };

export const HEADER = `# Atlas tree: every node

Generated from \`src/data/progression/map-tree.ts\` (the data is the source of truth). \`tests/game-progression/atlas-tree-spec.test.ts\`
fails when this file differs from the data; regenerate it with \`UPDATE_ATLAS_DOC=1 npx vitest run tests/game-progression/atlas-tree-spec.test.ts\`.
Type: S small, N notable, K keystone, T tier bonus, Seal theme seal. Net is reward minus carried danger in ledger units (tier bonuses at
Tier 15, everything else at Tier 9). Status "Awaits ..." means the node is fully specified but its engine is not live, so it cannot be allocated yet.

`;

export function treeMarkdown(): string {
  const out: string[] = [];
  for (const [g, label] of GROUPS) {
    out.push(`**${label}**`, '', '| Node | Type | Cost | Effect | Net | Status |', '|---|---|---|---|---|---|');
    for (const n of MAP_TREE.filter(x => x.group === g)) {
      const u = nodeUnits(n, n.kind === 'tier' ? 15 : 9);
      out.push(`| **${n.name}** | ${KIND[n.kind]} | ${n.cost} | ${n.text.replace(/\|/g, '/')} | ${u.net.toFixed(1)}u | ${n.engine === 'live' ? 'Active' : ENGINE_LABEL[n.engine]} |`);
    }
    out.push('');
  }
  return HEADER + out.join('\n');
}
