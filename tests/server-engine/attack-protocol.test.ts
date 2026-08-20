import assert from "node:assert/strict";
import test from "node:test";
import { attackCommandSchema } from "../../multiplayer/protocol";

test("direction is the sole authoritative targeting input for basic attacks", () => {
  assert.equal(attackCommandSchema.safeParse({
    sequence: 1,
    skill: "basic",
    direction: { x: 0.8, y: -0.6 },
  }).success, true);

  assert.equal(attackCommandSchema.safeParse({
    sequence: 2,
    skill: "basic",
    direction: { x: 1, y: 0 },
    targetId: "65536",
  }).success, false, "runtime monster IDs must never leak into the attack command contract");
});
