// The Orrery on the server (docs/power-rework/passive-tree.md 4 and 5): allocatePassive anywhere, refundPassive and mastery changes
// in a hideout at the quoted Scrap price and atomically, Boss Marks credited on the boss-defeated outcome, and the one-time Boss Mark
// migration of characters from before the Orrery. Every command is validated by the rules on the server.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import type { PassiveNodeId } from '../../src/contracts/passives';
import { MapInstance } from '../../src/server/instance';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { passivePoints } from '../../src/game/progression/passives';
import { pathToNode } from '../game-progression/passive-tree-harness';
import { createClock, createLocalCharacter, LocalPlayer, openMap, savedCharacter, startTestServer, walkIntoProp } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-passives-'));
let server: Awaited<ReturnType<typeof startTestServer>>;
afterEach(async () => { vi.restoreAllMocks(); await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const id = (s: string) => s as PassiveNodeId;

it('allocates anywhere, refunds and changes masteries only in a hideout, at the quoted price, atomically, and survives a restart', async () => {
  const path = join(dir, 'orrery.db'), clock = createClock();
  const options = { dbPath: path, game: { autoTick: false, now: clock.now } };
  server = await startTestServer(options);
  const aId = createLocalCharacter(server, 'Orrery Owner');
  let a = new LocalPlayer(server, aId);
  server.game.setCharacter(a.session, { ...a.session.record.ch, level: 30, currencyStash: { scrap: 100 } });

  // Validated by the rules: unknown or unlinked nodes are refused (the wire rejects ids that are not passive nodes at all).
  expect(a.command({ c: 'allocatePassive', nodeId: id('pas.fire.kindle') }).error).toMatch(/Connect Kindle/);
  const route = pathToNode('pas.arcana.mastery');
  for (const n of route) expect(a.command({ c: 'allocatePassive', nodeId: id(n) }).ok).toBe(true);
  expect(a.session.record.ch.passives).toHaveLength(route.length);
  expect(a.command({ c: 'chooseMastery', nodeId: id('pas.arcana.mastery'), choice: 0, expectedScrap: 0 }).ok).toBe(true);
  expect(a.session.record.ch.masteries).toEqual({ 'pas.arcana.mastery': 0 });

  // In a map: points can be spent and a first rider chosen, but nothing is refunded or changed.
  openMap(a);
  walkIntoProp(a, 'portal', clock);
  expect(a.session.instance).toBeInstanceOf(MapInstance);
  expect(a.command({ c: 'allocatePassive', nodeId: id('pas.fire.gate') }).ok).toBe(true);
  expect(a.command({ c: 'refundPassive', nodeId: id('pas.fire.gate'), expectedScrap: 0 }).error).toMatch(/in a hideout/);
  expect(a.command({ c: 'chooseMastery', nodeId: id('pas.arcana.mastery'), choice: 1, expectedScrap: 0 }).error).toMatch(/in a hideout/);
  expect(a.command({ c: 'leaveMap' }).ok).toBe(true);
  expect(a.session.instance?.kind).toBe('hideout');

  // The price is what the client was shown: the first ten refunds are free, then a notable costs 15.
  server.game.setCharacter(a.session, { ...a.session.record.ch, passiveRefunds: 10 });
  const start = currencyOnHand(a.session.record.ch, 'scrap');
  expect(a.command({ c: 'refundPassive', nodeId: id('pas.fire.gate'), expectedScrap: 0 }).error).toMatch(/costs 15 Forge Scrap now/);
  // A failed write refunds and charges nothing.
  vi.spyOn(server.db, 'saveCharacter').mockImplementationOnce(() => { throw new Error('disk busy'); });
  expect(a.command({ c: 'refundPassive', nodeId: id('pas.fire.gate'), expectedScrap: 15 }).ok).toBe(false);
  expect(a.session.record.ch.passives).toContain('pas.fire.gate');
  expect(currencyOnHand(a.session.record.ch, 'scrap')).toBe(start);
  const done = a.command({ c: 'refundPassive', nodeId: id('pas.fire.gate'), expectedScrap: 15 });
  expect(done).toMatchObject({ ok: true, message: 'Refunded for 15 Forge Scrap.' });
  expect(currencyOnHand(a.session.record.ch, 'scrap')).toBe(start - 15);
  expect(a.session.record.ch.passives).not.toContain('pas.fire.gate');
  // A mastery change in the hideout is a refund too.
  expect(a.command({ c: 'chooseMastery', nodeId: id('pas.arcana.mastery'), choice: 2, expectedScrap: 10 }).ok).toBe(true);
  expect(currencyOnHand(a.session.record.ch, 'scrap')).toBe(start - 25);
  // Leaf first.
  expect(a.command({ c: 'refundPassive', nodeId: id(route[0]), expectedScrap: 15 }).error).toBe('Refund the nodes beyond this one first.');

  const saved = savedCharacter(server, aId);
  expect(saved.passives).toEqual(a.session.record.ch.passives);
  expect(saved.masteries).toEqual({ 'pas.arcana.mastery': 2 });
  await server.close();
  server = await startTestServer(options);
  a = new LocalPlayer(server, aId);
  expect(a.session.record.ch.passives).toEqual(route);
  expect(a.session.record.ch.masteries).toEqual({ 'pas.arcana.mastery': 2 });
  expect(a.session.record.ch.passiveRefunds).toBe(12);
  expect(passivePoints(a.session.record.ch).free).toBe(29 - route.length);
}, 60_000);

it('credits a Boss Mark to every character present when the final boss falls, once, and seeds old characters from the Atlas', async () => {
  const path = join(dir, 'marks.db'), clock = createClock();
  const options = { dbPath: path, game: { autoTick: false, now: clock.now } };
  server = await startTestServer(options);
  const aId = createLocalCharacter(server, 'Mark Owner');
  let a = new LocalPlayer(server, aId);
  expect(a.session.record.ch.bossMarks).toEqual([]);
  openMap(a);
  walkIntoProp(a, 'portal', clock);
  const inst = a.session.instance as MapInstance;
  const boss = inst.setup.map.baseId === 'ashenForge' ? 'cinderMatriarch' : undefined;
  const handle = (server.game as unknown as { handleOutcome(i: MapInstance, o: { t: 'bossDefeated' }): void }).handleOutcome.bind(server.game);
  handle(inst, { t: 'bossDefeated' });
  const marks = a.session.record.ch.bossMarks!;
  expect(marks).toHaveLength(1);
  if (boss) expect(marks).toEqual([boss]);
  expect(a.all('toast').some((t) => /Boss Mark earned/.test(t.text))).toBe(true);
  handle(inst, { t: 'bossDefeated' });
  expect(a.session.record.ch.bossMarks).toEqual(marks);
  expect(savedCharacter(server, aId).bossMarks).toEqual(marks); // written at once

  // A character saved before the Orrery has no bossMarks: on load it is credited the account's Atlas first kills, once.
  const legacyId = createLocalCharacter(server, 'Old Timer');
  let old = new LocalPlayer(server, legacyId);
  const { bossMarks: _drop, ...rest } = old.session.record.ch;
  server.game.setCharacter(old.session, { ...rest, atlas: { ...rest.atlas!, bossesSeen: ['varkus', 'hollowWarden'] } });
  server.game.flushSave(old.session);
  expect(savedCharacter(server, legacyId).bossMarks).toBeUndefined();
  await server.close();
  server = await startTestServer(options);
  old = new LocalPlayer(server, legacyId);
  expect(old.session.record.ch.bossMarks).toEqual(['hollowWarden', 'varkus']);
  expect(savedCharacter(server, legacyId).bossMarks).toEqual(['hollowWarden', 'varkus']);
  expect(passivePoints(old.session.record.ch).bossMarks).toBe(2);
  a = new LocalPlayer(server, aId);
  expect(a.session.record.ch.bossMarks).toEqual(marks); // already migrated: never re-derived
}, 60_000);
