// The Codex view model: the 145-node wheel laid out in Codex world px, each node's plate class, colour identity and
// glyph, and the pure graph questions the UI asks (state, gates, exclusions, cheapest path, refundability, search).
// Everything here is plain data + functions so tests can cover it without a DOM.
import {
  ATLAS_ORIGIN_ID, ENGINE_LABEL, MAP_TREE, MAP_TREE_ORIGIN, atlasNodeAllocatable, findAtlasNode, type AtlasNode,
} from '../../data/progression/map-tree';
import { BRANCH_TONES, PLATE_R, PLATE_SIZE, TONES, type PlateClass, type Tone } from '../../art/codex/tones';
import { toWorld } from '../../art/codex/board';
import { glyphFor, type GlyphId } from '../../art/codex/glyphs';

export type CxState = 'on' | 'ready' | 'locked' | 'gated';

export interface CxNode {
  node: AtlasNode;
  id: string;
  x: number;
  y: number;
  cls: PlateClass;
  tone: Tone;
  tone2?: Tone;
  glyph: GlyphId;
  /** Visible plate radius in world px (hit testing). */
  r: number;
  /** Index in `CX_NODES` (origin first). */
  i: number;
}

export function plateClassOf(node: AtlasNode): PlateClass {
  switch (node.kind) {
    case 'keystone': case 'origin': return 'keystone';
    case 'notable': return 'notable';
    case 'event': return 'lens';
    case 'tier': return 'tier';
    case 'theme': return 'seal';
    default: return 'small';
  }
}

function branchOf(n: AtlasNode): Tone | null {
  return (BRANCH_TONES as readonly string[]).includes(n.group) ? (n.group as Tone) : null;
}

export function toneOf(node: AtlasNode): { tone: Tone; tone2?: Tone } {
  if (node.group === 'origin') return { tone: 'origin' };
  if (node.group === 'hub') return { tone: 'hub' };
  const own = branchOf(node);
  if (own) return { tone: own };
  if (node.base) return { tone: node.base };
  if (node.group === 'belt') {
    // belt smalls hang between two branches; their theme seal (the node that names the base) sits one step out
    const seal = node.links.map(l => findAtlasNode(l)).find(n => n?.base);
    if (seal?.base) return { tone: seal.base };
  }
  // bridge: the two branches it joins
  const parents = [...new Set(node.links.map(l => findAtlasNode(l)).map(n => (n ? branchOf(n) : null)).filter((t): t is Tone => !!t))];
  return { tone: parents[0] ?? 'hub', ...(parents[1] ? { tone2: parents[1] } : {}) };
}

const all = [MAP_TREE_ORIGIN, ...MAP_TREE];
export const CX_NODES: readonly CxNode[] = all.map((node, i) => {
  const p = toWorld(node.pos);
  const cls = plateClassOf(node);
  const tt = toneOf(node);
  return { node, id: node.id, x: Math.round(p.x), y: Math.round(p.y), cls, ...tt, glyph: node.id === ATLAS_ORIGIN_ID ? 'flame' : glyphFor(node), r: PLATE_R[cls], i };
});
export const CX_BY_ID: ReadonlyMap<string, CxNode> = new Map(CX_NODES.map(n => [n.id, n]));
export const CX_SIZE = PLATE_SIZE;

/** Undirected edges once each (ordered by node index). */
export const CX_EDGES: readonly { a: CxNode; b: CxNode }[] = CX_NODES.flatMap(a =>
  a.node.links.map(l => CX_BY_ID.get(l)!).filter(b => b && b.i > a.i).map(b => ({ a, b })));

// ---- kinds and labels --------------------------------------------------------------------------------------
export function kindLabel(n: AtlasNode): string {
  switch (n.kind) {
    case 'keystone': return 'Keystone';
    case 'notable': return 'Notable';
    case 'event': return 'Encounter lens';
    case 'tier': return 'Tier bonus';
    case 'theme': return 'Theme seal';
    case 'origin': return 'Origin';
    default: return n.group === 'bridge' ? 'Bridge' : n.group === 'belt' ? 'Belt node' : 'Small node';
  }
}
export function groupLabel(n: AtlasNode): string {
  if (n.group === 'origin') return 'Cinder Crossing';
  if (n.group === 'hub') return 'Inner ring';
  if (n.group === 'bridge') return 'Bridge';
  if (n.group === 'belt') return n.base ? TONES[n.base].label : 'Outer belt';
  return TONES[n.group as Tone]?.label ?? n.group;
}

// ---- graph questions -------------------------------------------------------------------------------------
/** The allocated node an exclusion pair clashes with (either direction), if any. */
export function exclusionOf(node: AtlasNode, allocated: ReadonlySet<string>): AtlasNode | undefined {
  for (const id of allocated) {
    const other = findAtlasNode(id);
    if (other && (node.excludes.includes(id) || other.excludes.includes(node.id))) return other;
  }
  return undefined;
}

export function linkedToPath(node: AtlasNode, allocated: ReadonlySet<string>): boolean {
  return node.links.some(l => l === ATLAS_ORIGIN_ID || allocated.has(l));
}

export function nodeState(node: AtlasNode, allocated: ReadonlySet<string>): CxState {
  if (node.id === ATLAS_ORIGIN_ID || allocated.has(node.id)) return 'on';
  if (!atlasNodeAllocatable(node)) return 'gated';
  if (linkedToPath(node, allocated) && !exclusionOf(node, allocated)) return 'ready';
  return 'locked';
}

/** True if the allocated set stays connected to the origin without `id`. */
export function canRefund(id: string, allocated: ReadonlySet<string>): boolean {
  if (!allocated.has(id)) return false;
  const rest = new Set(allocated);
  rest.delete(id);
  const seen = new Set<string>([ATLAS_ORIGIN_ID]);
  const stack = [ATLAS_ORIGIN_ID];
  while (stack.length) for (const l of findAtlasNode(stack.pop())?.links ?? []) if (rest.has(l) && !seen.has(l)) { seen.add(l); stack.push(l); }
  return [...rest].every(n => seen.has(n));
}

/** Allocated nodes that would be cut off from the origin by refunding `id`. */
export function dependants(id: string, allocated: ReadonlySet<string>): string[] {
  const rest = new Set(allocated);
  rest.delete(id);
  const seen = new Set<string>([ATLAS_ORIGIN_ID]);
  const stack = [ATLAS_ORIGIN_ID];
  while (stack.length) for (const l of findAtlasNode(stack.pop())?.links ?? []) if (rest.has(l) && !seen.has(l)) { seen.add(l); stack.push(l); }
  return [...rest].filter(n => !seen.has(n));
}

export interface PathPreview {
  /** Nodes to allocate, in order from your tree to the target (the target is last). */
  nodes: string[];
  /** Total Atlas points. */
  cost: number;
}

/**
 * Cheapest way to allocate `target` from what is allocated now (Dijkstra over point costs). Gated nodes and nodes that
 * clash with an allocated exclusion cannot be crossed. Null when no way exists.
 */
export function pathTo(target: string, allocated: ReadonlySet<string>): PathPreview | null {
  const goal = findAtlasNode(target);
  if (!goal || allocated.has(target) || !atlasNodeAllocatable(goal) || exclusionOf(goal, allocated)) return null;
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const open: string[] = [];
  const passable = (n: AtlasNode): boolean => n.id !== ATLAS_ORIGIN_ID && !allocated.has(n.id) && atlasNodeAllocatable(n) && !exclusionOf(n, allocated);
  // seeds: every unallocated node adjacent to the origin or the tree
  for (const src of [ATLAS_ORIGIN_ID, ...allocated]) for (const l of findAtlasNode(src)?.links ?? []) {
    const n = findAtlasNode(l);
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
    for (const l of findAtlasNode(id)!.links) {
      const n = findAtlasNode(l);
      if (!n || !passable(n) || done.has(l)) continue;
      const d = dist.get(id)! + n.cost;
      if (d < (dist.get(l) ?? Infinity)) { dist.set(l, d); prev.set(l, id); open.push(l); }
    }
  }
  if (!done.has(target)) return null;
  const nodes: string[] = [];
  for (let at: string | null | undefined = target; at; at = prev.get(at)) nodes.unshift(at);
  return { nodes, cost: dist.get(target)! };
}

export function reachableSet(allocated: ReadonlySet<string>): Set<string> {
  return new Set(MAP_TREE.filter(n => nodeState(n, allocated) === 'ready').map(n => n.id));
}

// ---- search ------------------------------------------------------------------------------------------------
const norm = (s: string): string => s.toLowerCase().replace(/['’]/g, '');
const HAYSTACK = new Map<string, string>(all.map(n => [n.id, norm(`${n.name} ${n.text} ${kindLabel(n)} ${groupLabel(n)} ${n.base ?? ''} ${n.notes.join(' ')}`)]));

/** Ids of nodes matching every word of the query (names, effect text, class, branch). Empty query matches nothing. */
export function searchNodes(query: string): Set<string> {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (!words.length) return out;
  for (const [id, hay] of HAYSTACK) if (id !== ATLAS_ORIGIN_ID && words.every(w => hay.includes(w))) out.add(id);
  return out;
}

// ---- reasons -----------------------------------------------------------------------------------------------
export type Verdict =
  | { kind: 'allocated' }
  | { kind: 'ready' }
  | { kind: 'gated'; reason: string }
  | { kind: 'excluded'; by: AtlasNode; reason: string }
  | { kind: 'unaffordable'; reason: string }
  | { kind: 'far'; reason: string; path: PathPreview | null };

export function verdict(node: AtlasNode, allocated: ReadonlySet<string>, free: number): Verdict {
  if (allocated.has(node.id)) return { kind: 'allocated' };
  if (!atlasNodeAllocatable(node)) return { kind: 'gated', reason: `${ENGINE_LABEL[node.engine]}. It is drawn and priced, but cannot be allocated until then.` };
  const clash = exclusionOf(node, allocated);
  if (clash) return { kind: 'excluded', by: clash, reason: `Mutually exclusive with ${clash.name}. Refund ${clash.name} to choose this instead.` };
  if (!linkedToPath(node, allocated)) return { kind: 'far', reason: 'Not connected to your tree yet.', path: pathTo(node.id, allocated) };
  if (node.cost > free) return { kind: 'unaffordable', reason: `Costs ${node.cost} Atlas point${node.cost === 1 ? '' : 's'}; you have ${free}.` };
  return { kind: 'ready' };
}

// ---- keyboard ----------------------------------------------------------------------------------------------
/** The nearest node from `from` in a screen direction (arrow-key focus moves). */
export function nearestNode(from: CxNode, dir: 'left' | 'right' | 'up' | 'down'): CxNode | null {
  let best: CxNode | null = null, bestScore = Infinity;
  for (const n of CX_NODES) {
    if (n === from) continue;
    const dx = n.x - from.x, dy = n.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 5) continue;
    const score = along + across * 1.8;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best;
}

// ---- sample trees (dev sandbox and tests) -------------------------------------------------------------------
/**
 * A valid, connected allocation of `points` points grown from the origin: live nodes only, round-robin over the branches
 * (`prefer` first), never both sides of an exclusion. Keystones are taken only when nothing else is open.
 */
export function sampleAllocation(points: number, prefer: readonly string[] = []): string[] {
  const out = new Set<string>();
  let spent = 0;
  const order = [...prefer, ...ATLAS_BRANCH_ORDER];
  for (let turn = 0; spent < points; turn++) {
    const open = MAP_TREE.filter(n => !out.has(n.id) && atlasNodeAllocatable(n) && spent + n.cost <= points
      && n.links.some(l => l === ATLAS_ORIGIN_ID || out.has(l)) && !n.excludes.some(e => out.has(e)));
    if (!open.length) break;
    const want = order[turn % order.length];
    const pick = open.find(n => n.group === want && n.kind !== 'keystone') ?? open.find(n => n.kind !== 'keystone') ?? open[0];
    out.add(pick.id);
    spent += pick.cost;
  }
  return [...out];
}
const ATLAS_BRANCH_ORDER: readonly string[] = ['cartography', 'foundry', 'bounty', 'fortune', 'echoes', 'peril'];
