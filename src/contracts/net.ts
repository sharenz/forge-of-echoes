// FROZEN CONTRACT — online protocol between the browser client and the authoritative game server.
//
// The server runs the rules (src/game) and the simulation (src/sim). The client renders and sends intent only.
//   HTTP (JSON)  : accounts, sessions, character list.
//   WebSocket    : everything in-game. Text frames = JSON messages below. Binary frames = world snapshots
//                  encoded by src/net (see SnapshotCodec).
import type { Attribute, SkillId, Theme } from './content';
import type { MerchantOffer, RunSetup } from './game';
import type { CharacterSave, Item, ItemLocation, ItemTone } from './items';
import type { PlayerIntent, PropView, SimEvent, WorldView } from './sim';

// Bump for incompatible wire changes OR shared-rule changes that require a fresh browser bundle.
// 2: level-based balance. Old tabs otherwise reconnect with stale tooltip and prediction rules.
// 3: phase-2 affix ladders, resistance scaling and immediate kill XP (no orbs).
// 4: freely assignable skills, RMB casting and stronger magic/rare monsters.
// 5: global chat channels and automatic special-stash routing from every stash tab.
// 6: account-wide storage, character item-ID namespaces and preserved legacy stash tabs.
// 7: account Atlas, area selection, entrance keys and revised map progression rewards.
// 8: hidden map-event plans and replicated encounter progress (snapshot 6).
// 9: Prefix/Suffix Runes, area ingredient sources and advanced equipment bases.
// 10: durable crafting history, Scrap services, Bounty maps and refundable territory fees.
// 11: six map themes, promoted final bosses, no wave-3 lieutenant and transferred completion rewards.
// 12: advanced ingredients, map crafting flags, four more events and independent twin bosses.
// 13: extended Atlas, sealed-area keys, fixed encounter chains and chosen-class rewards.
// 14: twelve boss-exclusive uniques, their icons and combat behaviours.
// 15: account map tree commands and frozen expedition modifiers.
export const PROTOCOL_VERSION = 15;
export const SERVER_PORT = 8787;
/** Snapshots are sent every SNAPSHOT_EVERY sim ticks (60 Hz / 2 = 30 Hz). */
export const SNAPSHOT_EVERY = 2;
/** Area-of-interest half extents around the receiving player (world units). */
export const AOI_HALF_WIDTH = 520;
export const AOI_HALF_HEIGHT = 340;
export const MAX_PARTY_SIZE = 4;
export const PORTALS_PER_MAP = 8;
/** Max items per side in a trade. */
export const TRADE_MAX_ITEMS = 12;
/** After either offer changes, accepting is blocked for this long (ms) so nobody can swap items at the last second. */
export const TRADE_ACCEPT_LOCK_MS = 2000;

// ---------------------------------------------------------------------------
// HTTP API (all JSON; auth via `Authorization: Bearer <token>`)
//   POST   /api/register          { username, password }           → AuthResponse
//   POST   /api/login             { username, password }           → AuthResponse
//   POST   /api/logout                                             → { ok: true }
//   GET    /api/me                                                 → MeResponse
//   POST   /api/characters        { name }                         → { character: CharacterSummary }
//   DELETE /api/characters/:id                                     → { ok: true }
//   GET    /api/health                                             → { ok: true, protocol }
// Errors: HTTP 4xx/5xx with { error: string } (player-facing text).
// Usernames 3–20 chars [A-Za-z0-9_]; passwords ≥ 8 chars; character names 3–16 chars, unique server-wide.
// ---------------------------------------------------------------------------

export interface AccountInfo {
  id: string;
  username: string;
}

export interface CharacterSummary {
  id: string;
  name: string;
  level: number;
  classId: string;
}

export interface AuthResponse {
  token: string;
  account: AccountInfo;
}

export interface MeResponse {
  account: AccountInfo;
  characters: CharacterSummary[];
}

// ---------------------------------------------------------------------------
// WebSocket: connect to `/ws?token=<token>&character=<id>&v=<PROTOCOL_VERSION>`.
// The server closes with code 4001 (bad auth), 4002 (protocol mismatch → client must reload),
// 4003 (character logged in elsewhere — the older socket is kicked), 4004 (server shutting down).
// ---------------------------------------------------------------------------

/** Loadout slot bits in InputMessage.held (bit i = slot i held). */
export type HeldMask = number;

export interface InputMessage {
  t: 'input';
  /** Monotonic per connection. The client sends one input per 60 Hz client tick (may batch). */
  seq: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  held: HeldMask;
  /** Belt slot pressed on this tick, or -1. */
  flask: number;
}

export type Command =
  // items & crafting (validated by the rules on the server)
  | { c: 'moveItem'; uid: string; to: ItemLocation; count?: number }
  | { c: 'quickMove'; uid: string; stashTab: number | 'currency' | 'mapCurrency' | 'maps' | null; count?: number }
  /** Deposit every currency stack in the backpack into the Crafting Stash (hideout only). */
  | { c: 'depositAllCurrency' }
  | { c: 'discardItem'; uid: string }
  | { c: 'applyCurrency'; currencyUid: string; targetUid: string; affixIndex?: number }
  | { c: 'addStashTab' }
  | { c: 'renameStashTab'; tab: number; name: string }
  | { c: 'clearNewFlags' }
  // character
  | { c: 'allocateAttribute'; attr: Attribute }
  | { c: 'rankUpSkill'; skillId: SkillId }
  | { c: 'setLoadoutSlot'; slot: number; skillId: SkillId | null }
  // hideout
  | { c: 'setMapTreeNode'; nodeId: import('./atlas').MapTreeNodeId; allocate: boolean }
  | { c: 'activateMapDevice'; areaId?: import('./atlas').AtlasAreaId; lootClass?: import('./content').ItemClass }
  | { c: 'merchantOffers' }
  | { c: 'buyOffer'; offerId: string }
  // party & social
  | { c: 'partyInvite'; name: string }
  | { c: 'partyRespond'; inviteId: string; accept: boolean }
  | { c: 'partyLeave' }
  | { c: 'partyKick'; characterId: string }
  | { c: 'partyPromote'; characterId: string }
  /** Travel to a party member's hideout (or your own with your own id). */
  | { c: 'visitHideout'; characterId: string }
  /**
   * Click a portal prop in the current instance: a hideout's map portal (enter the owner's map, costs a portal)
   * or a map's return portal (leave). Walking into a portal does the same.
   */
  | { c: 'usePortal'; propId: number }
  /** Click a ground item (own loot or a public drop). The client walks into PICKUP_REACH first. */
  | { c: 'pickup'; dropId: number }
  /** Drop an item you carry (backpack, equipment, belt; stash only in a hideout) on the floor at your feet — anyone in the area can pick it up. */
  | { c: 'dropItem'; uid: string }
  /** Crafting bench (any hideout): apply a deterministic bench recipe to an item you carry / have stashed. */
  | { c: 'benchCraft'; targetUid: string; recipeId: string; expectedScrap?: number }
  /** Crafting bench: remove the item's bench-crafted affix (free). */
  | { c: 'benchClear'; targetUid: string }
  /** Leave the current map (re-entering costs a portal). Goes to the map owner's hideout while you may visit it, else your own. */
  | { c: 'leaveMap' }
  /** Dead in a map → back to the map owner's hideout (or your own). */
  | { c: 'respawn' }
  | { c: 'chat'; text: string; channel?: ChatChannel }
  // --- trading (atomic, server-side; see TradeInfo) ---
  /** Ask an online player (by character name) to trade. */
  | { c: 'tradeRequest'; name: string }
  | { c: 'tradeRespond'; requestId: string; accept: boolean }
  /** Replace your whole offer with these item uids (backpack items only; max TRADE_MAX_ITEMS). Clears both accepts. */
  | { c: 'tradeOffer'; tradeId: string; uids: string[] }
  /** Lock in / unlock your acceptance. When both sides have accepted, the server swaps atomically. */
  | { c: 'tradeAccept'; tradeId: string; accept: boolean }
  | { c: 'tradeCancel'; tradeId: string };

export interface CommandMessage {
  t: 'cmd';
  /** Client-chosen request id, echoed in the result. */
  id: number;
  cmd: Command;
}

export interface PingMessage {
  t: 'ping';
  /** Client clock (ms). */
  time: number;
}

export type ClientMessage = InputMessage | CommandMessage | PingMessage;

// ---------------------------------------------------------------------------
// Server → client (JSON text frames)
// ---------------------------------------------------------------------------

export interface PortalInfo {
  ownerCharacterId: string;
  ownerName: string;
  mapName: string;
  tier: number;
  remaining: number;
  total: number;
  cleared: boolean;
}

export interface ZoneInfo {
  instanceId: string;
  kind: 'hideout' | 'map';
  ownerCharacterId: string;
  ownerName: string;
  theme: Theme;
  arenaRadius: number;
  mapName: string;
  tier: number;
  /** The receiving player's sim player id in this instance. */
  localPlayerId: number;
  /** Static props at the time of entry (dynamic props arrive in snapshots). */
  props: PropView[];
  /** Map zones: the run parameters (the client derives personal luck lines from them). */
  setup: RunSetup | null;
  /** Hideout zones: the owner's active map portal, if any. */
  portal: PortalInfo | null;
}

export interface PartyMemberInfo {
  characterId: string;
  name: string;
  level: number;
  online: boolean;
  isLeader: boolean;
  /** Where the member currently is. */
  zone: { kind: 'hideout' | 'map'; ownerName: string; mapName?: string; tier?: number } | null;
  /** The member's own open map (portals live in their hideout), if any. */
  activeMap: PortalInfo | null;
}

export type ChatChannel = 'global' | 'party';

export interface PartyInfo {
  id: string;
  leaderId: string;
  members: PartyMemberInfo[];
}

export interface PartyInvite {
  inviteId: string;
  fromCharacterId: string;
  fromName: string;
}

export interface RunSummaryInfo {
  result: 'cleared' | 'failed' | 'abandoned';
  mapName: string;
  tier: number;
  seconds: number;
  kills: number;
  xpGained: number;
  levelsGained: number;
  itemsFound: { label: string; tone: ItemTone }[];
}

export interface TradeRequestInfo {
  requestId: string;
  fromCharacterId: string;
  fromName: string;
}

/**
 * An open trade between the receiving player ("you") and a partner. Items are full copies so the client can
 * show tooltips. Any offer change clears both accepts and restarts TRADE_ACCEPT_LOCK_MS. When both accept,
 * the server checks both backpacks have room, then moves all items in one step and saves both characters
 * immediately; otherwise it answers with an error and leaves everything in place.
 */
export interface TradeInfo {
  tradeId: string;
  partnerCharacterId: string;
  partnerName: string;
  yourItems: Item[];
  theirItems: Item[];
  youAccepted: boolean;
  theyAccepted: boolean;
  /** Server time (ms) until which accepting is blocked after the last offer change. */
  acceptLockedUntil: number;
}

export type ServerMessage =
  | { t: 'welcome'; protocol: number; characterId: string; tickRate: number; serverTime: number }
  /** Full character state after any change (debounced ≤ 5 Hz). The client runs the shared rules for display only. */
  | { t: 'character'; character: CharacterSave }
  /** Entered a new instance. Clear the client world; snapshots for this instance follow. */
  | { t: 'zone'; zone: ZoneInfo }
  /** Portal state changed for the current hideout (opened, count changed, closed = null). */
  | { t: 'portal'; portal: PortalInfo | null }
  /** Cosmetic sim events for this client (AOI-filtered, capped by priority), batched with each snapshot. */
  | { t: 'events'; tick: number; events: SimEvent[] }
  | { t: 'result'; id: number; ok: boolean; error?: string; message?: string; offers?: MerchantOffer[] }
  | { t: 'toast'; text: string; tone: 'info' | 'good' | 'bad' | ItemTone }
  | { t: 'party'; party: PartyInfo | null }
  | { t: 'invite'; invite: PartyInvite }
  | { t: 'chat'; fromName: string; text: string; time: number; channel?: ChatChannel }
  | { t: 'runSummary'; summary: RunSummaryInfo }
  | { t: 'pong'; time: number; serverTime: number; serverTick: number }
  | { t: 'tradeRequest'; request: TradeRequestInfo }
  /** Current trade state (null = closed). `result` explains why it closed: completed / cancelled / failed text. */
  | { t: 'trade'; trade: TradeInfo | null; result?: string };

// ---------------------------------------------------------------------------
// Binary world snapshots (src/net implements; server encodes, client decodes)
// ---------------------------------------------------------------------------

export interface SnapshotEncoder {
  /**
   * Encode the part of `view` relevant to viewer `viewerId` (AOI-culled monsters/projectiles/motes/areas,
   * ALL players of the instance, the viewer's own drops + public drops (owner 0), dynamic props) plus the
   * viewer's last processed input seq.
   * Returns a standalone binary message.
   */
  encode(view: WorldView, viewerId: number, ackSeq: number): ArrayBuffer;
}

/**
 * Client-side replica of the world. Implements the same WorldView shape the presenter consumes, with
 * prev/current fields set to the two snapshots bracketing the render time (so `alpha` interpolation works),
 * and the local player predicted from inputs (replayed from the last acked seq on every snapshot).
 */
export interface ClientWorld {
  readonly view: WorldView;
  readonly localPlayerId: number;
  /** Server tick of the newest snapshot received. */
  readonly latestTick: number;
  /** Reset for a new zone (props, theme, arena, local player id). */
  setZone(zone: ZoneInfo): void;
  /** Feed a binary snapshot as it arrives (receivedAt = client ms). */
  pushSnapshot(data: ArrayBuffer, receivedAt: number): void;
  /**
   * Record a local input tick (the same message sent to the server) and advance the local prediction by one SIM_DT.
   */
  predict(input: InputMessage): void;
  /**
   * Advance the interpolation clock to client time `now` (ms). Returns the alpha (0..1) the presenter should use.
   * Remote entities render ~100 ms behind the newest snapshot; the local player renders at its predicted position.
   */
  update(now: number): number;
  /** Round-trip time estimate from ping/pong (ms). */
  setRtt(ms: number): void;
}

/** src/net/index.ts must export: createSnapshotEncoder(): SnapshotEncoder and createClientWorld(): ClientWorld. */
export type CreateSnapshotEncoder = () => SnapshotEncoder;
export type CreateClientWorld = () => ClientWorld;

/** Convert a held-state PlayerIntent to/from the wire input (shared helpers live in src/net). */
export type IntentFromInput = (input: InputMessage) => PlayerIntent;
