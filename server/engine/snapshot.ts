import { entityGeneration, entitySlot } from "./entity";
import type { World } from "./World";
import { encodeMonsterLifecycle, encodeMonsterSnapshot, type MonsterLifecyclePacket, type MonsterSnapshotRecord } from "../../multiplayer/wire/snapshot";

export interface AreaOfInterest {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  margin: number;
}

export interface ReplicationFrame {
  snapshot: Uint8Array;
  lifecycle: Uint8Array | null;
  visibleMonsterCount: number;
}

export class MonsterReplicator {
  private readonly knownGeneration: Uint16Array;
  private readonly visibleMarker: Uint32Array;
  private readonly lastX: Uint16Array;
  private readonly lastY: Uint16Array;
  private readonly lastLife: Uint8Array;
  private readonly lastFlags: Uint8Array;
  private marker = 0;

  constructor(private readonly world: World) {
    const capacity = world.monsters.capacity;
    this.knownGeneration = new Uint16Array(capacity);
    this.visibleMarker = new Uint32Array(capacity);
    this.lastX = new Uint16Array(capacity);
    this.lastY = new Uint16Array(capacity);
    this.lastLife = new Uint8Array(capacity);
    this.lastFlags = new Uint8Array(capacity);
  }

  build(aoi: AreaOfInterest): ReplicationFrame {
    this.marker = (this.marker + 1) >>> 0 || 1;
    const monsters = this.world.monsters;
    const changes: MonsterSnapshotRecord[] = [];
    const lifecycle: MonsterLifecyclePacket = { spawns: [], despawns: [] };
    const halfWidth = aoi.width / 2 + aoi.margin;
    const halfHeight = aoi.height / 2 + aoi.margin;
    let visibleMonsterCount = 0;
    this.world.grid.queryAabb(aoi.centerX - halfWidth, aoi.centerY - halfHeight, aoi.centerX + halfWidth, aoi.centerY + halfHeight, (slot) => {
      if (!monsters.active[slot]) return;
      visibleMonsterCount += 1;
      this.visibleMarker[slot] = this.marker;
      const id = monsters.idAt(slot);
      const generation = entityGeneration(id);
      const x = Math.max(0, Math.min(0xffff, Math.round(monsters.x[slot] * 4)));
      const y = Math.max(0, Math.min(0xffff, Math.round(monsters.y[slot] * 4)));
      const life = Math.max(0, Math.min(255, Math.round((monsters.life[slot] / monsters.maxLife[slot]) * 255)));
      const newlyVisible = this.knownGeneration[slot] !== generation;
      if (newlyVisible) {
        const previousGeneration = this.knownGeneration[slot];
        if (previousGeneration !== 0) lifecycle.despawns.push(((previousGeneration << 16) | slot) >>> 0);
        this.knownGeneration[slot] = generation;
        lifecycle.spawns.push({ id, archetype: monsters.archetype[slot], rarity: monsters.rarity[slot], maxLife: monsters.maxLife[slot], x: monsters.x[slot], y: monsters.y[slot] });
      }
      const positionChanged = this.lastX[slot] !== x || this.lastY[slot] !== y;
      const lifeChanged = newlyVisible || this.lastLife[slot] !== life;
      const flagsChanged = newlyVisible || this.lastFlags[slot] !== monsters.flags[slot];
      const distanceX = monsters.x[slot] - aoi.centerX;
      const distanceY = monsters.y[slot] - aoi.centerY;
      const farPositionOnlyUpdate = !newlyVisible && positionChanged && !lifeChanged && !flagsChanged
        && distanceX * distanceX + distanceY * distanceY > 300 * 300
        && this.world.tickNumber % 4 !== 0;
      if (farPositionOnlyUpdate) return;
      if (newlyVisible || positionChanged || lifeChanged || flagsChanged) {
        const deltaX = x - this.lastX[slot];
        const deltaY = y - this.lastY[slot];
        const canDelta = !newlyVisible && positionChanged && deltaX >= -127 && deltaX <= 127 && deltaY >= -127 && deltaY <= 127;
        changes.push({
          id,
          x: monsters.x[slot],
          y: monsters.y[slot],
          lifePercent: life / 255,
          flags: monsters.flags[slot],
          positionUnchanged: !positionChanged,
          deltaX: canDelta ? deltaX / 4 : undefined,
          deltaY: canDelta ? deltaY / 4 : undefined,
          lifeChanged,
          flagsChanged,
        });
        this.lastX[slot] = x;
        this.lastY[slot] = y;
        this.lastLife[slot] = life;
        this.lastFlags[slot] = monsters.flags[slot];
      }
    });
    for (let slot = 0; slot < this.knownGeneration.length; slot += 1) {
      if (this.knownGeneration[slot] === 0 || this.visibleMarker[slot] === this.marker) continue;
      lifecycle.despawns.push(((this.knownGeneration[slot] << 16) | slot) >>> 0);
      this.knownGeneration[slot] = 0;
    }
    return {
      snapshot: encodeMonsterSnapshot({ tick: this.world.tickNumber, monsters: changes }),
      lifecycle: lifecycle.spawns.length || lifecycle.despawns.length ? encodeMonsterLifecycle(lifecycle) : null,
      visibleMonsterCount,
    };
  }

  forget(id: number): void {
    const slot = entitySlot(id);
    if (slot < this.knownGeneration.length && this.knownGeneration[slot] === entityGeneration(id)) this.knownGeneration[slot] = 0;
  }
}
