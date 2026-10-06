// The short map tooltip (F-28, docs/onboarding-ux.md): a map's full card is a wall of numbers, so the first look is a summary
// ("Tier 1 · Cinder Crossing · 6 waves · boss: Cinder Matriarch", the luck, the theme effects, one line per mod) and the long card follows after a
// short hover or while Alt is held (components/Overlays.tsx TooltipHost decides when). Pure: built from the map and the rules'
// own ItemDescription, so it never states a number the full card does not.
import type { ItemDescription, MapItem, TooltipLine } from '../../contracts/items';
import { findAtlasArea } from '../../data/progression/atlas';
import { MAP_BASES } from '../../data/progression/maps';

/** How long a map tooltip stays short before the full card replaces it (ms). */
export const MAP_BRIEF_LINGER_MS = 600;
/** Mods listed in the summary; the rest are counted ("+2 more"). */
export const MAP_BRIEF_MODS = 4;

export interface MapBrief {
  /** "Tier 1 · Cinder Crossing · 6 waves · boss: Cinder Matriarch". */
  head: string;
  /** "Quantity +30% · Rarity +15%" (the map's own luck), and the surge charges when known. */
  luck: string | null;
  /** The area theme's own effects ("Monsters have +10% to all Resistances"), danger lines flagged. */
  base: { text: string; negative: boolean }[];
  /** One line per mod (the first line of each mod group), danger lines flagged. */
  mods: { text: string; negative: boolean }[];
  /** Mods beyond MAP_BRIEF_MODS. */
  more: number;
  /** Warnings the player must not miss in the short form (unexplored area, corrupted). */
  warnings: string[];
}

const prop = (desc: ItemDescription, label: string): string | null => desc.properties.find((p) => p.label === label)?.value ?? null;

/** "Surge 2/3 today" for an area with surge charges (max 0: no surge there, nothing to say). */
export function surgeText(surge: { remaining: number; max: number } | null | undefined): string | null {
  return surge && surge.max > 0 ? `Surge ${surge.remaining}/${surge.max} today` : null;
}

/** The first line of each mod group (a map mod spans danger and reward lines that share its affix name). */
function modHeads(lines: readonly TooltipLine[]): TooltipLine[] {
  const out: TooltipLine[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (i > 0 && l.affixName && prev?.affixName === l.affixName) return;
    out.push(l);
  });
  return out;
}

export function mapBrief(map: MapItem, desc: ItemDescription, surge?: { remaining: number; max: number } | null): MapBrief {
  const area = findAtlasArea(map.areaId);
  const waves = prop(desc, 'Waves');
  const boss = prop(desc, 'Boss');
  const head = [
    `Tier ${map.tier}`,
    area?.name ?? null,
    waves ? `${waves} waves` : null,
    boss ? `boss: ${boss}` : null,
  ].filter((s): s is string => !!s).join(' · ');

  const qty = prop(desc, 'Map Item Quantity');
  const rar = prop(desc, 'Map Item Rarity');
  const luckParts = [
    qty && qty !== '+0%' ? `Quantity ${qty}` : null,
    rar && rar !== '+0%' ? `Rarity ${rar}` : null,
    map.quality > 0 ? `Quality +${map.quality}%` : null,
    surgeText(surge),
  ].filter((s): s is string => !!s);

  // describeMap lists the theme's implicit effects first, then its arena note and the level lines (those stay in the full card).
  const baseCount = MAP_BASES[map.baseId]?.implicitEffects.length ?? 0;
  const base = desc.implicits.slice(0, baseCount).map((l) => ({ text: l.text, negative: !!l.negative }));
  const heads = modHeads(desc.affixes);
  const warnings = desc.headerLines.filter((l) => l.startsWith('Unexplored territory'));
  if (map.corrupted) warnings.push('Corrupted: map currency no longer works on it');
  return {
    head,
    luck: luckParts.length ? luckParts.join(' · ') : null,
    base,
    mods: heads.slice(0, MAP_BRIEF_MODS).map((l) => ({ text: l.text, negative: !!l.negative })),
    more: Math.max(0, heads.length - MAP_BRIEF_MODS),
    warnings,
  };
}

/** The Re-chart pointer on a map's full card (roadmap: a Re-chart entry on the item tooltip). Null for a corrupted map (it cannot move). */
export function rechartHint(map: MapItem): string | null {
  return map.corrupted ? null : 'Re-chart moves it to a neighbouring area for Scrap: at the Crafting Bench, or Re-chart on the area card in the Atlas.';
}
