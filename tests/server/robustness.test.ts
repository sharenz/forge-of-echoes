// Online robustness (in-process: fake connections on a fake clock): snapshot pacing on congested links,
// command results that never overtake their state, failures that stay contained (one outcome, one viewer,
// one join), expired logins, run summaries that survive crashes and dropped sockets, and server shutdowns
// that are nobody's failure (the open map is kept for the restart — see restart.test.ts).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { PORTALS_PER_MAP, SNAPSHOT_EVERY } from '../../src/contracts/net';
import type { ServerMessage } from '../../src/contracts/net';
import type { SimEvent } from '../../src/contracts/sim';
import { GameDatabase } from '../../src/server';
import { MapInstance } from '../../src/server/instance';
import { SNAPSHOT_BACKPRESSURE_BYTES } from '../../src/server/session';
import { createBot } from '../sim/bot';
import { LocalPlayer, createClock, createLocalCharacter, enterMapOf, openMap, partyUp, startTestServer, tick, walkIntoProp } from './helpers';
import type { Clock } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

const dir = mkdtempSync(join(tmpdir(), 'forge-robustness-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function setup(names: string[], opts: { reconnectGraceMs?: number; dbPath?: string } = {}) {
  const clock = createClock();
  server = await startTestServer({
    ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
    game: { autoTick: false, now: clock.now, ...(opts.reconnectGraceMs ? { reconnectGraceMs: opts.reconnectGraceMs } : {}) },
  });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

function soloMap(p: LocalPlayer, clock: Clock): MapInstance {
  openMap(p);
  walkIntoProp(p, 'portal', clock);
  const map = p.session.instance;
  if (!(map instanceof MapInstance)) throw new Error('not in a map');
  return map;
}

describe('snapshot pacing', () => {
  it('halves the rate while the socket backs up, skips at the hard limit, and recovers when it drains', async () => {
    const { server, clock, players } = await setup(['Slow Link']);
    const [p] = players;
    const conn = p.conn;
    const count = (ticks: number, buffered: number) => {
      conn.bufferedAmount = buffered;
      const before = conn.snapshotCount;
      for (let k = 0; k < ticks; k++) {
        p.input();
        tick(server, clock);
      }
      return conn.snapshotCount - before;
    };
    // Healthy: one snapshot every SNAPSHOT_EVERY ticks.
    expect(count(60, 0)).toBe(60 / SNAPSHOT_EVERY);
    // Unsent data keeps piling up: after two snapshot times in a row, every second snapshot only.
    const times = 120 / SNAPSHOT_EVERY;
    const slow = count(120, 2048);
    expect(slow).toBeGreaterThanOrEqual(times / 2);
    expect(slow).toBeLessThanOrEqual(times / 2 + 2);
    // Over the hard limit: nothing at all (but zone / character / results would still go out).
    expect(count(60, SNAPSHOT_BACKPRESSURE_BYTES + 1)).toBe(0);
    expect(p.command({ c: 'clearNewFlags' }).ok).toBe(true);
    // Drained completely: straight back to the full rate.
    expect(count(60, 0)).toBe(60 / SNAPSHOT_EVERY);
    expect(p.session.link.skipped).toBeGreaterThan(0);
  });

  it('a congested viewer keeps its essential events (own drops, deaths) and loses only cosmetic ones', async () => {
    const { server, clock, players } = await setup(['Lagging Lu']);
    const [p] = players;
    const map = soloMap(p, clock);
    const bot = createBot();
    const conn = p.conn;
    conn.bufferedAmount = SNAPSHOT_BACKPRESSURE_BYTES + 1;
    // Fight until something essential happened while the link was jammed.
    let sawEssential = false;
    for (let t = 0; t < 60 * 90 && !sawEssential; t++) {
      p.intent(bot.intent(map.run.view, p.playerId));
      tick(server, clock);
      sawEssential = map.run.view.drops.some((d) => d.spec.owner === p.playerId);
    }
    expect(sawEssential).toBe(true);
    const from = p.mark();
    conn.bufferedAmount = 0;
    tick(server, clock, SNAPSHOT_EVERY);
    const events = p.all('events', from).flatMap((m) => m.events);
    expect(events.some((e: SimEvent) => e.t === 'dropSpawn' && e.owner === p.playerId)).toBe(true);
    expect(events.length).toBeLessThanOrEqual(200 + 240);
  }, 60_000);
});

describe('command results and state', () => {
  it("a result that changed the character is sent after that change's 'character' push", async () => {
    const { clock, players } = await setup(['Quick Hands']);
    const [p] = players;
    // First change, well after the login push: the push goes out at once, then the result.
    clock.advance(1000);
    const ch = p.session.record.ch;
    const first = ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item.uid;
    let from = p.mark();
    p.send({ t: 'cmd', id: 900, cmd: { c: 'quickMove', uid: first, stashTab: 0 } });
    let kinds = p.conn.messages.slice(from).map((m) => m.t);
    expect(kinds).toEqual(['character', 'result']);
    // Second change right after: the push waits for its ≤ 5 Hz slot, and so does the result.
    const secondItem = p.session.record.ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item;
    if (secondItem.kind !== 'currency') throw new Error('Expected a currency');
    const second = secondItem.uid;
    const expectedCount = (p.session.record.ch.currencyStash[secondItem.currencyId] ?? 0) + secondItem.count;
    from = p.mark();
    p.send({ t: 'cmd', id: 901, cmd: { c: 'quickMove', uid: second, stashTab: 0 } });
    expect(p.conn.messages.slice(from)).toHaveLength(0);
    expect(p.session.pushPending).toBe(true);
    // A command that changes nothing is answered at once, even while a push is pending.
    p.send({ t: 'cmd', id: 902, cmd: { c: 'merchantOffers' } });
    expect(p.conn.messages.slice(from).map((m) => m.t)).toEqual(['result']);
    p.session.flushCharacter();
    kinds = p.conn.messages.slice(from).map((m) => m.t);
    expect(kinds).toEqual(['result', 'character', 'result']);
    const pushed = p.conn.messages.slice(from).find((m): m is Extract<ServerMessage, { t: 'character' }> => m.t === 'character')!;
    expect(pushed.character.currencyStash[secondItem.currencyId]).toBe(expectedCount);
    expect(pushed.character.backpack.entries.some((e) => e.item.uid === second)).toBe(false);
    expect((p.conn.messages.at(-1) as Extract<ServerMessage, { t: 'result' }>).id).toBe(901);
  });
});

describe('contained failures', () => {
  it('a failed map join refunds the portal and sends the player home', async () => {
    const { server, clock, players } = await setup(['Unlucky Una']);
    const [p] = players;
    openMap(p);
    const map = server.game.instances.activeMapOf(p.characterId)!;
    map.join = () => {
      throw new Error('simulated join failure');
    };
    const from = p.mark();
    const home = p.session.instance!;
    const prop = p.view.props.find((pr) => pr.kind === 'portal' && pr.state > 0)!;
    for (let k = 0; k < 600 && p.all('toast', from).length === 0; k++) {
      p.input(p.steerInput(prop.x, prop.y));
      tick(server, clock);
    }
    expect(p.all('toast', from).some((t) => /could not be entered/.test(t.text))).toBe(true);
    expect(map.portalsRemaining).toBe(PORTALS_PER_MAP);
    expect(p.session.instance?.kind).toBe('hideout');
    expect(p.session.instance?.ownerId).toBe(p.characterId);
    expect(home.disposed || p.session.instance === home).toBe(true);
  });

  it('one failing outcome is logged and skipped; the rest of the tick still happens', async () => {
    const { server, clock, players } = await setup(['Sturdy Sue']);
    const [p] = players;
    const map = soloMap(p, clock);
    const game = server.game as unknown as { grantXp: (...args: unknown[]) => void };
    const original = game.grantXp;
    game.grantXp = () => {
      throw new Error('simulated rules failure');
    };
    const deaths = p.session.record.ch.stats.deaths;
    try {
      server.game.handleOutcomes(map, [{ t: 'xp', amount: 40 }, { t: 'playerDied', playerId: p.playerId }]);
    } finally {
      game.grantXp = original;
    }
    expect(p.session.record.ch.stats.deaths).toBe(deaths + 1);
    expect(map.disposed).toBe(false);
    expect(p.session.instance).toBe(map);
  });

  it("one viewer's snapshot failures never cost the others theirs; the viewer is moved home after a few", async () => {
    const { server, clock, players } = await setup(['Host Hana', 'Broken Bo']);
    const [hana, bo] = players;
    partyUp(hana, bo);
    expect(bo.command({ c: 'visitHideout', characterId: hana.characterId }).ok).toBe(true);
    const hideout = hana.session.instance!;
    expect(bo.session.instance).toBe(hideout);
    const encoder = (hideout as unknown as { encoder: { encode: (v: unknown, viewer: number, ack: number) => ArrayBuffer } }).encoder;
    const encode = encoder.encode.bind(encoder);
    const badId = bo.playerId;
    encoder.encode = (v, viewer, ack) => {
      if (viewer === badId) throw new Error('simulated encoder failure');
      return encode(v, viewer, ack);
    };
    const hanaSnaps = hana.conn.snapshotCount;
    const from = bo.mark();
    for (let k = 0; k < SNAPSHOT_EVERY * 4; k++) {
      hana.input();
      bo.input();
      tick(server, clock);
    }
    expect(hana.conn.snapshotCount - hanaSnaps).toBe(4);
    expect(hideout.disposed).toBe(false);
    expect(bo.session.instance!.ownerId).toBe(bo.characterId);
    expect(bo.all('toast', from).some((t) => /went wrong/.test(t.text))).toBe(true);
    // At home (a fresh instance) Bo's snapshots flow again.
    const boSnaps = bo.conn.snapshotCount;
    tick(server, clock, SNAPSHOT_EVERY * 2);
    expect(bo.conn.snapshotCount - boSnaps).toBe(2);
    expect(bo.conn.closedWith).toBeNull();
  });

  it('a crashed map sends its players home with a run summary, and does not count as a failed map', async () => {
    const { server, clock, players } = await setup(['Crash Cora']);
    const [p] = players;
    const map = soloMap(p, clock);
    for (let k = 0; k < 120; k++) {
      p.input();
      tick(server, clock);
    }
    map.run.step = () => {
      throw new Error('simulated sim failure');
    };
    const from = p.mark();
    tick(server, clock, 2);
    expect(map.disposed).toBe(true);
    const summary = p.all('runSummary', from)[0]?.summary;
    expect(summary).toMatchObject({ result: 'abandoned', tier: 1 });
    expect(summary!.seconds).toBeGreaterThanOrEqual(2);
    const stats = p.session.record.ch.stats;
    expect(stats.mapsFailed).toBe(0);
    expect(stats.playSeconds).toBeGreaterThanOrEqual(2);
  });
});

describe('sessions', () => {
  it('a socket whose login session expired or was revoked is closed (4001) at the next check', async () => {
    const { server, clock, players } = await setup(['Stale Login']);
    const [p] = players;
    server.db.deleteSession(p.tokenHash);
    clock.advance(59_000);
    server.game.maintenance();
    clock.advance(2_000);
    server.game.maintenance();
    expect(p.conn.closedWith?.code).toBe(4001);
  });

  it('a run that ends while the player is disconnected is summarised on their next login', async () => {
    const { server, clock, players } = await setup(['Drop Out'], { reconnectGraceMs: 5000 });
    const [p] = players;
    soloMap(p, clock);
    for (let k = 0; k < 90; k++) {
      p.input();
      tick(server, clock);
    }
    server.game.detach(p.conn);
    clock.advance(6000);
    server.game.maintenance();
    expect(server.game.sessions.has(p.characterId)).toBe(false);
    const again = new LocalPlayer(server, p.characterId);
    const kinds = again.conn.messages.map((m) => m.t);
    expect(kinds.slice(0, 3)).toEqual(['welcome', 'character', 'zone']);
    expect(again.last('runSummary')?.summary).toMatchObject({ result: 'abandoned', tier: 1 });
    // Delivered once.
    const third = new LocalPlayer(server, p.characterId);
    expect(third.all('runSummary')).toHaveLength(0);
  });

  it('a server shutdown keeps open maps for the restart (no refund) and ends the runs so far neutrally', async () => {
    const dbPath = join(dir, 'shutdown.db');
    const { clock, players } = await setup(['Restart Rae', 'Friend Fox'], { dbPath });
    const [rae, fox] = players;
    partyUp(rae, fox);
    const mapItem = rae.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    openMap(rae);
    expect(rae.session.record.ch.mapDevice).toBeNull();
    walkIntoProp(rae, 'portal', clock, [fox]);
    enterMapOf(fox, rae, clock, [rae]);
    await server!.close();
    server = null;

    const db = await GameDatabase.open(dbPath);
    try {
      const load = (id: string) => JSON.parse(db.characterById(id)!.data) as CharacterSave;
      const raeSaved = load(rae.characterId);
      const foxSaved = load(fox.characterId);
      // The map is not handed back: it is kept, with its portals, for the next start.
      expect(raeSaved.mapDevice).toBeNull();
      const rows = db.loadOpenMaps();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ownerId: rae.characterId, portalsRemaining: PORTALS_PER_MAP - 2, cleared: false });
      expect(JSON.parse(rows[0].setup).map.uid).toBe(mapItem.uid);
      expect(db.characterMap(fox.characterId)).toMatchObject({ mapId: rows[0].mapId, ownerId: rae.characterId });
      // Nobody's failure: the runs so far count, but not as failed maps.
      expect(raeSaved.stats.mapsFailed).toBe(0);
      expect(foxSaved.stats.mapsFailed).toBe(0);
      expect(raeSaved.stats.playSeconds).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe('loot entropy', () => {
  it('every loot roll draws from fresh server entropy, not the sim loot stream', async () => {
    const { server, clock, players } = await setup(['Lucky Lin']);
    const [p] = players;
    const map = soloMap(p, clock);
    let rolls = 0;
    let calls = 0;
    const lootRng = server.game.lootRng.bind(server.game);
    server.game.lootRng = (simRng) => {
      calls++;
      const rng = lootRng(simRng);
      if (rng !== simRng) rolls++;
      return rng;
    };
    const bot = createBot();
    for (let t = 0; t < 60 * 60 && calls < 5; t++) {
      p.intent(bot.intent(map.run.view, p.playerId));
      tick(server, clock);
    }
    // An entropy check must not depend on a random drop appearing within one minute.
    expect(calls).toBeGreaterThanOrEqual(5);
    expect(rolls).toBe(calls);
  }, 60_000);
});
