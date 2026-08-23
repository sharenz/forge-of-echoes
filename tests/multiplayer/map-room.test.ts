import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "@colyseus/sdk";
import type { InventoryItem, PlayerProfile } from "../../app/game/domain";
import {
  CLIENT_MESSAGES,
  MULTIPLAYER_LIMITS,
  SERVER_MESSAGES,
  WIRE_PROTOCOL_VERSION,
  type MapExitReadyMessage,
  type PickupResultMessage,
  type RejectedCommandMessage,
} from "../../multiplayer/protocol";
import { decodeWorldEvents } from "../../multiplayer/wire/events";
import { signSessionToken } from "../../server/auth/session-token";
import { createGameServer } from "../../server/createGameServer";
import { ItemLockedError } from "../../server/persistence/errors";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import type { AuthoritativeProfile } from "../../server/persistence/PlayerRepository";
import { MapRoom } from "../../server/rooms/MapRoom";
import { configureServerServices } from "../../server/services";
import { MapRoomState } from "../../server/state/MapState";
import { InMemoryCoordination } from "../../server/coordination/InMemoryCoordination";
import { MapService } from "../../server/services/MapService";
import { ProfileCommandService } from "../../server/services/ProfileCommandService";
import { MonsterArchetype, type World } from "../../server/engine/World";
import { WorldEventType, type WorldEvent } from "../../server/engine/events";
import { entitySlot } from "../../server/engine/entity";
import { MonsterFlags } from "../../server/engine/stores/Monsters";
import { ACTIVE_SKILLS } from "../../app/game/config/skills";
import { resolveSkillDefinition } from "../../app/game/skills";
import { calculateCharacterStats } from "../../app/game/stats";

const secret = "four-player-map-test-secret";

class LockablePlayerRepository extends InMemoryPlayerRepository {
  private nextLockedSave: { characterId: string; itemId: string } | null = null;
  private pausedSave: { characterId: string; started: () => void; release: Promise<void> } | null = null;

  rejectNextSaveAsLocked(characterId: string, itemId: string): void {
    this.nextLockedSave = { characterId, itemId };
  }

  pauseNextSave(characterId: string): { started: Promise<void>; release: () => void } {
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.pausedSave = { characterId, started: signalStarted, release: gate };
    return { started, release };
  }

  override async saveProfile(characterId: string, expectedRevision: number, profile: PlayerProfile): Promise<AuthoritativeProfile> {
    await this.interceptWrite(characterId);
    return super.saveProfile(characterId, expectedRevision, profile);
  }

  override async mutateProfile(
    characterId: string,
    expectedRevision: number | null,
    transform: (profile: PlayerProfile) => PlayerProfile,
  ): Promise<AuthoritativeProfile> {
    await this.interceptWrite(characterId);
    return super.mutateProfile(characterId, expectedRevision, transform);
  }

  private async interceptWrite(characterId: string): Promise<void> {
    if (this.pausedSave?.characterId === characterId) {
      const paused = this.pausedSave;
      this.pausedSave = null;
      paused.started();
      await paused.release;
    }
    if (this.nextLockedSave?.characterId === characterId) {
      const { itemId } = this.nextLockedSave;
      this.nextLockedSave = null;
      throw new ItemLockedError(itemId);
    }
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMilliseconds = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for authoritative map state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function profileItemQuantity(profile: PlayerProfile, target: InventoryItem): number {
  const items = [
    ...profile.inventory.entries.map((entry) => entry.item),
    ...profile.stash.tabs.flatMap((tab) => tab.container.entries.map((entry) => entry.item)),
    ...Object.values(profile.equipped).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ...profile.flaskBelt.filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ...(profile.mapDevice ? [profile.mapDevice] : []),
  ];
  if (target.kind === "currency" || target.kind === "flask") {
    return items.reduce((total, item) => (
      item.kind === target.kind && item.baseId === target.baseId ? total + item.stackSize : total
    ), 0);
  }
  return Number(items.some((item) => item.id === target.id));
}

test("four players fight the same authoritative monsters and damage cannot be forged", async () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  const repository = new LockablePlayerRepository();
  await repository.initialize();
  const players = await Promise.all(Array.from({ length: MULTIPLAYER_LIMITS.playersPerRoom + 1 }, (_, index) => createTestPlayer(repository, {
    handle: `map-room-${index}`,
    characterName: `Map Player ${index + 1}`,
    classId: (["amazon", "barbarian", "sorceress"] as const)[index % 3],
  })));
  const identities = players.map((player) => ({
    sessionId: randomUUID(),
    authSessionId: randomUUID(),
    ...player,
    expiresAt: Date.now() + 60_000,
  }));
  await Promise.all(identities.map((identity) => repository.createAuthSession(
    identity.authSessionId,
    identity.accountId,
    identity.expiresAt,
  )));
  const parties = new InMemoryCoordination(repository);
  const party = await parties.create(identities[0].characterId);
  for (const identity of identities.slice(1, 4)) await parties.join(identity.characterId, party.id);
  configureServerServices({ authSecret: secret, players: repository, parties, expeditions: parties });
  const leaderProfile = await repository.loadProfile(identities[0].characterId);
  assert.ok(leaderProfile);
  const mapEntry = leaderProfile.profile.inventory.entries.find((entry) => entry.item.kind === "map");
  assert.ok(mapEntry && mapEntry.item.kind === "map");
  const map = mapEntry.item;
  const slotted = await new ProfileCommandService(repository).execute(identities[0].characterId, leaderProfile.revision, {
    type: "slot_map", itemId: map.id,
  });
  const opened = await new MapService(repository, parties, parties, secret).open(identities[0].characterId, slotted.revision);
  const mapTicket = opened.mapTicket;
  const tokens = identities.map((identity) => signSessionToken(identity, secret));
  let server: ColyseusTestServer | null = null;
  const clients: ClientRoom<MapRoom, MapRoomState>[] = [];
  let releasePausedSave: (() => void) | null = null;
  try {
    server = await boot(createGameServer(), 0);
    const authoritativeRoom = await server.createRoom<MapRoom>("map", { token: tokens[0], mapTicket, portalIndex: 0, protocolVersion: WIRE_PROTOCOL_VERSION });
    for (let index = 0; index < 4; index += 1) {
      const client = await server.connectTo(authoritativeRoom, { token: tokens[index], mapTicket, portalIndex: index, protocolVersion: WIRE_PROTOCOL_VERSION });
      client.onMessage("*", () => undefined);
      clients.push(client);
    }
    await waitFor(() => authoritativeRoom.state.players.size === 4 && clients.every((client) => client.state.players.size === 4));
    assert.equal(authoritativeRoom.clients.length, 4);
    let firstClientLeft = false;
    clients[0].onLeave(() => { firstClientLeft = true; });
    for (let sequence = 1; sequence <= 55; sequence += 1) {
      clients[0].send(CLIENT_MESSAGES.movement, { sequence, x: 0, y: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(firstClientLeft, false, "a valid movement-and-held-action-sized input burst stays connected");
    assert.equal(authoritativeRoom.clients.length, 4);
    assert.notEqual(
      await authoritativeRoom.onAuth(authoritativeRoom.clients[0], { token: tokens[0], mapTicket, portalIndex: 0, protocolVersion: WIRE_PROTOCOL_VERSION }),
      false,
      "a stale-socket replacement for an existing character does not consume another portal",
    );
    await assert.rejects(() => server!.connectTo(authoritativeRoom, { token: tokens[4], mapTicket, portalIndex: 4, protocolVersion: WIRE_PROTOCOL_VERSION }));
    const worldEvents: WorldEvent[] = [];
    clients[0].onMessage(SERVER_MESSAGES.worldEvents, (bytes: Uint8Array) => worldEvents.push(...decodeWorldEvents(bytes)));
    const dropPayloads = new Map<string, InventoryItem>();
    const receivedDropIds = clients.map(() => new Set<string>());
    clients.forEach((client, clientIndex) => client.onMessage(SERVER_MESSAGES.dropPayload, (payload: { dropId: string; item: InventoryItem }) => {
      dropPayloads.set(payload.dropId, payload.item);
      receivedDropIds[clientIndex].add(payload.dropId);
    }));
    const world = (authoritativeRoom as unknown as { world: World }).world;

    const loadoutProfile = await repository.loadProfile(identities[0].characterId);
    assert.ok(loadoutProfile);
    await new ProfileCommandService(repository).execute(identities[0].characterId, loadoutProfile.revision, {
      type: "set_skill_slot", slot: 3, skill: null,
    });
    let refreshedLoadout = false;
    let unequippedSkillRejected = false;
    clients[0].onMessage(SERVER_MESSAGES.profileUpdated, () => { refreshedLoadout = true; });
    clients[0].onMessage(SERVER_MESSAGES.rejected, (message: RejectedCommandMessage) => {
      if (message.command === CLIENT_MESSAGES.attack && message.reason === "unauthorized") unequippedSkillRejected = true;
    });
    clients[0].send(CLIENT_MESSAGES.refreshProfile, {});
    await waitFor(() => refreshedLoadout);
    clients[0].send(CLIENT_MESSAGES.attack, { sequence: 1, skill: "ward" });
    await waitFor(() => unequippedSkillRejected);
    assert.equal(authoritativeRoom.state.players.get(identities[0].characterId)!.lastProcessedAttack, 0, "unequipped skills never enter the simulation");

    const flaskPlayer = authoritativeRoom.state.players.get(identities[0].characterId)!;
    const flaskWorldPlayer = world.players.get(flaskPlayer.worldIndex)!;
    flaskWorldPlayer.life -= 30;
    const damagedLife = flaskWorldPlayer.life;
    const flaskProfileBefore = await repository.loadProfile(identities[0].characterId);
    const flaskCountBefore = flaskProfileBefore?.profile.flaskBelt[0]?.stackSize ?? 0;
    const delayedFlaskSave = repository.pauseNextSave(identities[0].characterId);
    clients[0].send(CLIENT_MESSAGES.useFlask, { slot: 0 });
    await delayedFlaskSave.started;
    await waitFor(() => flaskWorldPlayer.life > damagedLife);
    assert.equal(
      (await repository.loadProfile(identities[0].characterId))?.profile.flaskBelt[0]?.stackSize,
      flaskCountBefore,
      "flask recovery starts while the durable belt write is still pending",
    );
    delayedFlaskSave.release();
    await waitFor(async () => (await repository.loadProfile(identities[0].characterId))?.profile.flaskBelt[0]?.stackSize === flaskCountBefore - 1);

    const xpBeforeCheckpoint = (await repository.loadProfile(identities[0].characterId))!.profile.character.xp;
    flaskPlayer.experience += 17;
    await (authoritativeRoom as unknown as { checkpointProgress: () => Promise<void> }).checkpointProgress();
    assert.equal(
      (await repository.loadProfile(identities[0].characterId))!.profile.character.xp,
      xpBeforeCheckpoint + 17,
      "periodic checkpoint persistence makes in-map XP durable before leave or completion",
    );

    const flaskRuntime = (authoritativeRoom as unknown as {
      runtime: Map<string, { recoveries: Array<{ id: string }> }>;
    }).runtime.get(identities[0].characterId)!;
    flaskRuntime.recoveries.length = 0;
    flaskWorldPlayer.life -= 20;
    const rollbackLife = flaskWorldPlayer.life;
    const rollbackBelt = (await repository.loadProfile(identities[0].characterId))!.profile.flaskBelt[0]!.stackSize;
    const failedFlaskSave = repository.pauseNextSave(identities[0].characterId);
    repository.rejectNextSaveAsLocked(identities[0].characterId, "locked-test-item");
    let failedFlaskRejected = false;
    clients[0].onMessage(SERVER_MESSAGES.rejected, (message: RejectedCommandMessage) => {
      if (message.command === CLIENT_MESSAGES.useFlask && message.reason === "item_locked") failedFlaskRejected = true;
    });
    clients[0].send(CLIENT_MESSAGES.useFlask, { slot: 0 });
    await failedFlaskSave.started;
    await waitFor(() => flaskWorldPlayer.life > rollbackLife);
    failedFlaskSave.release();
    await waitFor(() => failedFlaskRejected);
    assert.equal(flaskRuntime.recoveries.length, 0, "failed persistence removes the optimistic recovery effect");
    assert.ok(flaskWorldPlayer.life <= rollbackLife + 0.01, "health already restored by the failed flask is rolled back");
    assert.equal(
      (await repository.loadProfile(identities[0].characterId))!.profile.flaskBelt[0]!.stackSize,
      rollbackBelt,
      "failed persistence rolls back both recovery and the authoritative belt charge",
    );

    const targetId = firstMonsterId(world);
    const targetSlot = entitySlot(targetId);
    world.monsters.evadeChance[targetSlot] = 0;
    const initialMonsterCount = authoritativeRoom.state.monstersAlive;
    const playerBeforeDash = authoritativeRoom.state.players.get(identities[0].characterId)!;

    world.monsters.flags[targetSlot] &= ~MonsterFlags.Aggroed;
    world.monsters.behavior[targetSlot] = MonsterArchetype.Ranged;
    world.monsters.x[targetSlot] = playerBeforeDash.x + 120;
    world.monsters.y[targetSlot] = playerBeforeDash.y;
    world.monsters.nextActionAt[targetSlot] = 0;
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.MonsterAggro && event.actorId === targetId));
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.MonsterAction && event.actorId === targetId && event.auxA === MonsterArchetype.Ranged));

    const jumperId = nextMonsterId(world, targetId);
    const jumperSlot = entitySlot(jumperId);
    world.monsters.behavior[jumperSlot] = MonsterArchetype.Jumper;
    world.monsters.x[jumperSlot] = playerBeforeDash.x + 150;
    world.monsters.y[jumperSlot] = playerBeforeDash.y;
    world.monsters.nextActionAt[jumperSlot] = 0;
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.MonsterAction && event.actorId === jumperId && event.auxA === MonsterArchetype.Jumper));

    const dashStartX = playerBeforeDash.x;
    const dashStartFocus = playerBeforeDash.focus;
    clients[0].send(CLIENT_MESSAGES.attack, { sequence: 1, skill: "dash", direction: { x: 1, y: 0 } });
    await waitFor(() => playerBeforeDash.x >= dashStartX + 100);
    assert.ok(playerBeforeDash.focus < dashStartFocus, "dash cost and position are resolved by the server");
    world.monsters.x[targetSlot] = playerBeforeDash.x + 300;
    world.monsters.y[targetSlot] = playerBeforeDash.y;
    world.monsters.maxLife[targetSlot] = 5_000;
    world.monsters.life[targetSlot] = 5_000;
    world.monsters.moveSpeed[targetSlot] = 0;
    for (let slot = 0; slot < world.monsters.capacity; slot += 1) {
      if (!world.monsters.active[slot] || slot === targetSlot) continue;
      world.monsters.x[slot] = playerBeforeDash.x + 700;
      world.monsters.y[slot] = playerBeforeDash.y + 700;
    }

    clients[0].send(CLIENT_MESSAGES.attack, { sequence: 2, skill: "nova" });
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.Skill && event.sequence === 2));
    const novaReleasedAt = authoritativeRoom.state.elapsedMilliseconds;
    assert.equal(world.monsters.life[targetSlot], 5_000, "nova damage waits for its authoritative projectiles to travel");
    await waitFor(() => world.monsters.life[targetSlot] < 5_000);
    const afterNovaLife = world.monsters.life[targetSlot];
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.Damage && event.sequence === 2 && event.auxB === 1 && event.amount > 0));

    const attackerProfile = await repository.loadProfile(identities[0].characterId);
    assert.ok(attackerProfile);
    const attackerStats = calculateCharacterStats(attackerProfile.profile).stats;
    const novaCastTime = resolveSkillDefinition(ACTIVE_SKILLS.nova, 1, attackerStats.skillCooldown, attackerStats.castSpeed).castTime;
    await waitFor(() => authoritativeRoom.state.elapsedMilliseconds >= novaReleasedAt + novaCastTime * 1_000);

    clients[0].send(CLIENT_MESSAGES.attack, { sequence: 3, skill: "flameWave", direction: { x: 1, y: 0 } });
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.Skill && event.sequence === 3));
    assert.equal(world.monsters.life[targetSlot], afterNovaLife, "flame wave damage waits for projectile collision");
    await waitFor(() => world.monsters.life[targetSlot] < afterNovaLife);
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.Damage && event.sequence === 3 && event.auxB === 4));
    await waitFor(() => activeProjectileCount(world) === 0);

    const lifeBeforeForgedAttack = world.monsters.life[targetSlot];
    clients[0].send(CLIENT_MESSAGES.attack, { sequence: 4, skill: "basic", direction: { x: 1, y: 0 }, claimedDamage: 1_000_000 });
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(world.monsters.life[targetSlot], lifeBeforeForgedAttack, "a payload containing client-authored damage must be rejected");
    assert.equal(authoritativeRoom.state.players.get(identities[0].characterId)!.lastProcessedAttack, 3);

    world.monsters.x[targetSlot] = playerBeforeDash.x + 100;
    world.monsters.y[targetSlot] = playerBeforeDash.y;
    world.monsters.life[targetSlot] = 1;
    world.monsters.itemQuantity[targetSlot] = 100_000;
    for (let slot = 0; slot < world.monsters.capacity; slot += 1) {
      if (!world.monsters.active[slot] || slot === targetSlot) continue;
      world.monsters.x[slot] = playerBeforeDash.x + 600;
      world.monsters.y[slot] = playerBeforeDash.y + 600;
    }
    const persistedBeforeKill = new Map(
      [...authoritativeRoom.state.players.values()].map((candidate) => [candidate.characterId, candidate.persistedExperience]),
    );
    clients.forEach((client, index) => {
      const attacker = authoritativeRoom.state.players.get(identities[index].characterId)!;
      const dx = world.monsters.x[targetSlot] - attacker.x;
      const dy = world.monsters.y[targetSlot] - attacker.y;
      const length = Math.hypot(dx, dy) || 1;
      client.send(CLIENT_MESSAGES.attack, { sequence: index === 0 ? 5 : 1, skill: "basic", direction: { x: dx / length, y: dy / length } });
    });
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.ProjectileSpawn && event.sequence === 5));
    await waitFor(() => !world.monsters.active[targetSlot]);
    await waitFor(() => worldEvents.some((event) => event.type === WorldEventType.Kill && event.targetId === targetId));
    const deathEvent = worldEvents.find((event) => event.type === WorldEventType.Kill && event.targetId === targetId)!;
    assert.equal(deathEvent.auxA, world.monsters.archetype[targetSlot]);
    assert.equal(deathEvent.auxB, world.monsters.rarity[targetSlot]);
    assert.equal(authoritativeRoom.state.monstersAlive, initialMonsterCount - 1);
    assert.equal([...authoritativeRoom.state.players.values()].reduce((sum, player) => sum + player.kills, 0), 1);
    const killer = [...authoritativeRoom.state.players.values()].find((player) => player.kills === 1);
    assert.ok(killer && killer.experience > 0, "the credited killer receives replicated experience immediately");
    assert.equal(
      killer.persistedExperience,
      persistedBeforeKill.get(killer.characterId),
      "newly earned map XP remains visibly pending until the next authoritative checkpoint",
    );

    await waitFor(() => authoritativeRoom.state.drops.size === 1);
    const drop = [...authoritativeRoom.state.drops.values()][0];
    await waitFor(() => receivedDropIds.every((ids) => ids.has(drop.id)));
    const creditedIndex = identities.findIndex((identity) => identity.characterId === killer.characterId);
    const pickerIndex = (creditedIndex + 1) % 4;
    const pickerIdentity = identities[pickerIndex];
    const picker = authoritativeRoom.state.players.get(pickerIdentity.characterId)!;
    drop.x = picker.x;
    drop.y = picker.y;

    const beforePickup = await repository.loadProfile(pickerIdentity.characterId);
    assert.ok(beforePickup);
    const rejectedCommands: RejectedCommandMessage[] = [];
    const pickupResults: PickupResultMessage[] = [];
    clients[pickerIndex].onMessage(SERVER_MESSAGES.rejected, (message: RejectedCommandMessage) => rejectedCommands.push(message));
    clients[pickerIndex].onMessage(SERVER_MESSAGES.pickupResult, (message: PickupResultMessage) => pickupResults.push(message));
    const lockedItemId = beforePickup.profile.inventory.entries[0].item.id;
    repository.rejectNextSaveAsLocked(pickerIdentity.characterId, lockedItemId);
    clients[pickerIndex].send(CLIENT_MESSAGES.pickup, { dropId: drop.id });
    await waitFor(() => rejectedCommands.some((message) => message.command === CLIENT_MESSAGES.pickup && message.reason === "item_locked"));
    await waitFor(() => pickupResults.some((result) => result.dropId === drop.id && result.status === "rejected" && result.reason === "item_locked"));
    assert.equal(authoritativeRoom.state.drops.has(drop.id), true, "a trade-locked profile rejects pickup without destroying the room");
    assert.equal(authoritativeRoom.clients.length, 4, "a rejected async persistence operation keeps every player connected");

    clients[pickerIndex].send(CLIENT_MESSAGES.pickup, { dropId: drop.id });
    await waitFor(() => !authoritativeRoom.state.drops.has(drop.id));
    await waitFor(() => pickupResults.some((result) => result.dropId === drop.id && result.status === "collected"));
    const afterPickup = await repository.loadProfile(pickerIdentity.characterId);
    assert.ok(afterPickup);
    const pickedItem = dropPayloads.get(drop.id);
    assert.ok(pickedItem);
    assert.match(pickedItem.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const pickedQuantity = pickedItem.kind === "currency" || pickedItem.kind === "flask" ? pickedItem.stackSize : 1;
    assert.equal(
      profileItemQuantity(afterPickup.profile, pickedItem),
      profileItemQuantity(beforePickup.profile, pickedItem) + pickedQuantity,
    );
    assert.notEqual(pickerIdentity.characterId, killer.characterId, "a party member other than the credited killer can claim shared loot");

    const playerDroppedItem = afterPickup.profile.inventory.entries.find((entry) => entry.item.kind === "map")?.item;
    assert.ok(playerDroppedItem?.kind === "map");
    clients[pickerIndex].send(CLIENT_MESSAGES.dropItem, { itemId: playerDroppedItem.id });
    await waitFor(() => [...authoritativeRoom.state.drops.values()].some((candidate) => candidate.source === "player"));
    const playerDrop = [...authoritativeRoom.state.drops.values()].find((candidate) => candidate.source === "player")!;
    await waitFor(() => receivedDropIds.every((ids) => ids.has(playerDrop.id)));
    assert.equal(dropPayloads.get(playerDrop.id)?.id, playerDroppedItem.id, "the server preserves the exact authoritative item identity");
    const afterPlayerDrop = await repository.loadProfile(pickerIdentity.characterId);
    assert.ok(afterPlayerDrop);
    assert.ok(!afterPlayerDrop.profile.inventory.entries.some((entry) => entry.item.id === playerDroppedItem.id));
    const receiverIndex = (pickerIndex + 1) % 4;
    const receiverIdentity = identities[receiverIndex];
    const receiver = authoritativeRoom.state.players.get(receiverIdentity.characterId)!;
    playerDrop.x = receiver.x;
    playerDrop.y = receiver.y;
    clients[receiverIndex].send(CLIENT_MESSAGES.pickup, { dropId: playerDrop.id });
    await waitFor(() => !authoritativeRoom.state.drops.has(playerDrop.id));
    const receiverProfile = await repository.loadProfile(receiverIdentity.characterId);
    assert.ok(receiverProfile?.profile.inventory.entries.some((entry) => entry.item.id === playerDroppedItem.id));

    // Measure the real room adapter and transport path, not only the standalone codec.
    const snapshotBytes = authoritativeRoom.clients.map(() => [] as number[]);
    const originalSendBytes = authoritativeRoom.clients.map((serverClient) => serverClient.sendBytes.bind(serverClient));
    authoritativeRoom.clients.forEach((serverClient, clientIndex) => {
      serverClient.sendBytes = ((type, bytes, options) => {
        if (type === SERVER_MESSAGES.monsterSnapshot) snapshotBytes[clientIndex].push(bytes.byteLength);
        originalSendBytes[clientIndex](type, bytes, options);
      }) as typeof serverClient.sendBytes;
    });
    while (world.monsters.count > 0) {
      const slot = world.monsters.activeSlots[world.monsters.count - 1];
      world.monsters.release(world.monsters.idAt(slot));
    }
    const rushCenter = world.players.get(flaskPlayer.worldIndex)!;
    world.config.forceAllMonstersActive = true;
    for (let index = 0; index < 2_000; index += 1) {
      world.spawnMonster({
        x: rushCenter.x - 790 + (index % 50) * 31,
        y: rushCenter.y - 650 + Math.floor(index / 50) * 33,
        archetype: index % 3,
        rarity: 0,
        packId: Math.floor(index / 6),
        life: 1e12,
        damage: 1,
        moveSpeed: 90,
        attackCooldownSeconds: 2,
      });
    }
    await waitFor(() => snapshotBytes.every((samples) => samples.length >= 20), 5_000);
    authoritativeRoom.clients.forEach((serverClient, clientIndex) => {
      serverClient.sendBytes = originalSendBytes[clientIndex];
    });
    for (const samples of snapshotBytes) {
      const steady = samples.slice(3).sort((left, right) => left - right);
      const p95BytesPerSecond = steady[Math.ceil(steady.length * 0.95) - 1] * 10;
      assert.ok(p95BytesPerSecond <= 80 * 1_024, `room rush snapshot p95 was ${(p95BytesPerSecond / 1_024).toFixed(2)} KiB/s`);
    }

    authoritativeRoom.state.wave = authoritativeRoom.state.totalWaves;
    authoritativeRoom.state.waveElapsedMilliseconds = 30_000;
    await waitFor(() => authoritativeRoom.state.finalRageActive);
    while (world.monsters.count > 0) {
      const slot = world.monsters.activeSlots[world.monsters.count - 1];
      world.monsters.release(world.monsters.idAt(slot));
    }
    await waitFor(() => authoritativeRoom.state.completed);
    await waitFor(() => authoritativeRoom.state.drops.size === 6);
    const rewards = [...authoritativeRoom.state.drops.values()];
    await waitFor(() => rewards.every((reward) => dropPayloads.has(reward.id)));
    await waitFor(() => receivedDropIds.every((ids) => rewards.every((reward) => ids.has(reward.id))));
    const items = rewards.map((reward) => dropPayloads.get(reward.id) as { kind: string; rarity?: string; tier?: number });
    const equipment = items.filter((item) => item.kind === "equipment");
    assert.equal(equipment.length, 2);
    assert.ok(equipment.some((item) => item.rarity === "magic" || item.rarity === "rare"));
    const progressionMap = items.find((item) => item.kind === "map");
    assert.equal(progressionMap?.tier, authoritativeRoom.state.tier + 1);
    for (const identity of identities.slice(0, 4)) {
      await waitFor(async () => (await repository.loadProfile(identity.characterId))?.profile.character.mapsCompleted === 1);
      const completedProfile = await repository.loadProfile(identity.characterId);
      assert.equal(completedProfile?.profile.character.highestWave, authoritativeRoom.state.totalWaves);
    }

    // Reproduce the death/exit race: a pickup save is deliberately held while
    // the client requests an exit. The server must not acknowledge the exit
    // until that item appears in the returned authoritative profile.
    const exitingIdentity = identities[0];
    const exitingClient = clients[0];
    const exitingPlayer = authoritativeRoom.state.players.get(exitingIdentity.characterId)!;
    const exitingWorldPlayer = world.players.get(exitingPlayer.worldIndex)!;
    exitingWorldPlayer.life = exitingWorldPlayer.maxLife;
    exitingPlayer.life = exitingPlayer.maxLife;
    const exitDrop = rewards.find((reward) => dropPayloads.get(reward.id)?.kind === "currency") ?? rewards[0];
    const exitItem = dropPayloads.get(exitDrop.id)!;
    exitDrop.x = exitingPlayer.x;
    exitDrop.y = exitingPlayer.y;
    const beforeExitPickup = await repository.loadProfile(exitingIdentity.characterId);
    assert.ok(beforeExitPickup);
    const exitPickupResults: PickupResultMessage[] = [];
    let exitReady: MapExitReadyMessage | null = null;
    exitingClient.onMessage(SERVER_MESSAGES.pickupResult, (message: PickupResultMessage) => exitPickupResults.push(message));
    exitingClient.onMessage(SERVER_MESSAGES.mapExitReady, (message: MapExitReadyMessage) => { exitReady = message; });
    const pausedSave = repository.pauseNextSave(exitingIdentity.characterId);
    releasePausedSave = pausedSave.release;
    let saveStarted = false;
    void pausedSave.started.then(() => { saveStarted = true; });
    const exitRequestId = randomUUID();
    exitingClient.send(CLIENT_MESSAGES.pickup, { dropId: exitDrop.id });
    exitingClient.send(CLIENT_MESSAGES.prepareMapExit, { requestId: exitRequestId });
    await waitFor(() => saveStarted);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(exitReady, null, "map exit waits for the in-flight pickup write");
    pausedSave.release();
    releasePausedSave = null;
    await waitFor(() => exitReady?.requestId === exitRequestId);
    await waitFor(() => exitPickupResults.some((result) => result.dropId === exitDrop.id && result.status === "collected"));
    const exitProfile = exitReady!.authoritativeProfile.profile;
    const exitQuantity = exitItem.kind === "currency" || exitItem.kind === "flask" ? exitItem.stackSize : 1;
    assert.equal(
      profileItemQuantity(exitProfile, exitItem),
      profileItemQuantity(beforeExitPickup.profile, exitItem) + exitQuantity,
      "the acknowledged exit profile includes the pickup that was in flight",
    );
  } finally {
    releasePausedSave?.();
    Math.random = originalRandom;
    await Promise.all(clients.map((client) => client.leave(true).catch(() => undefined)));
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});

test("a dropped map socket reconnects, resyncs world state, exits, and releases the room player", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const player = await createTestPlayer(repository, {
    handle: "map-reconnect",
    characterName: "Reconnect Player",
    classId: "sorceress",
  });
  const parties = new InMemoryCoordination(repository);
  await parties.create(player.characterId);
  configureServerServices({ authSecret: secret, players: repository, parties, expeditions: parties });
  const profile = await repository.loadProfile(player.characterId);
  assert.ok(profile);
  const mapEntry = profile.profile.inventory.entries.find((entry) => entry.item.kind === "map");
  assert.ok(mapEntry && mapEntry.item.kind === "map");
  const slotted = await new ProfileCommandService(repository).execute(player.characterId, profile.revision, {
    type: "slot_map", itemId: mapEntry.item.id,
  });
  const opened = await new MapService(repository, parties, parties, secret).open(player.characterId, slotted.revision);
  const claims = {
    sessionId: randomUUID(),
    authSessionId: randomUUID(),
    ...player,
    expiresAt: Date.now() + 60_000,
  };
  await repository.createAuthSession(claims.authSessionId, claims.accountId, claims.expiresAt);
  const token = signSessionToken(claims, secret);
  let server: ColyseusTestServer | null = null;
  let client: ClientRoom<MapRoom, MapRoomState> | null = null;
  try {
    server = await boot(createGameServer(), 0);
    const room = await server.createRoom<MapRoom>("map", { token, mapTicket: opened.mapTicket, portalIndex: 0, protocolVersion: WIRE_PROTOCOL_VERSION });
    client = await server.connectTo(room, { token, mapTicket: opened.mapTicket, portalIndex: 0, protocolVersion: WIRE_PROTOCOL_VERSION });
    client.onMessage("*", () => undefined);
    await waitFor(() => room.state.players.get(player.characterId)?.connected === true);

    const reconnectToken = client.reconnectionToken;
    client.reconnection.enabled = false;
    client.connection.close(4001, "simulate network loss");
    await waitFor(() => room.state.players.get(player.characterId)?.connected === false);

    client = await server.sdk.reconnect<MapRoomState>(reconnectToken, MapRoomState) as ClientRoom<MapRoom, MapRoomState>;
    let snapshotReceived = false;
    let unauthorizedSync = false;
    client.onMessage(SERVER_MESSAGES.monsterSnapshot, () => { snapshotReceived = true; });
    client.onMessage(SERVER_MESSAGES.rejected, (message: RejectedCommandMessage) => {
      if (message.command === CLIENT_MESSAGES.requestWorldSync && message.reason === "unauthorized") unauthorizedSync = true;
    });
    client.send(CLIENT_MESSAGES.requestWorldSync, {});
    await waitFor(() => snapshotReceived);
    assert.equal(unauthorizedSync, false, "the replacement socket is rebound before resync messages arrive");
    assert.equal(room.state.players.get(player.characterId)?.connected, true);

    let exitReady: MapExitReadyMessage | null = null;
    const requestId = randomUUID();
    client.onMessage(SERVER_MESSAGES.mapExitReady, (message: MapExitReadyMessage) => { exitReady = message; });
    client.send(CLIENT_MESSAGES.prepareMapExit, { requestId });
    await waitFor(() => exitReady?.requestId === requestId);
    await client.leave(true);
    client = null;
    await waitFor(() => room.state.players.size === 0);
    assert.equal((room as unknown as { activeClients: Map<string, unknown> }).activeClients.size, 0);
    assert.equal((room as unknown as { world: World }).world.players.getByCharacterId(player.characterId), null);
  } finally {
    await client?.leave(true).catch(() => undefined);
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});

function firstMonsterId(world: World): number {
  for (let slot = 0; slot < world.monsters.capacity; slot += 1) if (world.monsters.active[slot]) return world.monsters.idAt(slot);
  throw new Error("Expected an active monster");
}

function nextMonsterId(world: World, excluded: number): number {
  for (let slot = 0; slot < world.monsters.capacity; slot += 1) {
    const id = world.monsters.idAt(slot);
    if (world.monsters.active[slot] && id !== excluded) return id;
  }
  throw new Error("Expected another active monster");
}

function activeProjectileCount(world: World): number {
  let count = 0;
  for (let slot = 0; slot < world.projectiles.capacity; slot += 1) if (world.projectiles.active[slot]) count += 1;
  return count;
}
