// Four-way sprite facing with hysteresis (pure).
//
// The sorceress has south / north / east sprites (west = east mirrored). Picking the nearest of four directions
// every frame makes the sprite flicker whenever aim or movement hovers near a diagonal, so a facing only changes
// once the vector has moved clearly past the sector boundary. Horizontal sectors are a little wider than the
// vertical ones: on diagonals the side view reads better (the wand points where she casts).
import type { Dir4 } from '../contracts/sim';

/** Half-width (radians) of the east/west sectors; north/south get the remainder of each quadrant. */
export const HORIZONTAL_HALF_WIDTH = Math.PI / 4 + 0.12;
/** Extra angle (radians) the vector must travel past a boundary before the facing flips. */
export const FACING_HYSTERESIS = 0.2;

/** Which sector an angle (radians, 0 = east, y down) falls in, with the current sector widened by `hold`. */
function sectorOf(angle: number, current: Dir4 | null, hold: number): Dir4 {
  const H = HORIZONTAL_HALF_WIDTH;
  const a = Math.abs(angle);
  // Sector membership tests, each widened by `hold` if it is the current facing.
  const inEast = a < H + (current === 'east' ? hold : 0);
  const inWest = a > Math.PI - H - (current === 'west' ? hold : 0);
  const inSouth = angle > 0 && a > H - (current === 'south' ? hold : 0) && a < Math.PI - H + (current === 'south' ? hold : 0);
  const inNorth = angle < 0 && a > H - (current === 'north' ? hold : 0) && a < Math.PI - H + (current === 'north' ? hold : 0);
  if (current === 'east' && inEast) return 'east';
  if (current === 'west' && inWest) return 'west';
  if (current === 'south' && inSouth) return 'south';
  if (current === 'north' && inNorth) return 'north';
  if (a < H) return 'east';
  if (a > Math.PI - H) return 'west';
  return angle > 0 ? 'south' : 'north';
}

/**
 * Facing for the vector (dx, dy) given the current facing. Tiny vectors (|v| < minLength) keep the current facing.
 * `hold` is the hysteresis margin in radians.
 */
export function facingFromVector(dx: number, dy: number, current: Dir4, hold = FACING_HYSTERESIS, minLength = 1e-3): Dir4 {
  if (dx * dx + dy * dy < minLength * minLength) return current;
  return sectorOf(Math.atan2(dy, dx), current, hold);
}

/** Sprite set and mirroring for a facing: west is the east set flipped. */
export function spriteDir(d: Dir4): 'south' | 'north' | 'east' {
  return d === 'west' ? 'east' : d;
}
