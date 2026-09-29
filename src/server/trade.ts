// Trading (GAME_SPEC §12): requests by character name, a two-sided offer window, and an atomic swap.
//
//   tradeRequest  → the target (online anywhere on the server) gets { t: 'tradeRequest' }; the requester a toast.
//                   A repeated request only renews the pending one (expires after TRADE_REQUEST_TTL_MS); two
//                   players who ask each other open the trade at once. After a decline the same requester
//                   waits TRADE_DECLINE_COOLDOWN_MS; requests are rate-limited per requester.
//   tradeRespond  → accept opens the trade for both ({ t: 'trade' } to each side); decline tells the requester.
//   tradeOffer    → replaces your whole offer (backpack items, ≤ TRADE_MAX_ITEMS, distinct, existing). Any
//                   change clears BOTH accepts and blocks accepting until now + TRADE_ACCEPT_LOCK_MS.
//   tradeAccept   → refused while blocked. When both sides have accepted: the offers are compared with the
//                   live characters (defence in depth), then rules' tradeItems swaps everything in one step
//                   (all or nothing: both give first, then each backpack must take the other's items). On
//                   failure nothing moves, both accepts clear and both players read why; the trade stays
//                   open. On success both characters are committed and saved in ONE transaction, and both get
//                   { t: 'trade', trade: null, result: 'Trade completed' } plus a toast.
//   tradeCancel   → closes it for both (result names who cancelled).
// A trade is cancelled when either side disconnects or their session ends, and at shutdown (trades live
// in memory only). It works across instances. While an item is offered it is LOCKED: the Game handles
// commands and pickups with rules wrapped by withItemLocks(…, lockedUids) and refuses direct hits with
// ITEM_IN_TRADE; characterChanged() re-validates an offer after any change to its owner.
import type { Item } from '../contracts/items';
import { TRADE_ACCEPT_LOCK_MS } from '../contracts/net';
import type { TradeInfo, TradeRequestInfo } from '../contracts/net';
import { rules, tradeItems, tradeOfferError } from '../game';
import type { CommandResult } from './commands';
import type { Game } from './game';
import { TokenBucket } from './rate-limit';
import type { PlayerSession } from './session';

export const TRADE_REQUEST_TTL_MS = 60_000;
/** After a decline, the same requester must wait this long before asking the same player again. */
export const TRADE_DECLINE_COOLDOWN_MS = 20_000;
/** Pending requests one character may have out at once. */
export const MAX_PENDING_TRADE_REQUESTS = 8;
/** Refusal for any command aimed at an item that sits in an open trade offer. */
export const ITEM_IN_TRADE = 'That item is in a trade. Take it out of your offer or cancel the trade first.';
export const TRADE_COMPLETED = 'Trade completed';

const OK: CommandResult = { ok: true };
const fail = (error: string): CommandResult => ({ ok: false, error });
const TRADE_GONE = 'That trade is no longer open.';

interface TradeRequest {
  readonly id: string;
  readonly fromId: string;
  readonly fromName: string;
  readonly toId: string;
  expires: number;
}

interface TradeSide {
  readonly characterId: string;
  readonly name: string;
  uids: string[];
  /** Copies of the offered items as they were when offered (compared with the live ones on accept). */
  items: Item[];
  locked: ReadonlySet<string>;
  accepted: boolean;
}

interface Trade {
  readonly id: string;
  readonly sides: readonly [TradeSide, TradeSide];
  /** Wall ms (the Game's clock) until which accepting is blocked after the last offer change. */
  acceptLockedUntil: number;
  readonly openedAt: number;
}

/** JSON with sorted keys and without the "new" badge: two copies of the same item compare equal. */
function itemKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(itemKey).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => k !== 'isNew' && obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${itemKey(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameItem(a: Item, b: Item): boolean {
  return a === b || itemKey(a) === itemKey(b);
}

function newSide(s: PlayerSession): TradeSide {
  return { characterId: s.characterId, name: s.name, uids: [], items: [], locked: new Set(), accepted: false };
}

export class TradeDesk {
  private readonly trades = new Map<string, Trade>();
  private readonly byCharacter = new Map<string, Trade>();
  private readonly requests = new Map<string, TradeRequest>();
  /** `${fromId}|${toId}` → wall ms until which that requester may not ask that player again. */
  private readonly declined = new Map<string, number>();
  private readonly buckets = new Map<string, TokenBucket>();
  private nextTradeId = 1;
  private nextRequestId = 1;

  constructor(private readonly game: Game) {}

  // =========================================================================================
  // Queries
  // =========================================================================================

  get openTrades(): number {
    return this.trades.size;
  }

  /** The open trade id of a character (tests, diagnostics). */
  tradeIdOf(characterId: string): string | null {
    return this.byCharacter.get(characterId)?.id ?? null;
  }

  /** The uids a character has in its open trade offer (locked), or null. */
  lockedUids(characterId: string): ReadonlySet<string> | null {
    const trade = this.byCharacter.get(characterId);
    if (!trade) return null;
    const side = this.sideOf(trade, characterId);
    return side.locked.size > 0 ? side.locked : null;
  }

  isLocked(characterId: string, uid: string): boolean {
    return this.lockedUids(characterId)?.has(uid) ?? false;
  }

  private sideOf(trade: Trade, characterId: string): TradeSide {
    return trade.sides[0].characterId === characterId ? trade.sides[0] : trade.sides[1];
  }

  private otherSide(trade: Trade, characterId: string): TradeSide {
    return trade.sides[0].characterId === characterId ? trade.sides[1] : trade.sides[0];
  }

  private infoFor(trade: Trade, side: TradeSide): TradeInfo {
    const other = this.otherSide(trade, side.characterId);
    return {
      tradeId: trade.id,
      partnerCharacterId: other.characterId,
      partnerName: other.name,
      yourItems: side.items,
      theirItems: other.items,
      youAccepted: side.accepted,
      theyAccepted: other.accepted,
      acceptLockedUntil: trade.acceptLockedUntil,
    };
  }

  /** The trade `tradeId` if `s` takes part in it. */
  private tradeFor(s: PlayerSession, tradeId: string): Trade | null {
    const trade = this.trades.get(tradeId);
    return trade && trade.sides.some((side) => side.characterId === s.characterId) ? trade : null;
  }

  private push(trade: Trade): void {
    for (const side of trade.sides) this.game.sessions.get(side.characterId)?.send({ t: 'trade', trade: this.infoFor(trade, side) });
  }

  /** Close a trade; `results` maps a character id to the text its 'trade' null message carries. */
  private close(trade: Trade, results: (side: TradeSide) => string): void {
    if (this.trades.get(trade.id) !== trade) return;
    this.trades.delete(trade.id);
    for (const side of trade.sides) {
      if (this.byCharacter.get(side.characterId) === trade) this.byCharacter.delete(side.characterId);
    }
    for (const side of trade.sides) this.game.sessions.get(side.characterId)?.send({ t: 'trade', trade: null, result: results(side) });
  }

  /** An offer changed: both accepts clear and accepting is blocked for TRADE_ACCEPT_LOCK_MS. */
  private offerChanged(trade: Trade): void {
    for (const side of trade.sides) side.accepted = false;
    trade.acceptLockedUntil = this.game.now() + TRADE_ACCEPT_LOCK_MS;
    this.push(trade);
  }

  // =========================================================================================
  // Requests
  // =========================================================================================

  private onlineByName(name: string): PlayerSession | null {
    const lower = name.toLowerCase();
    for (const s of this.game.sessions.values()) if (s.online && s.name.toLowerCase() === lower) return s;
    return null;
  }

  request(s: PlayerSession, rawName: string): CommandResult {
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) return fail('Type the name of the player you want to trade with.');
    if (name.toLowerCase() === s.name.toLowerCase()) return fail("You can't trade with yourself.");
    const target = this.onlineByName(name);
    if (!target) {
      const row = this.game.db.characterByName(name);
      return fail(row ? `${row.name} is not online.` : `There is no character named "${name}".`);
    }
    if (this.byCharacter.has(s.characterId)) return fail('Finish your current trade first.');
    if (this.byCharacter.has(target.characterId)) return fail(`${target.name} is already trading with someone.`);
    this.expire();
    const now = this.game.now();
    for (const req of this.requests.values()) {
      if (req.fromId === s.characterId && req.toId === target.characterId) {
        // Repeated: renew only (the target already has the popup).
        req.expires = now + TRADE_REQUEST_TTL_MS;
        s.toast(`Your trade request to ${target.name} is still pending.`, 'info');
        return OK;
      }
    }
    for (const req of this.requests.values()) {
      // They asked us first: asking them back is as good as accepting.
      if (req.fromId === target.characterId && req.toId === s.characterId) return this.openFromRequest(s, req);
    }
    const key = `${s.characterId}|${target.characterId}`;
    if ((this.declined.get(key) ?? 0) > now) return fail(`${target.name} declined your trade request. Give them a moment before asking again.`);
    this.declined.delete(key);
    let bucket = this.buckets.get(s.characterId);
    if (!bucket) {
      bucket = new TokenBucket(4, 0.2, now);
      this.buckets.set(s.characterId, bucket);
    }
    if (!bucket.take(now)) return fail('You are sending trade requests too quickly.');
    let pending = 0;
    for (const req of this.requests.values()) if (req.fromId === s.characterId) pending++;
    if (pending >= MAX_PENDING_TRADE_REQUESTS) return fail('You have too many pending trade requests.');
    const req: TradeRequest = {
      id: `tr${this.nextRequestId++}`, fromId: s.characterId, fromName: s.name, toId: target.characterId, expires: now + TRADE_REQUEST_TTL_MS,
    };
    this.requests.set(req.id, req);
    target.send({ t: 'tradeRequest', request: { requestId: req.id, fromCharacterId: req.fromId, fromName: req.fromName } });
    s.toast(`Trade request sent to ${target.name}.`, 'info');
    this.game.log.info('trade requested', { from: s.name, to: target.name });
    return OK;
  }

  respond(s: PlayerSession, requestId: string, accept: boolean): CommandResult {
    this.expire();
    const req = this.requests.get(requestId);
    if (!req || req.toId !== s.characterId) return fail('That trade request has expired.');
    if (!accept) {
      this.requests.delete(req.id);
      this.declined.set(`${req.fromId}|${req.toId}`, this.game.now() + TRADE_DECLINE_COOLDOWN_MS);
      this.game.sessions.get(req.fromId)?.toast(`${s.name} declined your trade request.`, 'info');
      return OK;
    }
    return this.openFromRequest(s, req);
  }

  /** `s` (the addressee of `req`) accepts: open the trade for both. */
  private openFromRequest(s: PlayerSession, req: TradeRequest): CommandResult {
    const from = this.game.sessions.get(req.fromId);
    if (!from || !from.online) {
      this.requests.delete(req.id);
      return fail(`${req.fromName} is no longer online.`);
    }
    if (this.byCharacter.has(s.characterId)) return fail('Finish your current trade first.');
    if (this.byCharacter.has(from.characterId)) {
      this.requests.delete(req.id);
      return fail(`${from.name} is already trading with someone.`);
    }
    this.requests.delete(req.id);
    const trade: Trade = {
      id: `t${this.nextTradeId++}`,
      sides: [newSide(from), newSide(s)],
      acceptLockedUntil: 0,
      openedAt: this.game.now(),
    };
    this.trades.set(trade.id, trade);
    this.byCharacter.set(from.characterId, trade);
    this.byCharacter.set(s.characterId, trade);
    this.push(trade);
    from.toast(`${s.name} accepted your trade request.`, 'info');
    this.game.log.info('trade opened', { trade: trade.id, a: from.name, b: s.name });
    return OK;
  }

  /** Pending (unexpired) requests addressed to a character. */
  requestsFor(characterId: string): TradeRequestInfo[] {
    this.expire();
    const out: TradeRequestInfo[] = [];
    for (const req of this.requests.values()) {
      if (req.toId === characterId) out.push({ requestId: req.id, fromCharacterId: req.fromId, fromName: req.fromName });
    }
    return out;
  }

  expire(): void {
    const now = this.game.now();
    for (const [id, req] of this.requests) if (req.expires <= now) this.requests.delete(id);
    for (const [key, until] of this.declined) if (until <= now) this.declined.delete(key);
  }

  // =========================================================================================
  // The trade window
  // =========================================================================================

  offer(s: PlayerSession, tradeId: string, uids: readonly string[]): CommandResult {
    const trade = this.tradeFor(s, tradeId);
    if (!trade) return fail(TRADE_GONE);
    const ch = s.record.ch;
    const error = tradeOfferError(ch, uids);
    if (error) return fail(error);
    const side = this.sideOf(trade, s.characterId);
    const items: Item[] = [];
    for (const uid of uids) {
      const found = rules.findItem(ch, uid);
      if (!found) return fail('That item no longer exists.');
      items.push(found.item);
    }
    const unchanged = uids.length === side.uids.length && uids.every((u, k) => u === side.uids[k] && sameItem(items[k], side.items[k]));
    if (unchanged) return OK;
    side.uids = uids.slice();
    side.items = items;
    side.locked = new Set(side.uids);
    this.offerChanged(trade);
    return OK;
  }

  accept(s: PlayerSession, tradeId: string, accept: boolean): CommandResult {
    const trade = this.tradeFor(s, tradeId);
    if (!trade) return fail(TRADE_GONE);
    const side = this.sideOf(trade, s.characterId);
    const other = this.otherSide(trade, s.characterId);
    if (!accept) {
      if (side.accepted) {
        side.accepted = false;
        this.push(trade);
      }
      return OK;
    }
    const wait = trade.acceptLockedUntil - this.game.now();
    if (wait > 0) return fail(`The offer just changed. Check it — you can accept in ${Math.ceil(wait / 1000)} s.`);
    if (side.uids.length === 0 && other.uids.length === 0) return fail('Put an item into the trade first.');
    if (side.accepted) return OK;
    side.accepted = true;
    if (!other.accepted) {
      this.push(trade);
      return OK;
    }
    return this.execute(trade, s);
  }

  /** Both sides accepted: swap atomically, or explain why not and keep the trade open. */
  private execute(trade: Trade, accepter: PlayerSession): CommandResult {
    const [sa, sb] = trade.sides;
    const a = this.game.sessions.get(sa.characterId);
    const b = this.game.sessions.get(sb.characterId);
    if (!a || !b) {
      this.close(trade, () => 'Your trade partner left. The trade was cancelled.');
      return fail('Your trade partner left. The trade was cancelled.');
    }
    const refuse = (reason: string): CommandResult => {
      for (const side of trade.sides) side.accepted = false;
      this.push(trade);
      const other = accepter === a ? b : a;
      other.toast(`The trade did not go through: ${reason}`, 'bad');
      this.game.log.info('trade refused', { trade: trade.id, a: a.name, b: b.name, reason });
      return fail(reason);
    };
    // Defence in depth: the offers must still be exactly what both players saw.
    for (const [side, s] of [[sa, a], [sb, b]] as const) {
      for (let k = 0; k < side.uids.length; k++) {
        const found = rules.findItem(s.record.ch, side.uids[k]);
        if (!found || found.location.kind !== 'backpack' || !sameItem(found.item, side.items[k])) {
          this.characterChanged(side.characterId);
          return refuse(`${side.name}'s offer changed. Check it and accept again.`);
        }
      }
    }
    const swapped = tradeItems(a.record.ch, sa.uids, b.record.ch, sb.uids);
    if (!swapped.ok) return refuse(swapped.error);
    // Closed before the commit, so the change hooks do not re-validate a finished trade.
    this.close(trade, () => TRADE_COMPLETED);
    this.game.setCharacter(a, swapped.value.a, 'now');
    this.game.setCharacter(b, swapped.value.b, 'now');
    this.game.store.flushTogether([a.record, b.record]);
    a.toast(`Trade with ${b.name} completed.`, 'good');
    b.toast(`Trade with ${a.name} completed.`, 'good');
    this.game.log.info('trade completed', { trade: trade.id, a: a.name, b: b.name, aGave: sa.uids.length, bGave: sb.uids.length });
    return OK;
  }

  cancel(s: PlayerSession, tradeId: string): CommandResult {
    const trade = this.tradeFor(s, tradeId);
    if (!trade) return fail(TRADE_GONE);
    this.close(trade, (side) => (side.characterId === s.characterId ? 'You cancelled the trade.' : `${s.name} cancelled the trade.`));
    return OK;
  }

  // =========================================================================================
  // Lifecycle
  // =========================================================================================

  /**
   * A character changed: re-check its offer against the live character. Offered items are locked, so this
   * only matters for a path that changed them anyway — a vanished or altered item leaves the offer, and
   * both accepts clear.
   */
  characterChanged(characterId: string): void {
    const trade = this.byCharacter.get(characterId);
    const s = this.game.sessions.get(characterId);
    if (!trade || !s) return;
    const side = this.sideOf(trade, characterId);
    if (side.uids.length === 0) return;
    const ch = s.record.ch;
    const uids: string[] = [];
    const items: Item[] = [];
    let changed = false;
    for (let k = 0; k < side.uids.length; k++) {
      const found = rules.findItem(ch, side.uids[k]);
      if (!found || found.location.kind !== 'backpack') {
        changed = true;
        continue;
      }
      if (!sameItem(found.item, side.items[k])) changed = true;
      uids.push(side.uids[k]);
      items.push(found.item);
    }
    if (!changed) return;
    side.uids = uids;
    side.items = items;
    side.locked = new Set(uids);
    this.offerChanged(trade);
  }

  /** The character's socket dropped or its session ended: cancel its trade and forget its requests. */
  sessionGone(characterId: string, why: 'disconnected' | 'offline'): void {
    const trade = this.byCharacter.get(characterId);
    if (trade) {
      const name = this.sideOf(trade, characterId).name;
      this.close(trade, (side) => (side.characterId === characterId ? 'The trade was cancelled.' : `${name} ${why === 'disconnected' ? 'disconnected' : 'went offline'}. The trade was cancelled.`));
    }
    for (const [id, req] of this.requests) if (req.fromId === characterId || req.toId === characterId) this.requests.delete(id);
    if (why === 'offline') this.buckets.delete(characterId);
  }

  /** A (re)connected socket: the open trade and pending requests again. */
  resend(s: PlayerSession): void {
    const trade = this.byCharacter.get(s.characterId);
    if (trade) s.send({ t: 'trade', trade: this.infoFor(trade, this.sideOf(trade, s.characterId)) });
    for (const request of this.requestsFor(s.characterId)) s.send({ t: 'tradeRequest', request });
  }

  /** Close every trade (shutdown). */
  closeAll(result: string): void {
    for (const trade of [...this.trades.values()]) this.close(trade, () => result);
    this.requests.clear();
  }
}
