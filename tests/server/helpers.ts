// Shared helpers for the server tests: a real server on port 0 with an in-memory database, HTTP calls,
// account/character setup, and an in-process harness (fake connections + manual ticking on a fake clock)
// for scenarios that need minutes of sim time in seconds of test time.
import type { CharacterSave, Item, MapItem } from '../../src/contracts/items';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { findAtlasArea } from '../../src/data/progression/atlas';
import type { Command, InputMessage, ServerMessage, ZoneInfo } from '../../src/contracts/net';
import type { PlayerIntent, PropKind, WorldView } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { waresRotation } from '../../src/game/progression/wares';
import { decodeSnapshot, inputFromIntent } from '../../src/net';
import type { Snapshot } from '../../src/net';
import { newConnectionId, silentLogger, startServer } from '../../src/server';
import type { Connection, Logger, ServerHandle, ServerOptions } from '../../src/server';
import type { PlayerSession } from '../../src/server/session';

export const RELAXED_LIMITS = {
  registrationsPerIp: 1000,
  loginAttemptsPerIp: 1000,
  requestsPerMinute: 100_000,
};

export async function startTestServer(opts: ServerOptions = {}): Promise<ServerHandle & { base: string }> {
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    dbPath: ':memory:',
    logger: silentLogger,
    wsConnectionsPerMinute: 10_000,
    maxConnectionsPerIp: 1000,
    ...opts,
    limits: { ...RELAXED_LIMITS, ...opts.limits },
  });
  return Object.assign(server, { base: `http://127.0.0.1:${server.port}` });
}

export interface ApiReply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export async function api<T = Record<string, unknown>>(
  base: string, method: string, path: string, body?: unknown, token?: string,
): Promise<ApiReply<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

let userCounter = 0;

/** Register a fresh account and create one character on it. */
export async function newPlayer(base: string, name?: string): Promise<{ token: string; accountId: string; characterId: string; name: string }> {
  const n = ++userCounter;
  const username = `user_${n}_${Math.floor(Math.random() * 1e6)}`;
  const reg = await api<{ token: string; account: { id: string } }>(base, 'POST', '/api/register', { username, password: 'correct horse battery' });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const charName = name ?? `Hero${n}x${Math.floor(Math.random() * 1000)}`;
  const created = await api<{ character: { id: string; name: string } }>(base, 'POST', '/api/characters', { name: charName }, reg.body.token);
  if (created.status !== 201) throw new Error(`create character failed: ${JSON.stringify(created.body)}`);
  return { token: reg.body.token, accountId: reg.body.account.id, characterId: created.body.character.id, name: created.body.character.name };
}

// ---------------------------------------------------------------------------
// In-process harness
// ---------------------------------------------------------------------------

/** A Connection that records everything the server sends. */
export class FakeConnection implements Connection {
  readonly id = newConnectionId();
  readonly ip = '127.0.0.1';
  open = true;
  bufferedAmount = 0;
  readonly messages: ServerMessage[] = [];
  /** Raw snapshots (kept only when `keepSnapshots`). */
  readonly snapshots: ArrayBuffer[] = [];
  snapshotCount = 0;
  lastSnapshot: ArrayBuffer | null = null;
  bytes = 0;
  /** Text frames sent with permessage-deflate allowed / skipped. */
  compressed = 0;
  uncompressed = 0;
  closedWith: { code: number; reason: string } | null = null;

  constructor(readonly keepSnapshots = false) {}

  sendText(data: string, compress = true): void {
    this.bytes += data.length;
    if (compress) this.compressed++;
    else this.uncompressed++;
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  sendBinary(data: ArrayBuffer): void {
    this.bytes += data.byteLength;
    this.snapshotCount++;
    this.lastSnapshot = data;
    if (this.keepSnapshots) this.snapshots.push(data);
  }

  close(code: number, reason: string): void {
    this.open = false;
    this.closedWith = { code, reason };
  }
}

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** One in-process player: a fake connection attached to a character of `server.game`. */
export class LocalPlayer {
  readonly conn: FakeConnection;
  /** Hash of the (real, stored) login session this player's connection authenticated with. */
  readonly tokenHash: string;
  private seq = 0;
  private cmdId = 1;

  constructor(
    readonly server: ServerHandle,
    readonly characterId: string,
    keepSnapshots = false,
  ) {
    this.conn = new FakeConnection(keepSnapshots);
    const accountId = server.game.store.ownerOf(characterId);
    if (!accountId) throw new Error('unknown character');
    // Connected sockets re-check their login session, so the fake one needs a real (long-lived) one too.
    this.tokenHash = `test-session-${characterId}-${newConnectionId()}`;
    server.db.createSession(this.tokenHash, accountId, Number.MAX_SAFE_INTEGER);
    if (!server.game.attach(this.conn, characterId, this.tokenHash)) throw new Error('attach failed');
  }

  get session(): PlayerSession {
    const s = this.server.game.sessions.get(this.characterId);
    if (!s) throw new Error('no session');
    return s;
  }

  get view(): WorldView {
    const inst = this.session.instance;
    if (!inst) throw new Error('not in an instance');
    return inst.run.view;
  }

  get playerId(): number {
    return this.session.playerId;
  }

  me() {
    return this.view.players.find((p) => p.id === this.playerId) ?? null;
  }

  all<T extends ServerMessage['t']>(t: T, from = 0): Msg<T>[] {
    return this.conn.messages.slice(from).filter((m) => m.t === t) as Msg<T>[];
  }

  last<T extends ServerMessage['t']>(t: T): Msg<T> | null {
    const list = this.all(t);
    return list.length ? list[list.length - 1] : null;
  }

  get zone(): ZoneInfo | null {
    return this.last('zone')?.zone ?? null;
  }

  mark(): number {
    return this.conn.messages.length;
  }

  send(msg: unknown): void {
    this.server.game.onMessage(this.conn, typeof msg === 'string' ? msg : JSON.stringify(msg), false);
  }

  /**
   * Send a command and return its result. A result that changed the character waits for the debounced
   * 'character' push (a real timer); the harness fires that push right away — as the timer would.
   */
  command(cmd: Command): Msg<'result'> {
    const id = this.cmdId++;
    const from = this.mark();
    this.send({ t: 'cmd', id, cmd });
    let r = this.all('result', from).find((m) => m.id === id);
    if (!r && this.session.pushPending) {
      this.session.flushCharacter();
      r = this.all('result', from).find((m) => m.id === id);
    }
    if (!r) throw new Error(`no result for ${cmd.c}`);
    return r;
  }

  input(partial: Partial<InputMessage> = {}): void {
    const seq = ++this.seq;
    this.send({ t: 'input', moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: 0, flask: -1, ...partial, seq });
  }

  intent(intent: PlayerIntent): void {
    this.send(inputFromIntent(intent, ++this.seq));
  }

  steerInput(x: number, y: number): Partial<InputMessage> {
    const me = this.me();
    if (!me) return {};
    const dx = x - me.x;
    const dy = y - me.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return { aimX: x, aimY: y };
    const k = Math.min(1, d / 20) / d;
    return { moveX: dx * k, moveY: dy * k, aimX: x, aimY: y };
  }

  decodeLast(): Snapshot | null {
    return this.conn.lastSnapshot ? decodeSnapshot(this.conn.lastSnapshot) : null;
  }
}

/** Fake wall clock for in-process servers (the game's rate limits and timers read it). */
export function createClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

export type Clock = ReturnType<typeof createClock>;

/** One fixed tick of the whole game plus the clock. */
export function tick(server: ServerHandle, clock: Clock, n = 1): void {
  for (let k = 0; k < n; k++) {
    clock.advance(SIM_DT * 1000);
    server.game.stepAll(1);
  }
}

/**
 * Walk `player` into the first open prop of `kind` in its current instance (sending one input per tick)
 * until its zone changes. Returns the new zone.
 */
export function walkIntoProp(player: LocalPlayer, kind: PropKind, clock: Clock, others: LocalPlayer[] = [], maxTicks = 1200): ZoneInfo {
  const startInstance = player.session.instance;
  const prop = player.view.props.find((p) => p.kind === kind && p.state > 0);
  if (!prop) throw new Error(`no open ${kind}`);
  for (let k = 0; k < maxTicks; k++) {
    player.input(player.steerInput(prop.x, prop.y));
    for (const o of others) o.input();
    tick(player.server, clock);
    if (player.session.instance !== startInstance) {
      const z = player.zone;
      if (!z) throw new Error('moved without a zone message');
      return z;
    }
  }
  throw new Error(`never entered the ${kind}`);
}

/** Register (via the DB directly) an account + character for in-process tests. */
export function createLocalCharacter(server: ServerHandle, name: string): string {
  const accountId = `acct-${name}`;
  server.db.createAccount({ id: accountId, username: `u_${name}`.slice(0, 20), passHash: '00', salt: '00', created: 0 });
  const r = server.game.store.create(accountId, name);
  if (!r.ok) throw new Error(r.error);
  return r.character.id;
}

/** `leader` invites `member` (by name) and `member` accepts. */
export function partyUp(leader: LocalPlayer, member: LocalPlayer): void {
  const from = member.mark();
  const invited = leader.command({ c: 'partyInvite', name: member.session.name });
  if (!invited.ok) throw new Error(`invite failed: ${invited.error}`);
  const inv = member.all('invite', from).at(-1);
  if (!inv) throw new Error('no invite arrived');
  const accepted = member.command({ c: 'partyRespond', inviteId: inv.invite.inviteId, accept: true });
  if (!accepted.ok) throw new Error(`accept failed: ${accepted.error}`);
}

/**
 * Bind the map in `p`'s device (and nothing else) to `areaId`, charting the area: what choosing an area at the device meant
 * before maps were bound. Sealed areas and the Pit are reached through a passage instead, not by binding.
 */
export function bindDeviceMap(p: LocalPlayer, areaId: AtlasAreaId, patch: Partial<MapItem> = {}): void {
  const ch = p.session.record.ch;
  const area = findAtlasArea(areaId)!;
  if (!ch.mapDevice) throw new Error('bindDeviceMap: the device is empty');
  const atlas = ch.atlas ?? { discovered: [], completed: [], clears: 0 };
  p.server.game.setCharacter(p.session, {
    ...ch,
    mapDevice: { ...ch.mapDevice, areaId, baseId: area.baseId, ...patch },
    atlas: { ...atlas, discovered: [...new Set([...atlas.discovered, areaId])] as AtlasAreaId[] },
  });
}

/** Load the first map of `owner`'s backpack into the device and activate it (owner must be at home). */
export function openMap(owner: LocalPlayer): void {
  const entry = owner.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map');
  if (!entry) throw new Error('no map in the backpack');
  const moved = owner.command({ c: 'moveItem', uid: entry.item.uid, to: { kind: 'mapDevice' } });
  if (!moved.ok) throw new Error(`moveItem failed: ${moved.error}`);
  const opened = owner.command({ c: 'activateMapDevice' });
  if (!opened.ok) throw new Error(`activateMapDevice failed: ${opened.error}`);
}

/** Visit `owner`'s hideout (unless already there) and walk into its portal. */
export function enterMapOf(player: LocalPlayer, owner: LocalPlayer, clock: Clock, others: LocalPlayer[] = []): void {
  const inst = player.session.instance;
  if (!inst || inst.kind !== 'hideout' || inst.ownerId !== owner.characterId) {
    const r = player.command({ c: 'visitHideout', characterId: owner.characterId });
    if (!r.ok) throw new Error(`visitHideout failed: ${r.error}`);
  }
  walkIntoProp(player, 'portal', clock, others);
}

// ---------------------------------------------------------------------------
// Items: filling a backpack, and conservation checks (nothing duplicated, nothing lost)
// ---------------------------------------------------------------------------

/**
 * Fill `p`'s backpack with 1×1 copies of one of its maps until nothing fits, then free `leaveFree` cells
 * again. Returns the uids of the fillers still in the backpack.
 */
export function fillBackpack(p: LocalPlayer, leaveFree = 0): string[] {
  let ch = p.session.record.ch;
  const template = ch.backpack.entries.find((e) => e.item.kind === 'map')?.item;
  if (!template) throw new Error('no map to copy');
  const fillers: string[] = [];
  for (let n = 0; n < 200; n++) {
    const uid = `fill${n}`;
    const r = rules.addToBackpack(ch, { ...template, uid });
    if (!r.ok) break;
    const added = r.value.backpack.entries.find((e) => !ch.backpack.entries.some((old) => old.item.uid === e.item.uid));
    ch = r.value;
    if (added) fillers.push(added.item.uid);
  }
  for (let k = 0; k < leaveFree; k++) {
    const uid = fillers.pop();
    if (!uid) break;
    const r = rules.discardItem(ch, uid);
    if (r.ok) ch = r.value;
  }
  p.server.game.setCharacter(p.session, ch);
  return fillers;
}

function itemKey(item: Item): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).filter((k) => k !== 'uid' && k !== 'isNew').sort().map((k) => [k, strip(o[k])]));
    }
    return v;
  };
  return JSON.stringify(strip(item));
}

/**
 * Everything the given characters hold together: unique items by content (uid and "new" badge ignored),
 * currency and flask charges summed per kind (stacks merge and flasks refill belts on the way). The special
 * stash tabs count too: Crafting Stash slots as currency, Map Stash maps as items.
 */
export function holdings(...chs: CharacterSave[]): { items: string[]; stacks: Record<string, number> } {
  const items: string[] = [];
  const stacks: Record<string, number> = {};
  const addStack = (key: string, n: number) => {
    stacks[key] = (stacks[key] ?? 0) + n;
  };
  const add = (item: Item) => {
    if (item.kind === 'currency') addStack(`c:${item.currencyId}`, item.count);
    else if (item.kind === 'flask') addStack(`f:${item.flaskId}`, item.count);
    else items.push(itemKey(item));
  };
  for (const ch of chs) {
    for (const e of ch.backpack.entries) add(e.item);
    for (const tab of ch.stash) for (const e of tab.grid.entries) add(e.item);
    for (const it of Object.values(ch.equipment)) if (it) add(it);
    if (ch.mapDevice) add(ch.mapDevice);
    for (const b of ch.belt) if (b) addStack(`f:${b.flaskId}`, b.count);
    for (const [id, n] of Object.entries(ch.currencyStash ?? {})) if (n) addStack(`c:${id}`, n);
    for (const m of ch.mapStash ?? []) add(m);
    if (ch.craftSlot) add(ch.craftSlot);
  }
  items.sort();
  return { items, stacks };
}

/** Every item uid of a character (must be unique within it; Map Stash maps included). */
export function uidsOf(ch: CharacterSave): string[] {
  const out: string[] = [];
  for (const e of ch.backpack.entries) out.push(e.item.uid);
  for (const tab of ch.stash) for (const e of tab.grid.entries) out.push(e.item.uid);
  for (const it of Object.values(ch.equipment)) if (it) out.push(it.uid);
  if (ch.mapDevice) out.push(ch.mapDevice.uid);
  for (const m of ch.mapStash ?? []) out.push(m.uid);
  if (ch.craftSlot) out.push(ch.craftSlot.uid);
  return out;
}

/** The persisted private character plus its persisted account stash (no live cache or debounce involved). */
export function savedCharacter(server: ServerHandle, characterId: string): CharacterSave {
  const row = server.db.characterById(characterId);
  if (!row) throw new Error('no such character row');
  const shared = server.db.accountStorage(row.accountId);
  return { ...JSON.parse(row.data), ...(shared ? JSON.parse(shared.data) : {}) } as CharacterSave;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface CapturedLine {
  level: 'info' | 'warn' | 'error';
  msg: string;
  fields: Record<string, unknown>;
}

/** A logger that records every line (to assert on operator-facing logs). */
export function captureLogger(): Logger & { lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  const at = (level: CapturedLine['level']) => (msg: string, fields: Record<string, unknown> = {}) => {
    lines.push({ level, msg, fields });
  };
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

/**
 * Buy Rook's guaranteed plain map from the wares board (slot 0: Normal, quality 0, at the tier of the stock epoch snapshot). `areaId` narrows the
 * snapshot to that one area (so the map is bound to it); returns the command result of the purchase.
 */
export function buyRookMap(p: LocalPlayer, areaId?: AtlasAreaId): ReturnType<LocalPlayer['command']> {
  if (areaId) {
    const ch = p.session.record.ch;
    const rotation = waresRotation(p.server.game.now());
    p.server.game.setCharacter(p.session, { ...ch, wares: { rotation, level: ch.level, rerolls: 0, sold: [], tier: 0, areas: [areaId] } });
  }
  const view = p.command({ c: 'merchantWares' });
  if (!view.ok || !view.board) return view;
  return p.command({ c: 'buyWare', wareId: view.board.wares[0].id });
}
