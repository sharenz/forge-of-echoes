import { decodeMonsterLifecycle, decodeMonsterSnapshot, type MonsterSpawnRecord } from "../../multiplayer/wire/snapshot";
import type { NetworkMonsterSampleConsumer, NetworkMonsterSampler } from "./types";

interface TimedMonsterFrame {
  receivedAt: number;
  x: number;
  y: number;
  lifePercent: number;
  flags: number;
}

export interface InterpolatedMonster extends MonsterSpawnRecord {
  lifePercent: number;
  flags: number;
}

interface BufferedMonster {
  static: MonsterSpawnRecord;
  frames: TimedMonsterFrame[];
}

export class MonsterInterpolationBuffer implements NetworkMonsterSampler {
  private readonly monsters = new Map<number, BufferedMonster>();
  private readonly idsBySlot = new Map<number, number>();

  constructor(private readonly delayMilliseconds = 100, private readonly maximumFrames = 6) {}

  applyLifecycle(bytes: Uint8Array): void {
    const packet = decodeMonsterLifecycle(bytes);
    for (const spawn of packet.spawns) {
      const slot = spawn.id & 0xffff;
      const oldId = this.idsBySlot.get(slot);
      if (oldId !== undefined && oldId !== spawn.id) this.monsters.delete(oldId);
      this.idsBySlot.set(slot, spawn.id);
      this.monsters.set(spawn.id, { static: spawn, frames: [] });
    }
    for (const id of packet.despawns) this.remove(id);
  }

  applySnapshot(bytes: Uint8Array, receivedAt: number): void {
    const packet = decodeMonsterSnapshot(bytes);
    for (const frame of packet.monsters) {
      const resolvedId = this.idsBySlot.get(frame.id & 0xffff) ?? frame.id;
      const monster = this.monsters.get(resolvedId);
      if (!monster) continue;
      const previous = monster.frames[monster.frames.length - 1];
      const x = frame.deltaX !== undefined ? (previous?.x ?? monster.static.x) + frame.deltaX
        : frame.positionUnchanged ? (previous?.x ?? monster.static.x) : frame.x;
      const y = frame.deltaY !== undefined ? (previous?.y ?? monster.static.y) + frame.deltaY
        : frame.positionUnchanged ? (previous?.y ?? monster.static.y) : frame.y;
      const lifePercent = frame.lifeChanged ? frame.lifePercent : (previous?.lifePercent ?? 1);
      const flags = frame.flagsChanged ? frame.flags : (previous?.flags ?? 0);
      monster.frames.push({ receivedAt, x, y, lifePercent, flags });
      if (monster.frames.length > this.maximumFrames) monster.frames.splice(0, monster.frames.length - this.maximumFrames);
    }
  }

  sample(now: number): InterpolatedMonster[] {
    const renderAt = now - this.delayMilliseconds;
    const sampled: InterpolatedMonster[] = [];
    for (const monster of this.monsters.values()) {
      const frames = monster.frames;
      if (frames.length === 0) continue;
      let from = frames[0];
      let to = frames[frames.length - 1];
      for (let index = 1; index < frames.length; index += 1) {
        if (frames[index].receivedAt < renderAt) continue;
        from = frames[index - 1];
        to = frames[index];
        break;
      }
      const duration = Math.max(1, to.receivedAt - from.receivedAt);
      const progress = Math.max(0, Math.min(1, (renderAt - from.receivedAt) / duration));
      sampled.push({
        ...monster.static,
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        lifePercent: from.lifePercent + (to.lifePercent - from.lifePercent) * progress,
        flags: to.flags,
      });
    }
    return sampled;
  }

  forEachSample(now: number, consumer: NetworkMonsterSampleConsumer): void {
    const renderAt = now - this.delayMilliseconds;
    for (const [id, monster] of this.monsters) {
      const frames = monster.frames;
      if (frames.length === 0) continue;
      let from = frames[0];
      let to = frames[frames.length - 1];
      for (let index = 1; index < frames.length; index += 1) {
        if (frames[index].receivedAt < renderAt) continue;
        from = frames[index - 1];
        to = frames[index];
        break;
      }
      const duration = Math.max(1, to.receivedAt - from.receivedAt);
      const progress = Math.max(0, Math.min(1, (renderAt - from.receivedAt) / duration));
      consumer(
        id,
        monster.static.archetype,
        monster.static.rarity,
        monster.static.maxLife,
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        from.lifePercent + (to.lifePercent - from.lifePercent) * progress,
        to.flags,
      );
    }
  }

  staticRecord(id: number): MonsterSpawnRecord | null {
    return this.monsters.get(id)?.static ?? null;
  }

  remove(id: number): boolean {
    const removed = this.monsters.delete(id);
    const slot = id & 0xffff;
    if (this.idsBySlot.get(slot) === id) this.idsBySlot.delete(slot);
    return removed;
  }

  get size(): number {
    return this.monsters.size;
  }
}
