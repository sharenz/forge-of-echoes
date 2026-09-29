// UiState and the pure reducers that fold server messages and client events into it. The store (store.ts)
// owns identity and notification; everything here is (state, input) → new state, covered by tests/client.
import type { DerivedStats, RunSetup } from '../contracts/game';
import type { CharacterSave, Settings } from '../contracts/items';
import type { PartyInfo, PartyInvite, RunSummaryInfo, TradeInfo, TradeRequestInfo, ZoneInfo } from '../contracts/net';
import type { ChatLine, Panel, Toast, UiState } from '../contracts/ui';
import { provisionalHud } from './hud';

/** Toasts kept in state (the UI shows the newest three and dismisses each after ~5 s). */
export const MAX_TOASTS = 8;
/** Chat lines kept for scrollback. */
export const MAX_CHAT_LINES = 120;
/** Invites shown at once (the session drops stale cards; see INVITE_TTL_MS). */
export const MAX_INVITES = 4;
/** Trade request cards shown at once (the session drops stale cards; see TRADE_REQUEST_CARD_TTL_MS). */
export const MAX_TRADE_REQUESTS = 4;
/** The disconnected screen's headline while the server restarts for an update (close 4004, GAME_SPEC §11). */
export const SERVER_UPDATING_TEXT = 'Server updating — reconnecting…';
/** Panels tied to a hideout object: they close whenever the player changes zone. */
export const ZONE_PANELS: readonly Panel[] = ['stash', 'mapDevice', 'merchant', 'craftingBench'];

export function initialUiState(settings: Settings): UiState {
  return {
    screen: 'loading',
    connection: 'offline',
    error: null,
    busy: false,
    account: null,
    characters: [],
    character: null,
    derived: null,
    zone: null,
    openPanels: [],
    stashTab: 0,
    armed: null,
    affixChoice: null,
    craftingAllowed: false,
    isOwnHideout: false,
    benchItemUid: null,
    trade: null,
    tradeRequests: [],
    serverClockOffset: 0,
    run: null,
    hud: null,
    toasts: [],
    runSummary: null,
    party: null,
    invites: [],
    chat: [],
    chatOpen: false,
    paused: false,
    settings,
    altHeld: false,
    levelUpCount: 0,
  };
}

/** Everything in-game reset (leaving the game for character select / auth). Account data and settings stay. */
export function leaveGameState(s: UiState): UiState {
  return {
    ...s,
    character: null,
    derived: null,
    zone: null,
    openPanels: [],
    stashTab: 0,
    armed: null,
    affixChoice: null,
    craftingAllowed: false,
    isOwnHideout: false,
    benchItemUid: null,
    trade: null,
    tradeRequests: [],
    run: null,
    hud: null,
    toasts: [],
    runSummary: null,
    party: null,
    invites: [],
    chat: [],
    chatOpen: false,
    paused: false,
    altHeld: false,
  };
}

export function pushToast(s: UiState, toast: Toast): UiState {
  const toasts = [...s.toasts, toast];
  return { ...s, toasts: toasts.length > MAX_TOASTS ? toasts.slice(-MAX_TOASTS) : toasts };
}

export function dismissToast(s: UiState, id: number): UiState {
  return s.toasts.some((t) => t.id === id) ? { ...s, toasts: s.toasts.filter((t) => t.id !== id) } : s;
}

export function pushChat(s: UiState, line: ChatLine): UiState {
  const chat = [...s.chat, line];
  return { ...s, chat: chat.length > MAX_CHAT_LINES ? chat.slice(-MAX_CHAT_LINES) : chat };
}

/** A new invite (a repeated invite from the same player replaces the older one). */
export function addInvite(s: UiState, invite: PartyInvite): UiState {
  const others = s.invites.filter((i) => i.inviteId !== invite.inviteId && i.fromCharacterId !== invite.fromCharacterId);
  return { ...s, invites: [...others, invite].slice(-MAX_INVITES) };
}

export function removeInvite(s: UiState, inviteId: string): UiState {
  return s.invites.some((i) => i.inviteId === inviteId) ? { ...s, invites: s.invites.filter((i) => i.inviteId !== inviteId) } : s;
}

/** Party update. Invites from people who are now in our party are moot. */
export function withParty(s: UiState, party: PartyInfo | null): UiState {
  const members = new Set(party?.members.map((m) => m.characterId) ?? []);
  const invites = s.invites.filter((i) => !members.has(i.fromCharacterId));
  return { ...s, party, invites: invites.length === s.invites.length ? s.invites : invites };
}

/**
 * A new authoritative (or optimistic) character. `hasItem` answers whether a uid still exists on it, so an armed
 * currency stack that was used up disarms itself and an item that left (dropped, traded, discarded) leaves the
 * crafting bench. A higher level than before bumps levelUpCount (UI burst).
 */
export function withCharacter(s: UiState, ch: CharacterSave, derived: DerivedStats | null, hasItem: (uid: string) => boolean): UiState {
  const levelUp = !!s.character && s.character.id === ch.id && ch.level > s.character.level;
  let armed = s.armed;
  let affixChoice = s.affixChoice;
  if (armed && !hasItem(armed.uid)) armed = null;
  if (affixChoice && (!hasItem(affixChoice.currencyUid) || !hasItem(affixChoice.targetUid))) affixChoice = null;
  const benchItemUid = s.benchItemUid && !hasItem(s.benchItemUid) ? null : s.benchItemUid;
  const stashTab = Math.min(s.stashTab, Math.max(0, ch.stash.length - 1));
  return {
    ...s,
    character: ch,
    derived,
    armed,
    affixChoice,
    benchItemUid,
    stashTab,
    levelUpCount: s.levelUpCount + (levelUp ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------------------------

/** An incoming trade request (a repeated request from the same player replaces the older card). */
export function addTradeRequest(s: UiState, request: TradeRequestInfo): UiState {
  const others = s.tradeRequests.filter((r) => r.requestId !== request.requestId && r.fromCharacterId !== request.fromCharacterId);
  return { ...s, tradeRequests: [...others, request].slice(-MAX_TRADE_REQUESTS) };
}

export function removeTradeRequest(s: UiState, requestId: string): UiState {
  return s.tradeRequests.some((r) => r.requestId === requestId)
    ? { ...s, tradeRequests: s.tradeRequests.filter((r) => r.requestId !== requestId) }
    : s;
}

/**
 * The trade window's state from the server ('trade' message) or an optimistic change. A NEW trade (another
 * tradeId) opens the 'trade' panel and retires the partner's request cards; later updates of the same trade
 * leave the panels alone (the player may have tucked the window behind another panel). null closes the panel.
 */
export function withTrade(s: UiState, trade: TradeInfo | null): UiState {
  if (trade === s.trade) return s;
  if (!trade) {
    const next = { ...s, trade: null };
    return s.openPanels.includes('trade') ? closePanel(next, 'trade') : next;
  }
  const isNew = s.trade?.tradeId !== trade.tradeId;
  if (!isNew) return { ...s, trade };
  const requests = s.tradeRequests.filter((r) => r.fromCharacterId !== trade.partnerCharacterId);
  const next: UiState = { ...s, trade, tradeRequests: requests.length === s.tradeRequests.length ? s.tradeRequests : requests };
  return openPanel(next, 'trade');
}

/** Server clock offset (ms): serverTime ≈ Date.now() + offset. */
export function withServerClockOffset(s: UiState, offset: number): UiState {
  const o = Number.isFinite(offset) ? Math.round(offset) : 0;
  return o === s.serverClockOffset ? s : { ...s, serverClockOffset: o };
}

/**
 * Entering an instance (hideout or map). `resumed`: the same instance again after a reconnect — the player never
 * left, so the stash / device / merchant panels stay open and the HUD stays as it is.
 */
export function withZone(s: UiState, zone: ZoneInfo, characterId: string | null, resumed = false): UiState {
  const inMap = zone.kind === 'map';
  const own = zone.ownerCharacterId === characterId;
  const craftingAllowed = zone.kind === 'hideout';
  const openPanels = resumed ? s.openPanels : s.openPanels.filter((p) => !ZONE_PANELS.includes(p));
  return {
    ...s,
    screen: 'game',
    error: null,
    busy: false,
    zone: zone.kind,
    isOwnHideout: zone.kind === 'hideout' && own,
    craftingAllowed,
    armed: craftingAllowed ? s.armed : null,
    affixChoice: craftingAllowed ? s.affixChoice : null,
    // In a map: its setup. Back home: keep the last map's setup only while its summary is up.
    run: inMap ? zone.setup : s.runSummary ? s.run : null,
    openPanels: openPanels.length === s.openPanels.length ? s.openPanels : openPanels,
    // Until the new zone's first snapshot: the old HUD re-labelled (no blink of the command deck).
    hud: resumed || !s.hud ? s.hud : provisionalHud(s.hud, zone, characterId),
  };
}

/** The run summary after leaving a map; `setup` is the map just left (kept for the summary's mod colours). */
export function withRunSummary(s: UiState, summary: RunSummaryInfo, setup: RunSetup | null): UiState {
  return { ...s, runSummary: summary, run: s.zone === 'map' ? s.run : setup ?? s.run };
}

export function withoutRunSummary(s: UiState): UiState {
  return { ...s, runSummary: null, run: s.zone === 'map' ? s.run : null };
}

/**
 * The server is restarting for an update (4004): the calm "Server updating — reconnecting…" screen (connection
 * 'reconnecting'), not an error. The game state underneath — character, party, zone, panels — stays for the resume.
 */
export function withServerUpdating(s: UiState): UiState {
  if (s.screen === 'disconnected' && s.error === SERVER_UPDATING_TEXT && !s.busy && !s.paused) return s;
  return { ...s, screen: 'disconnected', error: SERVER_UPDATING_TEXT, busy: false, paused: false };
}

/** Open/close panels keeping order (the newest is last; the UI resolves sides and fix-ups). */
export function openPanel(s: UiState, panel: Panel): UiState {
  return s.openPanels.includes(panel) ? s : { ...s, openPanels: [...s.openPanels, panel] };
}

export function closePanel(s: UiState, panel: Panel): UiState {
  return s.openPanels.includes(panel) ? { ...s, openPanels: s.openPanels.filter((p) => p !== panel) } : s;
}

export function togglePanel(s: UiState, panel: Panel): UiState {
  return s.openPanels.includes(panel) ? closePanel(s, panel) : openPanel(s, panel);
}
