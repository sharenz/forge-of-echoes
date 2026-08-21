import { randomUUID } from "node:crypto";
import type { Client } from "colyseus";
import {
  CLIENT_MESSAGES,
  MULTIPLAYER_LIMITS,
  SERVER_MESSAGES,
  attackCommandSchema,
  dropItemCommandSchema,
  joinMapOptionsSchema,
  movementCommandSchema,
  pickupCommandSchema,
  prepareMapExitCommandSchema,
  refreshProfileCommandSchema,
  useFlaskCommandSchema,
  type AttackCommand,
  type MapTicketClaims,
  type RejectedCommandMessage,
  type MapExitReadyMessage,
  type PickupResultMessage,
  type SessionClaims,
} from "../../multiplayer/protocol";
import { encodeWorldEvents } from "../../multiplayer/wire/events";
import { ACTIVE_SKILLS, BASIC_ATTACK, buildArenaBalance, isArenaCleared, resolveArenaFocusRegen, rollHitDamage, shouldActivateFinalWaveRage, shouldSpawnNextWave, type ArenaBalance } from "../../app/game/combat";
import { resolveAttackTimeSeconds } from "../../app/game/action-timing";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "../../app/game/config/monsters";
import { MAP_COMPLETION_REWARDS } from "../../app/game/config/rewards";
import type { DamageType, InventoryItem, SkillLoadout } from "../../app/game/domain";
import { isSkillEquipped } from "../../app/game/skill-loadout";
import { resolveMonsterStats, rollMonsterPack } from "../../app/game/encounters";
import { consumeFlaskFromBelt, createFlaskStack } from "../../app/game/flasks";
import { storePickedUpItem, takeProfileItem } from "../../app/game/item-drop";
import { createCurrencyStack } from "../../app/game/inventory";
import { rollMonsterDrop, type GeneratedDrop } from "../../app/game/loot";
import { grantCharacterExperience, monsterExperienceReward } from "../../app/game/progression";
import { createMapCompletionRewards } from "../../app/game/rewards";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../../app/game/skills";
import { calculateCharacterStats } from "../../app/game/stats";
import { verifyMapTicket } from "../auth/map-ticket";
import { verifySessionToken } from "../auth/session-token";
import { MULTIPLAYER_COMBAT, advanceCooldownDeadline } from "../config/multiplayer-combat";
import { DamageTypeCode, MonsterArchetype, World } from "../engine/World";
import { WorldEventBuffer, WorldEventType, type WorldEvent } from "../engine/events";
import { SeededRng } from "../engine/rng";
import { MonsterReplicator } from "../engine/snapshot";
import { formatError } from "../logging";
import { ItemLockedError, ProfileRevisionConflict } from "../persistence/errors";
import { CharacterWriteQueue } from "../persistence/CharacterWriteQueue";
import { getServerServices } from "../services";
import { MapRoomState, NetworkGroundDrop, NetworkMapPlayer } from "../state/MapState";
import { PartyRoom } from "./PartyRoom";

const SNAPSHOT_EVERY_TICKS = 2;
const DROP_TTL_MILLISECONDS = 2 * 60_000;
const COMPLETION_DROP_TTL_MILLISECONDS = 10 * 60_000;
const EVENT_AOI_HALF_WIDTH = 800;
const EVENT_AOI_HALF_HEIGHT = 680;
const MAX_EVENTS_PER_CLIENT_TICK = 256;
const PLAYER_ENTITY_FLAG = 0x8000_0000;

const SKILL_CODE = { basic: 0, nova: 1, dash: 2, ward: 3, flameWave: 4 } as const;
const ARCHETYPE_IDS: MonsterArchetypeId[] = ["ashling", "cinder-spitter", "rift-stalker", "ironhide-brute", "ember-skitter"];

interface PlayerRuntime {
  worldPlayerIndex: number;
  movementSequence: number;
  nextBasicAttackAt: number;
  nextCastAt: number;
  nextNovaAt: number;
  nextWardAt: number;
  nextFlameWaveAt: number;
  dashCharges: number;
  nextDashRechargeAt: number;
  attackDamage: number;
  focusRegen: number;
  basicAttackCooldownMilliseconds: number;
  skillLoadout: SkillLoadout;
  skills: {
    nova: ResolvedSkillDefinition;
    dash: ResolvedSkillDefinition;
    ward: ResolvedSkillDefinition;
    flameWave: ResolvedSkillDefinition;
  };
  recoveries: Array<{ resource: "life" | "mana"; remainingAmount: number; remainingSeconds: number }>;
}

export class MapRoom extends PartyRoom<MapRoomState> {
  state = new MapRoomState();
  autoDispose = false;
  private ticket!: MapTicketClaims;
  private waveStartedAt = 0;
  private readonly runtime = new Map<string, PlayerRuntime>();
  private readonly replicators = new Map<string, MonsterReplicator>();
  private readonly dropItems = new Map<string, InventoryItem>();
  private readonly profileWrites = new CharacterWriteQueue();
  private readonly persistedExperience = new Map<string, number>();
  private readonly completionPersisted = new Set<string>();
  private readonly pickupInFlight = new Set<string>();
  private readonly exitingCharacters = new Set<string>();
  private readonly eventSelections = new Map<string, Uint16Array>();
  private readonly eventPackets = new Map<string, Uint8Array>();
  private arenaBalance!: ArenaBalance;
  private world!: World;
  private contentRng!: SeededRng;
  private packSequence = 0;
  private completionStarted = false;
  private emptyRoomExpiry: ReturnType<typeof setTimeout> | null = null;

  async onCreate(rawOptions: unknown): Promise<void> {
    const options = joinMapOptionsSchema.safeParse(rawOptions);
    if (!options.success) throw new Error("A signed map ticket is required to create a map room");
    this.services = getServerServices();
    const ticket = verifyMapTicket(options.data.mapTicket, this.services.authSecret);
    if (!ticket) throw new Error("The map ticket is invalid or expired");
    if (!await this.services.expeditions.claimRoom(ticket.ticketId, this.roomId)) throw new Error("The map ticket has already created an instance");
    this.ticket = ticket;
    this.state.ticketId = ticket.ticketId;
    this.state.ownerCharacterId = ticket.ownerCharacterId;
    this.state.tier = ticket.tier;
    const party = await this.services.parties.getForMember(ticket.ownerCharacterId);
    const leaderProfile = await this.services.players.loadProfile(ticket.ownerCharacterId);
    const activeMap = party?.activeMap?.ticketId === ticket.ticketId ? party.activeMap.map : null;
    if (!party || !leaderProfile || !activeMap) throw new Error("The authoritative map profile is unavailable");
    this.initializePartyRoom(this.services, party.id);
    this.arenaBalance = buildArenaBalance(leaderProfile.profile, activeMap);
    this.state.totalWaves = this.arenaBalance.waves;
    this.world = new World({
      width: MULTIPLAYER_COMBAT.world.width,
      height: MULTIPLAYER_COMBAT.world.height,
      fixedStepMilliseconds: 1_000 / MULTIPLAYER_LIMITS.simulationHz,
      maximumProjectilesPerPlayer: MULTIPLAYER_COMBAT.projectile.maximumActivePerPlayer,
    }, {
      rng: new SeededRng(ticket.seed),
      onSlowTick: (duration, tickNumber) => console.warn(`[map-room:${this.roomId}] slow world tick ${tickNumber}: ${duration.toFixed(2)}ms`),
    });
    // Content rolls intentionally use a second deterministic stream so adding
    // loot or encounter rolls cannot perturb combat simulation outcomes.
    this.contentRng = new SeededRng(ticket.seed ^ 0x9e37_79b9);
    this.spawnWave();
    this.onMessage(CLIENT_MESSAGES.movement, (client, raw) => this.parseMovement(client, raw));
    this.onMessage(CLIENT_MESSAGES.attack, (client, raw) => this.parseAttack(client, raw));
    this.onMessage(CLIENT_MESSAGES.pickup, (client, raw) => this.runAsyncCommand(client, CLIENT_MESSAGES.pickup, () => this.parsePickup(client, raw)));
    this.onMessage(CLIENT_MESSAGES.dropItem, (client, raw) => this.runAsyncCommand(client, CLIENT_MESSAGES.dropItem, () => this.dropItem(client, raw)));
    this.onMessage(CLIENT_MESSAGES.refreshProfile, (client, raw) => this.runAsyncCommand(client, CLIENT_MESSAGES.refreshProfile, () => this.refreshPlayerProfile(client, raw)));
    this.onMessage(CLIENT_MESSAGES.useFlask, (client, raw) => this.runAsyncCommand(client, CLIENT_MESSAGES.useFlask, () => this.useFlask(client, raw)));
    this.onMessage(CLIENT_MESSAGES.prepareMapExit, (client, raw) => this.runAsyncCommand(client, CLIENT_MESSAGES.prepareMapExit, () => this.prepareMapExit(client, raw)));
    this.onMessage(CLIENT_MESSAGES.requestWorldSync, (client) => this.requestWorldSync(client));
    this.setSimulationInterval((delta) => this.simulate(delta), 1_000 / MULTIPLAYER_LIMITS.simulationHz);
    this.clock.setInterval(() => {
      void this.renewRoomLease();
    }, 10_000);
    this.scheduleEmptyRoomExpiry(60_000);
  }

  async onDispose(): Promise<void> {
    if (this.emptyRoomExpiry) clearTimeout(this.emptyRoomExpiry);
    await Promise.all([...this.state.players.values()].map((player) => this.persistProgress(player, false).catch((error) => {
      console.error(`[map-room:${this.roomId}] dispose persistence failed\n${formatError(error)}`);
    })));
    await this.profileWrites.settled();
    // Expedition membership, portal use, and room ownership are durable. A
    // dispose/restart must leave them recoverable after this room lease expires.
  }

  private async renewRoomLease(): Promise<void> {
    try {
      if (await this.services.expeditions.renewRoom(this.ticket.ticketId, this.roomId)) return;
      console.error(`[map-room:${this.roomId}] lost expedition lease; stopping stale simulation`);
      await this.disconnect(1012);
    } catch (error) {
      console.error(`[map-room:${this.roomId}] expedition lease renewal failed\n${formatError(error)}`);
    }
  }

  async onAuth(_client: Client, rawOptions: unknown): Promise<SessionClaims | false> {
    const options = joinMapOptionsSchema.safeParse(rawOptions);
    if (!options.success) return false;
    const session = verifySessionToken(options.data.token, this.services.authSecret);
    const ticket = verifyMapTicket(options.data.mapTicket, this.services.authSecret);
    if (!session || !ticket || ticket.ticketId !== this.ticket.ticketId) return false;
    if (!ticket.allowedCharacterIds.includes(session.characterId)
      || !await this.services.parties.isMember(this.partyId, session.characterId)) return false;
    // Replacing a stale socket / refreshing the page is not a new portal entry.
    if (this.state.players.has(session.characterId)) return session;
    return await this.services.expeditions.consumePortal(session.characterId, ticket.ticketId, options.data.portalIndex) ? session : false;
  }

  async onJoin(client: Client, _options: unknown, claims: SessionClaims): Promise<void> {
    if (this.emptyRoomExpiry) {
      clearTimeout(this.emptyRoomExpiry);
      this.emptyRoomExpiry = null;
    }
    const existingPlayer = this.state.players.get(claims.characterId);
    if (existingPlayer) {
      existingPlayer.connected = true;
      const worldPlayer = this.world.players.get(existingPlayer.worldIndex);
      if (worldPlayer) worldPlayer.connected = true;
      this.replicators.set(claims.characterId, new MonsterReplicator(this.world));
      await this.registerPartyClient(client, claims);
      this.sendAllDropPayloads(client);
      return;
    }
    const authoritative = await this.services.players.loadProfile(claims.characterId);
    if (!authoritative) throw new Error("Authoritative profile is unavailable");
    const stats = calculateCharacterStats(authoritative.profile).stats;
    const skillLevels = authoritative.profile.character.skillLevels;
    const skills = {
      nova: resolveSkillDefinition(ACTIVE_SKILLS.nova, skillLevels.nova, stats.skillCooldown, stats.castSpeed),
      dash: resolveSkillDefinition(ACTIVE_SKILLS.dash, skillLevels.dash, stats.skillCooldown, stats.castSpeed),
      ward: resolveSkillDefinition(ACTIVE_SKILLS.ward, skillLevels.ward, stats.skillCooldown, stats.castSpeed),
      flameWave: resolveSkillDefinition(ACTIVE_SKILLS.flameWave, skillLevels.flameWave, stats.skillCooldown, stats.castSpeed),
    };
    const spawn = this.playerSpawn(this.state.players.size);
    const worldPlayer = this.world.addPlayer({
      characterId: claims.characterId,
      x: spawn.x,
      y: spawn.y,
      life: stats.maxLife,
      focus: stats.maxFocus,
      armor: stats.armor,
      evadeChance: stats.evadeChance / 100,
      moveSpeed: (stats.moveSpeed / 45) * 34,
    });
    if (!worldPlayer) throw new Error("Map player capacity exceeded");
    const player = new NetworkMapPlayer();
    player.characterId = claims.characterId;
    player.name = claims.characterName;
    player.classId = claims.classId;
    player.x = spawn.x;
    player.y = spawn.y;
    player.life = player.maxLife = stats.maxLife;
    player.focus = player.maxFocus = stats.maxFocus;
    player.attackSpeed = stats.attackSpeed;
    player.castSpeed = stats.castSpeed;
    player.worldIndex = worldPlayer.index;
    this.state.players.set(claims.characterId, player);
    this.runtime.set(claims.characterId, {
      worldPlayerIndex: worldPlayer.index,
      movementSequence: 0,
      nextBasicAttackAt: 0,
      nextCastAt: 0,
      nextNovaAt: 0,
      nextWardAt: 0,
      nextFlameWaveAt: 0,
      dashCharges: skills.dash.maxCharges,
      nextDashRechargeAt: 0,
      attackDamage: stats.attackDamage,
      focusRegen: resolveArenaFocusRegen(stats.focusRegen, this.arenaBalance.arenaModifiers).value,
      basicAttackCooldownMilliseconds: resolveAttackTimeSeconds(stats.attackSpeed) * 1_000,
      skillLoadout: authoritative.profile.character.skillLoadout,
      skills,
      recoveries: [],
    });
    this.replicators.set(claims.characterId, new MonsterReplicator(this.world));
    this.persistedExperience.set(claims.characterId, 0);
    player.persistedExperience = 0;
    await this.registerPartyClient(client, claims);
    this.sendAllDropPayloads(client);
  }

  async onLeave(client: Client, code: number): Promise<void> {
    const claims = client.auth as SessionClaims | undefined;
    if (!claims) return;
    const player = this.state.players.get(claims.characterId);
    if (!player) return;
    const worldPlayer = this.world.players.get(player.worldIndex);
    const preparedExit = this.exitingCharacters.has(claims.characterId);
    const remove = await this.releasePartyClient(client, preparedExit ? 4000 : code, claims, (connected) => {
      player.connected = connected;
      if (worldPlayer) {
        worldPlayer.connected = connected;
        if (!connected) {
          worldPlayer.movementX = 0;
          worldPlayer.movementY = 0;
        }
      }
    });
    if (!remove) return;
    await this.persistProgress(player, false);
    this.replicators.delete(claims.characterId);
    this.runtime.delete(claims.characterId);
    this.exitingCharacters.delete(claims.characterId);
    this.world.removePlayer(claims.characterId);
    this.state.players.delete(claims.characterId);
    if (this.activeClients.size === 0) this.scheduleEmptyRoomExpiry(10 * 60_000);
  }

  private parseMovement(client: Client, raw: unknown): void {
    const parsed = movementCommandSchema.safeParse(raw);
    if (!parsed.success) return this.reject(client, CLIENT_MESSAGES.movement, "invalid");
    const claims = client.auth as SessionClaims;
    const runtime = this.runtime.get(claims.characterId);
    if (!runtime) return this.reject(client, CLIENT_MESSAGES.movement, "unauthorized");
    if (parsed.data.sequence <= runtime.movementSequence) return this.reject(client, CLIENT_MESSAGES.movement, "stale");
    runtime.movementSequence = parsed.data.sequence;
    if (!this.world.enqueueInput({ kind: "movement", playerIndex: runtime.worldPlayerIndex, ...parsed.data })) {
      this.reject(client, CLIENT_MESSAGES.movement, "rate_limited");
    }
  }

  private requestWorldSync(client: Client): void {
    const claims = client.auth as SessionClaims | undefined;
    if (!claims || this.activeClients.get(claims.characterId) !== client) return this.reject(client, CLIENT_MESSAGES.requestWorldSync, "unauthorized");
    this.replicators.set(claims.characterId, new MonsterReplicator(this.world));
    this.sendAllDropPayloads(client);
  }

  private parseAttack(client: Client, raw: unknown): void {
    const parsed = attackCommandSchema.safeParse(raw);
    if (!parsed.success) return this.reject(client, CLIENT_MESSAGES.attack, "invalid");
    const claims = client.auth as SessionClaims;
    const player = this.state.players.get(claims.characterId);
    const runtime = this.runtime.get(claims.characterId);
    const worldPlayer = runtime ? this.world.players.get(runtime.worldPlayerIndex) : null;
    if (!player || !runtime || !worldPlayer || !player.connected || worldPlayer.life <= 0) return this.reject(client, CLIENT_MESSAGES.attack, "unauthorized");
    if (parsed.data.sequence <= player.lastProcessedAttack) return this.reject(client, CLIENT_MESSAGES.attack, "stale");
    this.attack(client, player, runtime, parsed.data);
  }

  private attack(client: Client, player: NetworkMapPlayer, runtime: PlayerRuntime, command: AttackCommand): void {
    const now = this.state.elapsedMilliseconds;
    const worldPlayer = this.world.players.get(runtime.worldPlayerIndex);
    if (!worldPlayer) return;
    if (!isSkillEquipped(runtime.skillLoadout, command.skill)) {
      return this.reject(client, CLIENT_MESSAGES.attack, "unauthorized");
    }
    if (command.skill === "basic") {
      const nextDeadline = advanceCooldownDeadline(
        now,
        runtime.nextBasicAttackAt,
        runtime.basicAttackCooldownMilliseconds,
        1_000 / MULTIPLAYER_LIMITS.simulationHz,
      );
      if (nextDeadline === null) return this.reject(client, CLIENT_MESSAGES.attack, "rate_limited");
      const direction = normalizedDirection(command.direction);
      if (!direction) return this.reject(client, CLIENT_MESSAGES.attack, "invalid");
      if (!this.enqueueProjectileBurst(runtime, command, BASIC_ATTACK, [direction], MULTIPLAYER_COMBAT.projectile.basicRange)) {
        return this.reject(client, CLIENT_MESSAGES.attack, "projectile_capacity");
      }
      runtime.nextBasicAttackAt = nextDeadline;
      player.lastProcessedAttack = command.sequence;
      return;
    }
    const skill = runtime.skills[command.skill];
    const nextAt = command.skill === "nova" ? runtime.nextNovaAt
      : command.skill === "ward" ? runtime.nextWardAt
        : command.skill === "flameWave" ? runtime.nextFlameWaveAt : 0;
    const nextCastDeadline = skill.presentation.animation === "cast"
      ? advanceCooldownDeadline(
          now,
          runtime.nextCastAt,
          skill.castTime * 1_000,
          1_000 / MULTIPLAYER_LIMITS.simulationHz,
        )
      : 0;
    if (nextCastDeadline === null || now < nextAt || worldPlayer.focus < skill.focusCost || (command.skill === "dash" && runtime.dashCharges <= 0)) {
      return this.reject(client, CLIENT_MESSAGES.attack, "rate_limited");
    }
    const direction = command.direction ? normalizedDirection(command.direction) : null;
    if ((command.skill === "dash" || command.skill === "flameWave") && !direction) return this.reject(client, CLIENT_MESSAGES.attack, "invalid");
    if (command.skill === "nova") {
      const directions = Array.from({ length: skill.projectileCount }, (_, index) => {
        const angle = Math.PI * 2 * index / skill.projectileCount;
        return { x: Math.cos(angle), y: Math.sin(angle) };
      });
      if (!this.enqueueProjectileBurst(runtime, command, skill, directions, MULTIPLAYER_COMBAT.projectile.novaRange)) {
        return this.reject(client, CLIENT_MESSAGES.attack, "projectile_capacity");
      }
      player.lastProcessedAttack = command.sequence;
      worldPlayer.focus -= skill.focusCost;
      runtime.nextNovaAt = now + skill.cooldown * 1_000;
      runtime.nextCastAt = nextCastDeadline;
      return;
    }
    if (command.skill === "dash") {
      player.lastProcessedAttack = command.sequence;
      worldPlayer.focus -= skill.focusCost;
      runtime.dashCharges -= 1;
      if (runtime.nextDashRechargeAt === 0) runtime.nextDashRechargeAt = now + skill.recharge * 1_000;
      this.world.enqueueInput({
        kind: "dash", playerIndex: runtime.worldPlayerIndex, sequence: command.sequence,
        directionX: direction!.x, directionY: direction!.y, distance: 105, skillId: SKILL_CODE.dash,
      });
      return;
    }
    if (command.skill === "ward") {
      player.lastProcessedAttack = command.sequence;
      worldPlayer.focus -= skill.focusCost;
      runtime.nextWardAt = now + skill.cooldown * 1_000;
      runtime.nextCastAt = nextCastDeadline;
      this.world.enqueueInput({
        kind: "ward", playerIndex: runtime.worldPlayerIndex, sequence: command.sequence,
        durationSeconds: skill.duration, damageReduction: skill.damageReduction / 100, skillId: SKILL_CODE.ward,
      });
      return;
    }
    const center = Math.atan2(direction!.y, direction!.x);
    const directions = Array.from({ length: skill.projectileCount }, (_, index) => {
      const offset = skill.projectileCount === 1 ? 0 : (index / (skill.projectileCount - 1) - 0.5) * 0.78;
      return { x: Math.cos(center + offset), y: Math.sin(center + offset) };
    });
    if (!this.enqueueProjectileBurst(runtime, command, skill, directions, MULTIPLAYER_COMBAT.projectile.flameWaveRange)) {
      return this.reject(client, CLIENT_MESSAGES.attack, "projectile_capacity");
    }
    player.lastProcessedAttack = command.sequence;
    worldPlayer.focus -= skill.focusCost;
    runtime.nextFlameWaveAt = now + skill.cooldown * 1_000;
    runtime.nextCastAt = nextCastDeadline;
  }

  private enqueueProjectileBurst(
    runtime: PlayerRuntime,
    command: AttackCommand,
    skill: Pick<ResolvedSkillDefinition, "damage" | "piercing">,
    directions: ReadonlyArray<{ x: number; y: number }>,
    range: number,
  ): boolean {
    if (!skill.damage) return false;
    const rolled = rollHitDamage(runtime.attackDamage, skill.damage, () => this.contentRng.next());
    return this.world.enqueueInput({
      kind: "projectileBurst",
      playerIndex: runtime.worldPlayerIndex,
      sequence: command.sequence,
      directions,
      speed: MULTIPLAYER_COMBAT.projectile.speed,
      range,
      radius: MULTIPLAYER_COMBAT.projectile.collisionRadius,
      damage: rolled.amount,
      damageType: damageTypeCode(rolled.type),
      pierces: skill.piercing,
      skillId: SKILL_CODE[command.skill],
    });
  }

  private simulate(deltaMilliseconds: number): void {
    this.expireDrops();
    const previousSimulationSeconds = this.world.simulationSeconds;
    this.world.advance(deltaMilliseconds, (events, outcomes) => this.flushWorldTick(events, outcomes));
    const simulationDeltaSeconds = this.world.simulationSeconds - previousSimulationSeconds;
    this.state.elapsedMilliseconds = this.world.simulationSeconds * 1_000;
    this.state.waveElapsedMilliseconds += simulationDeltaSeconds * 1_000;
    this.updatePlayerResources(simulationDeltaSeconds);
    this.state.monstersAlive = this.world.monsters.count;
    this.syncPlayers();
    if (!this.state.completed && shouldActivateFinalWaveRage(
      this.state.wave,
      this.state.totalWaves,
      this.state.waveElapsedMilliseconds / 1_000,
      this.state.finalRageActive,
    )) {
      this.state.finalRageActive = true;
      this.world.config.forceAllMonstersActive = true;
    }
    if (!this.state.completed && isArenaCleared(this.state.wave, this.state.totalWaves, this.state.monstersAlive)) {
      this.positionCompletionCache();
      this.state.completed = true;
      if (!this.completionStarted) {
        this.completionStarted = true;
        this.runAsyncTask("complete_map", () => this.completeMap(), "complete_map");
      }
    } else if (!this.state.completed && shouldSpawnNextWave(
      this.state.wave,
      this.state.totalWaves,
      this.state.monstersAlive,
      (this.state.elapsedMilliseconds - this.waveStartedAt) / 1_000,
    )) {
      this.state.wave += 1;
      this.spawnWave();
    }
  }

  private flushWorldTick(events: WorldEventBuffer, outcomes: readonly WorldEvent[]): void {
    for (const outcome of outcomes) this.applyWorldOutcome(outcome);
    // Death is an authoritative outcome rather than a best-effort cosmetic
    // event. Send it from the non-dropping outcome stream so corpses and death
    // cues cannot disappear when a busy combat tick saturates the event buffer.
    const deathOutcomes = outcomes.filter((outcome) => outcome.type === WorldEventType.Kill);
    for (const [characterId, client] of this.activeClients) {
      const runtime = this.runtime.get(characterId);
      const player = runtime ? this.world.players.get(runtime.worldPlayerIndex) : null;
      if (!player) continue;
      if (deathOutcomes.length > 0) {
        const relevantDeaths = deathOutcomes.filter((death) => this.isOutcomeRelevant(death, player.index, player.x, player.y));
        if (relevantDeaths.length > 0) client.sendBytes(SERVER_MESSAGES.worldEvents, encodeWorldEvents(relevantDeaths));
      }
      let selection = this.eventSelections.get(characterId);
      if (!selection) {
        selection = new Uint16Array(MAX_EVENTS_PER_CLIENT_TICK);
        this.eventSelections.set(characterId, selection);
      }
      const eventCount = this.selectWorldEvents(events, selection, player.index, player.x, player.y);
      if (eventCount > 0) {
        let packetBuffer = this.eventPackets.get(characterId);
        if (!packetBuffer) {
          packetBuffer = new Uint8Array(16_384);
          this.eventPackets.set(characterId, packetBuffer);
        }
        const packet = encodeWorldEvents(events, selection, eventCount, packetBuffer);
        client.sendBytes(SERVER_MESSAGES.worldEvents, packet);
      }
      if (this.world.tickNumber % SNAPSHOT_EVERY_TICKS !== 0) continue;
      const frame = this.replicators.get(characterId)?.build({ centerX: player.x, centerY: player.y, width: 960, height: 720, margin: 320 });
      if (!frame) continue;
      if (frame.lifecycle) client.sendBytes(SERVER_MESSAGES.monsterLifecycle, frame.lifecycle);
      client.sendBytes(SERVER_MESSAGES.monsterSnapshot, frame.snapshot);
    }
  }

  private applyWorldOutcome(event: WorldEvent): void {
    if (event.type === WorldEventType.Kill) {
      const player = this.playerFromEntity(event.actorId);
      if (player) {
        player.kills += 1;
        player.experience += Math.max(0, Math.round(event.amount));
      }
      return;
    }
    if (event.type === WorldEventType.Drop) {
      this.spawnMonsterDrop(event.x, event.y, event.amount, event.auxA);
    }
  }

  private selectWorldEvents(events: WorldEventBuffer, output: Uint16Array, playerIndex: number, playerX: number, playerY: number): number {
    let count = 0;
    for (let priority = 0; priority <= 2 && count < output.length; priority += 1) {
      for (let index = 0; index < events.length && count < output.length; index += 1) {
        const type = events.types[index] as WorldEventType;
        if (!this.isTransmittedEvent(type) || this.eventPriority(events, index, playerIndex) !== priority
          || !this.isEventRelevant(events, index, playerIndex, playerX, playerY)) continue;
        output[count] = index;
        count += 1;
      }
    }
    return count;
  }

  private eventPriority(events: WorldEventBuffer, index: number, playerIndex: number): number {
    const type = events.types[index] as WorldEventType;
    const playerEntity = (PLAYER_ENTITY_FLAG | playerIndex) >>> 0;
    if (events.actorIds[index] === playerEntity || events.targetIds[index] === playerEntity
      || type === WorldEventType.MonsterDespawn) return 0;
    if (type === WorldEventType.Damage || type === WorldEventType.Skill || type === WorldEventType.ProjectileSpawn
      || type === WorldEventType.MonsterAction || type === WorldEventType.MonsterProjectileHit
      || type === WorldEventType.MonsterProjectileExpire) return 1;
    return 2;
  }

  private isTransmittedEvent(type: WorldEventType): boolean {
    return type === WorldEventType.Damage || type === WorldEventType.Skill || type === WorldEventType.MonsterAction
      || type === WorldEventType.ProjectileSpawn || type === WorldEventType.ProjectileExpire
      || type === WorldEventType.MonsterDespawn || type === WorldEventType.MonsterProjectileHit
      || type === WorldEventType.MonsterProjectileExpire || type === WorldEventType.MonsterAggro;
  }

  private isEventRelevant(events: WorldEventBuffer, index: number, playerIndex: number, playerX: number, playerY: number): boolean {
    const playerEntity = (PLAYER_ENTITY_FLAG | playerIndex) >>> 0;
    if (events.actorIds[index] === playerEntity || events.targetIds[index] === playerEntity) return true;
    return Math.abs(events.xs[index] - playerX) <= EVENT_AOI_HALF_WIDTH
      && Math.abs(events.ys[index] - playerY) <= EVENT_AOI_HALF_HEIGHT;
  }

  private isOutcomeRelevant(event: WorldEvent, playerIndex: number, playerX: number, playerY: number): boolean {
    const playerEntity = (PLAYER_ENTITY_FLAG | playerIndex) >>> 0;
    if (event.actorId === playerEntity || event.targetId === playerEntity) return true;
    return Math.abs(event.x - playerX) <= EVENT_AOI_HALF_WIDTH
      && Math.abs(event.y - playerY) <= EVENT_AOI_HALF_HEIGHT;
  }

  private playerFromEntity(entityId: number): NetworkMapPlayer | null {
    if ((entityId & PLAYER_ENTITY_FLAG) === 0) return null;
    const index = entityId & ~PLAYER_ENTITY_FLAG;
    for (const player of this.state.players.values()) if (player.worldIndex === index) return player;
    return null;
  }

  private updatePlayerResources(deltaSeconds: number): void {
    for (const [characterId, runtime] of this.runtime) {
      const player = this.world.players.get(runtime.worldPlayerIndex);
      if (!player?.connected || player.life <= 0) continue;
      player.focus = Math.min(player.maxFocus, player.focus + runtime.focusRegen * deltaSeconds);
      if (runtime.dashCharges < runtime.skills.dash.maxCharges && this.state.elapsedMilliseconds >= runtime.nextDashRechargeAt) {
        runtime.dashCharges += 1;
        runtime.nextDashRechargeAt = runtime.dashCharges < runtime.skills.dash.maxCharges
          ? this.state.elapsedMilliseconds + runtime.skills.dash.recharge * 1_000 : 0;
      }
      for (let index = runtime.recoveries.length - 1; index >= 0; index -= 1) {
        const recovery = runtime.recoveries[index];
        const duration = Math.min(deltaSeconds, recovery.remainingSeconds);
        const restored = recovery.remainingSeconds > 0 ? recovery.remainingAmount / recovery.remainingSeconds * duration : recovery.remainingAmount;
        if (recovery.resource === "life") player.life = Math.min(player.maxLife, player.life + restored);
        else player.focus = Math.min(player.maxFocus, player.focus + restored);
        recovery.remainingAmount = Math.max(0, recovery.remainingAmount - restored);
        recovery.remainingSeconds = Math.max(0, recovery.remainingSeconds - duration);
        const full = recovery.resource === "life" ? player.life >= player.maxLife : player.focus >= player.maxFocus;
        if (full || recovery.remainingAmount <= 0 || recovery.remainingSeconds <= 0) runtime.recoveries.splice(index, 1);
      }
      const networkPlayer = this.state.players.get(characterId);
      if (networkPlayer) networkPlayer.lastProcessedMovement = player.lastMovementSequence;
    }
  }

  private syncPlayers(): void {
    for (const networkPlayer of this.state.players.values()) {
      const player = this.world.players.get(networkPlayer.worldIndex);
      if (!player) continue;
      networkPlayer.x = player.x;
      networkPlayer.y = player.y;
      networkPlayer.facingX = player.facingX;
      networkPlayer.facingY = player.facingY;
      networkPlayer.life = player.life;
      networkPlayer.maxLife = player.maxLife;
      networkPlayer.focus = player.focus;
      networkPlayer.maxFocus = player.maxFocus;
      networkPlayer.lastProcessedMovement = player.lastMovementSequence;
      networkPlayer.lastProcessedAttack = player.lastAttackSequence;
    }
  }

  private spawnWave(): void {
    const waveStats = this.arenaBalance.waveStats[this.state.wave - 1];
    if (!waveStats) throw new Error(`Missing authoritative balance for wave ${this.state.wave}`);
    const count = Math.max(1, Math.min(this.world.config.monsterCapacity - this.state.monstersAlive, Math.round(waveStats.monsterCount)));
    const center = { x: MULTIPLAYER_COMBAT.world.width / 2, y: MULTIPLAYER_COMBAT.world.height / 2 };
    let spawned = 0;
    const random = () => this.contentRng.next();
    while (spawned < count) {
      const packSize = Math.min(count - spawned, 4 + Math.floor(random() * 4));
      const plan = rollMonsterPack(packSize, this.state.wave, this.state.tier, waveStats.monsterRarity, random);
      const angle = (this.packSequence * 2.399963 + random() * 0.45) % (Math.PI * 2);
      const radius = 560 + this.packSequence % 4 * 260 + random() * 180;
      const packCenter = {
        x: Math.max(180, Math.min(MULTIPLAYER_COMBAT.world.width - 180, center.x + Math.cos(angle) * radius)),
        y: Math.max(180, Math.min(MULTIPLAYER_COMBAT.world.height - 180, center.y + Math.sin(angle) * radius)),
      };
      for (let memberIndex = 0; memberIndex < packSize; memberIndex += 1) {
        const archetypeId = plan.archetypeIds[memberIndex];
        const rareLeader = plan.rarity === "rare" && plan.rareLeaderIndex === memberIndex;
        const rarity = plan.rarity === "magic" ? "magic" : rareLeader ? "rare" : "normal";
        const stats = resolveMonsterStats(archetypeId, waveStats, rarity, rarity === "normal" ? [] : plan.modifierIds);
        const memberAngle = memberIndex / packSize * Math.PI * 2 + random() * 0.35;
        const memberRadius = 24 + memberIndex % 3 * 24;
        const archetype = MONSTER_ARCHETYPES[archetypeId];
        const id = this.world.spawnMonster({
          x: packCenter.x + Math.cos(memberAngle) * memberRadius,
          y: packCenter.y + Math.sin(memberAngle) * memberRadius,
          archetype: ARCHETYPE_IDS.indexOf(archetypeId),
          behavior: archetype.behavior === "ranged" ? MonsterArchetype.Ranged : archetype.behavior === "jumper" ? MonsterArchetype.Jumper : MonsterArchetype.Melee,
          rarity: rarity === "rare" ? 2 : rarity === "magic" ? 1 : 0,
          packId: this.packSequence & 0xffff,
          life: Math.max(1, Math.round(stats.maxLife)),
          damage: Math.max(1, stats.damage * (archetype.ranged?.damageEffectiveness ?? archetype.jump?.damageEffectiveness ?? 1)),
          armor: stats.armor,
          evadeChance: stats.evadeChance / 100,
          moveSpeed: stats.moveSpeed.min + random() * Math.max(0, stats.moveSpeed.max - stats.moveSpeed.min),
          attackRange: MULTIPLAYER_COMBAT.monster.contactRange,
          attackCooldownSeconds: archetype.behavior === "ranged" && archetype.ranged ? archetype.ranged.cooldown
            : archetype.behavior === "jumper" && archetype.jump ? archetype.jump.cooldown
              : MULTIPLAYER_COMBAT.monster.contactCooldownMilliseconds / 1_000,
          projectileSpeed: archetype.ranged?.projectileSpeed,
          projectileRange: archetype.ranged?.projectileRange,
          projectileRadius: archetype.ranged?.projectileRadius,
          experience: monsterExperienceReward(archetypeId, this.state.wave, this.state.tier, rarity),
          itemQuantity: stats.itemQuantity,
          itemRarity: stats.itemRarity,
        });
        if (id !== 0) this.state.monstersAlive += 1;
      }
      spawned += packSize;
      this.packSequence = (this.packSequence + 1) & 0xffff;
    }
    this.waveStartedAt = this.state.elapsedMilliseconds;
    this.state.waveElapsedMilliseconds = 0;
    this.state.finalRageActive = false;
    this.world.config.forceAllMonstersActive = false;
  }

  private spawnMonsterDrop(x: number, y: number, itemQuantity: number, itemRarity: number): void {
    const random = () => this.contentRng.next();
    const drop = rollMonsterDrop({
      itemLevel: this.arenaBalance.monsterLevel,
      currentMapTier: this.state.tier,
      itemQuantity,
      itemRarity,
    }, random);
    if (drop) this.spawnWorldItem(x, y, this.authoritativeItem(drop), "monster");
  }

  private spawnWorldDrop(x: number, y: number, drop: GeneratedDrop, source: "monster" | "completion"): void {
    this.spawnWorldItem(x, y, this.authoritativeItem(drop), source);
  }

  private spawnWorldItem(x: number, y: number, item: InventoryItem, source: "monster" | "completion" | "player"): void {
    const drop = new NetworkGroundDrop();
    drop.id = randomUUID();
    drop.x = Math.max(24, Math.min(MULTIPLAYER_COMBAT.world.width - 24, x));
    drop.y = Math.max(24, Math.min(MULTIPLAYER_COMBAT.world.height - 24, y));
    drop.source = source;
    drop.rarity = item.kind === "equipment" ? item.rarity : item.kind;
    drop.expiresAt = Date.now() + (source === "completion" ? COMPLETION_DROP_TTL_MILLISECONDS : DROP_TTL_MILLISECONDS);
    this.dropItems.set(drop.id, item);
    this.state.drops.set(drop.id, drop);
    for (const client of this.activeClients.values()) client.send(SERVER_MESSAGES.dropPayload, { dropId: drop.id, item });
  }

  private sendAllDropPayloads(client: Client): void {
    for (const drop of this.state.drops.values()) {
      const item = this.dropItems.get(drop.id);
      if (item) client.send(SERVER_MESSAGES.dropPayload, { dropId: drop.id, item });
    }
  }

  private expireDrops(): void {
    const now = Date.now();
    for (const drop of this.state.drops.values()) {
      if (drop.expiresAt > now) continue;
      this.state.drops.delete(drop.id);
      this.dropItems.delete(drop.id);
    }
  }

  private async parsePickup(client: Client, raw: unknown): Promise<void> {
    const parsed = pickupCommandSchema.safeParse(raw);
    if (!parsed.success) return this.reject(client, CLIENT_MESSAGES.pickup, "invalid");
    const claims = client.auth as SessionClaims | undefined;
    const player = claims ? this.state.players.get(claims.characterId) : null;
    const drop = this.state.drops.get(parsed.data.dropId);
    const item = this.dropItems.get(parsed.data.dropId);
    if (!claims || !player || player.life <= 0 || this.exitingCharacters.has(claims.characterId) || !drop || !item) {
      return this.rejectPickup(client, parsed.data.dropId, "unauthorized");
    }
    if (Math.hypot(player.x - drop.x, player.y - drop.y) > MULTIPLAYER_COMBAT.player.pickupRange) {
      return this.rejectPickup(client, parsed.data.dropId, "invalid");
    }
    if (this.pickupInFlight.has(drop.id)) return;
    this.pickupInFlight.add(drop.id);
    try {
      const saved = await this.profileWrites.run(claims.characterId, async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await this.services.players.loadProfile(claims.characterId);
          if (!current) return null;
          const profile = storePickedUpItem(current.profile, item);
          if (!profile) throw new Error("inventory_full");
          try {
            return await this.services.players.saveProfile(claims.characterId, current.revision, profile);
          } catch (error) {
            if (!(error instanceof ProfileRevisionConflict)) throw error;
          }
        }
        return null;
      });
      if (!saved) return this.rejectPickup(client, parsed.data.dropId, "conflict");
      this.state.drops.delete(drop.id);
      this.dropItems.delete(drop.id);
      client.send(SERVER_MESSAGES.pickupResult, {
        dropId: drop.id,
        status: "collected",
      } satisfies PickupResultMessage);
      client.send(SERVER_MESSAGES.profileUpdated, saved);
    } catch (error) {
      if (error instanceof Error && error.message === "inventory_full") return this.rejectPickup(client, parsed.data.dropId, "inventory_full");
      if (error instanceof ItemLockedError) return this.rejectPickup(client, parsed.data.dropId, "item_locked");
      throw error;
    } finally {
      this.pickupInFlight.delete(drop.id);
    }
  }

  private async prepareMapExit(client: Client, raw: unknown): Promise<void> {
    const parsed = prepareMapExitCommandSchema.safeParse(raw);
    if (!parsed.success) return this.reject(client, CLIENT_MESSAGES.prepareMapExit, "invalid");
    const claims = client.auth as SessionClaims | undefined;
    const player = claims ? this.state.players.get(claims.characterId) : null;
    if (!claims || !player || this.activeClients.get(claims.characterId) !== client) {
      return this.reject(client, CLIENT_MESSAGES.prepareMapExit, "unauthorized");
    }
    this.exitingCharacters.add(claims.characterId);
    try {
      // Commands from one socket are delivered in order. Once this character is
      // marked as exiting, no later pickup can enter the queue, so waiting for
      // its current tail creates a real persistence barrier.
      await this.profileWrites.settled(claims.characterId);
      await this.persistProgress(player, false);
      await this.profileWrites.settled(claims.characterId);
      const authoritativeProfile = await this.services.players.loadProfile(claims.characterId);
      if (!authoritativeProfile) throw new Error("Authoritative profile is unavailable");
      client.send(SERVER_MESSAGES.mapExitReady, {
        requestId: parsed.data.requestId,
        authoritativeProfile,
      } satisfies MapExitReadyMessage);
    } catch (error) {
      this.exitingCharacters.delete(claims.characterId);
      throw error;
    }
  }

  private async dropItem(client: Client, raw: unknown): Promise<void> {
    const parsed = dropItemCommandSchema.safeParse(raw);
    if (!parsed.success) return this.reject(client, CLIENT_MESSAGES.dropItem, "invalid");
    const claims = client.auth as SessionClaims | undefined;
    const player = claims ? this.state.players.get(claims.characterId) : null;
    if (!claims || !player || player.life <= 0 || this.exitingCharacters.has(claims.characterId)) {
      return this.reject(client, CLIENT_MESSAGES.dropItem, "unauthorized");
    }
    const result = await this.profileWrites.run(claims.characterId, async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await this.services.players.loadProfile(claims.characterId);
        if (!current) return null;
        const taken = takeProfileItem(current.profile, parsed.data.itemId);
        if (!taken) throw new Error("invalid_item");
        try {
          const saved = await this.services.players.saveProfile(claims.characterId, current.revision, taken.profile);
          return { saved, item: taken.item };
        } catch (error) {
          if (!(error instanceof ProfileRevisionConflict)) throw error;
        }
      }
      return null;
    });
    if (!result) return this.reject(client, CLIENT_MESSAGES.dropItem, "conflict");
    const angle = Math.atan2(player.facingY, player.facingX);
    this.spawnWorldItem(player.x + Math.cos(angle) * 46, player.y + Math.sin(angle) * 46, result.item, "player");
    client.send(SERVER_MESSAGES.profileUpdated, result.saved);
  }

  private async refreshPlayerProfile(client: Client, raw: unknown): Promise<void> {
    if (!refreshProfileCommandSchema.safeParse(raw).success) return this.reject(client, CLIENT_MESSAGES.refreshProfile, "invalid");
    const claims = client.auth as SessionClaims | undefined;
    const networkPlayer = claims ? this.state.players.get(claims.characterId) : null;
    const runtime = claims ? this.runtime.get(claims.characterId) : null;
    const player = runtime ? this.world.players.get(runtime.worldPlayerIndex) : null;
    if (!claims || !networkPlayer || !runtime || !player) return this.reject(client, CLIENT_MESSAGES.refreshProfile, "unauthorized");
    const current = await this.services.players.loadProfile(claims.characterId);
    if (!current) return this.reject(client, CLIENT_MESSAGES.refreshProfile, "unauthorized");
    const stats = calculateCharacterStats(current.profile).stats;
    const lifeRatio = player.maxLife > 0 ? player.life / player.maxLife : 1;
    const focusRatio = player.maxFocus > 0 ? player.focus / player.maxFocus : 1;
    player.maxLife = stats.maxLife;
    player.life = Math.max(1, Math.min(player.maxLife, player.maxLife * lifeRatio));
    player.maxFocus = stats.maxFocus;
    player.focus = Math.max(0, Math.min(player.maxFocus, player.maxFocus * focusRatio));
    player.armor = stats.armor;
    player.evadeChance = stats.evadeChance / 100;
    player.moveSpeed = stats.moveSpeed / 45 * 34;
    networkPlayer.attackSpeed = stats.attackSpeed;
    networkPlayer.castSpeed = stats.castSpeed;
    runtime.attackDamage = stats.attackDamage;
    runtime.focusRegen = resolveArenaFocusRegen(stats.focusRegen, this.arenaBalance.arenaModifiers).value;
    runtime.basicAttackCooldownMilliseconds = resolveAttackTimeSeconds(stats.attackSpeed) * 1_000;
    runtime.skillLoadout = current.profile.character.skillLoadout;
    runtime.skills = {
      nova: resolveSkillDefinition(ACTIVE_SKILLS.nova, current.profile.character.skillLevels.nova, stats.skillCooldown, stats.castSpeed),
      dash: resolveSkillDefinition(ACTIVE_SKILLS.dash, current.profile.character.skillLevels.dash, stats.skillCooldown, stats.castSpeed),
      ward: resolveSkillDefinition(ACTIVE_SKILLS.ward, current.profile.character.skillLevels.ward, stats.skillCooldown, stats.castSpeed),
      flameWave: resolveSkillDefinition(ACTIVE_SKILLS.flameWave, current.profile.character.skillLevels.flameWave, stats.skillCooldown, stats.castSpeed),
    };
    runtime.dashCharges = Math.min(runtime.dashCharges, runtime.skills.dash.maxCharges);
    client.send(SERVER_MESSAGES.profileUpdated, current);
  }

  private async useFlask(client: Client, raw: unknown): Promise<void> {
    const parsed = useFlaskCommandSchema.safeParse(raw);
    if (!parsed.success) return this.reject(client, CLIENT_MESSAGES.useFlask, "invalid");
    const claims = client.auth as SessionClaims | undefined;
    const runtime = claims ? this.runtime.get(claims.characterId) : null;
    const player = runtime ? this.world.players.get(runtime.worldPlayerIndex) : null;
    if (!claims || !runtime || !player || player.life <= 0 || this.exitingCharacters.has(claims.characterId)) {
      return this.reject(client, CLIENT_MESSAGES.useFlask, "unauthorized");
    }
    const result = await this.profileWrites.run(claims.characterId, async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await this.services.players.loadProfile(claims.characterId);
        if (!current) return null;
        const consumed = consumeFlaskFromBelt(current.profile, parsed.data.slot);
        if (!consumed) throw new Error("invalid_flask");
        const full = consumed.definition.resource === "life" ? player.life >= player.maxLife : player.focus >= player.maxFocus;
        if (full) throw new Error("resource_full");
        try {
          const saved = await this.services.players.saveProfile(claims.characterId, current.revision, consumed.profile);
          return { saved, definition: consumed.definition };
        } catch (error) {
          if (!(error instanceof ProfileRevisionConflict)) throw error;
        }
      }
      return null;
    });
    if (!result) return this.reject(client, CLIENT_MESSAGES.useFlask, "conflict");
    runtime.recoveries.push({
      resource: result.definition.resource,
      remainingAmount: result.definition.recovery,
      remainingSeconds: result.definition.durationSeconds,
    });
    client.send(SERVER_MESSAGES.profileUpdated, result.saved);
  }

  private async completeMap(): Promise<void> {
    await Promise.all([...this.state.players.values()].map((player) => this.persistProgress(player, true)));
    const rewards = createMapCompletionRewards(
      this.arenaBalance.monsterLevel,
      this.arenaBalance.waveStats.at(-1)?.itemRarity ?? 100,
      this.state.tier,
      () => this.contentRng.next(),
    );
    rewards.forEach((reward, index) => {
      const angle = index / rewards.length * Math.PI * 2;
      const distance = MAP_COMPLETION_REWARDS.chest.lootScatterRadius * (index % 2 === 0 ? 1 : 0.72);
      this.spawnWorldDrop(
        this.state.completionX + Math.cos(angle) * distance,
        this.state.completionY + Math.sin(angle) * distance,
        reward,
        "completion",
      );
    });
  }

  private positionCompletionCache(): void {
    const players = [...this.state.players.values()];
    const centerX = players.length > 0
      ? players.reduce((sum, player) => sum + player.x, 0) / players.length
      : MULTIPLAYER_COMBAT.world.width / 2;
    const centerY = players.length > 0
      ? players.reduce((sum, player) => sum + player.y, 0) / players.length
      : MULTIPLAYER_COMBAT.world.height / 2;
    const distance = MAP_COMPLETION_REWARDS.chest.spawnDistance;
    const yDirection = centerY + distance <= MULTIPLAYER_COMBAT.world.height - 100 ? 1 : -1;
    this.state.completionX = Math.max(100, Math.min(MULTIPLAYER_COMBAT.world.width - 100, centerX));
    this.state.completionY = Math.max(100, Math.min(MULTIPLAYER_COMBAT.world.height - 100, centerY + yDirection * distance));
  }

  private async persistProgress(player: NetworkMapPlayer, completed: boolean): Promise<void> {
    const alreadyPersisted = this.persistedExperience.get(player.characterId) ?? 0;
    const experienceDelta = Math.max(0, player.experience - alreadyPersisted);
    const shouldComplete = completed && !this.completionPersisted.has(player.characterId);
    if (experienceDelta === 0 && !shouldComplete) return;
    const saved = await this.profileWrites.run(player.characterId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await this.services.players.loadProfile(player.characterId);
        if (!current) return null;
        const progressed = grantCharacterExperience(current.profile, experienceDelta).profile;
        const next = shouldComplete ? {
          ...progressed,
          character: {
            ...progressed.character,
            mapsCompleted: progressed.character.mapsCompleted + 1,
            highestWave: Math.max(progressed.character.highestWave, this.state.wave),
          },
        } : progressed;
        try {
          return await this.services.players.saveProfile(player.characterId, current.revision, next);
        } catch (error) {
          if (!(error instanceof ProfileRevisionConflict)) throw error;
        }
      }
      return null;
    });
    if (!saved) return;
    this.persistedExperience.set(player.characterId, player.experience);
    player.persistedExperience = player.experience;
    if (shouldComplete) this.completionPersisted.add(player.characterId);
    this.activeClients.get(player.characterId)?.send(SERVER_MESSAGES.profileUpdated, saved);
  }

  private authoritativeItem(drop: GeneratedDrop): InventoryItem {
    if (drop.kind === "equipment") return { ...drop.item, id: randomUUID() };
    if (drop.kind === "currency") return { ...createCurrencyStack(drop.currency, drop.amount), id: randomUUID() };
    if (drop.kind === "flask") return createFlaskStack(drop.flask, drop.amount, randomUUID());
    return { ...drop.item, id: randomUUID() };
  }

  private scheduleEmptyRoomExpiry(delayMilliseconds: number): void {
    if (this.emptyRoomExpiry) clearTimeout(this.emptyRoomExpiry);
    this.emptyRoomExpiry = setTimeout(() => {
      this.emptyRoomExpiry = null;
      if (this.activeClients.size === 0) this.runAsyncTask("idle_dispose", () => this.disconnect());
    }, delayMilliseconds);
    this.emptyRoomExpiry.unref();
  }

  private playerSpawn(index: number): { x: number; y: number } {
    const angle = index / MULTIPLAYER_LIMITS.playersPerRoom * Math.PI * 2;
    return {
      x: MULTIPLAYER_COMBAT.world.width / 2 + Math.cos(angle) * 85,
      y: MULTIPLAYER_COMBAT.world.height / 2 + Math.sin(angle) * 85,
    };
  }

  private runAsyncCommand(client: Client, command: string, operation: () => Promise<unknown>): void {
    this.runAsyncTask(command, operation, command, client);
  }

  private runAsyncTask(label: string, operation: () => Promise<unknown>, command?: string, client?: Client): void {
    void operation().catch((error) => {
      console.error(`[map-room:${this.roomId}] ${label} failed\n${formatError(error)}`);
      if (command) {
        if (client) this.reject(client, command, error instanceof ItemLockedError ? "item_locked" : "server_error");
        else for (const activeClient of this.activeClients.values()) this.reject(activeClient, command, "server_error");
      }
    });
  }

  private reject(client: Client, command: string, reason: RejectedCommandMessage["reason"]): void {
    client.send(SERVER_MESSAGES.rejected, { command, reason } satisfies RejectedCommandMessage);
  }

  private rejectPickup(client: Client, dropId: string, reason: RejectedCommandMessage["reason"]): void {
    this.reject(client, CLIENT_MESSAGES.pickup, reason);
    client.send(SERVER_MESSAGES.pickupResult, { dropId, status: "rejected", reason } satisfies PickupResultMessage);
  }
}

function normalizedDirection(direction: { x: number; y: number } | undefined): { x: number; y: number } | null {
  if (!direction) return null;
  const length = Math.hypot(direction.x, direction.y);
  return length < 0.1 ? null : { x: direction.x / length, y: direction.y / length };
}

function damageTypeCode(type: DamageType): DamageTypeCode {
  return type === "fire" ? DamageTypeCode.Fire
    : type === "cold" ? DamageTypeCode.Cold
      : type === "lightning" ? DamageTypeCode.Lightning : DamageTypeCode.Physical;
}
