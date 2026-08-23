import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { joinHideoutOptionsSchema, joinMapOptionsSchema, WIRE_PROTOCOL_VERSION } from "../../multiplayer/protocol";
import { ServerDrain } from "../../server/observability/ServerDrain";
import { ServerHealth } from "../../server/observability/ServerHealth";

test("drain mode is idempotent and notifies rooms exactly once", () => {
  const drain = new ServerDrain();
  let notifications = 0;
  drain.subscribe(() => { notifications += 1; });
  assert.deepEqual(drain.snapshot(), { draining: false, startedAt: null });
  const started = drain.begin(1_000);
  drain.begin(2_000);
  assert.deepEqual(started, { draining: true, startedAt: "1970-01-01T00:00:01.000Z" });
  assert.deepEqual(drain.snapshot(), started);
  assert.equal(notifications, 1);
});

test("health counters expose aggregate room and world failures", () => {
  const health = new ServerHealth();
  health.roomStarted("hideout");
  health.roomStarted("map");
  health.recordUnhandledRejection();
  health.recordWorldDelta(
    { droppedSimulationSteps: 1, droppedCosmeticEvents: 2, slowTicks: 0, slowestTickMilliseconds: 4 },
    { droppedSimulationSteps: 4, droppedCosmeticEvents: 7, slowTicks: 2, slowestTickMilliseconds: 18 },
  );
  const snapshot = health.snapshot();
  assert.equal(snapshot.activeHideoutRooms, 1);
  assert.equal(snapshot.activeMapRooms, 1);
  assert.equal(snapshot.unhandledRejections, 1);
  assert.deepEqual(snapshot.world, {
    droppedSimulationSteps: 3,
    droppedCosmeticEvents: 5,
    slowTicks: 2,
    slowestTickMilliseconds: 18,
  });
});

test("room admission requires the exact rolling-deploy protocol version", () => {
  const token = "x".repeat(32);
  assert.equal(joinHideoutOptionsSchema.safeParse({ token, partyId: "00000000-0000-4000-8000-000000000001", protocolVersion: WIRE_PROTOCOL_VERSION }).success, true);
  assert.equal(joinHideoutOptionsSchema.safeParse({ token, partyId: "00000000-0000-4000-8000-000000000001", protocolVersion: WIRE_PROTOCOL_VERSION + 1 }).success, false);
  assert.equal(joinMapOptionsSchema.safeParse({ token, mapTicket: token, portalIndex: 0 }).success, false);
});

test("unhandled promise rejections are logged and counted without process-wide shutdown", async () => {
  const source = await readFile(new URL("../../server/index.ts", import.meta.url), "utf8");
  const rejectionHandler = source.match(/process\.on\("unhandledRejection"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.match(rejectionHandler, /recordUnhandledRejection/);
  assert.match(rejectionHandler, /console\.error/);
  assert.doesNotMatch(rejectionHandler, /fatalShutdown|process\.exit/);
});
