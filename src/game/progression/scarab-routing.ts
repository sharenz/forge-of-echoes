// Area-bias scarabs (brief D 5.6, slice S1): how loaded scarabs bend the frozen drop-routing table. Pure. The effects are the
// `RoutingBias` hook of map-routing.ts (it multiplies a candidate after pins, may add distant theme areas, retunes the upward
// tier roll and the chest upgrade); the numbers are data in src/data/scarabs.ts. Scarabs never change how many maps drop.
import type { AtlasAreaId } from '../../contracts/atlas';
import type { ScarabId } from '../../contracts/content';
import type { RouteKind } from '../../contracts/game';
import { findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { ROUTING_TIER_OFFSETS } from '../../data/progression/routing';
import { AREA_SCARAB_OWN_CAP, findScarab, type AreaScarabEffect } from '../../data/scarabs';
import type { RoutingBias } from './map-routing';

/**
 * Homing never turns a map into an own-area-only machine (D 5.6 "anti-degenerate check"): the own area's share of the table is capped at
 * `AREA_SCARAB_OWN_CAP` unless the player pinned it (a pin is their own explicit choice, x18 with Homing IV). A dead end with a single
 * neighbour is where the multiplier alone would pass the cap (about 77% with Homing IV); charts with real neighbours stay under it untouched.
 */
function capOwnShare(candidates: { areaId: AtlasAreaId; weight: number; kind?: RouteKind; pinned?: true; pending?: true }[]): void {
  const own = candidates.find((c) => c.kind === 'own');
  if (!own || own.pinned) return;
  const others = candidates.filter((c) => c !== own && !c.pending).reduce((s, c) => s + c.weight, 0);
  const cap = AREA_SCARAB_OWN_CAP / (1 - AREA_SCARAB_OWN_CAP) * others;
  if (others > 0 && own.weight > cap) own.weight = Math.round(cap * 1e6) / 1e6;
}

/** Minimum base weight a Hearthbound scarab gives an on-theme area far from the run (D 5.6 "minimum base 0.5"). */
export const HEARTHBOUND_FLOOR = 0.5;

const areaEffects = (scarabs: readonly ScarabId[]): { id: ScarabId; effect: AreaScarabEffect }[] =>
  scarabs.flatMap((id) => { const effect = findScarab(id)?.area; return effect ? [{ id, effect }] : []; });

/**
 * The routing bias of the loaded scarabs for a map bound to `from` (its theme is the map's theme). Wave scarabs contribute nothing.
 * Families compose: each multiplies the candidates it names, so Homing and Hearthbound on the own area multiply.
 */
export function scarabRoutingBias(scarabs: readonly ScarabId[], from?: AtlasAreaId): RoutingBias {
  const effects = areaEffects(scarabs);
  if (!effects.length) return {};
  const theme = findAtlasArea(from)?.baseId;
  const mult = (area: AtlasAreaDef, kind: RouteKind): number => {
    let m = 1;
    for (const { effect } of effects) {
      switch (effect.kind) {
        case 'own': if (kind === 'own') m *= effect.multiplier; break;
        case 'neighbours': if (kind === 'neighbour') m *= effect.multiplier; break;
        case 'deadEnds': if (area.deadEnd) m *= effect.multiplier; break;
        case 'theme': if (kind !== 'pending' && theme !== undefined && area.baseId === theme) m *= effect.multiplier; break;
        case 'upward': break;
      }
    }
    return m;
  };
  const bias: RoutingBias = { weightMultiplier: mult };
  if (effects.some(({ effect }) => effect.kind === 'own')) bias.finalize = capOwnShare;
  if (theme !== undefined && effects.some(({ effect }) => effect.kind === 'theme')) {
    bias.reach = (area) => (area.baseId === theme ? HEARTHBOUND_FLOOR : 0);
  }
  const up = effects.find(({ effect }) => effect.kind === 'upward')?.effect;
  if (up?.kind === 'upward') {
    bias.tierOffsets = upwardOffsets(up.weight);
    bias.chestUpgradeBonus = up.chestUpgradePoints;
  }
  return bias;
}

/** The tier ladder with the upward roll at `upPercent` of all drops; the other offsets keep their proportions (D 5.6 Deepward). */
export function upwardOffsets(upPercent: number): { offset: number; weight: number }[] {
  const total = ROUTING_TIER_OFFSETS.reduce((s, o) => s + o.weight, 0);
  const rest = ROUTING_TIER_OFFSETS.filter((o) => o.offset !== 1).reduce((s, o) => s + o.weight, 0);
  const up = total * upPercent / 100;
  const scale = rest > 0 ? (total - up) / rest : 0;
  return ROUTING_TIER_OFFSETS.map((o) => ({ offset: o.offset, weight: Math.round((o.offset === 1 ? up : o.weight * scale) * 1e6) / 1e6 }));
}

/** Combine two biases (pins first, scarabs after): multipliers multiply, floors take the larger, scarab tier ladder wins, chest points add. */
export function composeRoutingBias(a: RoutingBias, b: RoutingBias): RoutingBias {
  const out: RoutingBias = { ...a };
  if (b.pins) out.pins = [...(a.pins ?? []), ...b.pins];
  if (b.pinMultiplier !== undefined) out.pinMultiplier = b.pinMultiplier;
  if (b.weightMultiplier) {
    const first = a.weightMultiplier, second = b.weightMultiplier;
    out.weightMultiplier = first ? (area, kind) => first(area, kind) * second(area, kind) : second;
  }
  if (b.reach) {
    const first = a.reach, second = b.reach;
    out.reach = first ? (area) => Math.max(first(area), second(area)) : second;
  }
  if (b.finalize) {
    const first = a.finalize, second = b.finalize;
    out.finalize = first ? (candidates) => { first(candidates); second(candidates); } : second;
  }
  if (b.tierOffsets) out.tierOffsets = b.tierOffsets;
  if (b.chestUpgradeBonus !== undefined) out.chestUpgradeBonus = (a.chestUpgradeBonus ?? 0) + b.chestUpgradeBonus;
  return out;
}

const multiplierText = (m: number): string => `x${Math.round(m * 100) / 100}`;

/** Readout lines for the Device ("Scarab: Homing Scarab II: own area x3"), one per loaded area-bias scarab, in socket order. */
export function scarabRoutingLines(scarabs: readonly ScarabId[]): string[] {
  return areaEffects(scarabs).map(({ id, effect }) => {
    const name = findScarab(id)!.name;
    switch (effect.kind) {
      case 'own': return `Scarab: ${name}: own area ${multiplierText(effect.multiplier)}`;
      case 'neighbours': return `Scarab: ${name}: neighbouring areas ${multiplierText(effect.multiplier)}`;
      case 'deadEnds': return `Scarab: ${name}: dead-end areas ${multiplierText(effect.multiplier)}`;
      case 'theme': return `Scarab: ${name}: this map's theme, at any distance ${multiplierText(effect.multiplier)}`;
      case 'upward': return `Scarab: ${name}: ${effect.weight}% of dropped maps one tier higher, completion upgrade +${effect.chestUpgradePoints} points`;
    }
  });
}
