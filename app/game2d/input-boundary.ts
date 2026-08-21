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
