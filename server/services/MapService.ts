import { randomInt, randomUUID } from "node:crypto";
import type { MapItem } from "../../app/game/domain";
import type { MapTicketClaims } from "../../multiplayer/protocol";
import { signMapTicket } from "../auth/map-ticket";
import { ProfileRevisionConflict } from "../persistence/errors";
import type { AuthoritativeProfile, PlayerRepository } from "../persistence/PlayerRepository";
import type { PartyService } from "./PartyService";

export class MapOpenError extends Error {
  constructor(public readonly code: "not_found" | "not_leader" | "no_map" | "revision_conflict") {
    super(code);
  }
}

export interface OpenedAuthoritativeMap {
  map: MapItem;
  mapTicket: string;
  ticketClaims: MapTicketClaims;
  authoritativeProfile: AuthoritativeProfile;
}

export class MapService {
  constructor(
    private readonly players: PlayerRepository,
    private readonly parties: PartyService,
    private readonly authSecret: string,
  ) {}

  async open(characterId: string, expectedRevision: number): Promise<OpenedAuthoritativeMap> {
    const party = this.parties.getForMember(characterId) ?? this.parties.createSolo(characterId);
    if (party.leaderCharacterId !== characterId) throw new MapOpenError("not_leader");
    const current = await this.players.loadProfile(characterId);
    if (!current) throw new MapOpenError("not_found");
    if (current.revision !== expectedRevision) throw new MapOpenError("revision_conflict");
    const map = current.profile.mapDevice;
    if (!map) throw new MapOpenError("no_map");
    let authoritativeProfile: AuthoritativeProfile;
    try {
      authoritativeProfile = await this.players.saveProfile(characterId, expectedRevision, { ...current.profile, mapDevice: null });
    } catch (error) {
      if (error instanceof ProfileRevisionConflict) throw new MapOpenError("revision_conflict");
      throw error;
    }
    const ticketClaims: MapTicketClaims = {
      ticketId: randomUUID(),
      mapItemId: map.id,
      ownerCharacterId: characterId,
      allowedCharacterIds: party.memberCharacterIds,
      tier: map.tier,
      seed: randomInt(0x7fffffff),
      expiresAt: Date.now() + 10 * 60_000,
    };
    const mapTicket = signMapTicket(ticketClaims, this.authSecret);
    this.parties.activateMap(characterId, { ticketId: ticketClaims.ticketId, mapTicket, map, expiresAt: ticketClaims.expiresAt });
    return {
      map,
      ticketClaims,
      mapTicket,
      authoritativeProfile,
    };
  }
}
