import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  ENABLED_CHARACTER_CLASS_IDS,
  MULTIPLAYER_LIMITS,
  acceptTradeRequestSchema,
  createCharacterRequestSchema,
  createTradeRequestSchema,
  accountSessionRequestSchema,
  joinPartyRequestSchema,
  openMapRequestSchema,
  profileCommandRequestSchema,
  selectCharacterRequestSchema,
  setTradeOfferRequestSchema,
  type AccountSessionClaims,
  type SessionClaims,
} from "../../multiplayer/protocol";
import { signAccountToken, verifyAccountToken } from "../auth/account-token";
import { signSessionToken, verifySessionToken } from "../auth/session-token";
import { formatError } from "../logging";
import { CharacterNameTakenError, CharacterNotFoundError, ItemLockedError, ProfileRevisionConflict } from "../persistence/errors";
import type { PlayerIdentity } from "../persistence/PlayerRepository";
import { TradeError } from "../persistence/TradeRepository";
import type { ServerServices } from "../services";
import { MapOpenError, MapService } from "../services/MapService";
import { PartyError, type PublicPartyListing } from "../services/PartyService";
import { ProfileCommandError, ProfileCommandService } from "../services/ProfileCommandService";

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "invalid_request", parsed.error.issues);
  return parsed.data;
}

function issuePlayerSession(player: PlayerIdentity, secret: string) {
  const claims = {
    sessionId: randomUUID(),
    ...player,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
  return { token: signSessionToken(claims, secret), player };
}

function requireSession(services: ServerServices): RequestHandler {
  return (request, response, next) => {
    const token = bearerToken(request.headers.authorization);
    const session = token ? verifySessionToken(token, services.authSecret) : null;
    if (!session) return void response.status(401).json({ error: "unauthorized" });
    (request as Request & { session?: SessionClaims }).session = session;
    next();
  };
}

function requireAccount(services: ServerServices): RequestHandler {
  return (request, response, next) => {
    const token = bearerToken(request.headers.authorization);
    const account = token ? verifyAccountToken(token, services.authSecret) : null;
    if (!account) return void response.status(401).json({ error: "unauthorized" });
    (request as Request & { account?: AccountSessionClaims }).account = account;
    next();
  };
}

function session(request: Request): SessionClaims {
  return (request as Request & { session: SessionClaims }).session;
}

function account(request: Request): AccountSessionClaims {
  return (request as Request & { account: AccountSessionClaims }).account;
}

function requireTrades(services: ServerServices) {
  if (!services.trades) throw new HttpError(503, "trading_unavailable");
  return services.trades;
}

function routeParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "invalid_request");
  return value;
}

export function createApiRouter(services: ServerServices): express.Router {
  const router = express.Router();
  const playerSession = requireSession(services);
  const accountSession = requireAccount(services);
  const profileCommands = new ProfileCommandService(services.players);
  const maps = new MapService(services.players, services.parties, services.authSecret);

  router.get("/health", (_request, response) => {
    response.json({ ok: true, service: "crafty-game-server", maximumPlayersPerRoom: MULTIPLAYER_LIMITS.playersPerRoom });
  });

  router.post("/accounts/session", async (request, response) => {
    const input = parseBody(accountSessionRequestSchema, request.body);
    const createdAccount = await services.players.createOrLoadAccount(input.handle);
    const characters = await services.players.listCharacters(createdAccount.accountId);
    const token = signAccountToken({
      sessionId: randomUUID(),
      accountId: createdAccount.accountId,
      scope: "account",
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    }, services.authSecret);
    response.json({ token, account: createdAccount, characters });
  });

  router.get("/accounts/characters", accountSession, async (request, response) => {
    response.json(await services.players.listCharacters(account(request).accountId));
  });

  router.post("/accounts/characters", accountSession, async (request, response) => {
    const input = parseBody(createCharacterRequestSchema, request.body);
    const created = await services.players.createCharacter(account(request).accountId, input);
    response.status(201).json({
      session: issuePlayerSession(created, services.authSecret),
      characters: await services.players.listCharacters(account(request).accountId),
    });
  });

  router.post("/accounts/select-character", accountSession, async (request, response) => {
    const input = parseBody(selectCharacterRequestSchema, request.body);
    const player = await services.players.findAccountCharacter(account(request).accountId, input.characterId);
    if (!player) throw new HttpError(404, "character_not_found");
    if (!(ENABLED_CHARACTER_CLASS_IDS as readonly string[]).includes(player.classId)) {
      throw new HttpError(409, "class_unavailable");
    }
    response.json(issuePlayerSession(player, services.authSecret));
  });

  router.get("/profile", playerSession, async (request, response) => {
    const authoritative = await services.players.loadProfile(session(request).characterId);
    if (!authoritative) throw new HttpError(404, "profile_not_found");
    response.json(authoritative);
  });

  router.post("/profile/commands", playerSession, async (request, response) => {
    const input = parseBody(profileCommandRequestSchema, request.body);
    response.json(await profileCommands.execute(session(request).characterId, input.revision, input.command));
  });

  router.post("/parties", playerSession, (request, response) => {
    response.status(201).json(services.parties.create(session(request).characterId));
  });

  router.post("/parties/solo", playerSession, (request, response) => {
    response.status(201).json(services.parties.createSolo(session(request).characterId));
  });

  router.get("/parties", playerSession, async (request, response) => {
    const activeSession = session(request);
    const listings: PublicPartyListing[] = [];
    for (const party of services.parties.listPublic()) {
      if (party.memberCharacterIds.includes(activeSession.characterId)) continue;
      const leader = await services.players.findCharacter(party.leaderCharacterId);
      if (!leader) continue;
      listings.push({
        id: party.id,
        name: `${leader.characterName}'s Party`,
        leader: {
          characterId: leader.characterId,
          characterName: leader.characterName,
          classId: leader.classId,
          level: leader.level,
        },
        memberCount: party.memberCharacterIds.length,
        maximumMembers: MULTIPLAYER_LIMITS.playersPerRoom,
        activity: party.activeMap ? "map" : "hideout",
        activeMap: party.activeMap ? { name: party.activeMap.map.baseName, tier: party.activeMap.map.tier } : null,
      });
    }
    response.json(listings);
  });

  router.get("/parties/current", playerSession, (request, response) => {
    const party = services.parties.getForMember(session(request).characterId);
    if (!party) throw new HttpError(404, "party_not_found");
    response.json(party);
  });

  router.post("/parties/join", playerSession, (request, response) => {
    const input = parseBody(joinPartyRequestSchema, request.body);
    response.json(services.parties.join(session(request).characterId, input.partyId));
  });

  router.post("/parties/leave", playerSession, (request, response) => {
    response.json({ party: services.parties.leave(session(request).characterId) });
  });

  router.post("/maps/open", playerSession, async (request, response) => {
    const input = parseBody(openMapRequestSchema, request.body);
    response.status(201).json(await maps.open(session(request).characterId, input.revision));
  });

  router.post("/trades", playerSession, async (request, response) => {
    const input = parseBody(createTradeRequestSchema, request.body);
    response.status(201).json(await requireTrades(services).createTrade(
      session(request).characterId,
      input.targetCharacterId,
    ));
  });

  router.get("/trades", playerSession, async (request, response) => {
    response.json(await requireTrades(services).listOpenTrades(session(request).characterId));
  });

  router.get("/trades/:tradeId", playerSession, async (request, response) => {
    response.json(await requireTrades(services).getTrade(routeParam(request.params.tradeId), session(request).characterId));
  });

  router.post("/trades/:tradeId/offer", playerSession, async (request, response) => {
    const input = parseBody(setTradeOfferRequestSchema, request.body);
    response.json(await requireTrades(services).setOffer(
      routeParam(request.params.tradeId),
      session(request).characterId,
      input.revision,
      input.itemIds,
    ));
  });

  router.post("/trades/:tradeId/accept", playerSession, async (request, response) => {
    const input = parseBody(acceptTradeRequestSchema, request.body);
    response.json(await requireTrades(services).acceptTrade(
      routeParam(request.params.tradeId),
      session(request).characterId,
      input.revision,
    ));
  });

  router.post("/trades/:tradeId/cancel", playerSession, async (request, response) => {
    response.json(await requireTrades(services).cancelTrade(routeParam(request.params.tradeId), session(request).characterId));
  });

  router.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
    void next;
    const mapped = mapError(error);
    if (!mapped) {
      console.error(`[http] ${request.method} ${request.path}\n${formatError(error)}`);
      response.status(500).json({ error: "internal_server_error" });
      return;
    }
    response.status(mapped.status).json({
      error: mapped.code,
      ...(mapped.message ? { message: mapped.message } : {}),
      ...(mapped.details ? { issues: mapped.details } : {}),
    });
  });
  return router;
}

function mapError(error: unknown): { status: number; code: string; message?: string; details?: unknown } | null {
  if (error instanceof HttpError) return { status: error.status, code: error.code, details: error.details };
  if (error instanceof CharacterNameTakenError) return { status: 409, code: "character_name_taken", message: "That character name is already taken." };
  if (error instanceof CharacterNotFoundError) return { status: 404, code: "character_not_found" };
  if (error instanceof ProfileRevisionConflict) return { status: 409, code: "revision_conflict" };
  if (error instanceof ItemLockedError) return { status: 409, code: "item_locked" };
  if (error instanceof ProfileCommandError) {
    return { status: error.code === "not_found" ? 404 : error.code === "revision_conflict" ? 409 : 422, code: error.code, message: error.message };
  }
  if (error instanceof PartyError) {
    return { status: error.code === "not_found" ? 404 : error.code === "party_full" || error.code === "already_in_party" ? 409 : 422, code: error.code };
  }
  if (error instanceof MapOpenError) {
    return { status: error.code === "not_found" ? 404 : error.code === "revision_conflict" ? 409 : 422, code: error.code };
  }
  if (error instanceof TradeError) {
    return {
      status: error.code === "not_found" ? 404
        : error.code === "revision_conflict" || error.code === "item_locked" ? 409
          : error.code === "unauthorized" ? 403 : 422,
      code: error.code,
    };
  }
  return null;
}
