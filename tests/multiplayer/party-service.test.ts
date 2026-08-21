import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";
import { InMemoryCoordination } from "../../server/coordination/InMemoryCoordination";
import { PartyError } from "../../server/coordination/PartyCoordinator";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";

function coordinator(options: { now?: () => number; grace?: number } = {}) {
  const players = new InMemoryPlayerRepository();
  return new InMemoryCoordination(players, options.grace, options.now);
}

test("party admission caps membership at four and transfers leadership on leave", async () => {
  const service = coordinator();
  const members = Array.from({ length: 5 }, () => randomUUID());
  const created = await service.create(members[0]);
  for (const member of members.slice(1, 4)) await service.join(member, created.id);
  const full = await service.get(created.id);
  assert.equal(full?.memberCharacterIds.length, 4);
  assert.equal(new Set(full?.memberCharacterIds).size, 4);
  await assert.rejects(
    () => service.join(members[4], created.id),
    (error) => error instanceof PartyError && error.code === "party_full",
  );
  assert.equal(await service.getForMember(members[4]), null);
  const afterLeaderLeaves = await service.leave(members[0]);
  assert.equal(afterLeaderLeaves?.leaderCharacterId, members[1]);
  assert.equal(afterLeaderLeaves?.memberCharacterIds.length, 3);
});

test("party snapshots cannot mutate authoritative membership", async () => {
  const service = coordinator();
  const leader = randomUUID();
  const snapshot = await service.create(leader);
  snapshot.memberCharacterIds.push(randomUUID());
  assert.deepEqual((await service.getForMember(leader))?.memberCharacterIds, [leader]);
  const listings = await service.listPublic();
  listings[0].memberCharacterIds.push(randomUUID());
  assert.deepEqual((await service.getForMember(leader))?.memberCharacterIds, [leader]);
});

test("solo parties stay private, can be promoted, and are replaced on public join", async () => {
  const service = coordinator();
  const leader = randomUUID();
  const joiningCharacter = randomUUID();
  const solo = await service.createSolo(leader);
  assert.equal(solo.visibility, "solo");
  assert.deepEqual(await service.listPublic(), []);
  await assert.rejects(() => service.join(randomUUID(), solo.id), (error) => error instanceof PartyError && error.code === "not_found");
  const promoted = await service.create(leader);
  assert.equal(promoted.id, solo.id);
  assert.equal(promoted.visibility, "public");
  const idleSolo = await service.createSolo(joiningCharacter);
  const joined = await service.join(joiningCharacter, promoted.id);
  assert.equal(await service.get(idleSolo.id), null);
  assert.ok(joined.memberCharacterIds.includes(joiningCharacter));
});

test("a rejected full-party join preserves the player's private party", async () => {
  const service = coordinator();
  const party = await service.create(randomUUID());
  for (let index = 1; index < MULTIPLAYER_LIMITS.playersPerRoom; index += 1) await service.join(randomUUID(), party.id);
  const joiningCharacter = randomUUID();
  const solo = await service.createSolo(joiningCharacter);
  await assert.rejects(() => service.join(joiningCharacter, party.id), (error) => error instanceof PartyError && error.code === "party_full");
  assert.equal((await service.getForMember(joiningCharacter))?.id, solo.id);
});

test("connection leases survive overlap and expired leases remove ghost memberships", async () => {
  let now = 1_000;
  const service = coordinator({ now: () => now, grace: 40 });
  const leader = randomUUID();
  const member = randomUUID();
  const party = await service.create(leader);
  await service.join(member, party.id);
  await service.connect(party.id, leader, "leader-hideout");
  await service.connect(party.id, leader, "leader-map");
  await service.connect(party.id, member, "member-hideout");
  await service.disconnect(party.id, leader, "leader-hideout");
  now += 41;
  await service.renewConnection(party.id, leader, "leader-map");
  assert.ok(await service.get(party.id), "the overlapping map connection retains membership");
  assert.equal(await service.getForMember(member), null, "an expired member lease is reaped by any coordinator call");
  await service.disconnect(party.id, leader, "leader-map");
  now += 41;
  assert.equal(await service.get(party.id), null);
});

test("a late disconnect for an old connection cannot evict a renewed membership", async () => {
  let now = 10_000;
  const service = coordinator({ now: () => now, grace: 25 });
  const characterId = randomUUID();
  const party = await service.create(characterId);
  await service.connect(party.id, characterId, "old");
  await service.connect(party.id, characterId, "new");
  await service.disconnect(party.id, characterId, "old");
  now += 26;
  await service.renewConnection(party.id, characterId, "new");
  assert.equal((await service.getForMember(characterId))?.id, party.id);
});
