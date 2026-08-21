import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "@colyseus/sdk";
import { MULTIPLAYER_LIMITS, CLIENT_MESSAGES } from "../../multiplayer/protocol";
import { signSessionToken } from "../../server/auth/session-token";
import { createGameServer } from "../../server/createGameServer";
import { HideoutRoom } from "../../server/rooms/HideoutRoom";
import { configureServerServices } from "../../server/services";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import type { HideoutState } from "../../server/state/HideoutState";
import { InMemoryCoordination } from "../../server/coordination/InMemoryCoordination";

const secret = "four-player-hideout-test-secret";

function session(index: number, overrides: Partial<{ characterId: string }> = {}) {
  const classes = ["amazon", "barbarian", "sorceress"] as const;
  const characterId = overrides.characterId ?? randomUUID();
  const token = signSessionToken({
    sessionId: randomUUID(),
    accountId: randomUUID(),
    characterId,
    characterName: `Player ${index + 1}`,
    classId: classes[index % classes.length],
    expiresAt: Date.now() + 60_000,
  }, secret);
  return { characterId, token };
}

function token(index: number, overrides: Partial<{ characterId: string }> = {}): string {
  return session(index, overrides).token;
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
    const sessions = Array.from({ length: MULTIPLAYER_LIMITS.playersPerRoom }, (_, index) => session(index));
    const party = await parties.create(sessions[0].characterId);
    for (const { characterId } of sessions.slice(1)) await parties.join(characterId, party.id);
    await assert.rejects(
      () => server!.createRoom<HideoutRoom>("hideout", { token: session(99).token, partyId: party.id }),
      /Only a party member/,
    );
    const authoritativeRoom = await server.createRoom<HideoutRoom>("hideout", { token: sessions[1].token, partyId: party.id });
    for (let index = 0; index < MULTIPLAYER_LIMITS.playersPerRoom; index += 1) {
      const client = await server.connectTo(authoritativeRoom, { token: sessions[index].token, partyId: party.id });
      client.onMessage("*", () => undefined);
      clients.push(client);
    }
    await waitFor(() => authoritativeRoom.state.players.size === 4 && clients.every((client) => client.state.players.size === 4));
    assert.equal(authoritativeRoom.clients.length, 4);
    assert.equal(new Set([...authoritativeRoom.state.players.keys()]).size, 4);
    await assert.rejects(() => server!.connectTo(authoritativeRoom, { token: token(4), partyId: party.id }));

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
    const playerSession = session(0);
    const party = await parties.create(playerSession.characterId);
    const room = await server.createRoom<HideoutRoom>("hideout", { token: playerSession.token, partyId: party.id });
    const original = await server.connectTo(room, { token: playerSession.token, partyId: party.id });
    original.onMessage("*", () => undefined);
    await waitFor(() => room.state.players.size === 1);

    const replacement = await server.connectTo(room, { token: playerSession.token, partyId: party.id });
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
