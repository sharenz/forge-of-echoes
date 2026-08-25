import assert from "node:assert/strict";
import test from "node:test";
import { renderPrometheusMetrics } from "../../server/observability/prometheus";
import type { ServerHealthSnapshot } from "../../server/observability/ServerHealth";

test("prometheus rendering exposes health counters in exposition format", () => {
  const snapshot: ServerHealthSnapshot = {
    startedAt: "2026-08-25T00:00:00.000Z",
    uptimeSeconds: 93.25,
    activeHideoutRooms: 2,
    activeMapRooms: 5,
    unhandledRejections: 1,
    uncaughtExceptions: 0,
    world: {
      droppedSimulationSteps: 7,
      droppedCosmeticEvents: 12,
      slowTicks: 3,
      slowestTickMilliseconds: 24.5,
    },
  };
  const output = renderPrometheusMetrics(snapshot, true);
  const lines = output.split("\n");
  assert.equal(lines.at(-1), "", "exposition output ends with a newline");
  for (const expected of [
    "forgeofechoes_up 1",
    "forgeofechoes_draining 1",
    "forgeofechoes_uptime_seconds 93.250",
    'forgeofechoes_active_rooms{kind="hideout"} 2',
    'forgeofechoes_active_rooms{kind="map"} 5',
    "forgeofechoes_unhandled_rejections_total 1",
    "forgeofechoes_uncaught_exceptions_total 0",
    "forgeofechoes_world_dropped_simulation_steps_total 7",
    "forgeofechoes_world_dropped_cosmetic_events_total 12",
    "forgeofechoes_world_slow_ticks_total 3",
    "forgeofechoes_world_slowest_tick_milliseconds 24.500",
  ]) assert.ok(lines.includes(expected), `missing metric line: ${expected}`);
  assert.ok(output.includes("# TYPE forgeofechoes_world_slow_ticks_total counter"));
});
