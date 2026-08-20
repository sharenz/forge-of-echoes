import { randomUUID } from "node:crypto";
import type { CharacterClassId, MapItem } from "../../app/game/domain";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";

export interface ActivePartyMap {
  ticketId: string;
  mapTicket: string;
  map: MapItem;
  expiresAt: number;
  roomId: string | null;
  portals: Array<{ index: number; used: boolean }>;
}

export interface PartySnapshot {
  id: string;
  visibility: "public" | "solo";
  leaderCharacterId: string;
  memberCharacterIds: string[];
  revision: number;
  activeMap: ActivePartyMap | null;
}

export interface PublicPartyListing {
  id: string;
  name: string;
  leader: {
    characterId: string;
    characterName: string;
    classId: CharacterClassId;
    level: number;
  };
  memberCount: number;
  maximumMembers: number;
  activity: "hideout" | "map";
  activeMap: { name: string; tier: number } | null;
}

export class PartyError extends Error {
  constructor(public readonly code: "not_found" | "already_in_party" | "party_full" | "not_leader") {
    super(code);
  }
}

export class PartyService {
  private readonly parties = new Map<string, PartySnapshot>();
  private readonly partyByMember = new Map<string, string>();
  private readonly connectionCounts = new Map<string, number>();
  private readonly evictionTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly presenceGraceMilliseconds: number = MULTIPLAYER_LIMITS.partyPresenceGraceMilliseconds) {}

  create(leaderCharacterId: string): PartySnapshot {
    const existing = this.getMutableForMember(leaderCharacterId);
    if (existing) {
      if (existing.visibility === "solo") {
        existing.visibility = "public";
        existing.revision += 1;
      }
      return this.copy(existing);
    }
    return this.createFor(leaderCharacterId, "public");
  }

  createSolo(leaderCharacterId: string): PartySnapshot {
    const existing = this.getForMember(leaderCharacterId);
    if (existing) return existing;
    return this.createFor(leaderCharacterId, "solo");
  }

  private createFor(leaderCharacterId: string, visibility: PartySnapshot["visibility"]): PartySnapshot {
    const party: PartySnapshot = {
      id: randomUUID(),
      visibility,
      leaderCharacterId,
      memberCharacterIds: [leaderCharacterId],
      revision: 1,
      activeMap: null,
    };
    this.parties.set(party.id, party);
    this.partyByMember.set(leaderCharacterId, party.id);
    this.scheduleEviction(leaderCharacterId);
    return this.copy(party);
  }

  join(characterId: string, partyId: string): PartySnapshot {
    const party = this.parties.get(partyId);
    if (!party || party.visibility !== "public") throw new PartyError("not_found");
    if (party.memberCharacterIds.length >= MULTIPLAYER_LIMITS.playersPerRoom) throw new PartyError("party_full");
    const existing = this.getMutableForMember(characterId);
    if (existing?.visibility === "solo" && !existing.activeMap) this.leave(characterId);
    else if (existing) throw new PartyError("already_in_party");
    party.memberCharacterIds.push(characterId);
    party.revision += 1;
    this.partyByMember.set(characterId, party.id);
    this.scheduleEviction(characterId);
    return this.copy(party);
  }

  leave(characterId: string): PartySnapshot | null {
    const party = this.getMutableForMember(characterId);
    if (!party) return null;
    party.memberCharacterIds = party.memberCharacterIds.filter((id) => id !== characterId);
    this.partyByMember.delete(characterId);
    this.connectionCounts.delete(characterId);
    this.clearEviction(characterId);
    party.revision += 1;
    if (party.memberCharacterIds.length === 0) {
      this.parties.delete(party.id);
      return null;
    }
    if (party.leaderCharacterId === characterId) party.leaderCharacterId = party.memberCharacterIds[0];
    return this.copy(party);
  }

  getForMember(characterId: string): PartySnapshot | null {
    const party = this.getMutableForMember(characterId);
    return party ? this.copy(party) : null;
  }

  get(partyId: string): PartySnapshot | null {
    const party = this.parties.get(partyId);
    return party ? this.copy(party) : null;
  }

  listPublic(): PartySnapshot[] {
    return [...this.parties.values()]
      .filter((party) => party.visibility === "public")
      .map((party) => this.copy(party));
  }

  isMember(partyId: string, characterId: string): boolean {
    return this.parties.get(partyId)?.memberCharacterIds.includes(characterId) ?? false;
  }

  memberConnected(partyId: string, characterId: string): void {
    if (this.partyByMember.get(characterId) !== partyId) return;
    this.connectionCounts.set(characterId, (this.connectionCounts.get(characterId) ?? 0) + 1);
    this.clearEviction(characterId);
  }

  memberDisconnected(partyId: string, characterId: string): void {
    if (this.partyByMember.get(characterId) !== partyId) return;
    const remainingConnections = Math.max(0, (this.connectionCounts.get(characterId) ?? 0) - 1);
    if (remainingConnections > 0) {
      this.connectionCounts.set(characterId, remainingConnections);
      return;
    }
    this.connectionCounts.delete(characterId);
    this.scheduleEviction(characterId);
  }

  activateMap(leaderCharacterId: string, activeMap: Omit<ActivePartyMap, "roomId" | "portals">): PartySnapshot {
    const party = this.getMutableForMember(leaderCharacterId);
    if (!party) throw new PartyError("not_found");
    if (party.leaderCharacterId !== leaderCharacterId) throw new PartyError("not_leader");
    party.activeMap = {
      ...activeMap,
      map: structuredClone(activeMap.map),
      roomId: null,
      portals: Array.from({ length: MULTIPLAYER_LIMITS.portalsPerMap }, (_, index) => ({ index, used: false })),
    };
    party.revision += 1;
    return this.copy(party);
  }

  attachMapRoom(ownerCharacterId: string, ticketId: string, roomId: string): void {
    const party = this.getMutableForMember(ownerCharacterId) ?? this.getMutableForMapTicket(ticketId);
    if (!party?.activeMap || party.activeMap.ticketId !== ticketId) return;
    party.activeMap.roomId = roomId;
    party.revision += 1;
  }

  clearMap(ownerCharacterId: string, ticketId: string): void {
    const party = this.getMutableForMember(ownerCharacterId) ?? this.getMutableForMapTicket(ticketId);
    if (!party?.activeMap || party.activeMap.ticketId !== ticketId) return;
    party.activeMap = null;
    party.revision += 1;
    for (const memberCharacterId of party.memberCharacterIds) {
      if ((this.connectionCounts.get(memberCharacterId) ?? 0) === 0) this.scheduleEviction(memberCharacterId);
    }
  }

  consumeMapPortal(characterId: string, ticketId: string, portalIndex: number): boolean {
    const party = this.getMutableForMember(characterId);
    if (!party?.activeMap || party.activeMap.ticketId !== ticketId) return false;
    const portal = party.activeMap.portals.find((candidate) => candidate.index === portalIndex);
    if (!portal || portal.used) return false;
    portal.used = true;
    party.revision += 1;
    return true;
  }

  private getMutableForMember(characterId: string): PartySnapshot | undefined {
    const partyId = this.partyByMember.get(characterId);
    return partyId ? this.parties.get(partyId) : undefined;
  }

  private getMutableForMapTicket(ticketId: string): PartySnapshot | undefined {
    return [...this.parties.values()].find((party) => party.activeMap?.ticketId === ticketId);
  }

  private scheduleEviction(characterId: string, delayMilliseconds = this.presenceGraceMilliseconds): void {
    this.clearEviction(characterId);
    const timer = setTimeout(() => {
      this.evictionTimers.delete(characterId);
      if ((this.connectionCounts.get(characterId) ?? 0) > 0) return;
      const party = this.getMutableForMember(characterId);
      if (party?.activeMap && party.activeMap.expiresAt > Date.now()) {
        this.scheduleEviction(characterId, Math.min(this.presenceGraceMilliseconds, party.activeMap.expiresAt - Date.now()));
        return;
      }
      if (party?.activeMap) {
        party.activeMap = null;
        party.revision += 1;
      }
      this.leave(characterId);
    }, Math.max(1, delayMilliseconds));
    timer.unref();
    this.evictionTimers.set(characterId, timer);
  }

  private clearEviction(characterId: string): void {
    const timer = this.evictionTimers.get(characterId);
    if (timer) clearTimeout(timer);
    this.evictionTimers.delete(characterId);
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
