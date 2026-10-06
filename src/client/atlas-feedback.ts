// Atlas feedback the client says itself (brief D slice F1): which sound and banner follow a discovery, a pin and an activation.
// Pure, so the session only wires them; the server keeps saying the rest (the "Atlas revealed" toast, the surge banner that rides
// on the activation message, the Hourglass refill message).
import type { AtlasAreaId } from '../contracts/atlas';
import type { SfxId } from '../contracts/audio';
import type { RunSetup } from '../contracts/game';
import type { CharacterSave } from '../contracts/items';
import { findAtlasArea } from '../data/progression/atlas';
import { pinMultiplierFor, pinSlotCount } from '../data/progression/routing';

/** Areas `next` has charted that `prev` had not (none on the first character the session sees, or after a character switch). */
export function newlyDiscovered(prev: CharacterSave | null, next: CharacterSave): AtlasAreaId[] {
  if (!prev || prev.id !== next.id) return [];
  const before = new Set<string>(prev.atlas?.discovered ?? []);
  return (next.atlas?.discovered ?? []).filter((id) => !before.has(id));
}

/** The pin banner: what a pin does, and how many of the account's pins are now used. Unpinning says nothing (the tray shows it). */
export function pinBanner(ch: CharacterSave, areaId: AtlasAreaId, pinned: boolean): string | null {
  if (!pinned) return null;
  const area = findAtlasArea(areaId);
  if (!area) return null;
  const nodes = ch.atlas?.nodes;
  const used = ch.atlas?.pins?.length ?? 0;
  return `Pinned ${area.name}: its maps drop x${pinMultiplierFor(nodes)} as often (${used} of ${pinSlotCount(nodes)} pins).`;
}

/** Sounds after a successful activation, from the setup the rules previewed: a key turned in a sealed door, a surge charge spent. */
export function activationSounds(setup: Pick<RunSetup, 'surge' | 'passage'> | null): SfxId[] {
  if (!setup) return [];
  const out: SfxId[] = [];
  if (setup.passage?.kind === 'key') out.push('atlasSeal');
  if (setup.surge) out.push('surgeSpend');
  return out;
}
