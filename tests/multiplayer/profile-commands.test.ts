import assert from "node:assert/strict";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { profileCommandSchema } from "../../multiplayer/protocol";
import { findFirstFit } from "../../app/game/item-container";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import { ProfileCommandError, ProfileCommandService } from "../../server/services/ProfileCommandService";

test("authoritative profile commands move only existing items and reject stale concurrent writes", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const identity = await createTestPlayer(repository, { handle: "profile-test", characterName: "Aster", classId: "sorceress" });
    const initial = await repository.loadProfile(identity.characterId);
    assert.ok(initial);
    const weapon = initial.profile.equipped.mainHand!;
    assert.match(weapon.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const position = findFirstFit(initial.profile.inventory, weapon);
    assert.ok(position);

    const service = new ProfileCommandService(repository);
    const moved = await service.execute(identity.characterId, initial.revision, {
      type: "move_item", itemId: weapon.id, destination: "backpack", ...position,
    });
    assert.equal(moved.revision, initial.revision + 1);
    assert.equal(moved.profile.equipped.mainHand, undefined);
    assert.ok(moved.profile.inventory.entries.some((entry) => entry.item.id === weapon.id));

    await assert.rejects(
      () => service.execute(identity.characterId, initial.revision, {
        type: "move_item", itemId: weapon.id, destination: "backpack", x: position.x, y: position.y,
      }),
      (error) => error instanceof ProfileCommandError && error.code === "revision_conflict",
    );
    await assert.rejects(
      () => service.execute(identity.characterId, moved.revision, {
        type: "equip_item", itemId: "00000000-0000-4000-8000-000000000000", slot: "mainHand",
      }),
      (error) => error instanceof ProfileCommandError && error.code === "invalid_command",
    );
  } finally {
    await repository.close();
  }
});
test("profile protocol rejects client-authored item data and unsupported commands", () => {
  assert.equal(profileCommandSchema.safeParse({
    type: "move_item",
    itemId: "00000000-0000-4000-8000-000000000000",
    destination: "backpack",
    x: 0,
    y: 0,
    item: { kind: "equipment", attackDamage: 999_999 },
  }).success, false);
  assert.equal(profileCommandSchema.safeParse({ type: "grant_item", baseId: "god-sword" }).success, false);
});

test("online merchant and map crafting create only server-owned UUID items", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const identity = await createTestPlayer(repository, { handle: "online-crafter", characterName: "Smith", classId: "barbarian" });
    const initial = await repository.loadProfile(identity.characterId);
    assert.ok(initial);
    const service = new ProfileCommandService(repository);
    const initialMapCount = initial.profile.inventory.entries.filter((entry) => entry.item.kind === "map").length;
    const boughtMap = await service.execute(identity.characterId, initial.revision, { type: "buy_map", offerId: "free-ashen-t1" });
    const maps = boughtMap.profile.inventory.entries.filter((entry) => entry.item.kind === "map");
    assert.equal(maps.length, initialMapCount + 1);
    assert.match(maps.at(-1)!.item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const boughtFlask = await service.execute(identity.characterId, boughtMap.revision, { type: "buy_flask", offerId: "weak-health-supply" });
    const flask = boughtFlask.profile.inventory.entries.find((entry) => entry.item.kind === "flask")?.item;
    assert.ok(flask);
    assert.match(flask.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const mapEntry = boughtFlask.profile.inventory.entries.find((entry) => entry.item.kind === "map");
    assert.ok(mapEntry && mapEntry.item.kind === "map");
    const map = mapEntry.item;
    const slotted = await service.execute(identity.characterId, boughtFlask.revision, { type: "slot_map", itemId: map.id });
    const crafted = await service.execute(identity.characterId, slotted.revision, { type: "craft_map", action: "dust" });
    assert.equal(crafted.profile.mapDevice?.modifiers.length, 2);
  } finally {
    await repository.close();
  }
});
