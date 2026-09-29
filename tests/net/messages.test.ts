import { describe, expect, it } from 'vitest';
import type { ClientMessage, Command, ServerMessage, TradeInfo } from '../../src/contracts/net';
import { TRADE_MAX_ITEMS } from '../../src/contracts/net';
import type { CurrencyStack, EquipmentItem } from '../../src/contracts/items';
import {
  HELD_MASK_ALL, MAX_CLIENT_MESSAGE_LENGTH, createEventTimeline, heldToMask, inputFromIntent, intentFromInput, isSlotHeld,
  maskToHeld, parseClientMessage, parseServerMessage, setSlotHeld, validateClientMessage,
} from '../../src/net';
import type { SimEvent } from '../../src/contracts/sim';
import { makeZone } from './fixtures';

const input = { t: 'input', seq: 42, moveX: 0.70710678, moveY: -0.70710678, aimX: 123.5, aimY: -44, held: 0b100001, flask: -1 } as const;

function ok(raw: unknown): ClientMessage {
  const r = parseClientMessage(typeof raw === 'string' ? raw : JSON.stringify(raw));
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
}

function rejected(raw: unknown): string {
  const r = parseClientMessage(typeof raw === 'string' ? raw : JSON.stringify(raw));
  if (r.ok) throw new Error(`expected rejection of ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`);
  return r.error;
}

const cmd = (c: Record<string, unknown>) => ({ t: 'cmd', id: 7, cmd: c });

function wand(): EquipmentItem {
  return {
    kind: 'equipment', uid: 'i1f', baseId: 'ashwoodWand', itemLevel: 24, rarity: 'rare', name: 'Ember Bite',
    implicitValues: [14], affixes: [{ affixId: 'fireDamage', tier: 4, value: 31 }, { affixId: 'maxLife', tier: 6, value: 22, crafted: true }],
    scars: [], stability: 5, maxStability: 8, history: ['Kindling Shard made it magic'],
  };
}

function scrap(): CurrencyStack {
  return { kind: 'currency', uid: 'i20', currencyId: 'scrap', count: 12 };
}

function sampleTrade(): TradeInfo {
  return {
    tradeId: 'trade-1', partnerCharacterId: 'c2', partnerName: 'Brann', yourItems: [wand()],
    theirItems: [scrap(), { kind: 'map', uid: 'i21', baseId: 'rimedOssuary', tier: 4, rarity: 'magic', mods: [{ modId: 'teeming', value: 36 }], quality: 5, corrupted: false }],
    youAccepted: false, theyAccepted: true, acceptLockedUntil: 1.7e12,
  };
}

describe('client message validation', () => {
  it('accepts every well-formed message', () => {
    expect(ok(input)).toEqual(input);
    expect(ok({ t: 'ping', time: 12345.5 })).toEqual({ t: 'ping', time: 12345.5 });
    const commands: Command[] = [
      { c: 'moveItem', uid: 'i1f', to: { kind: 'backpack', x: 11, y: 4 } },
      { c: 'moveItem', uid: 'd3k9abc0000001', to: { kind: 'stash', tab: 7, x: 11, y: 7 } },
      { c: 'moveItem', uid: 'belt:2', to: { kind: 'equipment', slot: 'ring2' } },
      { c: 'moveItem', uid: 'i2', to: { kind: 'belt', index: 3 } },
      { c: 'moveItem', uid: 'i3', to: { kind: 'mapDevice' } },
      { c: 'quickMove', uid: 'i1', stashTab: null },
      { c: 'quickMove', uid: 'i1', stashTab: 2 },
      { c: 'discardItem', uid: 'i9' },
      { c: 'applyCurrency', currencyUid: 'i1', targetUid: 'i2' },
      { c: 'applyCurrency', currencyUid: 'i1', targetUid: 'i2', affixIndex: 3 },
      { c: 'addStashTab' },
      { c: 'renameStashTab', tab: 1, name: 'Maps ✦ T5+' },
      { c: 'clearNewFlags' },
      { c: 'allocateAttribute', attr: 'int' },
      { c: 'rankUpSkill', skillId: 'arcChain' },
      { c: 'setLoadoutSlot', slot: 5, skillId: null },
      { c: 'setLoadoutSlot', slot: 1, skillId: 'emberNova' },
      { c: 'activateMapDevice' },
      { c: 'merchantOffers' },
      { c: 'buyOffer', offerId: 'gamble:wand' },
      { c: 'partyInvite', name: 'Mira' },
      { c: 'partyRespond', inviteId: 'inv-12', accept: false },
      { c: 'partyLeave' },
      { c: 'partyKick', characterId: 'c_8f2' },
      { c: 'partyPromote', characterId: 'c_8f2' },
      { c: 'visitHideout', characterId: 'c_8f2' },
      { c: 'leaveMap' },
      { c: 'respawn' },
      { c: 'chat', text: 'portal is up — 7 left, come! 🔥' },
      { c: 'usePortal', propId: 12 },
      { c: 'pickup', dropId: 0 },
      { c: 'pickup', dropId: 4_000_000_000 },
      { c: 'dropItem', uid: 'i1f' },
      { c: 'dropItem', uid: 'belt:3' },
      { c: 'benchCraft', targetUid: 'i1f', recipeId: 'bench:maxLife:3' },
      { c: 'benchClear', targetUid: 'i1f' },
      { c: 'tradeRequest', name: "Brann O'Dell" },
      { c: 'tradeRespond', requestId: 'tr-5', accept: true },
      { c: 'tradeRespond', requestId: 'tr-5', accept: false },
      { c: 'tradeOffer', tradeId: 'trade-1', uids: [] },
      { c: 'tradeOffer', tradeId: 'trade-1', uids: ['i1', 'i2', 'd3k9abc0000001'] },
      { c: 'tradeOffer', tradeId: 'trade-1', uids: Array.from({ length: TRADE_MAX_ITEMS }, (_, k) => `i${k}`) },
      { c: 'tradeAccept', tradeId: 'trade-1', accept: true },
      { c: 'tradeAccept', tradeId: 'trade-1', accept: false },
      { c: 'tradeCancel', tradeId: 'trade-1' },
    ];
    for (const c of commands) expect(ok(cmd(c as unknown as Record<string, unknown>))).toEqual({ t: 'cmd', id: 7, cmd: c });
  });

  it('accepts Buffer / ArrayBuffer / fragment frames', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    expect(parseClientMessage(bytes).ok).toBe(true);
    expect(parseClientMessage(bytes.buffer.slice(0)).ok).toBe(true);
    expect(parseClientMessage([bytes.subarray(0, 10), bytes.subarray(10)]).ok).toBe(true);
    expect(parseClientMessage(new Uint8Array([0xff, 0xfe, 0x7b])).ok).toBe(false); // invalid UTF-8
  });

  it('rejects garbage and near-misses', () => {
    const bad: unknown[] = [
      'not json', '', '[]', 'null', '42', '"input"', '{"t":"input"}',
      JSON.stringify([input]),
      { ...input, t: 'inputs' },
      { ...input, extra: 1 }, // unknown key
      { ...input, seq: -1 }, { ...input, seq: 1.5 }, { ...input, seq: 2 ** 32 }, { ...input, seq: '1' },
      { ...input, moveX: 1.01 }, { ...input, moveY: -2 }, { ...input, moveX: '0.5' }, { ...input, moveX: null },
      { ...input, aimX: 1e9 }, { ...input, held: HELD_MASK_ALL + 1 }, { ...input, held: -1 }, { ...input, held: 1.5 },
      { ...input, flask: 4 }, { ...input, flask: -2 },
      '{"t":"input","seq":1,"moveX":NaN,"moveY":0,"aimX":0,"aimY":0,"held":0,"flask":-1}',
      '{"t":"input","seq":1,"moveX":1e999,"moveY":0,"aimX":0,"aimY":0,"held":0,"flask":-1}',
      { t: 'ping' }, { t: 'ping', time: 'now' },
      { t: 'cmd', id: -1, cmd: { c: 'leaveMap' } },
      { t: 'cmd', id: 1 },
      { t: 'cmd', id: 1, cmd: null },
      { t: 'cmd', id: 1, cmd: { c: 'selfDestruct' } },
      cmd({ c: 'leaveMap', now: true }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'backpack', x: 12, y: 0 } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'backpack', x: 0, y: 5 } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'stash', tab: 8, x: 0, y: 0 } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'equipment', slot: 'ring3' } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'belt', index: 4 } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'floor' } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'mapDevice', x: 1 } }),
      cmd({ c: 'moveItem', uid: 'i 1', to: { kind: 'mapDevice' } }),
      cmd({ c: 'moveItem', uid: '', to: { kind: 'mapDevice' } }),
      cmd({ c: 'moveItem', uid: 'x'.repeat(65), to: { kind: 'mapDevice' } }),
      cmd({ c: 'moveItem', uid: { $gt: '' }, to: { kind: 'mapDevice' } }),
      cmd({ c: 'quickMove', uid: 'i1' }),
      cmd({ c: 'applyCurrency', currencyUid: 'i1', targetUid: 'i2', affixIndex: -1 }),
      cmd({ c: 'applyCurrency', currencyUid: 'i1', targetUid: 'i2', affixIndex: null }),
      cmd({ c: 'renameStashTab', tab: 0, name: '' }),
      cmd({ c: 'renameStashTab', tab: 0, name: '   ' }),
      cmd({ c: 'renameStashTab', tab: 0, name: 'x'.repeat(25) }),
      cmd({ c: 'renameStashTab', tab: 0, name: 'bad\nname' }),
      cmd({ c: 'allocateAttribute', attr: 'luck' }),
      cmd({ c: 'rankUpSkill', skillId: 'fireball' }),
      cmd({ c: 'setLoadoutSlot', slot: 6, skillId: null }),
      cmd({ c: 'setLoadoutSlot', slot: 1 }),
      cmd({ c: 'partyRespond', inviteId: 'x', accept: 'yes' }),
      cmd({ c: 'chat', text: '' }),
      cmd({ c: 'chat', text: 'a'.repeat(241) }),
      cmd({ c: 'chat', text: 'hi\u0000there' }),
      cmd({ c: 'chat', text: 'line break' }),
      JSON.parse('{"t":"cmd","id":1,"cmd":{"c":"leaveMap","__proto__":{"admin":true}}}'),
      // usePortal / pickup: integer ids only
      cmd({ c: 'usePortal', propId: -1 }), cmd({ c: 'usePortal', propId: 1.5 }), cmd({ c: 'usePortal' }),
      cmd({ c: 'pickup', dropId: -1 }), cmd({ c: 'pickup', dropId: 2 ** 32 }), cmd({ c: 'pickup', dropId: 3.5 }),
      cmd({ c: 'pickup', dropId: '7' }), cmd({ c: 'pickup', dropId: null }), cmd({ c: 'pickup' }),
      cmd({ c: 'pickup', dropId: 7, x: 1 }), cmd({ c: 'pickup', dropId: 7, token: 3 }),
      // dropItem
      cmd({ c: 'dropItem' }), cmd({ c: 'dropItem', uid: '' }), cmd({ c: 'dropItem', uid: 'i 1' }), cmd({ c: 'dropItem', uid: 42 }),
      cmd({ c: 'dropItem', uid: 'i1', x: 10, y: 10 }), cmd({ c: 'dropItem', uid: ['i1'] }),
      // bench
      cmd({ c: 'benchCraft', targetUid: 'i1' }), cmd({ c: 'benchCraft', recipeId: 'r1' }),
      cmd({ c: 'benchCraft', targetUid: 'i1', recipeId: '' }), cmd({ c: 'benchCraft', targetUid: 'i1', recipeId: 'r 1' }),
      cmd({ c: 'benchCraft', targetUid: 'i1', recipeId: 'r'.repeat(65) }), cmd({ c: 'benchCraft', targetUid: 'i1', recipeId: 7 }),
      cmd({ c: 'benchCraft', targetUid: 'i1', recipeId: 'r1', tier: 1 }),
      cmd({ c: 'benchClear' }), cmd({ c: 'benchClear', targetUid: null }), cmd({ c: 'benchClear', targetUid: 'i1', affixIndex: 0 }),
      // trading
      cmd({ c: 'tradeRequest' }), cmd({ c: 'tradeRequest', name: '' }), cmd({ c: 'tradeRequest', name: '   ' }),
      cmd({ c: 'tradeRequest', name: 'x'.repeat(17) }), cmd({ c: 'tradeRequest', name: 'Mira\n' }), cmd({ c: 'tradeRequest', name: 5 }),
      cmd({ c: 'tradeRespond', requestId: 'tr-5' }), cmd({ c: 'tradeRespond', requestId: 'tr-5', accept: 1 }),
      cmd({ c: 'tradeRespond', requestId: 'tr 5', accept: true }), cmd({ c: 'tradeRespond', accept: true }),
      cmd({ c: 'tradeOffer', tradeId: 'trade-1' }), cmd({ c: 'tradeOffer', uids: [] }),
      cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: 'i1' }), cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: { 0: 'i1' } }),
      cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: ['i1', 'i1'] }), // duplicate: offering one item twice
      cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: ['i1', 'i2', 'i1'] }),
      cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: Array.from({ length: TRADE_MAX_ITEMS + 1 }, (_, k) => `i${k}`) }),
      cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: ['i1', ''] }), cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: ['i1', null] }),
      cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: [['i1']] }), cmd({ c: 'tradeOffer', tradeId: 'trade-1', uids: ['i1'], accept: true }),
      cmd({ c: 'tradeAccept', tradeId: 'trade-1' }), cmd({ c: 'tradeAccept', tradeId: 'trade-1', accept: 'true' }),
      cmd({ c: 'tradeAccept', accept: true }), cmd({ c: 'tradeAccept', tradeId: '', accept: true }),
      cmd({ c: 'tradeCancel' }), cmd({ c: 'tradeCancel', tradeId: 'trade-1', reason: 'bye' }), cmd({ c: 'tradeCancel', tradeId: { id: 1 } }),
      JSON.stringify({ t: 'ping', time: 1, pad: 'x'.repeat(MAX_CLIENT_MESSAGE_LENGTH) }),
    ];
    for (const b of bad) expect(rejected(b)).toMatch(/\w/);
    expect(validateClientMessage(undefined).ok).toBe(false);
    expect(parseClientMessage(12 as unknown).ok).toBe(false);
  });

  it('never throws on arbitrary JSON values', () => {
    const values: unknown[] = [true, 0, 'x', [], {}, { t: {} }, { t: 'cmd', id: 1, cmd: [] }, { t: 'cmd', id: 1, cmd: { c: 'moveItem', uid: 'i', to: [] } }];
    for (const v of values) expect(validateClientMessage(v).ok).toBe(false);
  });
});

describe('server message validation', () => {
  it('accepts well-formed server messages', () => {
    const msgs: ServerMessage[] = [
      { t: 'welcome', protocol: 1, characterId: 'c1', tickRate: 60, serverTime: 1e12 },
      { t: 'zone', zone: makeZone({ props: [{ id: 1, kind: 'portal', x: 0, y: -60, radius: 0, state: 8, variant: 0, interactive: true }] }) },
      { t: 'portal', portal: { ownerCharacterId: 'c1', ownerName: 'Mira', mapName: 'Ashen Forge', tier: 3, remaining: 7, total: 8, cleared: false } },
      { t: 'portal', portal: null },
      { t: 'events', tick: 1200, events: [{ t: 'waveStart', wave: 2 }] },
      { t: 'result', id: 3, ok: false, error: 'Not enough room' },
      { t: 'toast', text: 'Rare drop!', tone: 'rare' },
      { t: 'party', party: { id: 'p1', leaderId: 'c1', members: [{ characterId: 'c1', name: 'Mira', level: 12, online: true, isLeader: true, zone: { kind: 'map', ownerName: 'Mira', mapName: 'Ashen Forge', tier: 3 }, activeMap: null }] } },
      { t: 'party', party: null },
      { t: 'invite', invite: { inviteId: 'inv1', fromCharacterId: 'c2', fromName: 'Brann' } },
      { t: 'chat', fromName: 'Brann', text: 'hi', time: 5 },
      { t: 'runSummary', summary: { result: 'cleared', mapName: 'Ashen Forge', tier: 3, seconds: 612, kills: 812, xpGained: 5000, levelsGained: 1, itemsFound: [{ label: 'Ember Bite', tone: 'rare' }] } },
      { t: 'pong', time: 100, serverTime: 1e12, serverTick: 5000 },
      { t: 'tradeRequest', request: { requestId: 'tr-5', fromCharacterId: 'c2', fromName: 'Brann' } },
      { t: 'trade', trade: sampleTrade() },
      { t: 'trade', trade: { ...sampleTrade(), yourItems: [], theirItems: [], youAccepted: true, theyAccepted: true } },
      { t: 'trade', trade: null },
      { t: 'trade', trade: null, result: 'Trade completed.' },
      { t: 'trade', trade: null, result: 'Brann has no room for Ember Bite.' },
    ];
    for (const m of msgs) {
      const r = parseServerMessage(JSON.stringify(m));
      expect(r.ok ? r.value : r.error).toEqual(m);
    }
  });

  it('rejects malformed server messages', () => {
    const bad: unknown[] = [
      { t: 'welcome', protocol: 1 },
      { t: 'zone', zone: { ...makeZone(), theme: 'moon' } },
      { t: 'zone', zone: { ...makeZone(), props: [{ id: 1, kind: 'ufo', x: 0, y: 0, radius: 0, state: 0, variant: 0, interactive: false }] } },
      { t: 'events', tick: 1, events: [1, 2] },
      { t: 'toast', text: 'x', tone: 'loud' },
      { t: 'mystery' },
      { t: 'pong', time: 1, serverTime: 1 },
      { t: 'tradeRequest' },
      { t: 'tradeRequest', request: null },
      { t: 'tradeRequest', request: { requestId: 'tr-5', fromName: 'Brann' } },
      { t: 'tradeRequest', request: { requestId: 5, fromCharacterId: 'c2', fromName: 'Brann' } },
      { t: 'trade' },
      { t: 'trade', trade: null, result: 5 },
      { t: 'trade', trade: null, extra: true },
      { t: 'trade', trade: { ...sampleTrade(), youAccepted: 'yes' } },
      { t: 'trade', trade: { ...sampleTrade(), acceptLockedUntil: null } },
      { t: 'trade', trade: { ...sampleTrade(), yourItems: null } },
      { t: 'trade', trade: { ...sampleTrade(), theirItems: [null] } },
      { t: 'trade', trade: { ...sampleTrade(), theirItems: ['i1'] } },
      { t: 'trade', trade: { ...sampleTrade(), theirItems: [{ kind: 'relic', uid: 'i1' }] } },
      { t: 'trade', trade: { ...sampleTrade(), theirItems: [{ kind: 'currency', count: 3 }] } },
      { t: 'trade', trade: { ...sampleTrade(), yourItems: Array.from({ length: TRADE_MAX_ITEMS + 1 }, () => scrap()) } },
      { t: 'trade', trade: (({ partnerName: _omit, ...rest }: TradeInfo) => rest)(sampleTrade()) },
      { t: 'trade', trade: { ...sampleTrade(), secret: 1 } },
    ];
    for (const b of bad) expect(parseServerMessage(JSON.stringify(b)).ok).toBe(false);
    expect(parseServerMessage('{').ok).toBe(false);
  });
});

describe('input helpers', () => {
  it('packs held slots into a bitmask and back', () => {
    const held = [true, false, true, false, false, true];
    const mask = heldToMask(held);
    expect(mask).toBe(0b100101);
    expect(maskToHeld(mask)).toEqual(held);
    const out = new Array<boolean>(6).fill(true);
    expect(maskToHeld(0, out)).toBe(out);
    expect(out).toEqual([false, false, false, false, false, false]);
    expect(isSlotHeld(mask, 2)).toBe(true);
    expect(isSlotHeld(mask, 1)).toBe(false);
    expect(isSlotHeld(mask, 9)).toBe(false);
    expect(setSlotHeld(mask, 1, true)).toBe(0b100111);
    expect(setSlotHeld(mask, 0, false)).toBe(0b100100);
    expect(heldToMask([true, true, true, true, true, true, true, true])).toBe(HELD_MASK_ALL);
  });

  it('converts wire inputs to sanitised sim intents and back', () => {
    const intent = intentFromInput({ ...input });
    expect(intent).toEqual({ moveX: input.moveX, moveY: input.moveY, aimX: 123.5, aimY: -44, held: [true, false, false, false, false, true], flask: -1 });
    expect(inputFromIntent(intent, 43)).toEqual({ ...input, seq: 43 });
    const reused = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [] as boolean[], flask: -1 };
    const heldRef = reused.held;
    const r = intentFromInput({ t: 'input', seq: 1, moveX: 5, moveY: Number.NaN, aimX: Number.POSITIVE_INFINITY, aimY: 3, held: 1, flask: 9 }, reused);
    expect(r).toBe(reused);
    expect(r.held).toBe(heldRef);
    expect(r).toMatchObject({ moveX: 1, moveY: 0, aimX: 0, aimY: 3, flask: -1 });
    expect(r.held[0]).toBe(true);
  });
});

describe('event timeline', () => {
  const spawn = (wave: number): SimEvent => ({ t: 'monsterSpawn', kind: 'ashling', rarity: 0, x: wave, y: 0 });

  it('delays world events to the render tick but plays own feedback at once', () => {
    const tl = createEventTimeline();
    tl.setLocalPlayer(1);
    const own: SimEvent = { t: 'cast', playerId: 1, skill: 'emberLance', x: 0, y: 0, dirX: 1, dirY: 0 };
    const allyCast: SimEvent = { t: 'cast', playerId: 2, skill: 'emberNova', x: 5, y: 5, dirX: 0, dirY: 1 };
    const death: SimEvent = { t: 'death', kind: 'ashling', rarity: 0, x: 10, y: 10, facing: 1, damageType: 'fire' };
    const hurt: SimEvent = { t: 'hit', playerId: 1, x: 0, y: 0, amount: 7, damageType: 'physical', crit: false, target: 'player', killed: false };
    tl.push(100, [own, allyCast, death, hurt]);
    tl.push(102, [spawn(2)]);
    expect(tl.drain(90)).toEqual([own, hurt]);
    expect(tl.drain(97.5)).toEqual([]);
    // Released when the render tick enters the batch's span (tick − SNAPSHOT_EVERY), when the dead monster vanishes.
    expect(tl.drain(98)).toEqual([allyCast, death]);
    expect(tl.pending).toBe(1);
    expect(tl.drain(99.9)).toEqual([]);
    expect(tl.drain(100)).toEqual([spawn(2)]);
    expect(tl.pending).toBe(0);
  });

  it('releases events of live-timeline state at once: telegraph resolves, own pickups, props and run state', () => {
    const tl = createEventTimeline();
    tl.setLocalPlayer(1);
    const resolve: SimEvent = { t: 'areaResolve', kind: 'slamWarning', x: 4, y: 4, radius: 40 };
    const myPickup: SimEvent = { t: 'pickup', owner: 1, playerId: 1, tone: 'rare', x: 1, y: 1, label: 'Ember Bite' };
    const allyPickup: SimEvent = { t: 'pickup', owner: 2, playerId: 2, tone: 'rare', x: 1, y: 1, label: 'Ember Bite' };
    const chest: SimEvent = { t: 'chestOpen', x: 0, y: 0 };
    const portalOpen: SimEvent = { t: 'portal', playerId: 0, x: 0, y: 0, kind: 'open' };
    const allyEnters: SimEvent = { t: 'portal', playerId: 2, x: 0, y: 0, kind: 'enter' };
    const wave: SimEvent = { t: 'waveStart', wave: 3 };
    const allyHurt: SimEvent = { t: 'hit', playerId: 2, x: 4, y: 4, amount: 9, damageType: 'fire', crit: false, target: 'player', killed: false };
    tl.push(200, [resolve, myPickup, allyPickup, chest, portalOpen, allyEnters, wave, allyHurt]);
    expect(tl.drain(150)).toEqual([resolve, myPickup, chest, portalOpen, wave]);
    expect(tl.drain(198)).toEqual([allyPickup, allyEnters, allyHurt]);
  });

  it('plays pickups of public drops at once, whoever picked them up (the drop leaves the view with the newest snapshot)', () => {
    const tl = createEventTimeline();
    tl.setLocalPlayer(1);
    const thrown: SimEvent = { t: 'dropSpawn', owner: 0, tone: 'magic', x: 3, y: 3, label: 'Storm Loop' };
    const allyTakesPublic: SimEvent = { t: 'pickup', owner: 0, playerId: 2, tone: 'magic', x: 3, y: 3, label: 'Storm Loop' };
    const iTakePublic: SimEvent = { t: 'pickup', owner: 0, playerId: 1, tone: 'rare', x: 5, y: 3, label: 'Grave Coil' };
    tl.push(300, [thrown, allyTakesPublic, iTakePublic]);
    // The public drop appears on the render timeline (like monster loot), its pickups are live.
    expect(tl.drain(250)).toEqual([allyTakesPublic, iTakePublic]);
    expect(tl.drain(298)).toEqual([thrown]);
  });

  it('flushes batches that a stalled render clock would hold too long, and clears on zone change', () => {
    const tl = createEventTimeline();
    tl.setLocalPlayer(1);
    tl.push(10, [spawn(1)]);
    tl.push(60, [spawn(2)]);
    expect(tl.drain(0)).toEqual([spawn(1)]);
    tl.clear();
    expect(tl.drain(1000)).toEqual([]);
  });
});
