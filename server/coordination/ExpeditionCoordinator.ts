import type { MapItem } from "../../app/game/domain";
import type { MapTicketClaims } from "../../multiplayer/protocol";
import type { AuthoritativeProfile } from "../persistence/PlayerRepository";
import type { PartySnapshot } from "./PartyCoordinator";

export class ExpeditionError extends Error {
  constructor(public readonly code: "not_found" | "not_leader" | "no_map" | "profile_revision_conflict" | "party_revision_conflict") {
    super(code);
  }
}

export interface OpenExpeditionInput {
  leaderCharacterId: string;
  partyId: string;
  partyRevision: number;
  expectedProfileRevision: number;
  map: MapItem;
  mapTicket: string;
  ticketClaims: MapTicketClaims;
}

export interface OpenedExpedition {
  map: MapItem;
  mapTicket: string;
  ticketClaims: MapTicketClaims;
  authoritativeProfile: AuthoritativeProfile;
  party: PartySnapshot;
}

export interface ExpeditionCoordinator {
  open(input: OpenExpeditionInput): Promise<OpenedExpedition>;
  claimRoom(ticketId: string, roomId: string): Promise<boolean>;
  renewRoom(ticketId: string, roomId: string): Promise<boolean>;
  clear(ownerCharacterId: string, ticketId: string, roomId: string): Promise<void>;
  consumePortal(characterId: string, ticketId: string, portalIndex: number): Promise<boolean>;
  close(): Promise<void>;
}
