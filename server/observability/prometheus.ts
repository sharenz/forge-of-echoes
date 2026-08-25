import type { ServerHealthSnapshot } from "./ServerHealth";

/**
 * Renders the Prometheus text exposition format (version 0.0.4 semantics,
 * accepted by all scrapers) without a client dependency. Values come from the
 * same process-local counters that back /healthz; a future multi-worker
 * metrics adapter can sum per-process snapshots exactly as ServerHealth
 * documents.
 */
export function renderPrometheusMetrics(health: ServerHealthSnapshot, draining: boolean): string {
  const lines = [
    "# TYPE forgeofechoes_up gauge",
    "forgeofechoes_up 1",
    "# TYPE forgeofechoes_draining gauge",
    `forgeofechoes_draining ${draining ? 1 : 0}`,
    "# TYPE forgeofechoes_uptime_seconds gauge",
    `forgeofechoes_uptime_seconds ${health.uptimeSeconds.toFixed(3)}`,
    "# TYPE forgeofechoes_active_rooms gauge",
    `forgeofechoes_active_rooms{kind="hideout"} ${health.activeHideoutRooms}`,
    `forgeofechoes_active_rooms{kind="map"} ${health.activeMapRooms}`,
    "# TYPE forgeofechoes_unhandled_rejections_total counter",
    `forgeofechoes_unhandled_rejections_total ${health.unhandledRejections}`,
    "# TYPE forgeofechoes_uncaught_exceptions_total counter",
    `forgeofechoes_uncaught_exceptions_total ${health.uncaughtExceptions}`,
    "# TYPE forgeofechoes_world_dropped_simulation_steps_total counter",
    `forgeofechoes_world_dropped_simulation_steps_total ${health.world.droppedSimulationSteps}`,
    "# TYPE forgeofechoes_world_dropped_cosmetic_events_total counter",
    `forgeofechoes_world_dropped_cosmetic_events_total ${health.world.droppedCosmeticEvents}`,
    "# TYPE forgeofechoes_world_slow_ticks_total counter",
    `forgeofechoes_world_slow_ticks_total ${health.world.slowTicks}`,
    "# TYPE forgeofechoes_world_slowest_tick_milliseconds gauge",
    `forgeofechoes_world_slowest_tick_milliseconds ${health.world.slowestTickMilliseconds.toFixed(3)}`,
  ];
  return `${lines.join("\n")}\n`;
}
