// Passages (brief D 2.5): a key from the inventory offers its sealed area, a Bounty map bound to the Pit's entrance offers the Pit.
// Pure, so the dock and the tests share it with the rules (the server re-checks everything at activation; this only decides what the
// dock may offer and why a drop is refused).
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import type { CurrencyId } from '../../contracts/content';
import type { MapItem } from '../../contracts/items';
import { ATLAS_AREAS, ATLAS_KEYS, atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { CURRENCIES } from '../../data/items';

export interface PassageOption { id: string; label: string; area: AtlasAreaId; key?: CurrencyId; pit?: true }

/** The passages `map` can take now: keys in `held` whose area is charted and accepts its tier; the Pit for a Bounty map beside it. */
export function passageOptions(map: MapItem | null, atlas: Pick<AtlasProgress, 'discovered'>, held: ReadonlySet<string>): PassageOption[] {
  const out: PassageOption[] = [];
  if (!map) return out;
  for (const k of ATLAS_KEYS) {
    const dest = findAtlasArea(k.areaId);
    if (dest && held.has(k.currencyId) && atlas.discovered.includes(dest.id) && map.tier <= atlasTierCeiling(dest)) {
      out.push({ id: `key:${k.currencyId}`, label: `${CURRENCIES[k.currencyId].name}: ${dest.name}`, area: dest.id, key: k.currencyId });
    }
  }
  const pit = ATLAS_AREAS.find((a) => a.requiresBounty);
  if (pit && map.bounty && pit.neighbours.includes(map.areaId) && atlas.discovered.includes(pit.id) && map.tier <= atlasTierCeiling(pit)) {
    out.push({ id: 'pit', label: `Open the ${pit.name}`, area: pit.id, pit: true });
  }
  return out;
}

/** Why a dragged currency cannot go into the passage slot (null = it can). */
export function passageRefusal(map: MapItem | null, atlas: Pick<AtlasProgress, 'discovered'>, held: ReadonlySet<string>, currencyId: string): string | null {
  const key = ATLAS_KEYS.find((k) => k.currencyId === currencyId);
  if (!key) return 'Only a key can open a passage.';
  if (!map) return 'Slot a map first: the key is spent together with it.';
  const dest = findAtlasArea(key.areaId);
  if (!dest) return 'That key opens nothing.';
  if (!atlas.discovered.includes(dest.id)) return `${dest.name} is not charted yet.`;
  if (map.tier > atlasTierCeiling(dest)) return `${dest.name} accepts maps up to Tier ${atlasTierCeiling(dest)}.`;
  if (!held.has(currencyId)) return 'Keep the key in your inventory.';
  return null;
}
