import { Client, type Room } from "@colyseus/sdk";
import type { CharacterClassId } from "../game/domain";
import { MULTIPLAYER_LIMITS, WIRE_PROTOCOL_VERSION, type ProfileCommand } from "../../multiplayer/protocol";
import type { AccountIdentity, AuthoritativeProfile, CharacterRosterEntry, PlayerIdentity } from "../../server/persistence/PlayerRepository";
import type { PartySnapshot, PublicPartyListing } from "../../server/coordination/PartyCoordinator";
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

export class ProtocolMismatchError extends Error {
  constructor(readonly serverVersion: string | null) {
    super("The game was updated. Reload the page to reconnect with the current version.");
  }
}

export interface RetryWindowOptions {
  windowMilliseconds: number;
  delaysMilliseconds?: readonly number[];
  now?: () => number;
  sleep?: (delayMilliseconds: number) => Promise<void>;
}

export async function retryWithinWindow<T>(attempt: () => Promise<T>, options: RetryWindowOptions): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delayMilliseconds) => new Promise((resolve) => setTimeout(resolve, delayMilliseconds)));
  const delays = options.delaysMilliseconds ?? [100, 200, 400, 800, 1_200, 1_600, 2_000];
  const deadline = now() + options.windowMilliseconds;
  let retry = 0;
  let lastError: unknown = new Error("Connection recovery failed");
  while (now() < deadline) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const delay = Math.min(delays[Math.min(retry, delays.length - 1)] ?? remaining, remaining);
    retry += 1;
    await sleep(delay);
  }
  throw lastError;
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

function assertCompatibleProtocol(response: Response): void {
  const version = response.headers.get("x-crafty-protocol-version");
  if (version !== String(WIRE_PROTOCOL_VERSION)) throw new ProtocolMismatchError(version);
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

  async createAccountSession(handle: string, password: string, mode: "login" | "register"): Promise<AccountSession> {
    const response = await fetch(`${this.httpEndpoint}/api/accounts/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, password, mode }),
    });
    assertCompatibleProtocol(response);
    return responseJson<AccountSession>(response);
  }

  async logoutAccount(account: AccountSession): Promise<void> {
    const response = await fetch(`${this.httpEndpoint}/api/accounts/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}` },
    });
    assertCompatibleProtocol(response);
    if (!response.ok) await responseJson<unknown>(response);
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
    return this.realtime.joinOrCreate<HideoutState>("hideout", { token: session.token, partyId, protocolVersion: WIRE_PROTOCOL_VERSION });
  }

  connectMap(session: MultiplayerSession, mapTicket: string, portalIndex: number, roomId?: string): Promise<Room<unknown, MapRoomState>> {
    const options = { token: session.token, mapTicket, portalIndex, protocolVersion: WIRE_PROTOCOL_VERSION };
    return roomId
      ? this.realtime.joinById<MapRoomState>(roomId, options)
      : this.realtime.create<MapRoomState>("map", options);
  }

  async reconnectMap(reconnectionToken: string): Promise<Room<unknown, MapRoomState>> {
    // Leave a small margin inside the server's seat window so the final
    // attempt can complete before allowReconnection expires.
    try {
      return await retryWithinWindow(
        () => this.realtime.reconnect<MapRoomState>(reconnectionToken),
        { windowMilliseconds: MULTIPLAYER_LIMITS.reconnectSeconds * 1_000 - 250 },
      );
    } catch (error) {
      // A rolling deploy may have replaced the server with an incompatible
      // build while this socket was disconnected. Turn that into a clear
      // reload instruction instead of repeated binary-decoder failures.
      const health = await fetch(`${this.httpEndpoint}/healthz`).catch(() => null);
      if (health) assertCompatibleProtocol(health);
      throw error;
    }
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
    assertCompatibleProtocol(response);
    return responseJson<T>(response);
  }
}
