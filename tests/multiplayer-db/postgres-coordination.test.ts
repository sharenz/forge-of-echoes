import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Pool } from "pg";
import { createTestPlayer } from "../createTestPlayer";
import { signMapTicket } from "../../server/auth/map-ticket";
import { ExpeditionError } from "../../server/coordination/ExpeditionCoordinator";
import { PartyError } from "../../server/coordination/PartyCoordinator";
import { PostgresCoordination } from "../../server/coordination/PostgresCoordination";
import { PostgresPlayerRepository } from "../../server/persistence/PostgresPlayerRepository";
import { MapService } from "../../server/services/MapService";
import { ProfileCommandService } from "../../server/services/ProfileCommandService";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://crafty:crafty@127.0.0.1:5434/crafty";
const secret = "postgres-coordination-integration-secret";

test("PostgreSQL coordination survives adapter restart and enforces cross-process party invariants", async () => {
  const players = new PostgresPlayerRepository(databaseUrl);
  await players.initialize();
  const first = new PostgresCoordination(databaseUrl, players);
  const second = new PostgresCoordination(databaseUrl, players);
  const cleanup = new Pool({ connectionString: databaseUrl, max: 1 });
  const identities = await Promise.all(Array.from({ length: 8 }, (_, index) => createTestPlayer(players, {
    handle: `coord-${randomUUID().slice(0, 8)}-${index}`,
    characterName: `Coord${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    classId: "sorceress",
  })));
  try {
    const party = await first.create(identities[0].characterId);
    const joins = await Promise.allSettled(identities.slice(1, 5).map((identity, index) => (
      (index % 2 === 0 ? first : second).join(identity.characterId, party.id)
    )));
    assert.equal(joins.filter((result) => result.status === "fulfilled").length, 3);
    const rejected = joins.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(rejected?.reason instanceof PartyError && rejected.reason.code === "party_full");
    assert.equal((await second.get(party.id))?.memberCharacterIds.length, 4);

    const otherParty = await second.create(identities[5].characterId);
    const candidate = identities[6].characterId;
    const competingMemberships = await Promise.allSettled([
      first.join(candidate, party.id),
      second.join(candidate, otherParty.id),
    ]);
    assert.equal(competingMemberships.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await first.getForMember(candidate))?.id, otherParty.id, "the full party loses, and the unique membership is durable");

    const restarted = new PostgresCoordination(databaseUrl, players);
    try {
      const afterRestart = await restarted.get(party.id);
      assert.equal(afterRestart?.memberCharacterIds.length, 4);
      assert.equal(afterRestart?.leaderCharacterId, identities[0].characterId);
    } finally {
      await restarted.close();
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
    await cleanup.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [identities.map((identity) => identity.accountId)]);
    await cleanup.end();
    await players.close();
  }
});

test("map opening, portals, and room leases are transactional across coordinator instances", async () => {
  const players = new PostgresPlayerRepository(databaseUrl);
  await players.initialize();
  const first = new PostgresCoordination(databaseUrl, players, 15_000, 35);
  const second = new PostgresCoordination(databaseUrl, players, 15_000, 35);
  const cleanup = new Pool({ connectionString: databaseUrl, max: 1 });
  const identities = await Promise.all(Array.from({ length: 2 }, (_, index) => createTestPlayer(players, {
    handle: `expedition-${randomUUID().slice(0, 8)}-${index}`,
    characterName: `Exp${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    classId: "sorceress",
  })));
  try {
    const party = await first.create(identities[0].characterId);
    await second.join(identities[1].characterId, party.id);
    const initial = await players.loadProfile(identities[0].characterId);
    assert.ok(initial);
    const map = initial.profile.inventory.entries.find((entry) => entry.item.kind === "map")?.item;
    assert.ok(map?.kind === "map");
    const slotted = await new ProfileCommandService(players).execute(identities[0].characterId, initial.revision, {
      type: "slot_map",
      itemId: map.id,
    });
    const currentParty = await first.get(party.id);
    assert.ok(currentParty);
    const failedClaims = {
      ticketId: randomUUID(),
      mapItemId: map.id,
      ownerCharacterId: identities[0].characterId,
      allowedCharacterIds: currentParty.memberCharacterIds,
      tier: map.tier,
      seed: 123,
      expiresAt: Date.now() + 60_000,
    };
    await assert.rejects(
      () => first.open({
        leaderCharacterId: identities[0].characterId,
        partyId: party.id,
        partyRevision: currentParty.revision - 1,
        expectedProfileRevision: slotted.revision,
        map,
        mapTicket: signMapTicket(failedClaims, secret),
        ticketClaims: failedClaims,
      }),
      (error) => error instanceof ExpeditionError && error.code === "party_revision_conflict",
    );
    const afterRollback = await players.loadProfile(identities[0].characterId);
    assert.equal(afterRollback?.revision, slotted.revision);
    assert.equal(afterRollback?.profile.mapDevice?.id, map.id, "a failed transaction does not consume the map");

    const opened = await new MapService(players, first, first, secret).open(identities[0].characterId, slotted.revision);
    assert.equal(opened.authoritativeProfile.profile.mapDevice, null);
    const portalResults = await Promise.all([
      first.consumePortal(identities[0].characterId, opened.ticketClaims.ticketId, 0),
      second.consumePortal(identities[1].characterId, opened.ticketClaims.ticketId, 0),
    ]);
    const portalOwner = portalResults[0] ? identities[0].characterId : identities[1].characterId;
    const otherCharacter = portalResults[0] ? identities[1].characterId : identities[0].characterId;
    assert.deepEqual([...portalResults].sort(), [false, true], "one conditional update owns the portal");
    assert.equal(await first.consumePortal(portalOwner, opened.ticketClaims.ticketId, 0), true, "the owning character can reconnect through a consumed portal");
    assert.equal(await second.consumePortal(otherCharacter, opened.ticketClaims.ticketId, 0), false, "consumed portals remain unavailable to other characters");

    const roomClaims = await Promise.all([
      first.claimRoom(opened.ticketClaims.ticketId, "worker-a/room-a"),
      second.claimRoom(opened.ticketClaims.ticketId, "worker-b/room-b"),
    ]);
    assert.equal(roomClaims.filter(Boolean).length, 1, "one room owns the fresh lease");
    const winningRoom = roomClaims[0] ? "worker-a/room-a" : "worker-b/room-b";
    const losingRoom = roomClaims[0] ? "worker-b/room-b" : "worker-a/room-a";
    assert.equal(await first.renewRoom(opened.ticketClaims.ticketId, losingRoom), false);
    assert.equal(await second.renewRoom(opened.ticketClaims.ticketId, winningRoom), true);

    await delay(55);
    assert.equal((await second.get(party.id))?.activeMap?.roomId, null, "expired room IDs are not advertised to reconnecting clients");
    assert.equal(await second.claimRoom(opened.ticketClaims.ticketId, "worker-c/recovered-room"), true, "an expired owner can be recovered after process death");
    await first.clear(identities[0].characterId, opened.ticketClaims.ticketId, winningRoom);
    assert.equal((await second.get(party.id))?.activeMap?.roomId, "worker-c/recovered-room", "a fenced stale room cannot clear its successor");
    assert.equal(await second.renewRoom(opened.ticketClaims.ticketId, "worker-c/recovered-room"), true);

    const restarted = new PostgresCoordination(databaseUrl, players, 15_000, 35);
    try {
      const durable = await restarted.get(party.id);
      assert.equal(durable?.activeMap?.roomId, "worker-c/recovered-room");
      assert.equal(durable?.activeMap?.portals[0].used, true);
    } finally {
      await restarted.close();
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
    await cleanup.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [identities.map((identity) => identity.accountId)]);
    await cleanup.end();
    await players.close();
  }
});

test("expired PostgreSQL presence leases reap abandoned parties after process death", async () => {
  const players = new PostgresPlayerRepository(databaseUrl);
  await players.initialize();
  const crashedProcess = new PostgresCoordination(databaseUrl, players, 25, 100);
  const cleanup = new Pool({ connectionString: databaseUrl, max: 1 });
  const identity = await createTestPlayer(players, {
    handle: `lease-${randomUUID().slice(0, 8)}`,
    characterName: `Lease${randomUUID().replaceAll("-", "").slice(0, 11)}`,
    classId: "sorceress",
  });
  try {
    const party = await crashedProcess.create(identity.characterId);
    await crashedProcess.connect(party.id, identity.characterId, "dead-worker/socket");
    await crashedProcess.close();
    await delay(45);
    const replacementProcess = new PostgresCoordination(databaseUrl, players, 25, 100);
    try {
      assert.equal(await replacementProcess.get(party.id), null);
      assert.equal(await replacementProcess.getForMember(identity.characterId), null);
    } finally {
      await replacementProcess.close();
    }
  } finally {
    await crashedProcess.close();
    await cleanup.query("DELETE FROM accounts WHERE id = $1", [identity.accountId]);
    await cleanup.end();
    await players.close();
  }
});
