import { Client, type Room } from "@colyseus/sdk";
import type { CharacterClassId } from "../game/domain";
import type { ProfileCommand } from "../../multiplayer/protocol";
import type { AccountIdentity, AuthoritativeProfile, CharacterRosterEntry, PlayerIdentity } from "../../server/persistence/PlayerRepository";
import type { PartySnapshot, PublicPartyListing } from "../../server/services/PartyService";
import type { HideoutState } from "../../server/state/HideoutState";
import type { MapRoomState } from "../../server/state/MapState";
import type { OpenedAuthoritativeMap } from "../../server/services/MapService";
import type { TradeSnapshot } from "../../server/persistence/TradeRepository";

export interface MultiplayerSession {
  token: string;
  player: PlayerIdentity;
}

export interface AccountSession {
  token: string;
  account: AccountIdentity;
  characters: CharacterRosterEntry[];
}

interface CreatedCharacterResponse {
  session: MultiplayerSession;
  characters: CharacterRosterEntry[];
}

export class MultiplayerRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function defaultHttpEndpoint(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:2567";
  return `${window.location.protocol}//${window.location.hostname}:2567`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new MultiplayerRequestError(response.status, body.error ?? "request_failed", body.message ?? `Request failed (${response.status})`);
  return body as T;
}

export class MultiplayerClient {
  readonly httpEndpoint: string;
  readonly websocketEndpoint: string;
  private readonly realtime: Client;

  constructor(httpEndpoint = process.env.NEXT_PUBLIC_GAME_SERVER_URL?.replace(/^ws/, "http") ?? defaultHttpEndpoint()) {
    this.httpEndpoint = httpEndpoint.replace(/\/$/, "");
    this.websocketEndpoint = this.httpEndpoint.replace(/^http/, "ws");
    this.realtime = new Client(this.websocketEndpoint);
  }

  async createAccountSession(handle: string): Promise<AccountSession> {
    const response = await fetch(`${this.httpEndpoint}/api/accounts/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    return responseJson<AccountSession>(response);
  }

  createCharacter(account: AccountSession, input: { characterName: string; classId: CharacterClassId }): Promise<CreatedCharacterResponse> {
    return this.request<CreatedCharacterResponse>("/api/accounts/characters", account, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  selectCharacter(account: AccountSession, characterId: string): Promise<MultiplayerSession> {
    return this.request<MultiplayerSession>("/api/accounts/select-character", account, {
      method: "POST",
      body: JSON.stringify({ characterId }),
    });
  }

  loadProfile(session: MultiplayerSession): Promise<AuthoritativeProfile> {
    return this.request<AuthoritativeProfile>("/api/profile", session);
  }

  sendProfileCommand(session: MultiplayerSession, revision: number, command: ProfileCommand): Promise<AuthoritativeProfile> {
    return this.request<AuthoritativeProfile>("/api/profile/commands", session, {
      method: "POST",
      body: JSON.stringify({ revision, command }),
    });
  }

  createParty(session: MultiplayerSession): Promise<PartySnapshot> {
    return this.request<PartySnapshot>("/api/parties", session, { method: "POST", body: "{}" });
  }

  createSoloParty(session: MultiplayerSession): Promise<PartySnapshot> {
    return this.request<PartySnapshot>("/api/parties/solo", session, { method: "POST", body: "{}" });
  }

  listParties(session: MultiplayerSession): Promise<PublicPartyListing[]> {
    return this.request<PublicPartyListing[]>("/api/parties", session);
  }

  currentParty(session: MultiplayerSession): Promise<PartySnapshot> {
    return this.request<PartySnapshot>("/api/parties/current", session);
  }

  joinParty(session: MultiplayerSession, partyId: string): Promise<PartySnapshot> {
    return this.request<PartySnapshot>("/api/parties/join", session, {
      method: "POST",
      body: JSON.stringify({ partyId }),
    });
  }

  leaveParty(session: MultiplayerSession): Promise<{ party: PartySnapshot | null }> {
    return this.request<{ party: PartySnapshot | null }>("/api/parties/leave", session, { method: "POST", body: "{}" });
  }

  openMap(session: MultiplayerSession, revision: number): Promise<OpenedAuthoritativeMap> {
    return this.request<OpenedAuthoritativeMap>("/api/maps/open", session, {
      method: "POST",
      body: JSON.stringify({ revision }),
    });
  }

  createTrade(session: MultiplayerSession, targetCharacterId: string): Promise<TradeSnapshot> {
    return this.request<TradeSnapshot>("/api/trades", session, {
      method: "POST",
      body: JSON.stringify({ targetCharacterId }),
    });
  }

  listTrades(session: MultiplayerSession): Promise<TradeSnapshot[]> {
    return this.request<TradeSnapshot[]>("/api/trades", session);
  }

  getTrade(session: MultiplayerSession, tradeId: string): Promise<TradeSnapshot> {
    return this.request<TradeSnapshot>(`/api/trades/${tradeId}`, session);
  }

  setTradeOffer(session: MultiplayerSession, tradeId: string, revision: number, itemIds: string[]): Promise<TradeSnapshot> {
    return this.request<TradeSnapshot>(`/api/trades/${tradeId}/offer`, session, {
      method: "POST",
      body: JSON.stringify({ revision, itemIds }),
    });
  }

  acceptTrade(session: MultiplayerSession, tradeId: string, revision: number): Promise<TradeSnapshot> {
    return this.request<TradeSnapshot>(`/api/trades/${tradeId}/accept`, session, {
      method: "POST",
      body: JSON.stringify({ revision }),
    });
  }

  cancelTrade(session: MultiplayerSession, tradeId: string): Promise<TradeSnapshot> {
    return this.request<TradeSnapshot>(`/api/trades/${tradeId}/cancel`, session, { method: "POST", body: "{}" });
  }

  connectHideout(session: MultiplayerSession, partyId: string): Promise<Room<unknown, HideoutState>> {
    return this.realtime.joinOrCreate<HideoutState>("hideout", { token: session.token, partyId });
  }

  connectMap(session: MultiplayerSession, mapTicket: string, portalIndex: number, roomId?: string): Promise<Room<unknown, MapRoomState>> {
    const options = { token: session.token, mapTicket, portalIndex };
    return roomId
      ? this.realtime.joinById<MapRoomState>(roomId, options)
      : this.realtime.create<MapRoomState>("map", options);
  }

  private async request<T>(path: string, session: { token: string }, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.httpEndpoint}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    return responseJson<T>(response);
  }
}
