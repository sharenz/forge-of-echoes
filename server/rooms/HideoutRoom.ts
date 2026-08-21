import type { Client } from "colyseus";
import {
  CLIENT_MESSAGES,
  MULTIPLAYER_LIMITS,
  SERVER_MESSAGES,
  joinHideoutOptionsSchema,
  movementCommandSchema,
  type MovementCommand,
  type SessionClaims,
} from "../../multiplayer/protocol";
import { verifySessionToken } from "../auth/session-token";
import { getServerServices } from "../services";
import { HideoutState, NetworkPlayer } from "../state/HideoutState";
import { PartyRoom } from "./PartyRoom";

interface PlayerInput {
  x: number;
  y: number;
  sequence: number;
}

export class HideoutRoom extends PartyRoom<HideoutState> {
  state = new HideoutState();
  private readonly inputs = new Map<string, PlayerInput>();

  async onCreate(rawOptions: unknown): Promise<void> {
    const options = joinHideoutOptionsSchema.safeParse(rawOptions);
    if (!options.success) throw new Error("A party is required to create a hideout room");
    const services = getServerServices();
    const session = verifySessionToken(options.data.token, services.authSecret);
    const party = session ? await services.parties.get(options.data.partyId) : null;
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
  }

  async onAuth(_client: Client, rawOptions: unknown): Promise<SessionClaims | false> {
    const options = joinHideoutOptionsSchema.safeParse(rawOptions);
    if (!options.success) return false;
    const services = getServerServices();
    const session = verifySessionToken(options.data.token, services.authSecret);
    if (!session || options.data.partyId !== this.partyId || !await services.parties.isMember(this.partyId, session.characterId)) return false;
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
}
