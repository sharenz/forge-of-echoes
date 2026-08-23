import { randomInt, randomUUID } from "node:crypto";
import type { MapItem } from "../../app/game/domain";
import type { MapTicketClaims } from "../../multiplayer/protocol";
import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";
import { signMapTicket } from "../auth/map-ticket";
import type { AuthoritativeProfile, PlayerRepository } from "../persistence/PlayerRepository";
import { ExpeditionError, type ExpeditionCoordinator } from "../coordination/ExpeditionCoordinator";
import type { PartyCoordinator } from "../coordination/PartyCoordinator";

export class MapOpenError extends Error {
  constructor(public readonly code: "not_found" | "not_leader" | "no_map" | "revision_conflict") {
    super(code);
  }
}

export interface OpenedAuthoritativeMap {
  partyId: string;
  map: MapItem;
  mapTicket: string;
  ticketClaims: MapTicketClaims;
  authoritativeProfile: AuthoritativeProfile;
}

export class MapService {
  constructor(
    private readonly players: PlayerRepository,
    private readonly parties: PartyCoordinator,
    private readonly expeditions: ExpeditionCoordinator,
    private readonly authSecret: string,
  ) {}

  async open(characterId: string, expectedRevision: number): Promise<OpenedAuthoritativeMap> {
    const party = await this.parties.getForMember(characterId) ?? await this.parties.createSolo(characterId);
    if (party.leaderCharacterId !== characterId) throw new MapOpenError("not_leader");
    const current = await this.players.loadProfile(characterId);
    if (!current) throw new MapOpenError("not_found");
    if (current.revision !== expectedRevision) throw new MapOpenError("revision_conflict");
    const map = current.profile.mapDevice;
    if (!map) throw new MapOpenError("no_map");
    const ticketClaims: MapTicketClaims = {
      ticketId: randomUUID(),
      mapItemId: map.id,
      ownerCharacterId: characterId,
      allowedCharacterIds: party.memberCharacterIds,
      tier: map.tier,
      seed: randomInt(0x7fffffff),
      expiresAt: Date.now() + MULTIPLAYER_LIMITS.expeditionLifetimeMilliseconds,
    };
    const mapTicket = signMapTicket(ticketClaims, this.authSecret);
    try {
      const opened = await this.expeditions.open({
        leaderCharacterId: characterId,
        partyId: party.id,
        partyRevision: party.revision,
        expectedProfileRevision: expectedRevision,
        map,
        ticketClaims,
        mapTicket,
      });
      return { partyId: party.id, map: opened.map, ticketClaims: opened.ticketClaims, mapTicket: opened.mapTicket, authoritativeProfile: opened.authoritativeProfile };
    } catch (error) {
      if (error instanceof ExpeditionError) {
        if (error.code === "not_leader") throw new MapOpenError("not_leader");
        if (error.code === "no_map") throw new MapOpenError("no_map");
        if (error.code === "profile_revision_conflict" || error.code === "party_revision_conflict") {
          throw new MapOpenError("revision_conflict");
        }
        if (error.code === "not_found") throw new MapOpenError("not_found");
      }
      throw error;
    }
  }
}
