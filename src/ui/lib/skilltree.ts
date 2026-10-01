// Skill tree layout: branches become column groups, tiers become rows; a lone node sits under its in-branch
// prerequisite so connectors run straight down. Pure; covered by tests/ui/helpers.test.ts.
import type { SkillId } from '../../contracts/content';
import type { SkillInfo } from '../../contracts/game';

export const BRANCH_ORDER: readonly SkillInfo['branch'][] = ['basic', 'destruction', 'mobility', 'survival'];
export const BRANCH_LABEL: Readonly<Record<SkillInfo['branch'], string>> = {
  basic: 'Basic',
  destruction: 'Destruction',
  mobility: 'Mobility',
  survival: 'Survival',
};

export interface TreeNode {
  id: SkillId;
  /** Column centre in column units (0 = left edge). */
  x: number;
  /** Row index (tier − 1). */
  y: number;
}

export interface TreeBranch {
  branch: SkillInfo['branch'];
  start: number;
  width: number;
}

export interface TreeLayout {
  nodes: TreeNode[];
  branches: TreeBranch[];
  columns: number;
  rows: number;
  edges: { from: SkillId; to: SkillId; rank: number }[];
}

export function layoutSkillTree(skills: readonly SkillInfo[]): TreeLayout {
  const nodes: TreeNode[] = [];
  const branches: TreeBranch[] = [];
  const pos = new Map<SkillId, TreeNode>();
  let start = 0;
  let rows = 0;
  for (const branch of BRANCH_ORDER) {
    const inBranch = skills.filter((s) => s.branch === branch);
    if (!inBranch.length) continue;
    const byTier = new Map<number, SkillInfo[]>();
    for (const s of inBranch) byTier.set(s.tier, [...(byTier.get(s.tier) ?? []), s]);
    const width = Math.max(...[...byTier.values()].map((l) => l.length));
    for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
      const list = byTier.get(tier)!;
      list.forEach((s, i) => {
        let x = start + ((i + 0.5) * width) / list.length;
        const pre = s.prerequisite ? pos.get(s.prerequisite.skillId) : undefined;
        if (list.length === 1 && pre && inBranch.some((b) => b.id === s.prerequisite!.skillId)) x = pre.x;
        const node = { id: s.id, x, y: tier - 1 };
        nodes.push(node);
        pos.set(s.id, node);
        rows = Math.max(rows, tier);
      });
    }
    branches.push({ branch, start, width });
    start += width;
  }
  const edges = skills
    .filter((s) => s.prerequisite && pos.has(s.prerequisite.skillId))
    .map((s) => ({ from: s.prerequisite!.skillId, to: s.id, rank: s.prerequisite!.rank }));
  return { nodes, branches, columns: start, rows, edges };
}
