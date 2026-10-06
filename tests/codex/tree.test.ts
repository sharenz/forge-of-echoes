// The generic tree model, palette-parameterised plates and the shared renderer (power-rework PT1): the Atlas Codex and a
// hand-made sample graph go through the same code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plateFrame, cachedPlate } from '../../src/art/codex/plates';
import { CODEX_PALETTE } from '../../src/art/codex/tones';
import { CODEX_BOARD } from '../../src/art/codex/board';
import { ATLAS_TREE, CX_BY_ID, CX_EDGES, CX_NODES, nodeState, verdict } from '../../src/ui/codex/model';
import { ATLAS_VIEW } from '../../src/ui/codex/atlasView';
import { SAMPLE_PALETTE, SAMPLE_TREE, SAMPLE_VIEW } from '../../src/ui/codex/sample';
import type { TreeView } from '../../src/ui/codex/view';
import type { TreeInput } from '../../src/ui/codex/render';

const hash = (d: Uint8ClampedArray): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
const S = SAMPLE_TREE;
const node = (id: string) => S.find(id)!;

describe('generic tree model on a sample graph', () => {
  it('lays out every node, origin first, with one edge per link', () => {
    expect(S.nodes[0].id).toBe('core');
    expect(S.nodes.length).toBe(13);
    expect(S.edges.length).toBe(S.nodes.reduce((n, c) => n + c.node.links.length, 0) / 2);
    for (const n of S.nodes) { expect(Number.isInteger(n.x)).toBe(true); expect(n.r).toBeGreaterThan(0); }
    expect(S.byId.get('ab')!.tone2).toBe('rune');
  });
  it('answers state, gates and exclusions in both directions', () => {
    const none = new Set<string>();
    expect(S.nodeState(node('core'), none)).toBe('on');
    expect([...S.reachableSet(none)].sort()).toEqual(['a1', 'b1', 'c1']);
    expect(S.nodeState(node('a2'), none)).toBe('locked');
    expect(S.nodeState(node('c4'), none)).toBe('gated');
    const held = new Set(['a1', 'a2', 'a3', 'b1', 'b2']);
    expect(S.exclusionOf(node('b3'), held)?.id).toBe('a3'); // a3 lists the pair
    expect(S.exclusionOf(node('a3'), new Set(['b3']))?.id).toBe('b3');
    expect(S.nodeState(node('b3'), held)).toBe('locked');
  });
  it('prices the cheapest path and never crosses gated or excluded nodes', () => {
    expect(S.pathTo('a3', new Set())).toEqual({ nodes: ['a1', 'a2', 'a3'], cost: 4 });
    const viaBridge = S.pathTo('b2', new Set(['a1', 'a2']))!;
    expect(viaBridge.cost).toBe(2);
    expect(viaBridge.nodes.at(-1)).toBe('b2');
    expect(S.pathTo('c4', new Set())).toBeNull();
    expect(S.pathTo('b3', new Set(['a1', 'a2', 'a3']))).toBeNull();
  });
  it('refunds leaves only and names the dependants', () => {
    const a = new Set(['a1', 'a2', 'ab']);
    expect(S.canRefund('ab', a)).toBe(true);
    expect(S.canRefund('a1', a)).toBe(false);
    expect(S.dependants('a1', a).sort()).toEqual(['a2', 'ab']);
  });
  it('explains refusals with the binding\'s own words', () => {
    expect(S.verdict(node('c4'), new Set(), 9)).toEqual({ kind: 'gated', reason: 'Sealed in the sample. It is drawn and priced, but cannot be allocated.' });
    expect(S.verdict(node('a3'), new Set(['a1', 'a2']), 1)).toEqual({ kind: 'unaffordable', reason: 'Costs 2 sample points; you have 1.' });
    expect(S.verdict(node('a2'), new Set(), 9).kind).toBe('far');
    expect(S.verdict(node('a1'), new Set(), 9).kind).toBe('ready');
  });
  it('searches all words and moves arrow focus spatially', () => {
    expect([...S.searchNodes('blue')].sort()).toEqual(['b1', 'b2']);
    expect([...S.searchNodes('rune keystone')]).toEqual(['b3']);
    expect(S.searchNodes('heart').has('core')).toBe(false); // never the origin
    const core = S.byId.get('core')!;
    expect(S.nearestNode(core, 'up')!.id).toBe('a1');
  });
});

describe('the Atlas Codex is a binding of the same model', () => {
  it('re-exports the generic model under the old names', () => {
    expect(ATLAS_VIEW.model).toBe(ATLAS_TREE);
    expect(CX_NODES).toBe(ATLAS_TREE.nodes);
    expect(CX_BY_ID).toBe(ATLAS_TREE.byId);
    expect(CX_EDGES).toBe(ATLAS_TREE.edges);
    expect(nodeState).toBe(ATLAS_TREE.nodeState);
    expect(verdict(ATLAS_TREE.find('strangeSigns')!, new Set(), 0)).toEqual({ kind: 'unaffordable', reason: 'Costs 1 Atlas point; you have 0.' });
    expect(ATLAS_VIEW.board).toBe(CODEX_BOARD);
    expect(ATLAS_VIEW.palette).toBe(CODEX_PALETTE);
  });
});

describe('palette-parameterised plates', () => {
  it('draws the Codex palette by default and another palette on request', () => {
    const spec = { cls: 'notable', tone: 'peril', glyph: 'skull', state: 'on' } as const;
    expect(hash(plateFrame(spec).c.data)).toBe(hash(plateFrame(spec, CODEX_PALETTE).c.data));
    const sample = plateFrame({ cls: 'notable', tone: 'sinew', glyph: 'skull', state: 'on' }, SAMPLE_PALETTE);
    expect(sample.c.isEmpty()).toBe(false);
    expect(hash(sample.c.data)).not.toBe(hash(plateFrame(spec).c.data));
  });
  it('keeps one cache per palette', () => {
    const a = cachedPlate({ cls: 'small', tone: 'rune', glyph: 'eye', state: 'ready' }, SAMPLE_PALETTE);
    expect(cachedPlate({ cls: 'small', tone: 'rune', glyph: 'eye', state: 'ready' }, SAMPLE_PALETTE)).toBe(a);
    expect(cachedPlate({ cls: 'small', tone: 'rune', glyph: 'eye', state: 'ready' }, { ...SAMPLE_PALETTE, id: 'other' })).not.toBe(a);
  });
  it('gives a seal without an emblem its glyph instead', () => {
    for (const state of ['locked', 'on', 'gated'] as const) {
      const f = plateFrame({ cls: 'seal', tone: 'crown', glyph: 'seal', state }, SAMPLE_PALETTE);
      expect(f.c.opaque(16, 16), state).toBe(true);
    }
  });
});

// ---- the shared renderer, on a recording 2D canvas --------------------------------------------------------------
interface Rec { calls: Map<string, number> }
function fakeCanvas(rec: Rec) {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (key === 'createPattern') return () => ({});
      return (..._args: unknown[]) => { rec.calls.set(key, (rec.calls.get(key) ?? 0) + 1); };
    },
    set(target, key: string, v) { target[key] = v; return true; },
  });
  return { width: 0, height: 0, getContext: () => ctx };
}

describe('the shared renderer draws any tree view', () => {
  afterEach(() => vi.unstubAllGlobals());
  const input = (allocated: string[], extra: Partial<TreeInput> = {}): TreeInput => ({
    allocated: new Set(allocated), selected: null, hovered: null, matches: new Set(), searching: false, preview: null, previewOk: false, reduceMotion: true, ...extra,
  });
  const run = (view: TreeView, first: string[], next: string[], extra: Partial<TreeInput> = {}) => {
    const rec: Rec = { calls: new Map() };
    vi.stubGlobal('document', { createElement: () => fakeCanvas(rec) });
    const beats: string[] = [];
    const r = view.createRenderer(fakeCanvas(rec) as unknown as HTMLCanvasElement, { onBeat: (b, n) => beats.push(`${b}:${n.id}`) });
    r.resize(800, 500, 1);
    r.setInput(input(first, extra), true);
    rec.calls.clear();
    r.setInput(input(next, extra));
    (r as unknown as { frame(dt: number): void }).frame(0.016);
    return { rec, beats, r };
  };

  it('renders the Atlas Codex wheel: one plate per node, beats on allocation', () => {
    const { rec, beats } = run(ATLAS_VIEW, [], ['strangeSigns']);
    expect(rec.calls.get('drawImage')!).toBeGreaterThanOrEqual(ATLAS_TREE.nodes.length);
    expect(beats).toEqual(['impact:strangeSigns']);
  });
  it('renders the sample graph through the same code, with its preview, exclusion and refund', () => {
    const path = SAMPLE_TREE.pathTo('b3', new Set(['b1']))!;
    const { rec, beats, r } = run(SAMPLE_VIEW, ['a1', 'a2', 'a3', 'b1'], ['a1', 'a2', 'b1'], { selected: 'b2', hovered: 'b3', preview: path, previewOk: true });
    expect(rec.calls.get('drawImage')!).toBeGreaterThanOrEqual(SAMPLE_TREE.nodes.length);
    expect(beats).toEqual(['refund:a3']);
    expect(r.camX).toBe(SAMPLE_VIEW.board.cx);
    expect(r.worldToScreen(SAMPLE_VIEW.board.cx, SAMPLE_VIEW.board.cy)).toEqual({ x: 400, y: 250 });
  });
});
