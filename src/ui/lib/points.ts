// Unspent points shown on the HUD: attribute points (Character, C), skill points (Skills, K) and Atlas tree points
// (the Map Device in your hideout). Pure, covered by tests/ui/points.test.ts.
import type { Panel } from '../../contracts/ui';
import { PANEL_KEYS } from './keys';

export type PointKind = 'attribute' | 'skill' | 'atlas';

export interface PointEntry {
  kind: PointKind;
  count: number;
  /** The panel a click opens. */
  panel: Panel;
  /** The panel hotkey in capitals ('C'), or null when the panel has none. */
  key: string | null;
  /** Spoken label and tooltip: "3 attribute points to spend (C)". */
  label: string;
}

export interface PointsInput {
  attribute: number;
  skill: number;
  /** Free Atlas tree points (earned minus spent). */
  atlas: number;
  /** The Map Device can only be opened from a hideout. */
  inHideout: boolean;
}

/** The hotkey letter of a panel, upper-case, or null. */
export function panelHotkey(panel: Panel): string | null {
  for (const [key, p] of Object.entries(PANEL_KEYS)) if (p === panel) return key.toUpperCase();
  return null;
}

const NOUN: Record<PointKind, [string, string]> = {
  attribute: ['attribute point', 'attribute points'],
  skill: ['skill point', 'skill points'],
  atlas: ['Atlas tree point', 'Atlas tree points'],
};
const PANEL_OF: Record<PointKind, Panel> = { attribute: 'character', skill: 'skills', atlas: 'mapDevice' };

export function pointLabel(kind: PointKind, count: number): string {
  const key = panelHotkey(PANEL_OF[kind]);
  const where = kind === 'atlas' ? ' in the Atlas (Map Device)' : key ? ` (${key})` : '';
  return `${count} ${NOUN[kind][count === 1 ? 0 : 1]} to spend${where}`;
}

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The badges to show, in a fixed order; a kind with nothing to spend is absent (so the badge disappears at zero). */
export function pointEntries(p: PointsInput): PointEntry[] {
  const out: PointEntry[] = [];
  const add = (kind: PointKind, raw: number): void => {
    const count = whole(raw);
    if (count > 0) out.push({ kind, count, panel: PANEL_OF[kind], key: panelHotkey(PANEL_OF[kind]), label: pointLabel(kind, count) });
  };
  add('attribute', p.attribute);
  add('skill', p.skill);
  if (p.inHideout) add('atlas', p.atlas);
  return out;
}

/** The kinds whose count went UP since `prev` (null = first look, e.g. loading a character or reconnecting: no flourish). */
export function gainedKinds(prev: PointsInput | null, next: PointsInput): PointKind[] {
  if (!prev) return [];
  const out: PointKind[] = [];
  if (whole(next.attribute) > whole(prev.attribute)) out.push('attribute');
  if (whole(next.skill) > whole(prev.skill)) out.push('skill');
  if (whole(next.atlas) > whole(prev.atlas)) out.push('atlas');
  return out;
}

/** Total of all shown kinds (the "+" on the level gem shows while this is above zero). */
export function totalPoints(p: PointsInput): number {
  return pointEntries(p).reduce((n, e) => n + e.count, 0);
}
