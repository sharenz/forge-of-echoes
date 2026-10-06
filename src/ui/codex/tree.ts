// The generic tree model behind the Codex view: any node graph with an origin, point costs, links and exclusion pairs.
// A binding says where each node sits in world px, which plate, tone and glyph it wears, whether it can be taken at all
// and what search should match; the model answers the pure graph questions the UI asks (state, exclusions, cheapest
// path, refundability, search, arrow-key neighbours). The Atlas Codex binds it to MAP_TREE (model.ts); the Orrery binds
// it to the passive tree; tests bind it to small hand-made graphs. Plain data + functions, no DOM.
import { PLATE_R, type PlateClass } from '../../art/codex/tones';
import type { GlyphId } from '../../art/codex/glyphs';

export type TreeState = 'on' | 'ready' | 'locked' | 'gated';

/** What every tree node needs for the graph questions. */
export interface TreeNodeData {
  id: string;
  name: string;
  /** Undirected links (both ends list each other). */
  links: readonly string[];
  /** Mutually exclusive partners (either end may list the pair). */
  excludes: readonly string[];
  /** Points to allocate. */
  cost: number;
}

export interface TreeBinding<N extends TreeNodeData, T extends string = string> {
  /** The always-on root every path starts from (it is `nodes[0]`). */
  originId: string;
  /** Every node, origin first. */
  nodes: readonly N[];
  /** False for nodes that are drawn and priced but cannot be taken yet (state `gated`). */
  allocatable(n: N): boolean;
  /** World position in art px (rounded by the model). */
  place(n: N): { x: number; y: number };
  plateClass(n: N): PlateClass;
  tone(n: N): { tone: T; tone2?: T };
  glyph(n: N): GlyphId;
  /** Free text search matches against (name, effect text, class, group...). */
  searchText(n: N): string;
  /** The currency a node costs, singular ("Atlas point"); "s" is appended for plurals. */
  pointName: string;
  /** Why a gated node cannot be taken yet. */
  gateReason(n: N): string;
}

/** Why a node can or cannot be allocated now, with the text the rail and tooltip show. */
export type TreeVerdict<N> =
  | { kind: 'allocated' }
  | { kind: 'ready' }
  | { kind: 'gated'; reason: string }
  | { kind: 'excluded'; by: N; reason: string }
  | { kind: 'unaffordable'; reason: string }
  | { kind: 'far'; reason: string; path: PathPreview | null };

/** A node laid out for the view. */
export interface TreeNode<N extends TreeNodeData = TreeNodeData, T extends string = string> {
  node: N;
  id: string;
  x: number;
  y: number;
  cls: PlateClass;
  tone: T;
  tone2?: T;
  glyph: GlyphId;
  /** Visible plate radius in world px (hit testing). */
  r: number;
  /** Index in `nodes` (origin first). */
  i: number;
}

export interface PathPreview {
  /** Nodes to allocate, in order from your tree to the target (the target is last). */
  nodes: string[];
  /** Total points. */
  cost: number;
}

export type ArrowDir = 'left' | 'right' | 'up' | 'down';

export interface TreeModel<N extends TreeNodeData = TreeNodeData, T extends string = string> {
  readonly originId: string;
  readonly nodes: readonly TreeNode<N, T>[];
  readonly byId: ReadonlyMap<string, TreeNode<N, T>>;
  /** Undirected edges once each (ordered by node index). */
  readonly edges: readonly { a: TreeNode<N, T>; b: TreeNode<N, T> }[];
  find(id: string | undefined): N | undefined;
  allocatable(n: N): boolean;
  /** The allocated node an exclusion pair clashes with (either direction), if any. */
  exclusionOf(node: N, allocated: ReadonlySet<string>): N | undefined;
  linkedToPath(node: N, allocated: ReadonlySet<string>): boolean;
  nodeState(node: N, allocated: ReadonlySet<string>): TreeState;
  /** True if the allocated set stays connected to the origin without `id`. */
  canRefund(id: string, allocated: ReadonlySet<string>): boolean;
  /** Allocated nodes that would be cut off from the origin by refunding `id`. */
  dependants(id: string, allocated: ReadonlySet<string>): string[];
  /**
   * Cheapest way to allocate `target` from what is allocated now (Dijkstra over point costs). Gated nodes and nodes that
   * clash with an allocated exclusion cannot be crossed. Null when no way exists.
   */
  pathTo(target: string, allocated: ReadonlySet<string>): PathPreview | null;
  /** Ids of every node that can be taken right now. */
  reachableSet(allocated: ReadonlySet<string>): Set<string>;
  /** Ids of nodes matching every word of the query. Empty query matches nothing; the origin never matches. */
  searchNodes(query: string): Set<string>;
  /** The nearest node from `from` in a screen direction (arrow-key focus moves). */
  nearestNode(from: TreeNode<N, T>, dir: ArrowDir): TreeNode<N, T> | null;
  /** Can `node` be allocated now with `free` points, and if not, why. */
  verdict(node: N, allocated: ReadonlySet<string>, free: number): TreeVerdict<N>;
}

const norm = (s: string): string => s.toLowerCase().replace(/['’]/g, '');

export function createTreeModel<N extends TreeNodeData, T extends string>(b: TreeBinding<N, T>): TreeModel<N, T> {
  const origin = b.originId;
  const nodes: readonly TreeNode<N, T>[] = b.nodes.map((node, i) => {
    const p = b.place(node);
    const cls = b.plateClass(node);
    return { node, id: node.id, x: Math.round(p.x), y: Math.round(p.y), cls, ...b.tone(node), glyph: b.glyph(node), r: PLATE_R[cls], i };
  });
  const byId: ReadonlyMap<string, TreeNode<N, T>> = new Map(nodes.map((n) => [n.id, n]));
  const edges = nodes.flatMap((a) => a.node.links.map((l) => byId.get(l)!).filter((x) => x && x.i > a.i).map((x) => ({ a, b: x })));
  const find = (id: string | undefined): N | undefined => (id === undefined ? undefined : byId.get(id)?.node);
  const allocatable = (n: N): boolean => b.allocatable(n);

  const exclusionOf = (node: N, allocated: ReadonlySet<string>): N | undefined => {
    for (const id of allocated) {
      const other = find(id);
      if (other && (node.excludes.includes(id) || other.excludes.includes(node.id))) return other;
    }
    return undefined;
  };
  const linkedToPath = (node: N, allocated: ReadonlySet<string>): boolean => node.links.some((l) => l === origin || allocated.has(l));
  const nodeState = (node: N, allocated: ReadonlySet<string>): TreeState => {
    if (node.id === origin || allocated.has(node.id)) return 'on';
    if (!allocatable(node)) return 'gated';
    if (linkedToPath(node, allocated) && !exclusionOf(node, allocated)) return 'ready';
    return 'locked';
  };
  /** Allocated nodes still connected to the origin once `id` is gone. */
  const connectedWithout = (id: string, allocated: ReadonlySet<string>): { rest: Set<string>; seen: Set<string> } => {
    const rest = new Set(allocated);
    rest.delete(id);
    const seen = new Set<string>([origin]);
    const stack = [origin];
    while (stack.length) for (const l of find(stack.pop())?.links ?? []) if (rest.has(l) && !seen.has(l)) { seen.add(l); stack.push(l); }
    return { rest, seen };
  };
  const canRefund = (id: string, allocated: ReadonlySet<string>): boolean => {
    if (!allocated.has(id)) return false;
    const { rest, seen } = connectedWithout(id, allocated);
    return [...rest].every((n) => seen.has(n));
  };
  const dependants = (id: string, allocated: ReadonlySet<string>): string[] => {
    const { rest, seen } = connectedWithout(id, allocated);
    return [...rest].filter((n) => !seen.has(n));
  };

  const pathTo = (target: string, allocated: ReadonlySet<string>): PathPreview | null => {
    const goal = find(target);
    if (!goal || allocated.has(target) || !allocatable(goal) || exclusionOf(goal, allocated)) return null;
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const open: string[] = [];
    const passable = (n: N): boolean => n.id !== origin && !allocated.has(n.id) && allocatable(n) && !exclusionOf(n, allocated);
    // seeds: every unallocated node adjacent to the origin or the tree
    for (const src of [origin, ...allocated]) for (const l of find(src)?.links ?? []) {
      const n = find(l);
      if (!n || !passable(n)) continue;
      if (!dist.has(l) || n.cost < dist.get(l)!) { dist.set(l, n.cost); prev.set(l, null); open.push(l); }
    }
    const done = new Set<string>();
    while (open.length) {
      open.sort((p, q) => dist.get(q)! - dist.get(p)!);
      const id = open.pop()!;
      if (done.has(id)) continue;
      done.add(id);
      if (id === target) break;
      for (const l of find(id)!.links) {
        const n = find(l);
        if (!n || !passable(n) || done.has(l)) continue;
        const d = dist.get(id)! + n.cost;
        if (d < (dist.get(l) ?? Infinity)) { dist.set(l, d); prev.set(l, id); open.push(l); }
      }
    }
    if (!done.has(target)) return null;
    const out: string[] = [];
    for (let at: string | null | undefined = target; at; at = prev.get(at)) out.unshift(at);
    return { nodes: out, cost: dist.get(target)! };
  };

  const reachableSet = (allocated: ReadonlySet<string>): Set<string> =>
    new Set(nodes.filter((n) => n.id !== origin && nodeState(n.node, allocated) === 'ready').map((n) => n.id));

  let haystack: Map<string, string> | null = null;
  const searchNodes = (query: string): Set<string> => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const out = new Set<string>();
    if (!words.length) return out;
    haystack ??= new Map(nodes.map((n) => [n.id, norm(b.searchText(n.node))]));
    for (const [id, hay] of haystack) if (id !== origin && words.every((w) => hay.includes(w))) out.add(id);
    return out;
  };

  const nearestNode = (from: TreeNode<N, T>, dir: ArrowDir): TreeNode<N, T> | null => {
    let best: TreeNode<N, T> | null = null, bestScore = Infinity;
    for (const n of nodes) {
      if (n === from) continue;
      const dx = n.x - from.x, dy = n.y - from.y;
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
      const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 5) continue;
      const score = along + across * 1.8;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  };

  const verdict = (node: N, allocated: ReadonlySet<string>, free: number): TreeVerdict<N> => {
    if (allocated.has(node.id)) return { kind: 'allocated' };
    if (!allocatable(node)) return { kind: 'gated', reason: b.gateReason(node) };
    const clash = exclusionOf(node, allocated);
    if (clash) return { kind: 'excluded', by: clash, reason: `Mutually exclusive with ${clash.name}. Refund ${clash.name} to choose this instead.` };
    if (!linkedToPath(node, allocated)) return { kind: 'far', reason: 'Not connected to your tree yet.', path: pathTo(node.id, allocated) };
    if (node.cost > free) return { kind: 'unaffordable', reason: `Costs ${node.cost} ${b.pointName}${node.cost === 1 ? '' : 's'}; you have ${free}.` };
    return { kind: 'ready' };
  };

  return { originId: origin, nodes, byId, edges, find, allocatable, exclusionOf, linkedToPath, nodeState, canRefund, dependants, pathTo, reachableSet, searchNodes, nearestNode, verdict };
}
