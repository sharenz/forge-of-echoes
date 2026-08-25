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
import { PartyError } from "../coordination/PartyCoordinator";
import { ProfileCommandError, ProfileCommandService } from "../services/ProfileCommandService";
import { AccountAuthError, AccountAuthService } from "../services/AccountAuthService";
import { listPublicPartyListings } from "../services/PublicPartyService";
import { createRateLimiter } from "./rateLimit";
import type { SocialInvalidation } from "../social/SocialEventBus";
import { serverDrain } from "../observability/ServerDrain";

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

function issuePlayerSession(player: PlayerIdentity, authSessionId: string, secret: string) {
  const claims = {
    sessionId: randomUUID(),
    authSessionId,
    ...player,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
  return { token: signSessionToken(claims, secret), player };
}

function requireSession(services: ServerServices): RequestHandler {
  return async (request, response, next) => {
    const token = bearerToken(request.headers.authorization);
    const session = token ? verifySessionToken(token, services.authSecret) : null;
    if (!session || !await services.players.isAuthSessionActive(session.authSessionId, session.accountId)) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    (request as Request & { session?: SessionClaims }).session = session;
    next();
  };
}

function requireAccount(services: ServerServices): RequestHandler {
  return async (request, response, next) => {
    const token = bearerToken(request.headers.authorization);
    const account = token ? verifyAccountToken(token, services.authSecret) : null;
    if (!account || !await services.players.isAuthSessionActive(account.sessionId, account.accountId)) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
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

async function publishSocial(services: ServerServices, event: SocialInvalidation): Promise<void> {
  try {
    await services.social?.publish(event);
  } catch (error) {
    // The committed database mutation remains authoritative. A failed hint is
    // observable, while clients recover on their next relevant room join.
    console.error(`[social-events] publish failed\n${formatError(error)}`);
  }
}

export function createApiRouter(services: ServerServices): express.Router {
  const router = express.Router();
  const playerSession = requireSession(services);
  const accountSession = requireAccount(services);
  const profileCommands = new ProfileCommandService(services.players);
  const accountAuth = new AccountAuthService(services.players);
  const maps = new MapService(services.players, services.parties, services.expeditions, services.authSecret);
  // Credential endpoints are the unauthenticated abuse surface: a strict
  // per-client window caps scrypt work and registration spam, while the
  // whole API keeps a generous ceiling. trustedProxyHops=1 matches the
  // single Caddy hop in deploy/Caddyfile.
  const authenticationLimiter = createRateLimiter({ windowMilliseconds: 60_000, maximumRequests: 30, trustedProxyHops: 1 });
  const apiLimiter = createRateLimiter({ windowMilliseconds: 60_000, maximumRequests: 600, trustedProxyHops: 1 });

  router.get("/health", (_request, response) => {
    response.json({ ok: true, service: "forge-of-echoes-game-server", maximumPlayersPerRoom: MULTIPLAYER_LIMITS.playersPerRoom });
  });
  router.use(apiLimiter);
  router.post("/accounts/session", authenticationLimiter, async (request, response) => {
    const input = parseBody(accountSessionRequestSchema, request.body);
    const authenticated = await accountAuth.authenticate(input.handle, input.password, input.mode);
    const characters = await services.players.listCharacters(authenticated.account.accountId);
    const token = signAccountToken({
      sessionId: authenticated.sessionId,
      accountId: authenticated.account.accountId,
      scope: "account",
      expiresAt: authenticated.expiresAt,
    }, services.authSecret);
    response.json({ token, account: authenticated.account, characters });
  });

  router.post("/accounts/logout", accountSession, async (request, response) => {
    const claims = account(request);
    await services.players.revokeAuthSession(claims.sessionId, claims.accountId);
    response.status(204).end();
  });

  router.get("/accounts/characters", accountSession, async (request, response) => {
    response.json(await services.players.listCharacters(account(request).accountId));
  });

  router.post("/accounts/characters", accountSession, async (request, response) => {
    const input = parseBody(createCharacterRequestSchema, request.body);
    const created = await services.players.createCharacter(account(request).accountId, input);
    response.status(201).json({
      session: issuePlayerSession(created, account(request).sessionId, services.authSecret),
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
    response.json(issuePlayerSession(player, account(request).sessionId, services.authSecret));
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

  router.post("/parties", playerSession, async (request, response) => {
    const party = await services.parties.create(session(request).characterId);
    await publishSocial(services, { scope: "party", partyIds: [party.id], publicPartiesChanged: true });
    response.status(201).json(party);
  });

  router.post("/parties/solo", playerSession, async (request, response) => {
    const party = await services.parties.createSolo(session(request).characterId);
    await publishSocial(services, { scope: "party", partyIds: [party.id] });
    response.status(201).json(party);
  });

  router.get("/parties", playerSession, async (request, response) => {
    response.json(await listPublicPartyListings(services.parties, services.players, session(request).characterId));
  });

  router.get("/parties/current", playerSession, async (request, response) => {
    const party = await services.parties.getForMember(session(request).characterId);
    if (!party) throw new HttpError(404, "party_not_found");
    response.json(party);
  });

  router.post("/parties/join", playerSession, async (request, response) => {
    const input = parseBody(joinPartyRequestSchema, request.body);
    const party = await services.parties.join(session(request).characterId, input.partyId);
    await publishSocial(services, { scope: "party", partyIds: [party.id], publicPartiesChanged: true });
    response.json(party);
  });

  router.post("/parties/leave", playerSession, async (request, response) => {
    const party = await services.parties.leave(session(request).characterId);
    await publishSocial(services, { scope: "party", partyIds: party ? [party.id] : undefined, publicPartiesChanged: true });
    response.json({ party });
  });

  router.post("/maps/open", playerSession, async (request, response) => {
    if (serverDrain.isDraining) throw new HttpError(503, "server_draining");
    const input = parseBody(openMapRequestSchema, request.body);
    const opened = await maps.open(session(request).characterId, input.revision);
    await publishSocial(services, { scope: "party", partyIds: [opened.partyId], publicPartiesChanged: true });
    response.status(201).json(opened);
  });

  router.post("/trades", playerSession, async (request, response) => {
    const input = parseBody(createTradeRequestSchema, request.body);
    const trade = await requireTrades(services).createTrade(
      session(request).characterId,
      input.targetCharacterId,
    );
    await publishSocial(services, { scope: "trade", characterIds: trade.participants });
    response.status(201).json(trade);
  });

  router.get("/trades", playerSession, async (request, response) => {
    response.json(await requireTrades(services).listOpenTrades(session(request).characterId));
  });

  router.get("/trades/:tradeId", playerSession, async (request, response) => {
    response.json(await requireTrades(services).getTrade(routeParam(request.params.tradeId), session(request).characterId));
  });

  router.post("/trades/:tradeId/offer", playerSession, async (request, response) => {
    const input = parseBody(setTradeOfferRequestSchema, request.body);
    const trade = await requireTrades(services).setOffer(
      routeParam(request.params.tradeId),
      session(request).characterId,
      input.revision,
      input.itemIds,
    );
    await publishSocial(services, { scope: "trade", characterIds: trade.participants });
    response.json(trade);
  });

  router.post("/trades/:tradeId/accept", playerSession, async (request, response) => {
    const input = parseBody(acceptTradeRequestSchema, request.body);
    const trade = await requireTrades(services).acceptTrade(
      routeParam(request.params.tradeId),
      session(request).characterId,
      input.revision,
    );
    await publishSocial(services, { scope: "trade", characterIds: trade.participants });
    response.json(trade);
  });

  router.post("/trades/:tradeId/cancel", playerSession, async (request, response) => {
    const trade = await requireTrades(services).cancelTrade(routeParam(request.params.tradeId), session(request).characterId);
    await publishSocial(services, { scope: "trade", characterIds: trade.participants });
    response.json(trade);
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
  if (error instanceof AccountAuthError) {
    if (error.code === "account_locked") {
      return { status: 429, code: "account_locked", message: "Too many failed sign-in attempts. Try again in a few minutes." };
    }
    return {
      status: error.code === "account_exists" ? 409 : 401,
      code: error.code,
      message: error.code === "account_exists" ? "That player name is already registered." : "Player name or password is incorrect.",
    };
  }
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
