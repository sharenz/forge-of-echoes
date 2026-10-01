// Dev sandbox presets for the Codex (`?tree=` in dev/ui.html): every point earned plus a sample allocation, so the
// Atlas tree can be looked at fresh (tree=open), part-built (tree=mid) and complete (tree=full) without playing for it.
import { ATLAS_AREA_IDS, ATLAS_EVENT_KIND_IDS } from '../../contracts/atlas';
import type { CharacterSave } from '../../contracts/items';
import { ATLAS_POINT_TIERS } from '../../data/progression/map-tree';
import { ATLAS_BOSS_KINDS } from '../../game/progression/map-tree';
import { sampleAllocation } from '../codex/model';

export type MockTree = 'open' | 'mid' | 'full';
export const MOCK_TREE_POINTS: Record<MockTree, number> = { open: 0, mid: 14, full: 60 };

export function withTree(ch: CharacterSave, kind: MockTree, prefer: readonly string[] = ['foundry', 'fortune']): CharacterSave {
  const atlas = ch.atlas ?? { discovered: [], completed: [], clears: 0 };
  return {
    ...ch,
    currencyStash: { ...ch.currencyStash, scrap: Math.max(120, ch.currencyStash.scrap ?? 0) },
    atlas: {
      ...atlas,
      discovered: [...new Set([...atlas.discovered, ...ATLAS_AREA_IDS])],
      completed: [...ATLAS_AREA_IDS],
      clears: Math.max(atlas.clears, ATLAS_AREA_IDS.length),
      tiersCleared: [...ATLAS_POINT_TIERS],
      eventsSeen: [...ATLAS_EVENT_KIND_IDS],
      bossesSeen: [...ATLAS_BOSS_KINDS],
      nodes: sampleAllocation(MOCK_TREE_POINTS[kind], prefer),
    },
  };
}
