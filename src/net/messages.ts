// Strict JSON message validation.
//   Server: parseClientMessage(raw) → the only way a client frame becomes a typed ClientMessage. Exact shapes only:
//           unknown keys, wrong types, out-of-range numbers, oversized strings or unknown commands are rejected with
//           a short player-facing reason (the server turns it into a toast / closes abusive sockets).
//   Client: parseServerMessage(raw) → shape-checks server frames before the app trusts them.
import { ATTRIBUTES, EQUIP_SLOTS, SKILL_IDS, THEMES } from '../contracts/content';
import {
  BACKPACK_SIZE, BELT_SLOTS, LOADOUT_SLOTS, MAX_STASH_TABS, STASH_TAB_SIZE,
} from '../contracts/items';
import type { ItemLocation } from '../contracts/items';
import { TRADE_MAX_ITEMS } from '../contracts/net';
import type { ClientMessage, Command, ServerMessage } from '../contracts/net';
import { HELD_MASK_ALL } from './input';
import { PROP_KIND_CODES } from './protocol';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Largest accepted client text frame (bytes/chars). Inputs are ~120 B, the largest command well under 1 KB. */
export const MAX_CLIENT_MESSAGE_LENGTH = 4096;
/** Largest accepted server text frame on the client (full CharacterSave with 8 stash tabs fits comfortably). */
export const MAX_SERVER_MESSAGE_LENGTH = 4 * 1024 * 1024;
export const MAX_CHAT_LENGTH = 240;
export const MAX_STASH_TAB_NAME_LENGTH = 24;
export const MAX_CHARACTER_NAME_LENGTH = 16;
/** Item uids ("i1f", "d3k9…", "belt:2"), offer / recipe / invite / request / trade ids, character ids. */
const TOKEN_RE = /^[A-Za-z0-9_:.\-]{1,64}$/;
/** Drop ids are sim-assigned integers (u32 on the wire). */
const MAX_DROP_ID = 0xffffffff;
/** Control characters are never allowed in player-entered text. */
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]');

type Obj = Record<string, unknown>;

class Reject extends Error {}

function fail(reason: string): never {
  throw new Reject(reason);
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Require an object with exactly the given keys (plus optional ones). */
function shape(v: unknown, what: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (!isObj(v)) fail(`${what}: expected an object`);
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(v, k)) fail(`${what}: missing "${k}"`);
  for (const k of Object.keys(v)) {
    if (!required.includes(k) && !optional.includes(k)) fail(`${what}: unexpected "${k}"`);
  }
  return v;
}

function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what}: expected a number`);
  if (v < min || v > max) fail(`${what}: out of range`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  const n = num(v, what, min, max);
  if (!Number.isInteger(n)) fail(`${what}: expected an integer`);
  return n;
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') fail(`${what}: expected true/false`);
  return v;
}

function token(v: unknown, what: string): string {
  if (typeof v !== 'string' || !TOKEN_RE.test(v)) fail(`${what}: invalid id`);
  return v;
}

/** Player-entered text: non-empty after trimming, bounded, no control characters. */
function text(v: unknown, what: string, maxLength: number): string {
  if (typeof v !== 'string') fail(`${what}: expected text`);
  if (v.length > maxLength) fail(`${what}: too long (max ${maxLength})`);
  if (v.trim().length === 0) fail(`${what}: empty`);
  if (CONTROL_RE.test(v)) fail(`${what}: invalid characters`);
  return v;
}

function oneOf<T extends string>(v: unknown, what: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) fail(`${what}: unknown value`);
  return v as T;
}

function str(v: unknown, what: string, maxLength = 256): string {
  if (typeof v !== 'string') fail(`${what}: expected a string`);
  if (v.length > maxLength) fail(`${what}: too long`);
  return v;
}

function arr(v: unknown, what: string, maxLength = 100_000): unknown[] {
  if (!Array.isArray(v)) fail(`${what}: expected a list`);
  if (v.length > maxLength) fail(`${what}: too many entries`);
  return v;
}

function nullable<T>(v: unknown, parse: (v: unknown) => T): T | null {
  return v === null ? null : parse(v);
}

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

function itemLocation(v: unknown): ItemLocation {
  if (!isObj(v)) fail('location: expected an object');
  switch (v.kind) {
    case 'backpack': {
      const o = shape(v, 'location', ['kind', 'x', 'y']);
      return { kind: 'backpack', x: int(o.x, 'location.x', 0, BACKPACK_SIZE.w - 1), y: int(o.y, 'location.y', 0, BACKPACK_SIZE.h - 1) };
    }
    case 'stash': {
      const o = shape(v, 'location', ['kind', 'tab', 'x', 'y']);
      return {
        kind: 'stash',
        tab: int(o.tab, 'location.tab', 0, MAX_STASH_TABS - 1),
        x: int(o.x, 'location.x', 0, STASH_TAB_SIZE.w - 1),
        y: int(o.y, 'location.y', 0, STASH_TAB_SIZE.h - 1),
      };
    }
    case 'equipment': {
      const o = shape(v, 'location', ['kind', 'slot']);
      return { kind: 'equipment', slot: oneOf(o.slot, 'location.slot', EQUIP_SLOTS) };
    }
    case 'belt': {
      const o = shape(v, 'location', ['kind', 'index']);
      return { kind: 'belt', index: int(o.index, 'location.index', 0, BELT_SLOTS - 1) };
    }
    case 'mapDevice':
      shape(v, 'location', ['kind']);
      return { kind: 'mapDevice' };
    default:
      return fail('location: unknown kind');
  }
}

function command(v: unknown): Command {
  if (!isObj(v)) fail('command: expected an object');
  const c = v.c;
  switch (c) {
    case 'moveItem': {
      const o = shape(v, c, ['c', 'uid', 'to']);
      return { c, uid: token(o.uid, 'uid'), to: itemLocation(o.to) };
    }
    case 'quickMove': {
      const o = shape(v, c, ['c', 'uid', 'stashTab']);
      return { c, uid: token(o.uid, 'uid'), stashTab: nullable(o.stashTab, (t) => int(t, 'stashTab', 0, MAX_STASH_TABS - 1)) };
    }
    case 'discardItem': {
      const o = shape(v, c, ['c', 'uid']);
      return { c, uid: token(o.uid, 'uid') };
    }
    case 'applyCurrency': {
      const o = shape(v, c, ['c', 'currencyUid', 'targetUid'], ['affixIndex']);
      const cmd: Extract<Command, { c: 'applyCurrency' }> = {
        c,
        currencyUid: token(o.currencyUid, 'currencyUid'),
        targetUid: token(o.targetUid, 'targetUid'),
      };
      if (o.affixIndex !== undefined) cmd.affixIndex = int(o.affixIndex, 'affixIndex', 0, 31);
      return cmd;
    }
    case 'addStashTab':
    case 'clearNewFlags':
    case 'activateMapDevice':
    case 'merchantOffers':
    case 'partyLeave':
    case 'leaveMap':
    case 'respawn':
      shape(v, c, ['c']);
      return { c };
    case 'usePortal': {
      const o = shape(v, c, ['c', 'propId']);
      return { c, propId: int(o.propId, 'propId', 0, 0x7fffffff) };
    }
    case 'renameStashTab': {
      const o = shape(v, c, ['c', 'tab', 'name']);
      return { c, tab: int(o.tab, 'tab', 0, MAX_STASH_TABS - 1), name: text(o.name, 'name', MAX_STASH_TAB_NAME_LENGTH) };
    }
    case 'allocateAttribute': {
      const o = shape(v, c, ['c', 'attr']);
      return { c, attr: oneOf(o.attr, 'attr', ATTRIBUTES) };
    }
    case 'rankUpSkill': {
      const o = shape(v, c, ['c', 'skillId']);
      return { c, skillId: oneOf(o.skillId, 'skillId', SKILL_IDS) };
    }
    case 'setLoadoutSlot': {
      const o = shape(v, c, ['c', 'slot', 'skillId']);
      return {
        c,
        slot: int(o.slot, 'slot', 0, LOADOUT_SLOTS - 1),
        skillId: nullable(o.skillId, (s) => oneOf(s, 'skillId', SKILL_IDS)),
      };
    }
    case 'buyOffer': {
      const o = shape(v, c, ['c', 'offerId']);
      return { c, offerId: token(o.offerId, 'offerId') };
    }
    case 'partyInvite': {
      const o = shape(v, c, ['c', 'name']);
      return { c, name: text(o.name, 'name', MAX_CHARACTER_NAME_LENGTH) };
    }
    case 'partyRespond': {
      const o = shape(v, c, ['c', 'inviteId', 'accept']);
      return { c, inviteId: token(o.inviteId, 'inviteId'), accept: bool(o.accept, 'accept') };
    }
    case 'partyKick':
    case 'partyPromote':
    case 'visitHideout': {
      const o = shape(v, c, ['c', 'characterId']);
      return { c, characterId: token(o.characterId, 'characterId') };
    }
    case 'chat': {
      const o = shape(v, c, ['c', 'text']);
      return { c, text: text(o.text, 'text', MAX_CHAT_LENGTH) };
    }
    case 'pickup': {
      const o = shape(v, c, ['c', 'dropId']);
      return { c, dropId: int(o.dropId, 'dropId', 0, MAX_DROP_ID) };
    }
    case 'dropItem': {
      const o = shape(v, c, ['c', 'uid']);
      return { c, uid: token(o.uid, 'uid') };
    }
    case 'benchCraft': {
      const o = shape(v, c, ['c', 'targetUid', 'recipeId']);
      return { c, targetUid: token(o.targetUid, 'targetUid'), recipeId: token(o.recipeId, 'recipeId') };
    }
    case 'benchClear': {
      const o = shape(v, c, ['c', 'targetUid']);
      return { c, targetUid: token(o.targetUid, 'targetUid') };
    }
    case 'tradeRequest': {
      const o = shape(v, c, ['c', 'name']);
      return { c, name: text(o.name, 'name', MAX_CHARACTER_NAME_LENGTH) };
    }
    case 'tradeRespond': {
      const o = shape(v, c, ['c', 'requestId', 'accept']);
      return { c, requestId: token(o.requestId, 'requestId'), accept: bool(o.accept, 'accept') };
    }
    case 'tradeOffer': {
      const o = shape(v, c, ['c', 'tradeId', 'uids']);
      const list = arr(o.uids, 'uids', TRADE_MAX_ITEMS);
      const uids: string[] = [];
      for (let k = 0; k < list.length; k++) {
        const uid = token(list[k], `uids[${k}]`);
        if (uids.includes(uid)) fail('uids: duplicate item');
        uids.push(uid);
      }
      return { c, tradeId: token(o.tradeId, 'tradeId'), uids };
    }
    case 'tradeAccept': {
      const o = shape(v, c, ['c', 'tradeId', 'accept']);
      return { c, tradeId: token(o.tradeId, 'tradeId'), accept: bool(o.accept, 'accept') };
    }
    case 'tradeCancel': {
      const o = shape(v, c, ['c', 'tradeId']);
      return { c, tradeId: token(o.tradeId, 'tradeId') };
    }
    default:
      return fail('unknown command');
  }
}

/** Validate an already-parsed JSON value as a ClientMessage. */
export function validateClientMessage(v: unknown): ParseResult<ClientMessage> {
  try {
    if (!isObj(v)) fail('expected an object');
    switch (v.t) {
      case 'input': {
        const o = shape(v, 'input', ['t', 'seq', 'moveX', 'moveY', 'aimX', 'aimY', 'held', 'flask']);
        return {
          ok: true,
          value: {
            t: 'input',
            seq: int(o.seq, 'seq', 0, 0xffffffff),
            moveX: num(o.moveX, 'moveX', -1, 1),
            moveY: num(o.moveY, 'moveY', -1, 1),
            aimX: num(o.aimX, 'aimX', -1e6, 1e6),
            aimY: num(o.aimY, 'aimY', -1e6, 1e6),
            held: int(o.held, 'held', 0, HELD_MASK_ALL),
            flask: int(o.flask, 'flask', -1, BELT_SLOTS - 1),
          },
        };
      }
      case 'cmd': {
        const o = shape(v, 'cmd', ['t', 'id', 'cmd']);
        return { ok: true, value: { t: 'cmd', id: int(o.id, 'id', 0, Number.MAX_SAFE_INTEGER), cmd: command(o.cmd) } };
      }
      case 'ping': {
        const o = shape(v, 'ping', ['t', 'time']);
        return { ok: true, value: { t: 'ping', time: num(o.time, 'time', -1e15, 1e15) } };
      }
      default:
        return fail('unknown message type');
    }
  } catch (err) {
    if (err instanceof Reject) return { ok: false, error: err.message };
    return { ok: false, error: 'malformed message' };
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });

function toText(raw: unknown, maxLength: number): ParseResult<string> {
  let s: string;
  if (typeof raw === 'string') s = raw;
  else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    // UTF-8 needs at most 4 bytes per character: anything bigger cannot fit the character limit.
    if (raw.byteLength > maxLength * 4) return { ok: false, error: 'message too large' };
    try {
      s = textDecoder.decode(raw);
    } catch {
      return { ok: false, error: 'invalid UTF-8' };
    }
  } else if (Array.isArray(raw) && raw.every((b) => ArrayBuffer.isView(b))) {
    // ws may deliver fragmented frames as Buffer[].
    const parts = raw as ArrayBufferView[];
    let total = 0;
    for (const p of parts) total += p.byteLength;
    if (total > maxLength * 4) return { ok: false, error: 'message too large' };
    const joined = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      joined.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
      at += p.byteLength;
    }
    return toText(joined, maxLength);
  } else return { ok: false, error: 'expected a text frame' };
  if (s.length > maxLength) return { ok: false, error: 'message too large' };
  return { ok: true, value: s };
}

function parseJson(s: string): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(s) as unknown };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

/**
 * Parse + validate one client text frame (string, Buffer/ArrayBuffer or ws fragment list).
 * Rejects anything larger than MAX_CLIENT_MESSAGE_LENGTH before parsing.
 */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  const t = toText(raw, MAX_CLIENT_MESSAGE_LENGTH);
  if (!t.ok) return t;
  const j = parseJson(t.value);
  if (!j.ok) return j;
  return validateClientMessage(j.value);
}

// ---------------------------------------------------------------------------
// Server → client (shape checks; nested game state such as CharacterSave is trusted to the rules' parser)
// ---------------------------------------------------------------------------

const TOAST_TONES = ['info', 'good', 'bad', 'normal', 'magic', 'rare', 'unique', 'currency', 'map', 'flask'] as const;
const ITEM_KINDS = ['equipment', 'currency', 'map', 'flask'] as const;
const RUN_RESULTS = ['cleared', 'failed', 'abandoned'] as const;
const ZONE_KINDS = ['hideout', 'map'] as const;

function portalInfo(v: unknown, what: string): void {
  const o = shape(v, what, ['ownerCharacterId', 'ownerName', 'mapName', 'tier', 'remaining', 'total', 'cleared']);
  str(o.ownerCharacterId, `${what}.ownerCharacterId`);
  str(o.ownerName, `${what}.ownerName`);
  str(o.mapName, `${what}.mapName`);
  num(o.tier, `${what}.tier`, 0, 1000);
  int(o.remaining, `${what}.remaining`, 0, 1000);
  int(o.total, `${what}.total`, 0, 1000);
  bool(o.cleared, `${what}.cleared`);
}

function propView(v: unknown): void {
  const o = shape(v, 'prop', ['id', 'kind', 'x', 'y', 'radius', 'state', 'variant', 'interactive']);
  num(o.id, 'prop.id', 0, 0xffffffff);
  oneOf(o.kind, 'prop.kind', PROP_KIND_CODES);
  num(o.x, 'prop.x', -1e6, 1e6);
  num(o.y, 'prop.y', -1e6, 1e6);
  num(o.radius, 'prop.radius', 0, 1e5);
  num(o.state, 'prop.state', -1e9, 1e9);
  num(o.variant, 'prop.variant', 0, 1e6);
  bool(o.interactive, 'prop.interactive');
}

function zoneInfo(v: unknown): void {
  const o = shape(v, 'zone', [
    'instanceId', 'kind', 'ownerCharacterId', 'ownerName', 'theme', 'arenaRadius', 'mapName', 'tier',
    'localPlayerId', 'props', 'setup', 'portal',
  ]);
  str(o.instanceId, 'zone.instanceId');
  oneOf(o.kind, 'zone.kind', ZONE_KINDS);
  str(o.ownerCharacterId, 'zone.ownerCharacterId');
  str(o.ownerName, 'zone.ownerName');
  oneOf(o.theme, 'zone.theme', THEMES);
  num(o.arenaRadius, 'zone.arenaRadius', 0, 1e6);
  str(o.mapName, 'zone.mapName');
  num(o.tier, 'zone.tier', 0, 1000);
  int(o.localPlayerId, 'zone.localPlayerId', 0, 255);
  for (const p of arr(o.props, 'zone.props', 4096)) propView(p);
  if (o.setup !== null && !isObj(o.setup)) fail('zone.setup: expected an object');
  if (o.portal !== null) portalInfo(o.portal, 'zone.portal');
}

function partyInfo(v: unknown): void {
  const o = shape(v, 'party', ['id', 'leaderId', 'members']);
  str(o.id, 'party.id');
  str(o.leaderId, 'party.leaderId');
  for (const m of arr(o.members, 'party.members', 16)) {
    const mo = shape(m, 'member', ['characterId', 'name', 'level', 'online', 'isLeader', 'zone', 'activeMap']);
    str(mo.characterId, 'member.characterId');
    str(mo.name, 'member.name');
    num(mo.level, 'member.level', 0, 1000);
    bool(mo.online, 'member.online');
    bool(mo.isLeader, 'member.isLeader');
    if (mo.zone !== null) {
      const z = shape(mo.zone, 'member.zone', ['kind', 'ownerName'], ['mapName', 'tier']);
      oneOf(z.kind, 'member.zone.kind', ZONE_KINDS);
      str(z.ownerName, 'member.zone.ownerName');
      if (z.mapName !== undefined) str(z.mapName, 'member.zone.mapName');
      if (z.tier !== undefined) num(z.tier, 'member.zone.tier', 0, 1000);
    }
    if (mo.activeMap !== null) portalInfo(mo.activeMap, 'member.activeMap');
  }
}

/**
 * A full Item copy inside a server message. Checked loosely: an object with a known `kind` and a string `uid` (the
 * UI keys tooltips and drag state on them); the rest is the rules' domain and rendered through describeItem.
 */
function itemCopy(v: unknown, what: string): void {
  if (!isObj(v)) fail(`${what}: expected an item`);
  oneOf(v.kind, `${what}.kind`, ITEM_KINDS);
  str(v.uid, `${what}.uid`, 256);
}

function tradeInfo(v: unknown): void {
  const o = shape(v, 'trade', [
    'tradeId', 'partnerCharacterId', 'partnerName', 'yourItems', 'theirItems', 'youAccepted', 'theyAccepted',
    'acceptLockedUntil',
  ]);
  str(o.tradeId, 'trade.tradeId');
  str(o.partnerCharacterId, 'trade.partnerCharacterId');
  str(o.partnerName, 'trade.partnerName');
  for (const it of arr(o.yourItems, 'trade.yourItems', TRADE_MAX_ITEMS)) itemCopy(it, 'trade.yourItems[]');
  for (const it of arr(o.theirItems, 'trade.theirItems', TRADE_MAX_ITEMS)) itemCopy(it, 'trade.theirItems[]');
  bool(o.youAccepted, 'trade.youAccepted');
  bool(o.theyAccepted, 'trade.theyAccepted');
  num(o.acceptLockedUntil, 'trade.acceptLockedUntil', -1e15, 1e15);
}

/** Validate an already-parsed JSON value as a ServerMessage (top-level and key nested shapes). */
export function validateServerMessage(v: unknown): ParseResult<ServerMessage> {
  try {
    if (!isObj(v)) fail('expected an object');
    switch (v.t) {
      case 'welcome': {
        const o = shape(v, 'welcome', ['t', 'protocol', 'characterId', 'tickRate', 'serverTime']);
        int(o.protocol, 'protocol', 0, 0xffff);
        str(o.characterId, 'characterId');
        num(o.tickRate, 'tickRate', 1, 1000);
        num(o.serverTime, 'serverTime', -1e15, 1e15);
        break;
      }
      case 'character': {
        const o = shape(v, 'character', ['t', 'character']);
        const ch = o.character;
        if (!isObj(ch) || typeof ch.id !== 'string' || typeof ch.name !== 'string') fail('character: malformed');
        break;
      }
      case 'zone': {
        const o = shape(v, 'zone', ['t', 'zone']);
        zoneInfo(o.zone);
        break;
      }
      case 'portal': {
        const o = shape(v, 'portal', ['t', 'portal']);
        if (o.portal !== null) portalInfo(o.portal, 'portal');
        break;
      }
      case 'events': {
        const o = shape(v, 'events', ['t', 'tick', 'events']);
        int(o.tick, 'tick', 0, 0xffffffff);
        for (const e of arr(o.events, 'events', 20_000)) {
          if (!isObj(e) || typeof e.t !== 'string') fail('events: malformed event');
        }
        break;
      }
      case 'result': {
        const o = shape(v, 'result', ['t', 'id', 'ok'], ['error', 'message', 'offers']);
        int(o.id, 'id', 0, Number.MAX_SAFE_INTEGER);
        bool(o.ok, 'ok');
        if (o.error !== undefined) str(o.error, 'error', 2000);
        if (o.message !== undefined) str(o.message, 'message', 2000);
        if (o.offers !== undefined) {
          for (const off of arr(o.offers, 'offers', 500)) if (!isObj(off) || typeof off.id !== 'string') fail('offers: malformed');
        }
        break;
      }
      case 'toast': {
        const o = shape(v, 'toast', ['t', 'text', 'tone']);
        str(o.text, 'text', 2000);
        oneOf(o.tone, 'tone', TOAST_TONES);
        break;
      }
      case 'party': {
        const o = shape(v, 'party', ['t', 'party']);
        if (o.party !== null) partyInfo(o.party);
        break;
      }
      case 'invite': {
        const o = shape(v, 'invite', ['t', 'invite']);
        const i = shape(o.invite, 'invite', ['inviteId', 'fromCharacterId', 'fromName']);
        str(i.inviteId, 'inviteId');
        str(i.fromCharacterId, 'fromCharacterId');
        str(i.fromName, 'fromName');
        break;
      }
      case 'chat': {
        const o = shape(v, 'chat', ['t', 'fromName', 'text', 'time']);
        str(o.fromName, 'fromName');
        str(o.text, 'text', 2000);
        num(o.time, 'time', -1e15, 1e15);
        break;
      }
      case 'runSummary': {
        const o = shape(v, 'runSummary', ['t', 'summary']);
        const s = shape(o.summary, 'summary', ['result', 'mapName', 'tier', 'seconds', 'kills', 'xpGained', 'levelsGained', 'itemsFound']);
        oneOf(s.result, 'summary.result', RUN_RESULTS);
        str(s.mapName, 'summary.mapName');
        for (const k of ['tier', 'seconds', 'kills', 'xpGained', 'levelsGained'] as const) num(s[k], `summary.${k}`, -1e12, 1e12);
        for (const it of arr(s.itemsFound, 'summary.itemsFound', 10_000)) {
          const io = shape(it, 'item', ['label', 'tone']);
          str(io.label, 'item.label');
          oneOf(io.tone, 'item.tone', TOAST_TONES);
        }
        break;
      }
      case 'pong': {
        const o = shape(v, 'pong', ['t', 'time', 'serverTime', 'serverTick']);
        num(o.time, 'time', -1e15, 1e15);
        num(o.serverTime, 'serverTime', -1e15, 1e15);
        int(o.serverTick, 'serverTick', 0, 0xffffffff);
        break;
      }
      case 'tradeRequest': {
        const o = shape(v, 'tradeRequest', ['t', 'request']);
        const r = shape(o.request, 'request', ['requestId', 'fromCharacterId', 'fromName']);
        str(r.requestId, 'request.requestId');
        str(r.fromCharacterId, 'request.fromCharacterId');
        str(r.fromName, 'request.fromName');
        break;
      }
      case 'trade': {
        const o = shape(v, 'trade', ['t', 'trade'], ['result']);
        if (o.trade !== null) tradeInfo(o.trade);
        if (o.result !== undefined) str(o.result, 'result', 2000);
        break;
      }
      default:
        fail('unknown message type');
    }
    return { ok: true, value: v as unknown as ServerMessage };
  } catch (err) {
    if (err instanceof Reject) return { ok: false, error: err.message };
    return { ok: false, error: 'malformed message' };
  }
}

/** Parse + validate one server text frame on the client. */
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  const t = toText(raw, MAX_SERVER_MESSAGE_LENGTH);
  if (!t.ok) return t;
  const j = parseJson(t.value);
  if (!j.ok) return j;
  return validateServerMessage(j.value);
}

/** Serialise a message for a text frame (the one place JSON.stringify is used for the protocol). */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
