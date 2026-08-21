import { randomUUID } from "node:crypto";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";
import { ProfileRevisionConflict } from "../persistence/errors";
import type { PlayerRepository } from "../persistence/PlayerRepository";
import { ExpeditionError, type ExpeditionCoordinator, type OpenExpeditionInput, type OpenedExpedition } from "./ExpeditionCoordinator";
import { PartyError, type PartyCoordinator, type PartySnapshot } from "./PartyCoordinator";

interface ConnectionLease {
  partyId: string;
  characterId: string;
  expiresAt: number;
}

/** Fast test double. Runtime authority uses PostgresCoordination. */
export class InMemoryCoordination implements PartyCoordinator, ExpeditionCoordinator {
  private readonly parties = new Map<string, PartySnapshot>();
  private readonly partyByMember = new Map<string, string>();
  private readonly connections = new Map<string, ConnectionLease>();
  private readonly roomClaims = new Map<string, { roomId: string; expiresAt: number }>();

  constructor(
    private readonly players: PlayerRepository,
    private readonly presenceGraceMilliseconds: number = MULTIPLAYER_LIMITS.partyPresenceGraceMilliseconds,
    private readonly now: () => number = Date.now,
  ) {}

  async create(leaderCharacterId: string): Promise<PartySnapshot> {
    this.prune();
    const existing = this.mutableForMember(leaderCharacterId);
    if (existing) {
      if (existing.visibility === "solo") {
        existing.visibility = "public";
        existing.revision += 1;
      }
      return this.copy(existing);
    }
    return this.createFor(leaderCharacterId, "public");
  }

  async createSolo(leaderCharacterId: string): Promise<PartySnapshot> {
    this.prune();
    const existing = this.mutableForMember(leaderCharacterId);
    return existing ? this.copy(existing) : this.createFor(leaderCharacterId, "solo");
  }

  async join(characterId: string, partyId: string): Promise<PartySnapshot> {
    this.prune();
    const party = this.parties.get(partyId);
    if (!party || party.visibility !== "public") throw new PartyError("not_found");
    if (party.memberCharacterIds.length >= MULTIPLAYER_LIMITS.playersPerRoom) throw new PartyError("party_full");
    const existing = this.mutableForMember(characterId);
    if (existing?.visibility === "solo" && !existing.activeMap) await this.leave(characterId);
    else if (existing) throw new PartyError("already_in_party");
    party.memberCharacterIds.push(characterId);
    party.revision += 1;
    this.partyByMember.set(characterId, party.id);
    this.addPendingLease(party.id, characterId);
    return this.copy(party);
  }

  async leave(characterId: string): Promise<PartySnapshot | null> {
    const party = this.mutableForMember(characterId);
    if (!party) return null;
    party.memberCharacterIds = party.memberCharacterIds.filter((id) => id !== characterId);
    this.partyByMember.delete(characterId);
    for (const [id, lease] of this.connections) if (lease.characterId === characterId) this.connections.delete(id);
    party.revision += 1;
    if (party.memberCharacterIds.length === 0) {
      this.parties.delete(party.id);
      return null;
    }
    if (party.leaderCharacterId === characterId) party.leaderCharacterId = party.memberCharacterIds[0];
    return this.copy(party);
  }

  async getForMember(characterId: string): Promise<PartySnapshot | null> {
    this.prune();
    const party = this.mutableForMember(characterId);
    return party ? this.copy(party) : null;
  }

  async get(partyId: string): Promise<PartySnapshot | null> {
    this.prune();
    const party = this.parties.get(partyId);
    return party ? this.copy(party) : null;
  }

  async listPublic(): Promise<PartySnapshot[]> {
    this.prune();
    return [...this.parties.values()].filter((party) => party.visibility === "public").map((party) => this.copy(party));
  }

  async isMember(partyId: string, characterId: string): Promise<boolean> {
    this.prune();
    return this.parties.get(partyId)?.memberCharacterIds.includes(characterId) ?? false;
  }

  async connect(partyId: string, characterId: string, connectionId: string): Promise<void> {
    if (this.partyByMember.get(characterId) !== partyId) return;
    this.connections.set(connectionId, { partyId, characterId, expiresAt: this.now() + this.presenceGraceMilliseconds });
  }

  async renewConnection(partyId: string, characterId: string, connectionId: string): Promise<void> {
    await this.connect(partyId, characterId, connectionId);
  }

  async disconnect(partyId: string, characterId: string, connectionId: string): Promise<void> {
    const lease = this.connections.get(connectionId);
    if (!lease || lease.partyId !== partyId || lease.characterId !== characterId) return;
    lease.expiresAt = this.now() + this.presenceGraceMilliseconds;
  }

  async open(input: OpenExpeditionInput): Promise<OpenedExpedition> {
    const party = this.mutableForMember(input.leaderCharacterId);
    if (!party || party.id !== input.partyId) throw new ExpeditionError("not_found");
    if (party.leaderCharacterId !== input.leaderCharacterId) throw new ExpeditionError("not_leader");
    if (party.revision !== input.partyRevision) throw new ExpeditionError("party_revision_conflict");
    const current = await this.players.loadProfile(input.leaderCharacterId);
    if (!current) throw new ExpeditionError("not_found");
    if (current.revision !== input.expectedProfileRevision) throw new ExpeditionError("profile_revision_conflict");
    if (current.profile.mapDevice?.id !== input.map.id) throw new ExpeditionError("no_map");
    let authoritativeProfile;
    try {
      authoritativeProfile = await this.players.saveProfile(input.leaderCharacterId, input.expectedProfileRevision, {
        ...current.profile,
        mapDevice: null,
      });
    } catch (error) {
      if (error instanceof ProfileRevisionConflict) throw new ExpeditionError("profile_revision_conflict");
      throw error;
    }
    party.activeMap = {
      ticketId: input.ticketClaims.ticketId,
      mapTicket: input.mapTicket,
      map: structuredClone(input.map),
      expiresAt: input.ticketClaims.expiresAt,
      roomId: null,
      portals: Array.from({ length: MULTIPLAYER_LIMITS.portalsPerMap }, (_, index) => ({ index, used: false })),
    };
    party.revision += 1;
    return { ...input, authoritativeProfile, party: this.copy(party) };
  }

  async claimRoom(ticketId: string, roomId: string): Promise<boolean> {
    const party = this.mutableForTicket(ticketId);
    const existing = this.roomClaims.get(ticketId);
    if (!party?.activeMap || party.activeMap.expiresAt <= this.now() || (existing && existing.expiresAt > this.now())) return false;
    this.roomClaims.set(ticketId, { roomId, expiresAt: this.now() + 30_000 });
    party.activeMap.roomId = roomId;
    party.revision += 1;
    return true;
  }

  async renewRoom(ticketId: string, roomId: string): Promise<boolean> {
    const claim = this.roomClaims.get(ticketId);
    if (!claim || claim.roomId !== roomId) return false;
    claim.expiresAt = this.now() + 30_000;
    return true;
  }

  async clear(ownerCharacterId: string, ticketId: string, roomId: string): Promise<void> {
    const party = this.mutableForMember(ownerCharacterId) ?? this.mutableForTicket(ticketId);
    if (!party?.activeMap || party.activeMap.ticketId !== ticketId || party.activeMap.roomId !== roomId) return;
    party.activeMap = null;
    this.roomClaims.delete(ticketId);
    party.revision += 1;
  }

  async consumePortal(characterId: string, ticketId: string, portalIndex: number): Promise<boolean> {
    const party = this.mutableForMember(characterId);
    if (!party?.activeMap || party.activeMap.ticketId !== ticketId) return false;
    const portal = party.activeMap.portals.find((candidate) => candidate.index === portalIndex);
    if (!portal || portal.used) return false;
    portal.used = true;
    party.revision += 1;
    return true;
  }

  async close(): Promise<void> {}

  private createFor(leaderCharacterId: string, visibility: PartySnapshot["visibility"]): PartySnapshot {
    const party: PartySnapshot = {
      id: randomUUID(), visibility, leaderCharacterId, memberCharacterIds: [leaderCharacterId], revision: 1, activeMap: null,
    };
    this.parties.set(party.id, party);
    this.partyByMember.set(leaderCharacterId, party.id);
    this.addPendingLease(party.id, leaderCharacterId);
    return this.copy(party);
  }

  private addPendingLease(partyId: string, characterId: string): void {
    this.connections.set(`pending:${randomUUID()}`, { partyId, characterId, expiresAt: this.now() + this.presenceGraceMilliseconds });
  }

  private prune(): void {
    const now = this.now();
    for (const [ticketId, claim] of this.roomClaims) {
      if (claim.expiresAt > now) continue;
      this.roomClaims.delete(ticketId);
      const party = this.mutableForTicket(ticketId);
      if (party?.activeMap?.roomId === claim.roomId) party.activeMap.roomId = null;
    }
    for (const [id, lease] of this.connections) if (lease.expiresAt <= now) this.connections.delete(id);
    for (const [characterId, partyId] of [...this.partyByMember]) {
      const connected = [...this.connections.values()].some((lease) => lease.characterId === characterId && lease.expiresAt > now);
      if (connected) continue;
      const party = this.parties.get(partyId);
      if (party?.activeMap && party.activeMap.expiresAt > now) continue;
      void this.leave(characterId);
    }
  }

  private mutableForMember(characterId: string): PartySnapshot | undefined {
    const partyId = this.partyByMember.get(characterId);
    return partyId ? this.parties.get(partyId) : undefined;
  }

  private mutableForTicket(ticketId: string): PartySnapshot | undefined {
    return [...this.parties.values()].find((party) => party.activeMap?.ticketId === ticketId);
  }

  private copy(party: PartySnapshot): PartySnapshot {
    return {
      ...party,
      memberCharacterIds: [...party.memberCharacterIds],
      activeMap: party.activeMap ? {
        ...party.activeMap,
        map: structuredClone(party.activeMap.map),
        portals: party.activeMap.portals.map((portal) => ({ ...portal })),
      } : null,
    };
  }
}
