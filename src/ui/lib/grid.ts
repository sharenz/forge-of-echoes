// Grid geometry for inventory drag & drop. Pure; covered by tests/ui/helpers.test.ts.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Cell {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** The grid cell under a viewport point, or null outside the grid. */
export function cellAt(px: number, py: number, rect: Rect, grid: Size): Cell | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const fx = (px - rect.left) / (rect.width / grid.w);
  const fy = (py - rect.top) / (rect.height / grid.h);
  if (fx < 0 || fy < 0 || fx >= grid.w || fy >= grid.h) return null;
  return { x: Math.floor(fx), y: Math.floor(fy) };
}

/** Which cell of an item the pointer grabbed (offset in px inside the item box), clamped into the footprint. */
export function grabCell(offsetX: number, offsetY: number, cellPx: number, size: Size): Cell {
  const x = Math.floor(offsetX / Math.max(1, cellPx));
  const y = Math.floor(offsetY / Math.max(1, cellPx));
  return { x: clampInt(x, 0, size.w - 1), y: clampInt(y, 0, size.h - 1) };
}

/**
 * Top-left target of a dragged item so the grabbed cell stays under the pointer, clamped so the whole
 * footprint stays inside the grid (dragging a 2x3 against the edge snaps instead of turning red).
 */
export function placementOrigin(cell: Cell, grab: Cell, size: Size, grid: Size): Cell {
  return {
    x: clampInt(cell.x - grab.x, 0, Math.max(0, grid.w - size.w)),
    y: clampInt(cell.y - grab.y, 0, Math.max(0, grid.h - size.h)),
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
