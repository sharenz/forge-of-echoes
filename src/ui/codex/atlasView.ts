// The Atlas Codex as a tree view: MAP_TREE (model.ts) on the etched slate wheel in the brass/wax/glass palette.
import type { AtlasNode } from '../../data/progression/map-tree';
import { CODEX_BOARD } from '../../art/codex/board';
import { CODEX_PALETTE, type Tone } from '../../art/codex/tones';
import { ATLAS_TREE } from './model';
import { createTreeView } from './view';

export const ATLAS_VIEW = createTreeView<AtlasNode, Tone>({ model: ATLAS_TREE, board: CODEX_BOARD, palette: CODEX_PALETTE });
