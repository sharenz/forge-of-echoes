import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room } from "@colyseus/sdk";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { CLIENT_MESSAGES } from "../../multiplayer/protocol";
import { createGameServer } from "../../server/createGameServer";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import type { AuthoritativeProfile, PlayerIdentity } from "../../server/persistence/PlayerRepository";
import { configureServerServices } from "../../server/services";
import { MapAdmissionService } from "../../server/services/MapAdmissionService";
import type { OpenedAuthoritativeMap } from "../../server/services/MapService";
import { PartyService, type PartySnapshot } from "../../server/services/PartyService";
import type { MapRoomState } from "../../server/state/MapState";

const httpEndpoint = "http://127.0.0.1:2568";
const websocketEndpoint = "ws://127.0.0.1:2568";

interface SessionResponse {
  token: string;
  player: PlayerIdentity;
}

function authenticated(token: string, method = "GET", body?: unknown): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  };
}

async function json<T>(path: string, init?: RequestInit, expectedStatus = 200): Promise<T> {
  const response = await fetch(`${httpEndpoint}${path}`, init);
  assert.equal(response.status, expectedStatus, `${init?.method ?? "GET"} ${path}`);
  return response.json() as Promise<T>;
}

async function createSession(index: number): Promise<SessionResponse> {
  const account = await json<{ token: string }>("/api/accounts/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: `e2e-${index}` }),
  });
  const created = await json<{ session: SessionResponse }>(
    "/api/accounts/characters",
    authenticated(account.token, "POST", { characterName: `E2EHero${index + 1}`, classId: "sorceress" }),
    201,
  );
  return created.session;
}

async function waitFor(predicate: () => boolean, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for four-player end-to-end state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("four clients complete the authenticated party-to-map admission path", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  configureServerServices({
    authSecret: "four-player-e2e-secret",
    players: repository,
    parties: new PartyService(),
    mapAdmissions: new MapAdmissionService(),
  });
  let server: ColyseusTestServer | null = null;
  const rooms: Room<unknown, MapRoomState>[] = [];
  try {
    server = await boot(createGameServer());
    const sessions = await Promise.all(Array.from({ length: 4 }, (_, index) => createSession(index)));

    const party = await json<PartySnapshot>("/api/parties", authenticated(sessions[0].token, "POST", {}), 201);
    await Promise.all(sessions.slice(1).map((session) => json<PartySnapshot>(
      "/api/parties/join",
      authenticated(session.token, "POST", { partyId: party.id }),
    )));

    const leaderProfile = await json<AuthoritativeProfile>("/api/profile", authenticated(sessions[0].token));
    const map = leaderProfile.profile.inventory.entries.find((entry) => entry.item.kind === "map")?.item;
    assert.ok(map);
    const slotted = await json<AuthoritativeProfile>(
      "/api/profile/commands",
      authenticated(sessions[0].token, "POST", { revision: leaderProfile.revision, command: { type: "slot_map", itemId: map.id } }),
    );
    const opened = await json<OpenedAuthoritativeMap>(
      "/api/maps/open",
      authenticated(sessions[0].token, "POST", { revision: slotted.revision }),
      201,
    );

    const clients = sessions.map(() => new Client(websocketEndpoint));
    const leaderRoom = await clients[0].create<MapRoomState>("map", { token: sessions[0].token, mapTicket: opened.mapTicket, portalIndex: 0 });
    rooms.push(leaderRoom);
    for (let index = 1; index < sessions.length; index += 1) {
      rooms.push(await clients[index].joinById<MapRoomState>(leaderRoom.roomId, {
        token: sessions[index].token,
        mapTicket: opened.mapTicket,
        portalIndex: index,
      }));
    }
    await waitFor(() => rooms.every((room) => room.state.players.size === 4));

    const activeParty = await json<PartySnapshot>("/api/parties/current", authenticated(sessions[3].token));
    assert.equal(activeParty.activeMap?.roomId, leaderRoom.roomId);
    assert.equal(activeParty.activeMap?.map.id, map.id);
    assert.deepEqual(activeParty.activeMap?.portals.map((portal) => portal.used), [true, true, true, true, false, false]);
    assert.equal(new Set(leaderRoom.state.players.keys()).size, 4);

    const starts = sessions.map((session) => leaderRoom.state.players.get(session.player.characterId)!.x);
    rooms.forEach((room, index) => room.send(CLIENT_MESSAGES.movement, { sequence: 1, x: index % 2 === 0 ? 1 : -1, y: 0 }));
    await waitFor(() => sessions.every((session, index) => {
      const x = leaderRoom.state.players.get(session.player.characterId)!.x;
      return index % 2 === 0 ? x > starts[index] : x < starts[index];
    }));
  } finally {
    await Promise.all(rooms.map((room) => room.leave(true).catch(() => undefined)));
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});
