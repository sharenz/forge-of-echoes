// The server with the per-map-type rosters and player debuffs (GAME_SPEC §13–§14). Both are sim-internal; the
// server's part is that everything around them keeps flowing: a flask press still reaches the sim (which
// cleanses) and still spends the charge on the character, the player hears about their own debuffs, and kills,
// loot, run summaries and the character log work with the new monster kinds. In-process: fake connections,
// fixed ticks on a fake clock.
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_ROSTER } from '../../src/contracts/bestiary';
import type { MapItem } from '../../src/contracts/items';
import type { ServerMessage } from '../../src/contracts/net';
import type { SimEvent, SimOutcome } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { MapInstance } from '../../src/server/instance';
import { damageMonster, isHittable } from '../../src/sim/combat';
import { applyDebuff } from '../../src/sim/debuffs';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { worldOf } from '../../src/sim/run';
import { MFLAG } from '../../src/sim/stores';
import { createBot } from '../sim/bot';
import { LocalPlayer, createClock, createLocalCharacter, openMap, startTestServer, tick, walkIntoProp } from './helpers';
import type { Clock } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function pinnedEntropy(seed = 0xbe57a41): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

async function setup(name: string) {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now, entropy: pinnedEntropy() } });
  const p = new LocalPlayer(server, createLocalCharacter(server, name));
  return { server, clock, p };
}

function eventsOf(messages: readonly ServerMessage[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (const m of messages) if (m.t === 'events') out.push(...m.events);
  return out;
}

/** Buy a free Tier 1 map of `theme` from Rook, load it into the device, open it and walk in. */
function enterThemedMap(p: LocalPlayer, clock: Clock, theme: 'rimedOssuary' | 'ironColiseum'): MapInstance {
  expect(p.command({ c: 'buyOffer', offerId: `map-t1-${theme}` }).ok).toBe(true);
  const map = p.session.record.ch.backpack.entries.map((e) => e.item).find((i): i is MapItem => i.kind === 'map' && i.baseId === theme);
  if (!map) throw new Error(`no ${theme} map`);
  expect(p.command({ c: 'moveItem', uid: map.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
  const areaId = theme === 'rimedOssuary' ? 'boneApproach' : 'ironMarch';
  const ch = p.session.record.ch;
  p.server.game.setCharacter(p.session, { ...ch, atlas: { ...ch.atlas!, discovered: [...ch.atlas!.discovered, areaId] } });
  expect(p.command({ c: 'activateMapDevice', areaId }).ok).toBe(true);
  walkIntoProp(p, 'portal', clock);
  const inst = p.session.instance;
  if (!(inst instanceof MapInstance)) throw new Error('not in a map');
  return inst;
}

describe('player debuffs on the server', () => {
  it('a life flask still flows: the sim cleanses Burning and Bleeding, the charge is spent on the character, the player is told', async () => {
    const { server, clock, p } = await setup('Flask Fae');
    openMap(p);
    walkIntoProp(p, 'portal', clock);
    const map = p.session.instance!;
    expect(map.kind).toBe('map');
    // Test hook into the sim: set her alight and bleeding, as a Cinder Spitter lob and a Pit Hound bite would.
    const world = worldOf(map.run)!;
    const me = world.players.find((q) => q.id === p.playerId)!;
    const from = p.mark();
    expect(applyDebuff(world, me, 'burning', 40)).toBe(true);
    expect(applyDebuff(world, me, 'bleeding', 40)).toBe(true);
    p.input();
    tick(server, clock, 2);
    expect(p.me()!.debuffs.map((d) => d.id).sort()).toEqual(['bleeding', 'burning']);
    // Her own debuffs reach her client (class 0: never capped).
    const applied = eventsOf(p.all('events', from)).filter((e): e is Extract<SimEvent, { t: 'debuff' }> => e.t === 'debuff');
    expect(applied.map((e) => e.debuff).sort()).toEqual(['bleeding', 'burning']);
    expect(applied.every((e) => e.playerId === p.playerId)).toBe(true);

    const slot = p.session.record.ch.belt.findIndex((b) => b?.flaskId === 'lifeFlask' && b.count > 0);
    expect(slot).toBeGreaterThanOrEqual(0);
    const charges = p.session.record.ch.belt[slot]!.count;
    const pressed = p.mark();
    p.input({ flask: slot });
    tick(server, clock);
    for (let k = 0; k < 3; k++) {
      p.input();
      tick(server, clock);
    }
    // The sim cleansed both …
    expect(p.me()!.debuffs.filter((d) => d.id === 'burning' || d.id === 'bleeding')).toEqual([]);
    // … the server spent exactly one charge on the character and handed the new count back to the sim …
    expect(p.session.record.ch.belt[slot]!.count).toBe(charges - 1);
    expect(p.me()!.flasks[slot]!.count).toBe(charges - 1);
    // … and her client saw the flask and the cleanse.
    const after = eventsOf(p.all('events', pressed));
    expect(after).toContainEqual(expect.objectContaining({ t: 'flask', playerId: p.playerId, resource: 'life' }));
    expect(after).toContainEqual(expect.objectContaining({
      t: 'cleanse', playerId: p.playerId, debuffs: expect.arrayContaining(['burning', 'bleeding']),
    }));
    expect(p.last('character')!.character.belt[slot]!.count).toBe(charges - 1);
  });
});

describe('the new rosters on the server', () => {
  it.each(['rimedOssuary', 'ironColiseum'] as const)(
    '%s: its own monsters fight, die and drop loot; kills reach the run summary and the character log',
    async (theme) => {
      const { server, clock, p } = await setup(theme === 'rimedOssuary' ? 'Rime Delver' : 'Arena Delver');
      const map = enterThemedMap(p, clock, theme);
      expect(map.theme).toBe(theme);
      const roster = THEME_ROSTER[theme];
      const kinds = new Set<string>([...roster.family, roster.lieutenant, roster.boss]);
      // Watch the authoritative outcomes the Game handles for this map.
      const kills: Extract<SimOutcome, { t: 'kill' }>[] = [];
      const handle = server.game.handleOutcomes.bind(server.game);
      server.game.handleOutcomes = (inst, outcomes) => {
        if (inst === map) for (const o of outcomes) if (o.t === 'kill') kills.push(o);
        handle(inst, outcomes);
      };
      const from = p.mark();
      const bot = createBot();
      // Play through the lieutenant's wave (3) into wave 4.
      for (let t = 0; t < 60 * 150; t++) {
        if (p.session.instance !== map || map.isDead(p.session)) break;
        p.intent(bot.intent(map.run.view, p.playerId));
        tick(server, clock);
        if (map.run.view.run.wave >= 4) break;
      }
      // The map's own family came, fought and died — nothing from another roster — and every kill the sim
      // credited to the player is on their run. (A lieutenant kill is certain only in the cleared run below.)
      expect(kills.length).toBeGreaterThan(0);
      for (const k of kills) expect(kinds.has(k.kind), k.kind).toBe(true);
      expect(new Set(kills.filter((k) => roster.family.some((f) => f === k.kind)).map((k) => k.kind)).size).toBeGreaterThanOrEqual(3);
      for (const k of kills.filter((o) => o.isLieutenant)) expect(k.kind).toBe(roster.lieutenant);
      expect(kills.some((k) => k.isBoss)).toBe(false);
      const credited = kills.filter((k) => k.playerId === p.playerId).length;
      expect(map.participant(p.session).kills).toBe(credited);
      const events = eventsOf(p.all('events', from));
      const died = events.filter((e): e is Extract<SimEvent, { t: 'death' }> => e.t === 'death').map((e) => e.kind);
      expect(died.length).toBeGreaterThan(0);
      for (const kind of died) expect(kinds.has(kind), kind).toBe(true);
      // The wave-3 tell announced the lieutenant (run-wide cue, always delivered).
      expect(events).toContainEqual(expect.objectContaining({ t: 'waveTell', wave: 3, lieutenant: true }));
      // Snapshots with the new kinds decode for the viewer.
      expect(p.decodeLast()).not.toBeNull();

      // The lieutenant and the boss roll loot like any other: instanced, owned by the looter, labelled.
      for (const kind of [roster.lieutenant, roster.boss]) {
        const specs = map.run.config.hooks.rollKillLoot(
          { kind, summoned: false, rarity: 'rare', isLieutenant: kind === roster.lieutenant, isBoss: kind === roster.boss, wave: 6, x: 0, y: 0 },
          [p.playerId], createRng(99),
        );
        expect(specs.length, kind).toBeGreaterThan(0);
        for (const s of specs) {
          expect(s.owner).toBe(p.playerId);
          expect(s.label).toBeTruthy();
        }
      }

      // Out of the map: the summary counts her kills; closing the map logs them on the character.
      const credit = map.participant(p.session).kills;
      const dead = map.isDead(p.session);
      const statsBefore = p.session.record.ch.stats.kills;
      const left = p.mark();
      expect(p.command(dead ? { c: 'respawn' } : { c: 'leaveMap' }).ok).toBe(true);
      const summary = p.all('runSummary', left).at(-1)?.summary;
      expect(summary).toMatchObject({ result: dead ? 'failed' : 'abandoned', mapName: map.mapName, tier: map.tier, kills: credit });
      server.game.closeMap(map, 'idle');
      expect(p.session.record.ch.stats.kills).toBe(statsBefore + credit);
    },
    60_000,
  );

  it.each(['rimedOssuary', 'ironColiseum'] as const)(
    '%s: its boss falls — the map clears, the chest opens, the summary says cleared and the character counts it',
    async (theme) => {
      const { server, clock, p } = await setup(theme === 'rimedOssuary' ? 'Warden Bane' : 'Varkus Bane');
      const map = enterThemedMap(p, clock, theme);
      const roster = THEME_ROSTER[theme];
      const kills: Extract<SimOutcome, { t: 'kill' }>[] = [];
      const handle = server.game.handleOutcomes.bind(server.game);
      server.game.handleOutcomes = (inst, outcomes) => {
        if (inst === map) for (const o of outcomes) if (o.t === 'kill') kills.push(o);
        handle(inst, outcomes);
      };
      const statsBefore = { ...p.session.record.ch.stats };
      const from = p.mark();
      // Test hooks into the sim, so the whole run fits a unit test: she cannot die, and once a second every
      // monster that has finished arriving takes a killing hit credited to her (through the sim's own damage
      // path — the kill outcome, loot and wave bookkeeping are the real ones). The waves then run on their own
      // clock; the boss is let live for three seconds of its fight before it falls the same way.
      const world = worldOf(map.run)!;
      const me = world.players.find((q) => q.id === p.playerId)!;
      const bot = createBot();
      let bossSince = -1;
      for (let t = 0; t < 60 * 60 * 12 && !map.cleared; t++) {
        me.life = me.stats.maxLife;
        p.intent(bot.intent(map.run.view, p.playerId));
        tick(server, clock);
        const m = world.monsters;
        const bossSlot = world.director.bossId >= 0 ? m.slotOf(world.director.bossId) : -1;
        if (bossSlot >= 0 && bossSince < 0) bossSince = t;
        if (t % 60 !== 0) continue;
        for (let i = 0; i < m.hwm; i++) {
          if (!isHittable(world, i)) continue;
          if ((m.flags[i] & MFLAG.boss) !== 0 && t - bossSince < 180) continue;
          damageMonster(world, i, 1e9, DAMAGE_INDEX.physical, 0, 1, 0, 0, 0, 0, true, p.playerId);
        }
      }
      expect(map.cleared).toBe(true);
      expect(map.isDead(p.session)).toBe(false);
      // The clear's cues ride the next snapshot packet (one per two ticks).
      for (let t = 0; t < 4; t++) {
        p.input();
        tick(server, clock);
      }

      // The roster's own lieutenant and boss fell to her, and nothing from another roster came.
      const kinds = new Set<string>([...roster.family, roster.lieutenant, roster.boss]);
      for (const k of kills) expect(kinds.has(k.kind), k.kind).toBe(true);
      expect(kills.filter((k) => k.isLieutenant)).toEqual([expect.objectContaining({ kind: roster.lieutenant, playerId: p.playerId })]);
      expect(kills.filter((k) => k.isBoss)).toEqual([expect.objectContaining({ kind: roster.boss, playerId: p.playerId })]);
      const events = eventsOf(p.all('events', from));
      expect(events).toContainEqual(expect.objectContaining({ t: 'bossSpawn' }));
      expect(events).toContainEqual(expect.objectContaining({ t: 'death', kind: roster.boss }));
      expect(events).toContainEqual(expect.objectContaining({ t: 'cleared' }));

      // She walks to the completion chest and opens it: the cue reaches her and its loot drops for her.
      const chest = map.run.view.props.find((pr) => pr.kind === 'chest');
      if (!chest) throw new Error('no completion chest');
      const opening = p.mark();
      for (let t = 0; t < 60 * 20 && !eventsOf(p.all('events', opening)).some((e) => e.t === 'chestOpen'); t++) {
        p.input(p.steerInput(chest.x, chest.y));
        tick(server, clock);
      }
      const opened = eventsOf(p.all('events', opening));
      expect(opened).toContainEqual(expect.objectContaining({ t: 'chestOpen' }));
      // Nothing is killed for loot after the clear (the rest crumbles uncredited): these drops are the chest's.
      expect(opened).toContainEqual(expect.objectContaining({ t: 'dropSpawn', owner: p.playerId }));

      // Out of the map: a cleared summary with her kills, and the character counts the completed map.
      const credit = map.participant(p.session).kills;
      expect(credit).toBe(kills.filter((k) => k.playerId === p.playerId).length);
      const left = p.mark();
      expect(p.command({ c: 'leaveMap' }).ok).toBe(true);
      expect(p.all('runSummary', left).at(-1)?.summary).toMatchObject({ result: 'cleared', mapName: map.mapName, tier: map.tier, kills: credit });
      const stats = p.session.record.ch.stats;
      expect(stats.mapsCompleted).toBe(statsBefore.mapsCompleted + 1);
      expect(stats.mapsFailed).toBe(statsBefore.mapsFailed);
      expect(stats.kills).toBe(statsBefore.kills + credit);
    },
    60_000,
  );
});
