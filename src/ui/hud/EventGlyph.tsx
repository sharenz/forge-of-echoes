import type { MapEventKind } from '../../contracts/map-events';
import { MAP_EVENT_COLORS } from '../../data/progression/map-events';

/** A small ground-glyph per event kind (the same signs the presenter paints on the floor). */
export function EventGlyph({ kind }: { kind: MapEventKind }) {
  const [r, g, b] = MAP_EVENT_COLORS[kind];
  const c = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  const common = { fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const };
  return (
    <svg class="fe-event__glyph" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {kind === 'hunted' && <g {...common}><path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z" /><path d="M12 7 V17" /></g>}
      {kind === 'echoRift' && <g {...common}><path d="M12 3 A9 9 0 0 1 21 12" /><path d="M12 21 A9 9 0 0 1 3 12" /><path d="M12 7 A5 5 0 0 1 17 12" /><path d="M12 17 A5 5 0 0 1 7 12" /><circle cx="12" cy="12" r="1.4" /></g>}
      {kind === 'blackout' && <g {...common}><path d="M6 11 H18 L16 19 H8 Z" /><path d="M12 3 Q16 7 12 10 Q8 7 12 3 Z" /></g>}
      {kind === 'vaultbreakers' && <g {...common}><path d="M4 6 L10 12 L4 18" /><path d="M12 6 L18 12 L12 18" /></g>}
      {kind === 'secondCrown' && <g {...common}><path d="M3 18 V8 L8 13 L12 6 L16 13 L21 8 V18 Z" /></g>}
      {kind === 'wound' && <g {...common}><path d="M12 2 V22" /><path d="M3 7 L21 17" /><path d="M21 7 L3 17" /></g>}
      {kind === 'pactAltar' && <g {...common}><path d="M12 4 V20" /><path d="M5 8 H19" /><path d="M5 8 L2.5 14 H7.5 Z" /><path d="M19 8 L16.5 14 H21.5 Z" /><path d="M8 20 H16" /></g>}
      {kind === 'orchard' && <g {...common}><path d="M12 21 V11" /><path d="M12 13 Q6 13 5 6 Q11 6 12 12" /><path d="M12 11 Q18 11 19 4 Q13 4 12 10" /></g>}
      {kind === 'ring' && <g {...common}><circle cx="12" cy="12" r="8" stroke-dasharray="3 2.4" /><path d="M12 8 V16" /><path d="M8 12 H16" /></g>}
      {kind === 'host' && <g {...common}><path d="M12 2 L19 9 L12 22 L5 9 Z" /><path d="M5 9 H19" /><path d="M12 2 V22" /></g>}
      {kind === 'anvil' && <g {...common}><path d="M3 8 H16 Q20 8 20 12 H14 L13 15 H16 V19 H8 V15 H11 L10 12 H3 Z" /></g>}
      {kind === 'bellwatch' && <g {...common}><path d="M12 3 V5" /><path d="M6 17 Q7 8 12 5 Q17 8 18 17 Z" /><path d="M4 17 H20" /><path d="M10 20 H14" /></g>}
      {kind === 'voidBreach' && <g {...common}><path d="M12 2 Q8 8 12 12 Q16 16 12 22 Q18 16 14 12 Q10 8 12 2 Z" /><circle cx="12" cy="12" r="1.4" /></g>}
    </svg>
  );
}
