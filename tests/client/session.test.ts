// GameSession: server messages → UiState, commands with results and optimistic predictions, the input pipeline
// (keyboard, pause, auto-attack, autopilot) and the HUD.
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SfxId } from '../../src/contracts/audio';
import type { CharacterSave, EquipmentItem } from '../../src/contracts/items';
import type { ClientMessage, CommandMessage, PartyInfo, ServerMessage } from '../../src/contracts/net';
import { rules } from '../../src/game';
import { Autopilot } from '../../src/client/bot';
import {
  GameSession, INVITE_TTL_MS, SOCIAL_RESYNC_MS, SnapshotUnreadableError, WORLD_READABLE_SNAPSHOTS, craftFeedback,
} from '../../src/client/session';
import { SNAPSHOT_VERSION } from '../../src/net';
import { DEFAULT_SETTINGS } from '../../src/client/settings';
import { initialUiState } from '../../src/client/state';
import { createStateBox, type StateBox } from '../../src/client/store';
import { addMonster, fakeWorld, player, prop, worldView, zoneInfo, type FakeWorld } from './helpers';

const IDLE = { moveX: 0, moveY: 0, held: 0, flask: -1 };
const flush = () => new Promise((r) => setTimeout(r, 0));

interface Rig {
  session: GameSession;
  box: StateBox;
  world: FakeWorld;
  sent: ClientMessage[];
  sounds: SfxId[];
  zones: number;
  /** `resumed` flag of every zoneEntered call. */
  resumes: boolean[];
  clock: { t: number };
}

function rig(): Rig {
  const box = createStateBox(initialUiState({ ...DEFAULT_SETTINGS }));
  const world = fakeWorld(worldView({ players: [player(1, 'Ysolde', 0, 0), player(2, 'Mira', 40, 0)] }));
  const sent: ClientMessage[] = [];
  const sounds: SfxId[] = [];
  const clock = { t: 1000 };
  const r: Rig = { session: null as unknown as GameSession, box, world, sent, sounds, zones: 0, resumes: [], clock };
  r.session = new GameSession({
    box,
    rules,
    send: (m) => {
      sent.push(m);
      return true;
    },
    now: () => clock.t,
    wallNow: () => 1_700_000_000_000,
    sound: (id) => sounds.push(id),
    zoneEntered: (_zone, resumed) => {
      r.zones++;
      r.resumes.push(resumed);
    },
    world,
  });
  return r;
}

function feed(r: Rig, ...msgs: ServerMessage[]): void {
  for (const m of msgs) r.session.handle(m);
}

function enter(r: Rig, ch: CharacterSave): void {
  feed(
    r,
    { t: 'welcome', protocol: PROTOCOL_VERSION, characterId: ch.id, tickRate: 60, serverTime: 0 },
    { t: 'character', character: ch },
    { t: 'zone', zone: zoneInfo({ ownerCharacterId: ch.id, ownerName: ch.name, props: [prop(1, 'mapDevice', 0, -180)] }) },
  );
}

const lastCmd = (r: Rig): CommandMessage => {
  const m = [...r.sent].reverse().find((x) => x.t === 'cmd');
  if (!m || m.t !== 'cmd') throw new Error('no command sent');
  return m;
};

let r: Rig;
let ch: CharacterSave;
beforeEach(() => {
  r = rig();
  ch = { ...rules.createCharacter('Ysolde', 42), id: 'me' };
});

describe('connection handshake', () => {
  it('welcome → character → zone puts the player in the game', () => {
    enter(r, ch);
    const s = r.box.get();
    expect(s.screen).toBe('game');
    expect(s.zone).toBe('hideout');
    expect(s.isOwnHideout).toBe(true);
    expect(s.character?.name).toBe('Ysolde');
    expect(s.derived?.combat.maxLife).toBeGreaterThan(0);
    expect(r.world.zones).toHaveLength(1);
    expect(r.zones).toBe(1);
    expect(r.session.characterId).toBe('me');
  });

  it('a reconnect into the same instance is a resume; anything else is a new zone', () => {
    enter(r, ch);
    r.box.update((s) => ({ ...s, openPanels: ['inventory', 'stash'] }));
    // Short drop: new socket, the server resumes the character in place.
    r.session.connectionOpened();
    feed(r, { t: 'zone', zone: zoneInfo({ ownerCharacterId: 'me', props: [prop(1, 'mapDevice', 0, -180)] }) });
    expect(r.resumes).toEqual([false, true]);
    expect(r.box.get().openPanels).toEqual(['inventory', 'stash']);
    expect(r.world.zones).toHaveLength(2); // the replica still restarts (input seqs start over)
    // The same instance id without a reconnect (or a new instance after one) is a normal entry.
    feed(r, { t: 'zone', zone: zoneInfo({ ownerCharacterId: 'me' }) });
    r.session.connectionOpened();
    feed(r, { t: 'zone', zone: zoneInfo({ instanceId: 'h2', ownerCharacterId: 'me' }) });
    expect(r.resumes).toEqual([false, true, false, false]);
    expect(r.box.get().openPanels).toEqual(['inventory']);
  });

  it('after a server update (4004 streak) the same instance and player id are never an in-place resume', () => {
    enter(r, ch);
    r.box.update((s) => ({ ...s, openPanels: ['inventory', 'stash'] }));
    // The restarted server numbers instances and players from 1 again: h1 / player 1 is a coincidence.
    r.session.connectionOpened(false);
    feed(r, { t: 'welcome', protocol: PROTOCOL_VERSION, characterId: 'me', tickRate: 60, serverTime: 0 });
    feed(r, { t: 'zone', zone: zoneInfo({ ownerCharacterId: 'me', props: [prop(1, 'mapDevice', 0, -180)] }) });
    expect(r.resumes).toEqual([false, false]);
    expect(r.box.get().openPanels).toEqual(['inventory']);
    // A later short drop resumes in place again.
    r.session.connectionOpened();
    feed(r, { t: 'zone', zone: zoneInfo({ ownerCharacterId: 'me', props: [prop(1, 'mapDevice', 0, -180)] }) });
    expect(r.resumes).toEqual([false, false, true]);
  });

  it('a fresh socket restarts the input sequence', () => {
    enter(r, ch);
    r.session.inputTick(IDLE, { x: 0, y: 0 }, { blocked: false, autoAttack: false, bot: null, alpha: 1 });
    r.session.inputTick(IDLE, { x: 0, y: 0 }, { blocked: false, autoAttack: false, bot: null, alpha: 1 });
    expect(r.session.seq).toBe(2);
    r.session.connectionOpened();
    expect(r.session.seq).toBe(0);
  });
});

describe('party and invites after a reconnect', () => {
  const party: PartyInfo = {
    id: 'p1',
    leaderId: 'mira',
    members: [
      { characterId: 'mira', name: 'Mira', level: 5, online: true, isLeader: true, zone: null, activeMap: null },
      { characterId: 'me', name: 'Ysolde', level: 3, online: true, isLeader: false, zone: null, activeMap: null },
    ],
  };
  const invite = (id: string, from: string) => ({ inviteId: id, fromCharacterId: from, fromName: from });
  const welcome: ServerMessage = { t: 'welcome', protocol: PROTOCOL_VERSION, characterId: 'me', tickRate: 60, serverTime: 0 };
  const zone = (): ServerMessage => ({ t: 'zone', zone: zoneInfo({ ownerCharacterId: 'me' }) });
  const snapshot = () => r.session.snapshot(new ArrayBuffer(8), r.clock.t);

  beforeEach(() => {
    enter(r, ch);
    feed(r, { t: 'party', party }, { t: 'invite', invite: invite('i1', 'corvin') }, { t: 'invite', invite: invite('i2', 'brann') });
    r.sounds.length = 0;
  });

  it('what the server re-sends stays up without a blink or a second invite sound', () => {
    r.session.connectionLost();
    r.session.connectionOpened();
    const seen: (PartyInfo | null)[] = [];
    const off = r.box.subscribe(() => seen.push(r.box.get().party));
    feed(r, welcome, { t: 'character', character: ch }, zone(), { t: 'party', party }, { t: 'invite', invite: invite('i1', 'corvin') });
    snapshot();
    off();
    expect(seen.every((p) => p !== null)).toBe(true);
    expect(r.box.get().party?.id).toBe('p1');
    // i2 was not re-sent: it is gone on the server (expired or withdrawn).
    expect(r.box.get().invites.map((i) => i.inviteId)).toEqual(['i1']);
    expect(r.sounds).not.toContain('partyInvite');
  });

  it('a party the server did not re-send (dissolved, kicked while away, not restored) is dropped at the first snapshot', () => {
    r.session.connectionLost();
    r.session.connectionOpened(false);
    feed(r, welcome, { t: 'character', character: ch }, zone());
    expect(r.box.get().party?.id).toBe('p1'); // the burst is not over yet
    snapshot();
    expect(r.box.get().party).toBeNull();
    expect(r.box.get().invites).toEqual([]);
    // A later snapshot changes nothing, and a new party message still applies.
    snapshot();
    feed(r, { t: 'party', party });
    expect(r.box.get().party?.id).toBe('p1');
  });

  it('without a snapshot the check settles after SOCIAL_RESYNC_MS', () => {
    r.session.connectionOpened();
    feed(r, welcome, zone());
    r.clock.t += SOCIAL_RESYNC_MS - 1;
    r.session.tick(r.clock.t);
    expect(r.box.get().party).not.toBeNull();
    r.clock.t += 1;
    r.session.tick(r.clock.t);
    expect(r.box.get().party).toBeNull();
    expect(r.box.get().invites).toEqual([]);
  });

  it('an explicit party: null from the server clears it at once', () => {
    r.session.connectionOpened();
    feed(r, welcome, zone(), { t: 'party', party: null });
    expect(r.box.get().party).toBeNull();
    snapshot();
    expect(r.box.get().party).toBeNull();
  });
});

describe('snapshots', () => {
  it('a snapshot the replica could not decode throws (the connection counts those); decoded ones count as readable', () => {
    const errors = { n: 0 };
    r.world.stats = () => ({ decodeErrors: errors.n }) as ReturnType<typeof r.world.stats>;
    r.world.pushSnapshot = (data: ArrayBuffer) => {
      if (new Uint8Array(data)[0] !== SNAPSHOT_VERSION) errors.n++;
    };
    const buf = (v: number) => new Uint8Array([v, 0, 0, 0]).buffer;
    // Before a zone snapshots are ignored.
    expect(() => r.session.snapshot(buf(SNAPSHOT_VERSION + 1), 0)).not.toThrow();
    enter(r, ch);
    expect(() => r.session.snapshot(buf(SNAPSHOT_VERSION + 1), 0)).toThrow(SnapshotUnreadableError);
    expect(() => r.session.snapshot(buf(SNAPSHOT_VERSION + 1), 0)).toThrow(`format ${SNAPSHOT_VERSION + 1}`);
    for (let i = 0; i < WORLD_READABLE_SNAPSHOTS - 1; i++) r.session.snapshot(buf(SNAPSHOT_VERSION), 0);
    expect(r.session.worldReadable).toBe(false);
    r.session.snapshot(buf(SNAPSHOT_VERSION), 0);
    expect(r.session.worldReadable).toBe(true);
    // One bad snapshot starts the count over.
    expect(() => r.session.snapshot(buf(0), 0)).toThrow(SnapshotUnreadableError);
    expect(r.session.worldReadable).toBe(false);
  });
});

describe('social messages', () => {
  beforeEach(() => enter(r, ch));

  it('invites show with a sound and fall back to expiring after INVITE_TTL_MS', () => {
    feed(r, { t: 'invite', invite: { inviteId: 'i1', fromCharacterId: 'mira', fromName: 'Mira' } });
    expect(r.box.get().invites).toHaveLength(1);
    expect(r.sounds).toContain('partyInvite');
    // Longer than the server's minute: the server may have renewed it silently.
    expect(INVITE_TTL_MS).toBeGreaterThan(60_000);
    r.clock.t += 61_000;
    r.session.tick(r.clock.t);
    expect(r.box.get().invites).toHaveLength(1);
    r.clock.t += INVITE_TTL_MS;
    r.session.tick(r.clock.t);
    expect(r.box.get().invites).toHaveLength(0);
  });

  it('an invite re-sent after a reconnect renews the card without another sound', () => {
    const invite = { inviteId: 'i1', fromCharacterId: 'mira', fromName: 'Mira' };
    feed(r, { t: 'invite', invite });
    r.clock.t += INVITE_TTL_MS - 1000;
    feed(r, { t: 'invite', invite });
    expect(r.sounds.filter((x) => x === 'partyInvite')).toHaveLength(1);
    r.clock.t += 2000;
    r.session.tick(r.clock.t);
    expect(r.box.get().invites).toHaveLength(1);
  });

  it('answering an invite removes it and sends partyRespond', () => {
    feed(r, { t: 'invite', invite: { inviteId: 'i1', fromCharacterId: 'mira', fromName: 'Mira' } });
    r.session.partyRespond('i1', true);
    expect(r.box.get().invites).toHaveLength(0);
    expect(lastCmd(r).cmd).toEqual({ c: 'partyRespond', inviteId: 'i1', accept: true });
  });

  it('chat lines are kept; only other people make the chat sound', () => {
    feed(r, { t: 'chat', fromName: 'Ysolde', text: 'hi', time: 1 });
    expect(r.sounds.filter((x) => x === 'chat')).toHaveLength(0);
    feed(r, { t: 'chat', fromName: 'Mira', text: 'hey', time: 2 }, { t: 'chat', fromName: '', text: 'Mira joined the party.', time: 3 });
    expect(r.box.get().chat.map((c) => c.text)).toEqual(['hi', 'hey', 'Mira joined the party.']);
    expect(r.sounds.filter((x) => x === 'chat')).toHaveLength(2);
  });

  it('toasts arrive in order; bad ones play the error sound', () => {
    feed(r, { t: 'toast', text: 'Carrion Fang', tone: 'rare' }, { t: 'toast', text: 'Your backpack is full.', tone: 'bad' });
    expect(r.box.get().toasts.map((t) => [t.text, t.tone])).toEqual([
      ['Carrion Fang', 'rare'],
      ['Your backpack is full.', 'bad'],
    ]);
    expect(r.sounds).toContain('uiError');
  });

  it('portal updates reach the HUD', () => {
    r.clock.t += 100;
    expect(r.session.hud(r.clock.t, 60)?.portal).toBeNull();
    feed(r, { t: 'portal', portal: { ownerCharacterId: 'me', ownerName: 'Ysolde', mapName: 'Ashen Forge', tier: 1, remaining: 8, total: 8, cleared: false } });
    expect(r.session.hud(r.clock.t, 60)?.portal?.remaining).toBe(8);
  });

  it('a run summary after returning home is shown', () => {
    feed(r, { t: 'runSummary', summary: { result: 'cleared', mapName: 'Ashen Forge', tier: 1, seconds: 10, kills: 5, xpGained: 50, levelsGained: 0, itemsFound: [] } });
    expect(r.box.get().runSummary?.kills).toBe(5);
  });
});

describe('commands', () => {
  beforeEach(() => enter(r, ch));

  it('failed commands toast the error with the error sound', async () => {
    r.session.partyInvite('Nobody');
    const { id } = lastCmd(r);
    feed(r, { t: 'result', id, ok: false, error: 'There is no character named "Nobody".' });
    await flush();
    const t = r.box.get().toasts.at(-1);
    expect(t?.tone).toBe('bad');
    expect(t?.text).toContain('Nobody');
    expect(r.sounds).toContain('uiError');
  });

  it('predicts deterministic moves at once and reverts them when the server refuses', async () => {
    const before = r.box.get().character!;
    const entry = before.backpack.entries.find((e) => e.item.kind === 'currency')!;
    // Find a free backpack cell for a 1x1 currency stack.
    const occupied = new Set<string>();
    for (const e of before.backpack.entries) {
      const sz = rules.itemSize(e.item);
      for (let dx = 0; dx < sz.w; dx++) for (let dy = 0; dy < sz.h; dy++) occupied.add(`${e.x + dx},${e.y + dy}`);
    }
    let to = { kind: 'backpack' as const, x: 0, y: 0 };
    outer: for (let y = before.backpack.h - 1; y >= 0; y--) {
      for (let x = before.backpack.w - 1; x >= 0; x--) {
        if (!occupied.has(`${x},${y}`)) {
          to = { kind: 'backpack', x, y };
          break outer;
        }
      }
    }
    expect(r.session.moveItem(entry.item.uid, to)).toBe(true);
    const moved = r.box.get().character!.backpack.entries.find((e) => e.item.uid === entry.item.uid)!;
    expect([moved.x, moved.y]).toEqual([to.x, to.y]);
    const { id } = lastCmd(r);
    feed(r, { t: 'result', id, ok: false, error: 'Nope.' });
    await flush();
    const back = r.box.get().character!.backpack.entries.find((e) => e.item.uid === entry.item.uid)!;
    expect([back.x, back.y]).toEqual([entry.x, entry.y]);
  });

  it('keeps a confirmed prediction until the server push, then shows the server state', async () => {
    const pts = r.box.get().character!.unspentSkillPoints;
    expect(pts).toBeGreaterThan(0);
    r.session.rankUpSkill('emberNova');
    expect(r.box.get().character!.skillRanks.emberNova).toBe(1);
    const { id } = lastCmd(r);
    feed(r, { t: 'result', id, ok: true });
    await flush();
    // Still predicted while the push is on its way.
    expect(r.box.get().character!.skillRanks.emberNova).toBe(1);
    const server = rules.rankUpSkill(ch, 'emberNova');
    if (!server.ok) throw new Error(server.error);
    feed(r, { t: 'character', character: server.value });
    expect(r.box.get().character).toBe(server.value);
  });

  it('rejects impossible moves locally without sending anything', () => {
    const n = r.sent.length;
    expect(r.session.moveItem('no-such-item', { kind: 'backpack', x: 0, y: 0 })).toBe(false);
    expect(r.sent.length).toBe(n);
    expect(r.box.get().toasts.at(-1)?.tone).toBe('bad');
  });

  it('arms currencies only where crafting is allowed', () => {
    const scrap = r.box.get().character!.backpack.entries.find((e) => e.item.kind === 'currency')!;
    r.session.armCurrency(scrap.item.uid);
    expect(r.box.get().armed?.uid).toBe(scrap.item.uid);
    expect(r.sounds).toContain('craftArm');
    r.session.disarm();
    expect(r.box.get().armed).toBeNull();
  });

  it('merchant offers come from the shared rules', () => {
    expect(r.session.merchantOffers().length).toBeGreaterThan(0);
  });

  it('the connection dropping fails pending commands without toasts or error sounds', async () => {
    const toasts = r.box.get().toasts.length;
    const p1 = r.session.command({ c: 'leaveMap' });
    r.session.partyInvite('Mira');
    r.session.connectionLost();
    const res = await p1;
    await flush();
    expect(res).toMatchObject({ ok: false, lost: true });
    expect(r.box.get().toasts).toHaveLength(toasts);
    expect(r.sounds).not.toContain('uiError');
  });

  it('a command that cannot be sent at all still says so', async () => {
    const offline = rig();
    enter(offline, ch);
    const session = new GameSession({
      box: offline.box, rules, send: () => false, now: () => 0, wallNow: () => 0, sound: (id) => offline.sounds.push(id), world: offline.world,
    });
    await session.command({ c: 'leaveMap' });
    expect(offline.box.get().toasts.at(-1)).toMatchObject({ tone: 'bad', text: 'Not connected to the server.' });
  });
});

describe('input pipeline', () => {
  beforeEach(() => enter(r, ch));
  const opts = { blocked: false, autoAttack: false, bot: null, alpha: 1 };

  it('predicts every tick and sends active inputs with increasing seq', () => {
    const a = r.session.inputTick({ moveX: 1, moveY: 0, held: 0, flask: -1 }, { x: 50, y: 5 }, opts);
    const b = r.session.inputTick({ moveX: 1, moveY: 0, held: 2, flask: 1 }, { x: 60, y: 5 }, opts);
    expect(a?.seq).toBe(1);
    expect(b).toMatchObject({ seq: 2, moveX: 1, held: 2, flask: 1, aimX: 60, aimY: 5 });
    expect(r.world.predicted.map((m) => m.seq)).toEqual([1, 2]);
    expect(r.sent.filter((m) => m.t === 'input')).toHaveLength(2);
  });

  it('pausing blocks local input (the world keeps running)', () => {
    const m = r.session.inputTick({ moveX: 1, moveY: -1, held: 3, flask: 0 }, { x: 5, y: 5 }, { ...opts, blocked: true });
    expect(m).toMatchObject({ moveX: 0, moveY: 0, held: 0, flask: -1 });
  });

  it('auto-attack holds the basic attack aimed at the monster nearest the cursor', () => {
    const m = r.world.view.monsters;
    addMonster(m, 100, 0);
    const target = addMonster(m, 0, 120);
    const out = r.session.inputTick(IDLE, { x: 5, y: 110 }, { ...opts, autoAttack: true });
    expect(out?.held).toBe(1);
    expect([out?.aimX, out?.aimY]).toEqual([m.x[target], m.y[target]]);
  });

  it('auto-attack follows Ember Lance to any slot and stops when it is unassigned', () => {
    addMonster(r.world.view.monsters, 100, 0);
    const ch = r.box.get().character!;
    for (let slot = 0; slot < 6; slot++) {
      const loadout = Array.from({ length: 6 }, (_, i) => i === slot ? 'emberLance' as const : null);
      feed(r, { t: 'character', character: { ...ch, loadout } });
      const out = r.session.inputTick(IDLE, { x: 100, y: 0 }, { ...opts, autoAttack: true });
      expect(out?.held).toBe(1 << slot);
    }
    feed(r, { t: 'character', character: { ...ch, loadout: Array(6).fill(null) } });
    expect(r.session.inputTick(IDLE, { x: 100, y: 0 }, { ...opts, autoAttack: true })?.held).toBe(0);
  });

  it('auto-attack leads a moving target (it is drawn in the past; the bolt needs time)', () => {
    const m = r.world.view.monsters;
    // 150 units east of the player, walking south.
    const i = addMonster(m, 150, 0, 'ashling', { x: 150, y: -2 });
    const out = r.session.inputTick(IDLE, { x: 150, y: 0 }, { ...opts, autoAttack: true });
    expect(out?.held).toBe(1);
    expect(out!.aimX).toBeCloseTo(m.x[i], 0);
    expect(out!.aimY).toBeGreaterThan(m.y[i] + 5);
  });

  it('a manually held skill aims at the cursor even with auto-attack on', () => {
    addMonster(r.world.view.monsters, 100, 0);
    const out = r.session.inputTick({ ...IDLE, held: 0b100 }, { x: -30, y: -40 }, { ...opts, autoAttack: true });
    expect(out?.held).toBe(0b100);
    expect([out?.aimX, out?.aimY]).toEqual([-30, -40]);
  });

  it('the autopilot drives the input (walks toward an open hideout portal)', () => {
    r.world.view.props.push(prop(9, 'portal', 200, 0, 8));
    const out = r.session.inputTick(IDLE, { x: 0, y: 0 }, { ...opts, bot: new Autopilot() });
    expect(out!.moveX).toBeGreaterThan(0.9);
  });
});

describe('cosmetic events', () => {
  const tell: ServerMessage = { t: 'events', tick: 10, events: [{ t: 'waveTell', wave: 4, families: ['ashling'], lieutenant: false, boss: true }] };
  const hits: ServerMessage = {
    t: 'events', tick: 12,
    events: [{ t: 'hit', playerId: 2, x: 0, y: 0, amount: 5, damageType: 'fire', crit: false, target: 'monster', killed: false }],
  };

  it('are not queued while the page is hidden, but the wave tell still reaches the HUD', () => {
    enter(r, ch);
    r.session.setEventsSuspended(true);
    feed(r, hits, tell);
    expect(r.session.timeline.pending).toBe(0);
    expect(r.session.tell).toMatchObject({ wave: 4, boss: true });
    r.session.setEventsSuspended(false);
    feed(r, hits);
    expect(r.session.timeline.pending).toBe(1);
  });

  it('stalled frames discard what is due instead of saving it for one burst', () => {
    enter(r, ch);
    feed(r, tell, hits);
    // The world's render tick (0 here) never reached tick 12, but the tell is immediate: it is dropped and tracked.
    expect(r.session.discardDueEvents()).toBe(1);
    expect(r.session.tell?.wave).toBe(4);
    expect(r.session.timeline.pending).toBe(1);
  });
});

describe('HUD', () => {
  it('builds slots, flasks and allies from the local player view', () => {
    enter(r, ch);
    const hud = r.session.hud(2000, 58.7)!;
    expect(hud.zone).toBe('hideout');
    expect(hud.zoneIsOwn).toBe(true);
    expect(hud.life).toBe(80);
    expect(hud.slots.map((s) => s.key)).toEqual(['LMB', 'RMB', 'Q', 'E', 'R', 'F', 'Spc', 'Z']);
    expect(hud.slots[1].skillId).toBe('emberNova');
    expect(hud.flasks[0]).toMatchObject({ key: '1', flaskId: 'lifeFlask', count: 3, active: 0.5 });
    expect(hud.flasks[1]).toBeNull();
    expect(hud.allies).toEqual([{ name: 'Mira', level: 3, life: 80, maxLife: 100, dead: false }]);
    expect(hud.fps).toBe(59);
    expect(hud.run).toBeNull();
    expect(hud.xpToNext).toBe(rules.xpToNext(ch.level));
  });

  it('in a map: run readout, personal luck, mod lines, portals and the wave tell', () => {
    const map = ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    if (map.kind !== 'map') throw new Error('no map');
    const opened = rules.openMap({ ...ch, mapDevice: map });
    if (!opened.ok) throw new Error(opened.error);
    feed(
      r,
      { t: 'welcome', protocol: PROTOCOL_VERSION, characterId: 'me', tickRate: 60, serverTime: 0 },
      { t: 'character', character: ch },
      {
        t: 'zone',
        zone: zoneInfo({
          kind: 'map', theme: 'ashenForge', mapName: 'Ashen Forge', tier: 1, setup: opened.value.setup, ownerCharacterId: 'me',
          portal: { ownerCharacterId: 'me', ownerName: 'Ysolde', mapName: 'Ashen Forge', tier: 1, remaining: 7, total: 8, cleared: false },
        }),
      },
    );
    r.session.timeline.push(1, [{ t: 'waveTell', wave: 3, families: ['ashling', 'riftStalker'], lieutenant: true, boss: false }]);
    r.session.drainEvents([]);
    const hud = r.session.hud(r.clock.t, 60)!;
    expect(hud.run).toMatchObject({ mapName: 'Ashen Forge', tier: 1, monsterLevel: 4, wave: 2, portalsRemaining: 7, portalsTotal: 8 });
    expect(hud.run!.waveProgress).toBeCloseTo(0.25);
    expect(hud.run!.itemQuantity).toBe(rules.lootLuck(opened.value.setup, ch).itemQuantity);
    expect(hud.run!.tell).toMatchObject({ wave: 3, lieutenant: true });
    expect(r.box.get().run).toBe(opened.value.setup);

    // Trust the authoritative setup, even when it differs from the browser's tier formula.
    feed(r, { t: 'zone', zone: zoneInfo({ kind: 'map', tier: 1, setup: { ...opened.value.setup, monsterLevel: 17 } }) });
    expect(r.session.hud(r.clock.t, 60)?.run?.monsterLevel).toBe(17);
    feed(r, { t: 'zone', zone: zoneInfo() });
    expect(r.session.hud(r.clock.t, 60)?.run).toBeNull();
  });
});

describe('craft feedback', () => {
  const eq = (p: Partial<EquipmentItem>): EquipmentItem => ({
    kind: 'equipment', uid: 'w', baseId: 'ashwoodWand', itemLevel: 10, rarity: 'magic', name: null, implicitValues: [12],
    affixes: [], scars: [], stability: 6, maxStability: 8, history: [], ...p,
  });

  it('picks the sound and toast colour from what happened to the item', () => {
    expect(craftFeedback(eq({}), eq({ scars: [{ scarId: 'frail', value: 5 }] }))).toEqual({ sound: 'craftScar', tone: 'bad' });
    expect(craftFeedback(eq({ stability: 1 }), eq({ stability: 0 }))).toEqual({ sound: 'craftFinish', tone: 'rare' });
    expect(craftFeedback(eq({}), eq({ rarity: 'rare' }))).toEqual({ sound: 'craftRare', tone: 'rare' });
    expect(craftFeedback(eq({}), eq({ stability: 5 }))).toEqual({ sound: 'craftApply', tone: 'good' });
    expect(craftFeedback(null, null)).toEqual({ sound: 'craftApply', tone: 'good' });
  });
});
