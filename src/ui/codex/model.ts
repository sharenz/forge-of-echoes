// The Atlas Codex view model: MAP_TREE bound to the generic tree model (tree.ts). This file keeps what is Atlas-only:
// which plate class, colour identity and glyph each node wears, the kind and group labels, the gate reasons and the
// sample allocations of the dev sandbox. The graph questions (state, gates, exclusions, cheapest path, refundability,
// search, arrow keys, refusal reasons) are the generic model's, re-exported under the names the Codex has always used.
import {
  ATLAS_ORIGIN_ID, ENGINE_LABEL, MAP_TREE, MAP_TREE_ORIGIN, atlasNodeAllocatable, findAtlasNode, type AtlasNode,
} from '../../data/progression/map-tree';
import { BRANCH_TONES, PLATE_SIZE, TONES, type PlateClass, type Tone } from '../../art/codex/tones';
import { toWorld } from '../../art/codex/board';
import { glyphFor } from '../../art/codex/glyphs';
import { createTreeModel, type PathPreview, type TreeModel, type TreeNode, type TreeState, type TreeVerdict } from './tree';

export type CxState = TreeState;
export type { PathPreview };
/** A laid-out Atlas node. */
export type CxNode = TreeNode<AtlasNode, Tone>;
export type Verdict = TreeVerdict<AtlasNode>;

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

// ---- the binding -------------------------------------------------------------------------------------------
/** The Atlas tree on the generic model: the origin and 145 nodes in Codex world px. */
export const ATLAS_TREE: TreeModel<AtlasNode, Tone> = createTreeModel<AtlasNode, Tone>({
  originId: ATLAS_ORIGIN_ID,
  nodes: [MAP_TREE_ORIGIN, ...MAP_TREE],
  allocatable: atlasNodeAllocatable,
  place: (n) => toWorld(n.pos),
  plateClass: plateClassOf,
  tone: toneOf,
  glyph: (n) => (n.id === ATLAS_ORIGIN_ID ? 'flame' : glyphFor(n)),
  searchText: (n) => `${n.name} ${n.text} ${kindLabel(n)} ${groupLabel(n)} ${n.base ?? ''} ${n.notes.join(' ')}`,
  pointName: 'Atlas point',
  gateReason: (n) => `${ENGINE_LABEL[n.engine]}. It is drawn and priced, but cannot be allocated until then.`,
});

export const CX_NODES: readonly CxNode[] = ATLAS_TREE.nodes;
export const CX_BY_ID: ReadonlyMap<string, CxNode> = ATLAS_TREE.byId;
export const CX_SIZE = PLATE_SIZE;
/** Undirected edges once each (ordered by node index). */
export const CX_EDGES: readonly { a: CxNode; b: CxNode }[] = ATLAS_TREE.edges;

// ---- graph questions (the generic model's) -------------------------------------------------------------------
export const exclusionOf = ATLAS_TREE.exclusionOf;
export const linkedToPath = ATLAS_TREE.linkedToPath;
export const nodeState = ATLAS_TREE.nodeState;
export const canRefund = ATLAS_TREE.canRefund;
export const dependants = ATLAS_TREE.dependants;
export const pathTo = ATLAS_TREE.pathTo;
export const reachableSet = ATLAS_TREE.reachableSet;
export const searchNodes = ATLAS_TREE.searchNodes;
export const nearestNode = ATLAS_TREE.nearestNode;
export const verdict = ATLAS_TREE.verdict;

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
