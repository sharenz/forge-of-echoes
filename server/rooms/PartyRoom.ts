import { Room, type Client, type RoomException, type RoomMethodName } from "colyseus";
import { CLIENT_MESSAGES, latencyProbeSchema, MULTIPLAYER_LIMITS, SERVER_MESSAGES, type SessionClaims } from "../../multiplayer/protocol";
import { formatError } from "../logging";
import type { ServerServices } from "../services";

/** Shared socket replacement, presence, reconnect, and final-removal lifecycle. */
export abstract class PartyRoom<TState extends object> extends Room<{ state: TState }> {
  protected readonly activeClients = new Map<string, Client>();
  protected partyId = "";
  protected services!: ServerServices;

  onUncaughtException(error: RoomException, methodName: RoomMethodName): void {
    console.error(`[${this.constructor.name}:${this.roomId || "creating"}] uncaught ${methodName} exception\n${formatError(error)}`);
  }

  protected initializePartyRoom(services: ServerServices, partyId: string): void {
    this.services = services;
    this.partyId = partyId;
    this.maxClients = MULTIPLAYER_LIMITS.playersPerRoom + 1;
    this.maxMessagesPerSecond = MULTIPLAYER_LIMITS.maximumClientMessagesPerSecond;
    this.patchRate = 1_000 / MULTIPLAYER_LIMITS.statePatchHz;
    this.onMessage(CLIENT_MESSAGES.latencyProbe, (client, rawMessage) => {
      const message = latencyProbeSchema.safeParse(rawMessage);
      if (message.success) client.send(SERVER_MESSAGES.latencyProbeResponse, message.data);
    });
    this.clock.setInterval(() => {
      void Promise.all([...this.activeClients.entries()].map(async ([characterId, client]) => {
        const claims = client.auth as SessionClaims | undefined;
        if (!claims || !await this.services.players.isAuthSessionActive(claims.authSessionId, claims.accountId)) {
          client.leave(4003, "Login session expired or was revoked");
          return;
        }
        await this.services.parties.renewConnection(this.partyId, characterId, client.sessionId);
      })).catch((error) => {
        console.error(`[${this.constructor.name}:${this.roomId}] presence lease renewal failed\n${formatError(error)}`);
      });
    }, Math.max(1_000, Math.floor(MULTIPLAYER_LIMITS.partyPresenceGraceMilliseconds / 3)));
  }

  protected async registerPartyClient(client: Client, claims: SessionClaims): Promise<Client | null> {
    const previous = this.activeClients.get(claims.characterId) ?? null;
    this.activeClients.set(claims.characterId, client);
    await this.services.parties.connect(this.partyId, claims.characterId, client.sessionId);
    if (previous && previous !== client) {
      const timer = setTimeout(() => previous.leave(4000, "Connection replaced by a newer session"), 0);
      timer.unref();
    }
    return previous;
  }

  protected isActivePartyClient(characterId: string, client: Client): boolean {
    return this.activeClients.get(characterId)?.sessionId === client.sessionId;
  }

  /** Returns true only when the character's final socket should be removed. */
  protected async releasePartyClient(
    client: Client,
    code: number,
    claims: SessionClaims,
    setConnected: (connected: boolean) => void,
    onReconnected?: (client: Client) => void | Promise<void>,
  ): Promise<boolean> {
    await this.services.parties.disconnect(this.partyId, claims.characterId, client.sessionId);
    if (!this.isActivePartyClient(claims.characterId, client)) return false;
    setConnected(false);
    if (code !== 4000) {
      try {
        const reconnectedClient = await this.allowReconnection(client, MULTIPLAYER_LIMITS.reconnectSeconds);
        if (!this.isActivePartyClient(claims.characterId, client)) return false;
        // Colyseus creates a new Client instance for the reconnected transport
        // and does not invoke onJoin again. Every identity-sensitive room path
        // must therefore be rebound here before messages can be accepted.
        this.activeClients.set(claims.characterId, reconnectedClient);
        await this.services.parties.connect(this.partyId, claims.characterId, reconnectedClient.sessionId);
        setConnected(true);
        await onReconnected?.(reconnectedClient);
        return false;
      } catch {
        // Reconnection expired; the concrete room removes its state below.
      }
    }
    if (!this.isActivePartyClient(claims.characterId, client)) return false;
    this.activeClients.delete(claims.characterId);
    return true;
  }
}
