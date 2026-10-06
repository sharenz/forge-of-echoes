// A small hand-made tree for tests and the dev sandbox (dev/tree-view.html): proof that a graph other than the Atlas
// renders through the same model, renderer, stage and rail. Fourteen nodes on two rings around an origin, one notable
// per spoke, an exclusive keystone pair, a gated node and a seal without an emblem, in its own red/blue/gold palette.
import { hexToColor, type Ramp } from '../../art/palette';
import { ringBoard } from '../../art/codex/board';
import type { GlyphId } from '../../art/codex/glyphs';
import type { PlateClass, TonePalette, ToneDef } from '../../art/codex/tones';
import { createTreeModel, type TreeNodeData } from './tree';
import { createTreeView } from './view';

export type SampleTone = 'sinew' | 'rune' | 'crown' | 'core';

export interface SampleNode extends TreeNodeData {
  cls: PlateClass;
  tone: SampleTone;
  tone2?: SampleTone;
  glyph: GlyphId;
  /** Polar position: ring (0 = centre) and angle in degrees. */
  ring: number;
  angle: number;
  live: boolean;
}

const hx = (...s: string[]): Ramp => s.map((h) => hexToColor(h));
const tone = (label: string, face: Ramp, body: string, hi: string, lo: string, css: string): ToneDef =>
  ({ label, face, glyph: { body: hexToColor(body), hi: hexToColor(hi), lo: hexToColor(lo) }, light: hexToColor(css), css });

export const SAMPLE_PALETTE: TonePalette<SampleTone> = {
  id: 'sample',
  tones: {
    sinew: tone('Sinew', hx('#1d0a0d', '#3d1219', '#6e1a26', '#a82a36', '#e05a5a', '#ffc0b0'), '#ffd8d0', '#ffffff', '#3d0d14', '#ff5a5a'),
    rune: tone('Rune', hx('#0b1230', '#16245e', '#24409a', '#3a66d6', '#7fa8ff', '#d8e6ff'), '#d8e6ff', '#ffffff', '#101c46', '#6f9cff'),
    crown: tone('Crown', hx('#26190c', '#4d3512', '#7c5718', '#b8862f', '#e0b04a', '#f7dc8c'), '#fff0b8', '#ffffff', '#5a3a10', '#ffd35c'),
    core: tone('Core', hx('#1e160d', '#3d2c18', '#66492a', '#8a6a3e', '#c9a064', '#f0d9a0'), '#fff0c0', '#ffffff', '#3d2c18', '#e8c070'),
  },
};

const n = (id: string, name: string, cls: PlateClass, t: SampleTone, glyph: GlyphId, ring: number, angle: number, links: string[], extra: Partial<SampleNode> = {}): SampleNode =>
  ({ id, name, cls, tone: t, glyph, ring, angle, links, excludes: [], cost: cls === 'keystone' ? 2 : 1, live: true, ...extra });

/** The sample graph (links listed on both ends). */
export const SAMPLE_NODES: readonly SampleNode[] = [
  n('core', 'Heart of the Sample', 'keystone', 'core', 'sun', 0, 0, ['a1', 'b1', 'c1']),
  n('a1', 'Red Thread', 'small', 'sinew', 'heart', 1, -90, ['core', 'a2']),
  n('a2', 'Red Knot', 'notable', 'sinew', 'blades', 2, -90, ['a1', 'a3', 'ab']),
  n('a3', 'Crimson Vow', 'keystone', 'sinew', 'skull', 3, -90, ['a2'], { excludes: ['b3'] }),
  n('b1', 'Blue Thread', 'small', 'rune', 'snowflake', 1, 30, ['core', 'b2']),
  n('b2', 'Blue Knot', 'notable', 'rune', 'eye', 2, 30, ['b1', 'b3', 'ab', 'bc']),
  n('b3', 'Azure Vow', 'keystone', 'rune', 'moon', 3, 30, ['b2']),
  n('c1', 'Gold Thread', 'small', 'crown', 'coin', 1, 150, ['core', 'c2']),
  n('c2', 'Gold Knot', 'tier', 'crown', 'crown', 2, 150, ['c1', 'c3', 'bc']),
  n('c3', 'Gold Lens', 'lens', 'crown', 'spiral', 3, 150, ['c2', 'c4']),
  n('c4', 'Sealed Gate', 'seal', 'crown', 'seal', 4, 150, ['c3'], { live: false }),
  n('ab', 'Violet Bridge', 'small', 'sinew', 'chain', 2.5, -30, ['a2', 'b2'], { tone2: 'rune' }),
  n('bc', 'Green Bridge', 'small', 'rune', 'chain', 2.5, 90, ['b2', 'c2'], { tone2: 'crown' }),
];

/** World size of the sample board and the ring spacing, in art px. */
export const SAMPLE_W = 360;
const RING = 38;

export const SAMPLE_TREE = createTreeModel<SampleNode, SampleTone>({
  originId: 'core',
  nodes: SAMPLE_NODES,
  allocatable: (s) => s.live,
  place: (s) => ({ x: SAMPLE_W / 2 + Math.cos((s.angle * Math.PI) / 180) * s.ring * RING, y: SAMPLE_W / 2 + Math.sin((s.angle * Math.PI) / 180) * s.ring * RING }),
  plateClass: (s) => s.cls,
  tone: (s) => ({ tone: s.tone, ...(s.tone2 ? { tone2: s.tone2 } : {}) }),
  glyph: (s) => s.glyph,
  searchText: (s) => `${s.name} ${SAMPLE_PALETTE.tones[s.tone].label} ${s.cls}`,
  pointName: 'sample point',
  gateReason: () => 'Sealed in the sample. It is drawn and priced, but cannot be allocated.',
});

export const SAMPLE_VIEW = createTreeView<SampleNode, SampleTone>({
  model: SAMPLE_TREE,
  board: ringBoard(SAMPLE_W, SAMPLE_W, [RING, RING * 2, RING * 3, RING * 4]),
  palette: SAMPLE_PALETTE,
});
