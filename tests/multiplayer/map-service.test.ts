import assert from "node:assert/strict";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { verifyMapTicket } from "../../server/auth/map-ticket";
import { InMemoryCoordination } from "../../server/coordination/InMemoryCoordination";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import { MapOpenError, MapService } from "../../server/services/MapService";
import { ProfileCommandService } from "../../server/services/ProfileCommandService";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";

test("opening a map atomically consumes the item and replacing it invalidates old portals", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const coordination = new InMemoryCoordination(repository);
  try {
    const players = await Promise.all(Array.from({ length: 4 }, (_, index) => createTestPlayer(repository, {
      handle: `map-service-${index}`,
      characterName: `Mapper ${index}`,
      classId: index === 0 ? "sorceress" : "amazon",
    })));
    const party = await coordination.create(players[0].characterId);
    for (const player of players.slice(1)) await coordination.join(player.characterId, party.id);
    const initial = await repository.loadProfile(players[0].characterId);
    assert.ok(initial);
    const map = initial.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const commands = new ProfileCommandService(repository);
    const slotted = await commands.execute(players[0].characterId, initial.revision, { type: "slot_map", itemId: map.id });
    const secret = "map-service-test-secret";
    const service = new MapService(repository, coordination, coordination, secret);
    const opened = await service.open(players[0].characterId, slotted.revision);
    assert.equal(opened.map.id, map.id);
    assert.equal(opened.authoritativeProfile.profile.mapDevice, null);
    assert.deepEqual(new Set(opened.ticketClaims.allowedCharacterIds), new Set(players.map((player) => player.characterId)));
    assert.deepEqual(verifyMapTicket(opened.mapTicket, secret), opened.ticketClaims);
    assert.ok(
      opened.ticketClaims.expiresAt - Date.now() > MULTIPLAYER_LIMITS.expeditionLifetimeMilliseconds - 5_000,
      "a normal six-wave run cannot expire its own expedition",
    );
    const activeMap = (await coordination.getForMember(players[3].characterId))?.activeMap;
    assert.equal(activeMap?.ticketId, opened.ticketClaims.ticketId);
    assert.equal(activeMap?.map.id, map.id);
    assert.deepEqual(activeMap?.portals, Array.from({ length: 6 }, (_, index) => ({ index, used: false })));
    assert.equal(await coordination.claimRoom(opened.ticketClaims.ticketId, "authoritative-room-id"), true);
    assert.equal(await coordination.claimRoom(opened.ticketClaims.ticketId, "duplicate-room-id"), false);
    assert.equal((await coordination.getForMember(players[2].characterId))?.activeMap?.roomId, "authoritative-room-id");
    assert.equal(await coordination.consumePortal(players[0].characterId, opened.ticketClaims.ticketId, 0), true);
    assert.equal(await coordination.consumePortal(players[0].characterId, opened.ticketClaims.ticketId, 0), true, "the portal owner may reconnect");
    assert.equal(await coordination.consumePortal(players[1].characterId, opened.ticketClaims.ticketId, 0), false, "another character cannot reuse it");

    const replacementMap = opened.authoritativeProfile.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const replacementSlotted = await commands.execute(players[0].characterId, opened.authoritativeProfile.revision, {
      type: "slot_map", itemId: replacementMap.id,
    });
    const replacement = await service.open(players[0].characterId, replacementSlotted.revision);
    assert.notEqual(replacement.ticketClaims.ticketId, opened.ticketClaims.ticketId);
    assert.equal(replacement.authoritativeProfile.profile.mapDevice, null);
    assert.equal(await coordination.consumePortal(players[0].characterId, opened.ticketClaims.ticketId, 0), false);
    await coordination.clear(players[0].characterId, opened.ticketClaims.ticketId, "authoritative-room-id");
    assert.equal(
      (await coordination.getForMember(players[0].characterId))?.activeMap?.ticketId,
      replacement.ticketClaims.ticketId,
      "disposing the old room cannot clear the replacement expedition",
    );

    const memberProfile = await repository.loadProfile(players[1].characterId);
    assert.ok(memberProfile);
    await assert.rejects(
      () => service.open(players[1].characterId, memberProfile.revision),
      (error) => error instanceof MapOpenError && error.code === "not_leader",
    );
  } finally {
    await coordination.close();
    await repository.close();
  }
});

test("opening a map without a public party creates a private authoritative solo expedition", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const coordination = new InMemoryCoordination(repository);
  try {
    const player = await createTestPlayer(repository, { handle: "solo-map-service", characterName: "Solo Mapper", classId: "sorceress" });
    const initial = await repository.loadProfile(player.characterId);
    assert.ok(initial);
    const map = initial.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const slotted = await new ProfileCommandService(repository).execute(player.characterId, initial.revision, {
      type: "slot_map", itemId: map.id,
    });
    const opened = await new MapService(repository, coordination, coordination, "solo-map-secret").open(player.characterId, slotted.revision);
    const expedition = await coordination.getForMember(player.characterId);
    assert.equal(expedition?.visibility, "solo");
    assert.deepEqual(expedition?.memberCharacterIds, [player.characterId]);
    assert.deepEqual(opened.ticketClaims.allowedCharacterIds, [player.characterId]);
    assert.equal(expedition?.activeMap?.ticketId, opened.ticketClaims.ticketId);
    assert.deepEqual(await coordination.listPublic(), []);
  } finally {
    await coordination.close();
    await repository.close();
  }
});
