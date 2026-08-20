import { z } from "zod";
import type { CharacterClassId, DamageType, MonsterRarity, PlayerProfile } from "../app/game/domain";
import type { MonsterArchetypeId } from "../app/game/config/monsters";
import { MERCHANTS, type MerchantId } from "../app/game/config/merchants";

export const MULTIPLAYER_LIMITS = {
  playersPerRoom: 4,
  portalsPerMap: 6,
  simulationHz: 20,
  statePatchHz: 20,
  maximumClientMessagesPerSecond: 30,
  reconnectSeconds: 12,
  partyPresenceGraceMilliseconds: 15_000,
  world: { width: 960, height: 960, margin: 32 },
  playerSpeed: 190,
} as const;

// Session claims can represent existing characters; new roster entries are
// restricted independently to classes that are ready for players.
export const ENABLED_CHARACTER_CLASS_IDS = ["sorceress"] as const satisfies readonly CharacterClassId[];

export const CLIENT_MESSAGES = {
  movement: "player/movement",
  attack: "player/attack",
  pickup: "player/pickup",
  dropItem: "player/drop-item",
  refreshProfile: "player/refresh-profile",
  useFlask: "player/use-flask",
  prepareMapExit: "map/prepare-exit",
  requestWorldSync: "world/request-sync",
} as const;

export const SERVER_MESSAGES = {
  rejected: "command/rejected",
  profileUpdated: "profile/updated",
  worldEvents: "world/events",
  monsterSnapshot: "world/monster-snapshot",
  monsterLifecycle: "world/monster-lifecycle",
  dropPayload: "drop/payload",
  pickupResult: "pickup/result",
  mapExitReady: "map/exit-ready",
} as const;

export const sessionClaimsSchema = z.object({
  sessionId: z.string().uuid(),
  accountId: z.string().uuid(),
  characterId: z.string().uuid(),
  characterName: z.string().trim().min(1).max(24),
  classId: z.enum(["amazon", "barbarian", "sorceress"] satisfies CharacterClassId[]),
  expiresAt: z.number().int().positive(),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export const accountSessionClaimsSchema = z.object({
  sessionId: z.string().uuid(),
  accountId: z.string().uuid(),
  scope: z.literal("account"),
  expiresAt: z.number().int().positive(),
});

export type AccountSessionClaims = z.infer<typeof accountSessionClaimsSchema>;

export const mapTicketClaimsSchema = z.object({
  ticketId: z.string().uuid(),
  mapItemId: z.string().uuid(),
  ownerCharacterId: z.string().uuid(),
  allowedCharacterIds: z.array(z.string().uuid()).min(1).max(MULTIPLAYER_LIMITS.playersPerRoom),
  tier: z.number().int().min(1).max(20),
  seed: z.number().int().nonnegative().max(0x7fffffff),
  expiresAt: z.number().int().positive(),
}).strict();

export type MapTicketClaims = z.infer<typeof mapTicketClaimsSchema>;

export const joinRoomOptionsSchema = z.object({
  token: z.string().min(32).max(4096),
}).strict();

export const joinHideoutOptionsSchema = joinRoomOptionsSchema.extend({
  partyId: z.string().uuid(),
}).strict();

export const joinMapOptionsSchema = joinRoomOptionsSchema.extend({
  mapTicket: z.string().min(32).max(4096),
  portalIndex: z.number().int().min(0).max(MULTIPLAYER_LIMITS.portalsPerMap - 1),
}).strict();

export const movementCommandSchema = z.object({
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  x: z.number().finite().min(-1).max(1),
  y: z.number().finite().min(-1).max(1),
}).strict();

export type MovementCommand = z.infer<typeof movementCommandSchema>;

export const attackCommandSchema = z.object({
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  skill: z.enum(["basic", "nova", "dash", "ward", "flameWave"]),
  direction: z.object({ x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1) }).strict().optional(),
}).strict().superRefine((command, context) => {
  if ((command.skill === "basic" || command.skill === "dash" || command.skill === "flameWave") && !command.direction) {
    context.addIssue({ code: "custom", message: `${command.skill} requires a direction`, path: ["direction"] });
  }
});

export type AttackCommand = z.infer<typeof attackCommandSchema>;

export type CombatEvent =
  | {
      kind: "skill";
      actorCharacterId: string;
      sequence: number;
      skill: AttackCommand["skill"];
      direction: { x: number; y: number };
    }
  | {
      kind: "damage";
      actorCharacterId: string;
      sequence: number;
      skill: AttackCommand["skill"];
      targetId: number;
      targetX: number;
      targetY: number;
      amount: number;
      damageType: DamageType;
      evaded: boolean;
    }
  | {
      kind: "monster-action";
      monsterId: number;
      targetCharacterId: string;
      action: "melee" | "ranged" | "jump";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      durationMilliseconds: number;
      projectileId?: number;
      projectileRange?: number;
    }
  | {
      kind: "monster-aggro";
      monsterId: number;
      archetypeId: MonsterArchetypeId;
      x: number;
      y: number;
    }
  | {
      kind: "monster-death";
      monsterId: number;
      archetypeId: MonsterArchetypeId;
      rarity: MonsterRarity;
      x: number;
      y: number;
    }
  | {
      kind: "projectile-spawn";
      projectileId: number;
      actorCharacterId: string;
      sequence: number;
      skill: AttackCommand["skill"];
      originX: number;
      originY: number;
      direction: { x: number; y: number };
      speed: number;
    }
  | {
      kind: "projectile-hit";
      projectileId: number;
      targetId: number;
      x: number;
      y: number;
    }
  | {
      kind: "projectile-expire";
      projectileId: number;
      x: number;
      y: number;
    }
  | {
      kind: "monster-projectile-terminal";
      projectileId: number;
      x: number;
      y: number;
      hit: boolean;
    };

export const pickupCommandSchema = z.object({
  dropId: z.string().uuid(),
}).strict();

export const prepareMapExitCommandSchema = z.object({
  requestId: z.string().uuid(),
}).strict();

export interface PickupResultMessage {
  dropId: string;
  status: "collected" | "rejected";
  reason?: RejectedCommandMessage["reason"];
}

export interface MapExitReadyMessage {
  requestId: string;
  authoritativeProfile: { profile: PlayerProfile; revision: number };
}

export const dropItemCommandSchema = z.object({ itemId: z.string().uuid() }).strict();

export const refreshProfileCommandSchema = z.object({}).strict();

export const useFlaskCommandSchema = z.object({ slot: z.number().int().min(0).max(4) }).strict();

export const accountSessionRequestSchema = z.object({
  handle: z.string().trim().min(2).max(24).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

export const createCharacterRequestSchema = z.object({
  characterName: z.string().trim().min(2).max(24).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  classId: z.enum(ENABLED_CHARACTER_CLASS_IDS),
}).strict();

export const selectCharacterRequestSchema = z.object({
  characterId: z.string().uuid(),
}).strict();

const itemIdSchema = z.string().uuid();
const merchantIdSchema = z.enum(Object.keys(MERCHANTS) as [MerchantId, ...MerchantId[]]);
const characterEquipmentSlotSchema = z.enum([
  "helmet", "mainHand", "offHand", "amulet", "ringLeft", "ringRight", "chest", "gloves", "boots", "belt",
]);

export const profileCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move_item"),
    itemId: itemIdSchema,
    destination: z.enum(["backpack", "stash"]),
    stashTabId: z.string().trim().min(1).max(64).optional(),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(7),
  }).strict(),
  z.object({ type: z.literal("equip_item"), itemId: itemIdSchema, slot: characterEquipmentSlotSchema }).strict(),
  z.object({ type: z.literal("allocate_attribute"), attribute: z.enum(["strength", "dexterity", "intelligence"]) }).strict(),
  z.object({ type: z.literal("allocate_skill"), skill: z.enum(["nova", "dash", "ward", "flameWave"]) }).strict(),
  z.object({ type: z.literal("load_flask"), itemId: itemIdSchema, slot: z.number().int().min(0).max(4) }).strict(),
  z.object({ type: z.literal("unload_flask"), slot: z.number().int().min(0).max(4) }).strict(),
  z.object({ type: z.literal("select_stash_tab"), tabId: z.string().trim().min(1).max(64) }).strict(),
  z.object({ type: z.literal("rename_stash_tab"), tabId: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(24) }).strict(),
  z.object({ type: z.literal("create_stash_tab") }).strict(),
  z.object({ type: z.literal("slot_map"), itemId: itemIdSchema }).strict(),
  z.object({ type: z.literal("remove_map") }).strict(),
  z.object({ type: z.literal("apply_currency"), currencyItemId: itemIdSchema, targetItemId: itemIdSchema }).strict(),
  z.object({
    type: z.literal("buy_merchant_offer"),
    merchantId: merchantIdSchema,
    offerId: z.string().trim().min(1).max(64),
    position: z.object({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(4) }).strict().optional(),
  }).strict(),
]);

export type ProfileCommand = z.infer<typeof profileCommandSchema>;

export const profileCommandRequestSchema = z.object({
  revision: z.number().int().positive(),
  command: profileCommandSchema,
}).strict();

export const joinPartyRequestSchema = z.object({
  partyId: z.string().uuid(),
}).strict();

export const openMapRequestSchema = z.object({
  revision: z.number().int().positive(),
}).strict();

export const createTradeRequestSchema = z.object({
  targetCharacterId: z.string().uuid(),
}).strict();

export const setTradeOfferRequestSchema = z.object({
  revision: z.number().int().positive(),
  itemIds: z.array(itemIdSchema).max(24).refine((ids) => new Set(ids).size === ids.length, "Duplicate item IDs are not allowed"),
}).strict();

export const acceptTradeRequestSchema = z.object({
  revision: z.number().int().positive(),
}).strict();

export interface RejectedCommandMessage {
  command: string;
  reason: "invalid" | "stale" | "unauthorized" | "rate_limited" | "projectile_capacity" | "inventory_full" | "conflict" | "item_locked" | "server_error";
}
