import { flat, inc, EV, S, K } from './dsl';
import type { AtlasNodeSpec, AtlasRule } from './types';

const lens = (event: string, effect: string, danger: string): { rules: AtlasRule[]; units: { reward: number; danger: number }; notes: string[]; engine: 'events' } => ({
  engine: 'events', rules: [{ id: 'eventLens', event, effect, danger }], units: { reward: 4.2, danger: 1.2 }, notes: [`${effect}.`, `Price: ${danger}.`],
});

/** Echoes: encounters. The twelve lens notables and both keystones wait for the Event Director (stream C). */
export const ECHOES: readonly AtlasNodeSpec[] = [
  S('strangeSigns', 'Strange Signs', 1, 0, 'origin', { effects: [flat('eventChance', 2)] }),
  S('omenReader', 'Omen Reader', 2, 0, 'strangeSigns', { effects: [flat('eventChance', 2)] }),
  S('echoDust', 'Echo Dust', 3, 0, 'omenReader', { engine: 'events', rules: [{ id: 'eventSmall', effect: 'ingredientChance', value: 10 }],
    units: { reward: 1, danger: 0 }, notes: ['10% increased chance of event ingredients.'] }),
  S('longFuse', 'Long Fuse', 4, 0, 'echoDust', { engine: 'events', rules: [{ id: 'eventSmall', effect: 'timers', value: 10 }],
    units: { reward: 1, danger: 0 }, notes: ['Event timers last 10% longer.'] }),
  S('quickStudy', 'Quick Study', 5, 0, 'longFuse', { engine: 'events', rules: [{ id: 'eventSmall', effect: 'gradeEase', value: 5 }],
    units: { reward: 1, danger: 0 }, notes: ['Bronze, Silver and Gold thresholds are 5% easier.'] }),
  S('veilwalker', 'Veilwalker', 6, 0, 'quickStudy', { effects: [inc('itemQuantity', 4, { event: true })] }),
  S('faintSignal', 'Faint Signal', 7, 0, 'veilwalker', { effects: [flat('eventChance', 2)] }),
  S('whisper', 'Whisper', 8, 0, 'faintSignal', { effects: [flat('eventChance', 2)] }),
  // spur A: lenses of the hunting, hauling and rival encounters
  EV('hunterPatience', "Hunter's Patience", 3, -1.4, 'omenReader', lens('stalker', 'Every whiffed pounce counts double for the Trophy grade', 'the Stalker has 10% more Life')),
  EV('resonantRift', 'Resonant Rift', 4, -1.4, 'hunterPatience', lens('echoing', 'The rift tolerates two more echoes reaching it', 'echoes have 10% more Life')),
  EV('quickFingers', 'Quick Fingers', 5, -1.4, 'resonantRift', lens('caravan', 'Locks have 20% less HP', 'the Caravan is 10% faster')),
  EV('crownRivalry', 'Crown Rivalry', 6, -1.4, 'quickFingers', lens('rivalCrowns', "The rival boss's exclusive unique roll has 50% higher chance", 'the rival has 15% more Life')),
  EV('faultWalker', 'Fault-Walker', 7, -1.4, 'crownRivalry', lens('fault', 'Eruptions deal 50% more damage to monsters', 'one fewer pulse of warning preview')),
  EV('keeperOfTheFlame', 'Keeper of the Flame', 8, -1.4, 'faultWalker', lens('emberRelay', "The Ember's wick lasts 30% longer", 'one extra Wickbearer')),
  // spur B: lenses of the choice and arena encounters
  EV('pactBroker', 'Pact Broker', 3, 1.4, 'omenReader', lens('pactAltar', 'One additional pact is offered (four)', 'the extra pact is always a hard one')),
  EV('greenThumb', 'Green Thumb', 4, 1.4, 'pactBroker', lens('orchard', 'Blooms ripen 25% faster', 'monsters target blooms 20% more')),
  EV('ringmaster', 'Ringmaster', 5, 1.4, 'greenThumb', lens('ring', 'Grade thresholds are 15% easier', 'the champion has 20% more Life')),
  EV('thawWarden', 'Thaw Warden', 6, 1.4, 'ringmaster', lens('host', 'The host thaws 20% slower', 'it contains 15% more monsters')),
  EV('anvilBlessing', 'Anvil Blessing', 7, 1.4, 'thawWarden', lens('anvil', 'The anvil offers one more boon', 'charging needs 20% more kills')),
  EV('bellringer', 'Bellringer', 8, 1.4, 'anvilBlessing', lens('bellwatch', 'Tolls come 15% slower, so Dirge stacks build more slowly', 'cantors have 15% more Life')),
  K('twinOmens', 'Twin Omens', 9.5, -1, ['keeperOfTheFlame', 'whisper'], {
    engine: 'events', excludes: ['swornToTheVeil'], rules: [{ id: 'eventSlots', extra: 1, rewardMore: -25, backlash: true }],
    units: { manual: true, reward: 12, danger: 6 },
    notes: ['Maps roll a second, independent encounter of a different kind in a different wave window.',
      'Encounter rewards are 25% smaller.'] }),
  K('swornToTheVeil', 'Sworn to the Veil', 9.5, 1, ['bellringer', 'whisper'], {
    engine: 'events', excludes: ['twinOmens'], rules: [{ id: 'eventsAlways', rewardMore: 30, mandatory: true, timeoutSeconds: 90 }],
    units: { manual: true, reward: 12, danger: 6 },
    notes: ['Every map has an encounter (100%) and its rewards are 30% higher.',
      'Every encounter becomes mandatory: the map cannot be completed until it resolves. A running encounter fails after a 90 second soft timeout, so it never locks a run.'] }),
];
