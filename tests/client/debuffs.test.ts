// Player debuffs on the HUD (GAME_SPEC §13) from the replicated local PlayerView, the replica learning her own
// chain-hook drags from event batches, the autopilot's answers to the new hazards, and the map-theme music colour.
import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS, type PlayerDebuffView, type SimEvent, type WorldView } from '../../src/contracts/sim';
import { Autopilot } from '../../src/client/bot';
import { buildHud, hudDebuffs, provisionalHud } from '../../src/client/hud';
import { musicFor, musicThemeFor } from '../../src/client/music';
import { addMonster, player, worldView, zoneInfo } from './helpers';
import { enter, feed, rig } from './rig';

const debuff = (p: Partial<PlayerDebuffView> & Pick<PlayerDebuffView, 'id'>): PlayerDebuffView => ({
  remaining: 1, duration: 2, stacks: 1, source: null, ...p,
});

describe('HUD debuffs', () => {
  it('copies the local player debuffs (seconds, stacks) out of the pooled replica', () => {
    const pooled = [debuff({ id: 'rooted', remaining: 0.9, duration: 1.4, source: 'web' }), debuff({ id: 'bleeding', remaining: 3.2, duration: 4, stacks: 2 })];
    const out = hudDebuffs(player(1, 'Ysolde', 0, 0, { debuffs: pooled }));
    expect(out).toEqual([
      { id: 'rooted', remaining: 0.9, duration: 1.4, stacks: 1 },
      { id: 'bleeding', remaining: 3.2, duration: 4, stacks: 2 },
    ]);
    // A copy: the replica rewrites its pooled entries in place on the next snapshot.
    pooled[0].remaining = 0.1;
    expect(out[0].remaining).toBe(0.9);
    expect(out[0]).not.toBe(pooled[0]);
  });

  it('shows nothing while dead, nothing for run-out timers or ids this client does not know', () => {
    const list = [debuff({ id: 'chilled' }), debuff({ id: 'withered', remaining: 0 }), debuff({ id: 'soaked' as PlayerDebuffView['id'] })];
    expect(hudDebuffs(player(1, 'Y', 0, 0, { debuffs: list, dead: true }))).toEqual([]);
    expect(hudDebuffs(player(1, 'Y', 0, 0, { debuffs: list })).map((d) => d.id)).toEqual(['chilled']);
    expect(hudDebuffs(null)).toEqual([]);
  });

  it('never shows a timer above its duration, garbage stacks as 1, and one card per debuff', () => {
    const out = hudDebuffs(player(1, 'Y', 0, 0, {
      debuffs: [
        debuff({ id: 'burning', remaining: 2.5, duration: 2, stacks: 0 }),
        debuff({ id: 'burning', remaining: 1, duration: 3, stacks: 3 }),
        debuff({ id: 'shocked', remaining: Number.NaN }),
      ],
    }));
    expect(out).toEqual([{ id: 'burning', remaining: 2.5, duration: 2.5, stacks: 3 }]);
  });

  it('buildHud carries them; the provisional HUD of a new zone starts without any', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { debuffs: [debuff({ id: 'frozen', remaining: 0.5, duration: 0.8 })] })] });
    const hud = buildHud({
      view, localPlayerId: 1, zone: zoneInfo({ kind: 'map', theme: 'rimedOssuary' }), characterId: 'me', character: null,
      xpToNext: () => 100, portal: null, tell: null, luck: null, modLines: [], now: 0, fps: 60, pingMs: 30,
    });
    expect(hud?.debuffs).toEqual([{ id: 'frozen', remaining: 0.5, duration: 0.8, stacks: 1 }]);
    expect(provisionalHud(hud!, zoneInfo(), 'me').debuffs).toEqual([]);
  });

  it('the session HUD follows the replica at the HUD rate', () => {
    const r = rig(worldView({ players: [player(1, 'Ysolde', 0, 0, { debuffs: [debuff({ id: 'chilled', remaining: 1.8 })] })] }));
    enter(r);
    expect(r.session.hud(0, 60)?.debuffs).toEqual([{ id: 'chilled', remaining: 1.8, duration: 2, stacks: 1 }]);
    r.world.view.players[0].debuffs.length = 0;
    expect(r.session.hud(66, 60)?.debuffs).toEqual([]);
  });
});

describe('event batches reach the replica', () => {
  it('every batch is noted (her hook drags), also while the page is hidden', () => {
    const r = rig();
    enter(r);
    const pull: SimEvent = { t: 'pull', playerId: 1, fromX: 0, fromY: 0, toX: -30, toY: 10 };
    feed(r, { t: 'events', tick: 120, events: [pull] });
    r.session.setEventsSuspended(true);
    feed(r, { t: 'events', tick: 122, events: [{ t: 'debuff', playerId: 1, debuff: 'rooted', stacks: 1, x: 0, y: 0 }] });
    expect(r.world.noted.map((n) => n.tick)).toEqual([120, 122]);
    expect(r.world.noted[0].events[0]).toBe(pull);
  });

  it('nothing is noted before a zone', () => {
    const r = rig();
    feed(r, { t: 'events', tick: 5, events: [] });
    expect(r.world.noted).toEqual([]);
  });
});

describe('autopilot and the new hazards', () => {
  it('steps out of an ice prison closing on it', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0)] });
    addMonster(view.monsters, 400, 0, 'boneThrall');
    view.areas.push({ id: 1, kind: 'icePrison', x: 4, y: 0, radius: 40, age: 0.5, duration: 2 });
    const out = new Autopilot().step(view, 1, 'map');
    expect(out.moveX).toBeLessThan(0);
  });

  it('Rift Step breaks a root when something is closing in', () => {
    const view = worldView({
      players: [player(1, 'Ysolde', 0, 0, {
        debuffs: [debuff({ id: 'rooted', remaining: 1.2, duration: 1.4, source: 'chain' })],
        slots: [
          { skillId: 'emberLance', cooldown: 0, cooldownTotal: 0, charges: 1, maxCharges: 1, focusCost: 0, usable: true },
          { skillId: 'riftStep', cooldown: 0, cooldownTotal: 3, charges: 1, maxCharges: 1, focusCost: 10, usable: true },
          ...[0, 0, 0, 0].map(() => ({ skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false })),
        ],
      })],
    });
    for (let i = 0; i < 3; i++) addMonster(view.monsters, 30 + i * 6, 10, 'pitHound');
    const out = new Autopilot().step(view, 1, 'map');
    expect(out.held & 2).toBe(2);
    // Away from the hounds.
    expect(out.aimX).toBeLessThan(0);
  });
});

describe('autopilot bait mode (e2e: let chosen monsters land their debuffs)', () => {
  const COLISEUM_BAIT = ['chainThrall', 'tarSlinger', 'ironCrossbowman'] as const;
  const riftSlots = () => [
    { skillId: 'emberLance' as const, cooldown: 0, cooldownTotal: 0, charges: 1, maxCharges: 1, focusCost: 0, usable: true },
    { skillId: 'riftStep' as const, cooldown: 0, cooldownTotal: 3, charges: 1, maxCharges: 1, focusCost: 10, usable: true },
    ...[0, 0, 0, 0].map(() => ({ skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false })),
  ];
  /** A hostile projectile at (x, y) flying toward the origin. */
  function incoming(view: WorldView, kind: (typeof PROJECTILE_KINDS)[number], x: number, y: number): void {
    const pj = view.projectiles;
    const d = Math.hypot(x, y);
    pj.alive[0] = 1;
    pj.hostile[0] = 1;
    pj.kind[0] = PROJECTILE_KINDS.indexOf(kind);
    pj.x[0] = x;
    pj.y[0] = y;
    pj.vx[0] = (-x / d) * 320;
    pj.vy[0] = (-y / d) * 320;
    pj.count = 1;
  }

  it('stands within reach of the bait, never shoots it, and still shoots everything else', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
    addMonster(view.monsters, 150, 0, 'chainThrall');
    const bot = new Autopilot({ bait: [...COLISEUM_BAIT] });
    let out = bot.step(view, 1, 'map');
    expect(out.moveX).toBe(0);
    expect(out.moveY).toBe(0);
    expect(out.held & 1).toBe(0);
    // A hound joins: it is the target, the thrall still is not.
    addMonster(view.monsters, -120, 40, 'pitHound');
    out = bot.step(view, 1, 'map');
    expect(out.held & 1).toBe(1);
    expect(out.aimX).toBeLessThan(0);
    expect(out.moveX).toBe(0);
  });

  it('walks up to a bait monster that is out of reach', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
    addMonster(view.monsters, 0, 500, 'tarSlinger');
    const out = new Autopilot({ bait: [...COLISEUM_BAIT] }).step(view, 1, 'map');
    expect(out.moveY).toBeGreaterThan(0.9);
  });

  it('takes the hook instead of sidestepping it (and sidesteps it without bait)', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
    addMonster(view.monsters, 160, 0, 'chainThrall');
    incoming(view, 'chainHook', 40, 1);
    const baited = new Autopilot({ bait: [...COLISEUM_BAIT] }).step(view, 1, 'map');
    expect(Math.hypot(baited.moveX, baited.moveY)).toBe(0);
    const free = new Autopilot().step(view, 1, 'map');
    expect(Math.abs(free.moveY)).toBeGreaterThan(0.2);
  });

  it('stands in tar and in a wisp burst while baiting; every other telegraph is still dodged', () => {
    for (const kind of ['tarPool', 'wispBurst'] as const) {
      const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
      addMonster(view.monsters, 150, 0, kind === 'tarPool' ? 'tarSlinger' : 'glacialWisp');
      view.areas.push({ id: 1, kind, x: 6, y: 0, radius: 30, age: 0.2, duration: 3 });
      const bait = kind === 'tarPool' ? [...COLISEUM_BAIT] : (['frostWeaver', 'glacialWisp'] as const).slice();
      const out = new Autopilot({ bait }).step(view, 1, 'map');
      expect(Math.hypot(out.moveX, out.moveY)).toBe(0);
      expect(new Autopilot().step(view, 1, 'map').moveX).toBeLessThan(0);
    }
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
    addMonster(view.monsters, 150, 0, 'chainThrall');
    view.areas.push({ id: 2, kind: 'slamWarning', x: 6, y: 0, radius: 30, age: 0.2, duration: 1 });
    expect(new Autopilot({ bait: [...COLISEUM_BAIT] }).step(view, 1, 'map').moveX).toBeLessThan(0);
  });

  it('keeps a root on purpose: no Rift Step while baiting', () => {
    const view = worldView({
      players: [player(1, 'Ysolde', 0, 0, {
        life: 90,
        debuffs: [debuff({ id: 'rooted', remaining: 1.2, duration: 1.4, source: 'chain' })],
        slots: riftSlots(),
      })],
    });
    addMonster(view.monsters, 40, 10, 'chainThrall');
    addMonster(view.monsters, 36, -10, 'pitHound');
    expect(new Autopilot({ bait: [...COLISEUM_BAIT] }).step(view, 1, 'map').held & 2).toBe(0);
  });

  it('kites as usual when a crowd closes in or life runs low', () => {
    const crowd = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
    addMonster(crowd.monsters, 150, 0, 'chainThrall');
    for (let i = 0; i < 3; i++) addMonster(crowd.monsters, 30, -20 + i * 20, 'pitHound');
    const a = new Autopilot({ bait: [...COLISEUM_BAIT] }).step(crowd, 1, 'map');
    expect(Math.hypot(a.moveX, a.moveY)).toBeGreaterThan(0.5);

    const hurt = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 30 })] });
    addMonster(hurt.monsters, 60, 0, 'chainThrall');
    const b = new Autopilot({ bait: [...COLISEUM_BAIT] }).step(hurt, 1, 'map');
    expect(b.moveX).toBeLessThan(0);
  });

  it('without a bait monster alive it fights and collects like the plain autopilot', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0, { life: 90 })] });
    addMonster(view.monsters, 400, 0, 'pitHound');
    const baited = new Autopilot({ bait: [...COLISEUM_BAIT] }).step(view, 1, 'map');
    const plain = new Autopilot().step(view, 1, 'map');
    expect(baited).toEqual(plain);
  });
});

describe('music colour per map theme', () => {
  it('maps colour the music by their base; hideouts and the title play the plain tracks', () => {
    expect(musicThemeFor(zoneInfo({ kind: 'map', theme: 'rimedOssuary' }))).toBe('rimedOssuary');
    expect(musicThemeFor(zoneInfo({ kind: 'map', theme: 'ironColiseum' }))).toBe('ironColiseum');
    expect(musicThemeFor(zoneInfo({ kind: 'map', theme: 'ashenForge' }))).toBe('ashenForge');
    expect(musicThemeFor(zoneInfo({ kind: 'hideout', theme: 'hideout' }))).toBeNull();
    expect(musicThemeFor(null)).toBeNull();
  });

  it('any map boss (not only the Matriarch) switches to the boss track', () => {
    const run = { ...worldView().run, boss: { name: 'The Hollow Warden', life: 10, maxLife: 20, phase: 2 } };
    expect(musicFor('game', 'map', run)).toBe('boss');
  });
});
