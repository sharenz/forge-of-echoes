export type SpatialVisitor = (slot: number) => void;

export class SpatialGrid {
  readonly columns: number;
  readonly rows: number;
  private readonly heads: Int32Array;
  private readonly next: Int32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
    entityCapacity: number,
  ) {
    if (width <= 0 || height <= 0 || cellSize <= 0) throw new RangeError("Spatial grid dimensions must be positive");
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.heads = new Int32Array(this.columns * this.rows);
    this.next = new Int32Array(entityCapacity);
    this.clear();
  }

  clear(): void {
    this.heads.fill(-1);
    this.next.fill(-1);
  }

  insert(slot: number, x: number, y: number): void {
    const cell = this.cellIndex(x, y);
    this.next[slot] = this.heads[cell];
    this.heads[cell] = slot;
  }

  queryAabb(minX: number, minY: number, maxX: number, maxY: number, visitor: SpatialVisitor): void {
    const startX = this.clampColumn(Math.floor(minX / this.cellSize));
    const endX = this.clampColumn(Math.floor(maxX / this.cellSize));
    const startY = this.clampRow(Math.floor(minY / this.cellSize));
    const endY = this.clampRow(Math.floor(maxY / this.cellSize));
    for (let row = startY; row <= endY; row += 1) {
      const offset = row * this.columns;
      for (let column = startX; column <= endX; column += 1) {
        let slot = this.heads[offset + column];
        while (slot >= 0) {
          visitor(slot);
          slot = this.next[slot];
        }
      }
    }
  }

  querySegment(x1: number, y1: number, x2: number, y2: number, padding: number, visitor: SpatialVisitor): void {
    this.queryAabb(Math.min(x1, x2) - padding, Math.min(y1, y2) - padding, Math.max(x1, x2) + padding, Math.max(y1, y2) + padding, visitor);
  }

  private cellIndex(x: number, y: number): number {
    return this.clampRow(Math.floor(y / this.cellSize)) * this.columns + this.clampColumn(Math.floor(x / this.cellSize));
  }

  private clampColumn(column: number): number {
    return Math.max(0, Math.min(this.columns - 1, column));
  }

  private clampRow(row: number): number {
    return Math.max(0, Math.min(this.rows - 1, row));
  }
}
