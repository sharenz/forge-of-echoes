import type { Client } from "colyseus";
import {
  CLIENT_MESSAGES,
  MULTIPLAYER_LIMITS,
  SERVER_MESSAGES,
  joinHideoutOptionsSchema,
  movementCommandSchema,
  type PartySnapshotMessage,
  type PublicPartiesMessage,
  type TradeSnapshotsMessage,
  type MovementCommand,
  type SessionClaims,
} from "../../multiplayer/protocol";
import { verifySessionToken } from "../auth/session-token";
import { formatError } from "../logging";
import { getServerServices } from "../services";
import { HideoutState, NetworkPlayer } from "../state/HideoutState";
import { PartyRoom } from "./PartyRoom";
import { serverHealth } from "../observability/ServerHealth";
import { listPublicPartyListings } from "../services/PublicPartyService";
import type { SocialInvalidation } from "../social/SocialEventBus";

interface PlayerInput {
  x: number;
  y: number;
  sequence: number;
}

export class HideoutRoom extends PartyRoom<HideoutState> {
  state = new HideoutState();
  private readonly inputs = new Map<string, PlayerInput>();
  private healthRegistered = false;
  private unsubscribeSocial: (() => void) | null = null;
  private socialRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSocialRefresh = { party: false, trades: false, publicParties: false };

  async onCreate(rawOptions: unknown): Promise<void> {
    const options = joinHideoutOptionsSchema.safeParse(rawOptions);
    if (!options.success) throw new Error("A party is required to create a hideout room");
    const services = getServerServices();
    const session = verifySessionToken(options.data.token, services.authSecret);
    const authenticated = session && await services.players.isAuthSessionActive(session.authSessionId, session.accountId);
    const party = authenticated ? await services.parties.get(options.data.partyId) : null;
    if (!session || !party || !party.memberCharacterIds.includes(session.characterId)) throw new Error("Only a party member can create its hideout room");
    this.initializePartyRoom(services, party.id);
    this.state.partyId = party.id;
    this.state.ownerCharacterId = party.leaderCharacterId;
    // One transient extra socket allows an authenticated character to replace
    // its stale connection during a fast refresh. Party membership still caps
    // distinct characters at playersPerRoom.
    this.onMessage(CLIENT_MESSAGES.movement, (client, rawCommand) => {
      const parsed = movementCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        client.send(SERVER_MESSAGES.rejected, { command: CLIENT_MESSAGES.movement, reason: "invalid" });
        return;
      }
      this.receiveMovement(client, parsed.data);
    });
    this.setSimulationInterval((deltaMilliseconds) => this.simulate(deltaMilliseconds / 1000), 1000 / MULTIPLAYER_LIMITS.simulationHz);
    this.unsubscribeSocial = services.social?.subscribe((event) => this.onSocialInvalidation(event)) ?? null;
    serverHealth.roomStarted("hideout");
    this.healthRegistered = true;
  }

  onDispose(): void {
    this.unsubscribeSocial?.();
    this.unsubscribeSocial = null;
    if (this.socialRefreshTimer) clearTimeout(this.socialRefreshTimer);
    this.socialRefreshTimer = null;
    if (!this.healthRegistered) return;
    this.healthRegistered = false;
    serverHealth.roomStopped("hideout");
  }

  async onAuth(_client: Client, rawOptions: unknown): Promise<SessionClaims | false> {
    const options = joinHideoutOptionsSchema.safeParse(rawOptions);
    if (!options.success) return false;
    const services = getServerServices();
    const session = verifySessionToken(options.data.token, services.authSecret);
    if (!session
      || !await services.players.isAuthSessionActive(session.authSessionId, session.accountId)
      || options.data.partyId !== this.partyId
      || !await services.parties.isMember(this.partyId, session.characterId)) return false;
    return session;
  }

  async onJoin(client: Client, _options: unknown, claims: SessionClaims): Promise<void> {
    let player = this.state.players.get(claims.characterId);
    if (!player) {
      player = new NetworkPlayer();
      const positionIndex = this.state.players.size;
      player.characterId = claims.characterId;
      player.name = claims.characterName;
      player.classId = claims.classId;
      player.x = 430 + (positionIndex % 2) * 100;
      player.y = 500 + Math.floor(positionIndex / 2) * 90;
      this.state.players.set(claims.characterId, player);
    }
    player.connected = true;
    this.inputs.set(claims.characterId, { x: 0, y: 0, sequence: 0 });
    await this.registerPartyClient(client, claims);
    try {
      await this.pushSocialSnapshot(client, claims.characterId);
    } catch (error) {
      console.error(`[hideout-room:${this.roomId}] initial social snapshot failed\n${formatError(error)}`);
    }
  }

  async onLeave(client: Client, code: number): Promise<void> {
    const claims = client.auth as SessionClaims | undefined;
    if (!claims) return;
    const player = this.state.players.get(claims.characterId);
    if (!player) return;
    const remove = await this.releasePartyClient(client, code, claims, (connected) => { player.connected = connected; });
    if (!remove) return;
    this.inputs.delete(claims.characterId);
    this.state.players.delete(claims.characterId);
  }

  private receiveMovement(client: Client, command: MovementCommand): void {
    const claims = client.auth as SessionClaims | undefined;
    if (!claims) return;
    const input = this.inputs.get(claims.characterId);
    if (!input) return;
    if (command.sequence <= input.sequence) {
      client.send(SERVER_MESSAGES.rejected, { command: CLIENT_MESSAGES.movement, reason: "stale" });
      return;
    }
    const length = Math.hypot(command.x, command.y);
    input.x = length > 1 ? command.x / length : command.x;
    input.y = length > 1 ? command.y / length : command.y;
    input.sequence = command.sequence;
  }

  private simulate(deltaSeconds: number): void {
    this.state.serverTick += 1;
    const { margin, width, height } = MULTIPLAYER_LIMITS.world;
    for (const [characterId, input] of this.inputs) {
      const player = this.state.players.get(characterId);
      if (!player?.connected) continue;
      player.x = Math.max(margin, Math.min(width - margin, player.x + input.x * MULTIPLAYER_LIMITS.playerSpeed * deltaSeconds));
      player.y = Math.max(margin, Math.min(height - margin, player.y + input.y * MULTIPLAYER_LIMITS.playerSpeed * deltaSeconds));
      if (input.x !== 0 || input.y !== 0) {
        player.facingX = input.x;
        player.facingY = input.y;
      }
      player.lastProcessedSequence = input.sequence;
    }
  }

  private async pushSocialSnapshots(): Promise<void> {
    const requested = this.pendingSocialRefresh;
    this.pendingSocialRefresh = { party: false, trades: false, publicParties: false };
    const party = requested.party ? await this.services.parties.get(this.partyId) : null;
    const publicParties = requested.publicParties
      ? (await listPublicPartyListings(this.services.parties, this.services.players)).filter((listing) => listing.id !== this.partyId)
      : null;
    for (const [characterId, client] of this.activeClients) {
      if (requested.party) client.send(SERVER_MESSAGES.partySnapshot, { party } satisfies PartySnapshotMessage);
      if (requested.publicParties) client.send(SERVER_MESSAGES.publicParties, { parties: publicParties ?? [] } satisfies PublicPartiesMessage);
      if (!requested.trades || !this.services.trades) continue;
      const trades = await this.services.trades.listOpenTrades(characterId);
      client.send(SERVER_MESSAGES.tradeSnapshots, { trades } satisfies TradeSnapshotsMessage);
    }
  }

  private async pushSocialSnapshot(client: Client, characterId: string): Promise<void> {
    const party = await this.services.parties.get(this.partyId);
    client.send(SERVER_MESSAGES.partySnapshot, { party } satisfies PartySnapshotMessage);
    const publicParties = (await listPublicPartyListings(this.services.parties, this.services.players))
      .filter((listing) => listing.id !== this.partyId);
    client.send(SERVER_MESSAGES.publicParties, { parties: publicParties } satisfies PublicPartiesMessage);
    if (this.services.trades) {
      const trades = await this.services.trades.listOpenTrades(characterId);
      client.send(SERVER_MESSAGES.tradeSnapshots, { trades } satisfies TradeSnapshotsMessage);
    }
  }

  private onSocialInvalidation(event: SocialInvalidation): void {
    const partyRelevant = event.scope === "party" && (!event.partyIds?.length || event.partyIds.includes(this.partyId));
    const tradeRelevant = event.scope === "trade" && (!event.characterIds?.length
      || event.characterIds.some((characterId) => this.activeClients.has(characterId)));
    if (!partyRelevant && !tradeRelevant && !event.publicPartiesChanged) return;
    this.pendingSocialRefresh.party ||= partyRelevant;
    this.pendingSocialRefresh.trades ||= tradeRelevant;
    this.pendingSocialRefresh.publicParties ||= event.publicPartiesChanged === true;
    if (this.socialRefreshTimer) return;
    // Coalesce the several rows touched by one logical social operation into a
    // single snapshot read per room.
    this.socialRefreshTimer = setTimeout(() => {
      this.socialRefreshTimer = null;
      void this.pushSocialSnapshots().catch((error) => {
        console.error(`[hideout-room:${this.roomId}] social snapshot refresh failed\n${formatError(error)}`);
      });
    }, 25);
    this.socialRefreshTimer.unref();
  }
}
