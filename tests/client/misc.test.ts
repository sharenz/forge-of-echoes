// Optimistic character sync, settings normalisation, music selection, the API error text, the command tracker
// and the autopilot.
import { describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { ApiError, UNREACHABLE_TEXT, createApi, errorText } from '../../src/client/api';
import { Autopilot } from '../../src/client/bot';
import { COMMAND_TIMEOUT_MS, CommandTracker } from '../../src/client/commands';
import { approach, intensityFor, musicFor } from '../../src/client/music';
import { CharacterSync, SETTLE_MS } from '../../src/client/optimistic';
import { DEFAULT_SETTINGS, normalizeSettings, parseSettings } from '../../src/client/settings';
import { addMonster, drop, monsterStore, player, prop, runView, worldView } from './helpers';

describe('CharacterSync', () => {
  const a = rules.createCharacter('Ysolde', 1);
  const b: CharacterSave = { ...a, xp: 10 };
  const c: CharacterSave = { ...a, xp: 20 };

  it('shows the prediction while in flight and the server push afterwards', () => {
    const s = new CharacterSync();
    s.fromServer(a);
    s.predict(b);
    expect(s.display).toBe(b);
    // A push arriving mid-flight does not overwrite the prediction.
    s.fromServer(a);
    expect(s.display).toBe(b);
    expect(s.resolved(true, 0)).toBe(false);
    expect(s.display).toBe(b);
    expect(s.fromServer(c)).toBe(true);
    expect(s.display).toBe(c);
  });

  it('retires a confirmed prediction after a grace when the push came first', () => {
    const s = new CharacterSync();
    s.fromServer(a);
    s.predict(b);
    s.fromServer(b); // the server pushed before its result
    s.resolved(true, 100);
    expect(s.tick(100 + SETTLE_MS - 1)).toBe(false);
    expect(s.tick(100 + SETTLE_MS)).toBe(true);
    expect(s.display).toBe(b);
  });

  it('drops the prediction on a rejection or a lost connection', () => {
    const s = new CharacterSync();
    s.fromServer(a);
    s.predict(b);
    expect(s.resolved(false, 0)).toBe(true);
    expect(s.display).toBe(a);
    s.predict(c);
    expect(s.dropPredictions()).toBe(true);
    expect(s.display).toBe(a);
    expect(s.pending).toBe(0);
  });
});

describe('settings', () => {
  it('fills defaults and clamps garbage', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ masterVolume: 3, musicVolume: -1, sfxVolume: 'x', screenShake: 0.25, showFps: true, autoAttack: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      masterVolume: 1,
      musicVolume: 0,
      screenShake: 0.25,
      showFps: true,
    });
  });
});

describe('music', () => {
  it('title outside the game, zone tracks inside, the boss track while she lives', () => {
    expect(musicFor('loading', null, null)).toBeNull();
    expect(musicFor('auth', null, null)).toBe('title');
    expect(musicFor('characters', null, null)).toBe('title');
    expect(musicFor('game', 'hideout', null)).toBe('hideout');
    expect(musicFor('game', 'map', runView())).toBe('map');
    const boss = { name: 'Cinder Matriarch', life: 5, maxLife: 10, phase: 2 };
    expect(musicFor('game', 'map', runView({ phase: 'boss', boss }))).toBe('boss');
    expect(musicFor('game', 'map', runView({ phase: 'cleared', boss }))).toBe('map');
  });

  it('intensity rises with the horde, the lieutenant and the boss', () => {
    expect(intensityFor('hideout', null)).toBe(0);
    const calm = intensityFor('map', runView({ monstersAlive: 5, wave: 1 }));
    const busy = intensityFor('map', runView({ monstersAlive: 140, wave: 4 }));
    expect(busy).toBeGreaterThan(calm);
    expect(intensityFor('map', runView({ lieutenant: { name: 'Ashbound Herald', life: 1, maxLife: 2 } }))).toBeGreaterThan(intensityFor('map', runView()));
    expect(intensityFor('map', runView({ boss: { name: 'x', life: 1, maxLife: 2, phase: 1 } }))).toBe(1);
    expect(approach(0, 1, 0.5, 0.5)).toBe(0.25);
    expect(approach(0.9, 1, 0.5, 1)).toBe(1);
  });
});

describe('api timeout', () => {
  it('a request without an answer fails as unreachable instead of hanging the auth screen', async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const api = createApi(() => null, hang, '', 20);
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).unreachable).toBe(true);
    expect((err as ApiError).message).toBe(UNREACHABLE_TEXT);
  });

  it('a normal answer is unaffected', async () => {
    const ok = async () => new Response(JSON.stringify({ account: { id: 'a', username: 'u' }, characters: [] }), { status: 200 });
    const api = createApi(() => 'tok', ok, '', 20);
    expect((await api.me()).account.username).toBe('u');
  });
});

describe('api error text', () => {
  it("prefers the server's player-facing text", () => {
    expect(errorText(400, { error: 'That name is taken.' })).toBe('That name is taken.');
    expect(errorText(401, null)).toMatch(/log in/);
    expect(errorText(429, {})).toMatch(/Too many/);
    expect(errorText(503, 'x')).toMatch(/server/);
  });
});

describe('CommandTracker', () => {
  it('settles by id, times out and fails everything on disconnect', async () => {
    const t = new CommandTracker();
    const a = t.issue({ c: 'leaveMap' }, 0);
    const b = t.issue({ c: 'respawn' }, 0);
    const c = t.issue({ c: 'partyLeave' }, 5000);
    expect(a.id).not.toBe(b.id);
    expect(t.settle(a.id, { ok: true, message: 'ok' })?.c).toBe('leaveMap');
    expect(t.settle(a.id, { ok: true })).toBeNull();
    expect((await a.result).message).toBe('ok');
    expect(t.expire(COMMAND_TIMEOUT_MS).map((x) => x.c)).toEqual(['respawn']);
    expect((await b.result).ok).toBe(false);
    expect(t.failAll('gone').map((x) => x.c)).toEqual(['partyLeave']);
    expect((await c.result).error).toBe('gone');
    expect(t.size).toBe(0);
  });
});

describe('Autopilot', () => {
  it('walks into an open hideout portal and waits in it', () => {
    const bot = new Autopilot();
    const view = worldView({ theme: 'hideout', players: [player(1, 'Y', 0, 0)], props: [prop(5, 'portal', 0, 100, 8)] });
    const out = bot.step(view, 1, 'hideout');
    expect(out.moveY).toBeGreaterThan(0.9);
    view.players[0] = player(1, 'Y', 0, 99);
    const still = bot.step(view, 1, 'hideout');
    expect([still.moveX, still.moveY]).toEqual([0, 0]);
  });

  it('ignores a closed portal and stays put when disabled', () => {
    const view = worldView({ players: [player(1, 'Y', 0, 0)], props: [prop(5, 'portal', 0, 100, 0)] });
    expect(new Autopilot().step(view, 1, 'hideout').moveY).toBe(0);
    view.props[0].state = 8;
    expect(new Autopilot({ enterPortal: false }).step(view, 1, 'hideout').moveY).toBe(0);
  });

  it('in a map: aims at and attacks the nearest monster, flees a crowd, casts nova into it', () => {
    const view = worldView({ players: [player(1, 'Y', 0, 0)] });
    const m = view.monsters;
    for (let k = 0; k < 4; k++) addMonster(m, 30 + k * 4, 10);
    const out = new Autopilot().step(view, 1, 'map');
    expect(out.held & 1).toBe(1);
    expect(out.held & 0b10).toBe(0b10); // Ember Nova on Space: crowd within 120
    expect(out.aimX).toBe(30);
    expect(out.moveX).toBeLessThan(0); // kiting away from the pack on the east
  });

  it('drinks a life flask when low', () => {
    const view = worldView({ players: [player(1, 'Y', 0, 0, { life: 20 })] });
    view.players[0].flasks[0] = { flaskId: 'lifeFlask', count: 3, resource: 'life', active: 0, duration: 3 };
    expect(new Autopilot().step(view, 1, 'map').flask).toBe(0);
  });

  it('after the clear: chest first, then the return portal', () => {
    const view = worldView({
      players: [player(1, 'Y', 0, 0)],
      run: runView({ phase: 'cleared', monstersAlive: 0 }),
      props: [prop(1, 'chest', -100, 0, 0), prop(2, 'returnPortal', 100, 0, 1)],
    });
    expect(new Autopilot().step(view, 1, 'map').moveX).toBeLessThan(-0.9);
    view.props[0].state = 1;
    expect(new Autopilot().step(view, 1, 'map').moveX).toBeGreaterThan(0.9);
    expect(new Autopilot({ returnPortal: false }).step(view, 1, 'map').moveX).toBe(0);
  });
});

describe('autopilot scripted modes (the e2e run)', () => {
  it('hold: walks to the spot, then stands on it collecting nothing (a click-only item underfoot stays there)', () => {
    const drops = [drop(5, 30, 0)];
    const away = new Autopilot({ hold: { x: 30, y: 0 }, collect: false }).step(
      worldView({ players: [player(1, 'Ysolde', 0, 0)], drops }), 1, 'map',
    );
    expect(away.moveX).toBeGreaterThan(0.9);
    expect(away.pickup).toBe(-1);
    const m = monsterStore();
    addMonster(m, 150, 0);
    const there = new Autopilot({ hold: { x: 30, y: 0 }, collect: false }).step(
      worldView({ players: [player(1, 'Ysolde', 30, 0, { life: 90 })], drops, monsters: m }), 1, 'map',
    );
    expect([there.moveX, there.moveY]).toEqual([0, 0]);
    expect(there.pickup).toBe(-1);
    // Still fighting while it holds.
    expect(there.held & 1).toBe(1);
  });

  it('charge: walks straight at the nearest monster, never attacking or drinking', () => {
    const m = monsterStore();
    addMonster(m, 0, 200);
    addMonster(m, -80, 0);
    const out = new Autopilot({ charge: true }).step(
      worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 5 })], monsters: m }), 1, 'map',
    );
    expect(out.moveX).toBeLessThan(-0.9);
    expect(out.held).toBe(0);
    expect(out.flask).toBe(-1);
  });
});
