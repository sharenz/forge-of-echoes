import assert from "node:assert/strict";
import test from "node:test";
import { schemaValues } from "../../app/multiplayer/schemaValues";

test("schemaValues treats a room collection that has not hydrated yet as empty", () => {
  assert.deepEqual(schemaValues(undefined), []);
  assert.deepEqual(schemaValues(null), []);
});

test("schemaValues returns every value from a hydrated schema collection", () => {
  const collection = new Map([
    ["first", { id: "first" }],
    ["second", { id: "second" }],
  ]);

  assert.deepEqual(schemaValues(collection), [{ id: "first" }, { id: "second" }]);
});
