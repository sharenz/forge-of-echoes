// The tree/mod/scarab seam of the Event Director: encounter rules of the Atlas tree become slate and sim modifiers.
import { describe, expect, it } from 'vitest';
import type { AtlasRules } from '../../src/game/progression/atlas-rules';
import type { AtlasRule } from '../../src/data/progression/atlas-tree/types';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { ATLAS_BUILT_EVENTS } from '../../src/data/progression/map-tree';
import { ATLAS_EVENT_TO_KIND, dangerModCount, mapEventRules } from '../../src/game/progression/map-event-rules';
import { flattenMapEvents, mapEventOdds, rollMapEvent } from '../../src/game/progression/map-events';
import { pathTo, treeCharacter } from './atlas-tree-helpers';
import { bareCharacter, eventCtx, expectOk, map, setupFor, withBackpack } from './fixtures';

const atlas = (...list: AtlasRule[]): AtlasRules => ({ nodes: [], modifiers: [], capped: [], bossWave: 0, equipmentNormalOnly: false, currencyWeights: [],
  extraRules: list.map((rule, k) => ({ node: `n${k}`, rule })) });

describe('mapEventRules', () => {
  it('is neutral without encounter rules', () => {
    expect(mapEventRules(atlas())).toEqual({ slate: {}, sim: {} });
  });

  it('maps Twin Omens to a second-slot allowance and a 25% smaller payout', () => {
    const r = mapEventRules(atlas({ id: 'eventSlots', extra: 1, rewardMore: -25, backlash: true }));
    expect(r.slate.extraSlots).toBe(1);
    expect(r.sim.rewardMultiplier).toBeCloseTo(0.75);
  });

  it('maps Sworn to the Veil to certain, mandatory events with a soft timeout and 30% more reward', () => {
    const r = mapEventRules(atlas({ id: 'eventsAlways', rewardMore: 30, mandatory: true, timeoutSeconds: 90 }));
    expect(r.slate).toMatchObject({ chance: 1, mandatory: true });
    expect(r.sim).toMatchObject({ timeoutSeconds: 90, rewardMultiplier: 1.3 });
    // A certain event: the displayed odds sum to 1 and every map rolls one.
    const item = map('ashenForge', 5);
    expect(Object.values(mapEventOdds(item, undefined, [], r.slate)).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    for (let seed = 0; seed < 200; seed++) expect(rollMapEvent(item, seed, undefined, [], r.slate)).not.toBeNull();
  });

  it('maps the three event smalls', () => {
    const r = mapEventRules(atlas(
      { id: 'eventSmall', effect: 'ingredientChance', value: 0.1 }, { id: 'eventSmall', effect: 'timers', value: 0.1 },
      { id: 'eventSmall', effect: 'gradeEase', value: 0.05 },
    ));
    expect(r.sim).toEqual({ ingredientChance: 0.1, timerScale: 1.1, gradeEase: 0.05 });
  });

  it('gives each lens exactly the effect and price its text names, for every event', () => {
    const lens = (event: string) => mapEventRules(atlas({ id: 'eventLens', event, effect: '', danger: '' })).sim;
    expect(lens('stalker')).toEqual({ whiffMultiplier: 2, stalkerLife: 1.1 });
    expect(lens('echoing')).toEqual({ echoTolerance: 2, echoLife: 1.1 });
    expect(lens('caravan')).toEqual({ lockLife: 0.8, caravanSpeed: 1.1 });
    expect(lens('rivalCrowns')).toEqual({ rivalLife: 1.15, rivalUnique: 1.5 });
    expect(lens('fault')).toEqual({ faultMonsterDamage: 1.5, faultPreview: 1 });
    expect(lens('emberRelay')).toEqual({ relayWick: 1.3, relayBearers: 1 });
    expect(lens('pactAltar')).toEqual({ pactExtra: 1 });
    expect(lens('orchard')).toEqual({ bloomRipen: 1.25, bloomTarget: 1.2 });
    expect(lens('ring')).toEqual({ gradeEase: 0.15, championLife: 1.2 });
    expect(lens('host')).toEqual({ thawRate: 0.8, hostCount: 1.15 });
    expect(lens('anvil')).toEqual({ anvilBoons: 1, anvilCost: 1.2 });
    expect(lens('bellwatch')).toEqual({ tollScale: 1.15, cantorLife: 1.15 });
    // The director knows every lens the tree's gate lets through (the gate may trail the director: wave-2 events await it).
    for (const id of ATLAS_BUILT_EVENTS) expect(Object.keys(ATLAS_EVENT_TO_KIND), id).toContain(id);
    expect(Object.keys(ATLAS_EVENT_TO_KIND)).toHaveLength(12);
  });

  it('counts the map\'s danger mods as +1 to the trophy tally each (reward mods do not count)', () => {
    const item = map('ashenForge', 3, { mods: [{ modId: 'restless', value: 1 }, { modId: 'commanded', value: 1 }, { modId: 'bountiful', value: 1 }] });
    expect(dangerModCount(item)).toBe(2);
    expect(mapEventRules(atlas(), item).sim.tally).toBe(2);
    expect(mapEventRules(atlas(), map()).sim.tally).toBeUndefined();
  });

  it('a Twin Omens map can roll a third concurrent event', () => {
    const item = map('ashenForge', 6);
    const slate = mapEventRules(atlas({ id: 'eventSlots', extra: 1, rewardMore: -25, backlash: true })).slate;
    let most = 0;
    for (let seed = 0; seed < 3000; seed++) most = Math.max(most, flattenMapEvents(rollMapEvent(item, seed, undefined, [], slate)).length);
    expect(most).toBe(3);
  });

  it('a reward multiplier below one thins every payout but the first item', () => {
    const setup = setupFor(map('ashenForge', 3));
    let plain = 0, thin = 0;
    for (let seed = 0; seed < 300; seed++) {
      plain += rules.rollEventReward(setup, eventCtx('wound', 3), createRng(seed), bareCharacter()).length;
      thin += rules.rollEventReward(setup, eventCtx('wound', 3, { multiplier: 0.75 }), createRng(seed), bareCharacter()).length;
    }
    expect(thin).toBeLessThan(plain);
    expect(thin).toBeGreaterThan(plain * 0.6);
  });

  describe('allocated tree nodes reach the run the director plays', () => {
    const runOf = (nodes: string[], seed = 5) => {
      const setup = expectOk(rules.openMap(treeCharacter(nodes, { rngState: seed }, 6))).setup;
      return { setup, config: rules.buildRunConfig(setup, {} as never) };
    };

    it('lenses arrive as eventModifiers of the run config', () => {
      const { config } = runOf(pathTo('hunterPatience', 'crownRivalry', 'faultWalker'));
      expect(config.eventModifiers).toMatchObject({ whiffMultiplier: 2, stalkerLife: 1.1, rivalLife: 1.15, faultMonsterDamage: 1.5, faultPreview: 1 });
    });

    it('Twin Omens shrinks payouts by a quarter and widens the slate to three', () => {
      const { setup, config } = runOf(pathTo('twinOmens'));
      expect(config.eventModifiers?.rewardMultiplier).toBeCloseTo(0.75);
      let most = 0;
      for (let seed = 0; seed < 600; seed++) {
        const e = runOf(pathTo('twinOmens'), seed).setup.event;
        most = Math.max(most, flattenMapEvents(e).length);
      }
      expect(most).toBe(3);
      expect(setup.mapTree).toContain('twinOmens');
    });

    it('Sworn to the Veil makes every map roll a mandatory encounter with a soft timeout', () => {
      for (let seed = 1; seed <= 40; seed++) {
        const { setup, config } = runOf(pathTo('swornToTheVeil'), seed);
        expect(setup.event, `seed ${seed}`).not.toBeNull();
        expect(flattenMapEvents(setup.event).every(p => p.required)).toBe(true);
        expect(config.eventModifiers).toMatchObject({ timeoutSeconds: 90, rewardMultiplier: 1.3 });
      }
    });

    it('a lens of a built encounter reaches the director (the Pact Broker adds a fourth pact)', () => {
      const { config } = runOf(['strangeSigns', 'omenReader', 'pactBroker']);
      expect(config.eventModifiers).toMatchObject({ pactExtra: 1 });
    });
  });
});
