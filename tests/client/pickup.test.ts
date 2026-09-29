// Click-to-pick-up through the session (in reach → pickup now; out of reach → walk, then pickup; WASD / the item
// vanishing / a zone change cancel), dropping items on the floor, the crafting bench and the server clock.
import { PROTOCOL_VERSION } from '../../src/contracts/net';
import { describe, expect, it } from 'vitest';
import type { InputMessage } from '../../src/contracts/net';
import { rules } from '../../src/game';
import { PICKUP_APPROACH } from '../../src/client/autowalk';
import { Autopilot } from '../../src/client/bot';
import { loadoutKeyLabels } from '../../src/client/hud';
import { drop, player, worldView } from './helpers';
import { IDLE, TICK, answer, commands, enter, feed, flush, lastCmd, rig } from './rig';

const pickups = (r: ReturnType<typeof rig>) => commands(r).filter((c) => c.c === 'pickup');

describe('click to pick up', () => {
  it('an item in reach is picked up at once and the click never becomes an attack', () => {
    const r = rig(worldView({ players: [player(1, 'Ysolde', 0, 0)], drops: [drop(5, 30, 20)] }));
    enter(r);
    expect(r.session.clickDrop(5)).toBe(true);
    expect(pickups(r)).toEqual([{ c: 'pickup', dropId: 5 }]);
    expect(r.session.walk.active).toBe(false);
  });

  it('a click on an item that is not in the replica is not consumed (it is an attack)', () => {
    const r = rig();
    enter(r);
    expect(r.session.clickDrop(42)).toBe(false);
    expect(pickups(r)).toEqual([]);
  });

  it('out of reach: walks there (steering replaces the keyboard), then picks it up on arrival', () => {
    const me = player(1, 'Ysolde', 0, 0);
    const r = rig(worldView({ players: [me], drops: [drop(5, 200, 0)] }));
    enter(r);
    expect(r.session.clickDrop(5)).toBe(true);
    expect(pickups(r)).toEqual([]);
    expect(r.session.walk.active).toBe(true);
    const msg = r.session.inputTick(IDLE, { x: 0, y: 0 }, TICK) as InputMessage;
    expect(msg.moveX).toBeCloseTo(1);
    expect(msg.moveY).toBeCloseTo(0);
    expect(msg.held).toBe(0);
    // She walks (the replica moves her) until the approach radius.
    me.x = 200 - PICKUP_APPROACH - 1;
    expect(r.session.inputTick(IDLE, { x: 0, y: 0 }, TICK)?.moveX).toBeCloseTo(1);
    expect(pickups(r)).toEqual([]);
    me.x = 200 - PICKUP_APPROACH + 1;
    const arrived = r.session.inputTick(IDLE, { x: 0, y: 0 }, TICK) as InputMessage;
    expect(pickups(r)).toEqual([{ c: 'pickup', dropId: 5 }]);
    expect(arrived.moveX).toBe(0);
    expect(r.session.walk.active).toBe(false);
  });

  it('WASD cancels the walk; so do the item vanishing, a zone change and the menu', () => {
    const view = worldView({ players: [player(1, 'Ysolde', 0, 0)], drops: [drop(5, 200, 0)] });
    const r = rig(view);
    enter(r);
    r.session.clickDrop(5);
    const msg = r.session.inputTick({ ...IDLE, moveX: 0, moveY: -1 }, { x: 0, y: 0 }, TICK) as InputMessage;
    expect(msg.moveY).toBe(-1); // the player's own direction, not the walk
    expect(r.session.walk.active).toBe(false);

    r.session.clickDrop(5);
    view.drops.length = 0; // someone else picked it up
    r.session.inputTick(IDLE, { x: 0, y: 0 }, TICK);
    expect(r.session.walk.active).toBe(false);

    view.drops.push(drop(5, 200, 0));
    r.session.clickDrop(5);
    r.session.inputTick(IDLE, { x: 0, y: 0 }, { ...TICK, blocked: true });
    expect(r.session.walk.active).toBe(false);

    r.session.clickDrop(5);
    enter(r, { instanceId: 'm1', kind: 'map' });
    expect(r.session.walk.active).toBe(false);
    expect(pickups(r)).toEqual([]);
  });

  it('only the newest click toasts its refusal (the server answers a superseded click "Too far away.")', async () => {
    const r = rig(worldView({ players: [player(1, 'Ysolde', 0, 0)], drops: [drop(5, 10, 0), drop(6, 20, 0)] }));
    enter(r);
    r.session.clickDrop(5);
    const first = lastCmd(r).id;
    r.session.clickDrop(6);
    feed(r, { t: 'result', id: first, ok: false, error: 'Too far away.' });
    await flush();
    expect(r.box.get().toasts).toEqual([]);
    answer(r, false, { error: 'Your inventory is full.' });
    await flush();
    expect(r.box.get().toasts.map((t) => t.text)).toEqual(['Your inventory is full.']);
    expect(r.sounds).toContain('uiError');
  });

  it('the autopilot clicks equipment in reach (rate-limited), never public drops', () => {
    const view = worldView({
      players: [player(1, 'Ysolde', 0, 0)],
      drops: [drop(5, 1, 0), drop(6, 3, 0, { owner: 0 })],
      run: { ...worldView().run, phase: 'cleared', monstersAlive: 0 },
    });
    const r = rig(view);
    enter(r, { instanceId: 'm1', kind: 'map' });
    const bot = new Autopilot();
    r.session.inputTick(IDLE, { x: 0, y: 0 }, { ...TICK, bot });
    r.session.inputTick(IDLE, { x: 0, y: 0 }, { ...TICK, bot });
    expect(pickups(r)).toEqual([{ c: 'pickup', dropId: 5 }]);
    r.clock.t += 1000;
    r.session.inputTick(IDLE, { x: 0, y: 0 }, { ...TICK, bot });
    expect(pickups(r)).toHaveLength(2);
  });
});

describe('dropping an item on the floor', () => {
  it('sends dropItem and shows the item gone at once; a refusal brings it back', async () => {
    const r = rig();
    enter(r);
    const robe = r.ch.equipment.chest!;
    r.session.dropItem(robe.uid);
    expect(lastCmd(r).cmd).toEqual({ c: 'dropItem', uid: robe.uid });
    expect(r.box.get().character?.equipment.chest).toBeUndefined();
    answer(r, false, { error: 'There are too many items on the ground here. Pick some up first.' });
    await flush();
    expect(r.box.get().character?.equipment.chest?.uid).toBe(robe.uid);
    expect(r.box.get().toasts.at(-1)?.text).toMatch(/too many items/);
  });

  it('refuses while dead without asking the server', () => {
    const r = rig(worldView({ players: [player(1, 'Ysolde', 0, 0, { dead: true })] }));
    enter(r);
    r.session.dropItem(r.ch.equipment.chest!.uid);
    expect(commands(r).some((c) => c.c === 'dropItem')).toBe(false);
    expect(r.box.get().toasts.at(-1)?.text).toMatch(/dead/);
  });
});

describe('crafting bench', () => {
  it('crafts an available recipe on the bench item; unavailable ones never reach the server', () => {
    const r = rig();
    enter(r);
    const wand = r.ch.equipment.mainHand!;
    r.box.update((s) => ({ ...s, benchItemUid: wand.uid }));
    const recipes = rules.benchRecipes(r.ch, wand.uid);
    const ok = recipes.find((x) => x.available);
    const no = recipes.find((x) => !x.available);
    expect(ok).toBeTruthy();
    r.session.benchCraft(ok!.id);
    expect(lastCmd(r).cmd).toEqual({ c: 'benchCraft', targetUid: wand.uid, recipeId: ok!.id });
    if (no) {
      const before = r.sent.length;
      r.session.benchCraft(no.id);
      expect(r.sent.length).toBe(before);
      expect(r.box.get().toasts.at(-1)?.tone).toBe('bad');
    }
  });

  it('the bench works only in a hideout, and clearing needs a crafted affix', () => {
    const r = rig();
    enter(r);
    const wand = r.ch.equipment.mainHand!;
    r.box.update((s) => ({ ...s, benchItemUid: wand.uid }));
    r.session.benchClear(); // nothing crafted yet: refused locally
    expect(commands(r).some((c) => c.c === 'benchClear')).toBe(false);
    enter(r, { instanceId: 'm1', kind: 'map' });
    const before = r.sent.length;
    r.session.benchCraft('anything');
    expect(r.sent.length).toBe(before);
    expect(r.box.get().toasts.at(-1)?.text).toMatch(/hideout/);
  });

  it('clearing a crafted affix is predicted, and the bench forgets an item that left', async () => {
    const r = rig();
    enter(r);
    const wand = r.ch.equipment.mainHand!;
    const recipe = rules.benchRecipes(r.ch, wand.uid).find((x) => x.available)!;
    const crafted = rules.applyBenchRecipe(r.ch, wand.uid, recipe.id);
    if (!crafted.ok) throw new Error(crafted.error);
    feed(r, { t: 'character', character: crafted.value.character });
    r.box.update((s) => ({ ...s, benchItemUid: wand.uid }));
    r.session.benchClear();
    expect(lastCmd(r).cmd).toEqual({ c: 'benchClear', targetUid: wand.uid });
    expect(r.box.get().character?.equipment.mainHand?.affixes.some((a) => a.crafted)).toBe(false);
    answer(r, true, { message: 'Removed the crafted affix.' });
    await flush();
    expect(r.box.get().toasts.at(-1)).toMatchObject({ text: 'Removed the crafted affix.', tone: 'good' });
    // The wand is traded / dropped away: the bench selection clears itself.
    const gone = rules.discardItem(crafted.value.character, wand.uid);
    if (!gone.ok) throw new Error(gone.error);
    feed(r, { t: 'character', character: gone.value });
    expect(r.box.get().benchItemUid).toBeNull();
  });
});

describe('server clock', () => {
  it('estimates the offset from welcome and pongs (half the round trip) and skips slow outliers', () => {
    const r = rig();
    feed(r, { t: 'welcome', protocol: PROTOCOL_VERSION, characterId: 'me', tickRate: 60, serverTime: r.clock.wall + 5000 });
    expect(r.box.get().serverClockOffset).toBe(5000);
    r.clock.t = 2000;
    feed(r, { t: 'pong', time: 1900, serverTime: r.clock.wall + 5200 - 50, serverTick: 1 });
    // sample = serverTime + rtt/2 − wall = 5150 + 50 = 5200 → blended 25%
    expect(r.session.serverNow() - r.clock.wall).toBeCloseTo(5050, 0);
    feed(r, { t: 'pong', time: 0, serverTime: r.clock.wall + 99_000, serverTick: 2 }); // 2 s round trip: skipped
    expect(r.session.serverNow() - r.clock.wall).toBeCloseTo(5050, 0);
  });
});

describe('keycap labels', () => {
  it('follow the keyboard layout (AZERTY) and stay default on QWERTY', () => {
    const azerty = new Map([['KeyQ', 'a'], ['KeyE', 'e'], ['KeyR', 'r'], ['KeyF', 'f']]);
    expect(loadoutKeyLabels(azerty)).toEqual(['LMB', 'Space', 'A', 'E', 'R', 'F']);
    const qwerty = new Map([['KeyQ', 'q'], ['KeyE', 'e'], ['KeyR', 'r'], ['KeyF', 'f']]);
    expect(loadoutKeyLabels(qwerty)).toBeNull();
    const r = rig();
    enter(r);
    r.session.keyLabels = loadoutKeyLabels(azerty);
    expect(r.session.hud(0, 60)?.slots.map((s) => s.key)).toEqual(['LMB', 'Space', 'A', 'E', 'R', 'F']);
  });
});

