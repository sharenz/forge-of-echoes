// In-process scenarios on the real Game (fake connections, fast-forwarded fixed ticks on a fake clock):
// instanced loot, shared XP, death → respawn → re-entry, and the reconnect grace period.
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH, PORTALS_PER_MAP, SNAPSHOT_EVERY } from '../../src/contracts/net';
import type { ServerMessage } from '../../src/contracts/net';
import type { SimEvent } from '../../src/contracts/sim';
import { AOI_MARGIN, decodeSnapshot } from '../../src/net';
import { MapInstance } from '../../src/server/instance';
import { worldOf } from '../../src/sim/run';
import { damageMonster, damagePlayer } from '../../src/sim/combat';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { placeMonster } from '../sim/helpers';
import { createBot } from '../sim/bot';
import { LocalPlayer, createClock, createLocalCharacter, startTestServer, tick, walkIntoProp } from './helpers';
import type { Clock } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** Pinned server entropy (loot, crafting): every run of these tests rolls the same drops. */
function pinnedEntropy(seed = 0x5eed1234): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

async function setup(names: string[], opts: { reconnectGraceMs?: number } = {}) {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now, entropy: pinnedEntropy(), ...opts } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

function mapUid(ch: CharacterSave): string {
  const e = ch.backpack.entries.find((en) => en.item.kind === 'map');
  if (!e) throw new Error('no map');
  return e.item.uid;
}

/** Owner loads + opens a map; everyone else joins the party, visits and walks in. */
function openAndEnter(players: LocalPlayer[], clock: Clock): MapInstance {
  const [owner, ...rest] = players;
  for (const p of rest) {
    expect(owner.command({ c: 'partyInvite', name: p.session.name }).ok).toBe(true);
    const inv = p.last('invite')!.invite;
    expect(p.command({ c: 'partyRespond', inviteId: inv.inviteId, accept: true }).ok).toBe(true);
  }
  expect(owner.command({ c: 'moveItem', uid: mapUid(owner.session.record.ch), to: { kind: 'mapDevice' } }).ok).toBe(true);
  expect(owner.command({ c: 'activateMapDevice' }).ok).toBe(true);
  walkIntoProp(owner, 'portal', clock, rest);
  for (const p of rest) {
    expect(p.command({ c: 'visitHideout', characterId: owner.characterId }).ok).toBe(true);
    walkIntoProp(p, 'portal', clock, players.filter((q) => q !== p));
  }
  const map = owner.session.instance;
  if (!(map instanceof MapInstance)) throw new Error('owner is not in a map');
  for (const p of rest) expect(p.session.instance).toBe(map);
  return map;
}

function eventsOf(messages: readonly ServerMessage[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (const m of messages) if (m.t === 'events') out.push(...m.events);
  return out;
}

describe('instanced loot and shared xp', () => {
  it('grants distant kill XP immediately to living party members, once, without orbs', async () => {
    const { server, clock, players } = await setup(['Killwise', 'Sharewise']);
    const map = openAndEnter(players, clock);
    const world = worldOf(map.run)!;
    for (const p of world.players) p.stats.pickupRadius = 0;
    const before = players.map((p) => map.participant(p.session).xpGained);
    const kill = () => {
      const i = placeMonster(world, 'riftStalker', 500, 0, { life: 1 });
      const xp = world.monsters.xp[i];
      damageMonster(world, i, 1000, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, players[0].playerId);
      tick(server, clock);
      return xp;
    };
    const first = kill();
    expect(players.map((p, i) => map.participant(p.session).xpGained - before[i])).toEqual([first, first]);
    expect(map.run.view.motes.count).toBe(0);
    tick(server, clock, 3);
    expect(players.map((p, i) => map.participant(p.session).xpGained - before[i])).toEqual([first, first]);
    const secondPlayer = world.playerById[players[1].playerId]!;
    secondPlayer.invulnTime = 0;
    damagePlayer(world, secondPlayer, 1e9, DAMAGE_INDEX.physical, 'area');
    expect(secondPlayer.dead).toBe(true);
    const second = kill();
    expect(players.map((p, i) => map.participant(p.session).xpGained - before[i])).toEqual([first + second, first]);
  });

  it('each player sees and picks up only their own drops; XP goes to both', async () => {
    const { server, clock, players } = await setup(['Lootwise', 'Sharewell']);
    const [a, b] = players;
    const map = openAndEnter(players, clock);
    expect(map.portalsRemaining).toBe(PORTALS_PER_MAP - 2);
    const bots = [createBot(), createBot()];
    const xp0 = players.map((p) => ({ level: p.session.record.ch.level, xp: p.session.record.ch.xp }));
    const sawOwnDrop = [false, false];
    const sawOtherHidden = [false, false];
    let deaths = 0;
    const hw = AOI_HALF_WIDTH + AOI_MARGIN;
    const hh = AOI_HALF_HEIGHT + AOI_MARGIN;

    for (let t = 0; t < 60 * 180; t++) {
      for (let k = 0; k < 2; k++) {
        const p = players[k];
        if (p.session.instance === map) p.intent(bots[k].intent(map.run.view, p.playerId));
      }
      tick(server, clock);
      if (map.disposed) break;
      const view = map.run.view;
      if (view.tick % SNAPSHOT_EVERY === 0 && view.drops.length > 0) {
        // A snapshot just went out to everyone: it must carry only the viewer's own drops.
        for (const [k, p] of players.entries()) {
          if (p.session.instance !== map) continue;
          const snap = p.decodeLast()!;
          expect(snap.viewerId).toBe(p.playerId);
          for (let d = 0; d < snap.dropCount; d++) expect(snap.drops[d].spec.owner).toBe(p.playerId);
          if (snap.dropCount > 0) sawOwnDrop[k] = true;
          const me = p.me()!;
          const hidden = view.drops.some((d) => d.spec.owner !== p.playerId && Math.abs(d.x - me.x) <= hw && Math.abs(d.y - me.y) <= hh);
          if (hidden) sawOtherHidden[k] = true;
        }
      }
      deaths = Math.max(deaths, players.filter((p) => map.isDead(p.session)).length);
      const gained = players.every((p, k) => p.session.record.ch.xp !== xp0[k].xp || p.session.record.ch.level !== xp0[k].level);
      const collected = players.some(p => map.participant(p.session).itemsFound.length > 0);
      if (sawOwnDrop.every(Boolean) && sawOtherHidden.some(Boolean) && gained && collected && t > 60 * 30) break;
    }
    expect(sawOwnDrop).toEqual([true, true]);
    // Another player's drop was right there in view, and the snapshot left it out.
    expect(sawOtherHidden.some(Boolean)).toBe(true);

    // Drop and pickup events only ever reached their owner.
    for (const p of players) {
      const evs = eventsOf(p.conn.messages);
      const drops = evs.filter((e): e is Extract<SimEvent, { t: 'dropSpawn' | 'pickup' }> => e.t === 'dropSpawn' || e.t === 'pickup');
      expect(drops.length).toBeGreaterThan(0);
      for (const e of drops) expect(e.owner).toBe(p.playerId);
    }
    // Shared XP: both characters gained experience (identical while both stayed alive).
    for (const [k, p] of players.entries()) {
      const ch = p.session.record.ch;
      expect(ch.level > xp0[k].level || ch.xp > xp0[k].xp).toBe(true);
    }
    if (deaths === 0) {
      expect(a.session.record.ch.level).toBe(b.session.record.ch.level);
      expect(a.session.record.ch.xp).toBe(b.session.record.ch.xp);
    }
    // Picked-up loot landed in the right backpacks and the run log counts it.
    const found = players.map((p) => map.participant(p.session).itemsFound.length);
    expect(found.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    // Every snapshot any client got decodes cleanly.
    for (const p of players) expect(() => decodeSnapshot(p.conn.lastSnapshot!)).not.toThrow();
  }, 60_000);
});

/** Distance from a player to the open map portal of the hideout they stand in. */
function distanceToPortal(p: LocalPlayer): number {
  const portal = p.view.props.find((q) => q.kind === 'portal' && q.state > 0);
  const me = p.me();
  if (!portal || !me) return Infinity;
  return Math.hypot(me.x - portal.x, me.y - portal.y);
}

describe('death, respawn and re-entry', () => {
  it('a dead player returns home with a failed summary, keeps the map, and re-enters for a portal', async () => {
    const { server, clock, players } = await setup(['Fallen One']);
    const [p] = players;
    const map = openAndEnter(players, clock);
    expect(map.portalsRemaining).toBe(PORTALS_PER_MAP - 1);
    expect(p.command({ c: 'respawn' }).error).toMatch(/still alive/);
    const deathsBefore = p.session.record.ch.stats.deaths;

    // Stand still until the horde gets her.
    let t = 0;
    while (!map.isDead(p.session) && t++ < 60 * 600) {
      p.input();
      tick(server, clock);
    }
    expect(map.isDead(p.session)).toBe(true);
    expect(p.session.record.ch.stats.deaths).toBe(deathsBefore + 1);
    tick(server, clock, 2); // events travel with the next snapshot
    expect(eventsOf(p.conn.messages).some((e) => e.t === 'playerDeath' && e.playerId === p.playerId)).toBe(true);

    const from = p.mark();
    expect(p.command({ c: 'respawn' }).ok).toBe(true);
    const zone = p.all('zone', from)[0]?.zone;
    expect(zone).toMatchObject({ kind: 'hideout', ownerCharacterId: p.characterId });
    expect(zone!.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 1 });
    // Right in front of the portal (outside its walk-in radius: she is not pulled straight back in).
    expect(distanceToPortal(p)).toBeGreaterThan(26);
    expect(distanceToPortal(p)).toBeLessThanOrEqual(60);
    const summary = p.all('runSummary', from)[0]?.summary;
    expect(summary).toMatchObject({ result: 'failed', tier: 1 });
    expect(summary!.seconds).toBeGreaterThan(0);

    // The map survives (portals remain) and she walks back in, alive, for one more portal.
    tick(server, clock, 30);
    server.game.maintenance();
    expect(map.disposed).toBe(false);
    walkIntoProp(p, 'portal', clock);
    expect(p.session.instance).toBe(map);
    expect(map.isDead(p.session)).toBe(false);
    expect(map.portalsRemaining).toBe(PORTALS_PER_MAP - 2);
  }, 60_000);
});

describe('leaving a friend\'s map', () => {
  it('a party member who dies, leaves or takes the return portal lands in the map owner\'s hideout, next to its portals', async () => {
    const { server, clock, players } = await setup(['Owner Ola', 'Friend Finn']);
    const [owner, friend] = players;
    const map = openAndEnter(players, clock);
    expect(map.portalsRemaining).toBe(PORTALS_PER_MAP - 2);

    // Leave: back to Ola's hideout (not his own), with the portal right there.
    let from = friend.mark();
    expect(friend.command({ c: 'leaveMap' }).ok).toBe(true);
    let zone = friend.all('zone', from)[0]?.zone;
    expect(zone).toMatchObject({ kind: 'hideout', ownerCharacterId: owner.characterId });
    expect(zone!.portal).toMatchObject({ remaining: PORTALS_PER_MAP - 2 });
    expect(distanceToPortal(friend)).toBeLessThanOrEqual(60);

    // Walk back in (a portal), then die: respawn also lands in Ola's hideout.
    walkIntoProp(friend, 'portal', clock);
    expect(friend.session.instance).toBe(map);
    let t = 0;
    while (!map.isDead(friend.session) && t++ < 60 * 600) {
      friend.input();
      owner.input();
      tick(server, clock);
    }
    expect(map.isDead(friend.session)).toBe(true);
    from = friend.mark();
    expect(friend.command({ c: 'respawn' }).ok).toBe(true);
    zone = friend.all('zone', from)[0]?.zone;
    expect(zone).toMatchObject({ kind: 'hideout', ownerCharacterId: owner.characterId });
    expect(friend.all('runSummary', from)[0]?.summary).toMatchObject({ result: 'failed' });
    expect(distanceToPortal(friend)).toBeLessThanOrEqual(60);

    // Out of the party: leaving goes to his own hideout instead.
    walkIntoProp(friend, 'portal', clock);
    expect(friend.session.instance).toBe(map);
    expect(friend.command({ c: 'partyLeave' }).ok).toBe(true);
    if (friend.session.instance === map) {
      from = friend.mark();
      expect(friend.command({ c: 'leaveMap' }).ok).toBe(true);
      expect(friend.all('zone', from)[0]?.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: friend.characterId });
    } else {
      expect(friend.session.instance!.ownerId).toBe(friend.characterId);
    }
  }, 60_000);

  it('portals can be clicked: a party member enters from the owner\'s hideout without walking; bad clicks are refused', async () => {
    const { clock, players } = await setup(['Clicker Cai', 'Friend Fay']);
    const [owner, friend] = players;
    const mapItem = mapUid(owner.session.record.ch);
    expect(owner.command({ c: 'moveItem', uid: mapItem, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(owner.command({ c: 'activateMapDevice' }).ok).toBe(true);
    const portal = owner.session.instance!.run.view.props.find((p) => p.kind === 'portal')!;
    expect(portal.state).toBe(PORTALS_PER_MAP);
    // Not in the party yet: refused with a reason.
    expect(friend.command({ c: 'usePortal', propId: portal.id }).error).toMatch(/There is no portal|party/);
    expect(owner.command({ c: 'partyInvite', name: 'Friend Fay' }).ok).toBe(true);
    expect(friend.command({ c: 'partyRespond', inviteId: friend.last('invite')!.invite.inviteId, accept: true }).ok).toBe(true);
    expect(friend.command({ c: 'visitHideout', characterId: owner.characterId }).ok).toBe(true);
    // A prop that isn't a portal is refused.
    const stash = friend.session.instance!.run.view.props.find((p) => p.kind === 'stash')!;
    expect(friend.command({ c: 'usePortal', propId: stash.id }).ok).toBe(false);
    // Click the portal from across the hideout.
    expect(friend.command({ c: 'usePortal', propId: portal.id }).ok).toBe(true);
    const map = friend.session.instance!;
    expect(map.kind).toBe('map');
    expect((map as MapInstance).portalsRemaining).toBe(PORTALS_PER_MAP - 1);
    void clock;
  });

  it('the map owner still returns to their own hideout', async () => {
    const { clock, players } = await setup(['Solo Sol']);
    const [p] = players;
    openAndEnter(players, clock);
    const from = p.mark();
    expect(p.command({ c: 'leaveMap' }).ok).toBe(true);
    expect(p.all('zone', from)[0]?.zone).toMatchObject({ kind: 'hideout', ownerCharacterId: p.characterId });
  });
});

describe('reconnect grace', () => {
  it('keeps a disconnected character in place, resumes it on reconnect, and ends the session after the grace', async () => {
    const { server, clock, players } = await setup(['Flicker'], { reconnectGraceMs: 5000 });
    const [p] = players;
    const inst = p.session.instance!;
    const id = p.playerId;
    server.game.detach(p.conn);
    tick(server, clock, 60);
    server.game.maintenance();
    expect(server.game.sessions.has(p.characterId)).toBe(true);
    expect(p.session.instance).toBe(inst);

    // Reconnect: same instance, same player id, a fresh welcome/character/zone.
    const again = new LocalPlayer(server, p.characterId);
    expect(again.all('welcome')).toHaveLength(1);
    expect(again.zone).toMatchObject({ instanceId: inst.id, localPlayerId: id });

    // Drop again and let the grace run out: the session ends and the character is saved and released.
    server.game.detach(again.conn);
    clock.advance(6000);
    server.game.maintenance();
    expect(server.game.sessions.has(p.characterId)).toBe(false);
    expect(server.game.store.peek(p.characterId)).toBeNull();
    expect(inst.playerCount).toBe(0);
  });
});

describe('instance lifecycle', () => {
  it('a map closes once its 8 portals are spent and it is empty (logged as failed); the hideout portal disappears', async () => {
    const { server, clock, players } = await setup(['Portal Walker']);
    const [p] = players;
    const map = openAndEnter(players, clock);
    for (let used = 1; used < PORTALS_PER_MAP; used++) {
      expect(p.command({ c: 'leaveMap' }).ok).toBe(true);
      walkIntoProp(p, 'portal', clock);
      expect(p.session.instance).toBe(map);
    }
    expect(map.portalsRemaining).toBe(0);
    const from = p.mark();
    expect(p.command({ c: 'leaveMap' }).ok).toBe(true);
    // Home: no portal is shown any more, and the empty map with no portals left is closed.
    expect(p.all('zone', from)[0].zone.portal).toBeNull();
    const hideoutPortal = p.view.props.find((pr) => pr.kind === 'portal');
    expect(hideoutPortal?.state ?? 0).toBe(0);
    server.game.maintenance();
    expect(map.disposed).toBe(true);
    expect(server.game.instances.activeMapOf(p.characterId)).toBeNull();
    expect(p.session.record.ch.stats.mapsFailed).toBe(1);
  }, 60_000);

  it('an abandoned map closes after 10 idle minutes; an empty hideout is disposed after 60 s', async () => {
    const { server, clock, players } = await setup(['Idle Ida', 'Guest Gil']);
    const [ida, gil] = players;
    const map = openAndEnter([ida], clock);
    expect(ida.command({ c: 'leaveMap' }).ok).toBe(true);
    // Gil joins Ida's party and visits; his own hideout empties.
    expect(ida.command({ c: 'partyInvite', name: 'Guest Gil' }).ok).toBe(true);
    expect(gil.command({ c: 'partyRespond', inviteId: gil.last('invite')!.invite.inviteId, accept: true }).ok).toBe(true);
    const gilHome = gil.session.instance!;
    expect(gil.command({ c: 'visitHideout', characterId: ida.characterId }).ok).toBe(true);
    expect(gilHome.playerCount).toBe(0);

    clock.advance(59_000);
    server.game.maintenance();
    expect(gilHome.disposed).toBe(false);
    clock.advance(2_000);
    server.game.maintenance();
    expect(gilHome.disposed).toBe(true);
    expect(map.disposed).toBe(false);
    clock.advance(10 * 60_000);
    server.game.maintenance();
    expect(map.disposed).toBe(true);
    expect(ida.session.record.ch.stats.mapsFailed).toBe(1); // 'abandoned' counts as not completed
    // Party frames no longer list an open map.
    const info = ida.last('party')!.party!.members.find((m) => m.characterId === ida.characterId)!;
    expect(info.activeMap).toBeNull();
    // Gil can still go home: his hideout is created again on demand.
    expect(gil.command({ c: 'visitHideout', characterId: gil.characterId }).ok).toBe(true);
    expect(gil.session.instance!.ownerId).toBe(gil.characterId);
    expect(gil.session.instance).not.toBe(gilHome);
  }, 60_000);

  it('an instance that throws is disposed and its players are sent home; the server keeps running', async () => {
    const { server, clock, players } = await setup(['Crash Test']);
    const [p] = players;
    const map = openAndEnter(players, clock);
    map.run.step = () => {
      throw new Error('simulated sim failure');
    };
    const from = p.mark();
    tick(server, clock, 3);
    expect(map.disposed).toBe(true);
    expect(p.session.instance?.kind).toBe('hideout');
    expect(p.all('toast', from).some((m) => m.tone === 'bad' && /went wrong/.test(m.text))).toBe(true);
    expect(p.all('zone', from)[0].zone.kind).toBe('hideout');
    // Life goes on: the hideout ticks and answers commands.
    tick(server, clock, 10);
    expect(p.command({ c: 'clearNewFlags' }).ok).toBe(true);
    expect(p.conn.closedWith).toBeNull();
  });
});
