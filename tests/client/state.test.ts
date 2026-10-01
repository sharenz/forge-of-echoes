// UiState reducers for server messages and client events.
import { describe, expect, it } from 'vitest';
import type { RunSetup } from '../../src/contracts/game';
import type { PartyInfo, RunSummaryInfo } from '../../src/contracts/net';
import type { HudState, UiState } from '../../src/contracts/ui';
import { rules } from '../../src/game';
import { DEFAULT_SETTINGS } from '../../src/client/settings';
import {
  MAX_CHAT_LINES, MAX_TOASTS, SERVER_UPDATING_TEXT, addInvite, closePanel, dismissToast, initialUiState, leaveGameState,
  openPanel, pushChat, pushToast, removeInvite, togglePanel, withCharacter, withParty, withRunSummary, withServerUpdating,
  withZone, withoutRunSummary,
} from '../../src/client/state';
import { zoneInfo } from './helpers';

const base = (): UiState => initialUiState({ ...DEFAULT_SETTINGS });

function setupFor(): RunSetup {
  const ch = rules.createCharacter('Ysolde', 3);
  const map = ch.backpack.entries.find((e) => e.item.kind === 'map');
  if (!map || map.item.kind !== 'map') throw new Error('starting kit without a map');
  const r = rules.openMap({ ...ch, mapDevice: map.item });
  if (!r.ok) throw new Error(r.error);
  return r.value.setup;
}

const hud = (p: Partial<HudState> = {}): HudState => ({
  zone: 'map', zoneOwnerName: 'Mira', zoneIsOwn: false, life: 0, maxLife: 100, focus: 10, maxFocus: 50, wardFraction: 0.5,
  level: 4, xp: 10, xpToNext: 100, slots: [], flasks: [], run: null, portal: null,
  allies: [{ name: 'Mira', level: 5, life: 1, maxLife: 2, dead: false }], debuffs: [{ id: 'chilled', remaining: 1, duration: 2, stacks: 1 }],
  fps: 60, pingMs: 20, dead: true, ...p,
});

describe('initial state', () => {
  it('starts on the loading screen with the given settings', () => {
    const s = base();
    expect(s.screen).toBe('loading');
    expect(s.connection).toBe('offline');
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.openPanels).toEqual([]);
  });
});

describe('toasts and chat', () => {
  it('caps toasts and dismisses by id', () => {
    let s = base();
    for (let i = 1; i <= MAX_TOASTS + 3; i++) s = pushToast(s, { id: i, text: `t${i}`, tone: 'info' });
    expect(s.toasts).toHaveLength(MAX_TOASTS);
    expect(s.toasts[0].id).toBe(4);
    const before = s;
    s = dismissToast(s, 5);
    expect(s.toasts.some((t) => t.id === 5)).toBe(false);
    expect(dismissToast(s, 999)).toBe(s);
    expect(before.toasts).toHaveLength(MAX_TOASTS); // immutable
  });

  it('keeps a bounded chat scrollback', () => {
    let s = base();
    for (let i = 0; i < MAX_CHAT_LINES + 10; i++) s = pushChat(s, { id: i, fromName: 'Mira', text: `m${i}`, time: i });
    expect(s.chat).toHaveLength(MAX_CHAT_LINES);
    expect(s.chat[s.chat.length - 1].text).toBe(`m${MAX_CHAT_LINES + 9}`);
  });
});

describe('party & invites', () => {
  const party: PartyInfo = {
    id: 'p1',
    leaderId: 'mira',
    members: [
      { characterId: 'mira', name: 'Mira', level: 5, online: true, isLeader: true, zone: null, activeMap: null },
      { characterId: 'me', name: 'Ysolde', level: 3, online: true, isLeader: false, zone: null, activeMap: null },
    ],
  };

  it('replaces a repeated invite from the same player and removes answered ones', () => {
    let s = addInvite(base(), { inviteId: 'i1', fromCharacterId: 'mira', fromName: 'Mira' });
    s = addInvite(s, { inviteId: 'i2', fromCharacterId: 'mira', fromName: 'Mira' });
    s = addInvite(s, { inviteId: 'i3', fromCharacterId: 'corvin', fromName: 'Corvin' });
    expect(s.invites.map((i) => i.inviteId)).toEqual(['i2', 'i3']);
    s = removeInvite(s, 'i2');
    expect(s.invites.map((i) => i.inviteId)).toEqual(['i3']);
  });

  it('drops invites from players who are now party members', () => {
    let s = addInvite(base(), { inviteId: 'i1', fromCharacterId: 'mira', fromName: 'Mira' });
    s = addInvite(s, { inviteId: 'i2', fromCharacterId: 'corvin', fromName: 'Corvin' });
    s = withParty(s, party);
    expect(s.party).toBe(party);
    expect(s.invites.map((i) => i.inviteId)).toEqual(['i2']);
    expect(withParty(s, null).party).toBeNull();
  });
});

describe('zones', () => {
  it('entering my hideout: game screen, crafting allowed, own-hideout flags', () => {
    const s = withZone({ ...base(), busy: true, screen: 'characters' }, zoneInfo({ ownerCharacterId: 'me' }), 'me');
    expect(s.screen).toBe('game');
    expect(s.busy).toBe(false);
    expect(s.zone).toBe('hideout');
    expect(s.craftingAllowed).toBe(true);
    expect(s.isOwnHideout).toBe(true);
    expect(s.run).toBeNull();
  });

  it("visiting a party member's hideout: crafting yes, device/merchant no", () => {
    const s = withZone(base(), zoneInfo({ ownerCharacterId: 'mira', ownerName: 'Mira' }), 'me');
    expect(s.craftingAllowed).toBe(true);
    expect(s.isOwnHideout).toBe(false);
  });

  it('entering a map: run setup set, crafting off, armed currency dropped, hideout panels closed', () => {
    const setup = setupFor();
    let s = { ...base(), openPanels: ['inventory', 'stash', 'mapDevice'] as UiState['openPanels'] };
    s = { ...s, armed: { uid: 'c1', currencyId: 'scrap' }, affixChoice: { currencyUid: 'c1', targetUid: 'x', currencyId: 'seal' } };
    s = withZone(s, zoneInfo({ kind: 'map', theme: 'ashenForge', mapName: 'Ashen Forge', tier: 1, setup }), 'me');
    expect(s.zone).toBe('map');
    expect(s.run).toBe(setup);
    expect(s.craftingAllowed).toBe(false);
    expect(s.armed).toBeNull();
    expect(s.affixChoice).toBeNull();
    expect(s.openPanels).toEqual(['inventory']);
  });

  it('keeps a provisional HUD across the zone change (alive, no allies, new labels)', () => {
    const s = withZone({ ...base(), hud: hud() }, zoneInfo({ ownerCharacterId: 'me', ownerName: 'Ysolde' }), 'me');
    expect(s.hud).not.toBeNull();
    expect(s.hud!.zone).toBe('hideout');
    expect(s.hud!.zoneIsOwn).toBe(true);
    expect(s.hud!.dead).toBe(false);
    expect(s.hud!.allies).toEqual([]);
    // Debuffs belong to the instance left behind: the new zone starts clean.
    expect(s.hud!.debuffs).toEqual([]);
    expect(s.hud!.level).toBe(4);
  });

  it('resuming the same instance after a reconnect keeps hideout panels and the HUD as they are', () => {
    const before = { ...base(), openPanels: ['inventory', 'stash'] as UiState['openPanels'], hud: hud({ zone: 'hideout', dead: false }) };
    const s = withZone(before, zoneInfo({ ownerCharacterId: 'me' }), 'me', true);
    expect(s.openPanels).toBe(before.openPanels);
    expect(s.hud).toBe(before.hud);
    expect(s.screen).toBe('game');
    expect(s.isOwnHideout).toBe(true);
    // A real zone change closes them.
    expect(withZone(before, zoneInfo({ ownerCharacterId: 'me' }), 'me').openPanels).toEqual(['inventory']);
  });

  it('the run summary keeps the setup of the map just left until it is dismissed', () => {
    const setup = setupFor();
    let s = withZone(base(), zoneInfo({ kind: 'map', setup }), 'me');
    s = withZone(s, zoneInfo({ kind: 'hideout', ownerCharacterId: 'me' }), 'me');
    expect(s.run).toBeNull();
    const summary: RunSummaryInfo = { result: 'cleared', mapName: 'Ashen Forge', tier: 1, seconds: 300, kills: 400, xpGained: 900, levelsGained: 1, itemsFound: [] };
    s = withRunSummary(s, summary, setup);
    expect(s.runSummary).toBe(summary);
    expect(s.run).toBe(setup);
    s = withoutRunSummary(s);
    expect(s.runSummary).toBeNull();
    expect(s.run).toBeNull();
  });
});

describe('character', () => {
  it('bumps levelUpCount only when the same character levels up', () => {
    const ch = rules.createCharacter('Ysolde', 1);
    const has = () => true;
    let s = withCharacter(base(), ch, null, has);
    expect(s.levelUpCount).toBe(0);
    s = withCharacter(s, { ...ch, level: 2 }, null, has);
    expect(s.levelUpCount).toBe(1);
    s = withCharacter(s, { ...ch, level: 2, xp: 5 }, null, has);
    expect(s.levelUpCount).toBe(1);
    const other = rules.createCharacter('Other', 2);
    s = withCharacter(s, { ...other, level: 9 }, null, has);
    expect(s.levelUpCount).toBe(1);
  });

  it('disarms a used-up currency stack and clamps the stash tab', () => {
    const ch = rules.createCharacter('Ysolde', 1);
    let s: UiState = { ...base(), armed: { uid: 'gone', currencyId: 'scrap' }, stashTab: 5 };
    s = withCharacter(s, ch, null, (uid) => uid !== 'gone');
    expect(s.armed).toBeNull();
    expect(s.stashTab).toBe(Math.max(0, ch.stash.length - 1));
  });
});

describe('panels', () => {
  it('open / close / toggle keep order and identity when nothing changes', () => {
    let s = openPanel(base(), 'inventory');
    s = openPanel(s, 'character');
    expect(s.openPanels).toEqual(['inventory', 'character']);
    expect(openPanel(s, 'inventory')).toBe(s);
    s = togglePanel(s, 'inventory');
    expect(s.openPanels).toEqual(['character']);
    expect(closePanel(s, 'stash')).toBe(s);
  });

  it('leaving the game clears in-game state but keeps account and settings', () => {
    const s = leaveGameState({ ...base(), account: { id: 'a', username: 'u' }, zone: 'map', openPanels: ['inventory'], chat: [{ id: 1, fromName: '', text: 'x', time: 0 }] });
    expect(s.account).toEqual({ id: 'a', username: 'u' });
    expect(s.zone).toBeNull();
    expect(s.openPanels).toEqual([]);
    expect(s.chat).toEqual([]);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('server update (4004)', () => {
  it('shows the calm reconnecting screen and keeps the game state for the resume', () => {
    const party: PartyInfo = { id: 'p1', leaderId: 'a', members: [] };
    const inGame = { ...withParty(withZone(base(), zoneInfo(), 'me'), party), paused: true, busy: true };
    const s = withServerUpdating(inGame);
    expect(s.screen).toBe('disconnected');
    expect(s.error).toBe(SERVER_UPDATING_TEXT);
    expect(s.busy).toBe(false);
    expect(s.paused).toBe(false);
    expect(s.party).toBe(party);
    expect(s.zone).toBe('hideout');
    expect(withServerUpdating(s)).toBe(s);
    // Back in: the zone puts the game screen up again and clears the headline.
    const back = withZone(s, zoneInfo(), 'me');
    expect(back.screen).toBe('game');
    expect(back.error).toBeNull();
    expect(back.party).toBe(party);
  });

  it('the crafting bench closes on a zone change like the other hideout objects', () => {
    const s = withZone(openPanel(base(), 'craftingBench'), zoneInfo({ instanceId: 'm1', kind: 'map' }), 'me');
    expect(s.openPanels).not.toContain('craftingBench');
  });
});
