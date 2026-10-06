// The Orrery's rules (docs/power-rework/passive-tree.md 4, 5, 8): allocation, refunds, masteries, the resolver and its labels in the
// player model, Boss Marks and the save migration (old saves load with every point unspent).
import { describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import type { PassiveNodeId } from '../../src/contracts/passives';
import { ORRERY_CAPS, PASSIVE_NODES, PASSIVE_RESPEC, PASSIVE_START_ID, findPassiveNode } from '../../src/data/progression/passives';
import {
  allocatePassive, bossMarkKindFor, chooseMastery, masteryChangePrice, normalizePassives, passiveModifiers, passivePoints,
  passiveRefundPrice, refundPassive, resolvePassives, seedBossMarks,
} from '../../src/game/progression/passives';
import { creditBossMark } from '../../src/game/progression/character';
import { buildPlayerModel } from '../../src/game/progression/model';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { rules } from '../../src/game';
import { bareCharacter, expectErr, expectOk, exploredAtlas, map } from './fixtures';
import { pathToNode } from './passive-tree-harness';

const id = (s: string) => s as PassiveNodeId;
const scrap = (ch: CharacterSave, n: number): CharacterSave => ({ ...ch, currencyStash: { ...ch.currencyStash, scrap: n } });

/** Allocate every node on the way to `target` (and `target`). */
function allocateTo(ch: CharacterSave, target: string): CharacterSave {
  let next = ch;
  for (const n of pathToNode(target, new Set(next.passives ?? []))) next = expectOk(allocatePassive(next, id(n)));
  return next;
}

describe('points', () => {
  it('a level-17 character from before the Orrery has 16 points, all unspent', () => {
    const ch = bareCharacter({ level: 17 });
    expect(passivePoints(ch)).toEqual({ earned: 16, spent: 0, free: 16, bossMarks: 0, nextLevel: 18 });
    expect(rules.passivePoints(ch).free).toBe(16);
  });

  it('Boss Marks add one point each', () => {
    expect(passivePoints(bareCharacter({ level: 80, bossMarks: ['varkus', 'chainmaster'] })).earned).toBe(66);
  });
});

describe('allocation', () => {
  it('starts from Spark: a gate is allocatable, anything not linked is not', () => {
    const ch = bareCharacter({ level: 10 });
    const next = expectOk(allocatePassive(ch, id('pas.fire.gate')));
    expect(next.passives).toEqual(['pas.fire.gate']);
    expect(expectErr(allocatePassive(ch, id('pas.fire.kindle')))).toMatch(/Connect Kindle/);
    expect(expectErr(allocatePassive(ch, id(PASSIVE_START_ID)))).toMatch(/Spark is always lit/);
    expect(expectErr(allocatePassive(next, id('pas.fire.gate')))).toMatch(/already allocated/);
    expect(expectErr(allocatePassive(ch, id('pas.fire.nope')))).toMatch(/Choose a node/);
  });

  it('needs the points: a level-1 character has none, a keystone costs two', () => {
    expect(expectErr(allocatePassive(bareCharacter({ level: 1 }), id('pas.fire.gate')))).toMatch(/costs 1 passive point; you have 0/);
    // Perfect Tempo is three nodes from Spark: 1 + 1 + 2 points.
    let ch = bareCharacter({ level: 4 });
    for (const n of pathToNode('pas.hub.perfectTempo').slice(0, -1)) ch = expectOk(allocatePassive(ch, id(n)));
    expect(passivePoints(ch).free).toBe(1);
    expect(expectErr(allocatePassive(ch, id('pas.hub.perfectTempo')))).toMatch(/costs 2 passive points; you have 1/);
    ch = { ...ch, level: 5 };
    ch = expectOk(allocatePassive(ch, id('pas.hub.perfectTempo')));
    expect(passivePoints(ch)).toMatchObject({ spent: 4, free: 0 });
  });

  it('keeps the allocation in canonical order', () => {
    const ch = allocateTo(bareCharacter({ level: 30 }), 'pas.fire.kindle');
    const order = ch.passives!.map((n) => PASSIVE_NODES.findIndex((p) => p.id === n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('refuses the other side of a hard exclusion', () => {
    let ch = allocateTo(bareCharacter({ level: 50 }), 'pas.fire.pyreDoctrine');
    ch = allocateTo(ch, 'pas.cold.mastery');
    expect(expectErr(allocatePassive(ch, id('pas.cold.absoluteZero')))).toBe('Absolute Zero excludes Pyre Doctrine. Refund Pyre Doctrine first.');
    const tempo = allocateTo(bareCharacter({ level: 50 }), 'pas.hub.perfectTempo');
    const toGambler = pathToNode('pas.arcana.gamblersEdge', new Set(tempo.passives));
    expect(toGambler.at(-1)).toBe('pas.arcana.gamblersEdge');
    let g = tempo;
    for (const n of toGambler.slice(0, -1)) g = expectOk(allocatePassive(g, id(n)));
    expect(expectErr(allocatePassive(g, id('pas.arcana.gamblersEdge')))).toMatch(/excludes Perfect Tempo/);
  });
});

describe('refunds (5)', () => {
  it('leaf-first: a node with allocated dependants cannot be refunded', () => {
    const ch = allocateTo(bareCharacter({ level: 20 }), 'pas.fire.kindle');
    expect(expectErr(refundPassive(ch, id('pas.fire.gate')))).toBe('Refund the nodes beyond this one first.');
    const done = expectOk(refundPassive(ch, id('pas.fire.kindle')));
    expect(done.passives).not.toContain('pas.fire.kindle');
    expect(done.passiveRefunds).toBe(1);
    expect(expectErr(refundPassive(done, id('pas.fire.kindle')))).toBe('That node is not allocated.');
    expect(expectErr(refundPassive(done, id(PASSIVE_START_ID)))).toMatch(/Spark cannot be refunded/);
  });

  it('the first ten refunds are free, then small 5, notable 15, mastery 10, keystone 40 Scrap, paid atomically', () => {
    let ch = allocateTo(bareCharacter({ level: 50 }), 'pas.fire.pyreDoctrine');
    expect(passiveRefundPrice(ch, id('pas.fire.pyreDoctrine'))).toEqual({ scrap: 0, freeLeft: 10 });
    ch = { ...ch, passiveRefunds: 10 };
    expect(passiveRefundPrice(ch, id('pas.fire.pyreDoctrine')).scrap).toBe(PASSIVE_RESPEC.keystone);
    expect(passiveRefundPrice(ch, id('pas.fire.mastery')).scrap).toBe(PASSIVE_RESPEC.mastery);
    expect(passiveRefundPrice(ch, id('pas.fire.kindle')).scrap).toBe(PASSIVE_RESPEC.notable);
    expect(passiveRefundPrice(ch, id('pas.fire.s1')).scrap).toBe(PASSIVE_RESPEC.small);
    expect(passiveRefundPrice(ch, id('pas.fire.gate')).scrap).toBe(PASSIVE_RESPEC.notable);
    expect(expectErr(refundPassive(ch, id('pas.fire.pyreDoctrine')))).toBe('Refunding Pyre Doctrine costs 40 Forge Scrap.');
    const paid = expectOk(refundPassive(scrap(ch, 45), id('pas.fire.pyreDoctrine')));
    expect(currencyOnHand(paid, 'scrap')).toBe(5);
    expect(paid.passiveRespecSpent).toBe(40);
    expect(paid.passiveRefunds).toBe(11);
    expect(passivePoints(paid).free).toBe(passivePoints(ch).free + 2);
  });

  it('a respec session never costs more than 250 Scrap; opening a map starts a new session', () => {
    const ch = { ...allocateTo(bareCharacter({ level: 50 }), 'pas.fire.pyreDoctrine'), passiveRefunds: 10, passiveRespecSpent: 230 };
    expect(passiveRefundPrice(ch, id('pas.fire.pyreDoctrine')).scrap).toBe(20);
    expect(passiveRefundPrice({ ...ch, passiveRespecSpent: 250 }, id('pas.fire.pyreDoctrine')).scrap).toBe(0);
    const device = map('emberRoad', 1);
    const opened = expectOk(rules.openMap({ ...ch, mapDevice: device }));
    expect(opened.character.passiveRespecSpent).toBe(0);
    expect(opened.character.passiveRefunds).toBe(10);
  });
});

describe('masteries', () => {
  it('a mastery is allocated first, then a rider is chosen (free), and a change costs a refund', () => {
    let ch = allocateTo(bareCharacter({ level: 30 }), 'pas.arcana.mastery');
    expect(expectErr(chooseMastery(bareCharacter({ level: 30 }), id('pas.arcana.mastery'), 0))).toMatch(/Allocate Spell Attunement first/);
    expect(expectErr(chooseMastery(ch, id('pas.arcana.s1'), 0))).toMatch(/Choose a mastery/);
    expect(expectErr(chooseMastery(ch, id('pas.arcana.mastery'), 3))).toMatch(/one of the three/);
    expect(masteryChangePrice(ch, id('pas.arcana.mastery')).scrap).toBe(0);
    ch = expectOk(chooseMastery(ch, id('pas.arcana.mastery'), 0));
    expect(ch.masteries).toEqual({ 'pas.arcana.mastery': 0 });
    expect(ch.passiveRefunds ?? 0).toBe(0);
    expect(expectErr(chooseMastery(ch, id('pas.arcana.mastery'), 0))).toMatch(/already chosen/);
    const spent = { ...ch, passiveRefunds: 10 };
    expect(masteryChangePrice(spent, id('pas.arcana.mastery')).scrap).toBe(PASSIVE_RESPEC.masteryChange);
    expect(expectErr(chooseMastery(spent, id('pas.arcana.mastery'), 1))).toMatch(/costs 10 Forge Scrap/);
    const changed = expectOk(chooseMastery(scrap(spent, 10), id('pas.arcana.mastery'), 1));
    expect(changed.masteries).toEqual({ 'pas.arcana.mastery': 1 });
    expect(currencyOnHand(changed, 'scrap')).toBe(0);
    // Refunding the mastery drops its rider.
    const refunded = expectOk(refundPassive(ch, id('pas.arcana.mastery')));
    expect(refunded.masteries).toEqual({});
  });

  it("the chosen rider joins the model under the mastery's name", () => {
    const ch = expectOk(chooseMastery(allocateTo(bareCharacter({ level: 30 }), 'pas.arcana.mastery'), id('pas.arcana.mastery'), 0));
    const cast = buildPlayerModel(ch).of('castSpeed').find((m) => m.source === 'Orrery: Spell Attunement');
    expect(cast?.value).toBe(8);
  });
});

describe('resolver and the player model (1.3, 8)', () => {
  it('an empty tree adds nothing (Spark lights with the first node)', () => {
    expect(resolvePassives([]).mods).toEqual([]);
    expect(passiveModifiers(bareCharacter())).toEqual([]);
    const one = resolvePassives(['pas.fire.gate']);
    expect(one.nodes.map((n) => n.id)).toEqual([PASSIVE_START_ID, 'pas.fire.gate']);
    expect(one.mods).toEqual(expect.arrayContaining([
      { stat: 'int', mode: 'flat', value: 10, source: 'Orrery: Spark' },
      { stat: 'fireDamage', mode: 'increased', value: 14, source: 'Orrery: Gate of Embers' },
    ]));
  });

  it('labels every line "Orrery: <node>" in the sheet breakdown; smalls merge into one source', () => {
    const ch = allocateTo(bareCharacter({ level: 20 }), 'pas.fire.kindle');
    const derived = rules.deriveStats(ch);
    const fire = derived.breakdowns.fireDamage!;
    expect(fire.sources.map((s) => s.source)).toEqual(expect.arrayContaining(['Orrery: Kindle', 'Orrery: Gate of Embers', 'Orrery: small nodes']));
    expect(fire.sources.find((s) => s.source === 'Orrery: small nodes')!.value).toBe(12); // three rhythm smalls of +4%
    // Spark's attributes flow through the attribute resolution like gear.
    expect(derived.attributes.int).toBe(rules.deriveStats(bareCharacter({ level: 20 })).attributes.int + 10);
  });

  it('caps the tree: increased damage at +220%, `more` at ×2.0, resistances at +25 each, damage taken at ×0.75', () => {
    const all = resolvePassives(PASSIVE_NODES.map((n) => n.id));
    const capLine = (cid: string) => all.caps.find((c) => c.id === cid)!;
    expect(capLine('increasedDamage')).toMatchObject({ cap: ORRERY_CAPS.increasedDamage, capped: true });
    expect(capLine('moreDamage')).toMatchObject({ cap: 2, capped: true });
    expect(capLine('resistance:allRes').capped).toBe(true);
    const dt = resolvePassives([]); // no damage-taken node yet: the floor is still enforced by the resolver
    expect(dt.caps.find((c) => c.id === 'damageTakenFloor')).toBeUndefined();
    // Perfect Tempo raises the cast speed cap by its own 35%.
    const tempo = resolvePassives(pathToNode('pas.hub.perfectTempo'));
    expect(tempo.mods.filter((m) => m.stat === 'castSpeed').reduce((s, m) => s + m.value, 0)).toBe(35);
  });

  it('memoises per allocation array: the same array gives the same modifiers', () => {
    const ch = allocateTo(bareCharacter({ level: 20 }), 'pas.fire.kindle');
    expect(passiveModifiers(ch)).toBe(passiveModifiers({ ...ch }));
    const withMastery = { ...ch, masteries: { 'pas.fire.mastery': 0 } };
    expect(passiveModifiers(withMastery)).not.toBe(passiveModifiers(ch));
  });

  it('keystone prices reach the sheet: Glass Orrery costs 40% of maximum life', () => {
    const base = allocateTo(bareCharacter({ level: 50 }), 'pas.arcana.mastery');
    const glass = expectOk(allocatePassive(base, id('pas.arcana.glassOrrery')));
    expect(rules.deriveStats(glass).combat.maxLife).toBeLessThan(rules.deriveStats(base).combat.maxLife * 0.61);
  });
});

describe('Boss Marks (4)', () => {
  it('credits each final boss once per character; unknown bosses change nothing', () => {
    const ch = bareCharacter({ level: 30, bossMarks: [] });
    const one = creditBossMark(ch, 'varkus');
    expect(one.bossMarks).toEqual(['varkus']);
    expect(creditBossMark(one, 'varkus')).toBe(one);
    expect(creditBossMark(one, 'ashling')).toBe(one);
    expect(creditBossMark(one, null)).toBe(one);
    expect(passivePoints(creditBossMark(one, 'cinderMatriarch')).bossMarks).toBe(2);
  });

  it('the boss of an expedition is its area theme boss; boss-less areas give none', () => {
    const setup = { atlasAreaId: 'emberRoad', map: { baseId: 'ashenForge' } } as never;
    expect(bossMarkKindFor(setup)).toBe('cinderMatriarch');
    expect(bossMarkKindFor({ map: { baseId: 'ironColiseum' } } as never)).toBe('varkus');
  });

  it("migration: a character without bossMarks is credited its account's Atlas first kills once", () => {
    const legacy = bareCharacter({ level: 30, atlas: { ...exploredAtlas(), bossesSeen: ['varkus', 'hollowWarden', 'notABoss'] } });
    delete (legacy as Partial<CharacterSave>).bossMarks;
    const seeded = seedBossMarks(legacy);
    expect(seeded.bossMarks).toEqual(['hollowWarden', 'varkus']);
    expect(seedBossMarks(seeded)).toBe(seeded);
    // A new character starts with none and is never seeded from the account.
    const fresh = rules.createCharacter('Fresh', 9);
    expect(fresh.bossMarks).toEqual([]);
    expect(seedBossMarks({ ...fresh, atlas: legacy.atlas })).toEqual({ ...fresh, atlas: legacy.atlas });
  });
});

describe('save migration', () => {
  it('an old save loads: no Orrery fields, every point unspent, Boss Marks seeded from the Atlas it carries', () => {
    const old = bareCharacter({ level: 23, atlas: { ...exploredAtlas(), bossesSeen: ['varkus'] } });
    const save = rules.parseSave(JSON.stringify({ version: 3, characters: [old], lastCharacterId: old.id, settings: {} }));
    const ch = save.characters[0];
    expect(ch.passives).toBeUndefined();
    expect(ch.masteries).toBeUndefined();
    expect(ch.bossMarks).toEqual(['varkus']);
    expect(passivePoints(ch)).toMatchObject({ earned: 23, spent: 0, free: 23 });
    const noAtlas = rules.parseSave(JSON.stringify({ version: 3, characters: [{ ...old, atlas: undefined }], lastCharacterId: null, settings: {} }));
    expect(noAtlas.characters[0].bossMarks).toBeUndefined();
  });

  it('round-trips an allocation and drops what is not valid (unknown, disconnected, excluded, over budget, stray riders)', () => {
    let ch = allocateTo(bareCharacter({ level: 30, bossMarks: [] }), 'pas.fire.mastery');
    ch = expectOk(chooseMastery(ch, id('pas.fire.mastery'), 2));
    const back = rules.parseSave(rules.serializeSave({ version: 3, characters: [ch], lastCharacterId: ch.id, settings: rules.newSave().settings })).characters[0];
    expect(back.passives).toEqual(ch.passives);
    expect(back.masteries).toEqual({ 'pas.fire.mastery': 2 });
    const junk = { ...ch, passives: [...ch.passives!, 'pas.cold.kindle', 'pas.void.hollowPact', 'nope'], masteries: { 'pas.fire.mastery': 2, 'pas.cold.mastery': 1, 'pas.fire.kindle': 0 } };
    const cleaned = rules.parseSave(JSON.stringify({ version: 3, characters: [junk], lastCharacterId: null, settings: {} })).characters[0];
    expect(cleaned.passives).toEqual(ch.passives);
    expect(cleaned.masteries).toEqual({ 'pas.fire.mastery': 2 });
    // A level the points no longer cover keeps the canonical prefix that fits.
    expect(normalizePassives(ch.passives, 3)).toHaveLength(3);
    expect(normalizePassives(['pas.fire.pyreDoctrine'], 70)).toEqual([]);
  });
});

describe('the online rules', () => {
  it('a passive refund never pays with Scrap locked in a trade offer', async () => {
    const { withItemLocks } = await import('../../src/game');
    let ch = { ...allocateTo(bareCharacter({ level: 20 }), 'pas.fire.kindle'), passiveRefunds: 10 };
    ch = { ...ch, backpack: { ...ch.backpack, entries: [{ item: { kind: 'currency', uid: 'sc', currencyId: 'scrap', count: 20 }, x: 0, y: 0 }] } };
    const locked = withItemLocks(rules, () => new Set(['sc']));
    expect(locked.refundPassive(ch, id('pas.fire.kindle')).ok).toBe(false);
    expect(rules.refundPassive(ch, id('pas.fire.kindle')).ok).toBe(true);
    expect(findPassiveNode('pas.fire.kindle')!.kind).toBe('notable');
  });
});
