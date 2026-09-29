// Top-level item dispatchers: tooltips for every item kind, and crafting that routes map currencies on
// maps to the map rules and everything else to the Workbench (src/game/items).
import type { CraftOutcome, Result } from '../../contracts/game';
import type { CharacterSave, CurrencyStack, Item, ItemDescription, MapItem } from '../../contracts/items';
import { createRng } from '../../core/rng';
import { isMapCurrency } from '../../data/items';
import {
  applyEquipmentCurrency, craftPreview as equipmentCraftPreviewFor, craftingTargetError as equipmentTargetError,
  describeCurrency, describeEquipment, describeFlask, findItem, replaceItemAt, setStackCount,
} from '../items';
import type { FoundItem } from '../items';
import { craftMap, describeMap, mapCraftError, mapCraftPreview } from './maps';
import { buildPlayerModel } from './model';
import { fail, ok } from './util';

/** Tooltip for any item. With a character: level requirements, flask amounts, map-device hints. */
export function describeItem(item: Item, ch?: CharacterSave): ItemDescription {
  switch (item.kind) {
    case 'equipment':
      return describeEquipment(item, ch ? { characterLevel: ch.level } : {});
    case 'currency':
      return describeCurrency(item);
    case 'flask': {
      if (!ch) return describeFlask(item);
      const flaskEffect = buildPlayerModel(ch).breakdown('flaskEffect').value / 100;
      return describeFlask(item, { characterLevel: ch.level, flaskEffect });
    }
    case 'map':
      return describeMap(item, { inDevice: !!ch && ch.mapDevice?.uid === item.uid });
  }
}

interface MapCraft {
  currency: FoundItem & { item: CurrencyStack };
  target: FoundItem & { item: MapItem };
}

/** A map currency aimed at a map (the one case the map rules own), else null. */
function mapCraftTarget(ch: CharacterSave, currencyUid: string, targetUid: string): MapCraft | null {
  const currency = findItem(ch, currencyUid);
  if (!currency || currency.item.kind !== 'currency' || currency.item.count <= 0) return null;
  if (!isMapCurrency(currency.item.currencyId)) return null;
  const target = findItem(ch, targetUid);
  if (!target || target.item.kind !== 'map') return null;
  return { currency: currency as MapCraft['currency'], target: target as MapCraft['target'] };
}

export function craftingTargetError(ch: CharacterSave, currencyUid: string, targetUid: string): string | null {
  const m = mapCraftTarget(ch, currencyUid, targetUid);
  if (m) return mapCraftError(m.target.item, m.currency.item.currencyId);
  return equipmentTargetError(ch, currencyUid, targetUid);
}

export function craftPreview(ch: CharacterSave, currencyUid: string, targetUid: string): string[] {
  const m = mapCraftTarget(ch, currencyUid, targetUid);
  if (m) return mapCraftPreview(m.target.item, m.currency.item.currencyId);
  return equipmentCraftPreviewFor(ch, currencyUid, targetUid);
}

/** Apply a currency: consumes one, advances the character rng, counts the craft. Nothing is spent on failure. */
export function applyCurrency(ch: CharacterSave, currencyUid: string, targetUid: string, affixIndex?: number): Result<CraftOutcome> {
  const m = mapCraftTarget(ch, currencyUid, targetUid);
  if (!m) return applyEquipmentCurrency(ch, currencyUid, targetUid, affixIndex);
  const error = mapCraftError(m.target.item, m.currency.item.currencyId);
  if (error) return fail(error);
  const rng = createRng(ch.rngState >>> 0);
  const res = craftMap(m.target.item, m.currency.item.currencyId, rng);
  let next = replaceItemAt(ch, m.target.location, res.map);
  const currency = findItem(next, currencyUid);
  if (currency) next = setStackCount(next, currency, (currency.item as CurrencyStack).count - 1);
  next = { ...next, rngState: rng.state(), stats: { ...next.stats, itemsCrafted: (next.stats?.itemsCrafted ?? 0) + 1 } };
  return ok({ character: next, message: res.message, kind: res.kind, targetUid });
}
