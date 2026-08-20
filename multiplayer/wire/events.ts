export enum WorldEventType {
  Damage = 1,
  Kill = 2,
  Skill = 3,
  MonsterAction = 4,
  ProjectileSpawn = 5,
  ProjectileHit = 6,
  ProjectileExpire = 7,
  Drop = 8,
  MonsterSpawn = 9,
  MonsterDespawn = 10,
  MonsterProjectileHit = 11,
  MonsterProjectileExpire = 12,
  MonsterAggro = 13,
}

export interface WorldEvent {
  type: WorldEventType;
  tick: number;
  actorId: number;
  targetId: number;
  amount: number;
  x: number;
  y: number;
  auxA: number;
  auxB: number;
  sequence: number;
}

/** Allocation-free event storage consumed directly by the room codec. */
export interface WorldEventSource {
  readonly length: number;
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
}

const VERSION = 3;
const HEADER_BYTES = 8;

function recordBytes(type: WorldEventType): number {
  switch (type) {
    case WorldEventType.Skill: return 12;
    case WorldEventType.Damage: return 23;
    case WorldEventType.Kill: return 19;
    case WorldEventType.MonsterAction:
    case WorldEventType.ProjectileSpawn: return 24;
    case WorldEventType.ProjectileHit: return 18;
    case WorldEventType.ProjectileExpire: return 9;
    case WorldEventType.MonsterDespawn: return 5;
    case WorldEventType.MonsterProjectileHit:
    case WorldEventType.MonsterProjectileExpire: return 9;
    case WorldEventType.MonsterAggro: return 10;
    default: return 30;
  }
}

function sourceLength(source: readonly WorldEvent[] | WorldEventSource): number {
  return source.length;
}

function readEvent(source: readonly WorldEvent[] | WorldEventSource, index: number, target: WorldEvent): WorldEvent {
  if (Array.isArray(source)) return source[index];
  const typed = source as WorldEventSource;
  target.type = typed.types[index] as WorldEventType;
  target.tick = typed.ticks[index];
  target.actorId = typed.actorIds[index];
  target.targetId = typed.targetIds[index];
  target.amount = typed.amounts[index];
  target.x = typed.xs[index];
  target.y = typed.ys[index];
  target.auxA = typed.auxAs[index];
  target.auxB = typed.auxBs[index];
  target.sequence = typed.sequences[index];
  return target;
}

const scratchEvent: WorldEvent = { type: WorldEventType.Damage, tick: 0, actorId: 0, targetId: 0, amount: 0, x: 0, y: 0, auxA: 0, auxB: 0, sequence: 0 };

export function encodedWorldEventsSize(source: readonly WorldEvent[] | WorldEventSource, indexes?: Uint16Array, count = indexes?.length ?? sourceLength(source)): number {
  let size = HEADER_BYTES;
  for (let outputIndex = 0; outputIndex < count; outputIndex += 1) {
    const inputIndex = indexes ? indexes[outputIndex] : outputIndex;
    size += recordBytes(readEvent(source, inputIndex, scratchEvent).type);
  }
  return size;
}

/**
 * Encodes a single simulation tick. The packet stores tick once and uses a compact,
 * event-specific record layout. When `output` is supplied it is reused when large enough.
 */
export function encodeWorldEvents(
  source: readonly WorldEvent[] | WorldEventSource,
  indexes?: Uint16Array,
  count = indexes?.length ?? sourceLength(source),
  output?: Uint8Array,
): Uint8Array {
  const required = encodedWorldEventsSize(source, indexes, count);
  const bytes = output && output.byteLength >= required ? output.subarray(0, required) : new Uint8Array(required);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstIndex = count > 0 ? (indexes ? indexes[0] : 0) : 0;
  const tick = count > 0 ? readEvent(source, firstIndex, scratchEvent).tick : 0;
  view.setUint8(0, VERSION);
  view.setUint8(1, 0);
  view.setUint16(2, count, true);
  view.setUint32(4, tick >>> 0, true);
  let offset = HEADER_BYTES;
  for (let outputIndex = 0; outputIndex < count; outputIndex += 1) {
    const inputIndex = indexes ? indexes[outputIndex] : outputIndex;
    const event = readEvent(source, inputIndex, scratchEvent);
    view.setUint8(offset, event.type);
    switch (event.type) {
      case WorldEventType.Skill:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint8(offset + 5, event.auxA & 0xff);
        view.setUint16(offset + 6, event.auxB & 0xffff, true);
        view.setUint32(offset + 8, event.sequence >>> 0, true);
        break;
      case WorldEventType.Damage:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint32(offset + 5, event.targetId >>> 0, true);
        view.setFloat32(offset + 9, event.amount, true);
        view.setUint16(offset + 13, quantizePosition(event.x), true);
        view.setUint16(offset + 15, quantizePosition(event.y), true);
        view.setUint8(offset + 17, event.auxA & 0xff);
        view.setUint8(offset + 18, event.auxB & 0xff);
        view.setUint32(offset + 19, event.sequence >>> 0, true);
        break;
      case WorldEventType.Kill:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint32(offset + 5, event.targetId >>> 0, true);
        view.setUint16(offset + 9, quantizePosition(event.x), true);
        view.setUint16(offset + 11, quantizePosition(event.y), true);
        view.setUint8(offset + 13, event.auxA & 0xff);
        view.setUint8(offset + 14, event.auxB & 0xff);
        view.setUint32(offset + 15, event.sequence >>> 0, true);
        break;
      case WorldEventType.MonsterAction:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint32(offset + 5, event.targetId >>> 0, true);
        view.setFloat32(offset + 9, event.amount, true);
        view.setUint16(offset + 13, quantizePosition(event.x), true);
        view.setUint16(offset + 15, quantizePosition(event.y), true);
        view.setUint8(offset + 17, event.auxA & 0xff);
        view.setUint16(offset + 18, event.auxB & 0xffff, true);
        view.setUint32(offset + 20, event.sequence >>> 0, true);
        break;
      case WorldEventType.ProjectileSpawn:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint32(offset + 5, event.targetId >>> 0, true);
        view.setFloat32(offset + 9, event.amount, true);
        view.setUint16(offset + 13, quantizePosition(event.x), true);
        view.setUint16(offset + 15, quantizePosition(event.y), true);
        // ProjectileSpawn stores its quantized direction in auxA. It needs the
        // complete uint16 range; truncating it to uint8 points most visuals left.
        view.setUint16(offset + 17, event.auxA & 0xffff, true);
        view.setUint8(offset + 19, event.auxB & 0xff);
        view.setUint32(offset + 20, event.sequence >>> 0, true);
        break;
      case WorldEventType.ProjectileHit:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint32(offset + 5, event.targetId >>> 0, true);
        view.setUint16(offset + 9, quantizePosition(event.x), true);
        view.setUint16(offset + 11, quantizePosition(event.y), true);
        view.setUint8(offset + 13, event.auxA & 0xff);
        view.setUint32(offset + 14, event.sequence >>> 0, true);
        break;
      case WorldEventType.ProjectileExpire:
        view.setUint32(offset + 1, event.targetId >>> 0, true);
        view.setUint16(offset + 5, quantizePosition(event.x), true);
        view.setUint16(offset + 7, quantizePosition(event.y), true);
        break;
      case WorldEventType.MonsterDespawn:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        break;
      case WorldEventType.MonsterProjectileHit:
      case WorldEventType.MonsterProjectileExpire:
        view.setUint32(offset + 1, event.sequence >>> 0, true);
        view.setUint16(offset + 5, quantizePosition(event.x), true);
        view.setUint16(offset + 7, quantizePosition(event.y), true);
        break;
      case WorldEventType.MonsterAggro:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint8(offset + 5, event.auxA & 0xff);
        view.setUint16(offset + 6, quantizePosition(event.x), true);
        view.setUint16(offset + 8, quantizePosition(event.y), true);
        break;
      default:
        view.setUint32(offset + 1, event.actorId >>> 0, true);
        view.setUint32(offset + 5, event.targetId >>> 0, true);
        view.setFloat32(offset + 9, event.amount, true);
        view.setUint16(offset + 13, quantizePosition(event.x), true);
        view.setUint16(offset + 15, quantizePosition(event.y), true);
        view.setUint16(offset + 17, event.auxA & 0xffff, true);
        view.setUint16(offset + 19, event.auxB & 0xffff, true);
        view.setUint32(offset + 21, event.sequence >>> 0, true);
        view.setUint32(offset + 25, event.tick >>> 0, true);
        view.setUint8(offset + 29, 0);
        break;
    }
    offset += recordBytes(event.type);
  }
  return bytes;
}

export function decodeWorldEvents(bytes: Uint8Array): WorldEvent[] {
  if (bytes.byteLength < HEADER_BYTES) throw new Error("world_event_packet_too_short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== VERSION) throw new Error("unsupported_world_event_version");
  const count = view.getUint16(2, true);
  const tick = view.getUint32(4, true);
  const events: WorldEvent[] = [];
  let offset = HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (offset >= bytes.byteLength) throw new Error("invalid_world_event_packet_length");
    const type = view.getUint8(offset) as WorldEventType;
    const event: WorldEvent = { type, tick, actorId: 0, targetId: 0, amount: 0, x: 0, y: 0, auxA: 0, auxB: 0, sequence: 0 };
    const size = recordBytes(type);
    if (offset + size > bytes.byteLength) throw new Error("invalid_world_event_packet_length");
    switch (type) {
      case WorldEventType.Skill:
        event.actorId = view.getUint32(offset + 1, true);
        event.auxA = view.getUint8(offset + 5);
        event.auxB = view.getUint16(offset + 6, true);
        event.sequence = view.getUint32(offset + 8, true);
        break;
      case WorldEventType.Damage:
        event.actorId = view.getUint32(offset + 1, true);
        event.targetId = view.getUint32(offset + 5, true);
        event.amount = view.getFloat32(offset + 9, true);
        event.x = dequantizePosition(view.getUint16(offset + 13, true));
        event.y = dequantizePosition(view.getUint16(offset + 15, true));
        event.auxA = view.getUint8(offset + 17);
        event.auxB = view.getUint8(offset + 18);
        event.sequence = view.getUint32(offset + 19, true);
        break;
      case WorldEventType.Kill:
        event.actorId = view.getUint32(offset + 1, true);
        event.targetId = view.getUint32(offset + 5, true);
        event.x = dequantizePosition(view.getUint16(offset + 9, true));
        event.y = dequantizePosition(view.getUint16(offset + 11, true));
        event.auxA = view.getUint8(offset + 13);
        event.auxB = view.getUint8(offset + 14);
        event.sequence = view.getUint32(offset + 15, true);
        break;
      case WorldEventType.MonsterAction:
        event.actorId = view.getUint32(offset + 1, true);
        event.targetId = view.getUint32(offset + 5, true);
        event.amount = view.getFloat32(offset + 9, true);
        event.x = dequantizePosition(view.getUint16(offset + 13, true));
        event.y = dequantizePosition(view.getUint16(offset + 15, true));
        event.auxA = view.getUint8(offset + 17);
        event.auxB = view.getUint16(offset + 18, true);
        event.sequence = view.getUint32(offset + 20, true);
        break;
      case WorldEventType.ProjectileSpawn:
        event.actorId = view.getUint32(offset + 1, true);
        event.targetId = view.getUint32(offset + 5, true);
        event.amount = view.getFloat32(offset + 9, true);
        event.x = dequantizePosition(view.getUint16(offset + 13, true));
        event.y = dequantizePosition(view.getUint16(offset + 15, true));
        event.auxA = view.getUint16(offset + 17, true);
        event.auxB = view.getUint8(offset + 19);
        event.sequence = view.getUint32(offset + 20, true);
        break;
      case WorldEventType.ProjectileHit:
        event.actorId = view.getUint32(offset + 1, true);
        event.targetId = view.getUint32(offset + 5, true);
        event.x = dequantizePosition(view.getUint16(offset + 9, true));
        event.y = dequantizePosition(view.getUint16(offset + 11, true));
        event.auxA = view.getUint8(offset + 13);
        event.sequence = view.getUint32(offset + 14, true);
        break;
      case WorldEventType.ProjectileExpire:
        event.targetId = view.getUint32(offset + 1, true);
        event.x = dequantizePosition(view.getUint16(offset + 5, true));
        event.y = dequantizePosition(view.getUint16(offset + 7, true));
        break;
      case WorldEventType.MonsterDespawn:
        event.actorId = view.getUint32(offset + 1, true);
        break;
      case WorldEventType.MonsterProjectileHit:
      case WorldEventType.MonsterProjectileExpire:
        event.sequence = view.getUint32(offset + 1, true);
        event.x = dequantizePosition(view.getUint16(offset + 5, true));
        event.y = dequantizePosition(view.getUint16(offset + 7, true));
        break;
      case WorldEventType.MonsterAggro:
        event.actorId = view.getUint32(offset + 1, true);
        event.auxA = view.getUint8(offset + 5);
        event.x = dequantizePosition(view.getUint16(offset + 6, true));
        event.y = dequantizePosition(view.getUint16(offset + 8, true));
        break;
      default:
        event.actorId = view.getUint32(offset + 1, true);
        event.targetId = view.getUint32(offset + 5, true);
        event.amount = view.getFloat32(offset + 9, true);
        event.x = dequantizePosition(view.getUint16(offset + 13, true));
        event.y = dequantizePosition(view.getUint16(offset + 15, true));
        event.auxA = view.getUint16(offset + 17, true);
        event.auxB = view.getUint16(offset + 19, true);
        event.sequence = view.getUint32(offset + 21, true);
        event.tick = view.getUint32(offset + 25, true);
        break;
    }
    events.push(event);
    offset += size;
  }
  if (offset !== bytes.byteLength) throw new Error("invalid_world_event_packet_length");
  return events;
}

export function quantizePosition(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(value * 4)));
}

export function dequantizePosition(value: number): number {
  return value / 4;
}
