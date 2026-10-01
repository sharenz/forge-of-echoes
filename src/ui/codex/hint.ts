// "What this does to your current map": the map summary lines of the slotted map computed twice, with and without
// the node (or the whole path to it), and diffed. Uses the same rules function the Map Device readout uses, so the
// numbers are the ones the device will show.
import type { CharacterSave, MapItem } from '../../contracts/items';
import type { MapSummaryLine } from '../../contracts/game';
import { findAtlasNode } from '../../data/progression/map-tree';

export interface HintLine { label: string; from: string; to: string }
export interface Hint {
  lines: HintLine[];
  /** Set when the map is not affected, and why. */
  note?: string;
}

export interface SummaryRules { mapSummary(ch: CharacterSave, map: MapItem): MapSummaryLine[] }

/** The character as if `ids` were allocated (allocate) or removed (refund). Preview only, never saved. */
export function withNodes(ch: CharacterSave, ids: readonly string[], allocate: boolean): CharacterSave {
  const current = ch.atlas?.nodes ?? [];
  const nodes = allocate ? [...new Set([...current, ...ids])] : current.filter(n => !ids.includes(n));
  return { ...ch, atlas: { ...(ch.atlas ?? { discovered: [], completed: [], clears: 0 }), nodes } } as CharacterSave;
}

export function mapHint(rules: SummaryRules, ch: CharacterSave, map: MapItem | null, ids: readonly string[], allocate: boolean, target: string): Hint {
  const node = findAtlasNode(target);
  if (!map) return { lines: [], note: 'Load a map in the device to see how this changes it.' };
  let before: MapSummaryLine[], after: MapSummaryLine[];
  try {
    before = rules.mapSummary(ch, map);
    after = rules.mapSummary(withNodes(ch, ids, allocate), map);
  } catch {
    return { lines: [], note: 'This change cannot be previewed on the loaded map.' };
  }
  const was = new Map(before.map(l => [l.label, l.value]));
  const lines: HintLine[] = [];
  for (const l of after) {
    const b = was.get(l.label);
    if (b !== undefined && b !== l.value) lines.push({ label: l.label, from: b, to: l.value });
  }
  for (const l of after) if (!was.has(l.label)) lines.push({ label: l.label, from: 'none', to: l.value });
  if (lines.length) return { lines };
  const where = node?.base ? ' It only works on ' + node.base.replace(/([A-Z])/g, ' $1').toLowerCase().trim() + ' maps.' : '';
  return { lines: [], note: `No change to the loaded map.${where}` };
}
