/**
 * Phaser observes pointer events beyond the canvas in some browser/input
 * configurations. Combat input is valid only when the native event began on
 * the canvas and did not hit an interactive Phaser object such as a portal.
 */
export function isWorldPointerOrigin(
  eventTarget: EventTarget | null,
  canvas: EventTarget,
  interactiveTargetCount: number,
): boolean {
  return eventTarget === canvas && interactiveTargetCount === 0;
}

export interface AimVector {
  x: number;
  y: number;
}

/**
 * Resolves one finite unit-vector from the character to the current pointer.
 * The fallback keeps release callbacks safe when the pointer is exactly on the
 * character or the browser reports a transient non-finite coordinate.
 */
export function resolveAimVector(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  fallback: AimVector,
): AimVector {
  const x = targetX - originX;
  const y = targetY - originY;
  const length = Math.hypot(x, y);
  return Number.isFinite(length) && length > 0.1
    ? { x: x / length, y: y / length }
    : fallback;
}
