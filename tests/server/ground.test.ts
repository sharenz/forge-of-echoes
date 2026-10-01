// Items on the floor (in-process: fake connections on a fake clock): dropping items (public drops), click
// pickups of own loot and ground items (reach, retries, full backpacks, someone else's loot), immediate
// saves on both sides, expiry, and ground items lost with their area — never an item created or destroyed
// by the hand-over itself.
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item } from '../../src/contracts/items';
import { SNAPSHOT_EVERY } from '../../src/contracts/net';
import type { SimEvent } from '../../src/contracts/sim';
import { PICKUP_REACH } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { GROUND_HINT, GROUND_ITEM_TTL_MS, PICKUP_RETRY_TICKS } from '../../src/server/ground';
import { MapInstance } from '../../src/server/instance';
import { createBot } from '../sim/bot';
import {
  LocalPlayer, captureLogger, createClock, createLocalCharacter, enterMapOf, holdings, openMap, partyUp, savedCharacter,
  startTestServer, tick, uidsOf, walkIntoProp, fillBackpack,
} from './helpers';
import type { Clock } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function setup(names: string[], opts: { mapIdleMs?: number } = {}) {
  const clock = createClock();
  const logger = captureLogger();
  server = await startTestServer({ logger, game: { autoTick: false, now: clock.now, ...opts } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players, logger };
}

function eventsOf(p: LocalPlayer, from = 0): SimEvent[] {
  return p.all('events', from).flatMap((m) => m.events);
}

/** The public drop of the player's instance lying closest to them (id + position). */
function publicDrop(p: LocalPlayer) {
  const me = p.me()!;
  const drops = p.view.drops.filter((d) => d.spec.owner === 0);
  drops.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  return drops[0] ?? null;
}

function distanceTo(p: LocalPlayer, x: number, y: number): number {
  const me = p.me()!;
  return Math.hypot(x - me.x, y - me.y);
}

/** Steer `p` (one input per tick) until `done` or `maxTicks`; the others send idle inputs. */
function walk(p: LocalPlayer, clock: Clock, target: { x: number; y: number }, done: () => boolean, others: LocalPlayer[] = [], maxTicks = 600): void {
  for (let k = 0; k < maxTicks && !done(); k++) {
    p.input(p.steerInput(target.x, target.y));
    for (const o of others) o.input();
    tick(p.server, clock);
  }
  // Let the last inputs drain so the server position is where the client meant to stop.
  for (let k = 0; k < 4; k++) {
    p.input();
    for (const o of others) o.input();
    tick(p.server, clock);
  }
}

/** Open ground in every hideout, well out of reach of the spot in front of the spawn where drops land. */
const AWAY = { x: 100, y: -60 };

function findByContent(ch: CharacterSave, item: Item): Item | null {
  const same = (a: Item) => a.kind === item.kind && JSON.stringify({ ...a, uid: '', isNew: undefined }) === JSON.stringify({ ...item, uid: '', isNew: undefined });
  for (const e of ch.backpack.entries) if (same(e.item)) return e.item;
  for (const it of Object.values(ch.equipment)) if (it && same(it)) return it;
  return null;
}

describe('dropping items on the floor', () => {
  it('a dropped item is public: the partner sees it, picks it up, and both saves are written at once', async () => {
    const { server, clock, players, logger } = await setup(['Giver Gwen', 'Taker Tam']);
    const [gwen, tam] = players;
    partyUp(gwen, tam);
    expect(tam.command({ c: 'visitHideout', characterId: gwen.characterId }).ok).toBe(true);
    const before = holdings(gwen.session.record.ch, tam.session.record.ch);
    const robe = gwen.session.record.ch.equipment.chest!;
    const focusBefore = gwen.me()!.maxFocus;

    const from = gwen.mark();
    const tamFrom = tam.mark();
    expect(gwen.command({ c: 'dropItem', uid: robe.uid }).ok).toBe(true);
    // Gone from the character at once — and from the database row, without waiting for the debounce.
    expect(gwen.session.record.ch.equipment.chest).toBeUndefined();
    expect(savedCharacter(server, gwen.characterId).equipment.chest).toBeUndefined();
    expect(gwen.all('toast', from).filter((t) => t.text === GROUND_HINT)).toHaveLength(1);
    tick(server, clock);
    expect(gwen.me()!.maxFocus).toBeLessThan(focusBefore); // the robe's focus left the sim too
    // A second drop in the same session: no second hint.
    const scrap = gwen.session.record.ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item;
    expect(gwen.command({ c: 'dropItem', uid: scrap.uid }).ok).toBe(true);
    expect(gwen.all('toast', from).filter((t) => t.text === GROUND_HINT)).toHaveLength(1);
    expect(server.game.instances.hideoutOf(gwen.characterId)!.groundItems.size).toBe(2);

    // Everyone in the area is told and sees them (public drops travel in every viewer's snapshot).
    tick(server, clock, SNAPSHOT_EVERY * 30);
    const spawned = eventsOf(tam, tamFrom).filter((e) => e.t === 'dropSpawn');
    expect(spawned.map((e) => e.t === 'dropSpawn' && e.owner)).toEqual([0, 0]);
    const snap = tam.decodeLast()!;
    const seen = Array.from({ length: snap.dropCount }, (_, k) => snap.drops[k]);
    expect(seen.filter((d) => d.spec.owner === 0)).toHaveLength(2);
    expect(seen.every((d) => d.spec.autoPickup === false)).toBe(true);

    // Tam walks over and clicks the robe: it is his now, flagged new, saved at once.
    const robeDrop = tam.view.drops.find((d) => d.spec.owner === 0 && d.spec.sprite === 'equipment')!;
    walk(tam, clock, robeDrop, () => distanceTo(tam, robeDrop.x, robeDrop.y) < PICKUP_REACH - 24, [gwen]);
    const gwenFrom = gwen.mark();
    const r = tam.command({ c: 'pickup', dropId: robeDrop.id });
    expect(r).toMatchObject({ ok: true });
    const got = findByContent(tam.session.record.ch, robe)!;
    expect(got).not.toBeNull();
    expect(got.isNew).toBe(true);
    expect(findByContent(savedCharacter(server, tam.characterId), robe)).not.toBeNull();
    expect(tam.view.drops.some((d) => d.id === robeDrop.id)).toBe(false);
    // The dropper saw it go (public pickup cue in view).
    tick(server, clock, SNAPSHOT_EVERY);
    expect(eventsOf(gwen, gwenFrom).some((e) => e.t === 'pickup' && e.owner === 0 && e.playerId === tam.playerId)).toBe(true);
    // The dropper may take her own dropped item back, like anyone.
    const scrapDrop = publicDrop(gwen)!;
    walk(gwen, clock, scrapDrop, () => distanceTo(gwen, scrapDrop.x, scrapDrop.y) < PICKUP_REACH - 24, [tam]);
    expect(gwen.command({ c: 'pickup', dropId: scrapDrop.id }).ok).toBe(true);

    // Nothing was created or destroyed on the way; uids stay unique per character.
    expect(holdings(gwen.session.record.ch, tam.session.record.ch)).toEqual(before);
    for (const p of players) expect(new Set(uidsOf(p.session.record.ch)).size).toBe(uidsOf(p.session.record.ch).length);
    expect(logger.lines.some((l) => l.msg === 'item dropped' && l.fields.character === 'Giver Gwen')).toBe(true);
    expect(logger.lines.some((l) => l.msg === 'ground item picked up' && l.fields.character === 'Taker Tam' && l.fields.droppedBy === 'Giver Gwen')).toBe(true);
  });

  it('refuses drops of stash items outside a hideout, of unknown items, and of items the sender does not hold', async () => {
    const { clock, players } = await setup(['Careful Cy', 'Other Ola']);
    const [cy, ola] = players;
    const scrap = cy.session.record.ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item.uid;
    expect(cy.command({ c: 'moveItem', uid: scrap, to: { kind: 'stash', tab: 0, x: 0, y: 0 } }).ok).toBe(true);
    expect(cy.session.record.ch.stash[0].grid.entries.some((e) => e.item.uid === scrap)).toBe(true);
    openMap(cy);
    walkIntoProp(cy, 'portal', clock);
    expect(cy.session.instance!.kind).toBe('map');
    expect(cy.command({ c: 'dropItem', uid: scrap }).error).toMatch(/only be dropped in a hideout/);
    expect(cy.command({ c: 'dropItem', uid: 'i999' }).error).toMatch(/no longer exists/);
    // Ola's items are not Cy's to drop: a uid only Ola holds means nothing for Cy.
    const olaBefore = ola.session.record.ch;
    expect(cy.command({ c: 'dropItem', uid: 'fill-only-ola' }).error).toMatch(/no longer exists/);
    expect(ola.session.record.ch).toBe(olaBefore);
    // Belt slot 3 is empty in the starting kit.
    expect(cy.command({ c: 'dropItem', uid: 'belt:3' }).ok).toBe(false);
    // Belt charges can be dropped; the sim's flask runtime follows.
    expect(cy.command({ c: 'dropItem', uid: 'belt:2' }).ok).toBe(true);
    expect(cy.session.record.ch.belt[2]).toBeNull();
    tick(cy.server, clock, 2);
    expect(cy.me()!.flasks[2]).toBeNull();
  });
});

describe('click pickups', () => {
  it('own loot is clicked up; another player\'s loot is refused', async () => {
    const { server, clock, players } = await setup(['Looter Lia', 'Friend Fin']);
    const [lia, fin] = players;
    partyUp(lia, fin);
    // Every kill in this test drops one copy of Lia's (or Fin's) wand, as instanced loot for its roller.
    const original = rules.rollKillLoot;
    let minted = 0;
    rules.rollKillLoot = (_setup, _ctx, _rng, looter) => {
      const wand = Object.values(looter.equipment).find((i): i is EquipmentItem => !!i && i.baseId === 'ashwoodWand');
      return wand && minted < 6 ? [{ ...wand, uid: `dtest${minted++}` }] : [];
    };
    try {
      openMap(lia);
      walkIntoProp(lia, 'portal', clock, [fin]);
      enterMapOf(fin, lia, clock, [lia]);
      const map = lia.session.instance as MapInstance;
      const bots = [createBot(), createBot()];
      let own = null as null | { id: number; x: number; y: number };
      for (let t = 0; t < 60 * 90 && !own; t++) {
        lia.intent(bots[0].intent(map.run.view, lia.playerId));
        fin.intent(bots[1].intent(map.run.view, fin.playerId));
        tick(server, clock);
        const d = map.run.view.drops.find((dr) => dr.spec.owner === lia.playerId && !dr.spec.autoPickup && dr.z === 0);
        if (d) own = { id: d.id, x: d.x, y: d.y };
      }
      expect(own).not.toBeNull();
      // Fin cannot take Lia's instanced loot, whatever he sends.
      expect(fin.command({ c: 'pickup', dropId: own!.id }).error).toBe('That item belongs to someone else.');
      // Lia walks there and clicks it.
      const before = lia.session.record.ch.backpack.entries.length;
      walk(lia, clock, own!, () => distanceTo(lia, own!.x, own!.y) < PICKUP_REACH - 24, [fin]);
      const res = lia.command({ c: 'pickup', dropId: own!.id });
      expect(res.ok).toBe(true);
      expect(lia.session.record.ch.backpack.entries.length).toBe(before + 1);
      expect(lia.command({ c: 'pickup', dropId: own!.id }).error).toBe('That item is gone.');
    } finally {
      rules.rollKillLoot = original;
    }
  }, 60_000);

  it('a click just out of reach succeeds when the player arrives within the retry window, and fails after it', async () => {
    const { server, clock, players } = await setup(['Reacher Rui']);
    const [rui] = players;
    const map = rui.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect(rui.command({ c: 'dropItem', uid: map }).ok).toBe(true);
    tick(server, clock, 60); // it lands
    const drop = publicDrop(rui)!;
    // Walk away until clearly out of reach, then click: no answer yet (the click waits for reach) …
    walk(rui, clock, AWAY, () => distanceTo(rui, drop.x, drop.y) > PICKUP_REACH + 60);
    expect(distanceTo(rui, drop.x, drop.y)).toBeGreaterThan(PICKUP_REACH + 50);
    const from = rui.mark();
    rui.send({ t: 'cmd', id: 700, cmd: { c: 'pickup', dropId: drop.id } });
    expect(rui.all('result', from)).toHaveLength(0);
    // … and fails once the window is over.
    for (let k = 0; k <= PICKUP_RETRY_TICKS; k++) {
      rui.input();
      tick(server, clock);
    }
    expect(rui.all('result', from).find((m) => m.id === 700)).toMatchObject({ ok: false, error: 'Too far away.' });
    expect(publicDrop(rui)?.id).toBe(drop.id);

    // Just beyond reach and walking in: the retry picks it up within the window.
    walk(rui, clock, drop, () => distanceTo(rui, drop.x, drop.y) < PICKUP_REACH + 30);
    expect(distanceTo(rui, drop.x, drop.y)).toBeGreaterThan(PICKUP_REACH);
    const from2 = rui.mark();
    rui.send({ t: 'cmd', id: 701, cmd: { c: 'pickup', dropId: drop.id } });
    for (let k = 0; k <= PICKUP_RETRY_TICKS && !rui.all('result', from2).some((m) => m.id === 701); k++) {
      rui.input(rui.steerInput(drop.x, drop.y));
      tick(server, clock);
    }
    if (rui.session.pushPending) rui.session.flushCharacter();
    expect(rui.all('result', from2).find((m) => m.id === 701)).toMatchObject({ ok: true });
    expect(rui.session.record.ch.backpack.entries.some((e) => e.item.kind === 'map' && e.item.isNew)).toBe(true);

    // A newer click answers the older pending one.
    const scrap = rui.session.record.ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item.uid;
    expect(rui.command({ c: 'dropItem', uid: scrap }).ok).toBe(true);
    tick(server, clock, 60);
    const again = publicDrop(rui)!;
    walk(rui, clock, AWAY, () => distanceTo(rui, again.x, again.y) > PICKUP_REACH + 60);
    const from3 = rui.mark();
    rui.send({ t: 'cmd', id: 702, cmd: { c: 'pickup', dropId: again.id } });
    rui.send({ t: 'cmd', id: 703, cmd: { c: 'pickup', dropId: 987654 } });
    const results = rui.all('result', from3);
    expect(results.find((m) => m.id === 702)).toMatchObject({ ok: false, error: 'Too far away.' });
    expect(results.find((m) => m.id === 703)).toMatchObject({ ok: false, error: 'That item is gone.' });
  });

  it('clicking the same drop again while the first click waits: both clicks get the pickup, never a stray "Too far away."', async () => {
    const { server, clock, players } = await setup(['Double Dana']);
    const [dana] = players;
    const map = dana.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!;
    const sameAsDropped = (it: Item) => JSON.stringify({ ...it, uid: '', isNew: undefined }) === JSON.stringify({ ...map.item, uid: '', isNew: undefined });
    const copies = () => dana.session.record.ch.backpack.entries.filter((e) => sameAsDropped(e.item)).length;
    const before = copies();
    expect(dana.command({ c: 'dropItem', uid: map.item.uid }).ok).toBe(true);
    expect(copies()).toBe(before - 1);
    tick(server, clock, 60);
    const drop = publicDrop(dana)!;
    walk(dana, clock, AWAY, () => distanceTo(dana, drop.x, drop.y) > PICKUP_REACH + 60);

    // A double-click from out of reach: both wait. Asking again later renews the retry window.
    const from = dana.mark();
    dana.send({ t: 'cmd', id: 800, cmd: { c: 'pickup', dropId: drop.id } });
    dana.send({ t: 'cmd', id: 801, cmd: { c: 'pickup', dropId: drop.id } });
    for (let k = 0; k < PICKUP_RETRY_TICKS - 5; k++) {
      dana.input();
      tick(server, clock);
    }
    dana.send({ t: 'cmd', id: 802, cmd: { c: 'pickup', dropId: drop.id } });
    for (let k = 0; k < 10; k++) {
      dana.input();
      tick(server, clock);
    }
    expect(dana.all('result', from)).toHaveLength(0);

    // Walking up while the client keeps asking (each renewal keeps the click alive): every click waiting is
    // answered with the pickup.
    const ids = [800, 801, 802];
    for (let k = 0; k < 400 && copies() < before; k++) {
      dana.input(dana.steerInput(drop.x, drop.y));
      tick(server, clock);
      if (k % 15 === 14 && copies() < before) {
        ids.push(800 + ids.length);
        dana.send({ t: 'cmd', id: ids.at(-1)!, cmd: { c: 'pickup', dropId: drop.id } });
      }
    }
    if (dana.session.pushPending) dana.session.flushCharacter();
    const results = dana.all('result', from);
    expect(results.map((r) => r.id).sort()).toEqual(ids.slice().sort());
    for (const r of results) expect(r).toMatchObject({ ok: true });
    // Picked up exactly once.
    expect(copies()).toBe(before);
    expect(publicDrop(dana)).toBeNull();
  });

  it('a full backpack refuses a ground item and leaves it on the floor; nothing changes hands', async () => {
    const { server, clock, players } = await setup(['Packed Pia', 'Dropper Dov']);
    const [pia, dov] = players;
    partyUp(dov, pia);
    expect(pia.command({ c: 'visitHideout', characterId: dov.characterId }).ok).toBe(true);
    fillBackpack(pia);
    const wand = dov.session.record.ch.equipment.mainHand!;
    expect(dov.command({ c: 'dropItem', uid: wand.uid }).ok).toBe(true);
    tick(server, clock, 60);
    const before = holdings(pia.session.record.ch, dov.session.record.ch);
    const drop = publicDrop(pia)!;
    walk(pia, clock, drop, () => distanceTo(pia, drop.x, drop.y) < PICKUP_REACH - 24, [dov]);
    const from = pia.mark();
    expect(pia.command({ c: 'pickup', dropId: drop.id }).error).toBe('Your inventory is full.');
    // The command error is the only message about it (no extra "backpack full" toast).
    expect(pia.all('toast', from)).toHaveLength(0);
    expect(pia.view.drops.some((d) => d.id === drop.id)).toBe(true);
    expect(holdings(pia.session.record.ch, dov.session.record.ch)).toEqual(before);
    // Dov (with room) can still take it back.
    walk(dov, clock, drop, () => distanceTo(dov, drop.x, drop.y) < PICKUP_REACH - 24, [pia]);
    expect(dov.command({ c: 'pickup', dropId: drop.id }).ok).toBe(true);
  });

});

describe('ground item lifetime', () => {
  it('expires after 10 minutes; an empty hideout with items on the ground stays open until then', async () => {
    const { server, clock, players, logger } = await setup(['Host Hal', 'Visitor Vi']);
    const [hal, vi] = players;
    partyUp(hal, vi);
    expect(hal.command({ c: 'visitHideout', characterId: vi.characterId }).ok).toBe(true);
    const viHome = vi.session.instance!;
    // Vi leaves her own hideout; Hal drops something there and goes home.
    expect(vi.command({ c: 'visitHideout', characterId: hal.characterId }).ok).toBe(true);
    const map = hal.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect(hal.command({ c: 'dropItem', uid: map }).ok).toBe(true);
    const dropId = [...viHome.groundItems.values()][0].dropId;
    expect(hal.command({ c: 'visitHideout', characterId: hal.characterId }).ok).toBe(true);
    expect(viHome.playerCount).toBe(0);

    clock.advance(5 * 60_000);
    server.game.maintenance();
    expect(viHome.disposed).toBe(false); // well past the 60 s idle limit, kept for the item
    expect(viHome.groundItems.size).toBe(1);

    clock.advance(GROUND_ITEM_TTL_MS - 5 * 60_000);
    server.game.maintenance();
    expect(viHome.groundItems.size).toBe(0);
    expect(viHome.run.view.drops.some((d) => d.id === dropId)).toBe(false);
    expect(logger.lines.some((l) => l.msg === 'ground items expired' && l.fields.count === 1)).toBe(true);
    server.game.maintenance();
    expect(viHome.disposed).toBe(true);
  });

  it('what lies on the ground of a map is lost when the map closes (logged)', async () => {
    // The map closes (idle) long before its ground items would expire.
    const { server, clock, players, logger } = await setup(['Loser Lou'], { mapIdleMs: 60_000 });
    const [lou] = players;
    openMap(lou);
    walkIntoProp(lou, 'portal', clock);
    const map = lou.session.instance as MapInstance;
    const scrap = lou.session.record.ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item.uid;
    expect(lou.command({ c: 'dropItem', uid: scrap }).ok).toBe(true);
    expect(map.groundItems.size).toBe(1);
    expect(lou.command({ c: 'leaveMap' }).ok).toBe(true);
    clock.advance(60_000);
    server.game.maintenance();
    expect(map.disposed).toBe(true);
    expect(logger.lines.some((l) => l.msg === 'ground items lost' && l.fields.instance === map.id && l.fields.count === 1)).toBe(true);
  });
});
