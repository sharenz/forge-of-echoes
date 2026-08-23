import assert from "node:assert/strict";
import test from "node:test";
import { retryWithinWindow } from "../../app/multiplayer/MultiplayerClient";

test("reconnect retries with backoff for the full recovery window", async () => {
  let now = 0;
  let attempts = 0;
  const delays: number[] = [];
  const result = await retryWithinWindow(async () => {
    attempts += 1;
    if (attempts < 4) throw new Error("temporarily unavailable");
    return "connected";
  }, {
    windowMilliseconds: 2_000,
    delaysMilliseconds: [100, 200, 400],
    now: () => now,
    sleep: async (delay) => { delays.push(delay); now += delay; },
  });
  assert.equal(result, "connected");
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [100, 200, 400]);
});

test("reconnect stops at the deadline and reports the last failure", async () => {
  let now = 0;
  let attempts = 0;
  await assert.rejects(() => retryWithinWindow(async () => {
    attempts += 1;
    throw new Error(`failure-${attempts}`);
  }, {
    windowMilliseconds: 250,
    delaysMilliseconds: [100],
    now: () => now,
    sleep: async (delay) => { now += delay; },
  }), /failure-3/);
  assert.equal(attempts, 3);
});
