// Constants the Re-chart popover shares with the bench (the prefix is data/items/bench.ts's; theme labels are the chart's).
import { RECHART_SERVICE_PREFIX } from '../../data/items/bench';
import { THEMES } from '../../art/atlas/geometry';

export { RECHART_SERVICE_PREFIX };
export const THEME_LABELS: Record<string, string> = Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t.label]));
