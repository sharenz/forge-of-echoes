import assert from "node:assert/strict";
import test from "node:test";
import { advanceCooldownDeadline } from "../../multiplayer/combat";

test("attack cooldown tolerates one simulation tick without increasing sustained attack rate", () => {
  const cooldown = 740;
  const tick = 50;
  const firstDeadline = advanceCooldownDeadline(1_000, 0, cooldown, tick);
  assert.equal(firstDeadline, 1_740);

  const quantizedEarlyDeadline = advanceCooldownDeadline(1_700, firstDeadline!, cooldown, tick);
  assert.equal(quantizedEarlyDeadline, 2_480, "an accepted early packet remains anchored to the prior cadence");

  assert.equal(
    advanceCooldownDeadline(2_400, quantizedEarlyDeadline!, cooldown, tick),
    null,
    "packets arriving more than one server tick early are rejected",
  );
});

test("late attack commands begin a fresh cooldown from their arrival time", () => {
  assert.equal(advanceCooldownDeadline(2_000, 1_740, 740, 50), 2_740);
});
