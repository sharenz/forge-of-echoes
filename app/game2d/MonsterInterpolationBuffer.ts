import { decodeMonsterLifecycle, decodeMonsterSnapshot, type MonsterSpawnRecord } from "../../multiplayer/wire/snapshot";
import { AUTHORITATIVE_SIMULATION_STEP_SECONDS } from "../../multiplayer/simulation";
import type { NetworkMonsterSampleConsumer, NetworkMonsterSampler } from "./types";

interface TimedMonsterFrame {
  serverTime: number;
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
  private clockOffsetMilliseconds: number | null = null;
  private renderAheadPackets = 0;

  constructor(
    private readonly delayMilliseconds = 150,
    private readonly maximumFrames = 8,
    private readonly maximumExtrapolationMilliseconds = 100,
  ) {}

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
    const serverTime = packet.tick * AUTHORITATIVE_SIMULATION_STEP_SECONDS * 1_000;
    const measuredOffset = receivedAt - serverTime;
    const renderedBeforeObservation = this.clockOffsetMilliseconds === null
      ? Number.NEGATIVE_INFINITY
      : receivedAt - this.clockOffsetMilliseconds - this.delayMilliseconds;
    if (renderedBeforeObservation > serverTime + this.maximumExtrapolationMilliseconds / 2) {
      this.renderAheadPackets += 1;
    } else {
      this.renderAheadPackets = 0;
    }
    if (this.renderAheadPackets >= 3) {
      // A server stall can deliberately drop simulation steps. Re-anchor after
      // three consecutive confirmations instead of spending minutes pinned at
      // the extrapolation cap while the old min-filter offset crawls upward.
      this.clockOffsetMilliseconds = measuredOffset;
      this.renderAheadPackets = 0;
    } else if (this.clockOffsetMilliseconds === null || measuredOffset < this.clockOffsetMilliseconds) {
      // The lowest observed offset is the least-jittered clock sample. A slow
      // upward nudge still follows long-running clock drift without turning a
      // delayed packet into visible speed-up/slow-down.
      this.clockOffsetMilliseconds = measuredOffset;
    } else {
      this.clockOffsetMilliseconds += Math.min(0.02, measuredOffset - this.clockOffsetMilliseconds);
    }
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
      // A repeated or reordered packet must never rewind an entity timeline.
      if (previous && serverTime <= previous.serverTime) continue;
      monster.frames.push({ serverTime, x, y, lifePercent, flags });
      if (monster.frames.length > this.maximumFrames) monster.frames.splice(0, monster.frames.length - this.maximumFrames);
    }
  }

  sample(now: number): InterpolatedMonster[] {
    const renderAt = this.renderServerTime(now);
    const sampled: InterpolatedMonster[] = [];
    for (const monster of this.monsters.values()) {
      const frames = monster.frames;
      if (frames.length === 0) continue;
      const { from, to, progress } = this.framePair(frames, renderAt);
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
    const renderAt = this.renderServerTime(now);
    for (const [id, monster] of this.monsters) {
      const frames = monster.frames;
      if (frames.length === 0) continue;
      const { from, to, progress } = this.framePair(frames, renderAt);
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

  private renderServerTime(now: number): number {
    if (this.clockOffsetMilliseconds === null) return Number.NEGATIVE_INFINITY;
    return now - this.clockOffsetMilliseconds - this.delayMilliseconds;
  }

  private framePair(frames: TimedMonsterFrame[], renderAt: number): {
    from: TimedMonsterFrame;
    to: TimedMonsterFrame;
    progress: number;
  } {
    if (frames.length === 1 || renderAt <= frames[0].serverTime) {
      return { from: frames[0], to: frames[0], progress: 0 };
    }
    for (let index = 1; index < frames.length; index += 1) {
      const to = frames[index];
      if (to.serverTime < renderAt) continue;
      const from = frames[index - 1];
      const duration = Math.max(1, to.serverTime - from.serverTime);
      return { from, to, progress: Math.max(0, Math.min(1, (renderAt - from.serverTime) / duration)) };
    }
    const to = frames[frames.length - 1];
    const from = frames[Math.max(0, frames.length - 2)];
    const duration = Math.max(1, to.serverTime - from.serverTime);
    const extrapolation = Math.min(this.maximumExtrapolationMilliseconds, Math.max(0, renderAt - to.serverTime));
    return { from, to, progress: Math.min(2, 1 + extrapolation / duration) };
  }
}
