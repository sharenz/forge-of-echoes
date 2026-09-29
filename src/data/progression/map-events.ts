import type { MapEventKind } from '../../contracts/map-events';
import type { AtlasAreaType } from './atlas';

export const MAP_EVENT_NAMES: Record<MapEventKind, string> = {
  hunted: 'The Hunted', echoRift: 'Echo Rift', blackout: 'Blackout', vaultbreakers: 'Vaultbreakers',
  secondCrown: 'Second Crown', wound: 'The Wound',
};
export const MAP_EVENT_MIN_TIER: Record<MapEventKind, number> = {
  hunted: 1, echoRift: 1, blackout: 3, vaultbreakers: 3, secondCrown: 5, wound: 3,
};
export const MAP_EVENT_COLORS: Record<MapEventKind, readonly [number, number, number]> = {
  hunted: [0.95, 0.68, 0.25], echoRift: [0.55, 0.35, 0.82], blackout: [0.65, 0.88, 0.95],
  vaultbreakers: [0.95, 0.8, 0.35], secondCrown: [1, 0.5, 0.2], wound: [0.9, 0.25, 0.4],
};
export const MAP_EVENT_BASE_CHANCE = 0.25;
export const MAP_EVENT_MAX_CHANCE = 0.65;
/** Absolute additions to each eligible event's chance; all chances sum to the event chance. */
export const AREA_EVENT_BONUS: Partial<Record<AtlasAreaType, Partial<Record<MapEventKind, number>>>> = {
  forge: { hunted: 0.05, blackout: 0.05 }, arena: { hunted: 0.10, secondCrown: 0.05 },
  crypt: { echoRift: 0.10, wound: 0.05 }, vault: { echoRift: 0.05, vaultbreakers: 0.10 },
};
export const MOD_EVENT_BONUS: Record<string, Partial<Record<MapEventKind, number>>> = {
  commanded: { hunted: 0.08 }, restless: { hunted: 0.05 },
  teeming: { echoRift: 0.05 }, echo: { echoRift: 0.10 },
};
export const MAP_EVENT_WARNING_SECONDS = 3;
/** A short breathing space, never an indefinite way to stall normal map progression. */
export const MAP_EVENT_GRACE_SECONDS = 20;
export const ECHO_RIFT_PULSES = 3;
export const ECHO_RIFT_PACK_SIZE = 3;
export const ECHO_RIFT_REACH = 70;
export const VAULTBREAKER_SECONDS = 40;
export const VAULTBREAKER_COUNT = 3;
export const BLACKOUT_PACKS = 3;
export const WOUND_PACKS = 3;
