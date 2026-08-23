import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "@colyseus/sdk";
import { MULTIPLAYER_LIMITS, CLIENT_MESSAGES, SERVER_MESSAGES, WIRE_PROTOCOL_VERSION, type LatencyProbeMessage, type PublicPartiesMessage } from "../../multiplayer/protocol";
import { signSessionToken } from "../../server/auth/session-token";
import { createGameServer } from "../../server/createGameServer";
import { HideoutRoom } from "../../server/rooms/HideoutRoom";
import { configureServerServices } from "../../server/services";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import type { HideoutState } from "../../server/state/HideoutState";
import { InMemoryCoordination } from "../../server/coordination/InMemoryCoordination";
import { InMemorySocialEventBus } from "../../server/social/SocialEventBus";

const secret = "four-player-hideout-test-secret";

function session(index: number, overrides: Partial<{ characterId: string; accountId: string; authSessionId: string }> = {}) {
  const classes = ["amazon", "barbarian", "sorceress"] as const;
  const characterId = overrides.characterId ?? randomUUID();
  const token = signSessionToken({
    sessionId: randomUUID(),
    authSessionId: overrides.authSessionId ?? randomUUID(),
    accountId: overrides.accountId ?? randomUUID(),
    characterId,
    characterName: `Player ${index + 1}`,
    classId: classes[index % classes.length],
    expiresAt: Date.now() + 60_000,
  }, secret);
  return { characterId, token };
}

async function waitFor(predicate: () => boolean, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for multiplayer state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("four authenticated clients share one authoritative hideout and a fifth seat is rejected", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const parties = new InMemoryCoordination(repository);
  configureServerServices({ authSecret: secret, players: repository, parties, expeditions: parties });
  let server: ColyseusTestServer | null = null;
  const clients: ClientRoom<HideoutRoom, HideoutState>[] = [];
  try {
    server = await boot(createGameServer());
    const authAccount = await repository.createOrLoadAccount("hideout-auth");
    const authSessionId = randomUUID();
    await repository.createAuthSession(authSessionId, authAccount.accountId, Date.now() + 60_000);
    const auth = { accountId: authAccount.accountId, authSessionId };
    const sessions = Array.from({ length: MULTIPLAYER_LIMITS.playersPerRoom }, (_, index) => session(index, auth));
    const party = await parties.create(sessions[0].characterId);
    for (const { characterId } of sessions.slice(1)) await parties.join(characterId, party.id);
    await assert.rejects(
      () => server!.createRoom<HideoutRoom>("hideout", { token: session(99, auth).token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION }),
      /Only a party member/,
    );
    const authoritativeRoom = await server.createRoom<HideoutRoom>("hideout", { token: sessions[1].token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
    for (let index = 0; index < MULTIPLAYER_LIMITS.playersPerRoom; index += 1) {
      const client = await server.connectTo(authoritativeRoom, { token: sessions[index].token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
      client.onMessage("*", () => undefined);
      clients.push(client);
    }
    await waitFor(() => authoritativeRoom.state.players.size === 4 && clients.every((client) => client.state.players.size === 4));
    assert.equal(authoritativeRoom.clients.length, 4);
    assert.equal(new Set([...authoritativeRoom.state.players.keys()]).size, 4);
    await assert.rejects(() => server!.connectTo(authoritativeRoom, { token: session(4, auth).token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION }));

    let latencyProbeResponse: LatencyProbeMessage | null = null;
    clients[0].onMessage(SERVER_MESSAGES.latencyProbeResponse, (message: LatencyProbeMessage) => { latencyProbeResponse = message; });
    clients[0].send(CLIENT_MESSAGES.latencyProbe, { sequence: 42 });
    await waitFor(() => latencyProbeResponse !== null);
    assert.deepEqual(latencyProbeResponse, { sequence: 42 });

    const movingCharacterId = sessions[0].characterId;
    const startingX = authoritativeRoom.state.players.get(movingCharacterId)!.x;
    clients[0].send(CLIENT_MESSAGES.movement, { sequence: 1, x: 1, y: 0 });
    await waitFor(() => authoritativeRoom.state.players.get(movingCharacterId)!.x > startingX);
    await waitFor(() => clients.slice(1).every((client) => client.state.players.get(movingCharacterId)!.x > startingX));
    assert.equal(authoritativeRoom.state.players.get(movingCharacterId)!.lastProcessedSequence, 1);

    const acceptedX = authoritativeRoom.state.players.get(movingCharacterId)!.x;
    clients[0].send(CLIENT_MESSAGES.movement, { sequence: 1, x: -1, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(authoritativeRoom.state.players.get(movingCharacterId)!.x >= acceptedX, "stale movement must not reverse authoritative motion");

    clients[0].send(CLIENT_MESSAGES.movement, { sequence: 2, x: 999, y: 0, claimedDamage: 999999 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(authoritativeRoom.state.players.get(movingCharacterId)!.lastProcessedSequence, 1, "invalid client payload must be rejected before simulation");
    clients[0].send(CLIENT_MESSAGES.movement, { sequence: 2, x: 0, y: 0 });
    await waitFor(() => authoritativeRoom.state.players.get(movingCharacterId)!.lastProcessedSequence === 2);

  } finally {
    await Promise.all(clients.map((client) => client.leave(true).catch(() => undefined)));
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});

test("a refreshed character replaces its stale hideout socket without duplicating party presence", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const parties = new InMemoryCoordination(repository);
  configureServerServices({ authSecret: secret, players: repository, parties, expeditions: parties });
  let server: ColyseusTestServer | null = null;
  try {
    server = await boot(createGameServer());
    const authAccount = await repository.createOrLoadAccount("hideout-refresh-auth");
    const authSessionId = randomUUID();
    await repository.createAuthSession(authSessionId, authAccount.accountId, Date.now() + 60_000);
    const playerSession = session(0, { accountId: authAccount.accountId, authSessionId });
    const party = await parties.create(playerSession.characterId);
    const room = await server.createRoom<HideoutRoom>("hideout", { token: playerSession.token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
    const original = await server.connectTo(room, { token: playerSession.token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
    original.onMessage("*", () => undefined);
    await waitFor(() => room.state.players.size === 1);
    await assert.rejects(() => server!.connectTo(room, {
      token: playerSession.token,
      partyId: party.id,
      protocolVersion: WIRE_PROTOCOL_VERSION + 1,
    }));

    const replacement = await server.connectTo(room, { token: playerSession.token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
    replacement.onMessage("*", () => undefined);
    await waitFor(() => room.clients.length === 1 && replacement.state.players.size === 1);
    assert.equal(room.state.players.size, 1);
    replacement.send(CLIENT_MESSAGES.movement, { sequence: 1, x: 1, y: 0 });
    await waitFor(() => room.state.players.get(playerSession.characterId)!.lastProcessedSequence === 1);
  } finally {
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});

test("hideout pushes public-party listings when the social invalidation bus changes", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const parties = new InMemoryCoordination(repository);
  const social = new InMemorySocialEventBus();
  await social.initialize();
  configureServerServices({ authSecret: secret, players: repository, parties, expeditions: parties, social });
  let server: ColyseusTestServer | null = null;
  let client: ClientRoom<HideoutRoom, HideoutState> | null = null;
  try {
    server = await boot(createGameServer());
    const authAccount = await repository.createOrLoadAccount("hideout-social-auth");
    const authSessionId = randomUUID();
    await repository.createAuthSession(authSessionId, authAccount.accountId, Date.now() + 60_000);
    const playerSession = session(0, { accountId: authAccount.accountId, authSessionId });
    const party = await parties.createSolo(playerSession.characterId);
    const room = await server.createRoom<HideoutRoom>("hideout", { token: playerSession.token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
    client = await server.connectTo(room, { token: playerSession.token, partyId: party.id, protocolVersion: WIRE_PROTOCOL_VERSION });
    let latest: PublicPartiesMessage | null = null;
    client.onMessage(SERVER_MESSAGES.publicParties, (message: PublicPartiesMessage) => { latest = message; });

    const account = await repository.createOrLoadAccount("listing-leader");
    const leader = await repository.createCharacter(account.accountId, { characterName: "ListingLeader", classId: "sorceress" });
    const publicParty = await parties.create(leader.characterId);
    await social.publish({ scope: "party", partyIds: [publicParty.id], publicPartiesChanged: true });

    await waitFor(() => latest?.parties.some((listing) => listing.id === publicParty.id) ?? false);
    assert.equal(latest!.parties[0].leader.characterName, "ListingLeader");
  } finally {
    await client?.leave(true).catch(() => undefined);
    await server?.cleanup();
    await server?.shutdown();
    await social.close();
    await repository.close();
  }
});
