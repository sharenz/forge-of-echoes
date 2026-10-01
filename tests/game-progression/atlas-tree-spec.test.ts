// GAME_SPEC.md and docs/atlas-rework/tree-nodes.md must tell the truth about the Atlas tree data.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATLAS_CAPS, ATLAS_FREE_REFUNDS, ATLAS_RESPEC_COST, ATLAS_RESPEC_SESSION_CAP, ATLAS_WAVE_DURATION_FLOOR, MAP_TREE, MAP_TREE_POINTS,
} from '../../src/data/progression/map-tree';
import { treeMarkdown } from './atlas-tree-doc';

const SPEC = readFileSync(new URL('../../GAME_SPEC.md', import.meta.url), 'utf8');
const DOC_URL = new URL('../../docs/atlas-rework/tree-nodes.md', import.meta.url);

describe('Atlas tree documents', () => {
  it('keeps the generated node list in step with the data', () => {
    if (process.env.UPDATE_ATLAS_DOC) writeFileSync(DOC_URL, treeMarkdown());
    expect(readFileSync(DOC_URL, 'utf8')).toBe(treeMarkdown());
  });

  it('GAME_SPEC names every keystone, the economy numbers and the caps', () => {
    const start = SPEC.indexOf('**Atlas tree, "the Codex"');
    const end = SPEC.indexOf('**Atlas (account-wide).**');
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const s = SPEC.slice(start, end);
    for (const k of MAP_TREE.filter(n => n.kind === 'keystone')) expect(s, k.name).toContain(`**${k.name}**`);
    expect(s).toContain(`${MAP_TREE.length + 1} nodes`);
    expect(s).toContain(`${MAP_TREE_POINTS.total}`);
    expect(s).toContain(`first ${ATLAS_FREE_REFUNDS} refunds`);
    expect(s).toContain(`${ATLAS_RESPEC_SESSION_CAP} Scrap`);
    expect(s).toContain(`small ${ATLAS_RESPEC_COST.small}, notable, tier bonus and theme seal ${ATLAS_RESPEC_COST.notable}, keystone ${ATLAS_RESPEC_COST.keystone}`);
    expect(s).toContain(`${ATLAS_WAVE_DURATION_FLOOR} seconds`);
    expect(s).toContain(`+${ATLAS_CAPS.itemQuantityIncreased}% increased item quantity`);
    expect(s).toContain(`+${ATLAS_CAPS.itemRarityIncreased}% rarity`);
    expect(s).toContain(`+${ATLAS_CAPS.packRarityIncreased}% pack chance`);
    expect(s).toContain(`+${ATLAS_CAPS.mapDropChanceIncreased}% map drop chance`);
    expect(s).toContain(`+${ATLAS_CAPS.eventChancePoints} percentage points encounter chance`);
    expect(s).toContain(`x${ATLAS_CAPS.monsterLifeMoreMultiplier} total`);
    expect(s).not.toContain('Trailblazer');
  });
});
