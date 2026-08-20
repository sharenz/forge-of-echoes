import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";
import { createMap } from "../../app/game/maps";
import { PartyError, PartyService } from "../../server/services/PartyService";

test("party admission caps membership at four and transfers leadership on leave", () => {
  const service = new PartyService();
  const members = Array.from({ length: 5 }, () => randomUUID());
  const created = service.create(members[0]);
  for (const member of members.slice(1, 4)) service.join(member, created.id);
  const full = service.get(created.id)!;
  assert.equal(full.memberCharacterIds.length, 4);
  assert.equal(new Set(full.memberCharacterIds).size, 4);
  assert.throws(
    () => service.join(members[4], created.id),
    (error) => error instanceof PartyError && error.code === "party_full",
  );
  assert.equal(service.getForMember(members[4]), null);
  const afterLeaderLeaves = service.leave(members[0])!;
  assert.equal(afterLeaderLeaves.leaderCharacterId, members[1]);
  assert.equal(afterLeaderLeaves.memberCharacterIds.length, 3);
});

test("party snapshots cannot mutate authoritative membership", () => {
  const service = new PartyService();
  const leader = randomUUID();
  const snapshot = service.create(leader);
  snapshot.memberCharacterIds.push(randomUUID());
  assert.deepEqual(service.getForMember(leader)?.memberCharacterIds, [leader]);
  const listings = service.listPublic();
  listings[0].memberCharacterIds.push(randomUUID());
  assert.deepEqual(service.getForMember(leader)?.memberCharacterIds, [leader]);
});

test("solo expeditions stay private and can be promoted to public parties", () => {
  const service = new PartyService();
  const leader = randomUUID();
  const solo = service.createSolo(leader);

  assert.equal(solo.visibility, "solo");
  assert.deepEqual(service.listPublic(), []);
  assert.throws(
    () => service.join(randomUUID(), solo.id),
    (error) => error instanceof PartyError && error.code === "not_found",
  );

  const publicParty = service.create(leader);
  assert.equal(publicParty.id, solo.id);
  assert.equal(publicParty.visibility, "public");
  assert.equal(service.listPublic().length, 1);
});

test("joining a public party replaces an idle solo expedition", () => {
  const service = new PartyService();
  const leader = randomUUID();
  const joiningCharacter = randomUUID();
  const publicParty = service.create(leader);
  const solo = service.createSolo(joiningCharacter);

  const joined = service.join(joiningCharacter, publicParty.id);
  assert.equal(service.get(solo.id), null);
  assert.ok(joined.memberCharacterIds.includes(joiningCharacter));
});

test("a rejected public-party join preserves the player's private hideout", () => {
  const service = new PartyService();
  const leader = randomUUID();
  const publicParty = service.create(leader);
  for (let index = 1; index < MULTIPLAYER_LIMITS.playersPerRoom; index += 1) {
    service.join(randomUUID(), publicParty.id);
  }
  const joiningCharacter = randomUUID();
  const solo = service.createSolo(joiningCharacter);

  assert.throws(() => service.join(joiningCharacter, publicParty.id), (error: unknown) => (
    error instanceof PartyError && error.code === "party_full"
  ));
  assert.equal(service.getForMember(joiningCharacter)?.id, solo.id);
});

test("disconnected members expire without leaving ghost seats or ghost parties", async () => {
  const service = new PartyService(25);
  const leader = randomUUID();
  const member = randomUUID();
  const party = service.create(leader);
  service.join(member, party.id);
  service.memberConnected(party.id, leader);
  service.memberConnected(party.id, member);

  service.memberDisconnected(party.id, member);
  await delay(60);
  assert.equal(service.getForMember(member), null);
  assert.deepEqual(service.get(party.id)?.memberCharacterIds, [leader]);

  service.memberDisconnected(party.id, leader);
  await delay(60);
  assert.equal(service.get(party.id), null);
  assert.deepEqual(service.listPublic(), []);
});

test("presence counts survive room transitions and reconnects within the grace period", async () => {
  const service = new PartyService(40);
  const leader = randomUUID();
  const party = service.create(leader);
  service.memberConnected(party.id, leader);
  service.memberConnected(party.id, leader);
  service.memberDisconnected(party.id, leader);
  await delay(60);
  assert.ok(service.get(party.id), "one remaining room connection keeps membership alive");

  service.memberDisconnected(party.id, leader);
  await delay(15);
  service.memberConnected(party.id, leader);
  await delay(60);
  assert.ok(service.get(party.id), "reconnecting during the grace period cancels eviction");
  service.leave(leader);
});

test("a late disconnect from an old party cannot evict a character from their new party", async () => {
  const service = new PartyService(25);
  const characterId = randomUUID();
  const oldParty = service.create(characterId);
  service.memberConnected(oldParty.id, characterId);
  service.leave(characterId);
  const newParty = service.create(characterId);
  service.memberConnected(newParty.id, characterId);

  service.memberDisconnected(oldParty.id, characterId);
  await delay(60);
  assert.equal(service.getForMember(characterId)?.id, newParty.id);
  service.leave(characterId);
});

test("active maps still clear after their original leader leaves the party", () => {
  const service = new PartyService();
  const leader = randomUUID();
  const successor = randomUUID();
  const party = service.create(leader);
  service.join(successor, party.id);
  const ticketId = randomUUID();
  service.activateMap(leader, { ticketId, mapTicket: "signed-map-ticket", map: createMap(1), expiresAt: Date.now() + 60_000 });
  service.leave(leader);

  service.attachMapRoom(leader, ticketId, "room-after-leader-left");
  assert.equal(service.getForMember(successor)?.activeMap?.roomId, "room-after-leader-left");
  service.clearMap(leader, ticketId);
  assert.equal(service.getForMember(successor)?.activeMap, null);
  service.leave(successor);
});

test("each map portal can be consumed exactly once", () => {
  const service = new PartyService();
  const leader = randomUUID();
  const member = randomUUID();
  const party = service.create(leader);
  service.join(member, party.id);
  const ticketId = randomUUID();
  service.activateMap(leader, { ticketId, mapTicket: "signed-map-ticket", map: createMap(1), expiresAt: Date.now() + 60_000 });

  assert.equal(service.consumeMapPortal(leader, ticketId, 0), true);
  assert.equal(service.consumeMapPortal(member, ticketId, 0), false, "a consumed portal cannot be reused by another member");
  for (let index = 1; index < 6; index += 1) assert.equal(service.consumeMapPortal(member, ticketId, index), true);
  assert.equal(service.getForMember(leader)?.activeMap?.portals.every((portal) => portal.used), true);
  assert.equal(service.consumeMapPortal(leader, ticketId, 5), false);
});

test("an open expedition keeps its solo party alive until the map is cleared", async () => {
  const service = new PartyService(20);
  const leader = randomUUID();
  const ticketId = randomUUID();
  service.createSolo(leader);
  service.activateMap(leader, {
    ticketId,
    mapTicket: "signed-map-ticket",
    map: createMap(1),
    expiresAt: Date.now() + 1_000,
  });

  await delay(60);
  assert.equal(service.getForMember(leader)?.activeMap?.ticketId, ticketId);

  service.clearMap(leader, ticketId);
  await delay(60);
  assert.equal(service.getForMember(leader), null);
});
