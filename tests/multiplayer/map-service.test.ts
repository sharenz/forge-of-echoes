import assert from "node:assert/strict";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { verifyMapTicket } from "../../server/auth/map-ticket";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import { MapAdmissionService } from "../../server/services/MapAdmissionService";
import { MapOpenError, MapService } from "../../server/services/MapService";
import { PartyService } from "../../server/services/PartyService";
import { ProfileCommandService } from "../../server/services/ProfileCommandService";

test("opening a map consumes the item and replacing it invalidates the old expedition", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const players = await Promise.all(Array.from({ length: 4 }, (_, index) => createTestPlayer(repository, {
      handle: `map-service-${index}`,
      characterName: `Mapper ${index}`,
      classId: index === 0 ? "sorceress" : "amazon",
    })));
    const parties = new PartyService();
    const party = parties.create(players[0].characterId);
    players.slice(1).forEach((player) => parties.join(player.characterId, party.id));
    const initial = await repository.loadProfile(players[0].characterId);
    assert.ok(initial);
    const map = initial.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const commands = new ProfileCommandService(repository);
    const slotted = await commands.execute(players[0].characterId, initial.revision, {
      type: "slot_map", itemId: map.id,
    });
    const secret = "map-service-test-secret";
    const service = new MapService(repository, parties, secret);
    const opened = await service.open(players[0].characterId, slotted.revision);
    assert.equal(opened.map.id, map.id);
    assert.equal(opened.authoritativeProfile.profile.mapDevice, null);
    assert.deepEqual(new Set(opened.ticketClaims.allowedCharacterIds), new Set(players.map((player) => player.characterId)));
    assert.deepEqual(verifyMapTicket(opened.mapTicket, secret), opened.ticketClaims);
    const activeMap = parties.getForMember(players[3].characterId)?.activeMap;
    assert.equal(activeMap?.ticketId, opened.ticketClaims.ticketId);
    assert.equal(activeMap?.mapTicket, opened.mapTicket);
    assert.equal(activeMap?.map.id, map.id);
    assert.equal(activeMap?.roomId, null);
    assert.deepEqual(activeMap?.portals, Array.from({ length: 6 }, (_, index) => ({ index, used: false })));
    parties.attachMapRoom(players[0].characterId, opened.ticketClaims.ticketId, "authoritative-room-id");
    assert.equal(parties.getForMember(players[2].characterId)?.activeMap?.roomId, "authoritative-room-id");

    const admissions = new MapAdmissionService();
    assert.equal(admissions.claim(opened.ticketClaims.ticketId, opened.ticketClaims.expiresAt), true);
    assert.equal(admissions.claim(opened.ticketClaims.ticketId, opened.ticketClaims.expiresAt), false, "one consumed map cannot create two instances");

    const replacementMap = opened.authoritativeProfile.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const replacementSlotted = await commands.execute(players[0].characterId, opened.authoritativeProfile.revision, {
      type: "slot_map", itemId: replacementMap.id,
    });
    const replacement = await service.open(players[0].characterId, replacementSlotted.revision);
    assert.notEqual(replacement.ticketClaims.ticketId, opened.ticketClaims.ticketId);
    assert.equal(replacement.map.id, replacementMap.id);
    assert.equal(replacement.authoritativeProfile.profile.mapDevice, null, "opening immediately empties the map-device slot");
    assert.deepEqual(
      parties.getForMember(players[3].characterId)?.activeMap?.portals,
      Array.from({ length: 6 }, (_, index) => ({ index, used: false })),
      "the replacement expedition publishes six fresh portals",
    );
    assert.equal(
      parties.consumeMapPortal(players[0].characterId, opened.ticketClaims.ticketId, 0),
      false,
      "portals belonging to the replaced expedition are invalid immediately",
    );
    parties.clearMap(players[0].characterId, opened.ticketClaims.ticketId);
    assert.equal(
      parties.getForMember(players[0].characterId)?.activeMap?.ticketId,
      replacement.ticketClaims.ticketId,
      "disposing the old map room cannot clear the replacement expedition",
    );

    const memberProfile = await repository.loadProfile(players[1].characterId);
    assert.ok(memberProfile);
    await assert.rejects(
      () => service.open(players[1].characterId, memberProfile.revision),
      (error) => error instanceof MapOpenError && error.code === "not_leader",
    );
  } finally {
    await repository.close();
  }
});
test("expired map admissions are rejected and pruned", () => {
  let now = 1_000;
  const admissions = new MapAdmissionService(() => now);
  assert.equal(admissions.claim("first", 1_100), true);
  assert.equal(admissions.size, 1);
  now = 1_100;
  assert.equal(admissions.size, 0);
  assert.equal(admissions.claim("already-expired", 1_099), false);
  assert.equal(admissions.claim("first", 1_200), true, "an expired ticket id no longer occupies admission memory");
});

test("opening a map without a public party creates a private authoritative solo expedition", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  try {
    const player = await createTestPlayer(repository, {
      handle: "solo-map-service",
      characterName: "Solo Mapper",
      classId: "sorceress",
    });
    const parties = new PartyService();
    const initial = await repository.loadProfile(player.characterId);
    assert.ok(initial);
    const map = initial.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const slotted = await new ProfileCommandService(repository).execute(player.characterId, initial.revision, {
      type: "slot_map", itemId: map.id,
    });

    const opened = await new MapService(repository, parties, "solo-map-secret").open(player.characterId, slotted.revision);
    const expedition = parties.getForMember(player.characterId);

    assert.equal(expedition?.visibility, "solo");
    assert.deepEqual(expedition?.memberCharacterIds, [player.characterId]);
    assert.deepEqual(opened.ticketClaims.allowedCharacterIds, [player.characterId]);
    assert.equal(expedition?.activeMap?.ticketId, opened.ticketClaims.ticketId);
    assert.deepEqual(parties.listPublic(), []);
  } finally {
    await repository.close();
  }
});
