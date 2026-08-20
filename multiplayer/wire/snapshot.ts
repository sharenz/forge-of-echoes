import { dequantizePosition, quantizePosition } from "./events";

const SNAPSHOT_VERSION = 2;
const SNAPSHOT_HEADER_BYTES = 8;
const MASK_ABSOLUTE_POSITION = 1 << 0;
const MASK_DELTA_POSITION = 1 << 1;
const MASK_LIFE = 1 << 2;
const MASK_FLAGS = 1 << 3;

export interface MonsterSnapshotRecord {
  /** Full entity id while encoding; slot id while decoding. Lifecycle resolves the generation. */
  id: number;
  x: number;
  y: number;
  lifePercent: number;
  flags: number;
  positionUnchanged?: boolean;
  deltaX?: number;
  deltaY?: number;
  lifeChanged?: boolean;
  flagsChanged?: boolean;
}

export interface MonsterSnapshotPacket {
  tick: number;
  monsters: MonsterSnapshotRecord[];
}

export interface MonsterSpawnRecord {
  id: number;
  archetype: number;
  rarity: number;
  maxLife: number;
  x: number;
  y: number;
}

export interface MonsterLifecyclePacket {
  spawns: MonsterSpawnRecord[];
  despawns: number[];
}

function snapshotMask(monster: MonsterSnapshotRecord): number {
  const hasDelta = monster.deltaX !== undefined && monster.deltaY !== undefined;
  const hasAbsolute = !monster.positionUnchanged && !hasDelta;
  return (hasAbsolute ? MASK_ABSOLUTE_POSITION : 0)
    | (hasDelta ? MASK_DELTA_POSITION : 0)
    | (monster.lifeChanged === false ? 0 : MASK_LIFE)
    | (monster.flagsChanged === false ? 0 : MASK_FLAGS);
}

function snapshotRecordBytes(mask: number): number {
  if (mask === MASK_DELTA_POSITION) return 4;
  return 3
    + (mask & MASK_ABSOLUTE_POSITION ? 4 : 0)
    + (mask & MASK_DELTA_POSITION ? 2 : 0)
    + (mask & MASK_LIFE ? 1 : 0)
    + (mask & MASK_FLAGS ? 1 : 0);
}

export function encodeMonsterSnapshot(packet: MonsterSnapshotPacket): Uint8Array {
  let byteLength = SNAPSHOT_HEADER_BYTES;
  for (const monster of packet.monsters) byteLength += snapshotRecordBytes(snapshotMask(monster));
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, SNAPSHOT_VERSION);
  view.setUint8(1, 1);
  view.setUint32(2, packet.tick >>> 0, true);
  view.setUint16(6, packet.monsters.length, true);
  let offset = SNAPSHOT_HEADER_BYTES;
  for (const monster of packet.monsters) {
    const mask = snapshotMask(monster);
    if (mask === MASK_DELTA_POSITION) {
      view.setUint16(offset, (monster.id & 0x7fff) | 0x8000, true);
      view.setInt8(offset + 2, Math.max(-127, Math.min(127, Math.round((monster.deltaX ?? 0) * 4))));
      view.setInt8(offset + 3, Math.max(-127, Math.min(127, Math.round((monster.deltaY ?? 0) * 4))));
      offset += 4;
      continue;
    }
    view.setUint16(offset, monster.id & 0xffff, true);
    view.setUint8(offset + 2, mask);
    offset += 3;
    if (mask & MASK_ABSOLUTE_POSITION) {
      view.setUint16(offset, quantizePosition(monster.x), true);
      view.setUint16(offset + 2, quantizePosition(monster.y), true);
      offset += 4;
    } else if (mask & MASK_DELTA_POSITION) {
      view.setInt8(offset, Math.max(-127, Math.min(127, Math.round((monster.deltaX ?? 0) * 4))));
      view.setInt8(offset + 1, Math.max(-127, Math.min(127, Math.round((monster.deltaY ?? 0) * 4))));
      offset += 2;
    }
    if (mask & MASK_LIFE) {
      view.setUint8(offset, Math.max(0, Math.min(255, Math.round(monster.lifePercent * 255))));
      offset += 1;
    }
    if (mask & MASK_FLAGS) {
      view.setUint8(offset, monster.flags & 0xff);
      offset += 1;
    }
  }
  return bytes;
}

export function decodeMonsterSnapshot(bytes: Uint8Array): MonsterSnapshotPacket {
  if (bytes.byteLength < SNAPSHOT_HEADER_BYTES) throw new Error("monster_snapshot_too_short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== SNAPSHOT_VERSION || view.getUint8(1) !== 1) throw new Error("unsupported_monster_snapshot");
  const count = view.getUint16(6, true);
  const monsters: MonsterSnapshotRecord[] = [];
  let offset = SNAPSHOT_HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (offset + 2 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
    const encodedId = view.getUint16(offset, true);
    if (encodedId & 0x8000) {
      if (offset + 4 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
      monsters.push({
        id: encodedId & 0x7fff,
        x: 0,
        y: 0,
        lifePercent: 0,
        flags: 0,
        deltaX: view.getInt8(offset + 2) / 4,
        deltaY: view.getInt8(offset + 3) / 4,
        lifeChanged: false,
        flagsChanged: false,
      });
      offset += 4;
      continue;
    }
    if (offset + 3 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
    const id = encodedId;
    const mask = view.getUint8(offset + 2);
    offset += 3;
    let x = 0;
    let y = 0;
    let deltaX: number | undefined;
    let deltaY: number | undefined;
    if (mask & MASK_ABSOLUTE_POSITION) {
      if (offset + 4 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
      x = dequantizePosition(view.getUint16(offset, true));
      y = dequantizePosition(view.getUint16(offset + 2, true));
      offset += 4;
    } else if (mask & MASK_DELTA_POSITION) {
      if (offset + 2 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
      deltaX = view.getInt8(offset) / 4;
      deltaY = view.getInt8(offset + 1) / 4;
      offset += 2;
    }
    let lifePercent = 0;
    let flags = 0;
    if (mask & MASK_LIFE) {
      if (offset + 1 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
      lifePercent = view.getUint8(offset) / 255;
      offset += 1;
    }
    if (mask & MASK_FLAGS) {
      if (offset + 1 > bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
      flags = view.getUint8(offset);
      offset += 1;
    }
    monsters.push({
      id,
      x,
      y,
      lifePercent,
      flags,
      positionUnchanged: !(mask & (MASK_ABSOLUTE_POSITION | MASK_DELTA_POSITION)),
      deltaX,
      deltaY,
      lifeChanged: Boolean(mask & MASK_LIFE),
      flagsChanged: Boolean(mask & MASK_FLAGS),
    });
  }
  if (offset !== bytes.byteLength) throw new Error("invalid_monster_snapshot_length");
  return { tick: view.getUint32(2, true), monsters };
}

export function encodeMonsterLifecycle(packet: MonsterLifecyclePacket): Uint8Array {
  const bytes = new Uint8Array(6 + packet.spawns.length * 16 + packet.despawns.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, SNAPSHOT_VERSION);
  view.setUint8(1, 2);
  view.setUint16(2, packet.spawns.length, true);
  view.setUint16(4, packet.despawns.length, true);
  let offset = 6;
  for (const spawn of packet.spawns) {
    view.setUint32(offset, spawn.id >>> 0, true);
    view.setUint8(offset + 4, spawn.archetype & 0xff);
    view.setUint8(offset + 5, spawn.rarity & 0xff);
    view.setFloat32(offset + 6, spawn.maxLife, true);
    view.setUint16(offset + 10, quantizePosition(spawn.x), true);
    view.setUint16(offset + 12, quantizePosition(spawn.y), true);
    view.setUint16(offset + 14, 0, true);
    offset += 16;
  }
  for (const id of packet.despawns) {
    view.setUint32(offset, id >>> 0, true);
    offset += 4;
  }
  return bytes;
}

export function decodeMonsterLifecycle(bytes: Uint8Array): MonsterLifecyclePacket {
  if (bytes.byteLength < 6) throw new Error("monster_lifecycle_too_short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== SNAPSHOT_VERSION || view.getUint8(1) !== 2) throw new Error("unsupported_monster_lifecycle");
  const spawnCount = view.getUint16(2, true);
  const despawnCount = view.getUint16(4, true);
  if (bytes.byteLength !== 6 + spawnCount * 16 + despawnCount * 4) throw new Error("invalid_monster_lifecycle_length");
  const spawns: MonsterSpawnRecord[] = [];
  let offset = 6;
  for (let index = 0; index < spawnCount; index += 1) {
    spawns.push({
      id: view.getUint32(offset, true),
      archetype: view.getUint8(offset + 4),
      rarity: view.getUint8(offset + 5),
      maxLife: view.getFloat32(offset + 6, true),
      x: dequantizePosition(view.getUint16(offset + 10, true)),
      y: dequantizePosition(view.getUint16(offset + 12, true)),
    });
    offset += 16;
  }
  const despawns: number[] = [];
  for (let index = 0; index < despawnCount; index += 1) {
    despawns.push(view.getUint32(offset, true));
    offset += 4;
  }
  return { spawns, despawns };
}
