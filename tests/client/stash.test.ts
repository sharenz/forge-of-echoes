// Special stash tabs (GAME_SPEC §12): the Map Stash and the two Crafting Stash tabs through the session — Ctrl-click
// contexts, partial withdrawals (Shift+Ctrl-click = 1), "Deposit all", crafting straight from a slot, drops — plus
// the stash-tab state reducers.
import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENCY_STASH_MAX, currencyStashUid, type CharacterSave, type CurrencyStack, type MapItem } from '../../src/contracts/items';
import type { UiState } from '../../src/contracts/ui';
import { rules } from '../../src/game';
import { SETTLE_MS } from '../../src/client/optimistic';
import { STASH_HIDEOUT_ERROR, validMoveCount } from '../../src/client/session';
import { DEFAULT_SETTINGS } from '../../src/client/settings';
import { SPECIAL_STASH_TABS, clampStashTab, initialUiState, openPanel, visibleLeftPanel, withCharacter } from '../../src/client/state';
import type { Panel } from '../../src/contracts/ui';
import { visiblePanels } from '../../src/ui/lib/panels';
import { answer, commands, enter, feed, flush, lastCmd, rig, type Rig } from './rig';

let r: Rig;
beforeEach(() => {
  r = rig();
  enter(r);
});

const shown = (): CharacterSave => r.box.get().character!;
const backpackCurrency = (ch: CharacterSave, id: string): number =>
  ch.backpack.entries.reduce((n, e) => n + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0);
const stackOf = (ch: CharacterSave, id: string): CurrencyStack =>
  ch.backpack.entries.map((e) => e.item).find((i): i is CurrencyStack => i.kind === 'currency' && i.currencyId === id)!;
const mapsIn = (ch: CharacterSave): MapItem[] =>
  ch.backpack.entries.map((e) => e.item).filter((i): i is MapItem => i.kind === 'map');

/** Open the stash on `tab` (the UI does this with openPanel + setStashTab). */
function openStash(tab: UiState['stashTab']): void {
  r.box.update((s) => ({ ...openPanel(openPanel(s, 'inventory'), 'stash'), stashTab: tab }));
}

/** The server confirms the newest command and pushes the character the rules produce (like the real server). */
function confirm(next: CharacterSave, message?: string): void {
  feed(r, { t: 'character', character: next });
  answer(r, true, message ? { message } : {});
}

/** A character whose Crafting Stash holds `stash`, entered as the authoritative state. */
function withStash(stash: CharacterSave['currencyStash'], mapStash: MapItem[] = []): CharacterSave {
  const ch = { ...r.ch, currencyStash: stash, mapStash };
  feed(r, { t: 'character', character: ch });
  return ch;
}

describe('stash tab state', () => {
  it('special tabs stay; normal tab indices clamp to the tabs the character has; garbage falls back to 0', () => {
    for (const t of SPECIAL_STASH_TABS) expect(clampStashTab(t, 2)).toBe(t);
    expect(clampStashTab(1, 2)).toBe(1);
    expect(clampStashTab(5, 2)).toBe(1);
    expect(clampStashTab(-1, 2)).toBe(0);
    expect(clampStashTab(1.5, 4)).toBe(0);
    expect(clampStashTab('nonsense' as UiState['stashTab'], 2)).toBe(0);
  });

  it('a character update keeps the Map Stash / Crafting Stash tab open', () => {
    const base = initialUiState({ ...DEFAULT_SETTINGS });
    for (const t of SPECIAL_STASH_TABS) {
      const s = withCharacter({ ...base, stashTab: t }, r.ch, null, () => true);
      expect(s.stashTab).toBe(t);
    }
  });

  it("the visible left panel follows the UI's own rule for every order of panels", () => {
    const panels: Panel[] = ['inventory', 'stash', 'character', 'skills', 'mapDevice', 'merchant', 'craftingBench', 'trade', 'party', 'menu', 'help'];
    // Every ordered pick of up to three panels.
    const lists: Panel[][] = [[]];
    for (const a of panels) {
      lists.push([a]);
      for (const b of panels) {
        if (b === a) continue;
        lists.push([a, b]);
        for (const c of panels) if (c !== a && c !== b) lists.push([a, b, c]);
      }
    }
    for (const open of lists) expect(visibleLeftPanel(open)).toBe(visiblePanels(open).left);
  });

  it('only whole amounts go on the wire', () => {
    expect(validMoveCount(undefined)).toBe(true);
    expect(validMoveCount(1)).toBe(true);
    expect(validMoveCount(40)).toBe(true);
    for (const bad of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) expect(validMoveCount(bad)).toBe(false);
  });
});

describe('Ctrl-click contexts', () => {
  it('a backpack currency with a Crafting Stash tab open files into its slot (shown at once)', () => {
    openStash('currency');
    const scrap = stackOf(shown(), 'scrap');
    r.session.quickMove(scrap.uid);
    expect(lastCmd(r).cmd).toEqual({ c: 'quickMove', uid: scrap.uid, stashTab: 'currency' });
    expect(backpackCurrency(shown(), 'scrap')).toBe(0);
    expect(shown().currencyStash.scrap).toBe(scrap.count);
  });

  it('a map currency files into its slot from the map-currency tab too', () => {
    openStash('mapCurrency');
    const dust = stackOf(shown(), 'mapDust');
    r.session.quickMove(dust.uid);
    expect(lastCmd(r).cmd).toMatchObject({ c: 'quickMove', stashTab: 'mapCurrency' });
    expect(shown().currencyStash.mapDust).toBe(dust.count);
  });

  it('a backpack map with the Map Stash open files into the Map Stash; Ctrl-click on it brings it back', () => {
    openStash('maps');
    const map = mapsIn(shown())[0];
    r.session.quickMove(map.uid);
    expect(lastCmd(r).cmd).toEqual({ c: 'quickMove', uid: map.uid, stashTab: 'maps' });
    expect(shown().mapStash.map((m) => m.uid)).toContain(map.uid);
    expect(mapsIn(shown()).some((m) => m.uid === map.uid)).toBe(false);
    r.session.quickMove(map.uid);
    expect(mapsIn(shown()).some((m) => m.uid === map.uid)).toBe(true);
  });

  it('with the stash closed a Ctrl-click never targets a stash tab, whatever tab was last shown', () => {
    r.box.update((s) => ({ ...s, stashTab: 'currency' }));
    const map = mapsIn(shown())[0];
    r.session.quickMove(map.uid);
    expect(lastCmd(r).cmd).toEqual({ c: 'quickMove', uid: map.uid, stashTab: null });
    expect(shown().mapDevice?.uid).toBe(map.uid);
  });

  it('a map Ctrl-clicked with a Crafting Stash tab open is refused here (nothing sent)', () => {
    openStash('currency');
    const map = mapsIn(shown())[0];
    const n = r.sent.length;
    r.session.quickMove(map.uid);
    expect(r.sent.length).toBe(n);
    expect(r.box.get().toasts.at(-1)).toMatchObject({ tone: 'bad', text: 'Only currency can be stored in the Crafting Stash.' });
    expect(r.sounds.at(-1)).toBe('uiError');
    expect(mapsIn(shown()).some((m) => m.uid === map.uid)).toBe(true);
  });

  it('a stash hidden behind another left panel is not the destination (the UI shows only the newest left panel)', () => {
    openStash('currency');
    r.box.update((s) => ({ ...s, openPanels: ['inventory', 'stash', 'craftingBench'] }));
    expect(r.session.quickMoveTab()).toBeNull();
    // A currency has nowhere to go without the stash: refused here, never filed into the hidden tab.
    const scrap = stackOf(shown(), 'scrap');
    const n = r.sent.length;
    r.session.quickMove(scrap.uid);
    expect(r.sent.length).toBe(n);
    expect(r.box.get().toasts.at(-1)?.tone).toBe('bad');
    expect(shown().currencyStash.scrap ?? 0).toBe(0);
    // Back on top (the bench closed): the stash's tab counts again.
    r.box.update((s) => ({ ...s, openPanels: ['stash', 'inventory'] }));
    expect(r.session.quickMoveTab()).toBe('currency');
  });

  it('outside a hideout the open tab is never used (the stash only works in hideouts)', () => {
    openStash('currency');
    feed(r, { t: 'zone', zone: { ...r.session.zone!, instanceId: 'm1', kind: 'map', theme: 'rimedOssuary' } });
    r.box.update((s) => ({ ...openPanel(s, 'stash'), stashTab: 'currency' }));
    expect(r.session.quickMoveTab()).toBeNull();
  });
});

describe('Crafting Stash withdrawals', () => {
  it('Shift+Ctrl-click takes exactly one; Ctrl-click a full stack', () => {
    withStash({ scrap: 120 });
    openStash('currency');
    const before = backpackCurrency(shown(), 'scrap');
    r.session.quickMove(currencyStashUid('scrap'), 1);
    expect(lastCmd(r).cmd).toEqual({ c: 'quickMove', uid: 'cstash:scrap', stashTab: 'currency', count: 1 });
    expect(backpackCurrency(shown(), 'scrap')).toBe(before + 1);
    expect(shown().currencyStash.scrap).toBe(119);
    r.session.quickMove(currencyStashUid('scrap'));
    expect(lastCmd(r).cmd).toEqual({ c: 'quickMove', uid: 'cstash:scrap', stashTab: 'currency' });
    // A full backpack stack is 40: the slot gives exactly that much, no more.
    expect(shown().currencyStash.scrap).toBe(79);
    expect(backpackCurrency(shown(), 'scrap')).toBe(before + 41);
  });

  it('a slot dragged to a backpack cell (with or without a count) is a moveItem with that count', () => {
    withStash({ kindling: 30 });
    openStash('currency');
    const free = { kind: 'backpack' as const, x: 11, y: 4 };
    expect(r.session.moveItem(currencyStashUid('kindling'), free, 5)).toBe(true);
    expect(lastCmd(r).cmd).toEqual({ c: 'moveItem', uid: 'cstash:kindling', to: free, count: 5 });
    expect(shown().currencyStash.kindling).toBe(25);
    expect(r.session.moveItem(currencyStashUid('kindling'), { kind: 'backpack', x: 10, y: 4 })).toBe(true);
    expect(lastCmd(r).cmd).toEqual({ c: 'moveItem', uid: 'cstash:kindling', to: { kind: 'backpack', x: 10, y: 4 } });
  });

  it('a currency dropped on a Crafting Stash tab deposits (position-free location)', () => {
    const seal = stackOf(shown(), 'seal');
    expect(r.session.moveItem(seal.uid, { kind: 'currencyStash' })).toBe(true);
    expect(lastCmd(r).cmd).toEqual({ c: 'moveItem', uid: seal.uid, to: { kind: 'currencyStash' } });
    expect(shown().currencyStash.seal).toBe(seal.count);
  });

  it('a backpack map dropped on the Map Stash tab files into it (shown at once)', () => {
    const map = mapsIn(shown())[0];
    expect(r.session.moveItem(map.uid, { kind: 'mapStash' })).toBe(true);
    expect(lastCmd(r).cmd).toEqual({ c: 'moveItem', uid: map.uid, to: { kind: 'mapStash' } });
    expect(shown().mapStash.map((m) => m.uid)).toContain(map.uid);
    expect(mapsIn(shown()).some((m) => m.uid === map.uid)).toBe(false);
  });

  it('a move that changes nothing is done without a round trip (true: not an error)', () => {
    const map = mapsIn(r.ch)[0];
    const entries = r.ch.backpack.entries.filter((e) => e.item.uid !== map.uid);
    feed(r, { t: 'character', character: { ...r.ch, currencyStash: { scrap: 50 }, mapStash: [map], backpack: { ...r.ch.backpack, entries } } });
    const n = r.sent.length;
    const sounds = r.sounds.length;
    expect(r.session.moveItem(currencyStashUid('scrap'), { kind: 'currencyStash' })).toBe(true);
    expect(r.session.moveItem(map.uid, { kind: 'mapStash' })).toBe(true);
    const first = shown().backpack.entries[0];
    expect(r.session.moveItem(first.item.uid, { kind: 'backpack', x: first.x, y: first.y })).toBe(true);
    expect(r.sent.length).toBe(n);
    expect(r.sounds.length).toBe(sounds);
    expect(r.session.character.pending).toBe(0);
  });

  it('an empty slot or a bad amount is refused locally without a round trip', () => {
    const n = r.sent.length;
    openStash('currency');
    r.session.quickMove(currencyStashUid('fractureCore'));
    r.session.quickMove(currencyStashUid('scrap'), 0);
    expect(r.session.moveItem(stackOf(shown(), 'scrap').uid, { kind: 'backpack', x: 11, y: 4 }, 2.5)).toBe(false);
    // The empty slot is refused by the rules' prediction, the bad amounts before it: nothing is sent.
    expect(r.sent.length).toBe(n);
    const bad = r.box.get().toasts.filter((t) => t.tone === 'bad');
    expect(bad.length).toBe(3);
    expect(r.sounds.filter((s) => s === 'uiError').length).toBe(3);
  });
});

describe('Deposit all', () => {
  it('moves every backpack currency at once and toasts what the server says', async () => {
    const before = shown();
    const total = before.backpack.entries.reduce((n, e) => n + (e.item.kind === 'currency' ? e.item.count : 0), 0);
    r.session.depositAllCurrency();
    expect(lastCmd(r).cmd).toEqual({ c: 'depositAllCurrency' });
    expect(shown().backpack.entries.some((e) => e.item.kind === 'currency')).toBe(false);
    expect(Object.values(shown().currencyStash).reduce((a, b) => a + (b ?? 0), 0)).toBe(total);
    const server = rules.depositAllCurrency(before);
    if (!server.ok) throw new Error(server.error);
    confirm(server.value, `Stored ${total} currency in the Crafting Stash.`);
    await flush();
    expect(r.box.get().toasts.at(-1)).toMatchObject({ tone: 'good', text: `Stored ${total} currency in the Crafting Stash.` });
    expect(r.sounds).toContain('pickupCurrency');
    // The push came before the answer: the prediction retires after its short grace.
    r.clock.t += SETTLE_MS;
    r.session.tick(r.clock.t);
    expect(shown()).toBe(server.value);
  });

  it('the sound comes with the picture, before the answer', () => {
    r.session.depositAllCurrency();
    expect(r.sounds).toEqual(['pickupCurrency']);
    expect(shown().backpack.entries.some((e) => e.item.kind === 'currency')).toBe(false);
  });

  it('when some currency stays behind (a full slot) the toast is informative, not a success', async () => {
    const before = withStash({ scrap: CURRENCY_STASH_MAX });
    const scrap = backpackCurrency(before, 'scrap');
    expect(scrap).toBeGreaterThan(0);
    r.session.depositAllCurrency();
    // The lock-aware rules predict what the server does: Scrap stays, the rest goes.
    expect(backpackCurrency(shown(), 'scrap')).toBe(scrap);
    const server = rules.depositAllCurrency(before);
    if (!server.ok) throw new Error(server.error);
    const msg = `Stored 10 currency in the Crafting Stash. ${scrap} stayed in your backpack (Scrap: slot full).`;
    confirm(server.value, msg);
    await flush();
    expect(r.box.get().toasts.at(-1)).toMatchObject({ tone: 'info', text: msg });
    expect(r.sounds.filter((s) => s === 'pickupCurrency')).toHaveLength(1);
  });

  it('the toast goes by the prediction when the answer beats the push', async () => {
    withStash({ scrap: CURRENCY_STASH_MAX });
    r.session.depositAllCurrency();
    answer(r, true, { message: 'Stored some currency.' });
    await flush();
    expect(r.box.get().toasts.at(-1)).toMatchObject({ tone: 'info' });
  });

  it('a refusal puts the currency back', async () => {
    const before = backpackCurrency(shown(), 'scrap');
    r.session.depositAllCurrency();
    expect(backpackCurrency(shown(), 'scrap')).toBe(0);
    answer(r, false, { error: 'That item is in a trade.' });
    await flush();
    expect(backpackCurrency(shown(), 'scrap')).toBe(before);
    expect(r.box.get().toasts.at(-1)?.tone).toBe('bad');
  });

  it('with no currency in the backpack the rules explain without sending', () => {
    const empty = rules.depositAllCurrency(r.ch);
    if (!empty.ok) throw new Error(empty.error);
    feed(r, { t: 'character', character: empty.value });
    const n = r.sent.length;
    r.session.depositAllCurrency();
    expect(r.sent.length).toBe(n);
    expect(r.box.get().toasts.at(-1)).toMatchObject({ tone: 'bad', text: 'There is no currency in your backpack.' });
  });

  it('is refused outside a hideout', () => {
    feed(r, { t: 'zone', zone: { ...r.session.zone!, instanceId: 'm1', kind: 'map', theme: 'ironColiseum' } });
    const n = r.sent.length;
    r.session.depositAllCurrency();
    expect(r.sent.length).toBe(n);
    expect(r.box.get().toasts.at(-1)).toMatchObject({ tone: 'bad', text: STASH_HIDEOUT_ERROR });
  });
});

describe('crafting from the Crafting Stash', () => {
  it('a slot arms like a stack and crafts with the slot uid; an emptied slot disarms itself', () => {
    const ch = withStash({ scrap: 1 });
    r.session.armCurrency(currencyStashUid('scrap'));
    expect(r.box.get().armed).toEqual({ uid: 'cstash:scrap', currencyId: 'scrap' });
    const wand = ch.equipment.mainHand!;
    r.session.applyArmed(wand.uid);
    expect(commands(r).at(-1)).toEqual({ c: 'applyCurrency', currencyUid: 'cstash:scrap', targetUid: wand.uid });
    // The server used the last Scrap in the slot: the pushed character no longer has it.
    feed(r, { t: 'character', character: { ...ch, currencyStash: {} } });
    expect(r.box.get().armed).toBeNull();
  });
});

describe('dropping stash items', () => {
  it('a Crafting Stash slot is not an item: refused locally', () => {
    withStash({ scrap: 50 });
    const n = r.sent.length;
    r.session.dropItem(currencyStashUid('scrap'));
    expect(r.sent.length).toBe(n);
    expect(r.box.get().toasts.at(-1)?.tone).toBe('bad');
  });

  it('a Map Stash map drops like a stashed item in a hideout (gone at once)', () => {
    const map = mapsIn(r.ch)[0];
    const entries = r.ch.backpack.entries.filter((e) => e.item.uid !== map.uid);
    feed(r, { t: 'character', character: { ...r.ch, mapStash: [map], backpack: { ...r.ch.backpack, entries } } });
    r.session.dropItem(map.uid);
    expect(lastCmd(r).cmd).toEqual({ c: 'dropItem', uid: map.uid });
    expect(shown().mapStash).toHaveLength(0);
  });
});
