// createTreeView: one tree (a generic model), the table it lies on (board) and its colours (palette), bundled with
// what every view of it shares: the baked static layers, the plate cache and the renderer factory. The Atlas Codex is
// ATLAS_VIEW (atlasView.ts); the Orrery and the test graphs are other views over the same code.
import type { Frame } from '../../art/frame';
import { Raster } from '../../art/raster';
import { paintThread, type TreeBoard } from '../../art/codex/board';
import { cachedPlate } from '../../art/codex/plates';
import type { TonePalette } from '../../art/codex/tones';
import { rasterToCanvas, type Surface } from '../../art/atlas/canvas';
import type { TreeModel, TreeNode, TreeNodeData, TreeState } from './tree';
import { TreeRenderer, type TreeEvents } from './render';

export interface TreeViewSpec<N extends TreeNodeData, T extends string> {
  model: TreeModel<N, T>;
  board: TreeBoard;
  palette: TonePalette<T>;
}

export interface TreeView<N extends TreeNodeData = TreeNodeData, T extends string = string> extends TreeViewSpec<N, T> {
  /** The plate frame of a node in a state, cached per palette. */
  plate(n: TreeNode<N, T>, state: TreeState): Frame;
  /** The board, the dim threads and the tile never change: baked once per page and view, not once per visit. */
  staticAssets(): { board: Surface; dim: Surface; tile: Surface };
  createRenderer(canvas: HTMLCanvasElement, events?: TreeEvents<N, T>): TreeRenderer<N, T>;
}

export function createTreeView<N extends TreeNodeData, T extends string>(spec: TreeViewSpec<N, T>): TreeView<N, T> {
  let baked: { board: Surface; dim: Surface; tile: Surface } | null = null;
  const view: TreeView<N, T> = {
    ...spec,
    plate: (n, state) => cachedPlate({ cls: n.cls, tone: n.tone, ...(n.tone2 ? { tone2: n.tone2 } : {}), glyph: n.glyph, state }, spec.palette),
    staticAssets() {
      if (baked) return baked;
      const { board, model } = spec;
      const dim = new Raster(board.w, board.h);
      for (const { a, b } of model.edges) paintThread(dim, a.x, a.y, b.x, b.y, 'dim');
      baked = { board: rasterToCanvas(board.raster()), dim: rasterToCanvas(dim), tile: rasterToCanvas(board.tile()) };
      return baked;
    },
    createRenderer: (canvas, events = {}) => new TreeRenderer(view, canvas, events),
  };
  return view;
}
