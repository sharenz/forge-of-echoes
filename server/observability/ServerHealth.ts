import type { WorldHealthMetrics } from "../engine/World";

export interface ServerHealthSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  activeHideoutRooms: number;
  activeMapRooms: number;
  unhandledRejections: number;
  uncaughtExceptions: number;
  world: WorldHealthMetrics;
}

/**
 * Process-local health counters. They intentionally expose only aggregate
 * operational data: gameplay authority remains in rooms/PostgreSQL, while a
 * future multi-process metrics adapter can sum these per-worker snapshots.
 */
export class ServerHealth {
  private readonly startedAtMilliseconds = Date.now();
  private activeHideoutRooms = 0;
  private activeMapRooms = 0;
  private unhandledRejections = 0;
  private uncaughtExceptions = 0;
  private readonly world: WorldHealthMetrics = {
    droppedSimulationSteps: 0,
    droppedCosmeticEvents: 0,
    slowTicks: 0,
    slowestTickMilliseconds: 0,
  };

  roomStarted(kind: "hideout" | "map"): void {
    if (kind === "hideout") this.activeHideoutRooms += 1;
    else this.activeMapRooms += 1;
  }

  roomStopped(kind: "hideout" | "map"): void {
    if (kind === "hideout") this.activeHideoutRooms = Math.max(0, this.activeHideoutRooms - 1);
    else this.activeMapRooms = Math.max(0, this.activeMapRooms - 1);
  }

  recordUnhandledRejection(): void {
    this.unhandledRejections += 1;
  }

  recordUncaughtException(): void {
    this.uncaughtExceptions += 1;
  }

  recordWorldDelta(previous: WorldHealthMetrics, current: WorldHealthMetrics): void {
    this.world.droppedSimulationSteps += Math.max(0, current.droppedSimulationSteps - previous.droppedSimulationSteps);
    this.world.droppedCosmeticEvents += Math.max(0, current.droppedCosmeticEvents - previous.droppedCosmeticEvents);
    this.world.slowTicks += Math.max(0, current.slowTicks - previous.slowTicks);
    this.world.slowestTickMilliseconds = Math.max(this.world.slowestTickMilliseconds, current.slowestTickMilliseconds);
  }

  snapshot(nowMilliseconds = Date.now()): ServerHealthSnapshot {
    return {
      startedAt: new Date(this.startedAtMilliseconds).toISOString(),
      uptimeSeconds: Math.max(0, (nowMilliseconds - this.startedAtMilliseconds) / 1_000),
      activeHideoutRooms: this.activeHideoutRooms,
      activeMapRooms: this.activeMapRooms,
      unhandledRejections: this.unhandledRejections,
      uncaughtExceptions: this.uncaughtExceptions,
      world: { ...this.world },
    };
  }
}

export const serverHealth = new ServerHealth();
