// PACT ALTAR (event id 'pactAltar'): data. docs/atlas-rework/C-map-events.md 7.2, GAME_SPEC map events.
// Three stones offer a bargain for the NEXT wave (two bold pacts and Ember Tax, the safe decline); two rounds: the pact chosen
// during wave n shapes wave n+1, the second round opens when n+1 starts and shapes n+2. Bold pacts raise the wave's danger and
// its drops; the second round is harder when the first was bold.
import type { MapEventText } from '../map-events';
import type { PactId, WavePact } from '../../../contracts/map-events';

export const PACT_NAME = 'Pact Altar';
export const PACT_MIN_TIER = 4;
export const PACT_WINDOW: readonly [number, number] = [2, 4];
export const PACT_COLOR: readonly [number, number, number] = [0.72, 0.85, 0.35];

/** The altar keeps clear of the party and the rim. */
export const PACT_CLEARANCE = 250;
export const PACT_RIM = 170;
export const PACT_STONE_RADIUS = 26;
export const PACT_STONE_RING = 92;
/** Seconds on a stone that choose it. */
export const PACT_DWELL = 1;
/** Round two's pact is this much stronger (its deltas over 1) when round one was bold. */
export const PACT_ESCALATION = 1.35;
/** Ember Tax pays this much Scrap at the choice (a consolation, never a pact). */
export const PACT_TAX_SCRAP = 5;
/** EventRewardContext.choice of the Ember Tax consolation payout (the final payout uses choice 0). */
export const PACT_CHOICE_TAX = 10;
/** The pacts a bold stone may offer, and the order the Pact Broker's extra stone prefers (always a hard one). */
export const PACT_BOLD: readonly PactId[] = ['swarm', 'bloodMoon', 'ironhide', 'ambush', 'cinderCurse'];
export const PACT_HARD_ORDER: readonly PactId[] = ['ironhide', 'swarm', 'ambush', 'cinderCurse', 'bloodMoon'];

/** Base strength of each pact (see WavePact). Quantity and rarity are percent; resist is percentage points of every resistance. */
export const PACT_DEFS: Record<PactId, Omit<WavePact, 'wave'>> = {
  swarm: { id: 'swarm', monsters: 1.7, magic: false, life: 1, ambush: false, quantity: 60, rarity: 0, resist: 0 },
  bloodMoon: { id: 'bloodMoon', monsters: 1.15, magic: true, life: 1.25, ambush: false, quantity: 70, rarity: 0, resist: 0 },
  ironhide: { id: 'ironhide', monsters: 1, magic: false, life: 2.2, ambush: false, quantity: 0, rarity: 50, resist: 0 },
  ambush: { id: 'ambush', monsters: 1.25, magic: false, life: 1.2, ambush: true, quantity: 40, rarity: 0, resist: 0 },
  cinderCurse: { id: 'cinderCurse', monsters: 1.2, magic: false, life: 1.2, ambush: false, quantity: 0, rarity: 35, resist: 20 },
  emberTax: { id: 'emberTax', monsters: 1, magic: false, life: 1, ambush: false, quantity: 0, rarity: 0, resist: 0 },
};

/** Stone labels (the ground art writes them under the stones). */
export const PACT_NAMES: Record<PactId, string> = {
  swarm: 'Swarm', bloodMoon: 'Blood Moon', ironhide: 'Ironhide', ambush: 'Ambush', cinderCurse: 'Cinder Curse', emberTax: 'Ember Tax',
};
/** What a stone of each skin is called in the painter. */
export const PACT_STONE_SKINS = { ashen: 'anvil', ossuary: 'plinth', coliseum: 'gong' } as const;

export const PACT_TEXT: MapEventText = {
  omen: 'The altar offers a bargain.',
  phases: { available: 'Stones wait', warning: 'The stones stir', active: 'Choose a pact', complete: 'Pacts kept', failed: 'The altar falls silent' },
  objectives: ['Bold pacts kept (1 / 2)'],
  timers: ['Decide before the next wave'],
  // 0 is the call to choose; 1..6 follow PACT_IDS (swarm .. emberTax); 7 no pact; 8 round two.
  hints: [
    'Stand on a stone for one second to choose. The most-occupied stone wins.',
    'Swarm: the next wave brings 70% more monsters and 60% more loot.',
    'Blood Moon: every pack is magic or better, with 15% more monsters and 25% more life; 70% more loot.',
    'Ironhide: monsters of the next wave have 120% more life; 50% more rarity.',
    'Ambush: the wave arrives at once from every side, 25% bigger, 20% tougher; 40% more loot.',
    'Cinder Curse: you lose 20 resistance for the wave, monsters are 20% more and tougher; 35% more rarity.',
    'Ember Tax: no pact. Take the Scrap and the quiet.',
    'No pact this round. The altar waits.',
    'Round two. A bold first pact makes this one harder. Gold: both kept, nobody falls, each pact wave cleared in time.',
  ],
};
