// The Orrery's coordinates (docs/power-rework/passive-tree.md 2.1): a 768 × 768 world, Spark in the centre, seven sectors clockwise
// from the top (Fire at 12 o'clock). Positions are polar: a sector's spine runs outward along its angle, spur columns sit at fixed
// angular offsets beside it, so every ring of nodes reads as one orbit of the wheel. Pure functions of the table in nodes.ts.
import type { PassiveSector } from '../../../contracts/passives';
import { PASSIVE_SECTORS } from '../../../contracts/passives';

/** World size in px (the Atlas Codex is 512). */
export const ORRERY_SIZE = 768;
export const ORRERY_CENTER = ORRERY_SIZE / 2;

/** Radius of the gates and the hub ring. */
export const HUB_RING_RADIUS = 122;
/** Radius of the cross-hub notables (inside the ring). */
export const CROSS_RADIUS = 78;
/** Radii of the two smalls and the keystone of a hub keystone path. */
export const HUB_KEYSTONE_RADII = [34, 61, 88] as const;
/** Radius of sector row 0 and the step per row (row 9, the rim, at 354). */
export const ROW_RADIUS_0 = 165;
export const ROW_STEP = 21;
/** Angular offset of one spur column, degrees. */
export const COLUMN_DEGREES = 8;

const SECTOR_DEGREES = 360 / PASSIVE_SECTORS.length;

/** Angle (degrees, 0 = east, clockwise on screen) of a ring position: sector index k, or k + 0.5 between sector k and k + 1. */
export function ringAngle(at: number): number {
  return -90 + at * SECTOR_DEGREES;
}

export function sectorIndex(sector: PassiveSector): number {
  return PASSIVE_SECTORS.indexOf(sector);
}

const round = (v: number) => Math.round(v * 10) / 10;

export function polar(radius: number, degrees: number): { x: number; y: number } {
  const a = (degrees * Math.PI) / 180;
  return { x: round(ORRERY_CENTER + radius * Math.cos(a)), y: round(ORRERY_CENTER + radius * Math.sin(a)) };
}

export function rowRadius(row: number): number {
  return ROW_RADIUS_0 + ROW_STEP * row;
}

/** A sector cell: row 0 to 9 outward, column −2 to 2 (negative = counter-clockwise). */
export function cellPos(sector: PassiveSector, row: number, col: number): { x: number; y: number } {
  return polar(rowRadius(row), ringAngle(sectorIndex(sector)) + col * COLUMN_DEGREES);
}

export function gatePos(sector: PassiveSector): { x: number; y: number } {
  return polar(HUB_RING_RADIUS, ringAngle(sectorIndex(sector)));
}

/** Ring small k sits between gate k and gate k + 1. */
export function ringSmallPos(k: number): { x: number; y: number } {
  return polar(HUB_RING_RADIUS, ringAngle(k + 0.5));
}

/** Bridges sit at mid-radius halfway between their two sectors. */
export function bridgePos(first: PassiveSector, row: number): { x: number; y: number } {
  return polar(rowRadius(row), ringAngle(sectorIndex(first) + 0.5));
}

export function crossPos(at: number): { x: number; y: number } {
  return polar(CROSS_RADIUS, ringAngle(at));
}

export function hubKeystonePathPos(at: number, step: 0 | 1 | 2): { x: number; y: number } {
  return polar(HUB_KEYSTONE_RADII[step], ringAngle(at));
}

export const SPARK_POS = { x: ORRERY_CENTER, y: ORRERY_CENTER } as const;
