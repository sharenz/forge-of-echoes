import { describe, expect, it } from 'vitest';
import type { ClientMessage, Command, ServerMessage, TradeInfo } from '../../src/contracts/net';
import { TRADE_MAX_ITEMS } from '../../src/contracts/net';
import type { CurrencyStack, EquipmentItem } from '../../src/contracts/items';
import { CURRENCY_STASH_MAX, currencyStashUid } from '../../src/contracts/items';
import { CURRENCY_IDS, MONSTER_KINDS } from '../../src/contracts/content';
import { NEW_AREA_KINDS, PLAYER_DEBUFFS, THEME_ROSTER } from '../../src/contracts/bestiary';
import {
  HELD_MASK_ALL, MAX_CLIENT_MESSAGE_LENGTH, createEventTimeline, heldToMask, inputFromIntent, intentFromInput, isSlotHeld,
  maskToHeld, parseClientMessage, parseServerMessage, setSlotHeld, validateClientMessage,
} from '../../src/net';
import { MONSTER_ATTACKS, SIM_EVENT_TYPES } from '../../src/net/messages';
import { AREA_KINDS, PROJECTILE_KINDS } from '../../src/contracts/sim';
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
      { c: 'chat', text: 'Hello everyone', channel: 'global' },
      { c: 'chat', text: 'Only the party', channel: 'party' },
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
      // special stash tabs (GAME_SPEC §12)
      { c: 'moveItem', uid: 'i4', to: { kind: 'currencyStash' } },
      { c: 'moveItem', uid: 'i5', to: { kind: 'mapStash' } },
      { c: 'moveItem', uid: 'cstash:essenceEmber', to: { kind: 'backpack', x: 0, y: 0 }, count: 40 },
      { c: 'moveItem', uid: 'cstash:voidNeedle', to: { kind: 'backpack', x: 3, y: 2 }, count: 1 },
      { c: 'moveItem', uid: 'i6', to: { kind: 'backpack', x: 5, y: 1 }, count: 7 }, // split a backpack stack
      { c: 'moveItem', uid: 'i7', to: { kind: 'mapDevice' }, count: CURRENCY_STASH_MAX },
      { c: 'quickMove', uid: 'i1', stashTab: 'currency' },
      { c: 'quickMove', uid: 'i1', stashTab: 'mapCurrency' },
      { c: 'quickMove', uid: 'i1', stashTab: 'maps' },
      { c: 'quickMove', uid: 'cstash:scrap', stashTab: 'currency', count: 1 }, // Shift+Ctrl-click: exactly one
      { c: 'quickMove', uid: 'cstash:mapDust', stashTab: 'mapCurrency', count: 40 },
      { c: 'quickMove', uid: 'i2', stashTab: 7, count: 3 },
      { c: 'quickMove', uid: 'i2', stashTab: null, count: 12 },
      { c: 'depositAllCurrency' },
      { c: 'applyCurrency', currencyUid: 'cstash:catalyst', targetUid: 'i1f', affixIndex: 2 }, // craft from the stash
      { c: 'applyCurrency', currencyUid: 'cstash:threatGlyph', targetUid: 'i21' },
    ];
    for (const c of commands) expect(ok(cmd(c as unknown as Record<string, unknown>))).toEqual({ t: 'cmd', id: 7, cmd: c });
  });

  it('accepts the synthetic Crafting Stash uid of every currency wherever an item uid goes', () => {
    for (const id of CURRENCY_IDS) {
      const uid = currencyStashUid(id);
      expect(uid).toBe(`cstash:${id}`);
      const commands: Command[] = [
        { c: 'moveItem', uid, to: { kind: 'backpack', x: 11, y: 4 }, count: 1 },
        { c: 'quickMove', uid, stashTab: 'currency' },
        { c: 'applyCurrency', currencyUid: uid, targetUid: 'i1' },
        { c: 'discardItem', uid },
        { c: 'dropItem', uid },
      ];
      for (const c of commands) expect(ok(cmd(c as unknown as Record<string, unknown>))).toEqual({ t: 'cmd', id: 7, cmd: c });
    }
  });

  it('rejects malformed special-stash commands', () => {
    const bad: unknown[] = [
      // count: a positive integer up to the Crafting Stash slot size
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: 0 }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: -1 }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: 1.5 }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: CURRENCY_STASH_MAX + 1 }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: '3' }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: null }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash' }, count: Number.MAX_SAFE_INTEGER }),
      '{"t":"cmd","id":7,"cmd":{"c":"moveItem","uid":"i1","to":{"kind":"mapStash"},"count":1e999}}',
      // the position-free locations take no position
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash', x: 0, y: 0 } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currencyStash', currencyId: 'scrap' } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'mapStash', tier: 5 } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'mapstash' } }),
      cmd({ c: 'moveItem', uid: 'i1', to: { kind: 'currency' } }),
      // quickMove: a normal tab index, one of the three special tabs, or null
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 'stash' }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 'Maps' }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 'map' }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: '' }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 8 }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: -1 }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 1.5 }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: true }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: ['maps'] }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 'currency', count: 0 }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 'currency', count: 'all' }),
      cmd({ c: 'quickMove', uid: 'i1', stashTab: 'currency', count: 1, shift: true }),
      cmd({ c: 'quickMove', uid: 'cstash:scrap scrap', stashTab: 'currency' }),
      // depositAllCurrency takes nothing
      cmd({ c: 'depositAllCurrency', tab: 'currency' }),
      cmd({ c: 'depositAllCurrency', uids: ['i1'] }),
    ];
    for (const b of bad) expect(rejected(b)).toMatch(/\w/);
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
      cmd({ c: 'chat', text: 'Hi', channel: 'raid' }),
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
      {
        t: 'events', tick: 1202, events: [
          { t: 'debuff', playerId: 1, debuff: 'rooted', stacks: 1, x: 3, y: 4 },
          { t: 'debuff', playerId: 2, debuff: 'bleeding', stacks: 3, x: -3, y: 4 },
          { t: 'cleanse', playerId: 1, debuffs: ['burning', 'bleeding'], x: 3, y: 4 },
          { t: 'cleanse', playerId: 3, debuffs: [], x: 0, y: 0 },
          { t: 'blocked', x: 40.5, y: -12 },
          { t: 'pull', playerId: 2, fromX: 100, fromY: 0, toX: 60, toY: 0 },
          { t: 'monsterAttack', kind: 'chainThrall', x: 1, y: 2, attack: 'hook' },
          { t: 'monsterAttack', kind: 'hollowWarden', x: 1, y: 2, attack: 'prison' },
          { t: 'monsterSpawn', kind: 'varkus', rarity: 4, x: 0, y: -80 },
          { t: 'death', kind: 'boneThrall', rarity: 0, x: 5, y: 5, facing: -1, damageType: 'cold' },
          { t: 'areaResolve', kind: 'glacialSpike', x: 9, y: 9, radius: 14 },
          { t: 'projectileEnd', kind: 'chainHook', x: 1, y: 1 },
          { t: 'waveTell', wave: 3, families: ['pitHound', 'tarSlinger'], lieutenant: true, boss: false },
        ],
      },
      { t: 'result', id: 3, ok: false, error: 'Not enough room' },
      { t: 'toast', text: 'Rare drop!', tone: 'rare' },
      { t: 'party', party: { id: 'p1', leaderId: 'c1', members: [{ characterId: 'c1', name: 'Mira', level: 12, online: true, isLeader: true, zone: { kind: 'map', ownerName: 'Mira', mapName: 'Ashen Forge', tier: 3 }, activeMap: null }] } },
      { t: 'party', party: null },
      { t: 'invite', invite: { inviteId: 'inv1', fromCharacterId: 'c2', fromName: 'Brann' } },
      { t: 'chat', fromName: 'Brann', text: 'hi', time: 5 },
      { t: 'chat', fromName: 'Brann', text: 'hi everyone', time: 5, channel: 'global' },
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
      { t: 'events', tick: 1, events: 'lots' },
      { t: 'events', tick: -1, events: [] },
      { t: 'events', events: [] },
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

/** One well-formed sample of every cosmetic event type (typed: the compiler checks each shape). */
function everyEvent(): SimEvent[] {
  return [
    { t: 'cast', playerId: 1, skill: 'emberLance', x: 0, y: 0, dirX: 1, dirY: 0 },
    { t: 'nova', playerId: 1, skill: 'emberNova', x: 0, y: 0, radius: 60 },
    { t: 'dash', playerId: 1, fromX: 0, fromY: 0, toX: 80, toY: 0 },
    { t: 'ward', playerId: 1, x: 0, y: 0, duration: 4 },
    { t: 'chain', playerId: 1, points: [0, 0, 10, 10], damageType: 'lightning' },
    { t: 'hit', playerId: 1, x: 0, y: 0, amount: 12, damageType: 'physical', crit: false, target: 'player', killed: false, kind: 'pitHound' },
    { t: 'evade', playerId: 1, x: 0, y: 0, target: 'player' },
    { t: 'projectileEnd', kind: 'webShot', x: 0, y: 0 },
    { t: 'death', kind: 'ossuaryGolem', rarity: 2, x: 0, y: 0, facing: 1, damageType: 'fire' },
    { t: 'monsterAttack', kind: 'ironCrossbowman', x: 0, y: 0, attack: 'aim' },
    { t: 'debuff', playerId: 1, debuff: 'frozen', stacks: 1, x: 0, y: 0 },
    { t: 'cleanse', playerId: 1, debuffs: ['bleeding'], x: 0, y: 0 },
    { t: 'blocked', x: 0, y: 0 },
    { t: 'pull', playerId: 1, fromX: 0, fromY: 0, toX: -40, toY: 0 },
    { t: 'monsterSpawn', kind: 'rimeshade', rarity: 0, x: 0, y: 0 },
    { t: 'ailment', ailment: 'chilled', x: 0, y: 0 },
    { t: 'areaResolve', kind: 'executionMark', x: 0, y: 0, radius: 40 },
    { t: 'dropSpawn', owner: 1, tone: 'map', x: 0, y: 0, label: 'Rimed Ossuary (Tier 4)' },
    { t: 'pickup', owner: 1, playerId: 1, tone: 'map', x: 0, y: 0, label: 'Rimed Ossuary (Tier 4)' },
    { t: 'mote', playerId: 1, x: 0, y: 0 },
    { t: 'flask', playerId: 1, resource: 'life' },
    { t: 'waveTell', wave: 6, families: ['boneThrall'], lieutenant: false, boss: true },
    { t: 'waveStart', wave: 6 },
    { t: 'bossSpawn', x: 0, y: 0 },
    { t: 'bossPhase', phase: 3 },
    { t: 'cleared', x: 0, y: 0 },
    { t: 'chestOpen', x: 0, y: 0 },
    { t: 'portal', playerId: 1, x: 0, y: 0, kind: 'enter' },
    { t: 'playerDeath', playerId: 1, x: 0, y: 0 },
    { t: 'playerJoin', playerId: 2, x: 0, y: 0 },
    { t: 'notEnoughFocus', playerId: 1 },
  ];
}

describe('events channel', () => {
  it('drops a malformed event on its own and keeps the rest of the batch', () => {
    const good: SimEvent[] = [
      { t: 'waveStart', wave: 3 },
      { t: 'debuff', playerId: 1, debuff: 'rooted', stacks: 1, x: 0, y: 0 },
      { t: 'pull', playerId: 1, fromX: 10, fromY: 0, toX: 50, toY: 0 },
    ];
    const bad: unknown[] = [
      1, 'x', null, [], { x: 0, y: 0 },
      { t: 'teleport', x: 0, y: 0 }, // not a SimEvent type
      { t: 'debuff', playerId: 1, debuff: 'petrified', stacks: 1, x: 0, y: 0 },
      { t: 'debuff', playerId: 1, stacks: 1, x: 0, y: 0 },
      { t: 'debuff', playerId: 1, debuff: 'chilled', stacks: -1, x: 0, y: 0 },
      { t: 'debuff', playerId: 'me', debuff: 'chilled', stacks: 1, x: 0, y: 0 },
      { t: 'cleanse', playerId: 1, debuffs: ['chilled', 'slimed'], x: 0, y: 0 },
      { t: 'cleanse', playerId: 1, debuffs: 'chilled', x: 0, y: 0 },
      { t: 'pull', playerId: 1, fromX: 0, fromY: 0, toX: 1 },
      { t: 'pull', playerId: 1, fromX: Number.NaN, fromY: 0, toX: 1, toY: 0 }, // NaN → null in JSON
      { t: 'blocked', x: 'left', y: 0 },
      { t: 'monsterAttack', kind: 'varkus', x: 0, y: 0, attack: 'dance' },
    ];
    const mixed = [bad[0], good[0], ...bad.slice(1, 8), good[1], ...bad.slice(8), good[2]];
    const r = parseServerMessage(JSON.stringify({ t: 'events', tick: 12, events: mixed }));
    expect(r.ok ? r.value : r.error).toEqual({ t: 'events', tick: 12, events: good });
  });

  it('passes one of every SimEvent type, including the debuff and bestiary events', () => {
    const events = everyEvent();
    expect(new Set(events.map((e) => e.t))).toEqual(new Set(SIM_EVENT_TYPES));
    const r = parseServerMessage(JSON.stringify({ t: 'events', tick: 90, events }));
    expect(r.ok ? r.value : r.error).toEqual({ t: 'events', tick: 90, events });
  });

  it('passes every monster attack kind, debuff id, new monster kind and new area kind', () => {
    const events: SimEvent[] = [
      ...MONSTER_ATTACKS.map((attack): SimEvent => ({ t: 'monsterAttack', kind: 'varkus', x: 0, y: 0, attack })),
      ...PLAYER_DEBUFFS.map((debuff): SimEvent => ({ t: 'debuff', playerId: 2, debuff, stacks: 2, x: 0, y: 0 })),
      { t: 'cleanse', playerId: 2, debuffs: [...PLAYER_DEBUFFS], x: 0, y: 0 },
      ...MONSTER_KINDS.map((kind): SimEvent => ({ t: 'monsterSpawn', kind, rarity: 0, x: 0, y: 0 })),
      ...NEW_AREA_KINDS.map((kind): SimEvent => ({ t: 'areaResolve', kind, x: 0, y: 0, radius: 30 })),
    ];
    expect(parseServerMessage(JSON.stringify({ t: 'events', tick: 4, events })).ok).toBe(true);
  });
});

describe('events channel: kinds the presenter looks up', () => {
  it('drops an event whose monster / projectile / area kind or skill this bundle has no art, name or sound for', () => {
    const good: SimEvent[] = [
      { t: 'death', kind: 'varkus', rarity: 4, x: 0, y: 0, facing: 1, damageType: 'fire' },
      { t: 'projectileEnd', kind: 'chainHook', x: 0, y: 0 },
      { t: 'areaResolve', kind: 'glacialSpike', x: 0, y: 0, radius: 20 },
    ];
    const bad: unknown[] = [
      { t: 'death', kind: 'dragon', rarity: 0, x: 0, y: 0, facing: 1, damageType: 'fire' },
      { t: 'death', rarity: 0, x: 0, y: 0, facing: 1, damageType: 'fire' },
      { t: 'monsterSpawn', kind: 'imp', rarity: 0, x: 0, y: 0 },
      { t: 'monsterAttack', kind: 'imp', x: 0, y: 0, attack: 'melee' },
      { t: 'monsterAttack', kind: 7, x: 0, y: 0, attack: 'melee' },
      { t: 'hit', playerId: 1, x: 0, y: 0, amount: 3, damageType: 'fire', crit: false, target: 'player', killed: false, kind: 'imp' },
      { t: 'waveTell', wave: 2, families: ['boneThrall', 'imp'], lieutenant: false, boss: false },
      { t: 'waveTell', wave: 2, families: 'boneThrall', lieutenant: false, boss: false },
      { t: 'projectileEnd', kind: 'arrow', x: 0, y: 0 },
      { t: 'areaResolve', kind: 'lavaPit', x: 0, y: 0, radius: 20 },
      { t: 'cast', playerId: 1, skill: 'fireball', x: 0, y: 0, dirX: 1, dirY: 0 },
      { t: 'nova', playerId: 1, skill: 'fireball', x: 0, y: 0, radius: 60 },
    ];
    const mixed = [bad[0], good[0], ...bad.slice(1, 6), good[1], ...bad.slice(6), good[2]];
    const r = parseServerMessage(JSON.stringify({ t: 'events', tick: 30, events: mixed }));
    expect(r.ok ? r.value : r.error).toEqual({ t: 'events', tick: 30, events: good });
  });

  it('passes every monster kind (deaths, spawns, attacks, hits, wave tells), projectile kind and area kind', () => {
    const events: SimEvent[] = [
      ...MONSTER_KINDS.flatMap((kind): SimEvent[] => [
        { t: 'death', kind, rarity: 0, x: 0, y: 0, facing: -1, damageType: 'cold' },
        { t: 'monsterAttack', kind, x: 0, y: 0, attack: 'melee' },
        { t: 'hit', playerId: 1, x: 0, y: 0, amount: 1, damageType: 'physical', crit: false, target: 'player', killed: false, kind },
      ]),
      ...Object.values(THEME_ROSTER).map((r): SimEvent => ({ t: 'waveTell', wave: 1, families: [...r.family], lieutenant: true, boss: true })),
      ...PROJECTILE_KINDS.map((kind): SimEvent => ({ t: 'projectileEnd', kind, x: 0, y: 0 })),
      ...AREA_KINDS.map((kind): SimEvent => ({ t: 'areaResolve', kind, x: 0, y: 0, radius: 10 })),
    ];
    const r = parseServerMessage(JSON.stringify({ t: 'events', tick: 8, events }));
    expect(r.ok ? r.value : r.error).toEqual({ t: 'events', tick: 8, events });
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

  it('plays debuffs, cleanses and hook pulls on the local player at once, and everyone else\'s on the render clock', () => {
    const tl = createEventTimeline();
    tl.setLocalPlayer(1);
    const myRoot: SimEvent = { t: 'debuff', playerId: 1, debuff: 'rooted', stacks: 1, x: 0, y: 0 };
    const myCleanse: SimEvent = { t: 'cleanse', playerId: 1, debuffs: ['burning'], x: 0, y: 0 };
    const myPull: SimEvent = { t: 'pull', playerId: 1, fromX: 0, fromY: 0, toX: 40, toY: 0 };
    const allyBleed: SimEvent = { t: 'debuff', playerId: 2, debuff: 'bleeding', stacks: 2, x: 9, y: 0 };
    const allyPull: SimEvent = { t: 'pull', playerId: 2, fromX: 9, fromY: 0, toX: 49, toY: 0 };
    const blocked: SimEvent = { t: 'blocked', x: 30, y: 30 };
    const hook: SimEvent = { t: 'monsterAttack', kind: 'chainThrall', x: 40, y: 0, attack: 'hook' };
    tl.push(400, [hook, myRoot, allyBleed, blocked, myPull, allyPull, myCleanse]);
    expect(tl.drain(350)).toEqual([myRoot, myPull, myCleanse]);
    expect(tl.drain(398)).toEqual([hook, allyBleed, blocked, allyPull]);
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
