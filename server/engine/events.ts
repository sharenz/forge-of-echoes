import { WorldEventType, type WorldEvent, type WorldEventSource } from "../../multiplayer/wire/events";

export { WorldEventType };
export type { WorldEvent };

/** Fixed-capacity, struct-of-arrays event ring. A tick reset only moves the write cursor. */
export class WorldEventBuffer implements WorldEventSource, Iterable<WorldEvent> {
  readonly types: Uint8Array;
  readonly ticks: Uint32Array;
  readonly actorIds: Uint32Array;
  readonly targetIds: Uint32Array;
  readonly amounts: Float32Array;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly auxAs: Uint16Array;
  readonly auxBs: Uint16Array;
  readonly sequences: Uint32Array;
  length = 0;
  dropped = 0;

  constructor(readonly capacity: number) {
    this.types = new Uint8Array(capacity);
    this.ticks = new Uint32Array(capacity);
    this.actorIds = new Uint32Array(capacity);
    this.targetIds = new Uint32Array(capacity);
    this.amounts = new Float32Array(capacity);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.auxAs = new Uint16Array(capacity);
    this.auxBs = new Uint16Array(capacity);
    this.sequences = new Uint32Array(capacity);
  }

  push(event: WorldEvent): boolean {
    return this.pushValues(event.type, event.tick, event.actorId, event.targetId, event.amount, event.x, event.y, event.auxA, event.auxB, event.sequence);
  }

  pushValues(type: WorldEventType, tick: number, actorId: number, targetId: number, amount: number, x: number, y: number, auxA: number, auxB: number, sequence: number): boolean {
    const index = this.length;
    if (index >= this.capacity) {
      this.dropped += 1;
      return false;
    }
    this.types[index] = type;
    this.ticks[index] = tick;
    this.actorIds[index] = actorId;
    this.targetIds[index] = targetId;
    this.amounts[index] = amount;
    this.xs[index] = x;
    this.ys[index] = y;
    this.auxAs[index] = auxA;
    this.auxBs[index] = auxB;
    this.sequences[index] = sequence;
    this.length = index + 1;
    return true;
  }

  at(index: number): WorldEvent {
    if (index < 0 || index >= this.length) throw new RangeError("world_event_index_out_of_bounds");
    return {
      type: this.types[index] as WorldEventType,
      tick: this.ticks[index],
      actorId: this.actorIds[index],
      targetId: this.targetIds[index],
      amount: this.amounts[index],
      x: this.xs[index],
      y: this.ys[index],
      auxA: this.auxAs[index],
      auxB: this.auxBs[index],
      sequence: this.sequences[index],
    };
  }

  view(): this { return this; }

  some(predicate: (event: WorldEvent, index: number) => boolean): boolean {
    for (let index = 0; index < this.length; index += 1) if (predicate(this.at(index), index)) return true;
    return false;
  }

  filter(predicate: (event: WorldEvent, index: number) => boolean): WorldEvent[] {
    const result: WorldEvent[] = [];
    for (let index = 0; index < this.length; index += 1) {
      const event = this.at(index);
      if (predicate(event, index)) result.push(event);
    }
    return result;
  }

  *[Symbol.iterator](): Iterator<WorldEvent> {
    for (let index = 0; index < this.length; index += 1) yield this.at(index);
  }

  clear(): void {
    this.length = 0;
    this.dropped = 0;
  }
}

/** Authoritative consequences are never dropped; the room drains this once per fixed tick. */
export class WorldOutcomeBuffer {
  private readonly buffered: WorldEvent[] = [];

  push(event: WorldEvent): void { this.buffered.push(event); }
  view(): readonly WorldEvent[] { return this.buffered; }
  clear(): void { this.buffered.length = 0; }
}
