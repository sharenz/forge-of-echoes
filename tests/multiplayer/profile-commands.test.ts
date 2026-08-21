import assert from "node:assert/strict";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { profileCommandSchema } from "../../multiplayer/protocol";
import { findFirstFit } from "../../app/game/item-container";
import { createMap } from "../../app/game/maps";
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
  assert.equal(profileCommandSchema.safeParse({ type: "set_skill_slot", slot: 5, skill: "nova" }).success, false);
  assert.equal(profileCommandSchema.safeParse({ type: "set_skill_slot", slot: 1, skill: "client-invented" }).success, false);
  assert.equal(profileCommandSchema.safeParse({ type: "craft_map", action: "dust" }).success, false);
  assert.equal(profileCommandSchema.safeParse({ type: "craft_equipment", action: "essence", itemId: "00000000-0000-4000-8000-000000000000" }).success, false);
  assert.equal(profileCommandSchema.safeParse({ type: "buy_merchant_offer", merchantId: "cartographer-rook", offerId: "free-ashen-t1", position: { x: 0, y: 5 } }).success, false);
  assert.equal(profileCommandSchema.safeParse({ type: "buy_merchant_offer", merchantId: "client-invented", offerId: "god-item" }).success, false);
  assert.equal(profileCommandSchema.safeParse({
    type: "apply_currency",
    currencyItemId: "00000000-0000-4000-8000-000000000000",
    targetItemId: "00000000-0000-4000-8000-000000000001",
    currencyId: "mapDust",
  }).success, false);
});

test("skill bar assignments and empty slots persist authoritatively", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const identity = await createTestPlayer(repository, { handle: "loadout-test", characterName: "Loadout", classId: "sorceress" });
    const initial = await repository.loadProfile(identity.characterId);
    assert.ok(initial);
    assert.deepEqual(initial.profile.character.skillLoadout, ["basic", "nova", "dash", "ward", "flameWave"]);
    const service = new ProfileCommandService(repository);

    const cleared = await service.execute(identity.characterId, initial.revision, { type: "set_skill_slot", slot: 2, skill: null });
    assert.deepEqual(cleared.profile.character.skillLoadout, ["basic", "nova", null, "ward", "flameWave"]);

    const assigned = await service.execute(identity.characterId, cleared.revision, { type: "set_skill_slot", slot: 2, skill: "nova" });
    assert.deepEqual(assigned.profile.character.skillLoadout, ["basic", "nova", "nova", "ward", "flameWave"]);
    assert.deepEqual((await repository.loadProfile(identity.characterId))?.profile.character.skillLoadout, assigned.profile.character.skillLoadout);

    await assert.rejects(
      () => service.execute(identity.characterId, assigned.revision, { type: "set_skill_slot", slot: 2, skill: "nova" }),
      (error) => error instanceof ProfileCommandError && error.code === "invalid_command",
    );
  } finally {
    await repository.close();
  }
});

test("online merchant and backpack crafting create only server-owned UUID items", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const identity = await createTestPlayer(repository, { handle: "online-crafter", characterName: "Smith", classId: "barbarian" });
    const initial = await repository.loadProfile(identity.characterId);
    assert.ok(initial);
    const service = new ProfileCommandService(repository);
    const initialMapCount = initial.profile.inventory.entries.filter((entry) => entry.item.kind === "map").length;
    const purchasePosition = findFirstFit(initial.profile.inventory, createMap(1, "ashen-crucible"));
    assert.ok(purchasePosition);
    const boughtMap = await service.execute(identity.characterId, initial.revision, { type: "buy_merchant_offer", merchantId: "cartographer-rook", offerId: "free-ashen-t1", position: purchasePosition });
    const maps = boughtMap.profile.inventory.entries.filter((entry) => entry.item.kind === "map");
    assert.equal(maps.length, initialMapCount + 1);
    assert.match(maps.at(-1)!.item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual({ x: maps.at(-1)!.x, y: maps.at(-1)!.y }, purchasePosition);

    const boughtFlask = await service.execute(identity.characterId, boughtMap.revision, { type: "buy_merchant_offer", merchantId: "cartographer-rook", offerId: "weak-health-supply" });
    const flask = boughtFlask.profile.inventory.entries.find((entry) => entry.item.kind === "flask")?.item;
    assert.ok(flask);
    assert.match(flask.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const mapEntry = boughtFlask.profile.inventory.entries.find((entry) => entry.item.kind === "map");
    assert.ok(mapEntry && mapEntry.item.kind === "map");
    const dustEntry = boughtFlask.profile.inventory.entries.find((entry) => entry.item.kind === "currency" && entry.item.baseId === "mapDust");
    assert.ok(dustEntry && dustEntry.item.kind === "currency");
    const dustBefore = dustEntry.item.stackSize;
    const crafted = await service.execute(identity.characterId, boughtFlask.revision, {
      type: "apply_currency", currencyItemId: dustEntry.item.id, targetItemId: mapEntry.item.id,
    });
    const craftedMap = crafted.profile.inventory.entries.find((entry) => entry.item.id === mapEntry.item.id)?.item;
    const dustAfter = crafted.profile.inventory.entries.find((entry) => entry.item.id === dustEntry.item.id)?.item;
    assert.ok(craftedMap?.kind === "map");
    assert.equal(craftedMap.modifiers.length, 2);
    assert.equal(dustAfter?.kind === "currency" ? dustAfter.stackSize : 0, dustBefore - 1);
    assert.equal(crafted.profile.mapDevice, null);
  } finally {
    await repository.close();
  }
});

test("debug merchant purchases require a server-side account entitlement shared by every character", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const first = await createTestPlayer(repository, { handle: "debug-account", characterName: "First", classId: "sorceress" });
    const second = await repository.createCharacter(first.accountId, { characterName: "Second", classId: "sorceress" });
    const service = new ProfileCommandService(repository);
    const initial = await repository.loadProfile(first.characterId);
    assert.ok(initial);
    await assert.rejects(
      () => service.execute(first.characterId, initial.revision, { type: "buy_merchant_offer", merchantId: "debug-artificer", offerId: "impossible-haste-ring" }),
      (error) => error instanceof ProfileCommandError && error.code === "invalid_command",
    );

    repository.grantMerchantEntitlement(first.accountId, "debug-artificer");
    for (const characterId of [first.characterId, second.characterId]) {
      const before = await repository.loadProfile(characterId);
      assert.ok(before);
      const bought = await service.execute(characterId, before.revision, {
        type: "buy_merchant_offer", merchantId: "debug-artificer", offerId: "impossible-haste-ring",
      });
      const ring = bought.profile.inventory.entries.find((entry) => entry.item.kind === "equipment" && entry.item.displayName === "Impossible Haste Ring")?.item;
      assert.ok(ring?.kind === "equipment");
      assert.equal(ring.affixes[0].rolls[0].value, 10_000);
    }
  } finally {
    await repository.close();
  }
});
