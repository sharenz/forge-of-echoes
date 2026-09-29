// Performance smoke test: a full party of 4 bot players (level 18, points spent sensibly) in a real map
// instance on the real server logic. Fast-forward to wave 5, then measure the full server tick — intents,
// sim step, outcomes (XP, loot rolls, pickups), per-viewer event filtering and 4 snapshot encodes every
// other tick — which must average under 6 ms.
import { afterAll, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { MapInstance } from '../../src/server/instance';
import { EVENTS_COMPRESS_MIN_CHARS } from '../../src/server/session';
import { spendPoints } from '../game-progression/playthrough';
import { createBot } from '../sim/bot';
import { LocalPlayer, createClock, createLocalCharacter, startTestServer, tick, walkIntoProp } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | null = null;
afterAll(async () => {
  await server?.close();
});

function levelTo(ch: CharacterSave, level: number): CharacterSave {
  let next = ch;
  while (next.level < level) next = rules.grantXp(next, rules.xpToNext(next.level)).character;
  return spendPoints(next);
}

describe('server performance', () => {
  it('4 bot players in a map at wave 5: average server tick (sim + outcomes + events + 4 snapshots) < 6 ms', async () => {
    const clock = createClock();
    server = await startTestServer({ game: { autoTick: false, now: clock.now } });
    const names = ['Perf Ashe', 'Perf Brand', 'Perf Cinder', 'Perf Dusk'];
    const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
    for (const p of players) server.game.setCharacter(p.session, levelTo(p.session.record.ch, 18));
    const [owner, ...rest] = players;
    for (const p of rest) {
      expect(owner.command({ c: 'partyInvite', name: p.session.name }).ok).toBe(true);
      expect(p.command({ c: 'partyRespond', inviteId: p.last('invite')!.invite.inviteId, accept: true }).ok).toBe(true);
    }
    const mapUid = owner.session.record.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item.uid;
    expect(owner.command({ c: 'moveItem', uid: mapUid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(owner.command({ c: 'activateMapDevice' }).ok).toBe(true);
    walkIntoProp(owner, 'portal', clock, rest);
    for (const p of rest) {
      expect(p.command({ c: 'visitHideout', characterId: owner.characterId }).ok).toBe(true);
      walkIntoProp(p, 'portal', clock, players.filter((q) => q !== p));
    }
    const map = owner.session.instance;
    if (!(map instanceof MapInstance)) throw new Error('not in a map');
    expect(map.playerCount).toBe(4);

    const bots = players.map(() => createBot());
    const step = () => {
      for (let k = 0; k < players.length; k++) {
        const p = players[k];
        if (p.session.instance === map) p.intent(bots[k].intent(map.run.view, p.playerId));
      }
      tick(server!, clock);
    };

    // Fast-forward to wave 5 (bots fight for real; waves also advance on their 60 s timer).
    let guard = 0;
    while (map.run.view.run.wave < 5 && !map.disposed && guard++ < 60 * 60 * 8) step();
    expect(map.run.view.run.wave).toBeGreaterThanOrEqual(5);

    // Measure 10 s of play from here.
    map.stats.ticks = 0;
    map.stats.totalMs = 0;
    map.stats.maxMs = 0;
    const bytes0 = players.map((p) => p.conn.bytes);
    const snaps0 = players.map((p) => p.conn.snapshotCount);
    const msgs0 = players.map((p) => p.conn.messages.length);
    const compressed0 = players.map((p) => p.conn.compressed);
    let peakMonsters = 0;
    for (let t = 0; t < 600 && !map.disposed; t++) {
      step();
      peakMonsters = Math.max(peakMonsters, map.run.view.monsters.count);
    }
    const avg = map.stats.totalMs / Math.max(1, map.stats.ticks);
    // 'events' frames: the small, frequent ones go out uncompressed (no zlib wait in front of snapshots).
    const eventSizes = players.flatMap((p, k) =>
      p.conn.messages.slice(msgs0[k]).filter((m) => m.t === 'events').map((m) => JSON.stringify(m).length),
    ).sort((x, y) => x - y);
    const compressedFrames = players.reduce((n, p, k) => n + p.conn.compressed - compressed0[k], 0);
    const pct = (q: number) => eventSizes[Math.min(eventSizes.length - 1, Math.floor(q * eventSizes.length))] ?? 0;
    const kbPerSecond = players.map((p, k) => (p.conn.bytes - bytes0[k]) / 1024 / 10);
    const snapshots = players.map((p, k) => p.conn.snapshotCount - snaps0[k]);
    console.log(
      `[server perf] wave ${map.run.view.run.wave}, ${map.stats.ticks} ticks, avg ${avg.toFixed(3)} ms, max ${map.stats.maxMs.toFixed(2)} ms, ` +
        `peak monsters ${peakMonsters}, per-client ${kbPerSecond.map((v) => v.toFixed(1)).join('/')} KB/s, snapshots ${snapshots.join('/')}, ` +
        `events frames ${eventSizes.length} (median ${pct(0.5)}, p99 ${pct(0.99)}, max ${eventSizes.at(-1) ?? 0} chars), compressed text frames ${compressedFrames}`,
    );
    // Almost every events frame skips compression; only rare bursts (loot fountains) are deflated.
    expect(eventSizes.length).toBeGreaterThan(0);
    expect(pct(0.9)).toBeLessThan(EVENTS_COMPRESS_MIN_CHARS);
    expect(map.stats.ticks).toBeGreaterThan(500);
    expect(avg).toBeLessThan(6);
    for (const n of snapshots) expect(n).toBeGreaterThan(250);
  }, 180_000);
});
