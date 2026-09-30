// Helpers for the Atlas tree suites: full point progress and shortest connected paths through the wheel.
import { ATLAS_AREA_IDS, ATLAS_EVENT_KIND_IDS, type AtlasProgress } from '../../src/contracts/atlas';
import { ATLAS_ORIGIN_ID, ATLAS_POINT_TIERS, atlasNodeAllocatable, findAtlasNode } from '../../src/data/progression/map-tree';
import { ATLAS_BOSS_KINDS } from '../../src/game/progression/map-tree';
import { bareCharacter, map } from './fixtures';
import type { CharacterSave } from '../../src/contracts/items';

/** Every point source satisfied: 60 points. */
export function fullProgress(nodes: string[] = []): AtlasProgress {
  return {
    discovered: [...ATLAS_AREA_IDS], completed: [...ATLAS_AREA_IDS], clears: 25, treeVersion: 2, nodes,
    tiersCleared: [...ATLAS_POINT_TIERS], eventsSeen: [...ATLAS_EVENT_KIND_IDS], bossesSeen: [...ATLAS_BOSS_KINDS],
  };
}

/** Nodes from the origin to each target (BFS shortest path through nodes that can be allocated), deduplicated, in allocation order. */
export function pathTo(...targets: string[]): string[] {
  const out: string[] = [];
  for (const target of targets) {
    const prev = new Map<string, string>([[ATLAS_ORIGIN_ID, '']]);
    const queue = [ATLAS_ORIGIN_ID];
    while (queue.length && !prev.has(target)) {
      const id = queue.shift()!;
      for (const l of findAtlasNode(id)!.links) if (!prev.has(l) && (l === target || atlasNodeAllocatable(findAtlasNode(l)!))) { prev.set(l, id); queue.push(l); }
    }
    if (!prev.has(target)) throw new Error(`no allocatable path to ${target}`);
    const path: string[] = [];
    for (let id = target; id !== ATLAS_ORIGIN_ID; id = prev.get(id)!) path.unshift(id);
    for (const id of path) if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function treeCharacter(nodes: string[] = [], overrides: Partial<CharacterSave> = {}, tier = 10, base: Parameters<typeof map>[0] = 'ashenForge'): CharacterSave {
  return bareCharacter({ atlas: fullProgress(nodes), currencyStash: { scrap: 1000 }, mapDevice: map(base, tier), ...overrides });
}
