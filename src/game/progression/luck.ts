// Personal luck (GAME_SPEC §9, §11 "Loot is instanced"). Every player in a map rolls their own drops
// with their own luck:
//
//   personal = map-side luck (RunSetup.itemQuantity / itemRarity: tier, quality, implicit, mods)
//            + the looter's gear (% increased item quantity / rarity), resolved with the one formula
//
// Gear "increased" joins the map's "increased" sum, so it is scaled by the map's "more" multipliers:
// personal = mapSide + gear × Π(1 + more/100). No current map source is "more", so today this is a
// plain sum ("+26% map, +10% gear = +36%"), and the breakdown lines add up.
//
// Loot rolls run per kill per player, so gear luck is cached per CharacterSave object and the map's
// multipliers per map snapshot. Both rely on the rules' contract that saves are never mutated in place
// (every change is a new object) — a server must not edit a CharacterSave's equipment directly.
import type { MapSummaryLine, RunSetup } from '../../contracts/game';
import type { CharacterSave, StatBreakdown, StatModifier } from '../../contracts/items';
import type { GearLuck } from './maps';
import { luckTotalLine, mapLuck, summarySourceLine } from './maps';
import { buildPlayerModel } from './model';
import { clean, finite, signedPercent } from './util';
import { findAtlasArea } from '../../data/progression/atlas';

/** Final item quantity / rarity in percent (100 = base). */
export interface Luck {
  itemQuantity: number;
  itemRarity: number;
}

interface GearDetail {
  luck: GearLuck;
  quantity: readonly StatModifier[];
  rarity: readonly StatModifier[];
}

const NO_GEAR: GearDetail = { luck: { itemQuantity: 0, itemRarity: 0 }, quantity: [], rarity: [] };

/** Cached per CharacterSave object: saves are immutable (every change is a new object). */
const GEAR = new WeakMap<CharacterSave, GearDetail>();

function gearDetail(ch: CharacterSave | null): GearDetail {
  if (!ch) return NO_GEAR;
  let d = GEAR.get(ch);
  if (!d) {
    const model = buildPlayerModel(ch);
    const q: StatBreakdown = model.breakdown('itemQuantity');
    const r: StatBreakdown = model.breakdown('itemRarity');
    d = {
      luck: { itemQuantity: clean(q.value - 100), itemRarity: clean(r.value - 100) },
      quantity: q.sources,
      rarity: r.sources,
    };
    GEAR.set(ch, d);
  }
  return d;
}

/** % increased item quantity / rarity from a character's equipped gear (0 = none). */
export function gearLuck(ch: CharacterSave): GearLuck {
  return { ...gearDetail(ch).luck };
}

/** The map's "more" luck multipliers (what gear "increased" is scaled by), cached per map snapshot. */
const MORE = new WeakMap<RunSetup, { quantity: number; rarity: number }>();

function mapMore(setup: RunSetup): { quantity: number; rarity: number } {
  let m = MORE.get(setup);
  if (!m) {
    const luck = mapLuck(setup.map, null, setup.mapTree);
    const prod = (more: number[]) => more.reduce((p, v) => p * (1 + v / 100), 1);
    m = { quantity: prod(luck.quantity.more), rarity: prod(luck.rarity.more) };
    MORE.set(setup, m);
  }
  return m;
}

/**
 * Personal luck of `looter` in the map of `setup`: map-side luck plus the looter's gear. `null` =
 * nobody's gear (map-side luck only). This is GameRulesApi.lootLuck; the HUD shows it as the local
 * player's item quantity / rarity, and every loot roll for that player uses it.
 */
export function lootLuck(setup: RunSetup, looter: CharacterSave | null): Luck {
  const gear = gearDetail(looter).luck;
  const more = mapMore(setup);
  return {
    itemQuantity: clean(Math.max(0, finite(setup.itemQuantity, 100) + gear.itemQuantity * more.quantity * (1 + (findAtlasArea(setup.atlasAreaId)?.quantityMore ?? 0) / 100))),
    itemRarity: clean(Math.max(0, finite(setup.itemRarity, 100) + gear.itemRarity * more.rarity)),
  };
}

function personalLine(
  label: string, stat: 'itemQuantity' | 'itemRarity', value: number, setup: RunSetup, gear: readonly StatModifier[],
): MapSummaryLine {
  const map = mapLuck(setup.map, null, setup.mapTree)[stat === 'itemQuantity' ? 'quantity' : 'rarity'];
  const lines = [
    ...map.sources.map((m) => summarySourceLine(m)),
    ...gear.map((m) => summarySourceLine(m)),
  ];
  const area = findAtlasArea(setup.atlasAreaId);
  if (stat === 'itemQuantity' && area?.quantityMore) lines.push(`${area.quantityMore}% more ${area.name}`);
  if (!lines.length) lines.push('No bonuses: 100% is the base rate');
  lines.push(luckTotalLine(value), 'Your drops only: each party member rolls their own loot with their own gear');
  return { label, value: signedPercent(value - 100), breakdown: lines };
}

/**
 * The two personal luck lines with every source (map and gear) for tooltips and the in-map character
 * sheet: "Item Quantity in this Map +36%" → "+6% Quality", "+20% Teeming", "+10% Cinder Pendant
 * (of Plenty T3)", "Total 136% of the base rate", …  Values equal lootLuck(setup, looter).
 */
export function lootLuckLines(setup: RunSetup, looter: CharacterSave | null): MapSummaryLine[] {
  const luck = lootLuck(setup, looter);
  const gear = gearDetail(looter);
  return [
    personalLine('Item Quantity in this Map', 'itemQuantity', luck.itemQuantity, setup, gear.quantity),
    personalLine('Item Rarity in this Map', 'itemRarity', luck.itemRarity, setup, gear.rarity),
  ];
}
