import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { rules, redactSetupForClient } from '../../src/game';
import { flattenMapEvents, mapEventOdds, mapEventSlots, normalizeMapEvent, rollMapEvent } from '../../src/game/progression/map-events';
import { MAP_EVENT_KINDS, type MapEventKind } from '../../src/contracts/map-events';
import { MAP_EVENT_BASE_CHANCE, MAP_EVENT_MAX_CHANCE, MAP_EVENT_MIN_TIER, MAP_EVENT_SECOND_CHANCE, MAP_EVENT_WINDOW } from '../../src/data/progression/map-events';
import { restoreRunSetup } from '../../src/game/progression/runs';
import { bareCharacter, eventCtx, expectOk, map, setupFor } from './fixtures';

const NO_ODDS = Object.fromEntries(MAP_EVENT_KINDS.map(k => [k, 0])) as Record<MapEventKind, number>;

const currencies = (items: readonly { kind: string; currencyId?: string; count?: number }[]) =>
  items.filter(i => i.kind === 'currency').map(i => i.currencyId);

describe('map event creation', () => {
  it('gates encounters by tier, reproduces displayed odds for the first event and persists hidden plans', () => {
    for (const tier of [1, 3, 5]) {
      const item = map('ashenForge', tier), odds = mapEventOdds(item);
      const seen: Record<string, number> = {};
      for (let seed = 0; seed < 5000; seed++) {
        const event = rollMapEvent(item, seed);
        if (!event) continue;
        expect(event.wave === 6).toBe(event.kind === 'secondCrown');
        expect(normalizeMapEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
        for (const plan of flattenMapEvents(event)) {
          expect(tier).toBeGreaterThanOrEqual(MAP_EVENT_MIN_TIER[plan.kind]);
          expect(plan.wave).toBeGreaterThanOrEqual(MAP_EVENT_WINDOW[plan.kind][0]);
          expect(plan.wave).toBeLessThanOrEqual(MAP_EVENT_WINDOW[plan.kind][1]);
        }
        seen[event.kind] = (seen[event.kind] ?? 0) + 1;
      }
      for (const kind of MAP_EVENT_KINDS) expect(Math.abs((seen[kind] ?? 0) / 5000 - odds[kind])).toBeLessThan(0.02);
    }
    expect(normalizeMapEvent({ kind: 'secondCrown', wave: 2, angle: 0 })).toBeNull();
    expect(normalizeMapEvent({ kind: 'wound', wave: 6, angle: 0 })).toBeNull();
    expect(normalizeMapEvent({ kind: 'wound', wave: 2, angle: 0 })).not.toBeNull(); // older saves stay valid
  });

  it('uses one hidden, deterministic roll with 45% base odds, independently of gear', () => {
    const item = map();
    expect(mapEventOdds(item)).toEqual({ ...NO_ODDS, hunted: MAP_EVENT_BASE_CHANCE });
    let count = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const event = rollMapEvent(item, seed);
      expect(event).toEqual(rollMapEvent(item, seed));
      if (event) { count++; expect(event.kind).toBe('hunted'); expect([2, 3, 4]).toContain(event.wave); }
    }
    expect(count / 2000).toBeGreaterThan(MAP_EVENT_BASE_CHANCE - 0.05); expect(count / 2000).toBeLessThan(MAP_EVENT_BASE_CHANCE + 0.05);
  });

  it('keeps the total capped at 65% and lets the tree and Omen scarabs move it', () => {
    const rich = map('ashenForge', 6, { mods: [{ modId: 'commanded', value: 1 }, { modId: 'echo', value: 1 }, { modId: 'teeming', value: 1 }] });
    const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(total(mapEventOdds(rich, 'ironMarch'))).toBeLessThanOrEqual(MAP_EVENT_MAX_CHANCE + 1e-9);
    expect(total(mapEventOdds(map('ashenForge', 3), undefined, [], { chance: 0.1 }))).toBeCloseTo(0.55);
    const plain = mapEventOdds(map('ashenForge', 3));
    const omen = mapEventOdds(map('ashenForge', 3), undefined, [], { kindWeight: { wound: 3 } });
    expect(omen.wound / total(omen)).toBeGreaterThan(plain.wound / total(plain));
  });

  it('area and map modifiers favour specific events without changing loot luck', () => {
    const item = map('ashenForge', 2, { mods: [{ modId: 'commanded', value: 1 }, { modId: 'echo', value: 1 }] });
    const odds = mapEventOdds(item, 'ironMarch');
    // Tier 2: The Stalker, The Echoing and the Ashseed Orchard are eligible (a third each).
    const raw = { hunted: MAP_EVENT_BASE_CHANCE / 3 + 0.10 + 0.08, echoRift: MAP_EVENT_BASE_CHANCE / 3 + 0.10, orchard: MAP_EVENT_BASE_CHANCE / 3 };
    const scale = MAP_EVENT_MAX_CHANCE / (raw.hunted + raw.echoRift + raw.orchard);
    expect(odds.hunted).toBeCloseTo(raw.hunted * scale); expect(odds.echoRift).toBeCloseTo(raw.echoRift * scale);
    expect(mapEventOdds(map('ashenForge', 2), 'boneApproach').echoRift).toBeCloseTo(MAP_EVENT_BASE_CHANCE / 3 + 0.10);
  });

  it('draws a second concurrent event about 30% of the time, in another wave, never the same kind', () => {
    const item = map('ashenForge', 5);
    let first = 0, second = 0;
    for (let seed = 0; seed < 6000; seed++) {
      const event = rollMapEvent(item, seed);
      if (!event) continue;
      first++;
      const plans = flattenMapEvents(event);
      expect(plans.length).toBeLessThanOrEqual(2);
      if (plans.length === 2) {
        second++;
        expect(plans[1].kind).not.toBe(plans[0].kind);
        expect(plans[1].wave).not.toBe(plans[0].wave);
        expect(event.also).toBe(plans[1]);
      }
    }
    expect(Math.abs(second / first - MAP_EVENT_SECOND_CHANCE)).toBeLessThan(0.05);
  });

  it('a third slot needs Twin Omens and the total never passes three', () => {
    expect(mapEventSlots()).toBe(2);
    expect(mapEventSlots({ extraSlots: 1 })).toBe(3);
    expect(mapEventSlots({ extraSlots: 5 })).toBe(3);
    const item = map('ashenForge', 6);
    let three = 0;
    for (let seed = 0; seed < 4000; seed++) {
      const n = flattenMapEvents(rollMapEvent(item, seed, undefined, [], { extraSlots: 1 })).length;
      expect(n).toBeLessThanOrEqual(3);
      if (n === 3) three++;
    }
    expect(three).toBeGreaterThan(0);
    for (let seed = 0; seed < 2000; seed++) expect(flattenMapEvents(rollMapEvent(item, seed)).length).toBeLessThanOrEqual(2);
  });

  it('persists the creation decision, redacts even zero-seed plans and leaves old maps alone', () => {
    const ch = bareCharacter({ mapDevice: map() });
    const setup = expectOk(rules.openMap(ch)).setup;
    const event = { kind: 'echoRift' as const, wave: 4, angle: 1.5, variant: 9, also: { kind: 'hunted' as const, wave: 2, angle: 0.5 } };
    const forced = { ...setup, event };
    expect(restoreRunSetup(JSON.stringify(forced), setup.seed)?.event).toEqual(event);
    expect(redactSetupForClient({ ...forced, seed: 0 })).not.toHaveProperty('event');
    expect(redactSetupForClient(forced)).not.toHaveProperty('event');
    const { event: _event, ...legacy } = setup;
    expect(restoreRunSetup(legacy, setup.seed)).not.toHaveProperty('event');
    expect(restoreRunSetup({ ...setup, event: { ...event, wave: 99 } }, setup.seed)?.event).toBeNull();
  });
});

describe('map event rewards (rollEventReward)', () => {
  const rare = (items: readonly { kind: string; rarity?: string }[]) => items.filter(i => i.kind === 'equipment' && i.rarity === 'rare').length;

  it('The Stalker: Bronze is one Rare base, Silver adds a currency, Gold two Rares (plus a Compass chance)', () => {
    const setup = setupFor(map());
    for (let seed = 0; seed < 30; seed++) {
      const bronze = rules.rollEventReward(setup, eventCtx('hunted'), createRng(seed), bareCharacter());
      expect(bronze).toHaveLength(1);
      expect(bronze[0]).toMatchObject({ kind: 'equipment', rarity: 'rare', itemLevel: 4 });
      const silver = rules.rollEventReward(setup, eventCtx('hunted', 2), createRng(seed), bareCharacter());
      expect(silver.slice(0, 1)).toEqual(bronze);
      expect(silver).toHaveLength(2);
      expect(silver[1].kind).toBe('currency');
      const gold = rules.rollEventReward(setup, eventCtx('hunted', 3), createRng(seed), bareCharacter());
      expect(rare(gold)).toBeGreaterThanOrEqual(2);
      expect(rules.rollEventReward(setup, eventCtx('hunted', 0), createRng(seed), bareCharacter())).toEqual([]);
    }
    let compass = 0;
    for (let seed = 0; seed < 400; seed++) compass += currencies(rules.rollEventReward(setup, eventCtx('hunted', 3), createRng(seed), bareCharacter())).includes('compass') ? 1 : 0;
    expect(Math.abs(compass / 400 - 0.25)).toBeLessThan(0.07);
  });

  it('The Echoing: Bronze is the classic Reforging Ember + Map Dust, Silver and Gold add Echo Shards, Gold a Rare', () => {
    const setup = setupFor(map('ashenForge', 3));
    for (let seed = 0; seed < 30; seed++) {
      const bronze = rules.rollEventReward(setup, eventCtx('echoRift'), createRng(seed), bareCharacter());
      expect(currencies(bronze)).toEqual(expect.arrayContaining(['reforge', 'mapDust']));
      const silver = rules.rollEventReward(setup, eventCtx('echoRift', 2), createRng(seed), bareCharacter());
      expect(currencies(silver).filter(c => c === 'echoShard').length).toBeGreaterThanOrEqual(1);
      const gold = rules.rollEventReward(setup, eventCtx('echoRift', 3), createRng(seed), bareCharacter());
      expect(currencies(gold).filter(c => c === 'echoShard').length).toBeGreaterThanOrEqual(2);
      expect(rare(gold)).toBe(1);
      expect(currencies(rules.rollEventReward(setup, eventCtx('echoRift', 0), createRng(seed), bareCharacter()))).toEqual(['mapDust']);
    }
  });

  it('gives the event materials only where specified, never below their tier gates', () => {
    for (const [kind, currencyId, tier, chance, ctx] of [
      ['vaultbreakers', 'twinInk', 3, 0.2, eventCtx('vaultbreakers', 1, { choice: 0 })],
      ['wound', 'voidSplinter', 3, 1, eventCtx('wound')], ['secondCrown', 'crownFragment', 5, 1, eventCtx('secondCrown')],
    ] as const) {
      const rng = createRng(946), setup = setupFor(map('ashenForge', tier)), low = setupFor(map('ashenForge', tier - 1));
      let found = 0;
      for (let i = 0; i < 800; i++) {
        found += rules.rollEventReward(setup, ctx, rng, bareCharacter()).filter(d => d.kind === 'currency' && d.currencyId === currencyId).length;
        if (i < 40) expect(rules.rollEventReward(low, ctx, rng, bareCharacter()).some(d => d.kind === 'currency' && d.currencyId === currencyId)).toBe(false);
      }
      expect(Math.abs(found / 800 - chance)).toBeLessThan(0.055);
    }
    const dark = rules.rollEventReward(setupFor(map('ashenForge', 3)), eventCtx('blackout'), createRng(9), bareCharacter());
    expect(dark).toEqual(expect.arrayContaining([expect.objectContaining({ currencyId: 'seal', count: 1 }),
      expect.objectContaining({ currencyId: 'scrap', count: expect.any(Number) })]));
  });

  it('Ember Relay: Silver adds a Suffix Rune chance (10%), Gold a Fracture Core chance (15%)', () => {
    const setup = setupFor(map('ashenForge', 3));
    let rune = 0, core = 0;
    for (let seed = 0; seed < 1500; seed++) {
      if (currencies(rules.rollEventReward(setup, eventCtx('blackout', 2), createRng(seed), bareCharacter())).includes('suffixRune')) rune++;
      if (currencies(rules.rollEventReward(setup, eventCtx('blackout', 3), createRng(seed), bareCharacter())).includes('fractureCore')) core++;
    }
    expect(Math.abs(rune / 1500 - 0.1)).toBeLessThan(0.03);
    expect(Math.abs(core / 1500 - 0.15)).toBeLessThan(0.035);
  });

  it('Laden Caravan: each lock its own prize; the all-locks bonus is Twin Ink (50%) and a Compass', () => {
    const setup = setupFor(map('ashenForge', 3));
    const coffer = rules.rollEventReward(setup, eventCtx('vaultbreakers', 1, { choice: 0 }), createRng(1), bareCharacter());
    expect(coffer.filter(i => i.kind === 'currency').length).toBeGreaterThanOrEqual(3);
    const chest = rules.rollEventReward(setup, eventCtx('vaultbreakers', 1, { choice: 1 }), createRng(1), bareCharacter());
    expect(chest).toHaveLength(1);
    expect(chest[0]).toMatchObject({ kind: 'equipment' });
    expect(['magic', 'rare', 'unique']).toContain((chest[0] as { rarity: string }).rarity);
    const tube = rules.rollEventReward(setup, eventCtx('vaultbreakers', 1, { choice: 2 }), createRng(1), bareCharacter());
    expect(tube).toHaveLength(1);
    expect(tube[0]).toMatchObject({ kind: 'map', tier: 4 });
    for (let seed = 0; seed < 20; seed++) expect(currencies(rules.rollEventReward(setup, eventCtx('vaultbreakers', 3, { choice: 3 }), createRng(seed), bareCharacter()))).toContain('compass');
  });

  it('The Fault: Silver adds a Solvent or Catalyst, Gold a second Void Splinter and a Rare; the Black Pit adds Twin Ink', () => {
    const setup = setupFor(map('ashenForge', 3));
    const bronze = currencies(rules.rollEventReward(setup, eventCtx('wound'), createRng(3), bareCharacter()));
    expect(bronze).toEqual(['voidSplinter']);
    const silver = currencies(rules.rollEventReward(setup, eventCtx('wound', 2), createRng(3), bareCharacter()));
    expect(silver[0]).toBe('voidSplinter'); expect(['solvent', 'catalyst']).toContain(silver[1]);
    const gold = rules.rollEventReward(setup, eventCtx('wound', 3), createRng(3), bareCharacter());
    expect(currencies(gold).filter(c => c === 'voidSplinter')).toHaveLength(2);
    expect(rare(gold)).toBe(1);
  });

  it('Rival Crowns: Bronze a Crown Fragment, Silver two, Gold adds a unique-eligible roll', () => {
    const setup = setupFor(map('ashenForge', 5));
    expect(currencies(rules.rollEventReward(setup, eventCtx('secondCrown'), createRng(1), bareCharacter()))).toEqual(['crownFragment']);
    expect(currencies(rules.rollEventReward(setup, eventCtx('secondCrown', 2), createRng(1), bareCharacter()))).toEqual(['crownFragment', 'crownFragment']);
    const gold = rules.rollEventReward(setup, eventCtx('secondCrown', 3), createRng(1), bareCharacter());
    expect(gold.some(i => i.kind === 'equipment')).toBe(true);
  });

  it('is deterministic per rng and honours the tree\'s ingredient bonus and reward multiplier', () => {
    const setup = setupFor(map('ashenForge', 3));
    const a = rules.rollEventReward(setup, eventCtx('echoRift', 2), createRng(77), bareCharacter());
    expect(rules.rollEventReward(setup, eventCtx('echoRift', 2), createRng(77), bareCharacter())).toEqual(a);
    let plain = 0, dusty = 0;
    for (let seed = 0; seed < 600; seed++) {
      plain += currencies(rules.rollEventReward(setup, eventCtx('blackout', 2), createRng(seed), bareCharacter())).includes('suffixRune') ? 1 : 0;
      dusty += currencies(rules.rollEventReward(setup, eventCtx('blackout', 2, { ingredientBonus: 0.3 }), createRng(seed), bareCharacter())).includes('suffixRune') ? 1 : 0;
    }
    expect(dusty).toBeGreaterThan(plain * 2);
    const more = rules.rollEventReward(setup, eventCtx('blackout', 1, { multiplier: 2 }), createRng(5), bareCharacter());
    expect(more.length).toBeGreaterThan(rules.rollEventReward(setup, eventCtx('blackout', 1), createRng(5), bareCharacter()).length - 1);
  });

  it('every event kind has a payout for every grade', () => {
    const setup = setupFor(map('ashenForge', 5));
    for (const kind of MAP_EVENT_KINDS as readonly MapEventKind[]) for (const grade of [0, 1, 2, 3] as const) {
      const items = rules.rollEventReward(setup, eventCtx(kind, grade), createRng(2), bareCharacter());
      if (grade >= 1 && kind !== 'vaultbreakers') expect(items.length, `${kind} grade ${grade}`).toBeGreaterThan(0);
    }
  });
});
