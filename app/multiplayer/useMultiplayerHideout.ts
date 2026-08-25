"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import type { CharacterClassId, InventoryItem } from "../game/domain";
import type { MultiplayerWorldAdapter, NetworkMapView, NetworkPlayerView } from "../game2d/types";
import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  type CombatEvent,
  type LatencyProbeMessage,
  type MapExitReadyMessage,
  type PartySnapshotMessage,
  type PickupResultMessage,
  type ProfileCommand,
  type PublicPartiesMessage,
  type RejectedCommandMessage,
  type TradeSnapshotsMessage,
} from "../../multiplayer/protocol";
import type { PartySnapshot, PublicPartyListing } from "../../server/coordination/PartyCoordinator";
import type { HideoutState } from "../../server/state/HideoutState";
import type { MapRoomState } from "../../server/state/MapState";
import type { AuthoritativeProfile, CharacterRosterEntry } from "../../server/persistence/PlayerRepository";
import type { TradeSnapshot } from "../../server/persistence/TradeRepository";
import { MultiplayerClient, MultiplayerRequestError, ProtocolMismatchError, type AccountSession, type MultiplayerSession } from "./MultiplayerClient";
import { schemaValues } from "./schemaValues";
import { MonsterInterpolationBuffer } from "../game2d/MonsterInterpolationBuffer";
import { decodeWorldEvents, WorldEventType } from "../../multiplayer/wire/events";
import { skillIdFromCode as skillFromCode } from "../../multiplayer/protocol";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "../game/config/monsters";

export interface MultiplayerHideoutController {
  account: AccountSession | null;
  characters: CharacterRosterEntry[];
  session: MultiplayerSession | null;
  party: PartySnapshot | null;
  publicParties: PublicPartyListing[];
  adapter: MultiplayerWorldAdapter | undefined;
  connectedPlayers: NetworkPlayerView[];
  authoritativeProfile: AuthoritativeProfile | null;
  mapAdapter: MultiplayerWorldAdapter | undefined;
  activeMap: PartySnapshot["activeMap"];
  trades: TradeSnapshot[];
  activeTradeId: string | null;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  connectAccount: (handle: string, password: string, mode: "login" | "register") => Promise<void>;
  createCharacter: (characterName: string, classId: CharacterClassId) => Promise<void>;
  selectCharacter: (characterId: string) => Promise<void>;
  leaveCharacter: () => Promise<void>;
  leaveAccount: () => Promise<void>;
  createParty: () => Promise<boolean>;
  joinParty: (partyId: string) => Promise<boolean>;
  refreshParties: () => Promise<void>;
  enterHideout: () => Promise<void>;
  leaveParty: () => Promise<void>;
  openMap: () => Promise<void>;
  enterMap: (portalIndex: number) => Promise<void>;
  leaveMap: () => Promise<void>;
  executeProfileCommand: (command: ProfileCommand) => Promise<void>;
  startTrade: (targetCharacterId: string) => Promise<void>;
  selectTrade: (tradeId: string) => void;
  updateTradeOffer: (tradeId: string, itemIds: string[]) => Promise<void>;
  acceptTrade: (tradeId: string) => Promise<void>;
  cancelTrade: (tradeId: string) => Promise<void>;
  dropItem: (itemId: string) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof ProtocolMismatchError) return error.message;
  if (error instanceof MultiplayerRequestError) {
    if (error.status === 409 && error.code === "character_name_taken") return "That character name is already taken. Try another name.";
    if (error.status === 409 && error.code === "class_unavailable") return "That class is not playable yet. Sorceress is currently the only enabled class.";
    if (error.status === 409 && error.code === "party_full") return "That party already has four players.";
    if (error.status === 404 && error.code === "party_not_found") return "That party is no longer available.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The game server could not be reached.";
}

function samePresence(left: readonly NetworkPlayerView[], right: readonly NetworkPlayerView[]): boolean {
  return left.length === right.length && left.every((player, index) => {
    const candidate = right[index];
    return candidate?.characterId === player.characterId
      && candidate.name === player.name
      && candidate.classId === player.classId
      && candidate.connected === player.connected;
  });
}

export function useMultiplayerHideout(): MultiplayerHideoutController {
  const client = useMemo(() => new MultiplayerClient(), []);
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [party, setParty] = useState<PartySnapshot | null>(null);
  const [publicParties, setPublicParties] = useState<PublicPartyListing[]>([]);
  const [room, setRoom] = useState<Room<unknown, HideoutState> | null>(null);
  const [mapRoom, setMapRoom] = useState<Room<unknown, MapRoomState> | null>(null);
  const mapRoomRef = useRef<Room<unknown, MapRoomState> | null>(null);
  const intentionalMapClosures = useRef(new WeakSet<Room<unknown, MapRoomState>>());
  const [authoritativeProfile, setAuthoritativeProfile] = useState<AuthoritativeProfile | null>(null);
  const [trades, setTrades] = useState<TradeSnapshot[]>([]);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const roomRef = useRef<Room<unknown, HideoutState> | null>(null);
  const sequence = useRef(0);
  const attackSequence = useRef(0);
  const latencyMilliseconds = useRef<number | null>(null);
  const combatEventQueue = useRef<CombatEvent[]>([]);
  const pickupResultQueue = useRef<PickupResultMessage[]>([]);
  const profileRevision = useRef(0);
  const monsterBuffer = useRef(new MonsterInterpolationBuffer());
  const dropPayloads = useRef(new Map<string, InventoryItem>());
  const dropPayloadRevision = useRef(0);
  const hideoutPlayerViews = useRef<{ room: Room<unknown, HideoutState> | null; tick: number; value: readonly NetworkPlayerView[] }>({ room: null, tick: -1, value: [] });
  const mapPlayerViews = useRef<{ room: Room<unknown, MapRoomState> | null; tick: number; value: readonly NetworkPlayerView[] }>({ room: null, tick: -1, value: [] });
  const mapView = useRef<{ room: Room<unknown, MapRoomState> | null; tick: number; payloadRevision: number; value: NetworkMapView | null }>({ room: null, tick: -1, payloadRevision: -1, value: null });
  const mapExitRequests = useRef(new Map<string, {
    resolve: (profile: AuthoritativeProfile) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>());
  const [connectedPlayers, setConnectedPlayers] = useState<NetworkPlayerView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    profileRevision.current = authoritativeProfile?.revision ?? 0;
  }, [authoritativeProfile]);

  useEffect(() => {
    roomRef.current = room;
    if (!room) return;
    let timer: number | null = null;
    let lastAppliedAt = 0;
    const sync = () => {
      lastAppliedAt = performance.now();
      const next = schemaValues(room.state?.players).map((player) => ({
        characterId: player.characterId,
        name: player.name,
        classId: player.classId as CharacterClassId,
        x: player.x,
        y: player.y,
        facingX: player.facingX,
        facingY: player.facingY,
        connected: player.connected,
        serverTick: room.state.serverTick,
        lastProcessedMovement: player.lastProcessedSequence,
      }));
      setConnectedPlayers((current) => samePresence(current, next) ? current : next);
    };
    const scheduleSync = () => {
      const remaining = 500 - (performance.now() - lastAppliedAt);
      if (remaining <= 0) {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        sync();
      } else if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          sync();
        }, remaining);
      }
    };
    room.onStateChange(scheduleSync);
    sync();
    return () => {
      room.onStateChange.remove(scheduleSync);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [room]);

  useEffect(() => {
    mapRoomRef.current = mapRoom;
    if (!mapRoom) return;
    // Phaser reads the mutable Colyseus state directly. Snapshot packets update
    // its interpolation buffer without forcing a React render.
    return undefined;
  }, [mapRoom]);

  useEffect(() => {
    const activeRoom = mapRoom ?? room;
    latencyMilliseconds.current = null;
    if (!activeRoom) return;

    let probeSequence = 0;
    const pending = new Map<number, number>();
    const removeListener = activeRoom.onMessage(SERVER_MESSAGES.latencyProbeResponse, (message: LatencyProbeMessage) => {
      const sentAt = pending.get(message.sequence);
      if (sentAt === undefined) return;
      pending.delete(message.sequence);
      const sample = Math.max(0, performance.now() - sentAt);
      latencyMilliseconds.current = latencyMilliseconds.current === null
        ? sample
        : latencyMilliseconds.current * 0.7 + sample * 0.3;
    });
    const sendProbe = () => {
      probeSequence += 1;
      pending.set(probeSequence, performance.now());
      for (const [sequenceId, sentAt] of pending) {
        if (performance.now() - sentAt > 5_000) pending.delete(sequenceId);
      }
      activeRoom.send(CLIENT_MESSAGES.latencyProbe, { sequence: probeSequence });
    };
    sendProbe();
    const interval = window.setInterval(sendProbe, 1_000);
    return () => {
      window.clearInterval(interval);
      removeListener();
      pending.clear();
    };
  }, [mapRoom, room]);

  const refreshParties = useCallback(async () => {
    if (!session || party?.visibility === "public") return;
    try {
      setPublicParties(await client.listParties(session));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [client, party, session]);

  useEffect(() => () => {
    for (const pending of mapExitRequests.current.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Map connection closed before the server confirmed your saved progress."));
    }
    mapExitRequests.current.clear();
    void roomRef.current?.leave(true);
    if (mapRoomRef.current) intentionalMapClosures.current.add(mapRoomRef.current);
    void mapRoomRef.current?.leave(true);
  }, []);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const connectToPartyHideout = useCallback(async (selectedSession: MultiplayerSession, selectedParty: PartySnapshot) => {
    await roomRef.current?.leave(true);
    sequence.current = 0;
    const connected = await client.connectHideout(selectedSession, selectedParty.id);
    connected.onMessage(SERVER_MESSAGES.partySnapshot, (message: PartySnapshotMessage) => {
      setParty(message.party);
    });
    connected.onMessage(SERVER_MESSAGES.tradeSnapshots, (message: TradeSnapshotsMessage) => {
      setTrades(message.trades);
      setActiveTradeId((current) => current && message.trades.some((trade) => trade.id === current)
        ? current
        : message.trades[0]?.id ?? null);
    });
    connected.onMessage(SERVER_MESSAGES.publicParties, (message: PublicPartiesMessage) => {
      setPublicParties(message.parties);
    });
    connected.onLeave(() => {
      if (roomRef.current === connected) {
        roomRef.current = null;
        setConnectedPlayers([]);
        setRoom(null);
      }
    });
    roomRef.current = connected;
    setRoom(connected);
  }, [client]);

  const connectAccount = useCallback((handle: string, password: string, mode: "login" | "register") => run(async () => {
    const connected = await client.createAccountSession(handle, password, mode);
    setAccount(connected);
    setAuthoritativeProfile(null);
    setSession(null);
    setParty(null);
  }), [client, run]);

  const activateCharacter = useCallback(async (selected: MultiplayerSession) => {
    const loaded = await client.loadProfile(selected);
    let existingParty: PartySnapshot | null = null;
    try {
      existingParty = await client.currentParty(selected);
    } catch (caught) {
      if (!(caught instanceof MultiplayerRequestError) || caught.status !== 404) throw caught;
    }
    existingParty ??= await client.createSoloParty(selected);
    await connectToPartyHideout(selected, existingParty);
    setAuthoritativeProfile(loaded);
    setSession(selected);
    setParty(existingParty);
    setPublicParties([]);
  }, [client, connectToPartyHideout]);

  const createCharacter = useCallback((characterName: string, classId: CharacterClassId) => run(async () => {
    if (!account) throw new Error("Enter your account first.");
    const created = await client.createCharacter(account, { characterName, classId });
    setAccount({ ...account, characters: created.characters });
    await activateCharacter(created.session);
  }), [account, activateCharacter, client, run]);

  const selectCharacter = useCallback((characterId: string) => run(async () => {
    if (!account) throw new Error("Enter your account first.");
    await activateCharacter(await client.selectCharacter(account, characterId));
  }), [account, activateCharacter, client, run]);

  const leaveCharacter = useCallback(() => run(async () => {
    await roomRef.current?.leave(true);
    roomRef.current = null;
    if (mapRoomRef.current) intentionalMapClosures.current.add(mapRoomRef.current);
    await mapRoomRef.current?.leave(true);
    mapRoomRef.current = null;
    if (session && party) await client.leaveParty(session).catch(() => null);
    setConnectedPlayers([]);
    setRoom(null);
    setMapRoom(null);
    setParty(null);
    setPublicParties([]);
    setTrades([]);
    setActiveTradeId(null);
    setAuthoritativeProfile(null);
    setSession(null);
  }), [client, party, run, session]);

  const leaveAccount = useCallback(() => run(async () => {
    await roomRef.current?.leave(true);
    roomRef.current = null;
    if (mapRoomRef.current) intentionalMapClosures.current.add(mapRoomRef.current);
    await mapRoomRef.current?.leave(true);
    mapRoomRef.current = null;
    if (session && party) await client.leaveParty(session).catch(() => null);
    if (account) await client.logoutAccount(account).catch(() => undefined);
    setConnectedPlayers([]);
    setRoom(null);
    setMapRoom(null);
    setParty(null);
    setPublicParties([]);
    setTrades([]);
    setActiveTradeId(null);
    setAuthoritativeProfile(null);
    setSession(null);
    setAccount(null);
  }), [account, client, party, run, session]);

  const createParty = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      if (!session) throw new Error("Connect your character first.");
      const created = await client.createParty(session);
      setParty(created);
      await connectToPartyHideout(session, created);
      setPublicParties([]);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [client, connectToPartyHideout, session]);

  const joinParty = useCallback(async (partyIdToJoin: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      if (!session) throw new Error("Connect your character first.");
      const joined = await client.joinParty(session, partyIdToJoin);
      setParty(joined);
      await connectToPartyHideout(session, joined);
      setPublicParties([]);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      await refreshParties();
      return false;
    } finally {
      setBusy(false);
    }
  }, [client, connectToPartyHideout, refreshParties, session]);

  const enterHideout = useCallback(() => run(async () => {
    if (!session || !party) throw new Error("No online hideout is available.");
    await connectToPartyHideout(session, party);
  }), [connectToPartyHideout, party, run, session]);

  const leaveParty = useCallback(() => run(async () => {
    if (!session) return;
    await roomRef.current?.leave(true);
    roomRef.current = null;
    setConnectedPlayers([]);
    setRoom(null);
    if (mapRoomRef.current) intentionalMapClosures.current.add(mapRoomRef.current);
    await mapRoomRef.current?.leave(true);
    mapRoomRef.current = null;
    setMapRoom(null);
    await client.leaveParty(session);
    const solo = await client.createSoloParty(session);
    setParty(solo);
    await connectToPartyHideout(session, solo);
  }), [client, connectToPartyHideout, run, session]);

  const openMap = useCallback(() => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    const isLeader = !party || party.leaderCharacterId === session.player.characterId;
    if (!isLeader) throw new Error("Only the party leader can open a map.");
    const loaded = authoritativeProfile ?? await client.loadProfile(session);
    if (!loaded.profile.mapDevice) throw new Error("Drag a map into the map device first.");
    const opened = await client.openMap(session, loaded.revision);
    setAuthoritativeProfile(opened.authoritativeProfile);
    setParty(await client.currentParty(session));
  }), [authoritativeProfile, client, party, run, session]);

  const enterMap = useCallback((portalIndex: number) => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    const activeMap = party?.activeMap;
    if (!activeMap) throw new Error("Open a map at the map device first.");
    const portal = activeMap.portals.find((candidate) => candidate.index === portalIndex);
    if (!portal || portal.used) throw new Error("That portal has already been used.");
    const connected = await client.connectMap(session, activeMap.mapTicket, portalIndex, activeMap.roomId ?? undefined);
    const activateMapRoom = (activeConnection: Room<unknown, MapRoomState>): void => {
      activeConnection.onLeave((code) => {
      if (mapRoomRef.current !== activeConnection) return;
      const intentional = intentionalMapClosures.current.has(activeConnection);
      for (const pending of mapExitRequests.current.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Map connection closed before the server confirmed your saved progress."));
      }
      mapExitRequests.current.clear();
      if (intentional) return;

      console.warn(`[multiplayer] Map connection closed unexpectedly (code ${code}). Attempting session recovery.`);
      const reconnectionToken = activeConnection.reconnectionToken;
      void client.reconnectMap(reconnectionToken)
        .then((reconnected) => {
          if (mapRoomRef.current !== activeConnection) {
            intentionalMapClosures.current.add(reconnected);
            return reconnected.leave(true);
          }
          combatEventQueue.current = [];
          pickupResultQueue.current = [];
          monsterBuffer.current = new MonsterInterpolationBuffer();
          dropPayloads.current.clear();
          dropPayloadRevision.current += 1;
          activateMapRoom(reconnected);
          setError(null);
        })
        .catch((reconnectError) => {
          if (mapRoomRef.current !== activeConnection) return;
          combatEventQueue.current = [];
          pickupResultQueue.current = [];
          monsterBuffer.current = new MonsterInterpolationBuffer();
          dropPayloads.current.clear();
          dropPayloadRevision.current += 1;
          mapRoomRef.current = null;
          setMapRoom(null);
          setError(reconnectError instanceof ProtocolMismatchError
            ? reconnectError.message
            : "The map connection could not be recovered. Your progress was saved and you were returned to your hideout.");
          return client.currentParty(session)
            .catch(() => null)
            .then(async (currentParty) => {
              const destination = currentParty ?? await client.createSoloParty(session);
              setParty(destination);
              await connectToPartyHideout(session, destination);
            });
        })
        .catch((caught) => setError(errorMessage(caught)));
      });
    activeConnection.onMessage(SERVER_MESSAGES.profileUpdated, (updated: AuthoritativeProfile) => setAuthoritativeProfile(updated));
    activeConnection.onMessage(SERVER_MESSAGES.mapExitReady, (message: MapExitReadyMessage) => {
      const pending = mapExitRequests.current.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      mapExitRequests.current.delete(message.requestId);
      pending.resolve(message.authoritativeProfile);
    });
    activeConnection.onMessage(SERVER_MESSAGES.pickupResult, (message: PickupResultMessage) => {
      pickupResultQueue.current.push(message);
      if (message.status !== "rejected" || message.reason === "unauthorized") return;
      const description = message.reason === "inventory_full"
        ? "Your backpack is full. The item remains on the ground."
        : message.reason === "item_locked"
          ? "A trade-locked item prevented pickup. The item remains on the ground."
          : "Pickup was not confirmed. The item remains on the ground.";
      setError(description);
    });
    activeConnection.onMessage(SERVER_MESSAGES.rejected, (message: RejectedCommandMessage) => {
      if (message.command !== CLIENT_MESSAGES.prepareMapExit) return;
      const error = new Error("The server could not finish saving your map progress. Please try returning again.");
      for (const [requestId, pending] of mapExitRequests.current) {
        clearTimeout(pending.timeout);
        mapExitRequests.current.delete(requestId);
        pending.reject(error);
      }
    });
    activeConnection.onMessage(SERVER_MESSAGES.monsterLifecycle, (payload: Uint8Array | ArrayBuffer) => {
      monsterBuffer.current.applyLifecycle(asBytes(payload));
    });
    activeConnection.onMessage(SERVER_MESSAGES.monsterSnapshot, (payload: Uint8Array | ArrayBuffer) => {
      monsterBuffer.current.applySnapshot(asBytes(payload), performance.now());
    });
    activeConnection.onMessage(SERVER_MESSAGES.worldEvents, (payload: Uint8Array | ArrayBuffer) => {
      const events = decodeWorldEvents(asBytes(payload));
      const players = schemaValues(activeConnection.state?.players);
      for (const event of events) {
        const actor = players.find((player) => player.worldIndex === playerIndexFromEntity(event.actorId));
        const target = players.find((player) => player.worldIndex === playerIndexFromEntity(event.targetId));
        if (event.type === WorldEventType.Skill && actor) {
          const direction = directionFromCode(event.auxB);
          combatEventQueue.current.push({
            kind: "skill",
            actorCharacterId: actor.characterId,
            sequence: event.sequence,
            skill: skillFromCode(event.auxA),
            direction,
          });
        } else if (event.type === WorldEventType.Damage && actor) {
          combatEventQueue.current.push({
            kind: "damage",
            actorCharacterId: actor.characterId,
            sequence: event.sequence,
            skill: skillFromCode(event.auxB),
            targetId: event.targetId,
            targetX: event.x,
            targetY: event.y,
            amount: event.amount,
            damageType: damageTypeFromCode(event.auxA),
            evaded: false,
          });
        } else if (event.type === WorldEventType.MonsterDespawn) {
          monsterBuffer.current.remove(event.actorId);
        } else if (event.type === WorldEventType.Kill) {
          combatEventQueue.current.push({
            kind: "monster-death",
            monsterId: event.targetId,
            archetypeId: monsterArchetypeFromCode(event.auxA),
            rarity: event.auxB === 2 ? "rare" : event.auxB === 1 ? "magic" : "normal",
            x: event.x,
            y: event.y,
          });
          monsterBuffer.current.remove(event.targetId);
        } else if (event.type === WorldEventType.MonsterAction && target) {
          const rangedMonster = monsterBuffer.current.staticRecord(event.actorId);
          const rangedDefinition = rangedMonster ? MONSTER_ARCHETYPES[monsterArchetypeFromCode(rangedMonster.archetype)].ranged : undefined;
          const projectileRange = rangedDefinition?.projectileRange ?? 560;
          const projectileDirection = directionFromCode(event.auxB);
          const rangedDuration = Math.max(320, projectileRange / Math.max(1, event.amount) * 1_000);
          combatEventQueue.current.push({
            kind: "monster-action",
            monsterId: event.actorId,
            targetCharacterId: target.characterId,
            action: event.auxA === 1 ? "ranged" : event.auxA === 2 ? "jump" : "melee",
            fromX: event.x,
            fromY: event.y,
            toX: event.auxA === 1 ? event.x + projectileDirection.x * projectileRange : target.x,
            toY: event.auxA === 1 ? event.y + projectileDirection.y * projectileRange : target.y,
            durationMilliseconds: event.auxA === 2 ? 420 : event.auxA === 1 ? rangedDuration : 180,
            projectileId: event.auxA === 1 ? event.sequence : undefined,
            projectileRange: event.auxA === 1 ? projectileRange : undefined,
          });
        } else if (event.type === WorldEventType.MonsterAggro) {
          combatEventQueue.current.push({
            kind: "monster-aggro",
            monsterId: event.actorId,
            archetypeId: monsterArchetypeFromCode(event.auxA),
            x: event.x,
            y: event.y,
          });
        } else if (event.type === WorldEventType.ProjectileSpawn && actor) {
          combatEventQueue.current.push({
            kind: "projectile-spawn",
            projectileId: event.targetId,
            actorCharacterId: actor.characterId,
            sequence: event.sequence,
            skill: skillFromCode(event.auxB),
            originX: event.x,
            originY: event.y,
            direction: directionFromCode(event.auxA),
            speed: event.amount,
          });
        } else if (event.type === WorldEventType.ProjectileHit) {
          combatEventQueue.current.push({
            kind: "projectile-hit",
            projectileId: event.actorId,
            targetId: event.targetId,
            x: event.x,
            y: event.y,
          });
        } else if (event.type === WorldEventType.ProjectileExpire) {
          combatEventQueue.current.push({
            kind: "projectile-expire",
            projectileId: event.targetId,
            x: event.x,
            y: event.y,
          });
        } else if (event.type === WorldEventType.MonsterProjectileHit || event.type === WorldEventType.MonsterProjectileExpire) {
          combatEventQueue.current.push({
            kind: "monster-projectile-terminal",
            projectileId: event.sequence,
            x: event.x,
            y: event.y,
            hit: event.type === WorldEventType.MonsterProjectileHit,
          });
        }
      }
      if (combatEventQueue.current.length > 512) combatEventQueue.current.splice(0, combatEventQueue.current.length - 512);
    });
    activeConnection.onMessage(SERVER_MESSAGES.dropPayload, (payload: { dropId: string; item: InventoryItem }) => {
      dropPayloads.current.set(payload.dropId, payload.item);
      dropPayloadRevision.current += 1;
    });
      activeConnection.send(CLIENT_MESSAGES.requestWorldSync, {});
      mapRoomRef.current = activeConnection;
      setMapRoom(activeConnection);
    };
    activateMapRoom(connected);
    setParty(await client.currentParty(session));
    await roomRef.current?.leave(true);
    roomRef.current = null;
    setRoom(null);
  }), [client, connectToPartyHideout, party, run, session]);

  const leaveMap = useCallback(() => {
    if (mapExitRequests.current.size > 0) return Promise.resolve();
    return run(async () => {
      const activeRoom = mapRoomRef.current;
      let flushedProfile: AuthoritativeProfile | null = null;
      if (activeRoom) {
        const requestId = crypto.randomUUID();
        flushedProfile = await new Promise<AuthoritativeProfile>((resolve, reject) => {
          const timeout = setTimeout(() => {
            mapExitRequests.current.delete(requestId);
            reject(new Error("Saving the map exit timed out. Your character remains in the map; please try again."));
          }, 10_000);
          mapExitRequests.current.set(requestId, { resolve, reject, timeout });
          activeRoom.send(CLIENT_MESSAGES.prepareMapExit, { requestId });
        });
      }
      combatEventQueue.current = [];
      monsterBuffer.current = new MonsterInterpolationBuffer();
      dropPayloads.current.clear();
      dropPayloadRevision.current += 1;
      if (activeRoom) intentionalMapClosures.current.add(activeRoom);
      await activeRoom?.leave(true);
      mapRoomRef.current = null;
      setMapRoom(null);
      if (flushedProfile) setAuthoritativeProfile(flushedProfile);
      else if (session) setAuthoritativeProfile(await client.loadProfile(session));
      if (session) {
        const currentParty = await client.currentParty(session).catch(() => null) ?? await client.createSoloParty(session);
        setParty(currentParty);
        await connectToPartyHideout(session, currentParty);
      }
    });
  }, [client, connectToPartyHideout, run, session]);

  const executeProfileCommand = useCallback((command: ProfileCommand) => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    let current = authoritativeProfile ?? await client.loadProfile(session);
    try {
      current = await client.sendProfileCommand(session, current.revision, command);
    } catch (caught) {
      if (!(caught instanceof MultiplayerRequestError) || caught.status !== 409) throw caught;
      current = await client.loadProfile(session);
      current = await client.sendProfileCommand(session, current.revision, command);
    }
    setAuthoritativeProfile(current);
    mapRoomRef.current?.send(CLIENT_MESSAGES.refreshProfile, {});
  }), [authoritativeProfile, client, run, session]);

  const startTrade = useCallback((targetCharacterId: string) => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    const existing = trades.find((trade) => trade.participants.includes(targetCharacterId));
    const trade = existing ?? await client.createTrade(session, targetCharacterId);
    setTrades((current) => current.some((candidate) => candidate.id === trade.id) ? current : [trade, ...current]);
    setActiveTradeId(trade.id);
  }), [client, run, session, trades]);

  const updateTradeOffer = useCallback((tradeId: string, itemIds: string[]) => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    let trade = trades.find((candidate) => candidate.id === tradeId) ?? await client.getTrade(session, tradeId);
    try {
      trade = await client.setTradeOffer(session, tradeId, trade.revision, itemIds);
    } catch (caught) {
      if (!(caught instanceof MultiplayerRequestError) || caught.status !== 409) throw caught;
      trade = await client.getTrade(session, tradeId);
      trade = await client.setTradeOffer(session, tradeId, trade.revision, itemIds);
    }
    setTrades((current) => current.map((candidate) => candidate.id === tradeId ? trade : candidate));
  }), [client, run, session, trades]);

  const acceptTrade = useCallback((tradeId: string) => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    let trade = trades.find((candidate) => candidate.id === tradeId) ?? await client.getTrade(session, tradeId);
    try {
      trade = await client.acceptTrade(session, tradeId, trade.revision);
    } catch (caught) {
      if (!(caught instanceof MultiplayerRequestError) || caught.status !== 409) throw caught;
      trade = await client.getTrade(session, tradeId);
      trade = await client.acceptTrade(session, tradeId, trade.revision);
    }
    if (trade.state === "completed") {
      setTrades((current) => current.filter((candidate) => candidate.id !== tradeId));
      setActiveTradeId(null);
      setAuthoritativeProfile(await client.loadProfile(session));
    } else {
      setTrades((current) => current.map((candidate) => candidate.id === tradeId ? trade : candidate));
    }
  }), [client, run, session, trades]);

  const cancelTrade = useCallback((tradeId: string) => run(async () => {
    if (!session) throw new Error("Connect your character first.");
    await client.cancelTrade(session, tradeId);
    setTrades((current) => current.filter((candidate) => candidate.id !== tradeId));
    setActiveTradeId(null);
  }), [client, run, session]);

  const adapter = useMemo<MultiplayerWorldAdapter | undefined>(() => session && room ? {
    localCharacterId: session.player.characterId,
    getPing: () => latencyMilliseconds.current === null ? null : Math.round(latencyMilliseconds.current),
    getPlayers: () => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return [];
      const tick = activeRoom.state.serverTick;
      const cached = hideoutPlayerViews.current;
      if (cached.room === activeRoom && cached.tick === tick) return cached.value;
      const value = schemaValues(activeRoom.state?.players).map((player) => ({
        characterId: player.characterId,
        name: player.name,
        classId: player.classId as CharacterClassId,
        x: player.x,
        y: player.y,
        facingX: player.facingX,
        facingY: player.facingY,
        connected: player.connected,
        serverTick: activeRoom.state.serverTick,
        lastProcessedMovement: player.lastProcessedSequence,
      }));
      hideoutPlayerViews.current = { room: activeRoom, tick, value };
      return value;
    },
    sendMovement: (x, y) => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return undefined;
      sequence.current += 1;
      activeRoom.send(CLIENT_MESSAGES.movement, { sequence: sequence.current, x, y });
      return sequence.current;
    },
  } : undefined, [room, session]);

  const mapAdapter = useMemo<MultiplayerWorldAdapter | undefined>(() => session && mapRoom ? {
    localCharacterId: session.player.characterId,
    getPing: () => latencyMilliseconds.current === null ? null : Math.round(latencyMilliseconds.current),
    getPlayers: () => {
      const activeRoom = mapRoomRef.current;
      if (!activeRoom) return [];
      const tick = activeRoom.state.serverTick;
      const cached = mapPlayerViews.current;
      if (cached.room === activeRoom && cached.tick === tick) return cached.value;
      const value = schemaValues(activeRoom.state?.players).map((player) => ({
        characterId: player.characterId,
        name: player.name,
        classId: player.classId as CharacterClassId,
        x: player.x,
        y: player.y,
        facingX: player.facingX,
        facingY: player.facingY,
        connected: player.connected,
        serverTick: activeRoom.state.serverTick,
        life: player.life,
        maxLife: player.maxLife,
        focus: player.focus,
        maxFocus: player.maxFocus,
        attackSpeed: player.attackSpeed,
        castSpeed: player.castSpeed,
        lastProcessedMovement: player.lastProcessedMovement,
        lastProcessedAttack: player.lastProcessedAttack,
        experience: player.experience,
        persistedExperience: player.persistedExperience,
      }));
      mapPlayerViews.current = { room: activeRoom, tick, value };
      return value;
    },
    getMap: () => {
      const activeRoom = mapRoomRef.current;
      const state = activeRoom?.state;
      if (!state?.drops) return null;
      const tick = state.serverTick;
      const payloadRevision = dropPayloadRevision.current;
      const cached = mapView.current;
      if (cached.room === activeRoom && cached.tick === tick && cached.payloadRevision === payloadRevision) return cached.value;
      const value: NetworkMapView = {
        wave: state.wave,
        totalWaves: state.totalWaves,
        monstersAlive: state.monstersAlive,
        completed: state.completed,
        completionX: state.completionX,
        completionY: state.completionY,
        waveElapsedMilliseconds: state.waveElapsedMilliseconds,
        finalRageActive: state.finalRageActive,
        drops: schemaValues(state.drops).flatMap((drop) => {
          const item = dropPayloads.current.get(drop.id);
          return item ? [{
              id: drop.id,
              x: drop.x,
              y: drop.y,
              item,
              source: drop.source === "completion" ? "completion" as const : drop.source === "player" ? "player" as const : "monster" as const,
            }] : [];
        }),
      };
      mapView.current = { room: activeRoom, tick, payloadRevision, value };
      return value;
    },
    getMonsterSampler: () => monsterBuffer.current,
    drainCombatEvents: () => combatEventQueue.current.splice(0),
    drainPickupResults: () => pickupResultQueue.current.splice(0),
    getProfileRevision: () => profileRevision.current,
    sendMovement: (x, y) => {
      const activeRoom = mapRoomRef.current;
      if (!activeRoom) return undefined;
      sequence.current += 1;
      activeRoom.send(CLIENT_MESSAGES.movement, { sequence: sequence.current, x, y });
      return sequence.current;
    },
    sendAttack: (skill, direction) => {
      const activeRoom = mapRoomRef.current;
      if (!activeRoom) return undefined;
      attackSequence.current += 1;
      activeRoom.send(CLIENT_MESSAGES.attack, { sequence: attackSequence.current, skill, ...(direction ? { direction } : {}) });
      return attackSequence.current;
    },
    sendPickup: (dropId) => mapRoomRef.current?.send(CLIENT_MESSAGES.pickup, { dropId }),
    sendUseFlask: (slot) => mapRoomRef.current?.send(CLIENT_MESSAGES.useFlask, { slot }),
    sendDropItem: (itemId) => mapRoomRef.current?.send(CLIENT_MESSAGES.dropItem, { itemId }),
  } : undefined, [mapRoom, session]);

  return {
    account, characters: account?.characters ?? [], session, party, publicParties, adapter, mapAdapter, activeMap: party?.activeMap ?? null, connectedPlayers,
    trades, activeTradeId,
    authoritativeProfile, busy, error, clearError: () => setError(null), connectAccount, createCharacter, selectCharacter, leaveCharacter, leaveAccount, createParty, joinParty, refreshParties, enterHideout,
    leaveParty, openMap, enterMap, leaveMap, executeProfileCommand, startTrade,
    selectTrade: setActiveTradeId, updateTradeOffer, acceptTrade, cancelTrade,
    dropItem: (itemId) => mapRoomRef.current?.send(CLIENT_MESSAGES.dropItem, { itemId }),
  };
}

function asBytes(payload: Uint8Array | ArrayBuffer): Uint8Array {
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
}

function playerIndexFromEntity(entityId: number): number {
  return (entityId & 0x8000_0000) !== 0 ? entityId & 0x7fff_ffff : -1;
}

function directionFromCode(code: number): { x: number; y: number } {
  const angle = code / 65_535 * Math.PI * 2 - Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function damageTypeFromCode(code: number): "physical" | "fire" | "cold" | "lightning" {
  return (["physical", "fire", "cold", "lightning"] as const)[code] ?? "physical";
}

function monsterArchetypeFromCode(code: number): MonsterArchetypeId {
  return (["ashling", "cinder-spitter", "rift-stalker", "ironhide-brute", "ember-skitter"] as const)[code] ?? "ashling";
}
