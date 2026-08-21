import type { CharacterClassId, MapItem } from "../../app/game/domain";

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
  constructor(public readonly code: "not_found" | "already_in_party" | "party_full" | "not_leader" | "revision_conflict") {
    super(code);
  }
}

export interface PartyCoordinator {
  create(leaderCharacterId: string): Promise<PartySnapshot>;
  createSolo(leaderCharacterId: string): Promise<PartySnapshot>;
  join(characterId: string, partyId: string): Promise<PartySnapshot>;
  leave(characterId: string): Promise<PartySnapshot | null>;
  getForMember(characterId: string): Promise<PartySnapshot | null>;
  get(partyId: string): Promise<PartySnapshot | null>;
  listPublic(): Promise<PartySnapshot[]>;
  isMember(partyId: string, characterId: string): Promise<boolean>;
  connect(partyId: string, characterId: string, connectionId: string): Promise<void>;
  renewConnection(partyId: string, characterId: string, connectionId: string): Promise<void>;
  disconnect(partyId: string, characterId: string, connectionId: string): Promise<void>;
  close(): Promise<void>;
}

