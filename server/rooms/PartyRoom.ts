import { Room, type Client, type RoomException, type RoomMethodName } from "colyseus";
import { MULTIPLAYER_LIMITS, type SessionClaims } from "../../multiplayer/protocol";
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
    this.clock.setInterval(() => {
      void Promise.all([...this.activeClients.entries()].map(([characterId, client]) => (
        this.services.parties.renewConnection(this.partyId, characterId, client.sessionId)
      ))).catch((error) => {
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

  /** Returns true only when the character's final socket should be removed. */
  protected async releasePartyClient(
    client: Client,
    code: number,
    claims: SessionClaims,
    setConnected: (connected: boolean) => void,
  ): Promise<boolean> {
    await this.services.parties.disconnect(this.partyId, claims.characterId, client.sessionId);
    if (this.activeClients.get(claims.characterId) !== client) return false;
    setConnected(false);
    if (code !== 4000) {
      try {
        await this.allowReconnection(client, MULTIPLAYER_LIMITS.reconnectSeconds);
        if (this.activeClients.get(claims.characterId) !== client) return false;
        await this.services.parties.connect(this.partyId, claims.characterId, client.sessionId);
        setConnected(true);
        return false;
      } catch {
        // Reconnection expired; the concrete room removes its state below.
      }
    }
    if (this.activeClients.get(claims.characterId) !== client) return false;
    this.activeClients.delete(claims.characterId);
    return true;
  }
}
