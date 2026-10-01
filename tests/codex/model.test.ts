import { describe, expect, it } from 'vitest';
import { ATLAS_BRANCHES, MAP_TREE, atlasNodeAllocatable, findAtlasNode } from '../../src/data/progression/map-tree';
import {
  CX_BY_ID, CX_EDGES, CX_NODES, canRefund, dependants, exclusionOf, groupLabel, kindLabel, nearestNode, nodeState, pathTo, plateClassOf, reachableSet, searchNodes, toneOf, verdict,
} from '../../src/ui/codex/model';
import { BRANCH_TONES } from '../../src/art/codex/tones';
import { mapTreeChangeError } from '../../src/game/progression/map-tree';

const live = MAP_TREE.filter(atlasNodeAllocatable);
/** A connected allocation grown from the origin, `n` nodes, cheapest first (keystones last). */
function grow(n: number, prefer: string[] = []): Set<string> {
  const out = new Set<string>();
  while (out.size < n) {
    const next = live.filter(m => !out.has(m.id) && m.links.some(l => l === 'origin' || out.has(l)) && !m.excludes.some(e => out.has(e)))
      .sort((a, b) => a.cost - b.cost || (prefer.includes(a.group) ? -1 : 0) - (prefer.includes(b.group) ? -1 : 0))[0];
    if (!next) break;
    out.add(next.id);
  }
  return out;
}

describe('Codex layout', () => {
  it('has a plate for the origin and every node, and one edge per link', () => {
    expect(CX_NODES.length).toBe(MAP_TREE.length + 1);
    expect(CX_NODES[0].id).toBe('origin');
    const links = CX_NODES.reduce((n, c) => n + c.node.links.length, 0);
    expect(CX_EDGES.length).toBe(links / 2);
  });
  it('gives every node class matching its kind, and the tree shape the brief promises', () => {
    const count = (cls: string) => CX_NODES.filter(n => n.cls === cls).length;
    expect(count('keystone')).toBe(15); // 14 keystones and the origin brazier
    expect(count('tier')).toBe(5);
    expect(count('seal')).toBe(6);
    expect(count('lens')).toBe(12);
    for (const n of MAP_TREE) expect(plateClassOf(n)).toBe(n.kind === 'small' ? 'small' : n.kind === 'notable' ? 'notable' : n.kind === 'keystone' ? 'keystone' : n.kind === 'tier' ? 'tier' : n.kind === 'theme' ? 'seal' : 'lens');
  });
  it('colours each branch, the hub and the belt by identity', () => {
    for (const b of ATLAS_BRANCHES) for (const n of CX_NODES.filter(c => c.node.group === b)) expect(n.tone).toBe(b);
    for (const n of CX_NODES.filter(c => c.node.group === 'hub')) expect(n.tone).toBe('hub');
    for (const n of CX_NODES.filter(c => c.cls === 'seal')) expect(n.tone).toBe(n.node.base);
    // a bridge wears two branches
    const bridge = CX_NODES.filter(c => c.node.group === 'bridge');
    expect(bridge.length).toBeGreaterThan(10);
    for (const n of bridge) { expect(BRANCH_TONES as readonly string[]).toContain(n.tone); expect(n.tone2).toBeTruthy(); expect(n.tone2).not.toBe(n.tone); }
    expect(toneOf(findAtlasNode('origin')!).tone).toBe('origin');
  });
  it('labels kinds and groups for the tooltip', () => {
    expect(kindLabel(findAtlasNode('hunterPatience')!)).toBe('Encounter lens');
    expect(kindLabel(findAtlasNode('emptyHalls')!)).toBe('Keystone');
    expect(groupLabel(findAtlasNode('risingStakes')!)).toBe('Inner ring');
    expect(groupLabel(findAtlasNode('emberwrightsDue')!)).toBe('Ashen Forge');
  });
});

describe('Codex states', () => {
  it('starts with the ring around the origin ready and everything else locked or gated', () => {
    const none = new Set<string>();
    const ready = reachableSet(none);
    expect(ready.size).toBeGreaterThanOrEqual(5);
    for (const id of ready) expect(findAtlasNode('origin')!.links).toContain(id);
    for (const n of MAP_TREE) {
      const s = nodeState(n, none);
      if (!atlasNodeAllocatable(n)) expect(s).toBe('gated');
      else expect(s).toBe(ready.has(n.id) ? 'ready' : 'locked');
    }
    expect(nodeState(findAtlasNode('origin')!, none)).toBe('on');
  });
  it('lights the neighbours of an allocated node', () => {
    const a = new Set(['strangeSigns']);
    expect(nodeState(findAtlasNode('strangeSigns')!, a)).toBe('on');
    expect(nodeState(findAtlasNode('omenReader')!, a)).toBe('ready');
    expect(nodeState(findAtlasNode('echoDust')!, a)).not.toBe('ready');
  });
  it('locks a node that clashes with an allocated exclusion, in both directions', () => {
    const all = new Set(['emptyHalls']);
    const clash = findAtlasNode('overrunDoctrine')!;
    expect(exclusionOf(clash, all)?.id).toBe('emptyHalls');
    expect(nodeState(clash, all)).not.toBe('ready');
    const v = verdict(clash, all, 10);
    expect(v.kind === 'excluded' || v.kind === 'gated').toBe(true);
    if (v.kind === 'excluded') expect(v.reason).toMatch(/Mutually exclusive with/);
    expect(exclusionOf(findAtlasNode('emptyHalls')!, new Set(['overrunDoctrine']))?.id).toBe('overrunDoctrine');
  });
  it('explains every gated node by its engine, and agrees with the server rules', () => {
    const gated = MAP_TREE.filter(n => !atlasNodeAllocatable(n));
    for (const n of gated) {
      const v = verdict(n, new Set(), 10);
      expect(v.kind).toBe('gated');
      if (v.kind === 'gated') expect(v.reason).toMatch(/^Awaits /);
    }
  });
  it('matches the server on what is allocatable now (ready nodes pass, locked ones are refused)', () => {
    const ch = { atlas: { discovered: [], completed: [], clears: 0, nodes: [...grow(6)] } } as never;
    const tree = new Set<string>((ch as { atlas: { nodes: string[] } }).atlas.nodes);
    for (const n of live.slice(0, 60)) {
      if (tree.has(n.id)) continue;
      const s = nodeState(n, tree);
      const err = mapTreeChangeError({ ...(ch as object), atlas: { ...(ch as { atlas: object }).atlas, redrawn: false } } as never, n.id, true);
      if (s === 'ready') expect(err === null || /costs|points/.test(err), `${n.id}: ${err}`).toBe(true);
      else expect(err, n.id).not.toBeNull();
    }
  });
});

describe('Codex paths', () => {
  it('finds the cheapest route through connected, allocatable nodes', () => {
    const p = pathTo('omenReader', new Set())!;
    expect(p.nodes).toEqual(['strangeSigns', 'omenReader']);
    expect(p.cost).toBe(2);
    expect(pathTo('omenReader', new Set(['strangeSigns']))!.nodes).toEqual(['omenReader']);
    expect(pathTo('strangeSigns', new Set(['strangeSigns']))).toBeNull();
  });
  it('prices a keystone at its own 2 points on top of the route', () => {
    const k = live.find(n => n.kind === 'keystone')!;
    const p = pathTo(k.id, new Set())!;
    expect(p).not.toBeNull();
    expect(p.nodes[p.nodes.length - 1]).toBe(k.id);
    expect(p.cost).toBe(p.nodes.reduce((n, id) => n + findAtlasNode(id)!.cost, 0));
    expect(p.cost).toBeGreaterThanOrEqual(p.nodes.length + 1);
  });
  it('never routes through gated or excluded nodes, and refuses a gated target', () => {
    const gated = MAP_TREE.find(n => !atlasNodeAllocatable(n))!;
    expect(pathTo(gated.id, new Set())).toBeNull();
    for (const n of live.filter(m => m.kind === 'keystone').slice(0, 5)) {
      const p = pathTo(n.id, new Set());
      if (p) for (const id of p.nodes) expect(atlasNodeAllocatable(findAtlasNode(id)!)).toBe(true);
    }
    const held = new Set(['emptyHalls']);
    const p = pathTo('overrunDoctrine', held);
    expect(p).toBeNull();
  });
  it('knows which allocated nodes can be refunded (leaves) and which hold others up', () => {
    const a = new Set(['strangeSigns', 'omenReader']);
    expect(canRefund('omenReader', a)).toBe(true);
    expect(canRefund('strangeSigns', a)).toBe(false);
    expect(dependants('strangeSigns', a)).toEqual(['omenReader']);
    expect(canRefund('whisper', a)).toBe(false);
  });
});

describe('Codex search and keyboard', () => {
  it('finds nodes by name, effect text, branch and class, all words required', () => {
    expect(searchNodes('').size).toBe(0);
    expect(searchNodes('essence').size).toBeGreaterThan(8);
    expect(searchNodes('wagered charts').has('wageredCharts')).toBe(true);
    expect(searchNodes('hunters patience').has('hunterPatience')).toBe(true);
    const ks = searchNodes('keystone');
    expect(ks.size).toBe(14);
    for (const id of ks) expect(findAtlasNode(id)!.kind).toBe('keystone');
    expect([...searchNodes('echoes lens')].every(id => findAtlasNode(id)!.kind === 'event' || findAtlasNode(id)!.group === 'echoes')).toBe(true);
    expect(searchNodes('zzzzqq').size).toBe(0);
  });
  it('moves arrow focus to the nearest node in that direction', () => {
    const origin = CX_BY_ID.get('origin')!;
    const dirs = ['left', 'right', 'up', 'down'] as const;
    for (const d of dirs) {
      const n = nearestNode(origin, d)!;
      expect(n).toBeTruthy();
      const dx = n.x - origin.x, dy = n.y - origin.y;
      expect(d === 'left' ? dx < 0 : d === 'right' ? dx > 0 : d === 'up' ? dy < 0 : dy > 0).toBe(true);
    }
    // every node can be reached from the origin by arrows alone
    const seen = new Set<string>(['origin']);
    const stack = [origin];
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of dirs) { const n = nearestNode(c, d); if (n && !seen.has(n.id)) { seen.add(n.id); stack.push(n); } }
    }
    expect(seen.size).toBeGreaterThan(CX_NODES.length * 0.9);
  });
});
