import { entityGeneration, entityId, entitySlot } from "../entity";

export abstract class SlotStore {
  readonly active: Uint8Array;
  readonly activeSlots: Int32Array;
  readonly generation: Uint16Array;
  protected readonly free: Int32Array;
  private readonly activeIndexBySlot: Int32Array;
  protected freeCount: number;
  count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0xffff) throw new RangeError("Store capacity must be between 1 and 65535");
    this.active = new Uint8Array(capacity);
    this.activeSlots = new Int32Array(capacity);
    this.activeIndexBySlot = new Int32Array(capacity);
    this.activeIndexBySlot.fill(-1);
    this.generation = new Uint16Array(capacity);
    this.generation.fill(1);
    this.free = new Int32Array(capacity);
    for (let slot = 0; slot < capacity; slot += 1) this.free[slot] = capacity - slot - 1;
    this.freeCount = capacity;
  }

  protected allocateSlot(): number {
    if (this.freeCount === 0) return -1;
    const slot = this.free[--this.freeCount];
    this.active[slot] = 1;
    this.activeSlots[this.count] = slot;
    this.activeIndexBySlot[slot] = this.count;
    this.count += 1;
    return slot;
  }

  release(id: number): boolean {
    const slot = entitySlot(id);
    if (!this.has(id)) return false;
    const activeIndex = this.activeIndexBySlot[slot];
    const lastActiveIndex = this.count - 1;
    const lastActiveSlot = this.activeSlots[lastActiveIndex];
    this.activeSlots[activeIndex] = lastActiveSlot;
    this.activeIndexBySlot[lastActiveSlot] = activeIndex;
    this.activeIndexBySlot[slot] = -1;
    this.active[slot] = 0;
    this.generation[slot] = (this.generation[slot] + 1) & 0xffff;
    if (this.generation[slot] === 0) this.generation[slot] = 1;
    this.free[this.freeCount++] = slot;
    this.count = lastActiveIndex;
    this.clearSlot(slot);
    return true;
  }

  has(id: number): boolean {
    const slot = entitySlot(id);
    return slot < this.capacity && this.active[slot] === 1 && this.generation[slot] === entityGeneration(id);
  }

  idAt(slot: number): number {
    return entityId(slot, this.generation[slot]);
  }

  protected abstract clearSlot(slot: number): void;
}
