import type { MapEventKind } from '../../contracts/map-events';
import type { AtlasAreaType } from './atlas';

export const MAP_EVENT_NAMES: Record<MapEventKind, string> = { hunted: 'The Hunted', echoRift: 'Echo Rift' };
export const MAP_EVENT_BASE_CHANCE = 0.25;
export const MAP_EVENT_MAX_CHANCE = 0.65;
/** Absolute additions to the chance of each event (the two chances sum to the event chance). */
export const AREA_EVENT_BONUS: Partial<Record<AtlasAreaType, Partial<Record<MapEventKind, number>>>> = {
  forge: { hunted: 0.05 }, arena: { hunted: 0.10 },
  crypt: { echoRift: 0.10 }, vault: { echoRift: 0.05 },
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
